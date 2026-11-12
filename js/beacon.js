/**
 * Round 23: the map beacon. A tall pillar of light at a point you pick on the big map: drawn
 * without fog and additively so it shows from far off (past the far plane it's drawn as a scaled
 * proxy on the same line of sight), with a distance readout over it, or an arrow on the screen
 * edge pointing to it when it's behind you / off screen. Saved per world.
 */
import * as THREE from "three";

const HEIGHT = 420, PROXY = 820;

export class Beacon {
  /** o (round 24b, the Find marker reuses this): { name, id, icon, outer, inner, ring } colours. */
  constructor(scene, root, o = {}) {
    this.scene = scene; this.pos = null; this.key = ""; this.icon = o.icon || "📍";
    const g = (this.group = new THREE.Group()); g.name = o.name || "beacon"; g.visible = false; g.renderOrder = 5;
    const mk = (r, op, col) => new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, HEIGHT, 14, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    this.outer = mk(3.2, 0.22, o.outer ?? 0x5fe8ff); this.inner = mk(0.9, 0.75, o.inner ?? 0xd8fbff);
    for (const m of [this.outer, this.inner]) { m.position.y = HEIGHT / 2; m.frustumCulled = false; m.userData.noMelt = true; g.add(m); }
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 4.2, 32), new THREE.MeshBasicMaterial({ color: o.ring ?? 0x7ff6ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.25; g.add(ring); this.ring = ring;
    scene.add(g);
    const el = (this.el = document.createElement("div")); el.id = o.id || "beacon-ind"; el.className = "hidden";
    el.innerHTML = `<span class="ba"></span><span class="bd"></span>`; root.appendChild(el);
    this._v = new THREE.Vector3(); this._c = new THREE.Vector3();
  }
  /** Per-world save key. */
  bind(key) { this.key = key; let p = null; try { p = JSON.parse(localStorage.getItem(key) || "null"); } catch {} this.pos = p && Number.isFinite(p.x) ? p : null; }
  set(x, z) { this.pos = { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 }; this._save(); }
  clear() { this.pos = null; this._save(); this.group.visible = false; this.el.classList.add("hidden"); }
  _save() { if (!this.key) return; try { if (this.pos) localStorage.setItem(this.key, JSON.stringify(this.pos)); else localStorage.removeItem(this.key); } catch {} }
  dist(p) { return this.pos ? Math.hypot(this.pos.x - p.x, this.pos.z - p.z) : Infinity; }
  static fmt(d) { return d >= 1000 ? (d / 1000).toFixed(d >= 10000 ? 0 : 1) + " km" : Math.round(d) + " m"; }
  /** cam: the render camera; feet: the player; height(x, z); show: overworld + no cinematic. */
  update(cam, feet, height, show, time, W, H) {
    const on = !!this.pos && show;
    this.group.visible = on;
    if (!on) { this.el.classList.add("hidden"); return; }
    const b = this.pos, gy = height(b.x, b.z), cp = cam.position;
    const dx = b.x - cp.x, dz = b.z - cp.z, d = Math.hypot(dx, dz), k = d > PROXY ? PROXY / d : 1;
    this.group.position.set(cp.x + dx * k, cp.y + (gy - cp.y) * k, cp.z + dz * k);
    this.group.scale.setScalar(k * (1 + Math.min(3, d / 600))); // a little wider far away so it stays a few pixels thick
    this.outer.material.opacity = 0.18 + 0.06 * Math.sin(time * 2.2);
    this.ring.visible = d < 300;
    // HUD: distance label above the pillar base, or an edge arrow
    const fd = Math.hypot(b.x - feet.x, b.z - feet.z);
    this.el.querySelector(".bd").textContent = this.icon + " " + Beacon.fmt(fd);
    const v = this._v.set(b.x, gy + Math.min(40, 6 + d * 0.04), b.z).project(cam);
    const front = this._c.set(b.x, gy, b.z).applyMatrix4(cam.matrixWorldInverse).z < 0;
    const behind = !front, onScreen = front && Math.abs(v.x) < 0.92; // the pillar is tall: in view whenever it's ahead and inside the sides
    if (onScreen) v.y = Math.max(-0.82, Math.min(0.82, v.y));
    const arr = this.el.querySelector(".ba");
    let x, y;
    if (onScreen) { x = (v.x * 0.5 + 0.5) * W; y = (-v.y * 0.5 + 0.5) * H; arr.style.transform = "rotate(180deg)"; }
    else {
      // direction on screen: use the camera-space bearing so "behind" points the right way
      // bearing in camera space (x right, y up): points left / right toward it even when it's behind you
      const c = this._c.set(b.x, gy + 20, b.z).applyMatrix4(cam.matrixWorldInverse), a = Math.atan2(-c.y * (c.z < 0 ? 1 : 0.2), c.x || 1e-3);
      const m = 34, cx = W / 2, cy = H / 2, t = Math.min((cx - m) / Math.max(1e-3, Math.abs(Math.cos(a))), (cy - m) / Math.max(1e-3, Math.abs(Math.sin(a))));
      x = cx + Math.cos(a) * t; y = cy + Math.sin(a) * t;
      arr.style.transform = `rotate(${(a * 180) / Math.PI + 90}deg)`;
    }
    this.el.style.left = x + "px"; this.el.style.top = y + "px";
    this.el.classList.remove("hidden");
  }
}
