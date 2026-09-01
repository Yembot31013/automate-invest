"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AccountButton } from "@/components/auth/AccountButton";
import { CHAT_CHIPS, DeskChat } from "@/components/desk/DeskChat";
import {
  PaperBookModal,
  type PaperPositionRow,
} from "@/components/desk/PaperBookModal";
import { Sparkline } from "@/components/desk/Sparkline";
import { TradingViewModal } from "@/components/desk/TradingViewModal";
import { OnboardingModal } from "@/components/desk/OnboardingModal";
import { AutoTradeEnableModal } from "@/components/desk/AutoTradeEnableModal";
import { TriggerGuardrailsModal } from "@/components/desk/TriggerGuardrailsModal";
import { DeskAddModal } from "@/components/desk/DeskAddModal";
import { DeskTriggerDetailModal } from "@/components/desk/DeskTriggerDetailModal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import {
  BusyBanner,
  EmptyHint,
  Skeleton,
  Spinner,
  StatusToast,
  type ToastState,
} from "@/components/ui/Feedback";
import { Tip } from "@/components/ui/Tip";
import type { DeskSettings } from "@/lib/desk-settings";
import { MAX_USER_TRIGGERS, MAX_USER_WATCHLIST } from "@/lib/limits";
import { hasCompletedOnboarding } from "@/lib/onboarding";
import {
  formatTriggerAction,
  formatTriggerActionDetail,
  formatTriggerCondition,
  formatTriggerNotional,
  type DeskTrigger,
  type TriggerAction,
  type TriggerConditionKind,
  type TriggerSellCloseMode,
} from "@/lib/triggers";

type DeskSnapshot = {
  symbol: string;
  exchange: string;
  currentPrice?: number;
  changePct?: number;
  volumeRatio?: number;
  pctBelowSma14?: number;
  sentimentScore?: number | null;
  closes?: number[];
  headline?: string | null;
  error?: string;
};

type PortfolioPayload = {
  openCount: number;
  cash: number;
  equity: number;
  totalCost: number;
  totalMarketValue: number;
  totalUnrealizedPnl: number;
  totalUnrealizedPnlPct: number;
  positions?: PaperPositionRow[];
};

const ACCENTS = [
  "var(--yellow)",
  "var(--blue)",
  "var(--pink)",
  "var(--lavender)",
  "var(--green)",
  "var(--orange)",
] as const;

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatTapePrice(value: number, exchange?: string): string {
  const ex = exchange?.toUpperCase();
  if (ex === "NGX" || ex === "NGN" || ex === "NSE") {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      maximumFractionDigits: 2,
    }).format(value);
  }
  return formatUsd(value);
}

/** Shorter tape-card label — avoids COMMODITY:XAU/USD crowding the sparkline row. */
function formatTapeCardLabel(exchange: string, symbol: string): string {
  const ex = exchange.toUpperCase();
  const sym = symbol.toUpperCase();
  if (ex === "COMMODITY") {
    if (sym === "XAU/USD") return "Gold · XAU/USD";
    if (sym === "XAG/USD") return "Silver · XAG/USD";
    if (sym === "WTI/USD") return "Oil · WTI";
    return sym;
  }
  if (ex === "FOREX") return `FX · ${sym}`;
  if (ex === "CRYPTO") return sym;
  if (ex === "NGX" || ex === "NGN" || ex === "NSE") return `NGX · ${sym}`;
  return `${ex} · ${sym}`;
}

/** Compact money for tight metric tiles ($100k, $1.2M) — avoids overflow. */
function formatUsdCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const signed = value < 0 ? "-" : "";
    return `${signed}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  }
  if (abs >= 10_000) {
    const signed = value < 0 ? "-" : "";
    return `${signed}$${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  }
  return formatUsd(value);
}

function formatPct(value: number): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

function sidekickDeedLine(summary: string): string {
  switch (summary) {
    case "Watchlist updated":
      return "List updated · still loyal";
    case "Ticker removed":
      return "Dropped one · eyes forward";
    case "Trigger armed":
      return "Trigger armed · watching";
    case "Trigger updated":
      return "Trigger tweaked · still on it";
    case "Trigger removed":
      return "Trigger cleared · noted";
    case "Paper buy filled":
      return "Paper buy · salute";
    case "Paper sell filled":
      return "Paper sell · salute";
    case "Flagged a capability gap":
      return "Flagged a gap · on it";
    default:
      return summary;
  }
}

export function DeskShell() {
  const [snapshots, setSnapshots] = useState<DeskSnapshot[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioPayload | null>(null);
  const [watchlistCount, setWatchlistCount] = useState(0);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalTab, setAddModalTab] = useState<"watchlist" | "trigger">(
    "watchlist",
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyAdd, setBusyAdd] = useState(false);
  const [busyRemove, setBusyRemove] = useState<string | null>(null);
  const [busyScan, setBusyScan] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [chartSymbol, setChartSymbol] = useState<{
    symbol: string;
    exchange: string;
  } | null>(null);
  const [paperBookOpen, setPaperBookOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [mobilePanel, setMobilePanel] = useState<"chat" | "list" | "activity">(
    "chat",
  );
  const [externalPrompt, setExternalPrompt] = useState<string | null>(null);
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [sidekickSyncing, setSidekickSyncing] = useState(false);
  const [sidekickDeed, setSidekickDeed] = useState<string | null>(null);
  const [composerFocusKey, setComposerFocusKey] = useState(0);
  const [chatRefreshKey, setChatRefreshKey] = useState(0);
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [deskSettings, setDeskSettings] = useState<DeskSettings | null>(null);
  const [guardrailsModalOpen, setGuardrailsModalOpen] = useState(false);
  const [guardrailsBusy, setGuardrailsBusy] = useState(false);
  const [guardrailsError, setGuardrailsError] = useState<string | null>(null);
  const [autoTradeModalOpen, setAutoTradeModalOpen] = useState(false);
  const [autoTradeBusy, setAutoTradeBusy] = useState(false);
  const [autoTradeError, setAutoTradeError] = useState<string | null>(null);
  const [confirmDisableAuto, setConfirmDisableAuto] = useState(false);
  const [triggers, setTriggers] = useState<DeskTrigger[]>([]);
  const [triggerLimit, setTriggerLimit] = useState(MAX_USER_TRIGGERS);
  const [busyTrigger, setBusyTrigger] = useState<string | null>(null);
  const [pendingRemoveTrigger, setPendingRemoveTrigger] =
    useState<DeskTrigger | null>(null);
  const [selectedTriggerId, setSelectedTriggerId] = useState<string | null>(
    null,
  );
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bumpChatRefresh = useCallback(() => {
    setChatRefreshKey((k) => k + 1);
  }, []);

  const loadDeskSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/desk/settings", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { settings?: DeskSettings };
      if (data.settings) {
        setDeskSettings(data.settings);
        setAutoTradeEnabled(Boolean(data.settings.autoTradeEnabled));
      }
    } catch {
      // keep prior
    }
  }, []);

  useEffect(() => {
    void loadDeskSettings();
  }, [loadDeskSettings]);

  const showToast = useCallback((next: NonNullable<ToastState>) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(next);
    if (next.kind !== "busy") {
      toastTimer.current = setTimeout(() => setToast(null), 4200);
    }
  }, []);

  const rememberSidekickDeed = useCallback((deed: string) => {
    if (deedTimer.current) clearTimeout(deedTimer.current);
    setSidekickDeed(deed);
    deedTimer.current = setTimeout(() => setSidekickDeed(null), 8000);
  }, []);

  const handleChatBusy = useCallback((busy: boolean) => {
    setChatBusy(busy);
    // Chat already shows Ready/Answering + stream state — skip duplicate toast on mobile.
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (deedTimer.current) clearTimeout(deedTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!hasCompletedOnboarding()) {
      setOnboardingOpen(true);
    }
  }, []);

  const refresh = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!opts?.quiet) {
        setRefreshing(true);
      }
      setError(null);
      try {
        const res = await fetch("/api/desk", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = (await res.json()) as {
          snapshots: DeskSnapshot[];
          portfolio: PortfolioPayload;
          watchlist?: Array<{ symbol: string }>;
          triggers?: DeskTrigger[];
          triggerLimit?: number;
        };
        setSnapshots(data.snapshots ?? []);
        setPortfolio(data.portfolio ?? null);
        setWatchlistCount(data.watchlist?.length ?? data.snapshots?.length ?? 0);
        setTriggers(data.triggers ?? []);
        if (typeof data.triggerLimit === "number") {
          setTriggerLimit(data.triggerLimit);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load desk";
        setError(message);
        showToast({
          kind: "warn",
          message: "Couldn't refresh prices — try again in a moment.",
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [showToast],
  );

  const syncDeskFromSidekick = useCallback(
    async (reason: string) => {
      setSidekickSyncing(true);
      showToast({
        kind: "busy",
        message: reason,
      });
      setRefreshing(true);
      await refresh({ quiet: true });
      setSidekickSyncing(false);
      showToast({
        kind: "ok",
        message: "Desk updated from the sidekick.",
      });
    },
    [refresh, showToast],
  );

  const sidekickBusy = chatBusy || sidekickSyncing;
  const sidekickSubtext = sidekickBusy
    ? chatBusy
      ? "Poking the market… salute locked"
      : "Syncing your desk… hang tight"
    : sidekickDeed
      ? sidekickDeed
      : "On the tape · salute ready";

  useEffect(() => {
    // Quiet boot — chat/panel loaders already cover first paint (avoids toast over tabs).
    void refresh({ quiet: true });
  }, [refresh]);

  async function addSymbol(
    symbolRaw: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const symbol = symbolRaw.trim().toUpperCase();
    if (!symbol) return { ok: false, error: "Enter a ticker first." };
    setBusyAdd(true);
    setError(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        symbol?: string;
        error?: string;
      };
      if (!res.ok || data.ok === false) {
        throw new Error(data.error ?? "Failed to add symbol");
      }
      const added = data.symbol ?? symbol;
      setActivityLog((prev) => [`Monitored ${added}`, ...prev].slice(0, 12));
      showToast({
        kind: "ok",
        message: `${added} is on your watchlist. Nice.`,
      });
      await refresh({ quiet: true });
      return { ok: true };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to add symbol";
      return { ok: false, error: message };
    } finally {
      setBusyAdd(false);
    }
  }

  async function removeSymbol(symbol: string) {
    setBusyRemove(symbol);
    setError(null);
    showToast({
      kind: "busy",
      message: `Removing ${symbol} from your list…`,
    });
    try {
      const res = await fetch(
        `/api/watchlist?symbol=${encodeURIComponent(symbol)}`,
        { method: "DELETE" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || data.ok === false) {
        throw new Error(data.error ?? "Failed to remove symbol");
      }
      setPendingRemove(null);
      setActivityLog((prev) => [`Removed ${symbol}`, ...prev].slice(0, 12));
      showToast({ kind: "ok", message: `${symbol} is gone from your list.` });
      await refresh({ quiet: true });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to remove symbol";
      setError(message);
      showToast({
        kind: "warn",
        message: `Couldn't remove ${symbol}. It's still on your list.`,
      });
    } finally {
      setBusyRemove(null);
    }
  }

  async function runScan() {
    setBusyScan(true);
    setScanNote(null);
    setError(null);
    showToast({
      kind: "busy",
      message: autoTradeEnabled
        ? "Scanning your board · Attention + Auto…"
        : "Scanning your board · Attention mail…",
    });
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        alerted?: string[];
        scanned?: number;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Scan failed");
      }
      const note = `Scanned ${data.scanned ?? 0} · alerted ${(data.alerted ?? []).length}`;
      setScanNote(note);
      setActivityLog((prev) => [note, ...prev].slice(0, 12));
      showToast({
        kind: "ok",
        message: `Scan done — checked ${data.scanned ?? 0}, alerted ${(data.alerted ?? []).length}.`,
      });
      bumpChatRefresh();
      await refresh({ quiet: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Scan failed";
      setError(message);
      showToast({ kind: "warn", message: `Scan didn't finish: ${message}` });
    } finally {
      setBusyScan(false);
    }
  }

  async function saveGuardrails(patch: {
    guardrailsEnabled: boolean;
    maxSymbolExposureUsd: number;
    maxTriggerBuysPerDay: number;
    maxTriggerSpendPerDayUsd: number;
    pauseTriggerBuysWhenBookDownPct: number;
  }): Promise<boolean> {
    setGuardrailsBusy(true);
    setGuardrailsError(null);
    try {
      const res = await fetch("/api/desk/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateGuardrails", ...patch }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        settings?: DeskSettings;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.settings) {
        setGuardrailsError(data.error ?? "Couldn't save guardrails.");
        return false;
      }
      setDeskSettings(data.settings);
      setActivityLog((prev) => ["Guardrails updated", ...prev].slice(0, 12));
      return true;
    } catch {
      setGuardrailsError("Couldn't save guardrails.");
      return false;
    } finally {
      setGuardrailsBusy(false);
    }
  }

  async function enableAutoTrade(payload: {
    agreed: boolean;
    quizAnswers: Record<string, string>;
  }): Promise<boolean> {
    setAutoTradeBusy(true);
    setAutoTradeError(null);
    try {
      const res = await fetch("/api/desk/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "enable",
          agreed: payload.agreed,
          quizAnswers: payload.quizAnswers,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        settings?: DeskSettings;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Couldn't enable Auto-trade");
      }
      setAutoTradeEnabled(true);
      bumpChatRefresh();
      setActivityLog((prev) => ["Auto-trade enabled", ...prev].slice(0, 12));
      return true;
    } catch (err) {
      setAutoTradeError(
        err instanceof Error ? err.message : "Couldn't enable Auto-trade",
      );
      return false;
    } finally {
      setAutoTradeBusy(false);
    }
  }

  async function disableAutoTrade() {
    setAutoTradeBusy(true);
    try {
      const res = await fetch("/api/desk/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disable" }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Couldn't disable Auto-trade");
      }
      setAutoTradeEnabled(false);
      setConfirmDisableAuto(false);
      bumpChatRefresh();
      showToast({
        kind: "ok",
        message: "Auto-trade off — Attention mail still watches your board.",
      });
      setActivityLog((prev) => ["Auto-trade disabled", ...prev].slice(0, 12));
    } catch (err) {
      showToast({
        kind: "warn",
        message:
          err instanceof Error ? err.message : "Couldn't disable Auto-trade",
      });
    } finally {
      setAutoTradeBusy(false);
    }
  }

  async function createTrigger(input: {
    symbol: string;
    conditionKind: TriggerConditionKind;
    value: number;
    action: TriggerAction;
    notionalUsd?: number;
    sellCloseMode?: TriggerSellCloseMode;
    sellCloseValue?: number;
    autoPauseAfterFire?: boolean;
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const symbol = input.symbol.trim().toUpperCase();
    if (!symbol) return { ok: false, error: "Enter a ticker first." };
    if (!Number.isFinite(input.value) || input.value <= 0) {
      return { ok: false, error: "Threshold must be a positive number." };
    }
    setBusyTrigger("create");
    try {
      const res = await fetch("/api/triggers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          condition: { kind: input.conditionKind, value: input.value },
          action: input.action,
          notionalUsd: input.notionalUsd,
          sellCloseMode: input.sellCloseMode,
          sellCloseValue: input.sellCloseValue,
          autoPauseAfterFire: input.autoPauseAfterFire,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        triggers?: DeskTrigger[];
      };
      if (!res.ok || data.ok === false) {
        throw new Error(data.error ?? "Couldn't create trigger");
      }
      setTriggers(data.triggers ?? []);
      bumpChatRefresh();
      showToast({ kind: "ok", message: `Trigger set for ${symbol}` });
      setActivityLog((prev) => [`Trigger · ${symbol}`, ...prev].slice(0, 12));
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error ? err.message : "Couldn't create trigger",
      };
    } finally {
      setBusyTrigger(null);
    }
  }

  async function toggleTrigger(id: string, enabled: boolean) {
    await patchTrigger(id, { enabled });
  }

  async function patchTrigger(
    id: string,
    patch: {
      enabled?: boolean;
      autoPauseAfterFire?: boolean;
    },
  ) {
    setBusyTrigger(id);
    try {
      const res = await fetch("/api/triggers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        triggers?: DeskTrigger[];
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Couldn't update trigger");
      }
      setTriggers(data.triggers ?? []);
      bumpChatRefresh();
    } catch (err) {
      showToast({
        kind: "warn",
        message: err instanceof Error ? err.message : "Couldn't update trigger",
      });
    } finally {
      setBusyTrigger(null);
    }
  }

  async function removeTrigger(id: string) {
    setBusyTrigger(id);
    try {
      const res = await fetch(`/api/triggers?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        triggers?: DeskTrigger[];
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Couldn't remove trigger");
      }
      setTriggers(data.triggers ?? []);
      setPendingRemoveTrigger(null);
      setSelectedTriggerId(null);
      bumpChatRefresh();
      showToast({ kind: "ok", message: "Trigger removed" });
    } catch (err) {
      showToast({
        kind: "warn",
        message: err instanceof Error ? err.message : "Couldn't remove trigger",
      });
    } finally {
      setBusyTrigger(null);
    }
  }

  const pnlPositive = (portfolio?.totalUnrealizedPnl ?? 0) >= 0;
  const selectedTrigger =
    selectedTriggerId != null
      ? (triggers.find((t) => t.id === selectedTriggerId) ?? null)
      : null;
  const openSymbols = (portfolio?.positions ?? []).map((p) => p.symbol);
  const anyBusy =
    busyAdd ||
    busyRemove != null ||
    busyScan ||
    refreshing ||
    busyTrigger != null;

  const sidebar = (
    <aside
      className={`soft-card-strong flex h-full flex-col overflow-hidden ${busyAdd ? "ring-2 ring-[var(--blue)]/30" : ""}`}
      aria-busy={busyAdd || busyRemove != null}
    >
      <div className="shrink-0 border-b border-[color-mix(in_srgb,var(--mix)_50%,transparent)] px-4 py-4">
        <p className="font-mono-label">Agents</p>
        <h1 className="mt-1 text-xl font-extrabold tracking-tight text-[var(--ink)]">
          Signal Desk
        </h1>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Your tickers live here. Click one → ask the sidekick.
        </p>
      </div>

      <div className="shrink-0 space-y-2 border-b border-[color-mix(in_srgb,var(--mix)_50%,transparent)] px-3 py-3">
        <Tip
          label="Jump to chat with your loyal market pal"
          className="w-full"
          as="div"
        >
          <button
            type="button"
            className={`sidekick-card tilt-hover soft-card flex w-full items-center gap-3 px-3 py-3 text-left ${
              sidekickBusy ? "is-busy" : ""
            }`}
            onClick={() => {
              setMobilePanel("chat");
              setComposerFocusKey((n) => n + 1);
            }}
          >
            <span
              className={`sidekick-avatar ${sidekickBusy ? "is-busy" : ""}`}
              aria-hidden
            >
              🫡
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-[var(--ink)]">
                Sidekick
              </span>
              <span className="sidekick-subtext">{sidekickSubtext}</span>
            </span>
          </button>
        </Tip>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        <p className="font-mono-label px-1">Watchlist</p>
        {loading && snapshots.length === 0 ? (
          <div className="space-y-2 px-1" aria-busy="true" aria-label="Loading watchlist">
            <Skeleton lines={3} />
            <p className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <Spinner size="sm" label="Loading watchlist" />
              Loading your tickers…
            </p>
          </div>
        ) : snapshots.length === 0 ? (
          <EmptyHint
            title="Empty list"
            body="Tap Add below to pin a ticker. We'll verify it before saving."
          />
        ) : (
          snapshots.map((snap, i) => (
            <div
              key={snap.symbol}
              className={`tilt-hover soft-card flex w-full items-center gap-1 px-2 py-1.5 ${
                busyRemove === snap.symbol ? "opacity-60" : ""
              }`}
            >
              <Tip
                label={`Fill chat with a ${snap.symbol} update ask — you send when ready`}
                className="min-w-0 flex-1"
                as="div"
              >
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center justify-between gap-2 rounded-[12px] px-1.5 py-1 text-left"
                  onClick={() => {
                    setExternalPrompt(
                      `Give me an update on ${snap.symbol} including headlines — explain what each story means and why it matters.`,
                    );
                    setMobilePanel("chat");
                    showToast({
                      kind: "info",
                      message: `Shortcut for ${snap.symbol} — check the chat box`,
                    });
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: ACCENTS[i % ACCENTS.length] }}
                    />
                    <span className="truncate text-sm font-bold">
                      {snap.symbol}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-xs font-semibold ${
                      (snap.changePct ?? 0) >= 0
                        ? "text-[color-mix(in_srgb,var(--green)_70%,var(--ink))]"
                        : "text-[color-mix(in_srgb,var(--orange)_80%,var(--ink))]"
                    }`}
                  >
                    {snap.changePct != null ? formatPct(snap.changePct) : "—"}
                  </span>
                </button>
              </Tip>
              <Tip label={`Remove ${snap.symbol} from your watchlist`}>
                <button
                  type="button"
                  aria-label={`Remove ${snap.symbol}`}
                  disabled={busyRemove === snap.symbol || busyAdd}
                  onClick={() => setPendingRemove(snap.symbol)}
                  className="shrink-0 rounded-full px-2 py-1 text-xs font-bold text-[var(--muted)] transition hover:bg-[color-mix(in_srgb,var(--orange)_28%,var(--mix))] hover:text-[var(--ink)] disabled:opacity-50"
                >
                  {busyRemove === snap.symbol ? (
                    <Spinner size="sm" label={`Removing ${snap.symbol}`} />
                  ) : (
                    "×"
                  )}
                </button>
              </Tip>
            </div>
          ))
        )}

        <p className="font-mono-label px-1 pt-3">Triggers</p>
        <p className="px-1 pb-1 text-[0.68rem] leading-snug text-[var(--muted)]">
          {loading ? "…" : `${triggers.length}/${triggerLimit}`} · cron checks
          these on scan
        </p>
        {loading ? (
          <div
            className="space-y-2 px-1"
            aria-busy="true"
            aria-label="Loading triggers"
          >
            <Skeleton lines={2} />
            <p className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <Spinner size="sm" label="Loading triggers" />
              Loading your triggers…
            </p>
          </div>
        ) : triggers.length === 0 ? (
          <EmptyHint
            title="No triggers yet"
            body="Tap Add below to arm a rule — e.g. GOOG day drop 3% → alert or paper buy."
          />
        ) : (
          triggers.map((trg, i) => (
            <div
              key={trg.id}
              className={`tilt-hover soft-card desk-trigger-row ${
                busyTrigger === trg.id ? "is-busy" : ""
              } ${!trg.enabled ? "is-paused" : ""}`}
            >
              <div className="desk-trigger-card">
                <button
                  type="button"
                  className="desk-trigger-main"
                  aria-label={`Open ${trg.symbol} trigger details`}
                  disabled={busyTrigger === trg.id}
                  onClick={() => setSelectedTriggerId(trg.id)}
                >
                  <div className="desk-trigger-head">
                    <span
                      className="desk-trigger-dot"
                      style={{ background: ACCENTS[i % ACCENTS.length] }}
                      aria-hidden="true"
                    />
                    <span className="desk-trigger-symbol">{trg.symbol}</span>
                    <span
                      className={`desk-trigger-status ${
                        trg.enabled ? "is-on" : "is-paused"
                      }`}
                    >
                      {trg.enabled ? "On" : "Paused"}
                    </span>
                  </div>
                  <p className="desk-trigger-when">
                    {formatTriggerCondition(trg.condition)}
                  </p>
                  <div className="desk-trigger-foot">
                    <span
                      className={`desk-trigger-action desk-trigger-action--${trg.action}`}
                    >
                      {formatTriggerAction(trg.action)}
                    </span>
                    {trg.action === "paper_buy" ? (
                      <span className="desk-trigger-size">
                        {formatTriggerNotional(trg.notionalUsd)}
                      </span>
                    ) : trg.action === "paper_sell" ? (
                      <span className="desk-trigger-size">
                        {trg.sellCloseMode === "all"
                          ? "All"
                          : formatTriggerActionDetail(trg).replace(
                              /^Paper sell /,
                              "",
                            )}
                      </span>
                    ) : null}
                  </div>
                </button>
                <div className="desk-trigger-controls">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={trg.enabled}
                    aria-label={`${trg.enabled ? "Disable" : "Enable"} trigger ${trg.symbol}`}
                    disabled={busyTrigger === trg.id}
                    className={`desk-switch shrink-0 ${trg.enabled ? "is-on" : ""}`}
                    onClick={() => {
                      void toggleTrigger(trg.id, !trg.enabled);
                    }}
                  >
                    <span className="desk-switch-knob" aria-hidden="true" />
                  </button>
                  <Tip label={`Remove ${trg.symbol} trigger`}>
                    <button
                      type="button"
                      aria-label={`Remove ${trg.symbol} trigger`}
                      disabled={busyTrigger === trg.id}
                      onClick={() => setPendingRemoveTrigger(trg)}
                      className="shrink-0 rounded-full px-2 py-0.5 text-xs font-bold text-[var(--muted)] transition hover:bg-[color-mix(in_srgb,var(--orange)_28%,var(--mix))] hover:text-[var(--ink)] disabled:opacity-50"
                    >
                      {busyTrigger === trg.id ? (
                        <Spinner size="sm" label="Updating trigger" />
                      ) : (
                        "×"
                      )}
                    </button>
                  </Tip>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-auto shrink-0 space-y-2 border-t border-[color-mix(in_srgb,var(--mix)_50%,transparent)] p-3">
        <Tip
          label="Add a watchlist ticker or arm a trigger"
          className="w-full"
          as="div"
        >
          <button
            type="button"
            className="btn-primary w-full !py-2.5 text-sm"
            onClick={() => {
              setAddModalTab(
                snapshots.length === 0 && triggers.length > 0
                  ? "trigger"
                  : "watchlist",
              );
              setAddModalOpen(true);
            }}
          >
            Add
          </button>
        </Tip>
        <p className="text-center text-[0.68rem] leading-snug text-[var(--muted)]">
          Watchlist {watchlistCount}/{MAX_USER_WATCHLIST} · Triggers{" "}
          {triggers.length}/{triggerLimit}
        </p>
        {error && (
          <p
            className="rounded-[14px] bg-[color-mix(in_srgb,var(--orange)_28%,var(--mix))] px-2 py-1.5 text-xs leading-snug"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    </aside>
  );

  const activity = (
    <aside
      className="soft-card-strong flex h-full flex-col overflow-hidden"
      aria-busy={busyScan || refreshing}
    >
      <div className="border-b border-[color-mix(in_srgb,var(--mix)_50%,transparent)] px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-mono-label">Reports</p>
            <h2 className="mt-1 text-xl font-extrabold tracking-tight">
              Activity
            </h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Paper book, tape, and what just happened.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Tip label="Account — theme, profile, or sign out">
              <span className="inline-flex">
                <AccountButton />
              </span>
            </Tip>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Tip label="Run dip/breakout rules · Attention email + chat chip (Auto if enabled)">
            <button
              type="button"
              disabled={busyScan || loading}
              onClick={() => void runScan()}
              className="btn-primary !px-3 !py-1.5 text-xs"
            >
              {busyScan ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner size="sm" label="Scanning" />
                  Scanning…
                </span>
              ) : (
                "Scan now"
              )}
            </button>
          </Tip>
          <Tip
            label={
              autoTradeEnabled
                ? "Auto-trade is still on — exits on owned lots, buys from watchlist only. Click to turn off."
                : "Turn on Auto-trade — sells what you own, buys from your watchlist. Short quiz first."
            }
          >
            <button
              type="button"
              disabled={autoTradeBusy || loading}
              onClick={() => {
                setAutoTradeError(null);
                if (autoTradeEnabled) {
                  setConfirmDisableAuto(true);
                } else {
                  setAutoTradeModalOpen(true);
                }
              }}
              className={`badge-pill !px-3 !py-1.5 text-xs font-bold ${
                autoTradeEnabled
                  ? "bg-[color-mix(in_srgb,var(--green)_35%,var(--mix))] text-[var(--ink)]"
                  : "bg-[color-mix(in_srgb,var(--mix)_80%,transparent)] text-[var(--ink)]"
              }`}
            >
              {autoTradeEnabled ? "Auto on" : "Auto-trade"}
            </button>
          </Tip>
          <Tip label="Trigger buy limits — exposure per stock, daily spend, bad-day pause">
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setGuardrailsError(null);
                setGuardrailsModalOpen(true);
              }}
              className={`badge-pill !px-3 !py-1.5 text-xs font-bold ${
                deskSettings?.guardrailsEnabled
                  ? "bg-[color-mix(in_srgb,var(--yellow)_35%,var(--mix))] text-[var(--ink)]"
                  : "bg-[color-mix(in_srgb,var(--mix)_80%,transparent)] text-[var(--ink)]"
              }`}
            >
              {deskSettings?.guardrailsEnabled ? "Guardrails on" : "Guardrails"}
            </button>
          </Tip>
          <Tip label="Reload prices, headlines, and paper PnL">
            <button
              type="button"
              disabled={refreshing || busyScan}
              onClick={() => {
                showToast({
                  kind: "busy",
                  message: "Refreshing prices & paper book…",
                });
                void refresh().then(() => {
                  showToast({
                    kind: "ok",
                    message: "Desk is fresh — numbers updated.",
                  });
                });
              }}
              className="btn-ghost !px-3 !py-1.5 text-xs"
            >
              {refreshing ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner size="sm" label="Refreshing" />
                  Refreshing…
                </span>
              ) : (
                "Refresh"
              )}
            </button>
          </Tip>
        </div>
        {(busyScan || refreshing) && (
          <div className="mt-3">
            <BusyBanner
              active
              message={
                busyScan
                  ? "Scanning watchlist — this can take a few seconds…"
                  : "Pulling latest market data…"
              }
            />
          </div>
        )}
        {scanNote && (
          <p className="mt-2 text-xs font-medium text-[var(--ink)]">{scanNote}</p>
        )}
        {error && (
          <p
            className="mt-2 rounded-[14px] bg-[color-mix(in_srgb,var(--orange)_28%,var(--mix))] px-2 py-1.5 text-xs"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>

      <div
        className={`space-y-3 overflow-y-auto px-4 py-4 ${refreshing ? "opacity-80" : ""}`}
      >
        <p className="font-mono-label">Paper book</p>
        <p className="text-[0.7rem] text-[var(--muted)]">
          Equity = cash + positions · hover tiles for exact $ · tap Open for
          holdings
        </p>
        {loading && !portfolio ? (
          <div className="paper-metrics" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="paper-metric-cell">
                <div className="metric-tile h-full bg-[color-mix(in_srgb,var(--white)_80%,transparent)]">
                  <Skeleton lines={2} />
                </div>
              </div>
            ))}
          </div>
        ) : portfolio ? (
          <div className="paper-metrics">
            <div className="paper-metric-cell">
              <Tip
                label={`Equity (total account)\n${formatUsd(portfolio.equity)}\nCash left ${formatUsd(portfolio.cash)} + positions worth ${formatUsd(portfolio.totalMarketValue)}`}
                as="div"
                className="min-w-0"
              >
                <button
                  type="button"
                  className="metric-tile metric-tile-button"
                  style={{
                    background:
                      "color-mix(in srgb, var(--yellow) 35%, var(--mix))",
                  }}
                  onClick={() => setPaperBookOpen(true)}
                  aria-label={`Equity ${formatUsd(portfolio.equity)}. Open holdings.`}
                >
                  <p className="font-mono-label">Equity</p>
                  <p className="metric-value">
                    {formatUsdCompact(portfolio.equity)}
                  </p>
                  <p className="metric-meta" aria-hidden="true">
                    &nbsp;
                  </p>
                </button>
              </Tip>
            </div>
            <div className="paper-metric-cell">
              <Tip
                label={`Unrealized PnL\n${formatUsd(portfolio.totalUnrealizedPnl)} (${formatPct(portfolio.totalUnrealizedPnlPct)})\nGain/loss vs what you paid for open lots (${formatUsd(portfolio.totalCost)})`}
                as="div"
                className="min-w-0"
              >
                <button
                  type="button"
                  className="metric-tile metric-tile-button"
                  style={{
                    background: pnlPositive
                      ? "color-mix(in srgb, var(--green) 35%, var(--mix))"
                      : "color-mix(in srgb, var(--orange) 35%, var(--mix))",
                  }}
                  onClick={() => setPaperBookOpen(true)}
                  aria-label={`PnL ${formatUsd(portfolio.totalUnrealizedPnl)}. Open holdings.`}
                >
                  <p className="font-mono-label">PnL</p>
                  <p className="metric-value">
                    {formatUsdCompact(portfolio.totalUnrealizedPnl)}
                  </p>
                  <p className="metric-meta">
                    {formatPct(portfolio.totalUnrealizedPnlPct)}
                  </p>
                </button>
              </Tip>
            </div>
            <div className="paper-metric-cell">
              <Tip
                label={`Cash left\n${formatUsd(portfolio.cash)}\nStarted at $100,000.00 · ${formatUsd(portfolio.totalCost)} tied up in open positions`}
                as="div"
                className="min-w-0"
              >
                <button
                  type="button"
                  className="metric-tile metric-tile-button"
                  style={{
                    background:
                      "color-mix(in srgb, var(--blue) 32%, var(--mix))",
                  }}
                  onClick={() => setPaperBookOpen(true)}
                  aria-label={`Cash ${formatUsd(portfolio.cash)}. Open holdings.`}
                >
                  <p className="font-mono-label">Cash</p>
                  <p className="metric-value">
                    {formatUsdCompact(portfolio.cash)}
                  </p>
                  <p className="metric-meta" aria-hidden="true">
                    &nbsp;
                  </p>
                </button>
              </Tip>
            </div>
            <div className="paper-metric-cell">
              <Tip
                label={
                  portfolio.openCount === 0
                    ? "No open positions yet\nClick to open the holdings sheet"
                    : `${portfolio.openCount} open position${portfolio.openCount === 1 ? "" : "s"}\nWorth ${formatUsd(portfolio.totalMarketValue)} · click for tickers, qty, cost & PnL`
                }
                as="div"
                className="min-w-0"
              >
                <button
                  type="button"
                  className="metric-tile metric-tile-button"
                  style={{
                    background:
                      "color-mix(in srgb, var(--lavender) 40%, var(--mix))",
                  }}
                  onClick={() => setPaperBookOpen(true)}
                  aria-label={`${portfolio.openCount} open. View holdings.`}
                >
                  <p className="font-mono-label">Open</p>
                  <p className="metric-value">{portfolio.openCount}</p>
                  <p className="metric-meta">View holdings</p>
                </button>
              </Tip>
            </div>
          </div>
        ) : (
          <EmptyHint
            title="No paper trades yet"
            body='Tap Paper buy / Paper sell in the sidekick chips, or say “buy 5 NVDA” / “sell NVDA” / “close my BTC” — fake cash, real prices.'
          />
        )}

        <p className="font-mono-label pt-2">Tape cards</p>
        <p className="text-[0.7rem] text-[var(--muted)]">
          Tap a card for chart · NGX uses desk + TradingView (NSENG) · Remove stays on the button.
        </p>
        {loading && snapshots.length === 0 ? (
          <div className="space-y-2" aria-busy="true">
            <div className="soft-card p-3">
              <Skeleton lines={3} />
            </div>
            <div className="soft-card p-3">
              <Skeleton lines={3} />
            </div>
          </div>
        ) : snapshots.length === 0 ? (
          <EmptyHint
            title="Nothing on the tape"
            body="Add a ticker on the left, then you'll see price, volume, and headlines here."
          />
        ) : (
          <div className="space-y-2">
            {snapshots.map((snap, i) => {
              const up = (snap.changePct ?? 0) >= 0;
              return (
                <article
                  key={snap.symbol}
                  role="button"
                  tabIndex={0}
                  className={`tilt-hover soft-card cursor-pointer p-3 ${
                    busyRemove === snap.symbol ? "opacity-55" : ""
                  }`}
                  style={{
                    background: `color-mix(in srgb, ${ACCENTS[i % ACCENTS.length]} 18%, var(--mix))`,
                  }}
                  title={`Open TradingView chart for ${snap.symbol}`}
                  onClick={() =>
                    setChartSymbol({
                      symbol: snap.symbol,
                      exchange: snap.exchange,
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setChartSymbol({
                        symbol: snap.symbol,
                        exchange: snap.exchange,
                      });
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono-label">
                        {formatTapeCardLabel(snap.exchange, snap.symbol)}
                      </p>
                      <p className="mt-1 truncate text-lg font-extrabold tabular-nums">
                        {snap.currentPrice != null
                          ? formatTapePrice(snap.currentPrice, snap.exchange)
                          : "—"}
                      </p>
                      <p className="text-xs font-semibold">
                        {snap.changePct != null
                          ? formatPct(snap.changePct)
                          : (snap.error ?? "—")}
                      </p>
                    </div>
                    <Tip label={`Stop watching ${snap.symbol}`}>
                      <button
                        type="button"
                        aria-label={`Remove ${snap.symbol}`}
                        disabled={busyRemove === snap.symbol}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingRemove(snap.symbol);
                        }}
                        className="btn-ghost shrink-0 !px-2.5 !py-1 text-[0.65rem]"
                      >
                        {busyRemove === snap.symbol ? (
                          <span className="inline-flex items-center gap-1">
                            <Spinner size="sm" label="Removing" />
                            …
                          </span>
                        ) : (
                          "Remove"
                        )}
                      </button>
                    </Tip>
                  </div>
                  {snap.closes && snap.closes.length > 1 ? (
                    <div className="mt-2 overflow-hidden">
                      <Tip label="Recent closing prices — green up, orange soft">
                        <span className="block w-full max-w-full">
                          <Sparkline
                            values={snap.closes}
                            stroke={up ? "#8bd450" : "#ff8a5b"}
                            className="h-10 w-full max-w-full"
                          />
                        </span>
                      </Tip>
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-3 text-[0.7rem] text-[var(--muted)]">
                    <Tip label="Today's volume vs the 20-day average">
                      <span>
                        Vol{" "}
                        {snap.volumeRatio != null
                          ? `${snap.volumeRatio.toFixed(2)}×`
                          : "—"}
                      </span>
                    </Tip>
                    <Tip label="How far price sits below the 14-day moving average">
                      <span>
                        SMA{" "}
                        {snap.pctBelowSma14 != null
                          ? `${snap.pctBelowSma14.toFixed(1)}%`
                          : "—"}
                      </span>
                    </Tip>
                  </div>
                  {snap.headline && (
                    <p
                      className="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--muted)]"
                      title={snap.headline}
                    >
                      {snap.headline}
                    </p>
                  )}
                  {snap.error && (
                    <p className="mt-2 text-[0.7rem] font-medium text-[color-mix(in_srgb,var(--orange)_80%,var(--ink))]">
                      Price fetch hiccup — try Refresh.
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}

        <p className="font-mono-label pt-2">Shortcuts</p>
        <p className="text-[0.7rem] text-[var(--muted)]">
          One tap → fills the chat box so you can edit before sending.
        </p>
        <div className="flex flex-wrap gap-2">
          {CHAT_CHIPS.map((chip) => (
            <Tip key={chip.label} label={chip.hint} side="top">
              <button
                type="button"
                className="badge-pill"
                style={{
                  background: `color-mix(in srgb, ${chip.tint} 42%, var(--mix))`,
                }}
                onClick={() => {
                  setExternalPrompt(chip.text);
                  setMobilePanel("chat");
                  showToast({
                    kind: "info",
                    message: `“${chip.label}” ready in chat — edit or send`,
                  });
                }}
              >
                {chip.label}
              </button>
            </Tip>
          ))}
        </div>

        {activityLog.length > 0 && (
          <>
            <p className="font-mono-label pt-2">Recent</p>
            <ul className="space-y-1.5">
              {activityLog.map((item, idx) => (
                <li
                  key={`${item}-${idx}`}
                  className="rounded-[14px] bg-[color-mix(in_srgb,var(--white)_70%,transparent)] px-3 py-2 text-xs text-[var(--muted)] fade-up"
                >
                  {item}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  );

  return (
    <div className="relative min-h-full overflow-hidden bg-[var(--cream)]">
      <div
        aria-hidden
        className="blob left-[-8rem] top-[-6rem] h-72 w-72 bg-[var(--yellow)]"
      />
      <div
        aria-hidden
        className="blob right-[-6rem] top-[20%] h-64 w-64 bg-[var(--lavender)]"
      />
      <div
        aria-hidden
        className="blob bottom-[-8rem] left-[30%] h-72 w-72 bg-[var(--pink)]"
      />

      <div className="relative z-10 mx-auto flex h-[100dvh] max-w-[1600px] flex-col gap-2 overflow-hidden p-2 sm:gap-3 sm:p-3 md:gap-4 md:p-4">
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 lg:hidden">
          {(
            [
              ["list", "Agents", "Watchlist & add tickers"],
              ["chat", "Chat", "Talk to your sidekick"],
              ["activity", "Reports", "Paper book, tape & scan"],
            ] as const
          ).map(([id, label, hint]) => (
            <Tip key={id} label={hint} className="min-w-0 flex-1" as="div">
              <button
                type="button"
                onClick={() => setMobilePanel(id)}
                className={`w-full rounded-full px-2 py-2 text-xs font-bold transition sm:px-3 ${
                  mobilePanel === id
                    ? "bg-[var(--yellow)] text-[var(--ink)] shadow-[var(--shadow-soft)]"
                    : "bg-[color-mix(in_srgb,var(--white)_70%,transparent)] text-[var(--muted)] hover:bg-[var(--white)]"
                }`}
              >
                {label}
              </button>
            </Tip>
          ))}
        </div>

        {anyBusy && (
          <p className="sr-only" aria-live="polite">
            Working — please wait.
          </p>
        )}

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[240px_minmax(0,1fr)_300px] xl:grid-cols-[260px_minmax(0,1fr)_320px]">
          <div
            className={`min-h-0 overflow-hidden ${mobilePanel === "list" ? "block" : "hidden"} lg:block`}
          >
            {sidebar}
          </div>
          <div
            className={`min-h-0 min-w-0 overflow-hidden ${mobilePanel === "chat" ? "flex" : "hidden"} lg:flex`}
          >
            <DeskChat
              externalPrompt={externalPrompt}
              onExternalPromptConsumed={() => setExternalPrompt(null)}
              focusSignal={composerFocusKey}
              messagesRefreshSignal={chatRefreshKey}
              onPrompt={(text) =>
                setActivityLog((prev) =>
                  [`Chat · ${text.slice(0, 48)}`, ...prev].slice(0, 12),
                )
              }
              onBusyChange={handleChatBusy}
              onDeskMutated={(summary) => {
                rememberSidekickDeed(sidekickDeedLine(summary));
                setActivityLog((prev) =>
                  [summary, ...prev].slice(0, 12),
                );
                void syncDeskFromSidekick(
                  "Sidekick changed your desk — syncing…",
                );
              }}
            />
          </div>
          <div
            className={`min-h-0 overflow-hidden ${mobilePanel === "activity" ? "block" : "hidden"} lg:block`}
          >
            {activity}
          </div>
        </div>
      </div>

      <OnboardingModal
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
      />

      <DeskAddModal
        open={addModalOpen}
        busyWatchlist={busyAdd}
        busyTrigger={busyTrigger === "create"}
        watchlistCount={watchlistCount}
        watchlistLimit={MAX_USER_WATCHLIST}
        triggerCount={triggers.length}
        triggerLimit={triggerLimit}
        paperCash={portfolio?.cash}
        openSymbols={openSymbols}
        initialTab={addModalTab}
        onClose={() => {
          if (busyAdd || busyTrigger === "create") return;
          setAddModalOpen(false);
        }}
        onAddWatchlist={addSymbol}
        onAddTrigger={createTrigger}
      />

      <TriggerGuardrailsModal
        open={guardrailsModalOpen}
        busy={guardrailsBusy}
        error={guardrailsError}
        settings={deskSettings}
        onClose={() => {
          if (guardrailsBusy) return;
          setGuardrailsModalOpen(false);
          setGuardrailsError(null);
        }}
        onSave={saveGuardrails}
      />

      <AutoTradeEnableModal
        open={autoTradeModalOpen}
        busy={autoTradeBusy}
        error={autoTradeError}
        onCancel={() => {
          if (autoTradeBusy) return;
          setAutoTradeModalOpen(false);
          setAutoTradeError(null);
        }}
        onEnable={enableAutoTrade}
      />

      <ConfirmModal
        open={confirmDisableAuto}
        title="Turn off Auto-trade?"
        body="Attention mail still watches your board. You'll need the quiz again if you re-enable later."
        confirmLabel="Turn off"
        cancelLabel="Keep Auto on"
        tone="danger"
        busy={autoTradeBusy}
        onCancel={() => {
          if (autoTradeBusy) return;
          setConfirmDisableAuto(false);
        }}
        onConfirm={() => {
          void disableAutoTrade();
        }}
      />

      <ConfirmModal
        open={pendingRemove != null}
        title={`Remove ${pendingRemove ?? "ticker"}?`}
        body={
          <>
            This takes <strong>{pendingRemove}</strong> off your watchlist and
            stops desk scans for it (unless someone else is watching it). You
            can add it back anytime.
          </>
        }
        confirmLabel="Remove"
        cancelLabel="Keep it"
        tone="danger"
        busy={busyRemove != null}
        onCancel={() => {
          if (busyRemove) return;
          setPendingRemove(null);
        }}
        onConfirm={() => {
          if (pendingRemove) void removeSymbol(pendingRemove);
        }}
      />

      <DeskTriggerDetailModal
        open={selectedTrigger != null}
        trigger={selectedTrigger}
        busy={
          selectedTrigger != null && busyTrigger === selectedTrigger.id
        }
        paperCash={portfolio?.cash}
        openSymbols={openSymbols}
        onClose={() => {
          if (
            selectedTrigger &&
            busyTrigger === selectedTrigger.id
          ) {
            return;
          }
          setSelectedTriggerId(null);
        }}
        onToggle={(enabled) => {
          if (selectedTrigger) {
            void toggleTrigger(selectedTrigger.id, enabled);
          }
        }}
        onAutoPauseChange={(autoPauseAfterFire) => {
          if (selectedTrigger) {
            void patchTrigger(selectedTrigger.id, { autoPauseAfterFire });
          }
        }}
        onRemove={() => {
          if (selectedTrigger) {
            setSelectedTriggerId(null);
            setPendingRemoveTrigger(selectedTrigger);
          }
        }}
      />

      <ConfirmModal
        open={pendingRemoveTrigger != null}
        title={`Remove ${pendingRemoveTrigger?.symbol ?? "trigger"} rule?`}
        body={
          <>
            This deletes your{" "}
            <strong>
              {pendingRemoveTrigger
                ? `${formatTriggerCondition(pendingRemoveTrigger.condition)} · ${formatTriggerActionDetail(pendingRemoveTrigger)}`
                : "trigger"}
            </strong>{" "}
            rule for <strong>{pendingRemoveTrigger?.symbol}</strong>. Cron
            won&apos;t fire it anymore. You can arm a new one anytime.
          </>
        }
        confirmLabel="Remove"
        cancelLabel="Keep it"
        tone="danger"
        busy={
          pendingRemoveTrigger != null &&
          busyTrigger === pendingRemoveTrigger.id
        }
        onCancel={() => {
          if (
            pendingRemoveTrigger &&
            busyTrigger === pendingRemoveTrigger.id
          ) {
            return;
          }
          setPendingRemoveTrigger(null);
        }}
        onConfirm={() => {
          if (pendingRemoveTrigger) void removeTrigger(pendingRemoveTrigger.id);
        }}
      />

      <PaperBookModal
        open={paperBookOpen && portfolio != null}
        cash={portfolio?.cash ?? 0}
        equity={portfolio?.equity ?? 0}
        totalCost={portfolio?.totalCost ?? 0}
        totalMarketValue={portfolio?.totalMarketValue ?? 0}
        totalUnrealizedPnl={portfolio?.totalUnrealizedPnl ?? 0}
        totalUnrealizedPnlPct={portfolio?.totalUnrealizedPnlPct ?? 0}
        positions={portfolio?.positions ?? []}
        onClose={() => setPaperBookOpen(false)}
        onAskSell={(symbol) => {
          setPaperBookOpen(false);
          setMobilePanel("chat");
          setExternalPrompt(
            `Sell / close my open paper position in ${symbol} and return the cash to my paper book.`,
          );
          setComposerFocusKey((k) => k + 1);
        }}
      />

      <TradingViewModal
        open={chartSymbol != null}
        symbol={chartSymbol?.symbol ?? ""}
        exchange={chartSymbol?.exchange}
        onClose={() => setChartSymbol(null)}
      />

      <StatusToast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
