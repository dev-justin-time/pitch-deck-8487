import { useMutation, useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import { useRefreshAll } from "../hooks/refresh";

type Brand = "forge" | "orbital" | "sole";

export function useProjects(filter?: { brand?: Brand; status?: string }) {
  return useQuery(orpc.projects.list.queryOptions({ input: filter ?? {} }));
}

export function useProject(projectId: number) {
  return useQuery(
    orpc.projects.get.queryOptions({
      input: { projectId },
      enabled: Number.isFinite(projectId) && projectId > 0,
    }),
  );
}

export function useMyProjects(enabled: boolean) {
  return useQuery(orpc.projects.mine.queryOptions({ enabled }));
}

export function useFeeQuote(capitalGoalCents: number, riskTier: "low" | "medium" | "high") {
  return useQuery(
    orpc.projects.feeQuote.queryOptions({
      input: { capitalGoalCents: Math.max(10000, capitalGoalCents), riskTier },
      placeholderData: (prev) => prev,
    }),
  );
}

export function usePitch() {
  const refresh = useRefreshAll();
  return useMutation(orpc.projects.pitch.mutationOptions({ onSuccess: refresh }));
}

export function useComment() {
  const refresh = useRefreshAll();
  return useMutation(orpc.projects.comment.mutationOptions({ onSuccess: refresh }));
}

export function useSubmitMilestone() {
  const refresh = useRefreshAll();
  return useMutation(orpc.projects.submitMilestone.mutationOptions({ onSuccess: refresh }));
}

export function useCancelProject() {
  const refresh = useRefreshAll();
  return useMutation(orpc.projects.cancel.mutationOptions({ onSuccess: refresh }));
}
