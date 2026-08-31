/** Minimal shape needed to pick lots to close (compatible with PaperPosition). */
export type SellableLot = {
  id: string;
  symbol: string;
};

function symbolKey(symbol: string): string {
  return symbol.trim().toUpperCase().replaceAll("/", "").replaceAll("-", "");
}

/** Pick open positions to close — sellAll wins; else match symbols (slash-insensitive). */
export function selectOpenPositionsToSell<T extends SellableLot>(
  open: T[],
  opts: { sellAll?: boolean; symbols?: string[] },
): T[] {
  if (opts.sellAll) {
    return [...open];
  }
  const wants = (opts.symbols ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .map(symbolKey);
  if (wants.length === 0) {
    return [];
  }
  const wantSet = new Set(wants);
  // One open lot per matched symbol (newest first), same as single paperSell.
  const matched: T[] = [];
  const used = new Set<string>();
  for (const position of [...open].reverse()) {
    const key = symbolKey(position.symbol);
    if (!wantSet.has(key) || used.has(key)) continue;
    used.add(key);
    matched.push(position);
  }
  return matched.reverse();
}
