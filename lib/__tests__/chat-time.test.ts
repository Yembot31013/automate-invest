import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatChatTime, messageCreatedAt } from "../chat-time.ts";

describe("formatChatTime", () => {
  const now = Date.parse("2026-08-31T18:30:00.000Z");

  it("says now for very recent", () => {
    assert.equal(
      formatChatTime(new Date(now - 10_000).toISOString(), now),
      "now",
    );
  });

  it("uses minutes ago", () => {
    assert.equal(
      formatChatTime(new Date(now - 2 * 60_000).toISOString(), now),
      "2 minutes ago",
    );
  });

  it("uses hours ago same day", () => {
    assert.equal(
      formatChatTime(new Date(now - 3 * 3_600_000).toISOString(), now),
      "3 hours ago",
    );
  });

  it("uses yesterday with clock", () => {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 0, 0, 0);
    const label = formatChatTime(yesterday.toISOString(), now);
    assert.match(label, /^Yesterday 11pm$/i);
  });

  it("uses N days ago with clock", () => {
    const past = new Date(now);
    past.setDate(past.getDate() - 3);
    past.setHours(23, 5, 0, 0);
    const label = formatChatTime(past.toISOString(), now);
    assert.match(label, /^3 days ago 11:05pm$/i);
  });
});

describe("messageCreatedAt", () => {
  it("reads metadata createdAt", () => {
    assert.equal(
      messageCreatedAt({ metadata: { createdAt: "2026-08-31T12:00:00.000Z" } }),
      "2026-08-31T12:00:00.000Z",
    );
    assert.equal(messageCreatedAt({ metadata: {} }), null);
  });
});
