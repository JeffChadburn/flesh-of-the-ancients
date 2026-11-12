/**
 * Round 24b: one table of stats for every creature and person that can fight or be hunted.
 *   hp      hits to bring it down (a plain spear thrust does 1, a flint spear / Strength 2)
 *   dmg     hearts it takes off Kra per hit (0 = never attacks)
 *   speed   top speed in m/s (Kra jogs ~4, sprints ~7, a horse gallops ~19)
 *   role    prey (flees), defensive (flees, but turns and charges when hurt or cornered),
 *           predator (stalks, then attacks in range), person
 *   aggro   m: a predator starts stalking you inside this; attack: m, reach of a bite / blow
 *   cd      s between attacks; fleeAt: flees when hp drops to this fraction
 *   abilities: flee, zigzag, fly, herd, climb, mount, charge, stalk, pounce, pack, melee, throw
 */
export const STATS = {
  rabbit: { name: "Rabbit", hp: 1, dmg: 0, speed: 3.2, role: "prey", abilities: ["flee", "zigzag"] },
  bird: { name: "Bird", hp: 1, dmg: 0, speed: 4.0, role: "prey", abilities: ["flee", "fly"] },
  deer: { name: "Deer", hp: 1, dmg: 0, speed: 4.2, role: "prey", abilities: ["flee", "herd"] },
  goat: { name: "Mountain goat", hp: 1, dmg: 0, speed: 3.8, role: "prey", abilities: ["flee", "climb"] },
  fox: { name: "Fox", hp: 1, dmg: 0, speed: 4.0, role: "prey", abilities: ["flee"] },
  horse: { name: "Wild horse", hp: 2, dmg: 0, speed: 7.0, role: "prey", abilities: ["flee", "herd", "mount"] },
  boar: { name: "Boar", hp: 2, dmg: 1, speed: 3.5, charge: 6.5, attack: 1.6, cd: 1.6, role: "defensive", abilities: ["flee", "charge"] },
  wolf: { name: "Wolf", hp: 2, dmg: 1, speed: 5.4, aggro: 26, attack: 1.7, cd: 1.5, fleeAt: 0.5, pounce: 7, role: "predator", abilities: ["stalk", "pounce", "pack", "flee"] },
  bear: { name: "Brown bear", hp: 5, dmg: 2, speed: 4.8, charge: 7.5, aggro: 16, attack: 2.2, cd: 2.2, fleeAt: 0.2, role: "predator", abilities: ["stalk", "charge", "flee"] },
  // people (hostile towns, and warriors who answer your Call to Arms)
  villager: { name: "Villager", hp: 2, dmg: 1, speed: 3.6, attack: 1.6, cd: 1.8, fleeAt: 1, role: "person", abilities: ["flee"] },
  warrior: { name: "Warrior", hp: 4, dmg: 1, speed: 4.3, attack: 1.9, cd: 1.3, fleeAt: 0.25, role: "person", abilities: ["melee", "flee"] },
  thrower: { name: "Spear-thrower", hp: 3, dmg: 1, speed: 4.0, attack: 1.7, cd: 2.6, range: 15, fleeAt: 0.34, role: "person", abilities: ["throw", "melee", "flee"] },
  chief: { name: "War chief", hp: 7, dmg: 2, speed: 4.1, attack: 2.1, cd: 1.6, fleeAt: 0.15, role: "person", abilities: ["melee", "charge"] },
  ally: { name: "Warrior (yours)", hp: 5, dmg: 1, speed: 4.6, attack: 1.9, cd: 1.2, fleeAt: 0, role: "person", abilities: ["melee"] },
};
export const ABILITY = {
  flee: "Runs when hurt or scared", zigzag: "Zig-zags as it runs", fly: "Takes off", herd: "The herd bolts together", climb: "Climbs steep slopes",
  mount: "Can be ridden", charge: "Charges (much faster for a moment)", stalk: "Shadows you before it attacks", pounce: "Leaps the last few metres",
  pack: "Hunts with its pack: when one attacks, all do", melee: "Closes in to strike", throw: "Throws spears from range",
};
