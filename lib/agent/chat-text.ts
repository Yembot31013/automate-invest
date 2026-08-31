import type { UIMessage } from "ai";

/** Concatenate text parts from a UI message (ignores tool/image parts). */
export function textFromUIMessage(message: UIMessage | undefined): string {
  if (!message?.parts?.length) return "";
  return message.parts
    .filter(
      (part): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      return textFromUIMessage(messages[i]);
    }
  }
  return "";
}
