/** Round 22: short names + an obvious-slur filter for names and chat (client side; a server should repeat it). */
const LONG = ["nigger", "nigga", "faggot", "retard", "kike", "chink", "tranny", "wetback", "cunt", "beaner", "raghead", "towelhead", "sandnigger"];
const SHORT = ["fag", "spic", "coon", "gook", "dyke", "nig"];
const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", "$": "s", "!": "i", "|": "i" };
const norm = (s) => s.toLowerCase().replace(/[013457@$!|]/g, (c) => LEET[c]).normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
export function isBad(s) {
  const n = norm(s), squash = n.replace(/[^a-z]/g, "").replace(/(.)\1+/g, "$1$1");
  if (LONG.some((w) => squash.includes(w) || squash.includes(w.replace(/(.)\1/g, "$1")))) return true;
  const words = n.split(/[^a-z]+/);
  return SHORT.some((w) => words.includes(w) || words.includes(w + "s"));
}
export function cleanName(s) {
  let n = String(s || "").replace(/[\u0000-\u001f\u007f<>&"'`]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
  if (!n || isBad(n)) n = "";
  return n;
}
export function cleanChat(s) {
  let t = String(s || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 160);
  if (!t) return "";
  return t.split(/(\s+)/).map((w) => (isBad(w) ? "*".repeat(Math.min(6, w.length)) : w)).join("");
}
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
