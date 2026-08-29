import { auth } from "@clerk/nextjs/server";
import { google } from "@ai-sdk/google";
import {
  convertToModelMessages,
  isStepCount,
  streamText,
  type UIMessage,
} from "ai";

import { buildDeskInstructions } from "@/lib/agent/prompt";
import { createDeskTools } from "@/lib/agent/tools";
import { withUniqueMessageIds } from "@/lib/agent/messages";
import { logger } from "@/lib/logger";
import { getChatMessages, saveChatMessages, clearChatMessages } from "@/lib/redis";

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

    const result = streamText({
      model: google("gemini-2.5-pro"),
      instructions: buildDeskInstructions(),
      messages: await convertToModelMessages(messages),
      tools: createDeskTools(userId),
      stopWhen: isStepCount(8),
    });

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      onFinish: async ({ messages: nextMessages }) => {
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
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Chat request failed";
    logger.error("api/chat", message, { userId });
    return Response.json({ error: message }, { status: 500 });
  }
}
