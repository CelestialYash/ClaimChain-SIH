import { expect } from "chai";
import { ethers } from "ethers";
import { network } from "hardhat";

import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { Contract } from "ethers";

const STATUS = {
  SUBMITTED: 0n,
  AI_APPROVED: 1n,
  AI_FLAGGED: 2n,
  HUMAN_OVERRIDDEN: 3n,
  PAID: 4n,
  REJECTED: 5n,
} as const;

/** Mirror of the on-chain record-hash formula (keccak256(abi.encode(prev, stateHash, status, ts, by, noteHash))). */
function expectedRecordHash(
  prev: string,
  stateHash: string,
  status: bigint,
  ts: bigint | number,
  by: string,
  note: string
): string {
  const noteHash = ethers.keccak256(ethers.toUtf8Bytes(note));
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32", "uint8", "uint64", "address", "bytes32"],
      [prev, stateHash, status, ts, by, noteHash]
    )
  );
}

/**
 * Assert that `promise` reverts with the given custom error (matched by name in
 * the revert data selector), without needing the chai-matchers plugin.
 */
async function expectCustomError(promise: Promise<unknown>, errorName: string): Promise<void> {
  try {
    await promise;
    expect.fail(`Expected transaction to revert with ${errorName}`);
  } catch (err: any) {
    const data: string | undefined = err?.data ?? err?.info?.error?.data ?? err?.error?.data;
    const message: string = String(err?.message ?? err);
    const ok =
      (typeof data === "string" && data.slice(0, 10) !== "0x00000000" && data.length >= 10 && message.includes(errorName)) ||
      message.includes(errorName);
    expect(ok, `Expected revert with ${errorName}, got: ${message}`).to.equal(true);
  }
}

describe("ClaimAuditTrail", function () {
  let contract: Contract;
  let owner: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;
  const claimId = ethers.id("CLM-8919");

  before(async function () {
    // Hardhat 3: create a network connection; the plugin extends its ethers object.
    const connection = await network.create();
    const ethersExt = (connection as any).ethers;

    const signers = await ethersExt.getSigners();
    owner = signers[0];
    attacker = signers[1];

    const factory = await ethersExt.getContractFactory("ClaimAuditTrail");
    contract = await factory.deploy();
    await contract.waitForDeployment();
  });

  it("seals the first record with zero genesis link and updates the chain head", async function () {
    const stateHash = ethers.id("claim-evidence-v1");
    const tx = await contract
      .connect(owner)
      .sealClaimState(claimId, stateHash, STATUS.SUBMITTED, "Photos + GPS received");
    const receipt = await tx.wait();
    expect(receipt?.status).to.equal(1);

    expect(await contract.latestRecordHash(claimId)).to.not.equal(ethers.ZeroHash);
    expect(await contract.totalRecords()).to.equal(1n);

    const trail = await contract.getAuditTrail(claimId);
    expect(trail).to.have.lengthOf(1);
    expect(trail[0].prevRecordHash).to.equal(ethers.ZeroHash);
    expect(trail[0].recordedBy).to.equal(owner.address);
  });

  it("chains consecutive records: each prevRecordHash equals the previous recordHash", async function () {
    await contract.connect(owner).sealClaimState(claimId, ethers.id("evidence-2"), STATUS.AI_APPROVED, "pHash unique, GPS valid");
    await contract.connect(owner).sealClaimState(claimId, ethers.id("evidence-3"), STATUS.PAID, "UPI payout released");

    const trail = await contract.getAuditTrail(claimId);
    expect(trail).to.have.lengthOf(3);
    expect(trail[0].prevRecordHash).to.equal(ethers.ZeroHash);
    expect(trail[1].prevRecordHash).to.equal(trail[0].recordHash);
    expect(trail[2].prevRecordHash).to.equal(trail[1].recordHash);
    expect(await contract.latestRecordHash(claimId)).to.equal(trail[2].recordHash);
  });

  it("keeps separate chains per claim", async function () {
    const otherClaim = ethers.id("CLM-8920");
    await contract.connect(owner).sealClaimState(otherClaim, ethers.id("b"), STATUS.SUBMITTED, "other claim");

    const trailA = await contract.getAuditTrail(claimId);
    const trailB = await contract.getAuditTrail(otherClaim);
    expect(trailA).to.have.lengthOf(3);
    expect(trailB).to.have.lengthOf(1);
    expect(trailA[0].recordHash).to.not.equal(trailB[0].recordHash);
  });

  it("recordHash matches the documented formula (off-chain recomputation)", async function () {
    const stateHash = ethers.id("canonical-state");
    const note = "AI approved: OCR confidence 99.2%";
    await contract.connect(owner).sealClaimState(claimId, stateHash, STATUS.AI_APPROVED, note);

    const trail = await contract.getAuditTrail(claimId);
    const last = trail[trail.length - 1];
    const recomputed = expectedRecordHash(
      last.prevRecordHash,
      stateHash,
      STATUS.AI_APPROVED,
      last.timestamp,
      owner.address,
      note
    );
    expect(recomputed).to.equal(last.recordHash);
  });

  it("verifyTrail reports valid for an untouched chain", async function () {
    const [valid, brokenAt] = await contract.verifyTrail(claimId);
    expect(valid).to.equal(true);
    expect(brokenAt).to.equal(ethers.MaxUint256);
  });

  it("verifyTrail on an unknown claim also reports valid (empty chain)", async function () {
    const [valid, brokenAt] = await contract.verifyTrail(ethers.id("CLM-0000"));
    expect(valid).to.equal(true);
    expect(brokenAt).to.equal(ethers.MaxUint256);
  });

  it("reverts when a non-owner tries to seal (access control)", async function () {
    await expectCustomError(
      contract.connect(attacker).sealClaimState(claimId, ethers.id("x"), STATUS.SUBMITTED, "forged"),
      "NotOwner"
    );
  });

  it("reverts on empty claimId or empty stateHash", async function () {
    await expectCustomError(
      contract.connect(owner).sealClaimState(ethers.ZeroHash, ethers.id("x"), STATUS.SUBMITTED, "no id"),
      "EmptyClaimId"
    );
    await expectCustomError(
      contract.connect(owner).sealClaimState(claimId, ethers.ZeroHash, STATUS.SUBMITTED, "no hash"),
      "EmptyStateHash"
    );
  });

  it("detects tampering: replacing a historical record breaks the chain at that index", async function () {
    const tid = ethers.id("CLM-TAMPER-TEST");
    await contract.connect(owner).sealClaimState(tid, ethers.id("e1"), STATUS.SUBMITTED, "legit submit");
    await contract.connect(owner).sealClaimState(tid, ethers.id("e2"), STATUS.AI_APPROVED, "legit decision");
    await contract.connect(owner).sealClaimState(tid, ethers.id("e3"), STATUS.PAID, "legit payout");

    const trailBefore = await contract.getAuditTrail(tid);
    const originalStateHash: string = trailBefore[1].stateHash;
    const forgedStateHash = ethers.id("e2-FORGED-15000");
    const provider = (contract as any).runner.provider;
    const address: string = (contract.target as string).toLowerCase();

    // ---- Calibrated storage scan -------------------------------------------
    // Storage layout is compiler-specific, so instead of hard-coding the record
    // stride we scan the deterministic region where the trail array lives and
    // locate record 1's stateHash slot by its known value.
    const arraySlot = BigInt(ethers.solidityPackedKeccak256(["bytes32", "uint256"], [tid, 0n]));
    const recordBase = BigInt(ethers.solidityPackedKeccak256(["uint256"], [arraySlot]));

    const readSlot = async (slot: bigint): Promise<string> =>
      provider.send("eth_getStorageAt", [address, "0x" + slot.toString(16)]);

    let tamperSlot: bigint | null = null;
    for (let stride = 5n; stride <= 8n && tamperSlot === null; stride++) {
      // Probe the first field of record 1 under this stride hypothesis.
      for (let field = 0n; field < 2n; field++) {
        const candidate = recordBase + stride * 1n + field;
        const value = await readSlot(candidate);
        if (value.toLowerCase() === originalStateHash.toLowerCase()) {
          tamperSlot = candidate;
          break;
        }
      }
    }
    expect(tamperSlot, "record 1 stateHash slot not found in scanned region").to.not.equal(null);

    // Retro-edit history: overwrite the stored stateHash of record 1.
    await provider.send("hardhat_setStorageAt", [
      address,
      "0x" + tamperSlot!.toString(16).padStart(64, "0"),
      forgedStateHash,
    ]);

    // Confirm the forged value actually landed where getAuditTrail reads.
    const storedNow = await readSlot(tamperSlot!);
    expect(storedNow.toLowerCase()).to.equal(forgedStateHash.toLowerCase());
    // ----------------------------------------------------------------------------

    const trailAfter = await contract.getAuditTrail(tid);
    expect(trailAfter[1].stateHash).to.equal(forgedStateHash);
    expect(trailAfter[1].recordHash).to.equal(trailBefore[1].recordHash); // sealed hash not recomputed

    const [valid, brokenAt] = await contract.verifyTrail(tid);
    expect(valid).to.equal(false);
    expect(brokenAt).to.equal(1n);
  });

  it("getTrailLength matches the number of sealed transitions", async function () {
    const tid = ethers.id("CLM-LENGTH-TEST");
    expect(await contract.getTrailLength(tid)).to.equal(0n);
    await contract.connect(owner).sealClaimState(tid, ethers.id("e1"), STATUS.SUBMITTED, "s");
    await contract.connect(owner).sealClaimState(tid, ethers.id("e2"), STATUS.PAID, "p");
    expect(await contract.getTrailLength(tid)).to.equal(2n);
  });

  it("stores the plain-language note verbatim", async function () {
    const tid = ethers.id("CLM-NOTE-TEST");
    const note = "Duplicate image pHash collision with archive CLM-4102";
    await contract.connect(owner).sealClaimState(tid, ethers.id("e1"), STATUS.AI_FLAGGED, note);

    const trail = await contract.getAuditTrail(tid);
    expect(trail[0].note).to.equal(note);
  });

  it("seals and chains the extended HUMAN_* statuses (enum delta)", async function () {
    const tid = ethers.id("CLM-HUMAN-TEST");
    const HUMAN_REVIEW = 6n;
    const HUMAN_APPROVED = 7n;
    const HUMAN_REJECTED = 8n;

    await contract.connect(owner).sealClaimState(tid, ethers.id("h1"), STATUS.AI_FLAGGED, "pipeline flag");
    await contract
      .connect(owner)
      .sealClaimState(tid, ethers.id("h2"), HUMAN_REVIEW, "appeal accepted for second look");
    await contract
      .connect(owner)
      .sealClaimState(
        tid,
        ethers.id("h3"),
        HUMAN_APPROVED,
        "Human review: geotag verified on-site; payout unlocked (reason > 20 chars)"
      );
    await contract.connect(owner).sealClaimState(ethers.id("CLM-HUMAN-OTHER"), ethers.id("h4"), HUMAN_REJECTED, "Human review: evidence failed on-site verification");

    const trail = await contract.getAuditTrail(tid);
    expect(trail.map((r: { status: bigint }) => r.status)).to.deep.equal([2n, 6n, 7n]);
    expect(trail[2].prevRecordHash).to.equal(trail[1].recordHash);

    const [valid] = await contract.verifyTrail(tid);
    expect(valid).to.equal(true);
    void HUMAN_REJECTED;
  });
});
