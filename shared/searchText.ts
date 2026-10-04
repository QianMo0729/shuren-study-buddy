import { SYNONYMS } from './options';

/** Keep server search and profile highlights on the same synonym vocabulary. */
export function expand(term: string): string[] {
  const normalized = term.toLowerCase();
  const words = new Set([normalized]);
  for (const group of SYNONYMS) {
    const aliases = group.map((word) => word.toLowerCase());
    if (aliases.some((word) => word === normalized || (normalized.length >= 2 && word.includes(normalized)))) {
      aliases.forEach((word) => words.add(word));
    }
  }
  return [...words];
}

export function tokenize(query: string): string[] {
  return [...new Set(query.split(/[\s,，、;；/|]+/).map((word) => word.trim()).filter(Boolean))].slice(0, 8);
}
