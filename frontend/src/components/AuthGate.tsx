import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuthStatus } from '@/lib/auth';
import { LoginPage } from '@/components/LoginPage';

export function AuthGate({ children }: { children: ReactNode }) {
  const { data, isLoading } = useAuthStatus();

  if (isLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="animate-spin w-6 h-6 text-primary" />
      </div>
    );
  }

  if (data?.auth_enabled && !data.authenticated) {
    return <LoginPage />;
  }

  return <>{children}</>;
}
