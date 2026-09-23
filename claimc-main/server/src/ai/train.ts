import { claims } from '../store.js';
import { preloadClip } from './clip.js';
import { trainClaim, trainedClaimIds } from './fraud-memory.js';
import type { Claim } from '../types.js';

/**
 * Boot training pass: enroll every already-decided claim's photo embeddings
 * into the fraud memory. Labels derive from the sealed verdicts:
 *   genuine → AI_APPROVED / HUMAN_APPROVED / PAID
 *   fraud   → AI_FLAGGED / REJECTED / HUMAN_REJECTED
 * Already-trained claims are skipped (re-labeling happens only via human
 * review, the ground truth).
 */
const GENUINE: readonly Claim['status'][] = ['AI_APPROVED', 'HUMAN_APPROVED', 'PAID'];
const FRAUD: readonly Claim['status'][] = ['AI_FLAGGED', 'REJECTED', 'HUMAN_REJECTED'];

export async function trainFromExistingClaims(): Promise<{ enrolled: number; claimsConsidered: number }> {
  await preloadClip();
  const done = trainedClaimIds();
  let enrolled = 0;
  let considered = 0;

  for (const claim of claims.values()) {
    if (done.has(claim.id)) continue;
    if (claim.evidence.filter((e) => e.kind === 'photo').length === 0) continue;
    let label: 'genuine' | 'fraud' | null = null;
    if (GENUINE.includes(claim.status)) label = 'genuine';
    else if (FRAUD.includes(claim.status)) label = 'fraud';
    if (!label) continue;

    considered++;
    enrolled += await trainClaim(claim, label, claim.status === 'PAID' && claim.verification ? 'pipeline' : 'pipeline');
  }
  console.log(`[train] boot pass: ${considered} decided claim(s) considered, ${enrolled} photo embedding(s) enrolled`);
  return { enrolled, claimsConsidered: considered };
}
