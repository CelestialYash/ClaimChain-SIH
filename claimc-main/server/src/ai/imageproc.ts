import { createHash } from 'node:crypto';
import sharp from 'sharp';
import * as sharpPhash from 'sharp-phash';
import exifr from 'exifr';

/** sharp-phash's subpath typings break under TS7 NodeNext — bind the runtime default (with interop fallback). */
const phashModule = sharpPhash as unknown as {
  default?: (input?: Parameters<typeof sharp>[0]) => Promise<string>;
};
const phash = phashModule.default ?? (sharpPhash as unknown as (i?: Parameters<typeof sharp>[0]) => Promise<string>);

/** sha256 digest (0x-hex) of raw file bytes — content-addresses evidence. */
export function sha256Hex(buf: Buffer): string {
  return '0x' + createHash('sha256').update(buf).digest('hex');
}

/** 64-bit perceptual hash (64-char 01 string); null for unreadable images. */
export async function computePHash(buf: Buffer): Promise<string | null> {
  try {
    return await phash(buf);
  } catch {
    return null;
  }
}

/**
 * Hamming distance between two 64-char pHash strings (0/1 alphabet —
 * char inequality ≡ bit inequality, so this is the exact bit distance).
 */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

export interface ExifInfo {
  present: boolean;
  gps?: { lat: number; lon: number };
  takenAt?: string;
  device?: string;
  software?: string;
  width?: number;
  height?: number;
}

/** Extract EXIF (GPS, timestamp, device, editing-software signature). */
export async function extractExif(buf: Buffer): Promise<ExifInfo> {
  const out: ExifInfo = { present: false };
  try {
    const meta = (await exifr.parse(buf)) as Record<string, unknown> | undefined;
    if (!meta) return out;
    out.present = true;

    const lat = meta.latitude as number | undefined;
    const lon = meta.longitude as number | undefined;
    if (typeof lat === 'number' && typeof lon === 'number') out.gps = { lat, lon };

    const dt = meta.DateTimeOriginal ?? meta.DateTime ?? meta.CreateDate;
    if (dt instanceof Date && !Number.isNaN(dt.getTime())) out.takenAt = dt.toISOString();

    const make = meta.Make as string | undefined;
    const model = meta.Model as string | undefined;
    if (make || model) out.device = [make, model].filter(Boolean).join(' ');

    if (typeof meta.Software === 'string') out.software = meta.Software;
  } catch {
    /* no EXIF / unsupported container — stays present:false */
  }
  // Dimensions come from the decoded image, not EXIF.
  try {
    const img = sharp(buf);
    const m = await img.metadata();
    out.width = m.width;
    out.height = m.height;
  } catch {
    /* not a decodable image */
  }
  return out;
}
