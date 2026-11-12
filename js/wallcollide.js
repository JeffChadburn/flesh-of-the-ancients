/**
 * Mesh-accurate wall collision for caves. The analytic LRUD volume gives the floor / ceiling, but
 * its slabs and hub discs only approximate the lumpy rendered rock, so at dead ends, stubs and
 * junctions you could walk into (and through) visible walls. This clamps horizontal movement
 * against the actual rendered passage triangles (BVH raycasts), so collision matches what you see.
 * Only wall-like triangles (-0.6 < normal.y < 0.45) that face the player block; floors / ceilings and
 * the culled back of an overlapping tube never do.
 */
import * as THREE from "three";
import { computeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export function ensureBVH(geo) {
  if (geo && !geo.boundsTree && geo.index && geo.index.count) geo.computeBoundsTree({ maxLeafTris: 12 });
}

const rc = new THREE.Raycaster();
const O = new THREE.Vector3(), D = new THREE.Vector3();
const PUSH_DIRS = [...Array(10)].map((_, i) => [Math.cos((i / 10) * Math.PI * 2), Math.sin((i / 10) * Math.PI * 2)]);

// Round 13: a triangle under ~0.005 m^2 (a sliver or a degenerate fragment the mesher left floating)
// is not a wall you could see well enough to expect it to stop you.
const TA = new THREE.Vector3(), TB = new THREE.Vector3(), TC = new THREE.Vector3();
function tinyTri(h) {
  const pos = h.object?.geometry?.attributes?.position, f = h.face;
  if (!pos || !f) return false;
  TA.fromBufferAttribute(pos, f.a); TB.fromBufferAttribute(pos, f.b); TC.fromBufferAttribute(pos, f.c);
  TB.sub(TA); TC.sub(TA);
  return TB.cross(TC).length() * 0.5 < 0.005;
}

/** First wall hit (front-facing, wall-like) along a horizontal ray; null if none within far. */
function wallHit(meshes, ox, oy, oz, dx, dz, far, head = false) {
  O.set(ox, oy, oz); D.set(dx, 0, dz);
  rc.set(O, D); rc.near = 0; rc.far = far;
  const hits = rc.intersectObjects(meshes, false);
  for (const h of hits) {
    const n = h.face.normal;
    if (n.x * dx + n.z * dz >= 0) continue; // seen from behind (culled): not a wall from here
    if (n.y > 0.45 || n.y < -0.6) continue; // floor slopes / ceiling lumps are the volume's business
    if (head && n.y > 0.2) continue; // underside of a higher passage's floor at head height: an overhang, not a wall
    if (tinyTri(h)) continue; // round 13: slivers / degenerate fragments don't snag you
    const hl = Math.hypot(n.x, n.z) || 1;
    return { dist: h.distance, nx: n.x / hl, nz: n.z / hl };
  }
  return null;
}

export class WallCollider {
  constructor(getMeshes) { this.getMeshes = getMeshes; this.hits = 0; this.pushes = 0; }

  heights(st, room) {
    const hs = st.id === "crawl" ? [0.3] : st.id === "crouch" ? [0.5, 0.78] : [0.6, 1.0, 1.4];
    const out = hs.filter((h) => h < room - 0.1);
    return out.length ? out : [Math.max(0.12, room * 0.5)];
  }

  /** from/to: eye positions; floor/ceil: at the target. Returns corrected {x, z}. */
  resolve(from, to, floor, ceil, st) {
    const meshes = this.getMeshes();
    if (!meshes || !meshes.length) return { x: to.x, z: to.z, hit: false };
    // A slimmer skin than the analytic capsule: the lumpy rock may pinch a little below the LRUD
    // width, and the generator guarantees passability by LRUD, so never block a legal squeeze.
    const r = Math.min(0.19, (st.radius || 0.28) * 0.7);
    const feet = Math.min(floor, from.y - st.eye);
    const hs = this.heights(st, ceil - feet);
    // Round 12: mid-jump the body is higher than the floor band: test its real heights too.
    const lift = from.y - st.eye - floor;
    if (lift > 0.05) for (const h of this.heights(st, 9)) { const hh = h + lift; if (hh < ceil - feet - 0.05) hs.push(hh); }
    let px = from.x, pz = from.z, mx = to.x - from.x, mz = to.z - from.z, hit = false;
    for (let iter = 0; iter < 3; iter++) {
      const len = Math.hypot(mx, mz);
      if (len < 1e-6) break;
      const dx = mx / len, dz = mz / len;
      let best = null;
      for (const h of hs) {
        const w = wallHit(meshes, px, feet + h, pz, dx, dz, len + r, h > 1.1);
        if (w && (!best || w.dist < best.dist)) best = w;
      }
      if (!best) { px += mx; pz += mz; break; }
      hit = true;
      const travel = Math.max(0, best.dist - r);
      px += dx * travel; pz += dz * travel;
      let rx = dx * (len - travel), rz = dz * (len - travel);
      const into = rx * best.nx + rz * best.nz; // < 0: pushing into the wall
      if (into < 0) { rx -= best.nx * into; rz -= best.nz * into; }
      mx = rx * 0.98; mz = rz * 0.98;
    }
    // Push out of any wall closer than the body radius (corners, lumps you slid along).
    const hm = hs[Math.floor(hs.length / 2)];
    for (let k = 0; k < 2; k++) {
      let ox = 0, oz = 0;
      for (const [dx, dz] of PUSH_DIRS) {
        const w = wallHit(meshes, px, feet + hm, pz, dx, dz, r);
        if (w) { const pen = r - w.dist; ox += w.nx * pen * 0.6; oz += w.nz * pen * 0.6; }
      }
      if (Math.abs(ox) + Math.abs(oz) < 1e-4) break;
      px += ox; pz += oz; this.pushes++;
    }
    if (hit) this.hits++;
    return { x: px, z: pz, hit };
  }

  /** Debug: raw hits around a position (all directions, all heights). */
  probe(pos, feet, st, far = 1.2) {
    const meshes = this.getMeshes(), out = [];
    for (const h of this.heights(st, 9)) for (const [dx, dz] of PUSH_DIRS) {
      O.set(pos.x, feet + h, pos.z); D.set(dx, 0, dz); rc.set(O, D); rc.far = far;
      const hit = rc.intersectObjects(meshes, false)[0];
      if (hit) out.push({ h, dir: [+dx.toFixed(2), +dz.toFixed(2)], d: +hit.distance.toFixed(2), n: [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z].map((v) => +v.toFixed(2)), p: [hit.point.x, hit.point.y, hit.point.z].map((v) => +v.toFixed(2)) });
    }
    return out;
  }

  /** Does the straight move a->b (same height band) cross a visible wall? (tests / debugging) */
  crosses(a, b, feet, st) {
    const meshes = this.getMeshes();
    if (!meshes || !meshes.length) return false;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) return false;
    for (const h of this.heights(st, 9)) if (wallHit(meshes, a.x, feet + h, a.z, (b.x - a.x) / len, (b.z - a.z) / len, len, h > 1.1)) return true;
    return false;
  }
}
