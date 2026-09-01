import type { UIMessage } from "ai";

import { withUniqueMessageIds } from "@/lib/agent/messages";
import {
  buildDeskEventPayload,
  deskEventCreatedAt,
  deskEventHint,
  deskEventKind,
  deskEventTape,
  deskEventTooltip,
  extractRecentDeskEvents,
  formatDeskEventLogForPrompt,
  isDeskEventMessage,
  tapeFromSnapshot,
  withoutDeskEventMessages,
  type DeskEventKind,
  type DeskEventLogEntry,
  type DeskEventTape,
} from "@/lib/desk-events-meta";
import { getChatMessages, saveChatMessages } from "@/lib/redis";

export type { DeskEventKind };
export {
  deskEventCreatedAt,
  deskEventHint,
  deskEventKind,
  deskEventTape,
  deskEventTooltip,
  extractRecentDeskEvents,
  formatDeskEventLogForPrompt,
  isDeskEventMessage,
  tapeFromSnapshot,
  withoutDeskEventMessages,
  type DeskEventLogEntry,
  type DeskEventTape,
};

export function buildDeskEventMessage(params: {
  kind: DeskEventKind;
  text: string;
  symbol?: string;
  hint?: string;
  tape?: DeskEventTape;
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
    hint?: string;
    tape?: DeskEventTape;
  },
): Promise<UIMessage> {
  const event = buildDeskEventMessage(params);
  const existing = await getChatMessages<UIMessage>(userId);
  const next = withUniqueMessageIds([...existing, event]);
  await saveChatMessages(userId, next);
  return event;
}
