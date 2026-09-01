import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planAutoTradeForAlert,
  peakPctFromNotes,
  withPeakPct,
} from "../auto-trade-plan.ts";
import {
  AUTO_TRADE_QUIZ,
  DEFAULT_DESK_SETTINGS,
  gradeAutoTradeQuiz,
} from "../desk-settings.ts";
import {
  buildDeskEventPayload,
  extractRecentDeskEvents,
  formatDeskEventLogForPrompt,
  isDeskEventMessage,
  tapeFromSnapshot,
  withoutDeskEventMessages,
} from "../desk-events-meta.ts";

describe("gradeAutoTradeQuiz", () => {
  it("passes when every correct option is selected", () => {
    const answers: Record<string, string> = {};
    for (const q of AUTO_TRADE_QUIZ) {
      answers[q.id] = q.options.find((o) => o.correct)!.id;
    }
    assert.equal(gradeAutoTradeQuiz(answers).ok, true);
  });

  it("fails on a wrong answer", () => {
    const answers: Record<string, string> = {};
    for (const q of AUTO_TRADE_QUIZ) {
      answers[q.id] = q.options.find((o) => !o.correct)!.id;
    }
    assert.equal(gradeAutoTradeQuiz(answers).ok, false);
  });
});

describe("planAutoTradeForAlert", () => {
  const settings = { ...DEFAULT_DESK_SETTINGS, autoTradeEnabled: true };

  it("stops out owned losers regardless of watchlist", () => {
    const actions = planAutoTradeForAlert({
      settings,
      alert: {
        type: "dip",
        snapshot: { symbol: "SOL/USD", currentPrice: 100 },
      },
      openPositions: [
        { id: "1", symbol: "SOL/USD", unrealizedPnlPct: -6.5 },
      ],
      onWatchlist: false,
      buysToday: 0,
      cash: 50_000,
    });
    assert.equal(
      actions.some((a) => a.type === "exit" && a.reason === "stop"),
      true,
    );
  });

  it("only auto-buys dips that are on the watchlist", () => {
    const offList = planAutoTradeForAlert({
      settings,
      alert: { type: "dip", snapshot: { symbol: "NVDA", currentPrice: 120 } },
      openPositions: [],
      onWatchlist: false,
      buysToday: 0,
      cash: 50_000,
    });
    assert.equal(offList.some((a) => a.type === "entry"), false);

    const onList = planAutoTradeForAlert({
      settings,
      alert: { type: "dip", snapshot: { symbol: "NVDA", currentPrice: 120 } },
      openPositions: [],
      onWatchlist: true,
      buysToday: 0,
      cash: 50_000,
    });
    assert.equal(onList.some((a) => a.type === "entry"), true);
  });

  it("does nothing when auto is off", () => {
    const actions = planAutoTradeForAlert({
      settings: DEFAULT_DESK_SETTINGS,
      alert: { type: "dip", snapshot: { symbol: "NVDA", currentPrice: 100 } },
      openPositions: [],
      onWatchlist: true,
      buysToday: 0,
      cash: 50_000,
    });
    assert.deepEqual(actions, []);
  });
});

describe("peak notes", () => {
  it("stores and reads peak pct", () => {
    const notes = withPeakPct("auto-entry:dip", 9.5);
    assert.equal(peakPctFromNotes(notes), 9.5);
  });
});

describe("desk events", () => {
  it("marks and filters system chips", () => {
    const event = buildDeskEventPayload({
      kind: "attention",
      text: "Attention: NVDA dip",
      symbol: "NVDA",
    });
    assert.equal(isDeskEventMessage(event), true);
    const user = {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "hi" }], 
    };
    const filtered = withoutDeskEventMessages([user, event]);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.id, "u1");
  });

  it("extracts system log for Sidekick instructions", () => {
    const event = buildDeskEventPayload({
      kind: "auto-skip",
      text: "Nah — Auto won't chase XAU/USD breakouts",
      hint: "Auto-trade skipped · breakout",
      symbol: "XAU/USD",
      tape: tapeFromSnapshot(
        { currentPrice: 4482, changePct: 1.1 },
        { alertType: "breakout" },
      ),
      createdAt: "2025-08-31T19:31:00.000Z",
    });
    const user = {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "what happened overnight?" }],
    };
    const log = extractRecentDeskEvents([user, event]);
    assert.equal(log.length, 1);
    assert.equal(log[0]?.kind, "auto-skip");
    const prompt = formatDeskEventLogForPrompt(log);
    assert.match(prompt, /auto-skip/);
    assert.match(prompt, /XAU\/USD/);
    assert.match(prompt, /tape:/);
  });
});
