import { Outlet } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'
import { Toaster } from './components/ui/toast'
import { Button } from './components/ui/button'
import { AuthGate } from './components/AuthGate'
import { AUTH_STATUS_QUERY_KEY, useAuthStatus, useUnauthorizedHandler } from './lib/auth'
import { authApi } from './api'

function LogoutButton() {
  const { data } = useAuthStatus()
  const queryClient = useQueryClient()
  const logoutMutation = useMutation({
    mutationFn: authApi.logout,
    onSettled: () => queryClient.invalidateQueries({ queryKey: AUTH_STATUS_QUERY_KEY }),
  })

  if (!data?.auth_enabled || !data.authenticated) return null

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => logoutMutation.mutate()}
      disabled={logoutMutation.isPending}
      title="Sign out"
    >
      <LogOut className="w-4 h-4" />
    </Button>
  )
}

export function Root() {
  useUnauthorizedHandler()

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" />
            <h1 className="font-mono text-sm tracking-tight text-foreground">
              <span className="text-muted-foreground">s3://</span>
              <span className="font-medium">explorer</span>
            </h1>
          </div>
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        <AuthGate>
          <Outlet />
        </AuthGate>
      </main>

      <Toaster />
    </div>
  )
}
