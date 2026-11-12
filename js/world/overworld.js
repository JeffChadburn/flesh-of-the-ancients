/**
 * Overworld rendering: a chunk layer for the shared ChunkManager (2D grid with LOD rings),
 * plus a resident night sky and a far "horizon" heightfield silhouette.
 *
 *   ring 0-1 (3x3 chunks):  LOD0 ground (2 m grid), full trees, rocks, grass
 *   ring 2:                 LOD1 ground (4 m), full trees, rocks
 *   ring 3-4:               LOD2 ground (8 m), low-poly trees
 *   unload beyond ring 5 (hysteresis). LOD swaps keep the old chunk until the new one is in.
 * Chunk edges get skirts so neighbouring LODs never show cracks. All geometry is generated
 * from the Terrain's pure height function and scatter data (seed + chunk coords).
 */
import * as THREE from "three";
import { CHUNK, fbm2 } from "./terrain.js";
import { mulberry32 } from "../rng.js";
import { fbm3 } from "../rng.js";
import { addDetail } from "../realism.js";

const RES = [32, 16, 8];
const LOAD_RING = 4, KEEP_RING = 5;

function lodForRing(r) { return r <= 1 ? 0 : r === 2 ? 1 : 2; }

function colorize(geo, fn) {
  const p = geo.attributes.position, cols = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { fn(c, p.getX(i), p.getY(i), p.getZ(i)); cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  return geo;
}

function merge(parts) {
  // tiny non-indexed merge (avoids the BufferGeometryUtils import)
  const pos = [], nrm = [], col = [];
  for (const g0 of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    g.computeVertexNormals();
    pos.push(...g.attributes.position.array); nrm.push(...g.attributes.normal.array);
    col.push(...(g.attributes.color ? g.attributes.color.array : new Float32Array(g.attributes.position.count * 3).fill(1)));
    if (g !== g0) g.dispose();
    g0.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

function pineGeometry(lo) {
  const parts = [];
  const seg = lo ? 5 : 7;
  const trunk = new THREE.CylinderGeometry(0.12, 0.2, 2.2, lo ? 4 : 6); trunk.translate(0, 1.1, 0);
  parts.push(colorize(trunk, (c) => c.setHex(0x5a4330)));
  const tiers = lo ? [[1.6, 4.2, 2.4]] : [[1.9, 2.6, 1.6], [1.5, 2.3, 3.0], [1.05, 2.0, 4.2], [0.6, 1.6, 5.2]];
  for (const [r, h, y] of tiers) {
    const cone = new THREE.ConeGeometry(r, h, seg, 1); cone.translate(0, y + h * 0.5 - 0.2, 0);
    if (!lo) { const p = cone.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + (Math.sin(i * 12.9898) * 0.5) * 0.18; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } }
    parts.push(colorize(cone, (c, x, yy) => c.setHex(0x2c4a34).lerp(new THREE.Color(0x4a6b48), Math.min(1, (yy - y) / h + 0.2))));
  }
  return merge(parts);
}
function juniperGeometry(lo) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.18, 1.2, 5); trunk.translate(0, 0.6, 0);
  parts.push(colorize(trunk, (c) => c.setHex(0x6a5038)));
  const blobs = lo ? [[0, 2.0, 0, 1.4]] : [[0, 1.8, 0, 1.15], [0.6, 2.4, 0.2, 0.85], [-0.5, 2.3, -0.3, 0.8], [0.1, 2.9, 0.1, 0.7]];
  for (const [x, y, z, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, 0); g.translate(x, y, z);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = 1 + (fbm3(p.getX(i) * 2, p.getY(i) * 2, p.getZ(i) * 2, 2) - 0.5) * 0.5; p.setXYZ(i, x + (p.getX(i) - x) * k, y + (p.getY(i) - y) * k * 0.85, z + (p.getZ(i) - z) * k); }
    parts.push(colorize(g, (c) => c.setHex(0x3e5a3a)));
  }
  return merge(parts);
}
function rockGeometry(detail = 1, seed = 3) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.75 + fbm3(x * 1.3 + seed, y * 1.3, z * 1.3, 3) * 0.6;
    p.setXYZ(i, x * k * 1.15, Math.max(-0.35, y) * k * 0.7, z * k);
  }
  g.computeVertexNormals();
  return colorize(g, (c, x, y) => c.setHex(0x8a857c).lerp(new THREE.Color(0x5a5852), Math.max(0, -y)));
}
function grassGeometry() {
  // three crossed blades (6 tris), base at y=0
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(0.16, 0.55, 1, 2);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const yy = p.getY(k) + 0.275; p.setY(k, yy); if (yy > 0.5) p.setX(k, p.getX(k) * 0.15 + 0.05); }
    g.rotateY((i / 3) * Math.PI);
    g.translate(Math.cos(i * 2.1) * 0.12, 0, Math.sin(i * 2.1) * 0.12);
    parts.push(colorize(g, (c, x, y) => c.setHex(0x40512a).lerp(new THREE.Color(0x8a9a50), y / 0.55)));
  }
  const m = merge(parts);
  // Blades lit like the ground they grow from: explicit back faces (reversed copies) with
  // up-facing normals, drawn single-sided, so no side ever renders as a black cut-out.
  const P = m.attributes.position.array, C = m.attributes.color.array, n = P.length / 3;
  const pos = new Float32Array(P.length * 2), col = new Float32Array(C.length * 2), nrm = new Float32Array(P.length * 2);
  pos.set(P); col.set(C);
  for (let t = 0; t < n; t += 3) for (const [d, s] of [[0, 0], [1, 2], [2, 1]]) {
    pos.set(P.subarray((t + s) * 3, (t + s) * 3 + 3), (n + t + d) * 3);
    col.set(C.subarray((t + s) * 3, (t + s) * 3 + 3), (n + t + d) * 3);
  }
  for (let i = 0; i < n * 2; i++) nrm[i * 3 + 1] = 1;
  m.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  m.setAttribute("color", new THREE.BufferAttribute(col, 3));
  m.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  m.computeBoundingSphere();
  return m;
}

export class OverworldLayer {
  constructor(terrain, { lite = false } = {}) {
    this.name = "terrain";
    this.terrain = terrain;
    this.lite = lite;
    this.groundMat = addDetail(new THREE.MeshLambertMaterial({ vertexColors: true }), { scale: 0.55, amt: 0.32, sat: 0.72, ao: 0.22, bump: 0.12 }); // round 14: soil / grass mottling
    this.treeMat = addDetail(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { scale: 2.6, amt: 0.3, sat: 0.7, ao: 0.25, bump: 0.08 });
    // A faint cold self-light keeps moon-shadowed rock off pure black, so cave mouths (true black) read as holes.
    this.rockMat = addDetail(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x1a1e28 }), { scale: 1.6, amt: 0.42, sat: 0.55, ao: 0.3, bump: 0.15 });
    this.grassUniforms = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() } };
    this.grassMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.grassMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.grassUniforms.uTime;
      sh.uniforms.uCenter = this.grassUniforms.uCenter;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform vec3 uCenter;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          vec4 gip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float gd = distance(gip.xz, uCenter.xz);
          float gf = 1.0 - smoothstep(20.0, 36.0, gd);
          transformed *= gf;
          transformed.x += sin(uTime * 1.6 + gip.x * 0.35 + gip.z * 0.21) * 0.09 * position.y * gf;
          transformed.z += cos(uTime * 1.3 + gip.x * 0.17) * 0.05 * position.y * gf;`);
    };
    addDetail(this.grassMat, { scale: 0.9, amt: 0.25, sat: 0.7, ao: 0.1, bump: 0 }); // round 14: varied, less candy-green blades
    this.entranceMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mouthTubeMat = new THREE.MeshBasicMaterial({ color: 0x020202, side: THREE.BackSide });
    this.geos = {
      pine: pineGeometry(false), pineLo: pineGeometry(true),
      juniper: juniperGeometry(false), juniperLo: juniperGeometry(true),
      rock: rockGeometry(1, 3), rockLo: rockGeometry(0, 3), boulder: rockGeometry(2, 7),
      grass: grassGeometry(),
    };
    // Sky, sun, moon, clouds and weather live in atmosphere.js (added to `resident` by main).
    this.horizon = this._buildHorizon();
    this.resident = new THREE.Group();
    this.resident.name = "overworld-resident";
    this.resident.add(this.horizon);
  }

  dispose() {
    for (const g of Object.values(this.geos)) g.dispose();
    this.archGeo?.dispose();
    for (const m of [this.groundMat, this.treeMat, this.rockMat, this.grassMat, this.entranceMat, this.mouthTubeMat]) m.dispose();
    this.resident.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
  }

  _buildHorizon() {
    // Low-res far heightfield (40 m grid, +-1.2 km), dark silhouette, discarded near the
    // player where real chunks are drawn. Gives the mountain ridge on the horizon.
    const N = 60, S = 2400, t = this.terrain;
    const g = new THREE.PlaneGeometry(S, S, N, N);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), h = t.height(x, z);
      p.setY(i, h - 6);
      // albedo: green-grey hills, bare grey ridge, snow-dusted peaks
      const k = Math.min(1, Math.max(0, (h - 60) / 90)), sn = Math.min(1, Math.max(0, (h - 140) / 45));
      let r = 0.16 + k * 0.12, gg = 0.2 + k * 0.08, b = 0.14 + k * 0.14;
      r += (0.86 - r) * sn; gg += (0.88 - gg) * sn; b += (0.92 - b) * sn;
      col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.horizonUniforms = { uCenter: { value: new THREE.Vector3() }, uCut: { value: 4.4 * CHUNK }, uLight: { value: new THREE.Color(0.2, 0.22, 0.3) }, uFog: { value: new THREE.Color(0x0b0f1a) }, uFogD: { value: 0.0095 } };
    const mat = new THREE.ShaderMaterial({
      fog: false, vertexColors: true, uniforms: this.horizonUniforms,
      vertexShader: "varying vec3 vC; varying vec3 vW; void main(){ vC = color; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
      fragmentShader: `varying vec3 vC; varying vec3 vW; uniform vec3 uCenter, uLight, uFog; uniform float uCut, uFogD;
        void main(){ vec2 d = abs(vW.xz - uCenter.xz); if (max(d.x, d.y) < uCut) discard;
          float f = 1.0 - exp(-length(vW.xz - cameraPosition.xz) * uFogD * 0.55);
          gl_FragColor = vec4(mix(vC * uLight, uFog, clamp(f, 0.0, 0.97)), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const m = new THREE.Mesh(g, mat);
    m.name = "horizon";
    m.frustumCulled = false;
    return m;
  }

  /** Per-frame cosmetic updates (sky follows the eye, grass wind / fade centre). */
  tick(time, eye, atmo) {
    if (atmo) {
      const u = this.horizonUniforms;
      u.uLight.value.copy(atmo.horizonLight); u.uFog.value.copy(atmo.fogColor); u.uFogD.value = atmo.state.fogD;
    }
    this.grassUniforms.uTime.value = time;
    this.grassUniforms.uCenter.value.copy(eye);
    // Horizon cut snaps to the loaded chunk square around the player.
    const cx = (Math.floor(eye.x / CHUNK) + 0.5) * CHUNK, cz = (Math.floor(eye.z / CHUNK) + 0.5) * CHUNK;
    this.horizonUniforms.uCenter.value.set(cx, 0, cz);
  }

  scan(ctx) {
    const p = ctx.pos, mgr = ctx.manager;
    const pcx = Math.floor(p.x / CHUNK), pcz = Math.floor(p.z / CHUNK);
    const want = new Map(), keep = new Set();
    const fx = ctx.dir ? ctx.dir.x : 0, fz = ctx.dir ? ctx.dir.z : 0;
    for (let dx = -KEEP_RING; dx <= KEEP_RING; dx++) for (let dz = -KEEP_RING; dz <= KEEP_RING; dz++) {
      const ring = Math.max(Math.abs(dx), Math.abs(dz));
      const cx = pcx + dx, cz = pcz + dz;
      const L = lodForRing(Math.min(ring, LOAD_RING));
      const desired = `${cx},${cz},${L}`;
      if (ring <= LOAD_RING) {
        const n = Math.hypot(dx, dz) || 1, ahead = (dx * fx + dz * fz) / n;
        want.set(desired, ring * 10 - (ahead > 0.3 ? 6 * ahead : 0) + L);
      }
      const desiredIn = mgr ? mgr.isLoaded(this.name, desired) : false;
      for (let l = 0; l < RES.length; l++) {
        const k = `${cx},${cz},${l}`;
        if (l === L) keep.add(k);
        else if (!desiredIn) keep.add(k); // keep the old LOD until its replacement is ready
      }
    }
    return { want, keep };
  }

  *build(key) {
    const [cx, cz, lod] = key.split(",").map(Number);
    const t = this.terrain;
    const group = new THREE.Group();
    group.name = "terrain " + key;
    let tris = 0;
    // --- ground with skirts ---
    const n = RES[lod], step = CHUNK / n, x0 = cx * CHUNK, z0 = cz * CHUNK;
    const verts = (n + 1) * (n + 1);
    const pos = new Float32Array((verts + 4 * (n + 1)) * 3), nrm = new Float32Array(pos.length), col = new Float32Array(pos.length);
    const c = new THREE.Color(), grass = new THREE.Color(0x3d5230), dry = new THREE.Color(0x6a6444), rock = new THREE.Color(0x77736c), dirt = new THREE.Color(0x574632);
    const put = (i, x, z, y) => {
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      const e = 1;
      const gx = (t.height(x + e, z) - t.height(x - e, z)) / 2, gz = (t.height(x, z + e) - t.height(x, z - e)) / 2;
      const l = Math.hypot(gx, 1, gz);
      nrm[i * 3] = -gx / l; nrm[i * 3 + 1] = 1 / l; nrm[i * 3 + 2] = -gz / l;
      const m = Math.hypot(gx, gz);
      const v = fbm2(x / 23, z / 23, 2, 77);
      c.copy(grass).lerp(dry, Math.min(1, Math.max(0, v * 1.6 - 0.45)));
      if (v < 0.33) c.lerp(dirt, 0.5);
      c.lerp(rock, Math.min(1, Math.max(0, (m - 0.55) * 2.2)));
      if (y > 110) c.lerp(new THREE.Color(0x6a6c74), Math.min(1, (y - 110) / 60)); // bare high ridge
      if (y > 138) c.lerp(new THREE.Color(0xdde3ea), Math.min(1, (y - 138) / 40) * (m < 0.9 ? 1 : 0.5)); // snow-dusted peaks
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    };
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      put(j * (n + 1) + i, x, z, t.height(x, z));
    }
    const idx = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c2 = a + n + 1, d = c2 + 1;
      idx.push(a, c2, b, b, c2, d);
    }
    yield;
    // skirts: duplicate each edge vertex 3 m lower and stitch (hides LOD cracks)
    let k = verts;
    const edges = [
      Array.from({ length: n + 1 }, (_, i) => i),
      Array.from({ length: n + 1 }, (_, i) => n * (n + 1) + i),
      Array.from({ length: n + 1 }, (_, j) => j * (n + 1)),
      Array.from({ length: n + 1 }, (_, j) => j * (n + 1) + n),
    ];
    for (const e of edges) {
      const base = k;
      for (const vi of e) {
        pos[k * 3] = pos[vi * 3]; pos[k * 3 + 1] = pos[vi * 3 + 1] - 3; pos[k * 3 + 2] = pos[vi * 3 + 2];
        nrm.copyWithin(k * 3, vi * 3, vi * 3 + 3); col.copyWithin(k * 3, vi * 3, vi * 3 + 3);
        k++;
      }
      for (let i = 0; i < n; i++) idx.push(e[i], base + i, e[i + 1], e[i + 1], base + i, base + i + 1, e[i], e[i + 1], base + i, e[i + 1], base + i + 1, base + i);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const ground = new THREE.Mesh(geo, this.groundMat);
    ground.name = "ground";
    group.add(ground);
    tris += idx.length / 3;
    yield;
    // --- trees, rocks, grass from resident scatter data ---
    const sc = t.scatter(cx, cz);
    const dummy = new THREE.Object3D();
    const inst = (geo0, items, mat, place) => {
      if (!items.length) return;
      const m = new THREE.InstancedMesh(geo0, mat, items.length);
      items.forEach((it, i) => { place(it, dummy); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); });
      m.computeBoundingSphere();
      m.userData.sharedGeometry = true;
      group.add(m);
      tris += (geo0.index ? geo0.index.count : geo0.attributes.position.count) / 3 * items.length;
    };
    const lo = lod >= 2;
    for (const type of [0, 1]) {
      const items = sc.trees.filter((tr) => tr.type === type);
      const g0 = type === 0 ? (lo ? this.geos.pineLo : this.geos.pine) : (lo ? this.geos.juniperLo : this.geos.juniper);
      inst(g0, items, this.treeMat, (tr, d) => { d.position.set(tr.x, tr.y - 0.15, tr.z); d.rotation.set(0, tr.rot, 0); d.scale.setScalar(tr.s * (type === 0 ? 1.15 : 1)); });
    }
    if (lod <= 1) inst(lod === 0 ? this.geos.rock : this.geos.rockLo, sc.rocks, this.rockMat, (r, d) => { d.position.set(r.x, r.y - r.s * 0.15, r.z); d.rotation.set(r.tilt * 0.3, r.rot, 0); d.scale.setScalar(r.s); });
    yield;
    if (lod === 0) {
      const rng = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ 0x9e37);
      const count = this.lite ? 300 : 650, blades = [];
      for (let i = 0; i < count; i++) {
        const x = x0 + rng() * CHUNK, z = z0 + rng() * CHUNK;
        const patch = fbm2(x / 15, z / 15, 2, 31);
        if (patch < 0.42 || rng() > 0.9) continue;
        if (t.slope(x, z).m > 0.7) continue;
        blades.push({ x, z, y: t.height(x, z), s: 0.7 + rng() * 0.8, r: rng() * 6.28 });
      }
      inst(this.geos.grass, blades, this.grassMat, (b, d) => { d.position.set(b.x, b.y - 0.03, b.z); d.rotation.set(0, b.r, 0); d.scale.set(b.s, b.s * (0.8 + (b.r % 1) * 0.6), b.s); });
      const last = group.children[group.children.length - 1];
      if (last && last.material === this.grassMat) { last.name = "grass"; last.frustumCulled = false; }
    }
    // --- cave entrances in this chunk: rock outcrop with a dark mouth ---
    for (const e of t.entrances) {
      if (Math.floor(e.x / CHUNK) !== cx || Math.floor(e.z / CHUNK) !== cz) continue;
      const o = this._entranceObject(e, lod);
      group.add(o);
      o.traverse((m) => { if (m.geometry) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; });
    }
    let ymin = Infinity, ymax = -Infinity;
    for (let i = 1; i < verts * 3; i += 3) { ymin = Math.min(ymin, pos[i]); ymax = Math.max(ymax, pos[i]); }
    const bounds = new THREE.Box3(new THREE.Vector3(x0, ymin - 1, z0), new THREE.Vector3(x0 + CHUNK, ymax + 6, z0 + CHUNK));
    return { obj: group, tris, bounds };
  }

  _entranceObject(e, lod) {
    const t = this.terrain, k = e.scale;
    const g = new THREE.Group();
    g.name = "entrance " + e.id;
    const bx = -e.fx, bz = -e.fz, sx = -bz, sz = bx;
    const rng = mulberry32(e.id * 7777 + 5);
    const boulder = (x, z, s, sy, yOff = 0) => {
      const m = new THREE.Mesh(lod === 0 ? this.geos.boulder : this.geos.rock, this.rockMat);
      m.position.set(x, t.height(x, z) + yOff, z);
      m.scale.set(s, s * sy, s * (0.8 + rng() * 0.4));
      m.rotation.y = rng() * 6.28;
      m.userData.sharedGeometry = true;
      g.add(m);
    };
    // Pillars, lintel, and the big rock mass behind; the mouth is a black opening in front of it.
    for (const side of [1, -1]) boulder(e.x + sx * 3.0 * k * side + bx * 0.6 * k, e.z + sz * 3.0 * k * side + bz * 0.6 * k, 1.6 * k, 2.3, 0.5 * k);
    boulder(e.x + bx * 7.4 * k, e.z + bz * 7.4 * k, 5.2 * k, 1.5, 0.5 * k);
    boulder(e.x + bx * 1.9 * k, e.z + bz * 1.9 * k, 2.6 * k, 0.7, 3.9 * k);
    boulder(e.x + bx * 4.8 * k + sx * 4.2 * k, e.z + bz * 4.8 * k + sz * 4.2 * k, 2.6 * k, 1.1, 0.5);
    boulder(e.x + bx * 4.8 * k - sx * 4.4 * k, e.z + bz * 4.8 * k - sz * 4.4 * k, 2.3 * k, 1.2, 0.5);
    const my = t.height(e.x, e.z);
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(1, 24, 0, Math.PI), this.entranceMat);
    mouth.scale.set(1.9 * k, 2.7 * k, 1);
    mouth.position.set(e.x + bx * 0.35 * k, my - 0.4, e.z + bz * 0.35 * k);
    mouth.rotation.y = Math.atan2(e.fx, e.fz);
    mouth.renderOrder = 1;
    g.add(mouth);
    // A jagged rock arch framing the opening and running back into the hill, so the black mouth
    // meets solid rock all round (no slivers of sky / grass between the hole and the boulders).
    if (!this.archGeo) {
      const sh = new THREE.Shape(), N = 18, r2 = mulberry32(911);
      sh.moveTo(1.62, -0.25);
      for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI, r = 1.42 + r2() * 0.26; sh.lineTo(Math.cos(a) * r, Math.max(-0.25, Math.sin(a) * r * 1.04)); }
      sh.lineTo(-1.62, -0.25); sh.lineTo(-0.985, -0.25);
      for (let i = N; i >= 0; i--) { const a = (i / N) * Math.PI; sh.lineTo(-Math.cos(Math.PI - a) * 0.985, Math.max(-0.25, Math.sin(a) * 0.985)); }
      sh.lineTo(0.985, -0.25); sh.closePath();
      const ag = new THREE.ExtrudeGeometry(sh, { depth: 1.6, bevelEnabled: false, curveSegments: 1 });
      ag.translate(0, 0, -1.45);
      this.archGeo = ag.index ? ag.toNonIndexed() : ag;
      if (this.archGeo !== ag) ag.dispose();
      this.archGeo.computeVertexNormals();
      // rock colouring like the boulders (rockMat uses vertex colours), darker toward the mouth
      const pa = this.archGeo.attributes.position, col = [], c = new THREE.Color();
      for (let i = 0; i < pa.count; i++) { const r = Math.hypot(pa.getX(i), pa.getY(i)); c.setHex(0x8a857c).lerp(new THREE.Color(0x4a4844), Math.max(0, Math.min(1, (1.5 - r) * 1.6))); col.push(c.r, c.g, c.b); }
      this.archGeo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    }
    const arch = new THREE.Mesh(this.archGeo, this.rockMat);
    arch.scale.set(1.9 * k, 2.7 * k, 1.4 * k);
    arch.position.copy(mouth.position);
    arch.rotation.y = mouth.rotation.y;
    arch.userData.sharedGeometry = true;
    g.add(arch);
    return g;
  }

  debugColor(key) { const l = +key.split(",")[2]; return [0x66ff66, 0xffcc44, 0xff6644][l]; }
}
