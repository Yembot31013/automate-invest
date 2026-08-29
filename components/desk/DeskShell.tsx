"use client";

import { useCallback, useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";

import { DeskChat } from "@/components/desk/DeskChat";
import { Sparkline } from "@/components/desk/Sparkline";

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

export function DeskShell() {
  const [snapshots, setSnapshots] = useState<DeskSnapshot[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioPayload | null>(null);
  const [symbolInput, setSymbolInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyAdd, setBusyAdd] = useState(false);
  const [busyScan, setBusyScan] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
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
      setError(err instanceof Error ? err.message : "Failed to load desk");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function addSymbol(e: React.FormEvent) {
    e.preventDefault();
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) return;
    setBusyAdd(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, exchange: "NASDAQ" }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      setSymbolInput("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add symbol");
    } finally {
      setBusyAdd(false);
    }
  }

  async function runScan() {
    setBusyScan(true);
    setScanNote(null);
    setError(null);
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
      setScanNote(
        `Scanned ${data.scanned ?? 0} · alerted ${(data.alerted ?? []).length}`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setBusyScan(false);
    }
  }

  const pnlPositive = (portfolio?.totalUnrealizedPnl ?? 0) >= 0;

  return (
    <div className="min-h-full bg-[var(--desk-bg)]">
      <header className="flex items-center justify-between border-b border-[var(--desk-border)] px-4 py-4 md:px-8">
        <div>
          <p className="font-display text-2xl text-[var(--desk-text)]">
            Signal Desk
          </p>
          <p className="text-xs text-[var(--desk-muted)]">
            Glanceable tape · chatty sidekick
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busyScan}
            onClick={() => void runScan()}
            className="rounded-md bg-[var(--desk-accent)] px-3 py-1.5 text-xs font-semibold text-[#0b120e] disabled:opacity-50"
          >
            {busyScan ? "Scanning…" : "Scan now"}
          </button>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void refresh();
            }}
            className="rounded-md border border-[var(--desk-border)] px-3 py-1.5 text-xs text-[var(--desk-muted)] hover:text-[var(--desk-text)]"
          >
            Refresh
          </button>
          <UserButton />
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[1.1fr_0.9fr] md:px-8">
        <div className="space-y-6">
          <section
            className="rounded-2xl border border-[var(--desk-border)] px-5 py-4"
            style={{
              background: pnlPositive
                ? "linear-gradient(135deg, rgba(78,159,61,0.14), transparent 60%)"
                : "linear-gradient(135deg, rgba(224,86,86,0.14), transparent 60%)",
            }}
          >
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--desk-muted)]">
              Paper book
            </p>
            {portfolio ? (
              <div className="mt-2 flex flex-wrap items-end gap-6">
                <div>
                  <p className="font-display text-3xl text-[var(--desk-text)]">
                    {formatUsd(portfolio.equity)}
                  </p>
                  <p
                    className={`text-sm ${pnlPositive ? "text-[var(--desk-accent)]" : "text-[var(--desk-danger)]"}`}
                  >
                    PnL {formatUsd(portfolio.totalUnrealizedPnl)} (
                    {formatPct(portfolio.totalUnrealizedPnlPct)}) ·{" "}
                    {portfolio.openCount} open
                  </p>
                </div>
                <div className="text-sm text-[var(--desk-muted)]">
                  <p>Cash {formatUsd(portfolio.cash)}</p>
                  <p>Positions {formatUsd(portfolio.totalMarketValue)}</p>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-[var(--desk-muted)]">
                {loading ? "Loading…" : "No open paper positions yet."}
              </p>
            )}
            {scanNote && (
              <p className="mt-2 text-xs text-[var(--desk-accent)]">{scanNote}</p>
            )}
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-xl text-[var(--desk-text)]">
                Watchlist
              </h2>
              <form onSubmit={addSymbol} className="flex gap-2">
                <input
                  value={symbolInput}
                  onChange={(e) => setSymbolInput(e.target.value)}
                  placeholder="Add ticker"
                  className="w-28 rounded-lg border border-[var(--desk-border)] bg-[var(--desk-surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--desk-accent)]"
                />
                <button
                  type="submit"
                  disabled={busyAdd}
                  className="rounded-lg bg-[var(--desk-accent)] px-3 py-1.5 text-xs font-semibold text-[#0b120e] disabled:opacity-50"
                >
                  Monitor
                </button>
              </form>
            </div>

            {error && (
              <p className="mb-3 text-sm text-[var(--desk-danger)]">{error}</p>
            )}

            {loading && snapshots.length === 0 ? (
              <p className="text-sm text-[var(--desk-muted)]">Loading tape…</p>
            ) : snapshots.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--desk-border)] px-4 py-8 text-sm text-[var(--desk-muted)]">
                Nothing on the board yet — add a ticker or ask the sidekick to
                monitor one.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {snapshots.map((snap) => {
                  const up = (snap.changePct ?? 0) >= 0;
                  return (
                    <article
                      key={snap.symbol}
                      className="rounded-2xl border border-[var(--desk-border)] bg-[var(--desk-surface)] p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs text-[var(--desk-muted)]">
                            {snap.exchange}:{snap.symbol}
                          </p>
                          <p className="mt-1 text-xl font-semibold tabular-nums">
                            {snap.currentPrice != null
                              ? formatUsd(snap.currentPrice)
                              : "—"}
                          </p>
                          <p
                            className={`text-sm ${up ? "text-[var(--desk-accent)]" : "text-[var(--desk-danger)]"}`}
                          >
                            {snap.changePct != null
                              ? formatPct(snap.changePct)
                              : (snap.error ?? "—")}
                          </p>
                        </div>
                        {snap.closes && snap.closes.length > 1 && (
                          <Sparkline
                            values={snap.closes}
                            stroke={up ? "#4E9F3D" : "#E05656"}
                          />
                        )}
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--desk-muted)]">
                        <div>
                          <dt>Vol ratio</dt>
                          <dd className="text-[var(--desk-text)]">
                            {snap.volumeRatio != null
                              ? `${snap.volumeRatio.toFixed(2)}×`
                              : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt>vs SMA14</dt>
                          <dd className="text-[var(--desk-text)]">
                            {snap.pctBelowSma14 != null
                              ? `${snap.pctBelowSma14.toFixed(1)}% below`
                              : "—"}
                          </dd>
                        </div>
                      </dl>
                      {snap.headline && (
                        <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-[var(--desk-muted)]">
                          {snap.headline}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <DeskChat />
      </div>
    </div>
  );
}
