/**
 * Round 23: wild berry bushes across the world (the camp has its own). Biome-appropriate:
 * brambles in the temperate woods, bilberries on the cold slopes, cloudberries on the tundra,
 * cranberries in the marsh, juniper in the red rock and saltlands. ~260 spots, streamed in
 * within 75 m (shared geometry / materials, so it's cheap). Pick for +3 berries; they regrow
 * after 10 minutes (remembered across reloads).
 */
import * as THREE from "three";
import { mulberry32 } from "../rng.js";

const TAKEN = "fota-berry-taken-v1", REGROW = 10 * 60 * 1000;
export const BERRY_KINDS = {
  bramble: { name: "Bramble berries", leaf: 0x355a2e, fruit: 0x5a0f22, size: 1 },
  bilberry: { name: "Bilberries", leaf: 0x3d5a34, fruit: 0x2a3a8a, size: 0.75 },
  cloudberry: { name: "Cloudberries", leaf: 0x4f6a3a, fruit: 0xf0a030, size: 0.6 },
  cranberry: { name: "Cranberries", leaf: 0x46502c, fruit: 0xc0182a, size: 0.65 },
  juniper: { name: "Juniper berries", leaf: 0x48604a, fruit: 0x5a6aa0, size: 0.9 },
};
const leafGeo = new THREE.IcosahedronGeometry(0.5, 0), fruitGeo = new THREE.SphereGeometry(0.065, 5, 4);
const mats = {};
for (const [k, v] of Object.entries(BERRY_KINDS)) mats[k] = { leaf: new THREE.MeshLambertMaterial({ color: v.leaf, flatShading: true }), fruit: new THREE.MeshLambertMaterial({ color: v.fruit, emissive: v.fruit, emissiveIntensity: 0.18 }) };

function makeBush(s) {
  const r = mulberry32(s.seed >>> 0), K = BERRY_KINDS[s.kind], M = mats[s.kind], g = new THREE.Group(), fruit = new THREE.Group();
  const n = 3 + Math.floor(r() * 2);
  for (let k = 0; k < n; k++) { const m = new THREE.Mesh(leafGeo, M.leaf); const a = k * 2.1 + r(); m.position.set(Math.cos(a) * 0.35, 0.4 + k * 0.1, Math.sin(a) * 0.35); m.scale.setScalar(1 - k * 0.15); m.rotation.set(r() * 3, r() * 3, 0); g.add(m); }
  for (let k = 0; k < 14; k++) { const m = new THREE.Mesh(fruitGeo, M.fruit); const an = k * 2.39, rr = 0.48 + (k % 3) * 0.08; m.position.set(Math.cos(an) * rr, 0.3 + (k % 5) * 0.12, Math.sin(an) * rr); fruit.add(m); }
  fruit.name = "fruit"; g.add(fruit);
  g.scale.setScalar(K.size * (0.85 + r() * 0.3)); g.rotation.y = r() * 6.28;
  return g;
}

export class WildBerries {
  constructor(terrain, parent) {
    this.t = terrain; this.group = new THREE.Group(); this.group.name = "berries"; parent.add(this.group);
    try { this.taken = JSON.parse(localStorage.getItem(TAKEN) || "{}"); } catch { this.taken = {}; }
    this.spots = this._plan(); this.live = new Map(); this.checkT = 0;
    // a coarse grid for near() lookups
    this.grid = new Map(); for (const s of this.spots) { const k = Math.floor(s.x / 100) + "," + Math.floor(s.z / 100); (this.grid.get(k) || this.grid.set(k, []).get(k)).push(s); }
  }
  _kind(x, z) {
    const t = this.t;
    if (t.waterDepth(x, z) > -0.3 || t.slope(x, z).m > 0.4) return null;
    const w = t.bio?.weights?.(x, z); if (!w) return "bramble";
    if (w.sea > 0.05) return null;
    if (w.swamp > 0.5) return "cranberry";
    if (w.tundra > 0.5) return "cloudberry";
    if (w.alpine > 0.45) return "bilberry";
    if (w.red + w.salt > 0.5) return w.salt > 0.7 ? null : "juniper";
    return "bramble";
  }
  _plan() {
    const t = this.t, r = mulberry32((t.seed ^ 0xbe221e5) >>> 0), out = [];
    const clear = (x, z) => !t.inClearing?.(x, z) && Math.hypot(x - t.spawn.x, z - t.spawn.z) > 6; // trees / rocks are checked lazily as they stream in
    // clumps of 2-4 bushes; denser near water (streams / lake shores), like real berry thickets
    for (let i = 0; i < 9000 && out.length < 260; i++) {
      const x = (r() - 0.5) * 6000, z = (r() - 0.5) * 6000, kind = this._kind(x, z);
      if (!kind) continue;
      const rv = t.bio?.river?.(x, z), wet = rv && rv.d < 60;
      if (!wet && r() < 0.45) continue;
      if (out.some((s) => Math.abs(s.x - x) < 90 && Math.abs(s.z - z) < 90)) continue;
      const n = 2 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const a = r() * 6.28, d = k ? 2.5 + r() * 4 : 0, bx = x + Math.cos(a) * d, bz = z + Math.sin(a) * d;
        if (this._kind(bx, bz) !== kind || !clear(bx, bz)) continue;
        out.push({ id: out.length, x: Math.round(bx * 10) / 10, z: Math.round(bz * 10) / 10, kind, seed: Math.floor(r() * 1e9) });
      }
    }
    return out;
  }
  available(s) { const tk = this.taken[s.id]; return !tk || Date.now() - tk > REGROW; }
  update(dt, p) {
    if ((this.checkT -= dt) > 0) return;
    this.checkT = 0.6;
    for (const s of this.spots) {
      if (Math.abs(s.x - p.x) > 90 || Math.abs(s.z - p.z) > 90) { const m = this.live.get(s.id); if (m) { this.group.remove(m); this.live.delete(s.id); } continue; }
      const d = Math.hypot(s.x - p.x, s.z - p.z), want = d < 75;
      let m = this.live.get(s.id);
      if (want && !m && s.bad === undefined) { // first time near: step off any tree / rock it landed on
        s.bad = true;
        for (let k = 0; k < 6 && s.bad; k++) { const a = k * 1.05, d = k ? 1.6 : 0, x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d; if (!this.t.collidersNear(x, z, 1.3).length && this.t.waterDepth(x, z) < -0.3) { s.x = x; s.z = z; s.bad = false; } }
      }
      if (want && !m && !s.bad) { m = makeBush(s); m.position.set(s.x, this.t.height(s.x, s.z) - 0.05, s.z); this.group.add(m); this.live.set(s.id, m); }
      else if (!want && m) { this.group.remove(m); this.live.delete(s.id); m = null; }
      if (m) m.getObjectByName("fruit").visible = this.available(s);
    }
  }
  near(f, r = 2.2) {
    const gx = Math.floor(f.x / 100), gz = Math.floor(f.z / 100);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const s of this.grid.get(gx + i + "," + (gz + j)) || []) if (!s.bad && this.available(s) && Math.hypot(s.x - f.x, s.z - f.z) < r) return s;
    return null;
  }
  take(s) {
    this.taken[s.id] = Date.now();
    for (const k in this.taken) if (Date.now() - this.taken[k] > REGROW) delete this.taken[k];
    try { localStorage.setItem(TAKEN, JSON.stringify(this.taken)); } catch {}
    const m = this.live.get(s.id); if (m) m.getObjectByName("fruit").visible = false;
  }
}
