/**
 * DOM UI for Act 1: survival meters, faces, clock/weather, objective tracker, interact prompt
 * (+ phone Interact button), dialogue box, inventory / crafting / skills panel, choice dialogs,
 * title cards, toasts and the main menu. Built here so index.html stays small.
 */
import { ITEMS, SKILLS, RECIPES, TREE, GEAR } from "./survival.js";
import { StoryVoice } from "./voice.js";
import { Inspector } from "./inspect.js";

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const ITEM_COLORS = { berries: "#7a1f3a", roots: "#8a6a3a", meat: "#9a3a34", cooked: "#8a5a2a", organ: "#6a1018", pelt: "#8a7a64", hide: "#7a5636", feather: "#4a4a54", skin: "#6a4a3c", blood: "#5a0808", morgan: "#3a0a2a",
  bone: "#cfc3a6", sinew: "#9a6a52", flint: "#6a7484", ochre: "#a8401c", herbs: "#4a7a3a", salve: "#8a7a4a", logs: "#7a5a3a", copper: "#3a8a6a", shroom: "#e040d0", tin: "#a8acb0", iron: "#8a4a2a", coal: "#2a2a2c" };

export class StoryUI {
  constructor(root, { touch = false } = {}) {
    this.voice = new StoryVoice(); // round 13: spoken dialogue (Web Speech), subtitles optional
    this.root = root; this.touch = touch;
    const hud = document.getElementById("hud");
    this.clock = el("div", "clock-line"); hud.appendChild(this.clock);
    this.meters = el("div", "meters hidden", `
      <div class="meter" data-k="hunger"><span>Hunger</span><i><b></b></i></div>
      <div class="meter" data-k="thirst"><span>Thirst</span><i><b></b></i></div>
      <div class="meter" data-k="stamina"><span>Stamina</span><i><b></b></i></div>
      <div class="faces-line"></div>`);
    hud.appendChild(this.meters);
    this.bars = {}; for (const k of ["hunger", "thirst", "stamina"]) this.bars[k] = this.meters.querySelector(`[data-k=${k}] b`);
    this.facesEl = this.meters.querySelector(".faces-line");
    this.obj = el("div", "objective hidden"); root.appendChild(this.obj);
    this.prompt = el("div", "act-prompt hidden"); root.appendChild(this.prompt);
    this.actBtn = el("button", "act-btn hidden", "Use"); this.actBtn.type = "button"; root.appendChild(this.actBtn);
    // Round 13: a side rail with the tasks button (objective tracker folds into it) and the pack.
    this.rail = el("div", "side-rail hidden"); root.appendChild(this.rail);
    this.tasksBtn = el("button", "rail-btn tasks-btn", `<span class="ic">&#128220;</span><span class="lb">Tasks</span><i class="badge hidden"></i>`);
    this.tasksBtn.type = "button"; this.tasksBtn.setAttribute("aria-label", "Tasks"); this.tasksBtn.title = "Tasks (J)"; this.rail.appendChild(this.tasksBtn);
    this.invBtn = el("button", "rail-btn inv-btn hidden", `<span class="ic">&#127890;</span><span class="lb">Pack</span>`); this.invBtn.type = "button"; this.invBtn.setAttribute("aria-label", "Pack"); this.rail.appendChild(this.invBtn);
    this.tasksOpen = !touch; // desktop: open by default; phone: folded into the button
    this.obj.classList.toggle("open", this.tasksOpen);
    this.tasksBtn.addEventListener("click", (ev) => { ev.stopPropagation(); this.toggleTasks(); });
    this.obj.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const t = ev.target.closest?.("[data-track]");
      if (t) { this.onTrack?.(t.dataset.track); this._objKey = null; return; } // round 16: pick the tracked quest
      if (ev.target.closest?.("[data-hint]")) { if (this.touch) this.toggleTasks(false); this.onHint?.(); return; } // round 17
      this.toggleTasks(false);
    });
    this.dialog = el("div", "dialog hidden", `<div class="who"></div><div class="line"></div><div class="more">${touch ? "Tap" : "E / click"} to continue</div>`); root.appendChild(this.dialog);
    this.panel = el("div", "panel hidden", `<div class="tabs"><button data-t="inv">Inventory <kbd>I</kbd></button><button data-t="craft">Crafting <kbd>Tab</kbd></button><button data-t="skills">Skills <kbd>K</kbd></button><button class="close">✕</button></div><div class="body"></div>`);
    root.appendChild(this.panel);
    this.choice = el("div", "choice hidden"); root.appendChild(this.choice);
    this.card = el("div", "title-card hidden"); root.appendChild(this.card);
    this.toasts = el("div", "toasts"); root.appendChild(this.toasts);
    this.menu = el("div", "main-menu hidden"); root.appendChild(this.menu);
    for (const e of [this.actBtn, this.rail, this.obj, this.dialog, this.panel, this.choice, this.menu, this.card]) {
      e.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      e.addEventListener("click", (ev) => ev.stopPropagation());
    }
    this.panel.querySelectorAll(".tabs button[data-t]").forEach((b) => b.addEventListener("click", () => this.openPanel(b.dataset.t)));
    this.panel.querySelector(".close").addEventListener("click", () => this.closePanel());
    this.tab = null;
    this.onPanelAction = null; // (action, id) => void
    this.inspector = new Inspector(root); this.onInspect = null; // round 17
    this.dialogQueue = []; this.onDialogDone = null;
    this.dialog.addEventListener("click", () => this.advance());
  }

  get modal() { return !this.panel.classList.contains("hidden") || !this.choice.classList.contains("hidden") || !this.dialog.classList.contains("hidden") || !this.menu.classList.contains("hidden"); }

  setStoryVisible(on) {
    this.meters.classList.toggle("hidden", !on);
    this.obj.classList.toggle("hidden", !on);
    this.rail.classList.toggle("hidden", !on);
    this.tasksBtn.classList.remove("hidden");
    this.invBtn.classList.toggle("hidden", !on || !this.touch);
  }

  setClock(text) { this.clock.textContent = text; }

  meterUpdate(s) {
    for (const k of ["hunger", "thirst", "stamina"]) {
      const v = Math.max(0, Math.min(100, s[k]));
      const b = this.bars[k];
      b.style.width = v.toFixed(0) + "%";
      b.parentElement.parentElement.classList.toggle("low", v < 20 || (k === "stamina" && s.exhausted));
    }
    this.facesEl.textContent = s.faces ? `Face suit: ${s.faces} face${s.faces > 1 ? "s" : ""}  (+${s.faces} armour)` : "";
  }

  /** Round 13: open / close the objective panel (phone: it closes on its own after a few seconds). */
  toggleTasks(on = !this.tasksOpen, autoClose = this.touch ? 7 : 0) {
    this.tasksOpen = on;
    this.obj.classList.toggle("open", on);
    this.tasksBtn.classList.toggle("active", on);
    if (on) this.tasksBtn.querySelector(".badge").classList.add("hidden");
    clearTimeout(this._tasksT);
    if (on && autoClose) this._tasksT = setTimeout(() => this.toggleTasks(false), autoClose * 1000);
  }

  /** Round 16: free play shows the pack button only (no tasks). */
  setSandbox(on) {
    this.rail.classList.toggle("hidden", !on);
    this.tasksBtn.classList.toggle("hidden", on);
    this.invBtn.classList.toggle("hidden", !on || !this.touch);
    this.obj.classList.add("hidden");
  }

  setObjective(title, lines = [], extra = "") {
    const key = title + "|" + lines.map((l) => l[0] + (l[1] ? 1 : 0)).join("|") + extra;
    if (key === this._objKey) return;
    const newStep = this._objTitle !== undefined && title !== this._objTitle;
    const changed = this._objKey !== undefined;
    this._objKey = key; this._objTitle = title;
    // a new task (or a ticked line): pop the panel open briefly on phones, badge the button
    if (changed && this.touch && !this.tasksOpen) { if (newStep) this.toggleTasks(true, 4.5); else this.tasksBtn.querySelector(".badge").classList.remove("hidden"); }
    this.obj.innerHTML = `<div class="o-title">${title}<button class="q-hint" type="button" data-hint="1" title="Show me where to go">💡 Hint</button></div>` + lines.map(([t, done]) => `<div class="o-line${done ? " done" : ""}">${done ? "✓" : "•"} ${t}</div>`).join("") + (extra ? `<div class="q-extra">${extra}</div>` : "");
  }

  setPrompt(text, big = null) {
    if (!text) { this.prompt.classList.add("hidden"); this.actBtn.classList.add("hidden"); this._prompt = null; return; }
    if (text !== this._prompt) {
      this._prompt = text;
      this.prompt.innerHTML = this.touch ? text : `<kbd>E</kbd> ${text}`;
      this.actBtn.textContent = big || text.split(" ")[0];
      this.actBtn.classList.toggle("big", !!big); // round 17: story beats get a big, glowing button
      this.prompt.classList.toggle("big", !!big);
    }
    this.prompt.classList.remove("hidden");
    this.actBtn.classList.toggle("hidden", !this.touch);
  }

  toast(text, kind = "") {
    const t = el("div", "toast " + kind, text);
    this.toasts.appendChild(t);
    setTimeout(() => t.classList.add("out"), 2600);
    setTimeout(() => t.remove(), 3300);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
  }

  /** Show dialogue lines [{who, text}] one by one; onLine(i) fires as each appears. */
  say(lines, onDone, onLine) {
    this.dialogQueue = lines.slice(); this.onDialogDone = onDone; this.onLine = onLine; this._li = 0;
    this.dialog.classList.remove("hidden");
    this.advance(true);
  }
  /** Show the current line as plain text waiting for a tap (voice turned off / unavailable). */
  textOnly() {
    clearTimeout(this._autoT);
    this.dialog.classList.remove("spoken", "nosubs");
    this.dialog.querySelector(".more").textContent = this.touch ? "Tap to continue" : "E / click to continue";
  }
  advance(first = false) {
    if (this.dialog.classList.contains("hidden")) return false;
    if (!first && performance.now() - (this._lineAt || 0) < 350) return true;
    clearTimeout(this._autoT);
    this.voice.stop(false); // a tap skips the rest of the spoken line
    const next = this.dialogQueue.shift();
    if (!next) { this.dialog.classList.add("hidden"); const f = this.onDialogDone; this.onDialogDone = null; f?.(); return true; }
    this.dialog.querySelector(".who").textContent = next.who || "";
    this.dialog.querySelector(".line").textContent = next.text;
    this.dialog.classList.toggle("narration", !next.who);
    // Round 13: speak the line; when it ends (plus a short pause) the next one follows by itself.
    const spoken = this.voice.speak(next.text, next.voice || next.who || "", (why) => {
      if (this.voice.broken) { this.textOnly(); return; } // speech failed: leave the line up to read
      this._autoT = setTimeout(() => { if (!this.dialog.classList.contains("hidden")) this.advance(true); }, 700);
    });
    this.dialog.classList.toggle("spoken", spoken);
    this.dialog.classList.toggle("nosubs", spoken && !this.voice.subtitles); // text only ever hides while it is being heard
    this.dialog.querySelector(".more").textContent = spoken ? (this.touch ? "Tap to skip" : "E / click to skip") : (this.touch ? "Tap to continue" : "E / click to continue");
    this._lineAt = performance.now();
    this.onLine?.(this._li++, next);
    return true;
  }

  /** Modal choice: options [{id, label, desc}] -> onPick(id). */
  ask(title, text, options, onPick, cancellable = true) {
    this.choice.innerHTML = `<h3>${title}</h3><p>${text}</p><div class="opts"></div>` + (cancellable ? `<button class="cancel">Not now</button>` : "");
    const box = this.choice.querySelector(".opts");
    for (const o of options) {
      const b = el("button", "opt", `<strong>${o.label}</strong>${o.desc ? `<small>${o.desc}</small>` : ""}${o.svg || ""}`);
      b.type = "button"; b.dataset.id = o.id;
      b.addEventListener("click", () => { this.choice.classList.add("hidden"); onPick(o.id); });
      box.appendChild(b);
    }
    this.choice.querySelector(".cancel")?.addEventListener("click", () => this.choice.classList.add("hidden"));
    this.choice.classList.remove("hidden");
  }
  closeChoice() { this.choice.classList.add("hidden"); }

  openPanel(tab, surv = this._surv) {
    this._surv = surv;
    this.tab = tab;
    this.panel.classList.remove("hidden");
    this.panel.querySelectorAll(".tabs button[data-t]").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
    this.renderPanel();
  }
  closePanel() { this.panel.classList.add("hidden"); this.tab = null; }
  togglePanel(tab, surv) { if (!this.panel.classList.contains("hidden") && this.tab === tab) this.closePanel(); else this.openPanel(tab, surv); }

  renderPanel() {
    const s = this._surv, body = this.panel.querySelector(".body");
    if (!s || !this.tab) return;
    if (this.tab === "inv") {
      let h = `<div class="inv-head">${s.inv.length} / ${s.slots} slots${s.slots > 6 ? " (backpack)" : ""} · Tools: ${s.tools.knife ? "stone knife" : "—"}${s.tools.spear ? ", " + (s.tools.spearDone ? "bone spear" : "half-finished bone spear") : ""}</div><div class="grid">`;
      for (let i = 0; i < s.slots; i++) {
        const it = s.inv[i];
        if (!it) { h += `<div class="slot empty"></div>`; continue; }
        const d = ITEMS[it.id];
        const act = it.id === "shroom" ? `<button data-a="shroom" data-id="shroom">Eat</button>` : d.food ? `<button data-a="eat" data-id="${it.id}">Eat</button>` : it.id === "morgan" ? `<button data-a="eatm" data-id="morgan">Eat</button>` : d.heal ? `<button data-a="use" data-id="${it.id}">Use</button>` : "";
        h += `<div class="slot" data-insp="${it.id}" data-n="${it.n}"><i style="background:${ITEM_COLORS[it.id] || "#555"}"></i><span>${d.name}</span><em>×${it.n}</em>${s.inspected?.has(it.id) ? "" : `<b class="new-dot" title="Not inspected yet">ⓘ</b>`}${act}</div>`;
      }
      h += "</div>";
      // round 17: inspect what you carry that isn't a slot item
      const extras = [s.faces ? ["facesuit", `🎭 Face suit (${s.faces})`] : null, s.tools.knife ? ["knife", "🔪 Stone knife"] : null, s.tools.spear ? ["spear", "🦴 Spear"] : null].filter(Boolean);
      if (extras.length) h += `<div class="inv-head">Worn &amp; tools (tap to inspect)</div><div class="gear-row">` + extras.map(([id, l]) => `<button class="gear insp" data-insp="${id}">${l} ⓘ</button>`).join("") + "</div>";
      h += `<div class="inv-tip">Tap an item to inspect it.</div>`;
      if (this.tripOn?.()) h += `<button class="trip-end-btn" data-a="endtrip">🍄 End the vision (fade out now)</button>`; // round 21
      // round 16: clothing (Wear / Remove)
      const owned = Object.keys(GEAR).filter((g) => s.crafted.has(g));
      if (owned.length) h += `<div class="inv-head">Clothing</div><div class="gear-row">` + owned.map((g) => `<button class="gear${s.wear.has(g) ? " on" : ""}" data-a="wear" data-id="${g}">${s.wear.has(g) ? "✓ " : ""}${GEAR[g]}</button><button class="gear insp" data-insp="${g}" aria-label="Inspect ${GEAR[g]}">ⓘ</button>`).join("") + "</div>";
      body.innerHTML = h;
    } else if (this.tab === "craft") {
      const known = RECIPES.filter((r) => s.knows(r)), locked = RECIPES.filter((r) => !s.knows(r));
      body.innerHTML = known.map((r) => {
        const done = r.once && s.crafted.has(r.id), can = s.canCraft(r);
        const need = r.needs.map(([id, n]) => `<span class="${s.count(id) >= n ? "have" : "miss"}">${n} ${ITEMS[id].name} (${s.count(id)})</span>`).join(r.anyOf ? " <em>or</em> " : " + ");
        return `<div class="recipe${done ? " done" : ""}"><strong>${r.name}</strong><small>${r.desc}</small><small>Needs: ${need}${s.tools.knife ? "" : " · a knife"}</small>${done ? "<b>Made</b>" : `<button data-a="craft" data-id="${r.id}" ${can ? "" : "disabled"}>Craft</button>`}</div>`;
      }).join("") + (locked.length ? `<div class="inv-head">Not learned yet (skills or quests teach these)</div>` + locked.map((r) => `<div class="recipe locked"><strong>${r.name}</strong><small>${r.desc}</small><b>🔒</b></div>`).join("") : "")
        + `<div class="inv-head">Materials: animals (bone, sinew, hide, pelt), storage baskets in towns, flint / ochre in caves.</div>`;
    } else if (this.tab === "skills" && this.questDone) {
      // round 16: skill tree (4 branches x 3 tiers)
      const lvl = s.level, into = s.xp % 100;
      let h = `<div class="xp-line">Level ${lvl} · <i class="xpbar"><b style="width:${into}%"></b></i> ${into}/100 XP · <strong>${s.sp}</strong> skill point${s.sp === 1 ? "" : "s"}</div><div class="tree">`;
      for (const [bid, b] of Object.entries(TREE)) {
        h += `<div class="branch"><div class="b-name">${b.icon} ${b.name}</div>`;
        for (const t of b.tiers) {
          const why = s.learnBlock(t.id, this.questDone);
          const has = s.skills.has(t.id);
          h += `<div class="tier${has ? " on" : why ? " locked" : " can"}"><strong>${t.name}</strong><small>${t.desc}</small>${has ? "<b>Learned</b>" : why ? `<em>${why}</em>` : `<button data-a="learn" data-id="${t.id}">Learn (1 pt)</button>`}</div>`;
        }
        h += "</div>";
      }
      h += "</div>";
      const base = Object.entries(SKILLS).filter(([id]) => s.skills.has(id)).map(([, k]) => k.name).join(" · ");
      body.innerHTML = h + `<div class="skill stats"><small>Abilities: ${base || "none yet"}<br>Strength +${s.str} · Health bonus +${s.hpBonus} · Faces ${s.faces}</small></div>`;
    } else {
      body.innerHTML = Object.entries(SKILLS).map(([id, k]) => `<div class="skill${s.skills.has(id) ? " on" : ""}"><strong>${k.name}</strong><small>${k.desc}</small><b>${s.skills.has(id) ? "Learned" : "Locked"}</b></div>`).join("")
        + `<div class="skill stats"><small>Strength +${s.str} · Health bonus +${s.hpBonus} · Faces ${s.faces}</small></div>`;
    }
    body.querySelectorAll("button[data-a]").forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); this.onPanelAction?.(b.dataset.a, b.dataset.id); this.renderPanel(); }));
    body.querySelectorAll("[data-insp]").forEach((b) => b.addEventListener("click", () => this.inspect(b.dataset.insp, +(b.dataset.n || 1))));
  }

  /** Round 17: open the Inspect view (3D model + lore); the story gives the first-look XP. */
  inspect(id, n = 1) {
    const r = this.inspector.open(id, n);
    this.onInspect?.(id, r);
    setTimeout(() => this.renderPanel(), 0);
    return r;
  }

  titleCard(title, sub, ms = 4200) {
    this.card.innerHTML = `<h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}`;
    this.card.classList.remove("hidden", "out");
    clearTimeout(this._cardT); clearTimeout(this._cardT2);
    this._cardT = setTimeout(() => this.card.classList.add("out"), ms);
    this._cardT2 = setTimeout(() => this.card.classList.add("hidden"), ms + 1300);
  }

  showMenu({ canContinue, onContinue, onNew, onFree }) {
    this.menu.innerHTML = `<div class="mm"><h1>Flesh of the Ancients</h1><p class="sub">Act I · The Empty Camp</p>
      ${canContinue ? `<button data-m="cont">Continue</button>` : ""}<button data-m="new">New Game</button><button data-m="free">Free Play <small>(hills &amp; caves, no story)</small></button></div>`;
    this.menu.classList.remove("hidden");
    const go = (f) => () => { this.menu.classList.add("hidden"); f(); };
    this.menu.querySelector("[data-m=cont]")?.addEventListener("click", go(onContinue));
    this.menu.querySelector("[data-m=new]").addEventListener("click", go(onNew));
    this.menu.querySelector("[data-m=free]").addEventListener("click", go(onFree));
  }
  hideMenu() { this.menu.classList.add("hidden"); }
}
