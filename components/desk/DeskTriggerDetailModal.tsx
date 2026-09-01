"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import { Spinner } from "@/components/ui/Feedback";
import { formatChatTime } from "@/lib/chat-time";
import {
  formatTriggerAction,
  formatTriggerActionDetail,
  formatTriggerCondition,
  formatTriggerNotional,
  isProfitTriggerCondition,
  type DeskTrigger,
} from "@/lib/triggers";

type DeskTriggerDetailModalProps = {
  open: boolean;
  trigger: DeskTrigger | null;
  busy?: boolean;
  paperCash?: number;
  openSymbols?: string[];
  onClose: () => void;
  onToggle: (enabled: boolean) => void;
  onAutoPauseChange: (autoPauseAfterFire: boolean) => void;
  onRemove: () => void;
};

function readinessNote(
  trigger: DeskTrigger,
  paperCash: number | undefined,
  openSymbols: string[],
): string | null {
  const owns = openSymbols.some(
    (s) => s.toUpperCase() === trigger.symbol.toUpperCase(),
  );
  if (trigger.action === "paper_sell" && !owns) {
    const canArmAhead =
      isProfitTriggerCondition(trigger.condition.kind) ||
      trigger.condition.kind === "day_gain_pct" ||
      trigger.condition.kind === "price_above";
    if (canArmAhead) {
      return "No open lot yet — this take-profit rule stays paused until you hold the name.";
    }
    return "No open lot — this sell rule will stay paused until you hold the name.";
  }
  if (
    trigger.action === "paper_buy" &&
    paperCash != null &&
    paperCash < trigger.notionalUsd
  ) {
    return `Cash is tight — need ${formatTriggerNotional(trigger.notionalUsd)} to fire (have ${formatTriggerNotional(Math.floor(paperCash))}).`;
  }
  return null;
}

/** Full breakdown for one armed trigger — toggle, remove, or close. */
export function DeskTriggerDetailModal({
  open,
  trigger,
  busy = false,
  paperCash,
  openSymbols = [],
  onClose,
  onToggle,
  onAutoPauseChange,
  onRemove,
}: DeskTriggerDetailModalProps) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

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

  if (!mounted || !open || !trigger) return null;

  const note = readinessNote(trigger, paperCash, openSymbols);
  const lastFired = trigger.lastFiredAt
    ? formatChatTime(trigger.lastFiredAt)
    : null;

  return createPortal(
    <div
      className="modal-overlay fade-up"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="modal-card desk-trigger-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <p className="font-mono-label">Trigger</p>
        <div className="desk-trigger-detail-head">
          <h3 id={titleId} className="modal-title desk-trigger-detail-symbol">
            {trigger.symbol}
          </h3>
          <span
            className={`desk-trigger-status ${
              trigger.enabled ? "is-on" : "is-paused"
            }`}
          >
            {trigger.enabled ? "Armed" : "Paused"}
          </span>
        </div>

        <dl className="desk-trigger-detail-grid">
          <div>
            <dt>When</dt>
            <dd>{formatTriggerCondition(trigger.condition)}</dd>
          </div>
          <div>
            <dt>Then</dt>
            <dd>
              <span
                className={`desk-trigger-action desk-trigger-action--${trigger.action}`}
              >
                {formatTriggerAction(trigger.action)}
              </span>
              {trigger.action === "paper_buy" ? (
                <span className="desk-trigger-size">
                  {formatTriggerNotional(trigger.notionalUsd)}
                </span>
              ) : trigger.action === "paper_sell" &&
                trigger.sellCloseMode !== "all" ? (
                <span className="desk-trigger-size">
                  {formatTriggerActionDetail(trigger).replace(/^Paper sell /, "")}
                </span>
              ) : trigger.action === "paper_sell" ? (
                <span className="desk-trigger-size">All</span>
              ) : null}
            </dd>
          </div>
          {lastFired ? (
            <div>
              <dt>Last fired</dt>
              <dd>{lastFired}</dd>
            </div>
          ) : null}
          <div>
            <dt>After fire</dt>
            <dd>
              <label className="desk-add-check">
                <input
                  type="checkbox"
                  checked={trigger.autoPauseAfterFire}
                  disabled={busy}
                  onChange={(e) => onAutoPauseChange(e.target.checked)}
                />
                <span>Pause rule after it fires</span>
              </label>
            </dd>
          </div>
        </dl>

        {note ? (
          <p className="desk-add-warn" role="status">
            {note}
          </p>
        ) : (
          <p className="desk-add-hint">
            Checked on cron and Scan now · 24h cooldown while armed
            {trigger.autoPauseAfterFire ? " · auto-pauses after a successful fire" : ""}
          </p>
        )}

        <div className="modal-actions desk-trigger-detail-actions">
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => onToggle(!trigger.enabled)}
          >
            {busy ? (
              <span className="inline-flex items-center gap-1.5">
                <Spinner size="sm" label="Updating" />
                Updating…
              </span>
            ) : trigger.enabled ? (
              "Pause"
            ) : (
              "Arm"
            )}
          </button>
          <button
            type="button"
            className="btn-primary !bg-[color-mix(in_srgb,var(--orange)_88%,var(--ink))]"
            disabled={busy}
            onClick={onRemove}
          >
            Remove
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
