/**
 * Round 28a: things on the ground. Discarded items (and loot that didn't fit in the pack) lie
 * where they fell as a small hide bundle with the item's icon floating over it; walk up and
 * Pick up (E). Saved per place (the hills, or one cave) so they are still there after a reload.
 */
import * as THREE from "three";
import { ITEMS } from "./survival.js";

const MAX = 60;
export class Drops {
  /** env: { scene, key() -> storage key, where() -> place id ("ow" / "cave:<id>"), ground(x, z) -> y } */
  constructor(env) {
    this.env = env; this.list = []; this.shown = null;
    this.geo = new THREE.SphereGeometry(0.2, 8, 6); this.mat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.95, emissive: 0x24160a, emissiveIntensity: 0.6 });
    this.icons = new Map();
    this.load();
  }
  _icon(id) {
    if (this.icons.has(id)) return this.icons.get(id);
    const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
    g.fillStyle = "rgba(20,14,8,0.55)"; g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
    g.font = "38px serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(ITEMS[id]?.icon || "?", 32, 35);
    const m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false, transparent: true });
    this.icons.set(id, m); return m;
  }
  _mesh(d) {
    const g = new THREE.Group(), b = new THREE.Mesh(this.geo, this.mat); b.scale.set(1.2, 0.7, 1); b.position.y = 0.12; g.add(b);
    const sp = new THREE.Sprite(this._icon(d.id)); sp.scale.set(0.5, 0.5, 0.5); sp.position.y = 0.75; g.add(sp); d.sp = sp;
    g.position.set(d.x, d.y, d.z); return g;
  }
  /** Drop n of an item at x, z (in the current place). */
  drop(id, n, x, z, y = null) {
    const d = { id, n, x, z, y: y ?? this.env.ground(x, z), where: this.env.where(), t: Date.now() };
    this.list.push(d); while (this.list.length > MAX) this._kill(this.list[0]);
    if (d.where === this.shown) { d.mesh = this._mesh(d); this.env.scene.add(d.mesh); }
    this.save(); return d;
  }
  _kill(d) { if (d.mesh) this.env.scene.remove(d.mesh); this.list = this.list.filter((q) => q !== d); }
  near(f, r = 1.9) { let b = null, bd = r; const w = this.env.where(); for (const d of this.list) { if (d.where !== w) continue; const k = Math.hypot(d.x - f.x, d.z - f.z); if (k < bd && Math.abs((f.y ?? d.y) - d.y) < 2.5) { bd = k; b = d; } } return b; }
  /** Pick a drop up into surv; what doesn't fit stays on the ground. Returns how many were taken. */
  take(d, surv) {
    const k = surv.add(d.id, d.n); d.n -= k;
    if (d.n <= 0) this._kill(d);
    this.save(); return k;
  }
  /** Show the drops of the current place (call after changing place). */
  sync() {
    const w = this.env.where(); if (w === this.shown) return;
    this.shown = w;
    for (const d of this.list) { if (d.mesh) { this.env.scene.remove(d.mesh); d.mesh = null; } if (d.where === w) { d.y = this.env.ground(d.x, d.z) ?? d.y; d.mesh = this._mesh(d); this.env.scene.add(d.mesh); } }
  }
  update(t) { for (const d of this.list) if (d.sp) d.sp.position.y = 0.75 + Math.sin(t * 2 + d.x) * 0.06; }
  clear() { for (const d of [...this.list]) this._kill(d); this.save(); }
  save() { try { localStorage.setItem(this.env.key(), JSON.stringify(this.list.map(({ id, n, x, y, z, where, t }) => ({ id, n, x, y, z, where, t })))); } catch {} }
  load() {
    for (const d of this.list) if (d.mesh) this.env.scene.remove(d.mesh);
    this.list = []; this.shown = null;
    try { const a = JSON.parse(localStorage.getItem(this.env.key()) || "[]"); for (const d of a) if (ITEMS[d.id] && d.n > 0) this.list.push(d); } catch {}
  }
}
