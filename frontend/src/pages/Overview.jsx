import React, { useEffect, useState } from "react";
import { api, useRealtime } from "@/lib/api";
import { ArrowUpRight, Broadcast, ChatCircleDots, PlugsConnected, PaperPlaneTilt, CircleNotch } from "@phosphor-icons/react";
import { Link } from "react-router-dom";

function Stat({ label, value, icon: Icon, testid, sub }) {
  return (
    <div className="wa-card p-6" data-testid={testid}>
      <div className="flex items-start justify-between mb-4">
        <span className="mono text-[11px] uppercase tracking-widest text-zinc-500">{label}</span>
        <Icon size={18} weight="bold" color="#00E559" />
      </div>
      <div className="mono text-4xl font-bold text-white tracking-tight">{value ?? "—"}</div>
      {sub && <div className="mono text-[11px] text-zinc-500 mt-2">{sub}</div>}
    </div>
  );
}

export default function Overview() {
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [sessions, setSessions] = useState([]);
  const { subscribe, connected } = useRealtime();

  async function load() {
    try {
      const [s, l, se] = await Promise.all([
        api.get("/stats"),
        api.get("/logs?limit=10"),
        api.get("/sessions"),
      ]);
      setStats(s.data);
      setLogs(l.data.messages || []);
      setSessions(se.data.sessions || []);
    } catch {}
  }

  useEffect(() => {
    load();
    // Fallback poll every 15s in case WS drops silently
    const t = setInterval(load, 15000);
    const unsub1 = subscribe("message", (ev) => {
      setLogs((prev) => [ev.message, ...prev].slice(0, 10));
      setStats((prev) => prev ? { ...prev, messages_24h: (prev.messages_24h || 0) + 1 } : prev);
    });
    const unsub2 = subscribe("connection", () => { load(); });
    return () => { clearInterval(t); unsub1(); unsub2(); };
  }, [subscribe]);

  return (
    <div className="p-6 md:p-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="mono text-[11px] uppercase tracking-widest text-zinc-500 mb-1 flex items-center gap-3">
            /overview
            <span className={"wa-badge " + (connected ? "wa-badge-green" : "wa-badge-red")} data-testid="ws-status">
              <span className={"wa-pip " + (connected ? "wa-pip-green" : "wa-pip-red")} />
              {connected ? "LIVE" : "OFFLINE"}
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-white">Command Center</h1>
        </div>
        <Link to="/app/sessions" className="wa-btn wa-btn-primary" data-testid="quick-new-session">
          + NEW SESSION <ArrowUpRight size={14} weight="bold" />
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-8">
        <Stat label="Sessions" value={stats?.sessions_count} sub={`${stats?.sessions_connected || 0} connected`} icon={Broadcast} testid="stat-sessions" />
        <Stat label="Msgs (24h)" value={stats?.messages_24h} icon={PaperPlaneTilt} testid="stat-messages" />
        <Stat label="Auto-Reply Rules" value={stats?.rules_count} icon={ChatCircleDots} testid="stat-rules" />
        <Stat label="Webhooks" value={stats?.webhooks_count} icon={PlugsConnected} testid="stat-webhooks" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="wa-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="mono text-xs uppercase tracking-widest text-zinc-500">Active Sessions</div>
            <Link to="/app/sessions" className="mono text-xs text-[#00E559] hover:underline">MANAGE →</Link>
          </div>
          {sessions.length === 0 ? (
            <div className="mono text-xs text-zinc-500 py-6 text-center border border-dashed border-zinc-800">[ NO ACTIVE SESSIONS ]</div>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-2 border-b border-zinc-900">
                  <div className="flex items-center gap-3">
                    <span className={"wa-pip " + (s.ready ? "wa-pip-green" : s.status === "qr" || s.status === "pairing" ? "wa-pip-yellow" : "wa-pip-red")} />
                    <span className="mono text-sm text-white">{s.id}</span>
                  </div>
                  <span className="mono text-[10px] uppercase text-zinc-500">{s.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="wa-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="mono text-xs uppercase tracking-widest text-zinc-500">Recent Messages</div>
            <Link to="/logs" className="mono text-xs text-[#00E559] hover:underline">VIEW ALL →</Link>
          </div>
          {logs.length === 0 ? (
            <div className="mono text-xs text-zinc-500 py-6 text-center border border-dashed border-zinc-800">[ NO MESSAGES YET ]</div>
          ) : (
            <div className="space-y-1">
              {logs.map((m) => (
                <div key={m.id || `${m.session_id}-${m.timestamp}-${m.remote_jid}-${m.text}`} className="mono text-[11px] flex items-center gap-3 py-1 border-b border-zinc-900">
                  <span className={m.direction === "incoming" ? "text-[#00E559]" : "text-[#3388FF]"}>
                    {m.direction === "incoming" ? "◀" : "▶"}
                  </span>
                  <span className="text-zinc-500 shrink-0">{new Date((m.timestamp || 0) * 1000).toLocaleTimeString()}</span>
                  <span className="text-white truncate">{m.text || `[${m.media_type || "media"}]`}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
