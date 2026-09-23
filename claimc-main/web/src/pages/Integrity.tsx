import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, FileCheck2, Hash, Lock, RotateCcw, ShieldCheck, Zap } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, short } from '../lib/api';
import { Card, Chip, InnerPage } from '../components/ui';

/**
 * Integrity — tamper-evidence explained and then demonstrated: the page runs
 * a live integrity check against the chain and reproduces the retro-edit
 * demo (forge storage → watch the chain break → restore). Local-node only,
 * exactly like the server's assertLocalRpc guard.
 */

const CHAIN_STEPS = [
  { title: 'Genesis seal', desc: 'Submission hashes the evidence set (sha256 + pHash) into the first record. recordHash₀ = keccak256(prev=0, stateHash₀, status, time, sealer, note).' },
  { title: 'Chain growth', desc: 'Each new record embeds the previous recordHash — AI decision, human review, payout — so the trail is a linked hash chain, not a table.' },
  { title: 'Dual verification', desc: 'The API replays the chain off-chain AND calls the contract’s verifyTrail(); both must agree, and a break is reported at its exact index.' },
  { title: 'Independent proof', desc: 'Merkle inclusion proofs and a signed dossier let auditors verify a claim’s history without trusting the operator or exposing PII.' },
];

const RULES = [
  { code: 'RULE ZERO', title: 'Flagged claims cannot be paid', desc: 'AI_FLAGGED is a payout freeze. The only exit is a human decision — HUMAN_APPROVED or HUMAN_REJECTED — with a mandatory ≥20-char reason, sealed on-chain. Attempted payout → HTTP 409 FLAGGED_LOCKED.', tone: 'bad' },
  { code: 'R-403', title: 'AI verdicts are computed', desc: 'AI_APPROVED / AI_FLAGGED / AI_REJECTED can never be set by a client. The transition API rejects them with AI_VERDICTS_ARE_COMPUTED.', tone: 'warn' },
  { code: 'R-409', title: 'Payouts have one door', desc: 'PAID is sealed only through the dedicated /pay endpoint with a UPI reference hashed into the record — never through generic transitions.', tone: 'ai' },
  { code: 'R-ADD', title: 'Evidence is append-only', desc: 'Late files become sealed ADDENDUM records and trigger re-verification. History is never rewritten.', tone: 'ok' },
];

export default function IntegrityPage() {
  const [demoMsg, setDemoMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 5000, retry: 1 });
  const claims = useQuery({ queryKey: ['claims'], queryFn: api.listClaims, refetchInterval: 5000, retry: 1 });
  const trail = useQuery({
    queryKey: ['integrity-trail'],
    queryFn: () => api.auditTrail('CLM-8920'),
    refetchInterval: 5000,
    retry: 1,
    enabled: !!health.data?.chain.enabled,
  });

  const pickClaimId = () => {
    const first = claims.data?.find((c) => c.id === 'CLM-8920') ?? claims.data?.[0];
    return first?.id ?? 'CLM-8920';
  };

  const tamper = useMutation({
    mutationFn: () => api.tamper(pickClaimId(), 1),
    onSuccess: (r) => {
      setDemoMsg({ tone: 'bad', text: r.verdict });
      trail.refetch();
    },
    onError: (e) => setDemoMsg({ tone: 'bad', text: (e as Error).message }),
  });
  const restore = useMutation({
    mutationFn: () => api.restore(pickClaimId(), 1),
    onSuccess: (r) => {
      setDemoMsg({ tone: 'ok', text: r.verdict });
      trail.refetch();
    },
    onError: (e) => setDemoMsg({ tone: 'bad', text: (e as Error).message }),
  });

  const integrity = trail.data?.integrity;
  const ok = integrity ? integrity.offChainValid && integrity.onChainValid : true;

  return (
    <InnerPage
      eyebrow="Tamper evidence"
      title="Retro-edits don’t get hidden. They get proven."
      lead="Every event is a hash-linked record on-chain. This page explains the chain, the guard rules — then actually forges a record on a sandbox node so you can watch the break get detected and restored."
    >
      {/* How the chain works */}
      <h2 className="mb-6 text-3xl font-medium text-black md:text-4xl" style={{ letterSpacing: '-0.03em' }}>How the hash chain works</h2>
      <div className="mb-16 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {CHAIN_STEPS.map((s, i) => (
          <Card key={s.title} className="relative p-5">
            <Hash className="mb-3 h-5 w-5 text-black" />
            <h4 className="mb-1.5 text-base font-medium text-black">{s.title}</h4>
            <p className="text-xs leading-relaxed text-black/60">{s.desc}</p>
            {i < CHAIN_STEPS.length - 1 && <ArrowRight className="absolute -right-3 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-black/20 lg:block" />}
          </Card>
      ))}
      </div>

      {/* Live integrity card */}
      <div className="mb-16 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between border-b border-black/10 px-5 py-3">
            <h2 className="text-sm font-medium text-black">Live integrity — CLM-8920</h2>
            <Chip tone={ok ? 'ok' : 'bad'}>{ok ? 'chain valid' : `broken @ ${integrity?.onChainBreakAtIndex ?? integrity?.offChainBreakAtIndex}`}</Chip>
          </div>
          <div className="p-5">
            {health.data?.chain.enabled ? (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-[#F5F5F5] px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-black/40">Off-chain replay</p>
                    <p className={`font-mono text-sm font-semibold ${integrity?.offChainValid ? 'text-[#0b7a5c]' : 'text-[#b91c1c]'}`}>
                      {integrity ? (integrity.offChainValid ? 'VALID' : `BREAK @ ${integrity.offChainBreakAtIndex}`) : '…'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-[#F5F5F5] px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-black/40">On-chain verifyTrail()</p>
                    <p className={`font-mono text-sm font-semibold ${integrity?.onChainValid ? 'text-[#0b7a5c]' : 'text-[#b91c1c]'}`}>
                      {integrity ? (integrity.onChainValid ? 'VALID' : `BREAK @ ${integrity.onChainBreakAtIndex}`) : '…'}
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  {(trail.data?.records ?? []).slice(0, 4).map((r, i) => (
                    <div key={r.recordHash} className="flex items-center gap-3 rounded-xl bg-[#F5F5F5] px-4 py-2">
                      <span className="font-mono text-[10px] text-black/40">#{i}</span>
                      <span className="font-mono text-[10px] text-black/60">{short(r.recordHash)}</span>
                      <span className="ml-auto truncate text-[11px] text-black/50">{r.note}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-black/50">Chain offline — start the backend (<span className="font-mono text-xs">npm run demo</span>) to see the live check.</p>
            )}
          </div>
        </Card>

        {/* Tamper demo */}
        <Card className="flex flex-col p-5">
          <h3 className="mb-1 text-xl font-medium text-black" style={{ letterSpacing: '-0.02em' }}>The retro-edit demo</h3>
          <p className="mb-4 text-sm leading-relaxed text-black/60">
            This writes a forged payout into a historical record on a <span className="font-medium text-black">sandbox node only</span> — the server refuses this endpoint on any non-local RPC. The forged record no longer matches its sealed commitment, and the chain says so.
          </p>
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              disabled={tamper.isPending || restore.isPending || !health.data?.chain.enabled}
              onClick={() => tamper.mutate()}
              className="inline-flex items-center gap-2 rounded-full border border-[#ef4444]/40 px-4 py-2 text-xs font-medium text-[#b91c1c] transition-colors hover:bg-[#ef4444]/10 disabled:opacity-40"
            >
              <Zap className="h-3.5 w-3.5" /> {tamper.isPending ? 'forging…' : 'Attempt retro-edit'}
            </button>
            <button
              disabled={restore.isPending || tamper.isPending || !health.data?.chain.enabled}
              onClick={() => restore.mutate()}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-medium text-black/70 transition-colors hover:border-black/30 disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" /> {restore.isPending ? 'restoring…' : 'Restore'}
            </button>
          </div>
          {demoMsg && (
            <div className={`rounded-xl px-4 py-3 font-mono text-xs ${demoMsg.tone === 'bad' ? 'bg-[#ef4444]/10 text-[#b91c1c]' : 'bg-[#10b981]/10 text-[#0b7a5c]'}`}>
              {demoMsg.text}
            </div>
          )}
          {!demoMsg && (
            <div className="mt-auto flex items-center gap-2 rounded-xl bg-[#F5F5F5] px-4 py-3 text-xs text-black/50">
              <ShieldCheck className="h-4 w-4" /> Run the demo — the integrity card on the left will flip to BROKEN, then back.
            </div>
          )}
        </Card>
      </div>

      {/* Guard rules */}
      <h2 className="mb-6 text-3xl font-medium text-black md:text-4xl" style={{ letterSpacing: '-0.03em' }}>The guard rules</h2>
      <div className="mb-14 grid grid-cols-1 gap-4 md:grid-cols-2">
        {RULES.map((r) => (
          <Card key={r.code} className="p-5">
            <div className="mb-2 flex items-center gap-2">
              <Chip tone={r.tone}>{r.code}</Chip>
            </div>
            <h4 className="mb-1.5 text-base font-medium text-black">{r.title}</h4>
            <p className="text-xs leading-relaxed text-black/60">{r.desc}</p>
          </Card>
        ))}
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="flex items-center gap-3">
          <FileCheck2 className="h-5 w-5 text-black" />
          <p className="text-sm text-black/70">Want to forge a record yourself? The console wires the same demo to any claim.</p>
        </div>
        <Link to="/console" className="inline-flex items-center gap-3 rounded-full bg-black py-2 pl-7 pr-2 text-sm font-medium text-white transition-colors hover:bg-gray-800">
          Open Console
          <span className="rounded-full bg-white p-1.5"><Lock className="h-4 w-4 text-black" /></span>
        </Link>
      </Card>
    </InnerPage>
  );
}
