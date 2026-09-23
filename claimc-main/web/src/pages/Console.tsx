import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Ban,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Download,
  FileText,
  Image as ImageIcon,
  Info,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { LogoIcon } from '../components/LogoIcon';
import {
  api,
  inr,
  short,
  STATUS_META,
  type Claim,
  type ClaimStatus,
  type LossType,
  type StageLog,
} from '../lib/api';

/**
 * ClaimChain Console — the working claims dashboard in the Halo fintech
 * language: #F5F5F5 canvas, TT Norms Pro, black pills, white cards with
 * hairline borders. Every control maps to a REAL guarded endpoint:
 * verdicts arrive only from the pipeline; flagged claims lock payout;
 * the tamper demo forges storage and watches the chain break.
 */

const LOSS_TYPES: Array<{ id: LossType; label: string; hint: string }> = [
  { id: 'flood', label: 'Flood', hint: 'waterlogged fields' },
  { id: 'drought', label: 'Drought', hint: 'parched crops' },
  { id: 'livestock', label: 'Livestock', hint: 'injured or lost animals' },
];

const TONE_CLASS: Record<string, string> = {
  ok: 'bg-[#10b981]/10 text-[#0b7a5c] border-[#10b981]/30',
  ai: 'bg-[#06b6d4]/10 text-[#0e7490] border-[#06b6d4]/30',
  warn: 'bg-[#f59e0b]/10 text-[#b45309] border-[#f59e0b]/30',
  bad: 'bg-[#ef4444]/10 text-[#b91c1c] border-[#ef4444]/30',
  muted: 'bg-black/5 text-black/50 border-black/10',
};

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${TONE_CLASS[tone] ?? TONE_CLASS.muted}`}>
      {children}
    </span>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-black/10 bg-white ${className}`}>{children}</div>;
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-black/10 px-5 py-3">
      <h2 className="text-sm font-medium tracking-tight text-black" style={{ letterSpacing: '-0.01em' }}>
        {children}
      </h2>
      {right}
    </div>
  );
}

function StageIcon({ result }: { result: StageLog['result'] }) {
  const cls = 'h-4 w-4';
  switch (result) {
    case 'PASS':
      return <CircleCheck className={`${cls} text-[#10b981]`} />;
    case 'FAIL':
      return <CircleAlert className={`${cls} text-[#ef4444]`} />;
    case 'WARN':
      return <CircleAlert className={`${cls} text-[#f59e0b]`} />;
    case 'INFO':
      return <Info className={`${cls} text-black/40`} />;
    case 'AI_APPROVED':
      return <BadgeCheck className={`${cls} text-[#10b981]`} />;
    case 'AI_FLAGGED':
      return <CircleAlert className={`${cls} text-[#f59e0b]`} />;
    default:
      return <Ban className={`${cls} text-[#ef4444]`} />;
  }
}

// ---------------------------------------------------------------------------
// Intake form — real multipart upload (photos required 1–6)
// ---------------------------------------------------------------------------

function IntakeForm({ onCreated }: { onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('Ramesh Kumar');
  const [lossType, setLossType] = useState<LossType>('flood');
  const [amount, setAmount] = useState(6500);
  const [photos, setPhotos] = useState<File[]>([]);
  const [bills, setBills] = useState<File[]>([]);
  const [idDocs, setIdDocs] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  // Farmer-document slots (one upload each, sample image on every card)
  const [registry, setRegistry] = useState<File[]>([]);
  const [aadhaar, setAadhaar] = useState<File[]>([]);
  const [satellite, setSatellite] = useState<File[]>([]);
  const [policy, setPolicy] = useState<File[]>([]);
  const [destructionPct, setDestructionPct] = useState<number | ''>('');
  const photoRef = useRef<HTMLInputElement>(null);
  const billRef = useRef<HTMLInputElement>(null);
  const idRef = useRef<HTMLInputElement>(null);
  const regRef = useRef<HTMLInputElement>(null);
  const aadhaarRef = useRef<HTMLInputElement>(null);
  const satRef = useRef<HTMLInputElement>(null);
  const policyRef = useRef<HTMLInputElement>(null);

  const setFiles = (setter: (f: File[]) => void, prevSetter: (p: string[]) => void, max: number) => (list: FileList | null) => {
    const files = Array.from(list ?? []).slice(0, max);
    setter(files);
    prevSetter(files.map((f) => URL.createObjectURL(f)));
  };

  const create = useMutation({
    mutationFn: () =>
      api.createClaim({
        claimantName: name,
        lossType,
        amountRequested: amount,
        photos,
        bills,
        idDocs,
        registry,
        aadhaar,
        satellite,
        policy,
        ...(destructionPct === '' ? {} : { destructionPctClaimed: Number(destructionPct) }),
      }),
    onSuccess: (r) => {
      setPhotos([]);
      setBills([]);
      setIdDocs([]);
      setRegistry([]);
      setAadhaar([]);
      setSatellite([]);
      setPolicy([]);
      setDestructionPct('');
      setPreviews([]);
      qc.invalidateQueries({ queryKey: ['claims'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['health'] });
      onCreated(r.claim.id);
    },
  });

  const pick = (kind: 'photos' | 'bills' | 'idDocs' | 'registry' | 'aadhaar' | 'satellite' | 'policy') => {
    const ref =
      kind === 'photos' ? photoRef
      : kind === 'bills' ? billRef
      : kind === 'idDocs' ? idRef
      : kind === 'registry' ? regRef
      : kind === 'aadhaar' ? aadhaarRef
      : kind === 'satellite' ? satRef
      : policyRef;
    ref.current?.click();
  };

  return (
    <Card>
      <SectionTitle>New claim intake</SectionTitle>
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-3 gap-2">
          {LOSS_TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => setLossType(t.id)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                lossType === t.id ? 'border-black bg-black/[0.04]' : 'border-black/10 hover:border-black/30'
              }`}
            >
              <p className="text-sm font-medium text-black">{t.label}</p>
              <p className="text-[11px] text-black/50">{t.hint}</p>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-black/50">Claimant</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-[#F5F5F5] px-3 py-2 text-sm text-black outline-none focus:border-black"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-black/50">Amount (₹)</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full rounded-xl border border-black/10 bg-[#F5F5F5] px-3 py-2 text-sm text-black outline-none focus:border-black"
            />
          </label>
        </div>

        {/* Uploads: photos + farmer documents (one card per document role) */}
        <input ref={photoRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => setFiles(setPhotos, setPreviews, 6)(e.target.files)} />
        <input ref={billRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => setFiles(setBills, () => {}, 3)(e.target.files)} />
        <input ref={idRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => setFiles(setIdDocs, () => {}, 2)(e.target.files)} />
        <input ref={regRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => setFiles(setRegistry, () => {}, 2)(e.target.files)} />
        <input ref={aadhaarRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => setFiles(setAadhaar, () => {}, 2)(e.target.files)} />
        <input ref={satRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => setFiles(setSatellite, () => {}, 2)(e.target.files)} />
        <input ref={policyRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => setFiles(setPolicy, () => {}, 2)(e.target.files)} />

        <button
          onClick={() => pick('photos')}
          className={`flex w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-6 transition-colors ${
            photos.length > 0
              ? 'border-[#10b981]/50 bg-[#10b981]/[0.04] hover:border-[#10b981]'
              : 'border-black/25 bg-[#F5F5F5] hover:border-black/50'
          }`}
        >
          <span className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-black/50" />
            {photos.length > 0 && (
              <span className="rounded-full bg-[#10b981] px-2 py-0.5 text-[9px] font-bold text-white">✓ {photos.length}</span>
            )}
          </span>
          <span className="text-sm font-medium text-black">
            Upload damage photos
            {photos.length === 0 && (
              <span className="ml-2 rounded-full bg-[#ef4444]/10 px-2 py-0.5 align-middle text-[9px] font-bold uppercase tracking-widest text-[#b91c1c]">
                required
              </span>
            )}
          </span>
          <span className="text-[11px] text-black/50">
            {photos.length > 0
              ? `${photos.length} damage photo(s) ready · tap to replace`
              : '1–6 images · EXIF + perceptual hash extracted server-side'}
          </span>
        </button>

        {previews.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {previews.map((p, i) => (
              <img key={i} src={p} alt={`upload ${i + 1}`} className="h-16 w-16 rounded-lg border border-black/10 object-cover" />
            ))}
          </div>
        )}

        {/* Farmer documents — separate column per document, sample image on each */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-black/50">Farmer documents · किसान दस्तावेज़</p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: 'registry', label: 'Registry · रजिस्ट्री', hint: 'Land record, Hindi/English', sample: '/samples/registry.svg', files: registry, ref: regRef },
                { id: 'aadhaar', label: 'Aadhaar · आधार', hint: 'Name card (front)', sample: '/samples/aadhaar.svg', files: aadhaar, ref: aadhaarRef },
                { id: 'satellite', label: 'Satellite · उपग्रह', hint: 'Geo-tagged field image', sample: '/samples/satellite.svg', files: satellite, ref: satRef },
                { id: 'policy', label: 'Policy · पॉलिसी', hint: 'Insurance paper', sample: '/samples/policy.svg', files: policy, ref: policyRef },
              ] as const
            ).map((d) => (
              <button
                key={d.id}
                onClick={() => d.ref.current?.click()}
                className={`group overflow-hidden rounded-xl border text-left transition-colors ${
                  d.files.length > 0 ? 'border-[#10b981] bg-[#10b981]/[0.04]' : 'border-black/10 hover:border-black/40'
                }`}
              >
                <div className="relative">
                  <img src={d.sample} alt={`${d.label} sample`} className="h-24 w-full object-cover" />
                  {d.files.length > 0 && (
                    <span className="absolute right-1.5 top-1.5 rounded-full bg-[#10b981] px-2 py-0.5 text-[9px] font-bold text-white">✓ {d.files.length}</span>
                  )}
                </div>
                <div className="px-2.5 py-2">
                  <p className="text-[11px] font-semibold text-black">{d.label}</p>
                  <p className="truncate text-[9px] text-black/45" title={d.files.length > 0 ? d.files.map((f) => f.name).join(', ') : d.hint}>
                    {d.files.length > 0 ? d.files.map((f) => f.name).join(', ') : d.hint}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Farmer-stated destruction % (R5 cross-check vs satellite) */}
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-black/50">Stated destruction % (optional)</span>
          <input
            type="number"
            min={0}
            max={100}
            value={destructionPct}
            onChange={(e) => setDestructionPct(e.target.value === '' ? '' : Math.min(100, Math.max(0, Number(e.target.value))))}
            placeholder="e.g. 70 — AI cross-checks this vs the satellite image"
            className="w-full rounded-xl border border-black/10 bg-[#F5F5F5] px-3 py-2 text-sm text-black outline-none focus:border-black"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { kind: 'bills', label: 'Bills', max: 3, files: bills },
              { kind: 'idDocs', label: 'ID / policy', max: 2, files: idDocs },
            ] as const
          ).map((d) => (
            <button
              key={d.kind}
              onClick={() => pick(d.kind)}
              className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                d.files.length > 0
                  ? 'border-[#10b981]/40 bg-[#10b981]/[0.05] text-[#0b7a5c]'
                  : 'border-black/10 text-black/70 hover:border-black/30'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              {d.label} · {d.files.length > 0 ? `✓ ${d.files.length} added` : `optional (0–${d.max})`}
            </button>
          ))}
        </div>
        {(bills.length > 0 || idDocs.length > 0) && (
          <p className="text-[11px] text-black/50">
            {[...bills, ...idDocs].map((f) => f.name).join(' · ')}
          </p>
        )}

        <p className="text-center text-[10px] text-black/40">
          Damage photo is mandatory — bills, ID and farmer documents are optional extras.
        </p>

        <button
          disabled={create.isPending || !name.trim() || photos.length === 0}
          onClick={() => create.mutate()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-black py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-gray-800 disabled:opacity-40"
        >
          {create.isPending ? 'Sealing genesis record…' : photos.length === 0 ? 'Add at least 1 damage photo (above)' : 'Submit & verify'}
          {!create.isPending && <ArrowRight className="h-4 w-4" />}
        </button>
        {create.isError && <p className="text-xs text-[#b91c1c]">{(create.error as Error).message}</p>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Verification stepper — the live 7-stage pipeline
// ---------------------------------------------------------------------------

function PipelineStepper({ claimId }: { claimId: string }) {
  const [lang, setLang] = useState<'en' | 'hi'>('en');
  const ver = useQuery({
    queryKey: ['verification', claimId, lang],
    queryFn: () => api.verification(claimId, lang),
    refetchInterval: (q) => (q.state.data?.status === 'COMPLETE' ? false : 2500),
  });

  const run = ver.data?.verification ?? null;
  const running = ver.data?.status !== 'COMPLETE';

  return (
    <Card>
      <SectionTitle
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}
              className="rounded-full border border-black/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-black/60 transition-colors hover:border-black/40"
            >
              {lang === 'en' ? 'EN' : 'हिंदी'}
            </button>
            {run && <Chip tone={run.verdict === 'AI_APPROVED' ? 'ok' : run.verdict === 'AI_FLAGGED' ? 'warn' : 'bad'}>{run.verdict.replace('AI_', 'AI ')}</Chip>}
          </div>
        }
      >
        AI verification pipeline
      </SectionTitle>
      <div className="p-5">
        {!run && (
          <div className="flex items-center gap-3 py-6 text-sm text-black/60">
            <CircleDashed className="h-4 w-4 animate-spin" />
            {running ? 'Pipeline running — stages appear live…' : 'No verification yet.'}
          </div>
        )}
        {run && (
          <div className="space-y-3">
            <div className="space-y-2">
              {run.stages.map((s) => (
                <div key={s.stage} className="flex items-start gap-3 rounded-xl bg-[#F5F5F5] px-4 py-2.5">
                  <span className="mt-0.5"><StageIcon result={s.result} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-black/70">{s.stage.replace('_', ' ')}</span>
                      <span className="font-mono text-[10px] text-black/40">{s.ms}ms</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-black/60" title={s.details}>{s.details}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-black/10 p-4">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-black/50">Why · score {run.score}/100 · {run.durationMs}ms</p>
              <p className="whitespace-pre-line text-sm leading-relaxed text-black/80">{run.explanation}</p>
            </div>

            {run.docSummary && (run.docSummary.registry.found || run.docSummary.aadhaar.found || run.docSummary.policy.found || run.docSummary.satellite.found) && (
              <div className="rounded-xl border border-black/10 p-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-black/50">Document intelligence · दस्तावेज़ जाँच</p>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      run.docSummary.registry.found && {
                        ok: true,
                        title: 'Registry',
                        body: `${run.docSummary.registry.deedType ?? 'land record'}${run.docSummary.registry.district ? ` · ${run.docSummary.registry.district}` : ''} · ${run.docSummary.registry.language ?? 'read'}`,
                      },
                      run.docSummary.aadhaar.found && {
                        ok: true,
                        title: 'Aadhaar',
                        body: `${run.docSummary.aadhaar.name ?? run.docSummary.aadhaar.nameDevanagari ?? 'name read'}${run.docSummary.aadhaar.aadhaarMasked ? ` · ${run.docSummary.aadhaar.aadhaarMasked}` : ''}`,
                      },
                      {
                        ok: run.docSummary.identityCross.matched,
                        warn: !run.docSummary.identityCross.matched && run.docSummary.identityCross.inconclusive,
                        title: run.docSummary.identityCross.inconclusive && !run.docSummary.identityCross.matched
                          ? 'Identity · inconclusive'
                          : `Identity match ${run.docSummary.identityCross.score}%`,
                        body: run.docSummary.identityCross.detail,
                      },
                      run.docSummary.policy.found && {
                        ok: true,
                        title: 'Policy',
                        body: `${run.docSummary.policy.policyNumber ?? 'paper read'}${run.docSummary.policy.sumInsured ? ` · sum ₹${run.docSummary.policy.sumInsured.toLocaleString('en-IN')}` : ''}`,
                      },
                      run.docSummary.satellite.found && {
                        ok: true,
                        title: `Satellite · ${run.docSummary.satellite.destructionPct ?? '?'}% destroyed`,
                        body: `visual ladder rung: ${run.docSummary.satellite.rung ?? '?'}${run.docSummary.pctDelta != null ? ` · claimed ${run.docSummary.claimedPct}% (Δ ${run.docSummary.pctDelta})` : ''}`,
                      },
                    ].filter(Boolean) as Array<{ ok: boolean; warn?: boolean; title: string; body: string }>
                  ).map((c) => (
                    <div key={c.title} className={`rounded-lg border px-3 py-2 ${c.ok ? 'border-[#10b981]/30 bg-[#10b981]/[0.05]' : c.warn ? 'border-black/15 bg-black/[0.04]' : 'border-[#f59e0b]/40 bg-[#f59e0b]/[0.06]'}`}>
                      <p className={`text-[11px] font-semibold ${c.ok ? 'text-[#0b7a5c]' : c.warn ? 'text-black/60' : 'text-[#b45309]'}`}>{c.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-black/60" title={c.body}>{c.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {run.similarCases.length > 0 && (
              <div className="rounded-xl border border-black/10 p-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-black/50">Similar past cases · trained memory</p>
                <div className="flex flex-wrap gap-2">
                  {Object.values(
                    run.similarCases.reduce<Record<string, (typeof run.similarCases)[number]>>((acc, sc) => {
                      if (!acc[sc.claimId] || acc[sc.claimId].similarity < sc.similarity) acc[sc.claimId] = sc;
                      return acc;
                    }, {}),
                  )
                    .sort((a, b) => b.similarity - a.similarity)
                    .slice(0, 4)
                    .map((sc) => (
                      <span key={sc.claimId} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${sc.label === 'fraud' ? TONE_CLASS.bad : TONE_CLASS.ok}`}>
                        {sc.claimId} · {sc.label} · {sc.similarity}
                      </span>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Review + payout — the guarded human lanes
// ---------------------------------------------------------------------------

function ReviewAndPay({ claim }: { claim: Claim }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [reviewer, setReviewer] = useState('inspector-7');
  const [upiRef, setUpiRef] = useState(`UPI-${claim.id.slice(-6)}`);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['claims'] });
    qc.invalidateQueries({ queryKey: ['verification', claim.id] });
    qc.invalidateQueries({ queryKey: ['trail', claim.id] });
    qc.invalidateQueries({ queryKey: ['stats'] });
  };

  const review = useMutation({
    mutationFn: (status: 'HUMAN_APPROVED' | 'HUMAN_REJECTED') => api.review(claim.id, status, note, reviewer),
    onSuccess: invalidate,
  });
  const pay = useMutation({
    mutationFn: () => api.pay(claim.id, upiRef),
    onSuccess: invalidate,
  });

  const flagged = claim.status === 'AI_FLAGGED' || claim.status === 'HUMAN_REVIEW';
  const payable = claim.status === 'AI_APPROVED' || claim.status === 'HUMAN_APPROVED';
  const noteOk = note.trim().length >= 20;

  if (!flagged && !payable && claim.status !== 'PAID') {
    return (
      <Card className="p-5">
        <p className="text-xs text-black/50">
          Status <span className="font-medium text-black/70">{STATUS_META[claim.status].label}</span> — no action available. AI verdicts are computed, never typed.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle>Human lane</SectionTitle>
      <div className="space-y-4 p-5">
        {flagged && (
          <>
            <div className="flex items-center gap-2 rounded-xl bg-[#f59e0b]/10 px-4 py-3 text-xs text-[#b45309]">
              <ShieldAlert className="h-4 w-4" />
              Flagged claims are payout-locked. A reviewed decision (≥20-char reason) is the only exit — sealed on-chain.
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Why is this claim being approved or rejected? (mandatory, min 20 chars)"
              className="w-full rounded-xl border border-black/10 bg-[#F5F5F5] px-3 py-2 text-sm text-black outline-none focus:border-black"
            />
            <div className="flex items-center justify-between">
              <input
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
                className="w-40 rounded-xl border border-black/10 bg-[#F5F5F5] px-3 py-2 text-xs text-black outline-none focus:border-black"
              />
              <span className={`font-mono text-[11px] ${noteOk ? 'text-[#0b7a5c]' : 'text-black/40'}`}>{note.trim().length}/20</span>
            </div>
            <div className="flex gap-2">
              <button
                disabled={!noteOk || review.isPending}
                onClick={() => review.mutate('HUMAN_APPROVED')}
                className="flex-1 rounded-full bg-black py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-40"
              >
                Approve & unlock
              </button>
              <button
                disabled={!noteOk || review.isPending}
                onClick={() => review.mutate('HUMAN_REJECTED')}
                className="flex-1 rounded-full border border-[#ef4444]/40 py-2.5 text-sm font-medium text-[#b91c1c] transition-colors hover:bg-[#ef4444]/10 disabled:opacity-40"
              >
                Reject claim
              </button>
            </div>
            {review.isError && <p className="text-xs text-[#b91c1c]">{(review.error as Error).message}</p>}
          </>
        )}

        {payable && (
          <>
            <div className="flex items-center gap-2 rounded-xl bg-[#10b981]/10 px-4 py-3 text-xs text-[#0b7a5c]">
              <ShieldCheck className="h-4 w-4" />
              Payout-unlocked. UPI reference is hashed into the sealed PAID record.
            </div>
            <div className="flex gap-2">
              <input
                value={upiRef}
                onChange={(e) => setUpiRef(e.target.value)}
                className="flex-1 rounded-xl border border-black/10 bg-[#F5F5F5] px-3 py-2 font-mono text-xs text-black outline-none focus:border-black"
              />
              <button
                disabled={pay.isPending || upiRef.trim().length < 4}
                onClick={() => pay.mutate()}
                className="rounded-full bg-black px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-40"
              >
                {pay.isPending ? 'Paying…' : `Pay ${inr(claim.amountRequested)}`}
              </button>
            </div>
            {pay.isError && <p className="text-xs text-[#b91c1c]">{(pay.error as Error).message}</p>}
          </>
        )}

        {claim.status === 'PAID' && (
          <div className="flex items-center gap-2 rounded-xl bg-[#10b981]/10 px-4 py-3 text-sm text-[#0b7a5c]">
            <BadgeCheck className="h-4 w-4" /> Paid {inr(claim.amountRequested)} — terminal state, trail sealed.
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Evidence gallery + forensics
// ---------------------------------------------------------------------------

function EvidenceGrid({ claim }: { claim: Claim }) {
  if (claim.evidence.length === 0) return null;
  return (
    <Card>
      <SectionTitle right={<span className="font-mono text-[10px] text-black/40">{claim.evidence.length} file(s) · content-addressed</span>}>
        Evidence
      </SectionTitle>
      <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3">
        {claim.evidence.map((ev) => (
          <a key={ev.fileId} href={api.evidenceUrl(ev.fileId)} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-xl border border-black/10">
            {ev.kind === 'photo' ? (
              <img src={api.evidenceUrl(ev.fileId)} alt={ev.filename} className="h-28 w-full object-cover transition-transform group-hover:scale-[1.03]" />
            ) : (
              <div className="flex h-28 w-full items-center justify-center bg-[#F5F5F5]">
                <FileText className="h-6 w-6 text-black/40" />
              </div>
            )}
            <div className="px-3 py-2">
              <p className="truncate text-[11px] font-medium text-black">{ev.kind.toUpperCase()}</p>
              <p className="truncate font-mono text-[10px] text-black/40">{short(ev.sha256)}</p>
              {ev.exif.software && <p className="mt-0.5 text-[10px] font-semibold text-[#b91c1c]">edit tag: {ev.exif.software}</p>}
              {ev.exif.gps && (
                <p className="text-[10px] text-black/40">
                  GPS {ev.exif.gps.lat.toFixed(3)}, {ev.exif.gps.lon.toFixed(3)}
                </p>
              )}
            </div>
          </a>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Audit trail + integrity + tamper demo
// ---------------------------------------------------------------------------

function TrailPanel({ claimId }: { claimId: string }) {
  const qc = useQueryClient();
  const trail = useQuery({ queryKey: ['trail', claimId], queryFn: () => api.auditTrail(claimId), refetchInterval: 5000, retry: 1 });
  const [demoMsg, setDemoMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const tamper = useMutation({
    mutationFn: () => api.tamper(claimId, 1),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['trail', claimId] });
      setDemoMsg({ tone: 'bad', text: r.verdict });
    },
    onError: (e) => setDemoMsg({ tone: 'bad', text: (e as Error).message }),
  });
  const restore = useMutation({
    mutationFn: () => api.restore(claimId, 1),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['trail', claimId] });
      setDemoMsg({ tone: 'ok', text: r.verdict });
    },
    onError: (e) => setDemoMsg({ tone: 'bad', text: (e as Error).message }),
  });

  const integrity = trail.data?.integrity;
  const ok = integrity ? integrity.offChainValid && integrity.onChainValid : true;

  return (
    <Card>
      <SectionTitle
        right={
          integrity && (
            <Chip tone={ok ? 'ok' : 'bad'}>
              {ok ? 'chain valid' : `broken @ ${integrity.onChainBreakAtIndex ?? integrity.offChainBreakAtIndex}`}
            </Chip>
          )
        }
      >
        Immutable audit trail
      </SectionTitle>
      <div className="p-5">
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            disabled={tamper.isPending || restore.isPending}
            onClick={() => tamper.mutate()}
            className="inline-flex items-center gap-2 rounded-full border border-[#ef4444]/40 px-4 py-2 text-xs font-medium text-[#b91c1c] transition-colors hover:bg-[#ef4444]/10 disabled:opacity-40"
          >
            <Zap className="h-3.5 w-3.5" /> {tamper.isPending ? 'forging…' : 'Attempt retro-edit'}
          </button>
          <button
            disabled={restore.isPending || tamper.isPending}
            onClick={() => restore.mutate()}
            className="rounded-full border border-black/10 px-4 py-2 text-xs font-medium text-black/70 transition-colors hover:border-black/30 disabled:opacity-40"
          >
            {restore.isPending ? 'restoring…' : 'Restore'}
          </button>
        </div>
        {demoMsg && (
          <div className={`mb-4 rounded-xl px-4 py-3 font-mono text-xs ${demoMsg.tone === 'bad' ? 'bg-[#ef4444]/10 text-[#b91c1c]' : 'bg-[#10b981]/10 text-[#0b7a5c]'}`}>
            {demoMsg.text}
          </div>
        )}

        {trail.isLoading || !trail.data ? (
          <p className="py-6 text-center text-xs text-black/40">Reading trail from chain…</p>
        ) : (
          <div className="space-y-3">
            {trail.data.records.map((r, i) => (
              <div key={r.recordHash} className="flex gap-3">
                <div className={`mt-1 flex h-7 w-7 flex-none items-center justify-center rounded-lg border font-mono text-[10px] font-bold ${ok ? 'border-black/15 bg-black/[0.03] text-black/70' : 'border-[#ef4444]/40 bg-[#ef4444]/10 text-[#b91c1c]'}`}>
                  {i}
                </div>
                <div className="min-w-0 flex-1 rounded-xl bg-[#F5F5F5] px-4 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-black/70">{STATUS_META[(Object.keys(STATUS_META) as ClaimStatus[])[r.status] ?? 'SUBMITTED']?.label ?? `status ${r.status}`}</span>
                    <span className="font-mono text-[10px] text-black/40">{new Date(r.sealedAtIso).toLocaleTimeString()}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-black/60">{r.note}</p>
                  <p className="mt-1 truncate font-mono text-[10px] text-black/40">
                    rec {short(r.recordHash)} · prev {r.prevRecordHash.startsWith('0x0000') ? 'GENESIS' : short(r.prevRecordHash)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Console() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 5000, retry: 1 });
  const claims = useQuery({ queryKey: ['claims'], queryFn: api.listClaims, refetchInterval: 4000, retry: 1 });
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: 5000, retry: 1 });
  const memory = useQuery({ queryKey: ['memory'], queryFn: api.fraudMemory, refetchInterval: 10000, retry: 1 });

  useEffect(() => {
    if (!selectedId && claims.data && claims.data.length > 0) setSelectedId(claims.data[claims.data.length - 1].id);
  }, [claims.data, selectedId]);

  const selected = useMemo(() => claims.data?.find((c) => c.id === selectedId), [claims.data, selectedId]);
  const chainOk = health.data?.chain.enabled;

  const kpis = [
    { label: 'Claims today', value: stats.data?.claimsToday ?? '—' },
    { label: 'Auto-approved', value: stats.data?.autoApprovalPct != null ? `${stats.data.autoApprovalPct}%` : '—' },
    { label: 'Flagged locked', value: stats.data?.flaggedLocked ?? '—' },
    { label: 'Leakage prevented', value: stats.data ? inr(stats.data.leakagePreventedInr) : '—' },
    { label: 'Verify p50', value: stats.data?.verificationDurationP50Ms != null ? `${(stats.data.verificationDurationP50Ms / 1000).toFixed(1)}s` : '—' },
    { label: 'Trained memory', value: memory.data ? `${memory.data.size} (${memory.data.genuine}✓/${memory.data.fraud}⚑)` : '—' },
  ];

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-black/10 bg-[#F5F5F5]/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[88rem] items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2">
              <LogoIcon className="h-6 w-6 text-black" />
              <span className="text-lg font-medium tracking-tight text-black">ClaimChain</span>
            </Link>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Console</span>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            {chainOk ? <Chip tone="ok">chain live</Chip> : <Chip tone="bad">chain offline</Chip>}
            <span className="hidden rounded-full border border-black/10 px-3 py-1 font-mono text-black/60 sm:block">
              records {health.data?.chain.totalRecords ?? '—'}
            </span>
            <a
              href={api.exportCsvUrl()}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/10 px-3 py-1 font-medium text-black/70 transition-colors hover:border-black/40"
            >
              <Download className="h-3 w-3" /> CSV
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[88rem] px-6 py-6">
        {!chainOk && (
          <Card className="mb-4 border-[#f59e0b]/30 bg-[#f59e0b]/5 p-4">
            <p className="text-xs text-[#b45309]">
              Chain offline — start the backend with <span className="font-mono">npm run demo</span> (repo root), then refresh.
            </p>
          </Card>
        )}

        {/* KPI strip */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {kpis.map((k) => (
            <Card key={k.label} className="px-4 py-3">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-black/40">{k.label}</p>
              <p className="mt-1 font-mono text-sm font-semibold text-black">{k.value}</p>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Left: intake + queue */}
          <div className="flex flex-col gap-4 lg:col-span-4">
            <IntakeForm onCreated={setSelectedId} />
            <Card className="overflow-hidden">
              <SectionTitle right={<span className="font-mono text-[10px] text-black/40">{claims.data?.length ?? 0}</span>}>Claims queue</SectionTitle>
              <div className="max-h-96 overflow-y-auto">
                {(claims.data ?? []).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`flex w-full items-center justify-between border-b border-black/5 px-5 py-3 text-left transition-colors last:border-0 ${
                      selectedId === c.id ? 'bg-black/[0.04]' : 'hover:bg-black/[0.02]'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-black">{c.id}</p>
                      <p className="truncate text-[11px] text-black/50">
                        {c.claimantName} · {c.lossType}
                      </p>
                    </div>
                    <div className="flex flex-none items-center gap-2">
                      <span className="font-mono text-[11px] text-black/70">{inr(c.amountRequested)}</span>
                      <Chip tone={STATUS_META[c.status].tone}>{STATUS_META[c.status].label}</Chip>
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          </div>

          {/* Right: detail */}
          <div className="flex flex-col gap-4 lg:col-span-8">
            {!selected ? (
              <Card className="p-10 text-center text-sm text-black/50">Select or create a claim to begin.</Card>
            ) : (
              <>
                <Card className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="flex items-center gap-2 font-mono text-base font-semibold text-black">
                        {selected.id} <Chip tone={STATUS_META[selected.status].tone}>{STATUS_META[selected.status].label}</Chip>
                      </h2>
                      <p className="mt-0.5 text-xs text-black/50">
                        {selected.claimantName} · {selected.lossType} · {selected.evidence.filter((e) => e.kind === 'photo').length} photo(s)
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-semibold uppercase tracking-widest text-black/40">Requested</p>
                      <p className="font-mono text-xl font-semibold text-black">{inr(selected.amountRequested)}</p>
                    </div>
                  </div>
                </Card>

                <PipelineStepper claimId={selected.id} />
                <ReviewAndPay claim={selected} />
                <EvidenceGrid claim={selected} />
                <TrailPanel claimId={selected.id} />
              </>
            )}
          </div>
        </div>

        <footer className="py-10 text-center">
          <Link to="/" className="inline-flex items-center gap-2 text-xs font-medium text-black/50 transition-colors hover:text-black">
            <ArrowLeft className="h-3 w-3" /> Back to landing
          </Link>
        </footer>
      </main>
    </div>
  );
}
