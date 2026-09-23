import { useQuery } from '@tanstack/react-query';
import { CircleCheck, Search, XCircle } from 'lucide-react';
import { useState } from 'react';
import { api, short, type ChainEvent } from '../lib/api';
import { Card, Chip, InnerPage } from '../components/ui';

/**
 * Explorer — a live window into the chain: recent ClaimStateSealed events
 * with tx hashes and block numbers, plus search by CLM id or any 0x hash.
 * Both panels poll the real /api/explorer endpoints.
 */

const STATUS_NAMES = ['SUBMITTED', 'AI_APPROVED', 'AI_FLAGGED', 'HUMAN_OVERRIDDEN', 'PAID', 'REJECTED', 'HUMAN_REVIEW', 'HUMAN_APPROVED', 'HUMAN_REJECTED'];

function statusMeta(statusNum: number): { label: string; tone: string } {
  const name = STATUS_NAMES[statusNum] ?? `STATUS_${statusNum}`;
  const tone =
    name === 'PAID' || name === 'AI_APPROVED' || name === 'HUMAN_APPROVED'
      ? 'ok'
      : name === 'AI_FLAGGED' || name === 'HUMAN_REVIEW' || name === 'HUMAN_OVERRIDDEN'
        ? 'warn'
        : name === 'REJECTED' || name === 'HUMAN_REJECTED'
          ? 'bad'
          : 'ai';
  return { label: name, tone };
}

function EventRow({ e }: { e: ChainEvent }) {
  const meta = statusMeta(e.status);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-black/5 px-5 py-3 last:border-0">
      <span className="font-mono text-xs font-semibold text-black">{e.claimIdRef ?? short(e.claimId)}</span>
      <Chip tone={meta.tone}>{meta.label}</Chip>
      <span className="hidden font-mono text-[10px] text-black/40 md:inline">block {e.blockNumber}</span>
      <span className="hidden font-mono text-[10px] text-black/40 lg:inline">tx {short(e.txHash)}</span>
      <span className="hidden max-w-72 flex-1 truncate font-mono text-[10px] text-black/40 xl:inline">state {short(e.stateHash)}</span>
      <span className="ml-auto font-mono text-[10px] text-black/40">{new Date(e.sealedAtIso).toLocaleTimeString()}</span>
    </div>
  );
}

export default function ExplorerPage() {
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');

  const events = useQuery({
    queryKey: ['explorer-events'],
    queryFn: () => api.explorerEvents(50),
    refetchInterval: 5000,
    retry: 1,
  });

  const search = useQuery({
    queryKey: ['explorer-search', submitted],
    queryFn: () => api.explorerSearch(submitted),
    enabled: submitted.length > 0,
    retry: 1,
  });

  const offline = events.isError;

  return (
    <InnerPage
      eyebrow="Chain explorer"
      title="Every seal, public. Every hash, checkable."
      lead="This feed reads real ClaimStateSealed events from the audit contract — submissions, AI decisions, human reviews and payouts, each with its transaction hash and block. Search by claim id or paste any 0x hash."
    >
      {/* Search */}
      <Card className="mb-6 p-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(q.trim());
          }}
          className="flex items-center gap-2"
        >
          <Search className="ml-3 h-4 w-4 text-black/40" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search CLM-8919 · CLM-8920 · or any 0x… hash"
            className="flex-1 bg-transparent px-2 py-2.5 text-sm text-black outline-none placeholder:text-black/30"
          />
          {submitted && (
            <button type="button" onClick={() => { setQ(''); setSubmitted(''); }} className="rounded-full p-1.5 text-black/40 hover:bg-black/5">
              <XCircle className="h-4 w-4" />
            </button>
          )}
          <button type="submit" className="rounded-full bg-black px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800">
            Search
          </button>
        </form>
      </Card>

      {/* Search results */}
      {submitted && search.data && (
        <Card className="mb-6">
          <div className="flex items-center justify-between border-b border-black/10 px-5 py-3">
            <h2 className="text-sm font-medium text-black">
              Results for <span className="font-mono">{submitted}</span>
            </h2>
            <Chip tone={search.data.count > 0 ? 'ok' : 'muted'}>
              {search.data.count} match{search.data.count === 1 ? '' : 'es'} · {search.data.interpretedAs}
            </Chip>
          </div>
          {search.data.count === 0 ? (
            <p className="px-5 py-6 text-sm text-black/50">No sealed events matched this query in the recent block range.</p>
          ) : (
            <div>{search.data.matches.map((e) => <EventRow key={e.recordHash + e.txHash} e={e} />)}</div>
          )}
        </Card>
      )}
      {submitted && search.isError && (
        <Card className="mb-6 p-5 text-sm text-black/50">Search failed — is the chain up?</Card>
      )}

      {/* Live feed */}
      <Card>
        <div className="flex items-center justify-between border-b border-black/10 px-5 py-3">
          <h2 className="text-sm font-medium text-black">Latest sealed events</h2>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#10b981]" />
            <span className="font-mono text-[10px] text-black/40">live · {events.data?.count ?? 0} events</span>
          </div>
        </div>
        {offline ? (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-black/50">
            <XCircle className="h-4 w-4 text-black/30" /> Chain offline — start the backend (<span className="font-mono text-xs">npm run demo</span>) to see the live feed.
          </div>
        ) : (
          <div className="max-h-[560px] overflow-y-auto">
            {(events.data?.events ?? []).map((e) => <EventRow key={e.recordHash + e.txHash} e={e} />)}
          </div>
        )}
      </Card>

      <p className="mt-4 flex items-center gap-2 text-xs text-black/40">
        <CircleCheck className="h-3.5 w-3.5" /> Event data comes straight from eth_getLogs on the local node — nothing here is cached or faked.
      </p>
    </InnerPage>
  );
}
