import { CLAIM_STATUS, claimIdToBytes32, computeStateHash, type ClaimStatusName } from './chain/chain.js';
import type { ChainClient } from './chain/client.js';
import { runVerification, verificationHash } from './ai/pipeline.js';
import { generateEvidenceJpeg } from './ai/imagegen.js';
import { buildEvidenceRow } from './evidence.js';
import { claims } from './store.js';
import type { Claim } from './types.js';

/**
 * Demo seeds — the mockup narrative, produced by the REAL pipeline:
 *  - CLM-4102: archived clean claim (the pHash reference set)
 *  - CLM-8919: reuses CLM-4102's exact bytes → DUPLICATE_PHASH collision
 *              → pipeline AI_FLAGGED → human review pending
 *  - CLM-8920: clean flood claim → pipeline AI_APPROVED → paid via UPI
 *  - CLM-8930: fresh submission, verification in flight
 *
 * Idempotent: trails are sealed only when getTrailLength === 0 (fresh deploy).
 * Seeded trails replay the pipeline's computed notes; evidence bytes are
 * deterministic (seedKey) so the 8919↔4102 collision reproduces exactly.
 */

interface SeedSpec {
  id: string;
  claimantName: string;
  lossType: Claim['lossType'];
  amountRequested: number;
  policyNumber: string;
  minutesAgoSubmitted: number;
  /** Logical images: keyword in the image, duplicate variant for collisions. */
  images: Array<{ kind: 'photo' | 'bill'; keyword: string; variant: number; seedKey?: string }>;
  /** Human-review resolution to replay after the flag (8919 stays pending). */
  after?: Array<{ status: ClaimStatusName; note: string; minutesAgo: number }>;
  /** Skip pipeline/decision sealing (fresh SUBMITTED narrative). */
  freshOnly?: boolean;
}

const SEEDS: SeedSpec[] = [
  {
    id: 'CLM-4102',
    claimantName: 'Vitthal Rao',
    lossType: 'flood',
    amountRequested: 7800,
    policyNumber: 'MH-31-2255',
    minutesAgoSubmitted: 60 * 24 * 9, // archived ~9 days old
    images: [
      { kind: 'photo', keyword: 'flooded paddy field', variant: 0, seedKey: 'ARCHIVE-paddy' },
      { kind: 'photo', keyword: 'flooded paddy field', variant: 1, seedKey: 'ARCHIVE-paddy' },
      { kind: 'bill', keyword: 'policy MH-31-2255 insured Vitthal Rao claim amount 7800', variant: 0 },
    ],
    after: [{ status: 'PAID', note: 'Archived claim — UPI payout ref UPI-41022 (closed, clean)', minutesAgo: 60 * 24 * 9 - 30 }],
  },
  {
    id: 'CLM-8919',
    claimantName: 'Devendra Singh',
    lossType: 'flood',
    amountRequested: 9200,
    policyNumber: 'MH-27-4102',
    minutesAgoSubmitted: 118,
    images: [
      // EXACT SAME seedKey as the archived claim → byte-identical → pHash d=0
      { kind: 'photo', keyword: 'flooded paddy field', variant: 0, seedKey: 'ARCHIVE-paddy' },
      { kind: 'photo', keyword: 'flooded paddy field', variant: 1, seedKey: 'ARCHIVE-paddy' },
      { kind: 'bill', keyword: 'policy MH-27-4102 insured Devendra Singh claim amount 9200', variant: 0 },
    ],
  },
  {
    id: 'CLM-8920',
    claimantName: 'Ramesh Kumar',
    lossType: 'flood',
    amountRequested: 6500,
    policyNumber: 'MH-12-9931',
    minutesAgoSubmitted: 1560,
    images: [
      { kind: 'photo', keyword: 'flooded soybean lot', variant: 0 },
      { kind: 'photo', keyword: 'waterlogged soybean plot', variant: 2 },
      { kind: 'bill', keyword: 'policy MH-12-9931 insured Ramesh Kumar claim amount 6500', variant: 0 },
    ],
    after: [{ status: 'PAID', note: 'UPI payout released to Aadhaar-linked account ••4810 (ref UPI-88371)', minutesAgo: 1544 }],
  },
  {
    id: 'CLM-8930',
    claimantName: 'Sunita Pawar',
    lossType: 'drought',
    amountRequested: 4300,
    policyNumber: 'MH-22-7789',
    minutesAgoSubmitted: 8,
    images: [{ kind: 'photo', keyword: 'drought cracked maize field', variant: 0 }],
    freshOnly: true,
  },
];

async function buildSeedClaim(s: SeedSpec): Promise<Claim> {
  const claim: Claim = {
    id: s.id,
    claimantName: s.claimantName,
    lossType: s.lossType,
    amountRequested: s.amountRequested,
    status: 'SUBMITTED',
    submittedAt: new Date(Date.now() - s.minutesAgoSubmitted * 60_000).toISOString(),
    imageHashes: [],
    evidence: [],
    policyNumber: s.policyNumber,
  };

  for (const img of s.images) {
    const buf = await generateEvidenceJpeg({
      claimId: s.id,
      kind: img.kind,
      variant: img.variant,
      keyword: img.keyword,
      seedKey: img.seedKey,
    });
    const row = await buildEvidenceRow(buf, img.kind, `${s.id}-${img.kind}-${img.variant}.jpg`, 'image/jpeg', {
      pHash: true,
      exif: false, // synthetic images carry no EXIF by design (EXIF stage reports WARN, not FAIL)
    });
    claim.evidence.push(row.evidence);
    claim.imageHashes.push(row.evidence.sha256);
  }
  return claim;
}

/**
 * Chain-free registration of seed claims (evidence generation + store entry)
 * WITH real pipeline verdicts computed for each non-fresh seed — the trainer
 * and any chain-less consumer see exactly the statuses the chain path seals.
 */
export async function registerSeedClaims(): Promise<void> {
  const { runVerification } = await import('./ai/pipeline.js');
  // Interleaved like the chain path: register + verify one seed at a time, so
  // the archived claim (4102) is decided BEFORE 8919's duplicate photos exist
  // in the store — preserving the 8919-flagged / 4102-clean narrative.
  for (const s of SEEDS) {
    if (!claims.has(s.id)) {
      const claim = await buildSeedClaim(s);
      claims.set(claim.id, claim);
    }
    if (s.freshOnly) continue;
    const claim = claims.get(s.id)!;
    if (claim.verification) continue; // already decided
    const run = await runVerification(claim, claims);
    claim.verification = run;
    claim.status = run.verdict;
    for (const step of s.after ?? []) claim.status = step.status;
    console.log(`[seed] ${s.id} → ${claim.status} (pipeline ${run.verdict}, score ${run.score})`);
  }
  console.log(`[seed] ${SEEDS.length} seed claims registered (no chain)`);
}

/**
 * Seed demo claims into the in-memory store and seal their trails on-chain.
 * The trail replays what the pipeline WOULD have produced (deterministic),
 * so seeded evidence and sealed notes stay consistent with fresh runs.
 */
export async function seedClaims(chain: ChainClient): Promise<void> {
  if (!chain.enabled || !chain.signerAddress) {
    console.log('[seed] chain disabled — skipping demo seeds');
    return;
  }

  for (const s of SEEDS) {
    const id32 = claimIdToBytes32(s.id);

    let trailLen = 0;
    try {
      trailLen = Number(await chain.contract.getTrailLength(id32));
    } catch (err) {
      console.warn('[seed] chain unreachable mid-seed:', (err as Error).message);
      return;
    }

    // Restored from the persistence snapshot — the stored row (with its full
    // verification logs) is authoritative; do NOT rebuild over it.
    if (claims.has(s.id)) continue;

    const claim = await buildSeedClaim(s);
    claims.set(claim.id, claim);

    if (trailLen > 0) {
      // Already sealed on a previous boot — derive status from the newest record.
      const trail = await chain.contract.getAuditTrail(id32);
      const last = trail[trail.length - 1];
      claim.status =
        (Object.entries(CLAIM_STATUS).find(([, v]) => v === Number(last?.status))?.[0] as ClaimStatusName) ??
        'SUBMITTED';
      claim.latestStateHash = String(last?.stateHash ?? '');
      continue;
    }

    // --- Genesis: SUBMITTED with evidence hashes ---------------------------
    const genesisAt = claim.submittedAt;
    await seal(chain, s.id, genesisAt, claim, {
      status: 'SUBMITTED',
      note: `Claim submitted · ${claim.evidence.length} evidence file(s) · sha256 committed`,
    });

    if (s.freshOnly) {
      claim.status = 'SUBMITTED';
      console.log(`[seed] ${s.id} → SUBMITTED (verification queued)`);
      continue;
    }

    // --- Run the REAL pipeline for the seeded evidence ---------------------
    const run = await runVerification(claim, claims);
    claim.verification = run;

    const decisionAt = new Date(Date.now() - (s.minutesAgoSubmitted - 20) * 60_000).toISOString();
    await seal(
      chain,
      s.id,
      decisionAt,
      claim,
      { status: run.verdict, note: `AI ${run.verdict} · score ${run.score} · ${describe(run)}` },
      verificationHash(run)
    );
    claim.status = run.verdict;

    // --- Optional aftermath (payout for the clean claim) --------------------
    for (const step of s.after ?? []) {
      const at = new Date(Date.now() - step.minutesAgo * 60_000).toISOString();
      await seal(chain, s.id, at, claim, { status: step.status, note: step.note });
      claim.status = step.status;
    }

    console.log(`[seed] ${s.id} → ${claim.status} (pipeline ${run.verdict}, score ${run.score})`);
  }
  console.log(`[seed] ${SEEDS.length} demo claims ready`);
}

function describe(run: Awaited<ReturnType<typeof runVerification>>): string {
  const fails = run.stages.filter((x) => x.result === 'FAIL').map((x) => x.stage);
  return fails.length > 0 ? `fails: ${fails.join(', ')}` : 'all stages pass';
}

async function seal(
  chain: ChainClient,
  claimId: string,
  sealedAt: string,
  claim: Claim,
  rec: { status: ClaimStatusName; note: string },
  verHash?: string
): Promise<void> {
  const stateHash = computeStateHash({
    claimId,
    lossType: claim.lossType,
    claimantName: claim.claimantName,
    amountRequested: claim.amountRequested,
    evidenceHashes: claim.imageHashes,
    pHashes: claim.evidence.filter((e) => e.pHash).map((e) => e.pHash as string),
    verificationHash: verHash,
    sealedAt,
  });
  const tx = await chain.contract.sealClaimState(id32Of(claimId), stateHash, CLAIM_STATUS[rec.status], rec.note);
  await tx.wait();
  claim.latestStateHash = stateHash;
}

function id32Of(claimId: string): string {
  return claimIdToBytes32(claimId);
}
