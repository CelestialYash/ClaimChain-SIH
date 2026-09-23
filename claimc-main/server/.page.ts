import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { pdf } from 'pdf-to-img';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
const doc = await pdf(readFileSync(process.argv[2]), { scale: 2 });
let i = 0;
for await (const png of doc) {
  i++;
  const image = await loadImage(png as unknown as Buffer);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  const worker = await createWorker('eng');
  const { data } = await worker.recognize(canvas.toBuffer('image/png'));
  await worker.terminate();
  console.log(`=== ${process.argv[2]} page ${i} ===`);
  console.log(data.text.slice(0, 1500).replace(/\n{2,}/g, '\n').trim());
  if (i >= (Number(process.argv[3]) || 1)) break;
}
process.exit(0);
