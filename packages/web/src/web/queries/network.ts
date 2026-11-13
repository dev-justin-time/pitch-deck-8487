import { useMutation, useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import { useRefreshAll } from "../hooks/refresh";

export function useBrands() {
  return useQuery(orpc.network.brands.queryOptions({ staleTime: Infinity }));
}
export function useRules() {
  return useQuery(orpc.network.rules.queryOptions({ staleTime: Infinity }));
}
export function useCompliance() {
  return useQuery(orpc.network.compliance.queryOptions({ staleTime: Infinity }));
}
export function useNetworkStats() {
  return useQuery(orpc.network.stats.queryOptions());
}
export function useSeedStatus() {
  return useQuery(orpc.seed.status.queryOptions());
}
/** Admin-only on the server; the loader refuses to run on a network that already has data. */
export function useSeedRun() {
  const refresh = useRefreshAll();
  return useMutation(orpc.seed.run.mutationOptions({ onSuccess: refresh }));
}
