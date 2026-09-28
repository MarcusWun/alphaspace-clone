"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const HAS_GITHUB = process.env["NEXT_PUBLIC_HAS_GITHUB"] === "true";
const HAS_GOOGLE = process.env["NEXT_PUBLIC_HAS_GOOGLE"] === "true";

interface SignInFormProps {
  callbackUrl?: string;
  error?: string;
}

export function SignInForm({ callbackUrl = "/dashboard", error }: SignInFormProps) {
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(
    error === "CredentialsSignin" ? "Invalid email or password." : error ?? null
  );

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setFormError(null);
    const result = await signIn("credentials", {
      email,
      password,
      callbackUrl,
      redirect: false,
    });
    setLoading(false);
    if (result?.error) {
      setFormError("Invalid email or password.");
    } else if (result?.url) {
      window.location.href = result.url;
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setFormError(null);
    await signIn("nodemailer", { email, callbackUrl, redirect: true });
    setLoading(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          {mode === "password"
            ? "Enter your email and password"
            : "We'll send a magic link to your email"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {formError && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">
            {formError}
          </div>
        )}

        <form
          onSubmit={mode === "password" ? handleCredentials : handleMagicLink}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          {mode === "password" && (
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading
              ? "Signing in…"
              : mode === "password"
              ? "Sign in"
              : "Send magic link"}
          </Button>
        </form>

        <div className="flex items-center justify-center">
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-4"
            onClick={() => {
              setMode(mode === "password" ? "magic" : "password");
              setFormError(null);
            }}
          >
            {mode === "password"
              ? "Sign in with a magic link instead"
              : "Sign in with password instead"}
          </button>
        </div>

        {(HAS_GITHUB || HAS_GOOGLE) && (
          <>
            <div className="relative">
              <Separator />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                or
              </span>
            </div>
            <div className="space-y-2">
              {HAS_GITHUB && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => signIn("github", { callbackUrl })}
                >
                  Continue with GitHub
                </Button>
              )}
              {HAS_GOOGLE && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => signIn("google", { callbackUrl })}
                >
                  Continue with Google
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
