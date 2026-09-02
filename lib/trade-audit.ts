import {
  appendTradeAuditEntry,
  getTradeAuditEntries,
  getPaperPositions,
} from "@/lib/redis";
import { getPortfolioSummary } from "@/lib/paper";
import { logger } from "@/lib/logger";
import {
  computeRealizedPnl,
  parseSourceFromNotes,
} from "@/lib/trade-audit-helpers";
import type {
  PaperPosition,
  TradeAuditEntry,
  TradeAuditSource,
  TradeAuditTape,
  TradeFillAuditEntry,
  TradeHistoryRow,
  TradeHistorySummary,
} from "@/types";

export {
  computeRealizedPnl,
  formatTradeHistoryEntry,
  parseSourceFromNotes,
} from "@/lib/trade-audit-helpers";

export const MAX_TRADE_AUDIT_ENTRIES = 500;

export type TradeAuditContext = {
  source: TradeAuditSource;
  triggerId?: string;
  triggerSummary?: string;
  autoReason?: "dip" | "stop" | "trail";
  tape?: TradeAuditTape;
};

function createAuditId(): string {
  return `ta_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function persistAuditEntry(
  userId: string,
  entry: TradeAuditEntry,
): Promise<void> {
  try {
    await appendTradeAuditEntry(userId, entry);
  } catch (error) {
    logger.error("trade-audit", "failed to persist audit entry", {
      userId,
      event: entry.event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function roundMoney(n: number): number {
  return Number(n.toFixed(2));
}

export async function recordTradeBuyAudit(params: {
  userId: string;
  position: PaperPosition;
  cashAfter: number;
  audit?: TradeAuditContext;
}): Promise<void> {
  const { position, cashAfter, audit } = params;
  const notionalUsd = roundMoney(position.entryPrice * position.quantity);
  const entry: TradeAuditEntry = {
    id: createAuditId(),
    at: position.entryAt,
    event: "fill",
    side: "buy",
    source: audit?.source ?? parseSourceFromNotes(position.notes).source,
    symbol: position.symbol,
    exchange: position.exchange,
    positionId: position.id,
    quantity: position.quantity,
    price: roundMoney(position.entryPrice),
    notionalUsd,
    cashAfter: roundMoney(cashAfter),
    entryPrice: roundMoney(position.entryPrice),
    entryAt: position.entryAt,
    triggerId: audit?.triggerId,
    triggerSummary: audit?.triggerSummary,
    autoReason: audit?.autoReason,
    notes: position.notes,
    tape: audit?.tape,
  };
  await persistAuditEntry(params.userId, entry);
}

export async function recordTradeSellAudit(params: {
  userId: string;
  closed: PaperPosition;
  cashAfter: number;
  audit?: TradeAuditContext;
  partial?: boolean;
  remainingQty?: number;
  /** Original lot entry when known (partial slice keeps same entry). */
  entryPrice?: number;
  entryAt?: string;
}): Promise<void> {
  const { closed, cashAfter, audit, partial, remainingQty } = params;
  const exitPrice = closed.exitPrice ?? closed.entryPrice;
  const entryPrice = params.entryPrice ?? closed.entryPrice;
  const entryAt = params.entryAt ?? closed.entryAt;
  const { realizedPnl, realizedPnlPct } = computeRealizedPnl({
    entryPrice,
    exitPrice,
    quantity: closed.quantity,
  });
  const parsed = parseSourceFromNotes(closed.notes);
  const entry: TradeAuditEntry = {
    id: createAuditId(),
    at: closed.exitAt ?? new Date().toISOString(),
    event: "fill",
    side: "sell",
    source: audit?.source ?? parsed.source,
    symbol: closed.symbol,
    exchange: closed.exchange,
    positionId: closed.id,
    quantity: closed.quantity,
    price: roundMoney(exitPrice),
    notionalUsd: roundMoney(exitPrice * closed.quantity),
    cashAfter: roundMoney(cashAfter),
    entryPrice: roundMoney(entryPrice),
    entryAt,
    exitPrice: roundMoney(exitPrice),
    exitAt: closed.exitAt,
    realizedPnl,
    realizedPnlPct,
    partial: partial === true,
    remainingQty,
    triggerId: audit?.triggerId ?? parsed.triggerId,
    triggerSummary: audit?.triggerSummary,
    autoReason: audit?.autoReason ?? parsed.autoReason,
    notes: closed.notes,
    tape: audit?.tape,
  };
  await persistAuditEntry(params.userId, entry);
}

export async function recordTradeSkipAudit(params: {
  userId: string;
  symbol: string;
  reason: string;
  audit: TradeAuditContext;
}): Promise<void> {
  const entry: TradeAuditEntry = {
    id: createAuditId(),
    at: new Date().toISOString(),
    event: "skip",
    source: params.audit.source,
    symbol: params.symbol.trim().toUpperCase(),
    reason: params.reason,
    triggerId: params.audit.triggerId,
    triggerSummary: params.audit.triggerSummary,
    autoReason: params.audit.autoReason,
    tape: params.audit.tape,
  };
  await persistAuditEntry(params.userId, entry);
}

function closedLotToLegacySellRow(position: PaperPosition): TradeHistoryRow {
  const exitPrice = position.exitPrice ?? position.entryPrice;
  const { realizedPnl, realizedPnlPct } = computeRealizedPnl({
    entryPrice: position.entryPrice,
    exitPrice,
    quantity: position.quantity,
  });
  const parsed = parseSourceFromNotes(position.notes);
  return {
    id: `legacy_${position.id}`,
    at: position.exitAt ?? position.entryAt,
    event: "fill",
    side: "sell",
    source: parsed.source,
    symbol: position.symbol,
    exchange: position.exchange,
    positionId: position.id,
    quantity: position.quantity,
    price: roundMoney(exitPrice),
    notionalUsd: roundMoney(exitPrice * position.quantity),
    cashAfter: 0,
    entryPrice: roundMoney(position.entryPrice),
    entryAt: position.entryAt,
    exitPrice: roundMoney(exitPrice),
    exitAt: position.exitAt,
    realizedPnl,
    realizedPnlPct,
    partial: position.notes?.includes("partial sell") === true,
    triggerId: parsed.triggerId,
    autoReason: parsed.autoReason,
    notes: position.notes,
    legacy: true,
  };
}

function closedLotToLegacyBuyRow(position: PaperPosition): TradeHistoryRow | null {
  const parsed = parseSourceFromNotes(position.notes);
  return {
    id: `legacy_buy_${position.id}`,
    at: position.entryAt,
    event: "fill",
    side: "buy",
    source: parsed.source,
    symbol: position.symbol,
    exchange: position.exchange,
    positionId: position.id,
    quantity: position.quantity,
    price: roundMoney(position.entryPrice),
    notionalUsd: roundMoney(position.entryPrice * position.quantity),
    cashAfter: 0,
    entryPrice: roundMoney(position.entryPrice),
    entryAt: position.entryAt,
    triggerId: parsed.triggerId,
    autoReason: parsed.autoReason,
    notes: position.notes,
    legacy: true,
  };
}

function summarizeRows(
  rows: TradeHistoryRow[],
  portfolio: Awaited<ReturnType<typeof getPortfolioSummary>>,
): TradeHistorySummary {
  const fills = rows.filter(
    (r): r is TradeFillAuditEntry & { legacy?: boolean } => r.event === "fill",
  );
  const sells = fills.filter(
    (r): r is TradeFillAuditEntry & { side: "sell"; legacy?: boolean } =>
      r.side === "sell",
  );
  const totalRealizedPnl = roundMoney(
    sells.reduce((sum, s) => sum + (s.realizedPnl ?? 0), 0),
  );
  return {
    fillCount: fills.length,
    buyCount: fills.filter((r) => r.side === "buy").length,
    sellCount: sells.length,
    skipCount: rows.filter((r) => r.event === "skip").length,
    totalRealizedPnl,
    winningSells: sells.filter((s) => (s.realizedPnl ?? 0) > 0).length,
    losingSells: sells.filter((s) => (s.realizedPnl ?? 0) < 0).length,
    cash: roundMoney(portfolio.cash),
    openCount: portfolio.openCount,
    equity: roundMoney(portfolio.equity),
  };
}

function symbolKey(symbol: string): string {
  return symbol.trim().toUpperCase().replaceAll("/", "");
}

export async function getTradeHistory(params: {
  userId: string;
  limit?: number;
  symbol?: string;
}): Promise<{ summary: TradeHistorySummary; entries: TradeHistoryRow[] }> {
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const wantSymbol = params.symbol?.trim().toUpperCase();

  const [audit, positions, portfolio] = await Promise.all([
    getTradeAuditEntries(params.userId),
    getPaperPositions(params.userId),
    getPortfolioSummary(params.userId),
  ]);

  const auditedBuyIds = new Set(
    audit
      .filter((e) => e.event === "fill" && e.side === "buy")
      .map((e) => (e as TradeFillAuditEntry).positionId),
  );
  const auditedSellIds = new Set(
    audit
      .filter((e) => e.event === "fill" && e.side === "sell")
      .map((e) => (e as TradeFillAuditEntry).positionId),
  );
  const closed = positions.filter((p) => p.status === "closed");

  const legacyRows: TradeHistoryRow[] = [];
  for (const lot of closed) {
    if (!auditedSellIds.has(lot.id)) {
      legacyRows.push(closedLotToLegacySellRow(lot));
    }
    if (!auditedBuyIds.has(lot.id)) {
      const buyRow = closedLotToLegacyBuyRow(lot);
      if (buyRow) legacyRows.push(buyRow);
    }
  }

  const merged: TradeHistoryRow[] = [
    ...audit.map((e) => ({ ...e, legacy: false })),
    ...legacyRows,
  ];

  const filtered = wantSymbol
    ? merged.filter((r) => symbolKey(r.symbol) === symbolKey(wantSymbol))
    : merged;

  const sorted = [...filtered].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );

  const entries = sorted.slice(0, limit);
  const summary = summarizeRows(sorted, portfolio);

  return { summary, entries };
}
