import { fetchYahooDailyOhlc, fetchYahooIntradayOhlc } from "@/lib/market";
import type { OhlcBar } from "@/types";

import { resampleBars } from "./bos-fvg-ob.ts";

export const STRUCTURE_TIMEFRAMES = ["1H", "2H", "4H", "1D"] as const;
export type StructureTimeframe = (typeof STRUCTURE_TIMEFRAMES)[number];

export const DEFAULT_STRUCTURE_TIMEFRAME: StructureTimeframe = "2H";

export function isStructureTimeframe(value: string): value is StructureTimeframe {
  return (STRUCTURE_TIMEFRAMES as readonly string[]).includes(value);
}

export function normalizeStructureTimeframe(
  raw?: string | null,
): StructureTimeframe {
  const tf = raw?.trim().toUpperCase() ?? "";
  if (tf === "1H" || tf === "60M" || tf === "60MIN" || tf === "1HR") {
    return "1H";
  }
  if (tf === "2H" || tf === "120M" || tf === "2HR") return "2H";
  if (tf === "4H" || tf === "240M" || tf === "4HR") return "4H";
  if (tf === "1D" || tf === "D" || tf === "DAILY") return "1D";
  return DEFAULT_STRUCTURE_TIMEFRAME;
}

/** Fetch OHLC bars for structure detection on a forex pair. */
export async function fetchForexStructureBars(
  symbol: string,
  timeframe: StructureTimeframe,
): Promise<OhlcBar[]> {
  if (timeframe === "1D") {
    const series = await fetchYahooDailyOhlc(symbol, "forex", 120);
    return series.bars;
  }

  const series = await fetchYahooIntradayOhlc(symbol, "forex", "60m", "60d");
  if (timeframe === "1H") return series.bars;
  if (timeframe === "2H") return resampleBars(series.bars, 2);
  return resampleBars(series.bars, 4);
}
