import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/api";
import {
  House,
  Broadcast,
  PaperPlaneRight,
  ChatCircleDots,
  PlugsConnected,
  ListDashes,
  Key,
  BookOpen,
  SignOut,
  Terminal,
} from "@phosphor-icons/react";

const links = [
  { to: "/", icon: House, label: "Overview", testid: "nav-overview", end: true },
  { to: "/sessions", icon: Broadcast, label: "Sessions", testid: "nav-sessions" },
  { to: "/send", icon: PaperPlaneRight, label: "Send", testid: "nav-send" },
  { to: "/rules", icon: ChatCircleDots, label: "Auto-Reply", testid: "nav-rules" },
  { to: "/webhooks", icon: PlugsConnected, label: "Webhooks", testid: "nav-webhooks" },
  { to: "/logs", icon: ListDashes, label: "Logs", testid: "nav-logs" },
  { to: "/keys", icon: Key, label: "API Keys", testid: "nav-keys" },
  { to: "/docs", icon: BookOpen, label: "API Docs", testid: "nav-docs" },
];

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex" data-testid="dashboard-shell">
      <aside className="w-64 border-r border-zinc-800 bg-black flex flex-col shrink-0">
        <div className="p-6 border-b border-zinc-800 flex items-center gap-2">
          <Terminal size={22} weight="bold" color="#00E559" />
          <div>
            <div className="mono text-sm font-bold text-white">WA_API</div>
            <div className="mono text-[10px] text-zinc-500 uppercase tracking-widest">
              console v1.0
            </div>
          </div>
        </div>
        <nav className="flex-1 py-4">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                "wa-sidebar-link " + (isActive ? "active" : "")
              }
              data-testid={l.testid}
            >
              <l.icon size={16} weight="bold" />
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-zinc-800">
          <div className="mono text-[10px] text-zinc-500 uppercase mb-1">Signed in as</div>
          <div className="mono text-xs text-white truncate">{user?.email}</div>
          <button
            className="wa-btn wa-btn-secondary w-full justify-center mt-3"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
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
