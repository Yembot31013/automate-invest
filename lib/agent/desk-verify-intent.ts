/** Open thread about desk log, alerts, overnight, or automation truth. */
const DESK_LOG_THREAD =
  /\b(overnight|system (?:chip|message|alert|log)|signal desk|center (?:chip|message)|those chips|what happened|auto (?:skip|pause|trade|held)|attention (?:mail|chip)|scan alert|trigger (?:fire|fired|buy|sell)|paper book|did anything trade)\b/i;

/** Direct challenge to a prior answer — wording varies; not an exhaustive list. */
const PUSHBACK_EXPLICIT =
  /\b(did you know|are you sure|you(?:'re| are) (?:wrong|lying|hallucinating|making (?:that|this) up)|that(?:'s| is) (?:not right|not true|wrong|incorrect)|double[\s-]?check|verify (?:your answer|that|against)|doesn(?:'|')t make sense|you missed|you ignored|not what i (?:meant|asked)|i meant|still waiting|didn(?:'|')t answer)\b/i;

function looksLikeShortReactivePushback(text: string): boolean {
  const t = text.trim();
  if (t.length > 80 || !/\?/.test(t)) return false;
  return /\b(you|your|that|this|still|mean|talking|wrong|sure|what|know)\b/i.test(
    t,
  );
}

/**
 * User is pushing back or the thread is still open on desk-log truth — verify with tools first.
 * Uses thread context, not fixed keywords alone.
 */
export function requiresDeskVerificationFirst(
  userText: string,
  earlierUserTexts: string[] = [],
): boolean {
  const text = userText.trim();
  if (!text) return false;

  if (PUSHBACK_EXPLICIT.test(text) || looksLikeShortReactivePushback(text)) {
    return true;
  }

  const threadStillOpen = earlierUserTexts.some((prior) =>
    DESK_LOG_THREAD.test(prior),
  );
  if (threadStillOpen && text.length <= 120) {
    return true;
  }

  return DESK_LOG_THREAD.test(text);
}
