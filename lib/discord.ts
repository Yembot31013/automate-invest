import type {
  AlertPayload,
  AlertType,
  DiscordEmbed,
  DiscordWebhookPayload,
  MarketSnapshot,
} from "@/types";

/** Soft Crimson — dip / pullback accent. */
export const COLOR_DIP = 0xe05656;

/** Emerald / Mint Sage — breakout / growth accent. */
export const COLOR_BREAKOUT = 0x4e9f3d;

const MAX_CHART_POINTS = 20;

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPct(value: number, signed = true): string {
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

function formatVolume(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toFixed(0);
}

function accentFor(type: AlertType): number {
  return type === "dip" ? COLOR_DIP : COLOR_BREAKOUT;
}

function chartLineColor(type: AlertType): string {
  return type === "dip" ? "#E05656" : "#4E9F3D";
}

/**
 * Encode a minimalist dark-mode QuickChart line chart URL from close prices.
 * Kept short so Discord's image URL limit is respected.
 */
export function buildQuickChartUrl(
  closes: number[],
  symbol: string,
  type: AlertType,
): string {
  if (!closes.length) {
    throw new Error(`Cannot build chart: empty close series for ${symbol}`);
  }

  const points = closes.slice(-MAX_CHART_POINTS).map((v) => Number(v.toFixed(2)));
  const labels = points.map((_, index) => String(index + 1));

  const config = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: symbol,
          data: points,
          borderColor: chartLineColor(type),
          backgroundColor: "rgba(255,255,255,0.04)",
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.35,
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: `${symbol} · ${MAX_CHART_POINTS}d`,
          color: "#E8E8E8",
          font: { size: 13, weight: "600" },
        },
      },
      scales: {
        x: {
          display: false,
          grid: { display: false },
        },
        y: {
          ticks: { color: "#9CA3AF", font: { size: 10 } },
          grid: { color: "rgba(255,255,255,0.06)" },
        },
      },
    },
  };

  const params = new URLSearchParams({
    c: JSON.stringify(config),
    backgroundColor: "rgb(22,22,26)",
    width: "600",
    height: "280",
    devicePixelRatio: "2",
  });

  return `https://quickchart.io/chart?${params.toString()}`;
}

function buildDescription(payload: AlertPayload): string {
  if (payload.description) {
    return payload.description;
  }

  const { snapshot, type } = payload;
  if (type === "dip") {
    return (
      `${snapshot.symbol} is trading **${formatPct(snapshot.pctBelowSma14, false)}** ` +
      `below its 14-day SMA (${formatUsd(snapshot.sma14)}). ` +
      `Short-term dislocation may present a mean-reversion entry once catalysts clear.`
    );
  }

  return (
    `Volume has crossed **${snapshot.volumeRatio.toFixed(2)}×** the 20-day average` +
    (snapshot.sentimentScore !== null
      ? ` alongside a sentiment score of **${snapshot.sentimentScore.toFixed(2)}**`
      : "") +
    `. Structural accumulation suggests an early under-the-radar breakout.`
  );
}

/** Map a financial alert into a structured Discord embed micro-dashboard. */
export function buildAlertEmbed(payload: AlertPayload): DiscordEmbed {
  const { snapshot, type, title } = payload;
  const assetLabel = `${snapshot.exchange}:${snapshot.symbol}`;

  const fields = [
    {
      name: "Current Price",
      value: formatUsd(snapshot.currentPrice),
      inline: true,
    },
    {
      name: type === "dip" ? "% Off SMA(14)" : "Change %",
      value:
        type === "dip"
          ? formatPct(-snapshot.pctBelowSma14)
          : formatPct(snapshot.changePct),
      inline: true,
    },
    {
      name: "Vol Ratio",
      value: `${snapshot.volumeRatio.toFixed(2)}×`,
      inline: true,
    },
    {
      name: "24h Volume",
      value: formatVolume(snapshot.volume),
      inline: true,
    },
    {
      name: "SMA (14)",
      value: formatUsd(snapshot.sma14),
      inline: true,
    },
    {
      name: "Sentiment",
      value:
        snapshot.sentimentScore === null
          ? "—"
          : snapshot.sentimentScore.toFixed(2),
      inline: true,
    },
  ];

  return {
    author: { name: assetLabel },
    title,
    description: buildDescription(payload),
    color: accentFor(type),
    fields,
    image: {
      url: buildQuickChartUrl(snapshot.closes, snapshot.symbol, type),
    },
    footer: {
      text: "Autonomous Market Alerting Bot · Not financial advice",
    },
    timestamp: new Date().toISOString(),
  };
}

export function buildWebhookPayload(
  payload: AlertPayload,
  reactionLine?: string | null,
): DiscordWebhookPayload {
  const embed = buildAlertEmbed(payload);
  if (reactionLine?.trim()) {
    embed.description = `*${reactionLine.trim()}*\n\n${embed.description ?? ""}`;
  }
  return {
    username: "Signal Desk",
    embeds: [embed],
  };
}

export function createDipAlert(snapshot: MarketSnapshot): AlertPayload {
  const payload: AlertPayload = {
    type: "dip",
    snapshot,
    title: "Sharp Price Pullback Detected",
    description: "",
  };
  payload.description = buildDescription(payload);
  return payload;
}

export function createBreakoutAlert(snapshot: MarketSnapshot): AlertPayload {
  const payload: AlertPayload = {
    type: "breakout",
    snapshot,
    title: "Promising Under-the-Radar Breakout",
    description: "",
  };
  payload.description = buildDescription(payload);
  return payload;
}

/** POST a rich embed to the configured Discord webhook. */
export async function sendDiscordAlert(
  payload: AlertPayload,
  reactionLine?: string | null,
): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    throw new Error("Missing DISCORD_WEBHOOK_URL");
  }

  const body = buildWebhookPayload(payload, reactionLine);
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Discord webhook failed (${response.status}): ${detail || response.statusText}`,
    );
  }
}
