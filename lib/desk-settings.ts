/** Bump when quiz questions change — re-enable requires a fresh pass. */
export const AUTO_TRADE_QUIZ_VERSION = 3;

export type DeskSettings = {
  autoTradeEnabled: boolean;
  /** ISO time when auto-trade was last enabled */
  autoTradeEnabledAt: string | null;
  /** Quiz version acknowledged when enabling */
  autoTradeQuizVersion: number | null;
  /** Take-profit exit (% unrealized) on owned positions */
  takeProfitPct: number;
  /** Stop-loss exit (% unrealized) on owned positions */
  stopLossPct: number;
  /** After take-profit is reached, allow this much giveback before exit */
  trailGivebackPct: number;
  /** Allow paper buys on watchlist dip signals when auto is on */
  allowAutoBuys: boolean;
  /** Max notional USD per auto buy */
  maxBuyNotionalUsd: number;
  /** Cap auto buys per UTC day */
  maxBuysPerDay: number;
  /** Enforce trigger spending / exposure limits */
  guardrailsEnabled: boolean;
  /** Max USD in one symbol (open position + armed buy triggers) */
  maxSymbolExposureUsd: number;
  /** Max successful trigger paper buys per UTC day */
  maxTriggerBuysPerDay: number;
  /** Max USD spent by trigger buys per UTC day */
  maxTriggerSpendPerDayUsd: number;
  /** Skip trigger buys when book unrealized PnL % is at or below −this value */
  pauseTriggerBuysWhenBookDownPct: number;
};

export const DEFAULT_DESK_SETTINGS: DeskSettings = {
  autoTradeEnabled: false,
  autoTradeEnabledAt: null,
  autoTradeQuizVersion: null,
  takeProfitPct: 8,
  stopLossPct: 5,
  trailGivebackPct: 2,
  allowAutoBuys: true,
  maxBuyNotionalUsd: 2_000,
  maxBuysPerDay: 3,
  guardrailsEnabled: true,
  maxSymbolExposureUsd: 15_000,
  maxTriggerBuysPerDay: 5,
  maxTriggerSpendPerDayUsd: 10_000,
  pauseTriggerBuysWhenBookDownPct: 3,
};

export type AutoTradeQuizOption = {
  id: string;
  label: string;
  correct: boolean;
};

export type AutoTradeQuizQuestion = {
  id: string;
  prompt: string;
  /** Plain-English teach-back shown after they pick (esp. if wrong). */
  explainCorrect: string;
  options: AutoTradeQuizOption[];
};

/** Short quiz shown every time the user enables auto-trade. */
export const AUTO_TRADE_QUIZ: AutoTradeQuizQuestion[] = [
  {
    id: "scope",
    prompt: "What does Auto-trade handle for you?",
    explainCorrect:
      "Auto can sell positions you already own (stops / take-profit / trail), and it can buy from your watchlist when dip rules fire. It won’t roam the whole market buying random names.",
    options: [
      {
        id: "a",
        label:
          "It can sell positions I already own, and buy from my watchlist when the rules fire",
        correct: true,
      },
      {
        id: "b",
        label: "It can buy any ticker on the whole market when headlines look good",
        correct: false,
      },
      {
        id: "c",
        label: "It only sends emails — it never moves paper cash",
        correct: false,
      },
    ],
  },
  {
    id: "attention",
    prompt: "What is Attention mail?",
    explainCorrect:
      "Attention is a friendly heads-up in your email and as a chip in chat. It never buys or sells. Auto can also Attention you when it would rather you decide instead of guessing.",
    options: [
      {
        id: "a",
        label: "It auto-sells for me whenever a headline looks scary",
        correct: false,
      },
      {
        id: "b",
        label:
          "A friendly heads-up in my email (and chat) with points to check — it does not trade. Auto can also Attention me if it would rather I decide",
        correct: true,
      },
      {
        id: "c",
        label: "Discord pings only",
        correct: false,
      },
    ],
  },
  {
    id: "judgment",
    prompt: "How perfect are Auto’s decisions?",
    explainCorrect:
      "Auto is meant to help and usually works, but it isn’t flawless. A rule can misread the tape, a buy can look different after the next print, and you might disagree with a call. Leaving Auto on is your choice — turn it off anytime.",
    options: [
      {
        id: "a",
        label:
          "Always perfect fills and calls — I can blame the desk if a trade looks wrong",
        correct: false,
      },
      {
        id: "b",
        label:
          "It works, but it’s not perfect — rules can misread a move, a buy can look different a minute later, and Sidekick can make a call I’d disagree with. That’s on me for leaving Auto on",
        correct: true,
      },
      {
        id: "c",
        label: "It only fails when the internet is slow",
        correct: false,
      },
    ],
  },
  {
    id: "liability",
    prompt: "Who owns leaving Auto on?",
    explainCorrect:
      "You do. Paper cash is fake ($100k start) with real market marks. Not financial advice. Disable Auto whenever you want — nobody else owns that switch for you.",
    options: [
      {
        id: "a",
        label: "Signal Desk covers any paper loss from a bad Auto call",
        correct: false,
      },
      {
        id: "b",
        label:
          "Me. Fake $100k paper cash with real marks, not financial advice, and I can turn Auto off anytime",
        correct: true,
      },
      {
        id: "c",
        label: "Whoever sent the Attention email",
        correct: false,
      },
    ],
  },
];

export function correctQuizOptionId(
  question: AutoTradeQuizQuestion,
): string | null {
  return question.options.find((o) => o.correct)?.id ?? null;
}

export function normalizeDeskSettings(
  raw: Partial<DeskSettings> | null | undefined,
): DeskSettings {
  const base = { ...DEFAULT_DESK_SETTINGS };
  if (!raw || typeof raw !== "object") return base;
  return {
    autoTradeEnabled: Boolean(raw.autoTradeEnabled),
    autoTradeEnabledAt:
      typeof raw.autoTradeEnabledAt === "string" ? raw.autoTradeEnabledAt : null,
    autoTradeQuizVersion:
      typeof raw.autoTradeQuizVersion === "number"
        ? raw.autoTradeQuizVersion
        : null,
    takeProfitPct: clampPct(raw.takeProfitPct, base.takeProfitPct, 1, 50),
    stopLossPct: clampPct(raw.stopLossPct, base.stopLossPct, 1, 50),
    trailGivebackPct: clampPct(
      raw.trailGivebackPct,
      base.trailGivebackPct,
      0.5,
      20,
    ),
    allowAutoBuys:
      typeof raw.allowAutoBuys === "boolean"
        ? raw.allowAutoBuys
        : base.allowAutoBuys,
    maxBuyNotionalUsd: clampPct(
      raw.maxBuyNotionalUsd,
      base.maxBuyNotionalUsd,
      50,
      20_000,
    ),
    maxBuysPerDay: Math.round(
      clampPct(raw.maxBuysPerDay, base.maxBuysPerDay, 0, 20),
    ),
    guardrailsEnabled:
      typeof raw.guardrailsEnabled === "boolean"
        ? raw.guardrailsEnabled
        : base.guardrailsEnabled,
    maxSymbolExposureUsd: clampPct(
      raw.maxSymbolExposureUsd,
      base.maxSymbolExposureUsd,
      500,
      100_000,
    ),
    maxTriggerBuysPerDay: Math.round(
      clampPct(raw.maxTriggerBuysPerDay, base.maxTriggerBuysPerDay, 1, 30),
    ),
    maxTriggerSpendPerDayUsd: clampPct(
      raw.maxTriggerSpendPerDayUsd,
      base.maxTriggerSpendPerDayUsd,
      100,
      100_000,
    ),
    pauseTriggerBuysWhenBookDownPct: clampPct(
      raw.pauseTriggerBuysWhenBookDownPct,
      base.pauseTriggerBuysWhenBookDownPct,
      0.5,
      25,
    ),
  };
}

function clampPct(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export type QuizAnswers = Record<string, string>;

export function gradeAutoTradeQuiz(answers: QuizAnswers): {
  ok: boolean;
  missing: string[];
  wrong: string[];
} {
  const missing: string[] = [];
  const wrong: string[] = [];
  for (const q of AUTO_TRADE_QUIZ) {
    const picked = answers[q.id];
    if (!picked) {
      missing.push(q.id);
      continue;
    }
    const opt = q.options.find((o) => o.id === picked);
    if (!opt?.correct) wrong.push(q.id);
  }
  return { ok: missing.length === 0 && wrong.length === 0, missing, wrong };
}

export const AUTO_TRADE_DISCLAIMER = [
  "Auto can paper-sell what you already own (stops, take-profit, and a little trail room), and paper-buy names on your watchlist when dip rules fire.",
  "Attention mail is just a pal tap on the shoulder — points to check, no trades.",
  "Auto is meant to work for you, but it isn’t perfect: a rule can misread the tape, a buy can look different after the next print, and sometimes it’ll Attention you instead of guessing.",
  "Fake $100k paper cash, real marks. Not financial advice. You’re in charge of leaving it on — turn it off anytime.",
].join(" ");
