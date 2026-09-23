// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ClaimAuditTrail
 * @notice Immutable, hash-chained audit trail for ClaimChain insurance claims.
 *
 * Every claim state transition (SUBMITTED → AI decision → human override → payout)
 * is sealed as an `AuditRecord`. Each record's hash embeds the hash of the previous
 * record for the same claim, forming a verifiable hash chain (the "blockchain memory"
 * from the ClaimChain pitch). Any retro-edit of historical data breaks the chain and
 * is detected by `verifyTrail`.
 */
contract ClaimAuditTrail {
    enum ClaimStatus {
        SUBMITTED,
        AI_APPROVED,
        AI_FLAGGED,
        HUMAN_OVERRIDDEN,
        PAID,
        REJECTED,
        HUMAN_REVIEW,
        HUMAN_APPROVED,
        HUMAN_REJECTED
    }

    struct AuditRecord {
        bytes32 stateHash;      // keccak256(canonical claim data + pHash + timestamp) computed off-chain
        bytes32 prevRecordHash; // recordHash of the previous record in this claim's chain (genesis = 0x0)
        bytes32 recordHash;     // keccak256(abi.encode(prevRecordHash, stateHash, status, timestamp, recordedBy, noteHash))
        ClaimStatus status;
        uint64 timestamp;
        address recordedBy;
        string note;            // plain-language reason (e.g. "pHash collision, human override")
    }

    /// @notice Account authorized to seal state transitions (the claims engine / API signer).
    address public immutable owner;

    /// @notice claimId => chronological audit trail.
    mapping(bytes32 => AuditRecord[]) private _trails;

    /// @notice claimId => recordHash of the newest sealed record (chain head).
    mapping(bytes32 => bytes32) public latestRecordHash;

    /// @notice Total records sealed across all claims (for dashboard metrics).
    uint256 public totalRecords;

    event ClaimStateSealed(
        bytes32 indexed claimId,
        bytes32 indexed stateHash,
        bytes32 recordHash,
        bytes32 prevRecordHash,
        ClaimStatus status,
        uint64 timestamp,
        address indexed recordedBy
    );

    error NotOwner(address caller);
    error EmptyClaimId();
    error EmptyStateHash();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Seal a claim state transition onto the immutable ledger.
     * @param claimId    Unique claim identifier as bytes32 (e.g. keccak256("CLM-8919") or a packed id).
     * @param stateHash  Off-chain canonical state hash of the claim evidence.
     * @param status     New claim status after this transition.
     * @param note       Plain-language reason, sealed with the record and included in the chain hash.
     */
    function sealClaimState(
        bytes32 claimId,
        bytes32 stateHash,
        ClaimStatus status,
        string calldata note
    ) external onlyOwner {
        if (claimId == bytes32(0)) revert EmptyClaimId();
        if (stateHash == bytes32(0)) revert EmptyStateHash();

        bytes32 prev = latestRecordHash[claimId];
        uint64 ts = uint64(block.timestamp);
        address by = msg.sender;
        bytes32 noteHash = keccak256(bytes(note));

        // Chained: this record's hash commits to the entire preceding chain.
        bytes32 recordHash = keccak256(abi.encode(prev, stateHash, status, ts, by, noteHash));

        _trails[claimId].push(
            AuditRecord({
                stateHash: stateHash,
                prevRecordHash: prev,
                recordHash: recordHash,
                status: status,
                timestamp: ts,
                recordedBy: by,
                note: note
            })
        );
        latestRecordHash[claimId] = recordHash;
        unchecked {
            ++totalRecords;
        }

        emit ClaimStateSealed(claimId, stateHash, recordHash, prev, status, ts, by);
    }

    /// @notice Full chronological audit trail for a claim.
    function getAuditTrail(bytes32 claimId) external view returns (AuditRecord[] memory) {
        return _trails[claimId];
    }

    /// @notice Number of sealed transitions for a claim.
    function getTrailLength(bytes32 claimId) external view returns (uint256) {
        return _trails[claimId].length;
    }

    /**
     * @notice Verify the integrity of a claim's hash chain.
     * @return valid          True when every record's hash reproduces from its fields
     *                         and correctly chains to its predecessor.
     * @return brokenAtIndex  Index of the first broken record, or `type(uint256).max` when valid.
     */
    function verifyTrail(bytes32 claimId) external view returns (bool valid, uint256 brokenAtIndex) {
        AuditRecord[] storage trail = _trails[claimId];
        uint256 n = trail.length;

        for (uint256 i = 0; i < n; ++i) {
            AuditRecord storage r = trail[i];

            bytes32 expected = keccak256(
                abi.encode(r.prevRecordHash, r.stateHash, r.status, r.timestamp, r.recordedBy, keccak256(bytes(r.note)))
            );

            bool hashOk = expected == r.recordHash;
            bool linkOk = i == 0 ? r.prevRecordHash == bytes32(0) : r.prevRecordHash == trail[i - 1].recordHash;

            if (!hashOk || !linkOk) {
                return (false, i);
            }
        }
        return (true, type(uint256).max);
    }
}
