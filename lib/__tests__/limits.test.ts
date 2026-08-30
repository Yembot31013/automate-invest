import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DESK_SNAPSHOT_LIMIT, MAX_USER_WATCHLIST } from "../limits.ts";

describe("desk limits", () => {
  it("caps watchlist below unlimited and above tape snapshot window", () => {
    assert.equal(MAX_USER_WATCHLIST, 20);
    assert.equal(DESK_SNAPSHOT_LIMIT, 12);
    assert.ok(DESK_SNAPSHOT_LIMIT <= MAX_USER_WATCHLIST);
  });
});
