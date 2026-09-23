import { transliterate, nameMatch } from './translit.js';

/**
 * Farmer-document understanding (doc-verification spec §2–§5).
 *
 * Four document roles per flood claim:
 *   registry   — land record / sale deed (विक्रय विलेख, खसरा, etc.), any language
 *   aadhaar    — identity card; name is CROSS-VERIFIED against the registry
 *   satellite  — geotagged/aerial imagery of the plot (pre/post event ideally)
 *   policy     — insurance policy paper (sum insured, policy number)
 *
 * Every parser is deterministic: same OCR text → same fields. Extraction
 * failures degrade to null fields and stage WARNs, never crashes.
 */

export type DocRole = 'registry' | 'aadhaar' | 'satellite' | 'policy';

export const DOC_ROLES: readonly DocRole[] = ['registry', 'aadhaar', 'satellite', 'policy'];

export const DOC_META: Record<DocRole, { label: string; labelHi: string; hint: string }> = {
  registry: {
    label: 'Land Registry / रजिस्ट्री',
    labelHi: 'रजिस्ट्री (भूमि दस्तावेज़)',
    hint: 'Sale deed, khatauni, khasra, 7/12 — any format, Hindi or English',
  },
  aadhaar: {
    label: 'Aadhaar Card / आधार कार्ड',
    labelHi: 'आधार कार्ड',
    hint: 'Front side showing the name (Hindi or English both work)',
  },
  satellite: {
    label: 'Satellite / Geotagged Image / उपग्रह चित्र',
    labelHi: 'उपग्रह / जियो-टैग तस्वीर',
    hint: 'Aerial or field photo of the plot (pre-disaster if available)',
  },
  policy: {
    label: 'Insurance Policy / बीमा पॉलिसी',
    labelHi: 'बीमा पॉलिसी',
    hint: 'Policy paper showing sum insured and policy number',
  },
};

/* ------------------------------------------------------------------ */
/* Document classification                                             */
/* ------------------------------------------------------------------ */

const AADHAAR_SIGNS = [
  'aadhaar', 'aadhar', 'आधार', 'uidai', 'unique identification',
  'भारत सरकार', 'government of india', 'जन्म तिथि', 'dob', 'male', 'female',
];
const REGISTRY_SIGNS = [
  'विक्रय', 'खतौनी', 'खसरा', 'राजस्व', 'उत्तर प्रदेश', 'मध्य प्रदेश', 'महाराष्ट्र',
  'registry', 'registrar', 'sale deed', 'khatauni', 'khasra', '7/12', 'फर्द', 'गांव', ' Tehsil', 'tehsil',
];
const POLICY_SIGNS = [
  'policy', 'insurance', 'insured', 'premium', 'sum insured', 'बीमा', 'पॉलिसी',
  'pmfbry', 'pmfby', 'pradhan mantri fasal', 'nominee', 'coverage',
];

/** Score a document's OCR text against known role signatures. */
export function classifyDoc(text: string, filename = ''): { role: DocRole | null; scores: Record<DocRole, number> } {
  const t = (text + ' ' + filename).toLowerCase();
  const hits = (sigs: string[]): number => sigs.filter((s) => t.includes(s.toLowerCase())).length;
  const scores: Record<DocRole, number> = {
    aadhaar: hits(AADHAAR_SIGNS),
    registry: hits(REGISTRY_SIGNS),
    policy: hits(POLICY_SIGNS),
    satellite: 0, // imagery never has OCR text — classified by kind/photo role
  };
  const best = (Object.entries(scores) as Array<[DocRole, number]>)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])[0];
  return { role: best?.[0] ?? null, scores };
}

/* ------------------------------------------------------------------ */
/* Aadhaar                                                            */
/* ------------------------------------------------------------------ */

export interface AadhaarFields {
  name: string | null;
  nameDevanagari: string | null;
  dob: string | null;
  aadhaarMasked: string | null; // last 4 digits only — never store full number
  gender: string | null;
  confidence: number; // 0..1
}

/** Devanagari digits ०-९ → ASCII. */
export function devanagariToAscii(s: string): string {
  return s.replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - 0x966));
}

/** Masked Aadhaar pattern: 4-8 digits, optional X masking, groups of 4. */
const AADHAAR_NUM_RE = /\b([0-9oOlI]{4})[\s-]?([0-9oOlIxX]{4})[\s-]?([0-9oOlIxX]{4})\b/;

export function parseAadhaar(text: string): AadhaarFields {
  const raw = text;
  const t = devanagariToAscii(text).replace(/\s+/g, ' ');

  // Name: prefer the Latin line under the Devanagari name (Aadhaar shows both).
  // Devanagari name: line ending before "DoB"/"जन्म" or the line after the header.
  let nameLatin: string | null = null;
  let nameDeva: string | null = null;

  const latinName = raw.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b\s*\n?\s*(?:DoB|DOB|जन्म)/);
  if (latinName) nameLatin = latinName[1].trim();

  const devaName = raw.match(/([\u0900-\u097F][\u0900-\u097F\s]{2,40}?)[\s]*\n[\s]*[A-Z][a-z]+/);
  if (devaName) nameDeva = devaName[1].trim();

  // Fallback: "Name :" style labels (Aadhaar e-PDF / printouts)
  if (!nameLatin) {
    const labeled = t.match(/(?:name|naam|नाम)\s*[:\-]\s*([A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F .]{2,60})/i);
    if (labeled) nameLatin = labeled[1].trim();
  }

  const dob = (t.match(/\b(\d{2}[\/-]\d{2}[\/-]\d{4})\b/) ?? t.match(/\b(\d{4})[-\/](\d{2})[-\/](\d{2})\b/))?.[0] ?? null;

  const numRaw = t.match(AADHAAR_NUM_RE);
  let masked: string | null = null;
  if (numRaw) {
    const digits = numRaw[0].replace(/[^0-9xX]/g, '');
    masked = digits.length >= 4 ? `XXXX XXXX ${digits.slice(-4)}` : null;
  }

  const gender = /\b(female|महिला)\b/i.test(raw) ? 'female' : /\b(male|पुरुष)\b/i.test(raw) ? 'male' : null;

  let hits = 0;
  if (nameLatin || nameDeva) hits++;
  if (dob) hits++;
  if (masked) hits++;
  if (gender) hits++;

  return {
    name: nameLatin,
    nameDevanagari: nameDeva,
    dob,
    aadhaarMasked: masked,
    gender,
    confidence: hits / 4,
  };
}

/* ------------------------------------------------------------------ */
/* Registry (land record)                                             */
/* ------------------------------------------------------------------ */

export interface RegistryFields {
  ownerName: string | null; // Devanagari or Latin — matched bilingually later
  ownerRelation: string | null; // "पुत्र" / "S/O" line if present
  district: string | null;
  village: string | null;
  deedType: string | null; // "विक्रय विलेख" / "sale deed" / "खतौनी"
  executionDate: string | null;
  areaValue: number | null; // consideration amount if this is a sale deed
  confidence: number;
}

export function parseRegistry(text: string): RegistryFields {
  const t = devanagariToAscii(text);
  const flat = t.replace(/\s+/g, ' ');

  // Owner: the name after a relation marker is the buyer/owner in sale deeds
  // ("है उर्फ X पुत्र Y"); in khatauni it follows नाम/स्वामी.
  let owner: string | null = null;
  let relation: string | null = null;

  const afterRelation = flat.match(/(?:पुत्र|पुत्री|पत्नी|s\/o|d\/o|w\/o|son of|daughter of|wife of)\s*[:\-]?\s*([\u0900-\u097F][\u0900-\u097F\s]{2,40}|[A-Z][A-Za-z\s]{2,40})/i);
  if (afterRelation) {
    relation = 'relative';
    owner = afterRelation[1].trim();
  }
  if (!owner) {
    const labeled = flat.match(/(?:नाम|स्वामी|खातेदार|owner|name)\s*[:\-]?\s*([\u0900-\u097F][\u0900-\u097F\s]{2,40}|[A-Z][A-Za-z\s]{2,40})/);
    if (labeled) owner = labeled[1].trim();
  }
  // Drop OCR junk tokens ("wo", "go0", single letters picked from stamp noise)
  if (owner && /^(?:wo|go0|af|urpha|shri|sri|mr|the|and|[a-z]{1,2})$/i.test(owner.replace(/\s+/g, ''))) owner = null;

  const district =
    flat.match(/\b(?:जिला|district)\s*[:\-]?\s*([\u0900-\u097F]{3,20}|[A-Za-z]{3,20})/i)?.[1]?.trim() ??
    flat.match(/\b(muradabad|moradabad|ballia|yavatmal|nanded|thane|amravati|akola|solapur|latur|bhiwandi)\b/i)?.[1] ??
    null;

  const village =
    flat.match(/\b(?:ग्राम|गांव|मौजा|village)\s*[:\-]?\s*([\u0900-\u097F]{2,25}|[A-Za-z]{2,25})/i)?.[1]?.trim() ?? null;

  const deedType =
    flat.match(/(विक्रय विलेख|खतौनी|खसरा|फर्द|sale deed|registry|khatauni|khasra)/i)?.[1] ?? null;

  const execDate =
    flat.match(/\b(\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4})\b/)?.[1] ??
    flat.match(/\b(\d{2}[\/-]\d{2}[\/-]\d{4})\b/)?.[1] ??
    null;

  // Consideration / stamp value: first large ₹ figure (devanagari रू also appears)
  const amt =
    flat.match(/(?:₹|rs\.?|रू0?|रु)\s*([\d,]{4,12})/i)?.[1] ??
    flat.match(/\b([\d,]{6,12})\s*\//)?.[1] ??
    null;
  const areaValue = amt ? Number(amt.replace(/,/g, '')) : null;

  let hits = 0;
  if (owner) hits++;
  if (district) hits++;
  if (deedType) hits++;
  if (execDate) hits++;

  return { ownerName: owner, ownerRelation: relation, district, village, deedType, executionDate: execDate, areaValue, confidence: hits / 4 };
}

/* ------------------------------------------------------------------ */
/* Policy paper                                                       */
/* ------------------------------------------------------------------ */

export interface PolicyPaperFields {
  policyNumber: string | null;
  insuredName: string | null;
  sumInsured: number | null;
  coverage: string[]; // loss types mentioned
  confidence: number;
}

const SUM_INSURED_RE = /(?:sum insured|insured amount|बीमा राशि|विमा राशि)\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)/i;

export function parsePolicyPaper(text: string): PolicyPaperFields {
  const t = devanagariToAscii(text);
  const flat = t.replace(/\s+/g, ' ');

  // Form-style documents are LINE-oriented: match "Label: value" within a
  // single line first (stops greedy spillover across fields), fall back to
  // the flattened text.
  const lineValue = (labelRe: RegExp): string | null => {
    for (const line of t.split(/\n+/)) {
      const m = line.match(labelRe);
      if (m?.[1]) return m[1].trim();
    }
    return null;
  };

  const policyNumber =
    (lineValue(/policy\s*(?:no\.?|number|संख्या)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/-]{5,24})/i) ??
      flat.match(/\b([A-Z]{2,5}\/\d{2,4}\/[A-Z]{2,4}\/\d{3,8})\b/)?.[1] ??
      flat.match(/\b([A-Z]{2,5}[-\/]\d{2}[-\/]\d{3,6})\b/)?.[1])
      ?.toUpperCase() ?? null;

  const insured =
    lineValue(/(?:insured|claimant|farmer|नाम)\s*(?:name)?\s*[:\-]\s*([A-Z][A-Za-z]+(?:\s+[A-Z][a-z]+){0,2}(?=\s*(?:Sum|Policy|Season|Coverage)|\s*$)|[ऀ-ॿ][ऀ-ॿ\s]{2,60})/i) ??
    flat.match(/(?:insured|claimant|farmer)\s*(?:name)?\s*[:\-]\s*([A-Z][A-Za-z]+(?:\s+[A-Z][a-z]+){0,2})(?=\s+(?:Sum|Policy|Season|Coverage)\b)/i)?.[1]?.trim() ??
    null;

  const sumRaw = flat.match(SUM_INSURED_RE)?.[1] ?? flat.match(/(?:₹|rs\.?)\s*([\d,]{4,12})/i)?.[1] ?? null;
  const sumInsured = sumRaw ? Number(sumRaw.replace(/,/g, '')) : null;

  const coverage: string[] = [];
  if (/\bflood|बाढ़/i.test(t)) coverage.push('flood');
  if (/\bdrought|सूखा|अनावृष्टि/i.test(t)) coverage.push('drought');
  if (/\blivestock|पशु|cattle/i.test(t)) coverage.push('livestock');

  let hits = 0;
  if (policyNumber) hits++;
  if (insured) hits++;
  if (sumInsured) hits++;
  if (coverage.length > 0) hits++;

  return { policyNumber, insuredName: insured, sumInsured, coverage, confidence: hits / 4 };
}

/* ------------------------------------------------------------------ */
/* Cross-verification                                                 */
/* ------------------------------------------------------------------ */

export interface CrossVerifyResult {
  matched: boolean;
  score: number;
  aadhaarName: string | null;
  registryName: string | null;
  /**
   * true when the registry scan is too degraded to extract ANY owner name —
   * a text-based check can then neither convict nor exonerate. Never treated
   * as a mismatch (an honest farmer with an old CamScanner deed must not be
   * fraud-flagged); the human reviewer sees the inconclusive card instead.
   */
  inconclusive?: boolean;
  detail: string;
}

/**
 * The core identity check: does the Aadhaar holder appear in the registry?
 * Bilingual — either side may be Devanagari or Latin; also scans the whole
 * registry text so "Roshan" appearing anywhere in the deed counts.
 */
export function crossVerifyIdentity(aadhaar: AadhaarFields, registryText: string): CrossVerifyResult {
  const aName = aadhaar.name ?? aadhaar.nameDevanagari;
  if (!aName) {
    return { matched: false, score: 0, aadhaarName: null, registryName: null, inconclusive: true, detail: 'no readable name extracted from the Aadhaar — identity cross-check inconclusive' };
  }
  // Candidate registry names: parsed owner + any "X पुत्र Y" lines.
  const candidates: string[] = [];
  const parsed = parseRegistry(registryText);
  if (parsed.ownerName) candidates.push(parsed.ownerName);
  for (const m of registryText.matchAll(/([\u0900-\u097F][\u0900-\u097F\s]{2,40}?|[A-Z][A-Za-z\s]{2,40}?)\s*(?:पुत्र|पुत्री|पत्नी|s\/o|d\/o|w\/o)/gi)) {
    candidates.push(m[1].trim());
  }

  let best = { score: 0, name: '' };
  for (const c of candidates) {
    const r = nameMatch(aName, c);
    if (r.score > best.score) best = { score: r.score, name: c };
  }

  // Windowed full-text scan (2–3 word windows over the WHOLE registry) —
  // old stamp-paper scans mangle label patterns, but a real party name
  // usually survives somewhere in the body text.
  const words = transliterate(registryText).split(/\s+/).filter((w) => /^[a-z]{3,}$/.test(w));
  const aadhaarTokens = transliterate(aName).split(' ').filter((w) => w.length >= 3);
  for (let i = 0; i < words.length; i++) {
    for (const win of [2, 3]) {
      if (i + win > words.length) continue;
      const windowName = words.slice(i, i + win).join(' ');
      const r = nameMatch(aName, windowName);
      if (r.score > best.score) best = { score: r.score, name: windowName };
    }
  }
  // First-name-only fallback (very noisy scans): weak signal — matches are
  // reported but scored below the pass bar so a human still reviews.
  if (best.score < 50 && aadhaarTokens[0] && aadhaarTokens[0].length >= 4) {
    if (words.includes(aadhaarTokens[0])) {
      best = { score: 45, name: aadhaarTokens[0] };
    }
  }

  const matched = best.score >= 50;
  // Inconclusive ≠ mismatch: when the registry scan is too degraded to extract
  // an owner name at all (no parsed owner — label/relation patterns all
  // failed), a text-based verdict can neither convict nor exonerate. A
  // READABLE deed naming someone else still parses an ownerName → real
  // mismatches keep hard-failing below.
  const inconclusive = !matched && parsed.ownerName == null && best.score < 50;
  return {
    matched,
    inconclusive,
    score: best.score,
    aadhaarName: aName,
    registryName: best.name || null,
    detail: matched
      ? `Aadhaar "${aName}" ↔ registry "${best.name}" (match ${best.score}%)`
      : inconclusive
        ? `registry scan too degraded to extract a name — identity cross-check inconclusive (best ${best.score}%); human review advised`
        : best.score > 0
          ? `weak: Aadhaar "${aName}" only partially found in registry ("${best.name}", ${best.score}%) — manual review required`
          : `Aadhaar "${aName}" does not appear in the registry (best ${best.score}%)`,
  };
}

/* ------------------------------------------------------------------ */
/* Satellite imagery — destruction percentage (CLIP zero-shot ladder)  */
/* ------------------------------------------------------------------ */

/**
 * A six-rung visual ladder from untouched fields to total destruction.
 * Deterministic: fixed prompts + fixed weights → same image → same %.
 * The claim's stated loss % is then compared against this (R5).
 */
const DESTRUCTION_LADDER = [
  { label: 'intact', prompts: ['a healthy green farm field with standing crops', 'an intact village with dry roads and green trees'], weight: 0 },
  { label: 'wet', prompts: ['a farm field with puddles after rain', 'a wet village road with small water pools'], weight: 18 },
  { label: 'waterlogged', prompts: ['a partially waterlogged farm field with crops sticking out of water', 'a village street with knee-deep standing floodwater'], weight: 38 },
  { label: 'submerged', prompts: ['a farm field mostly submerged under muddy floodwater', 'houses surrounded by flood water up to waist level'], weight: 62 },
  { label: 'heavy', prompts: ['a village entirely surrounded by brown muddy floodwater', 'aerial view of a flooded town with only rooftops visible'], weight: 82 },
  { label: 'severe', prompts: ['a vast expanse of muddy floodwater covering everything to the horizon', 'aerial view of a completely submerged landscape under dark floodwater'], weight: 95 },
] as const;

/** Optional pre-disaster reference image shifts the baseline. */
const PRE_EVENT_PROMPTS = ['a healthy green farm field with standing crops', 'an intact village with dry roads and green trees'];

export interface DestructionResult {
  destructionPct: number; // 0..100
  rung: string;
  perRung: Array<{ label: string; score: number }>;
  usedReference: boolean;
}

export async function scoreDestruction(
  embedImageFn: (buf: Buffer) => Promise<number[]>,
  embedTextsFn: (texts: string[]) => Promise<number[][]>,
  imageBuf: Buffer,
  referenceBuf?: Buffer
): Promise<DestructionResult> {
  const allPrompts = DESTRUCTION_LADDER.flatMap((r) => [...r.prompts]);
  const rungVecs: number[][] = [];
  let idx = 0;
  const textVecs = await embedTextsFn(allPrompts);
  for (const rung of DESTRUCTION_LADDER) {
    const vecs = textVecs.slice(idx, idx + rung.prompts.length);
    idx += rung.prompts.length;
    rungVecs.push(...vecs);
  }

  const imgVec = await embedImageFn(imageBuf);
  const scoresPerRung = DESTRUCTION_LADDER.map((rung, i) => {
    const rungVecsI = rungVecs.slice(i * rung.prompts.length, (i + 1) * rung.prompts.length);
    const maxSim = Math.max(...rungVecsI.map((v) => cos(imgVec, v)));
    return { label: rung.label, score: maxSim, weight: rung.weight };
  });

  // Pre-event reference (if provided): how similar is the scene to intact?
  let referenceAdjust = 0;
  let usedReference = false;
  if (referenceBuf) {
    try {
      const refVec = await embedImageFn(referenceBuf);
      const intactVecs = await embedTextsFn(PRE_EVENT_PROMPTS as unknown as string[]);
      const refIntact = Math.max(...intactVecs.map((v) => cos(refVec, v)));
      const refFlood = Math.max(...(await embedTextsFn(['a landscape flooded under muddy water'])).map((v) => cos(refVec, v)));
      // A genuinely pre-disaster reference anchors the field's healthy state.
      if (refIntact > refFlood) {
        referenceAdjust = -8;
        usedReference = true;
      }
      void refVec;
    } catch {
      /* reference unusable → ignore */
    }
  }

  // Softmax-ish weighting: convert similarities to shares, then weighted mean.
  const minScore = Math.min(...scoresPerRung.map((s) => s.score));
  const expScores = scoresPerRung.map((s) => ({ ...s, e: Math.exp((s.score - minScore) * 12) }));
  const sumE = expScores.reduce((a, s) => a + s.e, 0);
  const destruction = Math.min(
    100,
    Math.max(
      0,
      Math.round(expScores.reduce((a, s) => a + (s.e / sumE) * s.weight, 0) + referenceAdjust)
    )
  );

  const best = scoresPerRung.reduce((a, b) => (b.score > a.score ? b : a));
  return {
    destructionPct: destruction,
    rung: best.label,
    perRung: scoresPerRung.map(({ label, score }) => ({ label, score: Math.round(score * 1000) / 1000 })),
    usedReference,
  };
}

function cos(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // embeddings are pre-normalized by the CLIP wrapper
}
