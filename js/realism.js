import * as THREE from "three";
/**
 * Round 14: "less cartoonish" surfaces without textures to download. addDetail() patches a Lambert /
 * Standard material so its flat or vertex colours pick up world-space procedural detail:
 *   - fbm value noise (3 octaves) varies the albedo (dirt, lichen, bark, skin blotches),
 *   - colours are desaturated toward natural tones,
 *   - large-scale low noise darkens hollows (cheap ambient-occlusion stand-in),
 *   - High quality only: a derivative bump from the same noise (normal detail), faded with distance.
 * World-space mapping means no UVs, so no stretching or streaks on any slope.
 * Graphics quality (Low / High) is saved in localStorage; phones default to Low.
 */
const KEY = "fota-gfx";
const isTouch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
let quality = (() => { try { return localStorage.getItem(KEY) || (isTouch ? "low" : "high"); } catch { return isTouch ? "low" : "high"; } })();
const patched = new Set();

export function gfxQuality() { return quality; }
export function setGfxQuality(q) {
  quality = q === "high" ? "high" : "low";
  try { localStorage.setItem(KEY, quality); } catch {}
  for (const m of patched) { m.needsUpdate = true; }
  return quality;
}

const NOISE = /* glsl */ `
varying vec3 vRWPos;
float rHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float rNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rHash(i), rHash(i + vec3(1, 0, 0)), f.x), mix(rHash(i + vec3(0, 1, 0)), rHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(rHash(i + vec3(0, 0, 1)), rHash(i + vec3(1, 0, 1)), f.x), mix(rHash(i + vec3(0, 1, 1)), rHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float rFbm(vec3 p) {
  #ifdef R_HQ
  return rNoise(p) * 0.55 + rNoise(p * 2.13 + 7.1) * 0.3 + rNoise(p * 4.7 + 3.3) * 0.15;
  #else
  return rNoise(p) * 0.62 + rNoise(p * 2.13 + 7.1) * 0.38; // Low: two octaves (phones)
  #endif
}
`;

/**
 * opts: scale (noise frequency per metre), amt (albedo variation 0..1), sat (kept saturation 0..1),
 * ao (hollow darkening 0..1), bump (normal strength, High only), tint (optional [r,g,b] multiplier).
 */
export function addDetail(mat, opts = {}) {
  const o = { scale: 1, amt: 0.3, sat: 0.8, ao: 0.2, bump: 0.6, tint: null, ...opts };
  const prev = mat.onBeforeCompile;
  const prevKey = prev && prev !== THREE_NOOP ? String(prev) : "";
  const key = `rd:${o.scale}:${o.amt}:${o.sat}:${o.ao}:${o.bump}:${o.tint}`;
  mat.onBeforeCompile = function (sh, r) {
    if (prev) prev.call(this, sh, r);
    const bump = quality === "high" && o.bump > 0;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vRWPos;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        { vec4 rwp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            rwp = instanceMatrix * rwp;
          #endif
          vRWPos = (modelMatrix * rwp).xyz; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\n" + (quality === "high" ? "#define R_HQ\n" : "") + NOISE)
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec3 rp = vRWPos * ${o.scale.toFixed(3)};
        float rn = rFbm(rp);
        float rl = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(vec3(rl), diffuseColor.rgb, ${o.sat.toFixed(3)});
        diffuseColor.rgb *= mix(${(1 - o.amt).toFixed(3)}, ${(1 + o.amt * 0.85).toFixed(3)}, rn);
        diffuseColor.rgb *= mix(${(1 - o.ao).toFixed(3)}, 1.0, smoothstep(0.2, 0.65, rNoise(rp * 0.31 + 1.7)));
        ${o.tint ? `diffuseColor.rgb *= vec3(${o.tint.map((v) => v.toFixed(3)).join(",")});` : ""}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        ${bump ? `{
          float rh = (rn + rNoise(rp * 2.7) * 0.25) * ${o.bump.toFixed(3)} * (1.0 - smoothstep(8.0, 30.0, length(vViewPosition)));
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1);
          vec3 g = sign(det) * (dFdx(rh) * r1 + dFdy(rh) * r2);
          normal = normalize(abs(det) * normal - g);
        }` : ""}`);
  };
  mat.customProgramCacheKey = () => prevKey + key + ":" + quality;
  patched.add(mat);
  mat.needsUpdate = true;
  return mat;
}
const THREE_NOOP = null;

/**
 * Round 14: smooth (averaged) normals across coincident vertices, so primitives built from boxes /
 * low cylinders shade like rounded, organic forms. Topology is unchanged (cheap, done once at load).
 * Optional crease angle: faces meeting sharper than this keep their own normal.
 */
export function smoothNormals(geo, crease = 70) {
  if (!geo || !geo.attributes || !geo.attributes.position || geo.userData?.smoothed) return geo;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const pos = geo.attributes.position, nor = geo.attributes.normal, n = pos.count;
  const cosC = Math.cos((crease * Math.PI) / 180);
  const groups = new Map();
  const q = (v) => Math.round(v * 1e4);
  for (let i = 0; i < n; i++) {
    const k = q(pos.getX(i)) + "," + q(pos.getY(i)) + "," + q(pos.getZ(i));
    let g = groups.get(k); if (!g) groups.set(k, (g = [])); g.push(i);
  }
  const out = new Float32Array(n * 3);
  for (const g of groups.values()) {
    for (const i of g) {
      const ax = nor.getX(i), ay = nor.getY(i), az = nor.getZ(i);
      let sx = 0, sy = 0, sz = 0;
      for (const j of g) { const bx = nor.getX(j), by = nor.getY(j), bz = nor.getZ(j); if (ax * bx + ay * by + az * bz >= cosC) { sx += bx; sy += by; sz += bz; } }
      const l = Math.hypot(sx, sy, sz) || 1;
      out[i * 3] = sx / l; out[i * 3 + 1] = sy / l; out[i * 3 + 2] = sz / l;
    }
  }
  geo.setAttribute("normal", new THREE.BufferAttribute(out, 3));
  geo.userData.smoothed = true;
  return geo;
}
/** Smooth every mesh under root (skips sprites / points / shader-material effects). */
export function smoothTree(root, crease = 70) {
  root?.traverse?.((o) => { if (o.isMesh && !o.material?.isShaderMaterial && !o.material?.isMeshBasicMaterial) smoothNormals(o.geometry, crease); });
}
