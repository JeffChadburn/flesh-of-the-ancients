/**
 * Round 13: spoken story lines with the browser's free Web Speech API (speechSynthesis). No
 * services, no accounts. Each speaker gets a distinct voice picked from what the device has, with
 * deterministic fallbacks, plus their own pitch / rate. Falls back to text only when speech is
 * missing. Settings (voice on/off, subtitles on/off) persist in localStorage.
 */
const PROFILES = {
  // narrator: deep and slow
  "": { prefer: ["Daniel", "Google UK English Male", "Microsoft George", "Microsoft Ryan", "Arthur", "Oliver", "Alex", "Aaron", "Rishi"], pitch: 0.62, rate: 0.84, slot: 0 },
  // Old Lume: an old, cracked, slower voice
  "Old Lume": { prefer: ["Fred", "Ralph", "Albert", "Microsoft David", "Google US English", "Bruce", "Gordon", "Lee", "Tom"], pitch: 0.45, rate: 0.76, slot: 1 },
  // Kra (if he ever speaks): younger, rougher
  Kra: { prefer: ["Microsoft Mark", "Google UK English Male", "Evan", "Nathan", "Reed", "Rocko", "Thomas"], pitch: 0.85, rate: 0.95, slot: 2 },
  // round 16: the people of the towns and camps
  "Elder Haska": { prefer: ["Karen", "Moira", "Google UK English Female", "Microsoft Hazel", "Fiona", "Tessa", "Samantha"], pitch: 0.82, rate: 0.82, slot: 3 },
  Neka: { prefer: ["Samantha", "Google US English", "Microsoft Zira", "Victoria", "Allison", "Ava"], pitch: 1.25, rate: 1.04, slot: 4 },
  "Warden Orrek": { prefer: ["Microsoft Guy", "Google UK English Male", "Daniel", "Aaron", "Gordon"], pitch: 0.55, rate: 0.9, slot: 5 },
  Brannoc: { prefer: ["Ralph", "Fred", "Albert", "Microsoft David", "Lee"], pitch: 0.7, rate: 0.8, slot: 6 },
  "The Ash-Walker": { prefer: ["Whisper", "Bad News", "Microsoft Ryan", "Arthur", "Rishi", "Oliver"], pitch: 0.3, rate: 0.74, slot: 7 },
  Mosi: { prefer: ["Tom", "Evan", "Google US English", "Microsoft Mark", "Nathan"], pitch: 1.12, rate: 1.08, slot: 8 },
};
const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v === "1"; } catch { return d; } };
const SAVE = (k, v) => { try { localStorage.setItem(k, v ? "1" : "0"); } catch {} };

export class StoryVoice {
  constructor() {
    this.synth = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined" ? window.speechSynthesis : null;
    this.enabled = LS("fota-voice", true);
    this.subtitles = LS("fota-subs", true);
    this.voices = [];
    this.primed = false;
    this.speaking = false;
    this.onDuck = null; // (on) => void
    this.log = [];
    if (this.synth) {
      const load = () => { this.voices = this.synth.getVoices() || []; this._pick = null; };
      load();
      this.synth.addEventListener?.("voiceschanged", load);
      if (!this.synth.addEventListener) this.synth.onvoiceschanged = load;
    }
  }
  get available() { return !!this.synth; }
  get active() { return this.available && this.enabled && !this.broken; }
  setEnabled(v) { this.enabled = !!v; if (v) this.broken = false; SAVE("fota-voice", this.enabled); if (!this.enabled) this.stop(false); }
  setSubtitles(v) { this.subtitles = !!v; SAVE("fota-subs", this.subtitles); }

  /** iOS / Safari only speak after a user gesture: call from a tap (Start / Continue / first touch). */
  prime() {
    if (!this.synth || this.primed) return;
    this.primed = true;
    try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; this.synth.speak(u); } catch {}
  }

  /** Voice for a speaker: a preferred name if present, else a deterministic pick by slot. */
  voiceFor(who) {
    const prof = PROFILES[who] || PROFILES[""];
    if (!this._pick) this._pick = {};
    if (this._pick[who] !== undefined) return this._pick[who];
    const en = this.voices.filter((v) => /^en/i.test(v.lang)).sort((a, b) => (a.localService === b.localService ? a.name.localeCompare(b.name) : a.localService ? -1 : 1));
    const pool = en.length ? en : this.voices.slice().sort((a, b) => a.name.localeCompare(b.name));
    let v = null;
    for (const name of prof.prefer) { v = pool.find((x) => x.name.includes(name)); if (v) break; }
    if (!v && pool.length) v = pool[(prof.slot || 0) % pool.length];
    // keep speakers apart when the device has more than one voice
    const others = Object.entries(this._pick).filter(([k]) => k !== who).map(([, x]) => x);
    if (v && others.includes(v) && pool.length > 1) v = pool.find((x) => !others.includes(x)) || v;
    this._pick[who] = v || null;
    return this._pick[who];
  }

  /** Speak one line; onEnd fires once when it finishes (or fails / times out). Returns false if not spoken. */
  speak(text, who = "", onEnd = null) {
    if (!this.active) return false;
    this.stop(false);
    const prof = PROFILES[who] || PROFILES[""];
    const u = new SpeechSynthesisUtterance(text);
    const v = this.voiceFor(who);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "en-GB";
    u.pitch = prof.pitch; u.rate = prof.rate; u.volume = 1;
    let done = false;
    const token = (this._token = (this._token || 0) + 1);
    const finish = (why) => {
      if (done) return; done = true;
      if (token !== this._token) return; // superseded / silently stopped: ignore late events
      clearTimeout(this._safety);
      this.speaking = false; this.onDuck?.(false);
      this.log.push({ e: "end", who, why, text: text.slice(0, 24) });
      // A real engine failure (no voice installed, not allowed, ...): text only from now on.
      if (/^error:/.test(why) && !/interrupted|canceled/.test(why)) { this.broken = why; this.onBroken?.(why); }
      this._cur = null;
      onEnd?.(why);
    };
    u.onend = () => finish("end");
    u.onerror = (e) => finish("error:" + (e.error || "?"));
    // some engines never fire onend: allow ~ the line's length at this rate, then move on
    const ms = 1500 + (text.length * 75) / prof.rate;
    this._safety = setTimeout(() => finish("timeout"), ms);
    this._cur = u; this._finish = finish;
    this.speaking = true; this.onDuck?.(true);
    this.log.push({ e: "speak", who, voice: v?.name || null, text: text.slice(0, 24) });
    try { this.synth.speak(u); } catch { finish("throw"); return false; }
    return true;
  }
  /** Stop the current line (fires its onEnd with "stop" unless silent). */
  stop(notify = true) {
    if (!this.synth) return;
    const f = this._finish; this._finish = null;
    if (this._cur && f) {
      if (notify) f("stop");
      else { this._token++; clearTimeout(this._safety); this.speaking = false; this.onDuck?.(false); this._cur = null; }
    }
    try { this.synth.cancel(); } catch {}
  }
}
