import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createRun,
  createManualRun,
  createPlan,
  createRunReport,
  deleteRun,
  deletePlan,
  getCalendar,
  getRunDetail,
  getRunReport,
  getRuns,
  getStats,
  getUserProfile,
  patchUserProfile,
  updatePlan,
  type RunUpload,
  type UserProfilePatch,
} from './client';
import { dequeueRun } from '../store/upload-queue';

export function useCompleteOnboarding(token: string | null) {
  return useMutation({
    mutationFn: (profile: UserProfilePatch) => {
      if (!token) {
        throw new Error('인증 정보가 없어요. 다시 시작해 주세요.');
      }
      return patchUserProfile(token, profile);
    },
  });
}

function requireToken(token: string | null): string {
  if (!token) throw new Error('인증 정보가 없어요. 다시 시작해 주세요.');
  return token;
}

export function useProfile(token: string | null) {
  return useQuery({
    queryKey: ['profile'],
    queryFn: () => getUserProfile(requireToken(token)),
    enabled: Boolean(token),
  });
}

export function useUpdateProfile(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profile: UserProfilePatch) => patchUserProfile(requireToken(token), profile),
    onSuccess: (profile) => queryClient.setQueryData(['profile'], profile),
  });
}

export function useStats(token: string | null) {
  return useQuery({
    queryKey: ['stats'],
    queryFn: () => getStats(requireToken(token)),
    enabled: Boolean(token),
  });
}

export function useRuns(token: string | null) {
  return useQuery({
    queryKey: ['runs'],
    queryFn: () => getRuns(requireToken(token)),
    enabled: Boolean(token),
  });
}

export function useRunReport(token: string | null, runId: string | null) {
  return useQuery({
    queryKey: ['report', runId],
    queryFn: () => getRunReport(requireToken(token), runId!),
    enabled: Boolean(token && runId),
    retry: false,
  });
}

export function useRunDetail(token: string | null, runId: string | null) {
  return useQuery({
    queryKey: ['run', runId],
    queryFn: () => getRunDetail(requireToken(token), runId!),
    enabled: Boolean(token && runId),
  });
}

export function useCalendar(token: string | null, year: number, month: number) {
  return useQuery({
    queryKey: ['calendar', year, month],
    queryFn: () => getCalendar(requireToken(token), year, month),
    enabled: Boolean(token),
  });
}

export function useUploadRun(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (run: RunUpload) => createRun(requireToken(token), run),
    onSuccess: async (_createdRun, run) => {
      dequeueRun(run.clientRunId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['runs'] }),
        queryClient.invalidateQueries({ queryKey: ['stats'] }),
        queryClient.invalidateQueries({ queryKey: ['calendar'] }),
      ]);
    },
  });
}

export function useCreateReport(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => createRunReport(requireToken(token), runId),
    onSuccess: (report) => queryClient.setQueryData(['report', report.runId], report),
  });
}

export function useDeleteRun(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => deleteRun(requireToken(token), runId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['runs'] }),
        queryClient.invalidateQueries({ queryKey: ['stats'] }),
        queryClient.invalidateQueries({ queryKey: ['calendar'] }),
      ]);
    },
  });
}

export function useCreatePlan(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { plannedDate: string; goalType: 'TIME' | 'DISTANCE'; goalValue: number; memo?: string }) => createPlan(requireToken(token), input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
  });
}

export function useUpdatePlan(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { planId: string; goalType?: 'TIME' | 'DISTANCE'; goalValue?: number; memo?: string; status?: 'PLANNED' | 'DONE' | 'SKIPPED' }) => {
      const { planId, ...patch } = input;
      return updatePlan(requireToken(token), planId, patch);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
  });
}

export function useDeletePlan(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (planId: string) => deletePlan(requireToken(token), planId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
  });
}

export function useCreateManualRun(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { clientRunId: string; startedAt: string; durationSec: number; distanceM?: number; memo?: string }) => createManualRun(requireToken(token), input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['runs'] }),
        queryClient.invalidateQueries({ queryKey: ['stats'] }),
        queryClient.invalidateQueries({ queryKey: ['calendar'] }),
      ]);
    },
  });
}
