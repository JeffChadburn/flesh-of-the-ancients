/**
 * Act 1 "The Empty Camp" director: objectives, interactions (E / Interact), Lume's dialogue,
 * survival ticking, hunting hooks, crafting, the Waterfall Hollow cave beats (rat-thing, blood
 * glyph painting, the dead hunter's face, Blood Memory), saving at the fire / autosave after the
 * cave, and death -> last save (faces / skills kept).
 */
import * as THREE from "three";
import { Survival, ITEMS, SKILLS, readSave, writeSave } from "./survival.js";
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
    env.ui.onPanelAction = (a, id) => this.panelAction(a, id);
  }

  _log(e) { this.log.push({ t: +(this.env.time() || 0).toFixed(1), ...e }); if (this.log.length > 120) this.log.shift(); }

  // ---------------- lifecycle ----------------
  newGame() {
    this.surv.reset();
    this.flags = {}; this.glyphs = [];
    this.active = true;
    this._log({ e: "newGame" });
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
      { title: "Waterfall Hollow", lines: [["Kill what lives in the dark", f.ratKilled], ["Collect its blood", f.ratHarvested], ["Paint a blood glyph on the wall", this.glyphs.length > 0], ["Take the dead hunter's face", f.faceTaken], ["Eat the creature's organ", f.memory]], done: f.ratKilled && f.ratHarvested && this.glyphs.length > 0 && f.faceTaken && f.memory },
      { title: "Home", lines: [["Return to camp and rest at the fire (save)", f.actDone]], done: f.actDone },
    ];
  }
  currentStep() { return this.steps().find((x) => !x.done) || null; }

  // ---------------- per-frame ----------------
  update(dt) {
    if (!this.active) return;
    const env = this.env, ui = env.ui, s = this.surv;
    const running = !env.player()?.mounted && env.player()?.runFrac > 0.3 && (env.player()?.speedNow || 0) > 2.6 ? 1 : 0; // the horse does the running
    if (!env.paused()) {
      const r = s.tick(dt, running);
      if (r.damage) { env.hurt(); ui.toast(s.hunger <= 0 ? "Starving..." : "Parched...", "bad"); }
    }
    env.player() && (env.player().sprintAllowed = !s.exhausted);
    ui.meterUpdate(s);
    const step = this.currentStep();
    if (step !== this._shownStep || (this._objT = (this._objT || 0) - dt) <= 0) {
      this._objT = 0.5; this._shownStep = step;
      if (step) ui.setObjective(step.title, step.lines);
      else ui.setObjective("Act I complete", [["The caves are calling. Explore freely.", true]]);
    }
    if (ui.modal) { ui.setPrompt(null); this.prompt = null; return; }
    this.prompt = this.findInteraction();
    ui.setPrompt(this.prompt ? this.prompt.label : null);
  }

  // ---------------- interactions ----------------
  findInteraction() {
    const env = this.env, f = env.feet(), s = this.surv, fl = this.flags;
    if (!f) return null;
    const d2 = (o) => Math.hypot(o.x - f.x, o.z - f.z);
    if (env.mode() === "overworld") {
      const camp = env.camp(), t = env.terrain();
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
      for (const b of camp.bushes) if (b.ready && d2(b) < 2.2) return { label: b.kind === "berries" ? "Pick berries" : "Dig up roots", act: () => this.gather(b) };
      if (t.streamDist(f.x, f.z) < 2.1) return { label: "Drink from the stream", act: () => this.drinkWater() };
      for (const b of camp.bodies) if (d2(b) < 1.8) return { label: "The dead lie with their mouths open", act: () => env.ui.toast("Their mouths are frozen open. Something drank them out.") };
      return null;
    }
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
    if (!this.active || this.env.ui.modal) return false;
    const p = this.prompt || this.findInteraction();
    if (!p) return false;
    this._log({ e: "interact", what: p.label });
    p.act();
    return true;
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
    this.env.ui.toast(`+${got} ${ITEMS[id].name}`);
    this._log({ e: "gather", id, n: got });
  }
  drinkWater() { this.env.ui.toast(this.surv.drink()); this.env.audio.splash?.(); this._log({ e: "drink" }); }

  harvest(a) {
    const yields = this.env.wildlife().harvest(a);
    const got = [];
    for (const [id, n] of yields) { const k = this.surv.add(id, n); if (k) got.push(`+${k} ${ITEMS[id].name}`); }
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
    if (a === "craft") {
      if (id === "backpack" && s.count("hide") && s.count("skin")) {
        ui.ask("Backpack", "Which skin will you sew?", [{ id: "hide", label: "Deer hide" }, { id: "skin", label: "Tor's skin" }], (use) => { const m = s.craft("backpack", use); if (m) ui.toast(m, "good"); ui.renderPanel(); });
        return;
      }
      const m = s.craft(id);
      if (m) { ui.toast(m, "good"); this._log({ e: "craft", id }); }
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

  // ---------------- Waterfall Hollow ----------------
  onCaveLoaded(kind) {
    if (!this.active || kind !== "hollow") { this.hunter = null; return; }
    this.flags.enteredHollow = true;
    const env = this.env;
    // the dead hunter lies deep in the cave
    const spot = env.caveSpot(0.78);
    if (spot) {
      const b = makeBody({ pose: "curl", seed: 31 });
      b.position.set(spot.x, spot.y, spot.z); b.rotation.y = spot.yaw;
      if (this.flags.faceTaken) markFaceTaken(b);
      env.addCaveObject(b);
      this.hunter = { x: spot.x, z: spot.z, obj: b };
    }
    for (const g of this.glyphs) this._placeGlyph(g);
    if (!this.flags.ratKilled) env.ui.toast("Water drips somewhere ahead. Something scrapes on stone.");
    this._log({ e: "enterHollow" });
  }

  onMonsterKilled(m) {
    if (!this.active || m.kind !== "rat") return;
    this.flags.ratKilled = true;
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
      v: 1, kind, flags: { ...this.flags }, surv: this.surv.toJSON(), glyphs: this.glyphs.slice(),
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
    const prev = keep ? { faces: this.surv.faces, skills: new Set(this.surv.skills), str: this.surv.str, hpBonus: this.surv.hpBonus, glyphs: this.glyphs.slice(), flags: { ...this.flags } } : null;
    this.surv.fromJSON(snap.surv);
    this.flags = { ...snap.flags };
    this.glyphs = (snap.glyphs || []).slice();
    if (prev) {
      this.surv.faces = Math.max(this.surv.faces, prev.faces);
      for (const k of prev.skills) this.surv.skills.add(k);
      this.surv.str = Math.max(this.surv.str, prev.str); this.surv.hpBonus = Math.max(this.surv.hpBonus, prev.hpBonus);
      if (prev.glyphs.length > this.glyphs.length) this.glyphs = prev.glyphs;
      for (const k of ["faceTaken", "memory", "ratKilled", "ratHarvested", "enteredHollow"]) if (prev.flags[k]) this.flags[k] = true;
      this.surv.stamina = 100;
    }
    this.active = true;
    this._log({ e: "load", keep });
    return snap;
  }
}
