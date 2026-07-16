import React, { useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { formatError } from "@/lib/api";
import { useSiteInfo } from "@/lib/siteInfo";
import PublicNav from "@/components/PublicNav";
import { Check } from "@phosphor-icons/react";

export default function Register() {
  const info = useSiteInfo();
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
      await axios.post(`${process.env.REACT_APP_BACKEND_URL}/api/auth/register`, form);
      setOk(true);
    } catch (e2) { setErr(formatError(e2)); }
    finally { setBusy(false); }
  }

  if (ok) return (
    <div className="pub pub-body min-h-screen">
      <PublicNav brand={info.company_name}/>
      <section className="px-6 py-20">
        <div className="max-w-md mx-auto pub-card text-center" data-testid="register-success">
          <Check size={30} className="accent mx-auto mb-4"/>
          <h2 className="mb-4">You&rsquo;re on the list.</h2>
          <p className="mb-6">Your account is <span className="accent">pending admin approval</span>. Once approved you can sign in and choose a subscription.</p>
          <Link to="/login" className="pub-btn pub-btn-primary">Back to login</Link>
        </div>
      </section>
    </div>
  );

  return (
    <div className="pub pub-body min-h-screen" data-testid="register-page">
      <PublicNav brand={info.company_name}/>
      <section className="px-6 py-12 md:py-20">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="mb-2">Create your <span className="accent-serif italic">account.</span></h1>
            <p className="text-sm">Registration takes a minute. Admin approves within 24h.</p>
          </div>
          <form onSubmit={submit} className="pub-card" data-testid="register-form">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="pub-label">Full name *</label>
                <input required className="pub-input" value={form.name} onChange={set("name")} data-testid="reg-name"/></div>
              <div><label className="pub-label">Company</label>
                <input className="pub-input" value={form.company} onChange={set("company")} data-testid="reg-company"/></div>
              <div><label className="pub-label">Email *</label>
                <input required type="email" className="pub-input" value={form.email} onChange={set("email")} data-testid="reg-email"/></div>
              <div><label className="pub-label">Password * (min 6)</label>
                <input required type="password" minLength={6} className="pub-input" value={form.password} onChange={set("password")} data-testid="reg-password"/></div>
              <div><label className="pub-label">Phone *</label>
                <input required className="pub-input" value={form.phone} onChange={set("phone")} data-testid="reg-phone"/></div>
              <div><label className="pub-label">Alternate phone</label>
                <input className="pub-input" value={form.alt_phone} onChange={set("alt_phone")} data-testid="reg-alt-phone"/></div>
              <div className="md:col-span-2"><label className="pub-label">Location (city, country)</label>
                <input className="pub-input" value={form.location} onChange={set("location")} placeholder="Chennai, India" data-testid="reg-location"/></div>
            </div>
            {err && <div className="mt-4 p-3 rounded-lg border border-red-900 bg-red-950/30 text-sm text-red-300" data-testid="reg-error">{err}</div>}
            <button disabled={busy} className="pub-btn pub-btn-primary w-full mt-6" data-testid="reg-submit">
              {busy ? "Submitting..." : "Create account"}
            </button>
            <div className="text-center text-xs text-zinc-500 mt-6">
              Already have an account? <Link to="/login" className="text-white hover:underline">Sign in →</Link>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
