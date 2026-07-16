import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, Link } from "react-router-dom";
import { api, useAuth } from "@/lib/api";
import {
  House, Broadcast, PaperPlaneRight, ChatCircleDots, PlugsConnected,
  ListDashes, Key, BookOpen, SignOut, Terminal, CreditCard, ShieldCheck,
} from "@phosphor-icons/react";

const userLinks = [
  { to: "/app", icon: House, label: "Overview", testid: "nav-overview", end: true },
  { to: "/app/sessions", icon: Broadcast, label: "Sessions", testid: "nav-sessions" },
  { to: "/app/send", icon: PaperPlaneRight, label: "Send", testid: "nav-send" },
  { to: "/app/rules", icon: ChatCircleDots, label: "Auto-Reply", testid: "nav-rules" },
  { to: "/app/webhooks", icon: PlugsConnected, label: "Webhooks", testid: "nav-webhooks" },
  { to: "/app/logs", icon: ListDashes, label: "Logs", testid: "nav-logs" },
  { to: "/app/keys", icon: Key, label: "API Keys", testid: "nav-keys" },
  { to: "/app/billing", icon: CreditCard, label: "Billing", testid: "nav-billing" },
  { to: "/app/docs", icon: BookOpen, label: "API Docs", testid: "nav-docs" },
];

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (!isAdmin && user) {
      api.get("/billing/summary").then(({ data }) => setSummary(data)).catch(() => {});
    }
  }, [isAdmin, user]);

  return (
    <div className="min-h-screen flex" data-testid="dashboard-shell">
      <aside className="w-64 border-r border-zinc-800 bg-black flex flex-col shrink-0">
        <div className="p-6 border-b border-zinc-800 flex items-center gap-2">
          <Terminal size={22} weight="bold" color="#25D366" />
          <div>
            <div className="mono text-sm font-bold text-white">WA_API</div>
            <div className="mono text-[10px] text-zinc-500 uppercase tracking-widest">console v2.0</div>
          </div>
        </div>
        <nav className="flex-1 py-4 overflow-y-auto">
          <div className="mono text-[9px] uppercase tracking-widest text-zinc-600 px-4 mb-2">WhatsApp</div>
          {userLinks.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}
              className={({ isActive }) => "wa-sidebar-link " + (isActive ? "active" : "")}
              data-testid={l.testid}>
              <l.icon size={16} weight="bold" />
              {l.label}
            </NavLink>
          ))}
          {isAdmin && (
            <>
              <div className="border-t border-zinc-900 my-3"/>
              <Link to="/admin" className="wa-sidebar-link" data-testid="nav-back-to-admin">
                <ShieldCheck size={16} weight="bold" color="#25D366"/> Admin Panel
              </Link>
            </>
          )}
        </nav>

        {!isAdmin && summary && (
          <div className="p-4 border-t border-zinc-800" data-testid="sidebar-subscription">
            <div className="mono text-[9px] uppercase text-zinc-600 mb-1">Subscription</div>
            <div className="mono text-xs text-white">{summary?.plan?.name || "No plan"}</div>
            {summary?.days_left !== null && summary?.days_left !== undefined && (
              <div className={"mono text-[10px] mt-1 " + (summary.days_left > 3 ? "text-[#25D366]" : "text-yellow-500")}>
                {summary.days_left} days left
              </div>
            )}
            <Link to="/app/billing" className="wa-btn wa-btn-secondary w-full justify-center mt-2 text-[10px]">MANAGE</Link>
          </div>
        )}

        <div className="p-4 border-t border-zinc-800">
          <div className="mono text-[10px] text-zinc-500 uppercase mb-1">Signed in as</div>
          <div className="mono text-xs text-white truncate">{user?.email}</div>
          {isAdmin && <div className="mono text-[10px] text-[#25D366] mt-1">◆ ADMIN</div>}
          <button
            className="wa-btn wa-btn-secondary w-full justify-center mt-3"
            onClick={async () => { await logout(); navigate("/login"); }}
            data-testid="logout-button"
          >
            <SignOut size={14} /> LOGOUT
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}
