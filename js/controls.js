/**
 * Round 24: ☰ → Controls: a reference sheet of every control, for the device you're on
 * (phone / tablet, keyboard & mouse, gamepad); the other devices are a tap away.
 */
export const CONTROLS = {
  touch: [
    ["Move", "Left joystick (push further = faster)"], ["Look", "Drag anywhere on the right side"], ["Sprint", "Push the stick all the way out (uses stamina)"],
    ["Jump", "Jump"], ["Crouch / Crawl", "Crouch, Crawl (tap again to stand)"], ["Torch up / down", "🔥 Torch"], ["Attack", "Stab (or Shoot with the bow)"],
    ["Spear ⇄ Bow", "Bow / Spear"], ["Use / pick up / talk / ride", "The action button (it names the action)"], ["Pack, crafting, skills", "🎒 Pack"],
    ["Tasks (quest log)", "📜 Tasks"], ["Map", "Tap the minimap, or 🗺"], ["Find (mushrooms, water, flint, ore…)", "🔍 by the minimap, or 🔍 Find in the map"], ["Call to Arms (near a hostile town)", "📯 by the minimap"], ["Map filters / hint / beacon / travel", "In the map: Filters, Hint, tap a place"],
    ["1st / 3rd person", "1st person"], ["Mount / dismount, boat", "Ride / Get out"], ["Leave a cave", "🏔 Exit cave"],
    ["Town / building", "🏕 Town button (after you found one)"], ["Menu, Audio, Controls, Multiplayer", "☰"],
  ],
  desktop: [
    ["Move", "W A S D or arrow keys"], ["Look", "Mouse (click the view first)"], ["Walk / jog / run pace", "1 / 2 / 3"], ["Sprint", "Hold Shift (uses stamina)"],
    ["Jump", "Space"], ["Crouch", "C"], ["Crawl", "Z or Ctrl"], ["Torch up / down", "L"], ["Attack", "Left click or R"], ["Spear ⇄ Bow", "Q or B"],
    ["Use / pick up / talk / ride", "E"], ["Pack / Crafting / Skills", "I / Tab / K"], ["Tasks (quest log)", "J"], ["Map", "M"], ["Find (mushrooms, water, flint, ore…)", "F (or 🔍 by the minimap)"], ["Call to Arms (near a hostile town)", "H (or 📯)"],
    ["1st / 3rd person", "V"], ["Time / weather (testing)", "T / Y"], ["Close panels", "Esc"], ["Multiplayer chat / talk", "Enter / hold V (in a room)"],
  ],
  pad: [
    ["Move", "Left stick (push further = faster)"], ["Look", "Right stick"], ["Sprint", "Right trigger or click the left stick"],
    ["Jump", "A"], ["Crouch (again: crawl, again: stand)", "B"], ["Attack", "X"], ["Use / pick up / talk / ride", "Y"],
    ["Spear ⇄ Bow", "LB"], ["Torch up / down", "RB"], ["Map", "Back / View"], ["Pack", "Start / Menu"], ["Tasks", "D-pad up"], ["Find", "D-pad down"], ["Call to Arms", "D-pad left"],
  ],
};
import { STATS, ABILITY } from "./act1/stats.js"; // round 24b: the creature / fighter table
const NAMES = { touch: "📱 Phone / tablet", desktop: "⌨️ Keyboard & mouse", pad: "🎮 Gamepad", beasts: "🐾 Creatures" };
function beastTable() {
  const row = ([k, v]) => `<tr><th>${v.name}</th><td>${"♥".repeat(Math.min(8, v.hp))}${v.hp > 8 ? "+" : ""}</td><td>${v.dmg ? "⚔".repeat(v.dmg) : "–"}</td><td>${v.speed}</td><td title="${v.abilities.map((a) => ABILITY[a]).join(" · ")}">${v.abilities.join(", ")}</td></tr>`;
  return `<table class="cs-beasts"><tr><th></th><td><b>HP</b></td><td><b>Hit</b></td><td><b>m/s</b></td><td><b>Abilities</b></td></tr>${Object.entries(STATS).map(row).join("")}</table>
    <p class="cs-tip">HP = spear hits to bring it down (a flint spear or Strength hits harder). Hit = hearts it takes. Predators stalk, then attack in range; wolves hunt in packs; prey flees. Hostile towns: villagers flee, warriors close in, spear-throwers keep their distance, anyone badly hurt runs. Shields and armour can turn a blow aside.</p>`;
}
export function currentDevice(touch) {
  try { if ([...(navigator.getGamepads?.() || [])].some((g) => g && g.connected)) return "pad"; } catch {}
  return touch ? "touch" : "desktop";
}
export class ControlsSheet {
  constructor(root, { touch, oneFinger = null, setOneFinger = null }) {
    this.touch = touch; this.oneFinger = oneFinger; this.setOneFinger = setOneFinger; // round 25e
    const el = (this.el = document.createElement("div")); el.id = "controls-sheet"; el.className = "hidden";
    root.appendChild(el);
    for (const e of ["pointerdown", "touchstart", "mousedown", "wheel"]) el.addEventListener(e, (ev) => ev.stopPropagation(), { passive: true });
    el.addEventListener("click", (ev) => { ev.stopPropagation(); const t = ev.target.closest("[data-d]"); if (t) this.render(t.dataset.d); if (ev.target.closest(".cs-1f")) { this.setOneFinger?.(!this.oneFinger?.()); this.render(this.dev); } if (ev.target.closest(".cs-close") || ev.target === el) this.close(); });
  }
  get isOpen() { return !this.el.classList.contains("hidden"); }
  open(dev) { if (document.pointerLockElement) document.exitPointerLock(); this.render(dev || currentDevice(this.touch)); this.el.classList.remove("hidden"); }
  close() { this.el.classList.add("hidden"); }
  /** Round 25e: the One-finger steering switch (phones). */
  _oneFingerRow() {
    const on = !!this.oneFinger();
    return `<div class="cs-opt"><button type="button" class="cs-1f ${on ? "on" : ""}" aria-pressed="${on}">👆 One-finger steering: <b>${on ? "On" : "Off"}</b></button>
      <small>${on ? "The stick does it all: up / down walks, left / right turns Kra and the camera. Drag anywhere else to look around; the view swings back behind Kra as you walk." : "Two-finger mode: the stick moves, a second finger on the right side turns the camera."}</small></div>`;
  }
  _rows(dev) {
    if (dev !== "touch" || !this.oneFinger?.()) return CONTROLS[dev];
    return CONTROLS.touch.map(([a, b]) => a === "Move" ? ["Move & turn", "Joystick: up / down = walk (further = faster), left / right = turn"] : a === "Look" ? ["Look around", "Drag anywhere else (the view eases back behind Kra as you walk)"] : [a, b]);
  }
  render(dev) {
    this.dev = dev;
    this.el.innerHTML = `<div class="cs-box"><div class="cs-head"><h3>Controls</h3><button type="button" class="cs-close" aria-label="Close">✕</button></div>
      <div class="cs-tabs">${[...Object.keys(CONTROLS), "beasts"].map((d) => `<button type="button" data-d="${d}" class="${d === dev ? "on" : ""}">${NAMES[d]}${d === currentDevice(this.touch) ? " · yours" : ""}</button>`).join("")}</div>
      ${dev === "touch" && this.oneFinger ? this._oneFingerRow() : ""}
      ${dev === "beasts" ? beastTable() : `<table>${this._rows(dev).map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join("")}</table>`}
      <p class="cs-tip">Want a guided tour? ☰ → Tutorial.</p></div>`;
  }
}
