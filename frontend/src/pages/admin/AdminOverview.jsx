import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { UsersThree, Clock, CurrencyDollar, Package, ArrowRight } from "@phosphor-icons/react";

function Stat({ label, value, icon: Icon, testid, to, warn }) {
  const inner = (
    <>
      <div className="flex items-start justify-between mb-4">
        <span className="mono text-[11px] uppercase tracking-widest text-zinc-500">{label}</span>
        <Icon size={18} weight="bold" color={warn ? "#FFB800" : "#25D366"} />
      </div>
      <div className="mono text-4xl font-bold text-white">{value ?? "—"}</div>
      {to && <div className="mono text-[10px] text-zinc-500 mt-3 flex items-center gap-1">MANAGE <ArrowRight size={10}/></div>}
    </>
  );
  return to ? (
    <Link to={to} className="wa-card p-6 wa-card-hover block" data-testid={testid}>{inner}</Link>
  ) : (
    <div className="wa-card p-6" data-testid={testid}>{inner}</div>
  );
}

export default function AdminOverview() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get("/admin/overview").then(({data}) => setData(data)).catch(() => {}); }, []);

  return (
    <div className="p-6 md:p-10">
      <div className="mb-8">
        <div className="mono text-[11px] uppercase tracking-widest text-zinc-500 mb-1">/admin</div>
        <h1 className="text-3xl md:text-4xl font-semibold text-white">SaaS Control Panel</h1>
        <p className="text-zinc-400 mt-2 text-sm">Manage users, plans, payments and billing settings.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label="Total Users" value={data?.users?.total} icon={UsersThree} to="/admin/users" testid="admin-stat-users"/>
        <Stat label="Pending Approval" value={data?.users?.pending} icon={Clock} to="/admin/users" testid="admin-stat-pending" warn={data?.users?.pending > 0}/>
        <Stat label="Payments to Verify" value={data?.payments?.awaiting_verification} icon={CurrencyDollar} to="/admin/payments" testid="admin-stat-payments" warn={data?.payments?.awaiting_verification > 0}/>
        <Stat label="Active Subscribers" value={data?.users?.active} icon={Package} to="/admin/users" testid="admin-stat-active"/>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="wa-card p-6">
          <div className="mono text-xs uppercase text-zinc-500 mb-3">Users</div>
          <div className="mono text-sm text-white">Total: <span className="text-[#25D366]">{data?.users?.total || 0}</span></div>
          <div className="mono text-sm text-white">Pending: <span className="text-yellow-500">{data?.users?.pending || 0}</span></div>
          <div className="mono text-sm text-white">Active: <span className="text-[#25D366]">{data?.users?.active || 0}</span></div>
          <div className="mono text-sm text-white">Suspended: <span className="text-red-400">{data?.users?.suspended || 0}</span></div>
          <Link to="/admin/users" className="wa-btn wa-btn-secondary mt-4">MANAGE USERS →</Link>
        </div>
        <div className="wa-card p-6">
          <div className="mono text-xs uppercase text-zinc-500 mb-3">Payments</div>
          <div className="mono text-sm text-white">Awaiting Verification: <span className="text-yellow-500">{data?.payments?.awaiting_verification || 0}</span></div>
          <div className="mono text-sm text-white">Verified: <span className="text-[#25D366]">{data?.payments?.verified || 0}</span></div>
          <div className="mono text-sm text-white mt-2">Plans configured: <span className="text-[#25D366]">{data?.plans_count || 0}</span></div>
          <div className="flex gap-2 mt-4">
            <Link to="/admin/payments" className="wa-btn wa-btn-secondary">PAYMENTS</Link>
            <Link to="/admin/plans" className="wa-btn wa-btn-secondary">PLANS</Link>
            <Link to="/admin/settings" className="wa-btn wa-btn-secondary">SETTINGS</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
