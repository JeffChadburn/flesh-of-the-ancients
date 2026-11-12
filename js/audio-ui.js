/**
 * Round 23: ☰ → Audio. Master / Music / Effects / Voices / Ambience sliders (saved by CaveAudio).
 * Master goes to 300% (a compressor + limiter on the master bus keeps it from clipping).
 */
import { VOL_DEFAULTS } from "./audio.js";

const ROWS = [
  ["master", "Master", 300, "Everything. Above 100% is a boost (kept clean by a limiter)."],
  ["music", "Music", 200, "The score and the mushroom-trip music."],
  ["effects", "Effects", 200, "Steps, weapons, animals, splashes, the things in the dark."],
  ["voices", "Voices", 200, "Spoken story lines (max out at 100%) and other players' voice chat."],
  ["ambience", "Ambience", 200, "Wind, rain, birds, crickets, water, cave drips."],
];

export class AudioPanel {
  constructor(root, audio, { onTestVoice } = {}) {
    this.audio = audio;
    const el = (this.el = document.createElement("div"));
    el.id = "audio-panel"; el.className = "hidden";
    el.innerHTML = `<div class="mp-box au-box"><button class="mp-x" type="button" aria-label="Close">✕</button><h3>Audio</h3>
      <p class="mp-st">Too quiet? Push Master past 100%.</p>
      ${ROWS.map(([k, name, max, tip]) => `<label class="au-row" title="${tip}"><span>${name}</span><input type="range" min="0" max="${max}" step="5" data-k="${k}" aria-label="${name} volume"><b data-v="${k}"></b></label>`).join("")}
      <div class="mp-row"><button type="button" data-a="test">▶ Test sound</button><button type="button" data-a="voice">🗣 Test voice</button><button type="button" data-a="reset">Reset</button></div></div>`;
    root.appendChild(el);
    for (const e of ["pointerdown", "pointerup", "click", "touchstart", "wheel", "keydown"]) el.addEventListener(e, (ev) => ev.stopPropagation(), { passive: true });
    el.addEventListener("click", (e) => { if (e.target === el) this.close(); });
    el.querySelector(".mp-x").addEventListener("click", () => this.close());
    el.querySelectorAll("input[type=range]").forEach((r) => r.addEventListener("input", () => { audio.setVol(r.dataset.k, +r.value); this._labels(); }));
    el.querySelector('[data-a="test"]').addEventListener("click", async () => { await audio.resume?.(); audio.bowShot?.(); setTimeout(() => audio.arrowHit?.(true), 260); });
    el.querySelector('[data-a="voice"]').addEventListener("click", () => onTestVoice?.());
    el.querySelector('[data-a="reset"]').addEventListener("click", () => { audio.resetVol(); this.sync(); });
  }
  get isOpen() { return !this.el.classList.contains("hidden"); }
  sync() { this.el.querySelectorAll("input[type=range]").forEach((r) => (r.value = this.audio.vol[r.dataset.k] ?? VOL_DEFAULTS[r.dataset.k])); this._labels(); }
  _labels() { this.el.querySelectorAll("[data-v]").forEach((b) => (b.textContent = (this.audio.vol[b.dataset.v] ?? 0) + "%")); }
  open() { this.sync(); this.el.classList.remove("hidden"); }
  close() { this.el.classList.add("hidden"); }
}
