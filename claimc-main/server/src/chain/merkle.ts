import { ethers } from 'ethers';
import type { TrailRecord } from './chain.js';

/**
 * Merkle inclusion proofs over a claim's sealed records.
 *
 * Lets an auditor prove "record #i is part of this claim's sealed history"
 * without trusting the API: they recompute the root from the proof and can
 * compare it against the root published/attested elsewhere. Leaves are the
 * recordHash values already committed on-chain.
 *
 * Standard binary Merkle tree with duplicate-last promotion for odd counts.
 */

export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return ethers.ZeroHash;
  let level = leaves.map((l) => ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(l)))).map((b) =>
    ethers.keccak256(b)
  );
  if (level.length === 1) return level[0];

  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i]; // duplicate-last
      next.push(ethers.keccak256(ethers.concat([left, right])));
    }
    level = next;
  }
  return level[0];
}

export interface MerkleProof {
  leafIndex: number;
  leaf: string;
  siblings: Array<{ hash: string; isRight: boolean }>; // path from leaf to root
  root: string;
}

export function merkleProof(leaves: string[], index: number): MerkleProof {
  if (index < 0 || index >= leaves.length) throw new Error('leaf index out of range');
  let level = [...leaves];
  let idx = index;
  const siblings: MerkleProof['siblings'] = [];

  // Normalize leaves the same way as merkleRoot.
  level = level.map((l) => ethers.keccak256(ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(l)))));

  while (level.length > 1) {
    const siblingIdx = idx ^ 1;
    const sibling = level[Math.min(siblingIdx, level.length - 1)];
    siblings.push({ hash: sibling, isRight: siblingIdx > idx || (siblingIdx === idx && idx % 2 === 0) });
    idx = idx >> 1;
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(ethers.keccak256(ethers.concat([left, right])));
    }
    level = next;
  }

  return { leafIndex: index, leaf: leaves[index], siblings, root: level[0] };
}

export function verifyMerkleProof(p: MerkleProof): boolean {
  let hash = ethers.keccak256(ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(p.leaf))));
  for (const s of p.siblings) {
    hash = s.isRight ? ethers.keccak256(ethers.concat([hash, s.hash])) : ethers.keccak256(ethers.concat([s.hash, hash]));
  }
  return hash === p.root;
}

export interface RecordMerkleBundle {
  claimId: string;
  leaves: number;
  root: string;
  proofs: MerkleProof[];
}

/** Build the full bundle for a claim trail: root + per-record proofs. */
export function buildClaimMerkleBundle(claimId: string, trail: TrailRecord[]): RecordMerkleBundle {
  const leaves = trail.map((r) => r.recordHash);
  return {
    claimId,
    leaves: leaves.length,
    root: merkleRoot(leaves),
    proofs: leaves.map((_, i) => merkleProof(leaves, i)),
  };
}
