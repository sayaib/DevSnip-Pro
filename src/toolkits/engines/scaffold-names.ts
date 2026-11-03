/** Naming shared by frontend and backend scaffold templates. */
export function words(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean).map(w => w.toLowerCase());
}
export const pascalOf = (name: string) => words(name).map(w => w[0].toUpperCase() + w.slice(1)).join("") || "Item";
export const camelOf = (name: string) => { const p = pascalOf(name); return p[0].toLowerCase() + p.slice(1); };
export const kebabOf = (name: string) => words(name).join("-") || "item";
export function pluralOf(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + "es";
  return word + "s";
}

