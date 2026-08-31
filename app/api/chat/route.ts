import { auth } from "@clerk/nextjs/server";
import { google } from "@ai-sdk/google";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";

import { lastUserText } from "@/lib/agent/chat-text";
import { buildDeskInstructions } from "@/lib/agent/prompt";
import { requiresSnapshotFirst } from "@/lib/agent/snapshot-intent";
import { createDeskTools } from "@/lib/agent/tools";
import { withUniqueMessageIds } from "@/lib/agent/messages";
import { withoutDeskEventMessages } from "@/lib/desk-events";
import { getDeskSettings } from "@/lib/desk-settings-store";
import { logger } from "@/lib/logger";
import {
  clearChatMessages,
  getChatMessages,
  getUserWatchlist,
  saveChatMessages,
} from "@/lib/redis";
import { listUserTriggers } from "@/lib/triggers-store";
import { formatTriggerSummary } from "@/lib/triggers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const messages = withUniqueMessageIds(
    await getChatMessages<UIMessage>(userId),
  );
  return Response.json({ messages });
}

export async function DELETE() {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    await clearChatMessages(userId);
    return Response.json({ ok: true, messages: [] });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to clear chat";
    logger.error("api/chat", message, { userId });
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
    return Response.json(
      { error: "Missing GOOGLE_GENERATIVE_AI_API_KEY" },
      { status: 500 },
    );
  }

  try {
    const body = (await request.json()) as { messages?: UIMessage[] };
    const messages = withUniqueMessageIds(body.messages ?? []);
    const watchlist = await getUserWatchlist(userId);
    const deskSettings = await getDeskSettings(userId);
    const triggers = await listUserTriggers(userId);
    const tools = createDeskTools(userId);
    const userText = lastUserText(messages);
    const forceSnapshotFirst = requiresSnapshotFirst(userText);
    const modelMessages = withoutDeskEventMessages(messages);

    const assistantCreatedAt = new Date().toISOString();

    const result = streamText({
      model: google("gemini-2.5-pro"),
      instructions: buildDeskInstructions({
        watchlistSymbols: watchlist.map((entry) => entry.symbol),
        triggerSummaries: triggers.map(formatTriggerSummary),
        autoTradeEnabled: deskSettings.autoTradeEnabled,
        takeProfitPct: deskSettings.takeProfitPct,
        stopLossPct: deskSettings.stopLossPct,
        trailGivebackPct: deskSettings.trailGivebackPct,
        allowAutoBuys: deskSettings.allowAutoBuys,
      }),
      messages: await convertToModelMessages(modelMessages),
      tools,
      stopWhen: isStepCount(8),
      prepareStep: ({ stepNumber, steps }) => {
        if (!forceSnapshotFirst || stepNumber > 0) return {};

        const snapshotted = steps.some((step) =>
          step.toolCalls.some((call) => call.toolName === "getSnapshot"),
        );
        if (snapshotted) return {};

        return {
          toolChoice: "required",
          activeTools: ["getSnapshot"],
        };
      },
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        tools,
        originalMessages: messages,
        messageMetadata: ({ part }) => {
          if (part.type === "start" || part.type === "finish") {
            return { createdAt: assistantCreatedAt };
          }
          return undefined;
        },
        onEnd: async ({ messages: nextMessages }) => {
          try {
            await saveChatMessages(
              userId,
              withUniqueMessageIds(nextMessages),
            );
          } catch (error) {
            logger.error("api/chat", "persist failed", {
              userId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
      }),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Chat request failed";
    logger.error("api/chat", message, { userId });
    return Response.json({ error: message }, { status: 500 });
  }
}
