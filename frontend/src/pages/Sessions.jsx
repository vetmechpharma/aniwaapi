import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Plus, X, DeviceMobile, QrCode, Copy, Check } from "@phosphor-icons/react";

function StatusBadge({ status, ready }) {
  const label = (status || "unknown").toUpperCase();
  const cls =
    ready ? "wa-badge-green" :
    status === "qr" || status === "pairing" ? "wa-badge-yellow" :
    status === "connecting" || status === "reconnecting" ? "wa-badge-blue" :
    "wa-badge-red";
  return <span className={"wa-badge " + cls}>{label}</span>;
}

function SessionCard({ s, onDelete, onRefresh }) {
  const [detail, setDetail] = useState(null);
  const [pairing, setPairing] = useState(false);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    try {
      const { data } = await api.get(`/sessions/${s.id}`);
      setDetail(data);
    } catch {}
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [s.id]);

  async function requestPair() {
    if (!phone) return;
    setBusy(true); setErr("");
    try {
      const form = new FormData();
      form.append("phone_number", phone);
      await api.post(`/sessions/${s.id}/pair`, form);
      await load();
    } catch (e) { setErr(formatError(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="wa-card p-5" data-testid={`session-card-${s.id}`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="mono text-[10px] text-zinc-500 uppercase tracking-widest">SESSION_ID</div>
          <div className="mono text-lg font-bold text-white">{s.id}</div>
        </div>
        <StatusBadge status={detail?.status || s.status} ready={detail?.ready ?? s.ready} />
      </div>

      {detail?.me?.id && (
        <div className="mono text-xs text-zinc-400 mb-4">
          <span className="text-zinc-500">CONNECTED_AS:</span> {detail.me.id.split(":")[0]}
        </div>
      )}

      {detail?.qrDataUrl && !detail?.ready && (
        <div className="my-4">
          <div className="mono text-[10px] text-zinc-500 uppercase mb-2">SCAN QR</div>
          <div className="p-2 bg-white inline-block">
            <img src={detail.qrDataUrl} alt="QR" className="w-48 h-48" data-testid={`qr-${s.id}`} />
          </div>
        </div>
      )}

      {detail?.pairingCode && !detail?.ready && (
        <div className="my-4">
          <div className="mono text-[10px] text-zinc-500 uppercase mb-2">PAIRING CODE</div>
          <div className="mono text-2xl font-bold text-[#25D366] tracking-widest" data-testid={`pair-code-${s.id}`}>
            {detail.pairingCode}
          </div>
          <div className="mono text-[10px] text-zinc-500 mt-1">
            Enter in WhatsApp → Linked Devices → Link with phone number
          </div>
        </div>
      )}

      {!detail?.ready && !detail?.qrDataUrl && !detail?.pairingCode && (
        <div className="my-4">
          {!pairing ? (
            <button className="wa-btn wa-btn-secondary" onClick={() => setPairing(true)} data-testid={`pair-toggle-${s.id}`}>
              <DeviceMobile size={14}/> USE PAIRING CODE
            </button>
          ) : (
            <div className="space-y-2">
              <label className="wa-label">PHONE (with country code, digits only)</label>
              <input className="wa-input" placeholder="14155551234" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid={`pair-phone-${s.id}`} />
              <div className="flex gap-2">
                <button className="wa-btn wa-btn-primary" disabled={busy || !phone} onClick={requestPair} data-testid={`pair-request-${s.id}`}>
                  {busy ? "..." : "GET CODE"}
                </button>
                <button className="wa-btn wa-btn-secondary" onClick={() => setPairing(false)}>CANCEL</button>
              </div>
              {err && <div className="mono text-xs text-red-400">ERR: {err}</div>}
            </div>
          )}
          <div className="mono text-[10px] text-zinc-500 mt-3 flex items-center gap-2">
            <QrCode size={12}/> Waiting for connection...
          </div>
        </div>
      )}

      <div className="pt-4 border-t border-zinc-800 flex justify-end">
        <button
          className="wa-btn wa-btn-danger"
          onClick={() => onDelete(s.id)}
          data-testid={`delete-session-${s.id}`}
        >
          <X size={14}/> DELETE
        </button>
      </div>
    </div>
  );
}

export default function Sessions() {
  const [sessions, setSessions] = useState([]);
  const [creating, setCreating] = useState(false);
  const [sid, setSid] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    try {
      const { data } = await api.get("/sessions");
      setSessions(data.sessions || []);
    } catch {}
  }
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, []);

  async function create() {
    setErr("");
    if (!sid.trim()) { setErr("Session ID required"); return; }
    try {
      await api.post("/sessions", { session_id: sid.trim() });
      setSid(""); setCreating(false); load();
    } catch (e) { setErr(formatError(e)); }
  }

  async function del(id) {
    if (!window.confirm(`Delete session ${id}? This logs out the WhatsApp session.`)) return;
    try { await api.delete(`/sessions/${id}`); load(); } catch {}
  }

  return (
    <div className="p-6 md:p-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="mono text-[11px] uppercase tracking-widest text-zinc-500 mb-1">/sessions</div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-white">WhatsApp Sessions</h1>
        </div>
        <button className="wa-btn wa-btn-primary" onClick={() => setCreating(true)} data-testid="new-session-btn">
          <Plus size={14} weight="bold"/> NEW SESSION
        </button>
      </div>

      {creating && (
        <div className="wa-card p-6 mb-6" data-testid="new-session-form">
          <label className="wa-label">SESSION ID (unique name, e.g. "primary" or "sales")</label>
          <div className="flex gap-3">
            <input className="wa-input" value={sid} onChange={(e) => setSid(e.target.value)} placeholder="primary" data-testid="new-session-id-input" />
            <button className="wa-btn wa-btn-primary" onClick={create} data-testid="new-session-create-btn">CREATE</button>
            <button className="wa-btn wa-btn-secondary" onClick={() => setCreating(false)}>CANCEL</button>
          </div>
          {err && <div className="mono text-xs text-red-400 mt-2">ERR: {err}</div>}
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="wa-card p-12 text-center border-dashed" data-testid="sessions-empty">
          <div className="mono text-xs text-zinc-500 uppercase tracking-widest mb-2">[ empty ]</div>
          <div className="text-zinc-400 mb-6">No active WhatsApp sessions.</div>
          <button className="wa-btn wa-btn-primary" onClick={() => setCreating(true)}>
            <Plus size={14}/> CREATE FIRST SESSION
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {sessions.map((s) => (
            <SessionCard key={s.id} s={s} onDelete={del} onRefresh={load} />
          ))}
        </div>
      )}
    </div>
  );
}
