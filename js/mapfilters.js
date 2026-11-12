/**
 * Round 17: what the minimap / big map show (⚙). Saved in localStorage; the default is the
 * uncluttered set (no animal dots, no monster blip).
 */
const KEY = "fota-mapfilters-v1";
export const FILTERS = [
  ["towns", "Towns & villages", true], ["caves", "Cave mouths", true], ["people", "Quest people (! ?)", true],
  ["quest", "Quest / hint marker", true], ["places", "Camp & falls", true], ["water", "Streams", true],
  ["trail", "Your trail (big map)", true], ["labels", "Names", true], ["animals", "Animals (tracking)", false], ["monsters", "Cave creature (close)", false],
];
export const mapFilters = Object.fromEntries(FILTERS.map(([k, , d]) => [k, d]));
try { Object.assign(mapFilters, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(mapFilters)); } catch {} };

let pop = null;
/** Toggle the ⚙ popup under `root` (anchored top-right). onChange() fires after each toggle. */
export function toggleFilters(root, onChange, where = "mini") {
  if (pop && pop.isConnected) { pop.remove(); pop = null; return; }
  pop = document.createElement("div");
  pop.className = "mf-pop " + where;
  pop.innerHTML = `<div class="mf-h">Show on the map <button type="button" class="mf-x" aria-label="Close">✕</button></div>` +
    FILTERS.map(([k, label]) => `<label class="mf-row"><input type="checkbox" data-k="${k}" ${mapFilters[k] ? "checked" : ""}/> ${label}</label>`).join("");
  for (const e of ["pointerdown", "click", "touchstart"]) pop.addEventListener(e, (ev) => ev.stopPropagation(), { passive: true });
  pop.querySelector(".mf-x").addEventListener("click", () => { pop.remove(); pop = null; });
  pop.querySelectorAll("input").forEach((i) => i.addEventListener("change", () => { mapFilters[i.dataset.k] = i.checked; save(); onChange?.(); }));
  root.appendChild(pop);
}
export function setFilter(k, v) { mapFilters[k] = !!v; save(); }
