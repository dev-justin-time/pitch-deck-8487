import { useMutation, useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import { useRefreshAll } from "../hooks/refresh";

export function useTaskBoard() {
  return useQuery(orpc.clout.board.queryOptions({ staleTime: Infinity }));
}
export function useMyTasks(enabled: boolean) {
  return useQuery(orpc.clout.mine.queryOptions({ enabled }));
}
export function useTaskQueue(enabled: boolean) {
  return useQuery(orpc.clout.queue.queryOptions({ enabled }));
}
export function useReviewTask() {
  const refresh = useRefreshAll();
  return useMutation(orpc.clout.reviewTask.mutationOptions({ onSuccess: refresh }));
}
export function useFinalizeProposal() {
  const refresh = useRefreshAll();
  return useMutation(orpc.governance.finalize.mutationOptions({ onSuccess: refresh }));
}
export function useClaimTask() {
  const refresh = useRefreshAll();
  return useMutation(orpc.clout.claim.mutationOptions({ onSuccess: refresh }));
}
export function useSubmitTask() {
  const refresh = useRefreshAll();
  return useMutation(orpc.clout.submit.mutationOptions({ onSuccess: refresh }));
}
export function useProposals() {
  return useQuery(orpc.governance.proposals.queryOptions());
}
export function usePropose() {
  const refresh = useRefreshAll();
  return useMutation(orpc.governance.propose.mutationOptions({ onSuccess: refresh }));
}
export function useVote() {
  const refresh = useRefreshAll();
  return useMutation(orpc.governance.vote.mutationOptions({ onSuccess: refresh }));
}
export function useReserve() {
  return useQuery(orpc.governance.reserve.queryOptions());
}
