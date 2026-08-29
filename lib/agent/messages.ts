import type { UIMessage } from "ai";

/** Guarantee unique ids for persisted/streamed UI messages (legacy rows may be empty). */
export function withUniqueMessageIds(messages: UIMessage[]): UIMessage[] {
  const seen = new Set<string>();

  return messages.map((message, index) => {
    let id = typeof message.id === "string" ? message.id.trim() : "";
    if (!id || seen.has(id)) {
      id = `msg-${index}-${message.role || "unknown"}`;
      let suffix = 0;
      while (seen.has(id)) {
        suffix += 1;
        id = `msg-${index}-${message.role || "unknown"}-${suffix}`;
      }
    }
    seen.add(id);
    return id === message.id ? message : { ...message, id };
  });
}
