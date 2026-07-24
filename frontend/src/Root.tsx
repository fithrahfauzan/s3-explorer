import { Outlet } from '@tanstack/react-router'
import { Toaster } from './components/ui/toast'

export function Root() {
  return (
    <div className="min-h-screen flex flex-col font-sans">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 h-14 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" />
          <h1 className="font-mono text-sm tracking-tight text-foreground">
            <span className="text-muted-foreground">s3://</span>
            <span className="font-medium">explorer</span>
          </h1>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>

      <Toaster />
    </div>
  )
}
