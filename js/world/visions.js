/**
 * Round 21: trip visions. Harmless, cartoonish (and a few surreal) creatures that pop in with a
 * wobble around Kra while the trip runs, wander / float / dance, and vanish with a shimmer.
 * Kinds: googly blob, dancing deer, floating fish, mushroom person, giant snail, many-eyed blob,
 * tentacle tree, giant floating face. At the peak, once: the "trip boss", a huge face that rises
 * in front of Kra, stares, opens its mouth and dissolves. Purely visual (no colliders, no damage).
 */
import * as THREE from "three";

const G = {
  sph: new THREE.SphereGeometry(1, 14, 10), box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  cone: new THREE.ConeGeometry(1, 1, 10), cap: new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), tor: new THREE.TorusGeometry(1, 0.28, 8, 24, Math.PI),
  shell: new THREE.TorusGeometry(1, 0.55, 10, 20),
};
const KINDS = ["blob", "deer", "fish", "shroom", "snail", "eyes", "tentacle", "face"];
const PAL = [0xff3fa4, 0x3fffd2, 0xffe63f, 0x8a5bff, 0xff7a2f, 0x4fa8ff, 0x7dff4f, 0xff4f4f];

export class Visions {
  /** env: { scene, ground(x, z) -> y, lite() } */
  constructor(env) {
    this.env = env; this.list = []; this.group = new THREE.Group(); this.group.name = "visions"; env.scene.add(this.group);
    this.spawnT = 0; this.bossDone = false; this.n = 0; this.log = [];
  }
  _mat(col, opts = {}) { const m = new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, transparent: true, opacity: 1, ...opts }); return m; }
  _mesh(geo, mat, x, y, z, sx, sy = sx, sz = sx) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.userData.noMelt = true; return m; }
  _eye(g, x, y, z, r, mats) { const w = this._mesh(G.sph, mats.white, x, y, z, r); const p = this._mesh(G.sph, mats.black, x, y, z + r * 0.6, r * 0.5); g.add(w, p); return p; }
  build(kind, r) {
    const g = new THREE.Group(), c = PAL[Math.floor(r() * PAL.length)], c2 = PAL[Math.floor(r() * PAL.length)];
    const mats = { a: this._mat(c), b: this._mat(c2), white: this._mat(0xffffff, { emissiveIntensity: 0.6 }), black: this._mat(0x111111, { emissive: 0x000000 }) };
    const pupils = [], parts = {};
    switch (kind) {
      case "blob": g.add(this._mesh(G.sph, mats.a, 0, 0.8, 0, 0.8, 0.75, 0.8)); pupils.push(this._eye(g, -0.28, 1.15, 0.62, 0.22, mats), this._eye(g, 0.28, 1.18, 0.62, 0.26, mats)); break;
      case "deer": {
        g.add(this._mesh(G.box, mats.a, 0, 1.1, 0, 0.55, 0.5, 1.3), this._mesh(G.box, mats.a, 0, 1.6, 0.7, 0.3, 0.7, 0.3), this._mesh(G.box, mats.b, 0, 1.95, 0.85, 0.32, 0.3, 0.5));
        parts.legs = [];
        for (const [lx, lz] of [[-0.2, -0.5], [0.2, -0.5], [-0.2, 0.5], [0.2, 0.5]]) { const l = this._mesh(G.cyl, mats.b, lx, 0.45, lz, 0.07, 0.9, 0.07); g.add(l); parts.legs.push(l); }
        for (const s of [-1, 1]) g.add(this._mesh(G.cone, mats.b, s * 0.18, 2.35, 0.8, 0.06, 0.5, 0.06));
        pupils.push(this._eye(g, -0.12, 2.02, 1.08, 0.09, mats), this._eye(g, 0.12, 2.02, 1.08, 0.11, mats)); break;
      }
      case "fish": g.add(this._mesh(G.sph, mats.a, 0, 0, 0, 0.5, 0.45, 0.9)); { const t = this._mesh(G.cone, mats.b, 0, 0, -1.0, 0.4, 0.6, 0.15); t.rotation.x = -Math.PI / 2; g.add(t); parts.tail = t; } pupils.push(this._eye(g, -0.25, 0.12, 0.6, 0.14, mats), this._eye(g, 0.25, 0.12, 0.6, 0.14, mats)); break;
      case "shroom": {
        g.add(this._mesh(G.cyl, mats.white, 0, 0.6, 0, 0.32, 1.2, 0.32), this._mesh(G.cap, mats.a, 0, 1.15, 0, 0.85, 0.7, 0.85));
        for (let i = 0; i < 6; i++) { const a = i * 1.05, rr = 0.55; g.add(this._mesh(G.sph, mats.white, Math.cos(a) * rr, 1.55, Math.sin(a) * rr, 0.11)); }
        const smile = this._mesh(G.tor, mats.black, 0, 0.62, 0.31, 0.13); smile.rotation.z = Math.PI; g.add(smile);
        pupils.push(this._eye(g, -0.12, 0.9, 0.3, 0.09, mats), this._eye(g, 0.12, 0.9, 0.3, 0.09, mats)); break;
      }
      case "snail": {
        g.add(this._mesh(G.sph, mats.b, 0, 0.35, 0.3, 0.45, 0.35, 1.3));
        const sh = this._mesh(G.shell, mats.a, 0, 1.0, -0.2, 0.6); sh.rotation.y = Math.PI / 2; g.add(sh);
        for (const s of [-1, 1]) { g.add(this._mesh(G.cyl, mats.b, s * 0.15, 0.85, 1.35, 0.04, 0.7, 0.04)); pupils.push(this._eye(g, s * 0.15, 1.25, 1.35, 0.1, mats)); }
        break;
      }
      case "eyes": {
        g.add(this._mesh(G.sph, mats.a, 0, 1.2, 0, 1.1));
        for (let i = 0; i < 11; i++) { const th = r() * 6.28, ph = 0.3 + r() * 1.6, R = 1.05; pupils.push(this._eye(g, Math.cos(th) * Math.sin(ph) * R, 1.2 + Math.cos(ph) * R, Math.abs(Math.sin(th)) * Math.sin(ph) * R + 0.1, 0.12 + r() * 0.15, mats)); }
        break;
      }
      case "tentacle": {
        g.add(this._mesh(G.cyl, mats.b, 0, 1.6, 0, 0.35, 3.2, 0.35), this._mesh(G.sph, mats.a, 0, 3.4, 0, 0.8));
        parts.arms = [];
        for (let i = 0; i < 6; i++) { const piv = new THREE.Group(); piv.position.set(0, 3.3, 0); piv.rotation.y = i * 1.047; const arm = this._mesh(G.cyl, mats.a, 0, 0, 0.9, 0.12, 1.9, 0.12); arm.rotation.x = Math.PI / 2; piv.add(arm); g.add(piv); parts.arms.push(piv); }
        pupils.push(this._eye(g, 0, 3.4, 0.75, 0.22, mats)); break;
      }
      case "face": case "boss": {
        g.add(this._mesh(G.sph, mats.a, 0, 0, 0, 1.6, 1.9, 1.3));
        pupils.push(this._eye(g, -0.55, 0.45, 1.05, 0.38, mats), this._eye(g, 0.55, 0.45, 1.05, 0.38, mats));
        const mouth = this._mesh(G.sph, mats.black, 0, -0.65, 1.05, 0.55, 0.18, 0.2); g.add(mouth); parts.mouth = mouth;
        g.add(this._mesh(G.cone, mats.b, 0, 0.0, 1.35, 0.18, 0.5, 0.18).rotateX(Math.PI / 2)); break;
      }
    }
    g.traverse((o) => { o.userData.noMelt = true; });
    return { g, mats, pupils, parts };
  }
  /** Per frame. L: trip level 0..1, peak: bool, eye: camera position, feet: {x,y,z}, cave: bool, trip seconds. */
  update(dt, L, eye, feet, cave, tt, peak) {
    const lite = this.env.lite(), want = L <= 0.05 ? 0 : Math.round(L * (lite ? 7 : 13) * (cave ? 0.6 : 1));
    // spawn
    if ((this.spawnT -= dt) <= 0 && this.list.filter((v) => !v.dying).length < want) {
      this.spawnT = 0.6 + Math.random() * 1.4;
      this.spawn(feet, eye, cave);
    }
    if (peak && !this.bossDone && tt > 70) { this.bossDone = true; this.spawn(feet, eye, cave, "boss"); }
    for (const v of this.list) {
      v.age += dt;
      const g = v.g, life = v.life;
      if (!v.dying && (v.age > life || L < 0.05 + v.r0 * 0.25)) { v.dying = true; v.dieT = 0; }
      // appear: pop with overshoot; vanish: shimmer (wobble + fade)
      let s = v.scale * (v.age < 0.8 ? 1 + Math.sin(Math.min(1, v.age / 0.8) * Math.PI * 1.5) * 0.3 * (1 - v.age / 0.8) - (1 - Math.min(1, v.age / 0.5)) : 1);
      let op = 1;
      if (v.dying) { v.dieT += dt; const k = v.dieT / 1.4; op = Math.max(0, 1 - k); s *= 1 + k * 0.6; g.rotation.y += dt * 9 * k; v.mats.a.emissiveIntensity = 0.35 + Math.sin(v.dieT * 40) * 0.5 + k; }
      g.scale.setScalar(Math.max(0.001, s));
      for (const m of Object.values(v.mats)) m.opacity = op;
      const T = v.age + v.r0 * 10;
      const gy = cave ? feet.y : this.env.ground(g.position.x, g.position.z);
      // movement per kind
      const toEye = Math.atan2(eye.x - g.position.x, eye.z - g.position.z);
      switch (v.kind) {
        case "blob": g.position.y = gy + Math.abs(Math.sin(T * 4)) * 1.2; g.scale.y *= 1 - 0.15 * Math.cos(T * 8); g.rotation.y = toEye; break;
        case "deer": g.position.y = gy + Math.abs(Math.sin(T * 3)) * 0.6; g.rotation.y += dt * 2.2; v.parts.legs.forEach((l, i) => { l.rotation.x = Math.sin(T * 6 + i * 1.6) * 0.7; }); break;
        case "fish": { v.a += dt * 0.6; g.position.x = v.cx + Math.cos(v.a) * 4; g.position.z = v.cz + Math.sin(v.a) * 4; g.position.y = gy + 2.5 + Math.sin(T * 1.3) * 0.8; g.rotation.y = -v.a; v.parts.tail.rotation.y = Math.sin(T * 9) * 0.5; break; }
        case "shroom": g.position.y = gy; g.rotation.z = Math.sin(T * 3) * 0.18; g.rotation.y = toEye + Math.sin(T * 1.5) * 0.4; break;
        case "snail": { g.position.y = gy; const sp = 0.25 * dt; g.position.x += Math.sin(g.rotation.y) * sp; g.position.z += Math.cos(g.rotation.y) * sp; g.scale.z *= 1 + 0.08 * Math.sin(T * 2); break; }
        case "eyes": g.position.y = gy + Math.sin(T * 1.2) * 0.4; g.scale.multiplyScalar(1 + 0.08 * Math.sin(T * 5)); g.rotation.y = toEye; break;
        case "tentacle": g.position.y = gy; v.parts.arms.forEach((p, i) => { p.rotation.x = -0.3 + Math.sin(T * 2 + i) * 0.6; }); break;
        case "face": g.position.y = gy + 7 + Math.sin(T * 0.7) * 1.2; g.rotation.y = toEye; v.parts.mouth.scale.y = 0.18 + 0.15 * (0.5 + 0.5 * Math.sin(T * 2)); break;
        case "boss": { const k = Math.min(1, v.age / 3); g.position.y = gy + 2 + k * 6; g.rotation.y = toEye; v.parts.mouth.scale.y = 0.18 + 0.9 * Math.max(0, Math.sin(Math.min(1, v.age / 8) * Math.PI)); break; }
      }
      for (const p of v.pupils) { p.position.x += (Math.random() - 0.5) * 0.02; }
    }
    // remove the faded
    for (let i = this.list.length - 1; i >= 0; i--) { const v = this.list[i]; if (v.dying && v.dieT > 1.4) { this.group.remove(v.g); for (const m of Object.values(v.mats)) m.dispose(); this.list.splice(i, 1); } }
  }
  spawn(feet, eye, cave, force = null) {
    const r = Math.random, kind = force || KINDS[Math.floor(r() * KINDS.length)];
    if (kind === "face" && this.list.some((v) => v.kind === "face")) return;
    const { g, mats, pupils, parts } = this.build(kind, r);
    const fwd = Math.atan2(feet.x - eye.x, feet.z - eye.z); // camera -> Kra: what you see
    let a = fwd + (r() - 0.5) * 2.6, d = cave ? 3 + r() * 5 : 7 + r() * 26;
    if (kind === "face") d = cave ? 6 : 28;
    if (kind === "boss") { a = fwd; d = cave ? 6 : 16; }
    const x = feet.x + Math.sin(a) * d, z = feet.z + Math.cos(a) * d;
    g.position.set(x, cave ? feet.y : this.env.ground(x, z), z); g.rotation.y = r() * 6.28;
    const scale = kind === "snail" ? 2.2 + r() : kind === "boss" ? (cave ? 1.6 : 4.5) : kind === "face" ? (cave ? 0.9 : 3) : 0.8 + r() * 0.7;
    this.group.add(g);
    const v = { kind, g, mats, pupils, parts, age: 0, life: kind === "boss" ? 11 : 12 + r() * 18, r0: r(), scale, a: r() * 6.28, cx: x, cz: z, dying: false, dieT: 0 };
    this.list.push(v); this.n++; this.log.push(kind); if (this.log.length > 60) this.log.shift();
    return v;
  }
  clear() { for (const v of this.list) { this.group.remove(v.g); for (const m of Object.values(v.mats)) m.dispose(); } this.list = []; this.bossDone = false; }
}
