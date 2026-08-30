import { Resend } from "resend";

import { logger } from "@/lib/logger";

const DEFAULT_TO = "yembot31013@gmail.com";
const DEFAULT_FROM = "Signal Desk <sidechick-invest@kiloapp.org>";

export type CapabilityGapPayload = {
  userId: string;
  userRequest: string;
  gapTitle: string;
  whyBlocked: string;
  whatExistsToday: string;
  whatToBuild: string;
  suggestedToolsApis?: string;
  priority?: "low" | "medium" | "high";
  conversationContext?: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function section(title: string, body: string): string {
  return `<h2 style="font-size:14px;margin:20px 0 6px;color:#2e2e2e">${escapeHtml(title)}</h2>
<p style="margin:0;white-space:pre-wrap;line-height:1.5;color:#444">${escapeHtml(body)}</p>`;
}

/** Email the product owner a concrete capability-gap report via Resend. */
export async function sendCapabilityGapEmail(
  payload: CapabilityGapPayload,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error: "RESEND_API_KEY is not configured — gap was not emailed",
    };
  }

  const to = process.env.CAPABILITY_GAP_EMAIL?.trim() || DEFAULT_TO;
  const from = process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM;
  const priority = payload.priority ?? "medium";
  const resend = new Resend(apiKey);

  const subject = `[Signal Desk gap · ${priority}] ${payload.gapTitle}`.slice(
    0,
    180,
  );

  const html = `
<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:640px;margin:0 auto;padding:20px">
  <p style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#777">Signal Desk · capability gap</p>
  <h1 style="font-size:22px;margin:8px 0 4px;color:#2e2e2e">${escapeHtml(payload.gapTitle)}</h1>
  <p style="margin:0;color:#777;font-size:13px">Priority: <strong>${escapeHtml(priority)}</strong> · User: <code>${escapeHtml(payload.userId)}</code></p>
  ${section("What the user asked", payload.userRequest)}
  ${section("Why we cannot do it today", payload.whyBlocked)}
  ${section("What exists on the desk now", payload.whatExistsToday)}
  ${section("What to build so the AI can do this", payload.whatToBuild)}
  ${
    payload.suggestedToolsApis
      ? section("Suggested tools / APIs / data", payload.suggestedToolsApis)
      : ""
  }
  ${
    payload.conversationContext
      ? section("Conversation context", payload.conversationContext)
      : ""
  }
  <p style="margin-top:24px;font-size:12px;color:#999">Sent automatically by the reportCapabilityGap tool.</p>
</div>`.trim();

  const text = [
    `Signal Desk capability gap (${priority})`,
    `Title: ${payload.gapTitle}`,
    `User: ${payload.userId}`,
    "",
    "What the user asked:",
    payload.userRequest,
    "",
    "Why blocked:",
    payload.whyBlocked,
    "",
    "What exists today:",
    payload.whatExistsToday,
    "",
    "What to build:",
    payload.whatToBuild,
    payload.suggestedToolsApis
      ? `\nSuggested tools/APIs:\n${payload.suggestedToolsApis}`
      : "",
    payload.conversationContext
      ? `\nContext:\n${payload.conversationContext}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: [to],
      subject,
      html,
      text,
    });

    if (error) {
      logger.error("email", "capability gap send failed", {
        message: error.message,
      });
      return { ok: false, error: error.message };
    }

    const id = data?.id ?? "unknown";
    logger.info("email", "capability gap sent", { id, to });
    return { ok: true, id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("email", "capability gap exception", { message });
    return { ok: false, error: message };
  }
}
