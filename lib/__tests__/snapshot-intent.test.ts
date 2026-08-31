import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { requiresSnapshotFirst } from "../agent/snapshot-intent.ts";

describe("requiresSnapshotFirst", () => {
  it("requires getSnapshot for update/headline asks", () => {
    assert.equal(
      requiresSnapshotFirst(
        "Give me an update on GOOG including headlines — explain what each story means and why it matters.",
      ),
      true,
    );
    assert.equal(requiresSnapshotFirst("What's TSLA doing today?"), true);
    assert.equal(requiresSnapshotFirst("Look at gold"), true);
    assert.equal(requiresSnapshotFirst("Check out NVDA headlines"), true);
  });

  it("does not force snapshot for other desk actions", () => {
    assert.equal(requiresSnapshotFirst("Monitor GOOG"), false);
    assert.equal(requiresSnapshotFirst("Paper buy 5 NVDA"), false);
    assert.equal(requiresSnapshotFirst("What should I recommend from my watchlist?"), false);
    assert.equal(requiresSnapshotFirst("Show my paper portfolio PnL"), false);
    assert.equal(requiresSnapshotFirst("What if we bought 10 AAPL 30 days ago?"), false);
    assert.equal(requiresSnapshotFirst("What's the naira to dollar rate?"), false);
  });
});
