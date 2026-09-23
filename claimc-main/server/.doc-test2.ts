import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { pdfToText } from './src/ai/pdfimg.js';
import { ocrTextHi } from './src/ai/ocr.js';
import { parseRegistry, parseAadhaar, parsePolicyPaper, crossVerifyIdentity } from './src/ai/docs.js';

const regText = await pdfToText(readFileSync('../samples/registry.pdf'), async (b) => (await ocrTextHi(b)).text, 2);
const reg = parseRegistry(regText);
console.log('registry:', JSON.stringify(reg));

const aadhaarText = `भारत सरकार
GOVERNMENT OF INDIA
रोशन पांडेय
Roshan Pandey
DoB: 03/01/1995
MALE
5522 6616 4533`;
const aad = parseAadhaar(aadhaarText);
console.log('aadhaar:', JSON.stringify(aad));

const policyText = `PMFBY INSURANCE POLICY
PROPOSAL FORM
Policy No: UP/2024/FLO/04512
Name of Insured: Roshan Pandey
Sum Insured: 250000
Season: Kharif 2024, Cluster: Ballia
Coverage: Flood, Drought, Pests`;
console.log('policy:', JSON.stringify(parsePolicyPaper(policyText)));

console.log('\nCROSS ( Aadhaar ↔ real registry):', JSON.stringify(crossVerifyIdentity(aad, regText), null, 1));
const wrong = crossVerifyIdentity({ ...aad, name: 'Suresh Yadav', nameDevanagari: 'सुरेश यादव' }, regText);
console.log('NEGATIVE (Suresh Yadav):', JSON.stringify(wrong, null, 1));
process.exit(0);
