import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Plus, TrashSimple, PencilSimple, FloppyDisk, XCircle } from "@phosphor-icons/react";

const empty = { session_id: "", match_type: "contains", trigger: "", response: "", enabled: true };

export default function Rules() {
  const [rules, setRules] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [editing, setEditing] = useState(null); // rule id or 'new'
  const [form, setForm] = useState(empty);
  const [err, setErr] = useState("");

  async function load() {
    try {
      const [r, s] = await Promise.all([api.get("/rules"), api.get("/sessions")]);
      setRules(r.data.rules || []);
      setSessions(s.data.sessions || []);
    } catch {}
  }
  useEffect(() => { load(); }, []);

  function startNew() {
    setForm({ ...empty, session_id: sessions[0]?.id || "" });
    setEditing("new");
    setErr("");
  }
  function startEdit(r) {
    setForm({
      session_id: r.session_id, match_type: r.match_type,
      trigger: r.trigger, response: r.response, enabled: r.enabled,
    });
    setEditing(r.id);
    setErr("");
  }

  async function save() {
    setErr("");
    try {
      if (editing === "new") {
        await api.post("/rules", form);
      } else {
        await api.put(`/rules/${editing}`, form);
      }
      setEditing(null); load();
    } catch (e) { setErr(formatError(e)); }
  }

  async function del(id) {
    if (!window.confirm("Delete this rule?")) return;
    await api.delete(`/rules/${id}`); load();
  }

  async function toggle(r) {
    await api.put(`/rules/${r.id}`, { ...r, enabled: !r.enabled });
    load();
  }

  return (
    <div className="p-6 md:p-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="mono text-[11px] uppercase tracking-widest text-zinc-500 mb-1">/rules</div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-white">Auto-Reply Rules</h1>
          <p className="text-zinc-400 mt-2 text-sm">Chatbot triggers: when an incoming message matches, the bot replies automatically.</p>
        </div>
        <button className="wa-btn wa-btn-primary" onClick={startNew} data-testid="new-rule-btn"><Plus size={14}/> NEW RULE</button>
      </div>

      {editing && (
        <div className="wa-card p-6 mb-6" data-testid="rule-form">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="wa-label">SESSION</label>
              <select className="wa-select" value={form.session_id} onChange={(e) => setForm({...form, session_id: e.target.value})} data-testid="rule-session">
                <option value="">-- select --</option>
                {sessions.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
              </select>
            </div>
            <div>
              <label className="wa-label">MATCH TYPE</label>
              <select className="wa-select" value={form.match_type} onChange={(e) => setForm({...form, match_type: e.target.value})} data-testid="rule-match-type">
                <option value="contains">contains</option>
                <option value="exact">exact</option>
                <option value="starts_with">starts_with</option>
                <option value="regex">regex</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="wa-label">TRIGGER (keyword / pattern)</label>
              <input className="wa-input" value={form.trigger} onChange={(e) => setForm({...form, trigger: e.target.value})} data-testid="rule-trigger" />
            </div>
          </div>
          <div className="mb-4">
            <label className="wa-label">RESPONSE (what the bot replies)</label>
            <textarea className="wa-textarea" value={form.response} onChange={(e) => setForm({...form, response: e.target.value})} data-testid="rule-response" />
          </div>
          <div className="flex gap-3">
            <button className="wa-btn wa-btn-primary" onClick={save} disabled={!form.session_id || !form.trigger || !form.response} data-testid="rule-save-btn">
              <FloppyDisk size={14}/> SAVE
            </button>
            <button className="wa-btn wa-btn-secondary" onClick={() => setEditing(null)}>
              <XCircle size={14}/> CANCEL
            </button>
          </div>
          {err && <div className="mono text-xs text-red-400 mt-2">ERR: {err}</div>}
        </div>
      )}

      <div className="wa-card overflow-x-auto">
        {rules.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mono text-xs text-zinc-500 uppercase tracking-widest">[ no rules yet ]</div>
          </div>
        ) : (
          <table className="wa-table">
            <thead>
              <tr>
                <th>SESSION</th>
                <th>MATCH</th>
                <th>TRIGGER</th>
                <th>RESPONSE</th>
                <th>ENABLED</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id} data-testid={`rule-row-${r.id}`}>
                  <td className="mono">{r.session_id}</td>
                  <td className="mono text-zinc-400">{r.match_type}</td>
                  <td className="mono text-[#00E559]">{r.trigger}</td>
                  <td className="text-zinc-300 max-w-md truncate">{r.response}</td>
                  <td>
                    <label className="mono text-xs cursor-pointer">
                      <input type="checkbox" checked={r.enabled} onChange={() => toggle(r)} className="mr-2" data-testid={`rule-toggle-${r.id}`}/>
                      {r.enabled ? "ON" : "OFF"}
                    </label>
                  </td>
                  <td className="text-right">
                    <button className="wa-btn wa-btn-secondary mr-2" onClick={() => startEdit(r)} data-testid={`rule-edit-${r.id}`}>
                      <PencilSimple size={12}/>
                    </button>
                    <button className="wa-btn wa-btn-danger" onClick={() => del(r.id)} data-testid={`rule-delete-${r.id}`}>
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
