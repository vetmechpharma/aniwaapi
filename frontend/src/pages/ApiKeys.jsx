import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Plus, Copy, TrashSimple, Prohibit, Check } from "@phosphor-icons/react";

export default function ApiKeys() {
  const [keys, setKeys] = useState([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState(null); // { key, name }
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");

  async function load() { const { data } = await api.get("/api-keys"); setKeys(data.keys || []); }
  useEffect(() => { load().catch(() => {}); }, []);

  async function create() {
    setErr("");
    try {
      const { data } = await api.post("/api-keys", { name });
      setNewKey(data); setName(""); setCreating(false); load();
    } catch (e) { setErr(formatError(e)); }
  }
  async function revoke(id) {
    if (!window.confirm("Revoke this key? Requests using it will fail.")) return;
    await api.post(`/api-keys/${id}/revoke`); load();
  }
  async function del(id) {
    if (!window.confirm("Permanently delete this key record?")) return;
    await api.delete(`/api-keys/${id}`); load();
  }

  return (
    <div className="p-6 md:p-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="mono text-[11px] uppercase tracking-widest text-zinc-500 mb-1">/api-keys</div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-white">API Keys</h1>
          <p className="text-zinc-400 mt-2 text-sm">Bearer tokens for the public API at <code className="mono text-[#00E559]">/api/v1/*</code>. Use them from your CRM or scripts.</p>
        </div>
        <button className="wa-btn wa-btn-primary" onClick={() => setCreating(true)} data-testid="new-key-btn">
          <Plus size={14}/> NEW KEY
        </button>
      </div>

      {creating && (
        <div className="wa-card p-6 mb-6" data-testid="key-form">
          <label className="wa-label">KEY NAME (label only)</label>
          <div className="flex gap-3">
            <input className="wa-input" placeholder="crm-production" value={name} onChange={(e) => setName(e.target.value)} data-testid="key-name-input" />
            <button className="wa-btn wa-btn-primary" onClick={create} disabled={!name} data-testid="key-create-btn">GENERATE</button>
            <button className="wa-btn wa-btn-secondary" onClick={() => setCreating(false)}>CANCEL</button>
          </div>
          {err && <div className="mono text-xs text-red-400 mt-2">ERR: {err}</div>}
        </div>
      )}

      {newKey && (
        <div className="wa-card p-6 mb-6 border-[#00E559]" data-testid="new-key-modal">
          <div className="mono text-xs uppercase tracking-widest text-[#00E559] mb-2">! COPY NOW - shown only once</div>
          <div className="flex items-center gap-3 p-3 bg-black border border-zinc-800">
            <code className="mono text-sm text-[#00E559] break-all flex-1" data-testid="new-key-value">{newKey.key}</code>
            <button
              className="wa-btn wa-btn-secondary shrink-0"
              onClick={async () => { await navigator.clipboard.writeText(newKey.key); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              data-testid="copy-new-key"
            >
              {copied ? <><Check size={14}/> COPIED</> : <><Copy size={14}/> COPY</>}
            </button>
          </div>
          <div className="flex justify-end mt-4">
            <button className="wa-btn wa-btn-primary" onClick={() => setNewKey(null)} data-testid="close-new-key">DONE</button>
          </div>
        </div>
      )}

      <div className="wa-card overflow-x-auto">
        {keys.length === 0 ? (
          <div className="p-12 text-center mono text-xs text-zinc-500 uppercase">[ no api keys ]</div>
        ) : (
          <table className="wa-table">
            <thead>
              <tr><th>NAME</th><th>KEY</th><th>CREATED</th><th>LAST USED</th><th>USAGE</th><th>STATUS</th><th></th></tr>
            </thead>
            <tbody>
              {keys.map(k => (
                <tr key={k.id}>
                  <td className="text-white">{k.name}</td>
                  <td className="mono text-zinc-400">{k.key_masked}</td>
                  <td className="mono text-zinc-500">{new Date(k.created_at).toLocaleDateString()}</td>
                  <td className="mono text-zinc-500">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "—"}</td>
                  <td className="mono">{k.usage_count || 0}</td>
                  <td>{k.revoked ? <span className="wa-badge wa-badge-red">REVOKED</span> : <span className="wa-badge wa-badge-green">ACTIVE</span>}</td>
                  <td className="text-right whitespace-nowrap">
                    {!k.revoked && (
                      <button className="wa-btn wa-btn-secondary mr-2" onClick={() => revoke(k.id)}><Prohibit size={12}/> REVOKE</button>
                    )}
                    <button className="wa-btn wa-btn-danger" onClick={() => del(k.id)}><TrashSimple size={12}/></button>
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
