/**
 * Round 19: boats. Stone-age craft on the round-18 water bodies:
 *  - canoe: a dugout log for lakes and rivers
 *  - raft: lashed logs and reed bundles for the marsh (also the one you can build)
 *  - umiak: a big skin boat on a driftwood frame for the ocean and the north coast
 * Boats sit docked (a little log jetty) by the towns, the camp, lakes, river mouths and along the
 * coast. Board with E / Ride, paddle (forward / back, turn), the river current pushes you
 * downstream, and a boat never leaves the water: it stops at the shoreline (and the Beach button
 * puts you ashore if you ever get wedged).
 */
import * as THREE from "three";
import { colorize, merge } from "./overworld.js";
import { colCore } from "./terrain.js";
import { WORLD_HALF } from "./biomes.js";

export const BOAT_KINDS = {
  canoe: { name: "dugout canoe", len: 4.6, max: 4.2, sprint: 6.2, back: 1.6, turn: 1.25, draft: 0.38, seat: 0.12, cur: 1 },
  raft: { name: "reed raft", len: 3.0, max: 2.4, sprint: 3.4, back: 1.1, turn: 0.95, draft: 0.26, seat: 0.3, cur: 1.15 },
  umiak: { name: "skin boat", len: 6.4, max: 4.8, sprint: 7.0, back: 1.6, turn: 0.8, draft: 0.5, seat: 0.22, cur: 0.8 },
};
const BOUND = WORLD_HALF - 40;

function hullGeo(L, W, H, wood, inside) {
  const g = new THREE.BoxGeometry(W, H, L, 2, 1, 14), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), u = z / (L / 2), k = Math.max(0.05, 1 - u * u * 0.95);
    if (y < 0) p.setXYZ(i, x * k * 0.55, y + u * u * H * 0.55, z);
    else p.setXYZ(i, x * k, y + Math.pow(Math.abs(u), 4) * 0.22, z);
  }
  g.translate(0, H / 2, 0);
  const c0 = new THREE.Color(wood), cIn = new THREE.Color(inside);
  return colorize(g, (c, x, y) => { c.copy(c0).multiplyScalar(0.7 + 0.3 * Math.min(1, y / H)); if (y > H * 0.9 && Math.abs(x) < 0.01) c.copy(cIn); });
}
function canoeGeo() { return merge([hullGeo(4.6, 0.78, 0.42, 0x4e3420, 0x1e140a)]); }
function umiakGeo() {
  const parts = [hullGeo(6.4, 1.45, 0.62, 0xc9b088, 0x4a3a28)];
  for (let i = -2; i <= 2; i++) { // thwarts (driftwood frame)
    const z = i * 1.1, u = z / 3.2, w = 1.45 * Math.max(0.05, 1 - u * u * 0.95);
    const b = new THREE.BoxGeometry(w, 0.06, 0.09); b.translate(0, 0.64, z); parts.push(colorize(b, (c) => c.setHex(0x5a4430)));
  }
  return merge(parts);
}
function raftGeo() {
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const g = new THREE.CylinderGeometry(0.15, 0.15, 3.0 - (i % 2) * 0.25, 6); g.rotateX(Math.PI / 2); g.translate(-0.9 + i * 0.3, 0.15, 0);
    parts.push(colorize(g, (c) => c.setHex(i % 2 ? 0x6a5236 : 0x7a6040)));
  }
  for (const z of [-1.1, 1.1]) { const g = new THREE.CylinderGeometry(0.08, 0.08, 2.3, 5); g.rotateZ(Math.PI / 2); g.translate(0, 0.32, z); parts.push(colorize(g, (c) => c.setHex(0x4a3a26))); }
  for (const x of [-0.75, 0.75]) { const g = new THREE.CylinderGeometry(0.16, 0.12, 2.6, 6); g.rotateX(Math.PI / 2); g.translate(x, 0.38, 0); parts.push(colorize(g, (c) => c.setHex(0x857a46))); } // reed bundles
  return merge(parts);
}
function dockGeo() {
  const parts = [];
  const deck = new THREE.BoxGeometry(1.3, 0.12, 1, 1, 1, 1); deck.translate(0, 0, 0.5);
  parts.push(colorize(deck, (c) => c.setHex(0x6a5236)));
  return merge(parts);
}
function postGeo() { const g = new THREE.CylinderGeometry(0.09, 0.11, 1, 5); g.translate(0, -0.5, 0); return merge([colorize(g, (c) => c.setHex(0x4a3a26))]); }
function paddleGeo() {
  const s = new THREE.CylinderGeometry(0.025, 0.03, 1.7, 5); s.translate(0, -0.35, 0);
  const b = new THREE.BoxGeometry(0.16, 0.5, 0.03); b.translate(0, -1.1, 0);
  return merge([colorize(s, (c) => c.setHex(0x7a5a38)), colorize(b, (c) => c.setHex(0x6a4a2c))]);
}
export const PADDLE_GEO = paddleGeo;

export class Boats {
  constructor(terrain, parent, { lite = false } = {}) {
    this.t = terrain; this.lite = lite;
    this.group = new THREE.Group(); this.group.name = "boats"; parent.add(this.group);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    this.geo = { canoe: canoeGeo(), raft: raftGeo(), umiak: umiakGeo() };
    this.dockG = dockGeo(); this.postG = postGeo();
    this.list = []; this.docks = [];
    this.wake = [];
    const ringG = new THREE.RingGeometry(0.55, 0.8, 16); ringG.rotateX(-Math.PI / 2);
    for (let i = 0; i < (lite ? 14 : 24); i++) {
      const m = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: 0xe8f2f4, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; m.renderOrder = 3; this.group.add(m); this.wake.push({ m, life: 0, vx: 0, vz: 0 });
    }
    this.wakeI = 0; this.wakeT = 0;
    this.plan();
  }

  /** Water surface at a point, the town lakes included (they have their own basins). */
  water(x, z) {
    for (const s of this.t.settlements || []) {
      const L = s.lake; if (!L) continue;
      if (Math.abs(x - L.x) < L.r + 8 && Math.abs(z - L.z) < L.r + 8 && Math.hypot(x - L.x, z - L.z) < (L.shore || L.r)) return { y: L.level, kind: "lake", fx: 0, fz: 0, town: s };
    }
    return this.t.bio.ready ? this.t.bio.waterAt(x, z) : null;
  }
  depth(x, z) { const w = this.water(x, z); return w ? w.y - this.t.height(x, z) : -1; }
  kindFor(w, x, z) {
    if (!w) return "canoe";
    if (w.kind === "marsh") return "raft";
    if (w.kind === "ocean") return "umiak";
    return this.t.bio.weights(x, z).tundra > 0.6 ? "umiak" : "canoe";
  }
  /** Dry, gentle, uncluttered ground (a place to step ashore). */
  dryOK(x, z) {
    if (Math.abs(x) > BOUND || Math.abs(z) > BOUND) return false;
    if (this.depth(x, z) > -0.05) return false;
    if (this.t.slope(x, z).m > 0.55) return false;
    return this.t.collidersNear(x, z, 0.8).every((c) => { const q = colCore(c, x, z); return Math.hypot(q.x - x, q.z - z) > q.t + 0.45; });
  }
  /** Nearest dry landing within `R` m of (x, z): {x, z, d} or null. */
  landing(x, z, R = 9) {
    for (let d = 1.5; d <= R; d += 0.75) for (let a = 0; a < 20; a++) {
      const ang = a * 0.314 + d * 0.37, lx = x + Math.cos(ang) * d, lz = z + Math.sin(ang) * d;
      if (this.dryOK(lx, lz)) return { x: lx, z: lz, d };
    }
    return null;
  }
  /** A spot in water at least `need` deep with dry shore within 12 m, near (px, pz) (rings out to R). */
  spot(px, pz, R, need = 0.9) {
    for (let r = 0; r <= R; r += 8) {
      const n = r === 0 ? 1 : Math.min(56, Math.max(10, Math.round(r / 9)));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r * 0.01, x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
        const s = this.shoreSpot(x, z, need); if (s) return s;
      }
    }
    return null;
  }
  shoreSpot(x, z, need = 0.9) {
    if (Math.abs(x) > BOUND - 30 || Math.abs(z) > BOUND - 30) return null;
    if (this.depth(x, z) < need) return null;
    let best = null;
    for (let k = 0; k < 12; k++) {
      const a = k * 0.5236, cs = Math.cos(a), sn = Math.sin(a);
      for (let d = 3; d <= 12; d += 1.5) {
        const lx = x + cs * d, lz = z + sn * d;
        if (this.depth(lx, lz) > -0.05) continue;
        if (this.dryOK(lx, lz) && (!best || d < best.d)) best = { d, x: lx, z: lz };
        break;
      }
    }
    return best ? { x, z, shore: best } : null;
  }

  add(kind, x, z, yaw, opts = {}) {
    const K = BOAT_KINDS[kind], m = new THREE.Mesh(this.geo[kind], this.mat);
    m.name = "boat-" + kind;
    const w = this.water(x, z);
    const b = { id: this.list.length, kind, K, x, z, yaw, v: 0, yr: 0, mesh: m, y: w ? w.y : 0, ph: Math.random() * 6, home: opts.home || "", taken: false, wkind: w?.kind || "lake" };
    m.position.set(x, b.y, z); m.rotation.y = yaw;
    this.group.add(m); this.list.push(b);
    return b;
  }
  /** A boat docked at a shore spot (a short jetty runs from the bank out to its side). */
  dock(s, kind, home) {
    if (this.list.some((b) => Math.hypot(b.x - s.x, b.z - s.z) < 40)) return null;
    const w = this.water(s.x, s.z), dx = s.x - s.shore.x, dz = s.z - s.shore.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
    kind = kind || this.kindFor(w, s.x, s.z);
    const K = BOAT_KINDS[kind];
    // boat alongside the jetty end, bow pointing out to open water
    let bx = s.x, bz = s.z;
    for (const side of [1, -1]) { const tx = s.x - uz * side * 1.25, tz = s.z + ux * side * 1.25; if (this.depth(tx, tz) > K.draft + 0.2 && this.depth(tx + ux * K.len * 0.5, tz + uz * K.len * 0.5) > K.draft) { bx = tx; bz = tz; break; } }
    const b = this.add(kind, bx, bz, Math.atan2(-ux, -uz), { home });
    // jetty: from 1 m up the bank to the boat
    const y = (w ? w.y : 0) + 0.35, sx = s.shore.x - ux * 1.0, sz = s.shore.z - uz * 1.0, len = L + 1.0;
    const d = new THREE.Mesh(this.dockG, this.mat); d.position.set(sx, y, sz); d.scale.set(1, 1, len); d.rotation.y = Math.atan2(ux, uz);
    this.group.add(d);
    const posts = [];
    for (const f of [0.35, 0.95]) for (const sd of [-0.6, 0.6]) {
      const px = sx + ux * len * f - uz * sd, pz = sz + uz * len * f + ux * sd, p = new THREE.Mesh(this.postG, this.mat);
      p.position.set(px, y + 0.25, pz); p.scale.y = Math.max(0.6, y + 0.25 - this.t.height(px, pz) + 0.3); this.group.add(p); posts.push(p);
    }
    b.dock = { x: s.shore.x, z: s.shore.z };
    this.docks.push({ x: sx + ux * len * 0.5, z: sz + uz * len * 0.5, mesh: d, posts, end: { x: s.x, z: s.z }, shore: { x: s.shore.x, z: s.shore.z } });
    return b;
  }

  /** Place the docked boats (deterministic; ~25 craft). */
  plan() {
    const t = this.t, B = t.bio;
    if (!B?.ready) return;
    const t0 = performance.now();
    // towns: their own lake (jetty at the canoe racks) or the nearest water
    for (const s of t.settlements || []) {
      if (s.lake) {
        const L = s.lake, sh = L.shore || L.r - 2;
        for (const da of [0.5, -0.5, 0.9, -0.9]) {
          const a = L.a + Math.PI + da, x = L.x + Math.cos(a) * (sh - 4.5), z = L.z + Math.sin(a) * (sh - 4.5);
          const lx = L.x + Math.cos(a) * (sh + 1.4), lz = L.z + Math.sin(a) * (sh + 1.4);
          if (this.depth(x, z) > 0.8 && this.dryOK(lx, lz)) { this.dock({ x, z, shore: { x: lx, z: lz } }, "canoe", s.name); break; }
        }
      }
      const sp = this.spot(s.x, s.z, 380); if (sp) this.dock(sp, null, s.name);
    }
    // the camp
    const site = t.act1;
    if (site) { const sp = this.spot(site.camp.x, site.camp.z, 700); if (sp) this.dock(sp, null, "River-Tooth camp"); }
    // lakes (one each), river mouths and a canoe partway down each river
    for (const l of B.lakes) for (let a = 0; a < 16; a++) { const an = a * 0.3927, s = this.shoreSpot(l.x + Math.cos(an) * l.r * 0.8, l.z + Math.sin(an) * l.r * 0.8); if (s && this.dock(s, null, "lake")) break; }
    for (const r of B.rivers) {
      const P = r.pts;
      for (const f of [0.45, 0.97]) for (let k = 0; k < 20; k++) {
        const i = Math.max(0, Math.min(P.length - 1, Math.floor(P.length * f) - k * 3)), p = P[i], q = P[Math.min(P.length - 1, i + 1)];
        const l = Math.hypot(q.x - p.x, q.z - p.z) || 1, nx = -(q.z - p.z) / l, nz = (q.x - p.x) / l;
        const s = this.shoreSpot(p.x + nx * p.w * 0.25, p.z + nz * p.w * 0.25, 0.8) || this.shoreSpot(p.x - nx * p.w * 0.25, p.z - nz * p.w * 0.25, 0.8);
        if (s && this.dock(s, f > 0.9 && r.end === "sea" ? "umiak" : "canoe", "river")) break;
      }
    }
    // the coast, every ~700 m
    for (let z = -2800; z <= 2800; z += 700) { const x = B.coastX(z); const sp = this.spot(x - 40, z, 160, 1.0); if (sp) this.dock(sp, "umiak", "coast"); }
    // the marsh: a few rafts
    let rafts = 0;
    for (let i = 0; i < 1500 && rafts < 5; i++) {
      const x = 1000 + ((i * 397) % 2000), z = -2800 + ((i * 1013) % 5600);
      const w = B.weights(x, z); if (w.swamp < 0.6) continue;
      const s = this.shoreSpot(x, z, 0.42); if (s && this.dock(s, "raft", "marsh")) rafts++;
    }
    this.planMs = performance.now() - t0;
  }

  /** Free (unboarded) boat within r of the feet. */
  near(f, r = 3.4) {
    let best = null, bd = r;
    for (const b of this.list) {
      if (b.taken) continue;
      let d = Math.hypot(b.x - f.x, b.z - f.z);
      if (b.dock && Math.hypot(b.x - b.dock.x, b.z - b.dock.z) < 16) d = Math.min(d, Math.hypot(b.dock.x - f.x, b.dock.z - f.z) + 0.5); // at the jetty foot
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  canFloat(b, x, z) {
    if (Math.abs(x) > BOUND || Math.abs(z) > BOUND) return false;
    if (this.depth(x, z) < b.K.draft) return false;
    const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw), h = b.K.len * 0.42;
    return this.depth(x + fx * h, z + fz * h) > b.K.draft * 0.5 && this.depth(x - fx * h, z - fz * h) > b.K.draft * 0.5;
  }
  /** Paddle one step. inp: { fwd -1..1, turn -1..1, boost }. Returns { stuck } (seconds pushing without moving). */
  steer(b, inp, dt) {
    const K = b.K, w = this.water(b.x, b.z);
    const want = inp.fwd >= 0 ? inp.fwd * (inp.boost ? K.sprint : K.max) : inp.fwd * K.back;
    b.v += (want - b.v) * Math.min(1, dt * (Math.abs(want) > Math.abs(b.v) ? 0.9 : 0.6));
    b.yr += (inp.turn * K.turn * (0.55 + 0.45 * Math.min(1, Math.abs(b.v) / 2)) - b.yr) * Math.min(1, dt * 3);
    const yaw0 = b.yaw; b.yaw += b.yr * dt;
    if (!this.canFloat(b, b.x, b.z) && this.canFloat({ ...b, yaw: yaw0 }, b.x, b.z)) { b.yaw = yaw0; b.yr = 0; } // don't swing the bow onto the bank
    let cx = 0, cz = 0;
    if (w && w.kind === "river") { const sp = 1.35 * K.cur; cx = w.fx * sp; cz = w.fz * sp; }
    else if (w && w.kind === "ocean") { cx = 0.15 * Math.sin(b.ph * 0.1); }
    const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
    const dx = (fx * b.v + cx) * dt, dz = (fz * b.v + cz) * dt;
    const d0 = this.depth(b.x, b.z);
    const ok = (x, z) => this.canFloat(b, x, z) || this.depth(x, z) > d0 + 0.005; // aground: any move to deeper water is fine
    let moved = 0;
    if (ok(b.x + dx, b.z + dz)) { b.x += dx; b.z += dz; moved = Math.hypot(dx, dz); }
    else if (ok(b.x + dx, b.z)) { b.x += dx; moved = Math.abs(dx); b.v *= 0.9; }
    else if (ok(b.x, b.z + dz)) { b.z += dz; moved = Math.abs(dz); b.v *= 0.9; }
    else {
      if (Math.abs(b.v) > 1.2) b.bump = true;
      b.v *= 0.25;
      // ease off the bank toward deeper water so a boat is never pinned (current / wind / a bad turn)
      let bx = 0, bz = 0, bd = d0;
      for (let k = 0; k < 8; k++) { const a = k * 0.785, x = b.x + Math.cos(a) * 1.5, z = b.z + Math.sin(a) * 1.5, d = this.depth(x, z); if (d > bd) { bd = d; bx = Math.cos(a); bz = Math.sin(a); } }
      if (bx || bz) { b.x += bx * 0.6 * dt; b.z += bz * 0.6 * dt; }
    }
    const pushing = Math.abs(inp.fwd) > 0.2;
    b.stuckT = pushing && moved < Math.abs(want) * dt * 0.15 ? (b.stuckT || 0) + dt : Math.max(0, (b.stuckT || 0) - dt * 2);
    if (w) { b.y = w.y; b.wkind = w.kind; }
    b.speed = moved / Math.max(dt, 1e-4);
    return { stuck: b.stuckT };
  }
  /** Per-frame: bob / roll on the waves, show only nearby boats, the wake. */
  update(dt, time, eye, rider = null) {
    for (const b of this.list) {
      const near = Math.abs(b.x - eye.x) < 420 && Math.abs(b.z - eye.z) < 420;
      b.mesh.visible = near;
      if (!near) continue;
      const sea = b.wkind === "ocean", amp = sea ? 0.12 : b.wkind === "river" ? 0.04 : 0.025;
      b.ph += dt;
      const bob = Math.sin(time * (sea ? 1.4 : 1.1) + b.id) * amp;
      b.bobY = bob;
      b.mesh.position.set(b.x, b.y + bob - b.K.draft * 0.45, b.z);
      b.mesh.rotation.set(Math.sin(time * 1.2 + b.id * 2) * amp * 0.6, b.yaw, Math.sin(time * 0.9 + b.id) * amp * (sea ? 0.9 : 0.5) - (b === rider ? b.yr * 0.05 : 0), "YXZ");
    }
    for (const d of this.docks) { const near = Math.abs(d.x - eye.x) < 420 && Math.abs(d.z - eye.z) < 420; d.mesh.visible = near; for (const p of d.posts) p.visible = near; }
    // wake: two spreading rings off the stern while moving
    if (rider && Math.abs(rider.v) > 0.6 && (this.wakeT -= dt) <= 0) {
      this.wakeT = 0.16;
      const fx = -Math.sin(rider.yaw), fz = -Math.cos(rider.yaw), L = rider.K.len * 0.45;
      for (const sd of [-1, 1]) {
        const w = this.wake[this.wakeI++ % this.wake.length];
        w.life = 1; w.m.visible = true;
        w.m.position.set(rider.x - fx * L + fz * sd * 0.3, rider.y + 0.04, rider.z - fz * L - fx * sd * 0.3);
        w.vx = -fz * sd * 0.5 - fx * 0.15; w.vz = fx * sd * 0.5 - fz * 0.15; w.s = 0.3;
      }
    }
    for (const w of this.wake) {
      if (w.life <= 0) continue;
      w.life -= dt / 2.2;
      if (w.life <= 0) { w.m.visible = false; continue; }
      w.m.position.x += w.vx * dt; w.m.position.z += w.vz * dt;
      w.s += dt * 0.7; w.m.scale.setScalar(w.s); w.m.material.opacity = w.life * 0.35;
    }
  }
  /** Map markers. */
  marks() { return this.list.map((b) => ({ x: b.x, z: b.z, kind: b.kind, taken: b.taken })); }
  dispose() { this.group.parent?.remove(this.group); for (const g of Object.values(this.geo)) g.dispose(); this.dockG.dispose(); this.postG.dispose(); this.mat.dispose(); }
}
export const BOAT_GEO = { canoe: canoeGeo, raft: raftGeo, umiak: umiakGeo }; // round 22: remote players' boats
