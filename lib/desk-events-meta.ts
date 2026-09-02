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
  | "trigger-skip"
  | "structure-entry";

/** Mark + context frozen at event time — for then-vs-now comparison. */
export type DeskEventTape = {
  price: number;
  changePct: number;
  alertType?: "dip" | "breakout";
  /** Open-position PnL % when an exit/skip references a held lot. */
  pnlPct?: number;
};

export type DeskEventMetadata = {
  deskEvent: true;
  kind: DeskEventKind;
  createdAt: string;
  symbol?: string;
  /** Technical detail — shown on chip hover. */
  hint?: string;
  /** Snapshot at event time (price, day %, etc.). */
  tape?: DeskEventTape;
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

export function deskEventHint(message: {
  metadata?: unknown;
}): string | null {
  const meta = message.metadata;
  if (!meta || typeof meta !== "object") return null;
  const hint = (meta as DeskEventMetadata).hint;
  return typeof hint === "string" && hint.trim() ? hint.trim() : null;
}

export function deskEventTape(message: {
  metadata?: unknown;
}): DeskEventTape | null {
  const meta = message.metadata;
  if (!meta || typeof meta !== "object") return null;
  const tape = (meta as DeskEventMetadata).tape;
  if (!tape || typeof tape !== "object") return null;
  if (
    typeof tape.price !== "number" ||
    !Number.isFinite(tape.price) ||
    typeof tape.changePct !== "number" ||
    !Number.isFinite(tape.changePct)
  ) {
    return null;
  }
  return {
    price: tape.price,
    changePct: tape.changePct,
    ...(tape.alertType === "dip" || tape.alertType === "breakout"
      ? { alertType: tape.alertType }
      : {}),
    ...(typeof tape.pnlPct === "number" && Number.isFinite(tape.pnlPct)
      ? { pnlPct: tape.pnlPct }
      : {}),
  };
}

function formatMarkPrice(price: number): string {
  if (price >= 1000) return price.toFixed(0);
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

export function formatDeskEventTapeLine(
  tape: DeskEventTape,
  symbol?: string | null,
): string {
  const prefix = symbol?.trim() ? `${symbol.trim()} ` : "";
  const sign = tape.changePct >= 0 ? "+" : "";
  const day = `${sign}${tape.changePct.toFixed(2)}% day`;
  const move =
    tape.alertType === "dip" || tape.alertType === "breakout"
      ? `${day} · ${tape.alertType}`
      : day;
  const pnl =
    tape.pnlPct != null
      ? ` · lot ${tape.pnlPct >= 0 ? "+" : ""}${tape.pnlPct.toFixed(1)}%`
      : "";
  return `${prefix}~$${formatMarkPrice(tape.price)} (${move}${pnl})`;
}

export function deskEventTooltip(message: {
  metadata?: unknown;
}): string | null {
  const hint = deskEventHint(message);
  const meta = message.metadata as DeskEventMetadata | undefined;
  const tape = deskEventTape(message);
  const tapeLine = tape ? formatDeskEventTapeLine(tape, meta?.symbol) : null;
  if (hint && tapeLine) return `${hint}\nAt the time: ${tapeLine}`;
  return hint ?? tapeLine;
}

export function tapeFromSnapshot(
  snapshot: { currentPrice: number; changePct: number },
  extras?: { alertType?: "dip" | "breakout"; pnlPct?: number },
): DeskEventTape {
  return {
    price: snapshot.currentPrice,
    changePct: snapshot.changePct,
    ...(extras?.alertType ? { alertType: extras.alertType } : {}),
    ...(extras?.pnlPct != null ? { pnlPct: extras.pnlPct } : {}),
  };
}

export function withoutDeskEventMessages<T extends object>(
  messages: T[],
): T[] {
  return messages.filter(
    (m) => !isDeskEventMessage(m as { role?: string; metadata?: unknown }),
  );
}

export type DeskEventLogEntry = {
  kind: DeskEventKind;
  text: string;
  hint: string | null;
  symbol: string | null;
  createdAt: string;
  tape: DeskEventTape | null;
};

function deskEventText(message: {
  parts?: unknown;
}): string {
  if (!Array.isArray(message.parts)) return "";
  return message.parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        !!part &&
        typeof part === "object" &&
        (part as { type?: string }).type === "text" &&
        typeof (part as { text?: string }).text === "string",
    )
    .map((part) => part.text)
    .join(" ")
    .trim();
}

/** Pull center system chips for Sidekick instructions (stripped from model chat). */
export function extractRecentDeskEvents(
  messages: ReadonlyArray<{
    role?: string;
    parts?: unknown;
    metadata?: unknown;
  }>,
  limit = 12,
): DeskEventLogEntry[] {
  const out: DeskEventLogEntry[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const message = messages[i];
    if (!message || !isDeskEventMessage(message)) continue;
    const kind = deskEventKind(message);
    const text = deskEventText(message);
    if (!kind || !text) continue;
    const createdAt = deskEventCreatedAt(message) ?? "";
    out.push({
      kind,
      text,
      hint: deskEventHint(message),
      symbol:
        typeof (message.metadata as DeskEventMetadata)?.symbol === "string"
          ? (message.metadata as DeskEventMetadata).symbol!
          : null,
      createdAt,
      tape: deskEventTape(message),
    });
  }
  return out.reverse();
}

export function formatDeskEventLogForPrompt(
  events: ReadonlyArray<DeskEventLogEntry>,
): string {
  if (events.length === 0) {
    return "- (none in chat yet — no overnight scan/auto/trigger-fire chips logged)";
  }
  return events
    .map((event) => {
      const when = event.createdAt ? event.createdAt.slice(0, 16) : "?";
      const hint = event.hint ? ` · detail: ${event.hint}` : "";
      const tape = event.tape
        ? ` · tape: ${formatDeskEventTapeLine(event.tape, event.symbol)}`
        : "";
      return `- [${event.kind}] ${when} · ${event.text}${tape}${hint}`;
    })
    .join("\n");
}

export function buildDeskEventPayload(params: {
  kind: DeskEventKind;
  text: string;
  symbol?: string;
  hint?: string;
  tape?: DeskEventTape;
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
    ...(params.hint?.trim() ? { hint: params.hint.trim() } : {}),
    ...(params.tape ? { tape: params.tape } : {}),
  };

  return {
    id: `desk-event-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    role: "system",
    parts: [{ type: "text", text: params.text }],
    metadata,
  };
}
