export type DeskSectionId = "watchlist" | "structure" | "triggers";

export type DeskSectionGuideBlock = {
  heading: string;
  body: string;
  bullets?: string[];
};

export type DeskSectionGuide = {
  id: DeskSectionId;
  eyebrow: string;
  title: string;
  summary: string;
  blocks: DeskSectionGuideBlock[];
  example: {
    title: string;
    body: string;
  };
  compare: string;
};

export const DESK_SECTION_GUIDES: Record<DeskSectionId, DeskSectionGuide> = {
  watchlist: {
    id: "watchlist",
    eyebrow: "Sidebar · Watchlist",
    title: "Your market board",
    summary:
      "Tickers you chose to follow. The desk keeps live prices, day change, and headlines for these names only.",
    blocks: [
      {
        heading: "What it does",
        body: "Think of it as pins on your desk:",
        bullets: [
          "Add stocks, crypto, forex, or commodities you care about",
          "See today’s move at a glance in the sidebar",
          "Tap a row to ask Sidekick for an update with headlines",
          "Remove with × when you’re done watching",
        ],
      },
      {
        heading: "What it does not do",
        body: "The watchlist does not buy, sell, or fire alerts by itself. It only says “we’re watching this.”",
      },
    ],
    example: {
      title: "Example",
      body: "You add EUR/USD and NVDA. Both show in the list with green/red day %. Tap EUR/USD → chat fills with “give me an update on EUR/USD…”",
    },
    compare:
      "Watchlist = what we monitor. Triggers = your rules that can alert or paper-trade. Structure = automatic FX setup scanner (forex only).",
  },
  structure: {
    id: "structure",
    eyebrow: "Sidebar · Structure · FX",
    title: "FX setup scanner",
    summary:
      "A background scan on forex pairs in your watchlist. It looks for one specific bullish pattern and shows buy zone, stop, and target when found. It does not place trades.",
    blocks: [
      {
        heading: "In plain English",
        body: "After a strong move up, price often pulls back to a “discount zone” before continuing. Structure finds that zone on 2H candles (also 1H/4H/1D in chat).",
        bullets: [
          "Order block (OB) = the buy zone band you see on the card",
          "RR 1:2 = risk vs reward (e.g. risk $1 to aim for $2)",
          "Cron + Sidekick can open a setup map with purple OB, stop, and target labels",
          "Arm buy-zone alert fills chat with a draft trigger (alert only) — you review and send",
        ],
      },
      {
        heading: "Status badges",
        body: "What the pill on each row means:",
        bullets: [
          "IN ZONE — price is inside the buy zone right now (or just below it). This is the “it’s at the level we were watching” state.",
          "WAITING — a setup exists, but price is still above the zone. We’re waiting for a pullback into the buy band.",
          "No row — no valid setup on that pair at the moment (scan still runs in the background).",
        ],
      },
      {
        heading: "What it does not do",
        body: "Structure does not auto-buy or auto-create triggers. Use Arm buy-zone alert to draft an attention rule at the order-block top, then send it in chat if you want it armed.",
      },
    ],
    example: {
      title: "Example",
      body: "NZD/USD shows IN ZONE · OB 0.58948–0.59004 · RR 1:2. On the chat setup card, tap Arm buy-zone alert → chat fills with a natural “ping me at this level” ask. You hit send when ready.",
    },
    compare:
      "Unlike Triggers (your custom rules), Structure is a fixed FX pattern detector. Arm buy-zone alert on the chat card drafts a trigger from the setup levels. Ask Sidekick to backtest the structure strategy for historical win rate / R stats. Unlike the watchlist (any asset), Structure only runs on forex pairs you’ve pinned.",
  },
  triggers: {
    id: "triggers",
    eyebrow: "Sidebar · Triggers",
    title: "Your standing rules",
    summary:
      "If-this-then-that rules you arm once. The scan checks them on a schedule and can alert you or paper-buy/sell when conditions hit.",
    blocks: [
      {
        heading: "What it does",
        body: "Each trigger is one rule:",
        bullets: [
          "When: day drop %, day gain %, price above/below a level, or profit on your lot",
          "Then: email alert, paper buy ($ size), or paper sell (all or partial)",
          "Pause/disable anytime — armed in sidebar ≠ already fired",
        ],
      },
      {
        heading: "Fired vs armed",
        body: "A line in the Triggers sidebar means the rule is waiting. It only “fired” if you see a trigger-buy/sell chip in chat system log or a new paper fill.",
      },
    ],
    example: {
      title: "Example",
      body: "“When GOOG drops 3% in a day → paper buy $1,000.” Next scan day, if GOOG is down 3%+, the rule fires (if enabled and guardrails allow).",
    },
    compare:
      "Triggers = you write the rule and pick the action. Structure = system finds FX setups. Watchlist = just tracks symbols with no rule attached.",
  },
};
