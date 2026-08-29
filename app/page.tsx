import Link from "next/link";
import { Show, UserButton } from "@clerk/nextjs";

export default function HomePage() {
  return (
    <div className="relative flex min-h-full flex-1 flex-col overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 20% 10%, rgba(78,159,61,0.22), transparent 55%), radial-gradient(ellipse 70% 50% at 90% 80%, rgba(224,86,86,0.12), transparent 50%), linear-gradient(180deg, #0f1412 0%, #121a16 100%)",
        }}
      />
      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <p className="font-display text-2xl tracking-tight text-[var(--desk-text)]">
          Signal Desk
        </p>
        <div className="flex items-center gap-3">
          <Show when="signed-out">
            <Link
              href="/sign-in"
              className="rounded-md px-3 py-2 text-sm text-[var(--desk-muted)] transition hover:text-[var(--desk-text)]"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="rounded-md bg-[var(--desk-accent)] px-3 py-2 text-sm font-medium text-[#0b120e] transition hover:brightness-110"
            >
              Join the desk
            </Link>
          </Show>
          <Show when="signed-in">
            <Link
              href="/desk"
              className="rounded-md bg-[var(--desk-accent)] px-3 py-2 text-sm font-medium text-[#0b120e] transition hover:brightness-110"
            >
              Open desk
            </Link>
            <UserButton />
          </Show>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col justify-center px-6 pb-24 pt-10 md:px-10">
        <p className="mb-4 text-sm uppercase tracking-[0.22em] text-[var(--desk-accent)]">
          Tape moves. Catalysts. No noise.
        </p>
        <h1 className="font-display max-w-3xl text-5xl leading-[1.05] tracking-tight text-[var(--desk-text)] md:text-7xl">
          Signal Desk
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--desk-muted)]">
          Your market sidekick watches dips and breakouts, cracks a joke when
          the tape freaks out, and keeps paper PnL honest — so you can react
          fast without digging through charts alone.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Show when="signed-out">
            <Link
              href="/sign-up"
              className="rounded-md bg-[var(--desk-accent)] px-5 py-3 text-sm font-semibold text-[#0b120e] transition hover:brightness-110"
            >
              Start chatting
            </Link>
            <Link
              href="/sign-in"
              className="rounded-md border border-[var(--desk-border)] bg-[var(--desk-surface)] px-5 py-3 text-sm text-[var(--desk-text)] transition hover:bg-[var(--desk-elevated)]"
            >
              I already have a seat
            </Link>
          </Show>
          <Show when="signed-in">
            <Link
              href="/desk"
              className="rounded-md bg-[var(--desk-accent)] px-5 py-3 text-sm font-semibold text-[#0b120e] transition hover:brightness-110"
            >
              Enter the desk
            </Link>
          </Show>
        </div>
      </main>
    </div>
  );
}
