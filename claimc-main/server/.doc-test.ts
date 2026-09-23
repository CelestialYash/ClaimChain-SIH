import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { pdfToText } from './src/ai/pdfimg.js';
import { ocrTextHi } from './src/ai/ocr.js';
import { transliterate, nameMatch } from './src/ai/translit.js';

const regText = await pdfToText(readFileSync('../samples/registry.pdf'), async (b) => (await ocrTextHi(b)).text, 3);
console.log('=== RAW REGISTRY OCR (first 2200 chars) ===');
console.log(regText.slice(0, 2200));
console.log('\n=== TRANSLIT of the whole text (first 900 chars) ===');
console.log(transliterate(regText).slice(0, 900));
console.log('\n=== nameMatch sanity ===');
console.log('roshan vs रोशन:', nameMatch('Roshan Pandey', 'रोशन पांडेय'));
process.exit(0);
