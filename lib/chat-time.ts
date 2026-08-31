/** Shared friendly timestamps for desk chat bubbles + system chips. */

export function messageCreatedAt(message: {
  metadata?: unknown;
}): string | null {
  const meta = message.metadata;
  if (!meta || typeof meta !== "object") return null;
  const createdAt = (meta as { createdAt?: unknown }).createdAt;
  return typeof createdAt === "string" && createdAt.trim()
    ? createdAt
    : null;
}

function clockLabel(date: Date): string {
  const hour24 = date.getHours();
  const minutes = date.getMinutes();
  const hour12 = hour24 % 12 || 12;
  const suffix = hour24 < 12 ? "am" : "pm";
  if (minutes === 0) return `${hour12}${suffix}`;
  return `${hour12}:${String(minutes).padStart(2, "0")}${suffix}`;
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Human chat time: now → minutes/hours ago → yesterday 11pm → 3 days ago 11pm → Aug 12 · 11pm.
 */
export function formatChatTime(iso: string, nowMs: number = Date.now()): string {
  const then = new Date(iso);
  const thenMs = then.getTime();
  if (Number.isNaN(thenMs)) return "";

  const diffMs = Math.max(0, nowMs - thenMs);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return "now";

  const min = Math.floor(sec / 60);
  if (min < 60) {
    return min === 1 ? "1 minute ago" : `${min} minutes ago`;
  }

  const hour = Math.floor(min / 60);
  if (hour < 24 && startOfLocalDay(nowMs) === startOfLocalDay(thenMs)) {
    return hour === 1 ? "1 hour ago" : `${hour} hours ago`;
  }

  const dayDiff = Math.round(
    (startOfLocalDay(nowMs) - startOfLocalDay(thenMs)) / 86_400_000,
  );
  const clock = clockLabel(then);

  if (dayDiff === 1) return `Yesterday ${clock}`;
  if (dayDiff > 1 && dayDiff < 7) return `${dayDiff} days ago ${clock}`;

  const sameYear = then.getFullYear() === new Date(nowMs).getFullYear();
  const datePart = then.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${datePart} · ${clock}`;
}
