"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import { EmptyHint, Spinner } from "@/components/ui/Feedback";
import { formatChatTime } from "@/lib/chat-time";
import type { TradeHistoryRow, TradeHistorySummary } from "@/types";

export type PaperPositionRow = {
  id: string;
  symbol: string;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  costBasis: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
};

type PaperBookModalProps = {
  open: boolean;
  cash: number;
  equity: number;
  totalCost: number;
  totalMarketValue: number;
  totalUnrealizedPnl: number;
  totalUnrealizedPnlPct: number;
  positions: PaperPositionRow[];
  onClose: () => void;
  onAskSell?: (symbol: string) => void;
};

type BookTab = "open" | "history";

function sideLabel(row: TradeHistoryRow): string {
  if (row.event === "skip") return "Skip";
  return row.side === "buy" ? "Buy" : "Sell";
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPct(value: number): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

/** Holdings sheet — what you own in the paper book (fake cash, real marks). */
export function PaperBookModal({
  open,
  cash,
  equity,
  totalCost,
  totalMarketValue,
  totalUnrealizedPnl,
  totalUnrealizedPnlPct,
  positions,
  onClose,
  onAskSell,
}: PaperBookModalProps) {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<BookTab>("open");
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historySummary, setHistorySummary] = useState<TradeHistorySummary | null>(
    null,
  );
  const [historyRows, setHistoryRows] = useState<TradeHistoryRow[]>([]);
  const titleId = useId();
  const openPositions = positions.filter((p) => p.quantity > 0);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setTab("open");
    setHistoryError(null);
  }, [open]);

  useEffect(() => {
    if (!open || tab !== "history") return;
    let cancelled = false;
    setHistoryBusy(true);
    setHistoryError(null);
    void fetch("/api/desk/history?limit=40")
      .then(async (res) => {
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          summary?: TradeHistorySummary;
          entries?: TradeHistoryRow[];
        };
        if (!res.ok || data.ok === false) {
          throw new Error(data.error ?? "Couldn't load history");
        }
        if (cancelled) return;
        setHistorySummary(data.summary ?? null);
        setHistoryRows(data.entries ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setHistoryError(
          err instanceof Error ? err.message : "Couldn't load history",
        );
      })
      .finally(() => {
        if (!cancelled) setHistoryBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="modal-overlay modal-overlay-sheet fade-up"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card paper-book-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex shrink-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono-label">Paper book</p>
            <h3 id={titleId} className="modal-title !mt-0.5 text-xl sm:text-2xl">
              {tab === "open" ? "Your holdings" : "Trade history"}
            </h3>
          </div>
          <button
            type="button"
            className="btn-primary shrink-0 !px-3.5 !py-2 text-sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="mt-3 flex shrink-0 gap-2">
          <button
            type="button"
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              tab === "open"
                ? "bg-[color-mix(in_srgb,var(--ink)_88%,var(--mix))] text-[var(--white)]"
                : "bg-[color-mix(in_srgb,var(--ink)_8%,var(--mix))] text-[var(--muted)]"
            }`}
            onClick={() => setTab("open")}
          >
            Open
          </button>
          <button
            type="button"
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              tab === "history"
                ? "bg-[color-mix(in_srgb,var(--ink)_88%,var(--mix))] text-[var(--white)]"
                : "bg-[color-mix(in_srgb,var(--ink)_8%,var(--mix))] text-[var(--muted)]"
            }`}
            onClick={() => setTab("history")}
          >
            History
          </button>
        </div>

        {tab === "open" ? (
          <>
        <p className="mt-2 shrink-0 text-[0.75rem] leading-snug text-[var(--muted)]">
          Fake $100k cash · real market prices. Equity = cash left + what open
          positions are worth. PnL = how much those positions are up or down vs
          what you paid.
        </p>

        <div className="mt-3 grid shrink-0 grid-cols-2 gap-2 text-[0.7rem] sm:grid-cols-4">
          <div className="rounded-[14px] bg-[color-mix(in_srgb,var(--yellow)_28%,var(--mix))] px-2.5 py-2">
            <p className="font-mono-label">Equity</p>
            <p className="truncate font-semibold text-[var(--ink)]">
              {formatUsd(equity)}
            </p>
          </div>
          <div className="rounded-[14px] bg-[color-mix(in_srgb,var(--blue)_28%,var(--mix))] px-2.5 py-2">
            <p className="font-mono-label">Cash</p>
            <p className="truncate font-semibold text-[var(--ink)]">
              {formatUsd(cash)}
            </p>
          </div>
          <div className="rounded-[14px] bg-[color-mix(in_srgb,var(--green)_28%,var(--mix))] px-2.5 py-2">
            <p className="font-mono-label">Positions</p>
            <p className="truncate font-semibold text-[var(--ink)]">
              {formatUsd(totalMarketValue)}
            </p>
          </div>
          <div className="rounded-[14px] bg-[color-mix(in_srgb,var(--lavender)_32%,var(--mix))] px-2.5 py-2">
            <p className="font-mono-label">PnL</p>
            <p className="font-semibold text-[var(--ink)]">
              <span className="block truncate sm:inline">
                {formatUsd(totalUnrealizedPnl)}
              </span>{" "}
              <span className="text-[var(--muted)]">
                ({formatPct(totalUnrealizedPnlPct)})
              </span>
            </p>
          </div>
        </div>

        <p className="mt-2 shrink-0 text-[0.68rem] text-[var(--muted)]">
          Cost basis on open lots: {formatUsd(totalCost)}
        </p>

        <div className="paper-book-list mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-0.5">
          {openPositions.length === 0 ? (
            <EmptyHint
              title="No open positions"
              body='Say “buy 5 NVDA” or tap Paper buy — then they’ll show up here.'
            />
          ) : (
            openPositions.map((pos) => (
              <div
                key={pos.id}
                className="rounded-[16px] border border-[color-mix(in_srgb,var(--ink)_10%,transparent)] bg-[color-mix(in_srgb,var(--white)_55%,var(--mix))] px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-display text-lg font-bold tracking-tight text-[var(--ink)]">
                      {pos.symbol}
                    </p>
                    <p className="text-[0.72rem] leading-snug text-[var(--muted)]">
                      {pos.quantity} × {formatUsd(pos.entryPrice)} entry → mark{" "}
                      {formatUsd(pos.markPrice)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={`text-sm font-semibold ${
                        pos.unrealizedPnl >= 0
                          ? "text-[color-mix(in_srgb,var(--green)_55%,var(--ink))]"
                          : "text-[color-mix(in_srgb,var(--orange)_70%,var(--ink))]"
                      }`}
                    >
                      {formatUsd(pos.unrealizedPnl)}
                    </p>
                    <p className="text-[0.68rem] text-[var(--muted)]">
                      {formatPct(pos.unrealizedPnlPct)}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex flex-col gap-2 text-[0.7rem] text-[var(--muted)] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                  <span className="min-w-0 leading-snug">
                    Paid {formatUsd(pos.costBasis)} · Worth{" "}
                    {formatUsd(pos.marketValue)}
                  </span>
                  {onAskSell ? (
                    <button
                      type="button"
                      className="btn-ghost w-full !px-2.5 !py-1.5 text-[0.7rem] sm:w-auto"
                      onClick={() => onAskSell(pos.symbol)}
                    >
                      Sell via chat
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>

        <p className="mt-3 shrink-0 text-[0.68rem] text-[var(--muted)]">
          Esc or Close to exit · Sell fills the sidekick composer
        </p>
          </>
        ) : (
          <>
            <p className="mt-2 shrink-0 text-[0.75rem] leading-snug text-[var(--muted)]">
              Durable log — survives chat clear. Realized PnL is from closed
              sells only.
            </p>
            {historySummary ? (
              <p className="mt-2 shrink-0 text-[0.68rem] text-[var(--muted)]">
                Realized {formatUsd(historySummary.totalRealizedPnl)} ·{" "}
                {historySummary.sellCount} sells · {historySummary.buyCount} buys
                {historySummary.skipCount > 0
                  ? ` · ${historySummary.skipCount} skips`
                  : ""}
              </p>
            ) : null}
            <div className="paper-book-list mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-0.5">
              {historyBusy ? (
                <p className="flex items-center gap-2 text-sm text-[var(--muted)]">
                  <Spinner size="sm" label="Loading history" />
                  Loading history…
                </p>
              ) : historyError ? (
                <p className="text-sm text-[color-mix(in_srgb,var(--orange)_80%,var(--ink))]">
                  {historyError}
                </p>
              ) : historyRows.length === 0 ? (
                <EmptyHint
                  title="No trades yet"
                  body="Buys, sells, and skips show up here with full numbers."
                />
              ) : (
                historyRows.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-[16px] border border-[color-mix(in_srgb,var(--ink)_10%,transparent)] bg-[color-mix(in_srgb,var(--white)_55%,var(--mix))] px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-display text-base font-bold text-[var(--ink)]">
                          {row.event === "skip" ? row.symbol : `${sideLabel(row)} · ${row.symbol}`}
                        </p>
                        <p className="text-[0.72rem] text-[var(--muted)]">
                          {formatChatTime(row.at)} · {row.source}
                          {row.legacy ? " · legacy" : ""}
                        </p>
                      </div>
                      {row.event === "fill" ? (
                        <p className="shrink-0 text-right text-sm font-semibold text-[var(--ink)]">
                          {formatUsd(row.notionalUsd)}
                        </p>
                      ) : null}
                    </div>
                    {row.event === "fill" ? (
                      <p className="mt-1 text-[0.72rem] text-[var(--muted)]">
                        {row.quantity} @ {formatUsd(row.price)}
                        {row.side === "sell" && row.realizedPnl != null
                          ? ` · PnL ${formatUsd(row.realizedPnl)} (${formatPct(row.realizedPnlPct ?? 0)})`
                          : ""}
                        {row.partial ? " · partial" : ""}
                      </p>
                    ) : (
                      <p className="mt-1 text-[0.72rem] text-[var(--muted)]">
                        {row.reason}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
            <p className="mt-3 shrink-0 text-[0.68rem] text-[var(--muted)]">
              Esc or Close to exit
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
