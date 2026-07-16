import React, { useState } from "react";
import { api, formatError } from "@/lib/api";
import { X, Lock, CheckCircle } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function AdminChangePassword({ onClose }) {
  const [cur, setCur] = useState("");
  const [n1, setN1] = useState("");
  const [n2, setN2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (n1 !== n2) { setErr("New passwords don't match"); return; }
    if (n1.length < 6) { setErr("Password must be 6+ characters"); return; }
    setBusy(true);
    try {
      await api.post("/admin/change-password", { current_password: cur, new_password: n1 });
      setOk(true);
      toast.success("Password updated");
      setTimeout(onClose, 1200);
    } catch (e2) {
      setErr(formatError(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-modal-backdrop" onClick={onClose}>
      <div className="adm-modal p-6" onClick={(e) => e.stopPropagation()} data-testid="change-password-modal">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[color:var(--adm-accent-soft)] flex items-center justify-center">
              <Lock size={18} color="#128C7E" weight="bold"/>
            </div>
            <h2 style={{fontFamily: 'Fraunces, serif'}} className="text-xl">Change your password</h2>
          </div>
          <button className="adm-btn adm-btn-ghost" onClick={onClose}><X size={16}/></button>
        </div>

        {ok ? (
          <div className="py-6 text-center">
            <CheckCircle size={40} color="#25D366" weight="fill" className="mx-auto mb-3"/>
            <div className="text-sm text-[color:var(--adm-text-2)]">Password updated.</div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="adm-label">Current password</label>
              <input required type="password" className="adm-input" value={cur} onChange={(e) => setCur(e.target.value)} data-testid="cp-current"/>
            </div>
            <div>
              <label className="adm-label">New password</label>
              <input required type="password" minLength={6} className="adm-input" value={n1} onChange={(e) => setN1(e.target.value)} data-testid="cp-new1"/>
            </div>
            <div>
              <label className="adm-label">Confirm new password</label>
              <input required type="password" minLength={6} className="adm-input" value={n2} onChange={(e) => setN2(e.target.value)} data-testid="cp-new2"/>
            </div>
            {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3" data-testid="cp-error">{err}</div>}
            <div className="flex gap-2 pt-2">
              <button type="submit" disabled={busy} className="adm-btn adm-btn-primary" data-testid="cp-submit">{busy ? "Updating..." : "Update password"}</button>
              <button type="button" className="adm-btn adm-btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
