import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Plus, TrashSimple, Flask, FloppyDisk } from "@phosphor-icons/react";

const empty = { session_id: "", url: "", enabled: true };

export default function Webhooks() {
  const [items, setItems] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [form, setForm] = useState(empty);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    const [w, s] = await Promise.all([api.get("/webhooks"), api.get("/sessions")]);
    setItems(w.data.webhooks || []); setSessions(s.data.sessions || []);
  }
  useEffect(() => { load().catch(() => {}); }, []);

  async function create() {
    setErr("");
    try { await api.post("/webhooks", form); setForm(empty); setCreating(false); load(); }
    catch (e) { setErr(formatError(e)); }
  }
  async function toggle(w) { await api.put(`/webhooks/${w.id}`, { session_id: w.session_id, url: w.url, enabled: !w.enabled }); load(); }
  async function del(id) { if (!window.confirm("Delete webhook?")) return; await api.delete(`/webhooks/${id}`); load(); }
  async function test(id) { const { data } = await api.post(`/webhooks/${id}/test`); alert(`Test result: ${data.status}`); load(); }

  return (
    <div className="p-6 md:p-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="mono text-[11px] uppercase tracking-widest text-zinc-500 mb-1">/webhooks</div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-white">Webhooks</h1>
          <p className="text-zinc-400 mt-2 text-sm">Forward incoming messages to your own server / CRM.</p>
        </div>
        <button className="wa-btn wa-btn-primary" onClick={() => { setCreating(true); setForm({ ...empty, session_id: sessions[0]?.id || "" }); }} data-testid="new-webhook-btn">
          <Plus size={14}/> NEW WEBHOOK
        </button>
      </div>

      {creating && (
        <div className="wa-card p-6 mb-6" data-testid="webhook-form">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="wa-label">SESSION</label>
              <select className="wa-select" value={form.session_id} onChange={(e) => setForm({...form, session_id: e.target.value})} data-testid="webhook-session">
                <option value="">-- select --</option>
                {sessions.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="wa-label">URL</label>
              <input className="wa-input" placeholder="https://your-crm.example.com/wa-hook" value={form.url} onChange={(e) => setForm({...form, url: e.target.value})} data-testid="webhook-url" />
            </div>
          </div>
          <div className="flex gap-3">
            <button className="wa-btn wa-btn-primary" onClick={create} disabled={!form.session_id || !form.url} data-testid="webhook-save-btn">
              <FloppyDisk size={14}/> SAVE
            </button>
            <button className="wa-btn wa-btn-secondary" onClick={() => setCreating(false)}>CANCEL</button>
          </div>
          {err && <div className="mono text-xs text-red-400 mt-2">ERR: {err}</div>}
        </div>
      )}

      <div className="wa-card overflow-x-auto">
        {items.length === 0 ? (
          <div className="p-12 text-center mono text-xs text-zinc-500 uppercase">[ no webhooks configured ]</div>
        ) : (
          <table className="wa-table min-w-[820px]">
            <thead>
              <tr><th>SESSION</th><th>URL</th><th>LAST FIRED</th><th>LAST STATUS</th><th>ENABLED</th><th></th></tr>
            </thead>
            <tbody>
              {items.map(w => (
                <tr key={w.id}>
                  <td className="mono">{w.session_id}</td>
                  <td className="mono text-[#25D366] truncate max-w-xs">{w.url}</td>
                  <td className="mono text-zinc-500">{w.last_fired_at ? new Date(w.last_fired_at).toLocaleString() : "—"}</td>
                  <td className="mono text-zinc-400">{w.last_status || "—"}</td>
                  <td>
                    <label className="mono text-xs cursor-pointer">
                      <input type="checkbox" checked={w.enabled} onChange={() => toggle(w)} className="mr-2"/>
                      {w.enabled ? "ON" : "OFF"}
                    </label>
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button className="wa-btn wa-btn-secondary mr-2" onClick={() => test(w.id)} data-testid={`webhook-test-${w.id}`}>
                      <Flask size={12}/> TEST
                    </button>
                    <button className="wa-btn wa-btn-danger" onClick={() => del(w.id)}>
                      <TrashSimple size={12}/>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
