/**
 * Round 21: glowing mushroom clusters. Rare: ~60 spots across the world on the forest floor
 * (temperate woods), in the marsh and at the tundra / taiga edge, plus a cluster in about half the
 * caves (placed by the story's cave pickups). Shown on the maps only once seen (within 30 m).
 * Picked clusters regrow after 30 minutes.
 */
import * as THREE from "three";
import { mulberry32 } from "../rng.js";

const SEEN = "fota-shroom-seen-v1", TAKEN = "fota-shroom-taken-v1", REGROW = 30 * 60 * 1000;
const COLS = [0x40f0ff, 0xff50e0, 0xb0ff40, 0xffa030];
const stemGeo = new THREE.CylinderGeometry(0.035, 0.05, 1, 6), capGeo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
const stemMat = new THREE.MeshLambertMaterial({ color: 0xe8e0d0, emissive: 0x403830 });
const capMats = COLS.map((c) => new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.9 }));
const haloGeo = new THREE.SphereGeometry(1, 10, 8), haloMats = COLS.map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.16, depthWrite: false }));

/** A little glowing cluster (also used for the cave ones). */
export function makeCluster(seed, scale = 1) {
  const r = mulberry32(seed >>> 0), g = new THREE.Group(), ci = Math.floor(r() * COLS.length), n = 4 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const a = r() * 6.28, d = r() * 0.35, h = 0.08 + r() * 0.16, cr = 0.04 + r() * 0.06, x = Math.cos(a) * d, z = Math.sin(a) * d;
    const st = new THREE.Mesh(stemGeo, stemMat); st.scale.set(1, h, 1); st.position.set(x, h / 2, z); st.rotation.z = (r() - 0.5) * 0.4;
    const cp = new THREE.Mesh(capGeo, capMats[(ci + (r() < 0.25 ? 1 : 0)) % COLS.length]); cp.scale.set(cr, cr * 0.7, cr); cp.position.set(x, h, z);
    g.add(st, cp);
  }
  const halo = new THREE.Mesh(haloGeo, haloMats[ci]); halo.scale.setScalar(0.55); halo.position.y = 0.12; halo.name = "halo"; g.add(halo);
  g.scale.setScalar(scale);
  g.traverse((o) => { o.userData.noMelt = true; });
  return g;
}

export class Shrooms {
  constructor(terrain, parent) {
    this.t = terrain; this.group = new THREE.Group(); this.group.name = "shrooms"; parent.add(this.group);
    this.seen = new Set(JSON.parse(localStorage.getItem(SEEN) || "[]"));
    try { this.taken = JSON.parse(localStorage.getItem(TAKEN) || "{}"); } catch { this.taken = {}; }
    this.spots = this._plan(); this.live = new Map(); this.checkT = 0;
  }
  _plan() {
    const t = this.t, r = mulberry32((t.seed ^ 0x5eed) >>> 0), out = [];
    const ok = (x, z) => {
      if (t.waterDepth(x, z) > -0.3 || t.slope(x, z).m > 0.35) return null;
      const w = t.bio?.weights?.(x, z); if (!w) return "forest";
      if (w.swamp > 0.55) return "marsh";
      if (w.alpine + w.tundra > 0.6 && w.tundra > 0.12 && w.tundra < 0.88) return "tundra";
      if (w.temperate > 0.7) { const sc = t.scatter(Math.floor(x / 64), Math.floor(z / 64)); if (sc.trees.length >= 14) return "forest"; }
      return null;
    };
    for (let i = 0; i < 5000 && out.length < 64; i++) {
      const x = (r() - 0.5) * 6000, z = (r() - 0.5) * 6000, kind = ok(x, z);
      if (!kind || (kind === "forest" && r() < 0.6)) continue;
      if (out.some((s) => Math.hypot(s.x - x, s.z - z) < 160)) continue;
      out.push({ id: out.length, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, kind, seed: Math.floor(r() * 1e9) });
    }
    // one patch in the woods a short walk from the start, so the first one can be found
    const s0 = t.spawn;
    for (let k = 0; k < 400; k++) {
      const a = r() * 6.28, d = 140 + r() * 140, x = s0.x + Math.cos(a) * d, z = s0.z + Math.sin(a) * d;
      if (ok(x, z) && t.collidersNear(x, z, 1.5).length === 0) { out.push({ id: out.length, x, z, kind: "forest", seed: Math.floor(r() * 1e9), near: true }); break; }
    }
    return out;
  }
  available(s) { const tk = this.taken[s.id]; return !tk || Date.now() - tk > REGROW; }
  /** Per frame: stream the clusters within 90 m, note the ones Kra has seen. */
  update(dt, p, time) {
    if ((this.checkT -= dt) <= 0) {
      this.checkT = 0.7;
      for (const s of this.spots) {
        const d = Math.hypot(s.x - p.x, s.z - p.z), want = d < 90 && this.available(s);
        if (d < 30 && !this.seen.has(s.id)) { this.seen.add(s.id); localStorage.setItem(SEEN, JSON.stringify([...this.seen])); this.onSeen?.(s); }
        const m = this.live.get(s.id);
        if (want && !m) { const g = makeCluster(s.seed, 1.5); g.position.set(s.x, this.t.height(s.x, s.z), s.z); this.group.add(g); this.live.set(s.id, g); }
        else if (!want && m) { this.group.remove(m); this.live.delete(s.id); }
      }
    }
    for (const g of this.live.values()) { const h = g.getObjectByName("halo"); if (h) h.scale.setScalar(0.5 + 0.12 * Math.sin(time * 2.4 + g.position.x)); }
  }
  near(f, r = 2.2) { for (const s of this.spots) if (this.available(s) && Math.hypot(s.x - f.x, s.z - f.z) < r) return s; return null; }
  take(s) { this.taken[s.id] = Date.now(); localStorage.setItem(TAKEN, JSON.stringify(this.taken)); const m = this.live.get(s.id); if (m) { this.group.remove(m); this.live.delete(s.id); } }
  marks() { return this.spots.filter((s) => this.seen.has(s.id) && this.available(s)); }
}
