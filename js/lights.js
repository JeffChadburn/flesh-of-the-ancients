/**
 * Show-cave lighting for traced caves (Carlsbad): a list of fixed electric lights
 * (low path lamps along the trail + warm floodlights in big rooms and on named
 * formations), a cheap baked-light lookup used for wall vertices and formation
 * instances (no runtime light cost), and the paved trail with handrails and lamps.
 */

import * as THREE from "three";
import { stationMap, stationWorld } from "./cave-data.js";

export function buildLights(cave) {
  const lights = [];
  if (cave.style !== "carlsbad") return makeLookup(lights);
  const smap = stationMap(cave);
  const lit = (s) => s && s.lit !== false;
  for (const leg of cave.legs) {
    const a = smap.get(leg.from), b = smap.get(leg.to);
    if (!lit(a) || !lit(b)) continue;
    const pa = stationWorld(a), pb = stationWorld(b);
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
    const n = Math.max(1, Math.round(len / 16));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const fa = pa.y - a.down, fb = pb.y - b.down;
      lights.push({ x: pa.x + (pb.x - pa.x) * t, y: fa + (fb - fa) * t + 0.5, z: pa.z + (pb.z - pa.z) * t, i: 0.55, r: 9 });
    }
  }
  // Floodlights: big rooms get several, aimed (approximately) up the walls.
  for (const s of cave.stations) {
    if (!lit(s)) continue;
    const p = stationWorld(s);
    const big = Math.max(s.left, s.right);
    if (big < 6) continue;
    const k = s.kind === "cavern" ? 4 : 2;
    for (let j = 0; j < k; j++) {
      const ang = (j / k) * Math.PI * 2 + s.x * 0.01;
      lights.push({ x: p.x + Math.cos(ang) * big * 0.55, y: p.y - s.down + Math.min(8, s.up * 0.25), z: p.z + Math.sin(ang) * big * 0.55, i: 0.9, r: Math.min(45, big * 1.1) });
    }
    // Faint wash high on the walls/ceiling so the vault reads from the trail.
    if (s.kind === "cavern") lights.push({ x: p.x, y: p.y + s.up * 0.55, z: p.z, i: 0.45, r: Math.max(s.up, big) * 0.95 });
  }
  for (const f of cave.features || []) {
    const s = smap.get(f.near);
    if (!s) continue;
    const p = stationWorld(s);
    lights.push({ x: p.x + (f.dx || 0), y: p.y - s.down + (f.h || 5) * 0.45, z: p.z - (f.dy || 0), i: 1.2, r: (f.h || 6) * 1.6 + 6 });
  }
  return makeLookup(lights);
}

function makeLookup(lights) {
  const CELL = 40;
  const grid = new Map();
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  for (const L of lights) {
    const reach = L.r * 3;
    const x0 = Math.floor((L.x - reach) / CELL), x1 = Math.floor((L.x + reach) / CELL);
    const z0 = Math.floor((L.z - reach) / CELL), z1 = Math.floor((L.z + reach) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = key(cx, cz);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(L);
    }
  }
  /** Baked brightness (0..~1.4) at a world point. */
  function at(x, y, z) {
    const list = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return 0;
    let sum = 0;
    for (const L of list) {
      const dx = x - L.x, dy = (y - L.y) * 0.8, dz = z - L.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 9 * L.r * L.r) continue;
      sum += L.i / (1 + d2 / (L.r * L.r));
    }
    return Math.min(1.4, sum);
  }
  return { lights, at, any: lights.length > 0 };
}

/** Paved trail ribbon, handrails with posts, and small warm lamps (traced caves only). */
export function addTrail(group, cave, lookup) {
  if (cave.style !== "carlsbad") return null;
  const smap = stationMap(cave);
  const pos = [], idx = [], rail = [], posts = [], lamps = [];
  const W = 0.85;
  for (const leg of cave.legs) {
    const a = smap.get(leg.from), b = smap.get(leg.to);
    if (!a || !b || a.lit === false || b.lit === false) continue;
    const pa = stationWorld(a), pb = stationWorld(b);
    const dx = pb.x - pa.x, dz = pb.z - pa.z;
    const hl = Math.hypot(dx, dz) || 1;
    const rx = -dz / hl, rz = dx / hl;
    const fa = pa.y - a.down + 0.1, fb = pb.y - b.down + 0.1;
    const n = Math.max(2, Math.ceil(hl / 2));
    const base = pos.length / 3;
    // Gentle meander so the trail doesn't look ruler-straight in big rooms.
    const wig = (t) => Math.sin(t * Math.PI) * Math.sin(t * 7 + pa.x) * Math.min(2, (a.left + b.left) * 0.03);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const cx = pa.x + dx * t + rx * wig(t), cz = pa.z + dz * t + rz * wig(t);
      const y = fa + (fb - fa) * t;
      pos.push(cx - rx * W, y, cz - rz * W, cx + rx * W, y, cz + rz * W);
      if (i > 0) {
        const j = base + (i - 1) * 2;
        idx.push(j, j + 2, j + 1, j + 1, j + 2, j + 3);
      }
      for (const sd of [-1, 1]) {
        const px = cx + rx * sd * (W + 0.05), pz = cz + rz * sd * (W + 0.05);
        if (i > 0) {
          const t0 = (i - 1) / n;
          const qx = pa.x + dx * t0 + rx * wig(t0) + rx * sd * (W + 0.05), qz = pa.z + dz * t0 + rz * wig(t0) + rz * sd * (W + 0.05);
          const qy = fa + (fb - fa) * t0;
          rail.push(qx, qy + 0.92, qz, px, y + 0.92, pz);
        }
        if (i % 2 === 0) posts.push(px, y, pz);
      }
      if (i % 7 === 3) lamps.push(cx + rx * (W + 0.25), y + 0.25, cz + rz * (W + 0.25));
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const bake = new Float32Array(pos.length / 3);
  for (let i = 0; i < bake.length; i++) bake[i] = lookup.at(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  g.setAttribute("aBake", new THREE.BufferAttribute(bake, 1));
  const trailMat = new THREE.MeshStandardMaterial({ color: 0x5a544c, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  trailMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aBake;\nvarying float vBake;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvBake = aBake;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vBake;").replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vBake * vec3(1.0, 0.7, 0.42) * 0.9;");
  };
  const trail = new THREE.Mesh(g, trailMat);
  trail.name = "trail";
  group.add(trail);

  const rg = new THREE.BufferGeometry();
  rg.setAttribute("position", new THREE.Float32BufferAttribute(rail, 3));
  group.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x2a2620 })));

  const postGeo = new THREE.BoxGeometry(0.05, 0.92, 0.05);
  postGeo.translate(0, 0.46, 0);
  const pm = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x2b2722, roughness: 0.6, metalness: 0.5 }), posts.length / 3);
  const m = new THREE.Matrix4();
  for (let i = 0; i < posts.length / 3; i++) {
    m.makeTranslation(posts[i * 3], posts[i * 3 + 1], posts[i * 3 + 2]);
    pm.setMatrixAt(i, m);
  }
  pm.frustumCulled = false;
  group.add(pm);

  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.Float32BufferAttribute(lamps, 3));
  const lampMat = new THREE.ShaderMaterial({
    uniforms: { uPx: { value: 800 } },
    vertexShader: `uniform float uPx; varying float vD;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z;
        gl_PointSize = clamp(0.35 * uPx / max(0.5, -mv.z), 1.5, 40.0); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vD;
      void main() { float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d); a = a * a;
        gl_FragColor = vec4(vec3(1.0, 0.72, 0.38) * (0.6 + 0.6 * smoothstep(0.35, 0.0, d)), a * clamp(1.4 - vD / 160.0, 0.15, 1.0)); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lampPts = new THREE.Points(lg, lampMat);
  lampPts.frustumCulled = false;
  group.add(lampPts);
  return { lampMat };
}
