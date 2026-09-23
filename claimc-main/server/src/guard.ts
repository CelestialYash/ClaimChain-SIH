import { PAYOUT_ELIGIBLE, type ClaimStatusName } from './chain/chain.js';

/**
 * Server-side state machine (CLAIMCHAIN_WORKFLOW.md §4) — the guard the
 * prototype lacked. AI verdicts are pipeline-only; flagged claims are
 * payout-frozen (RULE ZERO); humans can only resolve flagged/rejected claims
 * with a ≥20-char sealed reason.
 */

export class GuardError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    message: string
  ) {
    super(message);
    this.name = 'GuardError';
  }
}

/** Human-review transitions: [from-statuses, requiresNote?]. */
const HUMAN_RULES: Record<
  'HUMAN_APPROVED' | 'HUMAN_REJECTED' | 'HUMAN_REVIEW',
  { from: readonly ClaimStatusName[]; minNote: number }
> = {
  HUMAN_APPROVED: { from: ['AI_FLAGGED', 'AI_REJECTED'], minNote: 20 },
  HUMAN_REJECTED: { from: ['AI_FLAGGED', 'AI_REJECTED'], minNote: 20 },
  HUMAN_REVIEW: { from: ['AI_REJECTED'], minNote: 1 },
};

const TERMINAL: readonly ClaimStatusName[] = ['PAID', 'HUMAN_REJECTED'];

/**
 * Validate a requested transition. Throws GuardError on any violation.
 * AI verdicts and PAID can NEVER enter through here — they are set by the
 * verification pipeline and the guarded /pay endpoint respectively.
 */
export function assertTransition(current: ClaimStatusName, next: ClaimStatusName, note: string): void {
  if (next === 'AI_APPROVED' || next === 'AI_FLAGGED' || next === 'AI_REJECTED') {
    throw new GuardError(
      'AI_VERDICTS_ARE_COMPUTED',
      403,
      `AI verdicts are computed by the verification pipeline and cannot be sealed manually (requested ${next})`
    );
  }
  if (next === 'PAID') {
    throw new GuardError('USE_PAY_ENDPOINT', 409, 'Payouts must go through POST /api/claims/:id/pay');
  }
  if (next === 'SUBMITTED' || next === 'HUMAN_OVERRIDDEN' || next === 'REJECTED') {
    throw new GuardError('INVALID_TRANSITION', 409, `Transition to ${next} is not permitted`);
  }
  if (TERMINAL.includes(current)) {
    throw new GuardError('TERMINAL_STATE', 409, `Claim is ${current} (terminal) — no further transitions`);
  }

  const rule = HUMAN_RULES[next as keyof typeof HUMAN_RULES];
  if (rule) {
    if (!rule.from.includes(current)) {
      throw new GuardError(
        'INVALID_TRANSITION',
        409,
        `${next} is only allowed from ${rule.from.join(' / ')} (current: ${current})`
      );
    }
    if (note.trim().length < rule.minNote) {
      throw new GuardError(
        'REASON_TOO_SHORT',
        400,
        `Human ${next.toLowerCase()} requires a reason of at least ${rule.minNote} characters (sealed on-chain)`
      );
    }
    return;
  }

  throw new GuardError('INVALID_TRANSITION', 409, `Unknown transition target ${next}`);
}

/**
 * RULE ZERO: payout eligibility. A flagged claim is a payout freeze; the only
 * unlock is a human approval sealed with a reason.
 */
export function assertPayoutEligible(current: ClaimStatusName): void {
  if (current === 'AI_FLAGGED') {
    throw new GuardError('FLAGGED_LOCKED', 409, 'Claim is flagged for fraud review — human approval required before payout');
  }
  if (!PAYOUT_ELIGIBLE.includes(current)) {
    throw new GuardError('INVALID_STATE', 409, `Payout requires status ${PAYOUT_ELIGIBLE.join(' or ')} (current: ${current})`);
  }
}
