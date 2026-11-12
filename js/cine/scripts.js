/**
 * Round 24: cutscene scripts. INTRO is the opening (≈2 min); MEMORIES are the short story / milestone
 * cutscenes (20–45 s) that play once per save and stay in Pack → Journal → Memories.
 * Scenes: { panel } = an animated cave painting; otherwise a live camera move:
 *   at: camp | cave | ocean | red | north | here | settle   cam: fly | orbit | rise | push | low
 * Lines with no `who` are the narrator.
 */
const K = (text) => ({ who: "Kra", text });
const LUME = (text) => ({ who: "Old Lume", text });

export const INTRO = {
  id: "intro", title: "The River-Tooth", mood: "dread",
  scenes: [
    { at: "camp", cam: "fly", time: 17.6, card: ["Flesh of the Ancients", "a story of the River-Tooth"], lines: [
      "Before the ice let go of the world, the River-Tooth people lived where the water runs fast and cold, at the foot of the falls."] },
    { at: "camp", cam: "orbit", time: 18.2, lines: [
      "They hunted deer and bison, they kept the fire, and on the walls of the caves they painted what they saw."] },
    { panel: "hunt", lines: [
      "Ochre, and charcoal, and blood. The paintings were for the spirits.",
      "As long as the walls remembered, the dark beneath the hills stayed quiet."] },
    { panel: "mouth", accent: true, lines: [
      "But something under the hills is hungry. The old ones called it the First Mouth.",
      "It was shut once, with blood on stone. And it has been waiting.",
      "On the Night of Open Mouths it opened its throat, and the River-Tooth were drawn into the dark."] },
    { at: "camp", cam: "low", time: 6.2, kra: true, lines: [
      "In the morning they lay where they fell, their mouths open, emptied. Only one young hunter woke.",
      K("Kra.")] },
    { panel: "faces", lines: [
      LUME("Wear the faces, boy. So the mouths stay closed."),
      "Each face is a life. Each face is armour. Each face is a weight."] },
    { panel: "blood", lines: [
      "Paint in the blood of the things that crawl out of the dark, and the walls will remember again."] },
    { at: "cave", cam: "push", time: 16.5, lines: [
      "All across the land, the caves are opening their throats. Below, they are dark, and wet, and wrong."] },
    { at: "ocean", cam: "fly", alt: 34, time: 17.5, lines: [
      "Beyond them: the cold sea in the west,"] },
    { at: "red", cam: "fly", alt: 9, time: 16.8, lines: [
      "the red canyons of the south, the frozen north, and people who have never heard the name River-Tooth."] },
    { at: "camp", cam: "rise", time: 18.6, kra: true, accent: true, lines: [
      "Find them. Hunt. Survive. Build something that lasts.",
      "And when the First Mouth calls, answer it with blood."], hold: 1.5 },
    { panel: "glyph", card: ["Flesh of the Ancients", "Act I · The Empty Camp"], lines: [], hold: 0.5 },
  ],
};

/** Memories. trigger = the game event that plays it once per save. */
export const MEMORIES = [
  { id: "cave1", trigger: "firstCave", title: "The First Throat", mood: "dread", scenes: [
    { at: "here", cam: "push", card: ["The First Throat", "a memory"], lines: ["The air in the cave is warm, like breath. Somewhere below, water drips, and something listens to it."] },
    { panel: "mouth", lines: [K("Lume said the caves opened their throats. I thought it was an old man's way of talking."), "Keep the torch high. Walk soft. The dark can hear you run."] } ] },
  { id: "kill1", trigger: "firstKill", title: "First Blood", mood: "calm", scenes: [
    { panel: "kill", card: ["First Blood", "a memory"], lines: ["The first kill is the oldest painting on any wall: a hunter, a spear, an animal that falls."] },
    { at: "here", cam: "orbit", lines: [K("Thank you for your meat. I will waste none of you."), "Take the hide, the meat, the sinew. Nothing is wasted. That is how the River-Tooth lived."] } ] },
  { id: "face1", trigger: "faceTaken", title: "The First Face", mood: "dread", scenes: [
    { panel: "faces", card: ["The First Face", "a memory"], lines: ["He crawled into the hollow to hide, and never came out. Now his face is yours."] },
    { at: "here", cam: "rise", lines: [K("I am sorry, brother. Walk with me a while longer."), "A heart that is not your own beats under your skin. One face. The Mouth is a little more closed, and you are a little less Kra."] } ] },
  { id: "q_m1", trigger: "quest:m1", title: "The Empty Camp", mood: "calm", scenes: [
    { at: "here", cam: "low", card: ["The Empty Camp", "Act I · done"], lines: ["The fire burns again at the River-Tooth camp. The dead are not alone in the dark any more."] },
    { panel: "river", lines: [K("There is smoke to the west. Someone is alive out there."), "One hunter, one fire. It is a beginning."] } ] },
  { id: "q_m2", trigger: "quest:m2", title: "Smoke to the West", mood: "wonder", scenes: [
    { panel: "people", card: ["Smoke to the West", "a memory"], lines: ["A town by a lake: children, dogs, the smell of fish smoke. Living people, who look at the dead man's face you wear and do not run."] },
    { at: "here", cam: "orbit", lines: [K("They are not River-Tooth. But they are people. That is enough, today.")] } ] },
  { id: "q_m3", trigger: "quest:m3", title: "Proof of the Hunt", mood: "triumph", scenes: [
    { panel: "hunt", card: ["Proof of the Hunt", "a memory"], lines: ["Two deer, two hides, laid at the elder's feet. In the lake town, they say the word hunter differently now when they say your name."] },
    { at: "here", cam: "rise", lines: ["Bone arrows, light and true. The bow is a longer arm, and a quieter one."] } ] },
  { id: "q_m4", trigger: "quest:m4", title: "The Painted Hall", mood: "dread", scenes: [
    { panel: "mouth", card: ["The Painted Hall", "a memory"], accent: true, lines: ["The wall of the long hall shows it plainly: the Mouth woke once before, and the old ones shut it with blood on stone."] },
    { panel: "blood", lines: [K("Then it can be shut again. With enough blood. With the right wall.")] } ] },
  { id: "q_m5", trigger: "quest:m5", title: "Throat of Ash", mood: "dread", scenes: [
    { panel: "throat", card: ["Throat of Ash", "a memory"], lines: ["The ash cave breathes. Its walls are warm. Whatever is under the hills is spreading west, one cave at a time."] },
    { at: "here", cam: "push", lines: [K("Flint from its gullet. A sharper spear for whatever comes up next.")] } ] },
  { id: "q_m6", trigger: "quest:m6", title: "Word to the Hold", mood: "wonder", scenes: [
    { panel: "river", card: ["Word to the Hold", "a memory"], lines: ["The word goes from town to town, along the rivers: the caves are waking. Some listen. Some bar their doors."] },
    { at: "here", cam: "orbit", lines: ["And in the hold they speak of another face-wearer: a man of ash, with eleven faces."] } ] },
  { id: "q_m7", trigger: "quest:m7", title: "The Hunter of Faces", mood: "dread", scenes: [
    { panel: "faces", card: ["The Hunter of Faces", "Act II begins"], lines: [{ who: "The Ash-Walker", text: "Wear too many and you open yourself to the First Mouth. Remember that, when you are hungry for power." }] },
    { at: "here", cam: "rise", lines: [K("How many faces is too many? He did not say. Maybe he does not know."), "Act Two. The gathering of faces."] } ] },
  { id: "settle1", trigger: "firstSettlement", title: "A Fire of Our Own", mood: "triumph", scenes: [
    { at: "here", cam: "orbit", card: ["A Fire of Our Own", "a memory"], lines: ["A ring of stones, a cold hearth, a place on the map that has your name on it."] },
    { panel: "people", lines: [K("The River-Tooth are gone. Then let something new grow here, and let it remember them."), "People will come to a fire that stays lit."] } ] },
  { id: "age", trigger: "age", title: "A New Age", mood: "triumph", repeat: true, scenes: [
    { panel: "age", card: ["{age}", "your people grow"], lines: ["{ageLine}", "More hands, more fires, more children who have never seen the dark under the hills."] },
    { at: "here", cam: "rise", lines: [K("Lume would not know this place. I hope he would be proud of it."), "The tools change, the walls change. The hunger in the dark does not."] } ] },
  { id: "shroom1", trigger: "firstShroom", title: "The Colours", mood: "wonder", scenes: [
    { panel: "trip", card: ["The Colours", "a memory"], lines: ["The old ones called the glowing mushrooms the First Mouth's teeth. Eat them, and the walls between things grow thin."] },
    { at: "here", cam: "orbit", lines: [K("The world is breathing. Was it always breathing?"), "If the colours become too much, there is a Calm visuals switch in the menu. The spirits will not mind."] } ] },
  { id: "mouth1", trigger: "firstMouth", title: "The Breath of the First Mouth", mood: "dread", scenes: [
    { panel: "throat", card: ["The First Mouth", "a memory"], accent: true, lines: ["Deep in the throat of ash the rock turns soft and warm, and the air moves. In, and out. In, and out.", "Somewhere far below, every cave meets. The old ones called that place the Throat."] },
    { panel: "mouth", lines: [K("I hear them. My people. They are saying my name with open mouths."), "Not yet, Kra. Not yet. Gather the faces first."] } ] },
];
export const AGE_LINES = [
  "", "Timber: walls of split logs, and axes that bite.", "Stone: quarries and kilns, and houses that outlast their builders.",
  "Bronze: green fire in the furnace, copper and tin married into something harder than both.", "Iron and steel: the forge rings day and night, and the hills give up their bones.", "A new age.",
];
/** Fill {age} / {ageLine} for the templated age memory. */
export function fillMemory(m, vars = {}) {
  const sub = (s) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  return { ...m, title: vars.title || m.title, scenes: m.scenes.map((sc) => ({ ...sc, card: sc.card && sc.card.map(sub), lines: (sc.lines || []).map((l) => (typeof l === "string" ? sub(l) : { ...l, text: sub(l.text) })) })) };
}
