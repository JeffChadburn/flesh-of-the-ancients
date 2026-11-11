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
};
export const SKILLS = {
  tools: { name: "Stone Tools", desc: "Knife and spear: harvest carcasses, craft simple gear." },
  tracking: { name: "Basic Tracking", desc: "Nearby animals show on the map; crouch to stalk closer." },
  fire: { name: "Fire-starting", desc: "Relight a fire pit to cook meat and rest (save)." },
  blood: { name: "Blood Memory", desc: "Eating a monster organ permanently changes you." },
};
export const RECIPES = [
  { id: "backpack", name: "Simple backpack", desc: "Sewn from a whole skin. Inventory 6 → 12 slots.", needs: [["hide", 1], ["skin", 1]], anyOf: true, once: true },
  { id: "spear", name: "Finish the bone spear", desc: "Bind the point with pelt strips. Longer reach; a deer falls in one thrust.", needs: [["pelt", 1]], once: true },
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
  }

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
    return "Crafted";
  }

  /** Per-frame needs. running: 0..1. Returns { damage } when starving / parched. */
  tick(dt, running) {
    this.hunger = Math.max(0, this.hunger - dt * 0.105);
    this.thirst = Math.max(0, this.thirst - dt * 0.16);
    this.organBoost = Math.max(0, this.organBoost - dt);
    if (running > 0.2) { this.stamina = Math.max(0, this.stamina - dt * 15 * running); this.restT = 0; }
    else {
      this.restT += dt;
      if (this.restT > 0.8) {
        let r = 20 * (this.organBoost > 0 ? 1.8 : 1) * (this.hunger < 15 || this.thirst < 15 ? 0.5 : 1);
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
      tools: this.tools, crafted: [...this.crafted], stats: this.stats };
  }
  fromJSON(o) {
    this.reset();
    if (!o) return this;
    Object.assign(this, { hunger: o.hunger, thirst: o.thirst, stamina: o.stamina ?? 100, slots: o.slots || 6, inv: (o.inv || []).map((s) => ({ ...s })), faces: o.faces || 0, str: o.str || 0, hpBonus: o.hpBonus || 0 });
    this.skills = new Set(o.skills || []); this.tools = { ...this.tools, ...(o.tools || {}) }; this.crafted = new Set(o.crafted || []); this.stats = { ...this.stats, ...(o.stats || {}) };
    return this;
  }
}

const KEY = "flesh.save.v1";
export function readSave() { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; } }
export function writeSave(obj) { try { localStorage.setItem(KEY, JSON.stringify({ ...obj, savedAt: Date.now() })); return true; } catch { return false; } }
export function clearSave() { try { localStorage.removeItem(KEY); } catch {} }
