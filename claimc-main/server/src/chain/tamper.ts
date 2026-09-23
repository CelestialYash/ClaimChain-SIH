import { ethers } from 'ethers';

/**
 * Tamper-detection demo tooling.
 *
 * Simulates what a malicious insider could do to a *conventional* database:
 * reach into storage and rewrite a historical record — then proves that
 * ClaimChain's hash chain catches it (`verifyTrail` → brokenAtIndex).
 *
 * SAFETY: the slot write is only executed against a local EDR/Anvil-style
 * node (hardhat_setStorageAt). Every call site re-checks the guard below.
 */

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function isLocalRpc(rpcUrl: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(rpcUrl).hostname);
  } catch {
    return false;
  }
}

export function assertLocalRpc(rpcUrl: string): void {
  if (!isLocalRpc(rpcUrl)) {
    throw new Error(
      `Tamper simulation refused: ${rpcUrl} is not a local RPC. ` +
        'Forging storage is only allowed on a local sandbox node.'
    );
  }
}

export const readSlot = async (
  provider: ethers.JsonRpcApiProvider,
  address: string,
  slot: bigint
): Promise<string> => {
  const hex = '0x' + slot.toString(16);
  return provider.send('eth_getStorageAt', [address, hex]);
};

export const writeSlot = async (
  provider: ethers.JsonRpcApiProvider,
  address: string,
  slot: bigint,
  value: string
): Promise<void> => {
  const slotHex = '0x' + slot.toString(16).padStart(64, '0');
  const valueHex = value.startsWith('0x') ? value : '0x' + value;
  await provider.send('hardhat_setStorageAt', [address, slotHex, valueHex]);
};

/**
 * Locate the storage slot holding `stateHash` of `recordIndex` in the
 * `_trails[claimId]` array by scanning a small region around the
 * deterministic array base with several candidate record strides.
 *
 * The AuditRecord struct is 6 slots with solc 0.8.20 layout (status/timestamp/
 * recordedBy packed into one slot), but the scan stays stride-agnostic so a
 * compiler upgrade cannot silently break the demo.
 *
 * Returns null when the value cannot be found (should not happen on a local
 * node with a sealed trail).
 */
export async function findStateHashSlot(
  provider: ethers.JsonRpcApiProvider,
  address: string,
  claimIdBytes32: string,
  recordIndex: number,
  expectedStateHash: string
): Promise<bigint | null> {
  // _trails lives at storage slot 0: mapping key claimId → array.
  const arraySlot = BigInt(
    ethers.solidityPackedKeccak256(['bytes32', 'uint256'], [claimIdBytes32, 0n])
  );
  const recordBase = BigInt(ethers.solidityPackedKeccak256(['uint256'], [arraySlot]));

  for (let stride = 5n; stride <= 8n; stride++) {
    for (let field = 0n; field < 2n; field++) {
      const candidate = recordBase + stride * BigInt(recordIndex) + field;
      const value = await readSlot(provider, address, candidate);
      if (value.toLowerCase() === expectedStateHash.toLowerCase()) {
        return candidate;
      }
    }
  }
  return null;
}
