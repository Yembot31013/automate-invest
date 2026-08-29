import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-[var(--desk-bg)] px-4 py-16">
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        forceRedirectUrl="/desk"
      />
    </main>
  );
}
