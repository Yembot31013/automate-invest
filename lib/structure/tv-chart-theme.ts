import { ColorType, type DeepPartial, type ChartOptions } from "lightweight-charts";

/** TradingView-style chart colors (dark / light). */
export function tvChartOptions(theme: "light" | "dark"): DeepPartial<ChartOptions> {
  if (theme === "dark") {
    return {
      layout: {
        background: { type: ColorType.Solid, color: "#131722" },
        textColor: "#d1d4dc",
        fontFamily:
          "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1e222d" },
        horzLines: { color: "#1e222d" },
      },
      crosshair: {
        vertLine: {
          color: "#758696",
          labelBackgroundColor: "#363a45",
        },
        horzLine: {
          color: "#758696",
          labelBackgroundColor: "#363a45",
        },
      },
      rightPriceScale: {
        borderColor: "#2a2e39",
        scaleMargins: { top: 0.08, bottom: 0.12 },
      },
      timeScale: {
        borderColor: "#2a2e39",
        timeVisible: true,
        secondsVisible: false,
      },
    };
  }

  return {
    layout: {
      background: { type: ColorType.Solid, color: "#ffffff" },
      textColor: "#131722",
      fontFamily:
        "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: "#f0f3fa" },
      horzLines: { color: "#f0f3fa" },
    },
    crosshair: {
      vertLine: {
        color: "#9598a1",
        labelBackgroundColor: "#131722",
      },
      horzLine: {
        color: "#9598a1",
        labelBackgroundColor: "#131722",
      },
    },
    rightPriceScale: {
      borderColor: "#e0e3eb",
      scaleMargins: { top: 0.08, bottom: 0.12 },
    },
    timeScale: {
      borderColor: "#e0e3eb",
      timeVisible: true,
      secondsVisible: false,
    },
  };
}

export const TV_CANDLE_UP = "#26a69a";
export const TV_CANDLE_DOWN = "#ef5350";

export const TV_ZONE_COLORS = {
  profit: "rgba(38, 166, 154, 0.28)",
  loss: "rgba(239, 83, 80, 0.28)",
  orderBlock: "rgba(156, 120, 255, 0.38)",
  fvg: "rgba(38, 166, 154, 0.18)",
};

export const TV_LINE_COLORS = {
  bos: "#26a69a",
  entry: "#787b86",
  sl: "#ef5350",
  tp: "#26a69a",
  ob: "#c9a227",
};
