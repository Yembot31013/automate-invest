"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import { readTheme } from "@/components/theme/theme";
import { isCryptoPair } from "@/lib/symbols";

type TradingViewModalProps = {
  open: boolean;
  symbol: string;
  exchange?: string;
  onClose: () => void;
};

type ChartMode = "tradingview" | "desk";

/** Compact crypto pair for TradingView (BTC/USD → BTCUSD). */
function toTradingViewCryptoCode(symbol: string): string {
  const compact = symbol.trim().toUpperCase().replaceAll(/[/-]/g, "");
  if (!compact) return "BTCUSD";
  if (compact.endsWith("USD")) return compact;
  return `${compact}USD`;
}

function isNgxExchange(exchange?: string): boolean {
  const ex = (exchange ?? "").trim().toUpperCase();
  return ex === "NGX" || ex === "NGN" || ex === "NSE" || ex === "NIGERIA" || ex === "NSENG";
}

/**
 * Map desk tickers to TradingView symbols.
 * Nigerian listings use NSENG (not NGX) on TradingView.
 */
export function toTradingViewSymbol(symbol: string, exchange?: string): string {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return "NASDAQ:AAPL";

  const ex = (exchange ?? "NASDAQ").trim().toUpperCase() || "NASDAQ";

  if (ex === "FOREX" || ex === "COMMODITY") {
    if (sym === "XAU/USD" || sym === "XAUUSD" || sym === "GOLD") {
      return "OANDA:XAUUSD";
    }
    if (sym === "XAG/USD" || sym === "XAGUSD" || sym === "SILVER") {
      return "OANDA:XAGUSD";
    }
    if (sym === "WTI/USD" || sym === "WTI" || sym === "USOIL") {
      return "TVC:USOIL";
    }
    const compact = sym.replace("/", "");
    return `OANDA:${compact}`;
  }

  const looksCrypto =
    ex === "CRYPTO" ||
    ex === "COINBASE" ||
    ex === "BINANCE" ||
    isCryptoPair(sym);

  if (looksCrypto) {
    return `COINBASE:${toTradingViewCryptoCode(sym)}`;
  }

  if (isNgxExchange(ex)) {
    return `NSENG:${sym}`;
  }

  if (sym === "BTC" || sym === "BTCUSD" || sym === "XBT") {
    return "COINBASE:BTCUSD";
  }
  if (sym === "ETH" || sym === "ETHUSD") {
    return "COINBASE:ETHUSD";
  }

  return `${ex}:${sym}`;
}

export function tradingViewSymbolPageUrl(tvSymbol: string): string {
  // NSENG:DANGCEM → NSENG-DANGCEM
  const path = tvSymbol.replace(":", "-");
  return `https://www.tradingview.com/symbols/${encodeURIComponent(path)}/`;
}

function tradingViewEmbedUrl(
  tvSymbol: string,
  theme: "light" | "dark",
  interval = "D",
): string {
  const params = new URLSearchParams({
    frameElementId: "sd-tv",
    symbol: tvSymbol,
    interval,
    hidesidetoolbar: "0",
    hidetoptoolbar: "0",
    symboledit: "1",
    saveimage: "0",
    toolbarbg: theme === "dark" ? "#171c26" : "#fff8ec",
    studies: "[]",
    theme,
    style: "1",
    timezone: isNgxExchange(tvSymbol.split(":")[0]) ? "Africa/Lagos" : "Etc/UTC",
    withdateranges: "1",
    hideideas: "1",
    hidevolume: "0",
    allow_symbol_change: "1",
    locale: "en",
  });
  return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
}

export { tradingViewEmbedUrl };

function DeskLineChart({
  values,
  currency,
}: {
  values: number[];
  currency: "USD" | "NGN";
}) {
  if (values.length < 2) {
    return (
      <p className="px-4 py-10 text-center text-sm text-[var(--muted)]">
        Not enough history to draw a desk chart yet.
      </p>
    );
  }

  const width = 640;
  const height = 280;
  const pad = 16;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = pad + (i / Math.max(values.length - 1, 1)) * (width - pad * 2);
      const y = pad + (1 - (v - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const last = values[values.length - 1] ?? 0;
  const first = values[0] ?? 0;
  const up = last >= first;
  const stroke = up ? "#8bd450" : "#ff8a5b";
  const format = (n: number) =>
    new Intl.NumberFormat(currency === "NGN" ? "en-NG" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);

  return (
    <div className="flex h-full min-h-[240px] flex-col gap-2 p-3">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <p className="text-lg font-extrabold tracking-tight text-[var(--ink)]">
          {format(last)}
        </p>
        <p className="font-mono-label">
          {values.length} pts · {format(min)} – {format(max)}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full flex-1 rounded-xl bg-[color-mix(in_srgb,var(--ink)_4%,transparent)]"
        role="img"
        aria-label="Price history line chart"
      >
        <polyline
          fill="none"
          stroke={stroke}
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points}
        />
      </svg>
    </div>
  );
}

/** Full-width chart modal — TradingView embed, with desk OHLC fallback for NGX. */
export function TradingViewModal({
  open,
  symbol,
  exchange,
  onClose,
}: TradingViewModalProps) {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const ngx = isNgxExchange(exchange);
  const [mode, setMode] = useState<ChartMode>("tradingview");
  const [closes, setCloses] = useState<number[]>([]);
  const [ohlcError, setOhlcError] = useState<string | null>(null);
  const [ohlcLoading, setOhlcLoading] = useState(false);
  const titleId = useId();
  const tvSymbol = toTradingViewSymbol(symbol, exchange);
  const tvPage = tradingViewSymbolPageUrl(tvSymbol);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setTheme(readTheme());
    setMode("tradingview");
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
  }, [open, onClose, exchange]);

  useEffect(() => {
    if (!open || !symbol || mode !== "desk") return;

    let cancelled = false;
    setOhlcLoading(true);
    setOhlcError(null);

    const params = new URLSearchParams({
      symbol,
      ...(exchange ? { exchange } : {}),
    });

    void fetch(`/api/ohlc?${params.toString()}`)
      .then(async (res) => {
        const data = (await res.json()) as {
          closes?: number[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || "Could not load desk OHLC");
        }
        if (!cancelled) {
          setCloses(Array.isArray(data.closes) ? data.closes : []);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCloses([]);
          setOhlcError(
            error instanceof Error ? error.message : "Could not load desk chart",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setOhlcLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, symbol, exchange, mode]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="modal-overlay modal-overlay-chart fade-up"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card modal-card-chart"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex shrink-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono-label">Chart</p>
            <h3
              id={titleId}
              className="modal-title !mt-0.5 truncate text-xl md:text-2xl"
            >
              {symbol.toUpperCase()}
              <span className="ml-2 text-xs font-semibold text-[var(--muted)] md:text-sm">
                {tvSymbol}
              </span>
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

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {ngx ? (
            <>
              <button
                type="button"
                className={`btn-ghost !px-3 !py-1.5 text-xs ${mode === "tradingview" ? "ring-2 ring-[var(--yellow)]/50" : ""}`}
                onClick={() => setMode("tradingview")}
              >
                TradingView
              </button>
              <button
                type="button"
                className={`btn-ghost !px-3 !py-1.5 text-xs ${mode === "desk" ? "ring-2 ring-[var(--yellow)]/50" : ""}`}
                onClick={() => setMode("desk")}
              >
                Desk chart
              </button>
            </>
          ) : null}
          <a
            href={tvPage}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost !px-3 !py-1.5 text-xs"
          >
            Open on TradingView ↗
          </a>
        </div>

        <div className="tv-chart-frame">
          {mode === "tradingview" ? (
            <iframe
              key={`${tvSymbol}-${theme}`}
              title={`${symbol} TradingView chart`}
              src={tradingViewEmbedUrl(tvSymbol, theme)}
              className="tv-chart-iframe"
              allow="fullscreen"
            />
          ) : ohlcLoading ? (
            <p className="px-4 py-10 text-center text-sm text-[var(--muted)]">
              Loading desk history…
            </p>
          ) : ohlcError ? (
            <div className="space-y-3 px-4 py-8 text-center">
              <p className="text-sm text-[var(--muted)]">{ohlcError}</p>
              <a
                href={tvPage}
                target="_blank"
                rel="noreferrer"
                className="btn-primary inline-flex text-sm"
              >
                Open {tvSymbol} on TradingView
              </a>
            </div>
          ) : (
            <DeskLineChart
              values={closes}
              currency={ngx ? "NGN" : "USD"}
            />
          )}
        </div>

        <p className="mt-2 shrink-0 text-[0.7rem] text-[var(--muted)]">
          {ngx
            ? "NGX uses TradingView code NSENG · Desk chart uses NGN Market data (Free may be quote-backed) · Esc to close"
            : "Chart by TradingView · pinch/scroll inside to explore · Esc or Close to exit"}
        </p>
      </div>
    </div>,
    document.body,
  );
}
