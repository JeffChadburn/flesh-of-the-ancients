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
  // round 20: townsfolk (six voice types, picked per person)
  town0: { prefer: ["Google UK English Male", "Microsoft Ryan", "Daniel", "Aaron"], pitch: 0.75, rate: 0.95, slot: 9 },
  town1: { prefer: ["Google UK English Female", "Microsoft Libby", "Serena", "Kate"], pitch: 1.1, rate: 1.0, slot: 10 },
  town2: { prefer: ["Microsoft David", "Fred", "Ralph", "Lee"], pitch: 0.6, rate: 0.88, slot: 11 },
  town3: { prefer: ["Samantha", "Microsoft Zira", "Google US English", "Allison"], pitch: 1.2, rate: 1.06, slot: 12 },
  town4: { prefer: ["Microsoft Mark", "Tom", "Evan", "Nathan"], pitch: 0.95, rate: 1.04, slot: 13 },
  town5: { prefer: ["Moira", "Fiona", "Tessa", "Karen", "Microsoft Hazel"], pitch: 0.9, rate: 0.9, slot: 14 },
  // round 23: the Ancestor in the spirit visions: slow, low, distant
  "The Ancestor": { prefer: ["Moira", "Google UK English Female", "Microsoft Hazel", "Fiona", "Karen", "Tessa"], pitch: 0.55, rate: 0.78, slot: 15 },
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
    u.pitch = prof.pitch; u.rate = prof.rate; u.volume = Math.max(0, Math.min(1, this.getVolume ? this.getVolume() : 1)); // round 23: Voices slider
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
    // Round 25: don't move on while the engine is still talking (slow iOS voices), or the next
    // line would start on top of this one; give it up to two extra windows.
    const ms = 1500 + (text.length * 75) / prof.rate;
    let extra = 0;
    const safety = () => { if (token !== this._token) return; if (this.synth.speaking && extra++ < 2) { this._safety = setTimeout(safety, ms * 0.5); return; } finish("timeout"); };
    this._safety = setTimeout(safety, ms);
    this._cur = u; this._finish = finish;
    this.speaking = true; this.onDuck?.(true, text);
    this.log.push({ e: "speak", who, voice: v?.name || null, text: text.slice(0, 24) });
    // Round 25: iOS Safari can keep the cancelled line playing if speak() follows cancel() in the
    // same tick, so two voices overlap. Let the cancel settle first, and only speak if this line is
    // still the current one.
    const go = () => { if (token !== this._token) return; try { this.synth.cancel(); } catch {} try { this.synth.speak(u); } catch { finish("throw"); } };
    if (this._busy()) setTimeout(go, 120); else { try { this.synth.speak(u); } catch { finish("throw"); return false; } }
    return true;
  }
  _busy() { try { return !!(this.synth.speaking || this.synth.pending || performance.now() - (this._cancelAt || 0) < 120); } catch { return false; } }
  /** Stop the current line (fires its onEnd with "stop" unless silent). */
  stop(notify = true) {
    if (!this.synth) return;
    const f = this._finish; this._finish = null;
    if (this._cur && f) {
      if (notify) f("stop");
      else { this._token++; clearTimeout(this._safety); this.speaking = false; this.onDuck?.(false); this._cur = null; }
    }
    try { this.synth.cancel(); this._cancelAt = performance.now(); } catch {}
  }
}
