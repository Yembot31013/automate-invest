/** Per chat-request dedupe — parallel duplicate tool calls share one execution. */
export function createToolDedupeCache() {
  const inflight = new Map<string, Promise<unknown>>();

  return function dedupeTool<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = inflight.get(key);
    if (hit) return hit as Promise<T>;
    const promise = fn();
    inflight.set(key, promise);
    return promise;
  };
}
