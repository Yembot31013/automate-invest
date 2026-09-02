import { Resend } from "resend";

import { logger } from "@/lib/logger";
import type { BullishStructureSetup } from "@/lib/structure/types";

const DEFAULT_FROM = "Signal Desk <sidechick-invest@kiloapp.org>";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatFx(value: number): string {
  return value.toFixed(5);
}

export type StructureAlertEmailPayload = {
  to: string;
  setup: BullishStructureSetup;
  formatted: string;
  userName?: string | null;
};

export async function sendStructureAlertEmail(
  payload: StructureAlertEmailPayload,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error: "RESEND_API_KEY is not configured — structure alert skipped",
    };
  }

  const from = process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM;
  const { setup, to, formatted, userName } = payload;
  const name = userName?.trim() || "there";
  const resend = new Resend(apiKey);

  const subject = `Structure entry · ${setup.symbol} ${setup.timeframe} · order block touch`;

  const html = `
<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#2e2e2e">
  <p style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#888">Signal Desk · Structure</p>
  <h1 style="font-size:22px;margin:8px 0 4px">Bullish setup in zone — ${escapeHtml(setup.symbol)}</h1>
  <p style="margin:0 0 16px;color:#666;font-size:14px">Hey ${escapeHtml(name)} — price retraced into the order block on ${escapeHtml(setup.timeframe)}.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 16px">
    <tr><td style="padding:6px 0;color:#666">BOS close</td><td style="text-align:right">${formatFx(setup.bosPrice)}</td></tr>
    <tr><td style="padding:6px 0;color:#666">FVG</td><td style="text-align:right">${formatFx(setup.fvgLow)} – ${formatFx(setup.fvgHigh)}</td></tr>
    <tr><td style="padding:6px 0;color:#666">Order block</td><td style="text-align:right">${formatFx(setup.obLow)} – ${formatFx(setup.obHigh)}</td></tr>
    <tr><td style="padding:6px 0;color:#666">Current</td><td style="text-align:right">${formatFx(setup.currentPrice)}</td></tr>
    <tr><td style="padding:6px 0;color:#666">SL / TP</td><td style="text-align:right">${formatFx(setup.stopLoss)} / ${formatFx(setup.takeProfit)}</td></tr>
    <tr><td style="padding:6px 0;color:#666">RR</td><td style="text-align:right">1:${setup.riskReward}</td></tr>
  </table>
  <pre style="white-space:pre-wrap;font-size:13px;line-height:1.45;background:#f6f6f6;padding:12px;border-radius:10px">${escapeHtml(formatted)}</pre>
  <p style="margin:16px 0 0;font-size:12px;color:#888">Heads-up only — nothing was bought or sold. Not financial advice.</p>
</div>`;

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
    });
    if (error) {
      logger.error("email", "structure alert send failed", { error });
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id ?? "sent" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("email", "structure alert exception", { message });
    return { ok: false, error: message };
  }
}
