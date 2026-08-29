import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-[var(--desk-bg)] px-4 py-16">
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        forceRedirectUrl="/desk"
      />
    </main>
  );
}
