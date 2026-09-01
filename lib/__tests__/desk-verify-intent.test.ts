import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCasualDeskChat, requiresDeskVerificationFirst } from "../agent/desk-verify-intent.ts";

describe("requiresDeskVerificationFirst", () => {
  it("matches accuracy challenges", () => {
    assert.equal(
      requiresDeskVerificationFirst("did you know what you are talking about?"),
      true,
    );
    assert.equal(requiresDeskVerificationFirst("are you sure about that"), true);
  });

  it("ignores casual vibe checks", () => {
    assert.equal(
      requiresDeskVerificationFirst("what is on your mind today buddy?"),
      false,
    );
    assert.equal(isCasualDeskChat("hey buddy salute"), true);
  });

  it("matches open desk-log thread follow-ups", () => {
    assert.equal(
      requiresDeskVerificationFirst("okay", [
        "what happened overnight from those system chips?",
      ]),
      true,
    );
  });

  it("ignores unrelated chat", () => {
    assert.equal(requiresDeskVerificationFirst("update on NVDA"), false);
  });
});
