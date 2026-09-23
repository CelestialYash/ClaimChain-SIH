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
 * Preprocess for OCR: grayscale + 3x upscale + normalize. Small embedded text
 * in field photos is unreadable to Tesseract at native size; this is standard
 * OCR preprocessing and dramatically improves recall on our 320px evidence.
 */
async function preprocess(image: Buffer): Promise<Buffer> {
  try {
    return await sharp(image)
      .resize({ width: 960, withoutEnlargement: false })
      .greyscale()
      .normalise()
      .png()
      .toBuffer();
  } catch {
    return image; // non-decodable → let tesseract fail and report
  }
}

export async function ocrText(image: Buffer): Promise<string> {
  try {
    if (isPdf(image)) return ''; // leptonica cannot read PDFs — and the async worker throw would kill the process
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

const POLICY_RE = /\bMH-\d{2}-\d{4}\b/i;
const AMOUNT_RE = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)|(?:claim amount:?\s*)([\d,]+)/i;
const NAME_LINE_RE = /(?:insured|claimant|name)\s*[:\-]\s*([A-Za-z]+(?:\s+[A-Za-z]+){0,1})/i;

/**
 * Extract claim-relevant fields from OCR text of a bill / ID document.
 * Deterministic parser over the deterministic synthetic documents.
 */
export function parsePolicyFields(text: string): PolicyFields {
  const t = text.replace(/\s+/g, ' ');
  const policyMatch = t.match(POLICY_RE);
  const amountMatch = t.match(AMOUNT_RE);
  const nameMatch = t.match(NAME_LINE_RE);

  const amountRaw = amountMatch?.[1] ?? amountMatch?.[2];
  const amount = amountRaw ? Number(amountRaw.replace(/,/g, '')) : null;

  let hits = 0;
  if (policyMatch) hits++;
  if (amount != null && Number.isFinite(amount)) hits++;
  if (nameMatch) hits++;

  return {
    policyNumber: policyMatch ? policyMatch[0].toUpperCase() : null,
    name: nameMatch ? nameMatch[1].trim() : null,
    amount: amount != null && Number.isFinite(amount) ? Math.round(amount) : null,
    confidence: hits / 3,
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
