/**
 * Round 20: the phone-friendly settlement UI. A "Found 🏛" / "Town 🏘" button in the stance bar,
 * a build bar (cards with costs, a ghost 7 m in front of Kra on a 1 m grid, 90° rotation,
 * green = OK / red = blocked, with the reason) and the Settlement panel (stores, people and
 * their jobs, the next age, know-how, deposit Kra's pack, build, a debug fast-forward).
 */
import { AGES, BUILD, RES, TECH, JOBS, MAX_SETTLEMENTS, INSIGHTS } from "../world/colony.js";

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const costTxt = (cost) => Object.entries(cost).map(([r, n]) => `${RES[r][1]}${n}`).join(" ") || "free";
// what Kra's pack gives the settlement stores
const DEPOSIT = { logs: { wood: 3 }, flint: { stone: 2 }, hide: { hide: 1 }, pelt: { hide: 1 }, meat: { food: 3 }, cooked: { food: 4 }, berries: { food: 1 }, roots: { food: 1 }, fish: { food: 2 }, sinew: { fibre: 2 }, copper: { copper: 3 }, tin: { tin: 3 }, iron: { iron: 3 }, coal: { coal: 3 } };

export class ColonyUI {
  /** o: { root, stanceBar, colony, feet(), yaw(), surv(), toast(m, k), unlocked() -> reason|null, busy() -> bool, debug, onChange() } */
  constructor(o) {
    this.o = o; this.col = o.colony; this.mode = null; this.rot = 0; this.type = null; this.valid = null;
    const b = (this.btn = el("button", "hidden", "Found 🏛")); b.id = "btn-colony"; b.type = "button";
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); this.onButton(); });
    b.addEventListener("click", (e) => e.stopPropagation());
    o.stanceBar?.appendChild(b);
    const bar = (this.bar = el("div", "hidden")); bar.id = "build-bar";
    bar.addEventListener("pointerdown", (e) => e.stopPropagation());
    bar.innerHTML = `<div class="bb-cards"></div><div class="bb-row"><span class="bb-status"></span><button type="button" data-a="rot">⟳ Rotate</button><button type="button" data-a="place" class="bb-go">Place</button><button type="button" data-a="cancel">✕</button></div>`;
    bar.addEventListener("click", (e) => { const a = e.target.closest("[data-a]")?.dataset.a; const t = e.target.closest("[data-t]")?.dataset.t; e.stopPropagation(); if (t) this.pick(t); else if (a === "rot") this.rotate(); else if (a === "place") this.place(); else if (a === "cancel") this.stop(); });
    o.root.appendChild(bar);
    const pan = (this.panel = el("div", "hidden")); pan.id = "colony-panel";
    pan.addEventListener("pointerdown", (e) => e.stopPropagation());
    pan.addEventListener("click", (e) => this._panelClick(e));
    pan.addEventListener("change", (e) => { const s = e.target.closest("select[data-vid]"); if (s) { this.col.setJob(s.dataset.vid, s.value); this.o.toast(`${s.selectedOptions[0].textContent}: ${s.dataset.name}`); this.render(); } });
    o.root.appendChild(pan);
  }
  here() { const f = this.o.feet(); return f ? this.col.at(f.x, f.z) : null; }
  /** Per frame (overworld only). */
  update() {
    const busy = this.o.busy();
    if (busy && this.mode && this.o.mode?.() !== "overworld") this.stop();
    const c = this.here(), canFound = !c && !this.o.unlocked() && this.col.list.length < MAX_SETTLEMENTS;
    const want = busy && !this.mode ? "" : this.mode ? "" : c ? "town" : canFound ? "found" : "";
    if (this.btn._w !== want) { this.btn._w = want; this.btn.classList.toggle("hidden", !want); this.btn.innerHTML = want === "town" ? "Town 🏘" : "Found 🏛"; }
    if (this.mode) this._ghost();
  }
  onButton() {
    const c = this.here();
    if (c) { this.open(c); return; }
    const why = this.o.unlocked(); if (why) { this.o.toast(why, "bad"); return; }
    this.start("found");
  }
  // ---------------- build mode ----------------
  start(mode, c = null) {
    this.mode = mode; this.c = c; this.rot = 0; this.close();
    this.type = mode === "found" ? "stone" : null;
    this.bar.classList.remove("hidden"); this.btn.classList.add("hidden"); this.o.root.classList.add("building"); this.btn._w = "x";
    this._cards();
  }
  _cards() {
    const box = this.bar.querySelector(".bb-cards");
    if (this.mode === "found") { box.innerHTML = `<div class="bb-tip">Walk to flat, dry open ground away from towns and caves. The stone shows where your new hearth goes.</div>`; return; }
    const c = this.c;
    box.innerHTML = Object.entries(BUILD).filter(([id, K]) => id !== "stone").map(([id, K]) => {
      const lock = this.col.bAge(id) > c.age, cost = this.col.cost(id), ok = !lock && this.col.afford(c, cost);
      return `<button type="button" class="bb-card${this.type === id ? " on" : ""}${ok ? "" : " poor"}" data-t="${id}" ${lock ? "disabled" : ""}><b>${K.name}</b><span>${lock ? "🔒 " + AGES[K.age].name : costTxt(cost)}</span></button>`;
    }).join("");
    box.querySelector(".on")?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }
  pick(t) { this.type = t; this._cards(); const K = BUILD[t]; this.o.toast(`${K.name}: ${K.desc || ""}`); }
  rotate() { this.rot = (this.rot + Math.PI / 2) % (Math.PI * 2); }
  _spot() {
    const f = this.o.feet(), yaw = this.o.yaw(), d = this.mode === "found" || !this.type ? 7 : 4 + BUILD[this.type].r * 1.3;
    return { x: Math.round(f.x - Math.sin(yaw) * d), z: Math.round(f.z - Math.cos(yaw) * d) };
  }
  _ghost() {
    const st = this.bar.querySelector(".bb-status"), go = this.bar.querySelector(".bb-go");
    if (!this.type) { this.col.hideGhost(); st.textContent = "Pick a building"; go.disabled = true; return; }
    const p0 = this._spot(), age = this.c ? this.c.age : 0;
    const test = (x, z) => (this.mode === "found" ? this.col.canFound(x, z) : this.col.canPlace(this.c, this.type, x, z, this.rot));
    // smart snap: if the spot in front is blocked, slide the ghost to the nearest good grid spot within 3 m
    const key = `${p0.x},${p0.z},${this.type},${this.rot},${this.mode}`;
    if (key !== this._key || (this._reT = (this._reT || 0) + 1) > 30) {
      this._key = key; this._reT = 0;
      let why = test(p0.x, p0.z), p = p0;
      if (why && why !== "Not enough materials" && !why.startsWith("Not yet") && !why.startsWith("You already")) {
        let best = null;
        for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) { const d = dx * dx + dz * dz; if (!d || d > 9 || (best && d >= best.d)) continue; if (!test(p0.x + dx, p0.z + dz)) best = { x: p0.x + dx, z: p0.z + dz, d }; }
        if (best) { p = best; why = null; }
      }
      this._snap = { p, why };
    }
    const { p, why } = this._snap;
    const g = this.col.ghost(this.type, age);
    g.position.set(p.x, this.col.t.height(p.x, p.z) + 0.05, p.z); g.rotation.y = this.rot;
    g.material.color.setHex(why ? 0xff4030 : 0x40ff60);
    this.valid = why ? null : p;
    st.textContent = why || (this.mode === "found" ? "Good ground: found your settlement here" : `${BUILD[this.type].name}: ${costTxt(this.col.cost(this.type))}`);
    st.classList.toggle("bad", !!why); go.disabled = !!why;
    go.textContent = this.mode === "found" ? "Found here" : "Place";
  }
  place() {
    this._key = null; this._ghost(); const p = this.valid; if (!p) return false;
    if (this.mode === "found") {
      const c = this.col.found(p.x, p.z);
      this.o.toast(`🏛 ${c.name} founded! Take in people from the towns, or build huts and they will come.`, "good");
      this.o.onChange?.("found", c);
      this.start("build", c); return true;
    }
    const why = this.col.place(this.c, this.type, p.x, p.z, this.rot);
    if (why) { this.o.toast(why, "bad"); return false; }
    this.o.toast(`${BUILD[this.type].name} laid out. Builders (or anyone idle) will raise it.`, "good");
    this.o.onChange?.("place", this.c);
    this._key = null; this._cards(); return true;
  }
  stop() { this.mode = null; this.type = null; this.col.hideGhost(); this.bar.classList.add("hidden"); this.btn._w = "x"; this.o.root.classList.remove("building"); }
  // ---------------- panel ----------------
  open(c) { this.stop(); this.c = c; this.panel.classList.remove("hidden"); this.render(); }
  close() { this.panel.classList.add("hidden"); }
  isOpen() { return !this.panel.classList.contains("hidden"); }
  render() {
    const c = this.c, col = this.col; if (!c) return;
    const A = AGES[c.age], chk = col.ageCheck(c);
    const res = Object.entries(RES).filter(([r]) => (c.res[r] || 0) > 0.5 || ["wood", "stone", "food", "hide"].includes(r)).map(([r, [n, ic]]) => `<span class="cp-res" title="${n}">${ic} ${Math.floor(c.res[r] || 0)}</span>`).join("");
    const opts = (j) => Object.entries(JOBS).filter(([id]) => id === j || col.jobAllowed(id)).map(([id, J]) => `<option value="${id}"${id === j ? " selected" : ""}>${J.name}</option>`).join("");
    const vill = c.vill.length ? c.vill.map((v) => `<div class="cp-v"><span>${v.name}</span><select data-vid="${v.vid}" data-name="${v.name}">${opts(v.job)}</select></div>`).join("") : `<div class="cp-tip">No one lives here yet. Talk to people in the towns and ask them to join, or build huts and keep food in store: newcomers arrive on their own.</div>`;
    const sites = c.blds.filter((b) => b.built < 1).map((b) => `${BUILD[b.type].name} ${Math.round(b.built * 100)}%`).join(", ");
    const blds = Object.entries(BUILD).filter(([id]) => id !== "stone").map(([id, K]) => [K.name, col.count(c, id)]).filter((x) => x[1]).map(([n, k]) => `${n}${k > 1 ? " ×" + k : ""}`).join(", ");
    const tech = Object.entries(TECH).map(([id, T]) => { const w = col.techCheck(c, id); return `<div class="cp-v"><span>${T.name} <small>${costTxt(col.techCost(id))}</small></span>${w === "Known" ? "<b>✓ Known</b>" : `<button type="button" data-a="tech" data-id="${id}" ${w ? "disabled" : ""}>${w || "Learn"}</button>`}</div>`; }).join("");
    const next = AGES[c.age + 1];
    this.panel.innerHTML = `<div class="cp-box">
      <div class="cp-head"><b>${c.name}</b><button type="button" data-a="close">✕</button></div>
      <div class="cp-age">Age ${c.age + 1}: <b>${A.name}</b> · ${A.tool}<br><i>${A.lore}</i></div>
      <div class="cp-stats">👥 ${col.pop(c)}/${col.housing(c)} · 📦 cap ${col.cap(c)} · 🏠 ${c.blds.length - 1} buildings</div>
      <div class="cp-resrow">${res}</div>
      <div class="cp-btns"><button type="button" data-a="build" class="cp-go">🔨 Build</button><button type="button" data-a="deposit">🎒 Deposit pack</button>${this.o.debug ? `<button type="button" data-a="ff">⏩ +10 min</button>` : ""}</div>
      ${blds ? `<div class="cp-small">Built: ${blds}</div>` : ""}${sites ? `<div class="cp-small">Going up: ${sites}</div>` : ""}
      <h4>People</h4>${vill}
      <h4>Next age${next ? `: ${next.name}` : ""}</h4>
      ${chk.lines.map(([t, ok]) => `<div class="cp-need ${ok ? "ok" : ""}">${ok ? "✓" : "○"} ${t}</div>`).join("")}
      ${next && !chk.stub ? `<button type="button" data-a="age" class="cp-go" ${chk.ok ? "" : "disabled"}>Advance to the ${next.name} age</button>` : ""}
      <h4>Know-how</h4>${tech}
      ${this._insights(c)}
      ${this.o.surv?.()?.tools && !this.o.surv().tools.pick && col.count(c, "workshop") ? `<button type="button" data-a="pick">⛏ Take a stone pick from the workshop (3 stone)</button>` : ""}
    </div>`;
  }
  /** Round 23: insights from the visions, the policy slots, and the Tally ledger. */
  _insights(c) {
    const col = this.col, k = col.know; if (!k.insights.length) return `<h4>Insights</h4><div class="cp-tip">Visions teach new ideas for your people. (Glowing mushrooms grow in dark forests, marsh and caves.)</div>`;
    const pas = k.insights.filter((i) => !INSIGHTS[i].policy), pol = k.insights.filter((i) => INSIGHTS[i].policy), used = k.policies.length, n = col.slots();
    let h = `<h4>Insights</h4>` + pas.map((i) => `<div class="cp-ins"><b>${INSIGHTS[i].icon} ${INSIGHTS[i].name}</b><small>${INSIGHTS[i].desc}</small></div>`).join("");
    if (pol.length) h += `<h4>Policies <small>(${used}/${n} slots${k.insights.includes("council") ? ", +1 Council" : ""}; more slots in later ages)</small></h4>` + pol.map((i) => { const on = k.policies.includes(i); return `<div class="cp-ins pol${on ? " on" : ""}"><b>${INSIGHTS[i].icon} ${INSIGHTS[i].name}</b><small>${INSIGHTS[i].desc}</small><button type="button" data-a="pol" data-id="${i}" ${!on && used >= n ? "disabled" : ""}>${on ? "✓ In force · remove" : used >= n ? "No free slot" : "Adopt"}</button></div>`; }).join("");
    if (col.knows("tally")) {
      const r = col.rates(c), fmt = (v) => (v >= 0 ? "+" : "") + v.toFixed(1);
      h += `<h4>🧮 Ledger <small>(per minute)</small></h4><div class="cp-small">${Object.entries(r).filter(([, v]) => Math.abs(v) > 0.05).map(([res, v]) => `${RES[res][1]} ${fmt(v)}`).join(" · ") || "Nothing coming in yet"}${(c.res.food || 0) > 0 && r.food < 0 ? ` · food lasts ~${Math.floor((c.res.food || 0) / -r.food)} min` : ""}</div>`;
    }
    return h;
  }
  deposit(c) {
    const s = this.o.surv?.(); if (!s) return "";
    const got = {};
    for (const [id, y] of Object.entries(DEPOSIT)) {
      const n = s.count(id); if (!n) continue;
      s.remove(id, n); for (const [r, k] of Object.entries(y)) got[r] = (got[r] || 0) + k * n;
    }
    this.col.deposit(c, got); this.col.save();
    return Object.entries(got).map(([r, n]) => `+${n} ${RES[r][0].toLowerCase()}`).join(", ");
  }
  _panelClick(e) {
    e.stopPropagation();
    const b = e.target.closest("[data-a]"); if (!b) return;
    const c = this.c, a = b.dataset.a, col = this.col;
    if (a === "close") this.close();
    else if (a === "build") this.start("build", c);
    else if (a === "deposit") { const t = this.deposit(c); this.o.toast(t ? `Stored: ${t}` : "Nothing in your pack the settlement can use (logs, flint, hides, food, sinew, ore)", t ? "good" : ""); this.render(); }
    else if (a === "ff") { col.ff(600); this.o.toast("⏩ 10 minutes pass…"); this.render(); }
    else if (a === "age") { if (col.advance(c)) { this.o.toast(`🏛 ${c.name} enters the ${AGES[c.age].name} age! ${AGES[c.age].lore}`, "good"); this.o.onChange?.("age", c); } this.render(); }
    else if (a === "pol") { const id = b.dataset.id, on = !col.know.policies.includes(id), why = col.setPolicy(id, on); this.o.toast(why || `${INSIGHTS[id].name}: ${on ? "adopted" : "set aside"}`, why ? "bad" : "good"); this.render(); }
    else if (a === "tech") { if (col.learnTech(c, b.dataset.id)) this.o.toast(`Your people learn ${TECH[b.dataset.id].name.toLowerCase()}.`, "good"); this.render(); }
    else if (a === "pick") { if ((c.res.stone || 0) >= 3) { c.res.stone -= 3; this.o.surv().tools.pick = true; this.o.toast("You take a stone pick. Strike the ore veins in the caves.", "good"); } else this.o.toast("Not enough stone", "bad"); this.render(); }
  }
}
