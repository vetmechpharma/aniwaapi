import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { EnvelopeSimple, FloppyDisk, PaperPlaneRight, CheckCircle, Info } from "@phosphor-icons/react";
import { toast } from "sonner";

const empty = {
  host: "", port: 587, username: "", password: "",
  use_tls: true, use_ssl: false, from_name: "", from_email: "", enabled: true,
};

export default function AdminSmtp() {
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [testTo, setTestTo] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [passHint, setPassHint] = useState(""); // when we get masked back

  async function load() {
    try {
      const { data } = await api.get("/admin/settings/smtp");
      setForm({ ...empty, ...data, password: "" });  // never prefill password (comes masked)
      if (data.password) setPassHint("Saved (leave blank to keep)");
    } catch (e) { setErr(formatError(e)); }
  }
  useEffect(() => { load(); }, []);

  const s = (k) => (e) => setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function save() {
    setBusy(true); setErr("");
    try {
      const body = { ...form, port: Number(form.port) || 587 };
      await api.put("/admin/settings/smtp", body);
      toast.success("SMTP saved");
      load();
    } catch (e) { setErr(formatError(e)); }
    finally { setBusy(false); }
  }

  async function test() {
    if (!testTo) { toast.error("Enter a recipient email"); return; }
    setTestBusy(true);
    try {
      await api.post("/admin/settings/smtp/test", { to_email: testTo });
      toast.success("Test email sent — check the inbox");
    } catch (e) { toast.error(formatError(e)); }
    finally { setTestBusy(false); }
  }

  const useSslMode = form.use_ssl;

  return (
    <div className="p-6 md:p-10 max-w-4xl">
      <div className="mb-6">
        <div className="adm-crumb mb-2">/ admin / smtp</div>
        <h1 style={{fontFamily:'Fraunces, serif'}}>Email (SMTP)</h1>
        <p className="text-[color:var(--adm-text-2)] mt-1 text-[14px]">
          Configure outgoing mail. Used for welcome emails, password reset OTPs, and admin notifications.
        </p>
      </div>

      <div className="adm-card p-6 mb-6" data-testid="smtp-form">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2 flex items-center justify-between p-4 rounded-xl bg-[color:var(--adm-accent-soft)] border border-[color:var(--adm-border)]">
            <div className="flex items-center gap-3">
              <EnvelopeSimple size={22} color="#128C7E" weight="bold"/>
              <div>
                <div className="text-[14px] font-medium">Enable email sending</div>
                <div className="text-[12px] text-[color:var(--adm-text-3)]">When off, welcome & OTP mails will not be sent.</div>
              </div>
            </div>
            <span className="adm-toggle">
              <input type="checkbox" checked={!!form.enabled} onChange={s("enabled")} data-testid="smtp-enabled"/>
              <span className="adm-toggle-slider"/>
            </span>
          </div>

          <div><label className="adm-label">SMTP host *</label>
            <input className="adm-input" placeholder="smtp.gmail.com" value={form.host} onChange={s("host")} data-testid="smtp-host"/></div>
          <div><label className="adm-label">Port *</label>
            <input type="number" className="adm-input" placeholder="587 (STARTTLS) or 465 (SSL)" value={form.port} onChange={s("port")} data-testid="smtp-port"/></div>
          <div><label className="adm-label">Username</label>
            <input className="adm-input" placeholder="you@gmail.com" value={form.username} onChange={s("username")} data-testid="smtp-username"/></div>
          <div><label className="adm-label">Password / App password {passHint && <span className="text-[10px] text-[color:var(--adm-accent)] normal-case tracking-normal ml-1">({passHint})</span>}</label>
            <input type="password" className="adm-input" placeholder="•••••••• (leave blank to keep)" value={form.password} onChange={s("password")} data-testid="smtp-password"/></div>
          <div><label className="adm-label">From name</label>
            <input className="adm-input" placeholder="WA_API" value={form.from_name} onChange={s("from_name")} data-testid="smtp-from-name"/></div>
          <div><label className="adm-label">From email *</label>
            <input type="email" className="adm-input" placeholder="no-reply@yourdomain.com" value={form.from_email} onChange={s("from_email")} data-testid="smtp-from-email"/></div>

          <div className="md:col-span-2 flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-[13px] cursor-pointer">
              <input type="checkbox" checked={!!form.use_tls && !form.use_ssl} onChange={(e) => setForm({ ...form, use_tls: e.target.checked, use_ssl: e.target.checked ? false : form.use_ssl })} data-testid="smtp-tls"/>
              STARTTLS (recommended for port 587)
            </label>
            <label className="flex items-center gap-2 text-[13px] cursor-pointer">
              <input type="checkbox" checked={!!form.use_ssl} onChange={(e) => setForm({ ...form, use_ssl: e.target.checked, use_tls: e.target.checked ? false : form.use_tls })} data-testid="smtp-ssl"/>
              SSL/TLS (for port 465)
            </label>
          </div>
        </div>

        <div className="mt-6 p-4 rounded-xl bg-blue-50 border border-blue-200 flex items-start gap-3">
          <Info size={18} color="#1E40AF" weight="bold" className="shrink-0 mt-0.5"/>
          <div className="text-[13px] text-blue-900 leading-relaxed">
            <strong>Gmail users:</strong> Turn on 2-Step Verification and create an <a className="underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">App Password</a>. Use that 16-character password here, host <code>smtp.gmail.com</code>, port <code>587</code>, STARTTLS.
          </div>
        </div>

        {err && <div className="mt-4 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{err}</div>}

        <div className="flex gap-2 mt-6">
          <button disabled={busy} className="adm-btn adm-btn-primary" onClick={save} data-testid="smtp-save">
            <FloppyDisk size={14}/> {busy ? "Saving..." : "Save SMTP settings"}
          </button>
        </div>
      </div>

      <div className="adm-card p-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-xl bg-[color:var(--adm-accent-soft)] flex items-center justify-center">
            <PaperPlaneRight size={18} color="#128C7E" weight="bold"/>
          </div>
          <div>
            <div className="font-medium">Send test email</div>
            <div className="text-[12px] text-[color:var(--adm-text-3)]">Verifies your saved SMTP config even if disabled.</div>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <input type="email" className="adm-input flex-1" placeholder="you@example.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} data-testid="smtp-test-to"/>
          <button disabled={testBusy} className="adm-btn adm-btn-secondary" onClick={test} data-testid="smtp-test-btn">
            <CheckCircle size={14}/> {testBusy ? "Sending..." : "Send test"}
          </button>
        </div>
      </div>
    </div>
  );
}
