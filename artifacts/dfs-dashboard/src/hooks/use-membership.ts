import { useGetMembershipStatus, getGetMembershipStatusQueryKey } from '@workspace/api-client-react';
import { useAuth } from '@clerk/react';

export default function useMembership(signedIn: boolean) {
  const { userId } = useAuth();
  return useGetMembershipStatus({
    query: {
      queryKey: [...getGetMembershipStatusQueryKey(), { clerkUserId: signedIn ? userId : null }],
      enabled: signedIn,
      refetchOnMount: 'always',
      retry: 1,
    },
  });
}
