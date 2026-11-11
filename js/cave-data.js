/** Generic cave survey format: stations with LRUD widths, and legs between them.
 *
 * Survey coordinates: x = east (m), y = north (m), z = up (m).
 * Station LRUD is left/right/up/down in metres from the station (centerline).
 * This is the same idea as Survex/Compass passage data, so a real survey can
 * be converted into this JSON (or a simple CSV) later.
 */

export const FORMAT_VERSION = 1;

export function emptyCave() {
  return {
    format: "cavern-centerline-v1",
    version: FORMAT_VERSION,
    name: "Untitled",
    seed: null,
    source: { type: "procedural", note: "Generated in-engine." },
    character: null,
    stations: [],
    legs: [],
    entranceId: null,
    exitId: null,
  };
}

export function stationMap(cave) {
  const map = new Map();
  for (const s of cave.stations) map.set(s.id, s);
  return map;
}

export function neighborsOf(cave) {
  const n = new Map();
  for (const s of cave.stations) n.set(s.id, []);
  for (const leg of cave.legs) {
    if (!n.has(leg.from) || !n.has(leg.to)) continue;
    n.get(leg.from).push(leg.to);
    n.get(leg.to).push(leg.from);
  }
  return n;
}

export function dist3(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Convert survey (x east, y north, z up) to Three.js (x east, y up, z south). */
export function toWorld(s) {
  return { x: s.x, y: s.z, z: -s.y };
}

export function stationWorld(s) {
  return toWorld(s);
}

export function shortestDistances(cave, startId) {
  const nbrs = neighborsOf(cave);
  const dist = new Map();
  for (const s of cave.stations) dist.set(s.id, Infinity);
  if (!dist.has(startId)) return dist;
  dist.set(startId, 0);
  const q = [startId];
  const smap = stationMap(cave);
  while (q.length) {
    const id = q.shift();
    const a = smap.get(id);
    for (const bid of nbrs.get(id) || []) {
      const d = dist.get(id) + dist3(a, smap.get(bid));
      if (d < dist.get(bid)) {
        dist.set(bid, d);
        q.push(bid);
      }
    }
  }
  return dist;
}

export function longestPathIds(cave, startId) {
  const dist = shortestDistances(cave, startId);
  let farId = startId;
  let far = -1;
  for (const [id, d] of dist) {
    if (d < Infinity && d > far) {
      far = d;
      farId = id;
    }
  }
  // Reconstruct a path to the farthest station.
  const nbrs = neighborsOf(cave);
  const smap = stationMap(cave);
  const path = [farId];
  let cur = farId;
  const guard = new Set();
  while (cur !== startId && !guard.has(cur)) {
    guard.add(cur);
    let best = null;
    let bestD = dist.get(cur);
    for (const n of nbrs.get(cur) || []) {
      const d = dist.get(n);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (best == null) break;
    path.push(best);
    cur = best;
  }
  path.reverse();
  return { path, length: far, endId: farId };
}

export function totalLength(cave) {
  const smap = stationMap(cave);
  let len = 0;
  for (const leg of cave.legs) {
    const a = smap.get(leg.from);
    const b = smap.get(leg.to);
    if (a && b) len += dist3(a, b);
  }
  return len;
}

export function depthRange(cave) {
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of cave.stations) {
    if (s.z < minZ) minZ = s.z;
    if (s.z > maxZ) maxZ = s.z;
  }
  return { minZ, maxZ, depth: maxZ - minZ };
}

/** Estimate passage character, so a later real survey can drive maze generation. */
export function measureCharacter(cave) {
  const smap = stationMap(cave);
  const lengths = [];
  const sloped = [];
  for (const leg of cave.legs) {
    const a = smap.get(leg.from);
    const b = smap.get(leg.to);
    if (!a || !b) continue;
    const len = dist3(a, b);
    lengths.push(len);
    const horiz = Math.hypot(b.x - a.x, b.y - a.y);
    sloped.push(Math.atan2(b.z - a.z, horiz) * 180 / Math.PI);
  }
  const nbrs = neighborsOf(cave);
  let branches = 0;
  let chambers = 0;
  const widths = [];
  for (const s of cave.stations) {
    const deg = (nbrs.get(s.id) || []).length;
    if (deg >= 3) branches += 1;
    if (s.kind === "chamber" || (s.left + s.right) > 5) chambers += 1;
    widths.push(s.left, s.right, s.up, s.down);
  }
  const mean = (arr) => (arr.length ? arr.reduce((p, c) => p + c, 0) / arr.length : 0);
  const std = (arr) => {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((p, c) => p + (c - m) ** 2, 0) / arr.length);
  };
  return {
    meanLegLength: mean(lengths),
    stdLegLength: std(lengths),
    meanSlopeDeg: mean(sloped),
    stdSlopeDeg: std(sloped),
    branchRate: cave.stations.length ? branches / cave.stations.length : 0,
    chamberRate: cave.stations.length ? chambers / cave.stations.length : 0,
    meanLeft: mean(cave.stations.map((s) => s.left)),
    meanRight: mean(cave.stations.map((s) => s.right)),
    meanUp: mean(cave.stations.map((s) => s.up)),
    meanDown: mean(cave.stations.map((s) => s.down)),
    stationCount: cave.stations.length,
    legCount: cave.legs.length,
    surveyLength: totalLength(cave),
  };
}

export function parseJSONSurvey(text) {
  const data = typeof text === "string" ? JSON.parse(text) : text;
  if (!data || !Array.isArray(data.stations) || !Array.isArray(data.legs)) {
    throw new Error("Survey JSON needs stations[] and legs[].");
  }
  const cave = emptyCave();
  cave.name = data.name || "Imported survey";
  cave.seed = data.seed ?? null;
  cave.source = data.source || { type: "json", note: "Loaded from a file." };
  cave.stations = data.stations.map((s, i) => normalizeStation(s, i));
  cave.legs = data.legs.map((l) => ({ from: String(l.from), to: String(l.to) }));
  cave.entranceId = data.entranceId || findKind(cave, "entrance") || cave.stations[0]?.id || null;
  cave.exitId = data.exitId || findKind(cave, "exit") || null;
  cave.character = data.character || measureCharacter(cave);
  // Optional extras used by traced caves (named formations, pools, visual style).
  if (Array.isArray(data.features)) cave.features = data.features;
  if (Array.isArray(data.pools)) cave.pools = data.pools;
  if (data.style) cave.style = data.style;
  return cave;
}

export function parseCSVSurvey(text) {
  const lines = String(text).replace(/\r/g, "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith(";"));
  const cave = emptyCave();
  cave.name = "Imported CSV";
  cave.source = { type: "csv", note: "Stations as id,x,y,z,left,right,up,down[,kind]. Optional from,to legs." };
  let mode = "stations";
  for (const line of lines) {
    const low = line.toLowerCase();
    if (low.startsWith("id,") || low.startsWith("station")) {
      mode = "stations";
      continue;
    }
    if (low.startsWith("from,") || low === "legs") {
      mode = "legs";
      continue;
    }
    const parts = line.split(",").map((p) => p.trim());
    if (mode === "legs" || (parts.length === 2 && Number.isNaN(Number(parts[1])))) {
      cave.legs.push({ from: parts[0], to: parts[1] });
    } else if (parts.length >= 7) {
      cave.stations.push(normalizeStation({
        id: parts[0],
        x: +parts[1], y: +parts[2], z: +parts[3],
        left: +parts[4], right: +parts[5], up: +parts[6], down: +parts[7] || 0.6,
        kind: parts[8] || "passage",
      }));
    }
  }
  if (!cave.legs.length && cave.stations.length > 1) {
    for (let i = 0; i < cave.stations.length - 1; i++) {
      cave.legs.push({ from: cave.stations[i].id, to: cave.stations[i + 1].id });
    }
  }
  cave.entranceId = findKind(cave, "entrance") || cave.stations[0]?.id || null;
  cave.exitId = findKind(cave, "exit") || null;
  cave.character = measureCharacter(cave);
  return cave;
}

function findKind(cave, kind) {
  return cave.stations.find((s) => s.kind === kind)?.id ?? null;
}

function normalizeStation(s, i = 0) {
  return {
    id: String(s.id ?? `S${i}`),
    x: Number(s.x) || 0,
    y: Number(s.y) || 0,
    z: Number(s.z) || 0,
    left: Math.max(0.2, Number(s.left) || 1),
    right: Math.max(0.2, Number(s.right) || 1),
    up: Math.max(0.2, Number(s.up) || 1),
    down: Math.max(0.2, Number(s.down) || 0.6),
    kind: s.kind || "passage",
    ...(s.label ? { label: String(s.label) } : {}),
    ...(s.zone ? { zone: String(s.zone) } : {}),
    ...(s.lit != null ? { lit: !!s.lit } : {}),
    ...(s.clearance ? { clearance: s.clearance } : {}),
  };
}

export function caveToJSON(cave) {
  return JSON.stringify(cave, null, 2);
}
