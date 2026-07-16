import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { toast } from "sonner";
import {
  UserPlus, MagnifyingGlass, PencilSimple, TrashSimple, Key,
  UserCheck, UserMinus, ShieldStar, X, FloppyDisk, Toolbox, CheckCircle,
  ArrowClockwise, CopySimple,
} from "@phosphor-icons/react";

function StatusBadge({ s }) {
  const m = {
    approved: "adm-badge-green", pending: "adm-badge-yellow",
    suspended: "adm-badge-red", deleted: "adm-badge-red",
  };
  return <span className={"adm-badge " + (m[s] || "adm-badge-gray")}>{(s || "").toUpperCase()}</span>;
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
  const [flagDefs, setFlagDefs] = useState({ flags: [], limits: [], defaults: {} });
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState(null);

  const [addOpen, setAddOpen] = useState(false);
  const [nf, setNf] = useState(emptyNew);
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState("");

  const [editUser, setEditUser] = useState(null);   // user object
  const [pwUser, setPwUser] = useState(null);
  const [featureUser, setFeatureUser] = useState(null);
  const [linkModal, setLinkModal] = useState(null);

  async function load() {
    try {
      const [u, p, ff] = await Promise.all([
        api.get("/admin/users"),
        api.get("/admin/plans"),
        api.get("/admin/feature-flags"),
      ]);
      setUsers(u.data.users || []);
      setPlans(p.data.plans || []);
      setFlagDefs(ff.data || { flags: [], limits: [], defaults: {} });
    } catch (e) { setMsg("ERR: " + formatError(e)); }
  }
  useEffect(() => { load(); }, []);

  async function approve(uid) { try { await api.post(`/admin/users/${uid}/approve`); load(); } catch (e) { toast.error(formatError(e)); } }
  async function unsuspend(uid) { try { await api.post(`/admin/users/${uid}/unsuspend`); load(); } catch (e) { toast.error(formatError(e)); } }
  async function suspend(uid) {
    const reason = window.prompt("Reason for suspension (shown to user on login):", "");
    if (reason === null) return;
    try { await api.post(`/admin/users/${uid}/suspend`, { reason }); load(); } catch (e) { toast.error(formatError(e)); }
  }
  async function delUser(uid) {
    if (!window.confirm("Delete user? All their sessions, rules, keys and messages will be removed.")) return;
    try { await api.delete(`/admin/users/${uid}`); toast.success("User deleted"); load(); } catch (e) { toast.error(formatError(e)); }
  }
  async function resetLink(u) {
    try {
      const { data } = await api.post(`/admin/users/${u.id}/reset-link`, {});
      setLinkModal({ user: u, token: data.token, path: data.reset_path, expires_at: data.expires_at });
    } catch (e) { toast.error(formatError(e)); }
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
      const { data } = await api.post("/admin/users", body);
      if (data.welcome_email_sent) toast.success("User created — welcome email sent");
      else toast.success("User created" + (data.welcome_email_error ? " (email failed: " + data.welcome_email_error + ")" : ""));
      setAddOpen(false); setNf(emptyNew); load();
    } catch (e) { setAddErr(formatError(e)); }
    finally { setAddBusy(false); }
  }

  const filtered = users.filter((u) => {
    if (!q) return true;
    const s = `${u.email} ${u.name} ${u.company} ${u.phone}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  return (
    <div className="p-6 md:p-10">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="adm-crumb mb-2">/ admin / users</div>
          <h1 style={{fontFamily:'Fraunces, serif'}}>Users</h1>
          <p className="text-[color:var(--adm-text-2)] mt-1 text-[14px]">Add, edit, reset passwords and toggle features per user.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--adm-text-3)]"/>
            <input className="adm-input pl-9" placeholder="Search email, name..." value={q} onChange={(e) => setQ(e.target.value)} data-testid="users-search"/>
          </div>
          <button className="adm-btn adm-btn-primary" onClick={() => { setNf(emptyNew); setAddOpen(true); }} data-testid="add-user-btn">
            <UserPlus size={14} weight="bold"/> Add User
          </button>
        </div>
      </div>

      {msg && <div className="adm-card p-3 mb-4 text-[13px] text-red-700 border-red-200 bg-red-50">{msg}</div>}

      {linkModal && (
        <div className="adm-card p-6 mb-6 border-[color:var(--adm-accent)]" data-testid="reset-link-modal">
          <div className="text-[13px] text-[color:var(--adm-accent)] font-medium mb-1">Reset link for {linkModal.user.email}</div>
          <div className="text-[12px] text-[color:var(--adm-text-3)] mb-3">Valid for 24h. Share via WhatsApp, SMS or email.</div>
          <div className="p-3 bg-[color:var(--adm-accent-soft)] border border-[color:var(--adm-border)] rounded-lg flex items-center gap-2 break-all">
            <code className="text-[12px] flex-1 font-mono text-[color:var(--adm-text)]">{window.location.origin}{linkModal.path}</code>
            <button className="adm-btn adm-btn-secondary shrink-0" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${linkModal.path}`); toast.success("Copied"); }}>
              <CopySimple size={14}/> Copy
            </button>
          </div>
          <button className="adm-btn adm-btn-ghost mt-4" onClick={() => setLinkModal(null)}>Close</button>
        </div>
      )}

      <div className="adm-card overflow-x-auto">
        <table className="adm-table">
          <thead>
            <tr>
              <th>User</th><th>Contact</th><th>Plan</th><th>Expires</th><th>Status</th><th>Registered</th><th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} data-testid={`user-row-${u.id}`}>
                <td>
                  <div className="font-medium text-[color:var(--adm-text)]">{u.name || "—"}</div>
                  <div className="text-[12px] mono text-[color:var(--adm-text-3)]">{u.email}</div>
                  {u.role === "admin" && <span className="adm-badge adm-badge-blue mt-1 inline-flex"><ShieldStar size={10} weight="fill"/> ADMIN</span>}
                </td>
                <td className="text-[13px]">
                  <div className="mono">{u.phone || "—"}</div>
                  <div className="text-[color:var(--adm-text-3)] text-[12px]">{u.company || u.location || ""}</div>
                </td>
                <td className="text-[13px] text-[color:var(--adm-accent)] font-medium">{u.plan_name || "—"}</td>
                <td className="text-[12px] mono text-[color:var(--adm-text-2)]">{u.subscription_expires_at ? new Date(u.subscription_expires_at).toLocaleDateString() : "—"}</td>
                <td><StatusBadge s={u.status}/></td>
                <td className="text-[12px] mono text-[color:var(--adm-text-3)]">{new Date(u.created_at).toLocaleDateString()}</td>
                <td>
                  <div className="flex justify-end flex-wrap gap-1">
                    {u.status === "pending" && <button className="adm-btn adm-btn-primary" onClick={() => approve(u.id)} data-testid={`approve-${u.id}`} title="Approve"><UserCheck size={12}/></button>}
                    {u.status === "suspended" && <button className="adm-btn adm-btn-primary" onClick={() => unsuspend(u.id)} data-testid={`unsuspend-${u.id}`}>Unsuspend</button>}
                    <button className="adm-btn adm-btn-secondary" onClick={() => setEditUser(u)} data-testid={`edit-${u.id}`} title="Edit"><PencilSimple size={12}/></button>
                    <button className="adm-btn adm-btn-secondary" onClick={() => setFeatureUser(u)} data-testid={`features-${u.id}`} title="Features"><Toolbox size={12}/></button>
                    <button className="adm-btn adm-btn-secondary" onClick={() => setPwUser(u)} data-testid={`setpw-${u.id}`} title="Set password"><Key size={12}/></button>
                    <button className="adm-btn adm-btn-secondary" onClick={() => resetLink(u)} data-testid={`resetlink-${u.id}`} title="Reset link"><ArrowClockwise size={12}/></button>
                    {u.status === "approved" && u.role !== "admin" && <button className="adm-btn adm-btn-secondary" onClick={() => suspend(u.id)} data-testid={`suspend-${u.id}`} title="Suspend"><UserMinus size={12}/></button>}
                    {u.role !== "admin" && <button className="adm-btn adm-btn-danger" onClick={() => delUser(u.id)} data-testid={`delete-${u.id}`} title="Delete"><TrashSimple size={12}/></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="p-8 text-center text-[13px] text-[color:var(--adm-text-3)]">No users</div>}
      </div>

      {/* Add user modal */}
      {addOpen && (
        <div className="adm-modal-backdrop" onClick={() => setAddOpen(false)}>
          <div className="adm-modal p-6" onClick={(e) => e.stopPropagation()} data-testid="add-user-modal">
            <div className="flex items-center justify-between mb-4">
              <h2 style={{fontFamily:'Fraunces, serif'}} className="text-xl">Add a new user</h2>
              <button className="adm-btn adm-btn-ghost" onClick={() => setAddOpen(false)}><X size={16}/></button>
            </div>
            <form onSubmit={createUser} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="adm-label">Email *</label><input required type="email" className="adm-input" value={nf.email} onChange={setN("email")} data-testid="new-email"/></div>
              <div><label className="adm-label">Password * (min 6)</label><input required type="password" minLength={6} className="adm-input" value={nf.password} onChange={setN("password")} data-testid="new-password"/></div>
              <div><label className="adm-label">Full name *</label><input required className="adm-input" value={nf.name} onChange={setN("name")} data-testid="new-name"/></div>
              <div><label className="adm-label">Company</label><input className="adm-input" value={nf.company} onChange={setN("company")}/></div>
              <div><label className="adm-label">Phone *</label><input required className="adm-input" value={nf.phone} onChange={setN("phone")}/></div>
              <div><label className="adm-label">Alt Phone</label><input className="adm-input" value={nf.alt_phone} onChange={setN("alt_phone")}/></div>
              <div className="md:col-span-2"><label className="adm-label">Location</label><input className="adm-input" value={nf.location} onChange={setN("location")}/></div>
              <div><label className="adm-label">Role</label>
                <select className="adm-select" value={nf.role} onChange={setN("role")} data-testid="new-role">
                  <option value="user">user</option><option value="admin">admin</option>
                </select>
              </div>
              <div><label className="adm-label">Status</label>
                <select className="adm-select" value={nf.status} onChange={setN("status")} data-testid="new-status">
                  <option value="approved">approved</option>
                  <option value="pending">pending</option>
                  <option value="suspended">suspended</option>
                </select>
              </div>
              <div><label className="adm-label">Assign plan (optional)</label>
                <select className="adm-select" value={nf.plan_id} onChange={setN("plan_id")} data-testid="new-plan">
                  <option value="">— none —</option>
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.validity_days}d)</option>)}
                </select>
              </div>
              {nf.plan_id && (
                <div><label className="adm-label">Override validity (days)</label>
                  <input type="number" className="adm-input" placeholder="uses plan default" value={nf.validity_days} onChange={setN("validity_days")}/>
                </div>
              )}
              {addErr && <div className="md:col-span-2 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{addErr}</div>}
              <div className="md:col-span-2 flex gap-3 pt-2">
                <button type="submit" disabled={addBusy} className="adm-btn adm-btn-primary" data-testid="new-save"><FloppyDisk size={14}/> {addBusy ? "Creating..." : "Create user"}</button>
                <button type="button" className="adm-btn adm-btn-ghost" onClick={() => setAddOpen(false)}>Cancel</button>
              </div>
              <div className="md:col-span-2 text-[12px] text-[color:var(--adm-text-3)]">A welcome email with these credentials will be sent to the user (if SMTP is configured).</div>
            </form>
          </div>
        </div>
      )}

      {editUser && <EditUserModal user={editUser} plans={plans} onClose={() => setEditUser(null)} onSaved={() => { setEditUser(null); load(); }} />}
      {pwUser && <SetPasswordModal user={pwUser} onClose={() => setPwUser(null)} />}
      {featureUser && <FeaturesModal user={featureUser} flagDefs={flagDefs} onClose={() => setFeatureUser(null)} onSaved={() => { setFeatureUser(null); load(); }} />}
    </div>
  );
}

function EditUserModal({ user, plans, onClose, onSaved }) {
  const [f, setF] = useState({
    name: user.name || "", company: user.company || "", phone: user.phone || "",
    alt_phone: user.alt_phone || "", location: user.location || "",
    role: user.role || "user", status: user.status || "approved",
    plan_id: user.current_plan_id || "", validity_days: "",
    extend_days: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const s = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setBusy(true); setErr("");
    try {
      const body = { ...f };
      if (body.validity_days === "") delete body.validity_days; else body.validity_days = Number(body.validity_days);
      if (body.extend_days === "") delete body.extend_days; else body.extend_days = Number(body.extend_days);
      if (body.plan_id === user.current_plan_id) delete body.plan_id;
      await api.put(`/admin/users/${user.id}`, body);
      toast.success("Saved"); onSaved();
    } catch (e) { setErr(formatError(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="adm-modal-backdrop" onClick={onClose}>
      <div className="adm-modal p-6" onClick={(e) => e.stopPropagation()} data-testid="edit-user-modal">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 style={{fontFamily:'Fraunces, serif'}} className="text-xl">Edit user</h2>
            <div className="text-[12px] mono text-[color:var(--adm-text-3)]">{user.email}</div>
          </div>
          <button className="adm-btn adm-btn-ghost" onClick={onClose}><X size={16}/></button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="adm-label">Full name</label><input className="adm-input" value={f.name} onChange={s("name")} data-testid="edit-name"/></div>
          <div><label className="adm-label">Company</label><input className="adm-input" value={f.company} onChange={s("company")}/></div>
          <div><label className="adm-label">Phone</label><input className="adm-input" value={f.phone} onChange={s("phone")}/></div>
          <div><label className="adm-label">Alt phone</label><input className="adm-input" value={f.alt_phone} onChange={s("alt_phone")}/></div>
          <div className="md:col-span-2"><label className="adm-label">Location</label><input className="adm-input" value={f.location} onChange={s("location")}/></div>
          <div><label className="adm-label">Role</label>
            <select className="adm-select" value={f.role} onChange={s("role")}>
              <option value="user">user</option><option value="admin">admin</option>
            </select>
          </div>
          <div><label className="adm-label">Status</label>
            <select className="adm-select" value={f.status} onChange={s("status")} data-testid="edit-status">
              <option value="approved">approved</option>
              <option value="pending">pending</option>
              <option value="suspended">suspended</option>
            </select>
          </div>
          <div><label className="adm-label">Plan</label>
            <select className="adm-select" value={f.plan_id} onChange={s("plan_id")} data-testid="edit-plan">
              <option value="">— no plan —</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.validity_days}d)</option>)}
            </select>
          </div>
          <div><label className="adm-label">Validity days (set explicit)</label>
            <input type="number" className="adm-input" placeholder="days from now" value={f.validity_days} onChange={s("validity_days")}/>
          </div>
          <div className="md:col-span-2"><label className="adm-label">Extend current subscription by (days)</label>
            <input type="number" className="adm-input" placeholder="e.g. 30" value={f.extend_days} onChange={s("extend_days")} data-testid="edit-extend"/>
          </div>
        </div>
        {err && <div className="mt-4 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{err}</div>}
        <div className="flex gap-2 mt-6">
          <button disabled={busy} className="adm-btn adm-btn-primary" onClick={save} data-testid="edit-save"><FloppyDisk size={14}/> {busy ? "Saving..." : "Save changes"}</button>
          <button className="adm-btn adm-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function SetPasswordModal({ user, onClose }) {
  const [pw, setPw] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    if (pw.length < 6) { setErr("Min 6 characters"); return; }
    setBusy(true); setErr("");
    try {
      const { data } = await api.put(`/admin/users/${user.id}/password`, { password: pw, notify_email: notify });
      toast.success("Password updated" + (notify ? (data.email_sent ? " — user notified via email" : " — email failed") : ""));
      onClose();
    } catch (e) { setErr(formatError(e)); }
    finally { setBusy(false); }
  }
  return (
    <div className="adm-modal-backdrop" onClick={onClose}>
      <div className="adm-modal p-6" onClick={(e) => e.stopPropagation()} data-testid="setpw-modal">
        <div className="flex items-center justify-between mb-4">
          <h2 style={{fontFamily:'Fraunces, serif'}} className="text-xl">Set password</h2>
          <button className="adm-btn adm-btn-ghost" onClick={onClose}><X size={16}/></button>
        </div>
        <div className="text-[13px] text-[color:var(--adm-text-2)] mb-4">Setting a new password for <strong>{user.email}</strong>.</div>
        <label className="adm-label">New password (min 6)</label>
        <input type="password" minLength={6} className="adm-input" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="setpw-input"/>
        <label className="flex items-center gap-2 mt-4 text-[13px] cursor-pointer">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)}/>
          Email the new password to the user
        </label>
        {err && <div className="mt-4 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{err}</div>}
        <div className="flex gap-2 mt-6">
          <button className="adm-btn adm-btn-primary" onClick={save} disabled={busy} data-testid="setpw-save">{busy ? "Saving..." : "Update password"}</button>
          <button className="adm-btn adm-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function FeaturesModal({ user, flagDefs, onClose, onSaved }) {
  const eff = user.effective_feature_flags || flagDefs.defaults || {};
  const [flags, setFlags] = useState({ ...eff });
  const effLim = user.effective_limits || {};
  const [limits, setLimits] = useState({ ...effLim });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    setBusy(true); setErr("");
    try {
      await api.put(`/admin/users/${user.id}/features`, { feature_flags: flags, limits });
      toast.success("Features updated");
      onSaved();
    } catch (e) { setErr(formatError(e)); }
    finally { setBusy(false); }
  }
  return (
    <div className="adm-modal-backdrop" onClick={onClose}>
      <div className="adm-modal p-6" style={{maxWidth:720}} onClick={(e) => e.stopPropagation()} data-testid="features-modal">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 style={{fontFamily:'Fraunces, serif'}} className="text-xl">Features & limits</h2>
            <div className="text-[12px] mono text-[color:var(--adm-text-3)]">{user.email} — {user.plan_name || "no plan"}</div>
          </div>
          <button className="adm-btn adm-btn-ghost" onClick={onClose}><X size={16}/></button>
        </div>

        <div className="mb-2 adm-crumb">Feature toggles</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-6">
          {flagDefs.flags.map((f) => (
            <label key={f.key} className="flex items-center justify-between p-3 rounded-xl border border-[color:var(--adm-border)] hover:border-[color:var(--adm-accent)] cursor-pointer" data-testid={`flag-${f.key}`}>
              <div className="text-[14px]">{f.label}</div>
              <span className="adm-toggle">
                <input type="checkbox" checked={!!flags[f.key]} onChange={(e) => setFlags({ ...flags, [f.key]: e.target.checked })}/>
                <span className="adm-toggle-slider"/>
              </span>
            </label>
          ))}
        </div>

        <div className="mb-2 adm-crumb">Numeric limits (0 = unlimited for daily messages)</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          {flagDefs.limits.map((l) => (
            <div key={l.key}>
              <label className="adm-label">{l.label}</label>
              <input type="number" min="0" className="adm-input" value={limits[l.key] ?? ""} onChange={(e) => setLimits({ ...limits, [l.key]: e.target.value === "" ? 0 : Number(e.target.value) })} data-testid={`limit-${l.key}`}/>
            </div>
          ))}
        </div>

        {err && <div className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{err}</div>}
        <div className="flex gap-2 mt-6">
          <button disabled={busy} className="adm-btn adm-btn-primary" onClick={save} data-testid="features-save"><CheckCircle size={14}/> {busy ? "Saving..." : "Save features"}</button>
          <button className="adm-btn adm-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
        <div className="text-[12px] text-[color:var(--adm-text-3)] mt-4">
          Tip: To restore the plan's defaults, clear this user's overrides by resetting each flag to match the plan.
        </div>
      </div>
    </div>
  );
}
