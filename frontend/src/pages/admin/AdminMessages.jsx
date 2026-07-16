import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Envelope, TrashSimple, Check, ChatCircleDots } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function AdminMessages() {
  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");

  async function load() {
    try { const { data } = await api.get("/admin/messages"); setItems(data.messages || []); }
    catch (e) { setErr(formatError(e)); }
  }
  useEffect(() => { load(); }, []);

  async function markRead(id) { await api.post(`/admin/messages/${id}/mark-read`); load(); }
  async function del(id) {
    if (!window.confirm("Delete this message?")) return;
    try { await api.delete(`/admin/messages/${id}`); toast.success("Deleted"); load(); }
    catch (e) { toast.error(formatError(e)); }
  }

  return (
    <div className="p-6 md:p-10 max-w-4xl">
      <div className="mb-6">
        <div className="adm-crumb mb-2">/ admin / messages</div>
        <h1 style={{fontFamily:'Fraunces, serif'}}>Inbox</h1>
        <p className="text-[color:var(--adm-text-2)] mt-1 text-[14px]">Messages submitted through your public contact form.</p>
      </div>
      {err && <div className="adm-card p-3 mb-4 text-[13px] text-red-700 border-red-200 bg-red-50">{err}</div>}

      {items.length === 0 ? (
        <div className="adm-card p-12 text-center text-[13px] text-[color:var(--adm-text-3)]">No messages yet</div>
      ) : (
        <div className="space-y-3">
          {items.map((m) => (
            <div key={m.id} className={"adm-card p-5 " + (m.status === "new" ? "border-[color:var(--adm-accent)]" : "")} data-testid={`message-${m.id}`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <ChatCircleDots size={14} color="#128C7E"/>
                    <div className="font-medium">{m.name}</div>
                    {m.status === "new" && <span className="adm-badge adm-badge-green">NEW</span>}
                  </div>
                  <div className="text-[12px] mono text-[color:var(--adm-text-3)] mt-1">
                    <a href={`mailto:${m.email}`} className="hover:text-[color:var(--adm-accent)]">{m.email}</a>
                    {m.phone && <> · <a href={`tel:${m.phone}`} className="hover:text-[color:var(--adm-accent)]">{m.phone}</a></>}
                  </div>
                </div>
                <div className="text-[11px] mono text-[color:var(--adm-text-3)]">{new Date(m.created_at).toLocaleString()}</div>
              </div>
              {m.subject && <div className="text-[12px] text-[color:var(--adm-text-3)] mb-2">Subject: <span className="text-[color:var(--adm-text)]">{m.subject}</span></div>}
              <div className="text-[color:var(--adm-text)] whitespace-pre-wrap text-[14px] leading-relaxed">{m.message}</div>
              <div className="mt-4 pt-4 border-t border-[color:var(--adm-border)] flex gap-2 justify-end">
                {m.status === "new" && <button className="adm-btn adm-btn-secondary" onClick={() => markRead(m.id)}><Check size={12}/> Mark read</button>}
                <a href={`mailto:${m.email}${m.subject ? `?subject=Re: ${encodeURIComponent(m.subject)}` : ""}`} className="adm-btn adm-btn-primary"><Envelope size={12}/> Reply</a>
                <button className="adm-btn adm-btn-danger" onClick={() => del(m.id)}><TrashSimple size={12}/></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
