/** Seeded procedural cave that writes the generic centerline + LRUD format.
 *  Character (widths, branching, leg length, slope, chambers) is stored on the
 *  cave so a later real survey's measured character can drive this generator.
 */

import {
  emptyCave,
  shortestDistances,
  measureCharacter,
  stationMap,
  neighborsOf,
  longestPathIds,
  stationWorld,
} from "./cave-data.js";
import { mulberry32, randRange, gaussian, clamp, pick } from "./rng.js";

const FIRST = [
  "Black", "Fox", "Hollow", "Ash", "Red", "Drip", "Crow", "Fern",
  "Grit", "Low", "Whit", "Mud", "Owl", "Rift", "Silent", "Copper",
];
const SECOND = [
  "Hole", "Rift", "Pot", "Swallet", "Vein", "Gallery", "Sough", "Cleft",
  "Pipe", "Den", "Well", "Wynd", "Crawl", "Choke", "Chase", "Gate",
];

export function caveName(seed) {
  const rng = mulberry32((seed >>> 0) ^ 0x9e3779b9);
  return `${pick(rng, FIRST)} ${pick(rng, SECOND)}`;
}

export function defaultCharacter(rng) {
  return {
    meanLegLength: randRange(rng, 4.4, 7.2),
    stdLegLength: randRange(rng, 1.4, 2.6),
    minLegLength: 2.1,
    maxLegLength: 12,
    branchProbability: randRange(rng, 0.32, 0.44),
    maxActiveTips: 6,
    chamberProbability: randRange(rng, 0.12, 0.2),
    squeezeProbability: randRange(rng, 0.08, 0.16),
    meanHalfWidth: randRange(rng, 0.95, 1.35),
    widthSigma: 0.32,
    meanUp: randRange(rng, 1.15, 1.55),
    meanDown: randRange(rng, 0.55, 0.8),
    meanderDeg: randRange(rng, 22, 38),
    meanClinoDeg: randRange(rng, -14, -5),
    clinoSigmaDeg: randRange(rng, 10, 16),
    maxClinoDeg: 30,
    targetLegs: 60 + Math.floor(rng() * 30),
    loopProbability: 0.5,
    sideRooms: 4 + Math.floor(rng() * 3),
  };
}

function sampleLRUD(rng, ch, kind) {
  if (kind === "cavern") {
    const w = randRange(rng, 10, 18);
    const h = randRange(rng, 9, 16);
    return {
      left: w * randRange(rng, 0.42, 0.58),
      right: w * randRange(rng, 0.42, 0.58),
      up: h * randRange(rng, 0.72, 0.86),
      down: h * randRange(rng, 0.1, 0.2),
    };
  }
  if (kind === "chamber") {
    const w = randRange(rng, 2.6, 6.2);
    const h = randRange(rng, 2.3, 5.2);
    return {
      left: w * randRange(rng, 0.35, 0.65),
      right: w * randRange(rng, 0.35, 0.65),
      up: h * randRange(rng, 0.45, 0.7),
      down: h * randRange(rng, 0.25, 0.4),
    };
  }
  if (kind === "squeeze" || kind === "crouch") {
    return {
      left: randRange(rng, 0.7, 1.0),
      right: randRange(rng, 0.7, 1.0),
      up: randRange(rng, 0.72, 0.9),
      down: randRange(rng, 0.38, 0.5),
    };
  }
  if (kind === "crawl") {
    return {
      left: randRange(rng, 0.5, 0.7),
      right: randRange(rng, 0.5, 0.7),
      up: randRange(rng, 0.38, 0.5),
      down: randRange(rng, 0.28, 0.38),
    };
  }
  if (kind === "entrance" || kind === "exit") {
    return {
      left: randRange(rng, 1.4, 2.2),
      right: randRange(rng, 1.4, 2.2),
      up: randRange(rng, 1.6, 2.4),
      down: randRange(rng, 0.5, 0.8),
    };
  }
  const wL = Math.max(0.65, gaussian(rng, ch.meanHalfWidth, ch.widthSigma));
  const wR = Math.max(0.65, gaussian(rng, ch.meanHalfWidth, ch.widthSigma));
  return {
    left: wL,
    right: wR,
    up: Math.max(0.95, gaussian(rng, ch.meanUp, 0.28)),
    down: Math.max(0.4, gaussian(rng, ch.meanDown, 0.12)),
  };
}

function nearestStation(stations, pos, exceptId, minDist) {
  let hit = null;
  let best = minDist;
  for (const s of stations) {
    if (s.id === exceptId) continue;
    const d = Math.hypot(s.x - pos.x, s.y - pos.y, s.z - pos.z);
    if (d < best) {
      best = d;
      hit = s;
    }
  }
  return hit;
}

export function generateCave(seed, characterOverride = null) {
  const seedU = seed >>> 0;
  const rng = mulberry32(seedU);
  const ch = characterOverride ? { ...defaultCharacter(rng), ...characterOverride } : defaultCharacter(rng);
  const cave = emptyCave();
  cave.name = caveName(seedU);
  cave.seed = seedU;
  cave.source = {
    type: "procedural",
    note: "Seeded random cave in centerline + LRUD format. Real surveys can be loaded in the same shape later.",
  };

  const stations = cave.stations;
  const legs = cave.legs;
  const connected = new Set();

  function addStation(pos, kind) {
    const id = `S${stations.length}`;
    const s = { id, x: pos.x, y: pos.y, z: pos.z, kind, ...sampleLRUD(rng, ch, kind) };
    stations.push(s);
    return s;
  }

  function addLeg(a, b) {
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    if (connected.has(key) || a.id === b.id) return false;
    connected.add(key);
    legs.push({ from: a.id, to: b.id });
    return true;
  }

  const entrance = addStation({ x: 0, y: 0, z: 0 }, "entrance");
  cave.entranceId = entrance.id;

  const deg = (d) => (d * Math.PI) / 180;
  const tips = [{ station: entrance, bearing: randRange(rng, -0.2, 0.2), clino: deg(-8) }];

  let guard = 0;
  while (legs.length < ch.targetLegs && tips.length && guard++ < 500) {
    const ti = rng() < 0.6 ? 0 : Math.floor(rng() * tips.length);
    const tip = tips[ti];
    const len = clamp(
      gaussian(rng, ch.meanLegLength, ch.stdLegLength),
      ch.minLegLength,
      ch.maxLegLength,
    );
    const bearing = tip.bearing + (rng() - 0.5) * 2 * deg(ch.meanderDeg);
    let clino =
      tip.clino * 0.45 +
      deg(ch.meanClinoDeg) +
      (rng() - 0.5) * 2 * deg(ch.clinoSigmaDeg);
    clino = clamp(clino, -deg(ch.maxClinoDeg), deg(ch.maxClinoDeg));

    const horiz = len * Math.cos(clino);
    const pos = {
      x: tip.station.x + horiz * Math.sin(bearing),
      y: tip.station.y + horiz * Math.cos(bearing),
      z: tip.station.z + len * Math.sin(clino),
    };

    // Stay underground after leaving the mouth.
    if (stations.length > 2 && pos.z > -0.2) {
      pos.z = Math.min(pos.z, tip.station.z - 0.35);
    }

    const near = nearestStation(stations, pos, tip.station.id, 3.1);
    if (near) {
      if (rng() < ch.loopProbability) addLeg(tip.station, near);
      tips.splice(ti, 1);
      continue;
    }

    let kind = "passage";
    if (rng() < ch.chamberProbability) kind = "chamber";
    else if (rng() < ch.squeezeProbability) kind = "squeeze";

    const st = addStation(pos, kind);
    addLeg(tip.station, st);

    const dead = rng() < 0.07 && legs.length > 12;
    if (dead) {
      tips.splice(ti, 1);
    } else {
      tips[ti] = { station: st, bearing, clino };
    }

    if (!dead && rng() < ch.branchProbability && tips.length < ch.maxActiveTips) {
      const side = rng() < 0.5 ? 1 : -1;
      const fork = bearing + side * randRange(rng, 0.7, 1.35);
      tips.push({ station: st, bearing: fork, clino: clino * 0.35 });
      if (st.kind === "passage") st.kind = "junction";
    }
  }

  // Side rooms: short spurs off passages ending in a small chamber (dead-end grottos).
  const spurFrom = stations.filter((s) => s.kind === "passage" || s.kind === "junction");
  for (let k = 0, tries = 0; k < (ch.sideRooms || 0) && tries < 40 && spurFrom.length; tries++) {
    const base = spurFrom[Math.floor(rng() * spurFrom.length)];
    const b0 = rng() * Math.PI * 2;
    let prev = base, ok = true;
    const nLegs = 1 + Math.floor(rng() * 2);
    const made = [];
    for (let j = 0; j < nLegs; j++) {
      const len = randRange(rng, 3.5, 6.5);
      const br = b0 + (rng() - 0.5) * 0.6;
      const pos = { x: prev.x + len * Math.sin(br), y: prev.y + len * Math.cos(br), z: prev.z + randRange(rng, -1.2, 0.4) };
      if (nearestStation(stations, pos, prev.id, 3.4)) { ok = false; break; }
      const st = addStation(pos, j === nLegs - 1 ? "chamber" : "passage");
      addLeg(prev, st);
      made.push(st);
      prev = st;
    }
    if (made.length) k++;
    void ok;
  }

  // Loops: connect a few stations that are close in space but far apart along the passages.
  {
    let added = 0;
    const cand = stations.filter((s) => s.kind !== "entrance");
    for (let tries = 0; tries < 60 && added < 3; tries++) {
      const a = cand[Math.floor(rng() * cand.length)];
      const da = shortestDistances(cave, a.id);
      let best = null, bd = Infinity;
      for (const b of cand) {
        if (b === a) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 4.5 || d > 11 || Math.abs(a.z - b.z) > 2.5) continue;
        if ((da.get(b.id) ?? Infinity) < 30) continue;
        if (d < bd) { bd = d; best = b; }
      }
      if (best && addLeg(a, best)) added++;
    }
  }

  // Mark a far, preferably deep station as the exit.
  const dist = shortestDistances(cave, cave.entranceId);
  let bestId = null;
  let bestScore = -Infinity;
  for (const s of stations) {
    const d = dist.get(s.id);
    if (!isFinite(d) || s.id === cave.entranceId || d < 20) continue;
    const score = d + Math.max(0, -s.z) * 0.8;
    if (score > bestScore) {
      bestScore = score;
      bestId = s.id;
    }
  }
  if (!bestId) {
    for (const s of stations) {
      const d = dist.get(s.id) || 0;
      if (d > bestScore && s.id !== cave.entranceId) {
        bestScore = d;
        bestId = s.id;
      }
    }
  }
  if (bestId) {
    const ex = stations.find((s) => s.id === bestId);
    ex.kind = "exit";
    ex.left = Math.max(ex.left, 1.5);
    ex.right = Math.max(ex.right, 1.5);
    ex.up = Math.max(ex.up, 1.7);
    cave.exitId = ex.id;
  }

  shapeCavernsAndSqueezes(cave, rng);
  cave.character = { ...ch, ...measureCharacter(cave) };
  addWaterSystem(cave);
  return cave;
}

export function randomSeed() {
  return (Math.floor(Math.random() * 0xffffffff) || Date.now()) >>> 0;
}


/** Pick a downhill stream that ends in a chamber pool, with a waterfall lip. */
export function addWaterSystem(cave) {
  const stations = cave.stations;
  if (!stations.length) return cave;
  const smap = stationMap(cave);
  const nbrs = neighborsOf(cave);
  const rooms = stations.filter((s) => s.kind === "cavern" || s.kind === "chamber" || (s.left + s.right) > 4.2);
  const candidates = rooms.length ? rooms : stations.filter((s) => s.kind !== "entrance");
  let pool = null;
  let bestDrop = -1;
  let fromId = null;
  for (const room of candidates) {
    if (room.kind === "entrance") continue;
    for (const nid of nbrs.get(room.id) || []) {
      const n = smap.get(nid);
      if (!n) continue;
      const drop = n.z - room.z; // survey z is up; positive means neighbor is higher
      const score = drop + (room.kind === "cavern" ? 2.2 : room.kind === "chamber" ? 0.4 : 0) + (room.left + room.right) * 0.08;
      if (score > bestDrop) {
        bestDrop = score;
        pool = room;
        fromId = nid;
      }
    }
  }
  if (!pool) pool = stations[Math.floor(stations.length / 2)];
  // Walk uphill from the pool to build a stream source.
  const path = [pool.id];
  let cur = pool;
  const used = new Set([pool.id]);
  for (let i = 0; i < 10; i++) {
    let next = null;
    let nextZ = cur.z;
    for (const nid of nbrs.get(cur.id) || []) {
      if (used.has(nid)) continue;
      const n = smap.get(nid);
      if (n && n.z >= nextZ - 0.15) {
        next = n;
        nextZ = n.z;
      }
    }
    if (!next) break;
    path.push(next.id);
    used.add(next.id);
    cur = next;
  }
  path.reverse(); // high to low
  if (path.length < 2) {
    // Fall back to a short path using the incoming neighbor.
    if (fromId && fromId !== pool.id) path.unshift(fromId);
    if (path.length < 2) {
      const nb = (nbrs.get(pool.id) || [])[0];
      if (nb) path.unshift(nb);
    }
  }
  const legs = [];
  for (let i = 0; i < path.length - 1; i++) legs.push({ from: path[i], to: path[i + 1] });
  if (!fromId && path.length >= 2) fromId = path[path.length - 2];
  const fromSt = smap.get(fromId);
  const natural = fromSt ? Math.max(0, fromSt.z - pool.z) : 0;
  const big = pool.kind === "cavern";
  const lipHeight = Math.max(big ? 3.4 : 1.8, Math.min(big ? 6.5 : 4.2, natural > 1.1 ? natural + (big ? 1.2 : 0.3) : (big ? 4.4 : 2.4)));
  cave.water = {
    stationIds: path,
    legs,
    poolStationId: pool.id,
    waterfall: { stationId: pool.id, fromId: fromId || path[0], lipHeight, width: 0.9 },
    width: 0.55,
  };
  return cave;
}


function setClearance(s) {
  const h = s.up + s.down;
  if (h < 1.08) s.clearance = "crawl";
  else if (h < 1.62) s.clearance = "crouch";
  else s.clearance = "stand";
}

function inflateCavern(s, rng) {
  const w = randRange(rng, 10, 17);
  const h = randRange(rng, 9, 15);
  s.kind = "cavern";
  s.left = w * randRange(rng, 0.42, 0.58);
  s.right = w * randRange(rng, 0.42, 0.58);
  s.up = h * randRange(rng, 0.74, 0.86);
  s.down = Math.max(0.9, h * randRange(rng, 0.1, 0.18));
  s.clearance = "stand";
}

function applySqueeze(s, mode, rng) {
  if (mode === "crawl") {
    s.kind = s.kind === "entrance" || s.kind === "exit" || s.kind === "cavern" ? s.kind : "crawl";
    s.left = randRange(rng, 0.52, 0.68);
    s.right = randRange(rng, 0.52, 0.68);
    s.up = randRange(rng, 0.4, 0.5);
    s.down = randRange(rng, 0.3, 0.38);
  } else {
    s.kind = s.kind === "entrance" || s.kind === "exit" || s.kind === "cavern" ? s.kind : "crouch";
    s.left = randRange(rng, 0.72, 0.95);
    s.right = randRange(rng, 0.72, 0.95);
    s.up = randRange(rng, 0.74, 0.9);
    s.down = randRange(rng, 0.38, 0.48);
  }
  setClearance(s);
}

/** Big open halls plus crouch/crawl squeezes. The exit route stays crawl-passable. */
function shapeCavernsAndSqueezes(cave, rng) {
  const stations = cave.stations;
  const smap = stationMap(cave);
  const nbrs = neighborsOf(cave);
  if (stations.length < 8) {
    for (const s of stations) setClearance(s);
    return;
  }
  const startId = cave.entranceId || stations[0].id;
  const { path } = longestPathIds(cave, startId);
  const pathSet = new Set(path);

  // Upgrade 1-2 mid/deep stations into large caverns, and add short alcoves.
  const candidates = [];
  for (const id of path) {
    const s = smap.get(id);
    if (!s || s.kind === "entrance" || s.kind === "exit") continue;
    const i = path.indexOf(id);
    if (i < 4 || i > path.length - 3) continue;
    candidates.push(s);
  }
  const side = stations.filter((s) => !pathSet.has(s.id) && s.kind !== "entrance" && s.kind !== "exit");
  const picks = [];
  if (candidates.length) picks.push(candidates[Math.floor(candidates.length * 0.55)]);
  if (side.length && rng() < 0.85) picks.push(side[Math.floor(rng() * side.length)]);
  if (!picks.length) picks.push(stations[Math.floor(stations.length / 2)]);
  const caverns = [];
  for (const s of picks.slice(0, 2)) {
    inflateCavern(s, rng);
    caverns.push(s);
    // Flare the mouths into the hall.
    for (const nid of nbrs.get(s.id) || []) {
      const n = smap.get(nid);
      if (!n || n.kind === "entrance") continue;
      if (n.kind === "exit") continue;
      n.left = Math.max(n.left, randRange(rng, 2.2, 3.6));
      n.right = Math.max(n.right, randRange(rng, 2.2, 3.6));
      n.up = Math.max(n.up, randRange(rng, 2.4, 4.0));
    }
    // Two large alcoves so the room is a hall, not just a fat sausage.
    const p = { x: s.x, y: s.y, z: s.z };
    for (let i = 0; i < 2; i++) {
      const ang = rng() * Math.PI * 2;
      const dist = randRange(rng, 4.5, 7.5);
      const pos = {
        x: p.x + Math.sin(ang) * dist,
        y: p.y + Math.cos(ang) * dist,
        z: p.z + randRange(rng, -1.2, 0.4),
      };
      const id = `S${stations.length}`;
      const alc = {
        id, x: pos.x, y: pos.y, z: pos.z, kind: "cavern",
        left: randRange(rng, 3.5, 6), right: randRange(rng, 3.5, 6),
        up: randRange(rng, 5, 9), down: randRange(rng, 0.8, 1.4),
        clearance: "stand",
      };
      stations.push(alc);
      smap.set(id, alc);
      cave.legs.push({ from: s.id, to: id });
    }
  }
  cave.cavernIds = caverns.map((s) => s.id);

  // Crouch and crawl on the route to the exit (and a side passage if any).
  const usable = path.filter((id) => {
    const s = smap.get(id);
    return s && s.kind !== "entrance" && s.kind !== "exit" && s.kind !== "cavern";
  });
  function takeSlice(startFrac, mode) {
    if (usable.length < 4) return;
    let i = Math.floor(usable.length * startFrac);
    i = Math.max(1, Math.min(usable.length - 2, i));
    // Avoid squeezing right next to a cavern mouth.
    const ids = [usable[i]];
    if (usable[i + 1] && rng() < 0.7) ids.push(usable[i + 1]);
    for (const id of ids) {
      const s = smap.get(id);
      if (!s || s.kind === "cavern") continue;
      applySqueeze(s, mode, rng);
    }
  }
  takeSlice(0.32, "crouch");
  takeSlice(0.62, "crawl");
  // A side-passage squeeze, if one exists.
  const spur = stations.find((s) => !pathSet.has(s.id) && s.kind === "passage");
  if (spur) applySqueeze(spur, rng() < 0.5 ? "crawl" : "crouch", rng);

  for (const s of stations) {
    if (!s.clearance) setClearance(s);
    // Never tighter than a crawl, so the exit stays reachable.
    if (s.up + s.down < 0.68) {
      s.up = Math.max(s.up, 0.4);
      s.down = Math.max(s.down, 0.3);
    }
    if (s.left + s.right < 0.95) {
      s.left = Math.max(s.left, 0.5);
      s.right = Math.max(s.right, 0.5);
    }
    setClearance(s);
  }
}
