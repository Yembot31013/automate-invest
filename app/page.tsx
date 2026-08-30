import Image from "next/image";
import Link from "next/link";
import { Show } from "@clerk/nextjs";

import { AccountButton } from "@/components/auth/AccountButton";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

export default function HomePage() {
  return (
    <div className="relative flex min-h-full flex-1 flex-col overflow-x-hidden bg-[var(--cream)]">
      <div
        aria-hidden
        className="blob left-[-6rem] top-[-4rem] h-72 w-72 bg-[var(--yellow)]"
      />
      <div
        aria-hidden
        className="blob bottom-[-5rem] right-[-4rem] h-80 w-80 bg-[var(--pink)]"
      />
      <div
        aria-hidden
        className="blob right-[18%] top-[32%] h-56 w-56 bg-[var(--blue)] opacity-35"
      />

      <header className="relative z-10 flex items-center justify-between gap-2 px-4 py-4 sm:px-6 sm:py-5 md:px-10">
        <p className="shrink-0 text-xl font-extrabold tracking-tight text-[var(--ink)] sm:text-2xl">
          Signal Desk
        </p>
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
          <Show when="signed-out">
            <ThemeToggle className="theme-toggle-compact" />
            <Link
              href="/sign-in"
              className="btn-ghost !px-2.5 !py-1.5 text-xs sm:!px-3.5 sm:!py-2 sm:text-sm"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="btn-primary !px-2.5 !py-1.5 text-xs sm:!px-3.5 sm:!py-2 sm:text-sm"
            >
              <span className="sm:hidden">Join</span>
              <span className="hidden sm:inline">Join the desk</span>
            </Link>
          </Show>
          <Show when="signed-in">
            <Link
              href="/desk"
              className="btn-primary !px-2.5 !py-1.5 text-xs sm:!px-3.5 sm:!py-2 sm:text-sm"
            >
              Open desk
            </Link>
            <AccountButton />
          </Show>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-8 px-4 pb-12 pt-2 sm:gap-10 sm:px-6 sm:pb-16 sm:pt-6 md:grid-cols-2 md:gap-8 md:px-10 md:pb-20 md:pt-4">
        <div className="flex flex-col justify-center">
          <span className="badge-pill mb-4 w-fit bg-[color-mix(in_srgb,var(--lavender)_55%,var(--mix))] text-[var(--ink)] fade-up sm:mb-5">
            Tape · catalysts · jokes
          </span>
          <h1 className="max-w-xl text-4xl font-extrabold leading-[1.05] tracking-tight text-[var(--ink)] fade-up sm:text-5xl md:text-6xl lg:text-7xl">
            Your market sidekick
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-[var(--muted)] fade-up sm:mt-5 sm:text-lg">
            Watches dips and breakouts, cracks a joke when the tape freaks out,
            and keeps paper PnL honest — so you can react fast without digging
            through charts alone.
          </p>
          <div className="mt-7 flex flex-col gap-3 fade-up sm:mt-9 sm:flex-row sm:flex-wrap">
            <Show when="signed-out">
              <Link href="/sign-up" className="btn-primary w-full sm:w-auto">
                Start chatting
              </Link>
              <Link href="/sign-in" className="btn-ghost w-full sm:w-auto">
                I already have a seat
              </Link>
            </Show>
            <Show when="signed-in">
              <Link href="/desk" className="btn-primary w-full sm:w-auto">
                Enter the desk
              </Link>
            </Show>
          </div>
        </div>

        <div
          className="hero-art relative mx-auto w-full max-w-sm fade-up sm:max-w-md md:max-w-none md:justify-self-end"
          aria-hidden
        >
          <Image
            src="/hero.png"
            alt=""
            width={1024}
            height={1024}
            priority
            className="h-auto w-full select-none object-contain drop-shadow-[0_24px_48px_rgba(46,46,46,0.12)]"
          />
        </div>
      </main>
    </div>
  );
}
