/**
 * Round 24b: 🔍 Find. Pick something you need (mushrooms, water, flint, ore, a horse...) and the
 * nearest one gets a green find-marker: a light pillar in the world, an icon on the map and the
 * minimap, and the compass points at it with the distance. Next nearest / Clear; it clears itself
 * (with "Found!") when you're within ~6 m or the thing is picked up.
 *
 * Search uses the world's own plans, so places that aren't streamed in yet count too: mushroom and
 * berry spots, rivers / lakes, cave mouths (flint, ochre, bone, ore and some mushrooms lie inside;
 * the ore in each cave is known from its seed), towns. Trees come from the terrain scatter within
 * ~300 m. Animals, horses and fish only exist near you, so those search what's around.
 * Explored places win ties: an unexplored spot counts as 1.5x as far.
 */
import { ITEMS, RECIPES } from "./act1/survival.js";

export const FIND_CATS = [
  { id: "shroom", icon: "🍄", name: "Mushrooms" },
  { id: "berries", icon: "🫐", name: "Berries" },
  { id: "water", icon: "💧", name: "Water / stream" },
  { id: "flint", icon: "◆", name: "Flint & stone" },
  { id: "wood", icon: "🪵", name: "Wood" },
  { id: "ore:copper", icon: "🟠", name: "Copper ore" },
  { id: "ore:tin", icon: "⚪", name: "Tin ore" },
  { id: "ore:coal", icon: "⬛", name: "Coal" },
  { id: "ore:iron", icon: "⚙️", name: "Iron ore" },
  { id: "herbs", icon: "🌿", name: "Herbs & plants" },
  { id: "game", icon: "🦌", name: "Animals to hunt" },
  { id: "fish", icon: "🐟", name: "Fish" },
  { id: "horse", icon: "🐎", name: "Horses" },
  { id: "boat", icon: "⛵", name: "Boats" },
  { id: "cave", icon: "🕳", name: "Cave entrances" },
  { id: "town", icon: "🏘", name: "Villagers & towns" },
  { id: "quest", icon: "💡", name: "Quest target" },
];
export const CAT = Object.fromEntries(FIND_CATS.map((c) => [c.id, c]));
/** What to search for to get an item. */
export const ITEM_CAT = {
  berries: "berries", roots: "berries", herbs: "herbs", flint: "flint", ochre: "flint", bone: "flint", logs: "wood", shroom: "shroom",
  copper: "ore:copper", tin: "ore:tin", coal: "ore:coal", iron: "ore:iron",
  meat: "game", hide: "game", pelt: "game", feather: "game", organ: "game", sinew: "town",
};
/** Where it grows, for the "none near" line. */
const WHERE = {
  shroom: "Glowing mushrooms grow on the floor of thick temperate forest, in the marsh, at the tundra's edge, and inside about half the caves.",
  berries: "Berry bushes grow in clumps near streams: brambles in the woods, bilberries on cold slopes, cloudberries on the tundra, cranberries in the marsh.",
  water: "Rivers run down from the high country to the lakes and the sea in the west.",
  flint: "Flint, ochre and bone lie along the passages inside caves.",
  wood: "Trees grow thickest in the temperate forest and on the alpine slopes.",
  ore: "Ore veins are inside caves (you need a stone pick to mine them).",
  herbs: "Healing herbs come up with berries and roots once you know Herb Lore (Survival).",
  game: "Deer, boar and rabbits roam the forest edges; goats the steep slopes. Walk a while and they'll show up.",
  fish: "Fish swim in the streams and pools inside caves.",
  horse: "Wild horses graze on open grassland, away from the thick forest.",
  boat: "Boats are tied up at the lakes, rivers and coast, usually near towns.",
  cave: "Cave mouths open in hillsides near the middle of the world.",
  town: "Towns sit along the rivers and lake shores.",
  quest: "No quest target right now. Explore freely.",
};
const RANGE = 3200;

/** Ore + mushroom contents of the cave behind entrance `id` (same hash as story.placePickups). */
export function caveContents(id) {
  const key = "e" + id, h = [...key].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0, ores = ["copper", "tin", "coal", "iron"];
  return { ores: [ores[h % 4], ores[(h + 3) % 4]], shroom: h % 2 === 1, key };
}

export class Finder {
  /** env: see main.js (terrain, mode, feet, seen, story, ...). */
  constructor(root, env) {
    this.env = env; this.cur = null; this.list = []; this.idx = 0; this.cat = null;
    const el = (this.el = document.createElement("div")); el.id = "find-panel"; el.className = "hidden";
    root.appendChild(el);
    for (const e of ["pointerdown", "touchstart", "mousedown", "wheel", "pointerup"]) el.addEventListener(e, (ev) => ev.stopPropagation(), { passive: true });
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const b = ev.target.closest("[data-f]");
      if (b) { const id = b.dataset.f; if (id === "next") this.next(); else if (id === "clear") { this.clear(); this.env.toast("🔍 Find cleared."); } else this.find(id, b.dataset.lbl || null); this.close(); return; }
      if (ev.target.closest(".fd-x") || ev.target === el) this.close();
    });
  }
  get isOpen() { return !this.el.classList.contains("hidden"); }
  toggle() { this.isOpen ? this.close() : this.open(); }
  open() { if (document.pointerLockElement) document.exitPointerLock(); this.render(); this.el.classList.remove("hidden"); this.env.log?.({ e: "findOpen" }); }
  close() { this.el.classList.add("hidden"); }

  /** "Needed now": the quest, thirst / hunger, and what the recipes you could make are missing. */
  needed() {
    const env = this.env, s = env.story.surv, out = [], seen = new Set();
    const add = (cat, why) => { if (!cat || seen.has(cat)) return; seen.add(cat); out.push({ cat, why }); };
    if (env.story.active && env.questHint?.()) add("quest", env.questHint().label);
    if (s && (env.story.active || env.story.sandbox)) {
      if (s.thirst < 40) add("water", "you're thirsty");
      if (s.hunger < 35) add("berries", "you're hungry");
      for (const r of RECIPES) {
        if ((r.once && s.crafted.has(r.id)) || !s.knows(r) || (r.skill && !s.skills.has(r.skill))) continue;
        if (r.anyOf ? r.needs.some(([id, n]) => s.count(id) >= n) : r.needs.every(([id, n]) => s.count(id) >= n)) continue;
        for (const [id, n] of r.needs) if (s.count(id) < n) add(ITEM_CAT[id], `${ITEMS[id]?.name || id} ×${n - s.count(id)} for ${r.name.toLowerCase()}`);
      }
    }
    return out.slice(0, 6);
  }
  render() {
    const c = this.cur, f = this.env.feet();
    const cur = c ? `<div class="fd-cur"><span>🔍 <b>${c.label}</b> · ${fmt(Math.hypot(c.x - f.x, c.z - f.z))}</span><span class="fd-cb"><button type="button" data-f="next">Next nearest ▸</button><button type="button" data-f="clear">✕ Clear</button></span></div>` : "";
    const need = this.needed();
    const btn = (id, sub = "") => `<button type="button" data-f="${id}"><i>${CAT[id].icon}</i><span>${CAT[id].name}${sub ? `<small>${sub}</small>` : ""}</span></button>`;
    this.el.innerHTML = `<div class="fd-box"><div class="fd-head"><h3>🔍 Find</h3><button type="button" class="fd-x" aria-label="Close">✕</button></div>${cur}
      ${need.length ? `<div class="fd-sec">Needed now</div><div class="fd-grid need">${need.map((n) => btn(n.cat, n.why)).join("")}</div>` : ""}
      <div class="fd-sec">Everything</div><div class="fd-grid">${FIND_CATS.map((k) => btn(k.id)).join("")}</div>
      <p class="fd-tip">The nearest one gets a <b style="color:#b6ff5a">green pillar</b>, a 🔍 on the map and minimap, and the compass points to it.</p></div>`;
  }

  /** All candidates for a category, nearest (explored first) first. Each: {x, z, label, r?, live?, gone?, y?}. */
  search(cat) {
    const env = this.env, f = env.feet(), t = env.terrain(), out = [];
    if (!f) return out;
    const cave = env.mode() !== "overworld";
    const P = (x, z, label, extra = {}) => out.push({ x, z, label, ...extra });
    const ore = cat.startsWith("ore:") ? cat.slice(4) : null;
    if (cave) {
      // inside: the things lying in this cave, the fish in its stream; everything else means going out
      for (const k of env.story.pickups || []) {
        if (k.taken) continue;
        const ok = (cat === "flint" && !k.ore && k.id !== "shroom") || (ore && k.id === ore) || (cat === "shroom" && k.id === "shroom");
        if (ok) P(k.x, k.z, ITEMS[k.id]?.name || k.id, { y: k.y, gone: () => k.taken });
      }
      if (cat === "fish") for (const fi of env.caveFauna?.()?.fish || []) if (fi.alive && fi.pos) P(fi.pos.x, fi.pos.z, "Fish", { live: fi, gone: () => !fi.alive });
      if (cat === "water") { const w = env.caveWater?.(); if (w?.path?.length) for (const q of w.path) P(q.x, q.z, "Cave stream", { y: q.y }); }
    } else if (t) {
      const camp = env.camp?.();
      if (cat === "shroom") {
        const S = env.shrooms?.(); if (S) for (const s of S.spots) if (S.available(s)) P(s.x, s.z, "Glowing mushrooms", { gone: () => !S.available(s) });
        this._caves(t, P, (c) => c.shroom, "Cave (mushrooms inside)");
      } else if (cat === "berries" || cat === "herbs") {
        const B = env.berries?.(); if (B) for (const s of B.spots) if (!s.bad && B.available(s)) P(s.x, s.z, cat === "herbs" ? "Bush (herbs with Herb Lore)" : "Berry bush", { gone: () => !B.available(s) });
        if (camp) for (const b of camp.bushes) if (b.ready) P(b.x, b.z, cat === "herbs" ? "Camp bush (herbs)" : b.kind === "berries" ? "Berry bush" : "Root patch", { gone: () => !b.ready });
      } else if (cat === "water") {
        for (const r of t.bio?.rivers || []) for (let i = 0; i < r.pts.length; i += 3) { const q = r.pts[i]; P(q.x, q.z, r.creek ? "Creek" : "River"); }
        for (const l of t.bio?.lakes || []) { const a = Math.atan2(f.z - l.z, f.x - l.x), rr = Math.max(0, (l.r || 30) - 4); P(l.x + Math.cos(a) * rr, l.z + Math.sin(a) * rr, "Lake shore"); }
        for (const q of t.act1?.stream || []) P(q.x, q.z, "Stream");
      } else if (cat === "flint") this._caves(t, P, () => true, "Cave (flint, ochre, bone inside)");
      else if (ore) this._caves(t, P, (c) => c.ores.includes(ore), `Cave (${ITEMS[ore].name.toLowerCase()} inside)`);
      else if (cat === "wood") {
        const taken = env.story.woodTaken || new Set(), cx = Math.floor(f.x / 64), cz = Math.floor(f.z / 64);
        for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) for (const tr of t.scatter(cx + i, cz + j).trees) { const k = `${tr.x | 0},${tr.z | 0}`; if (tr.type <= 3 && !taken.has(k)) P(tr.x, tr.z, tr.type === 3 ? "Dead tree" : "Tree", { r: 4, gone: () => !!env.story.woodTaken?.has(k) }); }
      } else if (cat === "game") { for (const a of env.wildlife?.()?.list || []) if (a.alive && a.kind !== "horse" && !a.ridden) P(a.pos.x, a.pos.z, cap(a.kind), { live: a, gone: () => !a.alive }); }
      else if (cat === "horse") { for (const a of env.wildlife?.()?.list || []) if (a.alive && a.kind === "horse" && !a.ridden) P(a.pos.x, a.pos.z, "Wild horse", { live: a, gone: () => !a.alive || a.ridden }); }
      else if (cat === "fish") this._caves(t, P, () => true, "Cave (fish in its stream, if it has one)");
      else if (cat === "boat") { for (const b of env.boats?.()?.list || []) if (b !== env.riding?.()) P(b.x, b.z, b === env.myBoat?.() ? "Your boat" : cap(b.K?.name || b.kind || "boat"), { live: b, xz: true, gone: () => b === env.riding?.() }); }
      else if (cat === "cave") this._caves(t, P, () => true, null);
      else if (cat === "town") {
        for (const s of t.settlements || []) P(s.x, s.z, s.hostile ? `⚔ ${s.name} (hostile)` : s.name, { r: Math.max(6, s.R), pen: s.hostile ? 4 : 1 }); // round 24b: friendly towns first
        for (const c of env.colonies?.() || []) P(c.x, c.z, c.name + " (yours)", { r: 9 });
      } else if (cat === "quest") { const h = env.questHint?.(); if (h) P(h.x, h.z, h.label); }
    }
    for (const c of out) { c.d = Math.hypot(c.x - f.x, c.z - f.z); c.score = c.d * (cave || env.seen(c.x, c.z) ? 1 : 1.5) * (c.inside && cat === "shroom" ? 3 : 1) * (c.pen || 1); } // a mushroom in the open beats one somewhere down a cave
    return out.filter((c) => c.d < RANGE).sort((a, b) => a.score - b.score);
  }
  _caves(t, P, want, label) {
    for (const e of t.entrances) { const c = caveContents(e.id); if (!want(c)) continue; P(e.x + (e.fx || 0) * 3, e.z + (e.fz || 0) * 3, label ? `${e.name || "Cave"} ${label.replace(/^Cave /, "")}` : e.name || "Cave mouth", { cave: e, inside: !!label }); }
  }

  /** Choose a category: mark the nearest. */
  find(cat, why = null) {
    const env = this.env, K = CAT[cat];
    if (!K) return null;
    if (!env.feet()) return null;
    const cave = env.mode() !== "overworld";
    this.cat = cat; this.list = this.search(cat); this.idx = 0;
    env.log?.({ e: "find", cat, n: this.list.length });
    if (!this.list.length) {
      this.clear();
      const msg = cave && !["flint", "shroom", "fish", "water"].includes(cat) && !cat.startsWith("ore:") ? `You're in a cave. Step outside to look for ${K.name.toLowerCase()}.`
        : cat === "quest" ? WHERE.quest : `No ${K.name.toLowerCase()} anywhere near, sorry. ${WHERE[cat.startsWith("ore:") ? "ore" : cat] || ""}`;
      env.toast("🔍 " + msg); return null;
    }
    return this._mark(0, true);
  }
  next() {
    if (!this.cat) return null;
    const keep = this.cur; this.list = this.search(this.cat);
    if (keep) this.list = this.list.filter((c) => Math.hypot(c.x - keep.x, c.z - keep.z) > 4 && !(this._skip || []).some((s) => Math.hypot(c.x - s.x, c.z - s.z) < 4));
    this._skip = [...(this._skip || []), ...(keep ? [{ x: keep.x, z: keep.z }] : [])].slice(-12);
    if (!this.list.length) { this.env.toast(`🔍 No other ${CAT[this.cat].name.toLowerCase()} within reach.`); return null; }
    return this._mark(0, false);
  }
  _mark(i, fresh) {
    if (fresh) this._skip = [];
    const c = this.list[i], env = this.env, f = env.feet(), K = CAT[this.cat];
    if (c.d < (c.r || 6) && !c.cave) { env.toast(`🔍 Found! ${c.label} is right here.`, "good"); env.found?.(); this.clear(); return c; }
    this.cur = { ...c, cat: this.cat, icon: K.icon, mode: env.mode() === "overworld" ? "overworld" : "cave", armed: c.d >= (c.r || 6) };
    const dir = compassWord(c.x - f.x, c.z - f.z), seen = env.mode() !== "overworld" || env.seen(c.x, c.z);
    env.toast(`🔍 ${c.label}: ${fmt(c.d)} ${dir}${seen ? "" : " (unexplored)"}. Follow the green ${this.cur.mode === "cave" ? "marker" : "pillar"}.`, "skill");
    env.onChange?.(this.cur);
    return this.cur;
  }
  clear() { const had = !!this.cur; this.cur = null; this.list = []; this.env.onChange?.(null); return had; }

  /** Per frame: follow moving targets, clear on arrival / pick-up. */
  update() {
    const c = this.cur, env = this.env; if (!c) return;
    const f = env.feet(); if (!f) return;
    if ((c.mode === "cave") !== (env.mode() !== "overworld")) return; // paused while you're on the other side of a cave mouth
    if (c.live) { const q = c.live.pos || c.live; if (Number.isFinite(q.x)) { c.x = q.x; c.z = q.z; } }
    const d = Math.hypot(c.x - f.x, c.z - f.z), gone = c.gone?.();
    if (gone || d < (c.r || 6)) {
      env.toast(gone && d >= (c.r || 6) ? `🔍 Found! (${c.label} is gone now: picked or moved off.)` : `🔍 Found! ${c.label}.`, "good");
      env.found?.(); env.log?.({ e: "found", cat: c.cat, d: +d.toFixed(1), gone: !!gone });
      this.cur = null; this.lastFound = { cat: c.cat, label: c.label, d }; env.onChange?.(null);
    }
  }
}
export function fmt(d) { return d >= 1000 ? (d / 1000).toFixed(d >= 10000 ? 0 : 1) + " km" : Math.round(d) + " m"; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
/** World +x east, -z north (the minimap's up). */
function compassWord(dx, dz) { const a = (Math.atan2(dx, -dz) * 180) / Math.PI, i = Math.round(((a + 360) % 360) / 45) % 8; return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][i]; }
