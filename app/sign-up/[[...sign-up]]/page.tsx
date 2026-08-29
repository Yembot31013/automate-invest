import { SignUp } from "@clerk/nextjs";

import { ThemeToggle } from "@/components/theme/ThemeToggle";

export default function SignUpPage() {
  return (
    <main className="relative flex min-h-full flex-1 items-center justify-center overflow-hidden bg-[var(--cream)] px-4 py-16">
      <div className="absolute right-4 top-4 z-20 md:right-8 md:top-6">
        <ThemeToggle />
      </div>
      <div
        aria-hidden
        className="blob left-[-4rem] top-[-3rem] h-56 w-56 bg-[var(--pink)]"
      />
      <div
        aria-hidden
        className="blob bottom-[-4rem] right-[-3rem] h-64 w-64 bg-[var(--lavender)]"
      />
      <div className="relative z-10">
        <SignUp
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
          forceRedirectUrl="/desk"
        />
      </div>
    </main>
  );
}
