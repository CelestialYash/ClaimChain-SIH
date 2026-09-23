import { ethers } from 'ethers';

/**
 * TypeScript mirror of the ClaimAuditTrail hashing rules.
 * MUST stay byte-identical with blockchain/contracts/ClaimAuditTrail.sol —
 * the Hardhat tests in blockchain/test recompute the same formula.
 */

export const CLAIM_STATUSES = [
  'SUBMITTED',
  'AI_APPROVED',
  'AI_FLAGGED',
  'HUMAN_OVERRIDDEN',
  'PAID',
  'REJECTED',
  'HUMAN_REVIEW',
  'HUMAN_APPROVED',
  'HUMAN_REJECTED',
  /** Pipeline verdict alias — seals on-chain as REJECTED (5) but keeps the
   *  review lane open (HUMAN_REVIEW / appeal) unlike terminal REJECTED. */
  'AI_REJECTED',
] as const;

export type ClaimStatusName = (typeof CLAIM_STATUSES)[number];

export const CLAIM_STATUS: Record<ClaimStatusName, number> = {
  SUBMITTED: 0,
  AI_APPROVED: 1,
  AI_FLAGGED: 2,
  HUMAN_OVERRIDDEN: 3,
  PAID: 4,
  REJECTED: 5,
  HUMAN_REVIEW: 6,
  HUMAN_APPROVED: 7,
  HUMAN_REJECTED: 8,
  AI_REJECTED: 5, // same on-chain slot as REJECTED (contract enum unchanged)
};

/** Claim statuses that unlock payout (RULE ZERO — everything else is frozen). */
export const PAYOUT_ELIGIBLE: readonly ClaimStatusName[] = ['AI_APPROVED', 'HUMAN_APPROVED'] as const;

export function claimIdToBytes32(claimId: string): string {
  return ethers.id(claimId); // keccak256(utf8(claimId))
}

/**
 * Canonical state hash of a claim's evidence — the claim commitment that gets
 * sealed on-chain. Accepts either legacy string labels (imageHashes) or the
 * real crypto material (evidenceHashes / pHashes / verification digest).
 */
export function computeStateHash(input: {
  claimId: string;
  lossType: string;
  claimantName: string;
  amountRequested: number;
  /** Legacy string labels (seeded claims); hashes via keccak256(utf8(label)). */
  imageHashes?: string[];
  /** Real sha256 evidence digests (0x-hex or bare hex accepted). */
  evidenceHashes?: string[];
  /** Perceptual hashes of photos (64-char 01 strings). */
  pHashes?: string[];
  /** Verification log digest committed by DECISION records. */
  verificationHash?: string;
  sealedAt: string; // ISO timestamp
}): string {
  const types: string[] = ['string', 'string', 'string', 'uint256'];
  const values: (string | bigint | string[])[] = [
    input.claimId,
    input.lossType,
    input.claimantName,
    BigInt(input.amountRequested),
  ];

  const norm32 = (xs: string[]): string[] => xs.map((h) => (h.startsWith('0x') ? h : ethers.id(h)));
  const imageHashes = norm32(input.imageHashes ?? []);
  const evidenceHashes = norm32(input.evidenceHashes ?? []);
  const pHashes = (input.pHashes ?? []).map((p) =>
    ethers.solidityPackedKeccak256(['string'], [p])
  );
  types.push('bytes32[]');
  values.push([...imageHashes, ...evidenceHashes, ...pHashes]);

  if (input.verificationHash !== undefined) {
    types.push('bytes32');
    values.push(input.verificationHash);
  }

  types.push('string');
  values.push(input.sealedAt);

  return ethers.solidityPackedKeccak256(types, values as never);
}

/** keccak256(abi.encode(prev, stateHash, status, ts, by, noteHash)) — same as the contract. */
export function computeRecordHash(input: {
  prevRecordHash: string;
  stateHash: string;
  status: number; // uint8
  timestamp: bigint | number; // uint64
  recordedBy: string; // address
  note: string;
}): string {
  const noteHash = ethers.keccak256(ethers.toUtf8Bytes(input.note));
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes32', 'uint8', 'uint64', 'address', 'bytes32'],
      [
        input.prevRecordHash,
        input.stateHash,
        input.status,
        input.timestamp,
        input.recordedBy,
        noteHash,
      ]
    )
  );
}

export interface TrailRecord {
  stateHash: string;
  prevRecordHash: string;
  recordHash: string;
  status: number;
  timestamp: bigint;
  recordedBy: string;
  note: string;
}

/**
 * Combined integrity report: off-chain recomputation + the contract's own
 * verifyTrail verdict. The contract signals "intact" with type(uint256).max,
 * which is surfaced as null so JSON never carries a 78-digit sentinel.
 */
export function integrityReport(
  offChainBreak: number | null,
  onChainValid: boolean,
  onChainBrokenAt: bigint
): {
  offChainValid: boolean;
  offChainBreakAtIndex: number | null;
  onChainValid: boolean;
  onChainBreakAtIndex: number | null;
} {
  return {
    offChainValid: offChainBreak === null,
    offChainBreakAtIndex: offChainBreak,
    onChainValid,
    onChainBreakAtIndex:
      onChainValid || onChainBrokenAt === ethers.MaxUint256 ? null : Number(onChainBrokenAt),
  };
}

/**
 * Verify a trail's hash chain off-chain (the "prove" step from the pitch).
 * Returns the index of the first broken record, or null when the chain is intact.
 */
export function findChainBreak(trail: TrailRecord[]): number | null {
  for (let i = 0; i < trail.length; i++) {
    const r = trail[i];
    const expected = computeRecordHash({
      prevRecordHash: r.prevRecordHash,
      stateHash: r.stateHash,
      status: r.status,
      timestamp: r.timestamp,
      recordedBy: r.recordedBy,
      note: r.note,
    });
    if (expected !== r.recordHash) return i;
    const linkOk = i === 0 ? r.prevRecordHash === ethers.ZeroHash : r.prevRecordHash === trail[i - 1].recordHash;
    if (!linkOk) return i;
  }
  return null;
}
