/**
 * Round 27: modular cave pieces.
 *
 * A real-cave layout (data/real-caves/*.json: a few anchor stations with LRUD widths, tags and a
 * `module` name) is assembled into the game's centerline format by a small set of shared, tested
 * modules. Each module only writes stations + legs; the wall mesh (mesh.js tubes + rock hubs),
 * walk volume (volume.js), formations, water and the minimap are all built from those, so a piece
 * looks, collides and maps the same way wherever it is used.
 *
 *   tunnel    legs split into ~5-9 m sections with a gentle meander and width / height drift
 *   junction  3+ way stations: flared, and the branches fanned out to at least JUNCTION_MIN_DEG
 *             so tubes don't run inside each other for metres (the old seams / odd wedges)
 *   hall      big rooms: irregular footprint (side lobes, uneven ceiling; see mesh.js hallRoof)
 *   squeeze   one crouch or crawl neck per squeeze chain, eased in over a section either side
 *   pit       drops steeper than PIT_SLOPE become a walkable switchback (long drops) or a spiral
 *             ramp round a shaft (short, deep drops), never steeper than RAMP_SLOPE
 *   stream    stream-tagged stations carry the water (pool + waterfall at the low end)
 *
 * Everything is seeded: the same layout + seed always builds the same cave (multiplayer, saves).
 */
import { mulberry32, randRange, clamp } from "../rng.js";
import { stationMap, neighborsOf } from "../cave-data.js";

export const PIT_SLOPE = 0.62;   // steeper than this (rise / run) is a pit, not a slope
export const RAMP_SLOPE = 0.5;   // pit ramps are built no steeper than this
export const JUNCTION_MIN_DEG = 38;
export const MODULES = ["tunnel", "junction", "hall", "squeeze", "pit", "stream"];

const H = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const D3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const size = (s) => Math.max(s.left, s.right, s.up);

export function setClearance(s) {
  const h = s.up + s.down;
  s.clearance = h < 1.08 ? "crawl" : h < 1.62 ? "crouch" : "stand";
  return s;
}

/** Closest 3D distance between segment pq and segment rs (sampled; good enough for layout checks). */
function segDist(p, q, r, s) {
  let best = Infinity;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8, a = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t };
    const dx = s.x - r.x, dy = s.y - r.y, dz = s.z - r.z, L2 = dx * dx + dy * dy + dz * dz || 1;
    const u = clamp(((a.x - r.x) * dx + (a.y - r.y) * dy + (a.z - r.z) * dz) / L2, 0, 1);
    best = Math.min(best, Math.hypot(a.x - r.x - dx * u, a.y - r.y - dy * u, a.z - r.z - dz * u));
  }
  return best;
}

/** Context shared by the modules while one cave is assembled. */
export function makeAssembly(layout, seed) {
  const rng = mulberry32((seed >>> 0) ^ 0x5ca1ab1e);
  const st = layout.stations.map((s) => ({ ...s, tags: [...(s.tags || [])] }));
  const A = {
    rng, seed: seed >>> 0, stations: st, legs: layout.legs.map((l) => ({ from: l.from, to: l.to })),
    smap: new Map(st.map((s) => [s.id, s])), report: { modules: {}, notes: [] },
    count(m, n = 1) { this.report.modules[m] = (this.report.modules[m] || 0) + n; },
    add(s) { this.stations.push(s); this.smap.set(s.id, s); return s; },
    has(s, tag) { return (s.tags || []).includes(tag); },
    /** Room around a point: distance to every leg not touching `excl`, within a height band. */
    room(p, excl = [], band = 6) {
      let best = Infinity;
      for (const l of this.legs) {
        if (excl.includes(l.from) || excl.includes(l.to)) continue;
        const a = this.smap.get(l.from), b = this.smap.get(l.to);
        if (!a || !b) continue;
        if (Math.min(a.z, b.z) - band > p.z || Math.max(a.z, b.z) + band < p.z) continue;
        const r = Math.max(size(a), size(b));
        best = Math.min(best, segDist(p, p, a, b) - r);
      }
      return best;
    },
  };
  return A;
}

/* ---------------------------------------------------------------- hall */
/** Big rooms: classify, make the footprint lopsided and add 0-2 side lobes where there is room. */
export function hallModule(A, s, { lobes = true } = {}) {
  const big = Math.max(s.left, s.right) >= 6 || s.up >= 9;
  if (!big) { if (s.kind === "passage") s.kind = "chamber"; A.count("hall(chamber)"); return; }
  s.kind = "cavern";
  const r = A.rng;
  // lopsided: one side reaches further, the ceiling is uneven (mesh.js hallRoof uses irr / roofK)
  const k = randRange(r, 0.82, 1.12);
  s.left *= k; s.right *= 2 - k;
  s.irr = +randRange(r, 0.25, 0.6).toFixed(2);
  s.roofPhase = +randRange(r, 0, 6.283).toFixed(3);
  A.count("hall");
  if (!lobes) return;
  const n = r() < 0.75 ? (r() < 0.45 ? 2 : 1) : 0;
  for (let i = 0; i < n; i++) {
    const R = Math.max(4, Math.min(s.left, s.right) * randRange(r, 0.45, 0.7));
    let pos = null;
    for (let t = 0; t < 12 && !pos; t++) {
      const ang = r() * Math.PI * 2, dist = Math.max(s.left, s.right) * randRange(r, 0.7, 1.0) + R * 0.5;
      const c = { x: s.x + Math.cos(ang) * dist, y: s.y + Math.sin(ang) * dist, z: s.z - s.down + Math.max(1.2, s.down * 0.8) + randRange(r, -0.6, 0.3) };
      if (A.room(c, [s.id], 8) > R + 3 && A.stations.every((o) => o === s || o.kind !== "cavern" || H(o, c) > R + Math.max(o.left, o.right) + 2)) pos = c;
    }
    if (!pos) continue;
    const id = `${s.id}~lobe${i}`;
    const up = Math.max(5, s.up * randRange(r, 0.45, 0.8));
    A.add({ id, x: pos.x, y: pos.y, z: pos.z, kind: "cavern", left: R, right: R * randRange(r, 0.8, 1.15), up, down: Math.max(1.0, s.down * 0.8),
      zone: s.zone, tags: ["hall", "lobe"], module: "hall", irr: +randRange(r, 0.3, 0.6).toFixed(2), roofPhase: +randRange(r, 0, 6.283).toFixed(3) });
    A.legs.push({ from: s.id, to: id });
    A.count("hall lobe");
  }
}

/* ---------------------------------------------------------------- pit */
/**
 * A drop steeper than PIT_SLOPE. Long horizontal runs zig-zag (switchbacks); short deep drops spiral
 * round a central shaft. Returns the list of inner points (survey coords) from a to b.
 */
export function pitPath(a, b, rng, roomAt = () => Infinity) {
  const run = H(a, b), drop = Math.abs(b.z - a.z);
  const need = drop / RAMP_SLOPE;
  if (need <= run * 1.02) return [];
  const w = clamp((Math.min(a.left, 4) + Math.min(a.right, 4) + Math.min(b.left, 4) + Math.min(b.right, 4)) / 4, 1.6, 3);
  const ax = (b.x - a.x) / (run || 1), ay = (b.y - a.y) / (run || 1);
  const px = -ay, py = ax;
  const pts = [];
  if (run >= Math.max(14, w * 5)) {
    // switchbacks: n legs, points pushed sideways alternately (+L, -L, ...). Height is spread by
    // horizontal length, so every leg has the same gentle slope; L is solved so the total is `need`.
    const n = Math.max(2, Math.min(8, Math.floor(run / (w * 2.6))));
    const along = run / n, side = roomAt(1) >= roomAt(-1) ? 1 : -1;
    const lats = (L) => Array.from({ length: n + 1 }, (_, i) => (i === 0 || i === n ? 0 : (i % 2 ? 1 : -1) * side * L));
    const total = (L) => { const q = lats(L); let t = 0; for (let i = 0; i < n; i++) t += Math.hypot(along, q[i + 1] - q[i]); return t; };
    let lo = 0, hi = need;
    for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (total(m) < need) lo = m; else hi = m; }
    const q = lats(hi), tot = total(hi);
    let acc = 0;
    for (let i = 1; i < n; i++) {
      acc += Math.hypot(along, q[i] - q[i - 1]);
      const t = i / n, f = acc / tot;
      pts.push({ x: a.x + (b.x - a.x) * t + px * q[i], y: a.y + (b.y - a.y) * t + py * q[i], z: a.z + (b.z - a.z) * f, sw: true });
    }
    return pts;
  }
  // spiral ramp round a shaft centred off the leg, radius so one turn drops >= 2.6x the passage height
  const hgt = clamp((Math.min(a.up, 4) + a.down + Math.min(b.up, 4) + b.down) / 2, 2.4, 4.5);
  const R = Math.max(w * 1.6, (hgt * 2.6) / (2 * Math.PI * RAMP_SLOPE), 3.2);
  const side = roomAt(1) >= roomAt(-1) ? 1 : -1;
  const cx = (a.x + b.x) / 2 + px * R * side, cy = (a.y + b.y) / 2 + py * R * side;
  const a0 = Math.atan2(a.y - cy, a.x - cx), a1 = Math.atan2(b.y - cy, b.x - cx);
  // sweep enough angle (same direction) to make the length
  const turns = need / (2 * Math.PI * R);
  let sweep = Math.max(Math.PI * 0.6, turns * Math.PI * 2);
  let d = a1 - a0; while (d <= 0) d += Math.PI * 2;
  sweep = d + Math.PI * 2 * Math.max(0, Math.ceil((sweep - d) / (Math.PI * 2) - 0.05));
  const steps = Math.max(4, Math.ceil(sweep / (Math.PI / 4)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps, ang = a0 + sweep * t;
    pts.push({ x: cx + Math.cos(ang) * R, y: cy + Math.sin(ang) * R, z: a.z + (b.z - a.z) * t, spiral: true, cx, cy, R });
  }
  return pts;
}

/* ---------------------------------------------------------------- tunnel + squeeze + pit (per leg) */
/** Split every leg into sections; squeezes and pits are applied on the way. */
export function sectionModule(A, { squeezes = true } = {}) {
  const r = A.rng;
  const legs0 = hallPortals(A);
  A.legs = [];
  const chainDone = new Set();
  let squeezeN = 0;
  for (const leg of legs0) {
    const a = A.smap.get(leg.from), b = A.smap.get(leg.to);
    if (!a || !b) continue;
    const bothHall = a.kind === "cavern" || b.kind === "cavern"; // hall mouths are never split
    const run = H(a, b), slope = bothHall ? 0 : Math.abs(b.z - a.z) / Math.max(0.1, run);
    let inner = [];
    let mod = "tunnel";
    if (slope > PIT_SLOPE) {
      const ax = (b.x - a.x) / (run || 1), ay = (b.y - a.y) / (run || 1);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
      const roomAt = (sgn) => A.room({ x: mid.x - ay * 8 * sgn, y: mid.y + ax * 8 * sgn, z: mid.z }, [a.id, b.id], 10);
      inner = pitPath(a, b, r, roomAt);
      mod = "pit";
      A.count("pit");
      if (inner[0]?.spiral) A.report.notes.push(`pit spiral ${a.id}->${b.id} R=${inner[0].R.toFixed(1)}`);
    }
    // tunnel sections (also between pit switchback points)
    const pts = [a, ...inner, b];
    const out = [a];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const L = D3(p, q);
      const big = Math.max(size(a), size(b));
      const step = bothHall ? Infinity : clamp(big * 1.4, 5, 9);
      const n = Math.max(1, Math.round(L / step));
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        if (k === n) { if (i + 1 < pts.length - 1) out.push(q); continue; }
        const dx = q.x - p.x, dy = q.y - p.y, h = Math.hypot(dx, dy) || 1;
        // gentle meander: a smooth lateral offset, zero at both ends, never more than 40% of the width
        const w = Math.min(a.left + a.right, b.left + b.right) / 2;
        const amp = mod === "pit" || p.spiral ? 0 : Math.min(1.4, w * 0.4) * Math.sin(Math.PI * t) * (r() * 2 - 1);
        out.push({ x: p.x + dx * t - (dy / h) * amp, y: p.y + dy * t + (dx / h) * amp, z: p.z + (q.z - p.z) * t + (mod === "pit" ? 0 : (r() - 0.5) * 0.3) });
      }
    }
    out.push(b);
    // materialise inner stations
    const ids = [a.id];
    for (let i = 1; i < out.length - 1; i++) {
      const p = out[i], t = i / (out.length - 1);
      const lerp = (k) => a[k] + (b[k] - a[k]) * t;
      const j = () => randRange(r, 0.9, 1.1);
      const s = A.add({
        id: `${a.id}~${b.id}~${i}`, x: p.x, y: p.y, z: p.z, kind: "passage",
        left: Math.max(0.7, Math.min(lerp("left"), 6) * j()), right: Math.max(0.7, Math.min(lerp("right"), 6) * j()),
        up: Math.max(1.0, Math.min(lerp("up"), 7) * j()), down: Math.max(0.4, Math.min(lerp("down"), 1.2)),
        zone: t < 0.5 ? a.zone : b.zone, tags: (t < 0.5 ? a.tags : b.tags).filter((g) => g !== "hall" && g !== "entrance"), module: mod,
      });
      if (mod === "pit") { s.left = Math.max(s.left, 1.3); s.right = Math.max(s.right, 1.3); s.up = Math.max(s.up, 2.2); }
      ids.push(s.id);
    }
    ids.push(b.id);
    for (let i = 0; i < ids.length - 1; i++) A.legs.push({ from: ids[i], to: ids[i + 1] });
    A.count(mod, ids.length - 1);
    // squeeze: one neck per squeeze chain (stations sharing the tag), in the middle of a leg
    const sq = A.has(a, "squeeze") || A.has(b, "squeeze");
    if (squeezes && sq && mod !== "pit" && ids.length >= 3) {
      const chain = A.has(a, "squeeze") ? a.id : b.id;
      const key = chainKey(A, chain, legs0);
      if (!chainDone.has(key)) {
        chainDone.add(key);
        const mid = Math.floor(ids.length / 2), neck = A.smap.get(ids[mid]);
        const crawl = r() < 0.45;
        Object.assign(neck, crawl
          ? { left: randRange(r, 0.55, 0.68), right: randRange(r, 0.55, 0.68), up: randRange(r, 0.44, 0.52), down: randRange(r, 0.32, 0.38), kind: "crawl" }
          : { left: randRange(r, 0.75, 0.95), right: randRange(r, 0.75, 0.95), up: randRange(r, 0.8, 0.95), down: randRange(r, 0.4, 0.48), kind: "crouch" });
        neck.module = "squeeze";
        // ease in: the sections either side close down part of the way
        for (const j of [mid - 1, mid + 1]) {
          const s = A.smap.get(ids[j]);
          if (!s || j === 0 || j === ids.length - 1) continue;
          s.left = Math.min(s.left, neck.left + 0.45); s.right = Math.min(s.right, neck.right + 0.45);
          s.up = Math.min(s.up, neck.up + 0.6);
        }
        squeezeN++;
        A.count(crawl ? "squeeze(crawl)" : "squeeze(crouch)");
      }
    }
  }
  return squeezeN;
}
/** Hall mouths: a leg that meets a cavern first runs flat from the hall to a portal station just
 *  outside the hall's (bulged) wall, at hall-floor level. Everything that climbs, drops or meanders
 *  happens beyond the portal, so no section / ramp / spiral ever floats inside a hall. */
export function hallPortals(A) {
  const out = [];
  // a hall never swallows the passage stations around it: shrink it so each non-hall neighbour
  // sits outside its bulged wall with room for a mouth (a station inside a hall = ragged rock)
  for (const l of A.legs) {
    const a = A.smap.get(l.from), b = A.smap.get(l.to);
    if (!a || !b || (a.kind === "cavern") === (b.kind === "cavern")) continue;
    const c = a.kind === "cavern" ? a : b, o = c === a ? b : a;
    const maxR = (H(c, o) - 4.5) / 1.5, R = Math.max(c.left, c.right);
    const steep = Math.abs((o.z - o.down) - (c.z - c.down)) / Math.max(0.1, H(c, o)) > PIT_SLOPE;
    if (R > maxR && maxR >= 4 && !steep) {
      const k = maxR / R; c.left *= k; c.right *= k;
      A.report.notes.push(`hall ${c.id} R ${R.toFixed(1)}->${maxR.toFixed(1)}`);
    }
  }
  for (const leg of A.legs) {
    const a = A.smap.get(leg.from), b = A.smap.get(leg.to);
    if (!a || !b) continue;
    const ca = a.kind === "cavern", cb = b.kind === "cavern";
    if (ca && cb) {
      // hall -> hall: if there is a real gap between the walls, it becomes mouth + passage + mouth
      const Ma = Math.max(a.left, a.right), Mb = Math.max(b.left, b.right);
      let Ra = Ma * 1.5 + 1.5, Rb = Mb * 1.5 + 1.5;
      const run = H(a, b);
      if (run - Ra - Rb < 5) {
        // a near miss: pull both mouths in (still clear of the bulged walls) rather than join two
        // big spheres with a fat tube, whose cut can seal the hall wall (Lehman Grand Palace)
        const s = (run - 5) / (Ra + Rb);
        const dF = Math.abs((a.z - a.down) - (b.z - b.down));
        if (dF <= 5 && Ra * s >= Ma * 1.2 + 1 && Rb * s >= Mb * 1.2 + 1) { Ra *= s; Rb *= s; A.report.notes.push(`pulled mouths ${a.id}-${b.id} s ${s.toFixed(2)} ${a.id}:${Ma.toFixed(1)} ${b.id}:${Mb.toFixed(1)} run ${run.toFixed(1)}`); }
      }
      if (String(a.id).includes("lobe") || String(b.id).includes("lobe") || run - Ra - Rb < 4.9) { out.push(leg); continue; }
      const mk = (c, o, R) => {
        const k = R / run, down = Math.max(0.6, Math.min(Math.min(a.down, b.down), 1.2));
        return A.add({
          id: `${c.id}^${o.id}`, x: c.x + (o.x - c.x) * k, y: c.y + (o.y - c.y) * k, z: c.z - c.down + down + clamp((o.z - o.down) - (c.z - c.down), 0, 2),
          kind: "passage", module: "mouth", left: clamp(Math.min(a.left, b.left) * 0.45, 2.2, 5.5), right: clamp(Math.min(a.right, b.right) * 0.45, 2.2, 5.5),
          up: clamp(Math.min(a.up, b.up) * 0.5, 2.8, 7), down, zone: "passage", tags: [],
        });
      };
      const PA = mk(a, b, Ra), PB = mk(b, a, Rb);
      A.count("mouth", 2);
      out.push({ from: a.id, to: PA.id }, { from: PA.id, to: PB.id }, { from: PB.id, to: b.id });
      continue;
    }
    if (ca === cb) { out.push(leg); continue; }
    const c = ca ? a : b, o = ca ? b : a;
    let run = H(c, o);
    const Rp = Math.max(c.left, c.right) * 1.5 + 1.5;
    const cFloor = c.z - c.down, dFloor = (o.z - o.down) - cFloor;
    const steep = Math.abs(dFloor) / Math.max(0.1, run) > PIT_SLOPE;
    if (run < Rp + 3 && !steep) { out.push(leg); continue; }
    // room beyond the mouth for the climb / drop: a ramp, switchbacks or a spiral all need some run
    // outside the hall. If the surveyed station is too close, slide it outward (a passage station
    // only, and only into free rock); a shaft out of a hall roof (Mammoth Dome) always moves.
    const rise0 = clamp(dFloor, 0, 0.6);
    const want = Math.max(3, Math.min(14, Math.abs(dFloor - rise0) / RAMP_SLOPE));
    let lifted = false;
    if (run - Rp < want && o.kind !== "cavern") {
      const nr = Math.min(run + 18, Rp + want), k = nr / Math.max(0.1, run);
      const np = run < 0.1 ? { x: c.x + nr, y: c.y, z: o.z } : { x: c.x + (o.x - c.x) * k, y: c.y + (o.y - c.y) * k, z: o.z };
      const free = A.room(np, [o.id, c.id], 8) > 1.2;
      if (free || run < Rp + 3) {
        o.x = np.x; o.y = np.y; run = H(c, o);
        A.report.notes.push(`moved ${o.id} out from hall ${c.id}`);
      } else lifted = true;
    }
    const k = Rp / run;
    const down = Math.max(0.4, Math.min(o.down, 1.2));
    // a low mouth (<= 2 m up); only when nothing could move does it climb the wall as a rock ramp
    const rise = lifted ? clamp(dFloor, 0, Math.min(Rp * RAMP_SLOPE * 0.9, c.up * 0.7)) : rise0;
    const P = A.add({
      id: `${c.id}^${o.id}`, x: c.x + (o.x - c.x) * k, y: c.y + (o.y - c.y) * k,
      z: cFloor + down + rise,
      kind: "passage", module: "mouth",
      left: Math.max(1.3, Math.min(o.left, 5)), right: Math.max(1.3, Math.min(o.right, 5)), up: Math.max(2.2, Math.min(o.up, 6)), down,
      zone: o.zone, tags: (o.tags || []).filter((g) => g !== "hall" && g !== "entrance" && g !== "squeeze"),
    });
    A.count("mouth");
    if (ca) out.push({ from: a.id, to: P.id }, { from: P.id, to: b.id });
    else out.push({ from: a.id, to: P.id }, { from: P.id, to: b.id });
  }
  return out;
}
function chainKey(A, id, legs) {
  // connected component of squeeze-tagged anchor stations
  const seen = new Set([id]), stack = [id];
  while (stack.length) {
    const c = stack.pop();
    for (const l of legs) {
      const o = l.from === c ? l.to : l.to === c ? l.from : null;
      if (o && !seen.has(o) && A.has(A.smap.get(o) || {}, "squeeze")) { seen.add(o); stack.push(o); }
    }
  }
  return [...seen].sort()[0];
}

/* ---------------------------------------------------------------- junction */
/** Fan out branches that leave a 3+ way station at a narrow angle, and flare the station. */
export function junctionModule(A) {
  const nb = new Map();
  for (const l of A.legs) {
    (nb.get(l.from) || nb.set(l.from, []).get(l.from)).push(l.to);
    (nb.get(l.to) || nb.set(l.to, []).get(l.to)).push(l.from);
  }
  let fixed = 0, n = 0;
  for (const s of A.stations) {
    const ids = nb.get(s.id) || [];
    if (ids.length < 3) continue;
    n++;
    if (s.kind !== "cavern") {
      // a junction room: at least as wide / tall as what meets it
      const others = ids.map((i) => A.smap.get(i));
      s.left = Math.max(s.left, ...others.map((o) => Math.min(o.left, 5)), 1.4) * 1.08;
      s.right = Math.max(s.right, ...others.map((o) => Math.min(o.right, 5)), 1.4) * 1.08;
      s.up = Math.max(s.up, ...others.map((o) => Math.min(o.up, 6)), 2.0);
      if (s.kind === "passage") s.kind = "chamber";
      s.module = "junction";
    }
    // branch directions (only movable inner section stations)
    for (let it = 0; it < 6; it++) {
      const br = ids.map((i) => { const o = A.smap.get(i); return { o, ang: Math.atan2(o.y - s.y, o.x - s.x), movable: String(o.id).includes("~") && !String(o.id).includes("lobe") }; });
      let worst = null;
      for (let i = 0; i < br.length; i++) for (let j = i + 1; j < br.length; j++) {
        let d = Math.abs(br[i].ang - br[j].ang); if (d > Math.PI) d = 2 * Math.PI - d;
        // only branches on about the same level interfere
        if (Math.abs(br[i].o.z - br[j].o.z) > 3) continue;
        if (d < (JUNCTION_MIN_DEG * Math.PI) / 180 && (!worst || d < worst.d)) worst = { i, j, d };
      }
      if (!worst) break;
      const push = ((JUNCTION_MIN_DEG * Math.PI) / 180 - worst.d) / 2 + 0.02;
      const B1 = br[worst.i], B2 = br[worst.j];
      let sgn = Math.sin(B2.ang - B1.ang) >= 0 ? 1 : -1;
      for (const [B, k] of [[B1, -sgn], [B2, sgn]]) {
        if (!B.movable) continue;
        const r = H(B.o, s), ang = B.ang + push * k * (B1.movable && B2.movable ? 1 : 2);
        B.o.x = s.x + Math.cos(ang) * r; B.o.y = s.y + Math.sin(ang) * r;
      }
      fixed++;
    }
  }
  A.count("junction", n);
  if (fixed) A.report.notes.push(`junction fan-outs ${fixed}`);
}

/** After the junction fan-out moved some section stations, ease any leg that ended up too steep by
 *  spreading the height change onto the movable (section) stations around it. */
export function relaxSlopes(A, limit = PIT_SLOPE - 0.03) {
  const movable = (s) => String(s.id).includes("~");
  let left = 0;
  for (let it = 0; it < 30; it++) {
    left = 0;
    for (const l of A.legs) {
      const a = A.smap.get(l.from), b = A.smap.get(l.to);
      const run = Math.max(0.1, H(a, b)), dz = b.z - a.z;
      if (Math.abs(dz) / run <= limit) continue;
      left++;
      const want = Math.sign(dz) * limit * run, fix = dz - want;
      if (movable(a) && movable(b)) { a.z += fix / 2; b.z -= fix / 2; }
      else if (movable(b)) b.z -= fix;
      else if (movable(a)) a.z += fix;
    }
    if (!left) break;
  }
  if (left) A.report.notes.push(`steep legs left ${left}`);
  return left;
}

/* ---------------------------------------------------------------- side passages (variation) */
/** Seeded variation: 1-3 short dead-end side passages where there is room, so revisits differ. */
export function sidePassages(A, n) {
  const r = A.rng;
  const cand = A.stations.filter((s) => s.kind === "passage" && String(s.id).includes("~") && s.module === "tunnel" && s.clearance !== "crawl");
  let made = 0;
  for (let tries = 0; tries < 40 && made < n && cand.length; tries++) {
    const s = cand[Math.floor(r() * cand.length)];
    const legs = A.legs.filter((l) => l.from === s.id || l.to === s.id);
    if (legs.length !== 2) continue;
    const o = A.smap.get(legs[0].from === s.id ? legs[0].to : legs[0].from);
    const dirAng = Math.atan2(o.y - s.y, o.x - s.x) + (r() < 0.5 ? 1 : -1) * randRange(r, 1.1, 1.9);
    const len = randRange(r, 3, 5), steps = 2 + Math.floor(r() * 3);
    const pts = [];
    // floor-matched: a spur's floor starts level with the parent's floor (no knee-high step in)
    const down0 = 0.5;
    let p = { x: s.x, y: s.y, z: s.z - s.down + down0 }, ang = dirAng, ok = true;
    for (let i = 0; i < steps; i++) {
      ang += randRange(r, -0.35, 0.35);
      const L1 = i === 0 ? Math.max(s.left, s.right) + len * 0.8 : len; // start beyond the parent's wall, not inside it
      p = { x: p.x + Math.cos(ang) * L1, y: p.y + Math.sin(ang) * L1, z: p.z + (i === 0 ? 0 : randRange(r, -0.4, 0.25)) };
      if (A.room(p, [s.id], 5) < 2.6) { ok = false; break; }
      pts.push(p);
    }
    if (!ok || pts.length < 2) continue;
    let prev = s.id;
    pts.forEach((q, i) => {
      const last = i === pts.length - 1, id = `V${made}~${i}`;
      const room = last && r() < 0.5;
      A.add({ id, x: q.x, y: q.y, z: q.z, kind: room ? "chamber" : "passage", module: room ? "hall" : "tunnel", tags: ["side"],
        left: room ? randRange(r, 1.8, 2.8) : randRange(r, 1.0, 1.4), right: room ? randRange(r, 1.8, 2.8) : randRange(r, 1.0, 1.4),
        up: room ? randRange(r, 2.2, 3.2) : randRange(r, 1.5, 2.0), down: room ? 0.6 : down0, zone: s.zone });
      A.legs.push({ from: prev, to: id });
      prev = id;
    });
    made++;
  }
  A.count("side passage", made);
  return made;
}

/* ---------------------------------------------------------------- stream */
/** Water along the stream-tagged stations (high to low, pool at the bottom); null if none. */
export function streamModule(A) {
  const tagged = new Set(A.stations.filter((s) => A.has(s, "stream")).map((s) => s.id));
  if (!tagged.size) return null;
  const nb = new Map();
  for (const l of A.legs) {
    (nb.get(l.from) || nb.set(l.from, []).get(l.from)).push(l.to);
    (nb.get(l.to) || nb.set(l.to, []).get(l.to)).push(l.from);
  }
  // the section stations between two stream stations are stream too
  for (const s of A.stations) {
    if (!String(s.id).includes("~")) continue;
    const [p, q] = String(s.id).split("~");
    if (tagged.has(p) && tagged.has(q)) tagged.add(s.id);
  }
  // longest downhill chain inside the tagged set
  let best = [];
  for (const start of tagged) {
    const path = [start], used = new Set(path);
    let cur = A.smap.get(start);
    for (let i = 0; i < 40; i++) {
      const next = (nb.get(cur.id) || []).map((i) => A.smap.get(i)).filter((o) => tagged.has(o.id) && !used.has(o.id) && o.z <= cur.z + 0.2).sort((u, v) => u.z - v.z)[0];
      if (!next) break;
      path.push(next.id); used.add(next.id); cur = next;
    }
    if (path.length > best.length) best = path;
  }
  if (best.length < 2) return null;
  const pool = A.smap.get(best[best.length - 1]), from = A.smap.get(best[best.length - 2]);
  const legs = [];
  for (let i = 0; i < best.length - 1; i++) legs.push({ from: best[i], to: best[i + 1] });
  A.count("stream", legs.length);
  return {
    stationIds: best, legs, poolStationId: pool.id,
    waterfall: { stationId: pool.id, fromId: from.id, lipHeight: clamp(from.z - pool.z + 1.6, 1.8, 4.2), width: 0.9 },
    width: 0.55,
  };
}

/* ---------------------------------------------------------------- checks */
/** Static checks on an assembled cave (used by the build and the regression suite). */
export function checkCave(cave) {
  const smap = stationMap(cave), nbrs = neighborsOf(cave);
  const out = { steep: [], narrowJunctions: [], tooTight: [], crossings: 0, stations: cave.stations.length, legs: cave.legs.length };
  for (const l of cave.legs) {
    const a = smap.get(l.from), b = smap.get(l.to);
    const hall = a.kind === "cavern" || b.kind === "cavern";
    // hall mouths: what you walk is the floor (hall floor -> portal floor), not the centre line
    const dz = hall ? (b.z - b.down) - (a.z - a.down) : b.z - a.z;
    const sl = Math.abs(dz) / Math.max(0.1, H(a, b));
    if (sl > PIT_SLOPE + 0.01) out.steep.push(`${a.id}->${b.id} ${sl.toFixed(2)}`);
  }
  for (const s of cave.stations) {
    if (s.left + s.right < 1.0 || s.up + s.down < 0.72) out.tooTight.push(s.id);
    const ids = nbrs.get(s.id) || [];
    if (ids.length < 3 || s.kind === "cavern") continue; // halls swallow their mouths
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const p = smap.get(ids[i]), q = smap.get(ids[j]);
      if (Math.abs(p.z - q.z) > 3) continue;
      let d = Math.abs(Math.atan2(p.y - s.y, p.x - s.x) - Math.atan2(q.y - s.y, q.x - s.x)); if (d > Math.PI) d = 2 * Math.PI - d;
      if (d < ((JUNCTION_MIN_DEG - 6) * Math.PI) / 180) out.narrowJunctions.push(`${s.id} ${((d * 180) / Math.PI).toFixed(0)}°`);
    }
  }
  return out;
}
