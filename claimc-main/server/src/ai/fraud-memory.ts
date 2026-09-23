import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { cosine, embedImage } from './clip.js';
import type { Claim } from '../types.js';

/**
 * The "training" for ClaimChain's fraud flagging — a few-shot embedding memory
 * (the WinCLIP / PatchCore pattern: pre-trained CLIP + a nearest-neighbor
 * memory of decided cases; NO gradient training, NO labeled dataset needed).
 *
 * How it learns:
 *  1. Boot training pass — every already-decided claim (seeds included) is
 *     enrolled under its verdict label.
 *  2. Auto-enroll — every fresh DECISION enrolls that claim's photo embeddings
 *     under the computed verdict's label.
 *  3. Human feedback loop — HUMAN_APPROVED / HUMAN_REJECTED transitions
 *     re-label the claim's embeddings (humans are the ground truth).
 *
 * Scoring a new claim = k-NN vote over the memory (cosine similarity).
 * Persisted to disk so training survives restarts.
 */

const MEMORY_FILE = process.env.FRAUD_MEMORY_PATH
  ? path.resolve(process.env.FRAUD_MEMORY_PATH)
  : path.resolve('.fraud-memory.json');

interface MemoryEntry {
  label: 'genuine' | 'fraud';
  claimId: string;
  fileId: string;
  /** Normalized 512-dim CLIP embedding (rounded to shrink the file). */
  vec: number[];
  /** Where the label came from — auditability for judges. */
  source: 'pipeline' | 'human' | 'seed' | 'external';
  at: string;
}

const MAX_PER_LABEL = 500;
const KNN_K = 5;
const VOTE_FRAUD_FRACTION = 0.5; // ≥50% of k neighbors fraudulent → suspicious

let entries: MemoryEntry[] = [];
let loaded = false;
let dirty = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  if (!existsSync(MEMORY_FILE)) return;
  try {
    entries = JSON.parse(readFileSync(MEMORY_FILE, 'utf8')) as MemoryEntry[];
    console.log(`[fraud-memory] loaded ${entries.length} trained embeddings from ${path.basename(MEMORY_FILE)}`);
  } catch {
    entries = [];
  }
}

function persist(): void {
  if (!dirty) return;
  try {
    mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
    writeFileSync(MEMORY_FILE, JSON.stringify(entries));
    dirty = false;
  } catch (err) {
    console.warn('[fraud-memory] persist failed:', (err as Error).message);
  }
}

/** Upsert one claim's entries (replaces previous labels for the same claim). */
function upsertClaim(next: MemoryEntry[]): void {
  const claimId = next[0]?.claimId;
  entries = entries.filter((e) => e.claimId !== claimId);
  entries.push(...next);
  // Cap the memory so it can't grow unbounded.
  for (const label of ['genuine', 'fraud'] as const) {
    const ofLabel = entries.filter((e) => e.label === label);
    if (ofLabel.length > MAX_PER_LABEL) {
      const oldest = ofLabel
        .sort((a, b) => a.at.localeCompare(b.at))
        .slice(0, ofLabel.length - MAX_PER_LABEL)
        .map((e) => `${e.claimId}:${e.fileId}`);
      entries = entries.filter((e) => !oldest.includes(`${e.claimId}:${e.fileId}`));
    }
  }
  dirty = true;
  persist();
}

export interface ClaimScore {
  fraudScore: number; // 0..100 (k-NN fraud fraction × 100)
  knn: number; // neighbors considered
  matched: Array<{ claimId: string; label: 'genuine' | 'fraud'; similarity: number }>;
}

/** Score a photo's embedding against the trained memory (k-NN vote). */
export function scoreEmbedding(vec: number[]): ClaimScore {
  load();
  if (entries.length === 0) {
    return { fraudScore: 0, knn: 0, matched: [] };
  }
  const scored = entries
    .map((e) => ({ entry: e, similarity: cosine(vec, e.vec) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, KNN_K);

  const fraudNeighbors = scored.filter((s) => s.entry.label === 'fraud').length;
  const fraudScore = Math.round((fraudNeighbors / Math.max(1, scored.length)) * 100);
  return {
    fraudScore,
    knn: scored.length,
    matched: scored.map((s) => ({
      claimId: s.entry.claimId,
      label: s.entry.label,
      similarity: Math.round(s.similarity * 1000) / 1000,
    })),
  };
}

/** Enroll a claim's photos under a label (the training write). */
export async function trainClaim(claim: Claim, label: 'genuine' | 'fraud', source: MemoryEntry['source']): Promise<number> {
  const { readEvidence } = await import('../store.js');
  const next: MemoryEntry[] = [];
  for (const ev of claim.evidence) {
    if (ev.kind !== 'photo' && ev.kind !== 'satellite') continue;
    try {
      const buf = readEvidence(ev.fileId);
      const vec = await embedImage(buf);
      next.push({ label, claimId: claim.id, fileId: ev.fileId, vec: vec.map((x) => Math.round(x * 1e5) / 1e5), source, at: new Date().toISOString() });
    } catch {
      /* unreadable evidence — skip */
    }
  }
  if (next.length > 0) upsertClaim(next);
  return next.length;
}

/** Re-label an entire claim (human feedback loop). */
export async function relabelClaim(claim: Claim, label: 'genuine' | 'fraud'): Promise<number> {
  return trainClaim(claim, label, 'human');
}

/**
 * Enroll pre-computed embeddings from an external labeled training set
 * (npm run train:folder). `claimId` must be a stable group id — e.g.
 * "TRAINING/fraud/case-001" — so re-runs UPSERT that group instead of
 * duplicating entries. Labels are treated as ground truth ('external').
 */
export function enrollEmbeddings(
  claimId: string,
  items: Array<{ fileId: string; vec: number[]; label: 'genuine' | 'fraud' }>,
): number {
  const next: MemoryEntry[] = items.map((it) => ({
    label: it.label,
    claimId,
    fileId: it.fileId,
    vec: it.vec.map((x) => Math.round(x * 1e5) / 1e5),
    source: 'external',
    at: new Date().toISOString(),
  }));
  if (next.length > 0) upsertClaim(next);
  return next.length;
}

/** Claim ids already in memory (boot training pass skips them). */
export function trainedClaimIds(): Set<string> {
  load();
  return new Set(entries.map((e) => e.claimId));
}

export function memoryStats(): { size: number; genuine: number; fraud: number; file: string } {
  load();
  return {
    size: entries.length,
    genuine: entries.filter((e) => e.label === 'genuine').length,
    fraud: entries.filter((e) => e.label === 'fraud').length,
    file: path.basename(MEMORY_FILE),
  };
}
