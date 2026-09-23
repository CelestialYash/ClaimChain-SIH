/** Minimal human-readable ABI for ClaimAuditTrail — only what the API uses. */
export const CLAIM_AUDIT_TRAIL_ABI = [
  'function sealClaimState(bytes32 claimId, bytes32 stateHash, uint8 status, string note)',
  'function getAuditTrail(bytes32 claimId) view returns (tuple(bytes32 stateHash, bytes32 prevRecordHash, bytes32 recordHash, uint8 status, uint64 timestamp, address recordedBy, string note)[])',
  'function verifyTrail(bytes32 claimId) view returns (bool valid, uint256 brokenAtIndex)',
  'function latestRecordHash(bytes32 claimId) view returns (bytes32)',
  'function getTrailLength(bytes32 claimId) view returns (uint256)',
  'function totalRecords() view returns (uint256)',
  'function owner() view returns (address)',
  'event ClaimStateSealed(bytes32 indexed claimId, bytes32 indexed stateHash, bytes32 recordHash, bytes32 prevRecordHash, uint8 status, uint64 timestamp, address indexed recordedBy)',
];
