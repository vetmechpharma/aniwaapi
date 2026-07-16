import React from "react";
import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { useSiteInfo } from "@/lib/siteInfo";
import { Link } from "react-router-dom";
import {
  Broadcast, ChatCircleDots, PlugsConnected, Key, Clock, ShieldCheck,
  QrCode, UsersThree, PaperPlaneTilt, ChatDots, WhatsappLogo, Lightning, Check,
} from "@phosphor-icons/react";

const groups = [
  {
    title: "Messaging",
    intro: "Send anything WhatsApp supports, at scale.",
    items: [
      { icon: PaperPlaneTilt, title: "Text messages", body: "Individual or broadcast text with template variables." },
      { icon: WhatsappLogo, title: "Media", body: "Images, video, audio, PDF & documents up to 50 MB." },
      { icon: Broadcast, title: "Broadcasts", body: "Send to many recipients with a built-in throttle to protect your number." },
      { icon: UsersThree, title: "Groups (API)", body: "Create groups, add/remove members, promote/demote admins." },
    ]
  },
  {
    title: "Automation",
    intro: "Set rules once. Let the bot handle the rest.",
    items: [
      { icon: ChatCircleDots, title: "Keyword auto-reply", body: "Contains / exact / starts-with / regex triggers. Toggle per rule." },
      { icon: Clock, title: "Business hours mode", body: "Stay silent when you&rsquo;re open (humans handle chats). Send a fallback outside." },
      { icon: PlugsConnected, title: "Outbound webhooks", body: "Forward incoming messages to your CRM / server as JSON POST." },
      { icon: ChatDots, title: "Live logs", body: "Every message stored with status ticks (sent / delivered / read)." },
    ]
  },
  {
    title: "Developer platform",
    intro: "Made to be integrated. Everywhere.",
    items: [
      { icon: Key, title: "Scoped API keys", body: "send:text, send:media, broadcast, sessions:read, logs:read + custom scopes." },
      { icon: Lightning, title: "WebSocket push", body: "Real-time events for messages, statuses and connection changes." },
      { icon: ShieldCheck, title: "Bearer + rate limits", body: "Per-key requests-per-minute limits. Revoke instantly." },
      { icon: QrCode, title: "UPI billing", body: "Subscription plans, QR checkout, admin verification. Built-in." },
    ]
  }
];

export default function Features() {
  const info = useSiteInfo();
  return (
    <div className="pub pub-body">
      <PublicNav brand={info.company_name}/>
      <section className="pt-20 pb-10 px-6 text-center relative">
        <div className="pub-grid-bg absolute inset-0 pointer-events-none"/>
        <div className="max-w-3xl mx-auto relative">
          <div className="eyebrow mb-4">Features</div>
          <h1 className="mb-6">Powerful, without the <span className="accent-serif italic">bloat.</span></h1>
          <p className="lead">Every subscriber gets an isolated workspace with its own WhatsApp sessions, rules, webhooks and API keys.</p>
        </div>
      </section>

      {groups.map((g, gi) => (
        <section key={g.title} className="py-16 px-6 border-t border-white/5">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
              <div className="md:col-span-1">
                <div className="eyebrow mb-3">0{gi+1}</div>
                <h2 className="mb-4">{g.title}</h2>
                <p>{g.intro}</p>
              </div>
              <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {g.items.map(it => (
                  <div key={it.title} className="pub-card">
                    <it.icon size={20} weight="duotone" className="mb-3 accent"/>
                    <div className="text-white font-medium mb-1">{it.title}</div>
                    <p className="text-sm">{it.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ))}

      <section className="py-20 px-6 text-center border-t border-white/5">
        <div className="max-w-2xl mx-auto">
          <h2 className="mb-6">Ready to try it?</h2>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/register" className="pub-btn pub-btn-primary">Create free account</Link>
            <Link to="/pricing" className="pub-btn pub-btn-secondary">See pricing <Check size={14}/></Link>
          </div>
        </div>
      </section>

      <PublicFooter brand={info.company_name} email={info.contact_email} phone={info.contact_phone}/>
    </div>
  );
}
