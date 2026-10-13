import { useMemo } from 'react';
import { useAuth } from '@clerk/react';
import {
  getGetModelProjectionsQueryKey,
  useGetModelProjections,
  type GetModelProjectionsParams,
} from '@workspace/api-client-react';
import useMembership from '@/hooks/use-membership';

export function useModelProjections(params: GetModelProjectionsParams, active = true) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const signedIn = isLoaded && isSignedIn === true;
  const membership = useMembership(signedIn);
  const verified = signedIn
    && membership.isSuccess
    && !membership.isFetching
    && membership.data?.signedIn === true
    && membership.data.ready === true
    && membership.data.hasAccess === true
    && membership.data.error == null
    && !['unavailable', 'error'].includes(membership.data.status.toLowerCase());
  const queryKey = useMemo(
    () => [...getGetModelProjectionsQueryKey(params), { clerkUserId: signedIn ? userId ?? 'signed-in' : 'signed-out' }] as const,
    [params, signedIn, userId],
  );
  const query = useGetModelProjections(params, {
    query: {
      queryKey,
      enabled: active && verified,
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      retry: 1,
      refetchInterval: (current) => current.state.data?.status === 'warming' ? 3000 : false,
    },
  });
  const sheet = verified && !query.isError && query.data?.status !== 'locked' ? query.data : undefined;
  return { sheet, query, membership, verified, signedIn };
}
