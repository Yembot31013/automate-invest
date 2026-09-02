const TF_SECONDS: Record<string, number> = {
  "1H": 3600,
  "2H": 7200,
  "4H": 14400,
  "1D": 86400,
};

function timeframeSeconds(timeframe: string): number {
  return TF_SECONDS[timeframe.toUpperCase()] ?? 7200;
}

const dayFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const dayTimeFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

function formatStamp(unixSec: number, daily: boolean): string {
  const d = new Date(unixSec * 1000);
  return daily ? dayFmt.format(d) : dayTimeFmt.format(d);
}

export type StructureChartDataWindow = {
  barCount: number;
  timeframe: string;
  rangeFromUnix: number;
  rangeToUnix: number;
  priceAsOfUnix: number;
  /** e.g. Aug 29, 12:00 – Sep 2, 12:00 UTC */
  rangeLabel: string;
  /** e.g. Sep 2, 12:00 UTC */
  priceAsOfLabel: string;
};

/**
 * Visible candle window + when last-close was frozen.
 * Uses last bar open as the "as of" stamp (matches the candle that set currentPrice).
 */
export function structureChartDataWindow(params: {
  bars: { t: number }[];
  timeframe: string;
}): StructureChartDataWindow | null {
  const { bars, timeframe } = params;
  if (bars.length === 0) return null;

  const tf = timeframe.toUpperCase();
  const daily = tf === "1D";
  const barDur = timeframeSeconds(tf);
  const rangeFromUnix = bars[0]!.t;
  const lastOpen = bars[bars.length - 1]!.t;
  const priceAsOfUnix = lastOpen;
  const rangeToUnix = lastOpen + barDur;

  const fromLabel = formatStamp(rangeFromUnix, daily);
  const toLabel = formatStamp(lastOpen, daily);

  return {
    barCount: bars.length,
    timeframe: tf,
    rangeFromUnix,
    rangeToUnix,
    priceAsOfUnix,
    rangeLabel: `${fromLabel} – ${toLabel} UTC`,
    priceAsOfLabel: `${formatStamp(priceAsOfUnix, daily)} UTC`,
  };
}
