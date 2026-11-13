/** Build a rocky passage mesh from centerline + LRUD data. */

import * as THREE from "three";
import { stationMap, stationWorld, neighborsOf } from "./cave-data.js";
import { fbm3, mulberry32, randRange, clamp } from "./rng.js";

const RADIAL = 16;
const RADIAL_HALL = 30;

/**
 * Round 27: halls are irregular, not domes. A hall station may carry `irr` (0..1) and `roofPhase`:
 * the footprint bulges outward (never inward: the walk area stays inside the rock) by azimuth, and
 * the roof sags in broad lobes and is flatter on top. Both the hall's own rock (hub) and the
 * "is this point inside the hall?" test use these, so neighbouring pieces cut it consistently.
 */
const HALL_MACRO = 0.75; // round 27: was 1.1 (walls up to +55% off the nominal hall: mouths ended up inside rock)
export function hallBulge(irr, ph, az) {
  return 1 + irr * 0.32 * (0.5 + 0.5 * Math.sin(3 * az + ph * 1.7)) * (0.6 + 0.4 * Math.sin(az * 5 + ph));
}
export function hallRoof(irr, ph, az, rad) {
  // rad: 0 at the centre .. 1 at the wall. Broad sags (two lobes) deepest part-way out.
  const sag = (0.5 + 0.5 * Math.sin(2 * az + ph)) * (0.55 + 0.45 * Math.sin(az * 3 - ph * 0.7));
  return 1 - irr * 0.55 * sag * Math.min(1, 0.35 + rad * 1.2);
}

// Periodic 2D value noise so the rock texture tiles without seams.
function phash(ix, iy, period) {
  ix = ((ix % period) + period) % period;
  iy = ((iy % period) + period) % period;
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + 1013904223;
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function pnoise(x, y, period) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = phash(ix, iy, period), b = phash(ix + 1, iy, period);
  const c = phash(ix, iy + 1, period), d = phash(ix + 1, iy + 1, period);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function pfbm(u, v, base, oct) {
  let sum = 0, amp = 0.5, f = base;
  for (let i = 0; i < oct; i++) {
    sum += amp * pnoise(u * f, v * f, f);
    f *= 2;
    amp *= 0.5;
  }
  return sum / (1 - Math.pow(0.5, oct));
}

/** Tileable limestone: mottled base, cracks, speckle. Luminance doubles as bump height. */
function makeRockTexture() {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const base = pfbm(u, v, 4, 5);
      const fine = pfbm(u + 0.31, v + 0.17, 32, 3);
      // Ridged noise -> thin dark cracks.
      const rn = pfbm(u + 0.5, v + 0.5, 6, 4);
      const crack = Math.pow(1 - Math.min(1, Math.abs(rn - 0.5) * 26), 3);
      const lump = pfbm(u + 0.7, v + 0.2, 2, 3);
      let l = 0.42 + (base - 0.5) * 0.55 + (fine - 0.5) * 0.28 + (lump - 0.5) * 0.3 - crack * 0.07;
      l = Math.max(0.05, Math.min(1, l));
      const warm = (lump - 0.5) * 0.12;
      const i = (y * size + x) * 4;
      d[i] = 255 * Math.min(1, l * (1.02 + warm));
      d[i + 1] = 255 * Math.min(1, l * 0.96);
      d[i + 2] = 255 * Math.min(1, l * (0.88 - warm));
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

let sharedTexture = null;
let sharedEnv = null;
let wallMat = null;
let formMat = null;

function makeCaveEnv() {
  const cols = ["#241c14", "#1a1612", "#2e261c", "#0c0a08", "#3a3226", "#14110e"];
  const images = cols.map((col, idx) => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 32;
    const ctx = cv.getContext("2d");
    const g = ctx.createRadialGradient(18, 12, 2, 16, 16, 22);
    g.addColorStop(0, idx === 4 ? "#6a5a40" : "#2a2418");
    g.addColorStop(1, col);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    return cv;
  });
  const tex = new THREE.CubeTexture(images);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ensureMaps() {
  if (!sharedTexture) sharedTexture = makeRockTexture();
  if (!sharedEnv) sharedEnv = makeCaveEnv();
}

/**
 * World-space triplanar rock: no UV stretching on floors or big halls, a second
 * coarse layer to break tiling, mud on floors, wet glossy patches, and bump from
 * the texture height (screen-space derivatives, no tangents needed).
 */
function addTriplanar(mat, { scale = 0.42, bump = 0.45, mud = 0.55, wetness = 1 } = {}) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTriScale = { value: scale };
    shader.uniforms.uBump = { value: bump };
    shader.uniforms.uMud = { value: mud };
    shader.uniforms.uWet = { value: wetness };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNrm;\nattribute float aBake;\nvarying float vBake;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        {
          vec4 tp = vec4(transformed, 1.0);
          mat3 im = mat3(1.0);
          #ifdef USE_INSTANCING
            tp = instanceMatrix * tp;
            im = mat3(instanceMatrix);
          #endif
          vTriPos = (modelMatrix * tp).xyz;
          vTriNrm = normalize(mat3(modelMatrix) * im * objectNormal);
          vBake = aBake;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNrm;\nvarying float vBake;\nuniform float uTriScale;\nuniform float uBump;\nuniform float uMud;\nuniform float uWet;",
      )
      .replace(
        "#include <map_fragment>",
        `vec3 triN = normalize(vTriNrm);
        vec3 bw = pow(abs(triN), vec3(4.0));
        bw /= (bw.x + bw.y + bw.z);
        vec3 tp1 = vTriPos * uTriScale;
        vec4 t1 = texture2D(map, tp1.zy) * bw.x + texture2D(map, tp1.xz) * bw.y + texture2D(map, tp1.xy) * bw.z;
        vec3 tp2 = vTriPos * (uTriScale * 0.21) + vec3(0.37, 0.11, 0.53);
        vec4 t2 = texture2D(map, tp2.zy) * bw.x + texture2D(map, tp2.xz) * bw.y + texture2D(map, tp2.xy) * bw.z;
        // Far away (huge rooms), swap the fine layer for an even coarser one so tiling never shows.
        float farMix = smoothstep(7.0, 32.0, length(vViewPosition));
        vec3 tp3 = vTriPos * (uTriScale * 0.043) + vec3(0.71, 0.29, 0.13);
        vec4 t3 = texture2D(map, tp3.zy) * bw.x + texture2D(map, tp3.xz) * bw.y + texture2D(map, tp3.xy) * bw.z;
        vec4 fineL = mix(t1, t2, farMix);
        vec4 coarseL = mix(t2, t3, farMix);
        float triH = dot(fineL.rgb, vec3(0.333)) * 0.45 + dot(coarseL.rgb, vec3(0.333)) * 0.55;
        vec3 rockCol = fineL.rgb * (0.6 + 1.0 * coarseL.rgb);
        float floorness = smoothstep(0.5, 0.88, triN.y) * uMud;
        float wet = smoothstep(0.30, 0.48, coarseL.g) * uWet;
        // Ochre/iron and dark manganese staining from the coarse layer.
        rockCol = mix(rockCol, rockCol * vec3(1.25, 0.86, 0.6), smoothstep(0.35, 0.6, coarseL.r) * 0.45);
        vec3 mudCol = vec3(0.30, 0.22, 0.15) * (0.55 + 0.9 * t1.r);
        rockCol = mix(rockCol, mudCol, floorness * 0.7);
        rockCol *= mix(1.0, 0.62, wet * 0.75);
        diffuseColor.rgb *= rockCol * 1.3;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `float roughnessFactor = roughness + (triH - 0.45) * 0.35;
        roughnessFactor = mix(roughnessFactor, 0.16, max(wet * 0.9, floorness * 0.4));
        roughnessFactor = clamp(roughnessFactor, 0.1, 1.0);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        // Baked electric show-cave lighting (warm), zero in wild caves.
        totalEmissiveRadiance += diffuseColor.rgb * vBake * vec3(1.0, 0.8, 0.58) * 0.75;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        {
          vec3 sp = -vViewPosition;
          vec3 dpx = dFdx(sp);
          vec3 dpy = dFdy(sp);
          vec3 r1 = cross(dpy, normal);
          vec3 r2 = cross(normal, dpx);
          float det = dot(dpx, r1) * faceDirection;
          vec2 dH = vec2(dFdx(triH), dFdy(triH)) * uBump * (1.0 - wet * 0.5);
          vec3 g = sign(det) * (dH.x * r1 + dH.y * r2);
          normal = normalize(abs(det) * normal - g);
        }`,
      );
  };
  mat.customProgramCacheKey = () => `tri-${scale}-${bump}-${mud}`;
  return mat;
}

let backMat = null;
function backfillMaterial() {
  if (!backMat) {
    // Lit like rock (round 9): where passages overlap and a tube is clipped, you look at the other
    // tube's outer face; drawn dark-unlit it showed as black holes / shards under the brighter torch.
    ensureMaps();
    backMat = addTriplanar(new THREE.MeshStandardMaterial({
      map: sharedTexture, color: 0xa89a86, roughness: 0.85, metalness: 0.02,
      vertexColors: true, side: THREE.BackSide, depthWrite: false,
    }));
  }
  return backMat;
}

export function rockMaterial() {
  ensureMaps();
  if (wallMat) return wallMat;
  wallMat = addTriplanar(new THREE.MeshStandardMaterial({
    map: sharedTexture,
    color: 0xd2c4ae,
    roughness: 0.78,
    metalness: 0.04,
    envMap: sharedEnv,
    envMapIntensity: 0.5,
    vertexColors: true,
  }));
  return wallMat;
}

export function formationMaterial() {
  ensureMaps();
  if (formMat) return formMat;
  formMat = addTriplanar(new THREE.MeshStandardMaterial({
    map: sharedTexture,
    color: 0xcfc0a8,
    roughness: 0.5,
    metalness: 0.05,
    envMap: sharedEnv,
    envMapIntensity: 0.6,
  }), { scale: 0.9, bump: 0.5, mud: 0.15, wetness: 1.3 });
  return formMat;
}

function tangentAt(station, nbrs, smap, fallback) {
  const t = new THREE.Vector3();
  const p = stationWorld(station);
  const ids = nbrs.get(station.id) || [];
  if (!ids.length) return fallback.clone().normalize();
  for (const id of ids) {
    const q = stationWorld(smap.get(id));
    t.x += q.x - p.x;
    t.y += q.y - p.y;
    t.z += q.z - p.z;
  }
  if (t.lengthSq() < 1e-8) return fallback.clone().normalize();
  return t.normalize();
}

function makeFrame(tangent, upHint = new THREE.Vector3(0, 1, 0)) {
  const f = tangent.clone().normalize();
  let up = upHint.clone();
  if (Math.abs(f.dot(up)) > 0.92) up = new THREE.Vector3(1, 0, 0);
  const right = new THREE.Vector3().crossVectors(up, f).normalize();
  up = new THREE.Vector3().crossVectors(f, right).normalize();
  return { f, r: right, u: up };
}

/**
 * Point on an irregular LRUD cross-section, angle 0 = right, pi/2 = up.
 * Noise is sampled at the surface point's world position (not the centerline),
 * so walls are lumpy around the ring and neighbouring tubes share the same rock.
 * `hall` (0..1) makes the section boxier with big outward lumps and ceiling pockets.
 */
function sectionPoint(left, right, up, down, angle, pos, fr, roughness = 1, hall = 0, fs = 1) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const rx = c >= 0 ? right : left;
  const ry = s >= 0 ? up : down;
  // Superellipse: halls get steeper walls and a flatter, broken ceiling instead of a dome.
  const pw = 1 - 0.32 * hall;
  let x = rx * Math.sign(c) * Math.pow(Math.abs(c), pw);
  let y = ry * Math.sign(s) * Math.pow(Math.abs(s), pw);
  // Flatten the floor slightly so it's walkable.
  if (s < -0.35) {
    const t = clamp((-s - 0.35) / 0.65, 0, 1);
    y = lerp(y, -down, t * 0.55);
  }
  const wx = pos.x + fr.r.x * x + fr.u.x * y;
  const wy = pos.y + fr.r.y * x + fr.u.y * y;
  const wz = pos.z + fr.r.z * x + fr.u.z * y;
  const n =
    (fbm3(wx * 0.45 * fs, wy * 0.45 * fs, wz * 0.45 * fs, 4) - 0.5) * 0.34 * roughness +
    (fbm3(wx * 1.6 * fs + 9, wy * 1.6 * fs, wz * 1.6 * fs, 3) - 0.5) * 0.12 * roughness;
  // Less noise on the floor, almost none along the walking line.
  const floorScale = s < -0.85 ? 0.08 : s < -0.2 ? 0.25 : 1;
  // Walls bulge mostly outward (lumps stay, but rock never pinches inside the walkable LRUD
  // envelope the collision uses, so what you see and what stops you agree).
  let k = 1 + (s < -0.2 ? n * floorScale : Math.max(-0.04, n * 0.6 + 0.1));
  if (hall > 0 && s > -0.2) {
    // Large, low-frequency lumps: alcoves, buttresses, ceiling pockets and slabs.
    const hf = Math.min(1, fs * 3);
    const big = fbm3(wx * 0.11 * hf + 31, wy * 0.11 * hf, wz * 0.11 * hf - 7, 3) - 0.5;
    const mid = fbm3(wx * 0.3 * hf - 5, wy * 0.3 * hf + 2, wz * 0.3 * hf, 3) - 0.5;
    let lump = big * 1.1 + mid * 0.35;
    const ceilingish = clamp(s, 0, 1);
    // Walls only bulge outward (never into the walkable area); tall ceilings may sag.
    const inward = ceilingish * clamp((ry - 3.5) / 3, 0, 1) * 0.28;
    lump = Math.max(lump, -0.04 - inward);
    k += lump * hall;
    // Breakdown blocks: stepped ledges on the upper walls.
    if (s > 0.15) {
      const step = Math.floor(fbm3(wx * 0.18 * hf, wy * 0.5 * hf, wz * 0.18 * hf, 2) * 5) / 5;
      k += (step - 0.5) * 0.12 * hall * ceilingish;
    }
  }
  return { x: x * k, y: y * k };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function vertColor(wx, wy, wz, kind) {
  const n = fbm3(wx * 0.15 + 3, wy * 0.15, wz * 0.15, 3);
  const band = fbm3(wx * 0.05, wy * 0.9, wz * 0.05, 2); // horizontal strata
  const damp = 0.68 + n * 0.38;
  let r = 0.62 * damp;
  let g = 0.56 * damp;
  let b = 0.49 * damp;
  // Iron-stained strata vs grey limestone beds.
  const iron = clamp((band - 0.52) * 4, 0, 1);
  const grey = clamp((0.42 - band) * 4, 0, 1);
  r += iron * 0.12 - grey * 0.04;
  g += iron * 0.02 - grey * 0.01;
  b += -iron * 0.06 + grey * 0.03;
  if (kind === "chamber" || kind === "cavern") {
    r += 0.03;
    g += 0.01;
  }
  return new THREE.Color(r, g, b);
}

/**
 * Split the cave walls into independent, deterministic pieces: one tube per leg and one rock
 * hub per junction / bend / dead end. Every vertex comes from world-space noise, so a piece
 * built alone is bit-identical to the same piece built inside a whole-cave mesh: chunks that
 * group different pieces always meet seamlessly (tubes overlap at stations; hubs fill wedges).
 * Preparing is cheap (frames, dims); the heavy vertex work runs only when a piece is emitted.
 */
export function prepareCavePieces(cave) {
  const smap = stationMap(cave);
  const nbrs = neighborsOf(cave);
  const degree = (id) => (nbrs.get(id) || []).length;
  const legInfos = [];
  const pieces = [];

  function legDims(L, t) {
    const { a, b } = L;
    // Hold a cavern's full width/height along most of the leg so it reads as a hall, not a bulge.
    let u = t;
    let aCave = a.kind === "cavern";
    let bCave = b.kind === "cavern";
    // Round 27: a modular hall mouth (hall -> portal station) is a plain passage tube that pokes
    // through the hall wall; the two surfaces cross instead of a hall-sized funnel full of gaps.
    if (aCave && b.module === "mouth") { aCave = false; u = 1; }
    else if (bCave && a.module === "mouth") { bCave = false; u = 0; }
    else if (bCave && !aCave) u = smoothstep(0.12, 0.52, t);
    else if (aCave && !bCave) u = smoothstep(0.48, 0.88, t);
    // Slight flare at multi-way stations so overlapping tubes hide the seam.
    const flare = lerp(degree(a.id) >= 3 ? 1.12 : 1, degree(b.id) >= 3 ? 1.12 : 1, t);
    return {
      left: lerp(a.left, b.left, u) * flare,
      right: lerp(a.right, b.right, u) * flare,
      up: lerp(a.up, b.up, u) * flare,
      down: lerp(a.down, b.down, u) * flare,
      hall: lerp(aCave ? 1 : 0, bCave ? 1 : 0, u),
    };
  }

  // Big halls (cavern stations): anything else's wall that falls inside one is dropped, so legs
  // and small hubs swallowed by a hall don't leave free-standing rock skins in the room.
  const halls = cave.stations.filter((st) => st.kind === "cavern").map((st) => {
    const p = stationWorld(st);
    const hh = Math.min(1, 3 / Math.max(1, Math.max(st.left, st.right, st.up) / 3));
    return { id: st.id, x: p.x, y: p.y, z: p.z, R: Math.max(st.left, st.right) * 0.98, up: st.up, down: st.down, irr: st.irr || 0, ph: st.roofPhase || 0, hh };
  });
  // Round 27: the hall hub's big macro-noise (k up to +55%) moved its real wall far from the nominal
  // ellipsoid insideHall tested, so cuts missed (stubs of tube inside halls) or overshot (holes).
  // Same noise, sampled at the nominal wall point in that direction.
  function hallMacro(H, x, y, z) {
    const az = Math.atan2(z - H.z, x - H.x);
    const b = H.irr ? hallBulge(H.irr, H.ph, az) : 1;
    const wx = H.x + Math.cos(az) * H.R * b, wz = H.z + Math.sin(az) * H.R * b;
    if (y < H.y - H.down * 0.2) return 1;
    return 1 + Math.max(-0.04, (fbm3(wx * 0.11 * H.hh + 31, y * 0.11 * H.hh, wz * 0.11 * H.hh - 7, 3) - 0.5) * HALL_MACRO);
  }
  function insideHall(x, y, z, skipId = null, shrink = 0.92) {
    for (const H of halls) {
      if (H.id === skipId) continue;
      const az = Math.atan2(z - H.z, x - H.x);
      const dr = Math.hypot(x - H.x, z - H.z);
      if (dr > H.R * 2.2) continue;
      const mk = hallMacro(H, x, y, z);
      const d = dr / (H.R * shrink * (H.irr ? hallBulge(H.irr, H.ph, az) : 1) * mk);
      if (d >= 1) continue;
      if (y < H.y - H.down * 0.9 - 0.3) continue;
      const roof = H.irr ? Math.pow(Math.sqrt(1 - d * d), 0.75) * hallRoof(H.irr, H.ph, az, d) : Math.sqrt(1 - d * d);
      if (y > H.y + H.up * 0.93 * shrink * roof * mk) continue;
      return true;
    }
    return false;
  }

  for (const leg of cave.legs) {
    const a = smap.get(leg.from);
    const b = smap.get(leg.to);
    if (!a || !b) continue;
    const pa = stationWorld(a);
    const pb = stationWorld(b);
    const va = new THREE.Vector3(pa.x, pa.y, pa.z);
    const vb = new THREE.Vector3(pb.x, pb.y, pb.z);
    const len = va.distanceTo(vb);
    const dimMax = Math.max(a.left, a.right, a.up, b.left, b.right, b.up);
    const legDir = vb.clone().sub(va).normalize();
    const fr = makeFrame(legDir);
    const L = { a, b, va, vb, len, dir: legDir, fr };
    legInfos.push(L);
    pieces.push({
      kind: "leg", id: `${a.id}-${b.id}`, stations: [a.id, b.id],
      x: (va.x + vb.x) / 2, y: (va.y + vb.y) / 2, z: (va.z + vb.z) / 2,
      radius: len / 2 + dimMax,
      // Generator: yields between rings so a huge hall tube never blocks a frame.
      *emit(buf) {
        // Ring spacing and noise frequency scale with passage size, so a 70 m hall is
        // as smooth-but-lumpy as a 2 m crawl and doesn't explode the vertex count.
        const segs = Math.max(4, Math.ceil(len / Math.min(5, Math.max(0.6, dimMax * 0.1))));
        const fs = 1 / Math.max(1, dimMax / 3);
        const radial = (a.kind === "cavern" || b.kind === "cavern")
          ? Math.max(RADIAL_HALL, Math.min(64, Math.round(dimMax * 1.3)))
          : Math.max(RADIAL, Math.min(40, Math.round(dimMax * 1.6)));
        const rings = [], inOther = [];
        const legBase = buf.count();
        const pos = new THREE.Vector3();
        const floorHall = a.kind === "cavern" ? a.id : b.kind === "cavern" ? b.id : null;
        // Legs meeting this one at a station: where this tube's wall runs inside one of them
        // (junction overlap) it would stand across the other passage as a visible, walk-through
        // wall. Those triangles are dropped, like a hub's.
        // Any other leg whose tube overlaps this one (incident at a junction, or a passage that
        // merely crosses / grazes this one): test by bounding spheres first.
        const cx0 = (va.x + vb.x) / 2, cy0 = (va.y + vb.y) / 2, cz0 = (va.z + vb.z) / 2, R0 = len / 2 + dimMax * 1.4;
        const others = legInfos.filter((O) => {
          if (O === L) return false;
          const oR = O.len / 2 + Math.max(O.a.left, O.a.right, O.a.up, O.b.left, O.b.right, O.b.up) * 1.4;
          return Math.hypot((O.va.x + O.vb.x) / 2 - cx0, (O.va.y + O.vb.y) / 2 - cy0, (O.va.z + O.vb.z) / 2 - cz0) < R0 + oR;
        });
        const legInside = (x, y, z, floorPart) => {
          // A leg from a hall's own station keeps its floor inside the hall: a rock ramp up to the mouth.
          if (halls.length && insideHall(x, y, z, floorPart ? floorHall : null)) return true;
          for (const O of others) if (insideLeg(O, x, y, z, 0.86)) return true; // round 9: was 0.99 -> seam holes; now walls overlap a little
          return false;
        };
        for (let i = 0; i <= segs; i++) {
          const t = i / segs;
          pos.copy(va).lerp(vb, t);
          const dm = legDims(L, t);
          const kind = t < 0.5 ? a.kind : b.kind;
          const ring = [];
          for (let k = 0; k < radial; k++) {
            const ang = (k / radial) * Math.PI * 2;
            const p = sectionPoint(dm.left, dm.right, dm.up, dm.down, ang, pos, fr, 1, dm.hall, fs);
            const x = pos.x + fr.r.x * p.x + fr.u.x * p.y;
            const y = pos.y + fr.r.y * p.x + fr.u.y * p.y;
            const z = pos.z + fr.r.z * p.x + fr.u.z * p.y;
            ring.push(buf.vertex(x, y, z, k / radial, t, vertColor(x, y, z, kind)));
            // A leg from a hall's own station keeps its floor inside the hall: a rock ramp up to the mouth.
            const floorPart = Math.sin(ang) < -0.3;
            inOther.push(legInside(x, y, z, floorPart));
          }
          rings.push(ring);
          if ((i + 1) % Math.max(1, Math.floor(700 / radial)) === 0) yield;
        }
        const tris = [];
        for (let i = 0; i < segs; i++) {
          const o0 = i * radial, o1 = (i + 1) * radial;
          for (let k = 0; k < radial; k++) {
            const k2 = (k + 1) % radial;
            tris.push([o0 + k, o1 + k, o1 + k2], [o0 + k, o1 + k2, o0 + k2]);
          }
        }
        snapCut(buf, legBase, inOther, tris, (li, x, y, z) => legInside(x, y, z, Math.sin(((li % radial) / radial) * Math.PI * 2) < -0.3));
      },
    });
  }

  /** Is a world point inside a leg tube (smooth LRUD ellipse, no noise)? */
  function insideLeg(L, x, y, z, shrink, noBulge = false) {
    const dx = x - L.va.x, dy = y - L.va.y, dz = z - L.va.z;
    const along = dx * L.dir.x + dy * L.dir.y + dz * L.dir.z;
    const t = along / L.len;
    if (t < 0 || t > 1) return false;
    const cx = L.va.x + L.dir.x * along, cy = L.va.y + L.dir.y * along, cz = L.va.z + L.dir.z * along;
    const lx = (x - cx) * L.fr.r.x + (y - cy) * L.fr.r.y + (z - cz) * L.fr.r.z;
    const ly = (x - cx) * L.fr.u.x + (y - cy) * L.fr.u.y + (z - cz) * L.fr.u.z;
    const dm = legDims(L, t);
    // Hall walls only bulge outward (up to ~50%), so test hall tubes generously.
    // Over-dropping hub triangles inside a tube's length is safe: the tube wall hides them.
    const sh = shrink * (noBulge ? 1 : 1 + 0.3 * dm.hall);
    const rx = (lx >= 0 ? dm.right : dm.left) * sh;
    const ry = (ly >= 0 ? dm.up : dm.down) * sh;
    const e = 2 / (1 - 0.32 * dm.hall);
    return Math.pow(Math.abs(lx / rx), e) + Math.pow(Math.abs(ly / ry), e) < 1;
  }

  // Rock "hubs" at junctions and sharp bends: an inward-facing lumpy ellipsoid that
  // fills the wedge gaps between tube ends. Triangles fully inside a passage are
  // dropped so openings stay clear. Its footprint matches the collision hub radius.
  const legsAt = new Map();
  for (const L of legInfos) {
    for (const st of [L.a, L.b]) {
      if (!legsAt.has(st.id)) legsAt.set(st.id, []);
      legsAt.get(st.id).push(L);
    }
  }
  for (const st of cave.stations) {
    const Ls = legsAt.get(st.id) || [];
    if (Ls.length < 1) continue;
    if (Ls.length === 1 && (st.kind === "entrance" || st.kind === "exit")) continue;
    if (Ls.length === 2) {
      const d0 = Ls[0].a.id === st.id ? Ls[0].dir : Ls[0].dir.clone().negate();
      const d1 = Ls[1].a.id === st.id ? Ls[1].dir : Ls[1].dir.clone().negate();
      const wideRoom = Math.max(st.left, st.right) > 2.4 || st.kind === "cavern" || st.kind === "chamber";
      if (d0.dot(d1) < -0.86 && !wideRoom) continue;
    }
    const p = stationWorld(st);
    pieces.push({
      kind: "hub", id: st.id, stations: [st.id], x: p.x, y: p.y, z: p.z,
      radius: Math.max(st.left, st.right, st.up) * 1.6 + 1,
      *emit(buf) {
        let hubR = Math.max(st.left, st.right) * 1.05;
        for (const L of Ls) hubR = Math.min(hubR, L.len * 0.42);
        const reach = Math.max(st.left, st.right, st.up) * 1.6 + 1;
        // Every nearby leg, not just the incident ones, so a hub never pokes into another passage.
        const near = legInfos.filter((L) => {
          const mx = (L.va.x + L.vb.x) / 2 - p.x, my = (L.va.y + L.vb.y) / 2 - p.y, mz = (L.va.z + L.vb.z) / 2 - p.z;
          const big = Math.max(L.a.left, L.a.right, L.a.up, L.b.left, L.b.right, L.b.up) * 1.5;
          return Math.hypot(mx, my, mz) < reach + L.len / 2 + big;
        });
        const cavern = st.kind === "cavern";
        let R = Math.max(0.5, Math.max(st.left, st.right) * 0.98, hubR);
        if (Ls.length === 1) R = Math.min(R, Ls[0].len * 0.85);
        const hfs = 1 / Math.max(1, Math.max(st.left, st.right, st.up) / 3);
        const hh = Math.min(1, hfs * 3);
        const sph = new THREE.SphereGeometry(1, cavern ? (R > 9 ? 60 : 40) : 26, cavern ? (R > 9 ? 34 : 24) : 16) // round 27: was 76x42 for every hall (phone tris);
        const sp = sph.attributes.position;
        const base = buf.count();
        const outside = [];
        const hubInside = (X, Y, Z, dy) => {
          // Round 10: a hall's ceiling is only dropped where it is well inside a tube (no generous
          // hall-bulge allowance): the bulge test cut ceiling the tube never covered -> red/void holes.
          if (cavern && dy < -0.25) return false; // a hall's floor is always solid rock
          const roof = cavern && dy > 0.15;
          for (const L of (roof ? Ls : near)) {
            // A tube between two halls is swallowed by them (its own wall is dropped), so it must not cut
            // their domes either; the overlap of the two halls is handled by insideHall below.
            if (roof && L.a.kind === "cavern" && L.b.kind === "cavern") continue;
            const hh2 = cavern && L.a.kind === "cavern" && L.b.kind === "cavern"; // round 27: hall<->hall tubes cut walls tightly
            if (insideLeg(L, X, Y, Z, roof ? 0.82 : hh2 ? 0.86 : 0.9, roof || hh2)) return true;
          }
          // round 10: overlapping halls keep a margin of rock (no jagged ceiling holes)
          return !!(halls.length && insideHall(X, Y, Z, st.id, roof ? 0.78 : cavern ? 0.8 : 0.92));
        };
        for (let i = 0; i < sp.count; i++) {
          const dx = sp.getX(i), dy = sp.getY(i), dz = sp.getZ(i);
          const irr = cavern ? st.irr || 0 : 0;
          const az = Math.atan2(dz, dx), rad = Math.hypot(dx, dz);
          let y = dy >= 0 ? (irr ? Math.pow(dy, 0.75) * hallRoof(irr, st.roofPhase || 0, az, rad) : dy) * st.up * 0.96 : -(st.down + 0.1) * Math.min(1, -dy * 2.4);
          const bulge = irr ? hallBulge(irr, st.roofPhase || 0, az) : 1;
          let hx = dx * R * bulge, hz = dz * R * bulge;
          const wx = p.x + hx, wy = p.y + y, wz = p.z + hz;
          let k = 1 + ((fbm3(wx * 0.45 * hfs, wy * 0.45 * hfs, wz * 0.45 * hfs, 4) - 0.5) * 0.34 + (fbm3(wx * 1.6 * hfs + 9, wy * 1.6 * hfs, wz * 1.6 * hfs, 3) - 0.5) * 0.12) * 0.6 + 0.1;
          if (cavern && dy > -0.2) k += Math.max(-0.04, (fbm3(wx * 0.11 * hh + 31, wy * 0.11 * hh, wz * 0.11 * hh - 7, 3) - 0.5) * HALL_MACRO);
          if (dy < -0.3) k = 1 + (k - 1) * 0.25;
          hx *= k; hz *= k;
          if (dy > 0) y *= k;
          const X = p.x + hx, Y = p.y + y, Z = p.z + hz;
          outside.push(!hubInside(X, Y, Z, dy));
          buf.vertex(X, Y, Z, 0, 0, vertColor(X, Y, Z, st.kind));
          if ((i + 1) % 350 === 0) yield;
        }
        const si = sph.index.array;
        const tris = [];
        for (let i = 0; i < si.length; i += 3) tris.push([si[i], si[i + 2], si[i + 1]]); // inside faces the player
        const dys = sp.array;
        snapCut(buf, base, outside.map((o) => !o), tris, (li, x, y, z) => hubInside(x, y, z, dys[li * 3 + 1]));
        sph.dispose();
      },
    });
  }
  return { pieces, legInfos };
}

/**
 * Round 27: clean cut edges. Where one piece's wall runs inside another, triangles used to be
 * dropped whole (2-of-3 vertices inside), leaving a saw-tooth of fins and notches along every
 * junction and hall mouth. Instead, each inside vertex next to a kept (outside) vertex is slid
 * along that edge onto the other piece's surface (bisection on the same inside test); then only
 * triangles with no vertex left inside are kept, so the cut follows the other surface smoothly.
 * `tris` are [i0, i1, i2] local vertex ids (0..n-1) at buffer offset `base`.
 */
function snapCut(buf, base, inside, tris, pred, iters = 7) {
  const n = inside.length;
  let anyIn = false;
  for (let i = 0; i < n; i++) if (inside[i]) { anyIn = true; break; }
  if (!anyIn) { for (const t of tris) buf.indices.push(base + t[0], base + t[1], base + t[2]); return; }
  // one outside neighbour per inside vertex (the nearest)
  const P = buf.positions;
  const best = new Int32Array(n).fill(-1), bestD = new Float64Array(n).fill(Infinity);
  const consider = (i, j) => {
    if (!inside[i] || inside[j]) return;
    const a = (base + i) * 3, b = (base + j) * 3;
    const d = (P[a] - P[b]) ** 2 + (P[a + 1] - P[b + 1]) ** 2 + (P[a + 2] - P[b + 2]) ** 2;
    if (d < bestD[i]) { bestD[i] = d; best[i] = j; }
  };
  for (const t of tris) { consider(t[0], t[1]); consider(t[0], t[2]); consider(t[1], t[0]); consider(t[1], t[2]); consider(t[2], t[0]); consider(t[2], t[1]); }
  const snapped = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const j = best[i];
    if (j < 0) continue;
    const a = (base + i) * 3, b = (base + j) * 3;
    const ix = P[a], iy = P[a + 1], iz = P[a + 2], ox = P[b], oy = P[b + 1], oz = P[b + 2];
    let lo = 0, hi = 1; // t=0 outside vertex, t=1 inside vertex
    for (let it = 0; it < iters; it++) {
      const m = (lo + hi) / 2;
      if (pred(i, ox + (ix - ox) * m, oy + (iy - oy) * m, oz + (iz - oz) * m)) hi = m; else lo = m;
    }
    P[a] = ox + (ix - ox) * lo; P[a + 1] = oy + (iy - oy) * lo; P[a + 2] = oz + (iz - oz) * lo;
    snapped[i] = 1;
  }
  for (const t of tris) {
    const in0 = inside[t[0]] && !snapped[t[0]], in1 = inside[t[1]] && !snapped[t[1]], in2 = inside[t[2]] && !snapped[t[2]];
    if (in0 || in1 || in2) continue;
    // all three were inside and got snapped: a sliver lying on the other surface - drop it
    if (inside[t[0]] && inside[t[1]] && inside[t[2]]) continue;
    buf.indices.push(base + t[0], base + t[1], base + t[2]);
  }
}

/** Growable vertex buffer that pieces emit into. */
export function makePieceBuffer() {
  const positions = [], uvs = [], colors = [], indices = [];
  return {
    positions, uvs, colors, indices,
    count: () => positions.length / 3,
    vertex(x, y, z, u, v, color) {
      positions.push(x, y, z);
      uvs.push(u, v);
      colors.push(color.r, color.g, color.b);
      return positions.length / 3 - 1;
    },
  };
}

/** Buffer -> geometry (normals computed per piece-group; pieces share no vertices). */
export function pieceBufferGeometry(buf, lookup = null) {
  const geo = new THREE.BufferGeometry();
  const n = buf.positions.length / 3;
  geo.setAttribute("position", new THREE.Float32BufferAttribute(buf.positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(buf.uvs, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(buf.colors, 3));
  const bake = new Float32Array(n);
  if (lookup && lookup.any) for (let i = 0; i < n; i++) bake[i] = lookup.at(buf.positions[i * 3], buf.positions[i * 3 + 1], buf.positions[i * 3 + 2]);
  geo.setAttribute("aBake", new THREE.BufferAttribute(bake, 1));
  geo.setIndex(buf.indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Front wall mesh + its dark back-face safety pass (drawn first, no depth write). */
export function passageMeshes(geo, material) {
  const mesh = new THREE.Mesh(geo, material || rockMaterial());
  mesh.name = "passages";
  const backfill = new THREE.Mesh(geo, backfillMaterial());
  backfill.name = "passages-backfill";
  backfill.renderOrder = -1;
  return [mesh, backfill];
}

/** Whole cave in one mesh (legacy path, `?stream=0`): exactly the same pieces, one chunk. */
export function buildCaveGroup(cave, material, lookup = null) {
  const group = new THREE.Group();
  group.name = "cave";
  const { pieces } = prepareCavePieces(cave);
  const buf = makePieceBuffer();
  for (const pc of pieces) for (const _ of pc.emit(buf)); // eslint-disable-line no-unused-vars
  for (const m of passageMeshes(pieceBufferGeometry(buf, lookup), material)) group.add(m);
  for (const o of portalObjects(cave)) group.add(o.obj);
  return group;
}

function displaceGeometry(geometry, amount) {
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = (fbm3(v.x * 2.1, v.y * 2.1, v.z * 2.1, 3) - 0.5) * 2 * amount;
    const len = v.length() || 1;
    v.multiplyScalar(1 + n / len);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

export function portalObjects(cave, { daylight = true } = {}) {
  const out = [];
  const group = { add: (o) => out.push({ obj: o, x: o.position.x, y: o.position.y, z: o.position.z }) };
  const smap = stationMap(cave);
  if (daylight && cave.entranceId && smap.has(cave.entranceId)) {
    const s = smap.get(cave.entranceId);
    const p = stationWorld(s);
    const nbr = (cave.legs.find((l) => l.from === s.id || l.to === s.id));
    let out = new THREE.Vector3(0, 0.2, 1);
    if (nbr) {
      const o = smap.get(nbr.from === s.id ? nbr.to : nbr.from);
      const q = stationWorld(o);
      out.set(p.x - q.x, p.y - q.y, p.z - q.z).normalize();
    }
    const light = new THREE.PointLight(0xb9d4ff, 18, 16, 1.6);
    light.position.set(p.x + out.x * 2.5, p.y + s.up * 0.4 + 1.2, p.z + out.z * 2.5);
    group.add(light);
    // A pale disc of "daylight" just outside the mouth.
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(Math.max(s.left, s.right) * 1.4, 20),
      // Round 10: fogged, so from deep inside it fades to black instead of showing as pale sky through seams.
      new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.DoubleSide, fog: true }),
    );
    disc.name = "daylight";
    disc.position.set(p.x + out.x * 2.2, p.y + 0.4, p.z + out.z * 2.2);
    disc.lookAt(p.x, p.y, p.z);
    // Round 11: the disc fades out with distance (main.js updateDaylight) so it can never show
    // through a gap deep inside, e.g. Carlsbad's Natural Entrance span seen from 16 m down.
    disc.material.transparent = true;
    disc.material.depthWrite = false;
    disc.userData.mouth = { x: p.x, y: p.y, z: p.z };
    group.add(disc);
    // ...and behind it a rock cap closes the mouth, so past the disc there is rock, never sky / void.
    const capR = Math.max(s.left, s.right, s.up) * 2.4 + 2;
    const cap = new THREE.Mesh(
      new THREE.CircleGeometry(capR, 24),
      // Round 12 (playtest r3): unlit and the same colour as CAVE_BG (0x0d0907), so the mouth light
      // can't turn it into a faint grey "moon" when you look up the entrance from 15-16 m.
      new THREE.MeshBasicMaterial({ color: 0x0d0907, side: THREE.DoubleSide, fog: true }),
    );
    cap.position.set(p.x + out.x * 3.4, p.y + 0.4, p.z + out.z * 3.4);
    cap.lookAt(p.x, p.y + 0.4, p.z);
    cap.name = "mouth-cap";
    group.add(cap);
  }
  if (cave.exitId && smap.has(cave.exitId)) {
    const s = smap.get(cave.exitId);
    const p = stationWorld(s);
    const glow = new THREE.PointLight(0xffc56a, 20, 14, 1.4);
    glow.position.set(p.x, p.y + 0.4, p.z);
    group.add(glow);
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffd789, fog: false }),
    );
    marker.position.set(p.x, p.y + 0.15, p.z);
    marker.name = "exit-marker";
    group.add(marker);
  }
  return out;
}

let skyTex = null;
function skyTexture() {
  if (skyTex) return skyTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 54, 4, 64, 64, 64);
  grd.addColorStop(0, "#fff6e4");
  grd.addColorStop(0.45, "#d9e4ef");
  grd.addColorStop(0.8, "#8fa7c2");
  grd.addColorStop(1, "#3a4452");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  skyTex = new THREE.CanvasTexture(c);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  return skyTex;
}

export function disposeGroup(group) {
  if (!group) return;
  group.traverse((obj) => {
    if (obj.geometry && !obj.userData.sharedGeometry) obj.geometry.dispose();
    if (obj.userData.ownMaterial && obj.material) obj.material.dispose();
    if (obj.isLight && obj.dispose) obj.dispose();
  });
}
