import { ethers } from 'ethers';
import type { AuditTrailResponse } from './attest.js';
import { buildClaimMerkleBundle } from './merkle.js';
import type { TrailRecord } from './chain.js';

/**
 * Cryptographic dossier: a self-contained, verifiable JSON export for
 * regulators/off-chain storage (mirrors the mockups' "Export Cryptographic
 * Dossier (.json + .sig)"). Signature is over the canonical dossier bytes.
 */

export interface Dossier {
  format: 'claimchain-dossier';
  version: 1;
  generatedAt: string;
  claimId: string;
  recordCount: number;
  integrity: AuditTrailResponse['integrity'];
  records: Array<{
    index: number;
    status: string;
    note: string;
    sealedAtIso: string;
    stateHash: string;
    prevRecordHash: string;
    recordHash: string;
    recordedBy: string;
  }>;
  merkle: { leafCount: number; root: string };
  attestation: {
    algorithm: 'keccak256';
    canonicalHash: string; // keccak256 over the canonical JSON of everything above
    signer: string; // API attester address
    signature: string; // EIP-191 personal_sign over canonicalHash
  };
}

function canonicalize(value: unknown): string {
  // Stable JSON: sorted object keys, no whitespace.
  const json = JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v)
        .sort()
        .reduce((acc: Record<string, unknown>, key) => {
          acc[key] = (v as Record<string, unknown>)[key];
          return acc;
        }, {});
    }
    return v;
  });
  return json;
}

export async function buildDossier(
  claimId: string,
  trail: TrailRecord[],
  integrity: AuditTrailResponse['integrity'],
  signer: { address: string; signMessage: (m: string | Uint8Array) => Promise<string> }
): Promise<Dossier> {
  const STATUS_NAMES = ['SUBMITTED', 'AI_APPROVED', 'AI_FLAGGED', 'HUMAN_OVERRIDDEN', 'PAID', 'REJECTED'];
  const bundle = buildClaimMerkleBundle(claimId, trail);

  const dossierBody = {
    format: 'claimchain-dossier' as const,
    version: 1 as const,
    generatedAt: new Date().toISOString(),
    claimId,
    recordCount: trail.length,
    integrity,
    records: trail.map((r, i) => ({
      index: i,
      status: STATUS_NAMES[r.status] ?? String(r.status),
      note: r.note,
      sealedAtIso: new Date(Number(r.timestamp) * 1000).toISOString(),
      stateHash: r.stateHash,
      prevRecordHash: r.prevRecordHash,
      recordHash: r.recordHash,
      recordedBy: r.recordedBy,
    })),
    merkle: { leafCount: bundle.leaves, root: bundle.root },
  };

  const canonicalHash = ethers.keccak256(ethers.toUtf8Bytes(canonicalize(dossierBody)));
  // EIP-191 personal_sign over the canonical hash bytes.
  const signature: string = await signer.signMessage(ethers.getBytes(canonicalHash));

  return { ...dossierBody, attestation: { algorithm: 'keccak256', canonicalHash, signer: signer.address, signature } };
}
