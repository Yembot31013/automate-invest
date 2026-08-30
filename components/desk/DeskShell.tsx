"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AccountButton } from "@/components/auth/AccountButton";
import { CHAT_CHIPS, DeskChat } from "@/components/desk/DeskChat";
import { Sparkline } from "@/components/desk/Sparkline";
import { TradingViewModal } from "@/components/desk/TradingViewModal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import {
  BusyBanner,
  EmptyHint,
  Skeleton,
  Spinner,
  StatusToast,
  type ToastState,
} from "@/components/ui/Feedback";
import { Tip } from "@/components/ui/Tip";

type DeskSnapshot = {
  symbol: string;
  exchange: string;
  currentPrice?: number;
  changePct?: number;
  volumeRatio?: number;
  pctBelowSma14?: number;
  sentimentScore?: number | null;
  closes?: number[];
  headline?: string | null;
  error?: string;
};

type PortfolioPayload = {
  openCount: number;
  cash: number;
  equity: number;
  totalCost: number;
  totalMarketValue: number;
  totalUnrealizedPnl: number;
  totalUnrealizedPnlPct: number;
};

const ACCENTS = [
  "var(--yellow)",
  "var(--blue)",
  "var(--pink)",
  "var(--lavender)",
  "var(--green)",
  "var(--orange)",
] as const;

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

/** Compact money for tight metric tiles ($100k, $1.2M) — avoids overflow. */
function formatUsdCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const signed = value < 0 ? "-" : "";
    return `${signed}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  }
  if (abs >= 10_000) {
    const signed = value < 0 ? "-" : "";
    return `${signed}$${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  }
  return formatUsd(value);
}

function formatPct(value: number): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

function sidekickDeedLine(summary: string): string {
  switch (summary) {
    case "Watchlist updated":
      return "List updated · still loyal";
    case "Ticker removed":
      return "Dropped one · eyes forward";
    case "Paper buy filled":
      return "Paper buy · salute";
    case "Paper sell filled":
      return "Paper sell · salute";
    case "Flagged a capability gap":
      return "Flagged a gap · on it";
    default:
      return summary;
  }
}

export function DeskShell() {
  const [snapshots, setSnapshots] = useState<DeskSnapshot[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioPayload | null>(null);
  const [symbolInput, setSymbolInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyAdd, setBusyAdd] = useState(false);
  const [busyRemove, setBusyRemove] = useState<string | null>(null);
  const [busyScan, setBusyScan] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [chartSymbol, setChartSymbol] = useState<{
    symbol: string;
    exchange: string;
  } | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [mobilePanel, setMobilePanel] = useState<"chat" | "list" | "activity">(
    "chat",
  );
  const [externalPrompt, setExternalPrompt] = useState<string | null>(null);
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [sidekickSyncing, setSidekickSyncing] = useState(false);
  const [sidekickDeed, setSidekickDeed] = useState<string | null>(null);
  const [composerFocusKey, setComposerFocusKey] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((next: NonNullable<ToastState>) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(next);
    if (next.kind !== "busy") {
      toastTimer.current = setTimeout(() => setToast(null), 4200);
    }
  }, []);

  const rememberSidekickDeed = useCallback((deed: string) => {
    if (deedTimer.current) clearTimeout(deedTimer.current);
    setSidekickDeed(deed);
    deedTimer.current = setTimeout(() => setSidekickDeed(null), 8000);
  }, []);

  const handleChatBusy = useCallback(
    (busy: boolean) => {
      setChatBusy(busy);
      if (busy) {
        showToast({
          kind: "busy",
          message: "Sidekick is thinking — tools may run…",
        });
        return;
      }
      setToast((prev) =>
        prev?.kind === "busy" && prev.message.startsWith("Sidekick")
          ? null
          : prev,
      );
    },
    [showToast],
  );

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (deedTimer.current) clearTimeout(deedTimer.current);
    };
  }, []);

  const refresh = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!opts?.quiet) {
        setRefreshing(true);
      }
      setError(null);
      try {
        const res = await fetch("/api/desk", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = (await res.json()) as {
          snapshots: DeskSnapshot[];
          portfolio: PortfolioPayload;
        };
        setSnapshots(data.snapshots ?? []);
        setPortfolio(data.portfolio ?? null);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load desk";
        setError(message);
        showToast({
          kind: "warn",
          message: "Couldn't refresh prices — try again in a moment.",
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [showToast],
  );

  const syncDeskFromSidekick = useCallback(
    async (reason: string) => {
      setSidekickSyncing(true);
      showToast({
        kind: "busy",
        message: reason,
      });
      setRefreshing(true);
      await refresh({ quiet: true });
      setSidekickSyncing(false);
      showToast({
        kind: "ok",
        message: "Desk updated from the sidekick.",
      });
    },
    [refresh, showToast],
  );

  const sidekickBusy = chatBusy || sidekickSyncing;
  const sidekickSubtext = sidekickBusy
    ? chatBusy
      ? "Poking the market… salute locked"
      : "Syncing your desk… hang tight"
    : sidekickDeed
      ? sidekickDeed
      : "On the tape · salute ready";

  useEffect(() => {
    showToast({
      kind: "busy",
      message: "Warming up your desk — fetching prices…",
    });
    void refresh({ quiet: true }).then(() => {
      setToast((prev) => (prev?.kind === "busy" ? null : prev));
    });
  }, [refresh, showToast]);

  async function addSymbol(e: React.FormEvent) {
    e.preventDefault();
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) return;
    setBusyAdd(true);
    setError(null);
    showToast({
      kind: "busy",
      message: `Checking ${symbol} is a real ticker… hang tight.`,
    });
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, exchange: "NASDAQ" }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || data.ok === false) {
        throw new Error(data.error ?? "Failed to add symbol");
      }
      setSymbolInput("");
      setActivityLog((prev) => [`Monitored ${symbol}`, ...prev].slice(0, 12));
      showToast({
        kind: "ok",
        message: `${symbol} is on your watchlist. Nice.`,
      });
      await refresh({ quiet: true });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to add symbol";
      setError(message);
      showToast({
        kind: "warn",
        message: `Couldn't add that ticker — nothing was saved. ${message}`,
      });
    } finally {
      setBusyAdd(false);
    }
  }

  async function removeSymbol(symbol: string) {
    setBusyRemove(symbol);
    setError(null);
    showToast({
      kind: "busy",
      message: `Removing ${symbol} from your list…`,
    });
    try {
      const res = await fetch(
        `/api/watchlist?symbol=${encodeURIComponent(symbol)}`,
        { method: "DELETE" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || data.ok === false) {
        throw new Error(data.error ?? "Failed to remove symbol");
      }
      setPendingRemove(null);
      setActivityLog((prev) => [`Removed ${symbol}`, ...prev].slice(0, 12));
      showToast({ kind: "ok", message: `${symbol} is gone from your list.` });
      await refresh({ quiet: true });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to remove symbol";
      setError(message);
      showToast({
        kind: "warn",
        message: `Couldn't remove ${symbol}. It's still on your list.`,
      });
    } finally {
      setBusyRemove(null);
    }
  }

  async function runScan() {
    setBusyScan(true);
    setScanNote(null);
    setError(null);
    showToast({
      kind: "busy",
      message: "Scanning your watchlist & pinging Discord…",
    });
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        alerted?: string[];
        scanned?: number;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Scan failed");
      }
      const note = `Scanned ${data.scanned ?? 0} · alerted ${(data.alerted ?? []).length}`;
      setScanNote(note);
      setActivityLog((prev) => [note, ...prev].slice(0, 12));
      showToast({
        kind: "ok",
        message: `Scan done — checked ${data.scanned ?? 0}, alerted ${(data.alerted ?? []).length}.`,
      });
      await refresh({ quiet: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Scan failed";
      setError(message);
      showToast({ kind: "warn", message: `Scan didn't finish: ${message}` });
    } finally {
      setBusyScan(false);
    }
  }

  const pnlPositive = (portfolio?.totalUnrealizedPnl ?? 0) >= 0;
  const anyBusy = busyAdd || busyRemove != null || busyScan || refreshing;

  const sidebar = (
    <aside
      className={`soft-card-strong flex h-full flex-col overflow-hidden ${busyAdd ? "ring-2 ring-[var(--blue)]/30" : ""}`}
      aria-busy={busyAdd || busyRemove != null}
    >
      <div className="border-b border-[color-mix(in_srgb,var(--mix)_50%,transparent)] px-4 py-4">
        <p className="font-mono-label">Agents</p>
        <h1 className="mt-1 text-xl font-extrabold tracking-tight text-[var(--ink)]">
          Signal Desk
        </h1>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Your tickers live here. Click one → ask the sidekick.
        </p>
      </div>

      <div className="space-y-2 overflow-y-auto px-3 py-3">
        <Tip
          label="Jump to chat with your loyal market pal"
          className="w-full"
          as="div"
        >
          <button
            type="button"
            className={`sidekick-card tilt-hover soft-card flex w-full items-center gap-3 px-3 py-3 text-left ${
              sidekickBusy ? "is-busy" : ""
            }`}
            onClick={() => {
              setMobilePanel("chat");
              setComposerFocusKey((n) => n + 1);
            }}
          >
            <span
              className={`sidekick-avatar ${sidekickBusy ? "is-busy" : ""}`}
              aria-hidden
            >
              🫡
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-[var(--ink)]">
                Sidekick
              </span>
              <span className="sidekick-subtext">{sidekickSubtext}</span>
            </span>
          </button>
        </Tip>

        <p className="font-mono-label px-1 pt-3">Watchlist</p>
        {loading && snapshots.length === 0 ? (
          <div className="space-y-2 px-1" aria-busy="true" aria-label="Loading watchlist">
            <Skeleton lines={3} />
            <p className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <Spinner size="sm" label="Loading watchlist" />
              Loading your tickers…
            </p>
          </div>
        ) : snapshots.length === 0 ? (
          <EmptyHint
            title="Empty list"
            body="Type a ticker below (like NVDA) and hit Add. We'll verify it before saving."
          />
        ) : (
          snapshots.map((snap, i) => (
            <div
              key={snap.symbol}
              className={`tilt-hover soft-card flex w-full items-center gap-1 px-2 py-1.5 ${
                busyRemove === snap.symbol ? "opacity-60" : ""
              }`}
            >
              <Tip
                label={`Fill chat with a ${snap.symbol} update ask — you send when ready`}
                className="min-w-0 flex-1"
                as="div"
              >
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center justify-between gap-2 rounded-[12px] px-1.5 py-1 text-left"
                  onClick={() => {
                    setExternalPrompt(
                      `Give me an update on ${snap.symbol} including headlines — explain what each story means and why it matters.`,
                    );
                    setMobilePanel("chat");
                    showToast({
                      kind: "info",
                      message: `Shortcut for ${snap.symbol} — check the chat box`,
                    });
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: ACCENTS[i % ACCENTS.length] }}
                    />
                    <span className="truncate text-sm font-bold">
                      {snap.symbol}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-xs font-semibold ${
                      (snap.changePct ?? 0) >= 0
                        ? "text-[color-mix(in_srgb,var(--green)_70%,var(--ink))]"
                        : "text-[color-mix(in_srgb,var(--orange)_80%,var(--ink))]"
                    }`}
                  >
                    {snap.changePct != null ? formatPct(snap.changePct) : "—"}
                  </span>
                </button>
              </Tip>
              <Tip label={`Remove ${snap.symbol} from your watchlist`}>
                <button
                  type="button"
                  aria-label={`Remove ${snap.symbol}`}
                  disabled={busyRemove === snap.symbol || busyAdd}
                  onClick={() => setPendingRemove(snap.symbol)}
                  className="shrink-0 rounded-full px-2 py-1 text-xs font-bold text-[var(--muted)] transition hover:bg-[color-mix(in_srgb,var(--orange)_28%,var(--mix))] hover:text-[var(--ink)] disabled:opacity-50"
                >
                  {busyRemove === snap.symbol ? (
                    <Spinner size="sm" label={`Removing ${snap.symbol}`} />
                  ) : (
                    "×"
                  )}
                </button>
              </Tip>
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={addSymbol}
        className="mt-auto space-y-2 border-t border-[color-mix(in_srgb,var(--mix)_50%,transparent)] p-3"
      >
        <p className="font-mono-label">Add ticker</p>
        <p className="text-[0.7rem] leading-snug text-[var(--muted)]">
          We check the market first. Fake tickers never get saved.
        </p>
        <div className="flex gap-2">
          <Tip
            label="Enter a stock ticker like AAPL or TSLA"
            className="min-w-0 flex-1"
            as="div"
            side="top"
          >
            <input
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
              placeholder="NVDA"
              disabled={busyAdd}
              aria-label="Ticker symbol to monitor"
              className="soft-field flex-1 !py-2"
            />
          </Tip>
          <Tip label="Verify this ticker and add it to your watchlist">
            <button
              type="submit"
              disabled={busyAdd || !symbolInput.trim()}
              className="btn-primary !px-3 !py-2 text-xs"
            >
              {busyAdd ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner size="sm" label="Adding" />
                  Check
                </span>
              ) : (
                "Add"
              )}
            </button>
          </Tip>
        </div>
        {busyAdd && (
          <BusyBanner
            active
            message={`Verifying ${symbolInput.trim().toUpperCase() || "ticker"} — almost there…`}
          />
        )}
        {error && (
          <p
            className="rounded-[14px] bg-[color-mix(in_srgb,var(--orange)_28%,var(--mix))] px-2 py-1.5 text-xs leading-snug"
            role="alert"
          >
            {error}
          </p>
        )}
      </form>
    </aside>
  );

  const activity = (
    <aside
      className="soft-card-strong flex h-full flex-col overflow-hidden"
      aria-busy={busyScan || refreshing}
    >
      <div className="border-b border-[color-mix(in_srgb,var(--mix)_50%,transparent)] px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-mono-label">Reports</p>
            <h2 className="mt-1 text-xl font-extrabold tracking-tight">
              Activity
            </h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Paper book, tape, and what just happened.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Tip label="Account — theme, profile, or sign out">
              <span className="inline-flex">
                <AccountButton />
              </span>
            </Tip>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Tip label="Run dip/breakout rules on your list and post Discord alerts">
            <button
              type="button"
              disabled={busyScan || loading}
              onClick={() => void runScan()}
              className="btn-primary !px-3 !py-1.5 text-xs"
            >
              {busyScan ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner size="sm" label="Scanning" />
                  Scanning…
                </span>
              ) : (
                "Scan now"
              )}
            </button>
          </Tip>
          <Tip label="Reload prices, headlines, and paper PnL">
            <button
              type="button"
              disabled={refreshing || busyScan}
              onClick={() => {
                showToast({
                  kind: "busy",
                  message: "Refreshing prices & paper book…",
                });
                void refresh().then(() => {
                  showToast({
                    kind: "ok",
                    message: "Desk is fresh — numbers updated.",
                  });
                });
              }}
              className="btn-ghost !px-3 !py-1.5 text-xs"
            >
              {refreshing ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner size="sm" label="Refreshing" />
                  Refreshing…
                </span>
              ) : (
                "Refresh"
              )}
            </button>
          </Tip>
        </div>
        {(busyScan || refreshing) && (
          <div className="mt-3">
            <BusyBanner
              active
              message={
                busyScan
                  ? "Scanning watchlist — this can take a few seconds…"
                  : "Pulling latest market data…"
              }
            />
          </div>
        )}
        {scanNote && (
          <p className="mt-2 text-xs font-medium text-[var(--ink)]">{scanNote}</p>
        )}
        {error && (
          <p
            className="mt-2 rounded-[14px] bg-[color-mix(in_srgb,var(--orange)_28%,var(--mix))] px-2 py-1.5 text-xs"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>

      <div
        className={`space-y-3 overflow-y-auto px-4 py-4 ${refreshing ? "opacity-80" : ""}`}
      >
        <p className="font-mono-label">Paper book</p>
        {loading && !portfolio ? (
          <div className="grid grid-cols-2 gap-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="metric-tile bg-[color-mix(in_srgb,var(--white)_80%,transparent)]">
                <Skeleton lines={2} />
              </div>
            ))}
          </div>
        ) : portfolio ? (
          <div className="grid grid-cols-2 gap-2">
            <Tip
              label="Cash + market value of open paper positions"
              as="div"
              className="min-w-0"
            >
              <div
                className="metric-tile"
                style={{
                  background: "color-mix(in srgb, var(--yellow) 35%, var(--mix))",
                }}
              >
                <p className="font-mono-label">Equity</p>
                <p className="metric-value" title={formatUsd(portfolio.equity)}>
                  {formatUsdCompact(portfolio.equity)}
                </p>
              </div>
            </Tip>
            <Tip
              label="Unrealized profit or loss on open paper trades"
              as="div"
              className="min-w-0"
            >
              <div
                className="metric-tile"
                style={{
                  background: pnlPositive
                    ? "color-mix(in srgb, var(--green) 35%, var(--mix))"
                    : "color-mix(in srgb, var(--orange) 35%, var(--mix))",
                }}
              >
                <p className="font-mono-label">PnL</p>
                <p
                  className="metric-value"
                  title={formatUsd(portfolio.totalUnrealizedPnl)}
                >
                  {formatUsdCompact(portfolio.totalUnrealizedPnl)}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {formatPct(portfolio.totalUnrealizedPnlPct)}
                </p>
              </div>
            </Tip>
            <Tip
              label="Cash left in your $100k paper account"
              as="div"
              className="min-w-0"
            >
              <div
                className="metric-tile"
                style={{
                  background: "color-mix(in srgb, var(--blue) 32%, var(--mix))",
                }}
              >
                <p className="font-mono-label">Cash</p>
                <p className="metric-value" title={formatUsd(portfolio.cash)}>
                  {formatUsdCompact(portfolio.cash)}
                </p>
              </div>
            </Tip>
            <Tip
              label="How many paper positions are currently open"
              as="div"
              className="min-w-0"
            >
              <div
                className="metric-tile"
                style={{
                  background: "color-mix(in srgb, var(--lavender) 40%, var(--mix))",
                }}
              >
                <p className="font-mono-label">Open</p>
                <p className="metric-value">{portfolio.openCount}</p>
              </div>
            </Tip>
          </div>
        ) : (
          <EmptyHint
            title="No paper trades yet"
            body="Ask the sidekick to buy something on paper — e.g. “buy 5 NVDA”."
          />
        )}

        <p className="font-mono-label pt-2">Tape cards</p>
        <p className="text-[0.7rem] text-[var(--muted)]">
          Tap a card for TradingView · Remove stays on the button.
        </p>
        {loading && snapshots.length === 0 ? (
          <div className="space-y-2" aria-busy="true">
            <div className="soft-card p-3">
              <Skeleton lines={3} />
            </div>
            <div className="soft-card p-3">
              <Skeleton lines={3} />
            </div>
          </div>
        ) : snapshots.length === 0 ? (
          <EmptyHint
            title="Nothing on the tape"
            body="Add a ticker on the left, then you'll see price, volume, and headlines here."
          />
        ) : (
          <div className="space-y-2">
            {snapshots.map((snap, i) => {
              const up = (snap.changePct ?? 0) >= 0;
              return (
                <article
                  key={snap.symbol}
                  role="button"
                  tabIndex={0}
                  className={`tilt-hover soft-card cursor-pointer p-3 ${
                    busyRemove === snap.symbol ? "opacity-55" : ""
                  }`}
                  style={{
                    background: `color-mix(in srgb, ${ACCENTS[i % ACCENTS.length]} 18%, var(--mix))`,
                  }}
                  title={`Open TradingView chart for ${snap.symbol}`}
                  onClick={() =>
                    setChartSymbol({
                      symbol: snap.symbol,
                      exchange: snap.exchange,
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setChartSymbol({
                        symbol: snap.symbol,
                        exchange: snap.exchange,
                      });
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono-label">
                        {snap.exchange}:{snap.symbol}
                      </p>
                      <p className="mt-1 text-lg font-extrabold tabular-nums">
                        {snap.currentPrice != null
                          ? formatUsd(snap.currentPrice)
                          : "—"}
                      </p>
                      <p className="text-xs font-semibold">
                        {snap.changePct != null
                          ? formatPct(snap.changePct)
                          : (snap.error ?? "—")}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {snap.closes && snap.closes.length > 1 && (
                        <Tip label="Recent closing prices — green up, orange soft">
                          <span>
                            <Sparkline
                              values={snap.closes}
                              stroke={up ? "#8bd450" : "#ff8a5b"}
                            />
                          </span>
                        </Tip>
                      )}
                      <Tip label={`Stop watching ${snap.symbol}`}>
                        <button
                          type="button"
                          aria-label={`Remove ${snap.symbol}`}
                          disabled={busyRemove === snap.symbol}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingRemove(snap.symbol);
                          }}
                          className="btn-ghost !px-2.5 !py-1 text-[0.65rem]"
                        >
                          {busyRemove === snap.symbol ? (
                            <span className="inline-flex items-center gap-1">
                              <Spinner size="sm" label="Removing" />
                              …
                            </span>
                          ) : (
                            "Remove"
                          )}
                        </button>
                      </Tip>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-[0.7rem] text-[var(--muted)]">
                    <Tip label="Today's volume vs the 20-day average">
                      <span>
                        Vol{" "}
                        {snap.volumeRatio != null
                          ? `${snap.volumeRatio.toFixed(2)}×`
                          : "—"}
                      </span>
                    </Tip>
                    <Tip label="How far price sits below the 14-day moving average">
                      <span>
                        SMA{" "}
                        {snap.pctBelowSma14 != null
                          ? `${snap.pctBelowSma14.toFixed(1)}%`
                          : "—"}
                      </span>
                    </Tip>
                  </div>
                  {snap.headline && (
                    <p
                      className="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--muted)]"
                      title={snap.headline}
                    >
                      {snap.headline}
                    </p>
                  )}
                  {snap.error && (
                    <p className="mt-2 text-[0.7rem] font-medium text-[color-mix(in_srgb,var(--orange)_80%,var(--ink))]">
                      Price fetch hiccup — try Refresh.
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}

        <p className="font-mono-label pt-2">Shortcuts</p>
        <p className="text-[0.7rem] text-[var(--muted)]">
          One tap → fills the chat box so you can edit before sending.
        </p>
        <div className="flex flex-wrap gap-2">
          {CHAT_CHIPS.map((chip) => (
            <Tip key={chip.label} label={chip.hint} side="top">
              <button
                type="button"
                className="badge-pill"
                style={{
                  background: `color-mix(in srgb, ${chip.tint} 42%, var(--mix))`,
                }}
                onClick={() => {
                  setExternalPrompt(chip.text);
                  setMobilePanel("chat");
                  showToast({
                    kind: "info",
                    message: `“${chip.label}” ready in chat — edit or send`,
                  });
                }}
              >
                {chip.label}
              </button>
            </Tip>
          ))}
        </div>

        {activityLog.length > 0 && (
          <>
            <p className="font-mono-label pt-2">Recent</p>
            <ul className="space-y-1.5">
              {activityLog.map((item, idx) => (
                <li
                  key={`${item}-${idx}`}
                  className="rounded-[14px] bg-[color-mix(in_srgb,var(--white)_70%,transparent)] px-3 py-2 text-xs text-[var(--muted)] fade-up"
                >
                  {item}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  );

  return (
    <div className="relative min-h-full overflow-hidden bg-[var(--cream)]">
      <div
        aria-hidden
        className="blob left-[-8rem] top-[-6rem] h-72 w-72 bg-[var(--yellow)]"
      />
      <div
        aria-hidden
        className="blob right-[-6rem] top-[20%] h-64 w-64 bg-[var(--lavender)]"
      />
      <div
        aria-hidden
        className="blob bottom-[-8rem] left-[30%] h-72 w-72 bg-[var(--pink)]"
      />

      <div className="relative z-10 mx-auto flex h-[100dvh] max-w-[1600px] flex-col gap-3 p-3 md:gap-4 md:p-4">
        <div className="flex items-center gap-2 lg:hidden">
          {(
            [
              ["list", "Agents", "Watchlist & add tickers"],
              ["chat", "Chat", "Talk to your sidekick"],
              ["activity", "Reports", "Paper book, tape & scan"],
            ] as const
          ).map(([id, label, hint]) => (
            <Tip key={id} label={hint} className="flex-1" as="div">
              <button
                type="button"
                onClick={() => setMobilePanel(id)}
                className={`w-full rounded-full px-3 py-2 text-xs font-bold transition ${
                  mobilePanel === id
                    ? "bg-[var(--yellow)] text-[var(--ink)] shadow-[var(--shadow-soft)]"
                    : "bg-[color-mix(in_srgb,var(--white)_70%,transparent)] text-[var(--muted)] hover:bg-[var(--white)]"
                }`}
              >
                {label}
              </button>
            </Tip>
          ))}
        </div>

        {anyBusy && (
          <p className="sr-only" aria-live="polite">
            Working — please wait.
          </p>
        )}

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[240px_minmax(0,1fr)_300px] xl:grid-cols-[260px_minmax(0,1fr)_320px]">
          <div
            className={`min-h-0 ${mobilePanel === "list" ? "block" : "hidden"} lg:block`}
          >
            {sidebar}
          </div>
          <div
            className={`min-h-0 min-w-0 ${mobilePanel === "chat" ? "flex" : "hidden"} lg:flex`}
          >
            <DeskChat
              externalPrompt={externalPrompt}
              onExternalPromptConsumed={() => setExternalPrompt(null)}
              focusSignal={composerFocusKey}
              onPrompt={(text) =>
                setActivityLog((prev) =>
                  [`Chat · ${text.slice(0, 48)}`, ...prev].slice(0, 12),
                )
              }
              onBusyChange={handleChatBusy}
              onDeskMutated={(summary) => {
                rememberSidekickDeed(sidekickDeedLine(summary));
                setActivityLog((prev) =>
                  [summary, ...prev].slice(0, 12),
                );
                void syncDeskFromSidekick(
                  "Sidekick changed your desk — syncing…",
                );
              }}
            />
          </div>
          <div
            className={`min-h-0 ${mobilePanel === "activity" ? "block" : "hidden"} lg:block`}
          >
            {activity}
          </div>
        </div>
      </div>

      <ConfirmModal
        open={pendingRemove != null}
        title={`Remove ${pendingRemove ?? "ticker"}?`}
        body={
          <>
            This takes <strong>{pendingRemove}</strong> off your watchlist and
            stops desk scans for it (unless someone else is watching it). You
            can add it back anytime.
          </>
        }
        confirmLabel="Remove"
        cancelLabel="Keep it"
        tone="danger"
        busy={busyRemove != null}
        onCancel={() => {
          if (busyRemove) return;
          setPendingRemove(null);
        }}
        onConfirm={() => {
          if (pendingRemove) void removeSymbol(pendingRemove);
        }}
      />

      <TradingViewModal
        open={chartSymbol != null}
        symbol={chartSymbol?.symbol ?? ""}
        exchange={chartSymbol?.exchange}
        onClose={() => setChartSymbol(null)}
      />

      <StatusToast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
