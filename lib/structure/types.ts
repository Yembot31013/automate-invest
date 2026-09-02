/** Bullish BOS + FVG + order-block setup phases. */
export type StructurePhase =
  | "waiting_retrace"
  | "in_zone"
  | "invalidated";

export type StructureTimeframe = "1H" | "2H" | "4H" | "1D";

/** Detected bullish structure setup on intraday candles. */
export type BullishStructureSetup = {
  symbol: string;
  timeframe: StructureTimeframe;
  phase: StructurePhase;
  bosPrice: number;
  swingHighPrice: number;
  fvgLow: number;
  fvgHigh: number;
  obLow: number;
  obHigh: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  currentPrice: number;
  /** Unix seconds — bar where BOS confirmed. */
  setupBarTime: number;
  reason: string;
};

export type StructureScanResult = {
  setup: BullishStructureSetup | null;
  barCount: number;
};
