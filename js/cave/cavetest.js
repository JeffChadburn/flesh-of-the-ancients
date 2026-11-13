/**
 * Round 27 test hooks (used by the regression suite, not by play):
 *  walkCave: walks the player (real movement code, real collision) along every leg of the cave,
 *            changing stance for squeezes like a player would, and reports misses (never got there),
 *            stuck spots, safety-net rescues, time outside the walk volume and falls below the floor.
 *  meshProbe: builds the whole wall mesh and casts rays along every leg: no floor under you (hole /
 *            fall-through), no wall / roof where there should be one (seam hole), rock inside the
 *            passage (stray / broken triangles), and sliver-triangle counts.
 */
import * as THREE from "three";
import { stationMap, stationWorld } from "../cave-data.js";
import { queryVolume, requiredStanceAt, STANCES } from "../volume.js";
import { prepareCavePieces, makePieceBuffer, pieceBufferGeometry } from "../mesh.js";
import { ensureBVH } from "../wallcollide.js";

const RANK = { stand: 0, crouch: 1, crawl: 2 };

export function walkCave({ cave, player, camera, substeps, prime = () => {}, legs = null, dt = 1 / 30, sprint = true, limit = Infinity }) {
  const P = player, c = camera.position, vol = P.volume, smap = stationMap(cave);
  const feet = (s) => { const w = stationWorld(s); const q = queryVolume(vol, w.x, w.y, w.z, 0.05, 0.3); return { x: w.x, y: q.inside ? q.floor : w.y - s.down, z: w.z }; };
  const list = (legs || cave.legs).slice(0, limit);
  const out = { legs: list.length, ok: 0, miss: [], stuck: [], rescues: 0, outside: 0, falls: [], frames: 0, crawled: 0, crouched: 0 };
  const r0 = P.rescues || 0;
  for (const leg of list) {
    const a = smap.get(leg.from), b = smap.get(leg.to);
    if (!a || !b) continue;
    const fa = feet(a), fb = feet(b);
    P.setStance("stand"); P.placeWorld(fa.x, fa.y + 0.05, fa.z); prime();
    let primeAt = { x: fa.x, z: fa.z };
    const len = Math.hypot(fb.x - fa.x, fb.z - fa.z);
    const maxF = Math.ceil((len / 0.45 + 6) / dt);
    let ok = false, run = 0, anc = { x: c.x, z: c.z }, still = 0;
    for (let f = 0; f < maxF; f++) {
      const dx = fb.x - c.x, dz = fb.z - c.z, d = Math.hypot(dx, dz);
      if (d < 0.8) { ok = true; break; }
      P.yaw = Math.atan2(-dx / d, -dz / d);
      // stance like a player: drop for what's just ahead, stand back up when it fits
      let need = "stand";
      for (const k of [0, 0.5, 1.1, 1.8]) {
        const q = requiredStanceAt(vol, c.x - Math.sin(P.yaw) * k, c.y, c.z - Math.cos(P.yaw) * k);
        if (RANK[q] > RANK[need]) need = q;
      }
      if (still > 1.6 && RANK[need] < 2) need = still > 2.6 ? "crawl" : "crouch"; // the rock says lower than the volume did
      const cur = P.stance;
      if (RANK[need] > RANK[cur]) P.setStance(need);
      else if (RANK[need] < RANK[cur] && P.canUseStance(need)) P.setStance(need);
      if (P.stance === "crawl") out.crawled++; else if (P.stance === "crouch") out.crouched++;
      P.keys.clear(); P.keys.add("KeyW"); if (sprint && P.stance === "stand" && still < 0.5) P.keys.add("ShiftLeft");
      // blocked (a column, a boulder, a jutting wall): side-step like a player, alternating sides
      if (still > 0.5) { const side = Math.floor((still - 0.5) / 0.8) % 2 ? "KeyA" : "KeyD"; P.keys.add(side); out.sidesteps = (out.sidesteps || 0) + 1; }
      const ns = substeps(dt); for (let j = 0; j < ns; j++) P.update(dt / ns);
      if (Math.hypot(c.x - primeAt.x, c.z - primeAt.z) > 6) { prime(); primeAt = { x: c.x, z: c.z }; }
      out.frames++;
      const q = queryVolume(vol, c.x, c.y, c.z, 0.05, 0.1);
      if (!q.inside) out.outside++;
      const fy = c.y - (STANCES[P.stance] || STANCES.stand).eye;
      if (q.inside && fy < q.floor - 0.9) { out.falls.push(`${a.id}->${b.id}`); break; }
      if (Math.hypot(c.x - anc.x, c.z - anc.z) > 0.35) { anc = { x: c.x, z: c.z }; still = 0; } else still += dt;
      run = Math.max(run, still);
      if (still > 5) break;
    }
    P.keys.clear();
    if (ok) out.ok++;
    else out.miss.push({ leg: `${a.id}->${b.id}`, at: [+c.x.toFixed(1), +c.y.toFixed(1), +c.z.toFixed(1)], left: +Math.hypot(fb.x - c.x, fb.z - c.z).toFixed(1), stance: P.stance });
    if (run > 1.5) out.stuck.push({ leg: `${a.id}->${b.id}`, s: +run.toFixed(1) });
  }
  out.rescues = (P.rescues || 0) - r0;
  out.miss = out.miss.slice(0, 12); out.stuck = out.stuck.slice(0, 12); out.falls = out.falls.slice(0, 12);
  return out;
}

export function meshProbe(cave, opts = {}) {
  const { step = 1.2 } = opts;
  const t0 = performance.now();
  const { pieces } = prepareCavePieces(cave);
  const buf = makePieceBuffer();
  for (const pc of pieces) for (const _ of pc.emit(buf)); // eslint-disable-line no-unused-vars
  const geo = pieceBufferGeometry(buf);
  ensureBVH(geo);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);
  // triangle quality
  const pos = geo.attributes.position, idx = geo.index.array;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  let slivers = 0, tiny = 0;
  for (let i = 0; i < idx.length; i += 3) {
    A.fromBufferAttribute(pos, idx[i]); B.fromBufferAttribute(pos, idx[i + 1]); C.fromBufferAttribute(pos, idx[i + 2]);
    const ab = A.distanceTo(B), bc = B.distanceTo(C), ca = C.distanceTo(A), mx = Math.max(ab, bc, ca);
    const area = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A)).length() / 2;
    if (area < 1e-5) tiny++;
    else if (mx * mx / (2 * area) > 40) slivers++; // longest edge / height > 40
  }
  const rc = new THREE.Raycaster();
  const smap = stationMap(cave);
  const res = { tris: idx.length / 3, slivers, tiny, samples: 0, rays: 0, noFloor: [], holes: [], intrude: [] };
  // First hit along a ray: front face (rock facing us) is right; a back face (the outside of some
  // tube seen through a gap) or nothing at all means a hole / seam you could see through.
  const first = (o, d, far = 150) => {
    rc.set(o, d); rc.near = 0; rc.far = far;
    const h = rc.intersectObject(mesh, false)[0];
    if (!h) return { kind: "none" };
    return { kind: h.face.normal.dot(d) < 0 ? "front" : "back", dist: h.distance };
  };
  const DIRS = [];
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; DIRS.push([Math.cos(a), Math.sin(a)]); }
  for (const leg of cave.legs) {
    const a = smap.get(leg.from), b = smap.get(leg.to);
    const pa = stationWorld(a), pb = stationWorld(b);
    const L = Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
    const n = Math.max(1, Math.floor(L / step));
    const fwd = new THREE.Vector3(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z).normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x).normalize();
    const upv = new THREE.Vector3().crossVectors(right, fwd).normalize();
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = pa.x + (pb.x - pa.x) * t, y = pa.y + (pb.y - pa.y) * t, z = pa.z + (pb.z - pa.z) * t;
      const down = a.down + (b.down - a.down) * t, up = a.up + (b.up - a.up) * t;
      const half = Math.min(a.left, a.right, b.left, b.right);
      const fl = y - down, hgt = up + down;
      const tag = `${a.id}->${b.id}@${t.toFixed(2)}`;
      res.samples++;
      const o = new THREE.Vector3(x, fl + Math.min(1.0, hgt * 0.45), z);
      const f = first(new THREE.Vector3(x, fl + Math.min(0.6, hgt * 0.4), z), new THREE.Vector3(0, -1, 0), 2.5);
      if (f.kind !== "front") res.noFloor.push(tag);
      for (const [c, sn] of DIRS) {
        const d = right.clone().multiplyScalar(c).addScaledVector(upv, sn).normalize();
        const h = first(o, d);
        res.rays++;
        if (h.kind !== "front") res.holes.push(`${tag} ${h.kind} ${(Math.atan2(sn, c) * 57.3).toFixed(0)}°`);
        else if (Math.abs(sn) < 0.2 && h.dist < Math.max(0.2, half * 0.45) - 0.05) res.intrude.push(`${tag} ${h.dist.toFixed(2)}`);
      }
    }
  }
  geo.disposeBoundsTree?.(); geo.dispose();
  for (const k of ["noFloor", "holes", "intrude"]) { res[k + "N"] = res[k].length; if (!opts.full) res[k] = res[k].slice(0, 10); }
  res.ms = Math.round(performance.now() - t0);
  return res;
}
