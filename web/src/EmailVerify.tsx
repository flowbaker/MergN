import { useEffect, useState } from "react";
import { authClient, signOut } from "./auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Shown (full-screen) when the signed-in user hasn't verified their email yet
// and the deployment requires it. A 6-digit code was emailed at sign-up; the
// user enters it here. On success we reload so the fresh (verified) session
// flows through and the app renders normally.
export function EmailVerify({ email }: { email: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.emailOtp.verifyEmail({ email, otp: code });
      if (res.error) {
        setError(res.error.message || "Invalid or expired code.");
        return;
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0) return;
    setError(null);
    setCooldown(60);
    try {
      await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "email-verification",
      });
    } catch {
      setError("Couldn't resend the code. Try again in a moment.");
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border/50 bg-card p-6">
        <h1 className="text-xl font-semibold">Verify your email</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a 6-digit code to <span className="text-foreground">{email}</span>.
          Enter it below to finish signing up.
        </p>

        <form onSubmit={verify} className="mt-5 flex flex-col gap-3">
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            className="h-12 rounded-xl text-center font-mono text-2xl tracking-[0.4em]"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            className="h-11 w-full rounded-xl"
            disabled={busy || code.length !== 6}
          >
            {busy ? "Verifying…" : "Verify"}
          </Button>
        </form>

        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={resend}
            disabled={cooldown > 0}
            className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
