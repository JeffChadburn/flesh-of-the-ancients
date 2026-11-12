/**
 * Act 1 survival state: hunger / thirst / stamina, a slot inventory, crafting recipes, skills,
 * the face suit and Blood Memory stats, plus save / load (localStorage). Pure logic, no DOM.
 */
export const ITEMS = {
  berries: { name: "Berries", food: 14, water: 3, stack: 10, icon: "🫐" },
  roots: { name: "Roots", food: 18, stack: 10, icon: "🥕" },
  meat: { name: "Raw meat", food: 15, stack: 6, icon: "🥩" },
  cooked: { name: "Cooked meat", food: 42, stack: 6, icon: "🍖" },
  organ: { name: "Animal organ", food: 10, stamina: true, stack: 4, icon: "❤" },
  pelt: { name: "Rabbit pelt", stack: 6, icon: "🟫" },
  hide: { name: "Deer hide", stack: 3, icon: "🟤" },
  feather: { name: "Feathers", stack: 12, icon: "🪶" },
  skin: { name: "Tor's skin", stack: 1, icon: "◼" },
  blood: { name: "Creature blood", stack: 4, icon: "🩸" },
  morgan: { name: "Creature organ", stack: 2, icon: "✶" },
  // round 16: crafting materials + a consumable
  bone: { name: "Bone", stack: 8, icon: "🦴" },
  sinew: { name: "Sinew", stack: 8, icon: "〰" },
  flint: { name: "Flint", stack: 8, icon: "◆" },
  ochre: { name: "Red ochre", stack: 8, icon: "●" },
  herbs: { name: "Healing herbs", stack: 8, icon: "🌿" },
  salve: { name: "Healing salve", stack: 4, icon: "🏺", heal: 1 },
  logs: { name: "Deadwood logs", stack: 8, icon: "🪵" }, // round 19: raft building
  // round 20: ores Kra mines in the caves with a pick (for his settlements)
  copper: { name: "Copper ore", stack: 8, icon: "🟠" },
  tin: { name: "Tin ore", stack: 8, icon: "⚪" },
  iron: { name: "Iron ore", stack: 8, icon: "⚙️" },
  coal: { name: "Coal", stack: 8, icon: "⬛" },
  shroom: { name: "Glowing mushroom", stack: 6, icon: "🍄" }, // round 21: eaten from the Pack: a spirit vision (the trip)
};
export const SKILLS = {
  tools: { name: "Stone Tools", desc: "Knife and spear: harvest carcasses, craft simple gear." },
  tracking: { name: "Basic Tracking", desc: "Nearby animals show on the map; crouch to stalk closer." },
  fire: { name: "Fire-starting", desc: "Relight a fire pit to cook meat and rest (save)." },
  blood: { name: "Blood Memory", desc: "Eating a monster organ permanently changes you." },
};
/** Round 16: skill tree. 4 branches x 3 tiers; 1 skill point each; a tier needs the one below it
 *  (and some need a story quest done). Points come from quests and from XP (100 XP = 1 point). */
export const TREE = {
  hunt: { name: "Hunting", icon: "🏹", tiers: [
    { id: "hunt1", name: "Keen Eye", desc: "Animals show on the map. Recipe: bone arrows.", recipe: "arrows" },
    { id: "hunt2", name: "Flint Knapper", desc: "Recipe: flint-tipped spear (+1 spear damage).", recipe: "flintspear" },
    { id: "hunt3", name: "Butcher", desc: "Every carcass gives an extra meat and bone.", quest: "m4" },
  ] },
  craft: { name: "Crafting", icon: "🧵", tiers: [
    { id: "craft1", name: "Hide-Working", desc: "Recipe: hide boots (sprinting tires you 25% less).", recipe: "boots" },
    { id: "craft2", name: "Sinew Sewing", desc: "Recipe: hide cloak (+1 heart).", recipe: "cloak" },
    { id: "craft3", name: "Furrier", desc: "Recipe: fur hat (+1 heart).", recipe: "hat", quest: "m4" },
  ] },
  surv: { name: "Survival", icon: "🔥", tiers: [
    { id: "surv1", name: "Herb Lore", desc: "Find healing herbs when you gather. Recipe: healing salve.", recipe: "salve" },
    { id: "surv2", name: "Pitch Torch", desc: "Recipe: resin torch (brighter, reaches further in caves).", recipe: "torch" },
    { id: "surv3", name: "Iron Gut", desc: "Hunger and thirst drain 30% slower.", quest: "m4" },
  ] },
  work: { name: "Industry", icon: "⛏", tiers: [ // round 20: settlements
    { id: "wood1", name: "Woodcutting", desc: "Gather deadwood without Herb Lore, 3 logs a tree; your woodcutters +25%." },
    { id: "mine1", name: "Mining", desc: "Recipe: stone pick. Mine ore veins in caves; your miners and quarry workers +25%.", recipe: "pick" },
    { id: "mason", name: "Masonry", desc: "Your settlements' buildings need 20% less stone." },
    { id: "smelt", name: "Smelting", desc: "Your settlements learn smelting and iron working for half the cost." },
  ] },
  spirit: { name: "Spirit", icon: "✋", tiers: [
    { id: "spirit1", name: "Ochre Rites", desc: "Recipe: red face paint (stamina comes back 30% faster).", recipe: "paint" },
    { id: "spirit2", name: "Far Sight", desc: "The map reveals twice as far around you.", quest: "m4" },
    { id: "spirit3", name: "Ancestors' Voice", desc: "The dead stand with you: +1 heart.", quest: "m6" },
  ] },
};
export const TREE_IDS = Object.values(TREE).flatMap((b) => b.tiers.map((t) => t.id));
/** Clothing Kra can wear (crafted once, then Wear / Remove). */
export const GEAR = { boots: "Hide boots", cloak: "Hide cloak", hat: "Fur hat", paint: "Red face paint" };
export const RECIPES = [
  { id: "backpack", name: "Simple backpack", desc: "Sewn from a whole skin. Inventory 6 → 12 slots.", needs: [["hide", 1], ["skin", 1]], anyOf: true, once: true },
  { id: "spear", name: "Finish the bone spear", desc: "Bind the point with pelt strips. Longer reach; a deer falls in one thrust.", needs: [["pelt", 1]], once: true },
  { id: "arrows", name: "Bone arrows", desc: "Bone points and fletching: +1 arrow damage.", needs: [["bone", 2], ["feather", 2]], once: true },
  { id: "flintspear", name: "Flint-tipped spear", desc: "A knapped flint head bound with sinew: +1 spear damage.", needs: [["flint", 2], ["sinew", 1]], once: true, spear: true },
  { id: "boots", name: "Hide boots", desc: "Wrapped and laced. Sprinting tires you 25% less. (worn)", needs: [["hide", 1], ["sinew", 1]], once: true, gear: true },
  { id: "cloak", name: "Hide cloak", desc: "A deer hide over the shoulders: +1 heart. (worn)", needs: [["hide", 2], ["sinew", 1]], once: true, gear: true },
  { id: "hat", name: "Fur hat", desc: "Rabbit pelts sewn in a cap: +1 heart. (worn)", needs: [["pelt", 3], ["sinew", 1]], once: true, gear: true },
  { id: "paint", name: "Red face paint", desc: "Ochre and berry juice in the hunters' stripes: stamina back 30% faster. (worn)", needs: [["ochre", 2], ["berries", 1]], once: true, gear: true },
  { id: "salve", name: "Healing salve", desc: "Crushed herbs in fat. Use it to heal a heart.", needs: [["herbs", 2], ["berries", 1]] },
  { id: "raft", name: "Log raft", desc: "Deadwood logs lashed with sinew. Build it at the water's edge, then board it (E / Board).", needs: [["logs", 4], ["sinew", 2]], skill: "surv1" },
  { id: "pick", name: "Stone pick", desc: "A flint head on a bone haft, bound tight. Mine ore veins in the caves.", needs: [["flint", 2], ["bone", 1], ["sinew", 1]], once: true },
  { id: "torch", name: "Resin torch", desc: "Pine pitch on a bone haft: a brighter torch that reaches further.", needs: [["bone", 1], ["sinew", 1]], once: true },
];

export class Survival {
  constructor() { this.reset(); }

  reset() {
    this.hunger = 55; this.thirst = 42; this.stamina = 100;
    this.exhausted = false; this.restT = 0; this.organBoost = 0; this.starveT = 0;
    this.slots = 6; this.inv = [];
    this.skills = new Set(); this.faces = 0; this.str = 0; this.hpBonus = 0;
    this.tools = { knife: false, spear: false, spearDone: false };
    this.crafted = new Set();
    this.stats = { ate: 0, drank: 0, small: 0, deer: 0, cooked: 0, harvested: 0 };
    this.xp = 0; this.sp = 0; this.recipes = new Set(); this.wear = new Set();
    this.inspected = new Set(); // round 17
  }

  // ---- round 16: XP / skill tree / gear ----
  get level() { return 1 + Math.floor(this.xp / 100); }
  /** Add XP; returns the number of new skill points (levels gained). */
  addXP(n) { const l0 = this.level; this.xp += n; const g = this.level - l0; this.sp += g; return g; }
  tierInfo(id) { for (const b of Object.values(TREE)) { const i = b.tiers.findIndex((t) => t.id === id); if (i >= 0) return { b, i, t: b.tiers[i] }; } return null; }
  /** Why a tree skill can't be learned yet (null = it can). */
  learnBlock(id, questsDone = () => true) {
    const k = this.tierInfo(id); if (!k) return "?";
    if (this.skills.has(id)) return "Learned";
    if (k.i > 0 && !this.skills.has(k.b.tiers[k.i - 1].id)) return "Needs " + k.b.tiers[k.i - 1].name;
    if (k.t.quest && !questsDone(k.t.quest)) return "Unlocked by the story";
    if (this.sp < 1) return "Needs a skill point";
    return null;
  }
  learn(id, questsDone) { if (this.learnBlock(id, questsDone)) return false; this.sp -= 1; this.skills.add(id); if (id === "hunt1") this.skills.add("tracking"); return true; }
  knows(r) { return !r || !TREE_IDS.some((t) => this.tierInfo(t).t.recipe === r.id) || this.recipes.has(r.id) || TREE_IDS.some((t) => this.skills.has(t) && this.tierInfo(t).t.recipe === r.id); }
  bonusHearts() { return (this.wear.has("cloak") ? 1 : 0) + (this.wear.has("hat") ? 1 : 0) + (this.skills.has("spirit3") ? 1 : 0); }
  spearBonus() { return this.crafted.has("flintspear") ? 1 : 0; }
  arrowBonus() { return this.crafted.has("arrows") ? 1 : 0; }

  count(id) { return this.inv.filter((s) => s.id === id).reduce((a, s) => a + s.n, 0); }
  freeSlots() { return this.slots - this.inv.length; }
  /** Add up to n items; returns how many fit. */
  add(id, n = 1) {
    const st = ITEMS[id].stack;
    let left = n;
    for (const s of this.inv) if (s.id === id && s.n < st && left > 0) { const k = Math.min(left, st - s.n); s.n += k; left -= k; }
    while (left > 0 && this.inv.length < this.slots) { const k = Math.min(left, st); this.inv.push({ id, n: k }); left -= k; }
    return n - left;
  }
  remove(id, n = 1) {
    let left = n;
    for (let i = this.inv.length - 1; i >= 0 && left > 0; i--) {
      const s = this.inv[i]; if (s.id !== id) continue;
      const k = Math.min(left, s.n); s.n -= k; left -= k;
      if (s.n <= 0) this.inv.splice(i, 1);
    }
    return n - left;
  }

  /** Eat an item; returns a message or null. Monster organs are handled by the story (Blood Memory). */
  eat(id) {
    const it = ITEMS[id];
    if (!it || !it.food || !this.count(id)) return null;
    this.remove(id, 1);
    this.hunger = Math.min(100, this.hunger + it.food);
    if (it.water) this.thirst = Math.min(100, this.thirst + it.water);
    this.stats.ate++;
    if (it.stamina) { this.stamina = Math.min(100, this.stamina + 30); this.organBoost = 90; return `${it.name}: warm strength floods your legs (stamina boost)`; }
    return `Ate ${it.name.toLowerCase()}`;
  }
  drink() { this.thirst = Math.min(100, this.thirst + 45); this.stats.drank++; return "You drink the cold stream water"; }

  canCraft(r) {
    if (r.once && this.crafted.has(r.id)) return false;
    if (!this.tools.knife) return false;
    if (r.id === "spear" && !this.tools.spear) return false;
    if (r.spear && !this.tools.spear) return false;
    if (!this.knows(r)) return false;
    if (r.skill && !this.skills.has(r.skill)) return false;
    return r.anyOf ? r.needs.some(([id, n]) => this.count(id) >= n) : r.needs.every(([id, n]) => this.count(id) >= n);
  }
  /** Craft; `use` picks the input for anyOf recipes. Returns message or null. */
  craft(id, use = null) {
    const r = RECIPES.find((x) => x.id === id);
    if (!r || !this.canCraft(r)) return null;
    if (r.anyOf) {
      const pick = r.needs.find(([i, n]) => (use ? i === use : true) && this.count(i) >= n);
      if (!pick) return null;
      this.remove(pick[0], pick[1]);
      this.craftedFrom = pick[0];
    } else for (const [i, n] of r.needs) this.remove(i, n);
    this.crafted.add(id);
    if (id === "backpack") { this.slots = 12; return this.craftedFrom === "skin" ? "You sew Tor's skin into a pack. It still smells of him." : "You sew the deer hide into a pack (12 slots)"; }
    if (id === "spear") { this.tools.spearDone = true; return "The bone spear is finished: longer reach, deadlier point"; }
    if (r.gear) { this.wear.add(id); return `${r.name} made, and you put it on`; }
    if (id === "salve") { this.crafted.delete("salve"); this.add("salve", 1); return "Mixed a healing salve"; }
    if (id === "flintspear") { this.tools.spearDone = true; return "The flint head is bound on: +1 spear damage"; }
    if (id === "arrows") return "Bone arrows fletched: +1 arrow damage";
    if (id === "torch") return "Resin torch made: it burns brighter";
    if (id === "pick") { this.tools.pick = true; return "Stone pick made: strike the ore veins in the caves"; }
    if (id === "raft") { this.crafted.delete("raft"); return "You lash the logs together: a raft, ready at the water's edge"; }
    return "Crafted";
  }

  /** Per-frame needs. running: 0..1. Returns { damage } when starving / parched. */
  tick(dt, running) {
    const gut = this.skills.has("surv3") ? 0.7 : 1;
    this.hunger = Math.max(0, this.hunger - dt * 0.063 * gut); // round 23: needs drop ~40% slower
    this.thirst = Math.max(0, this.thirst - dt * 0.096 * gut);
    this.organBoost = Math.max(0, this.organBoost - dt);
    if (running > 0.2) { this.stamina = Math.max(0, this.stamina - dt * 8.25 * running * (this.wear.has("boots") ? 0.75 : 1)); this.restT = 0; }
    else {
      this.restT += dt;
      if (this.restT > 0.6) {
        let r = 27 * (this.wear.has("paint") ? 1.3 : 1) * (this.organBoost > 0 ? 1.8 : 1) * (this.hunger < 15 || this.thirst < 15 ? 0.5 : 1);
        this.stamina = Math.min(100, this.stamina + dt * r);
      }
    }
    if (this.stamina <= 0.5) this.exhausted = true;
    if (this.exhausted && this.stamina >= 30) this.exhausted = false;
    let damage = 0;
    if (this.hunger <= 0 || this.thirst <= 0) { this.starveT += dt; if (this.starveT > 45) { this.starveT = 0; damage = 1; } } else this.starveT = 0;
    return { damage };
  }

  toJSON() {
    return { hunger: this.hunger, thirst: this.thirst, stamina: this.stamina, slots: this.slots, inv: this.inv, skills: [...this.skills], faces: this.faces, str: this.str, hpBonus: this.hpBonus,
      tools: this.tools, crafted: [...this.crafted], stats: this.stats, xp: this.xp, sp: this.sp, recipes: [...this.recipes], wear: [...this.wear], inspected: [...this.inspected] };
  }
  fromJSON(o) {
    this.reset();
    if (!o) return this;
    Object.assign(this, { hunger: o.hunger, thirst: o.thirst, stamina: o.stamina ?? 100, slots: o.slots || 6, inv: (o.inv || []).map((s) => ({ ...s })), faces: o.faces || 0, str: o.str || 0, hpBonus: o.hpBonus || 0 });
    this.skills = new Set(o.skills || []); this.tools = { ...this.tools, ...(o.tools || {}) }; this.crafted = new Set(o.crafted || []); this.stats = { ...this.stats, ...(o.stats || {}) };
    this.xp = o.xp || 0; this.sp = o.sp || 0; this.recipes = new Set(o.recipes || []); this.wear = new Set(o.wear || []);
    this.inspected = new Set(o.inspected || []);
    return this;
  }
}

const KEY = "flesh.save.v1";
export function readSave() { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; } }
export function writeSave(obj) { try { localStorage.setItem(KEY, JSON.stringify({ ...obj, savedAt: Date.now() })); return true; } catch { return false; } }
export function clearSave() { try { localStorage.removeItem(KEY); } catch {} }
