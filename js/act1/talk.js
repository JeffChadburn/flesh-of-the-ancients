/**
 * Round 20: talkative townsfolk. Every person in a town / camp is a fixed individual (name,
 * voice, trait, trade) derived from the town seed. Walk up and Talk (E): a greeting that knows
 * the time of day, the weather, the land, what Kra wears and what he has done, then a short
 * dialog tree: the area, rumours (caves, animals, the quest, resources), barter, a gift, and
 * "join my settlement". They remember Kra (mood, saved) and call out as he passes (barks).
 */
import { mulberry32 } from "../rng.js";
import { ITEMS } from "./survival.js";

const SYL = ["ka", "ru", "mo", "ta", "ne", "ul", "os", "ri", "ba", "ek", "na", "ro", "shi", "va", "lu", "dar", "ho", "mi", "ten", "ga", "yo", "ar", "ke", "tu"];
const TRAITS = ["warm", "gruff", "shy", "boastful", "old", "curious"];
const JOBS = [
  { id: "hunter", what: "a hunter", anim: "carry", trade: [[["meat", 2], ["berries", 3]], [["hide", 1], ["bone", 2]]] },
  { id: "scraper", what: "a hide-scraper", anim: "scrape", trade: [[["hide", 1], ["meat", 2]], [["sinew", 1], ["bone", 1]]] },
  { id: "knapper", what: "a flint-knapper", anim: "chop", trade: [[["flint", 1], ["bone", 2]], [["flint", 2], ["hide", 1]]] },
  { id: "forager", what: "a forager", anim: "dig", trade: [[["berries", 3], ["pelt", 1]], [["herbs", 1], ["roots", 2]]] },
  { id: "fisher", what: "a fisher", anim: "carry", trade: [[["cooked", 1], ["flint", 1]], [["cooked", 2], ["hide", 1]]] },
  { id: "woodcutter", what: "a woodcutter", anim: "chop", trade: [[["logs", 2], ["meat", 1]], [["logs", 3], ["sinew", 1]]] },
  { id: "elder", what: "one of the elders", anim: null, trade: [[["ochre", 1], ["cooked", 1]], [["herbs", 2], ["meat", 2]]] },
];
export const TOWN_VOICES = 6;

/** A townsperson's fixed identity from a seed. */
export function identity(seed, s = null) {
  const r = mulberry32(seed >>> 0);
  const n = 2 + Math.floor(r() * 2);
  let name = ""; for (let i = 0; i < n; i++) name += SYL[Math.floor(r() * SYL.length)];
  name = name[0].toUpperCase() + name.slice(1);
  const job = JOBS[Math.floor(r() * JOBS.length)];
  return { name, trait: TRAITS[Math.floor(r() * TRAITS.length)], job: job.id, what: job.what, anim: job.anim, voice: "town" + Math.floor(r() * TOWN_VOICES), town: s?.name || "", seed: seed >>> 0 };
}
const pick = (a, r = Math.random) => a[Math.floor(r() * a.length)];
const dirName = (dx, dz) => ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][((Math.round(Math.atan2(dx, -dz) / (Math.PI / 4)) % 8) + 8) % 8];
const far = (d) => (d < 150 ? "close by" : d < 450 ? "a short walk" : d < 1100 ? "a long walk" : "days away");
const BIOME = { temperate: "the green hills", red: "the red-rock country", salt: "the salt flats", swamp: "the marsh", alpine: "the high peaks", tundra: "the frozen north", ocean: "the coast" };

export class TownTalk {
  constructor(env) {
    this.env = env;
    this.mem = {};
    try { this.mem = JSON.parse(localStorage.getItem("fota-talk-v1") || "{}"); } catch {}
    this.barkT = 0; this.log = [];
  }
  save() { try { localStorage.setItem("fota-talk-v1", JSON.stringify(this.mem)); } catch {} }
  toJSON() { return this.mem; }
  fromJSON(o) { if (o && typeof o === "object") { this.mem = o; this.save(); } }
  m(p) { return (this.mem[p.key || p.ident.name] ||= { rel: 0, met: 0 }); }
  joined(key) { return !!this.mem[key]?.joined; }
  mood(rel) { return rel >= 3 ? "fond of you" : rel >= 1.5 ? "friendly" : rel >= 0 ? "wary" : "afraid of you"; }

  /** Talkable person within reach of the feet. */
  near(f, r = 3.2) {
    const n = this.env.people()?.nearest(f.x, f.z);
    return n && n.d < r ? n.p : null;
  }
  ctx(p) {
    const env = this.env, A = env.atmo(), t = env.terrain(), s = env.surv();
    const h = A?.hours ?? 12;
    return {
      part: h < 5 || h > 21 ? "night" : h < 9 ? "morning" : h < 17 ? "day" : "evening", weather: A?.weather || "clear",
      biome: t?.biomeAt ? t.biomeAt(p.x, p.z) : "temperate", faces: s?.faces || 0, quests: env.questsDone?.() || 0, kills: env.kills?.() || 0,
      story: env.story(),
    };
  }
  greeting(p) {
    const I = p.ident, m = this.m(p), c = this.ctx(p), r = mulberry32((I.seed + (m.met | 0) * 31) >>> 0), L = [];
    const tod = { morning: "Early to be walking.", day: "", evening: "The light is going.", night: "Out in the dark? Keep your torch high." }[c.part];
    const wx = { rain: "Wet to the bone today.", storm: "Hear that sky? The spirits are angry.", snow: "Cold enough to crack teeth.", fog: "Can't see a spear's length in this murk.", clear: "" }[c.weather] || "";
    if (I.ext) {
      L.push(pick([`Kra. The ${I.jobName || "work"} goes well.`, `We're making something here, Kra.`, `Tell me what you need.`], r));
    } else if (!m.met) {
      const intro = { warm: `Welcome, stranger. I'm ${I.name}, ${I.what} of ${I.town || "this camp"}.`, gruff: `${I.name}. ${I.what[0].toUpperCase() + I.what.slice(1)}. What do you want?`, shy: `Oh... I'm ${I.name}. I work as ${I.what}.`, boastful: `You've heard of ${I.name}, surely? Best ${I.what.replace(/^(a|an|one of the) /, "")} in ${I.town || "these hills"}.`, old: `Sit, sit. I am ${I.name}. I was ${I.what} before your father was born.`, curious: `A new face! I'm ${I.name}, ${I.what}. Where did you come from?` }[I.trait];
      L.push(intro);
    } else L.push(pick(m.rel >= 1.5 ? [`Kra! Good to see you again.`, `There he is. Sit a while.`, `Back already, Kra?`] : m.rel < 0 ? [`You again.`, `Keep your distance.`] : [`Kra.`, `You came back.`], r));
    // what he wears, what he has done
    if (c.faces > 0 && !m.sawFaces && !I.ext) { m.sawFaces = 1; L.push(c.faces > 2 ? "Those faces on your chest... I knew some of those men. Don't come closer." : "Is that a man's face you're wearing? Spirits keep us."); if (I.trait === "shy" || I.trait === "warm") m.rel -= 0.5; }
    else if (c.quests >= 3 && !m.sawDeeds) { m.sawDeeds = 1; L.push(c.quests >= 5 ? "They say you went into the dark and came back with its blood. The young ones talk of nothing else." : "Haska says you're useful. We'll see."); m.rel += 0.3; }
    else if (c.kills >= 5 && r() < 0.4) L.push("You smell of the hunt. Good.");
    if (r() < 0.6 && (wx || tod)) L.push(wx || tod);
    else if (c.biome !== "temperate" && r() < 0.5) L.push({ red: "The red rock eats the heat of the day and gives it back at night.", salt: "Nothing grows on the white flats. Don't drink from the pans.", swamp: "Mind the mud. It keeps what it takes.", alpine: "Up here the wind talks louder than people.", tundra: "Cold country. The deer here grow thick coats and thick skulls." }[c.biome] || "");
    if (!m.met) m.met = 1; else m.met++;
    const day = Math.floor((this.env.time?.() || 0) / 300);
    if (m.day !== day) { m.day = day; m.rel += 0.15; }
    this.save();
    return L.filter(Boolean).map((text) => ({ who: I.name, voice: I.voice, text }));
  }
  /** Start a conversation. */
  talk(p) {
    p.talkT = 30;
    this.env.ui.say(this.greeting(p), () => this.menu(p));
    this.log.push({ e: "talk", who: p.ident.name });
  }
  say(p, lines, then) { this.env.ui.say(lines.map((text) => ({ who: p.ident.name, voice: p.ident.voice, text })), then); }
  menu(p) {
    const env = this.env, I = p.ident, m = this.m(p), col = env.colony?.();
    p.talkT = 30;
    if (I.ext) {
      const opts = [{ id: "work", label: "How is the work?" }, { id: "job", label: "Change your work", desc: `Now: ${I.jobName || "gatherer"}` }, { id: "bye", label: "Carry on" }];
      env.ui.ask(I.name, `One of your people.`, opts, (id) => {
        if (id === "work") this.say(p, [col?.report(I) || "We need more hands."], () => this.menu(p));
        else if (id === "job") env.ui.ask(I.name, "What should I do?", col.jobOptions(), (j) => { col.setJob(I.vid, j); this.say(p, [`${col.jobName(j)}. I'll see to it.`], () => this.menu(p)); });
        else this.bye(p);
      }, true);
      return;
    }
    const opts = [{ id: "area", label: "Ask about the area" }, { id: "rumour", label: "Any news or rumours?" }, { id: "trade", label: "Trade", desc: `${I.what[0].toUpperCase() + I.what.slice(1)}` }];
    const home = col?.homeFor?.(p);
    opts.push({ id: "gift", label: "Give a gift", desc: "Food makes friends" });
    if (home) opts.push({ id: "join", label: `Join me at ${home.name}`, desc: `They are ${this.mood(m.rel)}` });
    opts.push({ id: "bye", label: "Goodbye" });
    env.ui.ask(I.name, `${I.name} the ${I.what.replace(/^(a|an|one of the) /, "")} · ${this.mood(m.rel)}`, opts, (id) => this.pickOpt(p, id), true);
    this.onMenu?.(p);
  }
  bye(p) {
    p.talkT = 2;
    const m = this.m(p);
    this.say(p, [pick(m.rel >= 1.5 ? ["Walk well, Kra.", "Come back soon.", "Keep the fire in you."] : ["Go on, then.", "Mind the dark.", "Hm."])]);
  }
  pickOpt(p, id) {
    const env = this.env, I = p.ident, m = this.m(p), back = () => this.menu(p);
    if (id === "area") return this.say(p, this.area(p), back);
    if (id === "rumour") return this.say(p, this.rumour(p), back);
    if (id === "trade") return this.trade(p);
    if (id === "gift") return this.gift(p);
    if (id === "join") return this.join(p);
    this.bye(p);
  }
  area(p) {
    const t = this.env.terrain(), c = this.ctx(p), I = p.ident, out = [];
    out.push(`This is ${I.town || "our camp"}, in ${BIOME[c.biome] || "the hills"}.`);
    const lk = t.bio?.lakes?.slice().sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    if (lk && Math.hypot(lk.x - p.x, lk.z - p.z) < 1500) out.push(`There's a lake ${far(Math.hypot(lk.x - p.x, lk.z - p.z))} to the ${dirName(lk.x - p.x, lk.z - p.z)}. Good fishing, and boats at the shore.`);
    const w = t.bio?.weights?.(p.x, p.z);
    if (w) {
      const regions = [["red", 0, 1500, "Go south far enough and the land turns red: canyons, stone towers."], ["alpine", 0, -1500, "North the mountains start. Copper shows green in the rocks up there."], ["swamp", 1500, 0, "East is the marsh: reeds, mud and dead trees."], ["ocean", -1900, 0, "West, past the hills, the great water. The coast people use skin boats."]];
      out.push(pick(regions)[3]);
    }
    return out;
  }
  rumour(p) {
    const env = this.env, t = env.terrain(), c = this.ctx(p), out = [], r = Math.random;
    const st = c.story;
    const h = st?.active ? st.hint?.() : null;
    const opts = [];
    if (h) opts.push(() => `About your errand: ${h.text.replace(/^[A-Z]/, (a) => a.toLowerCase())}`);
    const disc = env.discovered?.() || new Set();
    const cave = t.entrances.filter((e) => !disc.has(e.id)).map((e) => ({ e, d: Math.hypot(e.x - p.x, e.z - p.z) })).sort((a, b) => a.d - b.d)[0];
    if (cave) opts.push(() => { env.markHint?.(cave.e.x, cave.e.z, cave.e.name); return `There's a cave mouth ${far(cave.d)} to the ${dirName(cave.e.x - p.x, cave.e.z - p.z)}. ${cave.e.name}, the old ones call it. Things scrape in there at night. (Marked on your map.)`; });
    const an = env.wildlife?.()?.list?.filter((a) => a.alive).map((a) => ({ a, d: Math.hypot(a.pos.x - p.x, a.pos.z - p.z) })).sort((a, b) => a.d - b.d)[0];
    if (an) opts.push(() => `I saw ${an.a.kind === "deer" ? "deer" : an.a.kind + "s"} to the ${dirName(an.a.pos.x - p.x, an.a.pos.z - p.z)} this ${c.part === "night" ? "evening" : "morning"}. ${an.a.kind === "wolf" ? "Watch yourself." : "Easy meat if you're quiet."}`);
    opts.push(() => "Copper is the green stone, tin the grey. Strike them in the deep caves with a pick and you'll have something no one else has.");
    opts.push(() => "The people of the coast lash skins over driftwood and go out on the great water. Mad, all of them.");
    if (c.faces > 0) opts.push(() => "The Ash-Walker wears eleven faces, they say. He says the more you wear, the closer the First Mouth comes.");
    if (env.colony?.()?.list?.length) opts.push(() => `People talk about the new hearth you founded. Some of the young ones want to go.`);
    out.push(pick(opts, r)());
    this.m(p).rel += 0.05;
    return out;
  }
  trade(p) {
    const env = this.env, I = p.ident, s = env.surv(), job = JOBS.find((j) => j.id === I.job) || JOBS[0];
    if (!s) return this.say(p, ["Come back when you've something to trade."], () => this.menu(p));
    const offers = job.trade.map(([give, want], i) => ({ id: "t" + i, give, want, ok: s.count(want[0]) >= want[1] }));
    const nm = ([id, n]) => `${n} ${(ITEMS[id]?.name || id).toLowerCase()}`;
    env.ui.ask(`Trade with ${I.name}`, "They offer:", offers.map((o) => ({ id: o.id, label: `${nm(o.give)} for your ${nm(o.want)}`, desc: o.ok ? "You have it" : `You have ${s.count(o.want[0])}` })).concat([{ id: "no", label: "Not now" }]), (id) => {
      const o = offers.find((x) => x.id === id);
      if (!o) return this.menu(p);
      if (!o.ok) return this.say(p, [`You don't have ${nm(o.want)}.`], () => this.menu(p));
      s.remove(o.want[0], o.want[1]);
      const got = s.add(o.give[0], o.give[1]);
      if (!got) { s.add(o.want[0], o.want[1]); return this.say(p, ["Your pack is full. Make room first."], () => this.menu(p)); }
      this.m(p).rel += 0.4; this.save();
      env.ui.toast(`Traded: +${nm(o.give)}`, "good");
      this.log.push({ e: "trade", who: I.name, got: o.give[0] });
      this.say(p, [pick(["Fair trade.", "Good. Pleasure.", "Done. Don't tell the others what I gave you."])], () => this.menu(p));
    }, true);
  }
  gift(p) {
    const env = this.env, s = env.surv(), food = ["cooked", "meat", "berries", "roots"].find((k) => s?.count(k) > 0);
    if (!food) return this.say(p, ["Kind thought. But your hands are empty."], () => this.menu(p));
    s.remove(food, 1);
    const m = this.m(p); m.rel += food === "cooked" ? 1.5 : 1; this.save();
    env.ui.toast(`Gave 1 ${ITEMS[food].name.toLowerCase()}`);
    this.say(p, [pick(["For me? You have a good heart, Kra.", "Ha! I'll remember this.", "The children will eat tonight. Thank you."])], () => this.menu(p));
  }
  join(p) {
    const env = this.env, col = env.colony(), m = this.m(p), I = p.ident, home = col.homeFor(p);
    if (!home) return this.say(p, ["Join you where? You have no hearth of your own."], () => this.menu(p));
    if (m.rel < (col.has?.("diplomacy") ? 0.6 : 1.2)) return this.say(p, [pick(["I hardly know you. Help us first, bring us something, and ask again.", "Leave my people for a stranger? Not yet."])], () => this.menu(p));
    if (!col.hasRoom(home)) return this.say(p, [`Where would I sleep? Build more huts at ${home.name} and ask again.`], () => this.menu(p));
    this.say(p, [pick([`${home.name}... yes. A new fire. I'll come.`, "My mother would say I'm a fool. I'll come anyway.", "Give me till sunset to say my goodbyes. Then I'm yours."])], () => {
      m.joined = 1; this.save();
      col.recruit(home, I);
      env.people().remove(p);
      env.ui.toast(`${I.name} joins ${home.name}`, "skill");
      this.log.push({ e: "join", who: I.name, home: home.name });
    });
  }
  /** Short lines called out when Kra walks by. */
  update(dt, f) {
    if ((this.barkT -= dt) > 0) return;
    this.barkT = 1;
    const env = this.env, ui = env.ui;
    if (ui.modal || !ui.dialog.classList.contains("hidden")) return;
    const n = env.people()?.nearest(f.x, f.z);
    if (!n || n.d > 7 || n.d < 2) return;
    const p = n.p, m = this.m(p), now = env.time();
    if ((this._lastBark || -99) > now - 14 || (m.barkAt || -99) > now - 90) return;
    m.barkAt = now; this._lastBark = now;
    const c = this.ctx(p), I = p.ident;
    const lines = I.ext ? ["Kra! The stores are filling.", "Good day for work.", "Back to it, then."] :
      c.faces > 1 ? ["Don't look at him. Don't look at the faces.", "Spirits...", "Keep walking, face-wearer."] :
      m.rel >= 1.5 ? [`Kra! Over here!`, "Ho, Kra!", "Good hunting, friend."] :
      c.part === "night" ? ["Stay near the fire tonight.", "Who's there?"] : c.weather === "rain" || c.weather === "storm" ? ["Get under a roof, fool.", "This rain..."] :
      [`Fresh meat at ${I.town || "the fire"}, if you've got something to trade.`, "Hm. Stranger.", "Watch where you walk.", "Nice spear.", "Have you been in the caves?"];
    const text = pick(lines);
    ui.toast(`${I.name}: “${text}”`);
    if (env.voice?.active && !env.voice.speaking) env.voice.speak(text, I.voice);
    this.log.push({ e: "bark", who: I.name });
  }
}
