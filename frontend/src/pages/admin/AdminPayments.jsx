import React, { useEffect, useState } from "react";
import { api, formatError, API } from "@/lib/api";
import { Check, XCircle, Image as ImageIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

function StatusBadge({ s }) {
  const m = { pending: "adm-badge-yellow", submitted: "adm-badge-blue", verified: "adm-badge-green", rejected: "adm-badge-red" };
  return <span className={"adm-badge " + (m[s] || "adm-badge-gray")}>{(s || "").toUpperCase()}</span>;
}

export default function AdminPayments() {
  const [payments, setPayments] = useState([]);
  const [status, setStatus] = useState("submitted");
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
    try { await api.post(`/admin/payments/${pid}/verify`, { admin_notes: notes[pid] || "" }); toast.success("Verified"); load(); }
    catch (e) { toast.error(formatError(e)); }
  }
  async function reject(pid) {
    const reason = window.prompt("Reason for rejection?", "");
    if (reason === null) return;
    try { await api.post(`/admin/payments/${pid}/reject`, { admin_notes: reason }); load(); }
    catch (e) { toast.error(formatError(e)); }
  }

  return (
    <div className="p-6 md:p-10">
      <div className="mb-6">
        <div className="adm-crumb mb-2">/ admin / payments</div>
        <h1 style={{fontFamily:'Fraunces, serif'}}>Payments</h1>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {["submitted", "verified", "rejected", "pending", ""].map((s) => (
          <button key={s} className={"adm-btn " + (status === s ? "adm-btn-primary" : "adm-btn-secondary")} onClick={() => setStatus(s)} data-testid={`filter-${s || "all"}`}>
            {s ? s.toUpperCase() : "ALL"}
          </button>
        ))}
      </div>

      {err && <div className="adm-card p-3 mb-4 text-[13px] text-red-700 border-red-200 bg-red-50">{err}</div>}

      <div className="adm-card overflow-x-auto adm-table-wrap">
        <table className="adm-table min-w-[900px]">
          <thead>
            <tr>
              <th>Date</th><th>User</th><th>Plan</th><th>Amount</th><th>Ref</th><th>UTR</th><th>Proof</th><th>Status</th><th>Admin Notes</th><th className="text-right">Actions</th></tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} data-testid={`admin-payment-${p.id}`}>
                <td className="text-[12px] text-[color:var(--adm-text-3)] mono">{new Date(p.created_at).toLocaleString()}</td>
                <td>
                  <div className="font-medium">{p.user_name || "—"}</div>
                  <div className="text-[12px] mono text-[color:var(--adm-text-3)]">{p.user_email}</div>
                </td>
                <td className="mono">{p.plan_name}</td>
                <td className="mono font-medium">{p.currency === "INR" ? "₹" : "$"}{p.amount}</td>
                <td className="mono text-[12px]">{p.reference}</td>
                <td className="mono text-[12px] text-[color:var(--adm-accent)]">{p.utr_number || "—"}</td>
                <td>
                  {p.screenshot_path ? (
                    <a href={`${API}/admin/payments/${p.id}/screenshot`} target="_blank" rel="noreferrer" className="adm-btn adm-btn-secondary">
                      <ImageIcon size={12}/>
                    </a>
                  ) : "—"}
                </td>
                <td><StatusBadge s={p.status}/></td>
                <td>
                  {p.status === "submitted" ? (
                    <input className="adm-input" placeholder="notes..." value={notes[p.id] || ""} onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })} data-testid={`notes-${p.id}`}/>
                  ) : <span className="text-[12px] text-[color:var(--adm-text-3)]">{p.admin_notes || "—"}</span>}
                </td>
                <td className="text-right whitespace-nowrap">
                  {p.status === "submitted" && (
                    <>
                      <button className="adm-btn adm-btn-primary mr-1" onClick={() => verify(p.id)} data-testid={`verify-${p.id}`}><Check size={12}/> Verify</button>
                      <button className="adm-btn adm-btn-danger" onClick={() => reject(p.id)} data-testid={`reject-${p.id}`}><XCircle size={12}/></button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {payments.length === 0 && <div className="p-8 text-center text-[13px] text-[color:var(--adm-text-3)]">No payments in this status</div>}
      </div>
    </div>
  );
}
