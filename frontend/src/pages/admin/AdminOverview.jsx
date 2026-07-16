import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import {
  UsersThree, Clock, CurrencyDollar, Package, CheckCircle, ArrowRight,
  Envelope, PaperPlaneRight, EnvelopeSimple, Gear,
} from "@phosphor-icons/react";

function Stat({ label, value, icon: Icon, to, warn, testid }) {
  const inner = (
    <div className="adm-stat" data-testid={testid}>
      <div className="flex items-start justify-between mb-1">
        <span className="adm-stat-label">{label}</span>
        <div className={"w-9 h-9 rounded-xl flex items-center justify-center " + (warn ? "bg-amber-50" : "bg-[color:var(--adm-accent-soft)]")}>
          <Icon size={18} weight="bold" color={warn ? "#B45309" : "#128C7E"} />
        </div>
      </div>
      <div className="adm-stat-value">{value ?? "—"}</div>
      {to && (
        <div className="mt-3 text-[12px] text-[color:var(--adm-accent)] flex items-center gap-1 font-medium">
          Manage <ArrowRight size={12}/>
        </div>
      )}
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function QuickAction({ to, icon: Icon, title, desc, testid }) {
  return (
    <Link to={to} className="adm-card p-5 flex items-start gap-4 hover:border-[color:var(--adm-accent)] transition-all" data-testid={testid}>
      <div className="w-10 h-10 rounded-xl bg-[color:var(--adm-accent-soft)] flex items-center justify-center shrink-0">
        <Icon size={20} weight="bold" color="#128C7E"/>
      </div>
      <div>
        <div className="font-medium text-[color:var(--adm-text)]">{title}</div>
        <div className="text-[13px] text-[color:var(--adm-text-2)] mt-1">{desc}</div>
      </div>
    </Link>
  );
}

export default function AdminOverview() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get("/admin/overview").then(({ data }) => setData(data)).catch(() => {}); }, []);

  return (
    <div className="p-6 md:p-10 max-w-7xl">
      <div className="mb-8">
        <div className="adm-crumb mb-2">/ admin</div>
        <h1 style={{fontFamily:'Fraunces, serif'}}>Welcome back to your control panel.</h1>
        <p className="text-[color:var(--adm-text-2)] mt-2 text-[15px]">Manage users, plans, payments and settings.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <Stat label="Total Users" value={data?.users?.total} icon={UsersThree} to="/admin/users" testid="admin-stat-users"/>
        <Stat label="Pending Approval" value={data?.users?.pending} icon={Clock} to="/admin/users" testid="admin-stat-pending" warn={data?.users?.pending > 0}/>
        <Stat label="Payments to Verify" value={data?.payments?.awaiting_verification} icon={CurrencyDollar} to="/admin/payments" testid="admin-stat-payments" warn={data?.payments?.awaiting_verification > 0}/>
        <Stat label="Active Subscribers" value={data?.users?.active} icon={CheckCircle} to="/admin/users" testid="admin-stat-active"/>
      </div>

      <div className="mb-4">
        <div className="adm-crumb">Quick actions</div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
        <QuickAction to="/admin/users" icon={UsersThree} title="Users" desc="Add, edit, delete, toggle features & reset passwords" testid="qa-users"/>
        <QuickAction to="/admin/send" icon={PaperPlaneRight} title="Send WhatsApp Message" desc="Send from any user's connected number" testid="qa-send"/>
        <QuickAction to="/admin/plans" icon={Package} title="Plans" desc="Set pricing, validity, limits and feature toggles" testid="qa-plans"/>
        <QuickAction to="/admin/smtp" icon={EnvelopeSimple} title="SMTP Setup" desc="Configure outgoing email for OTP + welcome" testid="qa-smtp"/>
        <QuickAction to="/admin/messages" icon={Envelope} title="Inbox" desc={`${data?.unread_messages || 0} unread contact form messages`} testid="qa-inbox"/>
        <QuickAction to="/admin/settings" icon={Gear} title="Billing Settings" desc="UPI VPA, brand name, contact info" testid="qa-settings"/>
      </div>
    </div>
  );
}
