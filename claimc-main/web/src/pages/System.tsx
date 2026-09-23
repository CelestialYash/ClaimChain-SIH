import { ArrowRight, Boxes, FileCheck2, FileText, Fingerprint, Layers, Lock, ScanSearch, Server, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, InnerPage } from '../components/ui';

/**
 * System — the architecture page. Explains the three deployables, the
 * request lifecycle, and why the design is tamper-evident by construction.
 */

const LAYERS = [
  {
    icon: FileText,
    name: 'Evidence layer',
    desc: 'Photos, bills and ID docs upload as multipart form-data. Bytes are content-addressed on disk by fileId; sha256, perceptual hash and EXIF are extracted server-side before anything is trusted.',
    chips: ['sha256', 'pHash (Hamming ≤ 6 = collision)', 'EXIF GPS/time/device/edit-tags', 'immutable addenda, never edits'],
  },
  {
    icon: ScanSearch,
    name: 'AI verification layer',
    desc: 'A deterministic 7-stage pipeline runs automatically after intake. Verdicts are computed from thresholds — no human, button, or prompt ever types an AI decision.',
    chips: ['EXIF integrity', 'pHash duplicate scan', 'Tesseract OCR', 'policy cross-check', 'CLIP damage + zero-shot', 'fraud rules', 'threshold decision'],
  },
  {
    icon: Layers,
    name: 'State & guard layer',
    desc: 'Claims live in a RAM store with write-through snapshots for restart survival. A server-side state machine whitelists every transition — flagged claims are payout-locked by rule (RULE ZERO).',
    chips: ['transition whitelist', 'flag = payout freeze', '≥20-char reviewed reasons', 'terminal-state locks'],
  },
  {
    icon: Server,
    name: 'Sealing layer',
    desc: 'Every accepted event is sealed on-chain: each recordHash embeds the previous one, so the trail is a hash chain. Verification replays the chain both off-chain and on the contract itself.',
    chips: ['ClaimAuditTrail.sol', 'owner-gated sealing', 'verifyTrail() → break index', 'Merkle inclusion proofs'],
  },
];

const FLOW = [
  { step: '01', title: 'Intake', desc: 'Multipart upload → sha256 + pHash + EXIF → genesis record sealed with evidence hashes.' },
  { step: '02', title: 'Verify', desc: '7 stages run in sequence, each emitting a hash-committed log entry with real timings.' },
  { step: '03', title: 'Decide', desc: 'Score + hard-fails map to APPROVED / FLAGGED / REJECTED. Flagged = payout-frozen.' },
  { step: '04', title: 'Review (if flagged)', desc: 'A human decides with a mandatory ≥20-char reason; the AI memory re-labels itself from that verdict.' },
  { step: '05', title: 'Pay & seal', desc: 'UPI ref is hashed into the final PAID record. The trail is complete and independently verifiable.' },
];

const GUARANTEES = [
  { icon: Lock, title: 'No verdicts by hand', desc: 'AI statuses are pipeline-only — the API returns 403 AI_VERDICTS_ARE_COMPUTED if a client tries.' },
  { icon: ShieldCheck, title: 'Flag = freeze', desc: 'Payout on a flagged claim returns 409 FLAGGED_LOCKED. The only exit is a reviewed human decision, sealed on-chain.' },
  { icon: Fingerprint, title: 'Evidence is immutable', desc: 'Late files are sealed ADDENDUM records. Re-verified bytes that mismatch their sealed hash auto-flag the claim.' },
  { icon: Boxes, title: 'Retro-edits break loudly', desc: 'Forging a historical record snaps verifyTrail() to the exact break index — off-chain and on-chain agree.' },
];

export default function SystemPage() {
  return (
    <InnerPage
      eyebrow="Architecture"
      title="One pipeline, three deployables, zero trust required."
      lead="ClaimChain is a React SPA, a Node API and a hash-chained Solidity audit trail. Each layer is independently testable; together they make every claim provable without trusting the operator."
    >
      {/* Layer stack */}
      <div className="mb-16 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {LAYERS.map((l) => (
          <Card key={l.name} className="p-6">
            <div className="mb-3 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-black/[0.04]">
                <l.icon className="h-5 w-5 text-black" />
              </span>
              <h3 className="text-lg font-medium text-black" style={{ letterSpacing: '-0.02em' }}>{l.name}</h3>
            </div>
            <p className="mb-4 text-sm leading-relaxed text-black/60">{l.desc}</p>
            <div className="flex flex-wrap gap-2">
              {l.chips.map((c) => (
                <span key={c} className="rounded-full border border-black/10 bg-[#F5F5F5] px-3 py-1 font-mono text-[10px] text-black/60">{c}</span>
              ))}
            </div>
  </Card>
        ))}
      </div>

      {/* Lifecycle */}
      <h2 className="mb-6 text-3xl font-medium text-black md:text-4xl" style={{ letterSpacing: '-0.03em' }}>
        Life of a claim
      </h2>
      <div className="mb-16 grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {FLOW.map((f, i) => (
          <Card key={f.step} className="relative p-5">
            <span className="font-mono text-[10px] font-semibold tracking-widest text-black/40">{f.step}</span>
            <h4 className="mb-1.5 mt-1 text-base font-medium text-black">{f.title}</h4>
            <p className="text-xs leading-relaxed text-black/60">{f.desc}</p>
            {i < FLOW.length - 1 && <ArrowRight className="absolute -right-3 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-black/20 lg:block" />}
          </Card>
        ))}
      </div>

      {/* Guarantees */}
      <h2 className="mb-6 text-3xl font-medium text-black md:text-4xl" style={{ letterSpacing: '-0.03em' }}>
        What the design guarantees
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {GUARANTEES.map((g) => (
          <Card key={g.title} className="p-5">
            <g.icon className="mb-3 h-5 w-5 text-black" />
            <h4 className="mb-1.5 text-base font-medium text-black">{g.title}</h4>
            <p className="text-xs leading-relaxed text-black/60">{g.desc}</p>
          </Card>
        ))}
      </div>

      <div className="mt-12 flex flex-wrap items-center gap-4">
        <Link to="/pipeline" className="inline-flex items-center gap-3 rounded-full bg-black py-2 pl-7 pr-2 text-sm font-medium text-white transition-colors hover:bg-gray-800">
          See the 7-stage pipeline
          <span className="rounded-full bg-white p-1.5"><ArrowRight className="h-4 w-4 text-black" /></span>
        </Link>
        <Link to="/integrity" className="inline-flex items-center gap-2 text-sm font-medium text-black/60 transition-colors hover:text-black">
          <FileCheck2 className="h-4 w-4" /> Or jump to integrity & tamper-evidence
        </Link>
      </div>
    </InnerPage>
  );
}
