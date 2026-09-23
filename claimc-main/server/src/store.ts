import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Claim, Evidence } from './types.js';

/**
 * In-memory store + evidence byte storage (persistence deliberately deferred
 * per CLAIMCHAIN_WORKFLOW.md §9). Evidence bytes are content-addressed by
 * fileId on disk so they survive dev reloads; the claims map is RAM-only.
 */

export const claims = new Map<string, Claim>();

/** fileId -> raw bytes (also mirrored to disk under EVIDENCE_DIR). */
const evidenceBytes = new Map<string, Buffer>();

export const EVIDENCE_DIR = process.env.EVIDENCE_DIR ?? path.resolve('.evidence');

export function saveEvidence(fileId: string, buf: Buffer): void {
  evidenceBytes.set(fileId, buf);
  try {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(path.join(EVIDENCE_DIR, fileId), buf);
  } catch (err) {
    // Disk mirror is best-effort; the in-memory copy is authoritative for this boot.
    console.warn('[store] evidence disk mirror failed:', (err as Error).message);
  }
}

export function readEvidence(fileId: string): Buffer {
  const mem = evidenceBytes.get(fileId);
  if (mem) return mem;
  const file = path.join(EVIDENCE_DIR, fileId);
  if (existsSync(file)) {
    const buf = readFileSync(file);
    evidenceBytes.set(fileId, buf);
    return buf;
  }
  throw new Error(`evidence ${fileId} not found`);
}

export function hasEvidence(fileId: string): boolean {
  return evidenceBytes.has(fileId) || existsSync(path.join(EVIDENCE_DIR, fileId));
}

/** Cross-claim duplicate lookup helper used by the evidence-tamper check. */
export function findEvidenceRow(fileId: string): { claim: Claim; evidence: Evidence } | null {
  for (const claim of claims.values()) {
    const evidence = claim.evidence.find((e) => e.fileId === fileId);
    if (evidence) return { claim, evidence };
  }
  return null;
}
