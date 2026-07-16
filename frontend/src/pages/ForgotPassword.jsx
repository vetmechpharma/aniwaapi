import React, { useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { formatError } from "@/lib/api";
import { Terminal, Question } from "@phosphor-icons/react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      await axios.post(`${process.env.REACT_APP_BACKEND_URL}/api/auth/forgot-password`, { email });
      setOk(true);
    } catch (e2) { setErr(formatError(e2)); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 grid-bg">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <Terminal size={32} weight="bold" color="#00E559" className="mx-auto mb-2"/>
          <p className="mono text-xs text-zinc-500 uppercase tracking-widest">Password recovery</p>
        </div>
        {!ok ? (
          <form onSubmit={submit} className="wa-card p-8" data-testid="forgot-form">
            <div className="flex items-center gap-2 mb-6"><Question size={18} color="#00E559"/>
              <span className="mono text-sm uppercase tracking-widest text-white">Forgot Password</span>
            </div>
            <p className="mono text-[11px] text-zinc-500 mb-4">
              Submit your email — an admin will review your request and share a reset link with you directly.
            </p>
            <label className="wa-label">EMAIL</label>
            <input required type="email" className="wa-input" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="forgot-email"/>
            {err && <div className="mono text-xs text-red-400 mt-4">ERR: {err}</div>}
            <button disabled={busy} className="wa-btn wa-btn-primary w-full justify-center mt-6" data-testid="forgot-submit">
              {busy ? "SUBMITTING..." : "> REQUEST RESET"}
            </button>
            <div className="text-center mt-4 mono text-[11px] text-zinc-500">
              <Link to="/login" className="text-[#00E559] underline">← BACK TO LOGIN</Link>
            </div>
          </form>
        ) : (
          <div className="wa-card p-8 text-center" data-testid="forgot-success">
            <div className="mono text-lg text-[#00E559] mb-3">REQUEST RECEIVED</div>
            <p className="text-zinc-400 mb-6 text-sm">If this email is registered, the admin will send you a reset link shortly.</p>
            <Link to="/login" className="wa-btn wa-btn-primary">← BACK TO LOGIN</Link>
          </div>
        )}
      </div>
    </div>
  );
}
