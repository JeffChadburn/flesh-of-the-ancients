/**
 * Standalone realism sample (not used by the game): one valley scene showing what a realism pass
 * looks like with stock Three.js r170: ACES + sRGB, sky + IBL, soft sun shadows, haze, procedural
 * PBR ground (albedo / normal / roughness, slope + height blending, triplanar rock), instanced wind
 * grass, bloom + vignette. ?gfx=low drops post-processing, MSAA and most of the grass.
 */
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Caveman } from "../caveman.js";

const URLP = new URLSearchParams(location.search);
const LOW = URLP.get("gfx") === "low";
const Q = LOW ? { tex: 256, seg: 160, grass: 9000, grassR: 16, trees: 40, shadow: 1024, dpr: 1.5, post: false, aa: false }
  : { tex: 512, seg: 300, grass: 70000, grassR: 30, trees: 90, shadow: 2048, dpr: 2, post: true, aa: true };
document.getElementById("q").textContent = LOW ? "Low quality" : "High quality";
const qa = document.getElementById("qa"); qa.textContent = LOW ? "switch to High" : "switch to Low (phones)";
qa.href = LOW ? "?gfx=high" : "?gfx=low";

// ---------------- noise ----------------
function hash2(x, y, s = 0) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const fade = (t) => t * t * (3 - 2 * t);
/** value noise; with `p` > 0 it tiles every p cells */
function vnoise(x, y, p = 0, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = fade(x - xi), fy = fade(y - yi);
  const w = (a) => (p ? ((a % p) + p) % p : a);
  const a = hash2(w(xi), w(yi), s), b = hash2(w(xi + 1), w(yi), s), c = hash2(w(xi), w(yi + 1), s), d = hash2(w(xi + 1), w(yi + 1), s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y, oct = 5, p = 0, s = 0) { let v = 0, amp = 0.5, f = 1, n = 0; for (let i = 0; i < oct; i++) { v += amp * vnoise(x * f, y * f, p ? p * f : 0, s + i); n += amp; amp *= 0.5; f *= 2; } return v / n; }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------- terrain height ----------------
function H(x, z) {
  let h = fbm(x * 0.012, z * 0.012, 5, 0, 7) * 12 - 6;
  const side = Math.min(1, Math.abs(x) / 220); h += side * side * 45;                 // valley walls
  const back = smooth(160, 420, -z), ridge = 1 - Math.abs(fbm(x * 0.006, z * 0.006, 4, 0, 3) * 2 - 1);
  h += back * (25 + ridge * ridge * 115);                                              // mountains behind
  const d = Math.hypot(x, z); h = h * (0.35 + 0.65 * smooth(6, 45, d)) + fbm(x * 0.15, z * 0.15, 2, 0, 9) * 0.25; // a gentle meadow where Kra stands
  return h;
}

// ---------------- procedural textures (canvas noise) ----------------
function makeTex(kind, S) {
  const Hf = new Float32Array(S * S), alb = document.createElement("canvas"), nrm = document.createElement("canvas");
  alb.width = alb.height = nrm.width = nrm.height = S;
  const A = alb.getContext("2d").createImageData(S, S), N = nrm.getContext("2d").createImageData(S, S);
  const cols = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x / S) * 8, v = (y / S) * 8, i = y * S + x;
    let h, c;
    if (kind === "grass") {
      const n = fbm(u, v, 5, 8, 1), blade = vnoise(u * 16, v * 4, 128, 5);
      h = n * 0.6 + blade * 0.4;
      const t = n * 0.7 + blade * 0.3;
      c = [0.16 + 0.17 * t, 0.24 + 0.14 * t, 0.07 + 0.05 * t];
    } else if (kind === "dirt") {
      const n = fbm(u, v, 5, 8, 11), peb = vnoise(u * 6, v * 6, 48, 13), p = smooth(0.72, 0.8, peb);
      h = n * 0.7 + p * 0.6;
      c = [0.30 + 0.12 * n + p * 0.12, 0.22 + 0.10 * n + p * 0.1, 0.15 + 0.07 * n + p * 0.09];
    } else {
      const n = fbm(u, v, 6, 8, 21), strata = Math.sin((v + n * 1.6) * 7.0) * 0.5 + 0.5, crack = 1 - Math.abs(fbm(u * 1.5, v * 1.5, 4, 12, 31) * 2 - 1);
      h = n * 0.55 + strata * 0.2 + smooth(0.86, 0.98, crack) * -0.5;
      const g = 0.22 + 0.13 * n + 0.05 * strata - smooth(0.86, 0.98, crack) * 0.12;
      c = [g * 1.03, g, g * 0.95];
    }
    Hf[i] = h; cols.push(c);
  }
  const strength = kind === "rock" ? 7 : kind === "dirt" ? 4 : 3;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, at = (xx, yy) => Hf[((yy + S) % S) * S + ((xx + S) % S)];
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    N.data[i * 4] = (-dx / l * 0.5 + 0.5) * 255; N.data[i * 4 + 1] = (-dy / l * 0.5 + 0.5) * 255; N.data[i * 4 + 2] = (1 / l * 0.5 + 0.5) * 255;
    // roughness in alpha would get premultiplied by the canvas, so it lives in the normal map's... no: own channel below
    N.data[i * 4 + 3] = 255;
    const c = cols[i]; A.data[i * 4] = Math.pow(c[0], 1 / 2.2) * 255; A.data[i * 4 + 1] = Math.pow(c[1], 1 / 2.2) * 255; A.data[i * 4 + 2] = Math.pow(c[2], 1 / 2.2) * 255; A.data[i * 4 + 3] = 255;
  }
  alb.getContext("2d").putImageData(A, 0, 0); nrm.getContext("2d").putImageData(N, 0, 0);
  const ta = new THREE.CanvasTexture(alb), tn = new THREE.CanvasTexture(nrm);
  ta.colorSpace = THREE.SRGBColorSpace;
  for (const t of [ta, tn]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.generateMipmaps = true; }
  return { albedo: ta, normal: tn, H: Hf };
}
/** One roughness texture for all three: R grass, G dirt, B rock (from their height fields). */
function makeRough(S, g, d, r) {
  const c = document.createElement("canvas"); c.width = c.height = S; const D = c.getContext("2d").createImageData(S, S);
  for (let i = 0; i < S * S; i++) { D.data[i * 4] = (0.78 + 0.2 * g[i]) * 255; D.data[i * 4 + 1] = (0.86 + 0.14 * d[i]) * 255; D.data[i * 4 + 2] = (0.5 + 0.35 * r[i]) * 255; D.data[i * 4 + 3] = 255; }
  c.getContext("2d").putImageData(D, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// ---------------- renderer / scene ----------------
const renderer = new THREE.WebGLRenderer({ antialias: Q.aa && !Q.post, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.dpr));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 5000);

// sky + sun
const sky = new Sky(); sky.scale.setScalar(4500); scene.add(sky);
const U = sky.material.uniforms; U.turbidity.value = 5; U.rayleigh.value = 1.4; U.mieCoefficient.value = 0.006; U.mieDirectionalG.value = 0.82;
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 13), THREE.MathUtils.degToRad(155));
U.sunPosition.value.copy(sunDir);
// image-based light from the same sky
const pmrem = new THREE.PMREMGenerator(renderer);
{ const s2 = new THREE.Scene(), sk2 = new Sky(); sk2.scale.setScalar(100); for (const k in U) sk2.material.uniforms[k].value = U[k].value; s2.add(sk2); scene.environment = pmrem.fromScene(s2, 0, 0.1, 200).texture; }
scene.environmentIntensity = 0.55;
const haze = new THREE.Color(0.66, 0.72, 0.8);
scene.fog = new THREE.FogExp2(haze, 0.0019);

const sun = new THREE.DirectionalLight(0xfff0dc, 3.2);
sun.castShadow = true; sun.shadow.mapSize.set(Q.shadow, Q.shadow);
const sc = sun.shadow.camera; sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 160;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 4;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x4a4030, 0.45));

// ---------------- materials ----------------
const T0 = performance.now();
const grassT = makeTex("grass", Q.tex), dirtT = makeTex("dirt", Q.tex), rockT = makeTex("rock", Q.tex);
const roughT = makeRough(Q.tex, grassT.H, dirtT.H, rockT.H);
const texMs = performance.now() - T0;

function terrainMaterial(rockOnly = false) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  m.customProgramCacheKey = () => (rockOnly ? "tri-rock" : "tri-ground");
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tGA: { value: grassT.albedo }, tGN: { value: grassT.normal }, tDA: { value: dirtT.albedo }, tDN: { value: dirtT.normal }, tRA: { value: rockT.albedo }, tRN: { value: rockT.normal }, tRough: { value: roughT } });
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWP; varying vec3 vWN;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
varying vec3 vWP; varying vec3 vWN;
uniform sampler2D tGA, tGN, tDA, tDN, tRA, tRN, tRough;
vec3 tri(sampler2D t, vec3 p, vec3 w) { return texture2D(t, p.zy).rgb * w.x + texture2D(t, p.xz).rgb * w.y + texture2D(t, p.xy).rgb * w.z; }
vec3 triN(sampler2D t, vec3 p, vec3 w, vec3 N) { // whiteout-blended triplanar normal map, world space
  vec3 s = sign(N);
  vec3 tx = texture2D(t, p.zy).xyz * 2.0 - 1.0, ty = texture2D(t, p.xz).xyz * 2.0 - 1.0, tz = texture2D(t, p.xy).xyz * 2.0 - 1.0;
  tx = vec3(tx.xy + N.zy, abs(tx.z) * N.x); ty = vec3(ty.xy + N.xz, abs(ty.z) * N.y); tz = vec3(tz.xy + N.xy, abs(tz.z) * N.z);
  return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
}
float W_ROCK, W_DIRT, W_SNOW; vec3 NW;`)
      .replace("#include <map_fragment>", `
  vec3 N0 = normalize(vWN);
  vec3 tw = pow(abs(N0), vec3(4.0)); tw /= (tw.x + tw.y + tw.z);
  float slope = 1.0 - N0.y;
  float macro = texture2D(tDA, vWP.xz / 211.0).g * 3.0 - 0.6 + texture2D(tGA, vWP.xz / 97.0).r * 1.2;
  W_ROCK = ${rockOnly ? "1.0" : "clamp(smoothstep(0.24, 0.42, slope) + smoothstep(70.0, 120.0, vWP.y) * 0.8, 0.0, 1.0)"};
  W_DIRT = ${rockOnly ? "0.0" : "clamp(smoothstep(0.55, 0.85, macro) + smoothstep(0.12, 0.24, slope) * 0.8, 0.0, 1.0) * (1.0 - W_ROCK)"};
  W_SNOW = ${rockOnly ? "0.0" : "smoothstep(105.0, 135.0, vWP.y + slope * -30.0) * (1.0 - smoothstep(0.5, 0.75, slope))"};
  vec2 g1 = vWP.xz / 3.5, g2 = vWP.xz / 13.0;
  vec3 aG = mix(texture2D(tGA, g1).rgb, texture2D(tGA, g2).rgb, 0.4);   // two scales hide tiling
  vec3 aD = texture2D(tDA, vWP.xz / 4.0).rgb;
  vec3 aR = tri(tRA, vWP / 6.0, tw);
  vec3 alb = mix(mix(aG, aD, W_DIRT), aR, W_ROCK);
  alb = mix(alb, vec3(0.86, 0.88, 0.92), W_SNOW);
  diffuseColor.rgb *= alb;
  vec3 nG = texture2D(tGN, g1).xyz * 2.0 - 1.0, nD = texture2D(tDN, vWP.xz / 4.0).xyz * 2.0 - 1.0;
  vec3 nGD = mix(nG, nD, W_DIRT); nGD = normalize(vec3(nGD.xy + N0.xz, abs(nGD.z) * N0.y)).xzy;
  NW = normalize(mix(nGD, triN(tRN, vWP / 6.0, tw, N0), W_ROCK));
  NW = normalize(mix(NW, N0, W_SNOW * 0.8));`)
      .replace("#include <roughnessmap_fragment>", `
  vec3 rr = texture2D(tRough, vWP.xz / 4.0).rgb;
  float roughnessFactor = mix(mix(rr.r, rr.g, W_DIRT), rr.b, W_ROCK);
  roughnessFactor = mix(roughnessFactor, 0.45, W_SNOW);`)
      .replace("#include <normal_fragment_maps>", "normal = normalize((viewMatrix * vec4(NW, 0.0)).xyz);");
  };
  return m;
}

// ---------------- terrain ----------------
const tg = new THREE.PlaneGeometry(1400, 1400, Q.seg, Q.seg); tg.rotateX(-Math.PI / 2);
{ const p = tg.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, H(p.getX(i), p.getZ(i))); tg.computeVertexNormals(); }
const terrain = new THREE.Mesh(tg, terrainMaterial()); terrain.receiveShadow = true; scene.add(terrain);
// a finer patch under the camera so the near ground isn't faceted
const ng = new THREE.PlaneGeometry(90, 90, LOW ? 90 : 180, LOW ? 90 : 180); ng.rotateX(-Math.PI / 2);
{ const p = ng.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, H(p.getX(i), p.getZ(i)) + 0.02); ng.computeVertexNormals(); }
const near = new THREE.Mesh(ng, terrain.material); near.receiveShadow = true; scene.add(near);

// ---------------- rocks ----------------
const rnd = (() => { let s = 1234567; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9 | 0) >>> 0) / 4294967296; })();
const rockMat = terrainMaterial(true);
const blockers = [];
for (let i = 0; i < 16; i++) {
  const g = new THREE.IcosahedronGeometry(1, 3), p = g.attributes.position, v = new THREE.Vector3(), sd = rnd() * 100;
  for (let k = 0; k < p.count; k++) { v.fromBufferAttribute(p, k); const n = fbm(v.x * 1.3 + sd, v.y * 1.3 + v.z * 0.7, 4, 0, 5); v.multiplyScalar(0.75 + n * 0.55); v.y *= 0.65; p.setXYZ(k, v.x, v.y, v.z); }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, rockMat), a = rnd() * 6.28, d = i < 5 ? 4 + rnd() * 9 : 10 + rnd() * 50, s = i < 5 ? 0.4 + rnd() * 0.8 : 0.8 + rnd() * 2.2;
  m.position.set(Math.cos(a) * d, 0, Math.sin(a) * d - 6); if (Math.abs(m.position.x) < 2.5 && m.position.z > -4 && m.position.z < 8) m.position.x += 5;
  m.position.y = H(m.position.x, m.position.z) - s * 0.15; m.scale.setScalar(s); m.rotation.y = rnd() * 6;
  m.castShadow = m.receiveShadow = true; scene.add(m); blockers.push({ x: m.position.x, z: m.position.z, r: s * 1.1 });
}

// ---------------- pines (instanced) ----------------
function mergeGeos(list) {
  const pos = [], nor = [], col = [];
  for (const [g0, c] of list) { const g = g0.index ? g0.toNonIndexed() : g0; g.computeVertexNormals(); pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b); }
  const o = new THREE.BufferGeometry(); o.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); o.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); o.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); return o;
}
const needle = new THREE.Color(0x1f3a22), needle2 = new THREE.Color(0x2c4a2a), bark = new THREE.Color(0x4a3426);
const parts = [[new THREE.CylinderGeometry(0.12, 0.2, 2.4, 7).translate(0, 1.2, 0), bark]];
for (let i = 0; i < 5; i++) { const r = 1.9 - i * 0.33, y = 1.6 + i * 1.15, cg = new THREE.ConeGeometry(r, 2.1, 9, 2, true); const p = cg.attributes.position; for (let k = 0; k < p.count; k++) { const yy = p.getY(k); if (yy < 0.9) { p.setX(k, p.getX(k) * (1 + (hash2(k, i) - 0.5) * 0.35)); p.setZ(k, p.getZ(k) * (1 + (hash2(i, k) - 0.5) * 0.35)); p.setY(k, yy - hash2(k, i, 3) * 0.25); } } parts.push([cg.translate(0, y, 0), i % 2 ? needle : needle2]); }
const pineG = mergeGeos(parts);
const pine = new THREE.InstancedMesh(pineG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide }), Q.trees);
pine.castShadow = pine.receiveShadow = true;
{ const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color(); let n = 0;
  for (let tries = 0; n < Q.trees && tries < 4000; tries++) {
    const x = (rnd() - 0.5) * 260, z = 30 - rnd() * 260;
    if (Math.hypot(x, z) < 11 || (Math.abs(x) < 7 && z > -2)) continue;
    const y = H(x, z), sl = Math.abs(H(x + 1, z) - H(x - 1, z)) + Math.abs(H(x, z + 1) - H(x, z - 1)); if (sl > 1.3 || y > 60) continue;
    const k = 0.7 + rnd() * 0.9; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28); s.set(k, k * (0.9 + rnd() * 0.3), k);
    M.compose(new THREE.Vector3(x, y - 0.1, z), q, s); pine.setMatrixAt(n, M); pine.setColorAt(n, c.setHSL(0.3 + rnd() * 0.04, 0.3, 0.45 + rnd() * 0.15)); n++; blockers.push({ x, z, r: 0.5 * k });
  }
  pine.count = n; }
scene.add(pine);

// ---------------- Kra ----------------
const kraPos = new THREE.Vector3(0, H(0, 0), 0);
let kra = null;
try {
  kra = new Caveman(scene);
  try { kra.update(1 / 60, { feet: kraPos, yaw: 0, pitch: 0, speed: 0, runFrac: 0, stance: "stand", eye: kraPos.clone().add(new THREE.Vector3(0, 1.6, 0)) }); } catch {}
  kra.root.position.copy(kraPos); kra.root.rotation.y = 0;
  kra.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
} catch (e) { // stand-in
  const g = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1, 6, 12), new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.9 }));
  g.position.copy(kraPos).add(new THREE.Vector3(0, 0.85, 0)); g.castShadow = true; scene.add(g);
}

// ---------------- grass (instanced blades, wind in the vertex shader) ----------------
{
  const seg = LOW ? 3 : 4, bw = 0.055, pos = [], col = [], nor = [], idx = [];
  for (let i = 0; i <= seg; i++) { const t = i / seg, w = bw * (1 - t * 0.92), bend = t * t * 0.18; pos.push(-w, t, bend, w, t, bend); const c = 0.4 + 0.45 * t; col.push(c, c, c, c, c, c); nor.push(0, 0.7, 0.7, 0, 0.7, 0.7); }
  for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); bg.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); bg.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); bg.setIndex(idx);
  const gm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const uTime = { value: 0 }; window.__grassTime = uTime;
  gm.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0.0, 1.0, 0.0);") // blades shade like the ground beneath: no dark flicker
      .replace("#include <project_vertex>", `
  vec4 mvPosition = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
    vec3 o = instanceMatrix[3].xyz;
  #else
    vec3 o = vec3(0.0);
  #endif
  float hh = position.y;
  float gust = sin(uTime * 0.7 + o.x * 0.05 + o.z * 0.03) * 0.5 + 0.5;
  float w = (sin(uTime * 1.9 + o.x * 0.35 + o.z * 0.21) * 0.5 + sin(uTime * 3.3 + o.x * 1.1 - o.z * 0.7) * 0.2 + 0.45) * (0.4 + gust);
  mvPosition.xz += vec2(0.9, 0.45) * w * hh * hh * 0.3;
  mvPosition.y -= w * w * hh * hh * 0.04;
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;`);
  };
  const grass = new THREE.InstancedMesh(bg, gm, Q.grass);
  grass.receiveShadow = true; grass.frustumCulled = false;
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  let n = 0;
  for (let tries = 0; n < Q.grass && tries < Q.grass * 3; tries++) {
    const a = rnd() * 6.283, r = Math.sqrt(rnd()) * Q.grassR, x = Math.cos(a) * r, z = Math.sin(a) * r - Q.grassR * 0.35;
    if (Math.abs(x) < 0.45 && Math.abs(z) < 0.45) continue;
    if (blockers.some((b) => Math.hypot(b.x - x, b.z - z) < b.r)) continue;
    const y = H(x, z), sl = Math.abs(H(x + 0.5, z) - H(x - 0.5, z)) + Math.abs(H(x, z + 0.5) - H(x, z - 0.5)); if (sl > 0.45) continue;
    const patch = fbm(x * 0.12, z * 0.12, 3, 0, 77); if (patch < 0.32 && rnd() < 0.7) continue; // bare patches
    const h = (0.16 + rnd() * 0.3) * (0.6 + patch * 0.8);
    q.setFromAxisAngle(up, rnd() * 6.283); s.set(1, h, 1); M.compose(new THREE.Vector3(x, y - 0.02, z), q, s);
    grass.setMatrixAt(n, M); grass.setColorAt(n, c.setRGB(0.22 + rnd() * 0.12 + patch * 0.08, 0.36 + rnd() * 0.12, 0.08 + rnd() * 0.05)); n++;
  }
  grass.count = n; window.__grassCount = n;
  scene.add(grass);
}

// ---------------- post ----------------
let composer = null;
if (Q.post) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.5, 0.92));
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null }, amt: { value: 0.32 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform sampler2D tDiffuse; uniform float amt; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5; c.rgb *= 1.0 - amt * smoothstep(0.25, 0.85, dot(d, d) * 2.2); gl_FragColor = c; }",
  }));
  composer.addPass(new OutputPass());
}

// ---------------- orbit camera (mouse + touch) ----------------
const cam = { theta: 0.0, phi: 1.3, r: 6, target: kraPos.clone().add(new THREE.Vector3(0, 1.35, 0)) };
if (URLP.has("theta")) cam.theta = +URLP.get("theta");
const pts = new Map(); let pinch0 = 0;
renderer.domElement.addEventListener("pointerdown", (e) => { renderer.domElement.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); } });
renderer.domElement.addEventListener("pointermove", (e) => {
  const p = pts.get(e.pointerId); if (!p) return;
  if (pts.size === 1) { cam.theta -= (e.clientX - p.x) * 0.006; cam.phi = Math.min(1.55, Math.max(0.55, cam.phi - (e.clientY - p.y) * 0.005)); }
  p.x = e.clientX; p.y = e.clientY;
  if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0) cam.r = Math.min(30, Math.max(2.5, cam.r * pinch0 / d)); pinch0 = d; }
});
const up = (e) => { pts.delete(e.pointerId); pinch0 = 0; };
renderer.domElement.addEventListener("pointerup", up); renderer.domElement.addEventListener("pointercancel", up);
renderer.domElement.addEventListener("wheel", (e) => { e.preventDefault(); cam.r = Math.min(30, Math.max(2.5, cam.r * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: false });
function placeCamera() {
  const off = new THREE.Vector3().setFromSphericalCoords(cam.r, cam.phi, cam.theta);
  camera.position.copy(cam.target).add(off);
  const g = H(camera.position.x, camera.position.z) + 0.4; if (camera.position.y < g) camera.position.y = g;
  const fwd = new THREE.Vector3(-off.x, 0, -off.z).normalize(); // aim a little past Kra so the sky and mountains stay in frame
  camera.lookAt(cam.target.x + fwd.x * 6, cam.target.y + 0.6, cam.target.z + fwd.z * 6);
  // shadow frustum follows Kra, sun from the sky's sun direction
  sun.position.copy(kraPos).addScaledVector(sunDir, 80); sun.target.position.copy(kraPos);
}
addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer?.setSize(innerWidth, innerHeight); });

// ---------------- loop + fps ----------------
const fpsEl = document.getElementById("fps"); let frames = 0, acc = 0, last = performance.now();
window.__sample = { ready: false, fps: 0, texMs: Math.round(texMs), grass: () => window.__grassCount, low: LOW };
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  window.__grassTime.value = now / 1000;
  placeCamera();
  if (composer) composer.render(); else renderer.render(scene, camera);
  frames++; acc += dt;
  if (acc > 1) { window.__sample.fps = Math.round(frames / acc); fpsEl.textContent = `${window.__sample.fps} fps · ${window.__grassCount.toLocaleString()} grass blades`; frames = 0; acc = 0; }
  window.__sample.ready = true;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
