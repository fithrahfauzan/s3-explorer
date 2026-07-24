import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const ToastProvider = ToastPrimitive.Provider
const useToast = ToastPrimitive.useToastManager

function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Portal>
      <ToastPrimitive.Viewport
        data-slot="toast-viewport"
        className={cn(
          "fixed top-auto right-4 bottom-4 z-[100] mx-auto flex w-80 max-w-[calc(100%-2rem)] flex-col-reverse gap-2 outline-none sm:right-6 sm:bottom-6",
          className
        )}
        {...props}
      />
    </ToastPrimitive.Portal>
  )
}

function ToastItem({
  className,
  toast,
  ...props
}: ToastPrimitive.Root.Props) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      toast={toast}
      className={cn(
        "relative flex w-full items-start gap-2 rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg transition-all data-[type=error]:border-destructive/40 data-[type=success]:border-emerald-500/40 data-starting-style:translate-y-2 data-starting-style:opacity-0 data-ending-style:opacity-0",
        className
      )}
      {...props}
    />
  )
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn("text-sm font-medium", className)}
      {...props}
    />
  )
}

function ToastDescription({
  className,
  ...props
}: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function ToastClose({ className, ...props }: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label="Dismiss"
      className={cn(
        "absolute top-3 right-3 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground",
        className
      )}
      {...props}
    >
      <X className="size-3.5" />
    </ToastPrimitive.Close>
  )
}

function Toaster() {
  const { toasts } = useToast()
  return (
    <ToastViewport>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast}>
          <div className="flex-1 space-y-1">
            {toast.title && <ToastTitle>{toast.title}</ToastTitle>}
            {toast.description && (
              <ToastDescription>{toast.description}</ToastDescription>
            )}
          </div>
          <ToastClose />
        </ToastItem>
      ))}
    </ToastViewport>
  )
}

export { ToastProvider, Toaster, useToast }
