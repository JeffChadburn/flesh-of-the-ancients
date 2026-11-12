/**
 * Round 12: procedural stone-age settlements in the open world.
 *  - camps    (3-5 hide tents round a fire)
 *  - villages (10-20 huts inside a palisade with a gate, drying racks)
 *  - "cities" (1-2 big lakeside settlements: a longhouse on a plaza, many huts, racks, worn paths)
 * Planning is pure data (seeded, done once in the Terrain constructor so the ground can be
 * flattened and the lake basin carved); meshes are built lazily as instanced groups near the
 * player and dropped again far away. People live in people.js.
 */
import * as THREE from "three";
import { mulberry32 } from "../rng.js";

const SYL_A = ["Ka", "Ur", "Om", "Ta", "Bru", "Ma", "Ro", "Ash", "Ne", "Gor", "Ul", "Sa", "Ya", "Dun", "Ko", "Ri", "Vo"];
const SYL_B = ["na", "rak", "lu", "mesh", "tu", "ga", "rin", "dal", "ko", "vey", "ru", "tha", "mo", "sk", "nek"];
const SUF = { camp: ["Camp", "Fire", "Rest"], village: ["Village", "Stockade", "Hold"], city: ["", ""] };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const SETTLE_KIND = {
  camp:    { R: 10, flat: 16, color: "#d9a066", label: "camp" },
  village: { R: 25, flat: 22, color: "#e7b65c", label: "village" },
  city:    { R: 52, flat: 30, color: "#ffd36a", label: "town" },
};

/** Plan the settlements for a terrain (needs baseHeight, entrances, act1). */
export function planSettlements(t) {
  const rng = mulberry32(t.seed ^ 0x5e771e);
  const H = (x, z) => t.baseHeight(x, z);
  const out = [];
  const usedNames = new Set();
  const name = (kind) => {
    for (let i = 0; i < 20; i++) {
      let n = SYL_A[Math.floor(rng() * SYL_A.length)] + SYL_B[Math.floor(rng() * SYL_B.length)];
      if (rng() < 0.35) n += SYL_B[Math.floor(rng() * SYL_B.length)];
      if (usedNames.has(n)) continue;
      usedNames.add(n);
      const s = SUF[kind][Math.floor(rng() * SUF[kind].length)];
      return s ? n + " " + s : n;
    }
    return kind;
  };
  const camp = t.act1?.camp || { x: t.spawn?.x || 0, z: t.spawn?.z || 0 };
  let around = { x: 0, z: 0 };
  const site = (kind, R, rMin, rMax, sepAct1, sepEnt, sepOther, maxSlope, lake) => {
    for (let tries = 0; tries < 900; tries++) {
      const relax = tries > 500 ? 1.6 : 1;
      const r = rMin + Math.sqrt(rng()) * (rMax - rMin), a = rng() * Math.PI * 2;
      const x = around.x + Math.cos(a) * r, z = around.z + Math.sin(a) * r;
      if (Math.hypot(x - camp.x, z - camp.z) < sepAct1) continue;
      if (t.act1 && Math.hypot(x - t.act1.pool.x, z - t.act1.pool.z) < sepAct1 * 0.8) continue;
      if (t.entrances.some((e) => Math.hypot(e.x - x, e.z - z) < sepEnt + R)) continue;
      if (out.some((s) => Math.hypot(s.x - x, s.z - z) < sepOther + s.R + R)) continue;
      // flat-ish, low ground (not on the ridge)
      let sum = 0, lo = 1e9, hi = -1e9, n = 0;
      for (let k = 0; k < 13; k++) {
        const kr = k === 0 ? 0 : (k < 7 ? 0.5 : 1) * R, ka = (k % 6) * 1.047 + (k < 7 ? 0 : 0.52);
        const h = H(x + Math.cos(ka) * kr, z + Math.sin(ka) * kr);
        sum += h; n++; lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      const level = sum / n;
      if (level > 70 || (hi - lo) / (2 * R) > maxSlope * relax) continue;
      let lk = null;
      if (lake) {
        // lake on the lowest side, just outside the plaza
        let best = null;
        for (let k = 0; k < 8; k++) {
          const ka = (k / 8) * Math.PI * 2, d = R + 24;
          const lx = x + Math.cos(ka) * d, lz = z + Math.sin(ka) * d, h = H(lx, lz);
          if (!best || h < best.h) best = { x: lx, z: lz, h, a: ka };
        }
        if (t.entrances.some((e) => Math.hypot(e.x - best.x, e.z - best.z) < 70)) continue;
        if (out.some((s) => Math.hypot(s.x - best.x, s.z - best.z) < s.R + 60)) continue;
        lk = { x: best.x, z: best.z, r: 26, a: best.a, level: level - 0.7 };
      }
      return { x, z, level, lake: lk };
    }
    return null;
  };
  const add = (kind, n, rMin, rMax, sepAct1, sepEnt, sepOther, maxSlope, lake = false) => {
    const K = SETTLE_KIND[kind];
    for (let i = 0; i < n; i++) {
      const p = site(kind, K.R, rMin, rMax, sepAct1, sepEnt, sepOther, maxSlope, lake);
      if (!p) continue;
      const s = { id: out.length, kind, name: name(kind), x: p.x, z: p.z, R: K.R, level: p.level, lake: p.lake, seed: Math.floor(rng() * 1e9) };
      layout(s);
      out.push(s);
    }
  };
  // distances are from the world origin (the caves cluster within ~280 m of it); one village and
  // two camps are kept within a short run so they're found early
  // Round 13: one town a short walk (about 200-320 m) from the Act I camp, so it's found from the start
  // (its smoke shows over the trees); fall back to a village there if no flat lakeside ground fits.
  if (t.act1) {
    around = camp;
    const n0 = out.length;
    add("city", 1, 200, 320, 190, 120, 200, 0.2, true);
    if (out.length === n0) add("village", 1, 150, 300, 140, 100, 150, 0.24);
    if (out.length > n0) out[n0].nearCamp = true;
    around = { x: 0, z: 0 };
  }
  add("city", t.act1 && out.some((q) => q.kind === "city") ? 1 : 2, 320, 760, 260, 150, 240, 0.16, true);
  add("village", 1, 200, 380, 190, 110, 150, 0.2);
  add("village", 4, 260, 950, 200, 110, 160, 0.2);
  add("camp", 2, 140, 320, 130, 80, 100, 0.26);
  add("camp", 7, 200, 1050, 140, 80, 100, 0.26);
  return out;
}

/** Fill a settlement's layout: huts / tents / fires / racks / palisade posts / longhouse / paths. */
function layout(s) {
  const rng = mulberry32(s.seed);
  s.huts = []; s.tents = []; s.fires = []; s.racks = []; s.posts = []; s.paths = []; s.longhouse = null; s.spots = [];
  const free = (x, z, r) => s.huts.every((h) => Math.hypot(h.x - x, h.z - z) > h.r + r + 1.2)
    && s.tents.every((h) => Math.hypot(h.x - x, h.z - z) > h.r + r + 1.0)
    && s.fires.every((f) => Math.hypot(f.x - x, f.z - z) > r + 3.2)
    && s.racks.every((f) => Math.hypot(f.x - x, f.z - z) > r + 1.6)
    && (!s.longhouse || !inLonghouse(s.longhouse, x, z, r + 1.8));
  const rel = (dx, dz) => ({ x: s.x + dx, z: s.z + dz });
  if (s.kind === "camp") {
    s.fires.push(rel(0, 0));
    const n = 3 + Math.floor(rng() * 3), a0 = rng() * 6.28;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.4, d = 5 + rng() * 1.6;
      const p = rel(Math.cos(a) * d, Math.sin(a) * d);
      s.tents.push({ ...p, r: 1.25, rot: a + Math.PI, tint: rng() });
    }
    if (rng() < 0.7) { const a = a0 + 0.6; s.racks.push({ ...rel(Math.cos(a) * 3.4, Math.sin(a) * 3.4), rot: a }); }
  } else if (s.kind === "village") {
    s.fires.push(rel(0, 0));
    const n = 10 + Math.floor(rng() * 11);
    for (let k = 0, placed = 0; k < 400 && placed < n; k++) {
      const a = rng() * Math.PI * 2, d = 7 + Math.sqrt(rng()) * 13.5;
      const p = rel(Math.cos(a) * d, Math.sin(a) * d), r = 1.7 + rng() * 0.5;
      if (!free(p.x, p.z, r)) continue;
      s.huts.push({ ...p, r, rot: Math.atan2(s.x - p.x, s.z - p.z), tint: rng() }); placed++;
    }
    for (let i = 0; i < 3; i++) { const a = rng() * 6.28, p = rel(Math.cos(a) * 4.2, Math.sin(a) * 4.2); if (free(p.x, p.z, 0.6)) s.racks.push({ ...p, rot: a }); }
    // palisade with a gate
    s.gate = rng() * Math.PI * 2;
    const PR = s.R - 0.5, step = 1.05 / PR;
    for (let a = 0; a < Math.PI * 2; a += step) {
      let da = Math.abs(((a - s.gate + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (da < 2.4 / PR) continue;
      s.posts.push({ ...rel(Math.cos(a) * PR, Math.sin(a) * PR), h: 2.6 + rng() * 0.7, r: 0.16 });
    }
    s.paths.push([rel(0, 0), rel(Math.cos(s.gate) * (s.R + 6), Math.sin(s.gate) * (s.R + 6))]);
  } else {
    // city: plaza + longhouse in the middle, lake on one side
    const la = s.lake.a, ca = Math.cos(la + Math.PI / 2), sa = Math.sin(la + Math.PI / 2);
    s.longhouse = { x: s.x - Math.cos(la) * 9, z: s.z - Math.sin(la) * 9, rot: Math.atan2(ca, sa), L: 22, W: 8 };
    s.fires.push(rel(Math.cos(la) * 4, Math.sin(la) * 4));
    for (let i = 0; i < 3; i++) { const a = la + 1.3 + i * 1.6, d = 26 + rng() * 8; s.fires.push(rel(Math.cos(a) * d, Math.sin(a) * d)); }
    // radial paths + a ring path; huts line them
    const spokes = [];
    for (let i = 0; i < 6; i++) spokes.push(la + Math.PI / 6 + (i / 6) * Math.PI * 2);
    for (const a of spokes) s.paths.push([rel(Math.cos(a) * 5, Math.sin(a) * 5), rel(Math.cos(a) * 30, Math.sin(a) * 30), rel(Math.cos(a) * (s.R + 4), Math.sin(a) * (s.R + 4))]);
    const ring = []; for (let i = 0; i <= 28; i++) { const a = (i / 28) * Math.PI * 2; ring.push(rel(Math.cos(a) * 30, Math.sin(a) * 30)); }
    s.paths.push(ring);
    s.paths.push([rel(0, 0), rel(Math.cos(la) * (s.R + 2), Math.sin(la) * (s.R + 2))]); // to the shore
    const onPath = (x, z) => s.paths.some((P) => P.some((q, i) => i > 0 && segD(x, z, P[i - 1].x, P[i - 1].z, q.x, q.z) < 2.6));
    const n = 38 + Math.floor(rng() * 14);
    for (let k = 0, placed = 0; k < 2000 && placed < n; k++) {
      const a = rng() * Math.PI * 2, d = 13 + Math.sqrt(rng()) * (s.R - 15);
      const p = rel(Math.cos(a) * d, Math.sin(a) * d), r = 1.7 + rng() * 0.6;
      if (Math.hypot(p.x - s.lake.x, p.z - s.lake.z) < s.lake.r + 5) continue;
      if (onPath(p.x, p.z) || !free(p.x, p.z, r)) continue;
      // face the nearest path-ish direction: toward the centre
      s.huts.push({ ...p, r, rot: Math.atan2(s.x - p.x, s.z - p.z), tint: rng() }); placed++;
    }
    for (let k = 0, placed = 0; k < 400 && placed < 9; k++) {
      const a = la + (rng() - 0.5) * 2.2, d = s.R * 0.45 + rng() * s.R * 0.4;
      const p = rel(Math.cos(a) * d, Math.sin(a) * d);
      if (Math.hypot(p.x - s.lake.x, p.z - s.lake.z) < s.lake.r + 3 || onPath(p.x, p.z) || !free(p.x, p.z, 0.7)) continue;
      s.racks.push({ ...p, rot: a }); placed++;
    }
    for (let i = 0; i < 4; i++) { const a = la + (i - 1.5) * 0.35, d = s.lake.r + 1.2; s.racks.push({ x: s.lake.x - Math.cos(a) * d, z: s.lake.z - Math.sin(a) * d, rot: a, canoe: i % 2 === 0 }); }
  }
  // places people go: doors, fires, racks, plaza
  for (const h of [...s.huts, ...s.tents]) s.spots.push({ x: h.x + Math.sin(h.rot) * (h.r + 1.0), z: h.z + Math.cos(h.rot) * (h.r + 1.0), kind: "door" });
  for (const r of s.racks) s.spots.push({ x: r.x + Math.cos(r.rot + 1.57) * 1.3, z: r.z + Math.sin(r.rot + 1.57) * 1.3, kind: "rack" });
  if (s.lake) s.spots.push({ x: s.x + Math.cos(s.lake.a) * (s.R + 1), z: s.z + Math.sin(s.lake.a) * (s.R + 1), kind: "shore" });
  // hide cones / hall volumes the chase camera must stay out of (round 12 + playtest r3)
  s.cones = [...s.huts.map((h) => ({ x: h.x, z: h.z, r: h.r * 1.04, h: 3.1 * (0.95 + h.tint * 0.2) })), ...s.tents.map((h) => ({ x: h.x, z: h.z, r: 1.45, h: 2.25 }))];
  if (s.longhouse) { const L = s.longhouse, ux = Math.sin(L.rot), uz = Math.cos(L.rot); for (let k = -2; k <= 2; k++) s.cones.push({ x: L.x + ux * k * 4.4, z: L.z + uz * k * 4.4, r: 4.3, h: 5.9, cyl: true }); }
  s.colliders = [];
  for (const h of s.huts) s.colliders.push({ x: h.x, z: h.z, r: h.r * 0.86 });
  for (const h of s.tents) s.colliders.push({ x: h.x, z: h.z, r: h.r * 0.86 });
  for (const f of s.fires) s.colliders.push({ x: f.x, z: f.z, r: 0.9 });
  for (const r of s.racks) s.colliders.push({ x: r.x, z: r.z, r: 0.45 });
  for (const p of s.posts) s.colliders.push({ x: p.x, z: p.z, r: 0.3 });
  if (s.longhouse) {
    const L = s.longhouse, ux = Math.sin(L.rot), uz = Math.cos(L.rot);
    for (let k = -2; k <= 2; k++) s.colliders.push({ x: L.x + ux * k * 4.4, z: L.z + uz * k * 4.4, r: 4.0 });
  }
  if (s.lake) s.colliders.push({ x: s.lake.x, z: s.lake.z, r: s.lake.r - 2.5 });
}
function inLonghouse(L, x, z, pad) {
  const ux = Math.sin(L.rot), uz = Math.cos(L.rot), dx = x - L.x, dz = z - L.z;
  return Math.abs(dx * ux + dz * uz) < L.L / 2 + pad && Math.abs(-dx * uz + dz * ux) < L.W / 2 + pad;
}
function segD(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / L));
  return Math.hypot(ax + vx * t - px, az + vz * t - pz);
}

/** Height modifier for the settlements: flat yards and the city lake basins. */
export function settleMod(list, x, z, h) {
  let d = 0;
  for (const s of list) {
    const dx = x - s.x, dz = z - s.z;
    const far = s.R + SETTLE_KIND[s.kind].flat;
    if (s.lake) {
      const dl = Math.hypot(x - s.lake.x, z - s.lake.z);
      if (dl < s.lake.r + 22) {
        const w = 1 - smooth(s.lake.r + 4, s.lake.r + 22, dl);
        d += (s.level - h - d) * w;
        if (dl < s.lake.r + 3) d -= 3.4 * (1 - smooth(s.lake.r * 0.35, s.lake.r + 3, dl));
        continue;
      }
    }
    if (Math.abs(dx) > far || Math.abs(dz) > far) continue;
    const dc = Math.hypot(dx, dz);
    if (dc < far) d += (s.level - h) * (1 - smooth(s.R + 2, far, dc));
  }
  return d;
}

/** Spatial hash of every settlement collider (16 m cells). */
export function colliderGrid(list) {
  const g = new Map(), C = 16;
  for (const s of list) for (const c of s.colliders) {
    const x0 = Math.floor((c.x - c.r) / C), x1 = Math.floor((c.x + c.r) / C), z0 = Math.floor((c.z - c.r) / C), z1 = Math.floor((c.z + c.r) / C);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = ix + "," + iz; let a = g.get(k); if (!a) g.set(k, (a = [])); a.push(c);
    }
  }
  g.C = C;
  return g;
}

// ------------------------------------------------------------------ meshes
function merged(parts) {
  const pos = [], nrm = [], col = [], c = new THREE.Color();
  for (const [g0, hex] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    g.computeVertexNormals();
    pos.push(...g.attributes.position.array); nrm.push(...g.attributes.normal.array);
    c.setHex(hex);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
    if (g !== g0) g.dispose(); g0.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
const T = (g, x, y, z) => { g.translate(x, y, z); return g; };
const R = (g, ax, ay, az) => { g.rotateX(ax); g.rotateY(ay); g.rotateZ(az); return g; };

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const hut = [[T(new THREE.ConeGeometry(2.0, 3.1, 10), 0, 1.55, 0), 0xffffff],
    [T(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 4), 0.18, 3.2, 0), 0x5a4026], [T(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 4), -0.18, 3.2, 0.1), 0x5a4026],
    [T(R(new THREE.PlaneGeometry(0.95, 1.35), -0.58, 0, 0), 0, 0.62, 1.62), 0x140d08]];
  const tent = [[T(new THREE.ConeGeometry(1.4, 2.2, 7), 0, 1.1, 0), 0xffffff],
    [T(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 4), 0.1, 2.3, 0), 0x5a4026],
    [T(R(new THREE.PlaneGeometry(0.7, 0.95), -0.56, 0, 0), 0, 0.45, 1.13), 0x140d08]];
  const fire = [];
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; fire.push([T(new THREE.DodecahedronGeometry(0.2, 0), Math.cos(a) * 0.7, 0.08, Math.sin(a) * 0.7), 0x77716a]); }
  for (let i = 0; i < 4; i++) fire.push([R(T(new THREE.CylinderGeometry(0.07, 0.08, 1.0, 5), 0, 0.12, 0), Math.PI / 2, (i / 4) * Math.PI, 0), 0x3b2a1c]);
  const rack = [[T(new THREE.CylinderGeometry(0.05, 0.06, 1.9, 4), -0.9, 0.95, 0), 0x5a4026], [T(new THREE.CylinderGeometry(0.05, 0.06, 1.9, 4), 0.9, 0.95, 0), 0x5a4026],
    [R(T(new THREE.CylinderGeometry(0.04, 0.04, 2.0, 4), 0, 0, 0), 0, 0, Math.PI / 2), 0x5a4026]];
  rack[2][0].translate(0, 1.8, 0);
  for (let i = 0; i < 4; i++) rack.push([T(new THREE.BoxGeometry(0.3, 0.55 + (i % 2) * 0.2, 0.03), -0.6 + i * 0.4, 1.45 - (i % 2) * 0.1, 0), i % 2 ? 0x8a4a3a : 0x9c7a55]);
  const canoe = [[T(new THREE.BoxGeometry(0.7, 0.3, 4.2), 0, 0.15, 0), 0x4a3422]];
  const post = [[T(new THREE.CylinderGeometry(0.13, 0.15, 1, 5), 0, 0.5, 0), 0x6a4c30], [T(new THREE.ConeGeometry(0.13, 0.35, 5), 0, 1.17, 0), 0x7b5a3a]];
  // longhouse: 22 x 8 hide-and-pole hall with a ridged roof
  const lh = [];
  const tri = new THREE.Shape([new THREE.Vector2(-4.7, 0), new THREE.Vector2(4.7, 0), new THREE.Vector2(0, 4.0)]);
  const roof = new THREE.ExtrudeGeometry(tri, { depth: 22.6, bevelEnabled: false });
  roof.translate(0, 1.85, -11.3);
  lh.push([roof, 0x8c6c48]);
  lh.push([T(new THREE.BoxGeometry(7.6, 2.0, 21.4), 0, 1.0, 0), 0x6e5236]);
  lh.push([T(new THREE.PlaneGeometry(1.4, 1.9), 0, 0.95, 10.72), 0x120c08]);
  lh.push([T(R(new THREE.PlaneGeometry(1.4, 1.9), 0, Math.PI, 0), 0, 0.95, -10.72), 0x120c08]);
  for (let i = 0; i < 4; i++) lh.push([T(new THREE.CylinderGeometry(0.1, 0.1, 1.3, 4), 0, 5.9, -9 + i * 6), 0x3a2817]);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const flameM = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  SHARED = {
    mat, flameM,
    hut: merged(hut), tent: merged(tent), fire: merged(fire), rack: merged(rack), canoe: merged(canoe), post: merged(post), longhouse: merged(lh),
    flame: T(new THREE.ConeGeometry(0.42, 1.25, 6), 0, 0.62, 0),
    pathM: new THREE.MeshLambertMaterial({ color: 0x8a7556, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    waterM: new THREE.MeshStandardMaterial({ color: 0x2f5562, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.86 }),
  };
  return SHARED;
}
const HIDE = [0xa48462, 0x8f6e4e, 0xb59673, 0x7d5f43, 0x9d8a6a];

/** Build one settlement's render group (a handful of instanced draws). */
export function buildSettlementGroup(s, terrain) {
  const S = shared();
  const g = new THREE.Group(); g.name = "settlement-" + s.id;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), c = new THREE.Color();
  const inst = (geo, items, place, tint) => {
    if (!items.length) return null;
    const m = new THREE.InstancedMesh(geo, S.mat, items.length);
    items.forEach((it, i) => { place(it); e.set(0, it.rot || 0, 0); q.setFromEuler(e); m4.compose(v, q, sc); m.setMatrixAt(i, m4); if (tint) m.setColorAt(i, c.setHex(tint(it))); });
    m.computeBoundingSphere(); m.castShadow = false; m.receiveShadow = false;
    g.add(m); return m;
  };
  const Y = (x, z) => terrain.height(x, z);
  inst(S.hut, s.huts, (h) => { v.set(h.x, Y(h.x, h.z) - 0.05, h.z); sc.set(h.r / 2, 0.95 + h.tint * 0.2, h.r / 2); }, (h) => HIDE[Math.floor(h.tint * HIDE.length)]);
  inst(S.tent, s.tents, (h) => { v.set(h.x, Y(h.x, h.z) - 0.05, h.z); sc.set(1, 1, 1); }, (h) => HIDE[Math.floor(h.tint * HIDE.length)]);
  sc.set(1, 1, 1);
  inst(S.fire, s.fires, (f) => { v.set(f.x, Y(f.x, f.z), f.z); sc.set(1, 1, 1); });
  inst(S.rack, s.racks.filter((r) => !r.canoe), (r) => { v.set(r.x, Y(r.x, r.z), r.z); sc.set(1, 1, 1); });
  inst(S.canoe, s.racks.filter((r) => r.canoe), (r) => { v.set(r.x, Y(r.x, r.z) + 0.02, r.z); sc.set(1, 1, 1); });
  inst(S.post, s.posts, (p) => { v.set(p.x, Y(p.x, p.z) - 0.2, p.z); sc.set(1, p.h, 1); });
  sc.set(1, 1, 1);
  if (s.longhouse) inst(S.longhouse, [s.longhouse], (L) => { v.set(L.x, Y(L.x, L.z) - 0.1, L.z); });
  // flames (one instanced additive draw; flicker scaled per frame)
  const fl = new THREE.InstancedMesh(S.flame, S.flameM, s.fires.length);
  s.fires.forEach((f, i) => { m4.makeTranslation(f.x, Y(f.x, f.z) + 0.1, f.z); fl.setMatrixAt(i, m4); });
  fl.computeBoundingSphere(); g.add(fl); g.userData.flames = fl;
  // worn earth paths draped over the ground
  if (s.paths.length) {
    const pos = [], idx = [];
    for (const P of s.paths) {
      const pts = [];
      for (let i = 0; i < P.length - 1; i++) {
        const L = Math.hypot(P[i + 1].x - P[i].x, P[i + 1].z - P[i].z), n = Math.max(1, Math.ceil(L / 2.5));
        for (let k = 0; k < n; k++) pts.push({ x: P[i].x + ((P[i + 1].x - P[i].x) * k) / n, z: P[i].z + ((P[i + 1].z - P[i].z) * k) / n });
      }
      pts.push(P[P.length - 1]);
      const base = pos.length / 3;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const w = 0.9;
        for (const sd of [-1, 1]) { const x = pts[i].x - dz * w * sd, z = pts[i].z + dx * w * sd; pos.push(x, Y(x, z) + 0.05, z); }
        if (i) { const o = base + i * 2; idx.push(o - 2, o - 1, o, o - 1, o + 1, o); }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    // make sure normals point up whatever the winding
    const nr = geo.attributes.normal; for (let i = 0; i < nr.count; i++) if (nr.getY(i) < 0) nr.setXYZ(i, -nr.getX(i), -nr.getY(i), -nr.getZ(i));
    const pm = new THREE.Mesh(geo, S.pathM); pm.material.side = THREE.DoubleSide; g.add(pm); g.userData.pathGeo = geo;
  }
  if (s.lake) {
    const w = new THREE.Mesh(new THREE.CircleGeometry(s.lake.r + 2.5, 40), S.waterM);
    w.rotation.x = -Math.PI / 2; w.position.set(s.lake.x, s.lake.level, s.lake.z); w.name = "lake";
    g.add(w); g.userData.lakeGeo = w.geometry;
  }
  return g;
}

/** Streams settlement render groups in / out around the player. */
export class SettlementLayer {
  constructor(terrain, scene, { lite = false } = {}) {
    this.t = terrain; this.scene = scene; this.lite = lite;
    this.list = terrain.settlements || [];
    this.groups = new Map();
    this.near = lite ? 380 : 480; this.far = this.near + 120;
    this.onBuild = null; this.onDrop = null;
    this.time = 0;
    this._beacons(scene);
  }

  /** Round 13: smoke columns over every settlement's fires, always present and unfogged, so a
   *  village or town reads from a long way off (one instanced, transparent draw for all). */
  _beacons(scene) {
    const H = 80, geo = new THREE.CylinderGeometry(7, 0.9, H, 9, 8, true).translate(0, H / 2, 0);
    const pos = geo.attributes.position, col = [];
    for (let i = 0; i < pos.count; i++) {
      const v = pos.getY(i) / H, wob = Math.sin(v * 9 + i) * 0.6 * v;
      pos.setX(i, pos.getX(i) + v * v * 14 + wob); // drifts downwind and widens
      col.push(0.78, 0.76, 0.72, Math.max(0, 0.42 * (1 - v) * Math.min(1, v * 8 + 0.25)));
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const fires = [];
    for (const st of this.list) for (const f of st.fires) fires.push({ ...f, k: st.kind === "camp" ? 0.55 : st.kind === "village" ? 0.85 : 1.15 });
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, fires.length));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    fires.forEach((f, i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7 + i * 0.13); v.set(f.x, this.t.height(f.x, f.z) + 0.8, f.z); sc.set(f.k, f.k, f.k); m.setMatrixAt(i, m4.compose(v, q, sc)); });
    m.count = fires.length; m.computeBoundingSphere(); m.frustumCulled = false; m.renderOrder = 2; m.name = "smoke-beacons";
    scene.add(m); this.smoke = m;
  }
  update(dt, p) {
    this.time += dt;
    let built = 0;
    for (const s of this.list) {
      const d = Math.hypot(s.x - p.x, s.z - p.z) - s.R;
      const g = this.groups.get(s.id);
      if (!g && d < this.near && built < 1) { const ng = buildSettlementGroup(s, this.t); this.scene.add(ng); this.groups.set(s.id, ng); built++; this.onBuild?.(s); }
      else if (g && d > this.far) this.drop(s);
    }
    // flicker
    const m4 = new THREE.Matrix4();
    for (const [id, g] of this.groups) {
      const fl = g.userData.flames, s = this.list[id];
      if (Math.hypot(s.x - p.x, s.z - p.z) > 160) continue;
      s.fires.forEach((f, i) => {
        const k = 0.8 + 0.25 * Math.sin(this.time * 11 + i * 2.1) + 0.12 * Math.sin(this.time * 23 + i);
        m4.makeScale(1, k, 1).setPosition(f.x, this.t.height(f.x, f.z) + 0.1, f.z); fl.setMatrixAt(i, m4);
      });
      fl.instanceMatrix.needsUpdate = true;
    }
  }
  drop(s) {
    const g = this.groups.get(s.id); if (!g) return;
    this.scene.remove(g);
    g.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    g.userData.pathGeo?.dispose(); g.userData.lakeGeo?.dispose();
    this.groups.delete(s.id); this.onDrop?.(s);
  }
  dispose() { for (const s of this.list) this.drop(s); if (this.smoke) { this.smoke.parent?.remove(this.smoke); this.smoke.geometry.dispose(); this.smoke.material.dispose(); } }
  /** Nearest settlement (towns and villages count 1.6x closer than camps: they're worth the walk). */
  nearest(x, z) {
    let best = null, bd = Infinity;
    for (const s of this.list) { const d = Math.hypot(s.x - x, s.z - z), w = s.kind === "camp" ? d * 1.6 : d; if (w < bd) { bd = w; best = s; } }
    return best && { s: best, d: Math.hypot(best.x - x, best.z - z) };
  }
  /** Settlement whose yard the point is in (for the place label). */
  at(x, z) { return this.list.find((s) => Math.hypot(s.x - x, s.z - z) < s.R + 12) || null; }
  drawCalls() { let n = 0; for (const g of this.groups.values()) g.traverse((o) => { if (o.isMesh) n++; }); return n; }
}
