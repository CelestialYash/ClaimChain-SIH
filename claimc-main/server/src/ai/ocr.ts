import { createWorker, type Worker } from 'tesseract.js';
import sharp from 'sharp';

/**
 * Tesseract OCR wrapper — in-process WASM worker, eng traineddata auto-downloads
 * (~11 MB) on first use and is cached by the tesseract.js runtime.
 * Falls back to empty text when the engine is unavailable so callers can
 * degrade gracefully (WARN confidence instead of a crash).
 */

let workerPromise: Promise<Worker> | null = null;
let workerPromiseHi: Promise<Worker> | null = null;
let initFailures = 0;
let initFailuresHi = 0;
const MAX_INIT_FAILURES = 2; // latch: stop retrying a broken/offline engine

async function getWorker(): Promise<Worker> {
  if (initFailures >= MAX_INIT_FAILURES) throw new Error('OCR engine disabled after repeated init failures');
  if (!workerPromise) {
    workerPromise = createWorker('eng').catch((err) => {
      workerPromise = null;
      initFailures++;
      if (initFailures === MAX_INIT_FAILURES) {
        console.warn('[ocr] engine disabled for this boot (init kept failing):', (err as Error).message);
      }
      throw err;
    });
  }
  return workerPromise;
}

/**
 * Preprocess for OCR: grayscale + 3x upscale + sharpen + normalize.
 * High-frequency noise suppression and contrast normalization significantly
 * improve Tesseract's character recognition on mobile phone photos and scans.
 */
async function preprocess(image: Buffer): Promise<Buffer> {
  try {
    return await sharp(image)
      .resize({ width: 1400, withoutEnlargement: false })
      .greyscale()
      .sharpen({ sigma: 1.2 })
      .normalise()
      .png()
      .toBuffer();
  } catch {
    return image; // non-decodable → let tesseract fail and report
  }
}

export async function ocrText(image: Buffer): Promise<string> {
  try {
    if (isPdf(image)) return ''; // leptonica cannot read PDFs — rasterize first
    const worker = await getWorker();
    const input = await preprocess(image);
    const { data } = await worker.recognize(input);
    return data.text ?? '';
  } catch (err) {
    if (initFailures < MAX_INIT_FAILURES) {
      console.warn('[ocr] recognize failed:', (err as Error).message);
    }
    return '';
  }
}

/** PDF magic-number sniff — protects the OCR workers from raw PDF bytes. */
function isPdf(buf: Buffer): boolean {
  return buf.length > 4 && buf.subarray(0, 5).toString('latin1') === '%PDF-';
}

/** Bilingual (English + Hindi Devanagari) worker for farmer documents. */
async function getWorkerHi(): Promise<Worker> {
  if (initFailuresHi >= MAX_INIT_FAILURES) throw new Error('OCR(hi) engine disabled after repeated init failures');
  if (!workerPromiseHi) {
    workerPromiseHi = createWorker('eng+hin', 1, { langPath: process.cwd() }).catch((err) => {
      workerPromiseHi = null;
      initFailuresHi++;
      if (initFailuresHi === MAX_INIT_FAILURES) {
        console.warn('[ocr] hindi engine disabled for this boot (init kept failing):', (err as Error).message);
      }
      throw err;
    });
  }
  return workerPromiseHi;
}

/**
 * OCR for farmer documents (registry / Aadhaar / policy papers): English +
 * Hindi. Uses the repo-root traineddata (eng auto-downloaded by tesseract.js,
 * hin committed alongside it). Falls back to English-only when the Hindi
 * engine cannot initialize — never crashes the pipeline.
 */
export async function ocrTextHi(image: Buffer): Promise<{ text: string; hindi: boolean }> {
  try {
    if (isPdf(image)) return { text: '', hindi: false }; // PDFs must be rasterized first (pdfimg.ts)
    const input = await preprocess(image);
    try {
      const worker = await getWorkerHi();
      const { data } = await worker.recognize(input);
      const text = data.text ?? '';
      return { text, hindi: /[\u0900-\u097F]/.test(text) };
    } catch {
      const worker = await getWorker(); // fallback: eng only
      const { data } = await worker.recognize(input);
      return { text: data.text ?? '', hindi: false };
    }
  } catch (err) {
    console.warn('[ocr] doc recognize failed:', (err as Error).message);
    return { text: '', hindi: false };
  }
}

export interface PolicyFields {
  policyNumber: string | null;
  name: string | null;
  amount: number | null;
  confidence: number; // 0..1 — how much of the expected structure was found
}

const POLICY_PATTERNS = [
  /\b(MH-\d{2}-\d{4})\b/i, // seed & demo policy
  /\b(PMFBY\/[A-Z0-9\/-]{4,28})\b/i, // PMFBY formats
  /\b(?:policy|pol|cover|cert(?:ificate)?)\s*(?:no\.?|num|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/-]{4,24})\b/i,
  /\b([A-Z]{2,5}[-\/]\d{2,4}[-\/][A-Z0-9\/-]{4,16})\b/i,
];

const AMOUNT_PATTERNS = [
  /(?:rs\.?|inr|₹|रू0?|रु)\s*([\d,]+(?:\.\d{1,2})?)/i,
  /(?:claim|bill|total|loss|net|insured|sum insured)\s*(?:amount|value|sum)?\s*[:\-]?\s*(?:rs\.?|inr|₹|रू)?\s*([\d,]+(?:\.\d{1,2})?)/i,
];

const NAME_PATTERNS = [
  /(?:insured|claimant|farmer|holder|beneficiary|नाम|क्रेता)\s*(?:name)?\s*[:\-]\s*([A-Za-z\u0900-\u097F]+(?:\s+[A-Za-z\u0900-\u097F]+){0,2})/i,
  /\b(?:shri|smt|mr|mrs)\.?\s+([A-Za-z\u0900-\u097F]+(?:\s+[A-Za-z\u0900-\u097F]+){1,2})/i,
  /(?:name|naam)\s*[:\-]\s*([A-Za-z]+(?:\s+[A-Za-z]+){0,2})/i,
];

/**
 * Extract claim-relevant fields from OCR text of a bill / ID document.
 * Matches standard Indian insurance policies, bills, and farmer documents.
 */
export function parsePolicyFields(text: string): PolicyFields {
  const t = text.replace(/\s+/g, ' ');

  let policyNumber: string | null = null;
  for (const re of POLICY_PATTERNS) {
    const m = t.match(re);
    if (m?.[1] || m?.[0]) {
      policyNumber = (m[1] ?? m[0]).trim().toUpperCase();
      break;
    }
  }

  let amount: number | null = null;
  for (const re of AMOUNT_PATTERNS) {
    const m = t.match(re);
    if (m?.[1]) {
      const parsed = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 10_000_000) {
        amount = Math.round(parsed);
        break;
      }
    }
  }

  let name: string | null = null;
  for (const re of NAME_PATTERNS) {
    const m = t.match(re);
    if (m?.[1]) {
      const candidate = m[1].trim();
      if (candidate.length >= 3 && !/^(total|amount|bill|rs|inr)$/i.test(candidate)) {
        name = candidate;
        break;
      }
    }
  }

  let hits = 0;
  if (policyNumber) hits++;
  if (amount != null) hits++;
  if (name) hits++;

  return {
    policyNumber,
    name,
    amount,
    confidence: Number((hits / 3).toFixed(2)),
  };
}

/** Terminate the shared worker (clean shutdown for tests/restarts). */
export async function closeOcr(): Promise<void> {
  if (workerPromise) {
    const w = await workerPromise.catch(() => null);
    await w?.terminate().catch(() => undefined);
    workerPromise = null;
  }
}
