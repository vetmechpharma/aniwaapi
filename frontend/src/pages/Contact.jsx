import React, { useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { useSiteInfo } from "@/lib/siteInfo";
import { formatError } from "@/lib/api";
import { EnvelopeSimple, Phone, MapPin, Check, PaperPlaneRight } from "@phosphor-icons/react";

export default function Contact() {
  const info = useSiteInfo();
  const [form, setForm] = useState({ name: "", email: "", phone: "", subject: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      await axios.post(`${process.env.REACT_APP_BACKEND_URL}/api/contact`, form);
      setOk(true);
      setForm({ name: "", email: "", phone: "", subject: "", message: "" });
    } catch (e2) { setErr(formatError(e2)); }
    finally { setBusy(false); }
  }

  return (
    <div className="pub pub-body" data-testid="contact-page">
      <PublicNav brand={info.company_name}/>
      <section className="pt-20 pb-10 px-6 relative">
        <div className="pub-grid-bg absolute inset-0 pointer-events-none"/>
        <div className="max-w-3xl mx-auto text-center relative">
          <div className="eyebrow mb-4">Contact</div>
          <h1 className="mb-4">Let&rsquo;s <span className="accent-serif italic">talk.</span></h1>
          <p className="lead">Questions on plans, custom integrations, or something else — we&rsquo;re happy to help.</p>
        </div>
      </section>

      <section className="pb-20 px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-4">
            {info.contact_email && (
              <div className="pub-card">
                <EnvelopeSimple size={20} className="accent mb-3"/>
                <div className="text-white font-medium mb-1">Email</div>
                <a href={`mailto:${info.contact_email}`} className="text-sm text-zinc-300 hover:text-white break-all">{info.contact_email}</a>
              </div>
            )}
            {info.contact_phone && (
              <div className="pub-card">
                <Phone size={20} className="accent mb-3"/>
                <div className="text-white font-medium mb-1">Phone / WhatsApp</div>
                <a href={`tel:${info.contact_phone}`} className="text-sm text-zinc-300 hover:text-white">{info.contact_phone}</a>
              </div>
            )}
            <div className="pub-card">
              <MapPin size={20} className="accent mb-3"/>
              <div className="text-white font-medium mb-1">Support hours</div>
              <p className="text-sm">Mon–Fri, 9:00 – 18:00 IST · Response within 24 hours.</p>
            </div>
          </div>

          <div className="lg:col-span-2">
            {ok ? (
              <div className="pub-card text-center py-16" data-testid="contact-success">
                <Check size={30} className="accent mx-auto mb-4"/>
                <h3 className="mb-3">Thanks — message received.</h3>
                <p className="lead mb-6">We&rsquo;ll get back to you shortly.</p>
                <button className="pub-btn pub-btn-secondary" onClick={() => setOk(false)}>Send another</button>
              </div>
            ) : (
              <form onSubmit={submit} className="pub-card" data-testid="contact-form">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><label className="pub-label">Your name *</label>
                    <input required className="pub-input" value={form.name} onChange={set("name")} data-testid="contact-name"/></div>
                  <div><label className="pub-label">Email *</label>
                    <input required type="email" className="pub-input" value={form.email} onChange={set("email")} data-testid="contact-email"/></div>
                  <div><label className="pub-label">Phone (optional)</label>
                    <input className="pub-input" value={form.phone} onChange={set("phone")} data-testid="contact-phone"/></div>
                  <div><label className="pub-label">Subject</label>
                    <input className="pub-input" value={form.subject} onChange={set("subject")} data-testid="contact-subject"/></div>
                  <div className="md:col-span-2"><label className="pub-label">Message *</label>
                    <textarea required className="pub-textarea" value={form.message} onChange={set("message")} data-testid="contact-message"/></div>
                </div>
                {err && <div className="mt-4 p-3 rounded-lg border border-red-900 bg-red-950/30 text-sm text-red-300">{err}</div>}
                <button disabled={busy} className="pub-btn pub-btn-primary mt-6" data-testid="contact-submit">
                  <PaperPlaneRight size={14}/> {busy ? "Sending..." : "Send message"}
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      <PublicFooter brand={info.company_name} email={info.contact_email} phone={info.contact_phone}/>
    </div>
  );
}
