import { getClerkUserEmail } from "@/lib/clerk-user";
import { structureEntryCopy } from "@/lib/desk-event-copy";
import { appendDeskEvent } from "@/lib/desk-events";
import { sendStructureAlertEmail } from "@/lib/email/structure-alert";
import { logger } from "@/lib/logger";
import {
  detectBullishStructure,
  formatStructureSetup,
} from "@/lib/structure/bos-fvg-ob";
import {
  buildStructureChartPayload,
  type StructureChartPayload,
} from "@/lib/structure/chart-payload";
import {
  DEFAULT_STRUCTURE_TIMEFRAME,
  fetchForexStructureBars,
  isStructureTimeframe,
  STRUCTURE_TIMEFRAMES,
  type StructureTimeframe,
} from "@/lib/structure/timeframes";
import type { BullishStructureSetup } from "@/lib/structure/types";
import { isForexPair } from "@/lib/symbols";
import { getSymbolWatchers, markAlertSent, wasAlertedRecently } from "@/lib/redis";
import { mapPool } from "@/lib/concurrency";
import type { OhlcBar } from "@/types";

const STRUCTURE_ALERT_TYPE = "structure-entry";

export type StructureScanRow = {
  timeframe: StructureTimeframe;
  setup: BullishStructureSetup | null;
  chart: StructureChartPayload | null;
  barCount: number;
};

export type StructureSidebarRow = {
  symbol: string;
  timeframe: StructureTimeframe;
  phase: BullishStructureSetup["phase"] | "none";
  currentPrice: number | null;
  obLow: number | null;
  obHigh: number | null;
  riskReward: number | null;
};

function rankSetup(setup: BullishStructureSetup | null): number {
  if (!setup) return -1;
  if (setup.phase === "in_zone") return 100 + setup.riskReward;
  if (setup.phase === "waiting_retrace") return 50 + setup.riskReward;
  return 0;
}

export function pickBestStructureScan(
  scans: StructureScanRow[],
): StructureScanRow | null {
  const ranked = scans
    .filter((s) => s.setup != null)
    .sort((a, b) => rankSetup(b.setup) - rankSetup(a.setup));
  return ranked[0] ?? null;
}

export async function scanForexStructureDetailed(
  symbol: string,
  timeframe: StructureTimeframe = DEFAULT_STRUCTURE_TIMEFRAME,
): Promise<StructureScanRow> {
  if (!isForexPair(symbol)) {
    return {
      timeframe,
      setup: null,
      chart: null,
      barCount: 0,
    };
  }
  try {
    const bars = await fetchForexStructureBars(symbol, timeframe);
    const result = detectBullishStructure(symbol, bars, timeframe);
    const setup = result.setup;
    const chart =
      setup != null ? buildStructureChartPayload(symbol, bars, setup) : null;
    return {
      timeframe,
      setup,
      chart,
      barCount: result.barCount,
    };
  } catch (error) {
    logger.warn("structure", "scan failed", {
      symbol,
      timeframe,
      error: error instanceof Error ? error.message : String(error),
    });
    return { timeframe, setup: null, chart: null, barCount: 0 };
  }
}

export async function scanForexStructureAllTimeframes(
  symbol: string,
): Promise<StructureScanRow[]> {
  const scans = await mapPool([...STRUCTURE_TIMEFRAMES], 2, async (tf) =>
    scanForexStructureDetailed(symbol, tf),
  );
  return scans;
}

export async function scanForexStructure(
  symbol: string,
  timeframe: StructureTimeframe = DEFAULT_STRUCTURE_TIMEFRAME,
): Promise<BullishStructureSetup | null> {
  const row = await scanForexStructureDetailed(symbol, timeframe);
  return row.setup;
}

export async function scanForexStructureForSidebar(
  symbol: string,
): Promise<StructureSidebarRow> {
  const row = await scanForexStructureDetailed(
    symbol,
    DEFAULT_STRUCTURE_TIMEFRAME,
  );
  return {
    symbol: symbol.toUpperCase(),
    timeframe: row.timeframe,
    phase: row.setup?.phase ?? "none",
    currentPrice: row.setup?.currentPrice ?? null,
    obLow: row.setup?.obLow ?? null,
    obHigh: row.setup?.obHigh ?? null,
    riskReward: row.setup?.riskReward ?? null,
  };
}

export type StructureScanOutcome = {
  symbol: string;
  setup: BullishStructureSetup | null;
  alerted: boolean;
  skipped?: string;
};

/** Scan one forex pair; alert watchers only when price is in the order-block zone. */
export async function evaluateStructureForSymbol(
  symbol: string,
  options: { userId?: string; notify: boolean },
): Promise<StructureScanOutcome> {
  const setup = await scanForexStructure(symbol, DEFAULT_STRUCTURE_TIMEFRAME);
  if (!setup || setup.phase !== "in_zone") {
    return { symbol, setup, alerted: false };
  }

  const alertType = STRUCTURE_ALERT_TYPE;
  if (await wasAlertedRecently(symbol, alertType)) {
    return {
      symbol,
      setup,
      alerted: false,
      skipped: `${symbol}:${alertType}`,
    };
  }

  if (options.notify) {
    if (options.userId) {
      await deliverStructureAlert({ userId: options.userId, setup });
    } else {
      const watchers = await getSymbolWatchers(symbol);
      await mapPool(watchers, 2, async (uid) => {
        await deliverStructureAlert({ userId: uid, setup });
        return null;
      });
    }
    await markAlertSent(symbol, alertType);
  }

  return { symbol, setup, alerted: true };
}

export async function deliverStructureAlert(params: {
  userId: string;
  setup: BullishStructureSetup;
}): Promise<void> {
  const { userId, setup } = params;
  const email = await getClerkUserEmail(userId);
  const formatted = formatStructureSetup(setup);

  let emailed = false;
  if (email) {
    const sent = await sendStructureAlertEmail({
      to: email,
      setup,
      formatted,
    });
    emailed = sent.ok;
    if (!sent.ok) {
      logger.error("structure", "alert email failed", {
        userId,
        symbol: setup.symbol,
        error: sent.error,
      });
    }
  }

  const chip = structureEntryCopy({ setup, emailed });
  await appendDeskEvent(userId, {
    kind: "structure-entry",
    text: chip.text,
    hint: chip.hint,
    symbol: setup.symbol,
    tape: {
      price: setup.currentPrice,
      changePct: 0,
    },
  });
}

export {
  formatStructureSetup,
  isStructureTimeframe,
  STRUCTURE_ALERT_TYPE,
  STRUCTURE_TIMEFRAMES,
};
