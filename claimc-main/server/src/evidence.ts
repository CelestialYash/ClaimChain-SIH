import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import multer from 'multer';
import { computePHash, extractExif, sha256Hex } from './ai/imageproc.js';
import { saveEvidence, readEvidence } from './store.js';
import type { Claim, Evidence } from './types.js';

/**
 * Evidence intake (CLAIMCHAIN_WORKFLOW.md §1): multipart upload → virus/size/
 * type check → sha256 + pHash + EXIF per file → evidence rows + byte storage.
 * Uploads are immutable once accepted: changes require a new ADDENDUM record.
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
export const MAX_PHOTOS = 6;
export const MAX_DOCS = 5; // bills + id combined

/** Farmer document roles (doc-verification spec) — one upload slot each. */
export const DOC_FIELDS = ['registry', 'aadhaar', 'satellite', 'policy'] as const;
export type DocField = (typeof DOC_FIELDS)[number];

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_PHOTOS + MAX_DOCS },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type ${file.mimetype} (allowed: JPG, PNG, HEIC, PDF)`));
  },
}).fields([
  { name: 'photos', maxCount: MAX_PHOTOS },
  { name: 'bills', maxCount: 3 },
  { name: 'idDocs', maxCount: 2 },
  { name: 'registry', maxCount: 2 },
  { name: 'aadhaar', maxCount: 2 },
  { name: 'satellite', maxCount: 2 },
  { name: 'policy', maxCount: 2 },
]);

/** Multer errors → 400-friendly message. */
export function uploadErrorMessage(err: unknown): string | null {
  const e = err as NodeJS.ErrnoException & { code?: string; field?: string };
  if (!e) return null;
  if (e.code === 'LIMIT_FILE_SIZE') return `A file exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB limit`;
  if (e.code === 'LIMIT_FILE_COUNT') return `Too many files (max ${MAX_PHOTOS} photos + ${MAX_DOCS} documents)`;
  if (e.code === 'LIMIT_UNEXPECTED_FILE') return `Unexpected upload field "${e.field ?? '?'}" (use photos / bills / idDocs / registry / aadhaar / satellite / policy)`;
  if (e instanceof Error && /Unsupported file type/.test(e.message)) return e.message;
  return null;
}

export interface ProcessedFile {
  evidence: Evidence;
  buffer: Buffer;
}

/** Extract + persist one uploaded file into an evidence row. */
export async function processFile(
  file: Express.Multer.File,
  kind: Evidence['kind'],
  opts: { pHash: boolean; exif: boolean; ocrNote?: string }
): Promise<ProcessedFile> {
  return buildEvidenceRow(file.buffer, kind, file.originalname.slice(0, 120), file.mimetype, opts);
}

/** Core row builder — shared by uploads and deterministic seed generation. */
export async function buildEvidenceRow(
  buf: Buffer,
  kind: Evidence['kind'],
  filename: string,
  mimeType: string,
  opts: { pHash: boolean; exif: boolean }
): Promise<ProcessedFile> {
  const fileId = `ev_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  const pHash = opts.pHash ? await computePHash(buf) : null;
  const exif = opts.exif ? await extractExif(buf) : { present: false };

  const evidence: Evidence = {
    fileId,
    kind,
    filename: filename.slice(0, 120),
    mimeType,
    sizeBytes: buf.length,
    sha256: sha256Hex(buf),
    pHash,
    exif: {
      gps: exif.gps,
      takenAt: exif.takenAt,
      device: exif.device,
      software: exif.software,
      present: exif.present,
    },
    createdAt: new Date().toISOString(),
  };

  saveEvidence(fileId, buf);
  return { evidence, buffer: buf };
}

/** Validate the intake rule: no evidence, no claim (≥1 photo required). */
export function requirePhotos(files: ProcessedFile[] | undefined): ProcessedFile[] {
  const photos = files ?? [];
  if (photos.length === 0) {
    throw new Error('At least one damage photo is required (field "photos")');
  }
  return photos;
}

/** Attach late evidence to an existing claim (caller seals the ADDENDUM). */
export function appendEvidence(claim: Claim, processed: ProcessedFile[]): void {
  for (const p of processed) claim.evidence.push(p.evidence);
}

/** Re-hash stored bytes to detect evidence tampering (§5.1). */
export function verifyEvidenceIntegrity(evidence: Evidence): boolean {
  try {
    return sha256Hex(readEvidence(evidence.fileId)) === evidence.sha256;
  } catch {
    return false;
  }
}

/** Type-guard for multipart requests in route handlers. */
export function filesFrom(req: Request): {
  photos: Express.Multer.File[] | undefined;
  bills: Express.Multer.File[] | undefined;
  idDocs: Express.Multer.File[] | undefined;
  registry?: Express.Multer.File[] | undefined;
  aadhaar?: Express.Multer.File[] | undefined;
  satellite?: Express.Multer.File[] | undefined;
  policy?: Express.Multer.File[] | undefined;
} {
  const f = (req as Request & { files?: Record<string, Express.Multer.File[]> }).files;
  return {
    photos: f?.photos,
    bills: f?.bills,
    idDocs: f?.idDocs,
    registry: f?.registry,
    aadhaar: f?.aadhaar,
    satellite: f?.satellite,
    policy: f?.policy,
  };
}
