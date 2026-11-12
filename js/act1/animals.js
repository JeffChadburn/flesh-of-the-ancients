/**
 * Overworld wildlife: rabbits, birds and a small deer herd near the camp, plus a roaming population
 * (rabbits, birds, deer, boar, goats, foxes) streamed per 64 m cell around the player.
 * Simple, readable AI: idle / graze / wander -> alert -> flee (rabbits zig-zag, birds fly off
 * and land again, deer bolt as a group). How close Kra can get depends on stance and speed
 * (crouch-walk to stalk). Spear hits kill (deer need two unless Kra has Blood Memory: Strength);
 * the carcass is harvested with the stone knife.
 */
import * as THREE from "three";
import { mulberry32 } from "../rng.js";
import { fbm2 } from "../world/terrain.js";

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
const S = (g, x, y, z) => { g.scale(x, y, z); return g; };

const SPEC = {
  // alert radii: [still, walking, running, crouched-moving]; flee speed; calm distance; hits to kill
  // Round 9 (easier hunting): flee speeds ~halved, alert radii ~-40%, shorter flights (fleeT),
  // bigger spear reach. Old values in comments.
  rabbit: { r: [2.5, 5.5, 9, 1.6], speed: 3.2, calm: 14, hits: 1, reach: 3.8, wander: 0.6, fleeT: 2.5 }, // was r [4,9,15,2.6], speed 6.2, calm 26, reach 2.9
  bird:   { r: [2.5, 5, 8, 1.6], speed: 4.0, calm: 16, hits: 1, reach: 3.8, wander: 0.5, fleeT: 3 },    // was speed 7.5
  deer:   { r: [6, 14, 20, 2.6], speed: 4.2, calm: 24, hits: 1, reach: 4.2, wander: 0.8, fleeT: 3.5 },  // was r [10,24,34,4.2], speed 8.2, calm 45, hits 2
  boar:   { r: [4.5, 10, 15, 2.2], speed: 3.5, calm: 18, hits: 2, reach: 4.0, wander: 0.5, fleeT: 3 },  // was speed 6.8, calm 35
  goat:   { r: [5.5, 12, 18, 2.4], speed: 3.8, calm: 20, hits: 1, reach: 4.0, wander: 0.5, fleeT: 3, climb: true }, // was speed 7.4
  fox:    { r: [3.5, 7, 12, 1.8], speed: 4.0, calm: 15, hits: 1, reach: 3.8, wander: 0.7, fleeT: 2.5 }, // was speed 7.8
  // Round 12: wild horses. Calm grazers: walking up only makes them watch you (so you can mount),
  // running at them or hurting them makes the herd bolt.
  horse:  { r: [2, 4.5, 16, 1.5], speed: 7.0, calm: 30, hits: 2, reach: 4.6, wander: 0.9, fleeT: 4, calmHerd: true },
};
const QUAD = { deer: { geo: "deerBody", leg: "leg", hip: 0.86, lx: 0.15, lz: 0.42 }, boar: { geo: "boarBody", leg: "legShort", hip: 0.42, lx: 0.16, lz: 0.36 },
  goat: { geo: "goatBody", leg: "legGoat", hip: 0.6, lx: 0.12, lz: 0.3 }, fox: { geo: "foxBody", leg: "legFox", hip: 0.3, lx: 0.08, lz: 0.2 },
  horse: { geo: "horseBay", geo2: "horseDun", leg: "legHorse", leg2: "legHorseDun", hip: 1.14, lx: 0.2, lz: 0.56 } };
/** Roaming species per streamed 64 m cell: [kind, weight, group size range]. */
const ROAM = [["rabbit", 0.24, [1, 3]], ["bird", 0.14, [2, 3]], ["deer", 0.16, [2, 4]], ["boar", 0.18, [1, 3]], ["goat", 0.12, [2, 3]], ["fox", 0.16, [1, 1]]];
export const ANIMAL_YIELD = {
  rabbit: [["meat", 1], ["pelt", 1], ["organ", 1]],
  bird: [["meat", 1], ["feather", 2]],
  deer: [["hide", 1], ["meat", 2], ["organ", 1]],
  boar: [["meat", 3], ["hide", 1], ["organ", 1]],
  goat: [["meat", 2], ["hide", 1]],
  fox: [["pelt", 1], ["meat", 1]],
  horse: [["meat", 4], ["hide", 2], ["organ", 1]],
};

export class Wildlife {
  constructor(terrain, scene, { lite = false } = {}) {
    this.t = terrain;
    this.scene = scene;
    this.rng = mulberry32(terrain.seed ^ 0x0a11);
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.geos = this._geos();
    this.list = [];
    this.group = new THREE.Group();
    this.group.name = "wildlife";
    scene.add(this.group);
    this.log = [];
    this.lite = lite;
    // Roaming population streamed per 64 m cell around the player (spawned when a cell comes into
    // range, dropped when it leaves; coming back later restocks it — that's the respawn).
    this.cells = new Map();
    this.cellSize = 64;
    this.cellR = lite ? 1 : 2;
    this.streamT = 0;
    this.camp = terrain.act1 ? terrain.act1.camp : null;
    const C = this.camp;
    if (C) {
      // round 9: 3x the camp's wildlife (was 5 rabbits, 4 birds, one herd of 4)
      for (let i = 0; i < (lite ? 10 : 15); i++) this._spawn("rabbit", C, 18, 80);
      for (let i = 0; i < (lite ? 8 : 12); i++) this._spawn("bird", C, 16, 70);
      for (let h = 0; h < (lite ? 2 : 3); h++) this._spawnHerd(C, lite ? 3 : 4);
      // round 12: a wild-horse herd grazing within a short walk of the camp
      this._spawnHorses(this._place(C, 45, 85), lite ? 3 : 4, "camp");
    }
  }

  _cellSpawn(cx, cz) {
    const S = this.cellSize, list = [];
    let h = (cx * 73856093) ^ (cz * 19349663) ^ this.t.seed ^ 0x5eed;
    const visits = (this.visits || (this.visits = new Map()));
    const key = cx + "," + cz, v = (visits.get(key) || 0) + 1; visits.set(key, v);
    const rng = mulberry32((h ^ (v * 0x9e3779b1)) >>> 0);
    const mx = (cx + 0.5) * S, mz = (cz + 0.5) * S;
    if (this.camp && Math.hypot(mx - this.camp.x, mz - this.camp.z) < 70) return list; // the camp has its own
    const groups = this.lite ? 3 + (rng() < 0.6 ? 1 : 0) : 4 + (rng() < 0.6 ? 1 : 0); // round 9: 3x (was 1-2)
    const cap = this.lite ? 110 : 280;
    // round 12: wild-horse herds on open grassland (low forest density), ~1 cell in 4
    const open = fbm2(mx / 120, mz / 120, 3, this.t.s + 11) < 0.5;
    if (open && rng() < (this.lite ? 0.18 : 0.26) && this.list.length < cap - 5) {
      for (let k = 0; k < 10; k++) {
        const x = cx * S + 8 + rng() * (S - 16), z = cz * S + 8 + rng() * (S - 16);
        if (this.t.slope(x, z).m > 0.4 || this.t.inClearing?.(x, z) || this.t.streamDist(x, z) < 4) continue;
        if (this.t.entrances?.some((e) => Math.hypot(e.x - x, e.z - z) < 25)) continue;
        for (const a of this._spawnHorses({ x, z }, 3 + Math.floor(rng() * 3), key, rng)) { a.cell = key; list.push(a); }
        break;
      }
    }
    for (let g = 0; g < groups; g++) {
      if (this.list.length >= cap) break;
      let roll = rng(), kind = ROAM[0];
      for (const k of ROAM) { if ((roll -= k[1]) <= 0) { kind = k; break; } }
      const [name, , [n0, n1]] = kind;
      const maxSlope = SPEC[name].climb ? 1.3 : 0.55;
      let c = null;
      for (let k = 0; k < 14 && !c; k++) {
        const x = cx * S + rng() * S, z = cz * S + rng() * S;
        const m = this.t.slope(x, z).m;
        if (m > maxSlope || (SPEC[name].climb && m < 0.25 && k < 10)) continue;
        if (this.t.streamDist(x, z) < 3 || this.t.inClearing?.(x, z)) continue;
        if (this.t.entrances?.some((e) => Math.hypot(e.x - x, e.z - z) < 10)) continue;
        c = { x, z };
      }
      if (!c) continue;
      const n = n0 + Math.floor(rng() * (n1 - n0 + 1));
      const herd = n > 1 && name !== "rabbit" && name !== "bird" ? { id: "herd" + key + g, alert: 0 } : null;
      for (let i = 0; i < n; i++) {
        const at = { x: c.x + Math.cos(i * 2.2 + g) * (1.5 + i), z: c.z + Math.sin(i * 2.2 + g) * (1.5 + i) };
        const a = this._spawn(name, null, 0, 0, at, herd, name === "deer" && i === 0);
        a.cell = key; list.push(a);
      }
    }
    return list;
  }

  /** Keep the roaming population streamed around the player. */
  _stream(P) {
    const S = this.cellSize, pcx = Math.floor(P.x / S), pcz = Math.floor(P.z / S), R = this.cellR;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const key = (pcx + dx) + "," + (pcz + dz);
      if (!this.cells.has(key)) this.cells.set(key, this._cellSpawn(pcx + dx, pcz + dz));
    }
    for (const [key, list] of this.cells) {
      const [cx, cz] = key.split(",").map(Number);
      if (Math.abs(cx - pcx) <= R + 1 && Math.abs(cz - pcz) <= R + 1) continue;
      for (const a of list) { this.group.remove(a.root); const i = this.list.indexOf(a); if (i >= 0) this.list.splice(i, 1); }
      this.cells.delete(key);
    }
  }

  _geos() {
    const rab = merged([
      [S(T(new THREE.SphereGeometry(0.2, 7, 5), 0, 0.2, 0), 0.85, 0.8, 1.35), 0x8a7a64],
      [T(new THREE.SphereGeometry(0.11, 6, 5), 0, 0.34, -0.25), 0x8f7f68],
      [T(S(new THREE.BoxGeometry(0.04, 0.22, 0.07), 1, 1, 1), -0.04, 0.5, -0.22), 0x9a876c],
      [T(S(new THREE.BoxGeometry(0.04, 0.22, 0.07), 1, 1, 1), 0.04, 0.5, -0.22), 0x9a876c],
      [T(new THREE.SphereGeometry(0.06, 5, 4), 0, 0.26, 0.27), 0xeeeae2],
      [T(new THREE.SphereGeometry(0.02, 4, 3), -0.06, 0.37, -0.33), 0x111111],
      [T(new THREE.SphereGeometry(0.02, 4, 3), 0.06, 0.37, -0.33), 0x111111],
    ]);
    const birdBody = merged([
      [S(T(new THREE.SphereGeometry(0.09, 6, 5), 0, 0.12, 0), 0.9, 0.85, 1.6), 0x3b3a40],
      [T(new THREE.SphereGeometry(0.06, 6, 5), 0, 0.2, -0.12), 0x2e2d33],
      [T(new THREE.ConeGeometry(0.02, 0.07, 4).rotateX(-Math.PI / 2), 0, 0.2, -0.19), 0xd08a2a],
      [T(S(new THREE.BoxGeometry(0.08, 0.015, 0.12), 1, 1, 1), 0, 0.13, 0.17), 0x2a292e],
    ]);
    const wing = merged([[T(new THREE.BoxGeometry(0.22, 0.012, 0.11), 0.11, 0, 0), 0x45444c]]);
    const deerBody = merged([
      [S(T(new THREE.CapsuleGeometry(0.27, 0.75, 3, 7).rotateX(Math.PI / 2), 0, 1.05, 0), 1, 1.05, 1), 0x8a6040],
      [T(new THREE.CylinderGeometry(0.1, 0.15, 0.6, 6).rotateX(0.65), 0, 1.38, -0.55), 0x86603f],
      [S(T(new THREE.BoxGeometry(0.17, 0.2, 0.36), 0, 1.66, -0.78), 1, 1, 1), 0x7c583a],
      [T(new THREE.ConeGeometry(0.05, 0.16, 4), -0.09, 1.82, -0.68), 0x6a4a30],
      [T(new THREE.ConeGeometry(0.05, 0.16, 4), 0.09, 1.82, -0.68), 0x6a4a30],
      [T(new THREE.SphereGeometry(0.07, 5, 4), 0, 1.15, 0.58), 0xf0ece4],
      [S(T(new THREE.SphereGeometry(0.2, 6, 5), 0, 0.95, 0), 1.2, 0.6, 2.6), 0xc8a888],
      [T(new THREE.SphereGeometry(0.025, 4, 3), -0.08, 1.7, -0.92), 0x111111],
      [T(new THREE.SphereGeometry(0.025, 4, 3), 0.08, 1.7, -0.92), 0x111111],
    ]);
    const antlers = merged([
      [T(new THREE.CylinderGeometry(0.018, 0.025, 0.4, 4).rotateZ(0.5), -0.14, 1.95, -0.7), 0xd9ccb0],
      [T(new THREE.CylinderGeometry(0.018, 0.025, 0.4, 4).rotateZ(-0.5), 0.14, 1.95, -0.7), 0xd9ccb0],
      [T(new THREE.CylinderGeometry(0.014, 0.018, 0.22, 4).rotateX(-0.6), -0.2, 2.08, -0.8), 0xd9ccb0],
      [T(new THREE.CylinderGeometry(0.014, 0.018, 0.22, 4).rotateX(-0.6), 0.2, 2.08, -0.8), 0xd9ccb0],
    ]);
    const leg = merged([[T(new THREE.CylinderGeometry(0.035, 0.05, 0.85, 5), 0, -0.42, 0), 0x6e4c32]]);
    const boarBody = merged([
      [S(T(new THREE.CapsuleGeometry(0.3, 0.55, 3, 7).rotateX(Math.PI / 2), 0, 0.62, 0), 1, 1.05, 1), 0x3e3128],
      [S(T(new THREE.BoxGeometry(0.1, 0.16, 0.7), 0, 0.92, -0.05), 1, 1, 1), 0x2a211b],
      [S(T(new THREE.SphereGeometry(0.22, 7, 5), 0, 0.6, -0.55), 1, 0.95, 1.25), 0x46372c],
      [T(new THREE.CylinderGeometry(0.08, 0.1, 0.12, 6).rotateX(Math.PI / 2), 0, 0.55, -0.82), 0x6a5040],
      [T(new THREE.ConeGeometry(0.025, 0.14, 4).rotateX(-2.2), -0.09, 0.5, -0.76), 0xe8e0cc],
      [T(new THREE.ConeGeometry(0.025, 0.14, 4).rotateX(-2.2), 0.09, 0.5, -0.76), 0xe8e0cc],
      [T(new THREE.ConeGeometry(0.06, 0.12, 4), -0.12, 0.82, -0.5), 0x2e241d],
      [T(new THREE.ConeGeometry(0.06, 0.12, 4), 0.12, 0.82, -0.5), 0x2e241d],
      [T(new THREE.SphereGeometry(0.025, 4, 3), -0.1, 0.68, -0.72), 0x111111],
      [T(new THREE.SphereGeometry(0.025, 4, 3), 0.1, 0.68, -0.72), 0x111111],
    ]);
    const goatBody = merged([
      [S(T(new THREE.CapsuleGeometry(0.22, 0.5, 3, 7).rotateX(Math.PI / 2), 0, 0.78, 0), 1, 1.05, 1), 0xc9c1b2],
      [T(new THREE.CylinderGeometry(0.08, 0.11, 0.38, 6).rotateX(0.5), 0, 1.0, -0.4), 0xbfb6a6],
      [S(T(new THREE.BoxGeometry(0.15, 0.17, 0.3), 0, 1.2, -0.56), 1, 1, 1), 0xb3aa99],
      [T(new THREE.TorusGeometry(0.1, 0.022, 4, 8, Math.PI * 1.2).rotateY(Math.PI / 2), -0.07, 1.32, -0.48), 0x5b5248],
      [T(new THREE.TorusGeometry(0.1, 0.022, 4, 8, Math.PI * 1.2).rotateY(Math.PI / 2), 0.07, 1.32, -0.48), 0x5b5248],
      [T(new THREE.ConeGeometry(0.03, 0.12, 4).rotateX(Math.PI), 0, 1.05, -0.68), 0xe0d8c8],
      [T(new THREE.SphereGeometry(0.02, 4, 3), -0.07, 1.25, -0.7), 0x111111],
      [T(new THREE.SphereGeometry(0.02, 4, 3), 0.07, 1.25, -0.7), 0x111111],
    ]);
    const foxBody = merged([
      [S(T(new THREE.CapsuleGeometry(0.12, 0.42, 3, 7).rotateX(Math.PI / 2), 0, 0.38, 0), 1, 1, 1), 0xc0602a],
      [S(T(new THREE.SphereGeometry(0.12, 7, 5), 0, 0.46, -0.36), 1, 0.9, 1.1), 0xc8662c],
      [T(new THREE.ConeGeometry(0.05, 0.16, 5).rotateX(-Math.PI / 2), 0, 0.43, -0.52), 0xd8d0c4],
      [T(new THREE.ConeGeometry(0.045, 0.12, 4), -0.06, 0.6, -0.34), 0x3a2418],
      [T(new THREE.ConeGeometry(0.045, 0.12, 4), 0.06, 0.6, -0.34), 0x3a2418],
      [S(T(new THREE.SphereGeometry(0.09, 6, 5), 0, 0.4, 0.42), 1, 0.9, 2.6), 0xb85a26],
      [T(new THREE.SphereGeometry(0.05, 5, 4), 0, 0.42, 0.64), 0xf2ece2],
      [T(new THREE.SphereGeometry(0.015, 4, 3), -0.05, 0.5, -0.46), 0x111111],
      [T(new THREE.SphereGeometry(0.015, 4, 3), 0.05, 0.5, -0.46), 0x111111],
    ]);
    const legShort = merged([[T(new THREE.CylinderGeometry(0.045, 0.055, 0.42, 5), 0, -0.21, 0), 0x2a211b]]);
    const legGoat = merged([[T(new THREE.CylinderGeometry(0.03, 0.04, 0.6, 5), 0, -0.3, 0), 0x8f8676]]);
    const legFox = merged([[T(new THREE.CylinderGeometry(0.02, 0.025, 0.3, 4), 0, -0.15, 0), 0x2a1a12]]);
    // Round 12: horse (Przewalski-like: stocky, upright dark mane), bay and dun coats; faces -z
    const horse = (coat, dark, belly) => merged([
      [S(T(new THREE.CapsuleGeometry(0.36, 1.05, 3, 8).rotateX(Math.PI / 2), 0, 1.36, 0), 1, 1.1, 1), coat],
      [T(new THREE.CylinderGeometry(0.15, 0.25, 0.8, 7).rotateX(-0.63), 0, 1.72, -0.86), coat],
      [T(new THREE.BoxGeometry(0.07, 0.86, 0.13).rotateX(-0.63), 0, 1.84, -0.78), dark],
      [T(new THREE.BoxGeometry(0.22, 0.26, 0.62).rotateX(-0.7), 0, 1.86, -1.3), coat],
      [T(new THREE.BoxGeometry(0.2, 0.17, 0.2).rotateX(-0.7), 0, 1.66, -1.53), 0x2a2220],
      [T(new THREE.ConeGeometry(0.045, 0.16, 4), -0.07, 2.17, -1.1), dark],
      [T(new THREE.ConeGeometry(0.045, 0.16, 4), 0.07, 2.17, -1.1), dark],
      [T(new THREE.CylinderGeometry(0.03, 0.09, 0.85, 5).rotateX(-0.45), 0, 1.15, 1.0), dark],
      [S(T(new THREE.SphereGeometry(0.3, 7, 5), 0, 1.14, 0), 1.0, 0.55, 2.1), belly],
      [T(new THREE.SphereGeometry(0.028, 4, 3), -0.115, 1.95, -1.36), 0x111111],
      [T(new THREE.SphereGeometry(0.028, 4, 3), 0.115, 1.95, -1.36), 0x111111],
    ]);
    const horseBay = horse(0x7a4a2a, 0x24170f, 0x8e6444), horseDun = horse(0xb3905e, 0x3a2a1c, 0xd0b58a);
    const legH = (c) => merged([[T(new THREE.CylinderGeometry(0.065, 0.075, 1.0, 6), 0, -0.5, 0), c], [T(new THREE.CylinderGeometry(0.07, 0.085, 0.14, 6), 0, -1.07, 0), 0x1c1612]]);
    const legHorse = legH(0x3a2618), legHorseDun = legH(0x4a3626);
    return { rab, birdBody, wing, deerBody, antlers, leg, boarBody, goatBody, foxBody, legShort, legGoat, legFox, horseBay, horseDun, legHorse, legHorseDun };
  }

  _place(C, rmin, rmax) {
    for (let k = 0; k < 40; k++) {
      const a = this.rng() * Math.PI * 2, d = rmin + this.rng() * (rmax - rmin);
      const x = C.x + Math.cos(a) * d, z = C.z + Math.sin(a) * d;
      if (this.t.slope(x, z).m < 0.55 && this.t.streamDist(x, z) > 3) return { x, z };
    }
    return { x: C.x + rmax, z: C.z };
  }

  _make(kind, buck = false) {
    const root = new THREE.Group();
    const parts = {};
    if (kind === "rabbit") { parts.body = new THREE.Mesh(this.geos.rab, this.mat); root.add(parts.body); }
    else if (kind === "bird") {
      parts.body = new THREE.Mesh(this.geos.birdBody, this.mat); root.add(parts.body);
      parts.wl = new THREE.Mesh(this.geos.wing, this.mat); parts.wl.position.set(0.05, 0.15, 0); parts.wl.rotation.y = 0;
      parts.wr = new THREE.Mesh(this.geos.wing, this.mat); parts.wr.position.set(-0.05, 0.15, 0); parts.wr.rotation.y = Math.PI;
      root.add(parts.wl, parts.wr);
    } else {
      const q = QUAD[kind];
      const alt = kind === "horse" && buck; // horses: "buck" picks the dun coat
      parts.body = new THREE.Mesh(this.geos[alt ? q.geo2 : q.geo], this.mat); root.add(parts.body);
      if (buck && kind === "deer") root.add(new THREE.Mesh(this.geos.antlers, this.mat));
      parts.legs = [];
      for (const [x, z] of [[-q.lx, -q.lz], [q.lx, -q.lz], [-q.lx, q.lz], [q.lx, q.lz]]) {
        const l = new THREE.Mesh(this.geos[alt ? q.leg2 : q.leg], this.mat); l.position.set(x, q.hip, z); root.add(l); parts.legs.push(l);
      }
    }
    root.traverse((o) => { o.userData.sharedGeometry = true; });
    this.group.add(root);
    return { root, parts };
  }

  _spawn(kind, C, rmin, rmax, at = null, herd = null, buck = false) {
    const p = at || this._place(C, rmin, rmax);
    const m = this._make(kind, buck);
    const a = {
      id: kind + (this.nextId = (this.nextId || 0) + 1), kind, spec: SPEC[kind], pos: new THREE.Vector3(p.x, this.t.height(p.x, p.z), p.z), yaw: this.rng() * 6.28,
      state: "idle", stateT: this.rng() * 3, health: SPEC[kind].hits, herd, alive: true, harvested: false, fly: 0, phase: this.rng() * 10, ...m,
      goal: null, flee: null, deadT: 0, home: { x: p.x, z: p.z },
    };
    this.list.push(a);
    return a;
  }

  _spawnHorses(c, n, tag, rng = this.rng) {
    const herd = { id: "horses" + tag + (this.list.length), alert: 0 }, out = [];
    for (let i = 0; i < n; i++) out.push(this._spawn("horse", null, 0, 0, { x: c.x + Math.cos(i * 2.4) * (2.5 + i * 1.3), z: c.z + Math.sin(i * 2.4) * (2.5 + i * 1.3) }, herd, rng() < 0.45));
    return out;
  }

  /** Round 12: the rideable horse nearest to p within r (alive, not ridden), or null. */
  mountable(p, r = 3.6) {
    let best = null, bd = r;
    for (const a of this.list) if (a.kind === "horse" && a.alive && !a.ridden) { const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z); if (d < bd) { bd = d; best = a; } }
    return best;
  }
  /** Take a horse out of the streamed cells (so it travels with its rider) and mark it ridden. */
  mount(a) {
    if (a.cell) { const l = this.cells.get(a.cell); if (l) { const i = l.indexOf(a); if (i >= 0) l.splice(i, 1); } a.cell = null; }
    a.ridden = true; a.state = "idle"; a.stateT = 0; a.herd = null;
    this.log.push({ e: "mount", id: a.id });
  }
  dismount(a) {
    a.ridden = false; a.state = "idle"; a.stateT = 0; a.tired = 6; a.home = { x: a.pos.x, z: a.pos.z };
    this.log.push({ e: "dismount", id: a.id });
  }
  /** Pose a ridden horse under the rider each frame. */
  ride(a, feet, yaw, speed, dt, time) {
    a.pos.set(feet.x, Math.max(feet.y, this.t.height(feet.x, feet.z)), feet.z); a.yaw = yaw; a.dist = 0; // follows the rider's jumps
    a.root.visible = true;
    if (a.parts.legs && !a.legsOn) { a.legsOn = true; for (const l of a.parts.legs) l.visible = true; }
    this._pose(a, dt, speed, time);
  }

  _spawnHerd(C, n) {
    const c = this._place(C, 70, 115), herd = { id: "herd" + this.list.length, alert: 0 };
    for (let i = 0; i < n; i++) this._spawn("deer", C, 0, 0, { x: c.x + Math.cos(i * 2.2) * 4, z: c.z + Math.sin(i * 2.2) * 4 }, herd, i === 0);
  }

  /** Called when an animal starts fleeing (herd mates follow). */
  _startFlee(a, from) {
    if (!a.alive || a.state === "flee") return;
    a.state = "flee"; a.stateT = 0;
    const dx = a.pos.x - from.x, dz = a.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
    a.flee = { x: dx / d, z: dz / d };
    if (a.kind === "bird") a.fly = Math.max(a.fly, 0.01);
    if (a.herd) for (const b of this.list) if (b.herd === a.herd && b !== a && b.alive) { b.state = "flee"; b.stateT = 0; b.flee = { ...a.flee }; }
    this.log.push({ e: "flee", id: a.id });
  }

  /** player: { pos (feet), speed, crouched, running } */
  update(dt, player, time) {
    const P = player.pos;
    this.streamT -= dt;
    if (this.streamT <= 0) { this.streamT = 1; this._stream(P); }
    for (const a of this.list) {
      const dx = a.pos.x - P.x, dz = a.pos.z - P.z, dist = Math.hypot(dx, dz);
      a.dist = dist;
      a.root.visible = dist < (a.cell ? (this.lite ? 85 : 120) : 140) && !a.harvested;
      if (a.parts.legs) { const lv = dist < 45; if (a.legsOn !== lv) { a.legsOn = lv; for (const l of a.parts.legs) l.visible = lv; } }
      if (a.ridden) continue; // posed by ride()
      if (!a.alive) { a.deadT += dt; this._pose(a, dt, 0, time); if (a.harvested && a.deadT > 60 && dist > 60 && !a.cell && this.camp) this._respawn(a, P); continue; }
      if (dist > 220) continue; // far away: frozen
      const r = a.spec.r;
      const moving = player.speed > 0.3;
      const radius = player.crouched ? (moving ? r[3] : r[3] * 0.7) : !moving ? r[0] : player.running ? r[2] : r[1];
      a.stateT += dt;
      let speed = 0;
      if (a.tired > 0) a.tired -= dt; // winded after a run: lets you close in
      if (a.spec.calmHerd && !player.mounted) {
        // horses: watch a walker, bolt from a runner
        if (a.state !== "flee" && player.running && dist < r[2] && !(a.tired > 0)) this._startFlee(a, P);
        else if (a.state !== "flee" && dist < r[1] && a.state !== "alert") { a.state = "alert"; a.stateT = 0; }
      } else if (a.spec.calmHerd) {
        // another horse with a rider: the herd doesn't mind
      } else if (a.state !== "flee" && !(a.tired > 0) && dist < radius) {
        const wary = a.kind === "deer" || a.kind === "goat" || a.kind === "boar";
        if (wary && a.state !== "alert") { a.state = "alert"; a.stateT = 0; }
        else if (!wary || a.stateT > 0.6 || dist < radius * 0.6) this._startFlee(a, P);
      }
      switch (a.state) {
        case "idle":
          if (a.stateT > 2 + (a.phase % 3)) { a.state = "wander"; a.stateT = 0; const an = this.rng() * 6.28, d = 2 + this.rng() * 6; a.goal = { x: a.home.x + Math.cos(an) * d, z: a.home.z + Math.sin(an) * d }; }
          break;
        case "wander": {
          if (!a.goal) { a.state = "idle"; break; }
          const gx = a.goal.x - a.pos.x, gz = a.goal.z - a.pos.z, gd = Math.hypot(gx, gz);
          if (gd < 0.4 || a.stateT > 8) { a.state = "idle"; a.stateT = 0; break; }
          a.yaw = turn(a.yaw, Math.atan2(-gx, -gz), dt * 3);
          speed = a.spec.wander;
          break;
        }
        case "alert":
          a.yaw = turn(a.yaw, Math.atan2(dx, dz) + Math.PI, dt * 4);
          if (dist > (a.spec.calmHerd ? r[1] * 1.6 : radius * 1.3) && a.stateT > 2) { a.state = "idle"; a.stateT = 0; }
          break;
        case "flee": {
          let fx = a.flee.x, fz = a.flee.z;
          if (a.kind === "rabbit") { const z = Math.sin(a.stateT * 5) * 0.7; fx += -a.flee.z * z; fz += a.flee.x * z; }
          // keep running away from the player, and don't run off the map edge
          const ax = dx / (dist || 1), az = dz / (dist || 1);
          fx = fx * 0.6 + ax * 0.4; fz = fz * 0.6 + az * 0.4;
          a.yaw = turn(a.yaw, Math.atan2(-fx, -fz), dt * 8);
          speed = a.spec.speed * (a.health < a.spec.hits ? 0.7 : 1) * Math.min(1, 0.4 + a.stateT * 2);
          if ((dist > a.spec.calm && a.stateT > 1.5) || a.stateT > (a.spec.fleeT || 3) + (a.health < a.spec.hits ? 1.5 : 0)) { a.state = "idle"; a.stateT = 0; a.tired = 3; a.home = { x: a.pos.x, z: a.pos.z }; if (a.herd) a.herd.alert = 0; }
          break;
        }
      }
      if (speed > 0) {
        const nx = a.pos.x - Math.sin(a.yaw) * speed * dt, nz = a.pos.z - Math.cos(a.yaw) * speed * dt;
        if (a.kind === "bird" && a.fly > 0 || this.t.slope(nx, nz).m < (a.spec.climb ? 1.6 : 0.9)) { a.pos.x = nx; a.pos.z = nz; }
        else a.yaw += 1.2;
      }
      const g = this.t.height(a.pos.x, a.pos.z);
      if (a.kind === "bird") {
        const want = a.state === "flee" ? 7 + Math.sin(a.stateT * 1.3) * 1.5 : 0;
        a.fly += (want - a.fly) * Math.min(1, dt * (want > a.fly ? 1.6 : 0.8));
        if (a.fly < 0.05 && a.state !== "flee") a.fly = 0;
        a.pos.y = g + a.fly;
      } else a.pos.y = g;
      this._pose(a, dt, speed, time);
    }
  }

  _pose(a, dt, speed, time) {
    const { root, parts } = a;
    root.position.copy(a.pos); root.rotation.y = a.yaw;
    a.phase += dt * (2 + speed * (a.kind === "horse" ? 1.05 : 2.6));
    if (!a.alive) {
      root.rotation.z = Math.min(1.45, a.deadT * 4);
      if (parts.legs) parts.legs.forEach((l) => (l.rotation.x = 0.2));
      return;
    }
    root.rotation.z = 0;
    if (a.kind === "rabbit") parts.body.position.y = speed > 0.1 ? Math.abs(Math.sin(a.phase * 1.6)) * 0.22 : 0;
    else if (a.kind === "bird") {
      const flap = a.fly > 0.05 ? Math.sin(time * 26) * 0.9 : Math.sin(time * 2 + a.phase) * 0.05 - 0.1;
      parts.wl.rotation.z = flap; parts.wr.rotation.z = -flap;
      parts.body.rotation.x = a.fly > 0.05 ? 0 : (a.state === "idle" ? Math.max(0, Math.sin(time * 3 + a.phase)) * 0.5 : 0);
    } else {
      const k = Math.min(1, speed / 3);
      if (a.kind === "horse") {
        // walk -> trot -> gallop: front/back pairs drift out of phase as speed rises, body rocks
        const g = Math.min(1, speed / 12);
        parts.legs.forEach((l, i) => { l.rotation.x = Math.sin(a.phase + (i % 2 ? Math.PI * (1 - g * 0.85) : 0) + (i > 1 ? 0.6 + g * 1.6 : 0)) * (0.35 + 0.5 * g) * k; });
        parts.body.rotation.x = a.state === "idle" && !a.ridden && speed < 0.1 ? 0.16 : Math.sin(a.phase) * 0.05 * g;
        parts.body.position.y = Math.abs(Math.sin(a.phase)) * 0.12 * g;
        return;
      }
      parts.legs.forEach((l, i) => { l.rotation.x = Math.sin(a.phase + (i % 2 ? Math.PI : 0) + (i > 1 ? 0.6 : 0)) * 0.6 * k; });
      parts.body.rotation.x = a.state === "idle" ? 0.12 : a.state === "alert" ? -0.06 : 0;
    }
  }

  _respawn(a, P) {
    const C = this.t.act1.camp;
    const p = this._place(C, 40, 110);
    if (Math.hypot(p.x - P.x, p.z - P.z) < 45) return;
    a.pos.set(p.x, this.t.height(p.x, p.z), p.z); a.home = { ...p };
    a.alive = true; a.harvested = false; a.health = a.spec.hits; a.state = "idle"; a.stateT = 0; a.deadT = 0; a.fly = 0;
    a.root.visible = true;
  }

  /** Spear thrust from feet position f with facing (fx, fz). Returns the animal hit (or null). */
  tryHit(f, fx, fz, dmg = 1) {
    let best = null, bd = Infinity;
    for (const a of this.list) {
      if (!a.alive || a.ridden) continue;
      const dx = a.pos.x - f.x, dz = a.pos.z - f.z, d = Math.hypot(dx, dz);
      if (d > a.spec.reach || Math.abs(a.pos.y - f.y) > 2.2) continue;
      const dot = d > 1e-3 ? (dx * fx + dz * fz) / d : 1;
      if (dot < 0.3) continue;
      if (d < bd) { bd = d; best = a; }
    }
    if (!best) return null;
    return this.damage(best, dmg, f);
  }

  damage(a, dmg, from) {
    if (!a.alive) return null;
    a.health -= dmg;
    if (a.health <= 0) { a.alive = false; a.deadT = 0; a.fly = 0; a.pos.y = this.t.height(a.pos.x, a.pos.z); this.log.push({ e: "kill", id: a.id }); }
    else this._startFlee(a, from);
    return a;
  }

  /** Arrow test: the living animal whose body is within reach of point p (or null). */
  bodyAt(p) {
    const R = { rabbit: 0.35, bird: 0.3, fox: 0.4, goat: 0.6, boar: 0.65, deer: 0.8, horse: 1.0 }, H = { rabbit: 0.25, bird: 0.15, fox: 0.35, goat: 0.8, boar: 0.6, deer: 1.1, horse: 1.4 };
    let best = null, bd = Infinity;
    for (const a of this.list) {
      if (!a.alive || !a.root.visible || a.ridden) continue;
      const d = Math.hypot(a.pos.x - p.x, a.pos.y + H[a.kind] - p.y, a.pos.z - p.z);
      if (d < R[a.kind] + 0.25 && d < bd) { bd = d; best = a; }
    }
    return best;
  }

  nearestCarcass(p, r = 2.6) {
    let best = null, bd = r;
    for (const a of this.list) if (!a.alive && !a.harvested) { const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z); if (d < bd) { bd = d; best = a; } }
    return best;
  }

  harvest(a) { a.harvested = true; a.root.visible = false; a.deadT = 0; return ANIMAL_YIELD[a.kind]; }

  nearest(p, kind = null) {
    let best = null, bd = Infinity;
    for (const a of this.list) if (a.alive && (!kind || a.kind === kind)) { const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z); if (d < bd) { bd = d; best = a; } }
    return best ? { a: best, d: bd } : null;
  }

  setVisible(v) { this.group.visible = v; }
}

function turn(cur, want, k) {
  let d = want - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * Math.min(1, k);
}
