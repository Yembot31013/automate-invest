"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import { readTheme } from "@/components/theme/theme";

type TradingViewModalProps = {
  open: boolean;
  symbol: string;
  exchange?: string;
  onClose: () => void;
};

/** Compact crypto pair for TradingView (BTC/USD → BTCUSD). */
function toTradingViewCryptoCode(symbol: string): string {
  const compact = symbol.trim().toUpperCase().replaceAll(/[/-]/g, "");
  if (!compact) return "BTCUSD";
  if (compact.endsWith("USD")) return compact;
  return `${compact}USD`;
}

/** Map desk tickers to TradingView symbols (crypto needs a venue pair). */
export function toTradingViewSymbol(symbol: string, exchange?: string): string {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return "NASDAQ:AAPL";

  const ex = (exchange ?? "NASDAQ").trim().toUpperCase() || "NASDAQ";
  const looksCrypto =
    ex === "CRYPTO" ||
    ex === "COINBASE" ||
    ex === "BINANCE" ||
    sym.includes("/") ||
    sym.includes("-");

  if (looksCrypto) {
    return `COINBASE:${toTradingViewCryptoCode(sym)}`;
  }

  if (sym === "BTC" || sym === "BTCUSD" || sym === "XBT") {
    return "COINBASE:BTCUSD";
  }
  if (sym === "ETH" || sym === "ETHUSD") {
    return "COINBASE:ETHUSD";
  }

  return `${ex}:${sym}`;
}

function tradingViewEmbedUrl(tvSymbol: string, theme: "light" | "dark"): string {
  const params = new URLSearchParams({
    frameElementId: "sd-tv",
    symbol: tvSymbol,
    interval: "D",
    hidesidetoolbar: "0",
    hidetoptoolbar: "0",
    symboledit: "1",
    saveimage: "0",
    toolbarbg: theme === "dark" ? "#171c26" : "#fff8ec",
    studies: "[]",
    theme,
    style: "1",
    timezone: "Etc/UTC",
    withdateranges: "1",
    hideideas: "1",
    hidevolume: "0",
    allow_symbol_change: "1",
    locale: "en",
  });
  return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
}

/** Full-width chart modal — TradingView embed for a tape symbol. */
export function TradingViewModal({
  open,
  symbol,
  exchange,
  onClose,
}: TradingViewModalProps) {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const titleId = useId();
  const tvSymbol = toTradingViewSymbol(symbol, exchange);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setTheme(readTheme());
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
            <h3 id={titleId} className="modal-title !mt-0.5 truncate text-xl md:text-2xl">
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

        <div className="tv-chart-frame">
          <iframe
            key={`${tvSymbol}-${theme}`}
            title={`${symbol} TradingView chart`}
            src={tradingViewEmbedUrl(tvSymbol, theme)}
            className="tv-chart-iframe"
            allow="fullscreen"
          />
        </div>

        <p className="mt-2 shrink-0 text-[0.7rem] text-[var(--muted)]">
          Chart by TradingView · pinch/scroll inside to explore · Esc or Close
          to exit
        </p>
      </div>
    </div>,
    document.body,
  );
}
