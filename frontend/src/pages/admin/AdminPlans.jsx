import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Plus, PencilSimple, TrashSimple, FloppyDisk, XCircle } from "@phosphor-icons/react";

const empty = {
  name: "", description: "", price_inr: 0, price_usd: 0, validity_days: 30,
  max_sessions: 1, max_messages_per_day: 1000, max_api_keys: 3,
  features: [], active: true, sort_order: 0,
};

export default function AdminPlans() {
  const [plans, setPlans] = useState([]);
  const [editing, setEditing] = useState(null); // id | 'new' | null
  const [form, setForm] = useState(empty);
  const [featStr, setFeatStr] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    try { const { data } = await api.get("/admin/plans"); setPlans(data.plans || []); }
    catch (e) { setErr(formatError(e)); }
  }
  useEffect(() => { load(); }, []);

  function startNew() { setForm(empty); setFeatStr(""); setEditing("new"); setErr(""); }
  function startEdit(p) {
    setForm({
      name: p.name || "", description: p.description || "",
      price_inr: p.price_inr, price_usd: p.price_usd,
      validity_days: p.validity_days, max_sessions: p.max_sessions,
      max_messages_per_day: p.max_messages_per_day, max_api_keys: p.max_api_keys,
      features: p.features || [], active: !!p.active, sort_order: p.sort_order || 0,
    });
    setFeatStr((p.features || []).join("\n"));
    setEditing(p.id); setErr("");
  }
  async function save() {
    setErr("");
    const features = featStr.split("\n").map(s => s.trim()).filter(Boolean);
    const body = { ...form, features,
      price_inr: Number(form.price_inr) || 0, price_usd: Number(form.price_usd) || 0,
      validity_days: Number(form.validity_days) || 30,
      max_sessions: Number(form.max_sessions) || 1,
      max_messages_per_day: Number(form.max_messages_per_day) || 1000,
      max_api_keys: Number(form.max_api_keys) || 3,
      sort_order: Number(form.sort_order) || 0,
    };
    try {
      if (editing === "new") await api.post("/admin/plans", body);
      else await api.put(`/admin/plans/${editing}`, body);
      setEditing(null); load();
    } catch (e) { setErr(formatError(e)); }
  }
  async function del(id) {
    if (!window.confirm("Delete this plan? Existing subscribers won't be affected.")) return;
    await api.delete(`/admin/plans/${id}`); load();
  }
  const set = (k) => (e) => setForm({ ...form, [k]: (e.target.type === "checkbox" ? e.target.checked : e.target.value) });

  return (
    <div className="p-6 md:p-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="mono text-[11px] uppercase tracking-widest text-zinc-500 mb-1">/admin/plans</div>
          <h1 className="text-3xl md:text-4xl font-semibold text-white">Subscription Plans</h1>
        </div>
        <button className="wa-btn wa-btn-primary" onClick={startNew} data-testid="new-plan-btn"><Plus size={14}/> NEW PLAN</button>
      </div>

      {editing && (
        <div className="wa-card p-6 mb-6" data-testid="plan-form">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2"><label className="wa-label">NAME *</label>
              <input className="wa-input" value={form.name} onChange={set("name")} data-testid="plan-name"/></div>
            <div><label className="wa-label">SORT ORDER</label>
              <input type="number" className="wa-input" value={form.sort_order} onChange={set("sort_order")}/></div>
            <div className="md:col-span-3"><label className="wa-label">DESCRIPTION</label>
              <input className="wa-input" value={form.description} onChange={set("description")}/></div>
            <div><label className="wa-label">PRICE (INR ₹)</label>
              <input type="number" className="wa-input" value={form.price_inr} onChange={set("price_inr")} data-testid="plan-inr"/></div>
            <div><label className="wa-label">PRICE (USD $)</label>
              <input type="number" className="wa-input" value={form.price_usd} onChange={set("price_usd")} data-testid="plan-usd"/></div>
            <div><label className="wa-label">VALIDITY DAYS</label>
              <input type="number" className="wa-input" value={form.validity_days} onChange={set("validity_days")} data-testid="plan-validity"/></div>
            <div><label className="wa-label">MAX SESSIONS</label>
              <input type="number" className="wa-input" value={form.max_sessions} onChange={set("max_sessions")}/></div>
            <div><label className="wa-label">MAX MSGS / DAY</label>
              <input type="number" className="wa-input" value={form.max_messages_per_day} onChange={set("max_messages_per_day")}/></div>
            <div><label className="wa-label">MAX API KEYS</label>
              <input type="number" className="wa-input" value={form.max_api_keys} onChange={set("max_api_keys")}/></div>
            <div className="md:col-span-3"><label className="wa-label">FEATURES (one per line)</label>
              <textarea className="wa-textarea" value={featStr} onChange={(e) => setFeatStr(e.target.value)} data-testid="plan-features"/></div>
            <div className="md:col-span-3">
              <label className="mono text-xs cursor-pointer flex items-center gap-2">
                <input type="checkbox" checked={form.active} onChange={set("active")} data-testid="plan-active"/>
                Active (shown on pricing page)
              </label>
            </div>
          </div>
          <div className="flex gap-3 mt-6">
            <button className="wa-btn wa-btn-primary" onClick={save} disabled={!form.name} data-testid="plan-save"><FloppyDisk size={14}/> SAVE</button>
            <button className="wa-btn wa-btn-secondary" onClick={() => setEditing(null)}><XCircle size={14}/> CANCEL</button>
          </div>
          {err && <div className="mono text-xs text-red-400 mt-3">ERR: {err}</div>}
        </div>
      )}

      <div className="wa-card overflow-x-auto">
        <table className="wa-table">
          <thead>
            <tr><th>ORDER</th><th>NAME</th><th>₹ INR</th><th>$ USD</th><th>VALIDITY</th><th>SESSIONS</th><th>MSGS/DAY</th><th>API KEYS</th><th>ACTIVE</th><th></th></tr>
          </thead>
          <tbody>
            {plans.map(p => (
              <tr key={p.id} data-testid={`plan-row-${p.id}`}>
                <td className="mono">{p.sort_order}</td>
                <td className="text-white">{p.name}</td>
                <td className="mono">{p.price_inr}</td>
                <td className="mono">{p.price_usd}</td>
                <td className="mono">{p.validity_days}d</td>
                <td className="mono">{p.max_sessions}</td>
                <td className="mono">{p.max_messages_per_day}</td>
                <td className="mono">{p.max_api_keys}</td>
                <td>{p.active ? <span className="wa-badge wa-badge-green">ON</span> : <span className="wa-badge wa-badge-red">OFF</span>}</td>
                <td className="text-right whitespace-nowrap">
                  <button className="wa-btn wa-btn-secondary mr-2" onClick={() => startEdit(p)} data-testid={`plan-edit-${p.id}`}><PencilSimple size={12}/></button>
                  <button className="wa-btn wa-btn-danger" onClick={() => del(p.id)}><TrashSimple size={12}/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {plans.length === 0 && <div className="p-8 text-center mono text-xs text-zinc-500">[ no plans ]</div>}
      </div>
    </div>
  );
}
