/**
 * Round 28a: the full-screen Character menu (👤 Kra on the rail, ☰ → Character, I / Tab / K on desktop).
 * Phone-first (390 x 844): tabs along the top with an icon and a word each.
 *  - Equipment: a live 3D Kra (drag to turn) wearing what is in his slots (head, face, back, weapon,
 *    body / face suit, offhand / torch, feet, two trinkets). Tap an item then a slot (or a slot then an
 *    item); on desktop you can also drag an item onto a slot.
 *  - Inventory: every item, with Eat / Use, Equip, Inspect, Sell (at a trader or a friendly town, paid in
 *    that age's money) and Discard (asks first; the item drops at your feet and can be picked back up).
 *  - Skills (level, XP, the tree, and how far / bright the torch burns), Stats, Quests and Map.
 */
import * as THREE from "three";
import { ITEMS, SLOTS, slotsFor, GEAR, TREE, SKILLS, MONEY } from "./survival.js";
import { Caveman } from "../caveman.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const TABS = [["equip", "🛡️", "Equip"], ["items", "🎒", "Items"], ["skills", "✋", "Skills"], ["stats", "📊", "Stats"], ["quests", "📜", "Quests"], ["map", "🗺️", "Map"]];
const VIRTUAL = { facesuit: { name: "Face suit", icon: "🎭" }, torch: { name: "Torch", icon: "🔥" } };
export function itemName(id) { return ITEMS[id]?.name || GEAR[id] || VIRTUAL[id]?.name || id; }
export function itemIcon(id) { return ITEMS[id]?.icon || { boots: "🥾", cloak: "🧥", hat: "🧢", paint: "🖍️" }[id] || VIRTUAL[id]?.icon || "•"; }

export class CharMenu {
  /** env: { surv(), changed(), gear(surv) -> Set, sellCtx() -> {ok, age, where, why}, sell(id, n), discard(id, n), act(a, id), inspect(id),
   *         quests() -> {active:[{title, act}], done:[...]}, openTasks(), openMap(), openCraft(), mapImage() -> canvas|null, stats() -> {...}, learn(id), questDone(q) } */
  constructor(root, env, { touch = false } = {}) {
    this.env = env; this.touch = touch; this.tab = "equip"; this.isOpen = false; this.sel = null; this.slotSel = null; this.itemSel = null; this.confirm = null;
    const el = (this.el = document.createElement("div"));
    el.className = "cm hidden"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Character");
    el.innerHTML = `<div class="cm-top"><b class="cm-title">Kra</b><span class="cm-sub"></span><button class="cm-craft" type="button" title="Crafting">⚒️ <span>Craft</span></button><button class="cm-x" type="button" aria-label="Close">✕</button></div>
      <div class="cm-tabs">${TABS.map(([id, ic, w]) => `<button type="button" data-tab="${id}"><span class="ic">${ic}</span><span class="w">${w}</span></button>`).join("")}</div>
      <div class="cm-body"></div><div class="cm-msg" aria-live="polite"></div>`;
    root.appendChild(el);
    for (const e of ["pointerdown", "click", "touchstart", "wheel", "keydown"]) el.addEventListener(e, (ev) => ev.stopPropagation(), { passive: true });
    el.querySelector(".cm-x").addEventListener("click", () => this.close());
    el.querySelector(".cm-craft").addEventListener("click", () => { this.close(); env.openCraft?.(); });
    el.querySelectorAll(".cm-tabs button").forEach((b) => b.addEventListener("click", () => this.show(b.dataset.tab)));
    this.body = el.querySelector(".cm-body"); this.msgEl = el.querySelector(".cm-msg");
    this.body.addEventListener("click", (ev) => this._click(ev));
    // desktop drag: an item onto a slot
    this.body.addEventListener("dragstart", (ev) => { const it = ev.target.closest?.("[data-item]"); if (it) { ev.dataTransfer.setData("text/plain", it.dataset.item); this.sel = it.dataset.item; } });
    this.body.addEventListener("dragover", (ev) => { if (ev.target.closest?.("[data-slot]")) ev.preventDefault(); });
    this.body.addEventListener("drop", (ev) => { const sl = ev.target.closest?.("[data-slot]"); if (!sl) return; ev.preventDefault(); const id = ev.dataTransfer.getData("text/plain"); if (id) this.equip(id, sl.dataset.slot); });
  }
  open(tab = this.tab) { this.isOpen = true; this.el.classList.remove("hidden"); document.body.classList.add("cm-on"); this.sel = this.slotSel = this.itemSel = this.confirm = null; this.show(tab); }
  close() { this.isOpen = false; this.el.classList.add("hidden"); document.body.classList.remove("cm-on"); this._stop3d(); this.env.onClose?.(); }
  toggle(tab) { if (this.isOpen && (!tab || tab === this.tab)) this.close(); else this.open(tab); }
  show(tab) {
    this.tab = tab; this.confirm = null;
    this.el.querySelectorAll(".cm-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    this.render();
  }
  say(t, kind = "") { this.msgEl.textContent = t || ""; this.msgEl.className = "cm-msg" + (t ? " on " + kind : ""); clearTimeout(this._mt); if (t) this._mt = setTimeout(() => (this.msgEl.className = "cm-msg"), 2600); }

  // ---------- actions ----------
  equip(id, slot) {
    const s = this.env.surv(), r = s.equipItem(id, slot);
    if (!r) { this.say(`${itemName(id)} doesn't go there.`, "bad"); return false; }
    this.sel = this.slotSel = null; this.env.changed(); this.say(r, "good"); this.render(); return true;
  }
  unequip(slot) {
    const s = this.env.surv(), id = s.equip[slot];
    if (!s.unequip(slot)) { this.say("No room in your pack to take that off.", "bad"); return false; }
    s.syncEquip?.(); this.slotSel = null; this.env.changed(); this.say(`Took off the ${itemName(id).toLowerCase()}.`); this.render(); return true;
  }
  /** Things that could go into slots: pack items, owned garments not worn, the face suit, the torch. */
  candidates(slot = null) {
    const s = this.env.surv(), out = [], seen = new Set();
    for (const it of s.inv) if (slotsFor(it.id).length && !seen.has(it.id)) { seen.add(it.id); out.push(it.id); }
    for (const g of Object.keys(GEAR)) if (s.crafted.has(g) && !s.wear.has(g)) out.push(g);
    if (s.faces && s.equip.body !== "facesuit") out.push("facesuit");
    if (s.equip.offhand !== "torch") out.push("torch");
    return slot ? out.filter((id) => slotsFor(id).includes(slot)) : out;
  }
  _click(ev) {
    const t = ev.target.closest?.("button, [data-slot], [data-item], [data-inv]"); if (!t) return;
    const s = this.env.surv();
    if (t.dataset.slot) {
      const sl = t.dataset.slot;
      if (this.sel) { if (slotsFor(this.sel).includes(sl)) this.equip(this.sel, sl); else { this.say(`${itemName(this.sel)} doesn't go in ${SLOTS.find((q) => q.id === sl).name.toLowerCase()}.`, "bad"); } return; }
      this.slotSel = this.slotSel === sl ? null : sl; this.render(); return;
    }
    if (t.dataset.item) { // a candidate in the Equipment tab
      const id = t.dataset.item;
      if (this.slotSel && slotsFor(id).includes(this.slotSel)) { this.equip(id, this.slotSel); return; }
      this.sel = this.sel === id ? null : id; this.slotSel = null; this.render(); return;
    }
    if (t.dataset.inv != null) { this.itemSel = this.itemSel === +t.dataset.inv ? null : +t.dataset.inv; this.confirm = null; this.render(); return; }
    const a = t.dataset.a, id = t.dataset.id;
    if (!a) return;
    if (a === "unequip") this.unequip(id);
    else if (a === "inspect") this.env.inspect?.(id);
    else if (a === "learn") { this.env.learn?.(id); this.render(); }
    else if (a === "eat" || a === "use" || a === "eatm" || a === "shroom") { this.env.act?.(a, id); this.itemSel = null; this.render(); }
    else if (a === "toequip") { this.sel = id; this.show("equip"); this.say(`Now tap a slot for the ${itemName(id).toLowerCase()}.`); }
    else if (a === "sell" || a === "sellall") {
      const it = s.inv[this.itemSel]; if (!it) return;
      const r = this.env.sell(it.id, a === "sellall" ? s.count(it.id) : 1);
      this.say(r.msg, r.ok ? "good" : "bad"); if (!s.inv[this.itemSel] || s.inv[this.itemSel].id !== it.id) this.itemSel = null; this.render();
    } else if (a === "discard") { this.confirm = { id, n: +t.dataset.n || 1 }; this.render(); }
    else if (a === "discardyes") {
      const c = this.confirm; this.confirm = null; if (!c) return;
      const r = this.env.discard(c.id, c.n); this.say(r.msg, r.ok ? "" : "bad"); this.itemSel = null; this.render();
    } else if (a === "discardno") { this.confirm = null; this.render(); }
    else if (a === "tasks") { this.close(); this.env.openTasks?.(); }
    else if (a === "map") { this.close(); this.env.openMap?.(); }
  }

  // ---------- render ----------
  render() {
    if (!this.isOpen) return;
    const s = this.env.surv(); if (!s) return;
    this.el.querySelector(".cm-sub").textContent = `Level ${s.level} · ${s.xp % 100}/100 XP${s.sp ? ` · ${s.sp} point${s.sp > 1 ? "s" : ""} to spend` : ""}`;
    this.el.dataset.tab = this.tab;
    if (this.tab !== "equip") this._stop3d();
    this.body.innerHTML = this["_" + this.tab]?.(s) ?? "";
    if (this.tab === "equip") this._start3d();
    if (this.tab === "map") { const c = this.env.mapImage?.(), box = this.body.querySelector(".cm-mapprev"); if (c && box) { const cv = document.createElement("canvas"); cv.width = cv.height = 320; cv.getContext("2d").drawImage(c, 0, 0, 320, 320); box.appendChild(cv); } }
  }
  _slotHTML(s, q) {
    const id = s.equip[q.id], fits = this.sel ? slotsFor(this.sel).includes(q.id) : false;
    return `<button type="button" class="cm-slot${id ? " full" : ""}${fits ? " fits" : ""}${this.slotSel === q.id ? " sel" : ""}" data-slot="${q.id}" aria-label="${q.name}${id ? ": " + esc(itemName(id)) : ""}">
      <span class="ic">${id ? itemIcon(id) : `<em>${q.icon}</em>`}</span><span class="w">${id ? esc(itemName(id)) : q.name}</span></button>`;
  }
  _equip(s) {
    const left = ["head", "face", "back", "trinket1"], right = ["weapon", "body", "offhand", "feet", "trinket2"];
    const by = (id) => SLOTS.find((q) => q.id === id);
    const cand = this.candidates(this.slotSel);
    const st = this.env.stats?.() || {};
    let h = `<div class="cm-eq"><div class="cm-col">${left.map((id) => this._slotHTML(s, by(id))).join("")}</div>
      <div class="cm-prev"><canvas class="cm-3d" aria-label="Kra (drag to turn)"></canvas><div class="cm-prev-cap">❤ ${st.hearts ?? "?"} · 🛡 ${st.armor ?? 0}% · 🗡 ${st.dmg ?? 1}</div></div>
      <div class="cm-col">${right.map((id) => this._slotHTML(s, by(id))).join("")}</div></div>`;
    if (this.slotSel) {
      const id = s.equip[this.slotSel], q = by(this.slotSel);
      h += `<div class="cm-slotbar"><b>${q.name}</b>${id ? ` <span>${esc(itemName(id))}</span> <button type="button" data-a="unequip" data-id="${q.id}">✋ Take off</button>${ITEMS[id] ? ` <button type="button" data-a="inspect" data-id="${id}">ⓘ Inspect</button>` : ""}` : " <span>empty</span>"}</div>`;
    }
    h += `<div class="cm-h">${this.slotSel ? `Fits ${by(this.slotSel).name.toLowerCase()}` : this.sel ? `Tap a glowing slot for the ${esc(itemName(this.sel).toLowerCase())}` : this.touch ? "Tap an item, then a slot" : "Click an item then a slot, or drag it onto a slot"}</div>`;
    h += cand.length ? `<div class="cm-cands">${cand.map((id) => `<button type="button" class="cm-cand${this.sel === id ? " sel" : ""}" data-item="${id}" draggable="true"><span class="ic">${itemIcon(id)}</span><span class="w">${esc(itemName(id))}</span><small>${slotsFor(id).map((q) => by(q).name).filter((v, i, a) => a.indexOf(v) === i).join(" / ")}</small></button>`).join("")}</div>`
      : `<div class="cm-tip">${this.slotSel ? "Nothing you carry fits here." : "Nothing more to wear. Weapons, armour, trinkets and crafted clothing show up here."}</div>`;
    return h;
  }
  _items(s) {
    const sc = this.env.sellCtx?.() || { ok: false, why: "" };
    let h = `<div class="cm-h">${s.inv.length} / ${s.slots} slots · ${sc.ok ? `🪙 Trading at ${esc(sc.where)} (${esc(ITEMS[MONEY[sc.age]].name.toLowerCase())})` : `<span class="dim">${esc(sc.why || "Sell at a trader or a friendly town")}</span>`}</div><div class="cm-grid">`;
    for (let i = 0; i < s.slots; i++) {
      const it = s.inv[i];
      if (!it) { h += `<div class="cm-cell empty"></div>`; continue; }
      h += `<button type="button" class="cm-cell${this.itemSel === i ? " sel" : ""}" data-inv="${i}" aria-label="${esc(itemName(it.id))} ×${it.n}"><span class="ic">${itemIcon(it.id)}</span><span class="w">${esc(itemName(it.id))}</span><em>×${it.n}</em></button>`;
    }
    h += `</div>`;
    const it = s.inv[this.itemSel];
    if (it) {
      const d = ITEMS[it.id], [m, p] = s.price(it.id, sc.age || 0), mi = ITEMS[m];
      const use = it.id === "shroom" ? ["shroom", "🍄 Eat"] : d.food ? ["eat", "🍖 Eat"] : it.id === "morgan" ? ["eatm", "✶ Eat"] : d.heal ? ["use", "🩹 Use"] : null;
      h += `<div class="cm-act"><div class="cm-act-h"><span class="ic">${itemIcon(it.id)}</span><b>${esc(d.name)}</b> ×${it.n}${p ? ` <small>worth ${p} ${mi.icon} each</small>` : d.money ? " <small>money</small>" : " <small>not for sale</small>"}</div><div class="cm-act-b">`
        + (use ? `<button type="button" data-a="${use[0]}" data-id="${it.id}">${use[1]}</button>` : "")
        + (slotsFor(it.id).length ? `<button type="button" data-a="toequip" data-id="${it.id}">🛡️ Equip</button>` : "")
        + `<button type="button" data-a="inspect" data-id="${it.id}">ⓘ Inspect</button>`
        + (p ? `<button type="button" data-a="sell" data-id="${it.id}" ${sc.ok ? "" : "disabled"} title="${esc(sc.ok ? "" : sc.why || "")}">🪙 Sell 1 (${p} ${mi.icon})</button>${it.n > 1 || s.count(it.id) > 1 ? `<button type="button" data-a="sellall" data-id="${it.id}" ${sc.ok ? "" : "disabled"}>🪙 Sell all (${p * s.count(it.id)} ${mi.icon})</button>` : ""}` : "")
        + `<button type="button" class="warn" data-a="discard" data-id="${it.id}" data-n="${it.n}">🗑️ Discard</button></div>`;
      if (this.confirm) h += `<div class="cm-confirm"><span>Drop ${this.confirm.n} ${esc(d.name.toLowerCase())} on the ground? You can pick it back up.</span><button type="button" class="warn" data-a="discardyes">🗑️ Drop it</button><button type="button" data-a="discardno">✋ Keep</button></div>`;
      if (!sc.ok && p) h += `<div class="cm-tip">${esc(sc.why || "Sell at a trader or a friendly town.")}</div>`;
      h += `</div>`;
    } else h += `<div class="cm-tip">Tap an item for Eat / Use, Equip, Inspect, Sell or Discard.</div>`;
    return h;
  }
  _skills(s) {
    const T = s.torchStats(), into = s.xp % 100, q = this.env.questDone || (() => true);
    let h = `<div class="cm-xp">Level ${s.level} <i class="xpbar"><b style="width:${into}%"></b></i> ${into}/100 XP · <strong>${s.sp}</strong> skill point${s.sp === 1 ? "" : "s"}</div>`;
    h += `<div class="cm-torch"><span class="ic">🔥</span><div><b>Torch</b> reach ${Math.round(45 * T.reach)} m (+${Math.round((T.reach - 1) * 100)}%) · brightness +${Math.round((T.bright - 1) * 100)}%<small>Grows with every level (${T.lv}), every skill learned (${T.sk}), Pitch Torch${T.pitch ? " ✓" : ""} and the resin torch${T.resin ? " ✓" : ""}.</small><i class="xpbar"><b style="width:${Math.round(((T.reach - 1) / 0.75) * 100)}%"></b></i></div></div>`;
    h += `<div class="cm-tree">`;
    for (const b of Object.values(TREE)) {
      h += `<div class="cm-branch"><div class="b-name">${b.icon} ${b.name}</div>`;
      for (const t of b.tiers) { const why = s.learnBlock(t.id, q), has = s.skills.has(t.id); h += `<div class="tier${has ? " on" : why ? " locked" : " can"}"><strong>${t.name}</strong><small>${t.desc}</small>${has ? "<b>✓ Learned</b>" : why ? `<em>${esc(why)}</em>` : `<button type="button" data-a="learn" data-id="${t.id}">✋ Learn (1 pt)</button>`}</div>`; }
      h += `</div>`;
    }
    const base = Object.entries(SKILLS).filter(([id]) => s.skills.has(id)).map(([, k]) => k.name).join(" · ");
    return h + `</div><div class="cm-tip">Abilities: ${base || "none yet"}</div>`;
  }
  _stats(s) {
    const st = this.env.stats?.() || {}, money = MONEY.map((m) => [ITEMS[m], s.count(m)]).filter(([, n]) => n);
    const row = (ic, k, v) => `<div class="cm-stat"><span class="ic">${ic}</span><span class="k">${k}</span><b>${v}</b></div>`;
    return `<div class="cm-stats">` + row("❤", "Hearts", `${st.hp ?? "?"} / ${st.hearts ?? "?"}`) + row("🛡", "Armour (blocks)", `${st.armor ?? 0}%`) + row("🗡", "Spear damage", st.dmg ?? 1) + row("🏹", "Bow damage", st.bow ?? 1)
      + row("🍖", "Hunger", Math.round(s.hunger)) + row("💧", "Thirst", Math.round(s.thirst)) + row("⚡", "Stamina", Math.round(s.stamina))
      + row("💪", "Strength", "+" + s.str) + row("🎭", "Faces sewn", s.faces) + row("⭐", "Level", `${s.level} (${s.xp} XP)`) + row("🔥", "Torch reach", `${Math.round(45 * s.torchStats().reach)} m`)
      + row("⚔", "Kills", st.kills ?? 0) + row("💀", "Deaths", st.deaths ?? 0) + row("🎒", "Pack", `${s.inv.length} / ${s.slots}`)
      + row("🪙", "Money", money.length ? money.map(([m, n]) => `${n} ${m.icon}`).join(" ") : "none") + `</div>`;
  }
  _quests() {
    const Q = this.env.quests?.() || { active: [], done: [] };
    const li = (q, on) => `<div class="cm-q${on ? " on" : ""}"><span class="ic">${q.main ? "📜" : "📌"}</span><div><b>${esc(q.title)}</b>${q.step ? `<small>${esc(q.step)}</small>` : ""}</div>${q.tracked ? "<em>tracked</em>" : ""}</div>`;
    return `<div class="cm-h">Active</div>${Q.active.length ? Q.active.map((q) => li(q, true)).join("") : `<div class="cm-tip">No active quests.</div>`}`
      + (Q.done.length ? `<div class="cm-h">Done</div>${Q.done.map((q) => li(q, false)).join("")}` : "") + `<button type="button" class="cm-wide" data-a="tasks">📜 Open the quest log</button>`;
  }
  _map() { return `<div class="cm-mapprev"></div><button type="button" class="cm-wide" data-a="map">🗺️ Open the full map</button><div class="cm-tip">Terrain map: green lowlands, tan hills, grey rock and white peaks, contour lines every 20 m, water in blue. Unexplored land stays blank.</div>`; }

  // ---------- 3D preview ----------
  _start3d() {
    const cv = this.body.querySelector(".cm-3d"); if (!cv) return;
    if (!this.r3) {
      try {
        const renderer = new THREE.WebGLRenderer({ canvas: document.createElement("canvas"), antialias: !this.touch, alpha: true, powerPreference: "low-power" });
        renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
        const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
        scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x3a2a1c, 1.6));
        const key = new THREE.DirectionalLight(0xffe2c0, 2.4); key.position.set(-2, 3, -3); scene.add(key);
        const rim = new THREE.DirectionalLight(0x9fb8ff, 1.2); rim.position.set(2, 2, 3); scene.add(rim);
        const cm = new Caveman(scene); cm.baseIntensity = 3; cm.light.distance = 4;
        const disc = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.005; scene.add(disc);
        this.r3 = { renderer, scene, cam, cm, yaw: Math.PI + 0.45, t: 0, drag: null }; // a three-quarter view of his front
      } catch (err) { this.r3 = { failed: String(err) }; }
    }
    const R = this.r3; if (R.failed) { cv.replaceWith(Object.assign(document.createElement("div"), { className: "cm-3d off", textContent: "🧍" })); return; }
    // the preview draws into its own (offscreen) canvas and is copied to the one in the page
    R.out = cv; R.ctx = cv.getContext("2d");
    const on = (e) => { R.drag = { x: e.clientX, yaw: R.yaw }; cv.setPointerCapture?.(e.pointerId); };
    const mv = (e) => { if (R.drag) { R.yaw = R.drag.yaw + (e.clientX - R.drag.x) * 0.012; this.still = true; } };
    const up = () => { R.drag = null; };
    cv.addEventListener("pointerdown", on); cv.addEventListener("pointermove", mv); cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    R.cm.setGear(this.env.gear(this.env.surv())); R.cm.setWeapon("spear", true); R.cm.setBlood(this.env.blood?.() || 0);
    if (!R.raf) { let last = performance.now(); const loop = (now) => { R.raf = requestAnimationFrame(loop); const dt = Math.min(0.05, (now - last) / 1000); last = now; this._draw3d(dt); }; R.raf = requestAnimationFrame(loop); }
  }
  _draw3d(dt) {
    const R = this.r3; if (!R || !R.out || !R.out.isConnected) return;
    const w = R.out.clientWidth || 160, h = R.out.clientHeight || 260, dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (R.out.width !== W || R.out.height !== H) { R.out.width = W; R.out.height = H; }
    if (R.renderer.domElement.width !== W || R.renderer.domElement.height !== H) R.renderer.setSize(W, H, false);
    R.cam.aspect = w / h; R.cam.updateProjectionMatrix();
    if (!R.drag && !this.still) R.yaw = Math.PI + 0.45 + Math.sin(R.t * 0.4) * 0.6; // sways to show both sides; drag to turn him
    R.t += dt;
    R.cm.update(dt, { feet: new THREE.Vector3(0, 0, 0), yaw: R.yaw, pitch: 0, speed: 0, runFrac: 0, stance: "stand", eye: new THREE.Vector3(0, 1.6, 0) });
    const dist = 4.6 * Math.max(1, 0.62 / (w / h));
    R.cam.position.set(0, 1.15, dist); R.cam.lookAt(0, 0.95, 0);
    R.renderer.render(R.scene, R.cam);
    R.ctx.clearRect(0, 0, W, H); R.ctx.drawImage(R.renderer.domElement, 0, 0);
    this.frames3d = (this.frames3d || 0) + 1;
  }
  _stop3d() { if (this.r3?.raf) { cancelAnimationFrame(this.r3.raf); this.r3.raf = 0; } }
  /** Tests: what the preview Kra wears. */
  previewGear() { return this.r3?.cm?._gearKey ?? null; }
}
