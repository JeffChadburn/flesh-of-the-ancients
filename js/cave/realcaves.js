/**
 * Round 27: every cave is modeled after a real cave. Layouts: data/real-caves/*.json (approximate,
 * playable layouts from public / public-domain sources; see docs/real-caves/README.md). Each world
 * entrance maps to one layout (seeded), assembled from the shared modules in modules.js with a little
 * seeded variation (side passages, meander, lobes, which squeezes are crawls), so a cave is the same
 * every visit (and for every player in a room) but two entrances using the same layout differ.
 */
import { mulberry32 } from "../rng.js";
import { emptyCave, measureCharacter } from "../cave-data.js";
import { makeAssembly, hallModule, sectionModule, junctionModule, relaxSlopes, sidePassages, streamModule, setClearance, checkCave } from "./modules.js";

export const REAL_CAVES = {
  lascaux: { name: "Lascaux", full: "Lascaux Cave (France)", style: "painted",
    credit: "Room order and published dimensions (French Ministry of Culture site; fr.wikipedia). Approximate layout, not a tracing of any plan." },
  carlsbad: { name: "Carlsbad Cavern", full: "Carlsbad Cavern (New Mexico, USA)", style: "carlsbad",
    credit: "U.S. National Park Service maps and tour pages (public domain). Approximate traced tour centerline." },
  mammoth: { name: "Mammoth Cave", full: "Mammoth Cave (Kentucky, USA)", style: "mammoth",
    credit: "Max Kämper's 1908 map (public domain), Hovey's handbook (public domain) and NPS pages. Scaled 0.35× across, 0.5× in height." },
  "wind-cave": { name: "Wind Cave", full: "Wind Cave (South Dakota, USA)", style: "windcave",
    credit: "NPS Wind Cave tour-route map (public domain), elevations from its labels. A few short boxwork spurs are invented." },
  lehman: { name: "Lehman Caves", full: "Lehman Caves (Nevada, USA)", style: "lehman",
    credit: "NPS Great Basin dimensions page (data credited to the Southern Nevada Grotto, NSS) and historic NPS brochure plan (public domain)." },
  timpanogos: { name: "Timpanogos Cave", full: "Timpanogos Cave (Utah, USA)", style: "timpanogos",
    credit: "NPS tour pages and the NPS trail-map cave section (public domain). The 2003 Timpanogos Cave Atlas was not used." },
};
export const REAL_IDS = ["lascaux", "carlsbad", "mammoth", "wind-cave", "lehman", "timpanogos"];

const cache = new Map(), ready = new Map();
export async function loadLayout(id) {
  if (!REAL_CAVES[id]) throw new Error("unknown real cave " + id);
  if (!cache.has(id)) cache.set(id, fetch(`data/real-caves/${id}.json`).then((r) => { if (!r.ok) throw new Error(`${id}: HTTP ${r.status}`); return r.json(); }).then((j) => { ready.set(id, j); return j; }));
  return cache.get(id);
}
/** Fetch all six up front (small files) so a cave can be built synchronously later. */
export function preloadLayouts() { return Promise.all(REAL_IDS.map((id) => loadLayout(id).catch(() => null))); }
export function layoutSync(id) { return ready.get(id) || null; }
/** Numeric seeds (?seed=, New cave) map onto the five assembled layouts; "lehman:5" picks one. */
export function realFromSeed(raw, seedNum) {
  const m = /^([a-z-]+)(?::(\d+))?$/.exec(String(raw ?? "").trim().toLowerCase());
  if (m && REAL_CAVES[m[1]]) return { id: m[1], seed: m[2] != null ? Number(m[2]) >>> 0 : seedNum };
  const ids = REAL_IDS.filter((i) => i !== "carlsbad");
  return { id: ids[(seedNum >>> 0) % ids.length], seed: seedNum >>> 0 };
}

/** Which real cave an entrance opens into. Story caves are fixed; the rest are a seeded deal of
 *  the six so each world has every layout at least once where it can. */
export function realCaveFor(entrance, entrances = [], storyCaveId = null) {
  if (!entrance) return "lascaux";
  if (entrance.hollow || entrance.cave === "hollow") return "lascaux";      // the painted first cave
  if (entrance.cave === "carlsbad") return "carlsbad";
  if (storyCaveId != null && entrance.id === storyCaveId) return "wind-cave"; // "breathing walls" (Throat of Ash)
  const pool = ["mammoth", "lehman", "timpanogos", "wind-cave", "lascaux"];
  const others = entrances.filter((e) => !e.hollow && e.cave !== "carlsbad" && e.id !== storyCaveId).sort((a, b) => a.id - b.id);
  const seed = others.reduce((h, e) => (Math.imul(h ^ (Number(e.cave) >>> 0), 2654435761) >>> 0), 0x2b7);
  const r = mulberry32(seed);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  if (storyCaveId != null) pool.splice(pool.indexOf("wind-cave"), 1), pool.push("wind-cave");
  const i = others.findIndex((e) => e.id === entrance.id);
  return pool[(i < 0 ? (Number(entrance.cave) >>> 0) : i) % pool.length];
}

const FEATURE_MAP = { heart: "dome", shield: "drapes", helictites: "column", stalactite: "column", frostwork: "column", boxwork: null, pit: "pit", boulder: "boulder", drapes: "drapes", dome: "dome", column: "column", totem: "totem" };

/**
 * Assemble a playable cave from a layout.
 * opts: { story: "hollow" | null, variation: true, squeezes: true }
 */
export function buildRealCave(layout, id, seed, opts = {}) {
  const meta = REAL_CAVES[id] || { name: layout.name, full: layout.name, credit: "" };
  const A = makeAssembly(layout, seed);
  const r = A.rng;
  // 1. per-station jitter (not on squeezes / entrances: those stay as surveyed)
  for (const s of A.stations) {
    if (A.has(s, "squeeze") || s.kind === "entrance" || s.kind === "exit") continue;
    const j = () => 0.92 + r() * 0.16;
    s.left *= j(); s.right *= j(); s.up *= j();
  }
  // 2. halls (lopsided rooms + lobes)
  for (const s of [...A.stations]) if (A.has(s, "hall") || s.kind === "cavern" || s.module === "hall") hallModule(A, s, { lobes: opts.variation !== false });
  // 3. tunnels, squeezes and pits along every leg
  sectionModule(A, { squeezes: opts.squeezes !== false });
  // 4. junctions
  junctionModule(A);
  relaxSlopes(A);
  // 5. variation: short side passages
  if (opts.variation !== false) sidePassages(A, 1 + Math.floor(r() * 3));
  // 6. assemble
  const cave = emptyCave();
  cave.name = meta.name;
  cave.seed = seed >>> 0;
  cave.real = { id, name: meta.name, full: meta.full, credit: meta.credit, source: layout.source?.note || "" };
  cave.source = { type: "real-cave", note: `Inspired by ${meta.full}. ${meta.credit}` };
  cave.style = id === "carlsbad" ? "carlsbad" : meta.style;
  cave.stations = A.stations.map((s) => {
    const o = { ...s };
    if (o.kind === "squeeze") o.kind = "passage";
    if (!o.down || o.down < 0.3) o.down = 0.3;
    if (o.left + o.right < 1.0) { o.left = Math.max(o.left, 0.5); o.right = Math.max(o.right, 0.5); }
    if (o.up + o.down < 0.72) o.up = Math.max(o.up, 0.42);
    return setClearance(o);
  });
  cave.legs = A.legs;
  cave.entranceId = layout.entranceId;
  cave.exitId = layout.exitId;
  cave.features = (layout.features || []).map((f) => ({ ...f, type: FEATURE_MAP[f.type] ?? null, h: f.type === "helictites" || f.type === "frostwork" ? Math.min(f.h || 2, 1.6) : f.h,
    r: f.type === "helictites" || f.type === "frostwork" || f.type === "stalactite" ? Math.min(f.r || 0.6, 0.5) : f.r })).filter((f) => f.type);
  cave.pools = (layout.pools || []).slice();
  cave.water = streamModule(A) || null;
  cave.character = measureCharacter(cave);
  cave.modules = A.report;
  cave.check = checkCave(cave);
  if (opts.story === "hollow") { cave.kind = "hollow"; }
  return cave;
}
