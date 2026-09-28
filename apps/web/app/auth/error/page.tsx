import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Auth Error — Alpha",
};

interface ErrorPageProps {
  searchParams: Promise<{ error?: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  Configuration: "There is a problem with the server configuration.",
  AccessDenied: "Access denied. You do not have permission.",
  Verification: "The verification link may be expired or already used.",
  Default: "An unexpected error occurred during authentication.",
};

export default async function AuthErrorPage({ searchParams }: ErrorPageProps) {
  const params = await searchParams;
  const message = ERROR_MESSAGES[params.error ?? "Default"] ?? ERROR_MESSAGES["Default"];

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Alpha</h1>
        <div className="rounded-lg border border-destructive/30 bg-card p-8 space-y-3">
          <div className="text-4xl">⚠️</div>
          <h2 className="text-xl font-semibold">Authentication Error</h2>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
        <a href="/auth/signin" className="text-sm text-primary underline underline-offset-4">
          Back to sign in
        </a>
      </div>
    </div>
  );
}
