import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDeskEventPayload,
  deskEventTooltip,
  formatDeskEventLogForPrompt,
  formatDeskEventTapeLine,
  tapeFromSnapshot,
} from "../desk-events-meta.ts";

describe("desk event tape", () => {
  it("formats mark and day move for tooltips", () => {
    const line = formatDeskEventTapeLine(
      { price: 4482.12, changePct: 1.13, alertType: "breakout" },
      "XAU/USD",
    );
    assert.match(line, /XAU\/USD/);
    assert.match(line, /4482/);
    assert.match(line, /breakout/);
  });

  it("stores tape on payload and prompt log", () => {
    const event = buildDeskEventPayload({
      kind: "auto-skip",
      text: "Auto passed",
      symbol: "XAU/USD",
      hint: "Auto-trade skipped",
      tape: tapeFromSnapshot(
        { currentPrice: 4482, changePct: 1.1 },
        { alertType: "breakout" },
      ),
    });
    const tooltip = deskEventTooltip(event);
    assert.ok(tooltip?.includes("At the time:"));
    const log = formatDeskEventLogForPrompt([
      {
        kind: "auto-skip",
        text: "Auto passed",
        hint: "Auto-trade skipped",
        symbol: "XAU/USD",
        createdAt: "2025-08-31T19:31:00.000Z",
        tape: tapeFromSnapshot(
          { currentPrice: 4482, changePct: 1.1 },
          { alertType: "breakout" },
        ),
      },
    ]);
    assert.match(log, /tape:/);
    assert.match(log, /4482/);
  });
});
