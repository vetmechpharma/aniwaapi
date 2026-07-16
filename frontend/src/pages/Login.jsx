import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, formatError } from "@/lib/api";
import { useSiteInfo } from "@/lib/siteInfo";
import PublicNav from "@/components/PublicNav";

export default function Login() {
  const { login } = useAuth();
  const info = useSiteInfo();
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("admin123");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const u = await login(email, password);
      nav(u.role === "admin" ? "/admin" : "/");
    } catch (e2) { setErr(formatError(e2)); }
    finally { setBusy(false); }
  }

  return (
    <div className="pub pub-body min-h-screen" data-testid="login-page">
      <PublicNav brand={info.company_name}/>
      <section className="px-6 py-20">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <h1 className="mb-2">Welcome <span className="accent-serif italic">back.</span></h1>
            <p className="text-sm">Sign in to manage your workspace.</p>
          </div>
          <form onSubmit={submit} className="pub-card" data-testid="login-form">
            <div className="space-y-4">
              <div>
                <label className="pub-label">Email</label>
                <input required type="email" className="pub-input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" data-testid="login-email-input"/>
              </div>
              <div>
                <div className="flex justify-between items-baseline">
                  <label className="pub-label">Password</label>
                  <Link to="/forgot-password" className="text-xs text-zinc-500 hover:text-zinc-900" data-testid="link-forgot">Forgot?</Link>
                </div>
                <input required type="password" className="pub-input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" data-testid="login-password-input"/>
              </div>
            </div>
            {err && <div className="mt-4 p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700" data-testid="login-error">{err}</div>}
            <button disabled={busy} className="pub-btn pub-btn-primary w-full mt-6" data-testid="login-submit-button">
              {busy ? "Signing in..." : "Sign in"}
            </button>
            <div className="text-center text-xs text-zinc-500 mt-6">
              New here? <Link to="/register" className="text-zinc-900 hover:underline" data-testid="link-register">Create an account →</Link>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
