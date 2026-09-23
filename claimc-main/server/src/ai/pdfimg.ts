import { pdf } from 'pdf-to-img';

/**
 * PDF → page images (rasterization for OCR). Uses pdf-to-img (pdfjs under the
 * hood); each yielded image IS a PNG buffer — directly consumable by
 * tesseract.js and sharp. Deterministic raster at fixed scale.
 */

export async function pdfPages(buf: Buffer, maxPages = 3, scale = 2): Promise<Buffer[]> {
  const doc = await pdf(buf, { scale });
  const pages: Buffer[] = [];
  for await (const png of doc) {
    pages.push(png as unknown as Buffer);
    if (pages.length >= maxPages) break;
  }
  return pages;
}

/** Rasterize up to maxPages and OCR them, joining page texts. */
export async function pdfToText(
  buf: Buffer,
  ocrFn: (img: Buffer) => Promise<string>,
  maxPages = 3
): Promise<string> {
  const pages = await pdfPages(buf, maxPages);
  const texts: string[] = [];
  for (const page of pages) {
    try {
      texts.push(await ocrFn(page));
    } catch {
      texts.push('');
    }
  }
  return texts.join('\n').trim();
}
