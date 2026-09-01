import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createToolDedupeCache } from "../agent/tool-dedupe.ts";

describe("createToolDedupeCache", () => {
  it("shares one execution for duplicate keys", async () => {
    const dedupe = createToolDedupeCache();
    let runs = 0;
    const work = () =>
      dedupe("portfolioPnL", async () => {
        runs += 1;
        return 42;
      });

    const [a, b, c] = await Promise.all([work(), work(), work()]);
    assert.equal(runs, 1);
    assert.equal(a, 42);
    assert.equal(b, 42);
    assert.equal(c, 42);
  });
});
