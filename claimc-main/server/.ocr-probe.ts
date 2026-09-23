import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { ocrText } from './src/ai/ocr.js';
for (const f of process.argv.slice(2)) {
  const text = await ocrText(readFileSync(f));
  console.log(`\n=== ${f} (${text.length} chars) ===`);
  console.log(text.slice(0, 900).replace(/\n{2,}/g, '\n').trim());
}
process.exit(0);
