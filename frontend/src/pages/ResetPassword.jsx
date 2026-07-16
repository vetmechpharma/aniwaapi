import React, { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { formatError } from "@/lib/api";
import { useSiteInfo } from "@/lib/siteInfo";
import PublicNav from "@/components/PublicNav";
import { Check } from "@phosphor-icons/react";

export default function ResetPassword() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const info = useSiteInfo();
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
    <div className="pub pub-body min-h-screen">
      <PublicNav brand={info.company_name}/>
      <section className="px-6 py-20">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <h1 className="mb-2">Reset <span className="accent-serif italic">password.</span></h1>
          </div>
          {ok ? (
            <div className="pub-card text-center" data-testid="reset-success">
              <Check size={26} className="accent mx-auto mb-4"/>
              <h3 className="mb-3">All set.</h3>
              <p>Redirecting to login…</p>
            </div>
          ) : (
            <form onSubmit={submit} className="pub-card" data-testid="reset-form">
              <label className="pub-label">Reset token</label>
              <input required className="pub-input font-mono text-xs" value={token} onChange={(e) => setToken(e.target.value)} data-testid="reset-token"/>
              <div className="mt-4"><label className="pub-label">New password</label>
                <input required type="password" minLength={6} className="pub-input" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="reset-pw"/></div>
              <div className="mt-4"><label className="pub-label">Confirm password</label>
                <input required type="password" minLength={6} className="pub-input" value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="reset-pw2"/></div>
              {err && <div className="mt-4 p-3 rounded-lg border border-red-900 bg-red-950/30 text-sm text-red-300">{err}</div>}
              <button disabled={busy} className="pub-btn pub-btn-primary w-full mt-6" data-testid="reset-submit">
                {busy ? "Resetting..." : "Reset password"}
              </button>
              <div className="text-center text-xs text-zinc-500 mt-6">
                <Link to="/login" className="text-white hover:underline">← Back to login</Link>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
