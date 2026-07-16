import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import axios from "axios";
import { api, formatError } from "@/lib/api";
import { Terminal, UserPlus } from "@phosphor-icons/react";

export default function Register() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    email: "", password: "", name: "", company: "",
    phone: "", alt_phone: "", location: "",
  });
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      // Use axios without auth cookie (registration is public)
      await axios.post(`${process.env.REACT_APP_BACKEND_URL}/api/auth/register`, form);
      setOk(true);
    } catch (e2) { setErr(formatError(e2)); }
    finally { setBusy(false); }
  }

  if (ok) return (
    <div className="min-h-screen flex items-center justify-center px-4 grid-bg">
      <div className="wa-card p-8 max-w-lg w-full text-center" data-testid="register-success">
        <Terminal size={40} weight="bold" color="#00E559" className="mx-auto mb-4"/>
        <h1 className="mono text-2xl font-bold text-white mb-4">REGISTRATION SUBMITTED</h1>
        <p className="text-zinc-400 mb-6">Your account is <span className="text-[#00E559]">pending admin approval</span>. Once approved you'll be able to sign in and choose a subscription plan.</p>
        <Link to="/login" className="wa-btn wa-btn-primary">← BACK TO LOGIN</Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 grid-bg">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-3 mb-2">
            <Terminal size={32} weight="bold" color="#00E559"/>
            <span className="mono text-xl font-bold text-white">WA_API::REGISTER</span>
          </div>
          <p className="mono text-xs text-zinc-500 uppercase tracking-widest">Create a subscriber account</p>
        </div>
        <form onSubmit={submit} className="wa-card p-8" data-testid="register-form">
          <div className="flex items-center gap-2 mb-6"><UserPlus size={18} color="#00E559"/>
            <span className="mono text-sm uppercase tracking-widest text-white">New Subscriber</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="wa-label">FULL NAME *</label>
              <input required className="wa-input" value={form.name} onChange={set("name")} data-testid="reg-name"/></div>
            <div><label className="wa-label">COMPANY</label>
              <input className="wa-input" value={form.company} onChange={set("company")} data-testid="reg-company"/></div>
            <div><label className="wa-label">EMAIL *</label>
              <input required type="email" className="wa-input" value={form.email} onChange={set("email")} data-testid="reg-email"/></div>
            <div><label className="wa-label">PASSWORD * (min 6 chars)</label>
              <input required type="password" minLength={6} className="wa-input" value={form.password} onChange={set("password")} data-testid="reg-password"/></div>
            <div><label className="wa-label">PHONE *</label>
              <input required className="wa-input" value={form.phone} onChange={set("phone")} data-testid="reg-phone"/></div>
            <div><label className="wa-label">ALTERNATE PHONE</label>
              <input className="wa-input" value={form.alt_phone} onChange={set("alt_phone")} data-testid="reg-alt-phone"/></div>
            <div className="md:col-span-2"><label className="wa-label">LOCATION (city, country)</label>
              <input className="wa-input" value={form.location} onChange={set("location")} placeholder="Chennai, India" data-testid="reg-location"/></div>
          </div>
          {err && <div className="mono text-xs text-red-400 mt-4 p-3 border border-red-800 bg-red-950/30" data-testid="reg-error">ERR: {err}</div>}
          <button disabled={busy} className="wa-btn wa-btn-primary w-full justify-center mt-6" data-testid="reg-submit">
            {busy ? "SUBMITTING..." : "> CREATE ACCOUNT"}
          </button>
          <div className="text-center mt-4 mono text-[11px] text-zinc-500">
            Already have an account? <Link to="/login" className="text-[#00E559] underline">SIGN IN</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
