import { Outlet } from '@tanstack/react-router'
import { Toaster } from './components/ui/toast'

export function Root() {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans relative overflow-hidden">
      {/* Decorative background blobs for glassmorphism effect */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/30 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/30 rounded-full blur-[120px] pointer-events-none" />
      
      <header className="glass sticky top-0 z-10 p-4 border-b border-glass-border">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            S3 Explorer
          </h1>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 lg:p-8 z-0">
        <Outlet />
      </main>

      <Toaster />
    </div>
  )
}
