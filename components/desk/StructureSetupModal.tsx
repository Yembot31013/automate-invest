"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { readTheme } from "@/components/theme/theme";
import type { StructureChartPayload } from "@/lib/structure/chart-payload";
import { structureChartDataWindow } from "@/lib/structure/chart-data-label";
import { setupViewport, slTpOffChart } from "@/lib/structure/chart-viewport";
import { structureTimeframeToTvInterval } from "@/lib/structure/tv-interval";
import { StructureDeskChart } from "@/components/desk/StructureDeskChart";
import {
  toTradingViewSymbol,
  tradingViewEmbedUrl,
  tradingViewSymbolPageUrl,
} from "@/components/desk/TradingViewModal";

type StructureSetupModalProps = {
  open: boolean;
  onClose: () => void;
  chart: StructureChartPayload;
  scans?: Array<{ timeframe: string; chart: StructureChartPayload | null }>;
};

function fx(value: number): string {
  return value.toFixed(5);
}

function phaseLabel(phase: StructureChartPayload["phase"]): string {
  if (phase === "in_zone") return "Price in buy zone";
  if (phase === "waiting_retrace") return "Waiting for retrace into buy zone";
  return "Setup invalidated";
}

function phaseBadgeClass(phase: StructureChartPayload["phase"]): string {
  if (phase === "in_zone") return "structure-phase-in";
  if (phase === "waiting_retrace") return "structure-phase-wait";
  return "structure-phase-off";
}

function TradePlanPanel({
  chart,
  view,
}: {
  chart: StructureChartPayload;
  view: "desk" | "tradingview";
}) {
  const { levels, phase } = chart;
  const inZone = phase === "in_zone";
  const setupView = setupViewport(chart.bars, levels);
  const slTpFar = slTpOffChart(levels, setupView);
  const dataWindow = structureChartDataWindow({
    bars: chart.bars,
    timeframe: chart.timeframe,
  });

  return (
    <aside className="structure-levels-panel">
      <p className="structure-levels-panel-title">Trade plan</p>

      {view === "tradingview" ? (
        <p className="structure-scan-live-note">
          <strong>Live chart</strong> on the left. Levels below are from our scan
          snapshot
          {dataWindow ? ` (${dataWindow.priceAsOfLabel})` : ""} — prices may not
          match.
        </p>
      ) : dataWindow ? (
        <p className="structure-scan-data-note">
          Scan snapshot · {dataWindow.barCount} × {chart.timeframe} ·{" "}
          {dataWindow.rangeLabel}. Not live ticks.
        </p>
      ) : null}

      {view === "desk" && slTpFar ? (
        <p className="structure-trade-offchart-hint">
          Stop &amp; target are far from price. Use <strong>Full trade</strong> for
          RR strips; exact SL/TP stay in this panel.
        </p>
      ) : null}

      <div className="structure-trade-hero">
        <div className="structure-trade-hero-card structure-trade-hero-buy">
          <span className="structure-trade-hero-label">Buy (long)</span>
          <span className="structure-trade-hero-value">
            {fx(levels.obLow)} – {fx(levels.obHigh)}
          </span>
          <span className="structure-trade-hero-hint">
            {inZone
              ? "Enter in the purple order block on chart"
              : "Wait for price to retrace into the purple zone"}
          </span>
        </div>
        <div className="structure-trade-hero-card structure-trade-hero-sl">
          <span className="structure-trade-hero-label">Stop loss</span>
          <span className="structure-trade-hero-value">{fx(levels.stopLoss)}</span>
          <span className="structure-trade-hero-hint">Exit if price hits this level</span>
        </div>
        <div className="structure-trade-hero-card structure-trade-hero-tp">
          <span className="structure-trade-hero-label">Take profit</span>
          <span className="structure-trade-hero-value">{fx(levels.takeProfit)}</span>
          <span className="structure-trade-hero-hint">
            Target exit · R:R 1 : {levels.riskReward}
          </span>
        </div>
      </div>

      <p className="structure-levels-panel-divider">Structure</p>
      <dl className="structure-detail-list">
        <div className="structure-detail-row">
          <dt>Break of structure</dt>
          <dd>{fx(levels.bosPrice)}</dd>
        </div>
        <div className="structure-detail-row">
          <dt>Fair value gap</dt>
          <dd>
            {fx(levels.fvgLow)} – {fx(levels.fvgHigh)}
          </dd>
        </div>
        <div className="structure-detail-row structure-detail-row--stack">
          <dt>Last close (scan)</dt>
          <dd>
            <span className="structure-detail-price">
              {fx(levels.currentPrice)}
            </span>
            {dataWindow ? (
              <span className="structure-detail-asof">
                as of {dataWindow.priceAsOfLabel}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
    </aside>
  );
}

export function StructureSetupModal({
  open,
  onClose,
  chart,
  scans = [],
}: StructureSetupModalProps) {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [view, setView] = useState<"tradingview" | "desk">("desk");
  const titleId = useId();

  const tabs = useMemo(() => {
    const fromScans = scans
      .filter((s) => s.chart)
      .map((s) => ({ timeframe: s.timeframe, chart: s.chart! }));
    if (fromScans.length > 0) return fromScans;
    return [{ timeframe: chart.timeframe, chart }];
  }, [chart, scans]);

  const [activeTf, setActiveTf] = useState(chart.timeframe);
  const activeChart =
    tabs.find((t) => t.timeframe === activeTf)?.chart ?? chart;

  const dataWindow = structureChartDataWindow({
    bars: activeChart.bars,
    timeframe: activeChart.timeframe,
  });

  const tvSymbol = toTradingViewSymbol(activeChart.symbol, "FOREX");
  const tvPage = tradingViewSymbolPageUrl(tvSymbol);
  const tvInterval = structureTimeframeToTvInterval(activeChart.timeframe);

  useEffect(() => setMounted(true), []);

  const openedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      openedRef.current = false;
      return;
    }
    if (openedRef.current) return;
    openedRef.current = true;
    setTheme(readTheme());
    setView("desk");
    setActiveTf(chart.timeframe);
  }, [open, chart.timeframe]);

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
      className="modal-overlay modal-overlay-chart fade-up"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card modal-card-structure"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="structure-modal-head">
          <div className="structure-modal-head-copy min-w-0">
            <h3 id={titleId} className="structure-modal-title">
              {activeChart.symbol}
              <span className="structure-modal-tf">{activeChart.timeframe}</span>
            </h3>
            <p className="structure-modal-sub">{phaseLabel(activeChart.phase)}</p>
            {dataWindow ? (
              <p className="structure-modal-data-range">
                {view === "desk"
                  ? `Scan window · ${dataWindow.rangeLabel}`
                  : `Scan levels · as of ${dataWindow.priceAsOfLabel}`}
              </p>
            ) : null}
          </div>
          <div className="structure-modal-head-actions">
            <span
              className={`structure-phase-badge ${phaseBadgeClass(activeChart.phase)}`}
            >
              {activeChart.phase === "in_zone"
                ? "IN ZONE"
                : activeChart.phase === "waiting_retrace"
                  ? "WAITING"
                  : "OFF"}
            </span>
            <button
              type="button"
              className="btn-primary structure-modal-close"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>

        <div className="structure-modal-toolbar">
          {tabs.length > 1 ? (
            <div className="structure-tf-tabs structure-tf-tabs-inline" role="tablist">
              {tabs.map((tab) => (
                <button
                  key={tab.timeframe}
                  type="button"
                  role="tab"
                  aria-selected={activeTf === tab.timeframe}
                  className={`structure-tf-tab${activeTf === tab.timeframe ? " is-active" : ""}`}
                  onClick={() => setActiveTf(tab.timeframe)}
                >
                  {tab.timeframe}
                </button>
              ))}
            </div>
          ) : null}
          <div className="structure-view-tabs">
            <button
              type="button"
              className={`structure-view-tab${view === "desk" ? " is-active" : ""}`}
              onClick={() => setView("desk")}
            >
              Setup map
            </button>
            <button
              type="button"
              className={`structure-view-tab${view === "tradingview" ? " is-active" : ""}`}
              onClick={() => setView("tradingview")}
            >
              TradingView
            </button>
            <a
              href={tvPage}
              target="_blank"
              rel="noreferrer"
              className="structure-view-tab structure-view-tab-link"
            >
              Open ↗
            </a>
          </div>
        </div>

        <div className="structure-modal-body">
          <div className="structure-modal-chart-col">
            {view === "tradingview" ? (
              <div className="tv-chart-frame structure-tv-frame">
                <iframe
                  key={`${tvSymbol}-${tvInterval}-${theme}`}
                  title={`${activeChart.symbol} TradingView ${activeChart.timeframe}`}
                  src={tradingViewEmbedUrl(tvSymbol, theme, tvInterval)}
                  className="tv-chart-iframe"
                  allow="fullscreen"
                />
              </div>
            ) : (
              <StructureDeskChart chart={activeChart} />
            )}
          </div>
          <TradePlanPanel chart={activeChart} view={view} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
