import type { TradeHistoryRow } from "../types/index.ts";

function roundMoney(n: number): number {
  return Number(n.toFixed(2));
}

function roundPct(n: number): number {
  return Number(n.toFixed(2));
}

export function computeRealizedPnl(params: {
  entryPrice: number;
  exitPrice: number;
  quantity: number;
}): { realizedPnl: number; realizedPnlPct: number } {
  const costBasis = params.entryPrice * params.quantity;
  const proceeds = params.exitPrice * params.quantity;
  const realizedPnl = proceeds - costBasis;
  const realizedPnlPct =
    costBasis === 0 ? 0 : (realizedPnl / costBasis) * 100;
  return {
    realizedPnl: roundMoney(realizedPnl),
    realizedPnlPct: roundPct(realizedPnlPct),
  };
}

export function parseSourceFromNotes(notes?: string): {
  source: "manual" | "trigger" | "auto";
  triggerId?: string;
  autoReason?: "dip" | "stop" | "trail";
} {
  if (!notes) return { source: "manual" };
  const triggerMatch = notes.match(/trigger:([^\s|]+)/);
  if (triggerMatch) {
    return { source: "trigger", triggerId: triggerMatch[1] };
  }
  if (notes.includes("auto-entry:dip")) {
    return { source: "auto", autoReason: "dip" };
  }
  if (notes.includes("auto-exit:stop") || notes.includes("stop-loss")) {
    return { source: "auto", autoReason: "stop" };
  }
  if (notes.includes("trail")) {
    return { source: "auto", autoReason: "trail" };
  }
  return { source: "manual" };
}

export function formatTradeHistoryEntry(row: TradeHistoryRow): string {
  if (row.event === "skip") {
    return `${row.at} · skip ${row.symbol} · ${row.reason} (${row.source})`;
  }
  const pnl =
    row.side === "sell" && row.realizedPnl != null
      ? ` · PnL ${row.realizedPnl >= 0 ? "+" : ""}$${row.realizedPnl} (${row.realizedPnlPct ?? 0}%)`
      : "";
  const partial = row.partial ? " · partial" : "";
  return `${row.at} · ${row.side} ${row.quantity} ${row.symbol} @ $${row.price} · $${row.notionalUsd}${pnl}${partial} · ${row.source}`;
}
