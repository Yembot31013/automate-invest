import Image from "next/image";
import Link from "next/link";
import { Show } from "@clerk/nextjs";

import { AccountButton } from "@/components/auth/AccountButton";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

export default function HomePage() {
  return (
    <div className="relative flex min-h-full flex-1 flex-col overflow-hidden bg-[var(--cream)]">
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

      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <p className="text-2xl font-extrabold tracking-tight text-[var(--ink)]">
          Signal Desk
        </p>
        <div className="flex items-center gap-3">
          <Show when="signed-out">
            <ThemeToggle />
            <Link href="/sign-in" className="btn-ghost text-sm">
              Sign in
            </Link>
            <Link href="/sign-up" className="btn-primary text-sm">
              Join the desk
            </Link>
          </Show>
          <Show when="signed-in">
            <Link href="/desk" className="btn-primary text-sm">
              Open desk
            </Link>
            <AccountButton />
          </Show>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-6 pb-16 pt-6 md:grid-cols-2 md:gap-8 md:px-10 md:pb-20 md:pt-4">
        <div className="flex flex-col justify-center">
          <span className="badge-pill mb-5 w-fit bg-[color-mix(in_srgb,var(--lavender)_55%,var(--mix))] text-[var(--ink)] fade-up">
            Tape · catalysts · jokes
          </span>
          <h1 className="max-w-xl text-5xl font-extrabold leading-[1.02] tracking-tight text-[var(--ink)] fade-up md:text-6xl lg:text-7xl">
            Signal Desk
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-[var(--muted)] fade-up">
            Your market sidekick watches dips and breakouts, cracks a joke when
            the tape freaks out, and keeps paper PnL honest — so you can react
            fast without digging through charts alone.
          </p>
          <div className="mt-9 flex flex-wrap gap-3 fade-up">
            <Show when="signed-out">
              <Link href="/sign-up" className="btn-primary">
                Start chatting
              </Link>
              <Link href="/sign-in" className="btn-ghost">
                I already have a seat
              </Link>
            </Show>
            <Show when="signed-in">
              <Link href="/desk" className="btn-primary">
                Enter the desk
              </Link>
            </Show>
          </div>
        </div>

        <div
          className="hero-art relative mx-auto w-full max-w-md fade-up md:max-w-none md:justify-self-end"
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
