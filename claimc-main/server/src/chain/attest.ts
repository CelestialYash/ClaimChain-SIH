/** Shared response shape for the audit-trail endpoint (kept in sync with index.ts). */
export interface AuditTrailResponse {
  claimId: string;
  recordCount: number;
  integrity: {
    offChainValid: boolean;
    offChainBreakAtIndex: number | null;
    onChainValid: boolean;
    onChainBreakAtIndex: number | null;
  };
  records: Array<Record<string, unknown>>;
}
