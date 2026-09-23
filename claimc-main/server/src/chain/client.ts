import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { CLAIM_AUDIT_TRAIL_ABI } from './abi.js';

export interface ChainClient {
  contract: ethers.Contract;
  address: string;
  enabled: boolean;
  signerAddress: string | null;
  provider: ethers.JsonRpcProvider;
  rpcUrl: string;
}

const DEFAULT_LOCAL = 'http://127.0.0.1:8545';
const DEFAULT_DEPLOYED_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3'; // first Anvil/Hardhat account deployment

function loadDeploymentAddress(): string | null {
  const file = path.resolve('../blockchain/deployments/localhost.json');
  if (!existsSync(file)) return null;
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as { address?: string }).address ?? null;
  } catch {
    return null;
  }
}

/**
 * Build a read/write client for ClaimAuditTrail.
 * - RPC_URL: JSON-RPC endpoint (default local Hardhat node)
 * - PRIVATE_KEY: sealing key — MUST equal the contract owner (deployer account #0 of the local node)
 * - CONTRACT_ADDRESS: overrides deployments/localhost.json
 *
 * When no node is reachable the API still runs; `enabled: false` marks chain ops as unavailable.
 */
export async function createChainClient(): Promise<ChainClient> {
  const rpcUrl = process.env.RPC_URL ?? DEFAULT_LOCAL;
  const address =
    process.env.CONTRACT_ADDRESS ??
    loadDeploymentAddress() ??
    DEFAULT_DEPLOYED_ADDRESS;

  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
    pollingInterval: 1000,
  });

  let signer: ethers.NonceManager | null = null;
  if (process.env.PRIVATE_KEY) {
    // NonceManager fetches the nonce once and increments locally per send —
    // avoids stale-nonce races ("nonce has already been used") against automining nodes.
    signer = new ethers.NonceManager(new ethers.Wallet(process.env.PRIVATE_KEY, provider));
  } else {
    console.warn('[chain] PRIVATE_KEY not set — running in read-only mode');
  }

  const contract = new ethers.Contract(address, CLAIM_AUDIT_TRAIL_ABI, signer ?? provider);

  // Probe reachability; don't crash the API when the node is down.
  try {
    await provider.getBlockNumber();
    const signerAddress = signer ? await signer.getAddress() : null;
    console.log(`[chain] connected to ${rpcUrl} — ClaimAuditTrail @ ${address}`);
    return { contract, address, enabled: true, signerAddress, provider, rpcUrl };
  } catch (err) {
    console.warn(`[chain] node unreachable at ${rpcUrl} (${(err as Error).message}) — chain features disabled`);
    return { contract, address, enabled: false, signerAddress: null, provider, rpcUrl };
  }
}
