import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { FloppyDisk, CheckCircle } from "@phosphor-icons/react";
import { toast } from "sonner";

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

  const s = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save() {
    setErr(""); setBusy(true);
    try {
      await api.put("/admin/settings", form);
      setSaved(true); toast.success("Settings saved");
      setTimeout(() => setSaved(false), 1800);
    } catch (e) { setErr(formatError(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="p-6 md:p-10 max-w-3xl">
      <div className="mb-6">
        <div className="adm-crumb mb-2">/ admin / settings</div>
        <h1 style={{fontFamily:'Fraunces, serif'}}>Billing settings</h1>
        <p className="text-[color:var(--adm-text-2)] mt-1 text-[14px]">These fields appear on the pricing page and inside UPI QR codes shown to subscribers.</p>
      </div>

      <div className="adm-card p-6 space-y-4" data-testid="settings-form">
        <div><label className="adm-label">Company / brand name</label>
          <input className="adm-input" value={form.company_name || ""} onChange={s("company_name")} placeholder="WA_API SaaS" data-testid="settings-company"/></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="adm-label">UPI VPA (yourname@upi) *</label>
            <input className="adm-input" value={form.upi_vpa || ""} onChange={s("upi_vpa")} placeholder="admin@ybl" data-testid="settings-vpa"/></div>
          <div><label className="adm-label">UPI payee name (shown in UPI app) *</label>
            <input className="adm-input" value={form.upi_payee_name || ""} onChange={s("upi_payee_name")} placeholder="Your Name / Company" data-testid="settings-payee"/></div>
          <div><label className="adm-label">Contact email</label>
            <input className="adm-input" value={form.contact_email || ""} onChange={s("contact_email")} placeholder="support@company.com"/></div>
          <div><label className="adm-label">Contact phone</label>
            <input className="adm-input" value={form.contact_phone || ""} onChange={s("contact_phone")}/></div>
        </div>
        <div><label className="adm-label">Invoice note</label>
          <input className="adm-input" value={form.invoice_note || ""} onChange={s("invoice_note")}/></div>

        <div className="pt-2">
          <button className="adm-btn adm-btn-primary" onClick={save} disabled={busy || !form.upi_vpa || !form.upi_payee_name} data-testid="settings-save">
            {saved ? <><CheckCircle size={14}/> Saved</> : <><FloppyDisk size={14}/> {busy ? "Saving..." : "Save settings"}</>}
          </button>
        </div>
        {err && <div className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{err}</div>}
      </div>
    </div>
  );
}
