import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Check your email — Alpha",
};

export default function VerifyRequestPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Alpha</h1>
        <div className="rounded-lg border bg-card p-8 space-y-3">
          <div className="text-4xl">📬</div>
          <h2 className="text-xl font-semibold">Check your email</h2>
          <p className="text-sm text-muted-foreground">
            A sign-in link has been sent to your email address.
          </p>
          <p className="text-xs text-muted-foreground">
            The link expires in 24 hours. You can close this tab.
          </p>
        </div>
        <a href="/auth/signin" className="text-sm text-primary underline underline-offset-4">
          Back to sign in
        </a>
      </div>
    </div>
  );
}
