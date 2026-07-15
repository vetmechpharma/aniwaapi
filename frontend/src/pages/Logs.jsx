import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ArrowsClockwise } from "@phosphor-icons/react";

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [sessionId, setSessionId] = useState("");
  const [direction, setDirection] = useState("");
  const [sessions, setSessions] = useState([]);

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
              <tr><th>DIR</th><th>TIME</th><th>SESSION</th><th>JID</th><th>NAME</th><th>MEDIA</th><th>TEXT</th></tr>
            </thead>
            <tbody>
              {logs.map(m => (
                <tr key={m.id}>
                  <td className={"mono font-bold " + (m.direction === "incoming" ? "text-[#00E559]" : "text-[#3388FF]")}>
                    {m.direction === "incoming" ? "◀ IN" : "▶ OUT"}
                  </td>
                  <td className="mono text-zinc-500 whitespace-nowrap">{new Date((m.timestamp || 0) * 1000).toLocaleString()}</td>
                  <td className="mono">{m.session_id}</td>
                  <td className="mono text-zinc-400">{m.remote_jid}</td>
                  <td className="mono text-zinc-400">{m.push_name || "—"}</td>
                  <td className="mono text-yellow-500">{m.media_type || "—"}</td>
                  <td className="max-w-md truncate">{m.text || "—"}{m.auto_reply && <span className="wa-badge wa-badge-green ml-2">AUTO</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
