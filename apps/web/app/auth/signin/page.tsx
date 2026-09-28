import { SignInForm } from "@/components/auth/sign-in-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In — Alpha",
};

interface SignInPageProps {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Alpha</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Investment Research Workspace
          </p>
        </div>
        <SignInForm callbackUrl={params.callbackUrl} error={params.error} />
        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <a href="/auth/signup" className="text-primary underline underline-offset-4">
            Sign up
          </a>
        </p>
      </div>
    </div>
  );
}
