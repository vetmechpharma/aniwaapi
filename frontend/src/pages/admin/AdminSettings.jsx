import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { FloppyDisk, Check } from "@phosphor-icons/react";

const empty = { upi_vpa: "", upi_payee_name: "", contact_email: "", contact_phone: "", invoice_note: "", company_name: "" };

export default function AdminSettings() {
  const [form, setForm] = useState(empty);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try { const { data } = await api.get("/admin/settings"); setForm({ ...empty, ...data }); }
    catch (e) { setErr(formatError(e)); }
  }
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save() {
    setErr(""); setBusy(true);
    try {
      await api.put("/admin/settings", form);
      setSaved(true); setTimeout(() => setSaved(false), 1800);
    } catch (e) { setErr(formatError(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="p-6 md:p-10 max-w-3xl">
      <div className="mb-6">
        <div className="mono text-[11px] uppercase tracking-widest text-zinc-500 mb-1">/admin/settings</div>
        <h1 className="text-3xl md:text-4xl font-semibold text-white">Billing Settings</h1>
        <p className="text-zinc-400 mt-2 text-sm">These fields appear on the pricing / payment QR code shown to subscribers.</p>
      </div>

      <div className="wa-card p-6 space-y-4" data-testid="settings-form">
        <div><label className="wa-label">COMPANY / BRAND NAME</label>
          <input className="wa-input" value={form.company_name || ""} onChange={set("company_name")} placeholder="WA_API SaaS" data-testid="settings-company"/></div>
        <div><label className="wa-label">UPI VPA (yourname@upi) *</label>
          <input className="wa-input" value={form.upi_vpa || ""} onChange={set("upi_vpa")} placeholder="admin@ybl" data-testid="settings-vpa"/></div>
        <div><label className="wa-label">UPI PAYEE NAME (shown in UPI app) *</label>
          <input className="wa-input" value={form.upi_payee_name || ""} onChange={set("upi_payee_name")} placeholder="Your Name / Company" data-testid="settings-payee"/></div>
        <div><label className="wa-label">CONTACT EMAIL</label>
          <input className="wa-input" value={form.contact_email || ""} onChange={set("contact_email")} placeholder="support@company.com"/></div>
        <div><label className="wa-label">CONTACT PHONE</label>
          <input className="wa-input" value={form.contact_phone || ""} onChange={set("contact_phone")}/></div>
        <div><label className="wa-label">INVOICE NOTE</label>
          <input className="wa-input" value={form.invoice_note || ""} onChange={set("invoice_note")}/></div>

        <div className="pt-2">
          <button className="wa-btn wa-btn-primary" onClick={save} disabled={busy || !form.upi_vpa || !form.upi_payee_name} data-testid="settings-save">
            {saved ? <><Check size={14}/> SAVED</> : <><FloppyDisk size={14}/> {busy ? "SAVING..." : "SAVE SETTINGS"}</>}
          </button>
        </div>
        {err && <div className="mono text-xs text-red-400">ERR: {err}</div>}
      </div>
    </div>
  );
}
