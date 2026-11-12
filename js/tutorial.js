/**
 * Round 24: the interactive tutorial. Five chapters (Basics, Survival, Combat, World, Empire), one small
 * step at a time: a spoken + subtitled line, the control for YOUR device (phone, keyboard & mouse,
 * gamepad), a pointing hand on the real button, and the step completes when you do it.
 * Skip step / Chapters / Exit at any time. Progress is its own save (fota-tutorial-v1).
 *
 * G (from main.js): dev(), feet(), look(), speed(), stance(), air(), stamina(), torchDown(), weapon(), count(item),
 * stats(), packOpen(tab), inspectOpen(), c (counters), mapOpen(), filtersSig(), hint(), beaconPos(), tasksOpen(),
 * horse(), boat(), mode(), colonies(), buildMode(), colonyOpen(), audioOpen(), controlsOpen(), hp()
 * + setups: toBerry(), toWater(), give(id, n), stalk(kind, d), toHorse(), toBoat(), toPerson(), toCave(), awayFromCamp(),
 *   toFoundSpot(), recruit(n), needs(h, t), say(text, onEnd), toast(t)
 */
const KEY = "fota-tutorial-v1";
const by = (o) => (dev) => o[dev] ?? o.desktop;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export const CHAPTERS = [
  { id: "basics", name: "Basics", icon: "🦶", steps: [
    { id: "move", title: "Walk", say: "Let's start with your feet. Walk a few steps.",
      how: by({ touch: "Drag the joystick (bottom left).", desktop: "W A S D (or the arrow keys).", pad: "Left stick." }), point: by({ touch: "#joystick" }),
      init: (G, s) => { s.p0 = G.feet(); }, check: (G, s) => dist(G.feet(), s.p0) > 3 },
    { id: "look", title: "Look around", say: "Now look around you.",
      how: by({ touch: "Drag on the right half of the screen.", desktop: "Click the view, then move the mouse.", pad: "Right stick." }), point: by({ touch: "@right" }),
      init: (G, s) => { s.y0 = G.look().yaw; s.p0 = G.look().pitch; }, check: (G, s) => angDiff(G.look().yaw, s.y0) > 0.9 || Math.abs(G.look().pitch - s.p0) > 0.5 },
    { id: "analog", title: "Slow or fast", say: "You choose your speed. Walk slowly, then go fast.",
      how: by({ touch: "Push the stick a little to walk, all the way to run.", desktop: "Press 1 to walk, 3 to run (2 is a jog).", pad: "Tilt the stick a little, then all the way." }), point: by({ touch: "#joystick" }),
      init: (G, s) => { s.slow = 0; s.fast = 0; },
      tick: (G, s, dt) => { const v = G.speed(); if (v > 0.4 && v < 2.9) s.slow += dt; if (v > 5.5) s.fast += dt; },
      check: (G, s) => s.slow > 0.8 && s.fast > 0.5 },
    { id: "sprint", title: "Sprint & stamina", say: "Sprint. Watch the yellow stamina bar: when it runs out, you have to slow down and breathe.",
      how: by({ touch: "Push the stick right to the edge and keep running.", desktop: "Hold Shift while you move.", pad: "Hold the right trigger." }), point: by({ touch: "#joystick", desktop: ".meters" }),
      check: (G) => G.stamina() < 80 },
    { id: "jump", title: "Jump", say: "Jump.", how: by({ touch: "Tap Jump.", desktop: "Space.", pad: "A." }), point: by({ touch: "#btn-jump" }),
      init: (G, s) => { s.n = G.c.jump || 0; }, check: (G, s) => (G.c.jump || 0) > s.n || G.air() },
    { id: "crouch", title: "Crouch", say: "Crouch down. Animals hear you less when you are low.", how: by({ touch: "Tap Crouch.", desktop: "C.", pad: "B." }), point: by({ touch: "#btn-crouch", desktop: "#btn-crouch" }),
      check: (G) => G.stance() === "crouch" },
    { id: "crawl", title: "Crawl", say: "Now crawl. In caves, some passages are only this high.", how: by({ touch: "Tap Crawl.", desktop: "Z (or Ctrl).", pad: "B again." }), point: by({ touch: "#btn-crawl", desktop: "#btn-crawl" }),
      check: (G) => G.stance() === "crawl" },
    { id: "stand", title: "Stand up", say: "And stand up again: from a crawl you rise to a crouch, then stand.", how: by({ touch: "Tap Crouch twice.", desktop: "C twice.", pad: "B." }), point: by({ touch: "#btn-crouch", desktop: "#btn-crouch" }),
      check: (G) => G.stance() === "stand" },
    { id: "torch", title: "Your torch", say: "Kra carries a torch. Lower it to hide in the dark, then raise it again.",
      how: by({ touch: "Tap 🔥 Torch, twice.", desktop: "L, twice.", pad: "RB, twice." }), point: by({ touch: "#btn-torch", desktop: "#btn-torch" }),
      init: (G, s) => { s.down = false; }, tick: (G, s) => { if (G.torchDown()) s.down = true; }, check: (G, s) => s.down && !G.torchDown() },
  ] },
  { id: "survival", name: "Survival", icon: "🍓", steps: [
    { id: "needs", title: "Hunger & thirst", say: "These bars are your hunger and thirst. They slowly drop. Here, nothing can kill you, so let's practise.",
      how: by({ touch: "The bars at the top left.", desktop: "The bars at the top left." }), point: by({ touch: ".meters", desktop: ".meters" }), info: true,
      setup: (G) => G.needs(45, 35) },
    { id: "berries", title: "Pick berries", say: "Walk to the berry bush in front of you and pick it.",
      how: by({ touch: "Walk close, then tap the action button.", desktop: "Walk close, then press E.", pad: "Walk close, then Y." }), point: by({ touch: ".act-btn" }),
      setup: (G) => G.toBerry(), init: (G, s) => { s.n = G.count("berries") + G.count("roots"); }, check: (G, s) => G.count("berries") + G.count("roots") > s.n },
    { id: "pack", title: "Your Pack", say: "Everything you pick up goes into your Pack. Open it.",
      how: by({ touch: "Tap 🎒 Pack.", desktop: "Press I.", pad: "Start." }), point: by({ touch: ".inv-btn", desktop: ".inv-btn" }),
      check: (G) => G.packOpen("inv") },
    { id: "inspect", title: "Inspect", say: "Tap an item in the Pack to look at it closely. Turn it with your finger or the mouse.",
      how: by({ touch: "Tap an item in the Pack.", desktop: "Click an item in the Pack." }), point: by({ touch: ".panel .slot[data-insp] i", desktop: ".panel .slot[data-insp] i" }),
      setup: (G) => { G.give("berries", 2); G.openPack(); }, check: (G) => G.inspectOpen() },
    { id: "eat", title: "Eat", say: "Now eat the berries.",
      how: by({ touch: "Tap Eat on the berries.", desktop: "Click Eat on the berries." }), point: by({ touch: ".panel .slot button[data-a=eat]", desktop: ".panel .slot button[data-a=eat]" }),
      setup: (G) => { G.give("berries", 1); G.closeInspect(); G.openPack(); }, init: (G, s) => { s.n = G.stats().ate; }, check: (G, s) => G.stats().ate > s.n },
    { id: "drink", title: "Drink", say: "Streams and creeks are your water. Walk to the water's edge and drink.",
      how: by({ touch: "At the edge, tap the action button: Drink.", desktop: "At the edge, press E: Drink.", pad: "Y at the edge." }), point: by({ touch: ".act-btn" }),
      setup: (G) => { G.closePanels(); G.toWater(); }, init: (G, s) => { s.n = G.stats().drank; }, check: (G, s) => G.stats().drank > s.n },
  ] },
  { id: "combat", name: "Combat", icon: "🗡", steps: [
    { id: "spear", title: "The spear", say: "Your spear is for close work. Stab.",
      how: by({ touch: "Tap Stab (bottom right).", desktop: "Left click (or F).", pad: "X." }), point: by({ touch: "#attack-btn" }),
      setup: (G) => G.weapon("spear"), init: (G, s) => { s.n = G.c.spear || 0; }, check: (G, s) => (G.c.spear || 0) > s.n },
    { id: "bow", title: "The bow", say: "Switch to the bow, and shoot an arrow.",
      how: by({ touch: "Tap Bow, then Shoot.", desktop: "Q, then left click.", pad: "LB, then X." }), point: by({ touch: "#btn-weapon", desktop: "#btn-weapon" }),
      init: (G, s) => { s.n = G.c.bow || 0; }, check: (G, s) => (G.c.bow || 0) > s.n },
    { id: "hunt", title: "Hunt", say: "A deer, right in front of you. Crouch, creep closer, and strike. A hit from behind is the surest.",
      how: by({ touch: "Crouch, walk up slowly, tap Stab (or shoot).", desktop: "C to crouch, walk up, click to stab.", pad: "B to crouch, walk up, X." }), point: by({ touch: "#attack-btn" }),
      setup: (G) => { G.weapon("spear"); G.stalk("deer", 1.7); }, init: (G, s) => { s.n = G.kills(); s.re = 0; },
      tick: (G, s, dt) => { if ((s.re += dt) > 25 && G.kills() === s.n) { s.re = 0; G.stalk("deer", 1.4); G.toast("Here's another one. Get in close."); } },
      check: (G, s) => G.kills() > s.n },
    { id: "skin", title: "Skin it", say: "Thank the animal, and take what it gives: meat, hide, bone and sinew.",
      how: by({ touch: "Stand by it, tap Harvest.", desktop: "Stand by it, press E.", pad: "Y." }), point: by({ touch: ".act-btn" }),
      setup: (G) => G.toCarcass(), init: (G, s) => { s.n = G.c.harvest || 0; }, check: (G, s) => (G.c.harvest || 0) > s.n },
    { id: "craft", title: "Crafting", say: "Bone and sinew make tools. Open Crafting and make something.",
      how: by({ touch: "🎒 Pack → Crafting → pick a recipe.", desktop: "Tab → pick a recipe.", pad: "Start → Crafting." }), point: by({ touch: ".inv-btn", desktop: ".inv-btn" }),
      setup: (G) => { G.give("bone", 2); G.give("sinew", 2); G.give("herbs", 2); G.give("berries", 1); }, init: (G, s) => { s.n = G.c.craft || 0; }, check: (G, s) => (G.c.craft || 0) > s.n },
  ] },
  { id: "world", name: "World", icon: "🗺", steps: [
    { id: "minimap", title: "The map", say: "The little map shows what's around you. Open the big map.",
      how: by({ touch: "Tap the minimap.", desktop: "Press M.", pad: "Back." }), point: by({ touch: "#minimap", desktop: "#minimap" }),
      setup: (G) => G.closePanels(), check: (G) => G.mapOpen() },
    { id: "filters", title: "Map filters", say: "Choose what the map shows: open the filters and switch something off or on.",
      how: by({ touch: "Tap ⚙ on the map.", desktop: "Click ⚙ on the map." }), point: by({ touch: ".wm-f", desktop: ".wm-f" }),
      setup: (G) => G.openMap(), init: (G, s) => { s.f = G.filtersSig(); }, check: (G, s) => G.filtersSig() !== s.f },
    { id: "hint", title: "Hint", say: "Lost? The hint button marks where to go next.", how: by({ touch: "Tap 💡 Hint.", desktop: "Click 💡 Hint." }), point: by({ touch: ".wm-hint", desktop: ".wm-hint" }),
      setup: (G) => G.openMap(), init: (G, s) => { s.h = G.hint(); }, check: (G, s) => G.hint() && G.hint() !== s.h },
    { id: "beacon", title: "Beacon", say: "Tap anywhere on the map and set a beacon. A pillar of light will guide you there.",
      how: by({ touch: "Tap the map → Set beacon here.", desktop: "Click the map → Set beacon here." }), point: by({ touch: ".worldmap canvas", desktop: ".worldmap canvas" }),
      setup: (G) => G.openMap(), check: (G) => !!G.beaconPos() },
    { id: "travel", title: "Fast travel", say: "Places you have found can be reached in a blink. Tap the camp on the map, and travel there.",
      how: by({ touch: "Tap Camp → Travel.", desktop: "Click Camp → Travel." }), point: by({ touch: ".worldmap canvas", desktop: ".worldmap canvas" }),
      setup: (G) => { G.closePanels(); G.awayFromCamp(); setTimeout(() => G.openMap(), 900); }, init: (G, s) => { s.n = G.c.ft || 0; }, check: (G, s) => (G.c.ft || 0) > s.n },
    { id: "tasks", title: "Tasks", say: "Your Tasks are the quest log: what to do next, and what's done.", how: by({ touch: "Tap 📜 Tasks.", desktop: "Press J (or click 📜 Tasks) to fold or unfold it.", pad: "D-pad up." }), point: by({ touch: ".tasks-btn", desktop: ".tasks-btn" }),
      setup: (G) => { G.closePanels(); G.showTasks(true); }, done: (G) => G.showTasks(false), init: (G, s) => { s.n = G.c.tasks || 0; }, check: (G, s) => (G.c.tasks || 0) > s.n },
    { id: "talk", title: "Talk to people", say: "People live in this land. Walk up to someone and talk.",
      how: by({ touch: "Walk close, tap Talk.", desktop: "Walk close, press E.", pad: "Y." }), point: by({ touch: ".act-btn" }),
      setup: (G) => { G.closePanels(); G.toPerson(); }, done: (G) => setTimeout(() => G.closePanels(), 900), init: (G, s) => { s.n = G.c.talk || 0; }, check: (G, s) => (G.c.talk || 0) > s.n },
    { id: "horse", title: "Ride a horse", say: "A wild horse. Walk up to it and get on.",
      how: by({ touch: "Tap Ride.", desktop: "E next to it.", pad: "Y." }), point: by({ touch: "#btn-mount", desktop: "#btn-mount" }),
      setup: (G) => { G.closePanels(); G.toHorse(); }, check: (G) => G.horse() },
    { id: "boat", title: "Take a boat", say: "Get off the horse. There's a boat on the water: climb in and paddle a little way.",
      how: by({ touch: "Ride (to get off) → Board → stick up to paddle.", desktop: "E to get off, E to board, W to paddle.", pad: "Y, then the left stick." }), point: by({ touch: "#btn-mount", desktop: "#btn-mount" }),
      setup: (G) => { G.closePanels(); G.dismount(); G.toBoat(); }, init: (G, s) => { s.p = null; }, tick: (G, s) => { if (G.boat() && !s.p) s.p = G.feet(); },
      check: (G, s) => G.boat() && s.p && dist(G.feet(), s.p) > 6 },
    { id: "cave", title: "Caves", say: "Get out of the boat. Here is a cave mouth: walk in. Caves are dark: keep your torch up.",
      how: by({ touch: "Walk into the dark opening.", desktop: "Walk into the dark opening.", pad: "Walk in." }), point: by({}),
      setup: (G) => { G.closePanels(); G.leaveBoat(); G.toCave(); }, check: (G) => G.mode() === "cave" },
    { id: "exitcave", title: "Leave a cave", say: "Deep in a cave, you don't have to walk all the way back. Use the Exit cave button.",
      how: by({ touch: "Tap ⤴ Exit cave, then Climb out.", desktop: "Click ⤴ Exit cave, then Climb out." }), point: by({ touch: "#exit-cave-btn", desktop: "#exit-cave-btn" }),
      check: (G) => G.mode() === "overworld" },
  ] },
  { id: "empire", name: "Empire", icon: "🏛", steps: [
    { id: "found", title: "Found a settlement", say: "One day, you will lead your own people. Found a settlement here.",
      how: by({ touch: "Tap Found 🏛.", desktop: "Click Found 🏛.", pad: "Tap Found 🏛." }), point: by({ touch: "#btn-colony", desktop: "#btn-colony" }),
      setup: (G) => { G.closePanels(); G.toFoundSpot(); }, check: (G) => G.colonies() > 0 },
    { id: "build", title: "Build", say: "Your town button opens the town. Choose Build, and pick something to put up.",
      how: by({ touch: "Town 🏘 → Build.", desktop: "Town 🏘 → Build." }), point: by({ touch: "#btn-colony", desktop: "#btn-colony" }),
      check: (G) => G.buildMode() },
    { id: "jobs", title: "Jobs", say: "Two people have joined you. Give one of them a job.",
      how: by({ touch: "Town 🏘 → People → pick a job.", desktop: "Town 🏘 → People → pick a job." }), point: by({ touch: "#colony-panel select, #btn-colony", desktop: "#colony-panel select, #btn-colony" }),
      setup: (G) => { G.stopBuild(); G.recruit(2); G.openTown(); }, init: (G, s) => { s.n = G.c.jobs || 0; }, check: (G, s) => (G.c.jobs || 0) > s.n },
    { id: "shrooms", title: "Glowing mushrooms", say: "Glowing mushrooms bring visions, and the spirits teach new ideas. The colours can be strong: there is a Calm visuals switch.",
      how: by({ touch: "Eat one from the Pack when you find it. Calm visuals: the 🍄 button during a vision.", desktop: "Eat one from the Pack when you find it. Calm visuals: the 🍄 button during a vision." }), info: true, setup: (G) => G.closePanels() },
    { id: "mp", title: "Play with friends", say: "You can play with friends: open Multiplayer in the menu, make a room, share the link. Hold to talk with voice.",
      how: by({ touch: "☰ → Multiplayer. Hold 🎙 to talk.", desktop: "☰ → Multiplayer. Hold V to talk." }), point: by({ touch: "#menu-btn", desktop: "#menu-btn" }), info: true },
    { id: "audio", title: "Sound", say: "Too loud? Too quiet? Open Audio and set the volumes.",
      how: by({ touch: "☰ → Audio.", desktop: "☰ → Audio." }), point: by({ touch: "#menu-btn", desktop: "#menu-btn" }), check: (G) => G.audioOpen() },
    { id: "controls", title: "All the controls", say: "And whenever you forget a control, it's all in one place: Controls.",
      how: by({ touch: "☰ → Controls.", desktop: "☰ → Controls." }), point: by({ touch: "#menu-btn", desktop: "#menu-btn" }), setup: (G) => G.closeAudio(), check: (G) => G.controlsOpen() },
  ] },
];

export class Tutorial {
  constructor(root, G) {
    this.G = G; this.on = false; this.ci = 0; this.si = 0; this.s = {}; this.log = [];
    try { this.save = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { this.save = {}; }
    this.save.done ||= {}; this.save.ch ||= {};
    const el = (this.el = document.createElement("div")); el.id = "tut"; el.className = "hidden";
    el.innerHTML = `<div class="tu-card"><div class="tu-top"><span class="tu-ch"></span><span class="tu-dots"></span></div><h3></h3><p class="tu-say"></p><p class="tu-how"></p>
      <div class="tu-btns"><button type="button" data-a="ok" class="tu-ok hidden">Got it ✓</button><button type="button" data-a="skip">Skip step</button><button type="button" data-a="chapters">Chapters</button><button type="button" data-a="exit">Exit tutorial</button></div></div>
      <div class="tu-done hidden">✓ Nice!</div><div class="tu-hand hidden">👆</div><div class="tu-menu hidden"></div>`;
    root.appendChild(el);
    for (const e of ["pointerdown", "touchstart", "mousedown"]) el.querySelector(".tu-card").addEventListener(e, (ev) => ev.stopPropagation(), { passive: true });
    for (const e of ["pointerdown", "touchstart", "mousedown"]) el.querySelector(".tu-menu").addEventListener(e, (ev) => ev.stopPropagation(), { passive: true });
    el.addEventListener("click", (ev) => {
      const a = ev.target.closest("[data-a]")?.dataset.a, ch = ev.target.closest("[data-ch]")?.dataset.ch;
      if (!a && ch == null) return; ev.stopPropagation();
      if (ch != null) { this.menu(false); this.go(+ch, 0); }
      else if (a === "ok") this.complete();
      else if (a === "skip") this.skip();
      else if (a === "chapters") this.menu(true);
      else if (a === "exit") this.G.exit();
      else if (a === "next") { this.menu(false); this.go(this.ci + 1, 0); }
      else if (a === "close") this.menu(false);
    });
    this.hand = el.querySelector(".tu-hand");
  }
  get step() { return CHAPTERS[this.ci]?.steps[this.si] || null; }
  start(ci = 0) { this.on = true; this.el.classList.remove("hidden"); this.go(ci, 0); }
  stop() { this.on = false; this.el.classList.add("hidden"); this.G.say?.(""); }
  go(ci, si) {
    if (ci >= CHAPTERS.length) return this.finished();
    this.ci = ci; this.si = si; this.s = {}; this.wait = 0; this._done = false; this.menu(false);
    const st = this.step, ch = CHAPTERS[ci], dev = this.G.dev();
    this.save.last = { ch: ci, step: si }; this._persist();
    this.el.querySelector(".tu-ch").textContent = `${ch.icon} ${ch.name} · ${si + 1}/${ch.steps.length}`;
    this.el.querySelector(".tu-dots").innerHTML = CHAPTERS.map((c, i) => `<i class="${i === ci ? "on" : this.save.ch[c.id] ? "ok" : ""}"></i>`).join("");
    this.el.querySelector("h3").textContent = st.title;
    this.el.querySelector(".tu-say").textContent = st.say;
    this.el.querySelector(".tu-how").innerHTML = `<b>${dev === "touch" ? "📱" : dev === "pad" ? "🎮" : "⌨️"}</b> ${st.how(dev)}`;
    this.el.querySelector(".tu-ok").classList.toggle("hidden", !st.info);
    this.el.querySelector(".tu-done").classList.add("hidden");
    this.log.push({ e: "step", id: st.id });
    try { st.setup?.(this.G); } catch (err) { console.warn("tutorial setup", st.id, err); }
    try { st.init?.(this.G, this.s); } catch (err) { console.warn("tutorial init", st.id, err); }
    this.G.say?.(st.say);
    this.wait = 0.6; // let a teleport settle before the baseline
  }
  complete(skipped = false) {
    if (this._done) return; this._done = true;
    const st = this.step, ch = CHAPTERS[this.ci];
    if (!skipped) this.save.done[st.id] = 1;
    try { st.done?.(this.G); } catch {}
    this.log.push({ e: skipped ? "skip" : "done", id: st.id });
    const last = this.si + 1 >= ch.steps.length;
    if (last) { if (ch.steps.every((x) => this.save.done[x.id])) this.save.ch[ch.id] = 1; else if (!skipped) this.save.ch[ch.id] = this.save.ch[ch.id] || 0.5; }
    this._persist();
    const d = this.el.querySelector(".tu-done"); d.textContent = skipped ? "Skipped" : "✓ Nice!"; d.classList.remove("hidden");
    this.G.sfx?.(skipped ? "" : "ok");
    setTimeout(() => { if (!this.on) return; if (last) this.chapterDone(); else this.go(this.ci, this.si + 1); }, skipped ? 350 : 1100);
  }
  skip() { if (this.on) this.complete(true); }
  chapterDone() {
    const ch = CHAPTERS[this.ci], nx = CHAPTERS[this.ci + 1];
    this.log.push({ e: "chapter", id: ch.id });
    this.G.say?.(nx ? `${ch.name}: done. Next: ${nx.name}.` : "That's everything. Go and live it.");
    this.menu(true, `${ch.icon} ${ch.name}: complete!`, !!nx);
    if (!nx) this.save.allDone = 1, this._persist();
  }
  finished() { this.menu(true, "🎉 Tutorial complete!", false); }
  menu(on, head = "Chapters", next = false) {
    const m = this.el.querySelector(".tu-menu");
    if (!on) { m.classList.add("hidden"); return; }
    m.innerHTML = `<div class="tu-mbox"><h3>${head}</h3>${CHAPTERS.map((c, i) => `<button type="button" data-ch="${i}" class="${this.save.ch[c.id] === 1 ? "ok" : ""}">${c.icon} ${c.name} ${this.save.ch[c.id] === 1 ? "✓" : `<small>${c.steps.length} steps</small>`}</button>`).join("")}
      <div class="tu-mrow">${next ? `<button type="button" data-a="next" class="tu-ok">Next chapter ▶</button>` : ""}${head === "Chapters" ? `<button type="button" data-a="close">Back</button>` : ""}<button type="button" data-a="exit">Exit tutorial</button></div></div>`;
    m.classList.remove("hidden");
  }
  _persist() { try { localStorage.setItem(KEY, JSON.stringify(this.save)); } catch {} }
  /** Per frame. */
  update(dt) {
    if (!this.on) return;
    const st = this.step; if (!st) return;
    this.el.classList.toggle("low", !!this.G.panelsOpen?.());
    this._hand(st);
    if (this._done || !this.el.querySelector(".tu-menu").classList.contains("hidden")) return;
    if (this.wait > 0) { this.wait -= dt; if (this.wait <= 0 && st.reinit) try { st.init?.(this.G, this.s); } catch (e) { console.warn(e); } return; }
    try { st.tick?.(this.G, this.s, dt); if (st.check && st.check(this.G, this.s)) this.complete(); } catch (e) { console.warn("tutorial check", st.id, e); }
  }
  _hand(st) {
    const sel = st.point?.(this.G.dev()), h = this.hand;
    let r = null;
    if (sel === "@right") { const W = innerWidth, H = innerHeight; r = { left: W * 0.62, top: H * 0.45, width: 60, height: 60, swipe: true }; }
    else if (sel) for (const s of sel.split(",")) { const e = document.querySelector(s.trim()); if (e && e.offsetParent !== null) { const q = e.getBoundingClientRect(); if (q.width > 2 && getComputedStyle(e).visibility !== "hidden") { r = q; break; } } }
    const card = this.el.querySelector(".tu-card");
    if (r && !r.swipe && !this.el.classList.contains("low")) { // the card must never cover the button it points at
      let c = card.getBoundingClientRect(); if (!this.el.classList.contains("avoid")) this._home = c; else c = this._home || c;
      const hit = r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top;
      if (hit !== this.el.classList.contains("avoid")) this.el.classList.toggle("avoid", hit);
    } else if (!r || this.el.classList.contains("low")) this.el.classList.remove("avoid");
    if (!r || this._done) { h.classList.add("hidden"); return; }
    const root = this.el.getBoundingClientRect();
    h.classList.remove("hidden"); h.classList.toggle("swipe", !!r.swipe);
    h.style.left = `${r.left - root.left + r.width / 2 - 14}px`; h.style.top = `${r.top - root.top + r.height / 2 + 4}px`;
  }
}
