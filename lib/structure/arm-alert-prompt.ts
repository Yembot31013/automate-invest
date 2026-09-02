import type { StructureChartPayload } from "@/lib/structure/chart-payload";

function fx(value: number): string {
  return value.toFixed(5);
}

/**
 * Composer draft: ask Sidekick to arm a buy-zone alert in plain language.
 * User still hits send — does not create the trigger by itself.
 */
export function structureArmBuyZoneAlertPrompt(
  chart: Pick<StructureChartPayload, "symbol" | "timeframe" | "levels" | "phase">,
): string {
  const { symbol, timeframe, levels, phase } = chart;
  const zone = `${fx(levels.obLow)}–${fx(levels.obHigh)}`;
  const entryLevel = fx(levels.obHigh);

  if (phase === "in_zone") {
    return `Hey — ping me when ${symbol} is at or below ${entryLevel} again (top of our ${timeframe} buy zone ${zone}). Alert only, don't paper buy. Price might already be in the zone, so just catch the next touch.`;
  }

  return `Hey — alert me when ${symbol} drops to ${entryLevel} or below (top of our ${timeframe} buy zone ${zone}). Just the ping, no paper buy.`;
}
