import { MAX_USER_WATCHLIST } from "@/lib/limits";

/** localStorage flag — once dismissed, first-visit tour stays off. */
export const ONBOARDING_STORAGE_KEY = "signal-desk:onboarding:v1";

export const DISCORD_INVITE_URL =
  process.env.NEXT_PUBLIC_DISCORD_INVITE_URL?.trim() ||
  "https://discord.gg/MvUUvnTsN";

export type OnboardingStep = {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  imageSrc: string;
  imageAlt: string;
};

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    eyebrow: "Welcome",
    title: "Meet Signal Desk",
    body: "Your market sidekick — dips, headlines, and paper practice in one calm seat. Not financial advice; just a faster way to watch the tape.",
    imageSrc: "/onboard-welcome.png",
    imageAlt: "Soft 3D desk scene welcoming you to Signal Desk",
  },
  {
    id: "chat",
    eyebrow: "Sidekick",
    title: "Chat is the controls",
    body: "Ask in plain English — monitor tickers, check headlines, paper buy or sell. Soft “desk deeds” show the work without looking like raw tools.",
    imageSrc: "/onboard-chat.png",
    imageAlt: "Chat bubbles floating over a yellow desk",
  },
  {
    id: "watchlist",
    eyebrow: "Board",
    title: "Watchlist + paper book",
    body: `Pin up to ${MAX_USER_WATCHLIST} symbols. Paper cash starts at $100k (fake money); prices and marks are real. Tap Open to see what you own.`,
    imageSrc: "/onboard-watchlist.png",
    imageAlt: "Tape cards and charts floating above a desk",
  },
  {
    id: "discord",
    eyebrow: "Crew",
    title: "Come hang with testers",
    body: "Bugs, ideas, and tape talk live on Discord. Drop in anytime — early feedback shapes what we build next.",
    imageSrc: "/onboard-discord.png",
    imageAlt: "Friendly clay figures and chat bubbles for community",
  },
];

export function hasCompletedOnboarding(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markOnboardingComplete(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
  } catch {
    // ignore quota / private mode
  }
}
