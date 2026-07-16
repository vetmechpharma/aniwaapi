import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuth } from "@/lib/api";
import { useSiteInfo } from "@/lib/siteInfo";
import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { Check, Rocket, ArrowRight } from "@phosphor-icons/react";

export default function Pricing() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const info = useSiteInfo();
  const nav = useNavigate();

  useEffect(() => {
    axios.get(`${process.env.REACT_APP_BACKEND_URL}/api/plans`)
      .then(({ data }) => setPlans(data.plans || []))
      .finally(() => setLoading(false));
  }, []);

  function choose(planId) {
    if (!user || user === false) { nav(`/register?next=/app/billing?plan=${planId}`); return; }
    if (user.role === "admin") { alert("Admins do not need to subscribe."); return; }
    nav(`/app/billing?plan=${planId}`);
  }

  return (
    <div className="pub pub-body" data-testid="pricing-page">
      <PublicNav brand={info.company_name}/>

      <section className="pt-20 pb-10 px-6 relative">
        <div className="pub-grid-bg absolute inset-0 pointer-events-none"/>
        <div className="max-w-3xl mx-auto text-center relative">
          <div className="eyebrow mb-4">Pricing</div>
          <h1 className="mb-4">Simple, <span className="accent-serif italic">honest</span> plans.</h1>
          <p className="lead">Pay via UPI QR. Once verified, your API is live within minutes. Upgrade, downgrade, cancel — anytime.</p>
        </div>
      </section>

      <section className="pb-20 px-6">
        <div className="max-w-6xl mx-auto">
          {loading ? (
            <div className="text-center text-zinc-500 py-16">Loading plans…</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {plans.map((p, i) => (
                <div key={p.id} className={"pub-card flex flex-col " + (i === 2 ? "pub-card-highlight" : "")} data-testid={`plan-${p.id}`}>
                  {i === 2 && <div className="pub-badge mb-3">★ Popular</div>}
                  <div className="eyebrow mb-3">{p.name}</div>
                  <div className="mb-1">
                    <span className="text-4xl text-zinc-900" style={{ fontFamily: "'Instrument Serif', serif" }}>₹{p.price_inr}</span>
                    <span className="text-xs text-zinc-500 ml-2">/ ${p.price_usd}</span>
                  </div>
                  <div className="text-xs text-zinc-500 mb-4">{p.validity_days} day validity</div>
                  <p className="text-sm mb-4 min-h-[3rem]">{p.description}</p>
                  <ul className="space-y-2 flex-1 mb-6">
                    {(p.features || []).map((f) => (
                      <li key={f} className="text-sm text-zinc-700 flex items-start gap-2">
                        <Check size={14} className="accent mt-0.5 shrink-0"/>{f}
                      </li>
                    ))}
                  </ul>
                  <button onClick={() => choose(p.id)}
                    className={"pub-btn w-full " + (i === 2 ? "pub-btn-primary" : "pub-btn-secondary")}
                    data-testid={`choose-plan-${p.id}`}>
                    <Rocket size={14}/> Choose plan
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-16 text-center">
            <p className="lead mb-4">Not sure which plan? Talk to us.</p>
            <Link to="/contact" className="pub-btn pub-btn-secondary">Contact sales <ArrowRight size={14}/></Link>
          </div>
        </div>
      </section>

      <PublicFooter brand={info.company_name} email={info.contact_email} phone={info.contact_phone}/>
    </div>
  );
}
