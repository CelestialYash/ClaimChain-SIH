import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { claims } from './store.js';
import { explainRun } from './ai/explain.js';
import type { Claim } from './types.js';

/**
 * Write-through snapshot persistence for the in-memory claims map.
 *
 * Scope (deliberate): the claims store is the ONLY RAM-only state — evidence
 * bytes are already content-addressed on disk (.evidence/), and the fraud
 * memory persists itself (.fraud-memory.json). This module snapshots claim
 * rows so a server restart restores claims + verification logs + explanations
 * without re-running the pipeline, while the on-chain trail remains the
 * source of truth for integrity.
 *
 * Semantics:
 *  - Write-through: every mutation calls schedulePersist(); writes are
 *    microtask-debounced and atomically replace the snapshot (tmp + rename).
 *  - Fill-the-gaps on boot: seeds re-seal only missing trails and SKIP
 *    rebuilding claims that were restored from the snapshot (idempotence).
 *  - Contract guard: the snapshot is stamped with the contract address; a
 *    different contract (fresh deploy) starts with an empty store instead of
 *    resurrecting claims whose sealed records live on another chain.
 *  - Derived fields: `explanation` is recomputed on load (never trusted from
 *    disk) so wording changes don't require a migration.
 *
 * Disabled with CLAIMCHAIN_PERSIST=0 (pure in-memory, previous behavior).
 * Upgrade path to Prisma/Postgres: replace this module's functions with real
 * queries — the call sites (schedulePersist / loadPersistedClaims) stay put.
 */

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve('.data');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'claims.json');

const enabled = process.env.CLAIMCHAIN_PERSIST !== '0';

interface SnapshotRow extends Omit<Claim, 'verification'> {
  verification?: Omit<Claim['verification'], 'explanation'> & { explanation?: string };
}

interface SnapshotFile {
  savedAt: string;
  contract: string | null;
  claims: SnapshotRow[];
}

/** Strip derived fields (explanation) — they are recomputed on load. */
function toRow(claim: Claim): SnapshotRow {
  const { verification, ...rest } = claim;
  if (!verification) return rest as SnapshotRow;
  const { explanation: _explanation, ...verRest } = verification;
  return { ...rest, verification: verRest } as SnapshotRow;
}

/** Revive a row: recompute the explanation, keep everything else verbatim. */
function fromRow(row: SnapshotRow): Claim {
  const claim = row as Claim;
  if (claim.verification && !claim.verification.explanation) {
    claim.verification.explanation = explainRun(claim.verification, claim);
  }
  return claim;
}

function writeSnapshot(contract: string | null): void {
  const payload: SnapshotFile = {
    savedAt: new Date().toISOString(),
    contract,
    claims: Array.from(claims.values()).map(toRow),
  };
  const tmp = `${SNAPSHOT_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload));
  renameSync(tmp, SNAPSHOT_FILE); // atomic replace
}

// --- Debounced writer -------------------------------------------------------

let contractRef: string | null = null;
const dirty = new Set<string>();
let scheduled = false;

function flush(): void {
  scheduled = false;
  if (dirty.size === 0) return;
  dirty.clear();
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeSnapshot(contractRef);
  } catch (err) {
    console.warn('[persist] snapshot write failed:', (err as Error).message);
  }
}

/** Queue a persist for one claim (coalesces same-tick mutations). */
export function schedulePersist(claimId: string): void {
  if (!enabled) return;
  dirty.add(claimId);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(flush);
  }
}

// --- Boot loader ------------------------------------------------------------

/**
 * Restore claims from the snapshot (before seeding). Returns the count.
 * A contract-address mismatch (fresh deploy) intentionally starts empty.
 */
export function loadPersistedClaims(contractAddress: string | null): number {
  contractRef = contractAddress; // stamp snapshots with the live contract from the first write
  if (!enabled || !existsSync(SNAPSHOT_FILE)) return 0;
  try {
    const parsed = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')) as SnapshotFile;
    if (parsed.contract !== contractAddress) {
      console.log(
        `[persist] snapshot is for contract ${parsed.contract ?? '—'}, current is ${contractAddress ?? '—'} — starting fresh`
      );
      return 0;
    }
    let n = 0;
    for (const row of parsed.claims ?? []) {
      if (!row?.id || claims.has(row.id)) continue;
      claims.set(row.id, fromRow(row));
      n++;
    }
    if (n > 0) console.log(`[persist] restored ${n} claim(s) from ${path.basename(SNAPSHOT_FILE)}`);
    contractRef = contractAddress;
    return n;
  } catch (err) {
    console.warn('[persist] snapshot unreadable — starting fresh:', (err as Error).message);
    return 0;
  }
}
