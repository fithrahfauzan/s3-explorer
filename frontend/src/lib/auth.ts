import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { authApi, setUnauthorizedHandler, type AuthStatus } from '@/api';

export const AUTH_STATUS_QUERY_KEY = ['auth-status'];

export function useAuthStatus() {
  return useQuery({
    queryKey: AUTH_STATUS_QUERY_KEY,
    queryFn: authApi.getStatus,
  });
}

// Registers the global 401 handler so an expired/invalidated session flips
// the cached auth status immediately, instead of waiting for a refetch.
export function useUnauthorizedHandler() {
  const queryClient = useQueryClient();
  useEffect(() => {
    setUnauthorizedHandler(() => markUnauthenticated(queryClient));
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);
}

function markUnauthenticated(queryClient: QueryClient) {
  queryClient.setQueryData<AuthStatus>(AUTH_STATUS_QUERY_KEY, (prev) =>
    prev ? { ...prev, authenticated: false } : prev
  );
}
