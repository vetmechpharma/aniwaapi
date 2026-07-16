import React, { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { formatError } from "@/lib/api";
import { Terminal, Key } from "@phosphor-icons/react";

export default function ResetPassword() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [token, setToken] = useState(sp.get("token") || "");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (pw !== pw2) { setErr("Passwords do not match"); return; }
    if (pw.length < 6) { setErr("Password must be at least 6 characters"); return; }
    setErr(""); setBusy(true);
    try {
      await axios.post(`${process.env.REACT_APP_BACKEND_URL}/api/auth/reset-password`, { token, password: pw });
      setOk(true);
      setTimeout(() => nav("/login"), 1800);
    } catch (e2) { setErr(formatError(e2)); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 grid-bg">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <Terminal size={32} weight="bold" color="#00E559" className="mx-auto mb-2"/>
        </div>
        {!ok ? (
          <form onSubmit={submit} className="wa-card p-8" data-testid="reset-form">
            <div className="flex items-center gap-2 mb-6"><Key size={18} color="#00E559"/>
              <span className="mono text-sm uppercase tracking-widest text-white">Reset Password</span>
            </div>
            <label className="wa-label">RESET TOKEN</label>
            <input required className="wa-input mono text-xs" value={token} onChange={(e) => setToken(e.target.value)} data-testid="reset-token"/>
            <div className="mt-4"><label className="wa-label">NEW PASSWORD</label>
              <input required type="password" minLength={6} className="wa-input" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="reset-pw"/></div>
            <div className="mt-4"><label className="wa-label">CONFIRM PASSWORD</label>
              <input required type="password" minLength={6} className="wa-input" value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="reset-pw2"/></div>
            {err && <div className="mono text-xs text-red-400 mt-4">ERR: {err}</div>}
            <button disabled={busy} className="wa-btn wa-btn-primary w-full justify-center mt-6" data-testid="reset-submit">
              {busy ? "RESETTING..." : "> RESET PASSWORD"}
            </button>
            <div className="text-center mt-4 mono text-[11px] text-zinc-500">
              <Link to="/login" className="text-[#00E559] underline">← LOGIN</Link>
            </div>
          </form>
        ) : (
          <div className="wa-card p-8 text-center" data-testid="reset-success">
            <div className="mono text-lg text-[#00E559] mb-3">PASSWORD RESET</div>
            <p className="text-zinc-400 text-sm">Redirecting to login...</p>
          </div>
        )}
      </div>
    </div>
  );
}
