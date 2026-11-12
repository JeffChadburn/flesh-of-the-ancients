import * as THREE from "three";
import { makeTransport } from "../net/transport.js";
import { NET } from "../net/config.js";
import { Avatar } from "./avatar.js";
import { Voice } from "./voice.js";
import { cleanName, cleanChat, esc } from "./safety.js";
/**
 * Round 22: multiplayer. Rooms of up to 8 over js/net (P2P WebRTC by default). Everything here is
 * game-side: lobby (☰ → Multiplayer), avatars, chat + emotes, throws, item hand-offs, read-only
 * settlement visits, proximity voice. Multiplayer always runs in free play with its own settlement
 * save key, so story saves are never touched; nothing is stored on any server.
 */
const CODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const COLORS = ["#c9a27a", "#d9604a", "#e0b040", "#6fbf5a", "#4fb0d0", "#7a7ae0", "#c76ad0", "#e8e0d0"];
const EMOTES = { wave: "👋", point: "👉", dance: "💃" };
const ls = { get: (k, d = null) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const r2 = (v) => Math.round(v * 100) / 100;

export class Multiplayer {
  constructor(env) {
    this.env = env; this.t = null; this.code = ""; this.players = new Map(); this.area = "";
    this.name = cleanName(ls.get("fota-mp-name", "")) || ""; this.color = ls.get("fota-mp-color") || COLORS[(Math.random() * COLORS.length) | 0];
    this.blocked = new Set(JSON.parse(ls.get("fota-mp-blocked", "[]") || "[]"));
    this.joinedAt = 0; this.isHost = false; this.sendT = 0; this.pingT = 0; this.colT = 0; this._colHash = ""; this.log = []; this.offers = new Map();
    this.voice = new Voice(this);
    this.lights = []; this.arrows = [];
    this._buildUI();
    window.addEventListener("online", () => { if (this.code) this.rejoin(); });
  }
  get on() { return !!this.t && this.t.status === "live"; }
  toast(m) { this.env.toast(m); }

  // ---------------- rooms ----------------
  newCode() { return Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => CODE_ABC[b % CODE_ABC.length]).join(""); }
  link(code = this.code) {
    const u = new URL(location.origin + location.pathname);
    u.searchParams.set("room", code);
    const seed = this.env.seed(); if (seed != null && seed !== 20261111) u.searchParams.set("world", seed);
    if (NET.transport !== "p2p") u.searchParams.set("net", NET.transport);
    return u.toString();
  }
  async create() { return this.join(this.newCode(), true); }
  async join(code, host = false) {
    code = String(code || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
    if (code.length !== 5) { this.toast("Room codes are 5 letters"); return false; }
    if (!this.name) { this.toast("Pick a name first"); this.open(); return false; }
    if (!this.env.inFreePlay()) { // multiplayer runs in free play: your story save stays as it is
      sessionStorage.setItem("fota-mp-room", code); sessionStorage.setItem("fota-mp-host", host ? "1" : "");
      this.env.gotoFree(code, this.env.seed()); return true;
    }
    if (this.t) this.leave(true);
    this.code = code; this.isHost = host; this.joinedAt = Date.now();
    sessionStorage.setItem("fota-mp-room", code); sessionStorage.setItem("fota-mp-host", host ? "1" : "");
    this.t = await makeTransport();
    const t = this.t;
    t.onPeer((ev, id) => (ev === "join" ? this._peerJoin(id) : this._peerLeave(id)));
    t.onStream((stream, id) => { if (!this.blocked.has(this.players.get(id)?.name)) this.voice.addRemote(stream, id); });
    for (const [ch, fn] of Object.entries(this._handlers())) t.on(ch, (m, from) => { const P = this.players.get(from); if (ch !== "hi" && (!P || P.blocked)) return; fn(m, from, P); });
    this.refresh("Connecting…");
    try { await t.join(code); } catch (e) { this.refresh("Could not connect: " + (e?.message || e)); this.t = null; return false; }
    this.env.onActive(true);
    this._lightPool();
    this.refresh();
    this._sys(host ? `Room ${code} created. Share the link to invite friends.` : `Joined room ${code}. Looking for players…`);
    return true;
  }
  rejoin() { const c = this.code, h = this.isHost; if (!c) return; this.leave(true); return this.join(c, h); }
  leave(quiet = false) {
    if (!this.t) return;
    for (const [id, o] of this.offers) this._refund(id, o);
    this.voice.stop();
    this.t.leave(); this.t = null;
    for (const id of [...this.players.keys()]) this._peerLeave(id, true);
    for (const l of this.lights) this.env.scene.remove(l); this.lights = [];
    if (!quiet) { this.code = ""; sessionStorage.removeItem("fota-mp-room"); this.env.onActive(false); this._sys("You left the room."); }
    this.refresh();
  }
  send(ch, m, to) { if (this.on) this.t.send(ch, m, to); }
  _hello(to, q = 0) { this.send("hi", { q, n: this.name, c: this.color, g: this.env.gear(), j: this.joinedAt, h: this.isHost ? 1 : 0, seed: this.env.seed() }, to); }
  _peerJoin(id) {
    if (!this.players.has(id)) this.players.set(id, { id, name: "…", color: "#c9a27a", av: null, ping: null, area: "", muted: false, blocked: false, seen: false });
    this._hello(id, 1); this.voice.peerJoined(id);
    const c = this.env.colony(); if (c?.list.length) this.send("co", c.toJSON(), id);
    this.refresh();
  }
  _peerLeave(id, silent = false) {
    const P = this.players.get(id); if (!P) return;
    P.av?.dispose(); P.guest?.clear(); P.guest?.group.parent?.remove(P.guest.group);
    this.voice.removeRemote(id); this.players.delete(id);
    if (!silent && P.seen) this._sys(`${P.name} left.`);
    this.refresh();
  }
  host() {
    let best = this.isHost ? { me: true, j: -1 } : { me: true, j: this.joinedAt };
    for (const P of this.players.values()) if (P.seen && (P.h ? -1 : P.j) < best.j) best = P;
    return best;
  }
  _handlers() {
    return {
      hi: (m, from) => {
        let P = this.players.get(from); if (!P) { this._peerJoin(from); P = this.players.get(from); }
        const first = !P.seen;
        Object.assign(P, { name: cleanName(m.n) || "Caveperson", color: COLORS.includes(m.c) ? m.c : "#c9a27a", j: +m.j || Date.now(), h: !!m.h, seed: m.seed >>> 0, seen: true });
        P.blocked = this.blocked.has(P.name);
        if (!P.av) P.av = new Avatar(this.env.scene, from);
        P.av.visible = !P.blocked;
        P.av.setInfo({ name: P.name, color: P.color, gear: Array.isArray(m.g) ? m.g.slice(0, 6) : [], muted: P.muted });
        if (first) this._sys(`${P.name} joined.`);
        if (first || m.q) this._hello(from);
        const H = this.host();
        if (H !== P && !H.me) return this.refresh();
        if (H === P && P.seed !== this.env.seed() && !sessionStorage.getItem("fota-mp-synced-" + this.code + P.seed)) {
          sessionStorage.setItem("fota-mp-synced-" + this.code + P.seed, "1");
          this.toast(`Loading ${P.name}'s world…`);
          this.env.gotoFree(this.code, P.seed);
        }
        this.refresh();
      },
      st: (m, from, P) => { if (typeof m?.x !== "number") return; P.area = String(m.a || ""); P.last = m; P.av?.push(m); },
      ch: (m, from, P) => { const t = cleanChat(m?.t); if (!t || P.muted || this._flood(P)) return; P.av?.say(t); this._chat(P.name, t, P.color); },
      em: (m, from, P) => { if (!EMOTES[m?.k]) return; P.av?.doEmote(m.k); this._chat(P.name, EMOTES[m.k] + " " + m.k + "s", P.color, true); },
      fx: (m, from, P) => { if (P.area !== this.area) return; if (m?.k === "thrust") P.av?.cm.thrust(); if (m?.k === "arrow" && Array.isArray(m.o) && Array.isArray(m.d)) { P.av?.cm.thrust(); this._arrow(m.o, m.d); } },
      vo: (m, from, P) => { P.talk = !!m?.on; },
      ft: (m, from, P) => { const to = cleanChat(m?.to); if (!to) return; this._sys(`${P.name} fast-travelled to ${to}.`); this.toast(`🧭 ${P.name} travelled to ${to}`); }, // round 23
      co: (m, from, P) => this._guestColony(P, m),
      tr: (m, from, P) => this._offerIn(m, P),
      ta: (m, from, P) => this._offerReply(m, P),
    };
  }
  _flood(P) { const now = performance.now(); P.chatTs = (P.chatTs || []).filter((t) => now - t < 4000); P.chatTs.push(now); return P.chatTs.length > 6; }

  // ---------------- per frame ----------------
  update(dt) {
    if (!this.t) return;
    if (this.on && !this.env.inFreePlay()) { this.leave(); this.toast("Left the room: multiplayer is free play only (your story is untouched)"); return; }
    const me = this.env.me();
    this.area = this.env.area();
    if (me && this.on && (this.sendT -= dt) <= 0) {
      this.sendT = 1 / NET.rate;
      this.send("st", { x: r2(me.x), y: r2(me.y), z: r2(me.z), yaw: r2(me.yaw), pitch: r2(me.pitch), run: r2(me.run), st: me.st, mounted: me.mounted ? 1 : 0, boat: me.boat || 0, torch: me.torch ? 1 : 0, armed: me.armed ? 1 : 0, w: me.w === "bow" ? 1 : 0, a: this.area });
    }
    if ((this.pingT -= dt) <= 0) { this.pingT = 3; for (const P of this.players.values()) this.t.ping(P.id).then((ms) => { P.ping = ms == null ? null : Math.round(ms); this._renderList(); }); }
    if ((this.colT -= dt) <= 0) { this.colT = 20; const c = this.env.colony(); if (c?.list.length) { const j = c.toJSON(), h = JSON.stringify(j.list.map((x) => [x.id, x.age, x.blds.length])); if (h !== this._colHash) { this._colHash = h; this.send("co", j); } } }
    const pxH = this.env.pxH(), base = this.env.torchBase();
    for (const P of this.players.values()) if (P.av) {
      P.av.cm.baseIntensity = base;
      P.av.update(dt, P.area === this.area && !P.blocked, pxH);
      P.av.setSpeaking(!P.muted && !this.voice.muteAll && (this.voice.speaking(P.id) || (P.talk && !this.voice.peers.has(P.id) && false) || (P.talk && this.voice.peers.has(P.id) && this.voice.speaking(P.id))));
      if (P.talk && !this.t.caps.voice) P.av.setSpeaking(!P.muted && !this.voice.muteAll); // local / server transports: the "talking" flag
    }
    this.voice.update(dt, me, me?.yaw || 0);
    this._lightsTick(me);
    this._arrowsTick(dt);
    this._talkBtn.classList.toggle("live", this.voice.on);
    this._talkBtn.classList.toggle("speak", this.voice.selfSpeaking);
    if (me && this.area === "o") this._visitCheck(me);
  }
  _lightPool() {
    if (this.lights.length) return;
    const n = this.env.isTouch ? 2 : 3;
    for (let i = 0; i < n; i++) { const l = new THREE.PointLight(0xffb37d, 0, 30, 1.0); l.userData.noMelt = true; this.env.scene.add(l); this.lights.push(l); }
  }
  _lightsTick(me) {
    if (!this.lights.length) return;
    const list = [...this.players.values()].filter((P) => P.av?.cm.root.visible && P.last?.torch).map((P) => ({ P, d: me ? Math.hypot(P.av.pos.x - me.x, P.av.pos.z - me.z) : 0 })).sort((a, b) => a.d - b.d);
    this.lights.forEach((l, i) => { const e = list[i]; if (e && e.d < 60) { l.position.copy(e.P.av.torch()); l.intensity = e.P.av.cm.light.intensity * 0.8; } else l.intensity = 0; });
  }
  _arrow(o, d) {
    if (!this._arrowGeo) { this._arrowGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.8, 4).rotateX(Math.PI / 2); this._arrowMat = new THREE.MeshLambertMaterial({ color: 0x8a6a40 }); }
    const m = new THREE.Mesh(this._arrowGeo, this._arrowMat); m.position.fromArray(o);
    const v = new THREE.Vector3().fromArray(d); const L = v.length() || 1; v.multiplyScalar(40 / L);
    this.env.scene.add(m); this.arrows.push({ m, v, t: 0 });
  }
  _arrowsTick(dt) {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i]; a.t += dt; a.v.y -= 7.5 * dt; a.m.position.addScaledVector(a.v, dt);
      a.m.lookAt(a.m.position.clone().add(a.v));
      const g = this.env.groundAt(a.m.position);
      if (a.t > 2.5 || (g != null && a.m.position.y < g)) { if (a.t > 6 || a.stuck) { this.env.scene.remove(a.m); this.arrows.splice(i, 1); } else { a.stuck = true; a.v.set(0, 0, 0); a.t = 4; } }
    }
  }
  /** Hooks from the game: Kra stabbed / shot. */
  /** Round 23: tell the room you fast-travelled. */
  travelled(to) { if (!this.on) return; this.send("ft", { to: String(to).slice(0, 40) }); this._sys(`You travelled to ${to}.`); }
  fx(k, o, d) { if (!this.on) return; this.send("fx", k === "arrow" ? { k, o: o.toArray().map(r2), d: d.toArray().map(r2) } : { k }); }

  // ---------------- chat / emotes ----------------
  say(text) {
    const t = cleanChat(text); if (!t || !this.on) return;
    this.send("ch", { t }); this._chat(this.name + " (you)", t, this.color);
  }
  emote(k) { if (!EMOTES[k] || !this.on) return; this.send("em", { k }); this._chat(this.name + " (you)", EMOTES[k] + " " + k, this.color, true); this.env.selfEmote?.(k); }
  _chat(who, text, color, sys = false) {
    this.log.push({ who, text, color, sys, at: Date.now() }); if (this.log.length > 60) this.log.shift();
    const line = `<div class="mp-line${sys ? " sys" : ""}"><b style="color:${color}">${esc(who)}</b> ${esc(text)}</div>`;
    this._logEl.insertAdjacentHTML("beforeend", line); while (this._logEl.children.length > 6) this._logEl.firstChild.remove();
    this._logEl.classList.remove("faded"); clearTimeout(this._fadeT); this._fadeT = setTimeout(() => this._logEl.classList.add("faded"), 12000);
    this._panelLog && (this._panelLog.innerHTML = this.log.slice(-30).map((l) => `<div class="mp-line${l.sys ? " sys" : ""}"><b style="color:${l.color}">${esc(l.who)}</b> ${esc(l.text)}</div>`).join(""), this._panelLog.scrollTop = 1e6);
  }
  _sys(t) { this._chat("•", t, "#d8c8a8", true); }

  // ---------------- trades ----------------
  give(id) {
    const P = this.players.get(id), me = this.env.me(), surv = this.env.surv();
    if (!P?.av || !surv) return this.toast("Nothing to hand over here");
    if (P.area !== this.area || !me || Math.hypot(P.av.pos.x - me.x, P.av.pos.z - me.z) > 8) return this.toast(`Walk up to ${P.name} (within 8 m) to hand them something`);
    const ids = [...new Set(surv.inv.map((s) => s.id))].filter((k) => this.env.items[k]).slice(0, 8);
    if (!ids.length) return this.toast("Your pack is empty");
    this.close();
    this.env.ask(`Give to ${esc(P.name)}`, "Pick something to hand over. They have to accept.", ids.map((k) => ({ id: k, label: `${this.env.items[k].icon || ""} ${esc(this.env.items[k].name)}`, desc: `you have ${surv.count(k)}` })), (k) => {
      if (!surv.remove(k, 1)) return;
      const oid = Math.random().toString(36).slice(2, 9);
      this.offers.set(oid, { to: id, item: k, n: 1, timer: setTimeout(() => this._refund(oid, this.offers.get(oid), "no answer"), 30000) });
      this.send("tr", { id: oid, item: k, n: 1 }, id);
      this.toast(`Offered ${this.env.items[k].name} to ${P.name}…`); this.env.changed?.();
    });
  }
  _refund(oid, o, why = "") {
    if (!o) return; clearTimeout(o.timer); this.offers.delete(oid);
    this.env.surv()?.add(o.item, o.n); this.env.changed?.();
    if (why) this.toast(`${this.env.items[o.item]?.name || o.item} came back (${why})`);
  }
  _offerIn(m, P) {
    const it = this.env.items[m?.item], n = Math.max(1, Math.min(10, m?.n | 0)), surv = this.env.surv();
    if (!it || !surv) return this.send("ta", { id: m?.id, ok: 0 }, P.id);
    this.env.ask(`${esc(P.name)} offers you something`, `${it.icon || ""} ${esc(it.name)}${n > 1 ? " ×" + n : ""}`, [{ id: "yes", label: "Accept" }, { id: "no", label: "No thanks" }], (k) => {
      const ok = k === "yes" && surv.add(m.item, n) !== false;
      this.send("ta", { id: m.id, ok: ok ? 1 : 0 }, P.id);
      if (ok) { this.toast(`${P.name} gave you ${it.name}`); this.env.changed?.(); }
    }, false);
  }
  _offerReply(m, P) {
    const o = this.offers.get(m?.id); if (!o || o.to !== P.id) return;
    if (m.ok) { clearTimeout(o.timer); this.offers.delete(m.id); this.toast(`${P.name} took the ${this.env.items[o.item]?.name}`); }
    else this._refund(m.id, o, `${P.name} declined`);
  }

  // ---------------- settlements (read-only visits) ----------------
  _guestColony(P, o) {
    if (!o || !Array.isArray(o.list)) return;
    o = { ...o, list: o.list.slice(0, 4) };
    try {
      if (!P.guest) P.guest = this.env.makeGuestColony();
      P.guest.load(o, false);
      P.towns = P.guest.list.map((c) => ({ x: c.x, z: c.z, name: c.name, age: c.age, n: c.vill.length }));
    } catch (e) { console.warn("guest colony", e); }
  }
  _visitCheck(me) {
    let at = null;
    for (const P of this.players.values()) for (const c of P.towns || []) if (Math.hypot(c.x - me.x, c.z - me.z) < 45 + 8 * c.age) at = { P, c };
    const key = at ? at.P.id + at.c.name : "";
    if (key !== this._visitKey) { this._visitKey = key; if (at) this.toast(`Visiting ${at.P.name}'s ${at.c.name} (read-only)`); }
  }
  /** Map / minimap marks for the game. */
  marks() {
    const out = [];
    for (const P of this.players.values()) {
      if (P.blocked) continue;
      if (P.av?.s && P.area === this.area) out.push({ x: P.av.pos.x, z: P.av.pos.z, color: P.color, label: P.name, player: true });
      for (const c of P.towns || []) out.push({ x: c.x, z: c.z, color: P.color, label: `${P.name}'s ${c.name}`, town: true });
    }
    return out;
  }

  // ---------------- UI ----------------
  _buildUI() {
    const root = this.env.root, mk = (tag, id, cls, html = "") => { const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; e.innerHTML = html; return e; };
    this._hud = mk("div", "mp-hud", "hidden");
    this._openBtn = mk("button", "mp-open", "", "👥"); this._openBtn.type = "button";
    this._talkBtn = mk("button", "mp-talk", "", "🎙"); this._talkBtn.type = "button"; this._talkBtn.title = "Push to talk (hold V)";
    this._chatBtn = mk("button", "mp-chat", "", "💬"); this._chatBtn.type = "button"; this._chatBtn.title = "Chat (T / Enter)";
    this._hud.append(this._openBtn, this._talkBtn, this._chatBtn);
    this._logEl = mk("div", "mp-log", "faded");
    this._bar = mk("form", "mp-bar", "hidden", `<input maxlength="160" placeholder="Say something…" autocomplete="off" enterkeyhint="send"><button type="submit">Send</button>${Object.entries(EMOTES).map(([k, e]) => `<button type="button" data-em="${k}" title="${k}">${e}</button>`).join("")}`);
    this._panel = mk("div", "mp-panel", "hidden");
    root.append(this._hud, this._logEl, this._bar, this._panel);
    for (const e of [this._hud, this._bar, this._panel]) for (const ev of ["pointerdown", "touchstart", "mousedown", "click", "keydown"]) e.addEventListener(ev, (x) => x.stopPropagation(), { passive: ev !== "click" && ev !== "keydown" ? true : false });
    this._openBtn.addEventListener("click", () => this.open());
    this._chatBtn.addEventListener("click", () => this.chatOpen());
    // push-to-talk: hold (default) or tap to toggle
    const down = (e) => { e.preventDefault?.(); this.env.armAudio(); if (this.voice.toggleMode) this.voice.talk(!this.voice.on); else this.voice.talk(true); };
    const up = () => { if (!this.voice.toggleMode && this.voice.on) this.voice.talk(false); };
    this._talkBtn.addEventListener("pointerdown", down); this._talkBtn.addEventListener("pointerup", up); this._talkBtn.addEventListener("pointercancel", up); this._talkBtn.addEventListener("pointerleave", up);
    this._talkBtn.addEventListener("contextmenu", (e) => e.preventDefault());
    this._bar.addEventListener("submit", (e) => { e.preventDefault(); const i = this._bar.querySelector("input"); this.say(i.value); i.value = ""; this.chatClose(); });
    this._bar.addEventListener("click", (e) => { const k = e.target.closest("[data-em]")?.dataset.em; if (k) { this.emote(k); this.chatClose(); } });
    this._bar.querySelector("input").addEventListener("keydown", (e) => { if (e.key === "Escape") this.chatClose(); });
    this.refresh();
  }
  chatOpen() { if (!this.on) return; this.env.exitLock(); this._bar.classList.remove("hidden"); this._logEl.classList.remove("faded"); setTimeout(() => this._bar.querySelector("input").focus(), 30); }
  chatClose() { this._bar.classList.add("hidden"); this._bar.querySelector("input").blur(); }
  /** Keyboard: V = push-to-talk while in a room with voice; T / Enter = chat. Returns true if used. */
  key(e, down) {
    if (!this.on) return false;
    if (e.code === "KeyV") { if (down) { if (e.repeat) return true; this.env.armAudio(); this.voice.toggleMode ? this.voice.talk(!this.voice.on) : this.voice.talk(true); } else if (!this.voice.toggleMode) this.voice.talk(false); return true; }
    if (down && (e.code === "KeyT" || e.code === "Enter") && this._bar.classList.contains("hidden")) { e.preventDefault(); this.chatOpen(); return true; }
    return false;
  }
  open() { this.env.exitLock(); this._panel.classList.remove("hidden"); this.refresh(); }
  close() { this._panel.classList.add("hidden"); }
  get panelOpen() { return !this._panel.classList.contains("hidden"); }
  refresh(status) {
    if (status !== undefined) this._status = status;
    const on = this.on, n = this.players.size + 1;
    this._hud.classList.toggle("hidden", !this.t);
    this._openBtn.textContent = `👥 ${n} · ${this.code}`;
    this._talkBtn.classList.toggle("hidden", !(this.t?.caps.voice || this.t?.caps.kind === "local"));
    if (this._panel.classList.contains("hidden")) return;
    const v = this.voice;
    const st = this._status && !on ? this._status : on ? `Room <b>${this.code}</b> · ${n}/${NET.maxPlayers} players · ${this.t.caps.kind === "p2p" ? "peer-to-peer" : this.t.caps.kind}` + (this.t.connectFails && !this.players.size ? `<br><small class="mp-warn">Found ${this.t.connectFails > 1 ? "players" : "a player"} but couldn't connect directly: one of the networks blocks peer-to-peer (needs a TURN relay). Try another Wi-Fi / mobile data.</small>` : "") : this.t ? "Connecting…" : "Play together in this world: up to 8 players, chat and voice.";
    this._panel.innerHTML = `<div class="mp-box"><button class="mp-x" type="button" aria-label="Close">✕</button><h3>Multiplayer</h3><p class="mp-st">${st}</p>
      <label class="mp-row">Your name <input id="mp-name" maxlength="16" value="${esc(this.name)}" placeholder="e.g. Ana" autocomplete="off"></label>
      <div class="mp-row mp-cols">${COLORS.map((c) => `<button type="button" class="mp-sw${c === this.color ? " on" : ""}" data-c="${c}" style="background:${c}" aria-label="colour"></button>`).join("")}</div>
      ${on ? `<div class="mp-row"><input id="mp-link" readonly value="${esc(this.link())}"><button type="button" data-a="copy">Copy link</button></div>
      <ul class="mp-list"><li class="me"><span class="dot" style="background:${this.color}"></span><b>${esc(this.name)}</b> (you)${this.isHost || this.host().me ? " · host" : ""}${v.on ? " 🎙" : ""}</li>${[...this.players.values()].filter((P) => P.seen).map((P) => `<li><span class="dot" style="background:${P.color}"></span><b>${esc(P.name)}</b>${P.h ? " · host" : ""}<span class="ping">${P.ping == null ? "…" : P.ping + " ms"}</span>${P.av?.speaking ? " 🔊" : ""}
        <button type="button" data-a="give" data-id="${esc(P.id)}" title="Hand over an item">🎁</button><button type="button" data-a="mute" data-id="${esc(P.id)}" class="${P.muted ? "on" : ""}" title="Mute voice + chat">${P.muted ? "🔇" : "🔈"}</button><button type="button" data-a="block" data-id="${esc(P.id)}" class="${P.blocked ? "on" : ""}" title="Block (hide, mute, ignore)">🚫</button></li>`).join("")}</ul>
      ${this.t.caps.voice || this.t.caps.kind === "local" ? `<div class="mp-row mp-voice"><button type="button" data-a="mic" class="${v.micReady ? "on" : ""}">${v.micReady ? "🎙 Mic ready" : "🎙 Enable mic"}</button><button type="button" data-a="ptt">${v.toggleMode ? "Tap to toggle" : "Hold to talk"}</button><button type="button" data-a="range">${v.roomWide ? "Room-wide" : "Proximity"}</button><button type="button" data-a="muteall" class="${v.muteAll ? "on" : ""}">${v.muteAll ? "🔇 All muted" : "Mute all"}</button></div><p class="mp-hint">${this.env.isTouch ? "Hold 🎙 to talk" : "Hold V (or 🎙) to talk"} · T / 💬 to chat · emotes in the chat bar</p>` : ""}
      <div class="mp-chatlog"></div>
      <div class="mp-row"><button type="button" data-a="chat">💬 Chat</button>${Object.entries(EMOTES).map(([k, e]) => `<button type="button" data-a="em" data-k="${k}">${e} ${k}</button>`).join("")}</div>
      <div class="mp-row"><button type="button" data-a="leave" class="warn">Leave room</button></div>`
      : `<div class="mp-row"><button type="button" data-a="create" class="big">Create room</button></div>
      <div class="mp-row"><input id="mp-code" maxlength="5" placeholder="CODE" autocomplete="off" autocapitalize="characters" value="${esc(this._prefill || "")}"><button type="button" data-a="join" class="big">Join</button></div>
      <p class="mp-hint">Peer-to-peer: players connect directly, signalled through free public relays. Free play only; your story save is untouched.</p>`}</div>`;
    const P = this._panel;
    P.querySelector(".mp-x").onclick = () => this.close();
    P.addEventListener("click", (e) => { if (e.target === P) this.close(); }, { once: true });
    const nm = P.querySelector("#mp-name");
    nm.onchange = () => { const c = cleanName(nm.value); if (!c && nm.value.trim()) this.toast("Please pick a different name"); this.name = c; nm.value = c; ls.set("fota-mp-name", c); if (this.on) this._hello(); };
    P.querySelectorAll(".mp-sw").forEach((b) => (b.onclick = () => { this.color = b.dataset.c; ls.set("fota-mp-color", this.color); if (this.on) this._hello(); this.refresh(); }));
    this._panelLog = P.querySelector(".mp-chatlog"); if (this._panelLog) this._chatRefresh();
    P.querySelectorAll("[data-a]").forEach((b) => (b.onclick = async () => {
      const a = b.dataset.a, id = b.dataset.id;
      if (nm.value !== this.name) nm.onchange();
      if (a === "create") { this.env.armAudio(); await this.create(); }
      else if (a === "join") { this.env.armAudio(); await this.join(P.querySelector("#mp-code").value); }
      else if (a === "leave") this.leave();
      else if (a === "copy") { const l = this.link(); try { await navigator.clipboard.writeText(l); this.toast("Invite link copied"); } catch { const i = P.querySelector("#mp-link"); i.select(); this.toast("Select + copy the link"); } }
      else if (a === "mute") { const Q = this.players.get(id); if (Q) { Q.muted = !Q.muted; Q.av?.setInfo({ muted: Q.muted }); } }
      else if (a === "block") { const Q = this.players.get(id); if (Q) { Q.blocked = !Q.blocked; Q.blocked ? this.blocked.add(Q.name) : this.blocked.delete(Q.name); ls.set("fota-mp-blocked", JSON.stringify([...this.blocked])); if (Q.av) Q.av.visible = !Q.blocked; if (Q.blocked) this.voice.removeRemote(id); } }
      else if (a === "give") this.give(id);
      else if (a === "mic") { this.env.armAudio(); await v.enableMic(); }
      else if (a === "ptt") { v.toggleMode = !v.toggleMode; ls.set("fota-mp-ptt-toggle", v.toggleMode ? "1" : "0"); if (v.on) v.talk(false); }
      else if (a === "range") { v.roomWide = !v.roomWide; ls.set("fota-mp-voice-room", v.roomWide ? "1" : "0"); }
      else if (a === "muteall") v.muteAll = !v.muteAll;
      else if (a === "chat") { this.close(); return this.chatOpen(); }
      else if (a === "em") { this.emote(b.dataset.k); return this.close(); }
      if (a !== "give") this.refresh();
    }));
  }
  _chatRefresh() { if (this._panelLog) { this._panelLog.innerHTML = this.log.slice(-30).map((l) => `<div class="mp-line${l.sys ? " sys" : ""}"><b style="color:${l.color}">${esc(l.who)}</b> ${esc(l.text)}</div>`).join(""); this._panelLog.scrollTop = 1e6; } }
  _renderList() { if (this.panelOpen && !this._panel.contains(document.activeElement)) this.refresh(); }
  /** Join from ?room= or after a reload into free play. */
  autoJoin(code) {
    code = String(code || "").toUpperCase();
    if (!code) return;
    this._prefill = code;
    const host = sessionStorage.getItem("fota-mp-host") === "1" && sessionStorage.getItem("fota-mp-room") === code;
    if (this.name) this.join(code, host); else { this.open(); this.toast("Pick a name, then Join"); }
  }
}
