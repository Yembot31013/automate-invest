import { google } from "@ai-sdk/google";
import { generateText } from "ai";

import { buildAlertReactionPrompt } from "@/lib/agent/prompt";
import type { AlertPayload } from "@/types";

/**
 * Optional humorous one-liner for Discord embeds.
 * Fail-open: returns null if Gemini is unavailable.
 */
export async function generateAlertReaction(
  alert: AlertPayload,
): Promise<string | null> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
    return null;
  }

  try {
    const { text } = await generateText({
      model: google("gemini-2.5-flash"),
      prompt: buildAlertReactionPrompt({
        type: alert.type,
        symbol: alert.snapshot.symbol,
        title: alert.title,
        description: alert.description,
      }),
      maxOutputTokens: 80,
    });

    const line = text?.trim().replace(/^["']|["']$/g, "");
    if (!line) {
      return null;
    }
    return line.slice(0, 160);
  } catch (error) {
    console.error("[agent/reaction] failed:", error);
    return null;
  }
}
