/**
 * Round 20: Kra's own settlements. Found a hearth (the Founding Stone), build on a grid, take in
 * people (recruited in the towns, or drawn by free huts and food), give them work, and they walk
 * out to trees / rocks / water / the mine, work, and haul it home. Settlements climb through the
 * ages (Hide & Hut -> Timber -> Stone -> Bronze -> Iron & Steel -> Modern, stub): each age needs
 * people, stores and a key building or craft, and changes every building's look and materials,
 * unlocks new buildings and better tools (faster harvesting).
 * Simulation: villagers near Kra really walk and carry (rendered by People as instanced folk);
 * far away a 1 s abstract tick produces at the same rates; offline time is caught up (capped).
 */
import * as THREE from "three";
import { colorize, merge } from "./overworld.js";
import { colCore } from "./terrain.js";
import { mulberry32 } from "../rng.js";
import { identity } from "../act1/talk.js";

export const RES = {
  wood: ["Wood", "🪵"], stone: ["Stone", "🪨"], food: ["Food", "🍖"], hide: ["Hide", "🟤"], fibre: ["Fibre", "🌾"], clay: ["Clay", "🧱"],
  copper: ["Copper ore", "🟠"], tin: ["Tin ore", "⚪"], iron: ["Iron ore", "⚙️"], coal: ["Coal", "⬛"],
};
export const AGES = [
  { id: "hide", name: "Hide & Hut", tool: "Flint tools", lore: "A fire, a few hides on poles. The first hearth since the camp went silent." },
  { id: "timber", name: "Timber", tool: "Stone axes", need: { pop: 3, res: { wood: 40, stone: 10 }, bld: ["workshop"] }, lore: "Log walls and thatch. A place meant to last a winter." },
  { id: "stone", name: "Stone", tool: "Ground-stone picks", need: { pop: 5, res: { wood: 40, stone: 60 }, bld: ["quarry"] }, lore: "Dressed stone and walls. The tribe stops running from the dark." },
  { id: "bronze", name: "Bronze", tool: "Bronze axes & picks", need: { pop: 7, res: { stone: 40, clay: 20, copper: 15, tin: 8 }, bld: ["kiln"], tech: "smelting" }, lore: "Green stone melted into gold-red metal. Trims that shine in the firelight." },
  { id: "iron", name: "Iron & Steel", tool: "Iron & steel tools", need: { pop: 9, res: { iron: 25, coal: 20, stone: 60 }, bld: ["forge"], tech: "ironwork" }, lore: "Black iron, then steel. Brick, beams and chimneys: a town, not a camp." },
  { id: "modern", name: "Modern", tool: "—", need: { stub: true }, lore: "Coming in a later round." },
];
export const TECH = {
  smelting: { name: "Copper smelting", needB: "kiln", cost: { wood: 20, clay: 10, copper: 5 } },
  ironwork: { name: "Iron working", needB: "forge", cost: { iron: 10, coal: 10 } },
};
export const BUILD = {
  stone: { name: "Founding Stone", r: 1.4, cost: {}, age: 99 },
  hut: { name: "Hut", r: 2.8, cost: { wood: 8, hide: 2 }, age: 0, desc: "Houses 2 people (more in later ages)." },
  storage: { name: "Storage", r: 2.6, cost: { wood: 12 }, age: 0, desc: "+150 storage for every resource." },
  fire: { name: "Fire pit", r: 1.5, cost: { wood: 3, stone: 3 }, age: 0, desc: "A gathering place. People sit here." },
  rack: { name: "Drying rack", r: 1.8, cost: { wood: 5, hide: 1 }, age: 0, desc: "Hunters and fishers bring 30% more food." },
  workshop: { name: "Workshop", r: 3, cost: { wood: 20, stone: 6 }, age: 0, desc: "Tools and know-how. Needed for the Timber age." },
  lumber: { name: "Lumber camp", r: 2.6, cost: { wood: 10, stone: 2 }, age: 0, desc: "Woodcutters 50% faster." },
  palisade: { name: "Palisade", r: 3.1, cost: { wood: 6 }, age: 0, wall: true, desc: "A 6 m wall section (stone and brick in later ages)." },
  dock: { name: "Dock", r: 2.4, cost: { wood: 12 }, age: 0, water: true, desc: "Build at the water's edge. Fishers 50% faster." },
  farm: { name: "Farm plot", r: 3.4, cost: { wood: 4, fibre: 4 }, age: 1, job: "farmer", desc: "A farmer grows food and fibre here." },
  quarry: { name: "Quarry", r: 3, cost: { wood: 10 }, age: 1, desc: "Quarry workers 50% faster; stone and clay. Needed for the Stone age." },
  mine: { name: "Mine entrance", r: 2.8, cost: { wood: 15, stone: 10 }, age: 1, rock: true, job: "miner", desc: "Build by rock or mountain slopes. Miners dig stone and clay, then copper, tin, iron and coal." },
  kiln: { name: "Kiln", r: 2, cost: { stone: 20, clay: 10 }, age: 2, desc: "Fires clay and smelts copper. Needed for the Bronze age." },
  forge: { name: "Forge", r: 2.6, cost: { stone: 30, copper: 10, tin: 5 }, age: 3, desc: "Iron and steel. Needed for the Iron & Steel age." },
};
export const JOBS = {
  gatherer: { name: "Gatherer", node: "bush", t: 6, anim: "dig", y: { food: 2, fibre: 1 } },
  woodcutter: { name: "Woodcutter", node: "tree", t: 8, anim: "chop", y: { wood: 3 } },
  quarry: { name: "Quarry worker", node: "rock", t: 8, anim: "mine", y: { stone: 3 } },
  miner: { name: "Miner", node: "mine", t: 10, anim: "mine", y: null },
  hunter: { name: "Hunter", node: "wild", t: 8, anim: "carry", y: { food: 3, hide: 1 } },
  fisher: { name: "Fisher", node: "water", t: 8, anim: "carry", y: { food: 3 } },
  builder: { name: "Builder", node: "site", t: 6, anim: "chop", y: {} },
  farmer: { name: "Farmer", node: "farm", t: 9, anim: "dig", y: { food: 5, fibre: 1 } },
};
const BONUS = { lumber: ["woodcutter", 0.5], rack: ["hunter", 0.3], dock: ["fisher", 0.5], quarry: ["quarry", 0.5], mine: ["miner", 0.3] };
const WALK = 2.1; // villagers' walking speed (m/s)
const NAMES = ["Kra's Hearth", "Second Fire", "Redstone Hold", "Eastwater", "Highcamp", "Ochre Rest"];
export const MAX_SETTLEMENTS = 3;

// ---------------- building models (merged, vertex coloured; one style per age) ----------------
const PAL = [
  { wall: 0xb89a72, wall2: 0x9c7c58, roof: 0x8a6a48, wood: 0x6a4a2c, trim: 0x4a3420, stone: 0x7a7670, floor: 0x6a5a40 },
  { wall: 0x7a5634, wall2: 0x6a4a2c, roof: 0x9a8a50, wood: 0x5a3c22, trim: 0x3e2a18, stone: 0x7a7670, floor: 0x6a5a40 },
  { wall: 0x8d8a84, wall2: 0x77736c, roof: 0x6e5c3a, wood: 0x5a3c22, trim: 0x5e5a54, stone: 0x8d8a84, floor: 0x7a766e },
  { wall: 0x9a948a, wall2: 0x857f74, roof: 0xa0522d, wood: 0x5a3c22, trim: 0xc07a3a, stone: 0x9a948a, floor: 0x857f74 },
  { wall: 0x8a3a2a, wall2: 0x74301f, roof: 0x3a3e44, wood: 0x4a4e56, trim: 0x5a6068, stone: 0x8a8a88, floor: 0x5a5a5a },
];
function part(g, hex, x = 0, y = 0, z = 0, ry = 0) { g.rotateY(ry); g.translate(x, y, z); const c0 = new THREE.Color(hex); return colorize(g, (c, px, py) => c.copy(c0).multiplyScalar(0.82 + 0.18 * Math.min(1, Math.max(0, py / 4)))); }
const box = (w, h, d, hex, x = 0, y = 0, z = 0, ry = 0) => part(new THREE.BoxGeometry(w, h, d), hex, x, y + h / 2, z, ry);
const cyl = (r0, r1, h, hex, x = 0, y = 0, z = 0, seg = 7) => part(new THREE.CylinderGeometry(r0, r1, h, seg), hex, x, y + h / 2, z);
const cone = (r, h, hex, x = 0, y = 0, z = 0, seg = 8) => part(new THREE.ConeGeometry(r, h, seg), hex, x, y + h / 2, z);
function roof(w, d, h, hex, y) { const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1); g.rotateY(Math.PI / 4); g.scale(w, h, d); return part(g, hex, 0, y + h / 2, 0); }
function house(P, a, w, d, h) {
  const out = [box(w + 0.3, 0.4, d + 0.3, P.stone, 0, -0.3), box(w, h, d, P.wall)];
  if (a === 4) { out.push(box(w + 0.4, 0.25, d + 0.4, P.roof, 0, h)); for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) out.push(box(0.22, h + 0.3, 0.22, P.trim, sx * w / 2, 0, sz * d / 2)); out.push(box(w * 0.9, 0.12, 0.05, P.trim, 0, h * 0.55, d / 2 + 0.03), box(0.5, 1.6, 0.4, P.wall2, w * 0.3, h, -d * 0.2)); }
  else out.push(roof(w + 0.8, d + 0.8, a === 1 ? 1.8 : 1.5, P.roof, h));
  if (a === 3) out.push(box(w + 0.1, 0.18, d + 0.1, P.trim, 0, h - 0.18));
  if (a === 2 || a === 3) for (const sx of [-1, 1]) out.push(box(0.3, h, 0.3, P.wall2, sx * w / 2, 0, d / 2));
  out.push(box(0.9, 1.7, 0.08, a >= 3 ? P.trim : P.trim, 0, 0, d / 2 + 0.03)); // door
  return out;
}
function modelParts(type, a) {
  const P = PAL[Math.min(a, 4)], out = [];
  switch (type) {
    case "stone": out.push(box(0.7, 2.3, 0.45, 0x6e6a64), box(0.74, 0.25, 0.49, 0xa8401c, 0, 1.5), cyl(1.3, 1.4, 0.15, 0x5a5a56)); break;
    case "hut":
      if (a === 0) { out.push(cone(2.5, 3.6, P.wall, 0, 0, 0, 9)); for (let i = 0; i < 4; i++) out.push(cyl(0.05, 0.05, 1, P.wood, Math.cos(i * 1.57) * 0.25, 3.3, Math.sin(i * 1.57) * 0.25, 4)); }
      else out.push(...house(P, a, 3.6 + a * 0.3, 3.4, 2.3 + a * 0.35));
      break;
    case "storage":
      if (a === 0) { out.push(cyl(1.6, 1.7, 1.6, P.wall2, 0, 0.3), cone(2.1, 1.6, P.roof, 0, 1.9)); for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) out.push(cyl(0.08, 0.08, 0.4, P.wood, x, 0, z, 4)); }
      else out.push(...house(P, a, 4.2, 3.6, 2.4 + a * 0.3), box(1.2, 0.8, 1.2, P.wood, 2.6, 0, 1.2));
      break;
    case "fire": for (let i = 0; i < 8; i++) out.push(box(0.35, 0.25, 0.35, a >= 2 ? P.stone : 0x6e6a64, Math.cos(i * 0.785) * 0.9, 0, Math.sin(i * 0.785) * 0.9)); out.push(box(1.2, 0.12, 0.15, 0x3a2414, 0, 0.05, 0, 0.5), box(1.2, 0.12, 0.15, 0x3a2414, 0, 0.1, 0, -0.6), cone(0.3, 0.6, 0xf08a2a, 0, 0.15, 0, 5)); break;
    case "rack": for (const x of [-1.2, 1.2]) out.push(cyl(0.06, 0.08, 2, P.wood, x, 0, 0, 5)); out.push(box(2.6, 0.08, 0.08, P.wood, 0, 1.9), box(0.9, 1.1, 0.04, 0xb89068, -0.6, 0.75, 0.05), box(0.8, 1.0, 0.04, 0x9a7050, 0.6, 0.8, 0.05)); break;
    case "workshop":
      for (const [x, z] of [[1.6, 1.4], [1.6, -1.4], [-1.6, 1.4], [-1.6, -1.4]]) out.push(box(0.2, 2.6, 0.2, P.wood, x, 0, z));
      out.push(roof(4.4, 4, 1.2, P.roof, 2.6), box(1.8, 0.8, 0.7, P.wood, 0, 0, 0.5), box(0.35, 0.5, 0.35, 0x6e6a64, -0.4, 0.8, 0.5));
      if (a >= 2) out.push(box(3.4, 1.6, 0.25, P.wall, 0, 0, -1.4));
      if (a >= 3) out.push(box(0.5, 0.35, 0.3, P.trim, 0.6, 0.8, 0.5));
      break;
    case "lumber": for (let i = 0; i < 5; i++) out.push(part(new THREE.CylinderGeometry(0.22, 0.22, 3, 6).rotateZ(Math.PI / 2), 0x7a5a38, 0, 0.25 + (i % 3) * 0.4 + (i > 2 ? 0.2 : 0), -0.8 + (i % 3) * 0.45 + (i > 2 ? 0.22 : 0))); out.push(cyl(0.4, 0.45, 0.6, 0x6a4a2c, 1.6, 0, 1), box(0.06, 0.5, 0.25, a >= 3 ? P.trim : 0x6e6a64, 1.6, 0.6, 1)); if (a >= 1) out.push(box(0.15, 2.4, 0.15, P.wood, -1.8, 0, 1.4), box(0.15, 2.4, 0.15, P.wood, 1.8, 0, 1.4), box(4, 0.15, 1.4, P.roof, 0, 2.4, 0.9)); break;
    case "palisade":
      if (a <= 1) for (let i = 0; i < 12; i++) { out.push(cyl(0.18, 0.2, 2.4 + (i % 3) * 0.15, P.wood, -2.75 + i * 0.5, 0, 0, 5), cone(0.2, 0.4, P.wood, -2.75 + i * 0.5, 2.4 + (i % 3) * 0.15, 0, 5)); }
      else { out.push(box(6.2, a >= 4 ? 2.6 : 2.3, 0.8, a >= 4 ? P.wall : P.stone)); for (let i = 0; i < 5; i++) out.push(box(0.6, 0.45, 0.85, a >= 4 ? P.wall2 : P.wall2, -2.5 + i * 1.25, a >= 4 ? 2.6 : 2.3)); if (a >= 3) out.push(box(6.25, 0.15, 0.85, P.trim, 0, 1.4)); }
      break;
    case "dock": out.push(box(2.2, 0.15, 7, P.wood === 0x4a4e56 ? 0x6a5a48 : 0x7a5a38, 0, 0.35, 2.5)); for (const [x, z] of [[1, 0], [-1, 0], [1, 5.5], [-1, 5.5]]) out.push(cyl(0.1, 0.12, 2.2, P.wood, x, -1.8, z, 5)); break;
    case "farm": out.push(box(6.4, 0.12, 6.4, 0x5a4026)); for (let i = 0; i < 6; i++) out.push(box(0.5, 0.45, 5.8, a >= 2 ? 0x8a9a3a : 0x5a8a3a, -2.6 + i * 1.04, 0.1)); for (const [x, z] of [[3.3, 3.3], [-3.3, 3.3], [3.3, -3.3], [-3.3, -3.3]]) out.push(cyl(0.06, 0.06, 1.1, P.wood, x, 0, z, 4)); break;
    case "quarry": out.push(box(1.2, 0.8, 1.0, 0x8a8680, -1, 0, 0.6), box(1.0, 0.7, 1.0, 0x7a766e, 0.4, 0, -0.9), box(0.9, 0.6, 0.9, 0x8a8680, -0.4, 0.8, 0.6), box(0.15, 3.4, 0.15, P.wood, 1.6, 0, 1.2), box(2.2, 0.12, 0.12, P.wood, 0.6, 3.3, 1.2), cyl(0.02, 0.02, 2, 0x8a7a5a, -0.4, 1.3, 1.2, 3)); if (a >= 3) out.push(box(0.3, 0.3, 0.3, P.trim, 1.6, 3.35, 1.2)); break;
    case "mine":
      out.push(box(3.4, 2.8, 2.2, a >= 2 ? P.stone : 0x6e6a64, 0, 0, -0.6), box(1.6, 2.0, 0.3, 0x0c0a08, 0, 0, 0.5), box(0.25, 2.3, 0.25, P.wood, -0.95, 0, 0.6), box(0.25, 2.3, 0.25, P.wood, 0.95, 0, 0.6), box(2.3, 0.3, 0.3, P.wood, 0, 2.2, 0.6), box(1.0, 0.4, 0.7, 0x5a4a3a, 1.8, 0, 1.4));
      if (a >= 4) { for (const [x, z] of [[-1, -1], [1, -1], [-0.7, 0.2], [0.7, 0.2]]) out.push(box(0.18, 6, 0.18, P.trim, x, 2.8, z - 0.6)); out.push(cyl(0.7, 0.7, 0.15, P.trim, 0, 8.6, -0.9, 10)); }
      else if (a >= 3) out.push(box(2.4, 0.15, 0.35, P.trim, 0, 2.5, 0.6));
      break;
    case "kiln": out.push(part(new THREE.SphereGeometry(1.5, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2), a >= 4 ? P.wall : 0xa0603a, 0, 0, 0), cyl(0.35, 0.4, 2.4, a >= 4 ? P.wall2 : 0x8a5030, 0.6, 0.8, -0.4), box(0.7, 0.6, 0.2, 0x1a0e08, 0, 0, 1.45)); break;
    case "forge": out.push(...house(P, Math.max(a, 2), 4, 3.4, 2.6)); out.push(cyl(0.45, 0.5, 4.6, a >= 4 ? P.wall2 : P.stone, 1.3, 0, -1.0), box(0.8, 0.5, 0.4, 0x2a2a2e, -1.2, 0.5, 2.2), box(0.3, 0.5, 0.3, 0x2a2a2e, -1.2, 0, 2.2), cone(0.25, 0.5, 0xf08a2a, 1.3, 4.6, -1.0, 5)); break;
  }
  return out;
}
const geoCache = new Map();
export function buildingGeo(type, age) {
  const k = type + ":" + age;
  if (!geoCache.has(k)) geoCache.set(k, merge(modelParts(type, age)));
  return geoCache.get(k);
}

export class Colony {
  /** env: { terrain, parent (THREE group), people, toast(msg), now() (s), skills() (Set), key } */
  constructor(env) {
    this.env = env; this.t = env.terrain; this.list = [];
    this.group = new THREE.Group(); this.group.name = "colonies"; env.parent.add(this.group);
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x40ff60, transparent: true, opacity: 0.45, depthWrite: false });
    this.simT = 0; this.agents = []; this.log = [];
  }
  // ---------------- persistence ----------------
  toJSON() { return { v: 1, savedAt: Date.now(), list: this.list.map((c) => ({ id: c.id, name: c.name, x: c.x, z: c.z, age: c.age, res: c.res, blds: c.blds.map((b) => ({ type: b.type, x: b.x, z: b.z, rot: b.rot, built: b.built })), vill: c.vill, techs: c.techs, arriveT: c.arriveT, t: c.t, seed: c.seed })) }; }
  load(o, catchUp = true) {
    this.clear();
    if (!o || !Array.isArray(o.list)) return;
    for (const d of o.list) { const c = { ...d, res: { ...d.res }, blds: d.blds.map((b) => ({ ...b })), vill: d.vill.map((v) => ({ ...v })), techs: d.techs || [] }; this.list.push(c); this._nodes(c); this.rebuild(c); }
    this._colliders();
    if (catchUp && o.savedAt) { const away = Math.min(7200, Math.max(0, (Date.now() - o.savedAt) / 1000)); if (away > 30) { this.ff(away * 0.5); this.caughtUp = away; } }
  }
  save() { try { localStorage.setItem(this.env.key(), JSON.stringify(this.toJSON())); } catch {} }
  loadSaved() { try { const s = localStorage.getItem(this.env.key()); this.load(s ? JSON.parse(s) : null); } catch { this.load(null); } }
  clear() { for (const a of this.agents) this.env.people.remove(a.p); this.agents = []; for (const c of this.list) c.grp?.parent?.remove(c.grp); this.list = []; this._colliders(); }

  // ---------------- queries ----------------
  at(x, z, pad = 25) { return this.list.find((c) => Math.hypot(c.x - x, c.z - z) < this.radius(c) + pad) || null; }
  radius(c) { return 40 + 8 * c.age; }
  pop(c) { return c.vill.length; }
  count(c, type) { return c.blds.filter((b) => b.type === type && b.built >= 1).length; }
  housing(c) { return 2 + this.count(c, "hut") * (c.age >= 4 ? 4 : c.age >= 2 ? 3 : 2); }
  cap(c) { return 60 + 150 * this.count(c, "storage"); }
  hasRoom(c) { return this.pop(c) < this.housing(c); }
  homeFor(p) { return this.list.length ? this.list.slice().sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0] : null; }
  cost(type) { const k = BUILD[type], sk = this.env.skills(), out = {}; for (const [r, n] of Object.entries(k.cost)) out[r] = r === "stone" && sk.has("mason") ? Math.ceil(n * 0.8) : n; return out; }
  afford(c, cost) { return Object.entries(cost).every(([r, n]) => (c.res[r] || 0) >= n); }
  pay(c, cost) { for (const [r, n] of Object.entries(cost)) c.res[r] = (c.res[r] || 0) - n; }
  jobName(j) { return JOBS[j]?.name || j; }
  jobOptions() { return Object.entries(JOBS).map(([id, j]) => ({ id, label: j.name })); }

  // ---------------- founding / building ----------------
  flatDry(x, z, r) {
    const t = this.t;
    for (let i = 0; i <= 8; i++) {
      const a = i * 0.785, px = i ? x + Math.cos(a) * r : x, pz = i ? z + Math.sin(a) * r : z;
      if (t.waterDepth(px, pz) > -0.15) return "Too wet here";
      if (t.slope(px, pz).m > 0.38) return "Too steep";
    }
    return null;
  }
  canFound(x, z) {
    const t = this.t;
    if (this.list.length >= MAX_SETTLEMENTS) return `You already lead ${MAX_SETTLEMENTS} settlements`;
    for (const s of t.settlements || []) if (Math.hypot(s.x - x, s.z - z) < s.R + 70) return `Too close to ${s.name}`;
    for (const c of this.list) if (Math.hypot(c.x - x, c.z - z) < 220) return `Too close to ${c.name}`;
    for (const e of t.entrances) if (Math.hypot(e.x - x, e.z - z) < 40) return "Too close to a cave mouth";
    const site = t.act1; if (site && Math.hypot(site.camp.x - x, site.camp.z - z) < 70) return "Too close to the old camp";
    const f = this.flatDry(x, z, 10); if (f) return f;
    if (this._blocked(x, z, 4, null)) return "Clear the trees and rocks first (move a little)";
    return null;
  }
  found(x, z, name = null) {
    const id = (this.list.reduce((m, c) => Math.max(m, c.id), -1) + 1);
    const c = { id, name: name || NAMES[id % NAMES.length], x, z, age: 0, res: { wood: 30, food: 25, hide: 6, stone: 8, fibre: 4 }, blds: [], vill: [], techs: [], arriveT: 60, t: 0, seed: (Math.floor(x * 31 + z * 17) >>> 0) };
    c.blds.push({ type: "stone", x, z, rot: 0, built: 1 }, { type: "fire", x: x + 4, z: z + 1, rot: 0, built: 1 });
    this.list.push(c); this._nodes(c); this.rebuild(c); this._colliders(); this.save();
    this.log.push({ e: "found", name: c.name });
    return c;
  }
  _blocked(x, z, r, c) {
    for (const k of this.t.collidersNear(x, z, r + 1)) { if (k.colony) continue; const q = colCore(k, x, z); if (Math.hypot(q.x - x, q.z - z) < q.t + r) return true; }
    return false;
  }
  rocky(x, z) {
    const t = this.t, w = t.bio?.weights?.(x, z);
    if (w && w.alpine + w.red + w.tundra > 0.4) return true;
    let mx = 0; for (let i = 0; i < 8; i++) { const a = i * 0.785; mx = Math.max(mx, t.slope(x + Math.cos(a) * 12, z + Math.sin(a) * 12).m); }
    if (mx > 0.42) return true;
    return t.collidersNear(x, z, 14).some((k) => k.top != null && k.r > 1.0);
  }
  canPlace(c, type, x, z, rot) {
    const K = BUILD[type];
    if (!K || K.age > c.age) return "Not yet (a later age)";
    if (Math.hypot(x - c.x, z - c.z) > this.radius(c)) return "Too far from the Founding Stone";
    for (const b of c.blds) { const R = BUILD[b.type].r; if (Math.hypot(b.x - x, b.z - z) < R + K.r + 0.4) return "Overlaps " + BUILD[b.type].name.toLowerCase(); }
    if (K.water) {
      const fx = Math.sin(rot), fz = Math.cos(rot);
      if (this.t.waterDepth(x, z) > 0.3) return "The near end must be on the bank";
      if (this.t.waterDepth(x + fx * 5, z + fz * 5) < 0.4) return "Needs water in front (rotate it to face the water)";
    } else { const f = this.flatDry(x, z, K.r * 0.8); if (f) return f; }
    if (K.rock && !this.rocky(x, z)) return "Needs rock or a mountain slope nearby";
    if (this._blocked(x, z, K.r * 0.8, c)) return "Trees or rocks in the way";
    if (!this.afford(c, this.cost(type))) return "Not enough materials";
    return null;
  }
  place(c, type, x, z, rot) {
    const why = this.canPlace(c, type, x, z, rot); if (why) return why;
    this.pay(c, this.cost(type));
    c.blds.push({ type, x, z, rot, built: 0.02 });
    this.rebuild(c); this._colliders(); this.save();
    this.log.push({ e: "place", type });
    return null;
  }
  buildTime(type) { const n = Object.values(BUILD[type].cost).reduce((a, b) => a + b, 0); return 12 + n * 0.8; }

  // ---------------- people ----------------
  recruit(c, ident, auto = false) {
    // newcomers take the least-staffed basic job (builders while there are sites), recruits start as gatherers
    let job = "gatherer";
    if (auto) { const pool = ["gatherer", "woodcutter", "quarry", "hunter"]; if (c.blds.some((b) => b.built < 1)) pool.unshift("builder"); job = pool.map((j) => [j, c.vill.filter((v) => v.job === j).length]).sort((a, b) => a[1] - b[1])[0][0]; }
    const v = { vid: `${c.id}-${c.vill.length}-${(ident.seed || 0) % 9973}`, name: ident.name, voice: ident.voice, seed: ident.seed || 1, job, trait: ident.trait };
    c.vill.push(v); this.save();
    this.log.push({ e: "recruit", name: v.name, c: c.name });
    return v;
  }
  setJob(vid, job) { for (const c of this.list) for (const v of c.vill) if (v.vid === vid && JOBS[job]) { v.job = job; const a = this.agents.find((x) => x.v === v); if (a) this._plan(a); this.save(); return true; } return false; }
  report(I) {
    const c = this.list.find((x) => x.vill.some((v) => v.vid === I.vid)); if (!c) return null;
    const v = c.vill.find((x) => x.vid === I.vid), node = this._node(c, v.job, Math.random);
    if (!node) return v.job === "miner" ? "There's no mine to work. Build a mine entrance by the rocks." : v.job === "farmer" ? "Give me a farm plot and I'll grow you food." : v.job === "fisher" ? "No water close enough to fish." : "Nothing to do here.";
    return `${(c.res.food || 0) < 5 ? "We're hungry, Kra. " : ""}${JOBS[v.job].name} work, ${Object.entries(this.yieldOf(c, v.job)).map(([r, n]) => `${n.toFixed(1)} ${RES[r][0].toLowerCase()}`).join(", ") || "building"} a trip.`;
  }
  yieldOf(c, job) {
    const J = JOBS[job], sk = this.env.skills();
    let y = J.y;
    if (job === "miner") y = c.age <= 1 ? { stone: 2, clay: 1 } : c.age === 2 ? { stone: 1, copper: 1, tin: 1 } : { copper: 1, tin: 0.5, iron: 1, coal: 1 };
    if (job === "quarry" && c.age >= 1) y = { stone: 3, clay: 1 };
    let m = 1 + 0.25 * c.age; // tools improve each age
    for (const [b, [j, k]] of Object.entries(BONUS)) if (j === job && this.count(c, b)) m += k;
    if ((job === "woodcutter" && sk.has("wood1")) || ((job === "miner" || job === "quarry") && sk.has("mine1"))) m += 0.25;
    if ((c.res.food || 0) <= 0 && job !== "hunter" && job !== "fisher" && job !== "gatherer" && job !== "farmer") m *= 0.5;
    const out = {}; for (const [r, n] of Object.entries(y || {})) out[r] = n * m; return out;
  }
  deposit(c, y) { const cap = this.cap(c); for (const [r, n] of Object.entries(y)) c.res[r] = Math.min(cap, (c.res[r] || 0) + n); }

  // ---------------- ages ----------------
  ageCheck(c) {
    const A = AGES[c.age + 1]; if (!A) return { ok: false, lines: [["The last age", false]] };
    if (A.need.stub) return { ok: false, lines: [["Coming in a later round", false]], stub: true };
    const N = A.need, lines = [[`${N.pop} people (${this.pop(c)})`, this.pop(c) >= N.pop]];
    for (const [r, n] of Object.entries(N.res)) lines.push([`${n} ${RES[r][0].toLowerCase()} (${Math.floor(c.res[r] || 0)})`, (c.res[r] || 0) >= n]);
    for (const b of N.bld) lines.push([`A finished ${BUILD[b].name.toLowerCase()}`, this.count(c, b) > 0]);
    if (N.tech) lines.push([`Know-how: ${TECH[N.tech].name}`, c.techs.includes(N.tech)]);
    return { ok: lines.every((l) => l[1]), lines, A };
  }
  advance(c) {
    const k = this.ageCheck(c); if (!k.ok) return false;
    for (const [r, n] of Object.entries(k.A.need.res)) c.res[r] -= n;
    c.age++; this.rebuild(c); this._colliders(); this.save();
    this.log.push({ e: "age", age: AGES[c.age].id });
    return true;
  }
  techCost(id) { const half = this.env.skills().has("smelt"), o = {}; for (const [r, n] of Object.entries(TECH[id].cost)) o[r] = half ? Math.ceil(n / 2) : n; return o; }
  techCheck(c, id) { const T = TECH[id]; if (c.techs.includes(id)) return "Known"; if (!this.count(c, T.needB)) return `Needs a ${BUILD[T.needB].name.toLowerCase()}`; if (!this.afford(c, this.techCost(id))) return "Not enough materials"; return null; }
  learnTech(c, id) { if (this.techCheck(c, id)) return false; this.pay(c, this.techCost(id)); c.techs.push(id); this.save(); this.log.push({ e: "tech", id }); return true; }

  // ---------------- simulation ----------------
  _nodes(c) {
    const t = this.t, trees = [], rocks = [], R = 80;
    for (let cx = Math.floor((c.x - R) / 64); cx <= Math.floor((c.x + R) / 64); cx++) for (let cz = Math.floor((c.z - R) / 64); cz <= Math.floor((c.z + R) / 64); cz++) {
      const sc = t.scatter(cx, cz);
      for (const q of sc.trees) if (q.type <= 3 && Math.hypot(q.x - c.x, q.z - c.z) < R) trees.push({ x: q.x, z: q.z });
      for (const q of sc.rocks) if (q.s > 0.6 && Math.hypot(q.x - c.x, q.z - c.z) < R) rocks.push({ x: q.x, z: q.z, r: q.s });
    }
    let water = null;
    for (let r = 10; r <= 160 && !water; r += 10) for (let i = 0; i < 24; i++) { const a = i * 0.2618, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r; if (t.waterDepth(x, z) > 0.3) { water = { x: c.x + Math.cos(a) * (r - 6), z: c.z + Math.sin(a) * (r - 6) }; break; } }
    const dd = (q) => Math.hypot(q.x - c.x, q.z - c.z);
    trees.sort((a, b) => dd(a) - dd(b)); rocks.sort((a, b) => dd(a) - dd(b));
    c._n = { trees: trees.filter((q) => dd(q) > 9), rocks, water };
  }
  _node(c, job, r) {
    const J = JOBS[job], n = c._n, at = (b) => ({ x: b.x + 2.2, z: b.z + 2.2 });
    const bld = (type) => c.blds.find((b) => b.type === type && b.built >= 1);
    switch (J.node) {
      case "tree": { const l = bld("lumber"); const list = n.trees; if (!list.length) return null; const q = list[Math.floor(r() * Math.min(list.length, 14))]; return { x: q.x + 0.9, z: q.z + 0.9, from: l }; }
      case "rock": { const q = bld("quarry"); if (q) return at(q); const list = n.rocks; if (!list.length) return null; const k = list[Math.floor(r() * Math.min(list.length, 6))]; return { x: k.x + k.r + 0.6, z: k.z }; }
      case "mine": { const m = bld("mine"); return m ? { x: m.x + Math.sin(m.rot) * 1.8, z: m.z + Math.cos(m.rot) * 1.8 } : null; }
      case "farm": { const f = bld("farm"); return f ? { x: f.x + (r() - 0.5) * 5, z: f.z + (r() - 0.5) * 5 } : null; }
      case "water": { const d = bld("dock"); return d ? { x: d.x, z: d.z } : n.water; }
      case "site": { const s = c.blds.find((b) => b.built < 1); return s ? { x: s.x + BUILD[s.type].r + 0.5, z: s.z, site: s } : null; }
      case "wild": { const a = r() * 6.28, d = 22 + r() * 18; return { x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d }; }
      default: { for (let k = 0; k < 6; k++) { const a = r() * 6.28, d = 12 + r() * 22, x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d; if (this.t.waterDepth(x, z) < -0.2) return { x, z }; } return { x: c.x + 10, z: c.z }; }
    }
  }
  storePt(c) { const s = c.blds.find((b) => b.type === "storage" && b.built >= 1) || c.blds[0]; return { x: s.x + 2.4, z: s.z + 0.6 }; }
  /** Abstract production for `dt` seconds (far away / offline / fast-forward). agentsLive: skip jobs done by live agents. */
  _abstract(c, dt, live) {
    for (const v of c.vill) {
      if (live) continue;
      const J = JOBS[v.job], node = this._node(c, v.job, Math.random);
      if (!node) continue;
      const cyc = J.t + 2 * Math.hypot(node.x - c.x, node.z - c.z) / WALK + 2;
      if (J.node === "site") { if (node.site) node.site.built = Math.min(1, node.site.built + dt * 1.5 / this.buildTime(node.site.type)); else this.deposit(c, Object.fromEntries(Object.entries(this.yieldOf(c, "gatherer")).map(([r, n]) => [r, n * dt / cyc]))); continue; }
      const y = this.yieldOf(c, v.job); for (const r in y) y[r] *= dt / cyc;
      this.deposit(c, y);
    }
  }
  _step(c, dt, live) {
    c.t += dt;
    this._abstract(c, dt, live);
    // construction: slow on its own; builders speed it up
    let changed = false;
    for (const b of c.blds) if (b.built < 1) { b.built = Math.min(1, b.built + dt / this.buildTime(b.type) * 0.35); if (b.built >= 1) { changed = true; this._say(`${BUILD[b.type].name} finished at ${c.name}`); } }
    // food
    c.res.food = Math.max(0, (c.res.food || 0) - this.pop(c) * dt / 90);
    // newcomers
    if (this.hasRoom(c) && (c.res.food || 0) >= 5) { c.arriveT -= dt; if (c.arriveT <= 0) { c.arriveT = 150; const I = identity((c.seed + c.vill.length * 104729) >>> 0); const v = this.recruit(c, I, true); this._say(`${v.name} arrives at ${c.name}, drawn by the fire (${this.jobName(v.job).toLowerCase()})`); changed = true; } }
    return changed;
  }
  _say(m) { if (this._quiet) this._quiet.push(m); else this.env.toast?.(m, "good"); }
  ff(sec) { // fast-forward (offline catch-up / debug)
    const step = 5; let ch = false; this._quiet = [];
    for (let s = 0; s < sec; s += step) for (const c of this.list) ch = this._step(c, Math.min(step, sec - s), false) || ch;
    for (const c of this.list) { this.rebuild(c); for (const r in c.res) c.res[r] = Math.min(this.cap(c), c.res[r]); }
    this._colliders(); this._syncAgents(null, true); this.save();
    const q = this._quiet; this._quiet = null;
    const arr = q.filter((m) => m.includes(" arrives")).length, fin = q.length - arr;
    if (q.length) this.env.toast?.(`While you were away: ${[fin && `${fin} building${fin > 1 ? "s" : ""} finished`, arr && `${arr} newcomer${arr > 1 ? "s" : ""} arrived`].filter(Boolean).join(", ")}`, "good");
  }
  /** Per frame. player: feet position. */
  update(dt, player) {
    // agents for the settlement Kra is near (real walking / working / hauling)
    this._syncAgents(player);
    for (const a of this.agents) this._agent(a, dt);
    if ((this.simT -= dt) > 0) return;
    const step = 1 - this.simT; this.simT = 1;
    for (const c of this.list) {
      const live = this.agents.length && this.agents[0].c === c;
      const ch = this._step(c, step, live);
      if (ch || c.blds.some((b) => b.built < 1)) this._grow(c);
      if (ch) { this.rebuild(c); this._colliders(); }
    }
    if ((this.saveT = (this.saveT || 0) - step) <= 0) { this.saveT = 15; this.save(); }
  }
  _syncAgents(player, force = false) {
    const near = player ? this.list.find((c) => Math.hypot(c.x - player.x, c.z - player.z) < 260) : null;
    const want = near ? near.vill : [];
    if (force || (this.agents[0] && this.agents[0].c !== near) || this.agents.length !== want.length) {
      const keep = new Map(this.agents.filter((a) => a.c === near).map((a) => [a.v, a]));
      for (const a of this.agents) if (!keep.has(a.v) || !want.includes(a.v)) this.env.people.remove(a.p);
      this.agents = want.map((v) => keep.get(v) || this._spawn(near, v));
    }
  }
  _spawn(c, v) {
    const r = mulberry32(v.seed >>> 0), a = r() * 6.28;
    const p = this.env.people.addExternal({ s: { kind: "colony", fires: [], spots: [] }, x: c.x + Math.cos(a) * 5, z: c.z + Math.sin(a) * 5, seed: v.seed, h: 0.92 + r() * 0.14, ident: { name: v.name, voice: v.voice, trait: v.trait, ext: true, vid: v.vid, jobName: JOBS[v.job].name, seed: v.seed } });
    const ag = { c, v, p, r, phase: "go", t: 0 };
    this._plan(ag);
    return ag;
  }
  _plan(a) {
    const node = this._node(a.c, a.v.job, a.r);
    a.p.ident.jobName = JOBS[a.v.job].name;
    a.node = node; a.phase = node ? "go" : "idle"; a.t = node ? 0 : 4;
    a.p.carry = false; a.p.work = null;
    if (!node) { a.p.state = "idle"; }
  }
  _agent(a, dt) {
    const p = a.p;
    if (p.talkT > 0) { p.state = "idle"; return; }
    if (a.phase === "idle") { if ((a.t -= dt) <= 0) this._plan(a); return; }
    const tgt = a.phase === "back" ? this.storePt(a.c) : a.node;
    if (a.phase === "go" || a.phase === "back") {
      const dx = tgt.x - p.x, dz = tgt.z - p.z, d = Math.hypot(dx, dz);
      if (d < 0.6) {
        if (a.phase === "go") { a.phase = "work"; a.t = JOBS[a.v.job].t; p.state = "idle"; p.work = JOBS[a.v.job].anim === "carry" ? "scrape" : JOBS[a.v.job].anim; }
        else { const y = this.yieldOf(a.c, a.v.job); this.deposit(a.c, y); a.trips = (a.trips || 0) + 1; this.log.push({ e: "haul", job: a.v.job }); if (this.log.length > 200) this.log.splice(0, 100); this._plan(a); }
        return;
      }
      const sp = 1.3 * Math.min(1, dt) ; p.state = "walk"; p.work = null;
      const st = Math.min(d, (p.carry ? 0.85 : 1) * WALK * dt); p.x += dx / d * st; p.z += dz / d * st; p.phase += st * 4.2; p.yaw = Math.atan2(dx, dz); void sp;
      return;
    }
    if (a.phase === "work") {
      a.t -= dt;
      if (a.node?.site) a.node.site.built = Math.min(1, a.node.site.built + dt * 1.5 / this.buildTime(a.node.site.type));
      if (a.t <= 0) { if (JOBS[a.v.job].node === "site") { this._plan(a); return; } a.phase = "back"; p.carry = true; p.work = null; }
    }
  }

  // ---------------- meshes ----------------
  _grow(c) { for (const m of c._sites || []) { const b = m.userData.b; m.scale.y = Math.max(0.05, b.built); } }
  rebuild(c) {
    if (c.grp) c.grp.parent?.remove(c.grp), c.done?.geometry.dispose();
    const g = (c.grp = new THREE.Group()); g.name = "colony-" + c.id;
    const done = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    c._sites = [];
    for (const b of c.blds) {
      const y = this.t.height(b.x, b.z) - (b.type === "dock" ? 0 : 0.05);
      if (b.built >= 1) { const geo = buildingGeo(b.type, c.age).clone(); m4.compose(new THREE.Vector3(b.x, y, b.z), q.setFromAxisAngle(up, b.rot), new THREE.Vector3(1, 1, 1)); geo.applyMatrix4(m4); done.push(geo); }
      else { const m = new THREE.Mesh(buildingGeo(b.type, c.age), this.mat); m.position.set(b.x, y, b.z); m.rotation.y = b.rot; m.scale.y = Math.max(0.05, b.built); m.userData.b = b; g.add(m); c._sites.push(m); }
    }
    if (done.length) { c.done = new THREE.Mesh(merge(done), this.mat); c.done.name = "colony-built"; g.add(c.done); } else c.done = null;
    this.group.add(g);
  }
  _colliders() {
    const out = [];
    for (const c of this.list) for (const b of c.blds) {
      const K = BUILD[b.type]; if (b.type === "farm" || b.type === "fire" || b.type === "dock" || b.type === "rack") continue;
      if (K.wall) { const cs = Math.cos(b.rot), sn = Math.sin(b.rot); out.push({ seg: true, ax: b.x - cs * 3, az: b.z + sn * 3, bx: b.x + cs * 3, bz: b.z - sn * 3, t: 0.45, x: b.x, z: b.z, r: 3.2, colony: true }); }
      else out.push({ x: b.x, z: b.z, r: K.r * (b.type === "stone" ? 0.5 : 0.82), colony: true });
    }
    this.t.extraColliders = out;
  }
  ghost(type, age) {
    if (!this._ghost) { this._ghost = new THREE.Mesh(buildingGeo(type, age), this.ghostMat); this._ghost.renderOrder = 5; this.group.add(this._ghost); }
    if (this._ghost.userData.k !== type + age) { this._ghost.geometry = buildingGeo(type, age); this._ghost.userData.k = type + age; }
    this._ghost.visible = true;
    return this._ghost;
  }
  hideGhost() { if (this._ghost) this._ghost.visible = false; }
  setVisible(v) { this.group.visible = v; }
  /** Map markers. */
  marks() { return this.list.map((c) => ({ x: c.x, z: c.z, name: c.name, age: AGES[c.age].name, pop: this.pop(c), food: Math.floor(c.res.food || 0) })); }
}
