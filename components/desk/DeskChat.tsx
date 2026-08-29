"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useState } from "react";

const CHIPS = [
  {
    label: "Recommend",
    text: "What should I look at right now? Recommend from my watchlist.",
  },
  { label: "Portfolio", text: "Show my paper portfolio PnL and cash." },
  { label: "Update NVDA", text: "Give me an update on NVDA including headlines." },
  {
    label: "What-if AAPL",
    text: "What if we bought 10 shares of AAPL 30 days ago?",
  },
] as const;

export function DeskChat() {
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat" }),
    [],
  );
  const [hydrated, setHydrated] = useState(false);
  const [seed, setSeed] = useState<UIMessage[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/chat", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { messages?: UIMessage[] };
          if (!cancelled && Array.isArray(data.messages)) {
            setSeed(data.messages);
          }
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

  if (!hydrated) {
    return (
      <section className="flex min-h-[420px] items-center justify-center rounded-2xl border border-[var(--desk-border)] bg-[var(--desk-surface)] text-sm text-[var(--desk-muted)]">
        Loading sidekick…
      </section>
    );
  }

  return <DeskChatSession transport={transport} initialMessages={seed} />;
}

function DeskChatSession({
  transport,
  initialMessages,
}: {
  transport: DefaultChatTransport<UIMessage>;
  initialMessages: UIMessage[];
}) {
  const { messages, sendMessage, status, error } = useChat({
    transport,
    messages: initialMessages,
  });
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    void sendMessage({ text: trimmed });
    setInput("");
  }

  return (
    <section className="flex h-full min-h-[420px] flex-col rounded-2xl border border-[var(--desk-border)] bg-[var(--desk-surface)]">
      <header className="border-b border-[var(--desk-border)] px-4 py-3">
        <h2 className="font-display text-xl text-[var(--desk-text)]">
          Sidekick
        </h2>
        <p className="text-xs text-[var(--desk-muted)]">
          Monitor · update · recommend · what-if — real numbers only
        </p>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-[var(--desk-border)] px-4 py-3">
        {CHIPS.map((chip) => (
          <button
            key={chip.label}
            type="button"
            disabled={busy}
            onClick={() => submit(chip.text)}
            className="rounded-full border border-[var(--desk-border)] bg-[var(--desk-elevated)] px-3 py-1 text-xs text-[var(--desk-text)] transition hover:border-[var(--desk-accent)] disabled:opacity-50"
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-sm leading-relaxed text-[var(--desk-muted)]">
            Yo — tell me what to watch. Try “monitor TSLA”, “update on SPY”, or
            hit a chip above. I bring jokes; tools bring the math.
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === "user"
                ? "ml-8 rounded-xl bg-[var(--desk-accent-soft)] px-3 py-2 text-sm text-[var(--desk-text)]"
                : "mr-4 rounded-xl bg-[var(--desk-elevated)] px-3 py-2 text-sm text-[var(--desk-text)]"
            }
          >
            <p className="mb-1 text-[10px] uppercase tracking-wider text-[var(--desk-muted)]">
              {message.role === "user" ? "You" : "Signal Desk"}
            </p>
            {message.parts.map((part, index) => {
              if (part.type === "text") {
                return (
                  <p
                    key={index}
                    className="whitespace-pre-wrap leading-relaxed"
                  >
                    {part.text}
                  </p>
                );
              }
              if (part.type.startsWith("tool-")) {
                const toolName = part.type.replace(/^tool-/, "");
                const state =
                  "state" in part ? String(part.state) : "running";
                return (
                  <p
                    key={index}
                    className="mt-1 text-xs text-[var(--desk-amber)]"
                  >
                    tool · {toolName} · {state}
                  </p>
                );
              }
              return null;
            })}
          </div>
        ))}
        {error && (
          <p className="text-sm text-[var(--desk-danger)]">{error.message}</p>
        )}
      </div>

      <form
        className="border-t border-[var(--desk-border)] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            placeholder="monitor NVDA / update on AAPL / what if…"
            className="flex-1 rounded-xl border border-[var(--desk-border)] bg-[var(--desk-bg)] px-3 py-2 text-sm text-[var(--desk-text)] outline-none placeholder:text-[var(--desk-muted)] focus:border-[var(--desk-accent)]"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-xl bg-[var(--desk-accent)] px-4 py-2 text-sm font-semibold text-[#0b120e] disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
