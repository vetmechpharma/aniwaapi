import React, { useEffect, useState } from "react";
import { api, useRealtime } from "@/lib/api";
import { ArrowsClockwise, Check, Checks } from "@phosphor-icons/react";

function StatusTicks({ status, direction }) {
  if (direction === "incoming") return <span className="mono text-[10px] text-zinc-500">—</span>;
  const s = (status || "pending").toLowerCase();
  if (s === "pending") return <span className="mono text-[10px] text-zinc-500" title="pending">◷</span>;
  if (s === "sent") return <Check size={14} weight="bold" className="text-zinc-400" data-status="sent" />;
  if (s === "delivered") return <Checks size={14} weight="bold" className="text-zinc-400" data-status="delivered" />;
  if (s === "read" || s === "played") return <Checks size={14} weight="bold" className="text-[#3388FF]" data-status="read" />;
  return <span className="mono text-[10px] text-zinc-500">{s}</span>;
}

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [sessionId, setSessionId] = useState("");
  const [direction, setDirection] = useState("");
  const [sessions, setSessions] = useState([]);
  const { subscribe } = useRealtime();

  async function load() {
    const q = new URLSearchParams();
    if (sessionId) q.set("session_id", sessionId);
    if (direction) q.set("direction", direction);
    q.set("limit", "200");
    const { data } = await api.get(`/logs?${q}`);
    setLogs(data.messages || []);
  }
  useEffect(() => {
    api.get("/sessions").then(({ data }) => setSessions(data.sessions || [])).catch(() => {});
  }, []);
  useEffect(() => { load().catch(() => {}); }, [sessionId, direction]);

  useEffect(() => {
    const unsub1 = subscribe("message", (ev) => {
      const m = ev.message;
      if (sessionId && m.session_id !== sessionId) return;
      if (direction && m.direction !== direction) return;
      setLogs((prev) => [m, ...prev].slice(0, 200));
    });
    const unsub2 = subscribe("status", (ev) => {
      setLogs((prev) =>
        prev.map((m) =>
          m.message_id === ev.message_id && m.session_id === ev.session_id
            ? { ...m, status: ev.status }
            : m
        )
      );
    });
    return () => { unsub1(); unsub2(); };
  }, [subscribe, sessionId, direction]);

  return (
    <div className="p-6 md:p-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="mono text-[11px] uppercase tracking-widest text-zinc-500 mb-1">/logs</div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-white">Message Logs</h1>
        </div>
        <button className="wa-btn wa-btn-secondary" onClick={load} data-testid="logs-refresh">
          <ArrowsClockwise size={14}/> REFRESH
        </button>
      </div>

      <div className="flex gap-3 mb-6">
        <select className="wa-select max-w-xs" value={sessionId} onChange={(e) => setSessionId(e.target.value)} data-testid="logs-session-filter">
          <option value="">ALL SESSIONS</option>
          {sessions.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
        </select>
        <select className="wa-select max-w-xs" value={direction} onChange={(e) => setDirection(e.target.value)} data-testid="logs-direction-filter">
          <option value="">BOTH DIRECTIONS</option>
          <option value="incoming">INCOMING</option>
          <option value="outgoing">OUTGOING</option>
        </select>
      </div>

      <div className="wa-card overflow-x-auto">
        {logs.length === 0 ? (
          <div className="p-12 text-center mono text-xs text-zinc-500 uppercase">[ no messages ]</div>
        ) : (
          <table className="wa-table">
            <thead>
              <tr><th>DIR</th><th>TIME</th><th>SESSION</th><th>JID</th><th>NAME</th><th>MEDIA</th><th>STATUS</th><th>TEXT</th></tr>
            </thead>
            <tbody>
              {logs.map(m => (
                <tr key={m.id || `${m.message_id}-${m.timestamp}`} data-testid={`log-row-${m.id || m.message_id}`}>
                  <td className={"mono font-bold " + (m.direction === "incoming" ? "text-[#00E559]" : "text-[#3388FF]")}>
                    {m.direction === "incoming" ? "◀ IN" : "▶ OUT"}
                  </td>
                  <td className="mono text-zinc-500 whitespace-nowrap">{new Date((m.timestamp || 0) * 1000).toLocaleString()}</td>
                  <td className="mono">{m.session_id}</td>
                  <td className="mono text-zinc-400">{m.remote_jid}</td>
                  <td className="mono text-zinc-400">{m.push_name || "—"}</td>
                  <td className="mono text-yellow-500">{m.media_type || "—"}</td>
                  <td><StatusTicks status={m.status} direction={m.direction} /></td>
                  <td className="max-w-md truncate">{m.text || "—"}{m.auto_reply && <span className="wa-badge wa-badge-green ml-2">AUTO{m.auto_reply_kind ? `:${m.auto_reply_kind}` : ""}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
