/**
 * Round 23: the spirit visions Kra has as a mushroom vision fades. Nine, in order across trips;
 * later ones read his life (faces, settlements, deeds). Then short "echoes". K = Kra, A = the
 * Ancestor (every fire that went out before his). ctx: see SpiritVision.context() in main.js.
 */
const K = (text) => ({ who: "Kra", text }), A = (text) => ({ who: "The Ancestor", text });
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

export const VISIONS = [
  { id: "hunger", title: "The Hunger", lines: () => [
    K("The colours are going out of the world like a tide. And under them, something is still."),
    A("Sit, child of the River-Tooth. We are every fire that went out before yours."),
    K("The Mouth took my people. Why? What did we ever take from it?"),
    A("It is not a beast that hates. It is a hunger that has forgotten it was ever fed. Long ago the first people fed it their fear, and fear is a meal that leaves you emptier."),
    A("It calls the dead because the dead cannot say no."),
    K("Then I will not feed it fear."),
    A("Good. Remember that when you are afraid. Feed the fire instead."),
  ] },
  { id: "faces", title: "The Faces You Wear", lines: (c) => [
    K(c.faces ? `I wear ${plural(c.faces, "face")}. Some nights I hear them breathing with me.` : "I have not taken a face. The Ash-Walker wears eleven, and he smiles like a man with no face of his own."),
    A("A face is not a trophy. It is a debt. Each one was a life that laughed, and was afraid, and wanted one more morning."),
    K("What do I owe them?"),
    A("To live the part of their lives they could not. Hunt as they hunted. Build what they meant to build. Sing their names where the children can hear."),
    c.faces > 3 ? A("But carry too many and their hunger becomes yours. The Mouth listens through borrowed skin.") : A("Wear only what you can carry with honour. The Mouth listens through borrowed skin."),
    K("Then I will carry them lightly, and set them down when the debt is paid."),
  ] },
  { id: "paintings", title: "The Painted Wall", choice: true, lines: (c) => [
    K(c.glyphs ? `In the caves I paint with blood. ${plural(c.glyphs, "mark")} so far. I thought it was to calm the spirits.` : "The old ones painted the caves in blood. I thought it was to calm the spirits."),
    A("The walls remember what the living forget. A painting is a promise made where the dark can see it."),
    A("The old ones shut the Mouth once with blood on stone. Not because blood is strong, but because many hands painted together."),
    K("Then the paintings are not spells. They are agreements."),
    A("Yes. And an agreement made by one hand alone is only a wish."),
  ] },
  { id: "circle", title: "The Circle", lines: (c) => [
    K(c.kills ? `I have killed ${plural(c.kills, "animal")} since the camp went quiet.` : "I have barely hunted since the camp went quiet. I live on roots like a child."),
    A("The deer does not belong to you. You belong to the same circle as the deer."),
    A("Take what you need. Give back what you can: the bones to the earth, the first meat to the fire, thanks to the herd that stays."),
    K("And if I take more than I need?"),
    A("Then the circle closes into a mouth. That is how the First Mouth began: a people that only ever took."),
  ] },
  { id: "people", title: "The People to Come", choice: true, lines: (c) => [
    K(c.towns ? `${c.biggest} has ${plural(c.pop, "soul")} now. They look at me as if I know the way.` : "I am alone. Who would follow a man who wears the dead?"),
    A("A tribe is not blood. It is whoever sits at the same fire when the night is long."),
    A("Look, a hundred winters from now: children who never heard the words River-Tooth, singing the old songs anyway."),
    K("Then the tribe does not end with me."),
    A("It never ended. It was only waiting for someone to light a fire and stay."),
  ] },
  { id: "empire", title: "What an Empire Should Be", lines: (c) => [
    K(c.towns ? `From hide and hut to ${c.ageName}. I could build walls to the mountains. I could make every town bow.` : "If I had a people I could build walls to the mountains. I could make every town bow."),
    A("Walls keep things out. They also keep things in. Ask which you are building."),
    A("An empire that only takes is a mouth with many teeth. One that shelters and feeds is a hearth with many rooms."),
    K("A hearth with many rooms."),
    A("Build that, and the dark will have nowhere to stand."),
  ] },
  { id: "deeds", title: "What You Have Done", choice: true, lines: (c) => [
    K("Show me what I have done."),
    c.helped ? A(`${plural(c.helped, "person")} in the towns trust you. ${c.joined ? `${plural(c.joined, "person")} left their own fires for yours.` : "None have left their fires for yours yet."} That is not a small thing.`) : A("You walk past the towns like a ghost. They know the face-wearer. They do not know your face."),
    c.kills > 20 ? A("And the herds remember you too. Many fell to your spear. Did you thank them?") : A("The herds do not fear your name. That is a kind of wealth."),
    K("I want them to remember me as the one who brought the fire back."),
    A("Then be that one again tomorrow, and the day after. A name is only what you do most."),
  ] },
  { id: "breath", title: "The Deep Breath", lines: () => [
    K("Sometimes I feel the caves breathing, even out here under the open sky."),
    A("The Mouth is closer to the surface than it has been for a thousand winters. It smells your fires, and it is curious."),
    A("When you go down to it at last, do not go as a hunter. Go as the keeper of a people."),
    K("Will that be enough?"),
    A("Nothing is ever enough. That is why we do it together."),
  ] },
  { id: "face", title: "The Ancestor's Face", choice: true, lines: (c) => [
    K("Who are you, really?"),
    A("Turn around and look."),
    K("It is me. Old. Grey. Sitting by a fire that never went out."),
    A(c.age >= 2 ? `You have already carried them from hide to ${c.ageName}. Carry them further.` : "What you see depends on what you build when the colours fade."),
    A("Go back now. The world is only the world again. That is enough. That was always enough."),
  ] },
];
/** After the ninth: short echoes that read his life now. */
export function echo(c, n) {
  const pool = [
    () => [K("The colours fade again. The voice is softer now, like a fire banked for the night."), A(c.towns ? `${c.biggest} sleeps well tonight. You did that.` : "Light one fire of your own, and I will have more to show you.")],
    () => [K("I keep seeing the old camp, but the fire is lit and someone is laughing."), A("That is not the past. That is what you are building.")],
    () => [K(`${plural(c.faces, "face")}, ${plural(c.towns, "settlement")}, ${plural(c.pop, "soul")}. Is it enough?`), A("Ask the children in a hundred winters. They will not know your name. They will know the songs.")],
    () => [K("The Mouth was quiet tonight."), A("Quiet is not sleep. Keep the watch, and keep the fire.")],
  ];
  return pool[n % pool.length]();
}
