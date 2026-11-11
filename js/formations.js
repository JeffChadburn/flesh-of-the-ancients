/** Seeded cave formations as instanced meshes, with walkable-centerline clearance. */

import * as THREE from "three";
import { stationMap, stationWorld, neighborsOf } from "./cave-data.js";
import { mulberry32, randRange, fbm3 } from "./rng.js";

const CLEAR = 0.72; // metres kept clear along the centerline so the exit stays reachable

function frameAt(ax, ay, az, bx, by, bz) {
  const tx = bx - ax, ty = by - ay, tz = bz - az;
  const len = Math.hypot(tx, ty, tz) || 1;
  const f = { x: tx / len, y: ty / len, z: tz / len };
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(f.y) > 0.94) { ux = 1; uy = 0; }
  let rx = uy * f.z - uz * f.y;
  let ry = uz * f.x - ux * f.z;
  let rz = ux * f.y - uy * f.x;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  return { rx, ry, rz, ux: f.y * rz - f.z * ry, uy: f.z * rx - f.x * rz, uz: f.x * ry - f.y * rx, len };
}

function addInstance(list, dummy, x, y, z, sx, sy, sz, rotX, rotY, rotZ, color) {
  dummy.position.set(x, y, z);
  dummy.rotation.set(rotX || 0, rotY || 0, rotZ || 0);
  dummy.scale.set(sx, sy, sz);
  dummy.updateMatrix();
  list.push({ matrix: dummy.matrix.clone(), color: color.clone() });
}

let creamy = false;
function wetColor(rng) {
  // Carlsbad: creamy white/tan/orange calcite; wild caves: damp brown.
  if (creamy) return new THREE.Color().setHSL(0.07 + rng() * 0.05, 0.25 + rng() * 0.3, 0.56 + rng() * 0.22);
  const c = new THREE.Color().setHSL(0.08 + rng() * 0.04, 0.18 + rng() * 0.12, 0.42 + rng() * 0.16);
  return c;
}

export function addFormations(group, cave, material, lookup = null, opts = {}) {
  const show = cave.style === "carlsbad";
  const rng = mulberry32((typeof cave.seed === "number" ? cave.seed : 7741) ^ 0xc0ffee);
  creamy = show;
  const smap = stationMap(cave);
  const nbrs = neighborsOf(cave);
  const dummy = new THREE.Object3D();
  const obstacles = [];

  const stalactites = [];
  const stalagmites = [];
  const columns = [];
  const straws = [];
  const drapes = [];

  const wet = material;

  function placeOnFloor(x, z, yBase, radius, height) {
    obstacles.push({ x, z, y: yBase, radius, height, kind: "formation" });
  }

  function alongLegs(callback) {
    for (const leg of cave.legs) {
      const a = smap.get(leg.from);
      const b = smap.get(leg.to);
      if (!a || !b) continue;
      const pa = stationWorld(a);
      const pb = stationWorld(b);
      const fr = frameAt(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
      callback(a, b, pa, pb, fr);
    }
  }

  alongLegs((a, b, pa, pb, fr) => {
    if (a.clearance === "crawl" || b.clearance === "crawl" || a.clearance === "crouch" || b.clearance === "crouch") return;
    if (show && (a.zone === "entrance" || b.zone === "entrance")) return; // sunlit entrance: bare rock
    const cavernish = a.kind === "cavern" || b.kind === "cavern";
    const chamberish = cavernish || a.kind === "chamber" || b.kind === "chamber" || (a.left + a.right + b.left + b.right) > 7;
    // Show-cave halls: giant dripstone, fewer but much bigger pieces per metre.
    const G = show && cavernish ? Math.min(7, Math.max(1, Math.min(a.up, b.up) / 6)) : show && chamberish ? 2 : 1;
    const steps = Math.max(1, Math.floor(fr.len * (chamberish ? 1.1 : 0.45) / G));
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.3 + rng() * 0.4) / steps;
      const x = pa.x + (pb.x - pa.x) * t;
      const y = pa.y + (pb.y - pa.y) * t;
      const z = pa.z + (pb.z - pa.z) * t;
      const left = a.left + (b.left - a.left) * t;
      const right = a.right + (b.right - a.right) * t;
      let up = a.up + (b.up - a.up) * t;
      let down = a.down + (b.down - a.down) * t;
      let floor = y - down;
      let ceil = y + up;
      const side = rng() < 0.5 ? -1 : 1;
      const half = side < 0 ? left : right;
      const clear = show ? (cavernish ? 7 : 2.4) : cavernish ? 3.8 : chamberish ? 0.95 : CLEAR;
      if (half < clear + 0.15) continue;
      const lat = randRange(rng, clear + 0.12, Math.max(clear + 0.12, half * 0.88));
      const fx = x + fr.rx * side * lat;
      const fz = z + fr.rz * side * lat;
      const color = wetColor(rng);
      if (show) {
        // Follow the (super)elliptical section so giants sit on the floor and hang from the roof.
        const pw = cavernish ? 0.68 : 1;
        const q = Math.min(0.98, lat / half);
        const f = Math.pow(Math.max(0.0, 1 - Math.pow(q, 2 / pw)), pw / 2);
        floor = y - down * (0.55 + 0.45 * f);
        ceil = y + up * Math.max(0.15, f) * 0.97;
        up = Math.max(0.5, ceil - y);
        down = Math.max(0.2, y - floor);
      }

      const dens = cavernish ? 0.95 : chamberish ? 0.85 : 0.45;
      if (rng() < dens) {
        const h = randRange(rng, chamberish ? 0.45 : 0.18, Math.min(cavernish ? 4.5 : chamberish ? 1.8 : 0.7, up * 0.55)) * G;
        const r = randRange(rng, 0.04, chamberish ? 0.16 : 0.1) * G * (show ? 1.4 : 1);
        addInstance(stalactites, dummy, fx, ceil - h * 0.5, fz, r / 0.08, h / 0.6, r / 0.08, Math.PI, rng() * 6, 0, color);
      }
      if (rng() < dens * 0.75) {
        const h = randRange(rng, 0.16, Math.min(chamberish ? 1.1 : 0.45, down + 0.2)) * G * (show && cavernish ? randRange(rng, 1, 2.6) : 1);
        const r = randRange(rng, 0.05, chamberish ? 0.18 : 0.11) * G * (show ? 1.5 : 1);
        addInstance(stalagmites, dummy, fx, floor + h * 0.5, fz, r / 0.08, h / 0.6, r / 0.08, 0, rng() * 6, 0, color);
        placeOnFloor(fx, fz, floor, r * 0.85, h);
      }
      if (chamberish && rng() < 0.16 && (show ? ceil - floor < 30 : ceil - floor < 7)) {
        const h = (ceil - floor) * randRange(rng, 0.92, 1.0);
        const r = randRange(rng, 0.07, 0.16) * (show ? Math.max(4, h * 0.08) : 1);
        addInstance(columns, dummy, fx, floor + h * 0.5, fz, r / 0.1, h / 1.6, r / 0.1, 0, rng() * 6, 0, color);
        placeOnFloor(fx, fz, floor, r * 0.9, h);
      }
    }
  });

  // Soda straws and extra dripstone in chambers.
  for (const s of cave.stations) {
    if (s.kind !== "cavern" && s.kind !== "chamber" && (s.left + s.right) < 4.5) continue;
    const p = stationWorld(s);
    const floor = p.y - s.down;
    const ceil = p.y + s.up;
    const strawN = ((s.kind === "cavern" ? 16 : 6) + Math.floor(rng() * (s.kind === "cavern" ? 20 : 14))) * (show ? 4 : 1);
    for (let i = 0; i < strawN; i++) {
      const ang = rng() * Math.PI * 2;
      const clear = s.kind === "cavern" ? 3.8 : CLEAR + 0.1;
      const rad = randRange(rng, clear, Math.max(s.left, s.right) * 0.92);
      const x = p.x + Math.cos(ang) * rad;
      const z = p.z + Math.sin(ang) * rad;
      const h = randRange(rng, 0.12, 0.55) * (show ? 3 : 1);
      addInstance(straws, dummy, x, ceil - h * 0.5, z, 1, h / 0.3, 1, 0, 0, 0, wetColor(rng));
    }
    // A few meeting columns / paired dripstones
    const pairs = (s.kind === "cavern" ? 3 : 1) + Math.floor(rng() * (s.kind === "cavern" ? 5 : 3));
    for (let i = 0; i < pairs; i++) {
      const ang = rng() * Math.PI * 2;
      const rad = randRange(rng, (s.kind === "cavern" ? 3.8 : CLEAR + 0.2), Math.max(s.left, s.right) * 0.82);
      const x = p.x + Math.cos(ang) * rad;
      const z = p.z + Math.sin(ang) * rad;
      const gap = Math.min(ceil - floor, show ? 26 : 99);
      const h1 = gap * randRange(rng, 0.35, 0.5);
      const h2 = gap - h1;
      const r = randRange(rng, 0.08, 0.17) * (show ? Math.max(1, gap * 0.12) : Math.max(1, gap * 0.08));
      const col = wetColor(rng);
      if (!show || ceil - floor < 26) addInstance(stalactites, dummy, x, ceil - h1 * 0.5, z, r / 0.08, h1 / 0.6, r / 0.08, Math.PI, 0, 0, col);
      addInstance(stalagmites, dummy, x, floor + h2 * 0.5, z, r / 0.08 * 1.1, h2 / 0.6, r / 0.08 * 1.1, 0, 0, 0, col);
      placeOnFloor(x, z, floor, r * 0.9, h2);
    }
  }

  // Round 8 halls: a dripstone forest scaled to the room (giant stalagmites and stalactites,
  // floor-to-ceiling columns, rimstone dams on the floor, flowstone sheets on the walls).
  // Walkways from the hall's centre to each mouth stay clear.
  if (!show) for (const s of cave.stations) {
    if (s.kind !== "cavern") continue;
    const p = stationWorld(s);
    const R = Math.max(s.left, s.right) * 0.98;
    if (R < 6) continue;
    const floor = p.y - s.down;
    const ways = (nbrs.get(s.id) || []).map((id) => stationWorld(smap.get(id))).map((q) => ({ x: q.x - p.x, z: q.z - p.z }));
    const onWay = (x, z, w) => ways.some((d) => {
      const L = Math.hypot(d.x, d.z) || 1, t = Math.max(0, ((x - p.x) * d.x + (z - p.z) * d.z) / (L * L));
      return Math.hypot(x - p.x - d.x * t, z - p.z - d.z * t) < w;
    });
    const ceilAt = (rad) => p.y + s.up * 0.9 * Math.sqrt(Math.max(0, 1 - (rad / R) ** 2));
    const area = Math.PI * R * R;
    const N = Math.min(90, Math.round(area / 12));
    for (let i = 0; i < N; i++) {
      const ang = rng() * Math.PI * 2, rad = Math.sqrt(rng()) * R * 0.86;
      const x = p.x + Math.cos(ang) * rad, z = p.z + Math.sin(ang) * rad;
      if (onWay(x, z, 2.4)) continue;
      const ceil = ceilAt(rad), gap = ceil - floor;
      if (gap < 2.5) continue;
      const col = wetColor(rng), roll = rng();
      if (roll < 0.38) { // stalagmite, sometimes giant
        const h = Math.min(gap * 0.5, randRange(rng, 0.4, 1.6) * (rng() < 0.25 ? 3.2 : 1));
        const r = h * randRange(rng, 0.12, 0.2);
        addInstance(stalagmites, dummy, x, floor + h * 0.5, z, r / 0.08, h / 0.6, r / 0.08, 0, rng() * 6, 0, col);
        placeOnFloor(x, z, floor, r * 0.85, h);
      } else if (roll < 0.78) { // stalactite from the dome
        const h = Math.min(gap * 0.45, randRange(rng, 0.6, 2.4) * (rng() < 0.3 ? 2.6 : 1));
        const r = h * randRange(rng, 0.08, 0.14);
        addInstance(stalactites, dummy, x, ceil - h * 0.5, z, r / 0.08, h / 0.6, r / 0.08, Math.PI, rng() * 6, 0, col);
      } else if (roll < 0.83) { // column
        const r = randRange(rng, 0.3, 0.8) * Math.min(1.6, gap / 10);
        addInstance(columns, dummy, x, floor + gap * 0.5, z, r / 0.1, gap / 1.6, r / 0.1, 0, rng() * 6, 0, col);
        placeOnFloor(x, z, floor, r * 0.95, gap);
      } else { // rimstone dam: a low, wide terrace lip on the floor
        const r = randRange(rng, 0.7, 1.6), h = randRange(rng, 0.1, 0.22);
        addInstance(stalagmites, dummy, x, floor + h * 0.25, z, r / 0.08, h / 0.6, r / 0.08 * randRange(rng, 0.6, 1), 0, rng() * 6, 0, col);
      }
    }
    // Flowstone curtains around the hall wall
    const nf = Math.round(R * 1.2);
    for (let i = 0; i < nf; i++) {
      const ang = (i / nf) * Math.PI * 2 + rng() * 0.3;
      const rad = R * 0.9, x = p.x + Math.cos(ang) * rad, z = p.z + Math.sin(ang) * rad;
      if (onWay(x, z, 3.2)) continue;
      const h = randRange(rng, 2.5, Math.min(9, s.up * 0.5)), w = randRange(rng, 1.2, 3.2);
      addInstance(drapes, dummy, x, floor, z, w, h, 1.4, 0, Math.atan2(Math.cos(ang), Math.sin(ang)), 0, wetColor(rng));
    }
  }

  // Flowstone / drapery on walls, no collision (thin, on the wall).
  alongLegs((a, b, pa, pb, fr) => {
    if (a.clearance === "crawl" || b.clearance === "crawl") return;
    const chamberish = a.kind === "cavern" || b.kind === "chamber" || a.kind === "chamber" || b.kind === "cavern";
    const n = (a.kind === "cavern" || b.kind === "cavern") ? 4 + Math.floor(rng() * 4) : chamberish ? 2 + Math.floor(rng() * 3) : (rng() < 0.35 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const t = randRange(rng, 0.15, 0.85);
      const x = pa.x + (pb.x - pa.x) * t;
      const y = pa.y + (pb.y - pa.y) * t;
      const z = pa.z + (pb.z - pa.z) * t;
      const left = a.left + (b.left - a.left) * t;
      const right = a.right + (b.right - a.right) * t;
      const up = a.up + (b.up - a.up) * t;
      const down = a.down + (b.down - a.down) * t;
      const side = rng() < 0.5 ? -1 : 1;
      const half = side < 0 ? left : right;
      const lat = half * 0.92;
      const fx = x + fr.rx * side * lat;
      const fz = z + fr.rz * side * lat;
      const fy = y - down * 0.05;
      const h = randRange(rng, 0.8, Math.min(2.4, up + down) * 0.85) * (show ? 3 : 1);
      const w = randRange(rng, 0.35, 0.9) * (show ? 2.5 : 1);
      const yaw = Math.atan2(fr.rx * side, fr.rz * side);
      addInstance(drapes, dummy, fx, fy, fz, w, h, 1, 0, yaw, 0, wetColor(rng));
    }
  });

  function instanced(geometry0, items) {
    if (!items.length || opts.defer) return null;
    const geometry = geometry0.clone();
    const bake = new Float32Array(items.length);
    const tmp = new THREE.Vector3();
    for (let i = 0; i < items.length; i++) {
      tmp.setFromMatrixPosition(items[i].matrix);
      bake[i] = lookup && lookup.any ? lookup.at(tmp.x, tmp.y, tmp.z) : 0;
    }
    geometry.setAttribute("aBake", new THREE.InstancedBufferAttribute(bake, 1));
    const mesh = new THREE.InstancedMesh(geometry, wet, items.length);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const hasColor = !!mesh.instanceColor || true;
    for (let i = 0; i < items.length; i++) {
      mesh.setMatrixAt(i, items[i].matrix);
      mesh.setColorAt(i, items[i].color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  }

  // Phones get lighter dripstone (about 40% fewer triangles on the biggest instanced layer).
  const lite = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  const stalGeo = lite ? makeDripstoneGeometry(show ? 7 : 6, show ? 8 : 7) : makeDripstoneGeometry(show ? 9 : 8, show ? 10 : 9);
  const colGeo = new THREE.CylinderGeometry(0.1, 0.13, 1.6, 7);
  displaceOnce(colGeo, 0.07);
  const strawGeo = new THREE.CylinderGeometry(0.012, 0.016, 0.3, 5);
  const drapeGeo = makeDrapeGeometry();

  const meshes = {
    stalactites: instanced(stalGeo, stalactites),
    stalagmites: instanced(stalGeo, stalagmites),
    columns: instanced(colGeo, columns),
    straws: instanced(strawGeo, straws),
    drapes: instanced(drapeGeo, drapes),
  };
  const named = addNamedFeatures(group, cave, wet, lookup, obstacles, opts.defer ? () => false : null);

  return {
    obstacles,
    counts: {
      stalactites: stalactites.length,
      stalagmites: stalagmites.length,
      columns: columns.length,
      straws: straws.length,
      drapes: drapes.length,
      named,
    },
    meshes,
    // Resident instance data (matrices + colours) and shared template geometries, so a
    // streaming chunk can build just its own instances.
    lists: { stalactites, stalagmites, columns, straws, drapes },
    geos: { stalactites: stalGeo, stalagmites: stalGeo, columns: colGeo, straws: strawGeo, drapes: drapeGeo },
  };
}

/** One InstancedMesh for a subset of instances (a chunk). Geometry is shared: never disposed here. */
export function buildInstanced(geometry, items, material) {
  if (!items.length) return null;
  if (!geometry.attributes.aBake) geometry.setAttribute("aBake", new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count), 1));
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  for (let i = 0; i < items.length; i++) {
    mesh.setMatrixAt(i, items[i].matrix);
    mesh.setColorAt(i, items[i].color);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.userData.sharedGeometry = true;
  return mesh;
}

function displaceOnce(geometry, amount) {
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = (fbm3(v.x * 7, v.y * 7, v.z * 7, 3) - 0.5) * 2 * amount;
    v.x *= 1 + n;
    v.z *= 1 + n;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

function makeDrapeGeometry() {
  const geo = new THREE.PlaneGeometry(1, 1, 5, 8);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const wave = Math.sin(v.x * Math.PI * 2) * 0.08 + Math.sin(v.y * 9) * 0.03;
    v.z = wave + (0.5 - v.y) * 0.12;
    v.x *= 1 + Math.sin(v.y * 6) * 0.08;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.translate(0, 0, 0.02);
  return geo;
}

/**
 * Dripstone with growth tiers (stacked bulges), vertical fluting ridges and a
 * rounded tip. Canonical size matches the old cone (radius 0.08, height 0.6,
 * centred) so instances scale the same way.
 */
function makeDripstoneGeometry(radial = 10, rows = 12) {
  const pos = [], idx = [];
  for (let r = 0; r <= rows; r++) {
    const h = r / rows; // 0 base .. 1 tip
    const taper = Math.pow(1 - h, 0.85);
    const tiers = 1 + 0.16 * Math.pow(Math.sin(h * Math.PI * 4.5), 2) * (1 - h);
    const tip = h > 0.92 ? Math.cos(((h - 0.92) / 0.08) * Math.PI * 0.5) : 1;
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const flute = 1 + 0.1 * Math.sin(a * 7 + h * 3) + 0.05 * Math.sin(a * 3 - h * 5);
      const rad = 0.08 * Math.max(0.02, taper * tiers * flute * tip);
      pos.push(Math.cos(a) * rad, h * 0.6 - 0.3, Math.sin(a) * rad);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < radial; k++) {
      const i0 = r * (radial + 1) + k;
      idx.push(i0, i0 + radial + 1, i0 + 1, i0 + 1, i0 + radial + 1, i0 + radial + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Lathe-like formation with a custom radius profile r(h) (h 0..1) and lumpy surface. */
function profileMesh(profile, H, R, radial, rows, lump, seed) {
  const pos = [], idx = [];
  for (let r = 0; r <= rows; r++) {
    const h = r / rows;
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      let rad = R * profile(h, a);
      const x0 = Math.cos(a), z0 = Math.sin(a);
      // Popcorn / coralloid lumps.
      rad *= 1 + (fbm3(x0 * 1.6 + seed, h * H * 0.18, z0 * 1.6, 3) - 0.5) * lump + (fbm3(x0 * 9 + seed, h * H * 1.4, z0 * 9, 2) - 0.5) * lump * 0.35;
      pos.push(x0 * rad, h * H, z0 * rad);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < radial; k++) {
      const i0 = r * (radial + 1) + k;
      idx.push(i0, i0 + radial + 1, i0 + 1, i0 + 1, i0 + radial + 1, i0 + radial + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const PROFILES = {
  // Beehive dome: broad base, stacked tiers, rounded crown (Giant Dome, Twin Domes, Rock of Ages).
  dome: (h, a) => Math.pow(Math.max(0, 1 - Math.pow(h, 3.2)), 0.42) * (1 - 0.18 * h) * (1 + 0.035 * Math.pow(Math.sin(h * Math.PI * 5 + Math.sin(a * 2) * 1.5), 2)) * (1 + 0.05 * Math.sin(a * 5 + h * 4) + 0.04 * Math.sin(a * 11 - h * 9)),
  // Totem pole: slim, many bulging rings.
  totem: (h, a) => (0.75 + 0.3 * Math.pow(Math.sin(h * Math.PI * 11), 2)) * (h > 0.94 ? Math.cos((h - 0.94) / 0.06 * 1.4) : 1) * (1 + 0.05 * Math.sin(a * 6)),
  // Floor-to-ceiling column: flared base and top, fluted.
  column: (h, a) => (0.55 + 0.45 * Math.pow(Math.abs(h - 0.5) * 2, 3)) * (1 + 0.12 * Math.sin(a * 8 + h * 6)) * (1 + 0.08 * Math.pow(Math.sin(h * Math.PI * 9), 2)),
};

/** Push a point horizontally away from every leg's centre line until it is at least `clear` away. */
function clearOfTrail(cave, smap, x, z, clear) {
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    for (const leg of cave.legs) {
      const a = smap.get(leg.from), b = smap.get(leg.to);
      if (!a || !b) continue;
      const pa = stationWorld(a), pb = stationWorld(b);
      const dx = pb.x - pa.x, dz = pb.z - pa.z, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - pa.x) * dx + (z - pa.z) * dz) / L2));
      const cx = pa.x + dx * t, cz = pa.z + dz * t;
      let ox = x - cx, oz = z - cz, d = Math.hypot(ox, oz);
      if (d >= clear) continue;
      if (d < 1e-3) { const L = Math.sqrt(L2); ox = -dz / L; oz = dx / L; d = 1; }
      x = cx + (ox / d) * clear; z = cz + (oz / d) * clear;
      moved = true;
    }
    if (!moved) break;
  }
  return [x, z];
}

/** Named formations from the survey (Giant Dome, Totem Pole, Iceberg Rock, ...). */
export function addNamedFeatures(group, cave, material, lookup, obstacles, filter = null) {
  const feats = cave.features || [];
  if (!feats.length) return 0;
  const smap = stationMap(cave);
  let n = 0;
  for (const f of feats) {
    const s = smap.get(f.near);
    if (!s) continue;
    const p = stationWorld(s);
    let x = p.x + (f.dx || 0), z = p.z - (f.dy || 0);
    const floor = p.y - s.down;
    const H = f.h || 6, R = f.r || 2;
    // Keep big formations (and their colliders) clear of the walking line / trail.
    if (f.type !== "drapes") [x, z] = clearOfTrail(cave, smap, x, z, R * 1.25 + 2.6);
    // Streaming: colliders are always registered; meshes only for the requested chunk.
    if (filter && !filter(x, floor, z)) {
      if (f.type === "pit") obstacles.push({ x, z, y: floor, radius: R + 0.3, height: 3, kind: "pit" });
      else if (f.type !== "drapes" && ["dome", "totem", "column", "boulder"].includes(f.type)) obstacles.push({ x, z, y: floor, radius: R * (f.type === "boulder" ? 1.2 : 0.9), height: H, kind: "formation" });
      n++;
      continue;
    }
    let geo = null;
    if (f.type === "dome") geo = profileMesh(PROFILES.dome, H, R, 48, 44, 0.42, n * 3.1);
    else if (f.type === "totem") geo = profileMesh(PROFILES.totem, H, R, 18, 48, 0.12, n * 3.1);
    else if (f.type === "column") geo = profileMesh(PROFILES.column, H, R, 32, 40, 0.18, n * 3.1);
    else if (f.type === "boulder") {
      geo = new THREE.IcosahedronGeometry(1, 4);
      const pa = geo.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i);
        const k = 1 + (fbm3(v.x * 1.7 + 4, v.y * 1.7, v.z * 1.7, 4) - 0.5) * 0.7;
        pa.setXYZ(i, v.x * R * 1.4 * k, Math.max(-0.1, v.y) * H * 0.55 * k, v.z * R * k);
      }
      geo.computeVertexNormals();
    } else if (f.type === "drapes") {
      // A mouth of hanging draperies: several big curtains in an arc.
      for (let i = 0; i < 9; i++) {
        const a = -1.2 + (i / 8) * 2.4;
        const d = makeCurtain(R * 0.5, H * (0.5 + 0.5 * Math.sin(i * 1.7) ** 2));
        const m = new THREE.Mesh(d, material);
        m.position.set(x + Math.sin(a) * R * 2, p.y + s.up * 0.8, z + Math.cos(a) * R * 2);
        m.rotation.y = a;
        addBake(d, lookup, m.position.x, m.position.y - H * 0.5, m.position.z);
        group.add(m);
      }
      n++;
      continue;
    } else if (f.type === "pit") {
      const pit = new THREE.Mesh(new THREE.CircleGeometry(R, 40), new THREE.MeshBasicMaterial({ color: 0x020101 }));
      pit.rotation.x = -Math.PI / 2;
      pit.position.set(x, floor + 0.14, z);
      group.add(pit);
      const rim = profileMesh((h) => 1 + h * 0.06, 0.5, R * 1.02, 48, 2, 0.1, 9);
      const rm = new THREE.Mesh(rim, material);
      rm.position.set(x, floor - 0.3, z);
      addBake(rim, lookup, x, floor, z);
      group.add(rm);
      obstacles.push({ x, z, y: floor, radius: R + 0.3, height: 3, kind: "pit" });
      n++;
      continue;
    }
    if (!geo) continue;
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, floor - 0.2, z);
    m.rotation.y = n * 1.3;
    addBake(geo, lookup, x, floor + H * 0.4, z, 0.35);
    group.add(m);
    if (f.type !== "boulder" || true) obstacles.push({ x, z, y: floor, radius: R * (f.type === "boulder" ? 1.2 : 0.9), height: H, kind: "formation" });
    n++;
  }
  return n;
}

function addBake(geo, lookup, x, y, z, extra = 0) {
  const v = (lookup && lookup.any ? lookup.at(x, y, z) : 0) + (lookup && lookup.any ? extra : 0);
  const arr = new Float32Array(geo.attributes.position.count).fill(v);
  // Fade the floodlight with height on tall pieces so tops fall into shadow.
  const pa = geo.attributes.position;
  let maxY = 0;
  for (let i = 0; i < pa.count; i++) maxY = Math.max(maxY, pa.getY(i));
  if (maxY > 0) for (let i = 0; i < pa.count; i++) arr[i] = v * (1.15 - 0.6 * Math.max(0, pa.getY(i)) / maxY);
  geo.setAttribute("aBake", new THREE.BufferAttribute(arr, 1));
}

function makeCurtain(w, h) {
  const geo = new THREE.PlaneGeometry(w, h, 10, 14);
  const pa = geo.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i);
    pa.setZ(i, Math.sin(x * 9) * 0.35 * w * 0.3 + Math.sin(y * 2) * 0.1);
    pa.setX(i, x * (1 - 0.3 * (0.5 - y / h)));
  }
  geo.translate(0, -h / 2, 0);
  geo.computeVertexNormals();
  return geo;
}
