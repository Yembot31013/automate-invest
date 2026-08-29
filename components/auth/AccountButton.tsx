"use client";

import { useEffect, useState } from "react";
import { UserButton, useClerk } from "@clerk/nextjs";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import {
  applyTheme,
  readTheme,
  toggleTheme,
  type ThemeMode,
} from "@/components/theme/theme";

function SignOutIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className="size-4"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className="size-4"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className="size-4"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.752 15.002A9.72 9.72 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"
      />
    </svg>
  );
}

/**
 * Clerk avatar menu: Manage account, theme toggle, confirmed Sign out.
 */
export function AccountButton() {
  const { signOut } = useClerk();
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const next = readTheme();
    applyTheme(next);
    setTheme(next);
  }, []);

  async function confirmSignOut() {
    setBusy(true);
    try {
      await signOut({ redirectUrl: "/" });
    } catch {
      setBusy(false);
      setSignOutOpen(false);
    }
  }

  const themeLabel = theme === "dark" ? "Light mode" : "Dark mode";

  return (
    <>
      <UserButton
        appearance={{
          elements: {
            userButtonPopoverActionButton__signOut: {
              display: "none",
            },
          },
        }}
      >
        <UserButton.MenuItems>
          <UserButton.Action label="manageAccount" />
          <UserButton.Action
            label={themeLabel}
            labelIcon={theme === "dark" ? <SunIcon /> : <MoonIcon />}
            onClick={() => setTheme((prev) => toggleTheme(prev))}
          />
          <UserButton.Action
            label="Sign out"
            labelIcon={<SignOutIcon />}
            onClick={() => setSignOutOpen(true)}
          />
        </UserButton.MenuItems>
      </UserButton>

      <ConfirmModal
        open={signOutOpen}
        title="Sign out?"
        body="You'll leave the desk and need to sign in again to chat, scan, or manage your watchlist."
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        tone="danger"
        busy={busy}
        onCancel={() => {
          if (busy) return;
          setSignOutOpen(false);
        }}
        onConfirm={() => void confirmSignOut()}
      />
    </>
  );
}
