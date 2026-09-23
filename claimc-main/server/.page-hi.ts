import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { pdf } from 'pdf-to-img';
import { createWorker } from 'tesseract.js';
const doc = await pdf(readFileSync('../samples/registry.pdf'), { scale: 2 });
let i = 0;
for await (const png of doc) {
  i++;
  if (i === 2) continue; // page 2 test
  const worker = await createWorker('eng+hin');
  const { data } = await worker.recognize(png as unknown as Buffer);
  await worker.terminate();
  console.log(`=== registry page ${i} (eng+hin) ===`);
  console.log(data.text.slice(0, 1100).replace(/\n{2,}/g, '\n').trim());
  break;
}
process.exit(0);
