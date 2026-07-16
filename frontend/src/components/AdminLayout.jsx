import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/api";
import {
  ShieldCheck, UsersThree, Package, CurrencyDollar, Gear, Envelope,
  PaperPlaneRight, Lock, SignOut, House, ArrowSquareOut, EnvelopeSimple,
  List, X,
} from "@phosphor-icons/react";
import AdminChangePassword from "@/components/AdminChangePassword";

const adminLinks = [
  { to: "/admin", icon: ShieldCheck, label: "Overview", end: true, testid: "nav-admin-home" },
  { to: "/admin/users", icon: UsersThree, label: "Users", testid: "nav-admin-users" },
  { to: "/admin/plans", icon: Package, label: "Plans", testid: "nav-admin-plans" },
  { to: "/admin/payments", icon: CurrencyDollar, label: "Payments", testid: "nav-admin-payments" },
  { to: "/admin/send", icon: PaperPlaneRight, label: "Send Message", testid: "nav-admin-send" },
  { to: "/admin/messages", icon: Envelope, label: "Inbox", testid: "nav-admin-messages" },
  { to: "/admin/smtp", icon: EnvelopeSimple, label: "SMTP", testid: "nav-admin-smtp" },
  { to: "/admin/settings", icon: Gear, label: "Billing Settings", testid: "nav-admin-settings" },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [pwOpen, setPwOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  return (
    <div className={"adm flex min-h-screen " + (drawerOpen ? "drawer-open" : "")} data-testid="admin-shell">
      <aside className="adm-sidebar w-64 shrink-0 flex flex-col">
        <div className="p-6 border-b border-[color:var(--adm-border)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[color:var(--adm-accent)] flex items-center justify-center">
              <ShieldCheck size={20} weight="fill" color="#fff"/>
            </div>
            <div>
              <div className="font-medium text-[15px]" style={{fontFamily: 'Fraunces, serif'}}>Control Panel</div>
              <div className="text-[11px] text-[color:var(--adm-text-3)] tracking-widest uppercase">Admin</div>
            </div>
          </div>
          <button className="md:hidden adm-btn adm-btn-ghost" onClick={() => setDrawerOpen(false)} aria-label="Close menu" data-testid="admin-drawer-close">
            <X size={16}/>
          </button>
        </div>

        <nav className="flex-1 py-4 overflow-y-auto">
          <div className="adm-section-title">SaaS</div>
          {adminLinks.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => "adm-sidebar-link " + (isActive ? "active" : "")}
              data-testid={l.testid}
            >
              <l.icon size={18} weight="bold" />
              {l.label}
            </NavLink>
          ))}

          <div className="adm-section-title mt-4">Shortcuts</div>
          <NavLink to="/app" className="adm-sidebar-link" data-testid="nav-user-view">
            <House size={18} weight="bold"/> User Dashboard
          </NavLink>
          <a href="/" target="_blank" rel="noreferrer" className="adm-sidebar-link" data-testid="nav-public-site">
            <ArrowSquareOut size={18} weight="bold"/> Public Site
          </a>
        </nav>

        <div className="p-4 border-t border-[color:var(--adm-border)]">
          <div className="text-[11px] text-[color:var(--adm-text-3)] uppercase tracking-widest mb-1">Signed in</div>
          <div className="text-[13px] truncate" data-testid="admin-current-email">{user?.email}</div>
          <div className="mt-3 flex gap-2">
            <button className="adm-btn adm-btn-secondary flex-1 justify-center" onClick={() => setPwOpen(true)} data-testid="admin-change-password-btn">
              <Lock size={14}/> Password
            </button>
            <button className="adm-btn adm-btn-ghost" onClick={async () => { await logout(); navigate("/login"); }} data-testid="admin-logout">
              <SignOut size={14}/>
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden min-w-0">
        <div className="mobile-topbar" data-testid="admin-mobile-topbar">
          <button className="mobile-topbar-btn" onClick={() => setDrawerOpen(true)} aria-label="Open menu" data-testid="admin-drawer-open">
            <List size={16}/> MENU
          </button>
          <div className="flex-1"/>
          <span className="text-[12px] text-[color:var(--adm-text-3)]">{user?.email}</span>
        </div>
        <Outlet />
      </main>

      {pwOpen && <AdminChangePassword onClose={() => setPwOpen(false)} />}
      {drawerOpen && (
        <button
          className="fixed inset-0 z-50 md:hidden bg-transparent"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close menu"
        />
      )}
    </div>
  );
}
