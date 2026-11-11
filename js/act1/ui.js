/**
 * DOM UI for Act 1: survival meters, faces, clock/weather, objective tracker, interact prompt
 * (+ phone Interact button), dialogue box, inventory / crafting / skills panel, choice dialogs,
 * title cards, toasts and the main menu. Built here so index.html stays small.
 */
import { ITEMS, SKILLS, RECIPES } from "./survival.js";

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const ITEM_COLORS = { berries: "#7a1f3a", roots: "#8a6a3a", meat: "#9a3a34", cooked: "#8a5a2a", organ: "#6a1018", pelt: "#8a7a64", hide: "#7a5636", feather: "#4a4a54", skin: "#6a4a3c", blood: "#5a0808", morgan: "#3a0a2a" };

export class StoryUI {
  constructor(root, { touch = false } = {}) {
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
    this.invBtn = el("button", "inv-btn hidden", "Pack"); this.invBtn.type = "button"; root.appendChild(this.invBtn);
    this.dialog = el("div", "dialog hidden", `<div class="who"></div><div class="line"></div><div class="more">${touch ? "Tap" : "E / click"} to continue</div>`); root.appendChild(this.dialog);
    this.panel = el("div", "panel hidden", `<div class="tabs"><button data-t="inv">Inventory <kbd>I</kbd></button><button data-t="craft">Crafting <kbd>Tab</kbd></button><button data-t="skills">Skills <kbd>K</kbd></button><button class="close">✕</button></div><div class="body"></div>`);
    root.appendChild(this.panel);
    this.choice = el("div", "choice hidden"); root.appendChild(this.choice);
    this.card = el("div", "title-card hidden"); root.appendChild(this.card);
    this.toasts = el("div", "toasts"); root.appendChild(this.toasts);
    this.menu = el("div", "main-menu hidden"); root.appendChild(this.menu);
    for (const e of [this.actBtn, this.invBtn, this.dialog, this.panel, this.choice, this.menu, this.card]) {
      e.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      e.addEventListener("click", (ev) => ev.stopPropagation());
    }
    this.panel.querySelectorAll(".tabs button[data-t]").forEach((b) => b.addEventListener("click", () => this.openPanel(b.dataset.t)));
    this.panel.querySelector(".close").addEventListener("click", () => this.closePanel());
    this.tab = null;
    this.onPanelAction = null; // (action, id) => void
    this.dialogQueue = []; this.onDialogDone = null;
    this.dialog.addEventListener("click", () => this.advance());
  }

  get modal() { return !this.panel.classList.contains("hidden") || !this.choice.classList.contains("hidden") || !this.dialog.classList.contains("hidden") || !this.menu.classList.contains("hidden"); }

  setStoryVisible(on) {
    this.meters.classList.toggle("hidden", !on);
    this.obj.classList.toggle("hidden", !on);
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

  setObjective(title, lines = []) {
    this.obj.innerHTML = `<div class="o-title">${title}</div>` + lines.map(([t, done]) => `<div class="o-line${done ? " done" : ""}">${done ? "✓" : "•"} ${t}</div>`).join("");
  }

  setPrompt(text) {
    if (!text) { this.prompt.classList.add("hidden"); this.actBtn.classList.add("hidden"); this._prompt = null; return; }
    if (text !== this._prompt) {
      this._prompt = text;
      this.prompt.innerHTML = this.touch ? text : `<kbd>E</kbd> ${text}`;
      this.actBtn.textContent = text.split(" ")[0];
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
  advance(first = false) {
    if (this.dialog.classList.contains("hidden")) return false;
    if (!first && performance.now() - (this._lineAt || 0) < 350) return true;
    const next = this.dialogQueue.shift();
    if (!next) { this.dialog.classList.add("hidden"); const f = this.onDialogDone; this.onDialogDone = null; f?.(); return true; }
    this.dialog.querySelector(".who").textContent = next.who || "";
    this.dialog.querySelector(".line").textContent = next.text;
    this.dialog.classList.toggle("narration", !next.who);
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
        const act = d.food ? `<button data-a="eat" data-id="${it.id}">Eat</button>` : it.id === "morgan" ? `<button data-a="eatm" data-id="morgan">Eat</button>` : "";
        h += `<div class="slot"><i style="background:${ITEM_COLORS[it.id] || "#555"}"></i><span>${d.name}</span><em>×${it.n}</em>${act}</div>`;
      }
      body.innerHTML = h + "</div>";
    } else if (this.tab === "craft") {
      body.innerHTML = RECIPES.map((r) => {
        const done = s.crafted.has(r.id), can = s.canCraft(r);
        const need = r.needs.map(([id, n]) => `${n} ${ITEMS[id].name} (${s.count(id)})`).join(r.anyOf ? " <em>or</em> " : " + ");
        return `<div class="recipe${done ? " done" : ""}"><strong>${r.name}</strong><small>${r.desc}</small><small>Needs: ${need}${s.tools.knife ? "" : " · a knife"}</small>${done ? "<b>Made</b>" : `<button data-a="craft" data-id="${r.id}" ${can ? "" : "disabled"}>Craft</button>`}</div>`;
      }).join("");
    } else {
      body.innerHTML = Object.entries(SKILLS).map(([id, k]) => `<div class="skill${s.skills.has(id) ? " on" : ""}"><strong>${k.name}</strong><small>${k.desc}</small><b>${s.skills.has(id) ? "Learned" : "Locked"}</b></div>`).join("")
        + `<div class="skill stats"><small>Strength +${s.str} · Health bonus +${s.hpBonus} · Faces ${s.faces}</small></div>`;
    }
    body.querySelectorAll("button[data-a]").forEach((b) => b.addEventListener("click", () => { this.onPanelAction?.(b.dataset.a, b.dataset.id); this.renderPanel(); }));
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
