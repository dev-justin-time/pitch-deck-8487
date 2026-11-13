import { useMutation, useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import { useRefreshAll } from "../hooks/refresh";

export function usePortfolio(enabled: boolean) {
  return useQuery(orpc.payouts.portfolio.queryOptions({ enabled }));
}
export function useDistributions(projectId: number) {
  return useQuery(
    orpc.payouts.history.queryOptions({ input: { projectId }, enabled: Number.isFinite(projectId) && projectId > 0 }),
  );
}
export function useReportRevenue() {
  const refresh = useRefreshAll();
  return useMutation(orpc.payouts.report.mutationOptions({ onSuccess: refresh }));
}
export function useEscrowQueue(enabled: boolean) {
  return useQuery(orpc.escrow.queue.queryOptions({ enabled }));
}
export function useEscrowReview() {
  const refresh = useRefreshAll();
  return useMutation(orpc.escrow.review.mutationOptions({ onSuccess: refresh }));
}
