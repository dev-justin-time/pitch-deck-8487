import { useMutation, useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import { useRefreshAll } from "../hooks/refresh";

export function useDrawState(enabled: boolean) {
  return useQuery(orpc.draw.current.queryOptions({ enabled }));
}

export function useDrawNext() {
  const refresh = useRefreshAll();
  return useMutation(orpc.draw.next.mutationOptions({ onSuccess: refresh }));
}

export function useDecide() {
  const refresh = useRefreshAll();
  return useMutation(orpc.draw.decide.mutationOptions({ onSuccess: refresh }));
}

export function useInvest() {
  const refresh = useRefreshAll();
  return useMutation(orpc.draw.invest.mutationOptions({ onSuccess: refresh }));
}
