import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, InnerPage } from '../components/ui';

/**
 * Pipeline — a deep dive into the deterministic 7-stage verification engine:
 * what each stage reads, what it emits, and the exact threshold math that
 * maps stage outcomes to verdicts.
 */

interface StageSpec {
  n: string;
  key: string;
  name: string;
  reads: string;
  does: string;
  pass: string;
  fail: string;
  tech: string[];
}

const STAGES: StageSpec[] = [
  {
    n: '01',
    key: 'EXIF_INTEGRITY',
    name: 'Photo metadata forensics',
    reads: 'EXIF blocks of every uploaded photo',
    does: 'Checks GPS presence, capture timestamps and editing-software signatures. Edited imagery is a hard fail — screenshots and Photoshop artifacts do not pass silently.',
    pass: 'Photos geotagged, timestamps consistent with submission',
    fail: 'Editing-software tag present → FAIL · missing GPS/timestamp → WARN',
    tech: ['exifr', 'software-tag scan', 'submission-skew check'],
  },
  {
    n: '02',
    key: 'DUPLICATE_PHASH',
    name: 'Perceptual duplicate scan',
    reads: 'pHash of every photo vs every other claim’s photos',
    does: 'Computes Hamming distance across the whole evidence corpus. A distance ≤ 6 to a foreign claim’s photo means reused imagery — the classic cross-district fraud.',
    pass: 'All photo hashes unique across the corpus',
    fail: 'Cross-claim collision (d ≤ 6) → FAIL · intra-claim duplicates → informational',
    tech: ['sharp-phash', '64-bit Hamming distance', 'cross-claim corpus'],
  },
  {
    n: '03',
    key: 'OCR_EXTRACT',
    name: 'Document reading',
    reads: 'Bill and ID document pixels (grayscale, 3× upscale)',
    does: 'Extracts policy number, claimant name and amounts, each with a confidence score. No documents → stage is informational, not a failure.',
    pass: 'Fields found with confidence reported',
    fail: 'No readable text → WARN (downgrades the score)',
    tech: ['tesseract.js (eng)', '3× upscale preprocessing', 'per-field confidence'],
  },
  {
    n: '04',
    key: 'POLICY_MATCH',
    name: 'Policy cross-check',
    reads: 'OCR fields vs the policy table and claim metadata',
    does: 'Validates the claimant name, the amount against the policy limit, and whether the loss type is even covered. A bill far above the requested amount is also flagged.',
    pass: 'Name / limit / loss type within cover',
    fail: 'Unknown policy, name mismatch, amount over limit → FAIL',
    tech: ['in-memory policy table', 'limit + coverage rules'],
  },
  {
    n: '05',
    key: 'DAMAGE_ASSESS',
    name: 'Visual damage scoring · the AI stage',
    reads: 'Photo pixels via OCR keywords, CLIP embeddings, trained k-NN memory, EXIF GPS',
    does: 'Four signals combine: loss-type vocabulary over real OCR of the photo, a k-NN vote against the trained fraud memory of past decided claims, a zero-shot CLIP check for staged imagery (screens, re-photographed prints) and for AI-generated content, plus a loss-type relevance check — does this imagery depict the claimed loss at all? Random photos and synthetic scenes fail here.',
    pass: 'Damage vocabulary found · memory and zero-shot agree the imagery looks genuine and on-topic',
    fail: 'k-NN ≥ 60% fraud neighbors → FAIL · staged ≥ 75 → FAIL · AI-generated ≥ 88 → FAIL · no damage keyword AND relevance < 50 → FAIL (random imagery) · 55–78 band → WARN',
    tech: ['CLIP ViT-B/32 (local ONNX)', 'k-NN fraud memory (k=5)', 'staged + AI-gen zero-shot prompts', 'loss-type relevance'],
  },
  {
    n: '06',
    key: 'FRAUD_RULES',
    name: 'Deterministic fraud rules',
    reads: 'All signals from stages 1–5 + photo GPS vs the district table',
    does: 'Rule engine over the accumulated evidence: duplicate evidence across districts (R2), shared sha256 bytes between claims, EXIF edit signatures, and GPS provenance (R4) — a photo geotagged outside the service area or in a district not covered for the claimed loss type is named and failed. Every trigger is an auditable rule.',
    pass: 'No rule triggered',
    fail: 'Any rule fires with a named reason (R2 duplicate · R4 gps-out-of-area / district-mismatch / gps-unresolved)',
    tech: ['named rules R2/R3/R4', 'cross-claim byte comparison', 'offline district resolver (haversine)'],
  },
  {
    n: '07',
    key: 'DECISION',
    name: 'Threshold decision · computed, never typed',
    reads: 'The full stage log',
    does: 'Score math: start at 100, −25 per FAIL, −12 per WARN. Any failing stage — damage assessment included — forces at least a flag, so unrelated imagery can never auto-approve. The decision — and a plain-language explanation in English or Hindi — is sealed on-chain with the stage-log digest.',
    pass: 'No hard fails and score ≥ 50 → AI_APPROVED',
    fail: 'Score < 20 → AI_REJECTED · everything else → AI_FLAGGED (payout-locked)',
    tech: ['deterministic thresholds', 'EN/हिंदी explanation', 'sha256 digest sealed on-chain'],
  },
];

export default function PipelinePage() {
  return (
    <InnerPage
      eyebrow="AI verification"
      title="Seven stages. One verdict. No buttons."
      lead="The pipeline runs automatically after every submission and re-runs when evidence is added. Every stage emits a hash-committed log entry with real wall-clock timings — the AI shows its work, and the work is sealed."
    >
      <div className="mb-14 space-y-4">
        {STAGES.map((s) => (
          <Card key={s.key} className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <span className="font-mono text-2xl font-semibold text-black/20" style={{ letterSpacing: '-0.04em' }}>{s.n}</span>
                <div>
                  <h3 className="text-lg font-medium text-black" style={{ letterSpacing: '-0.02em' }}>{s.name}</h3>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-black/40">{s.key}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {s.tech.map((t) => (
                  <span key={t} className="rounded-full border border-black/10 bg-[#F5F5F5] px-3 py-1 font-mono text-[10px] text-black/60">{t}</span>
                ))}
              </div>
            </div>

            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-black/70">{s.does}</p>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-xl bg-[#F5F5F5] px-4 py-3">
                <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-black/40"><Info className="h-3 w-3" /> Reads</p>
                <p className="text-xs text-black/70">{s.reads}</p>
              </div>
              <div className="rounded-xl bg-[#10b981]/5 px-4 py-3">
                <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#0b7a5c]"><CircleCheck className="h-3 w-3" /> Pass</p>
                <p className="text-xs text-black/70">{s.pass}</p>
              </div>
              <div className="rounded-xl bg-[#f59e0b]/5 px-4 py-3">
                <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#b45309]"><CircleAlert className="h-3 w-3" /> Fail</p>
                <p className="text-xs text-black/70">{s.fail}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-6">
        <h3 className="mb-2 text-xl font-medium text-black" style={{ letterSpacing: '-0.02em' }}>Why deterministic beats “smart”</h3>
        <p className="max-w-3xl text-sm leading-relaxed text-black/60">
          Same evidence in, same verdict out — every time, on every machine. That property is what makes the sealed decision meaningful: an auditor can replay the exact stage log from the committed digest. When a better model arrives, only stage 5’s engine swaps; the log format, thresholds and sealing never change.
        </p>
        <Link to="/console" className="mt-4 inline-flex items-center gap-3 rounded-full bg-black py-2 pl-7 pr-2 text-sm font-medium text-white transition-colors hover:bg-gray-800">
          Watch it run live
          <span className="rounded-full bg-white p-1.5"><CircleCheck className="h-4 w-4 text-black" /></span>
        </Link>
      </Card>
    </InnerPage>
  );
}
