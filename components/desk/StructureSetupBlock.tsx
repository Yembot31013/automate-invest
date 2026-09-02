"use client";

import { useState } from "react";

import { StructureSetupModal } from "@/components/desk/StructureSetupModal";
import type { StructureChartPayload } from "@/lib/structure/chart-payload";

function fx(value: number): string {
  return value.toFixed(5);
}

function phaseBadgeClass(phase: StructureChartPayload["phase"]): string {
  if (phase === "in_zone") return "structure-phase-in";
  if (phase === "waiting_retrace") return "structure-phase-wait";
  return "structure-phase-off";
}

type StructureSetupBlockProps = {
  chart: StructureChartPayload;
  scans?: Array<{ timeframe: string; chart: StructureChartPayload | null }>;
};

/** Compact chat card — full chart opens in a modal (keeps chat clean). */
export function StructureSetupBlock({
  chart,
  scans = [],
}: StructureSetupBlockProps) {
  const [open, setOpen] = useState(false);
  const { levels, phase, symbol, timeframe } = chart;
  const tfCount =
    scans.filter((s) => s.chart).length || 1;

  return (
    <>
      <div className="structure-preview-card">
        <div className="structure-preview-head">
          <div>
            <p className="structure-preview-title">
              {symbol} · {timeframe} bullish setup
            </p>
            <p className="structure-preview-sub">
              {tfCount > 1
                ? `${tfCount} timeframes · open for setup map`
                : "Open for buy zone, stop, and target"}
            </p>
          </div>
          <span className={`structure-phase-badge ${phaseBadgeClass(phase)}`}>
            {phase === "in_zone"
              ? "IN ZONE"
              : phase === "waiting_retrace"
                ? "WAITING"
                : "OFF"}
          </span>
        </div>

        <div className="structure-preview-levels">
          <div className="structure-preview-stat structure-preview-stat-buy">
            <span className="structure-preview-stat-label">Buy zone</span>
            <span className="structure-preview-stat-value">
              {fx(levels.obLow)} – {fx(levels.obHigh)}
            </span>
          </div>
          <div className="structure-preview-stat structure-preview-stat-sl">
            <span className="structure-preview-stat-label">Stop loss</span>
            <span className="structure-preview-stat-value">
              {fx(levels.stopLoss)}
            </span>
          </div>
          <div className="structure-preview-stat structure-preview-stat-tp">
            <span className="structure-preview-stat-label">Take profit</span>
            <span className="structure-preview-stat-value">
              {fx(levels.takeProfit)}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="structure-preview-open btn-primary w-full !py-2.5 text-sm"
          onClick={() => setOpen(true)}
        >
          Open full chart
        </button>
      </div>

      <StructureSetupModal
        open={open}
        onClose={() => setOpen(false)}
        chart={chart}
        scans={scans}
      />
    </>
  );
}

export function structureChartFromToolOutput(output: unknown): {
  chart: StructureChartPayload | null;
  scans: Array<{ timeframe: string; chart: StructureChartPayload | null }>;
} {
  if (!output || typeof output !== "object") {
    return { chart: null, scans: [] };
  }
  const o = output as {
    chart?: unknown;
    scans?: Array<{ timeframe?: string; chart?: unknown }>;
  };

  const scans = Array.isArray(o.scans)
    ? o.scans
        .filter((s) => s && typeof s === "object")
        .map((s) => ({
          timeframe: String(s.timeframe ?? ""),
          chart: isChart(s.chart) ? s.chart : null,
        }))
        .filter((s) => s.timeframe)
    : [];

  const chart = isChart(o.chart) ? o.chart : pickPrimaryChart(scans);
  return { chart, scans };
}

function isChart(value: unknown): value is StructureChartPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as StructureChartPayload;
  return Array.isArray(v.bars) && v.bars.length >= 2 && v.levels != null;
}

function pickPrimaryChart(
  scans: Array<{ timeframe: string; chart: StructureChartPayload | null }>,
): StructureChartPayload | null {
  const preferred = ["2H", "1H", "4H", "1D"];
  for (const tf of preferred) {
    const hit = scans.find((s) => s.timeframe === tf && s.chart);
    if (hit?.chart) return hit.chart;
  }
  return scans.find((s) => s.chart)?.chart ?? null;
}
