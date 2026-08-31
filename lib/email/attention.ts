import { Resend } from "resend";

import { logger } from "@/lib/logger";
import type { AlertPayload } from "@/types";

const DEFAULT_FROM = "Signal Desk <sidechick-invest@kiloapp.org>";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export type AttentionEmailPayload = {
  to: string;
  userName?: string | null;
  alert: AlertPayload;
  reactionLine?: string | null;
  /** Extra pal bullets (why it matters / what to check) */
  points?: string[];
  /** True when Auto is on but chose to alert instead of trade */
  autoUnsure?: boolean;
};

/** Personalized Attention mail — never executes a trade. */
export async function sendAttentionEmail(
  payload: AttentionEmailPayload,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error: "RESEND_API_KEY is not configured — Attention mail skipped",
    };
  }

  const from = process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM;
  const { alert, to, reactionLine, points, autoUnsure, userName } = payload;
  const snap = alert.snapshot;
  const name = userName?.trim() || "there";
  const resend = new Resend(apiKey);

  const subject = autoUnsure
    ? `Auto paused · check ${snap.symbol} (${alert.type})`
    : `Attention · ${snap.symbol} ${alert.type}`;

  const pointList =
    points && points.length > 0
      ? points
      : [
          alert.description.replace(/\*\*/g, "").slice(0, 280),
          `Mark ~${formatUsd(snap.currentPrice)} · day ${snap.changePct >= 0 ? "+" : ""}${snap.changePct.toFixed(2)}%`,
          "This is a heads-up only — nothing was bought or sold for you.",
        ];

  const html = `
<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#2e2e2e">
  <p style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#888">Signal Desk · Attention</p>
  <h1 style="font-size:22px;margin:8px 0 4px">${escapeHtml(alert.title)}</h1>
  <p style="margin:0 0 16px;color:#666;font-size:14px">Hey ${escapeHtml(name)} — quick tap on the shoulder for <strong>${escapeHtml(snap.symbol)}</strong>.</p>
  ${
    reactionLine?.trim()
      ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.45">${escapeHtml(reactionLine.trim())}</p>`
      : ""
  }
  ${
    autoUnsure
      ? `<p style="margin:0 0 16px;padding:10px 12px;background:#fff8e8;border-radius:10px;font-size:13px">Auto-trade is on, but Sidekick is <strong>not sure</strong> enough to move paper cash — your call.</p>`
      : ""
  }
  <ul style="padding-left:18px;margin:0 0 16px;line-height:1.55;font-size:14px;color:#444">
    ${pointList.map((p) => `<li style="margin-bottom:6px">${escapeHtml(p)}</li>`).join("")}
  </ul>
  <p style="margin:0;font-size:12px;color:#999">Not financial advice. Open the desk to act — or leave it if you disagree.</p>
</div>`.trim();

  const text = [
    `Signal Desk Attention — ${snap.symbol} (${alert.type})`,
    `Hey ${name},`,
    reactionLine?.trim() || "",
    autoUnsure
      ? "Auto is on but unsure — no paper trade was placed."
      : "Heads-up only — nothing was bought or sold.",
    "",
    ...pointList.map((p) => `• ${p}`),
    "",
    "Not financial advice.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: [to],
      subject: subject.slice(0, 180),
      html,
      text,
    });
    if (error) {
      logger.error("email", "attention send failed", { message: error.message });
      return { ok: false, error: error.message };
    }
    const id = data?.id ?? "unknown";
    logger.info("email", "attention sent", { id, to, symbol: snap.symbol });
    return { ok: true, id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("email", "attention exception", { message });
    return { ok: false, error: message };
  }
}
