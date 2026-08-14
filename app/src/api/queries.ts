import { useMutation } from '@tanstack/react-query';

import { patchUserProfile, type UserProfilePatch } from './client';

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
