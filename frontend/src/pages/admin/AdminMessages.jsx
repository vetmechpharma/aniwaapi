import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Envelope, TrashSimple, Check, ChatCircleDots } from "@phosphor-icons/react";

export default function AdminMessages() {
  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");

  async function load() {
    try { const { data } = await api.get("/admin/messages"); setItems(data.messages || []); }
    catch (e) { setErr(formatError(e)); }
  }
  useEffect(() => { load(); }, []);

  async function markRead(id) { await api.post(`/admin/messages/${id}/mark-read`); load(); }
  async function del(id) { if (!window.confirm("Delete this message?")) return; await api.delete(`/admin/messages/${id}`); load(); }

  return (
    <div className="p-6 md:p-10">
      <div className="mb-6">
        <div className="mono text-[11px] uppercase tracking-widest text-zinc-500 mb-1">/admin/messages</div>
        <h1 className="text-3xl md:text-4xl font-semibold text-white">Contact Messages</h1>
        <p className="text-zinc-400 mt-2 text-sm">Messages submitted from the public contact form.</p>
      </div>
      {err && <div className="wa-card p-3 mb-4 mono text-xs text-red-400">{err}</div>}

      {items.length === 0 ? (
        <div className="wa-card p-12 text-center mono text-xs text-zinc-500 uppercase">[ no messages ]</div>
      ) : (
        <div className="space-y-3">
          {items.map(m => (
            <div key={m.id} className={"wa-card p-5 " + (m.status === "new" ? "border-[#00E559]" : "")} data-testid={`message-${m.id}`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="mono text-sm text-white flex items-center gap-2">
                    <ChatCircleDots size={14} className="text-[#00E559]"/> {m.name}
                    {m.status === "new" && <span className="wa-badge wa-badge-green">NEW</span>}
                  </div>
                  <div className="mono text-xs text-zinc-400 mt-1">
                    <a href={`mailto:${m.email}`} className="hover:text-[#00E559]">{m.email}</a>
                    {m.phone && <> · <a href={`tel:${m.phone}`} className="hover:text-[#00E559]">{m.phone}</a></>}
                  </div>
                </div>
                <div className="mono text-[11px] text-zinc-500">{new Date(m.created_at).toLocaleString()}</div>
              </div>
              {m.subject && <div className="mono text-xs text-zinc-500 mb-2">Subject: <span className="text-white">{m.subject}</span></div>}
              <div className="text-zinc-300 whitespace-pre-wrap">{m.message}</div>
              <div className="mt-4 pt-4 border-t border-zinc-800 flex gap-2 justify-end">
                {m.status === "new" && <button className="wa-btn wa-btn-secondary" onClick={() => markRead(m.id)}><Check size={12}/> MARK READ</button>}
                <a href={`mailto:${m.email}${m.subject ? `?subject=Re: ${encodeURIComponent(m.subject)}` : ""}`} className="wa-btn wa-btn-primary"><Envelope size={12}/> REPLY</a>
                <button className="wa-btn wa-btn-danger" onClick={() => del(m.id)}><TrashSimple size={12}/></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
