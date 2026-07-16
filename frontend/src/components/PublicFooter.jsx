import React from "react";
import { Link } from "react-router-dom";

export default function PublicFooter({ brand = "WA_API", email = "", phone = "" }) {
  const year = new Date().getFullYear();
  return (
    <footer className="pub-footer mt-24">
      <div className="max-w-6xl mx-auto px-6 py-12 grid grid-cols-1 md:grid-cols-4 gap-8">
        <div className="md:col-span-2">
          <div className="text-2xl mb-2" style={{ fontFamily: "'Instrument Serif', serif", fontStyle: "italic", color: "#FAFAFA" }}>{brand}</div>
          <p className="text-sm max-w-sm">Self-hosted, unofficial WhatsApp API for personal & small-business use. Use responsibly.</p>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-zinc-500 mb-3">Product</div>
          <ul className="space-y-2 text-sm">
            <li><Link to="/features" className="hover:text-white">Features</Link></li>
            <li><Link to="/pricing" className="hover:text-white">Pricing</Link></li>
            <li><Link to="/register" className="hover:text-white">Sign up</Link></li>
            <li><Link to="/login" className="hover:text-white">Login</Link></li>
          </ul>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-zinc-500 mb-3">Contact</div>
          <ul className="space-y-2 text-sm">
            {email && <li><a href={`mailto:${email}`} className="hover:text-white">{email}</a></li>}
            {phone && <li><a href={`tel:${phone}`} className="hover:text-white">{phone}</a></li>}
            <li><Link to="/contact" className="hover:text-white">Contact form →</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col md:flex-row justify-between gap-2 text-xs text-zinc-600">
          <div>© {year} {brand}. All rights reserved.</div>
          <div>Unofficial WhatsApp API · Not affiliated with WhatsApp Inc.</div>
        </div>
      </div>
    </footer>
  );
}
