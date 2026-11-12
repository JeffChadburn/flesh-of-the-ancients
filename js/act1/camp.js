/**
 * Act 1 set dressing for the ruined River-Tooth camp, built once from the terrain's Act 1 site:
 * cold fire pit (relightable), hide huts (the shaman's torn open), stylised dead tribe members in
 * open-mouthed poses, old-blood spirals on the ground, Old Lume, berry bushes / root patches,
 * the stream, the plunge pool and the waterfall. Low-poly, Lambert-lit so day/night applies.
 */
import * as THREE from "three";
import { mulberry32 } from "../rng.js";

const lam = (color, o = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...o });
// shared body materials (so all static bodies merge into a few meshes)
const BM = {};
const bodyMat = (k, hex) => BM[k] || (BM[k] = lam(hex));

/**
 * Merge every static mesh under `root` into one mesh per material (draw-call saver).
 * Meshes in `keep` (or under a kept ancestor) stay separate (they change later).
 */
export function bake(root, keep = new Set()) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map(), remove = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    for (let p = o; p && p !== root; p = p.parent) if (keep.has(p)) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
    remove.push(o);
  });
  for (const o of remove) { o.parent.remove(o); o.geometry.dispose(); }
  for (const [mat, gs] of byMat) {
    const hasUV = gs.every((g) => g.attributes.uv);
    let n = 0; for (const g of gs) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = hasUV ? new Float32Array(n * 2) : null;
    let k = 0;
    for (const g of gs) {
      if (!g.attributes.normal) g.computeVertexNormals();
      pos.set(g.attributes.position.array, k * 3); nrm.set(g.attributes.normal.array, k * 3);
      if (uv) uv.set(g.attributes.uv.array, k * 2);
      k += g.attributes.position.count; g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    if (uv) out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    out.computeBoundingSphere();
    const m = new THREE.Mesh(out, mat);
    m.name = "baked";
    m.renderOrder = mat.transparent ? 2 : 0;
    root.add(m);
  }
  return root;
}

function streakTexture(vertical) {
  const c = document.createElement("canvas"); c.width = 64; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = vertical ? "#9fb8c8" : "#26404c"; g.fillRect(0, 0, 64, 128);
  const r = mulberry32(vertical ? 5 : 9);
  for (let i = 0; i < (vertical ? 70 : 40); i++) {
    const x = r() * 64, y = r() * 128, l = 10 + r() * 40, w = 1 + r() * (vertical ? 3 : 2);
    g.fillStyle = vertical ? `rgba(255,255,255,${0.35 + r() * 0.5})` : `rgba(150,190,205,${0.15 + r() * 0.3})`;
    if (vertical) g.fillRect(x, y, w, l); else g.fillRect(y / 2, x * 2, l, w);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A stylised dead (or dying) tribe member. pose: "sprawl" | "curl" | "reach" | "sit". */
export function makeBody({ pose = "sprawl", elder = false, mouthOpen = true, seed = 1 } = {}) {
  const rng = mulberry32(seed);
  const skin = elder ? bodyMat("skinE", 0x8d7562) : bodyMat("skin", 0x84644a), hide = bodyMat("hide", 0x4e3a2a), hair = elder ? bodyMat("hairE", 0xcfc8bc) : bodyMat("hair", 0x231a14), dark = bodyMat("dark", 0x120806);
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.5, 3, 7), hide);
  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 9, 7), skin); skull.scale.set(1, 1.12, 1);
  head.add(skull);
  const hr = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), hair); hr.position.y = 0.02; hr.rotation.x = -0.25;
  head.add(hr);
  if (elder) { const beard = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 6), hair); beard.position.set(0, -0.16, -0.08); beard.rotation.x = Math.PI + 0.3; head.add(beard); }
  // open mouth (the Night of Open Mouths): a dark stretched oval, eyes as shadowed pits
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), dark);
  mouth.scale.set(1, mouthOpen ? 1.7 : 0.4, 0.6); mouth.position.set(0, -0.06, -0.13);
  head.add(mouth);
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), dark); e.position.set(s * 0.055, 0.04, -0.13); head.add(e); }
  const limb = (len, r, m) => { const k = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 2, 6), m); k.geometry.translate(0, -len / 2, 0); const p = new THREE.Group(); p.add(k); return p; };
  const armL = limb(0.55, 0.065, skin), armR = limb(0.55, 0.065, skin), legL = limb(0.7, 0.085, skin), legR = limb(0.7, 0.085, skin);
  const cloth = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.27, 0.3, 7), hide); cloth.position.y = -0.3; 
  const body = new THREE.Group();
  body.add(torso, cloth);
  // bare chest + shoulders (skin) over the hide wrap
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 5), skin); chest.scale.set(1.05, 0.9, 0.8); chest.position.set(0, 0.2, -0.04); body.add(chest);
  head.position.set(0, 0.5, 0); body.add(head);
  armL.position.set(-0.24, 0.3, 0); armR.position.set(0.24, 0.3, 0); body.add(armL, armR);
  legL.position.set(-0.1, -0.32, 0); legR.position.set(0.1, -0.32, 0); body.add(legL, legR);
  g.add(body);
  body.scale.setScalar(1.12);
  if (pose === "sit") {
    body.position.y = 0.55;
    legL.rotation.x = legR.rotation.x = Math.PI / 2 - 0.1; legL.rotation.z = 0.25; legR.rotation.z = -0.25;
    armL.rotation.x = armR.rotation.x = 0.7; body.rotation.x = 0.15; head.rotation.x = 0.25;
  } else {
    // lying on the back, face to the sky, jaw dropped
    body.rotation.x = Math.PI / 2; body.position.y = 0.2;
    head.rotation.x = -0.35;
    armL.rotation.z = pose === "reach" ? 2.6 : 0.9 + rng() * 0.5; armR.rotation.z = pose === "curl" ? -0.3 : -1.1 - rng() * 0.6;
    if (pose === "curl") { legL.rotation.x = legR.rotation.x = 0.9; body.rotation.z = 0.6; }
    else { legL.rotation.z = 0.25 + rng() * 0.2; legR.rotation.z = -0.2 - rng() * 0.2; }
  }
  skull.material = skin.clone(); // per-body (the face can be taken)
  g.userData = { head, mouth, skull, body, skin };
  return g;
}

/** Mark a body's face as taken (stylised: the face becomes a flat dark-red mask, no gore detail). */
export function markFaceTaken(body) {
  const u = body.userData;
  if (!u || u.faceTaken) return;
  u.faceTaken = true;
  const raw = lam(0x5a1c16);
  u.skull.material = raw;
  u.mouth.visible = false;
}

export class Camp {
  constructor(terrain, { lite = false } = {}) {
    this.t = terrain;
    const a = (this.site = terrain.act1);
    this.group = new THREE.Group();
    this.group.name = "act1-camp";
    this.anim = [];
    const H = (x, z) => terrain.height(x, z);
    const C = a.camp;
    this.fireLit = false;
    // ---- fire pit ----
    const fire = (this.fire = new THREE.Group());
    fire.position.set(C.x, H(C.x, C.z), C.z);
    const stone = lam(0x6e6a62), char = lam(0x1d1612), ash = lam(0x4a4644);
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), stone);
      const an = (i / 10) * Math.PI * 2; s.position.set(Math.cos(an) * 0.8, 0.08, Math.sin(an) * 0.8); s.scale.set(1, 0.6, 1); s.rotation.y = an;
      fire.add(s);
    }
    const ashD = new THREE.Mesh(new THREE.CircleGeometry(0.72, 12), ash); ashD.rotation.x = -Math.PI / 2; ashD.position.y = 0.03; fire.add(ashD);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.0, 5), char);
      l.rotation.z = Math.PI / 2 - 0.35; l.rotation.y = (i / 4) * Math.PI * 2; l.position.y = 0.2; fire.add(l);
    }
    this.flames = new THREE.Group();
    const fm = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    for (let i = 0; i < 5; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.22 - i * 0.02, 0.9 - i * 0.08, 6), fm);
      f.position.set(Math.cos(i * 2.4) * 0.15, 0.45, Math.sin(i * 2.4) * 0.15); this.flames.add(f);
    }
    this.flames.visible = false;
    fire.add(this.flames);
    this.group.add(fire);
    // fire light lives directly in the scene (main adds it) so the light count never changes
    this.fireLight = new THREE.PointLight(0xff8a3a, 0, 22, 1.6);
    this.fireLight.position.set(C.x, H(C.x, C.z) + 1.1, C.z);
    // ---- huts ----
    const rng = mulberry32(terrain.seed ^ 0xc4a9);
    const hideM = lam(0x7a5a3c), hideD = lam(0x5c4230), pole = lam(0x4a3626);
    this.huts = [];
    for (let i = 0; i < 5; i++) {
      const an = (i / 5) * Math.PI * 2 + 0.4, d = 8.5 + rng() * 2;
      const x = C.x + Math.cos(an) * d, z = C.z + Math.sin(an) * d;
      const torn = i === 2;
      const hut = new THREE.Group();
      hut.position.set(x, H(x, z), z);
      hut.rotation.y = -an + Math.PI / 2;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.1, 3.0, 9, 1, true, torn ? 1.9 : 0, torn ? 3.4 : Math.PI * 2), i % 2 ? hideM : hideD);
      cone.material = cone.material.clone(); cone.material.side = THREE.DoubleSide; if (torn) cone.material.emissive = new THREE.Color(0x2a1a0e);
      cone.position.y = 1.5; hut.add(cone);
      for (let k = 0; k < 5; k++) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 3.9, 4), pole);
        const pa = (k / 5) * Math.PI * 2; p.position.set(Math.cos(pa) * 0.95, 1.85, Math.sin(pa) * 0.95);
        p.rotation.z = Math.cos(pa) * 0.55; p.rotation.x = -Math.sin(pa) * 0.55; hut.add(p);
      }
      if (torn) {
        // the shaman's hut: hide ripped away, flaps on the ground, a toppled bone totem
        for (let k = 0; k < 3; k++) {
          const flap = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), cone.material);
          flap.rotation.x = -Math.PI / 2; flap.rotation.z = rng() * 6; flap.position.set(1.5 + k * 0.6, 0.05, -0.8 + k * 0.9); hut.add(flap);
        }
        const bone = lam(0xd8cdb4);
        const totem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.2, 5), bone); totem.rotation.z = 1.35; totem.position.set(2.2, 0.15, 0.6); hut.add(totem);
        const skull = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 0), bone); skull.position.set(3.3, 0.2, 0.7); hut.add(skull);
        this.shamanHut = hut;
      }
      this.group.add(hut);
      this.huts.push({ x, z, torn });
    }
    // Round 11: camp props are solid. The fire ring (stones + logs, r 0.8) and the hide huts block
    // the player via the terrain's circle colliders (the torn shaman hut only at its centre poles).
    terrain.campColliders = [{ x: C.x, z: C.z, r: 0.95 }, ...this.huts.map((h) => ({ x: h.x, z: h.z, r: h.torn ? 0.9 : 1.75 }))];
    // ---- dead tribe members ----
    this.bodies = [];
    const poses = ["sprawl", "reach", "curl", "sprawl"];
    for (let i = 0; i < 4; i++) {
      const an = (i / 4) * Math.PI * 2 + 1.1 + rng() * 0.4, d = 4.2 + rng() * 3.5;
      const x = C.x + Math.cos(an) * d, z = C.z + Math.sin(an) * d;
      const b = makeBody({ pose: poses[i], seed: 10 + i });
      b.position.set(x, H(x, z), z); b.rotation.y = rng() * 6.28;
      this.group.add(b);
      this.bodies.push({ obj: b, x, z });
    }
    // Tor: a tribesmate at the edge of camp (the grim backpack choice)
    {
      const an = 2.9, d = 15;
      const x = C.x + Math.cos(an) * d, z = C.z + Math.sin(an) * d;
      const b = makeBody({ pose: "reach", seed: 99 });
      b.position.set(x, H(x, z), z); b.rotation.y = 0.7;
      this.group.add(b);
      this.tor = { obj: b, x, z, skinned: false };
    }
    // ---- old blood spirals painted on the ground ----
    const bloodM = new THREE.MeshBasicMaterial({ color: 0x5a0d09, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const spiral = (cx, cz, R, turns) => {
      const pos = [], idx = [], n = 90;
      for (let i = 0; i <= n; i++) {
        const t = i / n, an = t * turns * Math.PI * 2, r = 0.15 + t * R, w = 0.07 + 0.06 * Math.sin(t * 9);
        for (const s of [-1, 1]) {
          const rr = r + s * w, x = cx + Math.cos(an) * rr, z = cz + Math.sin(an) * rr;
          pos.push(x, H(x, z) + 0.04, z);
        }
        if (i < n) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
      const m = new THREE.Mesh(g, bloodM); m.renderOrder = 1; this.group.add(m);
    };
    spiral(C.x + 3.2, C.z - 2.6, 1.6, 3);
    spiral(C.x - 4.5, C.z + 1.5, 1.2, 2.5);
    if (this.shamanHut) spiral(this.shamanHut.position.x + 1.5, this.shamanHut.position.z + 1.5, 2.0, 3.5);
    // ---- Old Lume, slumped by the fire ----
    const la = 0.6, lx = C.x + Math.cos(la) * 2.2, lz = C.z + Math.sin(la) * 2.2;
    this.lume = { obj: makeBody({ pose: "sit", elder: true, mouthOpen: false, seed: 7 }), x: lx, z: lz, alive: true };
    this.lume.obj.position.set(lx, H(lx, lz), lz);
    this.lume.obj.rotation.y = Math.atan2(-(C.x - lx), -(C.z - lz)) + Math.PI;
    this.group.add(this.lume.obj);
    // ---- berry bushes / root patches ----
    const leaf = lam(0x355a2e), berry = lam(0x8a1a2a, { emissive: 0x200408 }), stalk = lam(0x6a7a3a);
    this.bushes = [];
    for (const b of a.bushes) {
      const g = new THREE.Group(); g.position.set(b.x, H(b.x, b.z), b.z);
      const fruit = new THREE.Group();
      if (b.kind === "berries") {
        for (let k = 0; k < 3; k++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 - k * 0.1, 0), leaf); m.position.set(Math.cos(k * 2.1) * 0.35, 0.45 + k * 0.12, Math.sin(k * 2.1) * 0.35); g.add(m); }
        for (let k = 0; k < 14; k++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), berry); const an = k * 2.39, r = 0.5 + (k % 3) * 0.08; m.position.set(Math.cos(an) * r, 0.35 + (k % 5) * 0.12, Math.sin(an) * r); fruit.add(m); }
      } else {
        for (let k = 0; k < 6; k++) { const m = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.6, 4), stalk); m.position.set(Math.cos(k) * 0.25, 0.3, Math.sin(k * 1.7) * 0.25); m.rotation.z = Math.cos(k * 3) * 0.3; fruit.add(m); }
      }
      g.add(fruit);
      this.group.add(g);
      this.bushes.push({ ...b, obj: g, fruit, ready: true, regrow: 0 });
    }
    // ---- stream, pool, waterfall ----
    this.waterTex = streakTexture(false);
    this.fallTex = streakTexture(true);
    const waterM = new THREE.MeshLambertMaterial({ color: 0x6a8ea0, map: this.waterTex, transparent: true, opacity: 0.82, emissive: 0x0a1418, depthWrite: false, side: THREE.DoubleSide });
    {
      // Densify the centreline (the bed is carved along straight segments between points).
      const P = [], pos = [], uv = [], idx = [];
      for (let i = 0; i < a.stream.length - 1; i++) {
        const p0 = a.stream[i], p1 = a.stream[i + 1], n = Math.max(1, Math.ceil(Math.hypot(p1.x - p0.x, p1.z - p0.z) / 1.2));
        for (let k = 0; k < n; k++) P.push({ x: p0.x + (p1.x - p0.x) * (k / n), z: p0.z + (p1.z - p0.z) * (k / n) });
      }
      P.push(a.stream[a.stream.length - 1]);
      // The terrain chunks are a 2 m (near) / 4 m (mid) grid that can't follow the narrow carved
      // bed, so sit the water on the highest of the true height and both grid interpolations;
      // otherwise the rendered ground swallows stretches of the stream.
      const grid = (x, z, st) => {
        const gx = Math.floor(x / st) * st, gz = Math.floor(z / st) * st, fx = (x - gx) / st, fz = (z - gz) / st;
        const h00 = H(gx, gz), h10 = H(gx + st, gz), h01 = H(gx, gz + st), h11 = H(gx + st, gz + st);
        return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
      };
      const surf = (x, z) => Math.max(H(x, z) + 0.3, grid(x, z, 2) + 0.12, grid(x, z, 4) + 0.06);
      let L = 0;
      for (let i = 0; i < P.length; i++) {
        const p0 = P[Math.max(0, i - 1)], p1 = P[Math.min(P.length - 1, i + 1)];
        const dx = p1.x - p0.x, dz = p1.z - p0.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
        if (i > 0) L += Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
        const w = i === 0 ? 2.2 : 1.35;
        for (const s of [-1, 1]) { const vx = P[i].x + nx * w * s, vz = P[i].z + nz * w * s; pos.push(vx, Math.max(surf(vx, vz), surf(P[i].x, P[i].z) - 0.05), vz); uv.push(L / 6, s > 0 ? 1 : 0); }
        if (i < P.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } // counter-clockwise from above (was culled: the stream was invisible)
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      const m = new THREE.Mesh(g, waterM); m.name = "stream"; m.renderOrder = 2; this.group.add(m);
    }
    const poolY = H(a.pool.x, a.pool.z) + 0.45;
    {
      const pm = new THREE.Mesh(new THREE.CircleGeometry(5.2, 20), waterM); pm.rotation.x = -Math.PI / 2; pm.position.set(a.pool.x, poolY, a.pool.z); pm.renderOrder = 2; this.group.add(pm);
    }
    {
      const f = a.fall;
      const cliffM = lam(0x6f6a62, { emissive: 0x15171d });
      const cliff = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), cliffM);
      const fy = H(f.x, f.z);
      cliff.scale.set(4.2, (f.top - fy) * 0.62, 3.6); cliff.position.set(f.x, fy + (f.top - fy) * 0.4, f.z); cliff.rotation.y = Math.atan2(f.fx, f.fz);
      this.group.add(cliff);
      for (const s of [-1, 1]) { const r = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), cliffM); r.scale.set(2.4, 3.2, 2.2); r.position.set(f.x - f.fz * 4.6 * s, fy + 1.5, f.z + f.fx * 4.6 * s); this.group.add(r); }
      const fallM = new THREE.MeshLambertMaterial({ color: 0xcfe0ea, map: this.fallTex, transparent: true, opacity: 0.86, emissive: 0x1c262c, side: THREE.DoubleSide, depthWrite: false });
      const hgt = f.top - poolY + 0.4;
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(2.4, hgt, 1, 8), fallM);
      // bow it outward a little, like water leaving a lip
      const sp = sheet.geometry.attributes.position;
      for (let i = 0; i < sp.count; i++) { const t = 0.5 - sp.getY(i) / hgt; sp.setZ(i, Math.sin(Math.min(1, t) * Math.PI * 0.5) * 1.1); }
      sheet.geometry.computeVertexNormals();
      const ox = f.x + f.fx * 3.3, oz = f.z + f.fz * 3.3;
      sheet.position.set(ox, poolY - 0.2 + hgt / 2, oz);
      sheet.rotation.y = Math.atan2(f.fx, f.fz);
      sheet.renderOrder = 3;
      this.group.add(sheet);
      const foamM = new THREE.MeshLambertMaterial({ color: 0xe8f0f4, transparent: true, opacity: 0.75, emissive: 0x2a3034, depthWrite: false });
      this.foam = [];
      for (let k = 0; k < 6; k++) {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), foamM);
        m.position.set(ox + f.fx * 0.9 + Math.cos(k * 1.1) * 0.9, poolY + 0.05, oz + f.fz * 0.9 + Math.sin(k * 1.1) * 0.9); m.scale.y = 0.4;
        this.group.add(m); this.foam.push(m);
      }
      this.fallPos = new THREE.Vector3(ox, poolY + hgt * 0.4, oz);
    }
    this.lite = lite;
    // one mesh per material for everything static; skulls / mouths / fruit / flames / Lume stay live
    const keep = new Set([this.flames, this.lume.obj]);
    for (const b of [...this.bodies, this.tor]) { keep.add(b.obj.userData.skull); keep.add(b.obj.userData.mouth); }
    for (const b of this.bushes) keep.add(b.fruit);
    bake(this.group, keep);
    for (const b of this.bushes) bake(b.fruit);
  }

  lightFire() {
    this.fireLit = true;
    this.flames.visible = true;
  }

  update(dt, time) {
    this.waterTex.offset.x -= dt * 0.35;
    this.fallTex.offset.y += dt * 1.6;
    if (this.fireLit) {
      const fl = 0.85 + Math.sin(time * 13) * 0.08 + Math.sin(time * 7.3) * 0.07;
      this.fireLight.intensity = 9 * fl;
      this.flames.children.forEach((f, i) => { f.scale.y = 0.8 + Math.sin(time * (9 + i) + i) * 0.25; f.rotation.y = time * (1 + i * 0.3); });
    } else this.fireLight.intensity = 0;
    for (const b of this.bushes) {
      if (!b.ready) { b.regrow -= dt; if (b.regrow <= 0) { b.ready = true; b.fruit.visible = true; } }
    }
  }

  dispose() {
    this.group.traverse((o) => { o.geometry?.dispose(); });
    this.waterTex.dispose(); this.fallTex.dispose();
  }
}
