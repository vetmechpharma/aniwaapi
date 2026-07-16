import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Plus, TrashSimple, PencilSimple, FloppyDisk, XCircle, Clock, Check } from "@phosphor-icons/react";

const empty = { session_id: "", match_type: "contains", trigger: "", response: "", enabled: true };
const emptyBH = {
  enabled: false, timezone: "UTC",
  days: [0, 1, 2, 3, 4], start_time: "09:00", end_time: "18:00",
  fallback_message: "Thanks for your message! We are currently offline. We'll get back to you during business hours.",
  also_use_rules_outside: true,
};

const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const COMMON_TZS = ["UTC", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Australia/Sydney"];

function BusinessHoursPanel({ sessionId }) {
  const [bh, setBh] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!sessionId) { setBh(null); return; }
    api.get(`/business-hours/${sessionId}`).then(({ data }) => setBh(data)).catch(() => setBh({ ...emptyBH, session_id: sessionId }));
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div className="wa-card p-6 mb-6" data-testid="business-hours-empty">
        <div className="flex items-center gap-2 mb-2">
          <Clock size={16} color="#25D366"/>
          <div className="mono text-xs uppercase tracking-widest text-white">Business Hours</div>
        </div>
        <div className="mono text-[11px] text-zinc-500">Select a session below (or create one) to configure business hours for it.</div>
      </div>
    );
  }

  function toggleDay(d) {
    setBh((cur) => {
      const set = new Set(cur.days || []);
      if (set.has(d)) set.delete(d); else set.add(d);
      return { ...cur, days: Array.from(set).sort() };
    });
  }

  async function save() {
    setBusy(true); setErr(""); setSaved(false);
    try {
      const { data } = await api.put(`/business-hours/${sessionId}`, {
        enabled: bh.enabled, timezone: bh.timezone, days: bh.days,
        start_time: bh.start_time, end_time: bh.end_time,
        fallback_message: bh.fallback_message,
        also_use_rules_outside: bh.also_use_rules_outside,
      });
      setBh(data);
      setSaved(true); setTimeout(() => setSaved(false), 1500);
    } catch (e) { setErr(formatError(e)); }
    finally { setBusy(false); }
  }

  if (!bh) return null;

  return (
    <div className="wa-card p-6 mb-6" data-testid={`business-hours-${sessionId}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock size={16} color="#25D366"/>
          <div className="mono text-xs uppercase tracking-widest text-white">Business Hours — <span className="text-[#25D366]">{sessionId}</span></div>
        </div>
        <label className="mono text-xs cursor-pointer flex items-center gap-2">
          <input type="checkbox" checked={!!bh.enabled} onChange={(e) => setBh({ ...bh, enabled: e.target.checked })} data-testid="bh-enabled"/>
          {bh.enabled ? "ENABLED" : "DISABLED"}
        </label>
      </div>

      <div className="mono text-[11px] text-zinc-500 mb-4">
        When ENABLED: no auto-reply during business hours (a human is handling chats).
        Outside business hours: fallback message is sent (and optionally keyword rules still fire).
      </div>

      <div className={"space-y-4 " + (bh.enabled ? "" : "opacity-60 pointer-events-none")}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="wa-label">TIMEZONE</label>
            <select className="wa-select" value={bh.timezone} onChange={(e) => setBh({ ...bh, timezone: e.target.value })} data-testid="bh-timezone">
              {COMMON_TZS.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              {!COMMON_TZS.includes(bh.timezone) && <option value={bh.timezone}>{bh.timezone}</option>}
            </select>
          </div>
          <div>
            <label className="wa-label">OPEN AT</label>
            <input type="time" className="wa-input" value={bh.start_time} onChange={(e) => setBh({ ...bh, start_time: e.target.value })} data-testid="bh-start"/>
          </div>
          <div>
            <label className="wa-label">CLOSE AT</label>
            <input type="time" className="wa-input" value={bh.end_time} onChange={(e) => setBh({ ...bh, end_time: e.target.value })} data-testid="bh-end"/>
          </div>
        </div>

        <div>
          <label className="wa-label">WORKING DAYS</label>
          <div className="flex gap-2 flex-wrap">
            {DAY_LABELS.map((d, i) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(i)}
                className={"wa-btn " + ((bh.days || []).includes(i) ? "wa-btn-primary" : "wa-btn-secondary")}
                data-testid={`bh-day-${i}`}
              >{d}</button>
            ))}
          </div>
        </div>

        <div>
          <label className="wa-label">FALLBACK MESSAGE (sent outside business hours)</label>
          <textarea className="wa-textarea" value={bh.fallback_message} onChange={(e) => setBh({ ...bh, fallback_message: e.target.value })} data-testid="bh-fallback"/>
        </div>

        <label className="mono text-xs cursor-pointer flex items-center gap-2">
          <input type="checkbox" checked={!!bh.also_use_rules_outside} onChange={(e) => setBh({ ...bh, also_use_rules_outside: e.target.checked })} data-testid="bh-use-rules-outside"/>
          Also match keyword rules outside business hours (rule wins over fallback if matched)
        </label>
      </div>

      <div className="flex gap-3 mt-6">
        <button className="wa-btn wa-btn-primary" onClick={save} disabled={busy} data-testid="bh-save">
          {saved ? <><Check size={14}/> SAVED</> : <><FloppyDisk size={14}/> {busy ? "SAVING..." : "SAVE BUSINESS HOURS"}</>}
        </button>
      </div>
      {err && <div className="mono text-xs text-red-400 mt-2">ERR: {err}</div>}
    </div>
  );
}

export default function Rules() {
  const [rules, setRules] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedSid, setSelectedSid] = useState("");
  const [editing, setEditing] = useState(null); // rule id or 'new'
  const [form, setForm] = useState(empty);
  const [err, setErr] = useState("");

  async function load() {
    try {
      const [r, s] = await Promise.all([api.get("/rules"), api.get("/sessions")]);
      const list = s.data.sessions || [];
      setRules(r.data.rules || []);
      setSessions(list);
      if (!selectedSid && list[0]) setSelectedSid(list[0].id);
    } catch {}
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function startNew() { setForm({ ...empty, session_id: selectedSid || sessions[0]?.id || "" }); setEditing("new"); setErr(""); }
  function startEdit(r) {
    setForm({ session_id: r.session_id, match_type: r.match_type, trigger: r.trigger, response: r.response, enabled: r.enabled });
    setEditing(r.id); setErr("");
  }

  async function save() {
    setErr("");
    try {
      if (editing === "new") await api.post("/rules", form);
      else await api.put(`/rules/${editing}`, form);
      setEditing(null); load();
    } catch (e) { setErr(formatError(e)); }
  }
  async function del(id) { if (!window.confirm("Delete this rule?")) return; await api.delete(`/rules/${id}`); load(); }
  async function toggle(r) { await api.put(`/rules/${r.id}`, { ...r, enabled: !r.enabled }); load(); }

  const filteredRules = selectedSid ? rules.filter(r => r.session_id === selectedSid) : rules;

  return (
    <div className="p-6 md:p-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="mono text-[11px] uppercase tracking-widest text-zinc-500 mb-1">/rules</div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-white">Auto-Reply Engine</h1>
          <p className="text-zinc-400 mt-2 text-sm">Configure business hours + keyword-based auto-replies per session.</p>
        </div>
        <button className="wa-btn wa-btn-primary" onClick={startNew} disabled={sessions.length === 0} data-testid="new-rule-btn">
          <Plus size={14}/> NEW RULE
        </button>
      </div>

      <div className="mb-6">
        <label className="wa-label">SELECT SESSION</label>
        <select className="wa-select max-w-md" value={selectedSid} onChange={(e) => setSelectedSid(e.target.value)} data-testid="rules-session-select">
          <option value="">-- select a session --</option>
          {sessions.map(s => <option key={s.id} value={s.id}>{s.id}{s.ready ? " (connected)" : ""}</option>)}
        </select>
      </div>

      <BusinessHoursPanel sessionId={selectedSid}/>

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
        {filteredRules.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mono text-xs text-zinc-500 uppercase tracking-widest">[ no rules{selectedSid ? ` for ${selectedSid}` : ""} ]</div>
          </div>
        ) : (
          <table className="wa-table min-w-[820px]">
            <thead>
              <tr>
                <th>SESSION</th><th>MATCH</th><th>TRIGGER</th><th>RESPONSE</th><th>ENABLED</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filteredRules.map(r => (
                <tr key={r.id} data-testid={`rule-row-${r.id}`}>
                  <td className="mono">{r.session_id}</td>
                  <td className="mono text-zinc-400">{r.match_type}</td>
                  <td className="mono text-[#25D366]">{r.trigger}</td>
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
