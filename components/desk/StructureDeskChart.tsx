"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { StructureSetupOverlay } from "@/lib/structure/lwc-setup-overlay";
import type { StructureChartPayload } from "@/lib/structure/chart-payload";
import { structureChartDataWindow } from "@/lib/structure/chart-data-label";
import {
  autoscaleForMode,
  buildZoneSpecs,
  canExpandFullTradeAxis,
  entryPrice,
  levelInViewport,
  setupViewport,
  slTpOffChart,
  usesCompactRrStrip,
  type ChartZoomMode,
} from "@/lib/structure/chart-viewport";
import {
  TV_CANDLE_DOWN,
  TV_CANDLE_UP,
  TV_FOREX_PRICE_FORMAT,
  TV_LINE_COLORS,
  tvChartOptions,
} from "@/lib/structure/tv-chart-theme";
import { readTheme } from "@/components/theme/theme";

function fx(value: number): string {
  return value.toFixed(5);
}

export function StructureDeskChart({ chart }: { chart: StructureChartPayload }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [zoomMode, setZoomMode] = useState<ChartZoomMode>("setup");

  const lastBar = chart.bars[chart.bars.length - 1];
  const prevBar = chart.bars[Math.max(0, chart.bars.length - 2)];

  const setupView = useMemo(
    () => setupViewport(chart.bars, chart.levels),
    [chart.bars, chart.levels],
  );
  const axisExpands = useMemo(
    () => canExpandFullTradeAxis(chart.bars, chart.levels),
    [chart.bars, chart.levels],
  );
  const compactRr = useMemo(
    () => usesCompactRrStrip(chart.bars, chart.levels, zoomMode),
    [chart.bars, chart.levels, zoomMode],
  );
  const zoneSpecs = useMemo(
    () => buildZoneSpecs(chart, zoomMode),
    [chart, zoomMode],
  );
  const autoscale = useMemo(
    () => autoscaleForMode(zoomMode, chart.bars, chart.levels),
    [zoomMode, chart.bars, chart.levels],
  );

  const offChartAtSetupZoom = slTpOffChart(chart.levels, setupView);
  const showOffChartNote = zoomMode === "setup" && offChartAtSetupZoom;
  const showCompactRrNote = compactRr;
  const slOffScreen = !levelInViewport(chart.levels.stopLoss, setupView);
  const tpOffScreen = !levelInViewport(chart.levels.takeProfit, setupView);
  const bosVisible = levelInViewport(chart.levels.bosPrice, setupView);
  const entry = entryPrice(chart.levels);

  useEffect(() => {
    setTheme(readTheme());
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const change = lastBar && prevBar ? lastBar.c - prevBar.c : 0;
  const changePct =
    lastBar && prevBar && prevBar.c > 0 ? (change / prevBar.c) * 100 : 0;
  const changeSign = change >= 0 ? "+" : "";
  const changeClass =
    change >= 0 ? "structure-tv-change-up" : "structure-tv-change-down";

  const headerOhlc = lastBar
    ? `O ${fx(lastBar.o)}  H ${fx(lastBar.h)}  L ${fx(lastBar.l)}  C ${fx(lastBar.c)}`
    : "";
  const dataWindow = structureChartDataWindow({
    bars: chart.bars,
    timeframe: chart.timeframe,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let chartApi: import("lightweight-charts").IChartApi | null = null;

    const run = async () => {
      const lwc = await import("lightweight-charts");
      if (disposed || !containerRef.current) return;

      chartApi = lwc.createChart(container, {
        ...tvChartOptions(theme),
        autoSize: true,
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale: { mouseWheel: true, pinch: true },
        timeScale: {
          ...tvChartOptions(theme).timeScale,
          barSpacing: 6,
          minBarSpacing: 2,
          rightOffset: 12,
        },
      });

      const series = chartApi.addSeries(lwc.CandlestickSeries, {
        upColor: TV_CANDLE_UP,
        downColor: TV_CANDLE_DOWN,
        borderVisible: false,
        wickUpColor: TV_CANDLE_UP,
        wickDownColor: TV_CANDLE_DOWN,
        priceLineVisible: true,
        lastValueVisible: true,
        priceFormat: TV_FOREX_PRICE_FORMAT,
      });

      series.setData(
        chart.bars.map((b) => ({
          time: b.t as import("lightweight-charts").UTCTimestamp,
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
        })),
      );

      const overlay = new StructureSetupOverlay(zoneSpecs, autoscale);
      series.attachPrimitive(overlay);

      const { levels } = chart;

      const addLine = (
        price: number,
        color: string,
        title: string,
        dashed = false,
      ) => {
        series.createPriceLine({
          price,
          color,
          lineWidth: 1,
          lineStyle: dashed ? lwc.LineStyle.Dashed : lwc.LineStyle.Solid,
          axisLabelVisible: true,
          title,
          lineVisible: true,
        });
      };

      if (zoomMode === "full") {
        addLine(entry, TV_LINE_COLORS.entry, "Entry");
        addLine(levels.obHigh, TV_LINE_COLORS.ob, "OB top", true);
        addLine(levels.obLow, TV_LINE_COLORS.ob, "OB low", true);
        if (!compactRr) {
          addLine(levels.stopLoss, TV_LINE_COLORS.sl, "SL");
          addLine(levels.takeProfit, TV_LINE_COLORS.tp, "TP");
        }
      } else if (bosVisible) {
        addLine(levels.bosPrice, TV_LINE_COLORS.bos, "BOS");
      }

      chartApi.timeScale().fitContent();
    };

    run();

    return () => {
      disposed = true;
      if (chartApi) {
        chartApi.remove();
        chartApi = null;
      }
    };
  }, [
    chart,
    zoneSpecs,
    theme,
    zoomMode,
    autoscale,
    bosVisible,
    entry,
    compactRr,
  ]);

  return (
    <div className="structure-tv-chart-wrap">
      <div className="structure-tv-head">
        <div className="structure-tv-head-symbol">
          <span className="structure-tv-ticker">{chart.symbol}</span>
          <span className="structure-tv-meta">{chart.timeframe}</span>
        </div>
        <div className="structure-tv-head-stats">
          {headerOhlc ? (
            <span className="structure-tv-ohlc">{headerOhlc}</span>
          ) : null}
          {lastBar && prevBar ? (
            <span className={`structure-tv-change ${changeClass}`}>
              {changeSign}
              {fx(Math.abs(change))} ({changeSign}
              {changePct.toFixed(2)}%)
            </span>
          ) : null}
        </div>
      </div>

      {dataWindow ? (
        <p className="structure-tv-data-range">
          {dataWindow.rangeLabel} · last close {dataWindow.priceAsOfLabel} · scan
          data
        </p>
      ) : null}

      <div className="structure-tv-zoom-bar">
        <div className="structure-tv-zoom-tabs" role="tablist" aria-label="Chart zoom">
          <button
            type="button"
            role="tab"
            aria-selected={zoomMode === "setup"}
            className={`structure-tv-zoom-tab${zoomMode === "setup" ? " is-active" : ""}`}
            onClick={() => setZoomMode("setup")}
          >
            Setup zoom
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={zoomMode === "full"}
            className={`structure-tv-zoom-tab${zoomMode === "full" ? " is-active" : ""}`}
            onClick={() => setZoomMode("full")}
          >
            Full trade
          </button>
        </div>
        {showOffChartNote ? (
          <p className="structure-tv-offchart-note">
            SL / TP are far from price — use{" "}
            <button
              type="button"
              className="structure-tv-offchart-link"
              onClick={() => setZoomMode("full")}
            >
              Full trade
            </button>{" "}
            for RR strips, or see Trade plan →
          </p>
        ) : null}
        {showCompactRrNote ? (
          <p className="structure-tv-offchart-note">
            Green/red strips = direction to TP / SL · exact levels on chart edges
            &amp; Trade plan →
          </p>
        ) : null}
        {zoomMode === "full" && axisExpands ? (
          <p className="structure-tv-offchart-note structure-tv-offchart-note-muted">
            Full SL → TP zoom (tight trade range)
          </p>
        ) : null}
      </div>

      <div className="structure-tv-chart-stage">
        {tpOffScreen ? (
          <div className="structure-tv-edge structure-tv-edge-top">
            TP {fx(chart.levels.takeProfit)}
          </div>
        ) : null}
        <div ref={containerRef} className="structure-tv-chart-host" />
        {slOffScreen ? (
          <div className="structure-tv-edge structure-tv-edge-bottom">
            SL {fx(chart.levels.stopLoss)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
