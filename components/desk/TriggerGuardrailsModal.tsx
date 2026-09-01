"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import { Spinner } from "@/components/ui/Feedback";
import type { DeskSettings } from "@/lib/desk-settings";

type TriggerGuardrailsModalProps = {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  settings: DeskSettings | null;
  onClose: () => void;
  onSave: (patch: {
    guardrailsEnabled: boolean;
    maxSymbolExposureUsd: number;
    maxTriggerBuysPerDay: number;
    maxTriggerSpendPerDayUsd: number;
    pauseTriggerBuysWhenBookDownPct: number;
  }) => Promise<boolean>;
};

/** Edit trigger spending / exposure limits (enforced on trigger paper buys). */
export function TriggerGuardrailsModal({
  open,
  busy = false,
  error = null,
  settings,
  onClose,
  onSave,
}: TriggerGuardrailsModalProps) {
  const [mounted, setMounted] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [maxSymbol, setMaxSymbol] = useState("15000");
  const [maxBuys, setMaxBuys] = useState("5");
  const [maxSpend, setMaxSpend] = useState("10000");
  const [pauseDown, setPauseDown] = useState("3");
  const [localError, setLocalError] = useState<string | null>(null);
  const titleId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !settings) return;
    setEnabled(settings.guardrailsEnabled);
    setMaxSymbol(String(settings.maxSymbolExposureUsd));
    setMaxBuys(String(settings.maxTriggerBuysPerDay));
    setMaxSpend(String(settings.maxTriggerSpendPerDayUsd));
    setPauseDown(String(settings.pauseTriggerBuysWhenBookDownPct));
    setLocalError(null);
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, busy, onClose]);

  if (!mounted || !open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const maxSymbolExposureUsd = Number(maxSymbol);
    const maxTriggerBuysPerDay = Number(maxBuys);
    const maxTriggerSpendPerDayUsd = Number(maxSpend);
    const pauseTriggerBuysWhenBookDownPct = Number(pauseDown);
    if (
      !Number.isFinite(maxSymbolExposureUsd) ||
      maxSymbolExposureUsd < 500
    ) {
      setLocalError("Max per symbol must be at least $500.");
      return;
    }
    if (
      !Number.isFinite(maxTriggerBuysPerDay) ||
      maxTriggerBuysPerDay < 1
    ) {
      setLocalError("Daily buy cap must be at least 1.");
      return;
    }
    if (
      !Number.isFinite(maxTriggerSpendPerDayUsd) ||
      maxTriggerSpendPerDayUsd < 100
    ) {
      setLocalError("Daily spend cap must be at least $100.");
      return;
    }
    if (
      !Number.isFinite(pauseTriggerBuysWhenBookDownPct) ||
      pauseTriggerBuysWhenBookDownPct <= 0
    ) {
      setLocalError("Pause threshold must be a positive %.");
      return;
    }
    setLocalError(null);
    const ok = await onSave({
      guardrailsEnabled: enabled,
      maxSymbolExposureUsd: Math.round(maxSymbolExposureUsd),
      maxTriggerBuysPerDay: Math.round(maxTriggerBuysPerDay),
      maxTriggerSpendPerDayUsd: Math.round(maxTriggerSpendPerDayUsd),
      pauseTriggerBuysWhenBookDownPct: pauseTriggerBuysWhenBookDownPct,
    });
    if (ok) onClose();
  }

  const err = localError ?? error;

  return createPortal(
    <div
      className="modal-overlay fade-up"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form
        className="modal-card desk-guardrails-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(e) => void submit(e)}
      >
        <p className="font-mono-label">Triggers</p>
        <h3 id={titleId} className="modal-title">
          Guardrails
        </h3>
        <p className="desk-add-lead">
          Limits on trigger paper buys — stops over-concentration and bad-day
          pile-ons while you sleep. Sells and alerts are not capped here.
        </p>

        <label className="desk-add-check">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>Enforce guardrails on trigger buys</span>
        </label>

        <label className="desk-add-label" htmlFor="gr-max-symbol">
          Max in one stock (position + armed buys)
        </label>
        <input
          id="gr-max-symbol"
          className="soft-field"
          inputMode="numeric"
          value={maxSymbol}
          disabled={busy || !enabled}
          onChange={(e) => setMaxSymbol(e.target.value)}
        />

        <label className="desk-add-label" htmlFor="gr-max-buys">
          Max trigger buys per day
        </label>
        <input
          id="gr-max-buys"
          className="soft-field"
          inputMode="numeric"
          value={maxBuys}
          disabled={busy || !enabled}
          onChange={(e) => setMaxBuys(e.target.value)}
        />

        <label className="desk-add-label" htmlFor="gr-max-spend">
          Max trigger spend per day (USD)
        </label>
        <input
          id="gr-max-spend"
          className="soft-field"
          inputMode="numeric"
          value={maxSpend}
          disabled={busy || !enabled}
          onChange={(e) => setMaxSpend(e.target.value)}
        />

        <label className="desk-add-label" htmlFor="gr-pause-down">
          Pause trigger buys when book is down (%)
        </label>
        <input
          id="gr-pause-down"
          className="soft-field"
          inputMode="decimal"
          value={pauseDown}
          disabled={busy || !enabled}
          onChange={(e) => setPauseDown(e.target.value)}
        />
        <p className="desk-add-hint">
          Example: 3 means skip new trigger buys while unrealized book PnL is
          −3% or worse.
        </p>

        {err ? (
          <p className="desk-add-warn" role="alert">
            {err}
          </p>
        ) : null}

        <div className="modal-actions">
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? (
              <span className="inline-flex items-center gap-1.5">
                <Spinner size="sm" label="Saving" />
                Saving…
              </span>
            ) : (
              "Save"
            )}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
