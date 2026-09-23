/**
 * Bilingual name matching (CLAIMCHAIN doc-verification spec §2).
 *
 * Indian documents mix scripts freely — a registry may say "रोशन पांडेय"
 * while the Aadhaar says "Roshan Pandey" (or "Roshan Pandeya", or the
 * registry OCR mangles it). Matching is therefore:
 *   1. normalize (case, punctuation, whitespace)
 *   2. transliterate Devanagari → Latin (deterministic rule table)
 *   3. token-level fuzzy compare (prefix / edit-distance tolerance)
 *
 * Deterministic: same strings → same boolean. No dictionaries, no network.
 */

const CONSONANTS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'ळ': 'l',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  // nukta forms
  'क़': 'q', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'फ़': 'f', 'ड़': 'r', 'ढ़': 'rh',
};

const VOWELS: Record<string, string> = {
  'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u',
  'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o',
};

const MATRAS: Record<string, string> = {
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u',
  'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'o', 'ॉ': 'o',
};

const VIRAMA = '\u094D'; // ् — suppresses the inherent vowel
const ANUSVARA = '\u0902'; // ं
const CANDRABINDU = '\u0901'; // ँ
const VISARGA = '\u0903'; // ः
const NUKTA = '\u093C'; // ़

/** Transliterate any Devanagari run to a lowercase Latin approximation. */
export function transliterate(input: string): string {
  let out = '';
  const chars = [...input.normalize('NFC')];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (CONSONANTS[c] !== undefined) {
      // nukta may follow the consonant — skip it (already folded into the map)
      let j = i + 1;
      while (j < chars.length && (chars[j] === NUKTA || chars[j] === '\u200D' || chars[j] === '\u200C')) j++;
      const base = CONSONANTS[c];
      if (j < chars.length && MATRAS[chars[j]] !== undefined) {
        out += base + MATRAS[chars[j]];
        i = j;
      } else if (j < chars.length && chars[j] === VIRAMA) {
        out += base; // dead consonant — no inherent vowel
        i = j;
      } else {
        out += base + 'a';
        i = j - 1; // re-examine the non-matra char next loop (rare junk)
      }
    } else if (VOWELS[c] !== undefined) {
      out += VOWELS[c];
    } else if (MATRAS[c] !== undefined) {
      out += MATRAS[c]; // stray matra after independent vowel handling
    } else if (c === ANUSVARA) {
      out += 'n'; // ं — could be n or m; 'n' is the common onoma for names
    } else if (c === CANDRABINDU) {
      out += 'n';
    } else if (c === VISARGA) {
      out += 'h';
    } else if (c === '।' || c === '॥') {
      out += ' ';
    }
    // Latin digits/letters pass through below
    else if (/[a-zA-Z0-9]/.test(c)) out += c.toLowerCase();
    else if (c === ' ' || c === '-' || c === '_' || c === '.' || c === '/') out += ' ';
    // everything else (junk OCR glyphs) dropped
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Small Levenshtein distance (iterative DP, fine for name-length strings). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Normalize a name token for comparison (lowercase letters only). */
function cleanToken(t: string): string {
  return t.toLowerCase().replace(/[^a-z]/g, '');
}

const STOP_TOKENS = new Set(['shri', 'smt', 'mr', 'mrs', 'md', 's', 'o', 'd', 'w', 'putra', 'putri']);

/** Fuzzy single-token equality: prefix (≥4) or edit-distance ≤ 2 (≥5 chars). */
function tokenMatches(a: string, b: string): boolean {
  const x = cleanToken(a);
  const y = cleanToken(b);
  if (x.length < 3 || y.length < 3) return false; // too short to be meaningful
  if (x === y) return true;
  if (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))) return true;
  const tol = x.length >= 5 && y.length >= 5 ? 2 : 1;
  return levenshtein(x, y) <= tol;
}

export interface NameMatchResult {
  matched: boolean;
  score: number; // 0..100 — share of the shorter token set that matched
  matchedTokens: string[];
  a: string; // transliterated forms (for logs)
  b: string;
}

/**
 * Do two person names plausibly refer to the same person?
 * Order-insensitive over tokens; ignores honorifics and relation markers.
 * Rule: every token of the SHORTER side must find a fuzzy partner on the
 * other side ("Roshan Pandey" ↔ "रोशन पांडेय" ✓; "Roshan Pandey" ↔
 * "Roshan Srivastava" ✗ — Pandey never matches).
 */
export function nameMatch(nameA: string, nameB: string): NameMatchResult {
  const a = transliterate(nameA);
  const b = transliterate(nameB);
  const ta = a.split(' ').map(cleanToken).filter((t) => t.length >= 3 && !STOP_TOKENS.has(t));
  const tb = b.split(' ').map(cleanToken).filter((t) => t.length >= 3 && !STOP_TOKENS.has(t));
  if (ta.length === 0 || tb.length === 0) {
    return { matched: false, score: 0, matchedTokens: [], a, b };
  }
  const matchedTokens: string[] = [];
  // iterate the shorter side
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  for (const x of short) {
    if (long.some((y) => tokenMatches(x, y))) matchedTokens.push(x);
  }
  const score = Math.round((matchedTokens.length / short.length) * 100);
  const matched = matchedTokens.length === short.length;
  return { matched, score, matchedTokens, a, b };
}
