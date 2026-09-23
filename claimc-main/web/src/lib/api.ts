/**
 * Typed client for the ClaimChain API (server/, port 4000 via Vite proxy).
 * Mirrors the server's full surface: multipart intake, 7-stage verification
 * logs (en/hi), similar cases, audit trail, guarded transitions, pay,
 * tamper/restore demo, fraud memory, stats.
 */

export type LossType = 'flood' | 'drought' | 'livestock';

export type ClaimStatus =
  | 'SUBMITTED'
  | 'AI_APPROVED'
  | 'AI_FLAGGED'
  | 'AI_REJECTED'
  | 'HUMAN_REVIEW'
  | 'HUMAN_APPROVED'
  | 'HUMAN_REJECTED'
  | 'HUMAN_OVERRIDDEN'
  | 'PAID'
  | 'REJECTED';

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
  ocrText?: string;
  createdAt: string;
}

export interface StageLog {
  stage: string;
  result: 'PASS' | 'FAIL' | 'WARN' | 'INFO' | 'AI_APPROVED' | 'AI_FLAGGED' | 'AI_REJECTED';
  details: string;
  ms: number;
}

export interface SimilarCase {
  claimId: string;
  label: 'genuine' | 'fraud';
  similarity: number;
  fileId: string;
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
  similarCases: SimilarCase[];
  explanation: string;
  docSummary?: DocSummary;
}

/** Entity extracted from a farmer document by OCR + NLP. */
export interface DocEntity {
  docKind: string;
  label: string;
  value: string;
  confidence: number;
}

/** Farmer-document intelligence (registry ↔ Aadhaar ↔ policy ↔ satellite). */
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
  satellite: { found: boolean; destructionPct?: number; rung?: string };
  claimedPct?: number;
  pctDelta?: number;
  /** Snippets of raw text read from documents by OCR (fileId → raw text snippet). */
  rawSnippets?: Record<string, string>;
  /** Key-value entities extracted across all farmer documents. */
  extractedEntities?: DocEntity[];
}

export interface Claim {
  id: string;
  claimantName: string;
  lossType: LossType;
  amountRequested: number;
  status: ClaimStatus;
  submittedAt: string;
  imageHashes: string[];
  evidence: Evidence[];
  policyNumber?: string;
  verification?: VerificationRun;
  latestStateHash?: string;
  destructionPctClaimed?: number;
}

export interface Health {
  ok: boolean;
  service: string;
  version: string;
  chain: { enabled: boolean; contract: string | null; totalRecords: string | null };
}

export interface AuditRecord {
  stateHash: string;
  prevRecordHash: string;
  recordHash: string;
  status: number;
  timestamp: string;
  sealedAtIso: string;
  recordedBy: string;
  note: string;
}

export interface AuditTrail {
  claimId: string;
  recordCount: number;
  integrity: {
    offChainValid: boolean;
    offChainBreakAtIndex: number | null;
    onChainValid: boolean;
    onChainBreakAtIndex: number | null;
  };
  records: AuditRecord[];
}

export interface Stats {
  claimsToday: number;
  total: number;
  autoApproved: number;
  autoApprovalPct: number | null;
  flagged: number;
  flaggedLocked: number;
  leakagePreventedInr: number;
  paidInr: number;
  verificationDurationP50Ms: number | null;
  scoreThresholds: { FLAG: number; REJECT: number };
  totalRecords: number | null;
  chainEnabled: boolean;
}

export interface FraudMemory {
  size: number;
  genuine: number;
  fraud: number;
  file: string;
  trainable: boolean;
  engine: string;
}

export interface ChainEvent {
  claimId: string;
  claimIdRef: string | null;
  stateHash: string;
  recordHash: string;
  prevRecordHash: string;
  status: number;
  timestamp: string;
  sealedAtIso: string;
  recordedBy: string;
  txHash: string;
  blockNumber: number;
}

export interface TamperResult {
  demo: 'tamper' | 'restore';
  claimId: string;
  integrity: AuditTrail['integrity'];
  verdict: string;
}

export interface SimilarCasesResponse {
  claimId: string;
  engine: string;
  memorySize: number;
  cases: Array<SimilarCase & { lossType: LossType | null; amountRequested: number | null; status: ClaimStatus | null }>;
}

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body as { error?: string; message?: string };
    throw new Error(err.error ?? err.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}

function jsonInit(method: string, payload: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

export interface CreateClaimInput {
  claimantName: string;
  lossType: LossType;
  amountRequested: number;
  note?: string;
  policyNumber?: string;
  /** Farmer-stated destruction % — cross-checked vs satellite imagery (R5). */
  destructionPctClaimed?: number;
  photos: File[];
  bills?: File[];
  idDocs?: File[];
  /** Farmer document slots (flood flow): land registry, Aadhaar, satellite/geotag, policy paper. */
  registry?: File[];
  aadhaar?: File[];
  satellite?: File[];
  policy?: File[];
}

export const api = {
  health: () => request<Health>('/health'),
  stats: () => request<Stats>('/stats'),
  fraudMemory: () => request<FraudMemory>('/fraud-memory'),

  listClaims: () => request<Claim[]>('/claims'),
  getClaim: (id: string) => request<Claim>(`/claims/${id}`),

  /** Multipart intake — photos required (1–6), bills/idDocs optional. */
  createClaim: (input: CreateClaimInput) => {
    const fd = new FormData();
    fd.set('claimantName', input.claimantName);
    fd.set('lossType', input.lossType);
    fd.set('amountRequested', String(input.amountRequested));
    if (input.note) fd.set('note', input.note);
    if (input.policyNumber) fd.set('policyNumber', input.policyNumber);
    if (input.destructionPctClaimed != null) fd.set('destructionPctClaimed', String(input.destructionPctClaimed));
    for (const f of input.photos) fd.append('photos', f);
    for (const f of input.bills ?? []) fd.append('bills', f);
    for (const f of input.idDocs ?? []) fd.append('idDocs', f);
    for (const f of input.registry ?? []) fd.append('registry', f);
    for (const f of input.aadhaar ?? []) fd.append('aadhaar', f);
    for (const f of input.satellite ?? []) fd.append('satellite', f);
    for (const f of input.policy ?? []) fd.append('policy', f);
    return request<{ claim: Claim; evidence: Evidence[]; verificationJobId: string }>('/claims', {
      method: 'POST',
      body: fd,
    });
  },

  /** Late evidence → sealed ADDENDUM + re-verification. */
  addEvidence: (id: string, files: { photos?: File[]; bills?: File[]; idDocs?: File[] }) => {
    const fd = new FormData();
    for (const f of files.photos ?? []) fd.append('photos', f);
    for (const f of files.bills ?? []) fd.append('bills', f);
    for (const f of files.idDocs ?? []) fd.append('idDocs', f);
    return request<{ claim: Claim; sealed: boolean }>(`/claims/${id}/evidence`, { method: 'POST', body: fd });
  },

  verification: (id: string, lang: 'en' | 'hi' = 'en') =>
    request<{ claimId: string; status: 'RUNNING' | 'COMPLETE'; verification: VerificationRun | null }>(
      `/claims/${id}/verification${lang === 'hi' ? '?lang=hi' : ''}`,
    ),

  similarCases: (id: string) => request<SimilarCasesResponse>(`/claims/${id}/similar-cases`),

  auditTrail: (id: string) => request<AuditTrail>(`/claims/${id}/audit-trail`),

  /** Human review lane — AI verdicts are pipeline-only (server rejects them). */
  review: (id: string, status: 'HUMAN_APPROVED' | 'HUMAN_REJECTED' | 'HUMAN_REVIEW', note: string, reviewer: string) =>
    request<{ claim: Claim; sealed: boolean; txHash: string }>(`/claims/${id}/transitions`, {
      ...jsonInit('POST', { status, note, reviewer }),
    }),

  /** The ONLY payout path — server enforces RULE ZERO (409 FLAGGED_LOCKED). */
  pay: (id: string, upiRef: string) =>
    request<{ claim: Claim; sealed: boolean; paidInr: number; txHash: string }>(`/claims/${id}/pay`, {
      ...jsonInit('POST', { upiRef }),
    }),

  retryVerification: (id: string) =>
    request<{ claim: Claim; verification: VerificationRun; sealed: boolean }>(`/claims/${id}/verification/retry`, {
      method: 'POST',
    }),

  explorerEvents: (limit = 50) => request<{ count: number; events: ChainEvent[] }>(`/explorer/events?limit=${limit}`),

  explorerSearch: (q: string) =>
    request<{ query: string; interpretedAs: string; count: number; matches: ChainEvent[] }>(
      `/explorer/search?q=${encodeURIComponent(q)}`,
    ),

  tamper: (claimId: string, recordIndex = 1, forgedLabel = 'FORGED-PAYOUT-15000') =>
    request<TamperResult>('/demo/tamper', { ...jsonInit('POST', { claimId, recordIndex, forgedLabel }) }),

  restore: (claimId: string, recordIndex = 1) =>
    request<TamperResult>('/demo/restore', { ...jsonInit('POST', { claimId, recordIndex }) }),

  evidenceUrl: (fileId: string) => `${BASE}/evidence/${fileId}`,
  exportCsvUrl: () => `${BASE}/export.csv`,
};

export const STATUS_META: Record<ClaimStatus, { label: string; tone: 'ok' | 'ai' | 'warn' | 'bad' | 'muted' }> = {
  SUBMITTED: { label: 'Submitted', tone: 'ai' },
  AI_APPROVED: { label: 'AI approved', tone: 'ok' },
  AI_FLAGGED: { label: 'AI flagged', tone: 'warn' },
  AI_REJECTED: { label: 'AI rejected', tone: 'bad' },
  HUMAN_REVIEW: { label: 'Human review', tone: 'warn' },
  HUMAN_APPROVED: { label: 'Human approved', tone: 'ok' },
  HUMAN_REJECTED: { label: 'Human rejected', tone: 'bad' },
  HUMAN_OVERRIDDEN: { label: 'Overridden', tone: 'warn' },
  PAID: { label: 'Paid', tone: 'ok' },
  REJECTED: { label: 'Rejected', tone: 'bad' },
};

export const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export const short = (h: string) => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h);
