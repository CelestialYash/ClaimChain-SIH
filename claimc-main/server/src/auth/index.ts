import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { db, users, type UserRow } from '../db/index.js';

/**
 * Insurer authentication (INSURER_AUTH_DB_SECURITY_PLAN.md §2).
 *
 * bcrypt (salt 10) password hashes + stateless HS256 JWTs (24h expiry)
 * carried in `Authorization: Bearer <token>`. Demo secret via JWT_SECRET
 * (default is for local judges only — override in any shared deployment).
 *
 * Guarded routes: human transitions (review), payout (RULE ZERO path),
 * verification retry, and claim assignment. Read endpoints stay public for
 * the judge demo; the pipeline intake stays public (farmers have no account).
 */

const JWT_SECRET = process.env.JWT_SECRET ?? 'claimchain-demo-secret-change-me';
const JWT_TTL = process.env.JWT_TTL ?? '24h';
const BCRYPT_ROUNDS = 10;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'inspector' | 'supervisor';
  district: string;
}

function toAuthUser(u: UserRow): AuthUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role, district: u.district };
}

// ---------------------------------------------------------------------------
// Seeded inspector accounts (one-click demo presets on the login screen)
// ---------------------------------------------------------------------------
const SEED_USERS: Array<Omit<UserRow, 'createdAt'>> = [
  {
    id: 'usr-inspector-1',
    email: 'inspector1@claimchain.gov.in',
    name: 'Inspector 1',
    role: 'inspector',
    district: 'Yavatmal / Nanded',
    passwordHash: bcrypt.hashSync('inspector1', BCRYPT_ROUNDS),
  },
  {
    id: 'usr-inspector-2',
    email: 'inspector2@claimchain.gov.in',
    name: 'Inspector 2',
    role: 'inspector',
    district: 'Nashik / Pune',
    passwordHash: bcrypt.hashSync('inspector2', BCRYPT_ROUNDS),
  },
  {
    id: 'usr-supervisor',
    email: 'supervisor@claimchain.gov.in',
    name: 'Supervisor',
    role: 'supervisor',
    district: 'Maharashtra (all districts)',
    passwordHash: bcrypt.hashSync('supervisor', BCRYPT_ROUNDS),
  },
];

/** Idempotent: INSERT OR IGNORE keeps password hashes across restarts. */
export function seedAuthUsers(): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO users (id, email, passwordHash, name, role, district, createdAt)
     VALUES (@id, @email, @passwordHash, @name, @role, @district, @createdAt)`,
  );
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const u of SEED_USERS) insert.run({ ...u, createdAt: now });
  });
  tx();
  console.log(`[auth] ${users.all.all().length} user account(s) ready`);
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------
export function issueToken(u: UserRow): string {
  const payload = { sub: u.id, email: u.email, name: u.name, role: u.role, district: u.district };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_TTL as jwt.SignOptions['expiresIn'] });
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
    const row = users.byId.get(payload.sub);
    return row ? toAuthUser(row) : null; // user deleted → token invalid
  } catch {
    return null;
  }
}

/** bcrypt password check (timing-safe via bcrypt.compare). */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ---------------------------------------------------------------------------
// Express middleware
// ---------------------------------------------------------------------------
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = token ? verifyToken(token) : null;
  if (!user) {
    res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Sign in as an inspector to perform this action.' });
    return;
  }
  req.auth = user;
  next();
}

export function requireRole(...roles: Array<AuthUser['role']>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Sign in first.' });
      return;
    }
    if (!roles.includes(req.auth.role)) {
      res.status(403).json({ error: 'FORBIDDEN', message: `Requires role: ${roles.join(' / ')}` });
      return;
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Routes (login / me / logout) are registered in index.ts — they reuse its
// zod validation + error style and need no special deps beyond this module.
// ---------------------------------------------------------------------------
