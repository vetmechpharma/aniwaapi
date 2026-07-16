import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { formatError } from "@/lib/api";
import { useSiteInfo } from "@/lib/siteInfo";
import PublicNav from "@/components/PublicNav";
import { Check, EnvelopeSimple, ShieldCheck, Lock } from "@phosphor-icons/react";

const BASE = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function ForgotPassword() {
  const info = useSiteInfo();
  const nav = useNavigate();

  const [step, setStep] = useState(1); // 1=email, 2=otp, 3=new password, 4=done
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info2, setInfo2] = useState("");

  async function requestOtp(e) {
    e?.preventDefault?.();
    setErr(""); setInfo2(""); setBusy(true);
    try {
      const { data } = await axios.post(`${BASE}/auth/forgot-password`, { email });
      if (data.smtp_enabled === false) {
        setInfo2("Note: outgoing email is not fully configured yet. Contact the admin if you don't receive the code.");
      }
      setStep(2);
    } catch (e2) { setErr(formatError(e2)); }
    finally { setBusy(false); }
  }

  async function verifyOtp(e) {
    e?.preventDefault?.();
    setErr(""); setBusy(true);
    try {
      await axios.post(`${BASE}/auth/verify-otp`, { email, otp });
      setStep(3);
    } catch (e2) { setErr(formatError(e2)); }
    finally { setBusy(false); }
  }

  async function resetPw(e) {
    e?.preventDefault?.();
    setErr("");
    if (p1 !== p2) { setErr("Passwords don't match"); return; }
    if (p1.length < 6) { setErr("Password must be at least 6 characters"); return; }
    setBusy(true);
    try {
      await axios.post(`${BASE}/auth/reset-password`, { email, otp, password: p1 });
      setStep(4);
      setTimeout(() => nav("/login"), 1800);
    } catch (e2) { setErr(formatError(e2)); }
    finally { setBusy(false); }
  }

  return (
    <div className="pub pub-body min-h-screen">
      <PublicNav brand={info.company_name}/>
      <section className="px-6 py-20">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <h1 className="mb-2">Forgot <span className="accent-serif italic">password?</span></h1>
            <p className="text-sm">We'll email you a 6-digit code to reset it.</p>
          </div>

          {step === 1 && (
            <form onSubmit={requestOtp} className="pub-card" data-testid="fp-step-email">
              <div className="flex items-center gap-3 mb-4 text-[color:var(--adm-accent,#128C7E)] text-sm">
                <EnvelopeSimple size={18} weight="bold"/> Enter your email
              </div>
              <label className="pub-label">Email</label>
              <input required type="email" className="pub-input" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="fp-email"/>
              {err && <div className="mt-4 p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">{err}</div>}
              <button disabled={busy || !email} className="pub-btn pub-btn-primary w-full mt-6" data-testid="fp-request-otp">
                {busy ? "Sending code..." : "Send reset code"}
              </button>
              <div className="text-center text-xs text-zinc-500 mt-6">
                <Link to="/login" className="text-zinc-900 hover:underline">← Back to login</Link>
              </div>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={verifyOtp} className="pub-card" data-testid="fp-step-otp">
              <div className="flex items-center gap-3 mb-4 text-[color:var(--adm-accent,#128C7E)] text-sm">
                <ShieldCheck size={18} weight="bold"/> Enter the 6-digit code
              </div>
              <p className="text-sm mb-4">Code sent to <strong>{email}</strong>. It expires in 10 minutes.</p>
              {info2 && <div className="p-3 rounded-lg border border-yellow-200 bg-yellow-50 text-xs text-yellow-800 mb-4">{info2}</div>}
              <label className="pub-label">Code</label>
              <input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} className="pub-input tracking-[10px] text-center text-2xl font-mono" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g,''))} data-testid="fp-otp" placeholder="••••••"/>
              {err && <div className="mt-4 p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">{err}</div>}
              <button disabled={busy || otp.length !== 6} className="pub-btn pub-btn-primary w-full mt-6" data-testid="fp-verify-otp">
                {busy ? "Verifying..." : "Verify code"}
              </button>
              <div className="text-center text-xs text-zinc-500 mt-4 flex justify-between">
                <button type="button" className="hover:text-zinc-900" onClick={() => setStep(1)}>← Change email</button>
                <button type="button" className="hover:text-zinc-900" onClick={requestOtp} disabled={busy}>Resend</button>
              </div>
            </form>
          )}

          {step === 3 && (
            <form onSubmit={resetPw} className="pub-card" data-testid="fp-step-newpw">
              <div className="flex items-center gap-3 mb-4 text-[color:var(--adm-accent,#128C7E)] text-sm">
                <Lock size={18} weight="bold"/> Choose a new password
              </div>
              <label className="pub-label">New password</label>
              <input required type="password" minLength={6} className="pub-input" value={p1} onChange={(e) => setP1(e.target.value)} data-testid="fp-pw1"/>
              <label className="pub-label mt-4">Confirm password</label>
              <input required type="password" minLength={6} className="pub-input" value={p2} onChange={(e) => setP2(e.target.value)} data-testid="fp-pw2"/>
              {err && <div className="mt-4 p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">{err}</div>}
              <button disabled={busy} className="pub-btn pub-btn-primary w-full mt-6" data-testid="fp-set-password">
                {busy ? "Updating..." : "Reset password"}
              </button>
            </form>
          )}

          {step === 4 && (
            <div className="pub-card text-center" data-testid="fp-done">
              <Check size={28} className="accent mx-auto mb-4"/>
              <h3 className="mb-2">Password reset.</h3>
              <p className="mb-6 text-sm">Redirecting to sign in…</p>
              <Link to="/login" className="pub-btn pub-btn-primary">Sign in now</Link>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
