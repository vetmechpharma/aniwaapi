import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Plus, Copy, TrashSimple, Prohibit, Check } from "@phosphor-icons/react";

export default function ApiKeys() {
  const [keys, setKeys] = useState([]);
  const [availableScopes, setAvailableScopes] = useState([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState([]); // empty = full access
  const [rateLimit, setRateLimit] = useState(60);
  const [newKey, setNewKey] = useState(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    const { data } = await api.get("/api-keys");
    setKeys(data.keys || []);
    setAvailableScopes(data.available_scopes || []);
  }
  useEffect(() => { load().catch(() => {}); }, []);

  function toggleScope(s) {
    setScopes((cur) => cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]);
  }

  async function create() {
    setErr("");
    try {
      const { data } = await api.post("/api-keys", {
        name,
        scopes: scopes.length ? scopes : null, // null = full access
        rate_limit_per_minute: Number(rateLimit) || 0,
      });
      setNewKey(data);
      setName(""); setScopes([]); setRateLimit(60); setCreating(false);
      load();
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
          <p className="text-zinc-400 mt-2 text-sm">Bearer tokens with scopes + rate limits for the public API at <code className="mono text-[#25D366]">/api/v1/*</code>.</p>
        </div>
        <button className="wa-btn wa-btn-primary" onClick={() => setCreating(true)} data-testid="new-key-btn">
          <Plus size={14}/> NEW KEY
        </button>
      </div>

      {creating && (
        <div className="wa-card p-6 mb-6" data-testid="key-form">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="wa-label">KEY NAME (label only)</label>
              <input className="wa-input" placeholder="crm-production" value={name} onChange={(e) => setName(e.target.value)} data-testid="key-name-input" />
            </div>
            <div>
              <label className="wa-label">RATE LIMIT (req/min, 0 = unlimited)</label>
              <input className="wa-input" type="number" min="0" value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} data-testid="key-rate-input" />
            </div>
          </div>

          <div className="mt-4">
            <label className="wa-label">SCOPES (leave all unchecked = full access)</label>
            <div className="flex flex-wrap gap-2">
              {availableScopes.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleScope(s)}
                  className={"wa-btn " + (scopes.includes(s) ? "wa-btn-primary" : "wa-btn-secondary")}
                  data-testid={`key-scope-${s}`}
                >
                  {scopes.includes(s) && <Check size={12}/>} {s}
                </button>
              ))}
            </div>
            <div className="mono text-[10px] text-zinc-500 mt-2">
              {scopes.length === 0
                ? "→ FULL ACCESS (all scopes granted)"
                : `→ ${scopes.length} scope(s) selected`}
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button className="wa-btn wa-btn-primary" onClick={create} disabled={!name} data-testid="key-create-btn">GENERATE</button>
            <button className="wa-btn wa-btn-secondary" onClick={() => setCreating(false)}>CANCEL</button>
          </div>
          {err && <div className="mono text-xs text-red-400 mt-2">ERR: {err}</div>}
        </div>
      )}

      {newKey && (
        <div className="wa-card p-6 mb-6 border-[#25D366]" data-testid="new-key-modal">
          <div className="mono text-xs uppercase tracking-widest text-[#25D366] mb-2">! COPY NOW - shown only once</div>
          <div className="flex items-center gap-3 p-3 bg-black border border-zinc-800">
            <code className="mono text-sm text-[#25D366] break-all flex-1" data-testid="new-key-value">{newKey.key}</code>
            <button
              className="wa-btn wa-btn-secondary shrink-0"
              onClick={async () => { await navigator.clipboard.writeText(newKey.key); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              data-testid="copy-new-key"
            >
              {copied ? <><Check size={14}/> COPIED</> : <><Copy size={14}/> COPY</>}
            </button>
          </div>
          <div className="mono text-[10px] text-zinc-500 mt-3">
            Scopes: <span className="text-white">{(newKey.scopes || []).join(", ") || "full access"}</span> · Rate: <span className="text-white">{newKey.rate_limit_per_minute || "unlimited"}/min</span>
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
          <table className="wa-table min-w-[900px]">
            <thead>
              <tr><th>NAME</th><th>KEY</th><th>SCOPES</th><th>RATE/MIN</th><th>CREATED</th><th>LAST USED</th><th>USAGE</th><th>STATUS</th><th></th></tr>
            </thead>
            <tbody>
              {keys.map(k => (
                <tr key={k.id}>
                  <td className="text-white">{k.name}</td>
                  <td className="mono text-zinc-400">{k.key_masked}</td>
                  <td className="mono text-[10px] text-zinc-400 max-w-xs">
                    {(k.scopes && k.scopes.length) ? k.scopes.join(", ") : <span className="text-[#25D366]">full</span>}
                  </td>
                  <td className="mono">{k.rate_limit_per_minute || <span className="text-zinc-500">∞</span>}</td>
                  <td className="mono text-zinc-500">{new Date(k.created_at).toLocaleDateString()}</td>
                  <td className="mono text-zinc-500">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "—"}</td>
                  <td className="mono">{k.usage_count || 0}</td>
                  <td>{k.revoked ? <span className="wa-badge wa-badge-red">REVOKED</span> : <span className="wa-badge wa-badge-green">ACTIVE</span>}</td>
                  <td className="text-right whitespace-nowrap">
                    {!k.revoked && (
                      <button className="wa-btn wa-btn-secondary mr-2" onClick={() => revoke(k.id)} data-testid={`revoke-key-${k.id}`}>
                        <Prohibit size={12}/> REVOKE
                      </button>
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
