import type { StructureTimeframe } from "./types";

/** TradingView widget interval strings for structure timeframes. */
export function structureTimeframeToTvInterval(
  timeframe: string,
): string {
  const tf = timeframe.trim().toUpperCase();
  if (tf === "1H") return "60";
  if (tf === "2H") return "120";
  if (tf === "4H") return "240";
  if (tf === "1D") return "D";
  return "120";
}

export function isStructureTimeframeLabel(
  value: string,
): value is StructureTimeframe {
  return value === "1H" || value === "2H" || value === "4H" || value === "1D";
}
