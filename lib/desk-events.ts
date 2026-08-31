import type { UIMessage } from "ai";

import { withUniqueMessageIds } from "@/lib/agent/messages";
import {
  buildDeskEventPayload,
  deskEventCreatedAt,
  deskEventKind,
  isDeskEventMessage,
  withoutDeskEventMessages,
  type DeskEventKind,
} from "@/lib/desk-events-meta";
import { getChatMessages, saveChatMessages } from "@/lib/redis";

export type { DeskEventKind };
export {
  deskEventCreatedAt,
  deskEventKind,
  isDeskEventMessage,
  withoutDeskEventMessages,
};

export function buildDeskEventMessage(params: {
  kind: DeskEventKind;
  text: string;
  symbol?: string;
  createdAt?: string;
}): UIMessage {
  return buildDeskEventPayload(params) as UIMessage;
}

export async function appendDeskEvent(
  userId: string,
  params: {
    kind: DeskEventKind;
    text: string;
    symbol?: string;
  },
): Promise<UIMessage> {
  const event = buildDeskEventMessage(params);
  const existing = await getChatMessages<UIMessage>(userId);
  const next = withUniqueMessageIds([...existing, event]);
  await saveChatMessages(userId, next);
  return event;
}
