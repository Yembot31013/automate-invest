import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const EXPECTED_ART = [
  "onboard-welcome.png",
  "onboard-chat.png",
  "onboard-watchlist.png",
  "onboard-discord.png",
];

describe("onboarding art", () => {
  it("ships four public tour images", () => {
    for (const name of EXPECTED_ART) {
      const full = path.join(root, "public", name);
      assert.ok(fs.existsSync(full), `missing ${name}`);
    }
  });
});
