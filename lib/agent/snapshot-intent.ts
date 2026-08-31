const SNAPSHOT_INTENT =
  /\b(update|updates|headline|headlines|news|snapshot|tape|check(?:ing)?\s+out|look(?:ing)?\s+at|pull(?:ing)?\s+up|what(?:'s|\s+is|\s+are)\s+.+\s+doing|how(?:'s|\s+is|\s+are)\s+.+\s+doing|how\s+.+\s+moving|give\s+me\s+an?\s+update|what\s+happened\s+(?:to|with))\b/i;

const OTHER_TOOL_INTENT =
  /\b(monitor|watch(?:list)?|track|pin(?:ned)?|unmonitor|remove\s+from|stop\s+watching|paper\s+buy|paper\s+sell|\bbuy\b|\bsell\b|close\s+(?:my|the)\s+(?:position|paper)|recommend|portfolio|p\s*&\s*l|pnl|what[\s-]?if|list\s+watchlist|what\s+are\s+you\s+watching|naira|ngn|dollar\s+rate|fx\s+rate|convert)\b/i;

/**
 * True when the latest user turn is asking for tape/headlines and must start with getSnapshot.
 * Excludes monitor/buy/sell/recommend/portfolio/what-if/FX intents.
 */
export function requiresSnapshotFirst(userText: string): boolean {
  const text = userText.trim();
  if (!text) return false;
  if (OTHER_TOOL_INTENT.test(text)) return false;
  return SNAPSHOT_INTENT.test(text);
}
