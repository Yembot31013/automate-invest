import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  attentionScanCopy,
  autoSkipCopy,
  triggerBuyCopy,
} from "../desk-event-copy.ts";

describe("desk-event-copy", () => {
  it("writes natural attention scan lines", () => {
    const emailed = attentionScanCopy({
      symbol: "BTC/USD",
      type: "breakout",
      emailed: true,
    });
    assert.match(emailed.text, /inbox/i);
    assert.ok(emailed.hint.includes("breakout"));

    const unsure = attentionScanCopy({
      symbol: "XAU/USD",
      type: "breakout",
      emailed: true,
      autoUnsure: true,
    });
    assert.match(unsure.text, /Auto passed/i);
  });

  it("writes nah-style auto skip for breakouts", () => {
    const chip = autoSkipCopy({
      symbol: "XAU/USD",
      reason: "Breakout on the board — Auto won't chase; check if you want in",
    });
    assert.match(chip.text, /Nah/i);
    assert.match(chip.text, /won't chase/i);
  });

  it("trigger buy chip separates human vs technical", () => {
    const chip = triggerBuyCopy({
      symbol: "GOOG",
      qty: 0.89,
      price: 335.41,
      condition: "day ≤ −3%",
    });
    assert.match(chip.text, /Trigger bought/);
    assert.match(chip.hint, /paper buy filled/i);
  });
});
