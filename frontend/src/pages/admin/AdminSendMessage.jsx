import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { PaperPlaneRight, User as UserIcon, Broadcast, CheckCircle, Info } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function AdminSendMessage() {
  const [sessions, setSessions] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  async function load() {
    try {
      const { data } = await api.get("/admin/user-sessions");
      setSessions(data.sessions || []);
      if ((data.sessions || []).length && selectedIdx === -1) {
        // pick first "ready" session automatically
        const readyIdx = data.sessions.findIndex((s) => s.ready);
        setSelectedIdx(readyIdx >= 0 ? readyIdx : 0);
      }
    } catch (e) { setErr(formatError(e)); }
  }
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = sessions[selectedIdx];

  async function send() {
    setResult(null); setErr("");
    if (!selected) { setErr("Pick a session"); return; }
    if (!selected.ready) { setErr("Session is not connected yet. Wait for it to be ready."); return; }
    if (!to.trim() || !text.trim()) { setErr("Enter a recipient number and a message"); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/admin/send/text", {
        user_id: selected.owner_id, session_slug: selected.slug,
        to: to.trim(), text,
      });
      setResult(data);
      toast.success("Message sent");
      setText("");
    } catch (e) { setErr(formatError(e)); }
    finally { setBusy(false); }
  }

  const readyCount = useMemo(() => sessions.filter((s) => s.ready).length, [sessions]);

  return (
    <div className="p-6 md:p-10 max-w-4xl">
      <div className="mb-6">
        <div className="adm-crumb mb-2">/ admin / send</div>
        <h1 style={{fontFamily:'Fraunces, serif'}}>Send a WhatsApp message</h1>
        <p className="text-[color:var(--adm-text-2)] mt-1 text-[14px]">
          Send from any user's connected WhatsApp number, right here.
        </p>
      </div>

      <div className="adm-card p-6 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="adm-crumb">Choose a session</div>
            <div className="text-[12px] text-[color:var(--adm-text-3)] mt-1">{readyCount} of {sessions.length} sessions are ready.</div>
          </div>
          <button className="adm-btn adm-btn-ghost" onClick={load} data-testid="refresh-sessions">Refresh</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sessions.length === 0 && <div className="col-span-2 text-[13px] text-[color:var(--adm-text-3)]">No sessions exist yet.</div>}
          {sessions.map((s, i) => {
            const active = i === selectedIdx;
            return (
              <button
                key={s.owner_id + "_" + s.slug}
                onClick={() => setSelectedIdx(i)}
                className={"text-left p-4 rounded-xl border transition-all " + (active
                  ? "border-[color:var(--adm-accent)] bg-[color:var(--adm-accent-soft)]"
                  : "border-[color:var(--adm-border)] bg-white hover:border-[color:var(--adm-border-strong)]")}
                data-testid={`session-card-${s.owner_id}-${s.slug}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Broadcast size={16} weight="bold" color={s.ready ? "#128C7E" : "#9CA3AF"}/>
                    <div className="font-medium truncate">{s.slug}</div>
                  </div>
                  <span className={"adm-badge " + (s.ready ? "adm-badge-green" : "adm-badge-gray")}>
                    {s.ready ? "READY" : (s.status || "unknown").toUpperCase()}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[12px] text-[color:var(--adm-text-2)]">
                  <UserIcon size={12}/>
                  <span className="truncate">{s.owner_email}</span>
                </div>
                {s.me && <div className="mt-1 text-[11px] mono text-[color:var(--adm-text-3)]">{typeof s.me === "string" ? s.me : (s.me.id || s.me.name || JSON.stringify(s.me))}</div>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="adm-card p-6">
        <div className="adm-crumb mb-3">Compose</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="adm-label">Recipient (phone or JID)</label>
            <input className="adm-input" placeholder="+91XXXXXXXXXX or 91XXXXXXXXXX@s.whatsapp.net" value={to} onChange={(e) => setTo(e.target.value)} data-testid="send-to"/>
            <div className="text-[11px] text-[color:var(--adm-text-3)] mt-1">Include country code. Group JIDs also work (…@g.us).</div>
          </div>
          <div>
            <label className="adm-label">From</label>
            <div className="adm-input" style={{background:"#F9FAFB",cursor:"default",display:"flex",alignItems:"center"}} data-testid="send-from">
              {selected ? `${selected.owner_email} • ${selected.slug}` : "Pick a session above"}
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="adm-label">Message</label>
            <textarea className="adm-textarea" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your message..." data-testid="send-text"/>
          </div>
        </div>

        {err && <div className="mt-4 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-3" data-testid="send-error">{err}</div>}
        {result && (
          <div className="mt-4 flex items-start gap-3 p-4 rounded-xl bg-[color:var(--adm-accent-soft)] border border-[color:var(--adm-border)]" data-testid="send-success">
            <CheckCircle size={22} color="#128C7E" weight="fill"/>
            <div className="text-[13px]">
              <div className="font-medium">Message sent</div>
              <div className="text-[12px] mono text-[color:var(--adm-text-3)] mt-1">JID: {result.jid} · ID: {result.messageId}</div>
            </div>
          </div>
        )}
        <div className="flex gap-2 mt-6">
          <button className="adm-btn adm-btn-primary" onClick={send} disabled={busy || !selected} data-testid="send-submit">
            <PaperPlaneRight size={14}/> {busy ? "Sending..." : "Send message"}
          </button>
        </div>
        <div className="mt-6 p-4 rounded-xl bg-blue-50 border border-blue-200 flex items-start gap-3">
          <Info size={18} color="#1E40AF" weight="bold" className="shrink-0 mt-0.5"/>
          <div className="text-[13px] text-blue-900">
            This is logged in the session owner's message history and marked as an admin action.
          </div>
        </div>
      </div>
    </div>
  );
}
