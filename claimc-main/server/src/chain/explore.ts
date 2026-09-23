import { ethers } from 'ethers';
import { CLAIM_AUDIT_TRAIL_ABI } from './abi.js';
import { claimIdToBytes32 } from './chain.js';

/**
 * Chain-explorer helpers backed by the contract's ClaimStateSealed events.
 */

export interface SealedEventView {
  claimId: string; // hex bytes32 (raw)
  claimIdRef: string | null; // CLM-XXXX when the id is a keccak of a known claim (resolved by caller map)
  stateHash: string;
  recordHash: string;
  prevRecordHash: string;
  status: number;
  timestamp: string;
  sealedAtIso: string;
  recordedBy: string;
  txHash: string;
  blockNumber: number;
}

export async function fetchRecentEvents(
  provider: ethers.JsonRpcProvider,
  contractAddress: string,
  opts: { limit?: number; fromBlock?: number } = {}
): Promise<SealedEventView[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const iface = new ethers.Interface(CLAIM_AUDIT_TRAIL_ABI);
  const topic = iface.getEvent('ClaimStateSealed')!.topicHash;
  const head = await provider.getBlockNumber();
  const from = opts.fromBlock ?? Math.max(0, head - 9_999); // most RPCs cap ranges

  const logs = await provider.send('eth_getLogs', [
    {
      address: contractAddress,
      fromBlock: '0x' + from.toString(16),
      toBlock: '0x' + head.toString(16),
      topics: [topic],
    },
  ]);

  const events: SealedEventView[] = [];
  for (const log of logs.slice(-limit).reverse()) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (!parsed || parsed.name !== 'ClaimStateSealed') continue;
      const a = parsed.args as Record<string, unknown>;
      const ts = Number(a.timestamp);
      events.push({
        claimId: String(a.claimId),
        claimIdRef: null,
        stateHash: String(a.stateHash),
        recordHash: String(a.recordHash),
        prevRecordHash: String(a.prevRecordHash),
        status: Number(a.status),
        timestamp: String(a.timestamp),
        sealedAtIso: new Date(ts * 1000).toISOString(),
        recordedBy: String(a.recordedBy),
        txHash: log.transactionHash ?? '',
        blockNumber: Number(log.blockNumber),
      });
    } catch {
      /* skip unparseable log */
    }
  }
  return events;
}

export type SearchTarget =
  | { kind: 'claimId'; value: string } // CLM-XXXX style
  | { kind: 'hash'; value: string }; // any 0x hash: claimId bytes32 / stateHash / recordHash

/** Interpret a user query string and search the event log. */
export async function searchChain(
  provider: ethers.JsonRpcProvider,
  contractAddress: string,
  query: string
): Promise<{ matches: SealedEventView[]; interpretedAs: SearchTarget['kind'] | 'unknown' }> {
  const q = query.trim();
  const all = await fetchRecentEvents(provider, contractAddress, { limit: 100 });

  const claims = new Map<string, string>(); // bytes32 -> CLM ref for display
  for (const e of all) {
    if (!claims.has(e.claimId)) claims.set(e.claimId, '');
  }

  if (/^CLM-/i.test(q)) {
    const id32 = claimIdToBytes32(q.toUpperCase()).toLowerCase();
    const matches = all.filter((e) => e.claimId.toLowerCase() === id32);
    for (const m of matches) m.claimIdRef = q.toUpperCase();
    return { matches, interpretedAs: 'claimId' };
  }

  if (/^0x[0-9a-fA-F]{64}$/.test(q)) {
    const lq = q.toLowerCase();
    const matches = all.filter(
      (e) =>
        e.claimId.toLowerCase() === lq ||
        e.stateHash.toLowerCase() === lq ||
        e.recordHash.toLowerCase() === lq ||
        e.prevRecordHash.toLowerCase() === lq ||
        e.txHash.toLowerCase() === lq
    );
    for (const m of matches) m.claimIdRef = claims.get(m.claimId) || null;
    return { matches, interpretedAs: 'hash' };
  }

  return { matches: [], interpretedAs: 'unknown' };
}
