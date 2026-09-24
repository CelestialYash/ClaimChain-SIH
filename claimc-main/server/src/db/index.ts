import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { claims } from '../store.js';
import type { Claim, Evidence } from '../types.js';

/**
 * Relational database layer (INSURER_AUTH_DB_SECURITY_PLAN.md §3).
 *
 * Engine: better-sqlite3 (embedded, file-backed, sub-ms queries, no external
 * service) — swappable to Postgres via Prisma later; every access goes through
 * this module.
 *
 * Architecture: the in-memory claims Map + JSON snapshot remain the LIVE
 * source of truth (whole pipeline reads/writes it). SQLite is a durable
 * relational mirror, written through on every mutation + a full resync on
 * boot, giving the insurer multi-tenant history, filtering and assignment
 * queries WITHOUT touching the verified pipeline semantics.
 *
 * Location: .data/claimchain.db (same dir as the claims snapshot; survives
 * restarts; gitignored). Override with DB_FILE. Disable with CLAIMCHAIN_DB=0
 * (auth then fails closed — auth is meaningless without a user store).
 */

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve('.data');
const DB_FILE = process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(DATA_DIR, 'claimchain.db');

export const dbEnabled = process.env.CLAIMCHAIN_DB !== '0';

export const db = new Database(dbEnabled ? DB_FILE : ':memory:');
db.pragma('journal_mode = WAL'); // concurrent readers (filtered history) during writes
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Schema (plan §3 erDiagram + assignments table)
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    passwordHash  TEXT NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('inspector', 'supervisor')),
    district      TEXT NOT NULL,
    createdAt     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS claims (
    id                TEXT PRIMARY KEY,
    claimantName      TEXT NOT NULL,
    lossType          TEXT NOT NULL,
    amountRequested   INTEGER NOT NULL,
    status            TEXT NOT NULL,
    policyNumber      TEXT,
    assignedTo        TEXT REFERENCES users(id),
    latestStateHash   TEXT,
    submittedAt       TEXT NOT NULL,
    decidedAt         TEXT
  );

  CREATE TABLE IF NOT EXISTS evidence (
    fileId      TEXT PRIMARY KEY,
    claimId     TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    filename    TEXT NOT NULL,
    sha256      TEXT NOT NULL,
    pHash       TEXT,
    sizeBytes   INTEGER NOT NULL,
    mimeType    TEXT NOT NULL,
    createdAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    claimId     TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    stateHash   TEXT NOT NULL,
    status      TEXT NOT NULL,
    recordedBy  TEXT,
    note        TEXT,
    timestamp   TEXT NOT NULL,
    UNIQUE (claimId, stateHash, status, timestamp)
  );

  CREATE TABLE IF NOT EXISTS assignments (
    claimId     TEXT PRIMARY KEY REFERENCES claims(id) ON DELETE CASCADE,
    assignedTo  TEXT NOT NULL REFERENCES users(id),
    assignedBy  TEXT NOT NULL,
    assignedAt  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_claims_status      ON claims(status);
  CREATE INDEX IF NOT EXISTS idx_claims_assignedTo  ON claims(assignedTo);
  CREATE INDEX IF NOT EXISTS idx_claims_submittedAt ON claims(submittedAt);
  CREATE INDEX IF NOT EXISTS idx_evidence_claimId   ON evidence(claimId);
  CREATE INDEX IF NOT EXISTS idx_audit_claimId      ON audit_records(claimId);
`);

mkdirSync(path.dirname(DB_FILE), { recursive: true });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: 'inspector' | 'supervisor';
  district: string;
  createdAt: string;
}

/** Latest known sealed record per claim (read off the in-memory verification trail). */
interface TrailStamp {
  stateHash: string;
  status: string;
  recordedBy: string | null;
  note: string | null;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Users repository
// ---------------------------------------------------------------------------
export const users = {
  byEmail: db.prepare<[string], UserRow>('SELECT * FROM users WHERE email = ?'),
  byId: db.prepare<[string], UserRow>('SELECT * FROM users WHERE id = ?'),
  all: db.prepare<[], UserRow>('SELECT * FROM users ORDER BY createdAt'),
  insert: db.prepare(
    `INSERT INTO users (id, email, passwordHash, name, role, district, createdAt)
     VALUES (@id, @email, @passwordHash, @name, @role, @district, @createdAt)`,
  ),
};

/** Convenience wrapper used by the login route in index.ts. */
export function userByEmail(email: string): UserRow | undefined {
  return users.byEmail.get(email);
}

// ---------------------------------------------------------------------------
// Claims + evidence + audit records mirror
// ---------------------------------------------------------------------------

/** A claim's latest decided timestamp, derived from its verification run. */
function decidedAtOf(claim: Claim): string | null {
  return claim.verification?.finishedAt ?? null;
}

/** Map an in-memory Evidence row onto the relational evidence table. */
function evidenceRow(claimId: string, e: Evidence) {
  return {
    fileId: e.fileId,
    claimId,
    kind: e.kind,
    filename: e.filename,
    sha256: e.sha256,
    pHash: e.pHash,
    sizeBytes: e.sizeBytes,
    mimeType: e.mimeType,
    createdAt: e.createdAt,
  };
}

const upsertClaim = db.prepare(`
  INSERT INTO claims (id, claimantName, lossType, amountRequested, status, policyNumber, latestStateHash, submittedAt, decidedAt)
  VALUES (@id, @claimantName, @lossType, @amountRequested, @status, @policyNumber, @latestStateHash, @submittedAt, @decidedAt)
  ON CONFLICT(id) DO UPDATE SET
    claimantName=excluded.claimantName,
    lossType=excluded.lossType,
    amountRequested=excluded.amountRequested,
    status=excluded.status,
    policyNumber=excluded.policyNumber,
    latestStateHash=excluded.latestStateHash,
    decidedAt=excluded.decidedAt
`);

const upsertEvidence = db.prepare(`
  INSERT INTO evidence (fileId, claimId, kind, filename, sha256, pHash, sizeBytes, mimeType, createdAt)
  VALUES (@fileId, @claimId, @kind, @filename, @sha256, @pHash, @sizeBytes, @mimeType, @createdAt)
  ON CONFLICT(fileId) DO NOTHING
`);

const insertAudit = db.prepare(`
  INSERT OR IGNORE INTO audit_records (claimId, stateHash, status, recordedBy, note, timestamp)
  VALUES (@claimId, @stateHash, @status, @recordedBy, @note, @timestamp)
`);

/**
 * Mirror ONE claim (in-memory → SQLite): claim row + evidence rows + the
 * verification DECISION stamp as the audit-record row. Called after every
 * mutation from the API (write-through).
 */
export function mirrorClaim(claim: Claim, trail?: TrailStamp): void {
  if (!dbEnabled) return;
  const tx = db.transaction(() => {
    upsertClaim.run({
      id: claim.id,
      claimantName: claim.claimantName,
      lossType: claim.lossType,
      amountRequested: claim.amountRequested,
      status: claim.status,
      policyNumber: claim.policyNumber ?? null,
      latestStateHash: claim.latestStateHash ?? null,
      submittedAt: claim.submittedAt,
      decidedAt: decidedAtOf(claim),
    });
    for (const e of claim.evidence) upsertEvidence.run(evidenceRow(claim.id, e));
    if (trail) {
      insertAudit.run({
        claimId: claim.id,
        stateHash: trail.stateHash,
        status: trail.status,
        recordedBy: trail.recordedBy,
        note: trail.note,
        timestamp: trail.timestamp,
      });
    }
  });
  tx();
}

/** Full resync on boot: ensures every in-memory claim exists relationally. */
export function mirrorAll(): number {
  if (!dbEnabled) return 0;
  let n = 0;
  for (const claim of claims.values()) {
    mirrorClaim(claim);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------
export const assignments = {
  get: db.prepare<[string], { claimId: string; assignedTo: string; assignedBy: string; assignedAt: string }>(
    'SELECT * FROM assignments WHERE claimId = ?',
  ),
  set: db.prepare(
    `INSERT INTO assignments (claimId, assignedTo, assignedBy, assignedAt)
     VALUES (@claimId, @assignedTo, @assignedBy, @assignedAt)
     ON CONFLICT(claimId) DO UPDATE SET assignedTo=excluded.assignedTo, assignedBy=excluded.assignedBy, assignedAt=excluded.assignedAt`,
  ),
  /** Keep claims.assignedTo in sync with the assignment table. */
  syncClaim: db.prepare('UPDATE claims SET assignedTo = @assignedTo WHERE id = @claimId'),
};

// ---------------------------------------------------------------------------
// Filtered history (plan §3 — dashboard tabs)
// ---------------------------------------------------------------------------

export interface HistoryFilters {
  status?: string | null; // AI_APPROVED | AI_FLAGGED | ... | PAID | 'flagged' group
  inspector?: string | null; // user id
  search?: string | null; // claim id / claimant / policy number
  lossType?: string | null;
}

const STATUS_GROUP: Record<string, string[]> = {
  approved: ['AI_APPROVED', 'HUMAN_APPROVED'],
  flagged: ['AI_FLAGGED', 'HUMAN_REVIEW'],
  rejected: ['AI_REJECTED', 'HUMAN_REJECTED', 'REJECTED'],
  paid: ['PAID'],
};

const claimedBase = `
  SELECT c.*, u.name AS inspectorName, u.district AS inspectorDistrict
  FROM claims c
  LEFT JOIN users u ON u.id = c.assignedTo
`;

export function listHistory(filters: HistoryFilters): Array<Record<string, unknown>> {
  if (!dbEnabled) return [];
  const where: string[] = [];
  const params: Record<string, string> = {};

  if (filters.status) {
    const group = STATUS_GROUP[filters.status.toLowerCase()];
    if (group) {
      // Expand the group into named params (:s0, :s1, …)
      where.push(`c.status IN (${group.map((_, i) => `@s${i}`).join(',')})`);
      group.forEach((s, i) => (params[`s${i}`] = s));
    } else {
      where.push('c.status = @status');
      params.status = filters.status;
    }
  }
  if (filters.inspector) {
    where.push('c.assignedTo = @inspector');
    params.inspector = filters.inspector;
  }
  if (filters.search) {
    where.push('(c.id LIKE @search OR c.claimantName LIKE @search OR c.policyNumber LIKE @search)');
    params.search = `%${filters.search}%`;
  }
  if (filters.lossType) {
    where.push('c.lossType = @lossType');
    params.lossType = filters.lossType;
  }

  const sql = claimedBase + (where.length ? ` WHERE ${where.join(' AND ')}` : '') + ' ORDER BY c.submittedAt DESC';
  return db.prepare(sql).all(params) as Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Boot resync + note
// ---------------------------------------------------------------------------

/**
 * Called from main() AFTER loadPersistedClaims + seedClaims so the relational
 * mirror starts from the complete in-memory state. One-shot (boot) — ongoing
 * changes arrive via mirrorClaim write-throughs.
 */
export function initDbMirror(): number {
  const n = mirrorAll();
  const auditCount = (db.prepare('SELECT COUNT(*) c FROM audit_records').get() as { c: number }).c;
  console.log(`[db] SQLite mirror ready: ${n} claim(s), ${auditCount} audit record(s) @ ${DB_FILE}`);
  return n;
}
