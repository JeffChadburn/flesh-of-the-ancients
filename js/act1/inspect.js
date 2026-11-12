/**
 * Round 17: Inspect view for the Pack. Tap an item: a small rotatable 3D model (drag / swipe,
 * slowly turns on its own), its name, lore, uses, the recipes that need it and where it comes from.
 * The first look at each item gives a little XP (more, with a lore line, for the story items).
 */
import * as THREE from "three";
import { ITEMS, RECIPES, GEAR } from "./survival.js";

export const LORE = {
  berries: { lore: "Dark berries from the thorn bushes by the camp. Lume taught you which ones sting the tongue and which ones kill.", uses: "Eat for a little food and water. Mixed into salve and face paint.", from: "Berry bushes in the hills (Gather)." },
  roots: { lore: "Pale roots dug from soft earth near water. Bitter, but they fill the belly through a hungry winter.", uses: "Eat for food.", from: "Digging near bushes and streams." },
  meat: { lore: "Still warm. Raw flesh keeps you alive, but fire makes it worth three times as much.", uses: "Eat raw (little food) or cook it at a lit fire.", from: "Butchering a rabbit, deer or boar." },
  cooked: { lore: "Fat crackles on the outside. The smell carries; something in the dark may notice.", uses: "Eat for a lot of food.", from: "Cook raw meat at a fire pit." },
  organ: { lore: "The old hunters ate the heart first, raw, so the animal's run would pass into their legs.", uses: "Eat to refill stamina quickly.", from: "Butchering larger animals." },
  pelt: { lore: "Soft rabbit fur. Three of them and a strip of sinew make a cap against the mountain wind.", uses: "Finish the bone spear; sew a fur hat.", from: "Butchering rabbits." },
  hide: { lore: "A whole deer hide, stiff once it dries. The Ancients wore nothing else.", uses: "Backpack, hide boots and hide cloak.", from: "Butchering deer." },
  feather: { lore: "Grey flight feathers. Two of them make an arrow fly true.", uses: "Fletching for bone arrows.", from: "Birds and storage baskets in towns." },
  skin: { lore: "Tor carried you out of the river when you were small. Now his skin will carry what you need. He would have wanted it used, not left for the crows.", uses: "Sew it into your first backpack (6 → 12 slots).", from: "Taken from Tor at the camp in Act I.", special: true },
  blood: { lore: "Black and slow, it does not dry like animal blood. The old glyphs were painted with it so the creatures would know whose cave it was.", uses: "Paint the glyph on the Waterfall Hollow wall.", from: "The creature in Waterfall Hollow.", special: true },
  morgan: { lore: "It is still twitching. The hunters said a man who eats one stops being only a man.", uses: "Eat it: Blood Memory (permanent strength and health).", from: "The creature in Waterfall Hollow.", special: true },
  bone: { lore: "Clean white bone, hard enough to take an edge. Nothing of a kill is wasted.", uses: "Arrows, the resin torch, spears.", from: "Animals, cave floors, storage baskets." },
  sinew: { lore: "Dried tendon, split into thread. It shrinks as it dries and binds tighter than any vine.", uses: "Binding and sewing: flint spear, boots, cloak, hat, torch.", from: "Larger animals and storage baskets." },
  shroom: { lore: "Pale stems, caps that glow like coals in the dark: blue, pink, green. The old ones called them the First Mouth's teeth: they grow where its breath reaches the surface. Eat one and the spirits open your eyes for a while. The world breathes, melts and sings, and things walk beside you that no one else can see.", uses: "Eat it (Pack): a spirit vision lasting about three and a half minutes. Harmless. You can end it early from the Pack.", from: "Rare: the forest floor, the marsh, the edge of the frozen north, and deep in some caves. Seen patches show on the map as 🍄." },
  copper: { lore: "Green-streaked stone, heavy for its size. In a hot enough fire it bleeds red metal.", uses: "Bring it to your settlement: bronze, the forge.", from: "Ore veins in the caves (needs a pick); miners at a mine entrance." },
  tin: { lore: "Dull grey nuggets. Alone it is soft; with copper it makes bronze.", uses: "Your settlement: bronze.", from: "Ore veins in the caves; miners." },
  iron: { lore: "Rust-red rock that rings when struck.", uses: "Your settlement: the Iron & Steel age.", from: "Ore veins in the caves; miners in the Bronze age and later." },
  coal: { lore: "Black stone that burns hotter than wood.", uses: "Your settlement: iron and steel.", from: "Ore veins in the caves; miners." },
  logs: { lore: "Dry, light deadwood, fallen limbs with the bark peeling. It floats high.", uses: "Four logs and two sinew make a raft (Survival: Herb Lore).", from: "Gather it under trees once you know Herb Lore." },
  flint: { lore: "Grey glassy stone that breaks into edges sharper than any knife you have known.", uses: "Knap a flint-tipped spear head.", from: "Cave floors and storage baskets." },
  ochre: { lore: "Red earth, the colour of the hunters' stripes and of the paintings in the halls.", uses: "Red face paint.", from: "Cave walls and storage baskets." },
  herbs: { lore: "Bitter leaves that numb a wound. The Herb-woman knows a dozen; you know this one.", uses: "Healing salve.", from: "Gathering bushes after learning Herb Lore." },
  salve: { lore: "Crushed herbs in rendered fat, sealed in a clay pot. It smells of smoke and green.", uses: "Use it to heal one heart.", from: "Craft from herbs and berries." },
  facesuit: { lore: "The faces of the dead, stitched edge to edge with sinew. The creatures in the deep caves hesitate before a man who wears the faces of hunters. Every face you add is another death that protects you.", uses: "Worn all the time: each face is +1 armour.", from: "Faces taken from the dead (the first is the hunter in Waterfall Hollow).", special: true, name: "Face suit" },
  knife: { lore: "A flake of stone with a hide-wrapped grip, the first tool you made.", uses: "Butcher animals, cut skin, craft.", from: "Made at the camp in Act I.", name: "Stone knife" },
  spear: { lore: "A long bone point lashed to a straight branch. It keeps the teeth further away.", uses: "Hunting and fighting (longer reach).", from: "Crafted in Act I.", name: "Bone spear" },
  boots: { lore: "Deer hide wrapped round the feet and laced with sinew.", uses: "Worn: sprinting tires you 25% less.", from: "Craft (Hide-Working).", name: GEAR.boots },
  cloak: { lore: "A whole hide over the shoulders. Rain runs off it; so do claws, sometimes.", uses: "Worn: +1 heart.", from: "Craft (Sinew Sewing).", name: GEAR.cloak },
  hat: { lore: "Rabbit pelts sewn in a cap, ears and all.", uses: "Worn: +1 heart.", from: "Craft (Furrier).", name: GEAR.hat },
  paint: { lore: "Ochre and berry juice in the three stripes of the old hunters.", uses: "Worn: stamina comes back 30% faster.", from: "Craft from ochre and berries.", name: GEAR.paint },
};
const COL = { berries: 0x5a1430, roots: 0x8a6a3a, meat: 0xa03a34, cooked: 0x7a4a22, organ: 0x6a1018, pelt: 0x8a7a64, hide: 0x7a5636, feather: 0x6a6a74, skin: 0xb08a72, blood: 0x3a0404, morgan: 0x4a0a32,
  bone: 0xe0d6bc, sinew: 0x9a6a52, flint: 0x5a6474, ochre: 0xa8401c, herbs: 0x3a7a2a, salve: 0x8a6a3a, facesuit: 0xc09a80, knife: 0x7a7a80, spear: 0xd8ccb0, boots: 0x6a4a2a, cloak: 0x7a5636, hat: 0x9a8a70, paint: 0xa8401c };

function model(id) {
  const g = new THREE.Group(), c = COL[id] ?? 0x888888;
  const M = (col = c, o = {}) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.75, metalness: 0, ...o });
  const add = (geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const k = new THREE.Mesh(geo, m); k.position.set(x, y, z); k.rotation.set(rx, ry, rz); g.add(k); return k; };
  const flat = (w, h, col, bend = 0.25) => { const geo = new THREE.PlaneGeometry(w, h, 12, 8); const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, Math.sin(x * 3.1) * bend * 0.3 + Math.cos(y * 2.7) * bend * 0.2 + (Math.random() - 0.5) * 0.03); } geo.computeVertexNormals(); return add(geo, M(col, { side: THREE.DoubleSide })); };
  switch (id) {
    case "berries": for (let i = 0; i < 9; i++) add(new THREE.SphereGeometry(0.16, 14, 10), M(c, { roughness: 0.3 }), Math.cos(i * 2.4) * 0.28 * Math.sqrt(i / 9), (i % 3) * 0.12 - 0.1, Math.sin(i * 2.4) * 0.28 * Math.sqrt(i / 9)); break;
    case "roots": for (let i = 0; i < 3; i++) add(new THREE.ConeGeometry(0.12, 1.1, 8), M(), (i - 1) * 0.18, 0, 0, 0.3 * (i - 1), 0, Math.PI / 2 + (i - 1) * 0.25); break;
    case "meat": case "cooked": case "organ": case "morgan": {
      const geo = new THREE.SphereGeometry(0.5, 24, 16); const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) { const n = 1 + 0.12 * Math.sin(p.getX(i) * 7) * Math.cos(p.getY(i) * 5); p.setXYZ(i, p.getX(i) * n * 1.25, p.getY(i) * n * 0.6, p.getZ(i) * n); }
      geo.computeVertexNormals(); add(geo, M(c, { roughness: id === "cooked" ? 0.85 : 0.35 }));
      if (id === "meat" || id === "cooked") add(new THREE.CylinderGeometry(0.06, 0.07, 0.9, 8), M(0xe8dcc0), 0.25, 0.05, 0, 0, 0, Math.PI / 2);
      if (id === "morgan") for (let i = 0; i < 5; i++) add(new THREE.TorusGeometry(0.12, 0.03, 6, 12), M(0x9a2050, { emissive: 0x400818 }), Math.cos(i) * 0.35, 0.2, Math.sin(i) * 0.3, i, i * 2, 0);
      break; }
    case "pelt": case "hide": case "skin": case "cloak": flat(id === "pelt" ? 0.9 : 1.4, id === "pelt" ? 0.7 : 1.1, c, id === "cloak" ? 0.6 : 0.3).rotation.x = -0.5; break;
    case "feather": for (let i = 0; i < 3; i++) { const f = add(new THREE.SphereGeometry(0.5, 12, 8), M(c), (i - 1) * 0.12, 0, 0, 0, 0, 0.3 * (i - 1)); f.scale.set(0.16, 1, 0.02); } break;
    case "blood": add(new THREE.CylinderGeometry(0.3, 0.38, 0.55, 18), M(0x5a4030), 0, -0.1, 0); add(new THREE.CylinderGeometry(0.27, 0.27, 0.05, 18), M(c, { roughness: 0.1, metalness: 0.2 }), 0, 0.16, 0); break;
    case "bone": case "spear": { add(new THREE.CylinderGeometry(0.07, 0.08, id === "spear" ? 1.8 : 1.0, 10), M(id === "spear" ? 0x6a4a2a : c), 0, 0, 0, 0, 0, 0.3);
      if (id === "bone") { add(new THREE.SphereGeometry(0.13, 10, 8), M(), -0.15, 0.48, 0); add(new THREE.SphereGeometry(0.13, 10, 8), M(), 0.15, -0.48, 0); } else add(new THREE.ConeGeometry(0.1, 0.45, 8), M(c), -0.29, 1.07, 0, 0, 0, 0.3); break; }
    case "sinew": add(new THREE.TorusKnotGeometry(0.3, 0.035, 90, 6, 2, 5), M()); break;
    case "flint": case "knife": { const geo = new THREE.IcosahedronGeometry(0.45, 1); const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (id === "knife" ? 0.4 : 1), p.getY(i) * (id === "knife" ? 1.3 : 0.8), p.getZ(i) * 0.35);
      geo.computeVertexNormals(); add(geo, M(c, { roughness: 0.25, metalness: 0.1, flatShading: true })); if (id === "knife") add(new THREE.CylinderGeometry(0.1, 0.1, 0.4, 8), M(0x5a3a22), 0, -0.6, 0); break; }
    case "ochre": case "paint": add(new THREE.DodecahedronGeometry(0.4, 0), M(c, { flatShading: true })); if (id === "paint") for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.08, 0.5, 0.02), M(0xc03018), (i - 1) * 0.15, 0, 0.42); break;
    case "herbs": for (let i = 0; i < 6; i++) { const l = add(new THREE.SphereGeometry(0.3, 10, 6), M(c), 0, 0, 0, 0, i * 1.05, 0.9); l.scale.set(0.35, 1, 0.08); l.position.set(Math.cos(i) * 0.15, 0.1, Math.sin(i) * 0.15); } break;
    case "salve": add(new THREE.SphereGeometry(0.42, 18, 12), M(0x8a5a3a)).scale.y = 0.8; add(new THREE.CylinderGeometry(0.2, 0.25, 0.2, 14), M(0x6a4a2a), 0, 0.38, 0); break;
    case "boots": for (const s of [-1, 1]) { add(new THREE.BoxGeometry(0.28, 0.5, 0.3), M(), s * 0.22, 0.1, 0); add(new THREE.BoxGeometry(0.3, 0.16, 0.6), M(), s * 0.22, -0.18, 0.14); } break;
    case "hat": add(new THREE.SphereGeometry(0.45, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M()); for (const s of [-1, 1]) add(new THREE.ConeGeometry(0.08, 0.4, 6), M(), s * 0.25, 0.5, 0, 0, 0, -s * 0.3); break;
    case "facesuit": {
      for (let i = 0; i < 4; i++) { const f = new THREE.Group(); const geo = new THREE.SphereGeometry(0.42, 22, 16, 0, Math.PI, 0, Math.PI); const p = geo.attributes.position;
        for (let k = 0; k < p.count; k++) { const z = p.getZ(k); p.setZ(k, z * 0.5); } geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, M(i % 2 ? 0xb08a72 : 0xa07a62, { side: THREE.DoubleSide })); m.rotation.y = -Math.PI / 2; f.add(m);
        for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), M(0x0a0604)); e.position.set(s * 0.14, 0.08, -0.17); f.add(e); }
        f.position.set((i % 2 - 0.5) * 0.8, (Math.floor(i / 2) - 0.5) * 0.85, 0); f.rotation.y = Math.PI; g.add(f); }
      break; }
    default: add(new THREE.BoxGeometry(0.6, 0.6, 0.6), M());
  }
  return g;
}

export class Inspector {
  constructor(root) {
    this.el = document.createElement("div");
    this.el.className = "inspect hidden";
    this.el.innerHTML = `<div class="in-card"><button class="in-x" type="button" aria-label="Close">✕</button><canvas class="in-cv"></canvas><div class="in-hint">drag to turn</div><div class="in-text"></div></div>`;
    root.appendChild(this.el);
    for (const e of ["pointerdown", "click", "touchstart", "wheel"]) this.el.addEventListener(e, (ev) => ev.stopPropagation(), { passive: true });
    this.el.querySelector(".in-x").addEventListener("click", () => this.close());
    this.el.addEventListener("click", (e) => { if (e.target === this.el) this.close(); });
    this.cv = this.el.querySelector(".in-cv");
    this.rot = { y: 0.6, x: 0.25, drag: null, spin: 0.6 };
    this.cv.addEventListener("pointerdown", (e) => { this.rot.drag = { x: e.clientX, y: e.clientY }; this.cv.setPointerCapture?.(e.pointerId); });
    this.cv.addEventListener("pointermove", (e) => { const d = this.rot.drag; if (!d) return; this.rot.y += (e.clientX - d.x) * 0.012; this.rot.x = Math.max(-1.2, Math.min(1.2, this.rot.x + (e.clientY - d.y) * 0.01)); d.x = e.clientX; d.y = e.clientY; this.rot.spin = 0; });
    const up = () => { this.rot.drag = null; this.rot.spinT = performance.now() + 2500; };
    this.cv.addEventListener("pointerup", up); this.cv.addEventListener("pointercancel", up);
  }
  _setup() {
    if (this.r) return;
    this.r = new THREE.WebGLRenderer({ canvas: this.cv, antialias: true, alpha: true });
    this.r.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(35, 1, 0.1, 20); this.cam.position.set(0, 0.2, 3.6); this.cam.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight(0xffe8c8, 0x302018, 1.4));
    const d = new THREE.DirectionalLight(0xffd8a0, 2.2); d.position.set(2, 3, 2.5); this.scene.add(d);
    const f = new THREE.PointLight(0xff8a3a, 6, 8); f.position.set(-2, -0.5, 1.5); this.scene.add(f);
  }
  /** info: { id, count } ; returns the text it showed (for tests). */
  open(id, count = 1) {
    const d = LORE[id] || { lore: "", uses: "", from: "" };
    const name = d.name || ITEMS[id]?.name || id;
    const recipes = RECIPES.filter((r) => r.needs.some(([n]) => n === id)).map((r) => r.name);
    this.el.querySelector(".in-text").innerHTML = `<h3>${ITEMS[id]?.icon || ""} ${name}${count > 1 ? ` <small>×${count}</small>` : ""}</h3>`
      + `<p class="in-lore${d.special ? " special" : ""}">${d.lore}</p>`
      + (d.uses ? `<p><b>Use:</b> ${d.uses}</p>` : "") + (recipes.length ? `<p><b>Recipes:</b> ${recipes.join(" · ")}</p>` : "") + (d.from ? `<p><b>Found:</b> ${d.from}</p>` : "");
    this.el.classList.remove("hidden"); this.isOpen = true; this.id = id;
    this._setup();
    if (this.obj) { this.scene.remove(this.obj); this.obj.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
    this.obj = model(id); this.scene.add(this.obj);
    this.rot.y = 0.6; this.rot.x = 0.25; this.rot.spin = 0.6;
    const loop = () => {
      if (!this.isOpen) return;
      const w = this.cv.clientWidth, h = this.cv.clientHeight;
      if (w && (this.cv.width !== Math.round(w * this.r.getPixelRatio()))) { this.r.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); }
      if (!this.rot.drag && performance.now() > (this.rot.spinT || 0)) this.rot.spin = 0.6;
      this.rot.y += this.rot.spin * 0.016;
      this.obj.rotation.set(this.rot.x, this.rot.y, 0);
      this.r.render(this.scene, this.cam);
      this._raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this._raf); loop();
    return { name, special: !!d.special, recipes };
  }
  close() { this.isOpen = false; cancelAnimationFrame(this._raf); this.el.classList.add("hidden"); }
}
