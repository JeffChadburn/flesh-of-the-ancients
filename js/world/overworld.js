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

function depthOK(HG, n2, i, j, a, b, c, d) {
  const g = (ii, jj) => HG[(jj + 1) * n2 + ii + 1];
  return a > g(i, j) - 0.05 || b > g(i + 1, j) - 0.05 || c > g(i, j + 1) - 0.05 || d > g(i + 1, j + 1) - 0.05;
}
/** Round 18: flowing / rolling water. Rivers scroll ripples downstream, the ocean rolls swell and
 *  surf onto the beach, lakes and marsh just shimmer. Lit by the sky colour, fogged like the land. */
export function makeWaterMaterial() {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uSky: { value: new THREE.Color(0.5, 0.6, 0.7) }, uLight: { value: 1 } }]);
  const m = new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: true, depthWrite: false,
    vertexShader: `attribute vec2 flow; attribute float kind; attribute float depth;
      uniform float uTime; varying vec2 vF; varying float vK; varying float vD; varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vec3 p = position; vF = flow; vK = kind; vD = depth;
        if (kind > 1.5) p.y += sin(p.x * 0.11 + uTime * 1.3) * 0.18 + sin(p.z * 0.07 - uTime * 0.9) * 0.12;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0); vW = (modelMatrix * vec4(p, 1.0)).xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; uniform vec3 uSky; uniform float uLight; varying vec2 vF; varying float vK; varying float vD; varying vec3 vW;
      #include <fog_pars_fragment>
      void main(){
        vec2 q = vW.xz;
        float sp = vK > 0.5 && vK < 1.5 ? 1.6 : 0.25;
        vec2 adv = q - vF * uTime * sp;
        float r = sin(adv.x * 0.9 + sin(adv.y * 0.6) * 1.4) * sin(adv.y * 1.1 + sin(adv.x * 0.4) * 1.7);
        float r2 = sin((adv.x + adv.y) * 2.3 + uTime * 1.7) * 0.5;
        float rip = r * 0.6 + r2 * 0.4;
        // linear colours (the output is converted to sRGB): keep them dark so water reads as water
        vec3 deep = vec3(0.012, 0.045, 0.06), shallow = vec3(0.05, 0.11, 0.1);
        if (vK > 1.5) { deep = vec3(0.006, 0.035, 0.075); shallow = vec3(0.03, 0.12, 0.14); }
        float sh = 1.0 - smoothstep(0.0, 2.2, vD);
        vec3 col = mix(deep, shallow, sh) + uSky * (0.07 + 0.05 * rip);
        float foam = 0.0;
        if (vK > 1.5) foam = smoothstep(0.55, 0.0, vD) * (0.5 + 0.5 * sin(vD * 9.0 - uTime * 2.4));
        else if (vK > 0.5) foam = smoothstep(0.75, 1.0, rip) * 0.35;
        col = mix(col, vec3(0.85, 0.9, 0.92), foam * 0.7);
        col *= uLight;
        gl_FragColor = vec4(col, mix(0.72, 0.94, smoothstep(0.0, 1.2, vD)) * smoothstep(-0.05, 0.12, vD + 0.08));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  return m;
}
const LOAD_RING = 4, KEEP_RING = 5;

function lodForRing(r) { return r <= 1 ? 0 : r === 2 ? 1 : 2; }

export function colorize(geo, fn) {
  const p = geo.attributes.position, cols = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { fn(c, p.getX(i), p.getY(i), p.getZ(i)); cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  return geo;
}

export function merge(parts) {
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
// ---- Round 18: region plants and rock forms ----
function spruceGeometry(lo) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.16, 2.0, lo ? 4 : 5); trunk.translate(0, 1.0, 0);
  parts.push(colorize(trunk, (c) => c.setHex(0x4a3828)));
  const tiers = lo ? [[1.1, 6.0, 1.2]] : [[1.25, 2.4, 1.0], [1.0, 2.2, 2.4], [0.78, 2.0, 3.7], [0.55, 1.8, 4.9], [0.32, 1.5, 6.0]];
  for (const [r, h, y] of tiers) {
    const cone = new THREE.ConeGeometry(r, h, lo ? 5 : 6, 1); cone.translate(0, y + h * 0.5 - 0.2, 0);
    parts.push(colorize(cone, (c, x, yy) => c.setHex(0x1e3a32).lerp(new THREE.Color(0x35574a), Math.min(1, (yy - y) / h + 0.1))));
  }
  return merge(parts);
}
function deadTreeGeometry() {
  const parts = [], c0 = 0x5e5448;
  const trunk = new THREE.CylinderGeometry(0.08, 0.22, 4.2, 5); trunk.translate(0, 2.1, 0); parts.push(colorize(trunk, (c) => c.setHex(c0)));
  for (const [y, a, l] of [[2.2, 0.4, 1.6], [2.9, 2.6, 1.3], [3.5, 4.4, 1.0], [1.6, 5.4, 1.1]]) {
    const b = new THREE.CylinderGeometry(0.03, 0.07, l, 4); b.translate(0, l / 2, 0); b.rotateZ(1.0); b.rotateY(a); b.translate(0, y, 0);
    parts.push(colorize(b, (c) => c.setHex(c0)));
  }
  return merge(parts);
}
function sageGeometry() {
  const g = new THREE.IcosahedronGeometry(0.9, 1); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 1 + (fbm3(p.getX(i) * 3, p.getY(i) * 3, p.getZ(i) * 3, 2) - 0.5) * 0.7; p.setXYZ(i, p.getX(i) * k, Math.max(-0.1, p.getY(i)) * k * 0.7 + 0.5, p.getZ(i) * k); }
  return colorize(g, (c, x, y) => c.setHex(0x7a8a6a).lerp(new THREE.Color(0xa8b090), Math.max(0, y - 0.6)));
}
const RED_BANDS = (c, y) => c.setHex(0xa8482a).lerp(new THREE.Color(0xd8874c), 0.5 + 0.5 * Math.sin(y * 2.4)).lerp(new THREE.Color(0xe8d2b0), Math.sin(y * 0.9) > 0.9 ? 0.6 : 0);
function hoodooGeometry() {
  // a tapering spire of stacked, weathered blocks with a pale cap rock
  const parts = []; let y = 0;
  for (let i = 0; i < 4; i++) {
    const r = 1.0 - i * 0.16, h = 1.6 + (i % 2) * 0.5;
    const g = new THREE.CylinderGeometry(r * 0.75, r, h, 7, 2); g.translate(0, y + h / 2, 0);
    const p = g.attributes.position; for (let k = 0; k < p.count; k++) { const q = 1 + (fbm3(p.getX(k) * 2 + i, p.getY(k) * 2, p.getZ(k) * 2, 2) - 0.5) * 0.45; p.setX(k, p.getX(k) * q); p.setZ(k, p.getZ(k) * q); }
    parts.push(colorize(g, (c, x, yy) => RED_BANDS(c, yy))); y += h * 0.95;
  }
  const cap = new THREE.CylinderGeometry(0.9, 0.7, 0.6, 7); cap.translate(0, y + 0.25, 0); parts.push(colorize(cap, (c) => c.setHex(0xd8c4a0)));
  return merge(parts);
}
function archGeometryRed() {
  // a natural sandstone arch: a thick half ring on two legs (span ~14 m at scale 1)
  const parts = [];
  const ring = new THREE.TorusGeometry(7, 1.5, 6, 14, Math.PI); ring.scale(1, 0.95, 1.2);
  const p = ring.attributes.position; for (let k = 0; k < p.count; k++) { const q = 1 + (fbm3(p.getX(k) * 0.4, p.getY(k) * 0.4, p.getZ(k) * 0.4, 2) - 0.5) * 0.25; p.setY(k, p.getY(k) * q); p.setZ(k, p.getZ(k) * q); }
  parts.push(colorize(ring, (c, x, y) => RED_BANDS(c, y)));
  for (const s of [-1, 1]) { const l = new THREE.CylinderGeometry(1.5, 2.1, 3, 7); l.translate(s * 7, -1.2, 0); parts.push(colorize(l, (c, x, y) => RED_BANDS(c, y))); }
  const g = merge(parts); g.translate(0, 1.2, 0); return g;
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
      spruce: spruceGeometry(false), spruceLo: spruceGeometry(true), dead: deadTreeGeometry(), sage: sageGeometry(),
      hoodoo: hoodooGeometry(), archRed: archGeometryRed(),
    };
    this.waterMat = makeWaterMaterial(); // round 18: lakes, rivers, marsh and the ocean
    const C = (h) => new THREE.Color(h);
    this.pal = { tmp: new THREE.Color(), mud: C(0x3e3a26), moss: C(0x4a5a2e), alpGrass: C(0x4a5e3a), stone: C(0x75777a), snow: C(0xe6ecf2), tundra: C(0x6e6a48), lichen: C(0x8a8a5e),
      ice: C(0xbcd8e8), redDeep: C(0x9a3e22), redLight: C(0xd27a40), cream: C(0xe2c9a0), sand: C(0xd2b88a), salt: C(0xd6d0c2), shoreRock: C(0x4c4a48) };
    // Sky, sun, moon, clouds and weather live in atmosphere.js (added to `resident` by main).
    this.horizon = this._buildHorizon();
    this.resident = new THREE.Group();
    this.resident.name = "overworld-resident";
    this.resident.add(this.horizon);
  }

  dispose() {
    for (const g of Object.values(this.geos)) g.dispose();
    this.archGeo?.dispose();
    for (const m of [this.groundMat, this.treeMat, this.rockMat, this.grassMat, this.entranceMat, this.mouthTubeMat, this.waterMat]) m.dispose();
    this.resident.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
  }

  _buildHorizon() {
    // Low-res far heightfield (40 m grid, +-1.2 km), dark silhouette, discarded near the
    // player where real chunks are drawn. Gives the mountain ridge on the horizon.
    const g = this._horizonGeo(0, 0);
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

  /** Round 18: far heightfield (40 m grid, 2.4 km square) around a centre, coloured by region
   *  (red rock, salt, snow, sea). Rebuilt as you travel so the horizon follows you. */
  _horizonGeo(cx, cz) {
    const N = 60, S = 2400, t = this.terrain;
    const g = new THREE.PlaneGeometry(S, S, N, N);
    g.rotateX(-Math.PI / 2); g.translate(cx, 0, cz);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), h = t.height(x, z), wa = t.bio.waterAt(x, z);
      p.setY(i, (wa && wa.y > h ? wa.y : h) - 6);
      const [r, gg, b] = t.bio.mapRGB(x, z, h);
      col[i * 3] = r * 0.85; col[i * 3 + 1] = gg * 0.85; col[i * 3 + 2] = b * 0.85;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.horizonAt = { x: cx, z: cz };
    return g;
  }

  /** Per-frame cosmetic updates (sky follows the eye, grass wind / fade centre). */
  tick(time, eye, atmo) {
    if (atmo) {
      const u = this.horizonUniforms;
      u.uLight.value.copy(atmo.horizonLight); u.uFog.value.copy(atmo.fogColor); u.uFogD.value = atmo.state.fogD;
    }
    this.grassUniforms.uTime.value = time;
    if (this.horizon && this.horizonAt && Math.hypot(eye.x - this.horizonAt.x, eye.z - this.horizonAt.z) > 600 && !this.lite2) {
      const old = this.horizon.geometry; this.horizon.geometry = this._horizonGeo(Math.round(eye.x / 200) * 200, Math.round(eye.z / 200) * 200); old.dispose();
    }
    this.waterMat.uniforms.uTime.value = time;
    if (atmo) { const hl = atmo.horizonLight; this.waterMat.uniforms.uSky.value.copy(atmo.fogColor).lerp(hl, 0.5); this.waterMat.uniforms.uLight.value = Math.min(1.1, 0.25 + (hl.r + hl.g + hl.b) * 0.6); }
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
    const ridgeC = new THREE.Color(0x6a6c74), snowC = new THREE.Color(0xdde3ea);
    const P = this.pal, B = t.bio;
    P.temperate = (cc, x, z, y, m) => {
      const v = fbm2(x / 23, z / 23, 2, 77);
      cc.copy(grass).lerp(dry, Math.min(1, Math.max(0, v * 1.6 - 0.45)));
      if (v < 0.33) cc.lerp(dirt, 0.5);
      cc.lerp(rock, Math.min(1, Math.max(0, (m - 0.55) * 2.2)));
      if (y > 110) cc.lerp(ridgeC, Math.min(1, (y - 110) / 60)); // bare high ridge
      if (y > 138) cc.lerp(snowC, Math.min(1, (y - 138) / 40) * (m < 0.9 ? 1 : 0.5)); // snow-dusted peaks
      return cc;
    };
    // Round 18: one height per grid point (plus a 1-cell halo for normals) instead of 5 per vertex.
    const n2 = n + 3, HG = new Float32Array(n2 * n2);
    for (let j = 0; j < n2; j++) for (let i = 0; i < n2; i++) HG[j * n2 + i] = t.height(x0 + (i - 1) * step, z0 + (j - 1) * step);
    const wet = this._wet = new Float32Array((n + 1) * (n + 1)).fill(NaN);
    const put = (i, x, z, y, gi, gj) => {
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      const gx = (HG[gj * n2 + gi + 1] - HG[gj * n2 + gi - 1]) / (2 * step), gz = (HG[(gj + 1) * n2 + gi] - HG[(gj - 1) * n2 + gi]) / (2 * step);
      const l = Math.hypot(gx, 1, gz);
      nrm[i * 3] = -gx / l; nrm[i * 3 + 1] = 1 / l; nrm[i * 3 + 2] = -gz / l;
      const m = Math.hypot(gx, gz);
      const w = B.weights(x, z);
      if (w.temperate > 0.999 && w.cd > 300) P.temperate(c, x, z, y, m); else B.color(c, x, z, y, m, w, P);
      const wa = B.waterAt(x, z, w, y);
      if (wa) { wet[i] = wa.y; if (wa.y > y) c.lerp(P.mud, Math.min(0.7, (wa.y - y) * 0.5)).multiplyScalar(0.85); } // wet, darker beds
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    };
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      put(j * (n + 1) + i, x, z, HG[(j + 1) * n2 + i + 1], i + 1, j + 1);
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
    const G = this.geos;
    const TG = [lo ? G.pineLo : G.pine, lo ? G.juniperLo : G.juniper, lo ? G.spruceLo : G.spruce, G.dead, G.sage, G.hoodoo, G.archRed];
    for (let type = 0; type < TG.length; type++) {
      const items = sc.trees.filter((tr) => tr.type === type);
      if (lo && type === 4) continue; // no far scrub
      inst(TG[type], items, this.treeMat, (tr, d) => { d.position.set(tr.x, tr.y - (type >= 5 ? 0.6 : 0.15), tr.z); d.rotation.set(0, tr.rot, 0); d.scale.setScalar(tr.s * (type === 0 ? 1.15 : 1)); });
    }
    if (lod <= 1) {
      inst(lod === 0 ? this.geos.rock : this.geos.rockLo, sc.rocks, this.rockMat, (r, d) => { d.position.set(r.x, r.y - r.s * 0.15, r.z); d.rotation.set(r.tilt * 0.3, r.rot, 0); d.scale.setScalar(r.s); });
      const rm = group.children[group.children.length - 1];
      if (rm?.isInstancedMesh && rm.material === this.rockMat && sc.rocks.length) { // round 18: red sandstone / pale granite boulders by region
        const tc = new THREE.Color(), red = new THREE.Color(1.35, 0.78, 0.55), cold = new THREE.Color(0.95, 1.0, 1.08);
        sc.rocks.forEach((r, i) => { const w = B.weights(r.x, r.z); tc.setRGB(1, 1, 1).lerp(red, w.red + w.salt * 0.5).lerp(cold, w.tundra); rm.setColorAt(i, tc); });
        rm.instanceColor.needsUpdate = true;
      }
    }
    yield;
    if (lod === 0) {
      const rng = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ 0x9e37);
      const count = this.lite ? 300 : 650, blades = [];
      for (let i = 0; i < count; i++) {
        const x = x0 + rng() * CHUNK, z = z0 + rng() * CHUNK;
        const patch = fbm2(x / 15, z / 15, 2, 31);
        if (patch < 0.42 || rng() > 0.9) continue;
        // round 18: blades per region (reeds in the marsh, sparse dry tufts in the desert, none on salt or ice)
        const w = B.weights(x, z), r6 = rng();
        if (w.sea > 0.02 || r6 > 1 - w.salt * 0.95 - w.red * 0.75 - w.tundra * 0.45 - w.alpine * 0.3) continue;
        const y = t.height(x, z);
        if (t.slope(x, z).m > 0.7) continue;
        const wa = B.waterAt(x, z, w, y);
        if (wa && wa.y > y + 0.25 && wa.kind !== "marsh") continue;
        blades.push({ x, z, y, s: (0.7 + rng() * 0.8) * (w.swamp > 0.5 ? 1.15 : 1), r: rng() * 6.28, reed: w.swamp, dryK: w.red + w.salt, cold: w.tundra + w.alpine * 0.5 });
      }
      inst(this.geos.grass, blades, this.grassMat, (b, d) => { d.position.set(b.x, b.y - 0.03, b.z); d.rotation.set(0, b.r, 0); d.scale.set(b.s, b.s * (0.8 + (b.r % 1) * 0.6) * (1 + b.reed * 0.8), b.s); });
      const gm = group.children[group.children.length - 1];
      if (gm?.isInstancedMesh && gm.material === this.grassMat && blades.some((b) => b.reed + b.dryK + b.cold > 0.01)) {
        const tc = new THREE.Color(), dryT = new THREE.Color(1.5, 1.2, 0.75), reedT = new THREE.Color(0.85, 1.0, 0.7), coldT = new THREE.Color(1.25, 1.1, 0.85);
        blades.forEach((b, i) => { tc.setRGB(1, 1, 1).lerp(dryT, b.dryK).lerp(reedT, b.reed).lerp(coldT, b.cold); gm.setColorAt(i, tc); });
        gm.instanceColor.needsUpdate = true;
      }
      const last = group.children[group.children.length - 1];
      if (last && last.material === this.grassMat) { last.name = "grass"; last.frustumCulled = false; }
    }
    // --- round 18: water surface (lakes / rivers / marsh / ocean) for this chunk ---
    {
      const wg = this._waterGeo(cx, cz, n, step, wet, HG, n2);
      if (wg) { const wm = new THREE.Mesh(wg, this.waterMat); wm.name = "water"; wm.renderOrder = 2; group.add(wm); tris += wg.index.count / 3; }
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

  /** Round 18: a water sheet over the chunk grid where any water body is (dilated one cell so
   *  the edge tucks under the banks). Attributes: flow (xz), kind (0 still, 1 river, 2 ocean),
   *  depth (surface - ground) for the shallow tint and the surf line. */
  _waterGeo(cx, cz, n, step, wet, HG, n2) {
    const t = this.terrain, B = t.bio, x0 = cx * CHUNK, z0 = cz * CHUNK, N1 = n + 1;
    if (!wet.some((v) => !Number.isNaN(v))) return null;
    const lv = new Float32Array(N1 * N1).fill(NaN);
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      let v = wet[j * N1 + i];
      if (Number.isNaN(v)) for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a <= n && b <= n && !Number.isNaN(wet[b * N1 + a])) { v = wet[b * N1 + a]; break; } }
      lv[j * N1 + i] = v;
    }
    const pos = [], flow = [], kind = [], depth = [], idx = [], map = new Int32Array(N1 * N1).fill(-1);
    const vert = (i, j) => {
      const k = j * N1 + i; if (map[k] >= 0) return map[k];
      const x = x0 + i * step, z = z0 + j * step, y = lv[k];
      const wa = B.waterAt(x, z);
      map[k] = pos.length / 3; pos.push(x, y, z);
      flow.push(wa ? wa.fx : 0, wa ? wa.fz : 0); kind.push(!wa ? 0 : wa.kind === "river" ? 1 : wa.kind === "ocean" ? 2 : 0);
      depth.push(y - HG[(j + 1) * n2 + i + 1]);
      return map[k];
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * N1 + i, b = a + 1, c = a + N1, d = c + 1;
      if ([a, b, c, d].some((q) => Number.isNaN(lv[q]))) continue;
      // skip cells that are entirely above the surface (dry)
      if (depthOK(HG, n2, i, j, lv[a], lv[b], lv[c], lv[d])) idx.push(vert(i, j), vert(i, j + 1), vert(i + 1, j), vert(i + 1, j), vert(i, j + 1), vert(i + 1, j + 1));
    }
    if (!idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("flow", new THREE.Float32BufferAttribute(flow, 2));
    g.setAttribute("kind", new THREE.Float32BufferAttribute(kind, 1));
    g.setAttribute("depth", new THREE.Float32BufferAttribute(depth, 1));
    g.setIndex(idx); g.computeBoundingSphere();
    return g;
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
