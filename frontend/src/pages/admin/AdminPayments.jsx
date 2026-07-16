import React, { useEffect, useState } from "react";
import { api, formatError, API } from "@/lib/api";
import { Check, XCircle, Image as ImageIcon } from "@phosphor-icons/react";

function StatusBadge({ s }) {
  const m = { pending: "wa-badge-yellow", submitted: "wa-badge-blue", verified: "wa-badge-green", rejected: "wa-badge-red" };
  return <span className={"wa-badge " + (m[s] || "")}>{(s || "").toUpperCase()}</span>;
}

export default function AdminPayments() {
  const [payments, setPayments] = useState([]);
  const [status, setStatus] = useState("submitted"); // default: awaiting verification
  const [err, setErr] = useState("");
  const [notes, setNotes] = useState({});

  async function load() {
    try {
      const q = status ? `?status=${status}` : "";
      const { data } = await api.get(`/admin/payments${q}`);
      setPayments(data.payments || []);
    } catch (e) { setErr(formatError(e)); }
  }
  useEffect(() => { load(); }, [status]); // eslint-disable-line

  async function verify(pid) {
    if (!window.confirm("Confirm this payment and activate subscription?")) return;
    try { await api.post(`/admin/payments/${pid}/verify`, { admin_notes: notes[pid] || "" }); load(); }
    catch (e) { setErr(formatError(e)); }
  }
  async function reject(pid) {
    const reason = window.prompt("Reason for rejection?", "");
    if (reason === null) return;
    try { await api.post(`/admin/payments/${pid}/reject`, { admin_notes: reason }); load(); }
    catch (e) { setErr(formatError(e)); }
  }

  return (
    <div className="p-6 md:p-10">
      <div className="mb-6">
        <div className="mono text-[11px] uppercase tracking-widest text-zinc-500 mb-1">/admin/payments</div>
        <h1 className="text-3xl md:text-4xl font-semibold text-white">Payments</h1>
      </div>

      <div className="flex gap-2 mb-6">
        {["submitted", "verified", "rejected", "pending", ""].map(s => (
          <button key={s} className={"wa-btn " + (status === s ? "wa-btn-primary" : "wa-btn-secondary")} onClick={() => setStatus(s)} data-testid={`filter-${s || "all"}`}>
            {s ? s.toUpperCase() : "ALL"}
          </button>
        ))}
      </div>

      {err && <div className="wa-card p-3 mb-4 mono text-xs text-red-400">ERR: {err}</div>}

      <div className="wa-card overflow-x-auto">
        <table className="wa-table">
          <thead>
            <tr><th>DATE</th><th>USER</th><th>PLAN</th><th>AMOUNT</th><th>REF</th><th>UTR</th><th>SS</th><th>STATUS</th><th>ADMIN NOTES</th><th></th></tr>
          </thead>
          <tbody>
            {payments.map(p => (
              <tr key={p.id} data-testid={`admin-payment-${p.id}`}>
                <td className="mono text-xs text-zinc-400">{new Date(p.created_at).toLocaleString()}</td>
                <td>
                  <div className="text-white">{p.user_name || "—"}</div>
                  <div className="mono text-[10px] text-zinc-500">{p.user_email}</div>
                  {p.user_company && <div className="text-[11px] text-zinc-500">{p.user_company}</div>}
                </td>
                <td className="mono">{p.plan_name}</td>
                <td className="mono text-white">{p.currency === "INR" ? "₹" : "$"}{p.amount}</td>
                <td className="mono text-xs text-zinc-400">{p.reference}</td>
                <td className="mono text-xs text-[#25D366]">{p.utr_number || "—"}</td>
                <td>
                  {p.screenshot_path ? (
                    <a href={`${API}/admin/payments/${p.id}/screenshot`} target="_blank" rel="noreferrer" className="wa-btn wa-btn-secondary">
                      <ImageIcon size={12}/>
                    </a>
                  ) : "—"}
                </td>
                <td><StatusBadge s={p.status}/></td>
                <td>
                  {p.status === "submitted" ? (
                    <input className="wa-input text-xs" placeholder="notes..." value={notes[p.id] || ""} onChange={(e) => setNotes({...notes, [p.id]: e.target.value})} data-testid={`notes-${p.id}`}/>
                  ) : <span className="text-zinc-400 text-xs">{p.admin_notes || "—"}</span>}
                </td>
                <td className="text-right whitespace-nowrap">
                  {p.status === "submitted" && (
                    <>
                      <button className="wa-btn wa-btn-primary mr-1" onClick={() => verify(p.id)} data-testid={`verify-${p.id}`}><Check size={12}/> VERIFY</button>
                      <button className="wa-btn wa-btn-danger" onClick={() => reject(p.id)} data-testid={`reject-${p.id}`}><XCircle size={12}/></button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {payments.length === 0 && <div className="p-8 text-center mono text-xs text-zinc-500">[ no payments in this status ]</div>}
      </div>
    </div>
  );
}
