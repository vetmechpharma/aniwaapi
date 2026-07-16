import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { api, formatError } from "@/lib/api";
import { CreditCard, QrCode, UploadSimple, Check, Clock, XCircle } from "@phosphor-icons/react";

function StatusBadge({ status }) {
  const map = {
    pending: "wa-badge-yellow", submitted: "wa-badge-blue",
    verified: "wa-badge-green", rejected: "wa-badge-red",
  };
  return <span className={"wa-badge " + (map[status] || "")}>{(status || "").toUpperCase()}</span>;
}

export default function Billing() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [summary, setSummary] = useState(null);
  const [plans, setPlans] = useState([]);
  const [payments, setPayments] = useState([]);
  const [activePayment, setActivePayment] = useState(null); // the QR payment being processed
  const [utr, setUtr] = useState("");
  const [screenshot, setScreenshot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    try {
      const [s, p, m] = await Promise.all([
        api.get("/billing/summary"),
        api.get("/plans"),
        api.get("/billing/my-payments"),
      ]);
      setSummary(s.data);
      setPlans(p.data.plans || []);
      setPayments(m.data.payments || []);
    } catch (e) { setErr(formatError(e)); }
  }
  useEffect(() => { load(); }, []);

  // Auto-open plan from ?plan= param
  useEffect(() => {
    const planId = sp.get("plan");
    if (planId && plans.length > 0 && !activePayment) {
      startPayment(planId, "INR");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans]);

  async function startPayment(planId, currency) {
    setErr(""); setMsg(""); setBusy(true);
    try {
      const fd = new FormData();
      fd.append("plan_id", planId);
      fd.append("currency", currency);
      const { data } = await api.post("/billing/create-payment", fd);
      setActivePayment(data);
    } catch (e) { setErr(formatError(e)); }
    finally { setBusy(false); }
  }

  async function submitUtr() {
    if (!activePayment) return;
    if (!utr.trim()) { setErr("UTR / transaction ID required"); return; }
    setErr(""); setBusy(true);
    try {
      const fd = new FormData();
      fd.append("payment_id", activePayment.id);
      fd.append("utr", utr.trim());
      if (screenshot) fd.append("screenshot", screenshot);
      await api.post("/billing/submit-utr", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setMsg("Payment submitted for admin verification.");
      setActivePayment(null); setUtr(""); setScreenshot(null);
      load();
    } catch (e) { setErr(formatError(e)); }
    finally { setBusy(false); }
  }

  if (summary?.is_admin) return (
    <div className="p-6 md:p-10">
      <div className="wa-card p-8">
        <h1 className="text-2xl font-semibold text-white mb-2">Billing (Admin)</h1>
        <p className="text-zinc-400 text-sm mb-4">You are logged in as admin — no subscription required.</p>
        <Link to="/admin/payments" className="wa-btn wa-btn-primary">MANAGE PAYMENTS →</Link>
      </div>
    </div>
  );

  const u = summary?.user;
  const plan = summary?.plan;
  const usage = summary?.usage || {};

  return (
    <div className="p-6 md:p-10 max-w-6xl">
      <div className="mb-6">
        <div className="mono text-[11px] uppercase tracking-widest text-zinc-500 mb-1">/billing</div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-white">Subscription & Payments</h1>
      </div>

      {err && <div className="wa-card p-4 mb-4 border-red-800 mono text-xs text-red-400" data-testid="billing-error">ERR: {err}</div>}
      {msg && <div className="wa-card p-4 mb-4 border-[#25D366] mono text-xs text-[#25D366]" data-testid="billing-msg">{msg}</div>}

      {/* Current plan summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="wa-card p-5" data-testid="billing-plan">
          <div className="mono text-[10px] uppercase text-zinc-500">CURRENT PLAN</div>
          <div className="mono text-xl font-bold text-white mt-1">{plan?.name || "— none —"}</div>
          {summary?.subscription_expires_at ? (
            <div className="mono text-[11px] text-zinc-400 mt-2">Expires: {new Date(summary.subscription_expires_at).toLocaleString()}
              {summary.days_left !== null && <span className={"ml-2 wa-badge " + (summary.days_left > 3 ? "wa-badge-green" : "wa-badge-yellow")}>{summary.days_left}d LEFT</span>}
            </div>
          ) : (
            <div className="mono text-[11px] text-red-400 mt-2">Not subscribed. Choose a plan below.</div>
          )}
        </div>
        <div className="wa-card p-5">
          <div className="mono text-[10px] uppercase text-zinc-500">USAGE TODAY</div>
          <div className="mono text-xl font-bold text-white mt-1">{usage.messages_today || 0}<span className="text-zinc-500 text-sm ml-1">/ {plan?.max_messages_per_day || "—"}</span></div>
          <div className="mono text-[11px] text-zinc-500 mt-2">messages sent today</div>
        </div>
        <div className="wa-card p-5">
          <div className="mono text-[10px] uppercase text-zinc-500">RESOURCES</div>
          <div className="mono text-sm text-white mt-1">Sessions: {usage.sessions_count} / {plan?.max_sessions || "—"}</div>
          <div className="mono text-sm text-white">API Keys: {usage.api_keys_count} / {plan?.max_api_keys || "—"}</div>
        </div>
      </div>

      {/* Active payment (QR + submit UTR) */}
      {activePayment ? (
        <div className="wa-card p-6 mb-8 border-[#25D366]" data-testid="active-payment">
          <div className="flex items-center gap-2 mb-4">
            <QrCode size={20} color="#25D366"/>
            <div className="mono text-sm uppercase text-white">Pay via UPI — {activePayment.plan_name} · ₹{activePayment.amount}</div>
          </div>

          {activePayment.qr_data_url ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              <div>
                <div className="mono text-[10px] uppercase text-zinc-500 mb-2">SCAN WITH ANY UPI APP</div>
                <div className="p-2 bg-white inline-block">
                  <img src={activePayment.qr_data_url} alt="UPI QR" className="w-64 h-64" data-testid="upi-qr"/>
                </div>
                <div className="mono text-[11px] text-zinc-400 mt-3">
                  <div>VPA: <span className="text-[#25D366]">{activePayment.upi_vpa}</span></div>
                  <div>Name: <span className="text-[#25D366]">{activePayment.upi_payee_name}</span></div>
                  <div>Ref: <span className="text-[#25D366]">{activePayment.reference}</span></div>
                  <div>Amount: <span className="text-[#25D366]">₹{activePayment.amount}</span></div>
                </div>
                <a
                  href={activePayment.upi_url} className="wa-btn wa-btn-secondary mt-3"
                  data-testid="upi-open-app"
                >OPEN UPI APP</a>
              </div>
              <div>
                <div className="mono text-[10px] uppercase text-zinc-500 mb-2">STEP 2 — CONFIRM PAYMENT</div>
                <label className="wa-label">UTR / TRANSACTION ID *</label>
                <input className="wa-input" value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="12-digit UPI UTR" data-testid="utr-input"/>
                <div className="mt-3"><label className="wa-label">SCREENSHOT (optional but recommended)</label>
                  <input type="file" accept="image/*" className="wa-input" onChange={(e) => setScreenshot(e.target.files?.[0])} data-testid="utr-screenshot"/></div>
                <div className="flex gap-2 mt-4">
                  <button className="wa-btn wa-btn-primary" disabled={busy || !utr.trim()} onClick={submitUtr} data-testid="utr-submit">
                    <UploadSimple size={14}/> {busy ? "SUBMITTING..." : "SUBMIT FOR VERIFICATION"}
                  </button>
                  <button className="wa-btn wa-btn-secondary" onClick={() => setActivePayment(null)}>CANCEL</button>
                </div>
                <div className="mono text-[10px] text-zinc-500 mt-4">
                  Admin will verify within 24h. You'll gain access as soon as it's approved.
                </div>
              </div>
            </div>
          ) : (
            <div className="mono text-xs text-yellow-500">UPI QR unavailable for this currency. Please contact admin.</div>
          )}
        </div>
      ) : (
        // Show plans grid to pick
        <div className="mb-8">
          <div className="mono text-xs uppercase tracking-widest text-zinc-500 mb-3">CHOOSE / RENEW A PLAN</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {plans.map((p) => (
              <div key={p.id} className="wa-card p-5 flex flex-col" data-testid={`billing-plan-${p.id}`}>
                <div className="mono text-[10px] uppercase text-zinc-500">{p.name}</div>
                <div className="mono text-2xl font-bold text-white mt-2">₹{p.price_inr}<span className="text-xs text-zinc-500 ml-1">/${p.price_usd}</span></div>
                <div className="mono text-[10px] text-zinc-500">{p.validity_days} days</div>
                <ul className="mt-3 space-y-1 flex-1">
                  {(p.features || []).slice(0, 4).map((f) => (
                    <li key={f} className="mono text-[11px] text-zinc-300 flex items-start gap-1"><Check size={10} className="text-[#25D366] mt-1"/>{f}</li>
                  ))}
                </ul>
                <button className="wa-btn wa-btn-primary mt-4" disabled={busy} onClick={() => startPayment(p.id, "INR")} data-testid={`pay-plan-${p.id}`}>PAY WITH UPI</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payment history */}
      <div className="mono text-xs uppercase tracking-widest text-zinc-500 mb-3">PAYMENT HISTORY</div>
      <div className="wa-card overflow-x-auto">
        {payments.length === 0 ? (
          <div className="p-8 text-center mono text-xs text-zinc-500 uppercase">[ no payments yet ]</div>
        ) : (
          <table className="wa-table">
            <thead>
              <tr><th>DATE</th><th>PLAN</th><th>AMOUNT</th><th>REF</th><th>UTR</th><th>STATUS</th><th>NOTES</th></tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} data-testid={`payment-row-${p.id}`}>
                  <td className="mono text-zinc-400">{new Date(p.created_at).toLocaleString()}</td>
                  <td className="mono">{p.plan_name}</td>
                  <td className="mono text-white">{p.currency === "INR" ? "₹" : "$"}{p.amount}</td>
                  <td className="mono text-zinc-500">{p.reference}</td>
                  <td className="mono text-zinc-400">{p.utr_number || "—"}</td>
                  <td><StatusBadge status={p.status}/></td>
                  <td className="text-zinc-400 text-sm">{p.admin_notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
