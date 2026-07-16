import React, { useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { formatError } from "@/lib/api";
import { useSiteInfo } from "@/lib/siteInfo";
import PublicNav from "@/components/PublicNav";
import { Check } from "@phosphor-icons/react";

export default function ForgotPassword() {
  const info = useSiteInfo();
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
    <div className="pub pub-body min-h-screen">
      <PublicNav brand={info.company_name}/>
      <section className="px-6 py-20">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <h1 className="mb-2">Forgot <span className="accent-serif italic">password?</span></h1>
            <p className="text-sm">Enter your email — admin will share a reset link with you.</p>
          </div>
          {ok ? (
            <div className="pub-card text-center" data-testid="forgot-success">
              <Check size={26} className="accent mx-auto mb-4"/>
              <h3 className="mb-3">Request received.</h3>
              <p className="mb-6">If this email is registered, our admin will get in touch shortly.</p>
              <Link to="/login" className="pub-btn pub-btn-primary">Back to login</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="pub-card" data-testid="forgot-form">
              <label className="pub-label">Email</label>
              <input required type="email" className="pub-input" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="forgot-email"/>
              {err && <div className="mt-4 p-3 rounded-lg border border-red-900 bg-red-950/30 text-sm text-red-300">{err}</div>}
              <button disabled={busy} className="pub-btn pub-btn-primary w-full mt-6" data-testid="forgot-submit">
                {busy ? "Sending..." : "Request reset"}
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
