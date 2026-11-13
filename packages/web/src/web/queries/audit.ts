import { useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useAuditTrail(enabled: boolean, filter?: { action?: string; outcome?: "accepted" | "rejected" }) {
  return useQuery(orpc.audit.recent.queryOptions({ input: { limit: 60, ...filter }, enabled }));
}
export function useReconciliation(enabled: boolean) {
  return useQuery(orpc.audit.reconciliation.queryOptions({ enabled, staleTime: 15_000 }));
}
