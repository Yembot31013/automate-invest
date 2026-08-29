import { auth } from "@clerk/nextjs/server";
import { google } from "@ai-sdk/google";
import {
  convertToModelMessages,
  isStepCount,
  streamText,
  type UIMessage,
} from "ai";

import { SIGNAL_DESK_SYSTEM_PROMPT } from "@/lib/agent/prompt";
import { createDeskTools } from "@/lib/agent/tools";
import { logger } from "@/lib/logger";
import { getChatMessages, saveChatMessages } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const messages = await getChatMessages<UIMessage>(userId);
  return Response.json({ messages });
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
    const messages = body.messages ?? [];

    const result = streamText({
      model: google("gemini-2.5-pro"),
      instructions: SIGNAL_DESK_SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
      tools: createDeskTools(userId),
      stopWhen: isStepCount(8),
    });

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      onFinish: async ({ messages: nextMessages }) => {
        try {
          await saveChatMessages(userId, nextMessages);
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
