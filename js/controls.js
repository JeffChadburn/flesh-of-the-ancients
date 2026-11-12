/**
 * Round 24: ☰ → Controls: a reference sheet of every control, for the device you're on
 * (phone / tablet, keyboard & mouse, gamepad); the other devices are a tap away.
 */
export const CONTROLS = {
  touch: [
    ["Move", "Left joystick (push further = faster)"], ["Look", "Drag anywhere on the right side"], ["Sprint", "Push the stick all the way out (uses stamina)"],
    ["Jump", "Jump"], ["Crouch / Crawl", "Crouch, Crawl (tap again to stand)"], ["Torch up / down", "🔥 Torch"], ["Attack", "Stab (or Shoot with the bow)"],
    ["Spear ⇄ Bow", "Bow / Spear"], ["Use / pick up / talk / ride", "The action button (it names the action)"], ["Pack, crafting, skills", "🎒 Pack"],
    ["Tasks (quest log)", "📜 Tasks"], ["Map", "Tap the minimap, or 🗺"], ["Map filters / hint / beacon / travel", "In the map: Filters, Hint, tap a place"],
    ["1st / 3rd person", "1st person"], ["Mount / dismount, boat", "Ride / Get out"], ["Leave a cave", "🏔 Exit cave"],
    ["Town / building", "🏕 Town button (after you found one)"], ["Menu, Audio, Controls, Multiplayer", "☰"],
  ],
  desktop: [
    ["Move", "W A S D or arrow keys"], ["Look", "Mouse (click the view first)"], ["Walk / jog / run pace", "1 / 2 / 3"], ["Sprint", "Hold Shift (uses stamina)"],
    ["Jump", "Space"], ["Crouch", "C"], ["Crawl", "Z or Ctrl"], ["Torch up / down", "L"], ["Attack", "Left click or F"], ["Spear ⇄ Bow", "Q or B"],
    ["Use / pick up / talk / ride", "E"], ["Pack / Crafting / Skills", "I / Tab / K"], ["Tasks (quest log)", "J"], ["Map", "M"],
    ["1st / 3rd person", "V"], ["Time / weather (testing)", "T / Y"], ["Close panels", "Esc"], ["Multiplayer chat / talk", "Enter / hold V (in a room)"],
  ],
  pad: [
    ["Move", "Left stick (push further = faster)"], ["Look", "Right stick"], ["Sprint", "Right trigger or click the left stick"],
    ["Jump", "A"], ["Crouch (again: crawl, again: stand)", "B"], ["Attack", "X"], ["Use / pick up / talk / ride", "Y"],
    ["Spear ⇄ Bow", "LB"], ["Torch up / down", "RB"], ["Map", "Back / View"], ["Pack", "Start / Menu"], ["Tasks", "D-pad up"],
  ],
};
const NAMES = { touch: "📱 Phone / tablet", desktop: "⌨️ Keyboard & mouse", pad: "🎮 Gamepad" };
export function currentDevice(touch) {
  try { if ([...(navigator.getGamepads?.() || [])].some((g) => g && g.connected)) return "pad"; } catch {}
  return touch ? "touch" : "desktop";
}
export class ControlsSheet {
  constructor(root, { touch }) {
    this.touch = touch;
    const el = (this.el = document.createElement("div")); el.id = "controls-sheet"; el.className = "hidden";
    root.appendChild(el);
    for (const e of ["pointerdown", "touchstart", "mousedown", "wheel"]) el.addEventListener(e, (ev) => ev.stopPropagation(), { passive: true });
    el.addEventListener("click", (ev) => { ev.stopPropagation(); const t = ev.target.closest("[data-d]"); if (t) this.render(t.dataset.d); if (ev.target.closest(".cs-close") || ev.target === el) this.close(); });
  }
  get isOpen() { return !this.el.classList.contains("hidden"); }
  open(dev) { if (document.pointerLockElement) document.exitPointerLock(); this.render(dev || currentDevice(this.touch)); this.el.classList.remove("hidden"); }
  close() { this.el.classList.add("hidden"); }
  render(dev) {
    this.dev = dev;
    this.el.innerHTML = `<div class="cs-box"><div class="cs-head"><h3>Controls</h3><button type="button" class="cs-close" aria-label="Close">✕</button></div>
      <div class="cs-tabs">${Object.keys(CONTROLS).map((d) => `<button type="button" data-d="${d}" class="${d === dev ? "on" : ""}">${NAMES[d]}${d === currentDevice(this.touch) ? " · yours" : ""}</button>`).join("")}</div>
      <table>${CONTROLS[dev].map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join("")}</table>
      <p class="cs-tip">Want a guided tour? ☰ → Tutorial.</p></div>`;
  }
}
