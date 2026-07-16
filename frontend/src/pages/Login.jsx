import React, { useState } from "react";
import { useAuth, formatError } from "@/lib/api";
import { Terminal, LockKey } from "@phosphor-icons/react";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("admin123");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await login(email, password);
    } catch (e2) {
      setErr(formatError(e2));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 grid-bg"
      data-testid="login-page"
    >
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-3 mb-3">
            <Terminal size={36} weight="bold" color="#00E559" />
            <span className="mono text-2xl font-bold tracking-tight text-white">
              WA_API::CONSOLE
            </span>
          </div>
          <p className="mono text-xs text-zinc-500 uppercase tracking-widest">
            Unofficial WhatsApp API // Self-hosted
          </p>
        </div>

        <form
          onSubmit={submit}
          className="wa-card p-8"
          data-testid="login-form"
        >
          <div className="flex items-center gap-2 mb-6">
            <LockKey size={18} color="#00E559" />
            <span className="mono text-sm uppercase tracking-widest text-white">
              Admin Access
            </span>
          </div>

          <div className="mb-4">
            <label className="wa-label">EMAIL</label>
            <input
              className="wa-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              data-testid="login-email-input"
            />
          </div>

          <div className="mb-6">
            <label className="wa-label">PASSWORD</label>
            <input
              className="wa-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              data-testid="login-password-input"
            />
          </div>

          {err && (
            <div
              className="mono text-xs text-red-400 mb-4 p-3 border border-red-800 bg-red-950/30"
              data-testid="login-error"
            >
              ERR: {err}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="wa-btn wa-btn-primary w-full justify-center"
            data-testid="login-submit-button"
          >
            {loading ? "AUTHENTICATING..." : "> ENTER"}
          </button>

          <div className="mt-6 pt-6 border-t border-zinc-800 space-y-3">
            <div className="flex justify-between mono text-[10px] uppercase tracking-widest">
              <a href="/forgot-password" className="text-zinc-400 hover:text-[#00E559]" data-testid="link-forgot">Forgot password?</a>
              <a href="/register" className="text-[#00E559] hover:underline" data-testid="link-register">Create account →</a>
            </div>
            <div className="mono text-[10px] text-zinc-600 uppercase tracking-widest text-center">
              [ default seed: admin@example.com / admin123 ]
            </div>
            <div className="mono text-[10px] text-center">
              <a href="/pricing" className="text-zinc-400 hover:text-[#00E559]" data-testid="link-pricing">View pricing plans →</a>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
