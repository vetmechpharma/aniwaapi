import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { api, useAuth, formatError } from "@/lib/api";
import { Terminal, Check, Rocket } from "@phosphor-icons/react";

export default function Pricing() {
  const [plans, setPlans] = useState([]);
  const [billing, setBilling] = useState({});
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    axios.get(`${process.env.REACT_APP_BACKEND_URL}/api/plans`)
      .then(({ data }) => { setPlans(data.plans || []); setBilling(data.billing || {}); })
      .finally(() => setLoading(false));
  }, []);

  async function choose(planId) {
    if (!user || user === false) { nav(`/login?next=/billing`); return; }
    if (user.role === "admin") { alert("Admins do not need to subscribe."); return; }
    nav(`/billing?plan=${planId}`);
  }

  return (
    <div className="min-h-screen py-16 px-4 grid-bg">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-3 mb-3">
            <Terminal size={30} weight="bold" color="#00E559"/>
            <span className="mono text-lg font-bold text-white">{billing.company_name || "WA_API"}</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-white">Pricing</h1>
          <p className="text-zinc-400 mt-3 max-w-xl mx-auto text-sm">Pick a plan. Pay via UPI QR. Once verified, your WhatsApp API is live within minutes.</p>
          <div className="mt-6 flex justify-center gap-3">
            {user ? (
              <Link to="/" className="wa-btn wa-btn-secondary">DASHBOARD →</Link>
            ) : (
              <>
                <Link to="/register" className="wa-btn wa-btn-primary">CREATE ACCOUNT</Link>
                <Link to="/login" className="wa-btn wa-btn-secondary">LOGIN</Link>
              </>
            )}
          </div>
        </div>

        {loading ? (
          <div className="mono text-zinc-500 text-center">LOADING PLANS...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {plans.map((p, i) => (
              <div key={p.id} className={"wa-card p-6 wa-card-hover flex flex-col " + (i === 2 ? "border-[#00E559]" : "")} data-testid={`plan-${p.id}`}>
                {i === 2 && <div className="mono text-[10px] uppercase tracking-widest text-[#00E559] mb-2">★ POPULAR</div>}
                <div className="mono text-xs uppercase tracking-widest text-zinc-500">{p.name}</div>
                <div className="mt-3 text-white">
                  <span className="text-4xl font-bold">₹{p.price_inr}</span>
                  <span className="mono text-xs text-zinc-500 ml-2">/ ${p.price_usd}</span>
                </div>
                <div className="mono text-[11px] text-zinc-500 mt-1">{p.validity_days} day validity</div>
                <p className="text-zinc-400 mt-3 text-sm min-h-[3rem]">{p.description}</p>
                <ul className="mt-4 space-y-2 flex-1">
                  {(p.features || []).map((f) => (
                    <li key={f} className="mono text-xs text-white flex items-start gap-2">
                      <Check size={14} className="text-[#00E559] mt-0.5"/> {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => choose(p.id)}
                  className={"wa-btn w-full justify-center mt-6 " + (i === 2 ? "wa-btn-primary" : "wa-btn-secondary")}
                  data-testid={`choose-plan-${p.id}`}
                >
                  <Rocket size={14}/> CHOOSE PLAN
                </button>
              </div>
            ))}
          </div>
        )}

        {(billing.contact_email || billing.contact_phone) && (
          <div className="mt-12 text-center mono text-[11px] text-zinc-500">
            Need help? {billing.contact_email && <>Email <span className="text-[#00E559]">{billing.contact_email}</span></>}
            {billing.contact_phone && <> · Call <span className="text-[#00E559]">{billing.contact_phone}</span></>}
          </div>
        )}
      </div>
    </div>
  );
}
