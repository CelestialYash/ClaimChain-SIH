import { useQuery } from '@tanstack/react-query';
import { BrainCircuit, GraduationCap, RefreshCw, Save, UserCheck } from 'lucide-react';
import { api } from '../lib/api';
import { Card, Chip, InnerPage } from '../components/ui';

/**
 * Memory — the trained fraud memory, explained and live: the page polls the
 * real /api/fraud-memory endpoint and shows how every decided claim makes
 * the next verdict smarter.
 */

const SOURCES = [
  {
    icon: BrainCircuit,
    title: 'Sealed verdicts (pipeline)',
    desc: 'Every computed AI decision enrolls that claim’s photo embeddings under its verdict — genuine claims enrich the “clean” side, caught fraud enriches the “fraud” side.',
  },
  {
    icon: UserCheck,
    title: 'Human review (ground truth)',
    desc: 'When an officer approves or rejects a flagged claim, the memory re-labels that claim’s embeddings. Humans are the ground truth the model defers to.',
  },
  {
    icon: Save,
    title: 'Persisted on disk',
    desc: 'The memory is a JSON snapshot (.fraud-memory.json, capped at 500 embeddings per label) — it survives restarts and grows with the platform.',
  },
];

export default function MemoryPage() {
  const memory = useQuery({ queryKey: ['memory'], queryFn: api.fraudMemory, refetchInterval: 5000, retry: 1 });
  const claims = useQuery({ queryKey: ['claims'], queryFn: api.listClaims, refetchInterval: 5000, retry: 1 });

  const decided = (claims.data ?? []).filter((c) => !['SUBMITTED'].includes(c.status));
  const fraudShare = memory.data && memory.data.size > 0 ? Math.round((memory.data.fraud / memory.data.size) * 100) : 0;

  return (
    <InnerPage
      eyebrow="Trained fraud memory"
      title="Every decided claim makes the next one smarter."
      lead="ClaimChain’s stage-5 engine scores new photos against a CLIP embedding memory of past decisions — a k-nearest-neighbor vote with cosine similarity. No gradient training, no dataset babysitting; the platform learns the way an investigator does: by remembering cases."
    >
      {/* Live stats */}
      <div className="mb-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Trained embeddings</p>
          <p className="mt-1 font-mono text-3xl font-semibold text-black">{memory.data?.size ?? '—'}</p>
          <p className="mt-1 text-xs text-black/50">{memory.data?.file ?? 'fraud memory'}</p>
        </Card>
        <Card className="p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Genuine / Fraud</p>
          <p className="mt-1 font-mono text-3xl font-semibold text-black">
            {memory.data ? `${memory.data.genuine}` : '—'}<span className="text-black/30"> / </span>{memory.data ? `${memory.data.fraud}` : ''}
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/10">
            <div className="h-full rounded-full bg-[#ef4444]/70" style={{ width: `${fraudShare}%` }} />
          </div>
        </Card>
        <Card className="p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Decided claims in store</p>
          <p className="mt-1 font-mono text-3xl font-semibold text-black">{decided.length}</p>
          <p className="mt-1 text-xs text-black/50">live from /api/claims</p>
        </Card>
        <Card className="p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Engine</p>
          <p className="mt-2 text-sm font-medium leading-snug text-black">{memory.data?.engine ?? 'CLIP ViT-B/32 (Xenova ONNX, local CPU)'}</p>
          <p className="mt-1 text-xs text-black/50">free · offline · no API keys</p>
        </Card>
      </div>

      {/* How it learns */}
      <h2 className="mb-6 text-3xl font-medium text-black md:text-4xl" style={{ letterSpacing: '-0.03em' }}>How the memory learns</h2>
      <div className="mb-14 grid grid-cols-1 gap-4 md:grid-cols-3">
        {SOURCES.map((s) => (
          <Card key={s.title} className="p-5">
            <s.icon className="mb-3 h-5 w-5 text-black" />
            <h4 className="mb-1.5 text-base font-medium text-black">{s.title}</h4>
            <p className="text-xs leading-relaxed text-black/60">{s.desc}</p>
          </Card>
        ))}
      </div>

      {/* Scoring flow */}
      <div className="mb-14 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <h3 className="mb-3 text-xl font-medium text-black" style={{ letterSpacing: '-0.02em' }}>How a new photo is scored</h3>
          <ol className="space-y-3 text-sm text-black/70">
            <li className="flex gap-3"><span className="font-mono text-xs font-semibold text-black/40">1.</span> CLIP embeds the photo into a 512-dimension vector — same bytes → same vector, always.</li>
            <li className="flex gap-3"><span className="font-mono text-xs font-semibold text-black/40">2.</span> Cosine similarity finds the k=5 nearest decided claims in memory.</li>
            <li className="flex gap-3"><span className="font-mono text-xs font-semibold text-black/40">3.</span> If ≥ 60% of neighbors were fraudulent, stage 5 fails the claim — the trained memory can only downgrade a verdict, never upgrade one.</li>
            <li className="flex gap-3"><span className="font-mono text-xs font-semibold text-black/40">4.</span> The matched cases surface in the console as “similar past cases”, so the reasoning is visible.</li>
          </ol>
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-[#F5F5F5] px-4 py-3 text-xs text-black/60">
            <GraduationCap className="h-4 w-4" /> Zero-shot CLIP prompts add a second, training-free signal for staged imagery (screens, re-photographed prints).
          </div>
        </Card>
        <Card className="p-6">
          <h3 className="mb-3 text-xl font-medium text-black" style={{ letterSpacing: '-0.02em' }}>Run it yourself</h3>
          <div className="space-y-2 font-mono text-xs">
            <div className="rounded-xl bg-[#0a0a0a] px-4 py-3 text-white/90">$ npm run train <span className="text-white/40">— in server/</span></div>
            <div className="rounded-xl bg-[#F5F5F5] px-4 py-3 text-black/70">[clip] Xenova/clip-vit-base-patch32 ready in 1.2s (cached after first run)</div>
            <div className="rounded-xl bg-[#F5F5F5] px-4 py-3 text-black/70">[train] boot pass: decided claims enrolled · memory persisted</div>
            <div className="rounded-xl bg-[#F5F5F5] px-4 py-3 text-black/70">Training complete: {'{'} size: N, genuine: N, fraud: N {'}'}</div>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-[#10b981]/5 px-4 py-3 text-xs text-[#0b7a5c]">
            <RefreshCw className="h-4 w-4" /> Re-train anytime — enrollment is idempotent and the dashboard picks up the new size automatically.
          </div>
          <div className="mt-4">
            <Chip tone="ai">local CPU · no GPU · no cloud</Chip>
          </div>
        </Card>
      </div>
    </InnerPage>
  );
}
