"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  EmptyHint,
  PulseDots,
  Skeleton,
  Spinner,
} from "@/components/ui/Feedback";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Tip } from "@/components/ui/Tip";
import { MarkdownBubble } from "@/components/desk/MarkdownBubble";
import {
  StructureSetupBlock,
  structureChartFromToolOutput,
} from "@/components/desk/StructureSetupBlock";
import { withUniqueMessageIds } from "@/lib/agent/messages";
import { deskDeedForTool } from "@/lib/agent/deeds";
import {
  deskEventKind,
  deskEventTooltip,
  isDeskEventMessage,
} from "@/lib/desk-events";
import { formatChatTime, messageCreatedAt } from "@/lib/chat-time";

export const CHAT_CHIPS = [
  {
    label: "Recommend",
    text: "What should I look at right now? Recommend from my watchlist — and tell me how to paper-buy or sell if I want to try it.",
    tint: "var(--lavender)",
    hint: "Rank your watchlist, then hint how to paper-buy or sell",
  },
  {
    label: "Paper buy",
    text: "Paper buy 5 shares of NVDA at the current mark using my paper cash.",
    tint: "var(--yellow)",
    hint: "Fake $100k cash · real prices · fills Paper book",
  },
  {
    label: "Paper sell",
    text: "Sell / close my open paper position in NVDA and return the cash to my paper book.",
    tint: "var(--pink)",
    hint: "Close an open paper long · proceeds go back to cash",
  },
  {
    label: "Portfolio",
    text: "Show my paper portfolio PnL and cash.",
    tint: "var(--green)",
    hint: "Show paper cash, equity, and open positions",
  },
  {
    label: "Update NVDA",
    text: "Give me an update on NVDA including headlines — explain what each story means and why it matters.",
    tint: "var(--blue)",
    hint: "Live NVDA snapshot + plain-English take on headlines",
  },
  {
    label: "What-if AAPL",
    text: "What if we bought 10 shares of AAPL 30 days ago?",
    tint: "var(--orange)",
    hint: "Counterfactual: buy 10 AAPL 30 days ago",
  },
] as const;

type DeskChatProps = {
  onPrompt?: (text: string) => void;
  externalPrompt?: string | null;
  onExternalPromptConsumed?: () => void;
  onBusyChange?: (busy: boolean) => void;
  /** Fired when chat tools mutate watchlist / paper book / triggers so the desk can refresh. */
  onDeskMutated?: (summary: string) => void;
  /** Bump to focus the composer (e.g. Sidekick card click). */
  focusSignal?: number;
  /** Bump to reload persisted messages (Attention / Auto chips). */
  messagesRefreshSignal?: number;
};

const DESK_MUTATING_TOOLS = new Set([
  "monitorSymbol",
  "monitorSymbols",
  "unmonitorSymbol",
  "createTrigger",
  "updateTrigger",
  "setTriggerEnabled",
  "removeTrigger",
  "paperBuy",
  "paperSell",
  "paperSellMany",
]);

function isToolDone(state: string): boolean {
  const s = state.toLowerCase();
  return (
    s.includes("result") ||
    s.includes("complete") ||
    s.includes("output") ||
    s === "done"
  );
}

/** Hide duplicate parallel tool calls (same tool + input) in one assistant turn. */
function dedupeToolParts<T extends { type: string; input?: unknown }>(
  parts: T[],
): T[] {
  const seen = new Set<string>();
  return parts.filter((part) => {
    if (!part.type.startsWith("tool-")) return true;
    const toolName = part.type.replace(/^tool-/, "");
    const key = `${toolName}:${JSON.stringify(part.input ?? {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toolMutationSummary(toolName: string): string {
  switch (toolName) {
    case "monitorSymbol":
    case "monitorSymbols":
      return "Watchlist updated";
    case "unmonitorSymbol":
      return "Ticker removed";
    case "createTrigger":
      return "Trigger armed";
    case "updateTrigger":
      return "Trigger updated";
    case "setTriggerEnabled":
      return "Trigger updated";
    case "removeTrigger":
      return "Trigger removed";
    case "reportCapabilityGap":
      return "Flagged a capability gap";
    case "paperBuy":
      return "Paper buy filled";
    case "paperSell":
      return "Paper sell filled";
    case "paperSellMany":
      return "Paper sells filled";
    default:
      return "Desk updated";
  }
}

export function DeskChat({
  onPrompt,
  externalPrompt,
  onExternalPromptConsumed,
  onBusyChange,
  onDeskMutated,
  focusSignal,
  messagesRefreshSignal,
}: DeskChatProps) {
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat" }),
    [],
  );
  const [hydrated, setHydrated] = useState(false);
  const [seed, setSeed] = useState<UIMessage[]>([]);
  const [hydrateError, setHydrateError] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/chat", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { messages?: UIMessage[] };
          if (!cancelled && Array.isArray(data.messages)) {
            setSeed(withUniqueMessageIds(data.messages));
          }
        } else if (!cancelled) {
          setHydrateError("Couldn't load past chat — starting fresh is fine.");
        }
      } catch {
        if (!cancelled) {
          setHydrateError("Couldn't load past chat — starting fresh is fine.");
        }
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!messagesRefreshSignal) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/chat", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { messages?: UIMessage[] };
        if (!cancelled && Array.isArray(data.messages)) {
          setSeed(withUniqueMessageIds(data.messages));
          setSessionKey((k) => k + 1);
        }
      } catch {
        // keep current thread
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messagesRefreshSignal]);

  if (!hydrated) {
    return (
      <section
        className="desk-chat soft-card-strong flex h-full min-h-0 flex-1 flex-col overflow-hidden"
        aria-busy="true"
        aria-label="Loading chat"
      >
        <header className="shrink-0 border-b border-[color-mix(in_srgb,var(--mix)_50%,transparent)] px-4 py-3 sm:px-5 sm:py-4">
          <Skeleton lines={2} />
        </header>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-5">
          <Spinner size="lg" label="Loading sidekick" />
          <p className="text-sm font-semibold text-[var(--ink)]">
            Loading your sidekick…
          </p>
          <p className="text-xs text-[var(--muted)]">
            Pulling chat history if you have any.
          </p>
          <PulseDots label="Loading" />
        </div>
      </section>
    );
  }

  return (
    <DeskChatSession
      key={sessionKey}
      transport={transport}
      initialMessages={seed}
      hydrateError={hydrateError}
      onPrompt={onPrompt}
      externalPrompt={externalPrompt}
      onExternalPromptConsumed={onExternalPromptConsumed}
      onBusyChange={onBusyChange}
      onDeskMutated={onDeskMutated}
      focusSignal={focusSignal}
    />
  );
}

function DeskChatSession({
  transport,
  initialMessages,
  hydrateError,
  onPrompt,
  externalPrompt,
  onExternalPromptConsumed,
  onBusyChange,
  onDeskMutated,
  focusSignal,
}: {
  transport: DefaultChatTransport<UIMessage>;
  initialMessages: UIMessage[];
  hydrateError: string | null;
  onPrompt?: (text: string) => void;
  externalPrompt?: string | null;
  onExternalPromptConsumed?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onDeskMutated?: (summary: string) => void;
  focusSignal?: number;
}) {
  const { messages, sendMessage, setMessages, status, error } = useChat({
    transport,
    messages: initialMessages,
  });
  const [input, setInput] = useState("");
  const [multiline, setMultiline] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busyClear, setBusyClear] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<string | null>(null);
  /** Bumps so relative timestamps stay fresh (now → 2 minutes ago). */
  const [nowMs, setNowMs] = useState(() => Date.now());
  const busy = status === "submitted" || status === "streaming";
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputValueRef = useRef(input);
  inputValueRef.current = input;
  const onBusyChangeRef = useRef(onBusyChange);
  onBusyChangeRef.current = onBusyChange;
  const onDeskMutatedRef = useRef(onDeskMutated);
  onDeskMutatedRef.current = onDeskMutated;
  const seenMutationsRef = useRef<Set<string>>(new Set());
  const pendingSyncRef = useRef<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  function focusComposer() {
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
  }

  function applyDraft(text: string) {
    setInput(text);
    focusComposer();
  }

  /** Fill composer from a shortcut — confirm first if the box already has edits. */
  function requestFillDraft(text: string) {
    const next = text.trim();
    if (!next) return;
    const current = inputValueRef.current.trim();
    if (current === next) {
      focusComposer();
      return;
    }
    if (!current) {
      applyDraft(text);
      return;
    }
    setPendingDraft(text);
  }

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onPrompt?.(trimmed);
    void sendMessage({
      text: trimmed,
      metadata: { createdAt: new Date().toISOString() },
    });
    setInput("");
  }

  async function clearChat() {
    setBusyClear(true);
    try {
      const res = await fetch("/api/chat", { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || data.ok === false) {
        throw new Error(data.error ?? "Failed to clear chat");
      }
      setMessages([]);
      setConfirmClear(false);
    } catch {
      setConfirmClear(false);
    } finally {
      setBusyClear(false);
    }
  }

  useEffect(() => {
    if (!externalPrompt) return;
    const next = externalPrompt;
    onExternalPromptConsumed?.();
    requestFillDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot external draft fill
  }, [externalPrompt]);

  useEffect(() => {
    if (!focusSignal) return;
    focusComposer();
  }, [focusSignal]);

  useEffect(() => {
    onBusyChangeRef.current?.(busy);
  }, [busy]);

  useEffect(() => {
    // Seed seen set from history so reloads don't re-sync old tools.
    if (seenMutationsRef.current.size > 0) return;
    for (const message of initialMessages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts ?? []) {
        if (!part.type.startsWith("tool-")) continue;
        const toolName = part.type.replace(/^tool-/, "");
        if (!DESK_MUTATING_TOOLS.has(toolName)) continue;
        const state = "state" in part ? String(part.state) : "";
        if (!isToolDone(state)) continue;
        const toolCallId =
          "toolCallId" in part && typeof part.toolCallId === "string"
            ? part.toolCallId
            : toolName;
        seenMutationsRef.current.add(`${message.id}:${toolCallId}`);
      }
    }
  }, [initialMessages]);

  useEffect(() => {
    let latestSummary: string | null = null;
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts ?? []) {
        if (!part.type.startsWith("tool-")) continue;
        const toolName = part.type.replace(/^tool-/, "");
        if (!DESK_MUTATING_TOOLS.has(toolName)) continue;
        const state = "state" in part ? String(part.state) : "";
        if (!isToolDone(state)) continue;
        const toolCallId =
          "toolCallId" in part && typeof part.toolCallId === "string"
            ? part.toolCallId
            : toolName;
        const key = `${message.id}:${toolCallId}`;
        if (seenMutationsRef.current.has(key)) continue;
        seenMutationsRef.current.add(key);
        latestSummary = toolMutationSummary(toolName);
      }
    }
    if (!latestSummary) return;
    // Wait until the turn settles so multiple parallel tools sync once.
    if (busy) {
      pendingSyncRef.current = latestSummary;
      return;
    }
    pendingSyncRef.current = null;
    onDeskMutatedRef.current?.(latestSummary);
  }, [messages, busy]);

  useEffect(() => {
    if (busy || !pendingSyncRef.current) return;
    const summary = pendingSyncRef.current;
    pendingSyncRef.current = null;
    onDeskMutatedRef.current?.(summary);
  }, [busy]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, busy, status]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const max = 120;
    el.style.height = "0px";
    const contentHeight = el.scrollHeight;
    const next = Math.min(Math.max(contentHeight, 38), max);
    el.style.height = `${next}px`;
    setMultiline(contentHeight > 52);
  }, [input]);

  const statusLabel =
    status === "submitted"
      ? "Sending…"
      : status === "streaming"
        ? "Answering…"
        : "Ready";

  return (
    <section
      className="desk-chat soft-card-strong fade-up flex h-full min-h-0 flex-1 flex-col overflow-hidden lg:min-h-[520px]"
      aria-busy={busy}
    >
      <header className="desk-chat-header shrink-0 flex items-start justify-between gap-2 border-b border-[color-mix(in_srgb,var(--mix)_50%,transparent)] px-4 py-3 sm:gap-3 sm:px-5 sm:py-4">
        <div className="min-w-0">
          <p className="font-mono-label">Primary stage</p>
          <h2 className="mt-0.5 text-xl font-extrabold tracking-tight text-[var(--ink)] sm:mt-1 sm:text-2xl">
            Sidekick chat
          </h2>
          <p className="mt-1 hidden text-sm text-[var(--muted)] sm:block">
            Ask in plain English. Tools fetch real numbers. We never invent
            prices.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Tip
            label="Wipe this thread only — watchlist & paper book stay"
            side="bottom"
          >
            <button
              type="button"
              className="btn-ghost !px-2 !py-1.5 text-[0.65rem] sm:!px-2.5 sm:text-xs"
              disabled={busy || busyClear || messages.length === 0}
              onClick={() => setConfirmClear(true)}
            >
              Clear
            </button>
          </Tip>
          <Tip
            label={
              busy
                ? "Hang tight — the sidekick is working on your ask"
                : "Ready for your next question"
            }
            side="bottom"
          >
            <span
              className={`badge-pill !px-2 !py-1 text-[0.65rem] sm:!px-2.5 sm:text-xs ${
                busy
                  ? "bg-[color-mix(in_srgb,var(--blue)_45%,var(--mix))]"
                  : "bg-[color-mix(in_srgb,var(--yellow)_60%,var(--mix))]"
              }`}
            >
              {busy ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner size="sm" label={statusLabel} />
                  {statusLabel}
                </span>
              ) : (
                statusLabel
              )}
            </span>
          </Tip>
        </div>
      </header>

      <div className="desk-chat-chips shrink-0 border-b border-[color-mix(in_srgb,var(--mix)_50%,transparent)] px-4 py-2.5 sm:px-5 sm:py-3">
        <div className="desk-chip-scroller pb-0.5">
          {CHAT_CHIPS.map((chip) => (
            <Tip
              key={chip.label}
              label={`${chip.hint} — fills the box so you can edit first`}
              className="shrink-0"
            >
              <button
                type="button"
                onClick={() => requestFillDraft(chip.text)}
                className="badge-pill desk-chip-btn whitespace-nowrap"
                style={{
                  background: `color-mix(in srgb, ${chip.tint} 45%, var(--mix))`,
                }}
              >
                {chip.label}
              </button>
            </Tip>
          ))}
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5"
      >
        {hydrateError && (
          <p className="rounded-[14px] bg-[color-mix(in_srgb,var(--lavender)_30%,var(--mix))] px-3 py-2 text-xs text-[var(--ink)]">
            {hydrateError}
          </p>
        )}
        {messages.length === 0 && !busy && (
          <EmptyHint
            title="You're in charge"
            body='Try “monitor TSLA”, “buy 5 NVDA”, “sell NVDA”, or tap a chip (Recommend / Paper buy / Paper sell).'
          >
            <p className="mt-2 text-[0.7rem] text-[var(--muted)]">
              Tip: Ctrl/⌘+Enter sends · chips fill the box — edit, then send
            </p>
          </EmptyHint>
        )}
        {messages.map((message, index) => {
          if (isDeskEventMessage(message)) {
            const text = message.parts
              .filter(
                (part): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
                  part.type === "text",
              )
              .map((part) => part.text)
              .join(" ")
              .trim();
            const createdAt = messageCreatedAt(message);
            const kind = deskEventKind(message);
            const tooltip = deskEventTooltip(message);
            const timeLabel = createdAt
              ? formatChatTime(createdAt, nowMs)
              : null;
            const absoluteLabel = createdAt
              ? new Date(createdAt).toLocaleString()
              : undefined;
            const chip = (
              <div
                className={`desk-system-chip desk-system-${kind ?? "attention"}`}
                role="status"
              >
                <span className="desk-system-text">{text}</span>
                {timeLabel ? (
                  <time
                    className="desk-system-time"
                    dateTime={createdAt ?? undefined}
                    title={absoluteLabel}
                  >
                    {timeLabel}
                  </time>
                ) : null}
              </div>
            );
            return (
              <div
                key={message.id?.trim() || `desk-event-${index}`}
                className="desk-system-row fade-up"
              >
                {tooltip ? (
                  <Tip label={tooltip} className="desk-system-tip" as="div">
                    {chip}
                  </Tip>
                ) : (
                  chip
                )}
              </div>
            );
          }

          const createdAt = messageCreatedAt(message);
          const timeLabel = createdAt
            ? formatChatTime(createdAt, nowMs)
            : null;
          const absoluteLabel = createdAt
            ? new Date(createdAt).toLocaleString()
            : undefined;

          return (
          <div
            key={message.id?.trim() || `msg-${index}-${message.role}`}
            className={
              message.role === "user" ? "bubble-user fade-up" : "bubble-assistant fade-up"
            }
          >
            <div className="desk-msg-meta">
              <p className="font-mono-label">
                {message.role === "user" ? "You" : "Signal Desk"}
              </p>
              {timeLabel ? (
                <time
                  className="desk-msg-time"
                  dateTime={createdAt ?? undefined}
                  title={absoluteLabel}
                >
                  {timeLabel}
                </time>
              ) : null}
            </div>
            {dedupeToolParts(message.parts).map((part, partIndex) => {
              if (part.type === "text") {
                return (
                  <MarkdownBubble
                    key={partIndex}
                    text={part.text}
                    tone={message.role === "user" ? "user" : "assistant"}
                  />
                );
              }
              if (part.type.startsWith("tool-")) {
                const toolName = part.type.replace(/^tool-/, "");
                const state =
                  "state" in part ? String(part.state) : "running";
                const input = "input" in part ? part.input : undefined;
                const output = "output" in part ? part.output : undefined;
                const deed = deskDeedForTool({ toolName, state, input, output });
                const toneClass =
                  deed.phase === "error"
                    ? "desk-deed-error"
                    : deed.phase === "done"
                      ? "desk-deed-done"
                      : "desk-deed-running";
                const structurePayload =
                  toolName === "getStructureSetup" && deed.phase === "done"
                    ? structureChartFromToolOutput(output)
                    : null;
                return (
                  <div key={partIndex} className="mt-1 w-full space-y-2">
                    <Tip
                      label={deed.hint}
                      as="div"
                      className="w-full"
                      side="top"
                    >
                      <div
                        className={`desk-deed ${toneClass}`}
                        role="status"
                        aria-label={deed.hint}
                      >
                        <span className="desk-deed-mark" aria-hidden="true">
                          {deed.phase === "running" ? (
                            <span className="desk-deed-pulse" />
                          ) : deed.phase === "done" ? (
                            "✓"
                          ) : (
                            "!"
                          )}
                        </span>
                        <span className="desk-deed-label">{deed.label}</span>
                      </div>
                    </Tip>
                    {structurePayload?.chart ? (
                      <StructureSetupBlock
                        chart={structurePayload.chart}
                        scans={structurePayload.scans}
                        onFillComposer={requestFillDraft}
                      />
                    ) : null}
                  </div>
                );
              }
              return null;
            })}
          </div>
          );
        })}
        {status === "submitted" && (
          <div className="thinking-bubble fade-up" aria-live="polite">
            <Spinner size="sm" label="Thinking" />
            Sidekick is on it
            <PulseDots />
          </div>
        )}
        {error && (
          <div
            className="rounded-[14px] bg-[color-mix(in_srgb,var(--orange)_30%,var(--mix))] px-3 py-2 text-sm text-[var(--ink)]"
            role="alert"
          >
            <p className="font-bold">Something went sideways</p>
            <p className="mt-1 text-xs leading-relaxed opacity-90">
              {error.message}
            </p>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Try again in a few seconds — nothing else broke.
            </p>
          </div>
        )}
      </div>

      <form
        className="composer-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <div
          className={`composer-bar ${busy ? "is-busy" : ""} ${multiline ? "is-multiline" : ""}`}
          title={
            busy
              ? "Wait for the current reply to finish"
              : "Type your question here — Enter makes a new line"
          }
        >
          <textarea
            ref={inputRef}
            className="composer-input"
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit(input);
              }
            }}
            disabled={busy}
            aria-label="Message to sidekick"
            placeholder="monitor NVDA / update on AAPL / what if…"
          />
          <div className="composer-actions">
            <Tip
              label={
                busy
                  ? "Wait — sidekick is still answering"
                  : input.trim()
                    ? "Send this message (or press Ctrl/⌘+Enter)"
                    : "Type something first, then send"
              }
              as="div"
            >
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="btn-primary composer-send"
              >
                {busy ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner size="sm" label="Sending" />
                    …
                  </span>
                ) : (
                  "Send"
                )}
              </button>
            </Tip>
          </div>
        </div>
        <p className="composer-hint">
          {busy
            ? "Locked while answering…"
            : "Enter = new line · Ctrl/⌘+Enter or Send to submit."}
        </p>
      </form>

      <ConfirmModal
        open={confirmClear}
        title="Clear this chat?"
        body="Wipes the sidekick thread so you start fresh. Your watchlist, paper book, and account stay exactly as they are."
        confirmLabel="Clear chat"
        cancelLabel="Keep messages"
        tone="danger"
        busy={busyClear}
        onCancel={() => {
          if (busyClear) return;
          setConfirmClear(false);
        }}
        onConfirm={() => void clearChat()}
      />

      <ConfirmModal
        open={pendingDraft !== null}
        title="Replace what you wrote?"
        body={
          <>
            <p>
              The composer already has text. Using this shortcut will wipe it
              and drop in the new ask.
            </p>
            {input.trim() ? (
              <p className="mt-2 text-xs text-[var(--muted)]">
                Current draft: “
                {input.trim().length > 90
                  ? `${input.trim().slice(0, 90)}…`
                  : input.trim()}
                ”
              </p>
            ) : null}
          </>
        }
        confirmLabel="Replace"
        cancelLabel="Keep mine"
        tone="neutral"
        onCancel={() => setPendingDraft(null)}
        onConfirm={() => {
          if (pendingDraft == null) return;
          applyDraft(pendingDraft);
          setPendingDraft(null);
        }}
      />
    </section>
  );
}
