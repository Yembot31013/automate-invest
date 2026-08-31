import { clerkClient } from "@clerk/nextjs/server";

import { logger } from "@/lib/logger";

/** Resolve the user's primary email for Attention mail. */
export async function getClerkUserEmail(
  userId: string,
): Promise<string | null> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const primaryId = user.primaryEmailAddressId;
    const primary = user.emailAddresses.find((e) => e.id === primaryId);
    const email =
      primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
    return email?.trim() || null;
  } catch (error) {
    logger.error("clerk", "email lookup failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
