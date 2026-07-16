import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { UserCheck, UserMinus, TrashSimple, Key, Copy, MagnifyingGlass, UserPlus, XCircle, FloppyDisk } from "@phosphor-icons/react";

function StatusPill({ s }) {
  const m = {
    approved: "wa-badge-green", pending: "wa-badge-yellow",
    suspended: "wa-badge-red", deleted: "wa-badge-red",
  };
  return <span className={"wa-badge " + (m[s] || "")}>{(s || "").toUpperCase()}</span>;
}

const emptyNew = {
  email: "", password: "", name: "", company: "",
  phone: "", alt_phone: "", location: "",
  role: "user", status: "approved",
  plan_id: "", validity_days: "",
};

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState(null);
  const [linkModal, setLinkModal] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [nf, setNf] = useState(emptyNew);
  const [addErr, setAddErr] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  async function load() {
    try {
      const [u, p] = await Promise.all([api.get("/admin/users"), api.get("/admin/plans")]);
      setUsers(u.data.users || []);
      setPlans(p.data.plans || []);
    } catch (e) { setMsg("ERR: " + formatError(e)); }
  }
  useEffect(() => { load(); }, []);

  async function act(uid, path, method = "post", body = null) {
    try {
      if (method === "delete") await api.delete(`/admin/users/${uid}`);
      else await api.post(`/admin/users/${uid}/${path}`, body || {});
      load();
    } catch (e) { setMsg("ERR: " + formatError(e)); }
  }
  async function suspend(uid) {
    const reason = window.prompt("Reason for suspension (shown to user on login):", "");
    if (reason === null) return;
    await act(uid, "suspend", "post", { reason });
  }
  async function resetLink(uid, u) {
    try {
      const { data } = await api.post(`/admin/users/${uid}/reset-link`, {});
      setLinkModal({ user: u, token: data.token, path: data.reset_path, expires_at: data.expires_at });
    } catch (e) { setMsg("ERR: " + formatError(e)); }
  }
  async function delUser(uid) {
    if (!window.confirm("Delete user? All their sessions, rules, keys and messages will be removed.")) return;
    await act(uid, "", "delete");
  }

  const setN = (k) => (e) => setNf({ ...nf, [k]: e.target.value });
  async function createUser(e) {
    e?.preventDefault?.();
    setAddErr(""); setAddBusy(true);
    try {
      const body = { ...nf };
      if (!body.plan_id) delete body.plan_id;
      if (!body.validity_days) delete body.validity_days;
      else body.validity_days = Number(body.validity_days);
      await api.post("/admin/users", body);
      setAddOpen(false); setNf(emptyNew); load();
    } catch (e) { setAddErr(formatError(e)); }
    finally { setAddBusy(false); }
  }

  const filtered = users.filter(u => {
    if (!q) return true;
    const s = `${u.email} ${u.name} ${u.company} ${u.phone}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  return (
    <div className="p-6 md:p-10">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="mono text-[11px] uppercase tracking-widest text-zinc-500 mb-1">/admin/users</div>
          <h1 className="text-3xl md:text-4xl font-semibold text-white">Users Management</h1>
        </div>
        <div className="flex items-center gap-2">
          <MagnifyingGlass size={16} className="text-zinc-500"/>
          <input className="wa-input max-w-xs" placeholder="search email / name..." value={q} onChange={(e) => setQ(e.target.value)} data-testid="users-search"/>
          <button className="wa-btn wa-btn-primary" onClick={() => { setNf(emptyNew); setAddOpen(true); }} data-testid="add-user-btn">
            <UserPlus size={14}/> ADD USER
          </button>
        </div>
      </div>

      {msg && <div className="wa-card p-3 mb-4 mono text-xs text-red-400">{msg}</div>}

      {addOpen && (
        <div className="wa-card p-6 mb-6" data-testid="add-user-form">
          <div className="flex items-center justify-between mb-4">
            <div className="mono text-sm uppercase text-white flex items-center gap-2"><UserPlus size={16} color="#25D366"/> Add User Manually</div>
            <button className="wa-btn wa-btn-secondary" onClick={() => setAddOpen(false)}><XCircle size={12}/></button>
          </div>
          <form onSubmit={createUser} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className="wa-label">EMAIL *</label>
              <input required type="email" className="wa-input" value={nf.email} onChange={setN("email")} data-testid="new-email"/></div>
            <div><label className="wa-label">PASSWORD * (min 6)</label>
              <input required type="password" minLength={6} className="wa-input" value={nf.password} onChange={setN("password")} data-testid="new-password"/></div>
            <div><label className="wa-label">FULL NAME *</label>
              <input required className="wa-input" value={nf.name} onChange={setN("name")} data-testid="new-name"/></div>
            <div><label className="wa-label">COMPANY</label>
              <input className="wa-input" value={nf.company} onChange={setN("company")}/></div>
            <div><label className="wa-label">PHONE *</label>
              <input required className="wa-input" value={nf.phone} onChange={setN("phone")}/></div>
            <div><label className="wa-label">ALT PHONE</label>
              <input className="wa-input" value={nf.alt_phone} onChange={setN("alt_phone")}/></div>
            <div className="md:col-span-3"><label className="wa-label">LOCATION</label>
              <input className="wa-input" value={nf.location} onChange={setN("location")}/></div>
            <div><label className="wa-label">ROLE</label>
              <select className="wa-select" value={nf.role} onChange={setN("role")} data-testid="new-role">
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <div><label className="wa-label">STATUS</label>
              <select className="wa-select" value={nf.status} onChange={setN("status")} data-testid="new-status">
                <option value="approved">approved</option>
                <option value="pending">pending</option>
                <option value="suspended">suspended</option>
              </select>
            </div>
            <div><label className="wa-label">ASSIGN PLAN (optional)</label>
              <select className="wa-select" value={nf.plan_id} onChange={setN("plan_id")} data-testid="new-plan">
                <option value="">-- none --</option>
                {plans.map(p => <option key={p.id} value={p.id}>{p.name} ({p.validity_days}d)</option>)}
              </select>
            </div>
            {nf.plan_id && (
              <div className="md:col-span-3"><label className="wa-label">OVERRIDE VALIDITY DAYS (optional)</label>
                <input type="number" className="wa-input" placeholder="uses plan default if empty" value={nf.validity_days} onChange={setN("validity_days")}/></div>
            )}
            <div className="md:col-span-3 flex gap-3 mt-2">
              <button type="submit" disabled={addBusy} className="wa-btn wa-btn-primary" data-testid="new-save"><FloppyDisk size={12}/> CREATE USER</button>
              <button type="button" className="wa-btn wa-btn-secondary" onClick={() => setAddOpen(false)}>CANCEL</button>
            </div>
            {addErr && <div className="md:col-span-3 mono text-xs text-red-400">ERR: {addErr}</div>}
          </form>
        </div>
      )}

      {linkModal && (
        <div className="wa-card p-6 mb-6 border-[#25D366]" data-testid="reset-link-modal">
          <div className="mono text-xs uppercase text-[#25D366] mb-2">! COPY THIS RESET LINK for {linkModal.user.email}</div>
          <div className="mono text-[11px] text-zinc-500 mb-3">Valid for 24h. Share via WhatsApp / SMS / email.</div>
          <div className="p-3 bg-black border border-zinc-800 flex items-center gap-2">
            <code className="mono text-xs text-[#25D366] break-all flex-1" data-testid="reset-link-value">
              {window.location.origin}{linkModal.path}
            </code>
            <button className="wa-btn wa-btn-secondary shrink-0" onClick={() => navigator.clipboard.writeText(`${window.location.origin}${linkModal.path}`)}>
              <Copy size={14}/> COPY
            </button>
          </div>
          <button className="wa-btn wa-btn-primary mt-4" onClick={() => setLinkModal(null)}>DONE</button>
        </div>
      )}

      <div className="wa-card overflow-x-auto">
        <table className="wa-table">
          <thead>
            <tr><th>EMAIL</th><th>NAME</th><th>COMPANY</th><th>PHONE</th><th>LOCATION</th><th>PLAN</th><th>EXPIRES</th><th>STATUS</th><th>REG</th><th></th></tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id} data-testid={`user-row-${u.id}`}>
                <td className="mono text-white">{u.email}</td>
                <td>{u.name}</td>
                <td className="text-zinc-400">{u.company || "—"}</td>
                <td className="mono text-zinc-400">{u.phone || "—"}{u.alt_phone && <div className="text-[10px] text-zinc-600">alt: {u.alt_phone}</div>}</td>
                <td className="text-zinc-400 text-sm">{u.location || "—"}</td>
                <td className="mono text-[#25D366]">{u.plan_name || "—"}</td>
                <td className="mono text-zinc-400 text-xs">{u.subscription_expires_at ? new Date(u.subscription_expires_at).toLocaleDateString() : "—"}</td>
                <td><StatusPill s={u.status}/></td>
                <td className="mono text-zinc-500 text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="text-right whitespace-nowrap">
                  {u.status === "pending" && <button className="wa-btn wa-btn-primary mr-1" onClick={() => act(u.id, "approve")} data-testid={`approve-${u.id}`}><UserCheck size={12}/> APPROVE</button>}
                  {u.status === "approved" && u.role !== "admin" && <button className="wa-btn wa-btn-secondary mr-1" onClick={() => suspend(u.id)} data-testid={`suspend-${u.id}`}><UserMinus size={12}/> SUSPEND</button>}
                  {u.status === "suspended" && <button className="wa-btn wa-btn-primary mr-1" onClick={() => act(u.id, "unsuspend")} data-testid={`unsuspend-${u.id}`}>UNSUSPEND</button>}
                  <button className="wa-btn wa-btn-secondary mr-1" onClick={() => resetLink(u.id, u)} data-testid={`resetlink-${u.id}`}><Key size={12}/></button>
                  {u.role !== "admin" && <button className="wa-btn wa-btn-danger" onClick={() => delUser(u.id)} data-testid={`delete-${u.id}`}><TrashSimple size={12}/></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="p-8 text-center mono text-xs text-zinc-500">[ no users ]</div>}
      </div>
    </div>
  );
}
