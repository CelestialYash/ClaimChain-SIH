import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ethers } from 'ethers';
import { randomUUID } from 'node:crypto';
import {
  CLAIM_STATUS,
  claimIdToBytes32,
  computeStateHash,
  findChainBreak,
  integrityReport,
  type ClaimStatusName,
  type TrailRecord,
} from './chain/chain.js';
import { createChainClient, type ChainClient } from './chain/client.js';
import { assertLocalRpc, findStateHashSlot, readSlot, writeSlot } from './chain/tamper.js';
import { buildClaimMerkleBundle, verifyMerkleProof } from './chain/merkle.js';
import { fetchRecentEvents, searchChain } from './chain/explore.js';
import { buildDossier } from './chain/dossier.js';
import { runVerification, verificationHash, SCORE } from './ai/pipeline.js';
import { buildExplanation } from './ai/explain.js';
import { trainFromExistingClaims } from './ai/train.js';
import { relabelClaim, memoryStats, trainClaim } from './ai/fraud-memory.js';
import { processFile, uploadMiddleware, uploadErrorMessage, filesFrom, requirePhotos } from './evidence.js';
import { GuardError, assertTransition, assertPayoutEligible } from './guard.js';
import { seedClaims } from './seed.js';
import { claims, readEvidence } from './store.js';
import { loadPersistedClaims, schedulePersist } from './persist.js';
import type { Claim, SimilarCase, VerificationRun } from './types.js';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));

// Rate limiting (basic abuse defense for the public demo endpoints).
// windowMs/100 = per-minute caps; trusted-proxy off by default (local demo).
app.set('trust proxy', false);
const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  limit: Number(process.env.RATE_LIMIT_MAX ?? 300),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many requests — slow down.' },
});
const intakeLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  limit: Number(process.env.RATE_LIMIT_INTAKE_MAX ?? 12),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many claims created from this address — wait a minute.' },
});
app.use('/api', apiLimiter);

// Guard against sandbox environments exporting PORT=0 (treat 0/empty as unset).
const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 4000;

// ---------------------------------------------------------------------------
// Chain client (optional at boot — API degrades gracefully when node is down)
// ---------------------------------------------------------------------------
let chain: ChainClient;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a trail record array from the contract. */
function normalizeTrail(raw: Array<Record<string, unknown>>): TrailRecord[] {
  return raw.map((r) => ({
    stateHash: String(r.stateHash),
    prevRecordHash: String(r.prevRecordHash),
    recordHash: String(r.recordHash),
    status: Number(r.status),
    timestamp: BigInt(r.timestamp as string | bigint),
    recordedBy: String(r.recordedBy),
    note: String(r.note),
  }));
}

async function loadTrail(claimId: string): Promise<TrailRecord[] | null> {
  const raw = (await chain.contract.getAuditTrail(claimIdToBytes32(claimId))) as Array<
    Record<string, unknown>
  >;
  return normalizeTrail(raw);
}

/** Canonical state hash for a claim's current evidence. */
function claimStateHash(claim: Claim, sealedAt: string, verificationHashHex?: string): string {
  return computeStateHash({
    claimId: claim.id,
    lossType: claim.lossType,
    claimantName: claim.claimantName,
    amountRequested: claim.amountRequested,
    evidenceHashes: claim.imageHashes,
    pHashes: claim.evidence.filter((e) => e.pHash).map((e) => e.pHash as string),
    verificationHash: verificationHashHex,
    sealedAt,
  });
}

/** Shared error shape for guard + validation failures. */
function fail(res: express.Response, err: unknown): express.Response {
  if (err instanceof GuardError) {
    return res.status(err.httpStatus).json({ error: err.code, message: err.message });
  }
  throw err; // let the async handler's try/catch deal with it
}

// ---------------------------------------------------------------------------
// Fraud memory (trained few-shot detector) — stats for the dashboard
// ---------------------------------------------------------------------------
app.get('/api/fraud-memory', (_req, res) => {
  res.json({ ...memoryStats(), trainable: true, engine: 'CLIP ViT-B/32 (Xenova ONNX, local CPU)' });
});

// ---------------------------------------------------------------------------
// Similar past cases (the trained memory made visible): nearest DECIDED claims
// in the CLIP embedding space, deduped to the best match per claim.
// ---------------------------------------------------------------------------
app.get('/api/claims/:id/similar-cases', (req, res) => {
  const claim = claims.get(req.params.id);
  if (!claim) return res.status(404).json({ error: 'Claim not found' });
  const dedup = new Map<string, SimilarCase>();
  for (const sc of claim.verification?.similarCases ?? []) {
    const prev = dedup.get(sc.claimId);
    if (!prev || sc.similarity > prev.similarity) dedup.set(sc.claimId, { ...sc });
  }
  const cases = Array.from(dedup.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5)
    .map((sc) => {
      const ref = claims.get(sc.claimId);
      return {
        ...sc,
        lossType: ref?.lossType ?? null,
        amountRequested: ref?.amountRequested ?? null,
        status: ref?.status ?? null,
      };
    });
  res.json({
    claimId: claim.id,
    engine: 'CLIP ViT-B/32 (Xenova ONNX, local CPU)',
    memorySize: memoryStats().size,
    cases,
  });
});

// ---------------------------------------------------------------------------
// CSV export (judges love a downloadable artifact) — one row per claim.
// ---------------------------------------------------------------------------
app.get('/api/export.csv', (_req, res) => {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows: string[] = [
    ['claimId', 'claimant', 'lossType', 'amountRequestedInr', 'status', 'verdict', 'score', 'submittedAt', 'decidedAt', 'durationMs', 'latestStateHash'].join(','),
  ];
  for (const c of claims.values()) {
    rows.push(
      [
        c.id,
        esc(c.claimantName),
        c.lossType,
        c.amountRequested,
        c.status,
        c.verification?.verdict ?? '',
        c.verification?.score ?? '',
        c.submittedAt,
        c.verification?.finishedAt ?? '',
        c.verification?.durationMs ?? '',
        c.latestStateHash ?? '',
      ].join(',')
    );
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="claimchain-export-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(rows.join('\n') + '\n');
});

// ---------------------------------------------------------------------------
// Health & meta
// ---------------------------------------------------------------------------
app.get('/api/health', async (_req, res) => {
  let totalRecords: string | null = null;
  if (chain.enabled) {
    try {
      totalRecords = (await chain.contract.totalRecords()).toString();
    } catch {
      /* node flapped; report null */
    }
  }
  res.json({
    ok: true,
    service: 'claimchain-api',
    version: '0.4.0',
    chain: { enabled: chain.enabled, contract: chain.address, totalRecords },
  });
});

// ---------------------------------------------------------------------------
// Stats (KPI strip) — includes §6's flaggedLocked + verificationDurationP50Ms
// ---------------------------------------------------------------------------
app.get('/api/stats', async (_req, res) => {
  const all = Array.from(claims.values());
  const today = all.filter((c) => Date.now() - new Date(c.submittedAt).getTime() < 24 * 3600_000).length;

  const autoApproved = all.filter((c) => c.status === 'AI_APPROVED' || c.status === 'PAID').length;
  const flagged = all.filter(
    (c) => c.status === 'AI_FLAGGED' || c.status === 'HUMAN_REVIEW'
  ).length;
  const flaggedLocked = all.filter((c) =>
    ['AI_FLAGGED', 'HUMAN_REVIEW'].includes(c.status)
  ).length;
  const leakagePrevented = all
    .filter((c) => ['AI_FLAGGED', 'REJECTED', 'HUMAN_REJECTED'].includes(c.status))
    .reduce((sum, c) => sum + c.amountRequested, 0);
  const paid = all.filter((c) => c.status === 'PAID').reduce((sum, c) => sum + c.amountRequested, 0);

  const durations = all
    .map((c) => c.verification?.durationMs)
    .filter((d): d is number => typeof d === 'number')
    .sort((a, b) => a - b);
  const p50 = durations.length > 0 ? durations[Math.floor(durations.length / 2)] : null;

  let totalRecords: number | null = null;
  if (chain.enabled) {
    try {
      totalRecords = Number(await chain.contract.totalRecords());
    } catch {
      /* ignore */
    }
  }

  res.json({
    claimsToday: today,
    total: all.length,
    autoApproved,
    autoApprovalPct: all.length ? Math.round((autoApproved / all.length) * 100) : null,
    flagged,
    flaggedLocked,
    leakagePreventedInr: leakagePrevented,
    paidInr: paid,
    verificationDurationP50Ms: p50,
    scoreThresholds: SCORE,
    totalRecords,
    chainEnabled: chain.enabled,
  });
});

// ---------------------------------------------------------------------------
// Claims — multipart intake (§1): files REQUIRED, hashes computed server-side
// ---------------------------------------------------------------------------
const CreateClaimFields = z.object({
  claimantName: z.string().min(1).max(120),
  lossType: z.enum(['flood', 'drought', 'livestock']),
  amountRequested: z.coerce.number().int().positive().max(100_000),
  note: z.string().max(280).optional(),
  policyNumber: z.string().max(40).optional(),
  /** Farmer-stated destruction % (0–100) — cross-checked vs satellite (R5). */
  destructionPctClaimed: z.coerce.number().int().min(0).max(100).optional(),
});

app.post('/api/claims', intakeLimiter, (req, res) => {
  uploadMiddleware(req, res, async (err) => {
    const uploadError = uploadErrorMessage(err);
    if (uploadError) return res.status(400).json({ error: uploadError });
    if (err) {
      console.error('[upload] intake failed:', (err as Error).message);
      return res.status(400).json({ error: 'Upload failed', message: (err as Error).message });
    }

    const parsed = CreateClaimFields.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid claim payload', details: parsed.error.issues });
    }

    const { photos, bills, idDocs, registry, aadhaar, satellite, policy } = filesFrom(req);
    let processed;
    try {
      processed = await Promise.all([
        ...(photos ?? []).map((f) => processFile(f, 'photo', { pHash: true, exif: true })),
        ...(satellite ?? []).map((f) => processFile(f, 'satellite', { pHash: true, exif: true })),
        ...(bills ?? []).map((f) => processFile(f, 'bill', { pHash: false, exif: false })),
        ...(idDocs ?? []).map((f) => processFile(f, 'id', { pHash: false, exif: false })),
        ...(registry ?? []).map((f) => processFile(f, 'registry', { pHash: false, exif: false })),
        ...(aadhaar ?? []).map((f) => processFile(f, 'aadhaar', { pHash: false, exif: false })),
        ...(policy ?? []).map((f) => processFile(f, 'policy', { pHash: false, exif: false })),
      ]);
      requirePhotos(processed.filter((p) => p.evidence.kind === 'photo'));
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }

    const now = new Date().toISOString();
    const claim: Claim = {
      id: `CLM-${randomUUID().slice(0, 8).toUpperCase()}`,
      ...parsed.data,
      status: 'SUBMITTED',
      submittedAt: now,
      imageHashes: processed.map((p) => p.evidence.sha256),
      evidence: processed.map((p) => p.evidence),
    };

    // Genesis seal commits the evidence hashes (sha256 + pHash) on-chain.
    if (chain.enabled && chain.signerAddress) {
      try {
        const stateHash = claimStateHash(claim, now);
        const tx = await chain.contract.sealClaimState(
          claimIdToBytes32(claim.id),
          stateHash,
          CLAIM_STATUS.SUBMITTED,
          `Claim submitted · ${processed.length} evidence file(s) · sha256+pHash committed`
        );
        await tx.wait();
        claim.latestStateHash = stateHash;
      } catch (e) {
        console.error('[chain] genesis seal failed:', (e as Error).message);
        return res.status(503).json({ error: 'Chain unavailable: could not seal genesis record' });
      }
    }

    claims.set(claim.id, claim);
    schedulePersist(claim.id); // write-through: claim row is durable before the pipeline even starts

    // §2: the pipeline runs AUTOMATICALLY — no button.
    void runVerificationJob(claim.id);

    return res.status(201).json({
      claim,
      evidence: claim.evidence,
      verificationJobId: `ver_${claim.id}`,
    });
  });
});

/**
 * Async pipeline runner: computes the verdict, seals the DECISION record with
 * the verification-log digest, updates the claim. Never throws into the route.
 */
async function runVerificationJob(claimId: string): Promise<void> {
  const claim = claims.get(claimId);
  if (!claim) return;
  try {
    const run = await runVerification(claim, claims);
    claim.verification = run;
    claim.status = run.verdict;
    schedulePersist(claim.id); // verdict + stage logs are durable

    // TRAIN: enroll the decided claim's photo embeddings into the fraud memory
    // (few-shot learning — every verdict makes the next one smarter).
    void (async () => {
      try {
        const label = run.verdict === 'AI_APPROVED' ? 'genuine' : 'fraud';
        const n = await trainClaim(claim, label, 'pipeline');
        if (n > 0) console.log(`[train] ${claim.id} enrolled ${n} photo(s) as ${label}`);
      } catch (e) {
        console.warn(`[train] ${claim.id} enrollment failed:`, (e as Error).message);
      }
    })();

    if (chain.enabled && chain.signerAddress) {
      const sealedAt = new Date().toISOString();
      const stateHash = claimStateHash(claim, sealedAt, verificationHash(run));
      const failStages = run.stages.filter((s) => s.result === 'FAIL').map((s) => s.stage);
      const note = `AI ${run.verdict} · score ${run.score} · ${failStages.length > 0 ? `fails: ${failStages.join(', ')}` : 'all stages pass'}`;
      const tx = await chain.contract.sealClaimState(
        claimIdToBytes32(claim.id),
        stateHash,
        CLAIM_STATUS[run.verdict],
        note.slice(0, 280)
      );
      await tx.wait();
      claim.latestStateHash = stateHash;
      schedulePersist(claim.id);
    }
    console.log(`[pipeline] ${claim.id} → ${run.verdict} (score ${run.score}, ${run.durationMs}ms)`);
  } catch (e) {
    console.error(`[pipeline] ${claimId} verification failed:`, (e as Error).message);
  }
}

app.get('/api/claims', (_req, res) => {
  res.json(Array.from(claims.values()));
});

app.get('/api/claims/:id', (req, res) => {
  const claim = claims.get(req.params.id);
  if (!claim) return res.status(404).json({ error: 'Claim not found' });
  res.json(claim);
});

// ---------------------------------------------------------------------------
// Verification logs (§3): stage-by-stage view + staff retry
// ---------------------------------------------------------------------------
app.get('/api/claims/:id/verification', (req, res) => {
  const claim = claims.get(req.params.id);
  if (!claim) return res.status(404).json({ error: 'Claim not found' });
  if (!claim.verification) {
    return res.json({ claimId: claim.id, status: 'RUNNING', verification: null });
  }
  // Stage-7 explanation language: ?lang=hi for Hindi (default en). Marathi
  // de-scoped per product decision. Derived on demand — never stored.
  const lang = req.query.lang === 'hi' ? 'hi' : 'en';
  const verification =
    lang === 'hi'
      ? { ...claim.verification, explanation: buildExplanation(claim.verification, claim, 'hi') }
      : claim.verification;
  res.json({ claimId: claim.id, status: 'COMPLETE', verification });
});

app.post('/api/claims/:id/verification/retry', async (req, res) => {
  const claim = claims.get(req.params.id);
  if (!claim) return res.status(404).json({ error: 'Claim not found' });
  if (['PAID', 'HUMAN_REJECTED'].includes(claim.status)) {
    return res.status(409).json({ error: 'TERMINAL_STATE', message: 'Terminal claims cannot be re-verified' });
  }
  if (!chain.enabled || !chain.signerAddress) {
    return res.status(503).json({ error: 'Chain unavailable: sealing a RETRY record requires the chain' });
  }

  try {
    const run = await runVerification(claim, claims);
    claim.verification = run;
    schedulePersist(claim.id);

    // RETRY appends to history — the prior verdict record is never mutated (§5.2).
    const sealedAt = new Date().toISOString();
    const stateHash = claimStateHash(claim, sealedAt, verificationHash(run));
    const tx = await chain.contract.sealClaimState(
      claimIdToBytes32(claim.id),
      stateHash,
      CLAIM_STATUS[run.verdict],
      `RETRY · AI ${run.verdict} · score ${run.score} (re-run appended, history intact)`.slice(0, 280)
    );
    await tx.wait();
    claim.latestStateHash = stateHash;
    claim.status = run.verdict;
    schedulePersist(claim.id);

    res.json({ claim, verification: run, sealed: true, txHash: tx.hash });
  } catch (e) {
    console.error('[pipeline] retry failed:', (e as Error).message);
    res.status(500).json({ error: 'Verification retry failed' });
  }
});

// ---------------------------------------------------------------------------
// Evidence: addendum upload, listing, byte serving (auth-gated = local demo)
// ---------------------------------------------------------------------------
app.post('/api/claims/:id/evidence', (req, res) => {
  uploadMiddleware(req, res, async (err) => {
    const uploadError = uploadErrorMessage(err);
    if (uploadError) return res.status(400).json({ error: uploadError });
    if (err) return res.status(400).json({ error: 'Upload failed', message: (err as Error).message });

    const claim = claims.get(req.params.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    if (['PAID', 'HUMAN_REJECTED'].includes(claim.status)) {
      return res.status(409).json({ error: 'TERMINAL_STATE', message: 'Terminal claims cannot receive addenda' });
    }
    if (!chain.enabled || !chain.signerAddress) {
      return res.status(503).json({ error: 'Chain unavailable: addendum sealing requires the chain' });
    }

    const { photos, bills, idDocs } = filesFrom(req);
    if (!photos?.length && !bills?.length && !idDocs?.length) {
      return res.status(400).json({ error: 'No files provided (fields: photos / bills / idDocs)' });
    }

    try {
      const processed = await Promise.all([
        ...(photos ?? []).map((f) => processFile(f, 'photo', { pHash: true, exif: true })),
        ...(bills ?? []).map((f) => processFile(f, 'bill', { pHash: false, exif: false })),
        ...(idDocs ?? []).map((f) => processFile(f, 'id', { pHash: false, exif: false })),
      ]);

      for (const p of processed) {
        claim.evidence.push(p.evidence);
        claim.imageHashes.push(p.evidence.sha256);
      }

      // Late evidence = sealed ADDENDUM record (never an edit, §1.2).
      const sealedAt = new Date().toISOString();
      const stateHash = claimStateHash(claim, sealedAt);
      const tx = await chain.contract.sealClaimState(
        claimIdToBytes32(claim.id),
        stateHash,
        CLAIM_STATUS.SUBMITTED, // ADDENDUM marker: submission-state re-seal with new evidence set
        `ADDENDUM · +${processed.length} evidence file(s) appended (immutable addendum, re-verification queued)`.slice(0, 280)
      );
      await tx.wait();
      claim.latestStateHash = stateHash;
      schedulePersist(claim.id);

      // Re-verify with the extended evidence set.
      void runVerificationJob(claim.id);

      return res.status(201).json({ claim, added: processed.map((p) => p.evidence), sealed: true, txHash: tx.hash });
    } catch (e) {
      console.error('[evidence] addendum failed:', (e as Error).message);
      return res.status(500).json({ error: 'Addendum processing failed' });
    }
  });
});

app.get('/api/claims/:id/evidence', (req, res) => {
  const claim = claims.get(req.params.id);
  if (!claim) return res.status(404).json({ error: 'Claim not found' });
  res.json({ claimId: claim.id, evidence: claim.evidence });
});

app.get('/api/evidence/:fileId', (req, res) => {
  let row: Claim['evidence'][number] | undefined;
  for (const c of claims.values()) {
    row = c.evidence.find((e) => e.fileId === req.params.fileId);
    if (row) break;
  }
  if (!row) return res.status(404).json({ error: 'Evidence not found' });
  try {
    const buf = readEvidence(req.params.fileId);
    res.setHeader('Content-Type', row.mimeType);
    return res.send(buf);
  } catch {
    return res.status(410).json({ error: 'Evidence bytes no longer available' });
  }
});

// ---------------------------------------------------------------------------
// Transitions — GUARDED (§4). AI verdicts are pipeline-only; humans get the
// review lane with mandatory reasons; payouts go through /pay only.
// ---------------------------------------------------------------------------
/**
 * Schema accepts any status token so the GUARD (not zod) issues the semantic
 * rejection — AI verdicts → 403 AI_VERDICTS_ARE_COMPUTED, PAID → 409
 * USE_PAY_ENDPOINT, etc. (spec §4.2: enforced in the transition rule engine).
 */
const HumanTransition = z.object({
  status: z.enum([
    'AI_APPROVED',
    'AI_FLAGGED',
    'AI_REJECTED',
    'HUMAN_APPROVED',
    'HUMAN_REJECTED',
    'HUMAN_REVIEW',
    'PAID',
    'SUBMITTED',
    'HUMAN_OVERRIDDEN',
    'REJECTED',
  ]),
  note: z.string().min(1).max(280),
  reviewer: z.string().min(1).max(80).default('ops-agent'),
});

app.post('/api/claims/:id/transitions', async (req, res) => {
  try {
    const claim = claims.get(req.params.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const parsed = HumanTransition.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid transition payload', details: parsed.error.issues });
    }

    // State machine whitelist + note-length rule (throws GuardError → 4xx).
    assertTransition(claim.status, parsed.data.status, parsed.data.note);

    if (!chain.enabled || !chain.signerAddress) {
      return res.status(503).json({ error: 'Chain unavailable: sealing requires a connected node and PRIVATE_KEY' });
    }

    const sealedAt = new Date().toISOString();
    const stateHash = claimStateHash(claim, sealedAt);
    const note = `[${parsed.data.reviewer}] ${parsed.data.status}: ${parsed.data.note}`.slice(0, 280);

    const tx = await chain.contract.sealClaimState(
      claimIdToBytes32(claim.id),
      stateHash,
      CLAIM_STATUS[parsed.data.status],
      note
    );
    await tx.wait();

    claim.status = parsed.data.status;
    claim.latestStateHash = stateHash;
    schedulePersist(claim.id);

    // HUMAN FEEDBACK LOOP: the reviewer's verdict is ground truth — re-label
    // this claim's embeddings in the fraud memory (the model learns from it).
    if (parsed.data.status === 'HUMAN_APPROVED' || parsed.data.status === 'HUMAN_REJECTED') {
      const label = parsed.data.status === 'HUMAN_APPROVED' ? 'genuine' : 'fraud';
      void relabelClaim(claim, label)
        .then((n) => console.log(`[train] ${claim.id} re-labeled ${n} photo(s) → ${label} (human review)`))
        .catch((e) => console.warn(`[train] ${claim.id} re-label failed:`, (e as Error).message));
    }

    return res.json({ claim, sealed: true, txHash: tx.hash });
  } catch (err) {
    if (res.headersSent) return;
    try {
      return fail(res, err);
    } catch (unhandled) {
      console.error('[transition] failed:', (unhandled as Error).message);
      return res.status(500).json({ error: 'Transition failed' });
    }
  }
});

// ---------------------------------------------------------------------------
// Payment — the ONLY payout path (§6). RULE ZERO enforced here.
// ---------------------------------------------------------------------------
const PayInput = z.object({
  upiRef: z.string().min(4).max(64),
  amount: z.coerce.number().int().positive().optional(),
});

app.post('/api/claims/:id/pay', async (req, res) => {
  try {
    const claim = claims.get(req.params.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const parsed = PayInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payout payload', details: parsed.error.issues });
    }

    // RULE ZERO (throws FLAGGED_LOCKED / INVALID_STATE as GuardError → 409).
    assertPayoutEligible(claim.status);

    if (!chain.enabled || !chain.signerAddress) {
      return res.status(503).json({ error: 'Chain unavailable: payout sealing requires the chain' });
    }

    const amount = parsed.data.amount ?? claim.amountRequested;
    const sealedAt = new Date().toISOString();
    const stateHash = claimStateHash(claim, sealedAt);
    const note = `UPI payout ₹${amount} · ref ${parsed.data.upiRef} · sealed by ClaimChain disbursement`;

    const tx = await chain.contract.sealClaimState(
      claimIdToBytes32(claim.id),
      stateHash,
      CLAIM_STATUS.PAID,
      note.slice(0, 280)
    );
    await tx.wait();

    claim.status = 'PAID';
    claim.latestStateHash = stateHash;
    schedulePersist(claim.id);
    return res.json({ claim, sealed: true, paidInr: amount, txHash: tx.hash });
  } catch (err) {
    if (res.headersSent) return;
    try {
      return fail(res, err);
    } catch (unhandled) {
      console.error('[pay] failed:', (unhandled as Error).message);
      return res.status(500).json({ error: 'Payout failed' });
    }
  }
});

// ---------------------------------------------------------------------------
// Immutable audit trail for a claim (unchanged behavior, reused helpers)
// ---------------------------------------------------------------------------
app.get('/api/claims/:id/audit-trail', async (req, res) => {
  if (!chain.enabled) return res.status(503).json({ error: 'Chain unavailable' });

  try {
    const trail = await loadTrail(req.params.id);
    const breakAtIndex = findChainBreak(trail ?? []);
    const [onChainValid, onChainBrokenAt] = await chain.contract.verifyTrail(claimIdToBytes32(req.params.id));

    return res.json({
      claimId: req.params.id,
      recordCount: trail?.length ?? 0,
      integrity: integrityReport(breakAtIndex, onChainValid, onChainBrokenAt),
      records: (trail ?? []).map((r) => ({
        ...r,
        timestamp: r.timestamp.toString(),
        sealedAtIso: new Date(Number(r.timestamp) * 1000).toISOString(),
      })),
    });
  } catch (err) {
    console.error('[chain] audit trail read failed:', (err as Error).message);
    return res.status(502).json({ error: 'Failed to read audit trail from chain' });
  }
});

// ---------------------------------------------------------------------------
// Merkle inclusion proofs (auditor replay)
// ---------------------------------------------------------------------------
app.get('/api/claims/:id/merkle', async (req, res) => {
  if (!chain.enabled) return res.status(503).json({ error: 'Chain unavailable' });
  try {
    const trail = await loadTrail(req.params.id);
    if (!trail || trail.length === 0) return res.status(404).json({ error: 'Claim not found on chain' });
    const bundle = buildClaimMerkleBundle(req.params.id, trail);
    return res.json({
      claimId: req.params.id,
      leaves: bundle.leaves,
      root: bundle.root,
      proofs: bundle.proofs.map((p) => ({
        leafIndex: p.leafIndex,
        leaf: p.leaf,
        root: p.root,
        siblings: p.siblings,
        verifies: verifyMerkleProof(p),
      })),
    });
  } catch (err) {
    console.error('[merkle] bundle failed:', (err as Error).message);
    return res.status(500).json({ error: 'Failed to build Merkle bundle' });
  }
});

app.post('/api/merkle/verify', (req, res) => {
  const Schema = z.object({
    leaf: z.string().startsWith('0x'),
    siblings: z.array(z.object({ hash: z.string().startsWith('0x'), isRight: z.boolean() })),
    root: z.string().startsWith('0x'),
  });
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid proof payload', details: parsed.error.issues });
  }
  const valid = verifyMerkleProof({
    leafIndex: 0,
    leaf: parsed.data.leaf,
    siblings: parsed.data.siblings,
    root: parsed.data.root,
  });
  return res.json({ valid, root: parsed.data.root });
});

// ---------------------------------------------------------------------------
// Chain explorer: recent sealed events + hash/claim search
// ---------------------------------------------------------------------------
app.get('/api/explorer/events', async (req, res) => {
  if (!chain.enabled) return res.status(503).json({ error: 'Chain unavailable' });
  try {
    const limit = req.query.limit ? Math.min(Number(req.query.limit) || 25, 100) : 25;
    const events = await fetchRecentEvents(chain.provider, chain.address, { limit });
    for (const c of claims.keys()) {
      const id32 = claimIdToBytes32(c).toLowerCase();
      for (const e of events) if (e.claimId.toLowerCase() === id32) e.claimIdRef = c;
    }
    return res.json({ count: events.length, events });
  } catch (err) {
    console.error('[explorer] events failed:', (err as Error).message);
    return res.status(502).json({ error: 'Failed to read events from chain' });
  }
});

app.get('/api/explorer/search', async (req, res) => {
  if (!chain.enabled) return res.status(503).json({ error: 'Chain unavailable' });
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.status(400).json({ error: 'Missing query ?q=' });
  try {
    const { matches, interpretedAs } = await searchChain(chain.provider, chain.address, q);
    for (const m of matches) {
      const ref = Array.from(claims.keys()).find((c) => claimIdToBytes32(c).toLowerCase() === m.claimId.toLowerCase());
      if (ref) m.claimIdRef = ref;
    }
    return res.json({ query: q, interpretedAs, count: matches.length, matches });
  } catch (err) {
    console.error('[explorer] search failed:', (err as Error).message);
    return res.status(502).json({ error: 'Search failed' });
  }
});

// ---------------------------------------------------------------------------
// Cryptographic dossier export (signed)
// ---------------------------------------------------------------------------
app.get('/api/claims/:id/dossier', async (req, res) => {
  if (!chain.enabled) return res.status(503).json({ error: 'Chain unavailable' });
  try {
    const trail = await loadTrail(req.params.id);
    if (!trail || trail.length === 0) return res.status(404).json({ error: 'Claim not found on chain' });
    const offBreak = findChainBreak(trail);
    const [onValid, onBrokenAt] = await chain.contract.verifyTrail(claimIdToBytes32(req.params.id));

    if (!chain.signerAddress) return res.status(503).json({ error: 'Dossier signing requires PRIVATE_KEY' });
    if (!process.env.PRIVATE_KEY) return res.status(503).json({ error: 'Dossier signing requires PRIVATE_KEY' });

    const wallet = new ethers.NonceManager(new ethers.Wallet(process.env.PRIVATE_KEY, chain.provider));
    const dossier = await buildDossier(req.params.id, trail, integrityReport(offBreak, onValid, onBrokenAt), {
      address: chain.signerAddress,
      signMessage: (m: string | Uint8Array) => wallet.signMessage(m),
    });

    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}-dossier.json"`);
    return res.json(dossier);
  } catch (err) {
    console.error('[dossier] export failed:', (err as Error).message);
    return res.status(500).json({ error: 'Failed to build dossier' });
  }
});

// ---------------------------------------------------------------------------
// Tamper-detection demo (local-node-only, unchanged behavior)
// ---------------------------------------------------------------------------
const restoreMemo = new Map<string, string>();

const TamperInput = z.object({
  claimId: z.string().min(1),
  recordIndex: z.number().int().min(1).default(1),
  forgedLabel: z.string().min(1).max(80).default('e2-FORGED-15000'),
});

app.post('/api/demo/tamper', async (req, res) => {
  if (!chain.enabled) return res.status(503).json({ error: 'Chain unavailable' });
  try {
    assertLocalRpc(chain.rpcUrl);
  } catch (err) {
    return res.status(403).json({ error: (err as Error).message });
  }

  const parsed = TamperInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid tamper payload', details: parsed.error.issues });
  }
  const { claimId, recordIndex, forgedLabel } = parsed.data;
  const id32 = claimIdToBytes32(claimId);

  try {
    const trail = await loadTrail(claimId);
    if (!trail || trail.length === 0) return res.status(404).json({ error: 'Claim not found on chain' });
    if (recordIndex >= trail.length) {
      return res.status(400).json({ error: `recordIndex ${recordIndex} out of range (0..${trail.length - 1})` });
    }

    const target = trail[recordIndex];
    const forgedStateHash = ethers.solidityPackedKeccak256(['string', 'bytes32'], [forgedLabel, id32]);

    const slot = await findStateHashSlot(chain.provider, chain.address, id32, recordIndex, target.stateHash);
    if (slot === null) {
      return res.status(500).json({ error: 'Could not locate stateHash slot for the target record' });
    }
    const originalStateHash = await readSlot(chain.provider, chain.address, slot);
    await writeSlot(chain.provider, chain.address, slot, forgedStateHash);
    restoreMemo.set(claimId, originalStateHash);

    const trailAfter = (await loadTrail(claimId)) ?? [];
    const offBreak = findChainBreak(trailAfter);
    const [onValid, onBrokenAt] = await chain.contract.verifyTrail(id32);

    return res.json({
      demo: 'tamper',
      claimId,
      forged: {
        recordIndex,
        slot: '0x' + slot.toString(16),
        originalStateHash,
        forgedStateHash,
        forgedLabel,
      },
      integrity: integrityReport(offBreak, onValid, onBrokenAt),
      verdict:
        offBreak !== null || !onValid
          ? `TAMPERING DETECTED: hash chain broken at record index ${offBreak ?? 'on-chain'} — the forged payout no longer matches its sealed commitment.`
          : 'UNDETECTED (this would be a critical vulnerability!)',
    });
  } catch (err) {
    console.error('[demo] tamper failed:', (err as Error).message);
    return res.status(500).json({ error: 'Tamper simulation failed' });
  }
});

app.post('/api/demo/restore', async (req, res) => {
  if (!chain.enabled) return res.status(503).json({ error: 'Chain unavailable' });
  try {
    assertLocalRpc(chain.rpcUrl);
  } catch (err) {
    return res.status(403).json({ error: (err as Error).message });
  }

  const parsed = TamperInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid restore payload', details: parsed.error.issues });
  }
  const { claimId, recordIndex } = parsed.data;
  const id32 = claimIdToBytes32(claimId);

  try {
    const trail = await loadTrail(claimId);
    if (!trail || trail.length === 0) return res.status(404).json({ error: 'Claim not found on chain' });
    if (recordIndex >= trail.length) {
      return res.status(400).json({ error: `recordIndex ${recordIndex} out of range (0..${trail.length - 1})` });
    }

    const target = trail[recordIndex];
    const slot = await findStateHashSlot(chain.provider, chain.address, id32, recordIndex, target.stateHash);
    if (slot === null) {
      return res
        .status(404)
        .json({ error: 'Target record does not look forged (its stored stateHash cannot be located)' });
    }

    const originalStateHash = restoreMemo.get(claimId);
    if (!originalStateHash) {
      return res.status(409).json({
        error: 'No in-memory record of the original stateHash (server restarted?). Re-seed the demo claim instead.',
      });
    }

    await writeSlot(chain.provider, chain.address, slot, originalStateHash);
    restoreMemo.delete(claimId);

    const trailAfter = (await loadTrail(claimId)) ?? [];
    const offBreak = findChainBreak(trailAfter);
    const [onValid, onBrokenAt] = await chain.contract.verifyTrail(id32);

    return res.json({
      demo: 'restore',
      claimId,
      restored: { recordIndex, stateHash: originalStateHash },
      integrity: integrityReport(offBreak, onValid, onBrokenAt),
      verdict: onValid && offBreak === null ? 'CHAIN RESTORED: all records verify again.' : 'Restore incomplete.',
    });
  } catch (err) {
    console.error('[demo] restore failed:', (err as Error).message);
    return res.status(500).json({ error: 'Restore simulation failed' });
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
// Native worker modules (tesseract/leptonica) can throw asynchronously from
// message ports; an unguarded throw kills the whole API mid-demo. Log and
// keep serving — individual pipelines already degrade gracefully.
process.on('uncaughtException', (err) => {
  console.error('[fatal-guard] uncaught exception survived:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal-guard] unhandled rejection survived:', String(reason).slice(0, 300));
});

async function main() {
  chain = await createChainClient();

  // Restore the previous session's claims BEFORE seeding — seeds only fill
  // the gaps (claims missing from the snapshot), so restarts are seamless.
  loadPersistedClaims(chain.enabled ? chain.address : null);

  if (process.env.SEED_DEMO !== '0') {
    await seedClaims(chain);
  }

  // Train the fraud memory from already-decided claims (lazy-loads CLIP).
  // Non-fatal: the pipeline degrades to heuristics if training fails.
  void trainFromExistingClaims().catch((e) =>
    console.warn('[train] boot training failed:', (e as Error).message)
  );

  app.listen(PORT, () => {
    console.log(`ClaimChain API listening on http://localhost:${PORT} (chain ${chain.enabled ? 'enabled' : 'disabled'})`);
  });
}

void main();
