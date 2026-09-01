"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import { DeskSelect } from "@/components/ui/DeskSelect";
import { Spinner } from "@/components/ui/Feedback";
import {
  DEFAULT_TRIGGER_NOTIONAL_USD,
  defaultAutoPauseAfterFire,
  isProfitTriggerCondition,
  MAX_TRIGGER_NOTIONAL_USD,
  type TriggerAction,
  type TriggerConditionKind,
} from "@/lib/triggers";

type DeskAddTab = "watchlist" | "trigger";

const MARKET_CONDITION_OPTIONS: Array<{
  value: TriggerConditionKind;
  label: string;
  hint: string;
}> = [
  {
    value: "day_drop_pct",
    label: "Day drop %",
    hint: "Fires when the day move is at or under −value",
  },
  {
    value: "day_gain_pct",
    label: "Day gain %",
    hint: "Fires when the day move is at or over +value",
  },
  {
    value: "price_below",
    label: "Price ≤",
    hint: "Fires when mark is at or under this price",
  },
  {
    value: "price_above",
    label: "Price ≥",
    hint: "Fires when mark is at or over this price",
  },
];

const PROFIT_CONDITION_OPTIONS: Array<{
  value: TriggerConditionKind;
  label: string;
  hint: string;
}> = [
  {
    value: "profit_usd_above",
    label: "Profit ≥ $",
    hint: "Fires when YOUR open lot profit reaches this USD amount",
  },
  {
    value: "profit_pct_above",
    label: "Profit ≥ %",
    hint: "Fires when YOUR open lot profit % reaches this value",
  },
];

function conditionOptionsFor(action: TriggerAction) {
  if (action === "paper_sell") {
    return [...MARKET_CONDITION_OPTIONS, ...PROFIT_CONDITION_OPTIONS];
  }
  return MARKET_CONDITION_OPTIONS;
}

function thresholdPlaceholder(kind: TriggerConditionKind): string {
  if (kind === "profit_usd_above") return "28";
  if (kind === "profit_pct_above") return "5";
  if (kind === "price_below" || kind === "price_above") return "250";
  return "3";
}

const ACTION_OPTIONS: Array<{
  value: TriggerAction;
  label: string;
  hint: string;
}> = [
  {
    value: "attention",
    label: "Alert me",
    hint: "Email + chat chip — no trade",
  },
  {
    value: "paper_buy",
    label: "Paper buy",
    hint: "Spend a set USD size when the rule hits",
  },
  {
    value: "paper_sell",
    label: "Paper sell",
    hint: "Close all open paper lots for that symbol",
  },
];

type DeskAddModalProps = {
  open: boolean;
  busyWatchlist?: boolean;
  busyTrigger?: boolean;
  watchlistCount: number;
  watchlistLimit: number;
  triggerCount: number;
  triggerLimit: number;
  /** Live paper cash — used to hint paper-buy affordability. */
  paperCash?: number;
  /** Open lot symbols — paper sell needs one of these. */
  openSymbols?: string[];
  initialTab?: DeskAddTab;
  onClose: () => void;
  onAddWatchlist: (
    symbol: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onAddTrigger: (input: {
    symbol: string;
    conditionKind: TriggerConditionKind;
    value: number;
    action: TriggerAction;
    notionalUsd?: number;
    autoPauseAfterFire?: boolean;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
};

/** One modal for pinning watchlist tickers and arming triggers. */
export function DeskAddModal({
  open,
  busyWatchlist = false,
  busyTrigger = false,
  watchlistCount,
  watchlistLimit,
  triggerCount,
  triggerLimit,
  paperCash,
  openSymbols = [],
  initialTab = "watchlist",
  onClose,
  onAddWatchlist,
  onAddTrigger,
}: DeskAddModalProps) {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<DeskAddTab>(initialTab);
  const [symbol, setSymbol] = useState("");
  const [triggerKind, setTriggerKind] =
    useState<TriggerConditionKind>("day_drop_pct");
  const [triggerValue, setTriggerValue] = useState("3");
  const [triggerAction, setTriggerAction] =
    useState<TriggerAction>("attention");
  const [autoPauseAfterFire, setAutoPauseAfterFire] = useState(false);
  const [notionalUsd, setNotionalUsd] = useState(
    String(DEFAULT_TRIGGER_NOTIONAL_USD),
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const titleId = useId();
  const busy = busyWatchlist || busyTrigger;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setSymbol("");
    setTriggerKind("day_drop_pct");
    setTriggerValue("3");
    setTriggerAction("attention");
    setAutoPauseAfterFire(false);
    setNotionalUsd(String(DEFAULT_TRIGGER_NOTIONAL_USD));
    setLocalError(null);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, busy, onClose]);

  if (!mounted || !open) return null;

  const watchlistFull = watchlistCount >= watchlistLimit;
  const triggersFull = triggerCount >= triggerLimit;
  const ownsSymbol = openSymbols.some(
    (s) => s.toUpperCase() === symbol.trim().toUpperCase(),
  );
  const conditionOptions = conditionOptionsFor(triggerAction);
  const selectedCondition = conditionOptions.find((o) => o.value === triggerKind);
  const canArmSellAhead =
    triggerAction === "paper_sell" &&
    (isProfitTriggerCondition(triggerKind) ||
      triggerKind === "day_gain_pct" ||
      triggerKind === "price_above");

  async function submitWatchlist(e: React.FormEvent) {
    e.preventDefault();
    const next = symbol.trim().toUpperCase();
    if (!next) {
      setLocalError("Enter a ticker first.");
      return;
    }
    if (busyWatchlist || watchlistFull) return;
    setLocalError(null);
    const result = await onAddWatchlist(next);
    if (result.ok) {
      setSymbol("");
      onClose();
      return;
    }
    setLocalError(result.error);
  }

  async function submitTrigger(e: React.FormEvent) {
    e.preventDefault();
    const next = symbol.trim().toUpperCase();
    const value = Number(triggerValue);
    const size = Number(notionalUsd);
    if (!next) {
      setLocalError("Enter a ticker first.");
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      setLocalError("Threshold must be a positive number.");
      return;
    }
    if (
      triggerAction === "paper_buy" &&
      (!Number.isFinite(size) || size <= 0)
    ) {
      setLocalError("Enter a paper-buy size in USD.");
      return;
    }
    if (busyTrigger || triggersFull) return;
    setLocalError(null);
    const result = await onAddTrigger({
      symbol: next,
      conditionKind: triggerKind,
      value,
      action: triggerAction,
      notionalUsd:
        triggerAction === "paper_buy" ? Math.round(size) : undefined,
      autoPauseAfterFire,
    });
    if (result.ok) {
      setSymbol("");
      onClose();
      return;
    }
    setLocalError(result.error);
  }

  return createPortal(
    <div
      className="modal-overlay fade-up"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="modal-card desk-add-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <p className="font-mono-label">Desk</p>
        <h3 id={titleId} className="modal-title">
          Add to your board
        </h3>
        <p className="desk-add-lead">
          Pin a ticker to watch, or arm a standing trigger the cron can fire.
        </p>

        <div className="desk-add-tabs" role="tablist" aria-label="Add type">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "watchlist"}
            className={`desk-add-tab ${tab === "watchlist" ? "is-active" : ""}`}
            disabled={busy}
            onClick={() => {
              setTab("watchlist");
              setLocalError(null);
            }}
          >
            Watchlist
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "trigger"}
            className={`desk-add-tab ${tab === "trigger" ? "is-active" : ""}`}
            disabled={busy}
            onClick={() => {
              setTab("trigger");
              setLocalError(null);
            }}
          >
            Trigger
          </button>
        </div>

        <div className="modal-body desk-add-body">
          {localError ? (
            <p className="desk-add-warn" role="alert">
              {localError}
            </p>
          ) : null}

          {tab === "watchlist" ? (
            <form
              id="desk-add-watchlist"
              className="desk-add-form"
              onSubmit={(e) => {
                void submitWatchlist(e);
              }}
            >
              <label className="desk-add-label" htmlFor="desk-add-symbol-watch">
                Ticker
              </label>
              <input
                id="desk-add-symbol-watch"
                value={symbol}
                onChange={(e) => {
                  setSymbol(e.target.value.toUpperCase());
                  if (localError) setLocalError(null);
                }}
                placeholder="NVDA or DANGCEM"
                disabled={busyWatchlist || watchlistFull}
                className="soft-field"
                autoFocus
              />
              <p className="desk-add-hint">
                {watchlistCount}/{watchlistLimit} slots · we verify before saving
              </p>
              {watchlistFull ? (
                <p className="desk-add-warn" role="status">
                  Watchlist is full — remove one first.
                </p>
              ) : null}
            </form>
          ) : (
            <form
              id="desk-add-trigger"
              className="desk-add-form"
              onSubmit={(e) => {
                void submitTrigger(e);
              }}
            >
              <label className="desk-add-label" htmlFor="desk-add-symbol-trg">
                Ticker
              </label>
              <input
                id="desk-add-symbol-trg"
                value={symbol}
                onChange={(e) => {
                  setSymbol(e.target.value.toUpperCase());
                  if (localError) setLocalError(null);
                }}
                placeholder="GOOG"
                disabled={busyTrigger || triggersFull}
                className="soft-field"
                autoFocus
              />

              <div className="desk-add-grid">
                <div>
                  <span className="desk-add-label" id="desk-add-kind-label">
                    When
                  </span>
                  <DeskSelect
                    id="desk-add-kind"
                    aria-label="Trigger condition"
                    value={triggerKind}
                    options={conditionOptions}
                    disabled={busyTrigger}
                    onChange={(next) => {
                      setTriggerKind(next);
                      setTriggerValue(thresholdPlaceholder(next));
                    }}
                  />
                </div>
                <div>
                  <label className="desk-add-label" htmlFor="desk-add-value">
                    Threshold
                  </label>
                  <input
                    id="desk-add-value"
                    value={triggerValue}
                    onChange={(e) => {
                      setTriggerValue(e.target.value);
                      if (localError) setLocalError(null);
                    }}
                    inputMode="decimal"
                    placeholder={thresholdPlaceholder(triggerKind)}
                    disabled={busyTrigger}
                    className="soft-field"
                  />
                </div>
              </div>

              <span className="desk-add-label" id="desk-add-action-label">
                Then
              </span>
              <DeskSelect
                id="desk-add-action"
                aria-label="Trigger action"
                value={triggerAction}
                options={ACTION_OPTIONS}
                disabled={busyTrigger}
                onChange={(next) => {
                  setTriggerAction(next);
                  setAutoPauseAfterFire(defaultAutoPauseAfterFire(next));
                  if (
                    next !== "paper_sell" &&
                    isProfitTriggerCondition(triggerKind)
                  ) {
                    setTriggerKind("day_drop_pct");
                    setTriggerValue("3");
                  }
                  if (next === "paper_sell" && triggerKind === "day_drop_pct") {
                    setTriggerKind("day_gain_pct");
                    setTriggerValue("8");
                  }
                }}
              />

              <label className="desk-add-check">
                <input
                  type="checkbox"
                  checked={autoPauseAfterFire}
                  disabled={busyTrigger}
                  onChange={(e) => setAutoPauseAfterFire(e.target.checked)}
                />
                <span>Pause after it fires once</span>
              </label>
              <p className="desk-add-hint">
                When on, the rule turns off after a successful fire (24h cooldown
                still applies if left armed).
              </p>

              {selectedCondition ? (
                <p className="desk-add-hint">{selectedCondition.hint}</p>
              ) : null}

              {triggerAction === "paper_buy" ? (
                <>
                  <label className="desk-add-label" htmlFor="desk-add-notional">
                    Buy size (USD)
                  </label>
                  <input
                    id="desk-add-notional"
                    value={notionalUsd}
                    onChange={(e) => {
                      setNotionalUsd(e.target.value);
                      if (localError) setLocalError(null);
                    }}
                    inputMode="numeric"
                    placeholder={String(DEFAULT_TRIGGER_NOTIONAL_USD)}
                    disabled={busyTrigger}
                    className="soft-field"
                  />
                  <p className="desk-add-hint">
                    $25–${MAX_TRIGGER_NOTIONAL_USD.toLocaleString()}
                    {paperCash != null
                      ? ` · cash on hand $${Math.floor(paperCash).toLocaleString()}`
                      : ""}
                  </p>
                </>
              ) : null}

              {triggerAction === "paper_sell" ? (
                <p
                  className={
                    symbol.trim() && !ownsSymbol && !canArmSellAhead
                      ? "desk-add-warn"
                      : "desk-add-hint"
                  }
                  role="status"
                >
                  {symbol.trim() && !ownsSymbol && !canArmSellAhead
                    ? `No open lot in ${symbol.trim().toUpperCase()} — this sell rule needs a holding, or pick take-profit (day gain / profit ≥).`
                    : isProfitTriggerCondition(triggerKind)
                      ? "Uses your open lot's unrealized profit, not today's market %. Closes all lots for this ticker."
                      : canArmSellAhead && !ownsSymbol
                        ? "You can arm this take-profit ahead — it stays paused until you hold the name."
                        : "Closes all open paper lots for this ticker when the rule hits."}
                </p>
              ) : null}

              <p className="desk-add-hint">
                {triggerCount}/{triggerLimit} triggers · checked on cron / Scan
                now
              </p>
              {triggersFull ? (
                <p className="desk-add-warn" role="status">
                  Triggers are full — remove one first.
                </p>
              ) : null}
            </form>
          )}
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          {tab === "watchlist" ? (
            <button
              type="submit"
              form="desk-add-watchlist"
              className="btn-primary"
              disabled={busyWatchlist || !symbol.trim() || watchlistFull}
            >
              {busyWatchlist ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner size="sm" label="Adding" />
                  Checking…
                </span>
              ) : (
                "Add to watchlist"
              )}
            </button>
          ) : (
            <button
              type="submit"
              form="desk-add-trigger"
              className="btn-primary"
              disabled={
                busyTrigger ||
                !symbol.trim() ||
                triggersFull ||
                !triggerValue.trim() ||
                (triggerAction === "paper_buy" && !notionalUsd.trim())
              }
            >
              {busyTrigger ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner size="sm" label="Arming" />
                  Arming…
                </span>
              ) : (
                "Arm trigger"
              )}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
