import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { useSiteInfo } from "@/lib/siteInfo";
import {
  Broadcast, ChatCircleDots, PlugsConnected, Key, Clock, ShieldCheck,
  Lightning, ArrowRight, Check, PaperPlaneTilt, UsersThree, QrCode, ChatTeardrop, ChatsCircle,
} from "@phosphor-icons/react";

const featureList = [
  { icon: ChatsCircle, title: "Multi-session chat", body: "Connect multiple numbers to a single dashboard. Scan QR or use pairing code — auto-reconnect on restart." },
  { icon: PaperPlaneTilt, title: "Send text, media & broadcasts", body: "Text, images, video, audio, documents. Broadcast to hundreds with built-in throttle to protect your number." },
  { icon: ChatTeardrop, title: "Rule-based auto-reply", body: "Keyword rules (contains / exact / starts-with / regex) with per-session control, and business-hours mode for office hours." },
  { icon: PlugsConnected, title: "Webhooks for CRM", body: "Forward every incoming message to your own server or CRM via HTTP. Retry-friendly with delivery status logging." },
  { icon: Key, title: "Scoped API keys", body: "Fine-grained scopes (send:text, send:media, broadcast, sessions:read, logs:read…) with per-key rate limits." },
  { icon: Clock, title: "Delivery ticks & live logs", body: "See ✓ / ✓✓ / ✓✓ (blue) status in real time via WebSocket. Full searchable message history." },
  { icon: ShieldCheck, title: "Secure by default", body: "JWT admin auth with brute-force lockout. Bearer-token API access. HTTPS cookies. Encrypted sessions on disk." },
  { icon: QrCode, title: "UPI QR payments", body: "Simple subscription: subscriber scans a UPI QR, pays, submits UTR, admin verifies. Access activates instantly." },
];

const steps = [
  { n: "01", title: "Register", body: "Create your account with company details in under a minute." },
  { n: "02", title: "Approve & pay", body: "Admin approves your account. Pick a plan, scan UPI QR, submit UTR." },
  { n: "03", title: "Connect WhatsApp", body: "Scan the QR from your phone → your number is live behind the API." },
  { n: "04", title: "Automate", body: "Send from any CRM via Bearer API. Configure auto-replies and webhooks." },
];

export default function Landing() {
  const info = useSiteInfo();
  const [plans, setPlans] = useState([]);
  useEffect(() => {
    axios.get(`${process.env.REACT_APP_BACKEND_URL}/api/plans`)
      .then(({ data }) => setPlans((data.plans || []).slice(0, 3))).catch(() => {});
  }, []);

  return (
    <div className="pub pub-body" data-testid="landing-page">
      <PublicNav brand={info.company_name}/>

      {/* Hero */}
      <section className="relative pt-20 md:pt-28 pb-20 md:pb-32 overflow-hidden">
        <div className="pub-grid-bg absolute inset-0 pointer-events-none"/>
        {/* Chat-bubble decorations (WhatsApp-inspired) */}
        <div className="pub-bubble hidden md:block" style={{ top: '18%', left: '4%', width: 200, height: 60 }}/>
        <div className="pub-bubble left hidden md:block" style={{ top: '32%', right: '5%', width: 160, height: 52 }}/>
        <div className="pub-bubble hidden lg:block" style={{ top: '58%', left: '8%', width: 140, height: 44 }}/>
        <div className="pub-bubble left hidden lg:block" style={{ top: '70%', right: '7%', width: 180, height: 50 }}/>

        <div className="max-w-4xl mx-auto px-6 text-center relative">
          <div className="inline-flex items-center gap-2 pub-badge mb-8">
            <Lightning size={12} weight="fill"/> Self-hosted unofficial WhatsApp API
          </div>
          <h1 className="mb-6">
            Your own <span className="accent-serif italic">chat</span> API, <br/>
            live in <span className="accent-serif italic">minutes.</span>
          </h1>
          <p className="lead max-w-2xl mx-auto mb-10">
            A clean, developer-first messaging automation platform.
            Send messages, receive webhooks, auto-reply, and integrate with any CRM — from a single elegant dashboard.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/register" className="pub-btn pub-btn-primary" data-testid="hero-cta-register">
              Create account <ArrowRight size={14}/>
            </Link>
            <Link to="/pricing" className="pub-btn pub-btn-secondary" data-testid="hero-cta-pricing">
              View pricing
            </Link>
          </div>
          <div className="mt-10 flex justify-center items-center gap-6 text-xs text-zinc-500">
            <span className="flex items-center gap-1"><Check size={12} className="accent"/> No credit card to start</span>
            <span className="flex items-center gap-1"><Check size={12} className="accent"/> UPI payments</span>
            <span className="flex items-center gap-1"><Check size={12} className="accent"/> Cancel anytime</span>
          </div>
        </div>
      </section>

      {/* Feature grid preview */}
      <section id="features" className="py-20 border-t border-white/5">
        <div className="max-w-6xl mx-auto px-6">
          <div className="max-w-2xl mb-12">
            <div className="eyebrow mb-3">Features</div>
            <h2 className="mb-4">Everything you need to run <span className="accent-serif italic">WhatsApp</span> at scale.</h2>
            <p className="lead">Every subscriber gets an isolated workspace with sessions, rules, webhooks and API keys — all governed by their plan limits.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {featureList.map((f) => (
              <div key={f.title} className="pub-card" data-testid={`feature-${f.title}`}>
                <f.icon size={22} weight="duotone" className="mb-4 accent"/>
                <div className="text-white font-medium mb-2" style={{ fontFamily: "'Inter', sans-serif" }}>{f.title}</div>
                <p className="text-sm">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 border-t border-white/5">
        <div className="max-w-5xl mx-auto px-6">
          <div className="eyebrow mb-3">How it works</div>
          <h2 className="mb-12">Four steps. That&rsquo;s it.</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {steps.map(s => (
              <div key={s.n} className="pub-card" data-testid={`step-${s.n}`}>
                <div style={{ fontFamily: "'Instrument Serif', serif" }} className="text-4xl italic mb-3 text-zinc-600">{s.n}</div>
                <div className="text-white font-medium mb-2">{s.title}</div>
                <p className="text-sm">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing preview */}
      <section className="py-20 border-t border-white/5">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-10">
            <div>
              <div className="eyebrow mb-3">Pricing</div>
              <h2>Simple, <span className="accent-serif italic">honest</span> plans.</h2>
            </div>
            <Link to="/pricing" className="pub-btn pub-btn-ghost">See all plans <ArrowRight size={14}/></Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((p, i) => (
              <div key={p.id} className={"pub-card " + (i === 1 ? "pub-card-highlight" : "")}>
                {i === 1 && <div className="pub-badge mb-3">★ Popular</div>}
                <div className="eyebrow mb-3">{p.name}</div>
                <div className="mb-1">
                  <span className="text-4xl text-white" style={{ fontFamily: "'Instrument Serif', serif" }}>₹{p.price_inr}</span>
                  <span className="text-xs text-zinc-500 ml-2">/ ${p.price_usd}</span>
                </div>
                <div className="text-xs text-zinc-500 mb-4">{p.validity_days} day validity</div>
                <ul className="space-y-2 mb-6 min-h-[7rem]">
                  {(p.features || []).slice(0, 4).map((f) => (
                    <li key={f} className="text-sm text-zinc-300 flex items-start gap-2"><Check size={14} className="accent mt-0.5 shrink-0"/>{f}</li>
                  ))}
                </ul>
                <Link to="/pricing" className={"pub-btn w-full " + (i === 1 ? "pub-btn-primary" : "pub-btn-secondary")}>
                  Choose {p.name}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust / CTA band */}
      <section className="py-20 border-t border-white/5">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <UsersThree size={30} weight="duotone" className="mx-auto accent mb-4"/>
          <h2 className="mb-6">Ready to <span className="accent-serif italic">automate?</span></h2>
          <p className="lead mb-8">Join businesses running WhatsApp workflows without vendor lock-in. Your data, your server, your rules.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/register" className="pub-btn pub-btn-primary">Get started</Link>
            <Link to="/contact" className="pub-btn pub-btn-secondary">Talk to us</Link>
          </div>
        </div>
      </section>

      <PublicFooter brand={info.company_name} email={info.contact_email} phone={info.contact_phone}/>
    </div>
  );
}
