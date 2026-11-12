/**
 * Act 1 "The Empty Camp" director: objectives, interactions (E / Interact), Lume's dialogue,
 * survival ticking, hunting hooks, crafting, the Waterfall Hollow cave beats (rat-thing, blood
 * glyph painting, the dead hunter's face, Blood Memory), saving at the fire / autosave after the
 * cave, and death -> last save (faces / skills kept).
 */
import * as THREE from "three";
import { Survival, ITEMS, SKILLS, RECIPES, TREE, GEAR, readSave, writeSave } from "./survival.js";
import { QuestLog, QUESTS, QUEST, NPCS, fill } from "./quests.js";
import { makeBody, markFaceTaken, bake } from "./camp.js";
import { queryVolume } from "../volume.js";

const LUME_LINES = [
  { who: "Old Lume", text: "Kra... you breathe. Good. Come close. My eyes are full of dark." },
  { who: "Old Lume", text: "They came in the night. The caves opened their throats... and the mouths sang our names." },
  { who: "Old Lume", text: "Hunters, mothers, the little ones. They lay down and opened their mouths, and something drank them out." },
  { who: "Old Lume", text: "Listen to me. The dead must not be wasted. Wear the faces, Kra. Wear the faces so the mouths stay closed." },
  { who: "Old Lume", text: "Take my knife. And this spear... I did not finish it. You will." },
  { who: "Old Lume", text: "Eat. Drink. Hunt. Then go to the falling water. The small cave there... it is the first throat." },
  { who: "", text: "Old Lume's breath rattles once, and stops. The camp is silent but for the stream." },
];

export const GLYPHS = {
  spiral: { label: "River-Tooth spiral", desc: "The tribe's mark. Claims this place for the dead." },
  hand: { label: "Open hand", desc: "A warning: a hunter was here and lived." },
  mouth: { label: "Closed mouth", desc: "A ward: may the throats stay shut." },
};

function glyphCanvas(kind) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  g.strokeStyle = "rgba(120,10,6,0.95)"; g.fillStyle = "rgba(120,10,6,0.95)"; g.lineCap = "round"; g.lineJoin = "round";
  g.lineWidth = 7;
  if (kind === "spiral") {
    g.beginPath();
    for (let i = 0; i <= 120; i++) { const t = i / 120, a = t * Math.PI * 6, r = 4 + t * 50; const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  } else if (kind === "hand") {
    g.beginPath(); g.ellipse(64, 78, 24, 28, 0, 0, Math.PI * 2); g.fill();
    for (const [x, y, a, l] of [[40, 44, -0.5, 30], [52, 30, -0.15, 36], [66, 26, 0.05, 38], [80, 32, 0.25, 34], [96, 64, 0.95, 26]]) {
      g.save(); g.translate(x, y + 18); g.rotate(a); g.beginPath(); g.ellipse(0, -l / 2, 7, l / 2, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
  } else {
    g.beginPath(); g.ellipse(64, 64, 48, 26, 0, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(18, 64); g.lineTo(110, 64); g.stroke();
    for (let i = 0; i < 7; i++) { const x = 30 + i * 11; g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 3, 54); g.lineTo(x + 6, 64); g.fill(); g.beginPath(); g.moveTo(x + 2, 64); g.lineTo(x + 5, 74); g.lineTo(x + 8, 64); g.fill(); }
  }
  // drips
  g.lineWidth = 3;
  for (let i = 0; i < 6; i++) { const x = 30 + Math.random() * 70, y = 70 + Math.random() * 30; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 1, y + 10 + Math.random() * 18); g.stroke(); }
  return c;
}
export function glyphSVG(kind) {
  const p = kind === "spiral" ? '<path d="M24 24 m0 0 a2 2 0 1 1 4 0 a6 6 0 1 1 -12 0 a10 10 0 1 1 20 0 a14 14 0 1 1 -28 0" fill="none" stroke="#a01a10" stroke-width="3"/>'
    : kind === "hand" ? '<ellipse cx="24" cy="30" rx="9" ry="11" fill="#a01a10"/><g fill="#a01a10"><rect x="13" y="8" width="5" height="14" rx="2.5" transform="rotate(-20 15 15)"/><rect x="19" y="4" width="5" height="16" rx="2.5"/><rect x="25" y="4" width="5" height="16" rx="2.5"/><rect x="31" y="7" width="5" height="14" rx="2.5" transform="rotate(15 33 14)"/><rect x="34" y="22" width="5" height="11" rx="2.5" transform="rotate(50 36 27)"/></g>'
    : '<ellipse cx="24" cy="24" rx="19" ry="10" fill="none" stroke="#a01a10" stroke-width="3"/><path d="M6 24h36" stroke="#a01a10" stroke-width="3"/><path d="M10 24l2-4 2 4 2-4 2 4 2-4 2 4 2-4 2 4 2-4 2 4 2-4 2 4 2-4 2 4" fill="none" stroke="#a01a10" stroke-width="1.5"/>';
  return `<svg viewBox="0 0 48 48" width="48" height="48">${p}</svg>`;
}

export class Story {
  constructor(env) {
    this.env = env;
    this.surv = new Survival();
    this.active = false;
    this.flags = {};
    this.glyphs = [];
    this.log = [];
    this.lastPromptT = 0;
    this.prompt = null;
    this._glyphTex = {};
    this.quests = new QuestLog(); // round 16
    this.sandbox = false; // round 16: free play keeps a pack (baskets, crafting) without the story
    this.pickups = []; this.picked = {};
    env.ui.onPanelAction = (a, id) => this.panelAction(a, id);
    env.ui.onInspect = (id, r) => this.inspected(id, r);
    env.ui.onTrack = (id) => { if (this.quests.state(id) === "active") { this.quests.tracked = id; this._objT = 0; } };
    env.ui.questDone = (id) => this.quests.done(id);
  }

  _log(e) { this.log.push({ t: +(this.env.time() || 0).toFixed(1), ...e }); if (this.log.length > 120) this.log.shift(); }

  // ---------------- lifecycle ----------------
  newGame() {
    this.surv.reset();
    this.flags = {}; this.glyphs = []; this.picked = {};
    this.quests.reset(); this.quests.start("m1", this.surv.stats);
    this.active = true; this.sandbox = false;
    this._log({ e: "newGame" });
  }

  /** Round 16: free play: a pack, crafting and baskets, but no needs, quests or story. */
  startSandbox() {
    this.active = false; this.sandbox = true;
    this.surv.reset(); this.surv.slots = 12; this.surv.tools = { knife: true, spear: true, spearDone: true };
    for (const r of RECIPES) this.surv.recipes.add(r.id);
  }

  // ---------------- round 16: quests ----------------
  get P() { return this.env.places?.() || null; }
  near(key, r) { const p = this.place(key), f = this.env.feet(); return !!(p && f && this.env.mode() === "overworld" && Math.hypot(p.x - f.x, p.z - f.z) < r); }
  place(key) {
    const P = this.P; if (!P) return null;
    if (key === "hall") { const h = (P.town.buildings || []).find((b) => b.kind === "hall"); return h ? { x: h.x, z: h.z } : P.town; }
    if (key === "cave") return P.cave;
    return P[key] || null;
  }
  npcVisible(id) { const n = NPCS[id]; return !n.after || this.quests.done(n.after); }
  questReady(id) {
    const d = QUEST[id]; if (!d) return false;
    if (d.dynamic) return !!this.flags.actDone;
    const c = this.quests.ctx(id);
    return d.objectives.every((o) => o.ok(this, c));
  }
  questLines(id) {
    const d = QUEST[id], c = this.quests.ctx(id), P = this.P;
    if (d.dynamic) { const st = this.currentStep(); return st ? { title: `${d.title}: ${st.title}`, lines: st.lines } : { title: d.title, lines: [["Rest at the camp fire", false]] }; }
    const lines = d.objectives.map((o) => [fill(o.t, P), !!o.ok(this, c)]);
    if (d.turnIn) lines.push([`${lines.every((l) => l[1]) ? "Return to" : "Then speak with"} ${NPCS[d.turnIn].name}`, false]);
    return { title: fill(d.title, P), lines };
  }
  /** Where the tracked quest points (minimap / map / compass), or null. */
  questTarget(id = this.quests.tracked) {
    const d = QUEST[id]; if (!d || d.dynamic || this.quests.state(id) !== "active") return null;
    const c = this.quests.ctx(id);
    for (const o of d.objectives) if (!o.ok(this, c)) { if (o.at) { const p = o.at(this); if (p) return { x: p.x, z: p.z, label: fill(o.t, this.P) }; } return null; }
    const n = this.P?.npc[d.turnIn]; return n ? { x: n.x, z: n.z, label: n.name } : null;
  }
  /** "!" quest to offer, "?" quest to hand in, or "". */
  npcMark(id) {
    if (!this.active || !this.npcVisible(id)) return "";
    if (this.quests.active().some((q) => QUEST[q].turnIn === id && this.questReady(q))) return "?";
    if (QUESTS.some((d) => d.giver === id && !this.quests.state(d.id) && (d.req || []).every((r) => this.quests.done(r)))) return "!";
    return "";
  }
  /** Round 17: the first look at each item: +5 XP (+15 and a lore line for story items). */
  inspected(id, r = {}) {
    const s = this.surv;
    if (s.inspected.has(id)) return 0;
    s.inspected.add(id);
    const n = r.special ? 15 : 5;
    this.env.ui.toast(r.special ? `Lore learned: ${r.name} (+${n} XP)` : `Inspected ${r.name} (+${n} XP)`, r.special ? "skill" : "");
    this.xp(n, "inspect");
    return n;
  }
  /** Add XP (toast on level up). */
  xp(n, why = "") {
    const g = this.surv.addXP(n);
    if (g) { this.env.ui.toast(`Level ${this.surv.level}! +${g} skill point${g > 1 ? "s" : ""} (Pack → Skills)`, "skill"); this.env.audio.music?.duckFor?.(2, 0.5); }
    this._log({ e: "xp", n, why });
  }
  giveReward(r = {}) {
    const s = this.surv, ui = this.env.ui, got = [];
    if (r.sp) { s.sp += r.sp; got.push(`+${r.sp} skill point${r.sp > 1 ? "s" : ""}`); }
    if (r.recipe && !s.recipes.has(r.recipe)) { s.recipes.add(r.recipe); got.push("recipe: " + (RECIPES.find((x) => x.id === r.recipe)?.name || r.recipe)); }
    for (const [id, n] of r.items || []) { const k = s.add(id, n); if (k) got.push(`${k} ${ITEMS[id].name.toLowerCase()}`); }
    if (got.length) ui.toast("Reward: " + got.join(", "), "skill");
    if (r.xp) this.xp(r.xp, "quest");
    if (r.card) ui.titleCard(r.card[0], r.card[1], 4200);
  }
  _say(lines, done) {
    const P = this.P;
    this.env.audio.music?.duckFor?.(20, 0.35);
    this.env.ui.say(lines.map((l) => ({ who: l.who, text: fill(l.text, P) })), done);
  }
  startQuest(id, silent = false) {
    if (!this.quests.start(id, this.surv.stats)) return;
    this._objT = 0;
    if (!silent) this.env.ui.toast("New quest: " + fill(QUEST[id].title, this.P), "skill");
    this._log({ e: "questStart", id });
  }
  completeQuest(id) {
    const d = QUEST[id], s = this.surv;
    for (const [it, n] of d.take || []) s.remove(it, n);
    const end = () => {
      this.quests.finish(id); this._objT = 0;
      this.env.ui.toast("Quest complete: " + fill(d.title, this.P), "good");
      this.giveReward(d.reward);
      this._log({ e: "questDone", id });
      this.save("auto");
      // chain: the same person may have the next task straight away
      const next = d.turnIn && QUESTS.find((q) => q.giver === d.turnIn && !this.quests.state(q.id) && (q.req || []).every((r) => this.quests.done(r)));
      if (next) setTimeout(() => { if (!this.env.ui.modal) this.offerQuest(next); }, 900);
    };
    if (d.outro) this._say(d.outro, end); else end();
  }
  offerQuest(d) { this._say(d.intro || [], () => this.startQuest(d.id)); }
  talkNPC(id) {
    const n = NPCS[id], q = this.quests;
    const ready = q.active().find((x) => QUEST[x].turnIn === id && this.questReady(x));
    if (ready) return this.completeQuest(ready);
    const offer = QUESTS.find((d) => d.giver === id && !q.state(d.id) && (d.req || []).every((r) => q.done(r)));
    if (offer) return this.offerQuest(offer);
    const pend = q.active().find((x) => QUEST[x].turnIn === id);
    if (pend) { const L = this.questLines(pend).lines.find((l) => !l[1]); return this._say([{ who: n.name, text: L ? `Not yet. ${L[0]}.` : "Well?" }]); }
    this._say([{ who: n.name, text: n.idle }]);
  }
  /** Per-frame quest bookkeeping (cheap; runs a few times a second). */
  tickQuests() {
    const q = this.quests;
    if (q.state("m1") === "active" && this.flags.actDone) {
      q.finish("m1"); this.giveReward(QUEST.m1.reward);
      this.env.ui.toast("Quest complete: The Empty Camp", "good");
    }
    for (const d of QUESTS) if (d.auto && !q.state(d.id) && (d.req || []).every((r) => q.done(r)) && !this.env.ui.modal) { this.startQuest(d.id); if (d.intro) this._say(d.intro); }
    const f = this.env.feet(), P = this.P;
    if (q.state("m4") === "active" && f && P) {
      const c = q.ctx("m4"), h = this.hallLocal(f);
      if (h && Math.abs(h.along) < 10.4 && Math.abs(h.lat) < 3.6) c.flags.inHall = true;
    }
    if (q.state("m5") === "active" && this.env.mode() !== "overworld" && P?.cave && this.env.caveEntryId?.() === P.cave.id) {
      const c = q.ctx("m5"); c.flags.entered = true; c.flags.explored = Math.max(c.flags.explored || 0, this.env.explored?.() || 0);
    }
  }
  hallLocal(f) {
    const P = this.P, h = P && (P.town.buildings || []).find((b) => b.kind === "hall"); if (!h) return null;
    const ux = Math.sin(h.rot), uz = Math.cos(h.rot), dx = f.x - h.x, dz = f.z - h.z;
    return { along: dx * ux + dz * uz, lat: -dx * uz + dz * ux };
  }
  questLogHTML() {
    const q = this.quests, P = this.P;
    const others = q.active().filter((id) => id !== q.tracked).map((id) => `<button class="q-other" data-track="${id}">${QUEST[id].main ? "◆" : "◇"} ${fill(QUEST[id].title, P)}</button>`).join("");
    const done = q.completed();
    return (others ? `<div class="q-sub">Other quests (tap to track)</div>${others}` : "") + (done.length ? `<div class="q-sub">Done: ${done.map((id) => fill(QUEST[id].title, P)).join(" · ")}</div>` : "");
  }

  /** Objective list (first unfinished group is shown). */
  steps() {
    const f = this.flags, s = this.surv, st = s.stats;
    return [
      { title: "Find who still breathes", lines: [["Search the camp", f.lumeTalked]], done: f.lumeDead },
      { title: "Survive", lines: [["Gather berries or roots and eat", st.ate > 0], ["Drink from the stream", st.drank > 0]], done: st.ate > 0 && st.drank > 0 },
      { title: "Hunt", lines: [["Kill a rabbit or bird (crouch to stalk)", st.small > 0], ["Bring down a deer", st.deer > 0], ["Harvest a carcass with your knife", st.harvested > 0]], done: st.small > 0 && st.deer > 0 && st.harvested > 0 },
      { title: "Fire", lines: [["Relight the camp fire", f.fireLit], ["Cook meat at the fire", st.cooked > 0]], done: f.fireLit && st.cooked > 0 },
      { title: "A pack for the journey", lines: [["Craft a backpack (Tab / Pack → Crafting) from a hide, or from Tor...", s.crafted.has("backpack")]], done: s.crafted.has("backpack") },
      { title: "The first throat", lines: [["Find the cave beside the waterfall", f.enteredHollow]], done: f.enteredHollow },
      { title: "Waterfall Hollow", lines: [["Kill what lives in the dark", f.ratKilled], ["Collect its blood", f.ratHarvested], ["Paint a blood glyph on the wall", this.glyphs.length > 0], ["Find the dead hunter deep in the cave and remove his face", f.faceTaken], ["Eat the creature's organ", f.memory]], done: f.ratKilled && f.ratHarvested && this.glyphs.length > 0 && f.faceTaken && f.memory },
      { title: "Home", lines: [["Return to camp and rest at the fire (save)", f.actDone]], done: f.actDone },
    ];
  }
  currentStep() { return this.steps().find((x) => !x.done) || null; }

  // ---------------- per-frame ----------------
  update(dt) {
    if (this.sandbox && !this.active) { // round 16: free play: prompts only (baskets, carcasses, pickups)
      const ui = this.env.ui;
      if (ui.modal) { ui.setPrompt(null); this.prompt = null; return; }
      this.prompt = this.findInteraction(); ui.setPrompt(this.prompt ? this.prompt.label : null);
      return;
    }
    if (!this.active) return;
    const env = this.env, ui = env.ui, s = this.surv;
    const running = !env.player()?.mounted && env.player()?.runFrac > 0.3 && (env.player()?.speedNow || 0) > 2.6 ? 1 : 0; // the horse does the running
    if (!env.paused()) {
      const r = s.tick(dt, running);
      if (r.damage) { env.hurt(); ui.toast(s.hunger <= 0 ? "Starving..." : "Parched...", "bad"); }
    }
    env.player() && (env.player().sprintAllowed = !s.exhausted);
    ui.meterUpdate(s);
    if ((this._objT = (this._objT || 0) - dt) <= 0) {
      this._objT = 0.4;
      this.tickQuests();
      const tr = this.quests.tracked;
      if (tr && this.quests.state(tr) === "active") { const v = this.questLines(tr); ui.setObjective(v.title, v.lines, this.questLogHTML()); }
      else ui.setObjective(this.quests.done("m7") ? "Act II: Gathering Faces" : "No quest tracked", [["Explore, hunt, and look for people with a ! over their heads", true]], this.questLogHTML());
    }
    if (ui.modal) { ui.setPrompt(null); this.prompt = null; return; }
    this.prompt = this.findInteraction();
    ui.setPrompt(this.prompt ? this.prompt.label : null, this.prompt?.big);
    if (this.hunter?.glow) this.hunter.glow.userData.tick(env.time());
  }

  // ---------------- interactions ----------------
  findInteraction() {
    const env = this.env, f = env.feet(), s = this.surv, fl = this.flags;
    if (!f) return null;
    const d2 = (o) => Math.hypot(o.x - f.x, o.z - f.z);
    if (env.mode() === "overworld") {
      const camp = env.camp(), t = env.terrain();
      // round 15: storage baskets inside a settlement's longhouse / lodges
      const box = env.container?.(f);
      if (box) return { label: box.searched ? "The basket is empty" : "Search the storage basket", act: () => this.searchBasket(box) };
      // round 19: deadwood for a raft (Survival: Herb Lore)
      if (s.skills.has("surv1") && t?.scatter) {
        const k = this.deadwoodNear(f, t);
        if (k) return { label: "Gather deadwood logs", act: () => this.gatherWood(k) };
      }
      if (this.sandbox && !this.active) {
        const carc = env.wildlife()?.nearestCarcass(f, 2.6);
        return carc ? { label: `Harvest the ${carc.kind}`, act: () => this.harvest(carc) } : null;
      }
      // round 16: people with something to say
      const P = this.P;
      if (P) for (const [id, n] of Object.entries(P.npc)) if (this.npcVisible(id) && d2(n) < 2.4) return { label: `Talk to ${n.name}`, act: () => this.talkNPC(id) };
      if (this.quests.state("m4") === "active" && !this.quests.ctx("m4").flags.painting) {
        const h = this.hallLocal(f);
        if (h && Math.abs(h.along) < 5 && Math.abs(h.lat) > 1.7 && Math.abs(h.lat) < 3.6) return { label: "Study the wall painting", act: () => this.studyPainting() };
      }
      if (!camp) return null;
      if (!fl.lumeDead && d2(camp.lume) < 2.8) return { label: "Kneel by Old Lume", act: () => this.talkLume() };
      const fireP = { x: camp.site.camp.x, z: camp.site.camp.z };
      if (d2(fireP) < 2.6) {
        if (!camp.fireLit && fl.lumeDead) return { label: "Strike flint and relight the fire", act: () => this.lightFire() };
        if (camp.fireLit) return { label: "Use the fire (cook / rest & save)", act: () => this.useFire() };
      }
      const carc = env.wildlife()?.nearestCarcass(f, 2.6);
      if (carc) return s.tools.knife ? { label: `Harvest the ${carc.kind} with your knife`, act: () => this.harvest(carc) } : { label: "You need a knife to cut it", act: () => env.ui.toast("You need a knife") };
      if (!camp.tor.skinned && d2(camp.tor) < 2.4 && fl.lumeDead) return { label: "Kneel by Tor", act: () => this.torChoice() };
      if (camp.tor.skinned && d2(camp.tor) < 2.4) return { label: "Look at Tor", act: () => this._say([{ who: "", text: "You took Tor's skin for the pack. The face Lume spoke of is another: a hunter who crawled into Waterfall Hollow and never came out. He lies deep inside." }]) };
      for (const b of camp.bushes) if (b.ready && d2(b) < 2.2) return { label: b.kind === "berries" ? "Pick berries" : "Dig up roots", act: () => this.gather(b) };
      if (t.streamDist(f.x, f.z) < 2.1) return { label: "Drink from the stream", act: () => this.drinkWater() };
      for (const b of camp.bodies) if (d2(b) < 1.8) return { label: "The dead lie with their mouths open", act: () => env.ui.toast("Their mouths are frozen open. Something drank them out.") };
      return null;
    }
    // round 17: the story beats in the hollow come first (they used to lose to "Drink" / pickups)
    if (this.active && env.caveKind() === "hollow") {
      const h = this.hunter;
      if (h && !fl.faceTaken && Math.hypot(h.x - f.x, h.z - f.z) < 3.0 && Math.abs(h.y - f.y) < 2.2) return { label: "Remove the dead hunter's face", big: "Remove face", act: () => this.takeFace() };
      const m0 = env.monster();
      if (m0 && !m0.alive && m0.kind === "rat" && !fl.ratHarvested && Math.hypot(m0.pos.x - f.x, m0.pos.z - f.z) < 2.6) return { label: "Collect the creature's blood and organ", big: "Collect blood", act: () => this.harvestRat() };
    }
    // round 16: flint / ochre / bone lying in the caves
    for (const k of this.pickups) if (!k.taken && Math.hypot(k.x - f.x, k.z - f.z) < 1.6 && Math.abs(k.y - f.y) < 2) return { label: `Pick up ${ITEMS[k.id].name.toLowerCase()}`, act: () => this.takePickup(k) };
    if (this.sandbox && !this.active) return null;
    // caves: drink only where the rendered stream / pool really is
    const wh = env.caveWater?.();
    if (wh && wh.waterDist && wh.waterDist(f.x, f.y, f.z) < 0.9) return { label: "Drink from the stream", act: () => this.drinkWater() };
    if (env.caveKind() !== "hollow") return null;
    const m = env.monster();
    if (m && !m.alive && m.kind === "rat" && !fl.ratHarvested && Math.hypot(m.pos.x - f.x, m.pos.z - f.z) < 2.4) return { label: "Collect the creature's blood and organ", act: () => this.harvestRat() };
    const h = this.hunter;
    if (h && !fl.faceTaken && Math.hypot(h.x - f.x, h.z - f.z) < 2.3) return { label: "Take the dead hunter's face", act: () => this.takeFace() };
    if (s.count("blood") > 0) {
      const w = this.wallAhead();
      if (w) return { label: "Paint a blood glyph on the wall", act: () => this.paintChoice(w) };
    }
    return null;
  }

  interact() {
    if (this.env.ui.advance()) return true;
    if ((!this.active && !this.sandbox) || this.env.ui.modal) return false;
    const p = this.prompt || this.findInteraction();
    if (!p) return false;
    this._log({ e: "interact", what: p.label });
    p.act();
    return true;
  }

  searchBasket(box) {
    if (box.searched) { this.env.ui.toast("Nothing left in it."); return; }
    box.searched = true;
    const got = [];
    for (const [id, n] of box.loot) { this.surv.add(id, n); got.push(`${n} ${(ITEMS[id]?.name || id).toLowerCase()}`); }
    this.env.ui.toast("Found: " + got.join(", "), "good");
    if (this.active) this.xp(5, "basket");
    this._log({ e: "basket", loot: box.loot });
  }

  studyPainting() {
    const c = this.quests.ctx("m4"); c.flags.painting = true;
    this._say([{ who: "", text: "Handprints. A deer hunt. Spirals of old red. And at the end, a mouth: wide open, full of teeth, with small figures walking into it." },
      { who: "", text: "Kra's skin crawls. He has seen those teeth before, in the dark behind the falls." }]);
    this.xp(20, "painting");
  }
  takePickup(k) {
    if (!this.surv.add(k.id, k.n)) { this.env.ui.toast("No room in your pack", "bad"); return; }
    k.taken = true; if (k.obj) k.obj.visible = false;
    (this.picked[k.cave] || (this.picked[k.cave] = [])).push(k.i);
    this.env.ui.toast(`+${k.n} ${ITEMS[k.id].name}`, "good");
    this._log({ e: "pickup", id: k.id });
  }

  talkLume() {
    const env = this.env, camp = env.camp();
    this.flags.lumeTalked = true;
    env.audio.music?.duckFor?.(30, 0.35);
    env.ui.say(LUME_LINES, () => {
      const s = this.surv;
      s.tools.knife = true; s.tools.spear = true; s.skills.add("tools");
      env.setArmed(true);
      this.lumeDies();
      env.ui.toast("Received: stone knife, half-finished bone spear", "good");
      env.ui.toast("Skill learned: Stone Tools", "skill");
      this._log({ e: "lumeDied" });
    }, (i, line) => { if (line.who) env.audio.murmur?.(1.2 + line.text.length * 0.045); });
  }

  lumeDies() {
    const camp = this.env.camp();
    this.flags.lumeDead = true;
    if (!camp || camp.lume.deadObj) return;
    const L = camp.lume, old = L.obj;
    const b = makeBody({ pose: "sprawl", elder: true, seed: 7 });
    b.position.copy(old.position); b.rotation.y = old.rotation.y;
    old.parent.add(b); old.visible = false; L.deadObj = b; L.alive = false;
    bake(b, new Set([b.userData.skull, b.userData.mouth]));
  }

  lightFire() {
    const camp = this.env.camp();
    camp.lightFire(); this.flags.fireLit = true;
    if (!this.surv.skills.has("fire")) { this.surv.skills.add("fire"); this.env.ui.toast("Skill learned: Fire-starting", "skill"); }
    this.env.ui.toast("Sparks catch in the dry moss. The fire lives again.");
    this._log({ e: "fireLit" });
  }

  useFire() {
    const s = this.surv, raw = s.count("meat");
    const opts = [];
    if (raw) opts.push({ id: "cook", label: `Cook meat (${raw})`, desc: "Cooked meat feeds you far better." });
    opts.push({ id: "save", label: "Rest and save", desc: "Your progress is kept here." });
    this.env.ui.ask("The fire", "Warmth, light, the smell of smoke.", opts, (id) => {
      if (id === "cook") this.cook();
      else this.saveAtFire();
    });
  }
  cook() {
    const s = this.surv, n = s.count("meat");
    s.remove("meat", n);
    const got = s.add("cooked", n);
    s.stats.cooked += got;
    this.env.ui.toast(`Cooked ${got} meat`, "good");
    this._log({ e: "cook", n: got });
  }
  saveAtFire() {
    const fl = this.flags;
    if (!fl.actDone && fl.memory && fl.exitedHollow) {
      fl.actDone = true;
      this.save("fire");
      this.env.ui.titleCard("End of Act I", "The Empty Camp<br><em>Wear the faces so the mouths stay closed. The caves are calling.</em>", 6500);
      this._log({ e: "actDone" });
    } else this.save("fire");
    this.env.ui.toast("Rested by the fire. Game saved.", "good");
  }

  gather(b) {
    const s = this.surv, id = b.kind === "berries" ? "berries" : "roots", n = id === "berries" ? 3 : 2;
    const got = s.add(id, n);
    if (!got) { this.env.ui.toast("No room in your hands. Craft a backpack.", "bad"); return; }
    b.ready = false; b.fruit.visible = false; b.regrow = 240;
    const herb = s.skills.has("surv1") ? s.add("herbs", 1) : 0;
    this.env.ui.toast(`+${got} ${ITEMS[id].name}` + (herb ? ", +1 Healing herbs" : ""));
    this._log({ e: "gather", id, n: got });
  }
  deadwoodNear(f, t) {
    this.woodTaken = this.woodTaken || new Set();
    const sc = t.scatter(Math.floor(f.x / 64), Math.floor(f.z / 64));
    for (const tr of sc.trees) if (tr.type <= 3 && Math.hypot(tr.x - f.x, tr.z - f.z) < 2.4) { const k = `${tr.x | 0},${tr.z | 0}`; if (!this.woodTaken.has(k)) return k; }
    return null;
  }
  gatherWood(k) {
    const got = this.surv.add("logs", 2);
    if (!got) { this.env.ui.toast("No room for the logs. Craft a backpack.", "bad"); return; }
    this.woodTaken.add(k);
    this.env.ui.toast(`+${got} Deadwood logs`);
    this._log({ e: "gather", id: "logs", n: got });
  }
  drinkWater() { this.env.ui.toast(this.surv.drink()); this.env.audio.splash?.(); this._log({ e: "drink" }); }

  harvest(a) {
    const yields = this.env.wildlife().harvest(a);
    const got = [];
    const big = a.kind === "deer" || a.kind === "boar" || a.kind === "goat", y2 = yields.slice();
    y2.push(["bone", 1]); if (big) y2.push(["sinew", 1]);
    if (this.surv.skills.has("hunt3")) y2.push(["meat", 1], ["bone", 1]);
    for (const [id, n] of y2) { if (!ITEMS[id]) continue; const k = this.surv.add(id, n); if (k) got.push(`+${k} ${ITEMS[id].name}`); }
    this.surv.stats.harvested++;
    this.env.ui.toast(got.join(", ") || "Your hands are full", got.length ? "good" : "bad");
    this._log({ e: "harvest", kind: a.kind, got });
  }

  torChoice() {
    const camp = this.env.camp();
    this.env.ui.ask("Tor", "Tor taught you to swim in this stream. His mouth is open like the others. Lume said the dead must not be wasted.", [
      { id: "take", label: "Take his skin", desc: "Enough for a backpack. You will carry him with you." },
      { id: "leave", label: "Leave him in peace", desc: "Hunt a deer for its hide instead." },
    ], (id) => {
      if (id !== "take") return;
      if (!this.surv.add("skin", 1)) { this.env.ui.toast("No room", "bad"); return; }
      camp.tor.skinned = true; markFaceTaken(camp.tor.obj);
      this.env.ui.toast("+1 Tor's skin. Forgive me, brother.", "skill");
      this._log({ e: "torSkin" });
    });
  }

  /** Spear thrust: animals first (overworld). Returns true if something was hit. */
  onAttack(feet, fx, fz) {
    if (!this.active || this.env.mode() !== "overworld") return false;
    const dmg = 1 + (this.surv.tools.spearDone || this.surv.str > 0 ? 1 : 0);
    const a = this.env.wildlife()?.tryHit(feet, fx, fz, dmg);
    this.lastHit = a;
    if (!a) return false;
    this.creditAnimal(a);
    return true;
  }

  /** Story bookkeeping for a hit animal (spear or arrow). */
  creditAnimal(a) {
    if (!this.active) return;
    if (!a.alive) {
      if (a.kind === "deer") this.surv.stats.deer++; else this.surv.stats.small++;
      this.xp(a.kind === "deer" || a.kind === "boar" ? 25 : 10, "kill");
      this.env.ui.toast(`You killed a ${a.kind}`, "good");
      if (!this.surv.skills.has("tracking")) { this.surv.skills.add("tracking"); this.env.ui.toast("Skill learned: Basic Tracking (animals on the map)", "skill"); }
    } else this.env.ui.toast(`The ${a.kind} is wounded and bolts!`);
    this._log({ e: "hitAnimal", kind: a.kind, dead: !a.alive });
  }

  // ---------------- crafting / inventory ----------------
  panelAction(a, id) {
    const s = this.surv, ui = this.env.ui;
    if (a === "eat") { const m = s.eat(id); if (m) ui.toast(m); this._log({ e: "eat", id }); }
    if (a === "eatm") this.bloodMemory();
    if (a === "learn") {
      if (s.learn(id, (q) => this.quests.done(q))) { const k = s.tierInfo(id); ui.toast(`Skill learned: ${k.t.name}`, "skill"); this.env.applyStats(); this._log({ e: "learn", id }); }
    }
    if (a === "wear") { if (s.wear.has(id)) s.wear.delete(id); else if (s.crafted.has(id)) s.wear.add(id); this.env.applyStats(); }
    if (a === "use" && id === "salve") { if (this.env.heal?.(1)) { s.remove("salve", 1); ui.toast("The salve stings, then soothes. +1 heart", "good"); } else ui.toast("You are not hurt"); }
    if (a === "craft") {
      if (id === "backpack" && s.count("hide") && s.count("skin")) {
        ui.ask("Backpack", "Which skin will you sew?", [{ id: "hide", label: "Deer hide" }, { id: "skin", label: "Tor's skin" }], (use) => { const m = s.craft("backpack", use); if (m) ui.toast(m, "good"); ui.renderPanel(); });
        return;
      }
      if (id === "raft" && !this.env.launchRaft?.(true)) { ui.toast("Stand at the water's edge (a lake, river, marsh or the sea) to build a raft.", "bad"); return; }
      const m = s.craft(id);
      if (m && id === "raft") this.env.launchRaft?.();
      if (m) { ui.toast(m, "good"); this._log({ e: "craft", id }); if (this.active) this.xp(15, "craft"); this.env.applyStats(); }
    }
  }

  bloodMemory() {
    const s = this.surv, ui = this.env.ui;
    if (!s.count("morgan")) return;
    ui.closePanel();
    ui.ask("Blood Memory", "The organ is cold and bitter. Something old moves behind your eyes. What does your blood remember?", [
      { id: "str", label: "Strength", desc: "+1 spear damage, permanently." },
      { id: "hp", label: "Health", desc: "+1 heart, permanently." },
    ], (id) => {
      s.remove("morgan", 1);
      if (id === "str") s.str += 1; else s.hpBonus += 1;
      s.skills.add("blood"); this.flags.memory = true;
      this.env.applyStats();
      ui.toast("Skill learned: Blood Memory (" + (id === "str" ? "+1 Strength" : "+1 Health") + ")", "skill");
      this._log({ e: "bloodMemory", pick: id });
    }, false);
  }

  /** Round 17: a pale pulsing halo + ground ring so the hunter's body reads in the dark. */
  _glow(spot, env) {
    const g = new THREE.Group(); g.name = "hunter-glow";
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d"), gr = x.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,226,160,0.9)"); gr.addColorStop(0.4, "rgba(255,190,110,0.35)"); gr.addColorStop(1, "rgba(255,170,90,0)");
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    halo.scale.set(2.2, 2.2, 1); halo.position.set(spot.x, spot.y + 0.55, spot.z); g.add(halo);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 32), new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(spot.x, spot.y + 0.04, spot.z); g.add(ring);
    g.userData.tick = (t) => { const k = 0.75 + 0.25 * Math.sin(t * 3); halo.material.opacity = k; ring.material.opacity = 0.35 + 0.3 * k; ring.scale.setScalar(0.9 + 0.15 * k); };
    env.addCaveObject(g);
    return g;
  }

  /** Round 17: where to go next + a short line (the 💡 Hint button). Coordinates are in the current world. */
  hint() {
    const env = this.env, fl = this.flags, mode = env.mode(), camp = env.camp(), site = env.terrain()?.act1, f = env.feet();
    const T = (x, z, label, text) => ({ x, z, label, text });
    if (mode !== "overworld") {
      const out = env.caveExit?.();
      if (this.active && env.caveKind() === "hollow") {
        const m = env.monster();
        if (!fl.ratKilled) { const sp = env.caveSpot(0.55); return T(sp?.x ?? f.x, sp?.z ?? f.z, "The scraping", "Something scrapes deeper in. Follow the main passage down and keep your spear ready."); }
        if (!fl.ratHarvested && m) return T(m.pos.x, m.pos.z, "The creature's body", "The creature lies where it fell. Kneel by it and collect its blood.");
        if (!this.glyphs.length) return T(f.x, f.z, "Any wall", "Stand facing a cave wall with the blood and press Paint.");
        if (!fl.faceTaken && this.hunter) return T(this.hunter.x, this.hunter.z, "The dead hunter", "The dead hunter lies deeper in, curled against the wall. Look for the pale glow, then remove his face.");
        if (!fl.memory) return T(f.x, f.z, "Your pack", "Open your Pack and eat the creature's organ. Your blood will remember.");
      }
      return out ? T(out.x, out.z, "Way out", "Head back the way you came to the cave mouth, or use Exit cave.") : null;
    }
    if (!this.active) return null;
    const st = this.currentStep();
    if (st && !fl.actDone) {
      const t = st.title;
      if (t.startsWith("Find who")) return T(camp.lume.x, camp.lume.z, "Old Lume", "Someone is still breathing by the fire. Kneel by Old Lume.");
      if (t === "Survive") {
        if (!this.surv.stats.ate) { const b = camp.bushes.filter((x) => x.ready).sort((a, b2) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b2.x - f.x, b2.z - f.z))[0]; if (b) return T(b.x, b.z, "Berry bush", "Pick berries or dig roots near the camp, then eat them from your Pack."); }
        const q = site.stream[Math.floor(site.stream.length * 0.6)]; return T(q.x, q.z, "The stream", "Drink from the stream below the camp.");
      }
      if (t === "Hunt") {
        const c = env.wildlife()?.nearestCarcass(f, 300); if (c && !c.harvested) return T(c.pos.x, c.pos.z, "Your kill", "Harvest the carcass with your knife.");
        const kind = this.surv.stats.small ? "deer" : "rabbit", n = env.wildlife()?.nearest(f, kind) || env.wildlife()?.nearest(f, "bird");
        if (n) return T(n.a.pos.x, n.a.pos.z, kind === "deer" ? "Deer" : "Small game", `Crouch and creep up on the ${kind === "deer" ? "deer" : "rabbit or bird"}, then stab.`);
      }
      if (t === "Fire" || t === "Home") return T(site.camp.x, site.camp.z, "Camp fire", t === "Home" ? "Go home and rest by the fire." : "Strike flint at the camp fire, then cook your meat there.");
      if (t.startsWith("A pack")) return T(f.x, f.z, "Your pack", "Open the Pack, then Crafting: sew a backpack from a deer hide or Tor's skin.");
      const e = site.caveEntrance; return T(e.x, e.z, "Waterfall Hollow", "The first throat is the small cave beside the falling water.");
    }
    const q = this.questTarget();
    if (q) return T(q.x, q.z, q.label, q.label + ".");
    return null;
  }

  // ---------------- Waterfall Hollow ----------------
  /** Round 16: a few flint / ochre / bone finds along the main passage of every cave. */
  placePickups(key) {
    const env = this.env, kinds = ["flint", "ochre", "flint", "bone", "flint", "ochre"];
    this.pickups = [];
    if (!this.active && !this.sandbox) return;
    const taken = new Set(this.picked[key] || []);
    const geo = this._pkGeo || (this._pkGeo = new THREE.DodecahedronGeometry(0.11, 0));
    const mats = this._pkMat || (this._pkMat = { flint: new THREE.MeshLambertMaterial({ color: 0x8a96a8, emissive: 0x18202a }), ochre: new THREE.MeshLambertMaterial({ color: 0xb8401c, emissive: 0x2a0a04 }), bone: new THREE.MeshLambertMaterial({ color: 0xe8dcc0, emissive: 0x24201a }) });
    kinds.forEach((id, i) => {
      const sp = env.caveSpot(0.12 + i * 0.15); if (!sp) return;
      const k = { id, n: id === "flint" ? 1 : 1, x: sp.x, y: sp.y, z: sp.z, i, cave: key, taken: taken.has(i) };
      if (!k.taken) { const m = new THREE.Mesh(geo, mats[id]); m.position.set(sp.x, sp.y + 0.08, sp.z); m.scale.set(1.3, 0.7, 1); m.name = "pickup"; env.addCaveObject(m); k.obj = m; }
      this.pickups.push(k);
    });
  }
  onCaveLoaded(kind, key = kind) {
    this.placePickups(key);
    if (!this.active || kind !== "hollow") { this.hunter = null; return; }
    this.flags.enteredHollow = true;
    const env = this.env;
    // the dead hunter lies in the creature's den. Round 17: on the first roomy stretch past the
    // halfway mark you can reach standing / crouching (it was at 78%, past two crawl-only squeezes
    // in the dark, which is why it was so hard to find).
    const spot = env.caveSpotRoomy?.(0.45, 0.62) || env.caveSpot(0.55);
    if (spot) {
      const b = makeBody({ pose: "curl", seed: 31 });
      const fy = env.floorAt?.(spot.x, spot.y + 1.2, spot.z); // round 17: sit on the rendered floor (was sometimes sunk)
      if (fy != null && Math.abs(fy - spot.y) < 2.5) spot.y = fy + 0.02;
      b.position.set(spot.x, spot.y, spot.z); b.rotation.y = spot.yaw;
      if (this.flags.faceTaken) markFaceTaken(b);
      env.addCaveObject(b);
      this.hunter = { x: spot.x, y: spot.y, z: spot.z, obj: b };
      if (!this.flags.faceTaken) this.hunter.glow = this._glow(spot, env);
    }
    for (const g of this.glyphs) this._placeGlyph(g);
    if (!this.flags.ratKilled) env.ui.toast("Water drips somewhere ahead. Something scrapes on stone.");
    this._log({ e: "enterHollow" });
  }

  onMonsterKilled(m) {
    if (!this.active || m.kind !== "rat") return;
    this.flags.ratKilled = true; this.xp(40, "rat");
    this.env.ui.toast("The rat-thing is dead. Its blood is still warm.", "good");
    this._log({ e: "ratKilled" });
  }
  harvestRat() {
    const s = this.surv;
    const b = s.add("blood", 2), o = s.add("morgan", 1);
    if (!b && !o) { this.env.ui.toast("No room: drop or eat something", "bad"); return; }
    this.flags.ratHarvested = true;
    this.env.ui.toast(`+${b} Creature blood, +${o} Creature organ`, "good");
    this._log({ e: "ratHarvest" });
  }

  takeFace() {
    const s = this.surv;
    this.flags.faceTaken = true;
    s.faces += 1;
    markFaceTaken(this.hunter.obj);
    if (this.hunter.glow) { this.hunter.glow.visible = false; this.hunter.glow = null; }
    this.env.applyStats();
    this.env.ui.toast("You cut away the hunter's face and tie it over your own. (+1 armour)", "skill");
    this.env.ui.titleCard("1 face", "The suit begins.", 2200);
    this._log({ e: "face", faces: s.faces });
  }

  /** A wall point straight ahead (within ~2.2 m) inside the current cave, or null. */
  wallAhead() {
    const env = this.env, eye = env.eye(), vol = env.volume(), yaw = env.player().yaw;
    if (!vol) return null;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const y = eye.y - 0.25;
    for (let d = 0.3; d < 2.3; d += 0.1) {
      const q = queryVolume(vol, eye.x + fx * d, y, eye.z + fz * d, 0.02, 0);
      if (!q.inside || y > q.ceil - 0.05) return { x: eye.x + fx * (d - 0.12), y, z: eye.z + fz * (d - 0.12), yaw };
    }
    return null;
  }
  paintChoice(w) {
    const opts = Object.entries(GLYPHS).map(([id, g]) => ({ id, label: g.label, desc: g.desc, svg: glyphSVG(id) }));
    this.env.ui.ask("Blood painting", "Dip two fingers in the blood. What will you paint?", opts, (id) => {
      if (!this.surv.remove("blood", 1)) return;
      const g = { kind: id, x: w.x, y: w.y, z: w.z, yaw: w.yaw, cave: "hollow" };
      this.glyphs.push(g);
      this._placeGlyph(g);
      this.env.ui.toast(`You paint the ${GLYPHS[id].label.toLowerCase()}. It glistens in the torchlight.`, "skill");
      this._log({ e: "glyph", kind: id });
    });
  }
  _placeGlyph(g) {
    const tex = this._glyphTex[g.kind] || (this._glyphTex[g.kind] = new THREE.CanvasTexture(glyphCanvas(g.kind)));
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), new THREE.MeshLambertMaterial({ map: tex, color: 0x7a2018, transparent: true, alphaTest: 0.05, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.set(g.x, g.y, g.z);
    m.rotation.y = g.yaw; // faces back toward where Kra stood
    m.name = "glyph";
    m.renderOrder = 4;
    this.env.addCaveObject(m);
  }

  onExitCave(kind) {
    if (!this.active || kind !== "hollow") return;
    if (this.flags.ratKilled) {
      this.flags.exitedHollow = true;
      this.save("auto");
      this.env.ui.toast("Autosaved", "good");
    }
  }

  // ---------------- save / load ----------------
  snapshot(kind = "fire") {
    const env = this.env, p = env.savePos();
    const camp = env.camp();
    return {
      v: 1, kind, flags: { ...this.flags }, surv: this.surv.toJSON(), glyphs: this.glyphs.slice(), quests: this.quests.toJSON(), picked: this.picked,
      pos: p, hours: env.atmo()?.hours, weather: env.atmo()?.weather,
      camp: camp ? { fireLit: camp.fireLit, tor: camp.tor.skinned } : null,
      health: env.health(),
    };
  }
  save(kind) { const snap = this.snapshot(kind); writeSave(snap); this.lastSave = snap; this._log({ e: "save", kind }); return snap; }
  hasSave() { return !!readSave(); }
  /** Restore a save. keep: carry over faces / skills / Blood Memory stats gained since (death rule). */
  load(snap = readSave(), { keep = false } = {}) {
    if (!snap) return false;
    const prev = keep ? { faces: this.surv.faces, skills: new Set(this.surv.skills), str: this.surv.str, hpBonus: this.surv.hpBonus, glyphs: this.glyphs.slice(), flags: { ...this.flags },
      xp: this.surv.xp, sp: this.surv.sp, recipes: new Set(this.surv.recipes), quests: this.quests.toJSON() } : null;
    this.surv.fromJSON(snap.surv);
    this.flags = { ...snap.flags };
    this.glyphs = (snap.glyphs || []).slice();
    this.quests.fromJSON(snap.quests); this.picked = snap.picked || {};
    if (!this.quests.state("m1")) this.quests.start("m1", this.surv.stats); // pre-round-16 saves
    this.sandbox = false;
    if (prev) {
      this.surv.faces = Math.max(this.surv.faces, prev.faces);
      for (const k of prev.skills) this.surv.skills.add(k);
      this.surv.str = Math.max(this.surv.str, prev.str); this.surv.hpBonus = Math.max(this.surv.hpBonus, prev.hpBonus);
      if (prev.glyphs.length > this.glyphs.length) this.glyphs = prev.glyphs;
      for (const k of ["faceTaken", "memory", "ratKilled", "ratHarvested", "enteredHollow"]) if (prev.flags[k]) this.flags[k] = true;
      // round 16: XP, skill points, recipes and quest progress are kept too (no double rewards)
      if (prev.xp >= this.surv.xp) { this.surv.xp = prev.xp; this.surv.sp = prev.sp; }
      for (const k of prev.recipes) this.surv.recipes.add(k);
      this.quests.fromJSON(prev.quests);
      this.surv.stamina = 100;
    }
    this.active = true;
    this._log({ e: "load", keep });
    return snap;
  }
}
