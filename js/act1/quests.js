/**
 * Round 16: the quest chain (Act I through the start of Act II) and town side quests, the named
 * people who give them, and the quest log state. Pure logic + a tiny NPC mesh builder; Story drives
 * it (talking, rewards) and the UI shows it through the Tasks button.
 *
 * Places are picked from the world, not hard-coded: "the town" is the city nearest the River-Tooth
 * camp, "the hold" the nearest walled village, "the camp" the nearest travellers' camp and "the
 * gallery" the cave mouth nearest the town (seed 20261111: Tako, Dunrin Hold, Kanatu Rest, Ash Gallery).
 */
import * as THREE from "three";
import { smoothTree } from "../realism.js";

/** People. look: tunic / hair colours; elder adds a staff and white hair. */
export const NPCS = {
  haska: { name: "Elder Haska", at: "town", spot: 0, look: { tunic: 0x7a3a26, hair: 0xd8d2c8, elder: true }, idle: "The lake remembers everyone who drank from it, Kra." },
  neka: { name: "Neka", at: "town", spot: 1, look: { tunic: 0x9b7b55, hair: 0x2a1a10 }, idle: "Mind the pot. It bites." },
  orrek: { name: "Warden Orrek", at: "hold", spot: 0, look: { tunic: 0x4e4436, hair: 0x3a2a1e, big: true }, idle: "The gate stays shut after dark. For everyone." },
  brannoc: { name: "Brannoc", at: "hold", spot: 1, look: { tunic: 0x6e5034, hair: 0x8a8a84, elder: true }, idle: "My hands ache before the snow does." },
  ashwalker: { name: "The Ash-Walker", at: "camp", spot: 0, look: { tunic: 0x2a2622, hair: 0x101010, faces: true }, idle: "Count your faces, River-Tooth. I count mine.", after: "m6" },
  mosi: { name: "Mosi", at: "camp", spot: 1, look: { tunic: 0x8c5a3c, hair: 0x3a2412 }, idle: "Birds fly low today. Rain, or worse." },
};

const L = (who, text) => ({ who, text });
/** Quest defs. objectives: [{ t, ok(S, q), at?(S) }]; turnIn: npc id (talk to finish) or null (auto). */
export const QUESTS = [
  { id: "m1", main: true, title: "The Empty Camp", giver: "lume", act: "Act I",
    // the Act I steps (Story.steps) are its objectives
    dynamic: true, reward: { sp: 1, xp: 60 } },
  { id: "m2", main: true, title: "Smoke to the West", req: ["m1"], auto: true, act: "Act I",
    intro: [L("", "From the ridge, Kra sees smoke on the wind: many fires, beside a lake. People. Living people.")],
    objectives: [{ t: "Travel to {town}", ok: (S) => S.near("town", 40), at: (S) => S.place("town") }],
    turnIn: "haska",
    outro: [L("Elder Haska", "A River-Tooth boy, alone, with a dead man's face tied over his own. So it is true. The mouths opened in the east."),
      L("Elder Haska", "Sit. Eat. And then prove to my hunters that you are not a ghost.")],
    reward: { sp: 1, xp: 40 } },
  { id: "m3", main: true, title: "Proof of the Hunt", req: ["m2"], giver: "haska", act: "Act I",
    intro: [L("Elder Haska", "Our hunters will not follow a stranger's word. Bring down two deer and bring me their hides."),
      L("Elder Haska", "Do that, and I will show you how we tip our arrows with bone.")],
    objectives: [{ t: "Bring down 2 deer", ok: (S, q) => S.surv.stats.deer - (q.base.deer || 0) >= 2 },
      { t: "Carry 2 deer hides", ok: (S) => S.surv.count("hide") >= 2 }],
    turnIn: "haska", take: [["hide", 2]],
    outro: [L("Elder Haska", "Clean cuts. You were taught well. Here: bone for the point, feathers for the flight.")],
    reward: { sp: 1, xp: 60, recipe: "arrows", items: [["bone", 2], ["feather", 2]] } },
  { id: "m4", main: true, title: "The Painted Hall", req: ["m3"], giver: "haska", act: "Act I",
    intro: [L("Elder Haska", "You ask what took your people. Go into our long hall. Our grandmothers painted the night it happened before, long ago."),
      L("Elder Haska", "Find the mouth on the wall. Look at it a long time.")],
    objectives: [{ t: "Enter {town}'s long hall", ok: (S, q) => !!q.flags.inHall, at: (S) => S.place("hall") },
      { t: "Find the painting of the open mouth", ok: (S, q) => !!q.flags.painting, at: (S) => S.place("hall") }],
    turnIn: "haska",
    outro: [L("Elder Haska", "You saw it. The mouth with too many teeth. It woke once before, and the old ones shut it with blood on stone."),
      L("Elder Haska", "Your people's dead were not wasted, Kra. Lume knew. Learn the old ways now; you will need all of them.")],
    reward: { sp: 1, xp: 60, card: ["The mouth on the wall", "It woke once before."] } },
  { id: "m5", main: true, title: "Throat of Ash", req: ["m4"], giver: "haska", act: "Act I",
    intro: [L("Elder Haska", "There is a cave near here, {cave}. Our flint came from it, until the scraping started."),
      L("Elder Haska", "Go deep. Bring back two pieces of its flint, and tell me what you hear.")],
    objectives: [{ t: "Enter {cave}", ok: (S, q) => !!q.flags.entered, at: (S) => S.place("cave") },
      { t: "Explore 20 passages inside", ok: (S, q) => (q.flags.explored || 0) >= 20 },
      { t: "Bring back 2 flint", ok: (S) => S.surv.count("flint") >= 2 }],
    turnIn: "haska",
    outro: [L("Elder Haska", "Breathing walls. Yes. It is spreading west."),
      L("Elder Haska", "Keep the flint: our knappers will show you how to bind a spear head with it.")],
    reward: { sp: 1, xp: 70, recipe: "flintspear", items: [["sinew", 1]] } },
  { id: "m6", main: true, title: "Word to {hold}", req: ["m5"], giver: "haska", act: "Act I",
    intro: [L("Elder Haska", "{hold} must know. Take this message stick to Warden Orrek. Its notches say: the mouths are waking. Shut your gates."),
      L("Elder Haska", "Go fast. Ride if you can.")],
    objectives: [{ t: "Carry Haska's message stick to {hold}", ok: (S) => S.near("hold", 30), at: (S) => S.place("hold") }],
    turnIn: "orrek",
    outro: [L("Warden Orrek", "Haska's notches. I know them."),
      L("Warden Orrek", "Then the stranger was telling the truth. A man in a coat of faces came through three nights ago, asking about River-Tooth."),
      L("Warden Orrek", "Here, a cloak pattern for your trouble. Hide and sinew; you will want it on the high trails.")],
    reward: { sp: 1, xp: 60, recipe: "cloak" } },
  { id: "m7", main: true, title: "The Hunter of Faces", req: ["m6"], giver: "orrek", act: "Act II",
    intro: [L("Warden Orrek", "He camps at {camp}. He calls himself the Ash-Walker. Go and see him, if you dare.")],
    objectives: [{ t: "Find the Ash-Walker at {camp}", ok: (S) => S.near("camp", 25), at: (S) => S.place("camp") }],
    turnIn: "ashwalker",
    outro: [L("The Ash-Walker", "River-Tooth. One face. Only one. You are young at this."),
      L("The Ash-Walker", "I wear eleven. Each one makes me stronger... and each one makes the caves sing louder when I pass."),
      L("The Ash-Walker", "Wear too many and you open yourself to the First Mouth. Remember that, when you are hungry for power."),
      L("", "The Ash-Walker smiles with someone else's lips. Act II begins.")],
    reward: { sp: 2, xp: 100, items: [["ochre", 2]], card: ["Act II", "Gathering Faces"] } },
  // ---- side quests ----
  { id: "s1", title: "Neka's Stew", giver: "neka", req: ["m2"],
    intro: [L("Neka", "Half the town to feed and the root-diggers are scared of the dark. Three roots and three handfuls of berries, hunter?")],
    objectives: [{ t: "Carry 3 roots", ok: (S) => S.surv.count("roots") >= 3 }, { t: "Carry 3 berries", ok: (S) => S.surv.count("berries") >= 3 }],
    turnIn: "neka", take: [["roots", 3], ["berries", 3]],
    outro: [L("Neka", "Good. Take a bowl. And these herbs: crushed in fat they close a wound.")],
    reward: { xp: 40, items: [["herbs", 2], ["cooked", 2]], recipe: "salve" } },
  { id: "s2", title: "Cold Hands", giver: "brannoc", req: [],
    intro: [L("Brannoc", "Three rabbit pelts. I'll show you how to sew a fur cap that keeps the cold out of your skull.")],
    objectives: [{ t: "Carry 3 rabbit pelts", ok: (S) => S.surv.count("pelt") >= 3 }],
    turnIn: "brannoc", take: [["pelt", 3]],
    outro: [L("Brannoc", "Fine pelts. Now watch my fingers: in, over, pull. You'll need sinew of your own.")],
    reward: { xp: 40, sp: 1, recipe: "hat", items: [["sinew", 1]] } },
  { id: "s3", title: "Feathers for Mosi", giver: "mosi", req: [],
    intro: [L("Mosi", "I fletch arrows for the whole valley and I've run out of feathers. Bring me four?")],
    objectives: [{ t: "Carry 4 feathers", ok: (S) => S.surv.count("feather") >= 4 }],
    turnIn: "mosi", take: [["feather", 4]],
    outro: [L("Mosi", "Ha! Here, bone for points. And a trick: crouch downwind, and they never hear you.")],
    reward: { xp: 50, items: [["bone", 3]] } },
];
export const QUEST = Object.fromEntries(QUESTS.map((q) => [q.id, q]));

/** Pick the story places + NPC spots for a world (null if it has no Act 1 camp / settlements). */
export function planPlaces(terrain) {
  const a = terrain.act1, S = terrain.settlements || [];
  if (!a || !S.length) return null;
  const c = a.camp, d = (p) => Math.hypot(p.x - c.x, p.z - c.z);
  const near = (kind) => S.filter((s) => s.kind === kind).sort((u, v) => d(u) - d(v))[0] || null;
  const town = near("city"), hold = near("village"), camp = near("camp");
  if (!town || !hold || !camp) return null;
  const caves = terrain.entrances.filter((e) => !e.hollow && e.cave !== "carlsbad").sort((u, v) => Math.hypot(u.x - town.x, u.z - town.z) - Math.hypot(v.x - town.x, v.z - town.z));
  const cave = caves[0] || null;
  const P = { town, hold, camp, cave, npc: {} };
  const free = (s, x, z, pad = 0.75) => {
    for (const k of s.colliders || []) {
      let cx = k.x, cz = k.z, t = k.r;
      if (k.seg) { const vx = k.bx - k.ax, vz = k.bz - k.az, L2 = vx * vx + vz * vz || 1, q = Math.max(0, Math.min(1, ((x - k.ax) * vx + (z - k.az) * vz) / L2)); cx = k.ax + vx * q; cz = k.az + vz * q; t = k.t; }
      if (Math.hypot(x - cx, z - cz) < t + pad) return false;
    }
    return true;
  };
  for (const [id, n] of Object.entries(NPCS)) {
    const s = P[n.at], f = s.fires[0] || s;
    let best = null;
    for (let i = 0; i < 24 && !best; i++) {
      const ang = n.spot * Math.PI + (i % 12) * 0.52 + 0.4, r = 2.4 + Math.floor(i / 12) * 1.4;
      const x = f.x + Math.cos(ang) * r, z = f.z + Math.sin(ang) * r;
      if (free(s, x, z)) best = { x, z };
    }
    best = best || { x: f.x + 3, z: f.z };
    P.npc[id] = { id, ...n, x: best.x, z: best.z, yaw: Math.atan2(best.x - f.x, best.z - f.z), s };
  }
  return P;
}

/** Fill {town} / {hold} / {camp} / {cave} with this world's names. */
export function fill(text, P) {
  if (!P) return text;
  return text.replace(/\{(town|hold|camp|cave)\}/g, (_, k) => (k === "cave" ? P.cave?.name || "the gallery" : P[k]?.name || k));
}

/** A small standing person (cheap: ~10 meshes, shared materials), plus a floating quest mark. */
const _mats = new Map();
const lam = (c) => { if (!_mats.has(c)) _mats.set(c, new THREE.MeshLambertMaterial({ color: c })); return _mats.get(c); };
export function makeNPC(look = {}) {
  const g = new THREE.Group(), skin = lam(0xb5835c), tun = lam(look.tunic || 0x7a5a3c), hair = lam(look.hair || 0x2a1a10);
  const s = look.big ? 1.08 : 1;
  const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
  add(new THREE.CylinderGeometry(0.21, 0.24, 0.66, 8), tun, 0, 1.12, 0).scale.z = 0.75;
  add(new THREE.CylinderGeometry(0.24, 0.3, 0.36, 8), lam(0x4a3626), 0, 0.72, 0);
  for (const sx of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.07, 0.055, 0.72, 6), skin, sx * 0.1, 0.36, 0);
    const arm = add(new THREE.CylinderGeometry(0.055, 0.045, 0.62, 6), skin, sx * 0.27, 1.12, 0); arm.rotation.z = sx * 0.12;
  }
  add(new THREE.SphereGeometry(0.15, 10, 8), skin, 0, 1.6, 0);
  add(new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, 1.7), hair, 0, 1.63, 0.03);
  if (look.elder) { const st = add(new THREE.CylinderGeometry(0.025, 0.03, 1.7, 5), lam(0x5a4028), 0.36, 0.85, -0.1); st.rotation.z = -0.06; }
  if (look.faces) for (let i = 0; i < 5; i++) { const f = add(new THREE.CircleGeometry(0.075, 7), lam(0xc8b090), -0.15 + (i % 3) * 0.15, 0.95 + Math.floor(i / 3) * 0.2, -0.165); f.rotation.y = Math.PI; }
  g.scale.setScalar(s);
  smoothTree(g);
  // quest mark: "!" offers a quest, "?" a quest ready to hand in
  const c = document.createElement("canvas"); c.width = 64; c.height = 64;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  mark.scale.set(0.55, 0.55, 1); mark.position.y = 2.25; mark.renderOrder = 6; mark.visible = false; g.add(mark);
  g.userData.setMark = (ch) => {
    if (g.userData.markCh === ch) return; g.userData.markCh = ch;
    mark.visible = !!ch; if (!ch) return;
    const x = c.getContext("2d"); x.clearRect(0, 0, 64, 64);
    x.font = "bold 54px Georgia, serif"; x.textAlign = "center"; x.textBaseline = "middle";
    x.lineWidth = 7; x.strokeStyle = "#1a0e04"; x.strokeText(ch, 32, 34); x.fillStyle = ch === "?" ? "#9fe3a8" : "#ffd36a"; x.fillText(ch, 32, 34);
    tex.needsUpdate = true;
  };
  return g;
}

/** Quest log state (saved with the game). */
export class QuestLog {
  constructor() { this.reset(); }
  reset() { this.st = {}; this.base = {}; this.flags = {}; this.tracked = null; this.order = []; }
  state(id) { return this.st[id] || null; }
  done(id) { return this.st[id] === "done"; }
  active() { return this.order.filter((id) => this.st[id] === "active"); }
  completed() { return this.order.filter((id) => this.st[id] === "done"); }
  start(id, stats) {
    if (this.st[id]) return false;
    this.st[id] = "active"; this.base[id] = { ...stats }; this.flags[id] = {}; this.order.push(id);
    if (!this.tracked || QUEST[id].main) this.tracked = id;
    return true;
  }
  finish(id) {
    this.st[id] = "done";
    if (this.tracked === id) this.tracked = this.active().find((q) => QUEST[q].main) || this.active()[0] || null;
  }
  ctx(id) { return { base: this.base[id] || {}, flags: this.flags[id] || (this.flags[id] = {}) }; }
  toJSON() { return { st: this.st, base: this.base, flags: this.flags, tracked: this.tracked, order: this.order }; }
  fromJSON(o) { this.reset(); if (!o) return this; Object.assign(this, { st: { ...o.st }, base: { ...o.base }, flags: JSON.parse(JSON.stringify(o.flags || {})), tracked: o.tracked || null, order: (o.order || []).slice() }); return this; }
}
