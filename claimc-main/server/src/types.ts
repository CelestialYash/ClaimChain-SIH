import type { ClaimStatusName } from './chain/chain.js';

export interface Claim {
  id: string;
  claimantName: string;
  lossType: 'flood' | 'drought' | 'livestock';
  amountRequested: number;
  status: ClaimStatusName;
  submittedAt: string;
  imageHashes: string[]; // sha256 hex (evidence-derived); seeded claims keep legacy labels
  evidence: Evidence[];
  policyNumber?: string;
  /** Latest verification run for this claim (decision + stage logs). */
  verification?: VerificationRun;
  /** Sealed stateHash of the latest on-chain record for this claim. */
  latestStateHash?: string;
  /** Farmer-stated destruction % (doc-verification spec §5, R5 cross-check). */
  destructionPctClaimed?: number;
}

export interface Evidence {
  fileId: string;
  kind: 'photo' | 'bill' | 'id' | 'registry' | 'aadhaar' | 'satellite' | 'policy';
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  pHash: string | null;
  exif: {
    gps?: { lat: number; lon: number };
    takenAt?: string;
    device?: string;
    software?: string;
    present: boolean;
  };
  /** Text extracted by OCR (bills / id). */
  ocrText?: string;
  createdAt: string;
}

export interface VerificationRun {
  verificationId: string;
  claimId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  verdict: 'AI_APPROVED' | 'AI_FLAGGED' | 'AI_REJECTED';
  score: number;
  stages: StageLog[];
  /** Plain-language reasoning (stage 7). Derived from the logs — NOT part of verificationHash. */
  explanation: string;
  /** Nearest decided claims from the trained fraud memory (k-NN neighbors, deduped by claim). Derived — not hashed. */
  similarCases: SimilarCase[];
  /** Farmer-document intelligence summary (doc-verification spec §2–§5). Derived — not hashed. */
  docSummary?: DocSummary;
}

export interface DocEntity {
  docKind: string;
  label: string;
  value: string;
  confidence: number;
}

/** Cross-document verification result surfaced to the frontend (stage 3/4/5). */
export interface DocSummary {
  registry: {
    found: boolean;
    deedType?: string;
    district?: string;
    village?: string;
    executionDate?: string;
    khasraNo?: string;
    areaHectares?: string;
    state?: string;
    language?: 'hindi' | 'english' | 'mixed';
  };
  aadhaar: {
    found: boolean;
    name?: string;
    nameDevanagari?: string;
    aadhaarMasked?: string;
    dob?: string;
    gender?: string;
  };
  identityCross: {
    matched: boolean;
    score: number;
    detail: string;
    inconclusive?: boolean;
    aadhaarNameClean?: string;
    registryNameClean?: string;
    transliterated?: string;
    distance?: number;
  };
  policy: {
    found: boolean;
    policyNumber?: string;
    sumInsured?: number;
    coverage?: string[];
    insuredName?: string;
  };
  satellite: {
    found: boolean;
    destructionPct?: number;
    rung?: string;
    /** Tile provenance when the imagery was server-fetched (R5 fix). */
    tileId?: string;
    provider?: string;
    prePostNdvi?: { pre: number; post: number };
  };
  claimedPct?: number;
  pctDelta?: number;
  /** Snippets of raw text read from documents by OCR (fileId -> raw text snippet). */
  rawSnippets?: Record<string, string>;
  /** Key-value entities extracted across all farmer documents. */
  extractedEntities?: DocEntity[];
}

/** A previously DECIDED claim that visually resembles this claim's evidence. */
export interface SimilarCase {
  claimId: string;
  label: 'genuine' | 'fraud';
  /** Cosine similarity 0..1 (rounded to 3 decimals) from the CLIP embedding space. */
  similarity: number;
  /** Which of this claim's evidence files matched. */
  fileId: string;
}

export interface StageLog {
  stage: string;
  /** Intermediate stages emit PASS/FAIL/WARN/INFO; the DECISION stage emits the verdict. */
  result: 'PASS' | 'FAIL' | 'WARN' | 'INFO' | 'AI_APPROVED' | 'AI_FLAGGED' | 'AI_REJECTED';
  details: string;
  ms: number;
}

export const LOSS_META: Record<
  Claim['lossType'],
  { label: string; damageTerms: string[]; idealDistricts: string[] }
> = {
  flood: {
    label: 'Flood',
    damageTerms: ['flood', 'water', 'soaked', 'drowned', 'inundated', 'rain', 'muddy'],
    idealDistricts: ['yavatmal', 'nanded', 'thane', 'bhiwandi', 'amravati'],
  },
  drought: {
    label: 'Drought',
    damageTerms: ['drought', 'dry', 'cracked', 'withered', 'parched'],
    idealDistricts: ['nanded', 'yavatmal', 'solapur', 'latur'],
  },
  livestock: {
    label: 'Livestock',
    damageTerms: ['livestock', 'cattle', 'cow', 'ox', 'buffalo', 'goat', 'injured', 'deceased'],
    idealDistricts: ['yavatmal', 'nanded', 'amaravati', 'akola'],
  },
};

/**
 * In-memory policy table (§1.2 of CLAIMCHAIN_WORKFLOW.md — persistence deferred).
 * Deterministic lookup so POLICY_MATCH behaves identically for identical inputs.
 */
export const POLICY_TABLE: Record<string, { claimant: string; limitInr: number; lossTypes: string[] }> = {
  'MH-12-9931': { claimant: 'Ramesh Kumar', limitInr: 10000, lossTypes: ['flood', 'drought'] },
  'MH-27-4102': { claimant: 'Devendra Singh', limitInr: 12000, lossTypes: ['flood', 'livestock'] },
  'MH-22-7789': { claimant: 'Sunita Pawar', limitInr: 8000, lossTypes: ['drought', 'flood'] },
  'MH-31-2255': { claimant: 'Generic Farmer Policy', limitInr: 10000, lossTypes: ['flood', 'drought', 'livestock'] },
};
