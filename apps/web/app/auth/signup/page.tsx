import { SignUpForm } from "@/components/auth/sign-up-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign Up — Alpha",
};

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Alpha</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Create your account
          </p>
        </div>
        <SignUpForm />
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <a href="/auth/signin" className="text-primary underline underline-offset-4">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
