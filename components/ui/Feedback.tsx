"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Spinner({
  size = "md",
  label = "Loading",
}: {
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  return (
    <span
      className={`spinner spinner-${size}`}
      role="status"
      aria-label={label}
    />
  );
}

export function PulseDots({ label = "Working" }: { label?: string }) {
  return (
    <span className="pulse-dots" role="status" aria-label={label}>
      <span />
      <span />
      <span />
    </span>
  );
}

export function Skeleton({
  className = "",
  lines = 1,
}: {
  className?: string;
  lines?: number;
}) {
  return (
    <div className={`space-y-2 ${className}`.trim()} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ width: `${88 - (i % 3) * 12}%` }}
        />
      ))}
    </div>
  );
}

export type ToastKind = "info" | "ok" | "warn" | "busy";

export type ToastState = {
  kind: ToastKind;
  message: string;
} | null;

export function StatusToast({
  toast,
  onDismiss,
}: {
  toast: ToastState;
  onDismiss?: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!toast || !mounted) return null;

  return createPortal(
    <div className="status-toast-host" role="presentation">
      <div
        className={`status-toast status-toast-${toast.kind} fade-up`}
        role="status"
        aria-live="polite"
      >
        <span className="flex items-center gap-2">
          {toast.kind === "busy" && <Spinner size="sm" label={toast.message} />}
          {toast.kind === "ok" && <span aria-hidden>✓</span>}
          {toast.kind === "warn" && <span aria-hidden>!</span>}
          {toast.kind === "info" && <span aria-hidden>i</span>}
          <span>{toast.message}</span>
        </span>
        {onDismiss && toast.kind !== "busy" && (
          <button
            type="button"
            className="status-toast-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss message"
            title="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function EmptyHint({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-hint fade-up">
      <p className="font-mono-label mb-1">{title}</p>
      <p className="text-sm leading-relaxed text-[var(--muted)]">{body}</p>
      {children}
    </div>
  );
}

export function BusyBanner({
  active,
  message,
}: {
  active: boolean;
  message: string;
}) {
  if (!active) return null;
  return (
    <div className="busy-banner fade-up" role="status" aria-live="polite">
      <Spinner size="sm" label={message} />
      <span>{message}</span>
      <PulseDots label={message} />
    </div>
  );
}
