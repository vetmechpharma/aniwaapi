import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Plus, PencilSimple, TrashSimple, FloppyDisk, X } from "@phosphor-icons/react";
import { toast } from "sonner";

const empty = {
  name: "", description: "", price_inr: 0, price_usd: 0, validity_days: 30,
  max_sessions: 1, max_messages_per_day: 1000, max_api_keys: 3, max_rules: 50, max_webhooks: 10,
  features: [], feature_flags: {}, active: true, sort_order: 0,
};

export default function AdminPlans() {
  const [plans, setPlans] = useState([]);
  const [flagDefs, setFlagDefs] = useState({ flags: [], defaults: {} });
  const [editing, setEditing] = useState(null); // id | 'new' | null
  const [form, setForm] = useState(empty);
  const [featStr, setFeatStr] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    try {
      const [pr, ff] = await Promise.all([api.get("/admin/plans"), api.get("/admin/feature-flags")]);
      setPlans(pr.data.plans || []);
      setFlagDefs(ff.data || { flags: [], defaults: {} });
    } catch (e) { setErr(formatError(e)); }
  }
  useEffect(() => { load(); }, []);

  function startNew() {
    setForm({ ...empty, feature_flags: { ...flagDefs.defaults } });
    setFeatStr(""); setEditing("new"); setErr("");
  }
  function startEdit(p) {
    setForm({
      name: p.name || "", description: p.description || "",
      price_inr: p.price_inr, price_usd: p.price_usd,
      validity_days: p.validity_days, max_sessions: p.max_sessions,
      max_messages_per_day: p.max_messages_per_day, max_api_keys: p.max_api_keys,
      max_rules: p.max_rules ?? 50, max_webhooks: p.max_webhooks ?? 10,
      features: p.features || [], feature_flags: { ...flagDefs.defaults, ...(p.feature_flags || {}) },
      active: !!p.active, sort_order: p.sort_order || 0,
    });
    setFeatStr((p.features || []).join("\n"));
    setEditing(p.id); setErr("");
  }
  async function save() {
    setErr("");
    const features = featStr.split("\n").map((s) => s.trim()).filter(Boolean);
    const body = { ...form, features,
      price_inr: Number(form.price_inr) || 0, price_usd: Number(form.price_usd) || 0,
      validity_days: Number(form.validity_days) || 30,
      max_sessions: Number(form.max_sessions) || 1,
      max_messages_per_day: Number(form.max_messages_per_day) || 1000,
      max_api_keys: Number(form.max_api_keys) || 3,
      max_rules: Number(form.max_rules) || 50,
      max_webhooks: Number(form.max_webhooks) || 10,
      sort_order: Number(form.sort_order) || 0,
    };
    try {
      if (editing === "new") await api.post("/admin/plans", body);
      else await api.put(`/admin/plans/${editing}`, body);
      toast.success("Plan saved");
      setEditing(null); load();
    } catch (e) { setErr(formatError(e)); }
  }
  async function del(id) {
    if (!window.confirm("Delete this plan? Existing subscribers won't be affected.")) return;
    try { await api.delete(`/admin/plans/${id}`); load(); }
    catch (e) { toast.error(formatError(e)); }
  }
  const set = (k) => (e) => setForm({ ...form, [k]: (e.target.type === "checkbox" ? e.target.checked : e.target.value) });

  return (
    <div className="p-6 md:p-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="adm-crumb mb-2">/ admin / plans</div>
          <h1 style={{fontFamily:'Fraunces, serif'}}>Subscription plans</h1>
        </div>
        <button className="adm-btn adm-btn-primary" onClick={startNew} data-testid="new-plan-btn"><Plus size={14}/> New plan</button>
      </div>

      {editing && (
        <div className="adm-modal-backdrop" onClick={() => setEditing(null)}>
          <div className="adm-modal p-6" style={{maxWidth: 820}} onClick={(e) => e.stopPropagation()} data-testid="plan-form">
            <div className="flex items-center justify-between mb-4">
              <h2 style={{fontFamily:'Fraunces, serif'}} className="text-xl">{editing === "new" ? "Create a plan" : "Edit plan"}</h2>
              <button className="adm-btn adm-btn-ghost" onClick={() => setEditing(null)}><X size={16}/></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2"><label className="adm-label">Name *</label>
                <input className="adm-input" value={form.name} onChange={set("name")} data-testid="plan-name"/></div>
              <div><label className="adm-label">Sort order</label>
                <input type="number" className="adm-input" value={form.sort_order} onChange={set("sort_order")}/></div>
              <div className="md:col-span-3"><label className="adm-label">Description</label>
                <input className="adm-input" value={form.description} onChange={set("description")}/></div>
              <div><label className="adm-label">Price INR ₹</label>
                <input type="number" className="adm-input" value={form.price_inr} onChange={set("price_inr")} data-testid="plan-inr"/></div>
              <div><label className="adm-label">Price USD $</label>
                <input type="number" className="adm-input" value={form.price_usd} onChange={set("price_usd")} data-testid="plan-usd"/></div>
              <div><label className="adm-label">Validity days</label>
                <input type="number" className="adm-input" value={form.validity_days} onChange={set("validity_days")} data-testid="plan-validity"/></div>
              <div><label className="adm-label">Max sessions</label>
                <input type="number" className="adm-input" value={form.max_sessions} onChange={set("max_sessions")}/></div>
              <div><label className="adm-label">Max msgs/day</label>
                <input type="number" className="adm-input" value={form.max_messages_per_day} onChange={set("max_messages_per_day")}/></div>
              <div><label className="adm-label">Max API keys</label>
                <input type="number" className="adm-input" value={form.max_api_keys} onChange={set("max_api_keys")}/></div>
              <div><label className="adm-label">Max rules</label>
                <input type="number" className="adm-input" value={form.max_rules} onChange={set("max_rules")}/></div>
              <div><label className="adm-label">Max webhooks</label>
                <input type="number" className="adm-input" value={form.max_webhooks} onChange={set("max_webhooks")}/></div>
              <div className="flex items-end">
                <label className="text-[13px] flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.active} onChange={set("active")} data-testid="plan-active"/> Active (shown on pricing page)
                </label>
              </div>

              <div className="md:col-span-3">
                <label className="adm-label">Feature toggles (defaults for this plan)</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {flagDefs.flags.map((f) => (
                    <label key={f.key} className="flex items-center justify-between p-3 rounded-xl border border-[color:var(--adm-border)] hover:border-[color:var(--adm-accent)] cursor-pointer">
                      <div className="text-[13px]">{f.label}</div>
                      <span className="adm-toggle">
                        <input type="checkbox" checked={!!form.feature_flags[f.key]} onChange={(e) => setForm({ ...form, feature_flags: { ...form.feature_flags, [f.key]: e.target.checked } })} data-testid={`plan-flag-${f.key}`}/>
                        <span className="adm-toggle-slider"/>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="md:col-span-3"><label className="adm-label">Features (one per line, marketing text)</label>
                <textarea className="adm-textarea" value={featStr} onChange={(e) => setFeatStr(e.target.value)} data-testid="plan-features"/></div>
            </div>
            <div className="flex gap-3 mt-6">
              <button className="adm-btn adm-btn-primary" onClick={save} disabled={!form.name} data-testid="plan-save"><FloppyDisk size={14}/> Save</button>
              <button className="adm-btn adm-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            </div>
            {err && <div className="mt-3 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{err}</div>}
          </div>
        </div>
      )}

      <div className="adm-card overflow-x-auto adm-table-wrap">
        <table className="adm-table min-w-[820px]">
          <thead>
            <tr>
              <th>Order</th><th>Name</th><th>₹ INR</th><th>$ USD</th><th>Validity</th>
              <th>Sessions</th><th>Msgs/day</th><th>API</th><th>Active</th><th></th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} data-testid={`plan-row-${p.id}`}>
                <td className="mono">{p.sort_order}</td>
                <td className="font-medium">{p.name}</td>
                <td className="mono">{p.price_inr}</td>
                <td className="mono">{p.price_usd}</td>
                <td className="mono">{p.validity_days}d</td>
                <td className="mono">{p.max_sessions}</td>
                <td className="mono">{p.max_messages_per_day}</td>
                <td className="mono">{p.max_api_keys}</td>
                <td>{p.active ? <span className="adm-badge adm-badge-green">ON</span> : <span className="adm-badge adm-badge-red">OFF</span>}</td>
                <td className="text-right whitespace-nowrap">
                  <button className="adm-btn adm-btn-secondary mr-2" onClick={() => startEdit(p)} data-testid={`plan-edit-${p.id}`}><PencilSimple size={12}/></button>
                  <button className="adm-btn adm-btn-danger" onClick={() => del(p.id)}><TrashSimple size={12}/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {plans.length === 0 && <div className="p-8 text-center text-[13px] text-[color:var(--adm-text-3)]">No plans</div>}
      </div>
    </div>
  );
}
