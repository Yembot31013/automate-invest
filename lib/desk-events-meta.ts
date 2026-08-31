export type DeskEventKind =
  | "attention"
  | "auto-exit"
  | "auto-entry"
  | "auto-skip"
  | "auto-enabled"
  | "auto-disabled"
  | "trigger-attention"
  | "trigger-buy"
  | "trigger-sell"
  | "trigger-skip";

export type DeskEventMetadata = {
  deskEvent: true;
  kind: DeskEventKind;
  createdAt: string;
  symbol?: string;
};

export function isDeskEventMessage(message: {
  role?: string;
  metadata?: unknown;
}): boolean {
  const meta = message.metadata;
  if (!meta || typeof meta !== "object") return false;
  return (meta as DeskEventMetadata).deskEvent === true;
}

export function deskEventKind(message: {
  metadata?: unknown;
}): DeskEventKind | null {
  const meta = message.metadata;
  if (!meta || typeof meta !== "object") return null;
  const kind = (meta as DeskEventMetadata).kind;
  return typeof kind === "string" ? (kind as DeskEventKind) : null;
}

export function deskEventCreatedAt(message: {
  metadata?: unknown;
}): string | null {
  const meta = message.metadata;
  if (!meta || typeof meta !== "object") return null;
  const createdAt = (meta as DeskEventMetadata).createdAt;
  return typeof createdAt === "string" ? createdAt : null;
}

export function withoutDeskEventMessages<T extends object>(
  messages: T[],
): T[] {
  return messages.filter(
    (m) => !isDeskEventMessage(m as { role?: string; metadata?: unknown }),
  );
}

export function buildDeskEventPayload(params: {
  kind: DeskEventKind;
  text: string;
  symbol?: string;
  createdAt?: string;
}): {
  id: string;
  role: "system";
  parts: Array<{ type: "text"; text: string }>;
  metadata: DeskEventMetadata;
} {
  const createdAt = params.createdAt ?? new Date().toISOString();
  const metadata: DeskEventMetadata = {
    deskEvent: true,
    kind: params.kind,
    createdAt,
    ...(params.symbol ? { symbol: params.symbol } : {}),
  };

  return {
    id: `desk-event-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    role: "system",
    parts: [{ type: "text", text: params.text }],
    metadata,
  };
}
