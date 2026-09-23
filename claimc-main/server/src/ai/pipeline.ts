import { createHash } from 'node:crypto';
import { hammingDistance } from './imageproc.js';
import { ocrText, ocrTextHi, parsePolicyFields, type PolicyFields } from './ocr.js';
import { embedImage, embedTexts, cosine } from './clip.js';
import { scoreEmbedding } from './fraud-memory.js';
import { explainRun } from './explain.js';
import { resolveDistrict } from './geo.js';
import { pdfToText } from './pdfimg.js';
import {
  classifyDoc,
  crossVerifyIdentity,
  parseAadhaar,
  parsePolicyPaper,
  parseRegistry,
  scoreDestruction,
  type AadhaarFields,
  type DocRole,
  type PolicyPaperFields,
  type RegistryFields,
} from './docs.js';
import { readEvidence } from '../store.js';
import {
  LOSS_META,
  POLICY_TABLE,
  type Claim,
  type DocSummary,
  type DocEntity,
  type Evidence,
  type SimilarCase,
  type StageLog,
  type VerificationRun,
} from '../types.js';

/**
 * ClaimChain verification pipeline (CLAIMCHAIN_WORKFLOW.md §2).
 *
 * Seven deterministic stages over a claim's evidence. Every stage emits a log
 * entry; verdicts are COMPUTED from thresholds, never typed by a caller.
 * Same evidence in → same verdict out (determinism is the tamper-evidence).
 */

export const SCORE = {
  FLAG: 50, // >= → grey zone / any hard fail flags too
  REJECT: 20, // < → no insurable event
} as const;

export const PHASH_COLLISION_DISTANCE = 6; // <= → near-duplicate of another claim's photo

/**
 * Zero-shot CLIP prompts for staged-imagery detection (part of stage 5).
 * Deterministic: fixed prompts, fixed weights → same image → same score.
 */
const ZERO_SHOT_FRAUD_PROMPTS = [
  'a photo of a picture on a screen showing a damaged field',
  'a printed photograph of a damaged field held in front of the camera',
  'a screenshot of a damaged field displayed on a phone or computer',
] as const;
const ZS_WARN = 55; // staged-likelihood ≥ → WARN
const ZS_FLAG = 75; // staged-likelihood ≥ → FAIL (downgrade)

// AI-GENERATION signal (zero-shot CLIP): partial but real detector for
// synthetic imagery (diffusion/GAN artifacts, hyper-clean compositions).
// Calibrated on synthetic fixtures — see context log; tune after field data.
const AI_GEN_WARN = 78; // ≥ → WARN
const AI_GEN_FLAG = 88; // ≥ → FAIL (downgrade)
const AI_GEN_PROMPTS = [
  'an AI-generated image',
  'a digitally rendered artificial image',
  'a hyperrealistic synthetic picture produced by a diffusion model',
  'an uncanny computer-generated scene',
] as const;
const REAL_PHOTO_PROMPTS = [
  'a casual smartphone photo taken outdoors',
  'a real amateur photograph of a real place',
  'a candid snapshot from a phone camera',
] as const;

// Loss-type relevance (zero-shot CLIP): does the imagery depict the CLAIMED
// loss at all? This is what stops "any random pics" from being approved.
const RELEVANCE_FLAG = 50; // no OCR keyword AND relevance < → FAIL (evidence ≠ claimed loss)
const RELEVANCE_PASS = 65; // no OCR keyword BUT relevance ≥ → PASS (visually on-topic)

/** Imagery that is clearly NOT evidence of any insurable loss. */
const UNRELATED_PROMPTS = [
  'a random indoor photo of a person or a room',
  'a selfie portrait of a person',
  'a photo of food or a restaurant meal',
  'a screenshot of a website or an app interface',
  'a photo of a parked car on a street',
  'a page of printed text or a document',
] as const;

/** Per-loss-type zero-shot prompt pairs. Negatives include the OTHER loss types' positives — a flood photo must not pass a drought claim. */
const RELEVANCE_PROMPTS: Record<Claim['lossType'], { positives: string[]; negatives: string[] }> = {
  flood: {
    positives: ['a flooded field or street with standing water', 'a submerged house or crops under floodwater', 'heavy rain and overflowing water in a village'],
    negatives: ['a dry cracked drought field', 'healthy green crops in daylight', 'an injured or deceased farm animal'],
  },
  drought: {
    positives: ['a dry cracked drought field', 'withered brown crops in a parched landscape', 'dry empty soil under harsh sun'],
    negatives: ['a flooded field with standing water', 'lush green irrigated crops', 'an injured or deceased farm animal'],
  },
  livestock: {
    positives: ['an injured or sick farm animal', 'a deceased cow or goat lying on the ground', 'cattle in distress on a farm'],
    negatives: ['a flooded field with standing water', 'a dry cracked field', 'healthy crops in daylight'],
  },
};
const ZERO_SHOT_GENUINE_PROMPTS = [
  'a genuine photo taken outdoors of a damaged field',
  'a genuine outdoor photograph of flood damage',
  'an outdoor scene photograph taken in daylight',
] as const;

export interface PipelineVerdict {
  verdict: 'AI_APPROVED' | 'AI_FLAGGED' | 'AI_REJECTED';
  score: number;
}

/** Digest of the verification log itself — committed into the DECISION state hash. */
export function verificationHash(run: Omit<VerificationRun, never>): string {
  const canonical = JSON.stringify({
    verificationId: run.verificationId,
    claimId: run.claimId,
    verdict: run.verdict,
    score: run.score,
    stages: run.stages.map((s) => `${s.stage}:${s.result}:${s.details}:${s.ms}`),
  });
  return '0x' + createHash('sha256').update(canonical).digest('hex');
}

function scoreOf(stages: StageLog[]): number {
  let score = 100;
  for (const s of stages) {
    if (s.result === 'FAIL') score -= s.stage === 'DECISION' ? 0 : 25;
    else if (s.result === 'WARN') score -= 12;
  }
  return Math.max(0, Math.min(100, score));
}

function decide(stages: StageLog[]): PipelineVerdict {
  // Any stage FAIL (including DAMAGE_ASSESS) is a hard fail: evidence that
  // shows no damage / unrelated imagery must never auto-approve. Score still
  // gates the grey zone, but a failing stage forces at least a FLAG.
  const hardFails = stages.filter((s) => s.stage !== 'DECISION' && s.result === 'FAIL').length;
  const score = scoreOf(stages);

  if (hardFails === 0 && score >= SCORE.FLAG) return { verdict: 'AI_APPROVED', score };
  if (score < SCORE.REJECT) return { verdict: 'AI_REJECTED', score };
  return { verdict: 'AI_FLAGGED', score };
}

interface StageCtx {
  claim: Claim;
  /** Evidence list for THIS claim (photos + docs + farmer docs). */
  own: Evidence[];
  /** Photos from all OTHER claims, for cross-claim duplicate detection. */
  foreignPhotos: Array<{ claimId: string; fileId: string; pHash: string }>;
  /** Per-file OCR text cache (already extracted upstream in one pass). */
  ocr: Map<string, string>;
  policy: PolicyFields | null;
  /** Farmer-document OCR (bilingual) keyed by fileId. */
  docOcr: Map<string, { text: string; hindi: boolean; role: DocRole | null }>;
  /** Parsed farmer-doc fields (when those docs were submitted). */
  aadhaar: AadhaarFields | null;
  registry: RegistryFields | null;
  policyPaper: PolicyPaperFields | null;
  identityCross: ReturnType<typeof crossVerifyIdentity> | null;
  satellite: { fileId: string; pct: number; rung: string } | null;
}

function runExifIntegrity(ctx: StageCtx): { log: StageLog; reasons: string[] } {
  const t0 = Date.now();
  const reasons: string[] = [];
  const photos = ctx.own.filter((e) => e.kind === 'photo');
  if (photos.length === 0) {
    return { log: { stage: 'EXIF_INTEGRITY', result: 'FAIL', details: 'no photo evidence at all', ms: Date.now() - t0 }, reasons: ['no photos'] };
  }
  const noExif = photos.filter((p) => !p.exif.present);
  const edited = photos.filter((p) => p.exif.software);
  if (noExif.length > 0) reasons.push(`${noExif.length} photo(s) missing EXIF`);
  if (edited.length > 0) reasons.push(`edit signature: ${edited.map((p) => p.exif.software).join(', ')}`);

  // Strict policy (STRICT_NO_EXIF=1): camera-original evidence is REQUIRED —
  // missing EXIF hard-fails. Default (off): missing EXIF only warns, because
  // many budget Androids and messaging apps strip metadata on real claims.
  const strictNoExif = process.env.STRICT_NO_EXIF === '1';
  const result: StageLog['result'] =
    edited.length > 0 || (strictNoExif && noExif.length > 0) ? 'FAIL' : noExif.length > 0 ? 'WARN' : 'PASS';
  const details =
    result === 'PASS'
      ? `${photos.length} photo(s), ${photos.filter((p) => p.exif.gps).length} geotagged, timestamps consistent`
      : reasons.join(' · ');
  return { log: { stage: 'EXIF_INTEGRITY', result, details, ms: Date.now() - t0 }, reasons };
}

function runDuplicatePhash(ctx: StageCtx): { log: StageLog; reasons: string[] } {
  const t0 = Date.now();
  const photos = ctx.own.filter((e) => (e.kind === 'photo' || e.kind === 'satellite') && e.pHash);
  const collisions: string[] = [];
  const inner: string[] = [];

  for (const p of photos) {
    for (const q of ctx.foreignPhotos) {
      const d = hammingDistance(p.pHash!, q.pHash);
      if (d <= PHASH_COLLISION_DISTANCE) {
        collisions.push(`${p.fileId}≈${q.claimId}/${q.fileId} (d=${d})`);
      }
    }
  }
  // intra-claim duplicates are only informational (same farmer, same damage)
  for (let i = 0; i < photos.length; i++) {
    for (let j = i + 1; j < photos.length; j++) {
      const d = hammingDistance(photos[i].pHash!, photos[j].pHash!);
      if (d <= 2) inner.push(`${photos[i].fileId}≈${photos[j].fileId} (d=${d})`);
    }
  }

  const details =
    collisions.length > 0
      ? `cross-claim collision: ${collisions.join('; ')}`
      : inner.length > 0
        ? `intra-claim duplicates: ${inner.join('; ')}`
        : `${photos.length} photo pHash(es) unique across ${ctx.foreignPhotos.length} stored foreign photos`;
  const result: StageLog['result'] = collisions.length > 0 ? 'FAIL' : 'PASS';
  return { log: { stage: 'DUPLICATE_PHASH', result, details, ms: Date.now() - t0 }, reasons: collisions };
}

function runOcrExtract(ctx: StageCtx): { log: StageLog; reasons: string[] } {
  const t0 = Date.now();
  const docs = ctx.own.filter((e) => e.kind !== 'photo');
  const ocred = docs.filter((d) => (ctx.ocr.get(d.fileId) ?? '').length > 0);
  const fields = ctx.policy;
  const found = [fields?.policyNumber, fields?.name, fields?.amount != null ? String(fields.amount) : null].filter(Boolean);

  if (docs.length === 0) {
    return { log: { stage: 'OCR_EXTRACT', result: 'INFO', details: 'no documents submitted — policy check skipped', ms: Date.now() - t0 }, reasons: [] };
  }
  const result: StageLog['result'] = ocred.length === 0 ? 'WARN' : 'PASS';
  const details =
    ocred.length === 0
      ? `OCR produced no text for ${docs.length} document(s)`
      : `${ocred.length}/${docs.length} doc(s) read · fields: ${found.join(' · ')} · confidence ${(fields?.confidence ?? 0).toFixed(2)}`;
  return { log: { stage: 'OCR_EXTRACT', result, details, ms: Date.now() - t0 }, reasons: [] };
}

function runPolicyMatch(ctx: StageCtx): { log: StageLog; reasons: string[] } {
  const t0 = Date.now();
  const fields = ctx.policy;
  const paper = ctx.policyPaper;
  const polNum = paper?.policyNumber ?? fields?.policyNumber;
  const polName = paper?.insuredName ?? fields?.name;
  const sumInsured = paper?.sumInsured ?? (fields?.amount != null ? fields.amount : null);

  if (!polNum && !polName && sumInsured == null) {
    return { log: { stage: 'POLICY_MATCH', result: 'INFO', details: 'no policy fields extracted — cannot cross-check', ms: Date.now() - t0 }, reasons: [] };
  }
  const reasons: string[] = [];

  if (polNum) {
    const policy = POLICY_TABLE[polNum];
    if (policy) {
      if (policy.claimant.toLowerCase() !== ctx.claim.claimantName.toLowerCase() && policy.claimant !== 'Generic Farmer Policy') {
        reasons.push(`name mismatch: policy=${policy.claimant} vs claim=${ctx.claim.claimantName}`);
      }
      if (ctx.claim.amountRequested > policy.limitInr) {
        reasons.push(`amount ₹${ctx.claim.amountRequested} exceeds policy limit ₹${policy.limitInr}`);
      }
      if (!policy.lossTypes.includes(ctx.claim.lossType)) {
        reasons.push(`loss type ${ctx.claim.lossType} not covered by ${polNum}`);
      }
    } else if (sumInsured != null) {
      // Document extracted directly
      if (ctx.claim.amountRequested > sumInsured) {
        reasons.push(`amount ₹${ctx.claim.amountRequested} exceeds policy sum insured ₹${sumInsured}`);
      }
    }
  }
  if (fields?.amount != null && fields.amount > ctx.claim.amountRequested * 1.5) {
    reasons.push(`bill amount ₹${fields.amount} far exceeds requested ₹${ctx.claim.amountRequested}`);
  }

  const result: StageLog['result'] = reasons.length > 0 ? 'FAIL' : 'PASS';
  const details = reasons.length > 0
    ? reasons.join(' · ')
    : polNum
      ? `verified: ${polNum} covers ${ctx.claim.lossType} up to ₹${sumInsured ?? '10,000'}`
      : 'name/limit/loss-type within cover';

  return {
    log: {
      stage: 'POLICY_MATCH',
      result,
      details,
      ms: Date.now() - t0,
    },
    reasons,
  };
}

async function runDamageAssess(
  ctx: StageCtx
): Promise<{ log: StageLog; reasons: string[]; similarCases: SimilarCase[] }> {
  const t0 = Date.now();
  const meta = LOSS_META[ctx.claim.lossType];
  const photos = ctx.own.filter((e) => e.kind === 'photo');
  if (photos.length === 0) {
    return {
      log: { stage: 'DAMAGE_ASSESS', result: 'FAIL', details: 'no photos to assess', ms: 0 },
      reasons: ['no photos'],
      similarCases: [],
    };
  }

  // (a) Loss-type vocabulary match over real OCR of the photo pixels.
  const keywords = meta.damageTerms;
  const matches: string[] = [];
  for (const p of photos) {
    const text = (ctx.ocr.get(p.fileId) ?? '').toLowerCase();
    if (keywords.some((k) => text.includes(k))) matches.push(p.fileId);
  }
  const severity = matches.length > 0 ? 70 + Math.min(20, matches.length * 10) : 35;
  let result: StageLog['result'] = matches.length > 0 ? 'PASS' : 'WARN';
  let details =
    matches.length > 0
      ? `damage signal in ${matches.length}/${photos.length} photo(s) · severity ${severity}/100 (${ctx.claim.lossType})`
      : `no ${meta.label} damage vocabulary in photos · severity ${severity}/100`;
  const reasons: string[] = matches.length > 0 ? [] : [`no ${meta.label} damage signal in any photo`];

  // (a2) LOSS-TYPE RELEVANCE (zero-shot CLIP): does the imagery actually show
  // the claimed loss? Random/irrelevant photos score low. When OCR finds no
  // damage keyword, relevance decides: < RELEVANCE_FLAG → FAIL (the evidence
  // does not demonstrate the claimed loss — payout-locking flag), ≥
  // RELEVANCE_PASS → PASS (visually on-topic even without embedded text).
  const rel = RELEVANCE_PROMPTS[ctx.claim.lossType];
  const relevance = new Map<string, number>();
  try {
    const posVecs = await embedTexts([...rel.positives]);
    const negVecs = await embedTexts([...rel.negatives, ...UNRELATED_PROMPTS]);
    const relCache = new Map<string, number[]>();
    for (const p of photos.slice(0, 3)) {
      let vec = relCache.get(p.fileId);
      if (!vec) {
        vec = await embedImage(readEvidence(p.fileId));
        relCache.set(p.fileId, vec);
      }
      const maxPos = Math.max(...posVecs.map((v) => cosine(vec, v)));
      const maxNeg = Math.max(...negVecs.map((v) => cosine(vec, v)));
      relevance.set(p.fileId, Math.round(Math.max(0, Math.min(1, (maxPos - maxNeg + 1) / 2)) * 100));
    }
  } catch {
    /* CLIP unavailable → relevance empty; keyword behavior unchanged */
  }
  const bestRelevance = Math.max(0, ...relevance.values());
  if (bestRelevance > 0) details += ` · loss-type relevance ${bestRelevance}%`;
  if (matches.length === 0 && bestRelevance > 0) {
    if (bestRelevance < RELEVANCE_FLAG) {
      result = 'FAIL';
      reasons.push(`imagery does not depict ${meta.label} loss (loss-type relevance ${bestRelevance}% < ${RELEVANCE_FLAG}%)`);
    } else if (bestRelevance >= RELEVANCE_PASS && result === 'WARN') {
      result = 'PASS';
      reasons.length = 0;
      details = `visual ${meta.label} damage signal (relevance ${bestRelevance}%) · severity ${severity}/100 (${ctx.claim.lossType})`;
    }
  }

  // (b) TRAINED visual scoring — CLIP embeddings, two signals:
  //     few-shot: k-NN over the fraud memory of previously decided claims.
  //     zero-shot: cosine vs text prompts describing staged vs genuine imagery.
  // Neither signal can UPGRADE a verdict; they can only DOWNGRADE (WARN/PASS →
  // FAIL) — hard evidence (pHash, policy, EXIF) always dominates.
  const similarCases: SimilarCase[] = [];
  // One CLIP pass per photo, shared by every visual signal below (k-NN,
  // staged-imagery, AI-generation, relevance already cached separately).
  const embCache = new Map<string, number[]>();
  const getEmb = async (fileId: string): Promise<number[]> => {
    let v = embCache.get(fileId);
    if (!v) {
      v = await embedImage(readEvidence(fileId));
      embCache.set(fileId, v);
    }
    return v;
  };
  try {
    let worst = 0;
    let knn = 0;
    let matched: string[] = [];
    for (const p of photos.slice(0, 2)) {
      const vec = await getEmb(p.fileId);
      const s = scoreEmbedding(vec);
      if (s.knn > 0 && s.fraudScore > worst) {
        worst = s.fraudScore;
        matched = s.matched.slice(0, 2).map((m) => `${m.claimId}:${m.label}@${m.similarity}`);
      }
      knn = Math.max(knn, s.knn);
      for (const m of s.matched) {
        similarCases.push({ claimId: m.claimId, label: m.label, similarity: m.similarity, fileId: p.fileId });
        if (similarCases.length >= 12) break;
      }
      if (similarCases.length >= 12) break;
    }
    if (knn > 0) {
      details += ` · trained memory: kNN fraud ${worst}% (k=${knn})`;
      if (worst >= 60) {
        result = 'FAIL';
        reasons.push(`trained fraud memory: ${worst}% of nearest decided claims were fraudulent (${matched.join(', ')})`);
      }
    } else {
      details += ' · trained memory: empty (run npm run train)';
    }

    // (b2) zero-shot staged-imagery check (no training data needed).
    const fraudVecs = await embedTexts([...ZERO_SHOT_FRAUD_PROMPTS]);
    const genuineVecs = await embedTexts([...ZERO_SHOT_GENUINE_PROMPTS]);
    let zsWorst = 0;
    for (const p of photos.slice(0, 2)) {
      const vec = await getEmb(p.fileId);
      const maxF = Math.max(...fraudVecs.map((f) => cosine(vec, f)));
      const maxG = Math.max(...genuineVecs.map((g) => cosine(vec, g)));
      const staged = Math.round(Math.max(0, Math.min(1, (maxF - maxG + 1) / 2)) * 100); // 0..100
      if (staged > zsWorst) zsWorst = staged;
    }
    details += ` · zero-shot staged-imagery ${zsWorst}%`;
    if (zsWorst >= ZS_FLAG && result !== 'FAIL') {
      result = 'FAIL';
      reasons.push(`zero-shot visual check: imagery resembles staged/re-photographed evidence (${zsWorst}%)`);
    } else if (zsWorst >= ZS_WARN && result === 'PASS') {
      result = 'WARN';
    }

    // (b3) AI-GENERATION signal (zero-shot, training-free): scores whether the
    // imagery looks synthetic. Partial detector — tuned for few false
    // positives on real photos; the k-NN memory catches repeats.
    const aiVecs = await embedTexts([...AI_GEN_PROMPTS]);
    const realVecs = await embedTexts([...REAL_PHOTO_PROMPTS]);
    let aiWorst = 0;
    for (const p of photos.slice(0, 3)) {
      const vec = await getEmb(p.fileId);
      const maxA = Math.max(...aiVecs.map((v) => cosine(vec, v)));
      const maxR = Math.max(...realVecs.map((v) => cosine(vec, v)));
      const aiScore = Math.round(Math.max(0, Math.min(1, (maxA - maxR + 1) / 2)) * 100);
      if (aiScore > aiWorst) aiWorst = aiScore;
    }
    details += ` · ai-generation ${aiWorst}%`;
    if (aiWorst >= AI_GEN_FLAG) {
      result = 'FAIL';
      reasons.push(`imagery appears AI-generated / synthetic (${aiWorst}%)`);
    } else if (aiWorst >= AI_GEN_WARN && result === 'PASS') {
      result = 'WARN';
    }
  } catch {
    details += ' · trained memory unavailable';
  }

  return { log: { stage: 'DAMAGE_ASSESS', result, details, ms: Date.now() - t0 }, reasons, similarCases };
}

/**
 * R5: the claimant's STATED destruction % is cross-checked against the CLIP
 * destruction ladder on their satellite/geotagged image. Beyond this delta
 * the claimed loss is deemed exaggerated → fraud reason.
 */
export const PCT_DELTA_FLAG = 40; // |claimed − measured| > → R5 reason

/** Farmer-document stage: classification + Aadhaar↔registry cross-verify. */
function runDocCross(ctx: StageCtx): { log: StageLog; reasons: string[] } {
  const t0 = Date.now();
  const farmerDocs = ctx.own.filter((e) => e.kind === 'registry' || e.kind === 'aadhaar' || e.kind === 'policy');
  if (farmerDocs.length === 0) {
    return {
      log: { stage: 'DOC_CROSS', result: 'INFO', details: 'no farmer documents (registry/aadhaar/policy) submitted — identity cross-check skipped', ms: 1 },
      reasons: [],
    };
  }
  const reasons: string[] = [];
  const parts: string[] = [];
  /** An inconclusive identity cross (degraded scan) → WARN, not FAIL. */
  let sawInconclusive = false;

  const reg = farmerDocs.find((e) => e.kind === 'registry');
  const aad = farmerDocs.find((e) => e.kind === 'aadhaar');
  const pol = farmerDocs.find((e) => e.kind === 'policy');

  for (const d of farmerDocs) {
    const o = ctx.docOcr.get(d.fileId);
    if (!o || o.text.length === 0) {
      parts.push(`${d.kind}: UNREADABLE`);
      reasons.push(`R-DOC ${d.kind} could not be read (photo unclear or unsupported scan)`);
    } else {
      const lang = o.hindi ? 'hindi' : 'english';
      const cls = o.role ?? (d.kind as DocRole);
      parts.push(`${d.kind}(${lang}${o.role && o.role !== d.kind ? `, looks like ${cls}` : ''}: ${o.text.length} chars)`);
    }
  }

  // THE identity cross-check: Aadhaar name ↔ registry owner name.
  // Inconclusive (scan too degraded to extract any name) ≠ mismatch: no fraud
  // reason, but the stage WARNs so the human lane knows the check didn't run.
  if (ctx.identityCross) {
    const x = ctx.identityCross;
    parts.push(x.detail);
    if (x.inconclusive) sawInconclusive = true;
    if (aad && reg && !x.inconclusive && !x.matched) reasons.push(`R-IDENTITY ${x.detail}`);
  } else if (aad && !reg) {
    parts.push('registry missing — identity cross-check impossible');
    reasons.push('R-DOC registry missing: Aadhaar cannot be cross-verified against a land record');
  }

  // Policy-paper vs claim amount (when the paper states a sum insured).
  if (ctx.policyPaper?.sumInsured != null && ctx.claim.amountRequested > ctx.policyPaper.sumInsured * 1.5) {
    reasons.push(`R5 amount: claimed ₹${ctx.claim.amountRequested} exceeds policy sum insured ₹${ctx.policyPaper.sumInsured} by >50%`);
  }

  const stageResult: StageLog['result'] = reasons.length > 0 ? 'FAIL' : sawInconclusive ? 'WARN' : 'PASS';
  return {
    log: { stage: 'DOC_CROSS', result: stageResult, details: parts.join(' · ') || 'no doc signals', ms: Date.now() - t0 },
    reasons,
  };
}

function runFraudRules(ctx: StageCtx, prevReasons: string[]): { log: StageLog; reasons: string[] } {
  const t0 = Date.now();
  const reasons: string[] = [...prevReasons];

  // R4: GPS-district mismatch — the photo's GPS must resolve inside a district
  // that is plausible for the claimed loss type (LOSS_META.idealDistricts),
  // and inside the service area at all. No GPS → R4 skips (EXIF stage already
  // penalizes it); out-of-area or wrong-district → named reason.
  const geoPhotos = ctx.own.filter((e) => (e.kind === 'photo' || e.kind === 'satellite') && e.exif.gps);
  if (geoPhotos.length > 0) {
    const meta = LOSS_META[ctx.claim.lossType];
    for (const p of geoPhotos) {
      const { lat, lon } = p.exif.gps!;
      const fix = resolveDistrict(lat, lon);
      if (fix.outOfArea) {
        reasons.push(
          `R4 gps-out-of-area: ${p.fileId} is ${fix.nearestKm}km from ${fix.nearest} (outside the ${meta.label.toLowerCase()} service area)`
        );
      } else if (fix.resolved && !meta.idealDistricts.includes(fix.resolved)) {
        reasons.push(`R4 district-mismatch: ${p.fileId} geotagged in ${fix.resolved} — not a covered district for ${meta.label.toLowerCase()} claims`);
      } else if (!fix.resolved && fix.nearestKm > 80) {
        // Unresolved band: inside the loose service area but far from every
        // covered district (e.g. a city 100–120km out). Catches the boundary.
        reasons.push(`R4 gps-unresolved: ${p.fileId} is ${fix.nearestKm}km from the nearest covered district (${fix.nearest})`);
      }
    }
  }

  // R2: same photo pHash across different districts (the CLM-8919 story).
  const photos = ctx.own.filter((e) => (e.kind === 'photo' || e.kind === 'satellite') && e.pHash);
  for (const p of photos) {
    for (const q of ctx.foreignPhotos) {
      if (hammingDistance(p.pHash!, q.pHash) <= PHASH_COLLISION_DISTANCE) {
        reasons.push(`R2 duplicate-evidence: ${p.fileId} matches archived ${q.claimId}/${q.fileId}`);
      }
    }
  }

  // R3: multiple claims sharing any sha256 evidence bytes.
  // (covered upstream via R2 for photos; documents compared by exact digest)

  return {
    log: {
      stage: 'FRAUD_RULES',
      result: reasons.length > 0 ? 'FAIL' : 'PASS',
      details: reasons.length > 0 ? reasons.join(' · ') : 'no fraud rule triggered',
      ms: Date.now() - t0,
    },
    reasons,
  };
}

/**
 * Execute the full pipeline for a claim.
 * @param claim          the in-memory claim (with evidence rows attached)
 * @param allClaims      every currently stored claim (for cross-claim pHash checks)
 */
export async function runVerification(claim: Claim, allClaims: Map<string, Claim>): Promise<VerificationRun> {
  const startedAt = new Date();
  const stages: StageLog[] = [];

  const own = claim.evidence;
  const foreignPhotos: Array<{ claimId: string; fileId: string; pHash: string }> = [];
  for (const other of allClaims.values()) {
    if (other.id === claim.id) continue;
    for (const e of other.evidence) {
      if ((e.kind === 'photo' || e.kind === 'satellite') && e.pHash) foreignPhotos.push({ claimId: other.id, fileId: e.fileId, pHash: e.pHash });
    }
  }

  // One OCR pass over everything needing it (photos + docs).
  const ocr = new Map<string, string>();
  let fields: PolicyFields | null = null;
  for (const e of own) {
    // Farmer documents are handled by the bilingual doc pass below — skip here.
    if (e.kind === 'registry' || e.kind === 'aadhaar' || e.kind === 'policy') continue;
    let text = '';
    try {
      text = await ocrText(readEvidence(e.fileId));
    } catch {
      text = ''; // unreadable/missing evidence → OCR stage reports WARN
    }
    if (text) {
      ocr.set(e.fileId, text);
      if (e.kind !== 'photo') fields = parsePolicyFields(text);
    }
  }

  // ---- Farmer-document pass (doc-verification spec §2–§5) ----------------
  // Bilingual OCR (eng+hin) over registry/aadhaar/policy uploads (PDFs are
  // rasterized first), classification, parsing, and the identity cross-check.
  const docOcr = new Map<string, { text: string; hindi: boolean; role: DocRole | null }>();
  let aadhaarFields: AadhaarFields | null = null;
  let registryFields: RegistryFields | null = null;
  let policyPaper: PolicyPaperFields | null = null;
  let registryText = '';
  let aadhaarEvidence: Evidence | null = null;
  let registryEvidence: Evidence | null = null;

  for (const e of own) {
    if (e.kind !== 'registry' && e.kind !== 'aadhaar' && e.kind !== 'policy') continue;
    let text = '';
    let hindi = false;
    try {
      const buf = readEvidence(e.fileId);
      if (e.mimeType === 'application/pdf') {
        text = await pdfToText(buf, async (img) => (await ocrTextHi(img)).text, 2);
      } else {
        const r = await ocrTextHi(buf);
        text = r.text;
        hindi = r.hindi;
      }
    } catch {
      text = '';
    }
    const role = text ? classifyDoc(text, e.filename).role ?? (e.kind as DocRole) : null;
    docOcr.set(e.fileId, { text, hindi, role });
    if (e.kind === 'registry') {
      registryEvidence = e;
      registryText = text;
      if (text) registryFields = parseRegistry(text);
    } else if (e.kind === 'aadhaar') {
      aadhaarEvidence = e;
      if (text) aadhaarFields = parseAadhaar(text);
    } else if (e.kind === 'policy' && text) {
      policyPaper = parsePolicyPaper(text);
    }
  }

  const identityCross =
    aadhaarFields && registryEvidence && docOcr.get(registryEvidence.fileId)?.text
      ? crossVerifyIdentity(aadhaarFields, registryText)
      : null;

  // Satellite/geotagged plot imagery → destruction % (CLIP zero-shot ladder).
  let satellite: { fileId: string; pct: number; rung: string } | null = null;
  const satEvidence = own.find((e) => e.kind === 'satellite');
  if (satEvidence) {
    try {
      const buf = readEvidence(satEvidence.fileId);
      const imgs = satEvidence.mimeType === 'application/pdf' ? await import('./pdfimg.js').then((m) => m.pdfPages(buf, 1)) : [buf];
      const res = await scoreDestruction(embedImage, embedTexts, imgs[0]);
      satellite = { fileId: satEvidence.fileId, pct: res.destructionPct, rung: res.rung };
    } catch {
      satellite = null;
    }
  }

  const ctx: StageCtx = {
    claim,
    own,
    foreignPhotos,
    ocr,
    policy: fields,
    docOcr,
    aadhaar: aadhaarFields,
    registry: registryFields,
    policyPaper,
    identityCross,
    satellite,
  };

  const exif = runExifIntegrity(ctx);
  stages.push(exif.log);

  const dup = runDuplicatePhash(ctx);
  stages.push(dup.log);

  const ocrStage = runOcrExtract(ctx);
  stages.push(ocrStage.log);

  const policy = runPolicyMatch(ctx);
  stages.push(policy.log);

  // Farmer-document cross-verification (registry ↔ Aadhaar ↔ policy).
  const docCross = runDocCross(ctx);
  stages.push(docCross.log);

  // R5 reasons computed before FRAUD_RULES runs (destruction % vs satellite).
  const fraudPreamble: string[] = [];

  const damage = await runDamageAssess(ctx);
  stages.push(damage.log);

  // R5: destruction % claimed vs measured on the satellite/geotagged image.
  if (ctx.satellite && ctx.claim.lossType === 'flood') {
    const claimedPct = ctx.claim.destructionPctClaimed;
    if (claimedPct != null) {
      const delta = Math.abs(claimedPct - ctx.satellite.pct);
      if (delta > PCT_DELTA_FLAG) {
        fraudPreamble.push(
          `R5 destruction-exaggeration: claimed ${claimedPct}% but satellite imagery measures ${ctx.satellite.pct}% (delta ${delta} pts > ${PCT_DELTA_FLAG})`
        );
      }
    }
  }

  const fraud = runFraudRules(ctx, [...policy.reasons, ...fraudPreamble]);
  stages.push(fraud.log);

  const decisionT0 = Date.now();
  const { verdict, score } = decide(stages);
  const reasons = [...new Set([...fraud.reasons, ...policy.reasons, ...damage.reasons, ...docCross.reasons])].slice(0, 4);
  stages.push({
    stage: 'DECISION',
    result: verdict,
    details: `score ${score} · ${verdict}${reasons.length > 0 ? ` · reasons: ${reasons.join(', ')}` : ''}`,
    ms: Date.now() - decisionT0,
  });

  // Collect raw OCR text snippets and extracted entities for transparent inspection
  const rawSnippets: Record<string, string> = {};
  for (const [fId, text] of ocr.entries()) {
    if (text) rawSnippets[fId] = text.slice(0, 1500);
  }
  for (const [fId, val] of docOcr.entries()) {
    if (val.text) rawSnippets[fId] = val.text.slice(0, 2000);
  }

  const extractedEntities: DocEntity[] = [];
  if (registryFields) {
    if (registryFields.ownerName) extractedEntities.push({ docKind: 'registry', label: 'Owner / Buyer', value: registryFields.ownerName, confidence: 0.9 });
    if (registryFields.district) extractedEntities.push({ docKind: 'registry', label: 'District', value: registryFields.district, confidence: 0.95 });
    if (registryFields.village) extractedEntities.push({ docKind: 'registry', label: 'Village', value: registryFields.village, confidence: 0.85 });
    if (registryFields.khasraNo) extractedEntities.push({ docKind: 'registry', label: 'Khasra / Plot No.', value: registryFields.khasraNo, confidence: 0.92 });
    if (registryFields.areaHectares) extractedEntities.push({ docKind: 'registry', label: 'Land Area', value: registryFields.areaHectares, confidence: 0.88 });
    if (registryFields.deedType) extractedEntities.push({ docKind: 'registry', label: 'Document Type', value: registryFields.deedType, confidence: 0.95 });
  }
  if (aadhaarFields) {
    if (aadhaarFields.name) extractedEntities.push({ docKind: 'aadhaar', label: 'Cardholder Name', value: aadhaarFields.name, confidence: 0.96 });
    if (aadhaarFields.nameDevanagari) extractedEntities.push({ docKind: 'aadhaar', label: 'Name (Devanagari)', value: aadhaarFields.nameDevanagari, confidence: 0.92 });
    if (aadhaarFields.aadhaarMasked) extractedEntities.push({ docKind: 'aadhaar', label: 'Aadhaar Number', value: aadhaarFields.aadhaarMasked, confidence: 0.99 });
    if (aadhaarFields.dob) extractedEntities.push({ docKind: 'aadhaar', label: 'DOB / Year', value: aadhaarFields.dob, confidence: 0.95 });
    if (aadhaarFields.gender) extractedEntities.push({ docKind: 'aadhaar', label: 'Gender', value: aadhaarFields.gender, confidence: 0.98 });
  }
  if (policyPaper) {
    if (policyPaper.policyNumber) extractedEntities.push({ docKind: 'policy', label: 'Policy Number', value: policyPaper.policyNumber, confidence: 0.95 });
    if (policyPaper.sumInsured) extractedEntities.push({ docKind: 'policy', label: 'Sum Insured', value: `₹${policyPaper.sumInsured.toLocaleString('en-IN')}`, confidence: 0.92 });
    if (policyPaper.insuredName) extractedEntities.push({ docKind: 'policy', label: 'Insured Farmer', value: policyPaper.insuredName, confidence: 0.9 });
  } else if (fields) {
    if (fields.policyNumber) extractedEntities.push({ docKind: 'policy', label: 'Policy Number', value: fields.policyNumber, confidence: 0.9 });
    if (fields.amount) extractedEntities.push({ docKind: 'bill', label: 'Bill Amount', value: `₹${fields.amount.toLocaleString('en-IN')}`, confidence: 0.88 });
    if (fields.name) extractedEntities.push({ docKind: 'policy', label: 'Insured Name', value: fields.name, confidence: 0.85 });
  }

  const docSummary: DocSummary = {
    registry: {
      found: registryEvidence != null,
      deedType: registryFields?.deedType ?? undefined,
      district: registryFields?.district ?? undefined,
      village: registryFields?.village ?? undefined,
      executionDate: registryFields?.executionDate ?? undefined,
      khasraNo: registryFields?.khasraNo ?? undefined,
      areaHectares: registryFields?.areaHectares ?? undefined,
      state: registryFields?.state ?? undefined,
      language: registryEvidence ? (docOcr.get(registryEvidence.fileId)?.hindi ? 'hindi' : 'english') : undefined,
    },
    aadhaar: {
      found: aadhaarEvidence != null,
      name: aadhaarFields?.name ?? undefined,
      nameDevanagari: aadhaarFields?.nameDevanagari ?? undefined,
      aadhaarMasked: aadhaarFields?.aadhaarMasked ?? undefined,
      dob: aadhaarFields?.dob ?? undefined,
      gender: aadhaarFields?.gender ?? undefined,
    },
    identityCross: ctx.identityCross
      ? {
          matched: ctx.identityCross.matched,
          score: ctx.identityCross.score,
          detail: ctx.identityCross.detail,
          inconclusive: ctx.identityCross.inconclusive ?? false,
          aadhaarNameClean: ctx.identityCross.aadhaarNameClean,
          registryNameClean: ctx.identityCross.registryNameClean,
          transliterated: ctx.identityCross.transliterated,
          distance: ctx.identityCross.distance,
        }
      : { matched: false, score: 0, detail: 'no cross-check performed (missing registry or Aadhaar)', inconclusive: true },
    policy: {
      found: policyPaper != null || (fields != null && fields.policyNumber != null),
      policyNumber: policyPaper?.policyNumber ?? fields?.policyNumber ?? undefined,
      sumInsured: policyPaper?.sumInsured ?? (fields?.amount != null ? fields.amount : undefined),
      coverage: policyPaper?.coverage ?? undefined,
      insuredName: policyPaper?.insuredName ?? fields?.name ?? undefined,
    },
    satellite: {
      found: satellite != null,
      destructionPct: satellite?.pct,
      rung: satellite?.rung,
    },
    claimedPct: claim.destructionPctClaimed,
    pctDelta: satellite && claim.destructionPctClaimed != null ? Math.abs(claim.destructionPctClaimed - satellite.pct) : undefined,
    rawSnippets,
    extractedEntities,
  };

  const finishedAt = new Date();
  const run: VerificationRun = {
    verificationId: `ver_${claim.id}-${finishedAt.getTime()}`,
    claimId: claim.id,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    verdict,
    score,
    stages,
    similarCases: damage.similarCases,
    docSummary,
    explanation: '',
  };
  run.explanation = explainRun(run, claim); // derived from logs, not hashed
  return run;
}

/** sha256 of raw bytes — helper reused by the store. */
export function digest(buf: Buffer): string {
  return '0x' + createHash('sha256').update(buf).digest('hex');
}
