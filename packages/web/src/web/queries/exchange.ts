import { useMutation, useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import { useRefreshAll } from "../hooks/refresh";

export function usePointRate() {
  return useQuery(orpc.exchange.rate.queryOptions());
}
export function usePointBook() {
  return useQuery(orpc.exchange.book.queryOptions());
}
export function useEquityBook() {
  return useQuery(orpc.exchange.equityBook.queryOptions());
}
export function useMyListings(enabled: boolean) {
  return useQuery(orpc.exchange.myListings.queryOptions({ enabled }));
}
export function useCancelEquityListing() {
  const refresh = useRefreshAll();
  return useMutation(orpc.exchange.cancelEquityListing.mutationOptions({ onSuccess: refresh }));
}
export function useSellPoints() {
  const refresh = useRefreshAll();
  return useMutation(orpc.exchange.sellPoints.mutationOptions({ onSuccess: refresh }));
}
export function useBuyPoints() {
  const refresh = useRefreshAll();
  return useMutation(orpc.exchange.buyPoints.mutationOptions({ onSuccess: refresh }));
}
export function useCancelListing() {
  const refresh = useRefreshAll();
  return useMutation(orpc.exchange.cancelListing.mutationOptions({ onSuccess: refresh }));
}
export function useListEquity() {
  const refresh = useRefreshAll();
  return useMutation(orpc.exchange.listEquity.mutationOptions({ onSuccess: refresh }));
}
export function useBuyEquity() {
  const refresh = useRefreshAll();
  return useMutation(orpc.exchange.buyEquity.mutationOptions({ onSuccess: refresh }));
}
