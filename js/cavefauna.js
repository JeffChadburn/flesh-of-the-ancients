/**
 * Harmless cave life, streamed around the player from the analytic cave volume:
 *  - bat flocks roosting under high ceilings; they burst off the roost and swirl round the room
 *    when the torch comes close or you make noise, then settle again;
 *  - fish in the rendered cave stream and pool (they dart away from you);
 *  - spiders sitting on the rendered walls (found with BVH raycasts), scuttling off the torch.
 * All drawn with a handful of InstancedMeshes (phone friendly). Any of them can be speared:
 * bats and fish give a scrap of meat.
 */
import * as THREE from "three";
import { mulberry32 } from "./rng.js";

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), tmpE = new THREE.Euler();
const rc = new THREE.Raycaster();


function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function geoBat() {
  const body = new THREE.SphereGeometry(0.05, 6, 4); body.scale(1, 1, 1.7);
  const head = new THREE.SphereGeometry(0.035, 5, 4); head.translate(0, 0.01, -0.08);
  const g = mergeSimple([body, head]); g.scale(1.5, 1.5, 1.5);
  const wing = new THREE.BufferGeometry();
  // a scalloped membrane from the shoulder out to +x
  wing.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, -0.03, 0.22, 0.02, -0.05, 0.16, 0, 0.06, 0, 0, -0.03, 0.16, 0, 0.06, 0, 0, 0.05], 3));
  wing.scale(1.5, 1.5, 1.5); wing.computeVertexNormals();
  return { body: g, wing };
}
function geoSpider() {
  const parts = [];
  const ab = new THREE.SphereGeometry(0.05, 6, 4); ab.scale(1, 0.7, 1.25); ab.translate(0, 0.03, 0.05); parts.push(ab);
  const th = new THREE.SphereGeometry(0.03, 5, 4); th.translate(0, 0.025, -0.035); parts.push(th);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
    const l = new THREE.BoxGeometry(0.11, 0.008, 0.008); l.translate(0.055 * s, 0, 0);
    l.rotateZ(-0.5 * s); l.rotateY((i - 1.5) * 0.45 * s); l.translate(0.02 * s, 0.03, -0.035 + (i - 1.5) * 0.012); parts.push(l);
  }
  return mergeSimple(parts);
}
function geoFish() {
  const b = new THREE.SphereGeometry(0.045, 6, 4); b.scale(0.55, 0.8, 2.2);
  const t = new THREE.ConeGeometry(0.035, 0.07, 4); t.rotateX(Math.PI / 2); t.scale(0.3, 1, 1); t.translate(0, 0, 0.13);
  return mergeSimple([b, t]);
}
function mergeSimple(list) {
  const pos = [];
  for (const g0 of list) { const g = g0.index ? g0.toNonIndexed() : g0; pos.push(...g.attributes.position.array); }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

export class CaveFauna {
  constructor(scene, { lite = false, seed = 1 } = {}) {
    this.scene = scene; this.lite = lite; this.seed = seed;
    this.group = new THREE.Group(); this.group.name = "cave-fauna"; scene.add(this.group);
    const bg = geoBat();
    this.maxBats = lite ? 200 : 480; this.maxSpiders = lite ? 54 : 120; this.maxFish = lite ? 48 : 108; // round 9: 3x
    const batM = new THREE.MeshLambertMaterial({ color: 0x4e3e34 }), wingM = new THREE.MeshLambertMaterial({ color: 0x6a5044, side: THREE.DoubleSide });
    const spM = new THREE.MeshLambertMaterial({ color: 0x3a2e26 }), fishM = new THREE.MeshLambertMaterial({ color: 0xd8d0c6, emissive: 0x141414 });
    const mk = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.frustumCulled = false; this.group.add(m); return m; };
    this.batBody = mk(bg.body, batM, this.maxBats);
    this.batWing = mk(bg.wing, wingM, this.maxBats * 2);
    this.spMesh = mk(geoSpider(), spM, this.maxSpiders);
    this.fishMesh = mk(geoFish(), fishM, this.maxFish);
    this.flocks = new Map(); // hub id -> flock
    this.spiders = new Map(); // hub id -> [spider]
    this.fish = null;
    this.scanT = 0; this.time = 0;
    this.kills = { bat: 0, spider: 0, fish: 0 };
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); o.dispose?.(); } });
  }

  _ray(meshes, o, d, far) {
    rc.set(o, d); rc.near = 0; rc.far = far;
    for (const h of rc.intersectObjects(meshes, false)) {
      const n = h.face.normal;
      if (n.dot(d) >= 0) continue; // only the rock's lit (inner) face
      return h;
    }
    return null;
  }

  _scan(P, vol, meshes, water) {
    if (!vol || !meshes.length) return;
    const near = vol.hubs.filter((h) => Math.hypot(h.x - P.x, h.z - P.z) < 46 && Math.abs(h.y - P.y) < 18);
    let batBudget = this.maxBats - [...this.flocks.values()].reduce((n, f) => n + f.bats.length, 0);
    let spBudget = this.maxSpiders - [...this.spiders.values()].reduce((n, l) => n + l.length, 0);
    for (const h of near) {
      const rng = mulberry32(hashStr(h.id) ^ this.seed);
      const room = h.up + h.down, big = h.kind === "cavern";
      if (!this.flocks.has(h.id) && room > 3.2 && rng() < (big ? 1 : 0.85) && batBudget > 6) {
        // roost: the real ceiling above the hub (needs its rock streamed in)
        const hit = this._ray(meshes, tmpP.set(h.x, h.y - h.down + 1.2, h.z), UP, room + 4);
        if (hit) {
          const n = Math.min(batBudget, Math.round((big ? 30 + rng() * 20 : 10 + rng() * 10) * (this.lite ? 0.55 : 1)));
          const bats = [];
          for (let i = 0; i < n; i++) {
            const a = rng() * 6.28, r = rng() * Math.min(1.4, h.radius * 0.25);
            const rx = h.x + Math.cos(a) * r, rz = h.z + Math.sin(a) * r;
            const hh = this._ray(meshes, tmpP.set(rx, h.y - h.down + 1.2, rz), UP, room + 4);
            const ry = (hh ? hh.point.y : hit.point.y) - 0.1;
            bats.push({ roost: new THREE.Vector3(rx, ry, rz), pos: new THREE.Vector3(rx, ry, rz), vel: new THREE.Vector3(), yaw: rng() * 6.28, phase: rng() * 10, alive: true, wander: rng() * 10 });
          }
          const cy = h.y - h.down + Math.min(room * 0.55, Math.max(2.2, hit.point.y - (h.y - h.down) - 1.2));
          this.flocks.set(h.id, { hub: h, bats, state: "roost", t: 0, centre: new THREE.Vector3(h.x, cy, h.z), R: Math.max(2.2, Math.min(h.radius * 0.7, 9)), H: Math.max(0.8, Math.min(room * 0.3, 6)) });
          batBudget -= n;
        }
      }
      if (!this.spiders.has(h.id) && spBudget > 0) {
        const list = [];
        const n = 2 + Math.floor(rng() * (big ? 10 : 5)); // round 9: ~3x
        for (let i = 0; i < n && spBudget > 0; i++) {
          const a = rng() * 6.28, y = h.y - h.down + 0.5 + rng() * Math.min(2.2, room - 0.6);
          const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
          const hit = this._ray(meshes, new THREE.Vector3(h.x, y, h.z), d, Math.max(h.radius, h.left, h.right) + 4);
          if (!hit || Math.abs(hit.face.normal.y) > 0.6) continue;
          const nrm = hit.face.normal.clone();
          const tan = new THREE.Vector3().crossVectors(nrm, UP).normalize();
          list.push({ anchor: hit.point.clone().addScaledVector(nrm, 0.012), n: nrm, tan, off: 0, want: 0, t: rng() * 5, alive: true, phase: rng() * 6 });
          spBudget--;
        }
        this.spiders.set(h.id, list);
      }
    }
    // drop what's far behind
    for (const [id, f] of this.flocks) if (Math.hypot(f.hub.x - P.x, f.hub.z - P.z) > 70) this.flocks.delete(id);
    for (const [id, l] of this.spiders) { const h = vol.hubs.find((q) => q.id === id); if (!h || Math.hypot(h.x - P.x, h.z - P.z) > 70) this.spiders.delete(id); }
    // fish: schools along the visible stream and in the pool
    if (!this.fish && water && (water.path || water.features?.pool)) {
      const rng = mulberry32(this.seed ^ 0xf15);
      const fish = [], path = water.path || [];
      for (let i = 6; i < path.length - 6 && fish.length < this.maxFish - 6; i += 5 + Math.floor(rng() * 4)) {
        const n = 1 + Math.floor(rng() * 3);
        for (let k = 0; k < n; k++) fish.push({ mode: "stream", i0: i - 5, i1: i + 5, u: i + rng() * 2 - 1, dir: rng() < 0.5 ? 1 : -1, side: (rng() - 0.5) * 0.5, speed: 0.8 + rng() * 0.8, alive: true, phase: rng() * 6, dart: 0 });
      }
      const pool = water.features?.pool;
      if (pool) for (let k = 0; k < (this.lite ? 9 : 18); k++) fish.push({ mode: "pool", a: rng() * 6.28, r: pool.radius * (0.25 + rng() * 0.6), speed: (0.25 + rng() * 0.3) * (rng() < 0.5 ? 1 : -1), alive: true, phase: rng() * 6, dart: 0 });
      this.fish = fish;
    }
  }

  update(dt, { pos: P, cam, noise = 0, volume, meshes, water }) {
    this.time += dt;
    this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = 1.2; this._scan(P, volume, meshes || [], water); }
    const t = this.time;
    // ---- bats ----
    let nb = 0, nw = 0;
    for (const f of this.flocks.values()) {
      const dTorch = cam.distanceTo(f.centre), dRoost = f.bats.length ? cam.distanceTo(f.bats[0].roost) : 99;
      if (f.state === "roost" && (dRoost < 9 || (noise > 0.55 && dTorch < 16) || (noise > 0.3 && dTorch < 9))) { f.state = "fly"; f.t = 0; this.lastScatter = { id: f.hub.id, t }; }
      if (f.state === "fly") { f.t += dt; if (f.t > 14 && dRoost > 7 && noise < 0.4) { f.state = "home"; f.t = 0; } }
      else if (f.state === "home") { f.t += dt; if (dRoost < 5 || noise > 0.55) { f.state = "fly"; f.t = 0; } }
      const far = cam.distanceTo(f.centre) > 55;
      for (const b of f.bats) {
        if (!b.alive) continue;
        if (f.state === "roost") { b.pos.copy(b.roost); b.vel.set(0, 0, 0); }
        else {
          b.wander += dt * (0.6 + (b.phase % 1));
          const tx = f.centre.x + Math.cos(b.wander + b.phase) * f.R, tz = f.centre.z + Math.sin(b.wander * 1.3 + b.phase) * f.R;
          const ty = f.centre.y + Math.sin(b.wander * 0.7 + b.phase * 2) * f.H;
          const goal = f.state === "home" ? b.roost : tmpP.set(tx, ty, tz);
          const ax = goal.x - b.pos.x, ay = goal.y - b.pos.y, az = goal.z - b.pos.z;
          const k = f.state === "home" ? 2.2 : 1.6;
          b.vel.x += (ax * k - b.vel.x) * Math.min(1, dt * 2.5); b.vel.y += (ay * k - b.vel.y) * Math.min(1, dt * 2.5); b.vel.z += (az * k - b.vel.z) * Math.min(1, dt * 2.5);
          // swerve around the player's head
          const px = b.pos.x - cam.x, py = b.pos.y - cam.y, pz = b.pos.z - cam.z, pd = Math.hypot(px, py, pz);
          if (pd < 1.6) { b.vel.x += (px / pd) * 12 * dt * 4; b.vel.z += (pz / pd) * 12 * dt * 4; }
          const sp = Math.hypot(b.vel.x, b.vel.y, b.vel.z), mx = f.state === "home" ? 5 : 7;
          if (sp > mx) b.vel.multiplyScalar(mx / sp);
          b.pos.addScaledVector(b.vel, dt);
          if (Math.hypot(b.vel.x, b.vel.z) > 0.2) b.yaw = Math.atan2(-b.vel.x, -b.vel.z);
          if (f.state === "home" && b.pos.distanceTo(b.roost) < 0.15) b.pos.copy(b.roost);
        }
        if (far || nb >= this.maxBats) continue;
        const hanging = b.pos.equals(b.roost);
        // body: hanging upside down under the roost, or flying level
        tmpE.set(hanging ? Math.PI * 0.5 : 0, b.yaw, 0, "YXZ"); tmpQ.setFromEuler(tmpE);
        tmpM.compose(hanging ? tmpP.set(b.pos.x, b.pos.y - 0.06, b.pos.z) : b.pos, tmpQ, tmpS.set(1, 1, 1));
        this.batBody.setMatrixAt(nb++, tmpM);
        const flap = hanging ? 1.35 : Math.sin(t * 22 + b.phase * 7) * 0.9;
        for (const s of [1, -1]) {
          tmpE.set(hanging ? Math.PI * 0.5 : 0, b.yaw, s * flap, "YXZ"); tmpQ.setFromEuler(tmpE);
          tmpM.compose(hanging ? tmpP.set(b.pos.x, b.pos.y - 0.06, b.pos.z) : b.pos, tmpQ, tmpS.set(s * (hanging ? 0.35 : 1), 1, 1));
          this.batWing.setMatrixAt(nw++, tmpM);
        }
      }
    }
    this.batBody.count = nb; this.batWing.count = nw;
    this.batBody.instanceMatrix.needsUpdate = true; this.batWing.instanceMatrix.needsUpdate = true;
    // ---- spiders ----
    let ns = 0;
    for (const list of this.spiders.values()) for (const s of list) {
      if (!s.alive || ns >= this.maxSpiders) continue;
      const d = cam.distanceTo(s.anchor);
      s.t -= dt;
      if (d < 2.2) s.want = s.off > 0 ? 1.1 : -1.1; // scuttle away from the torch
      else if (s.t < 0) { s.t = 2 + Math.random() * 5; s.want = (Math.random() - 0.5) * 0.9; }
      const v = d < 2.2 ? 1.6 : 0.25;
      s.off += Math.sign(s.want - s.off) * Math.min(Math.abs(s.want - s.off), v * dt);
      if (d > 40) continue;
      tmpP.copy(s.anchor).addScaledVector(s.tan, s.off);
      // spider up = wall normal, facing along its crawl direction
      tmpQ.setFromUnitVectors(UP, s.n);
      const spin = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(s.want - s.off >= 0 ? 1 : -1, 0) + Math.sin(t * 2 + s.phase) * 0.15);
      tmpQ.multiply(spin);
      tmpM.compose(tmpP, tmpQ, tmpS.set(1.15, 1.15, 1.15));
      this.spMesh.setMatrixAt(ns++, tmpM);
      s.pos = s.pos || new THREE.Vector3(); s.pos.copy(tmpP);
    }
    this.spMesh.count = ns; this.spMesh.instanceMatrix.needsUpdate = true;
    // ---- fish ----
    let nf = 0;
    const path = water?.path, pool = water?.features?.pool;
    if (this.fish) for (const f of this.fish) {
      if (!f.alive || nf >= this.maxFish) continue;
      let x, y, z, yaw;
      f.dart = Math.max(0, f.dart - dt);
      if (f.mode === "stream" && path && path.length > 2) {
        const sp = f.speed * (f.dart > 0 ? 4 : 1);
        f.u += f.dir * sp * dt * 1.4;
        const lo = Math.max(0, f.i0), hi = Math.min(path.length - 2, f.i1);
        if (f.u < lo) { f.u = lo; f.dir = 1; } if (f.u > hi) { f.u = hi; f.dir = -1; }
        const i = Math.floor(f.u), k = f.u - i, a = path[i], b = path[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
        const side = f.side * a.w + Math.sin(t * 1.3 + f.phase) * 0.05;
        x = a.x + dx * k - (dz / l) * side; z = a.z + dz * k + (dx / l) * side; y = a.y + (b.y - a.y) * k - 0.025;
        yaw = Math.atan2(-dx * f.dir, -dz * f.dir) + Math.sin(t * 9 + f.phase) * 0.18;
      } else if (f.mode === "pool" && pool) {
        f.a += f.speed * dt * (f.dart > 0 ? 4 : 1);
        x = pool.x + Math.cos(f.a) * f.r; z = pool.z + Math.sin(f.a) * f.r; y = pool.y - 0.03;
        yaw = Math.atan2(Math.sin(f.a) * Math.sign(f.speed), -Math.cos(f.a) * Math.sign(f.speed)) + Math.sin(t * 9 + f.phase) * 0.18;
      } else continue;
      if (Math.hypot(x - cam.x, z - cam.z) < 1.8 && f.dart <= 0) { f.dart = 1.2; if (f.dir) f.dir = -f.dir; }
      f.pos = f.pos || new THREE.Vector3(); f.pos.set(x, y, z);
      if (Math.hypot(x - cam.x, z - cam.z) > 35) continue;
      tmpE.set(0, yaw, 0); tmpQ.setFromEuler(tmpE);
      tmpM.compose(f.pos, tmpQ, tmpS.set(1, 1, 1));
      this.fishMesh.setMatrixAt(nf++, tmpM);
    }
    this.fishMesh.count = nf; this.fishMesh.instanceMatrix.needsUpdate = true;
  }

  /** Spear thrust from the feet (fx, fz facing). Returns { kind, alive:false, food } or null. */
  tryHit(f, fx, fz) {
    let best = null, bd = 2.7, kill = null;
    const consider = (p, kind, obj, dyMax) => {
      if (!p) return;
      const dx = p.x - f.x, dz = p.z - f.z, d = Math.hypot(dx, dz);
      if (d > bd || p.y - f.y > dyMax || p.y - f.y < -1.2) return;
      const dot = d > 0.05 ? (dx * fx + dz * fz) / d : 1;
      if (dot < 0.45) return;
      bd = d; best = obj; kill = kind;
    };
    for (const fl of this.flocks.values()) for (const b of fl.bats) if (b.alive) consider(b.pos, "bat", b, 2.3);
    for (const l of this.spiders.values()) for (const s of l) if (s.alive) consider(s.pos, "spider", s, 2.3);
    for (const fi of this.fish || []) if (fi.alive) consider(fi.pos, "fish", fi, 0.8);
    if (!best) return null;
    best.alive = false;
    this.kills[kill]++;
    return { kind: kill, alive: false, food: kill !== "spider" };
  }

  /** Arrow test: kill the creature nearest point p within r. */
  hitAt(p, r = 0.45) {
    let best = null, bd = r, kind = null;
    const c = (q, k, o) => { if (!q) return; const d = q.distanceTo(p); if (d < bd) { bd = d; best = o; kind = k; } };
    for (const fl of this.flocks.values()) for (const b of fl.bats) if (b.alive) c(b.pos, "bat", b);
    for (const l of this.spiders.values()) for (const s of l) if (s.alive) c(s.pos, "spider", s);
    for (const f of this.fish || []) if (f.alive) c(f.pos, "fish", f);
    if (!best) return null;
    best.alive = false; this.kills[kind]++;
    return { kind, alive: false, food: kind !== "spider" };
  }

  stats() {
    let bats = 0, flying = 0; for (const f of this.flocks.values()) { bats += f.bats.filter((b) => b.alive).length; if (f.state !== "roost") flying++; }
    let sp = 0; for (const l of this.spiders.values()) sp += l.filter((s) => s.alive).length;
    return { flocks: this.flocks.size, bats, flying, spiders: sp, fish: (this.fish || []).filter((f) => f.alive).length, drawn: { bats: this.batBody.count, spiders: this.spMesh.count, fish: this.fishMesh.count }, kills: { ...this.kills }, lastScatter: this.lastScatter || null };
  }
}
