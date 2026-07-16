import React, { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "@/lib/api";
import { List, X } from "@phosphor-icons/react";

const links = [
  { to: "/", label: "Home", end: true },
  { to: "/features", label: "Features" },
  { to: "/pricing", label: "Pricing" },
  { to: "/contact", label: "Contact" },
];

export default function PublicNav({ brand = "WA_API" }) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  return (
    <nav className="pub-nav" data-testid="public-nav">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2" data-testid="brand-link">
          <span className="text-2xl" style={{ fontFamily: "'Instrument Serif', serif", color: "#FAFAFA", fontStyle: "italic" }}>{brand}</span>
        </Link>
        <div className="hidden md:flex items-center gap-8">
          {links.map(l => (
            <NavLink key={l.to} to={l.to} end={l.end}
              className={({ isActive }) => "pub-nav-link " + (isActive ? "active" : "")}
              data-testid={`nav-${l.label.toLowerCase()}`}>
              {l.label}
            </NavLink>
          ))}
        </div>
        <div className="hidden md:flex items-center gap-3">
          {user && user !== false ? (
            <Link to="/" className="pub-btn pub-btn-primary" data-testid="nav-dashboard">Dashboard</Link>
          ) : (
            <>
              <Link to="/login" className="pub-btn pub-btn-ghost" data-testid="nav-login">Login</Link>
              <Link to="/register" className="pub-btn pub-btn-primary" data-testid="nav-register">Get started</Link>
            </>
          )}
        </div>
        <button className="md:hidden text-white" onClick={() => setOpen(!open)} data-testid="mobile-menu">
          {open ? <X size={22}/> : <List size={22}/>}
        </button>
      </div>
      {open && (
        <div className="md:hidden border-t border-white/5 px-6 py-4 space-y-3">
          {links.map(l => (
            <Link key={l.to} to={l.to} onClick={() => setOpen(false)} className="block pub-nav-link">{l.label}</Link>
          ))}
          <div className="pub-divider my-2"/>
          {user && user !== false ? (
            <Link to="/" onClick={() => setOpen(false)} className="pub-btn pub-btn-primary w-full">Dashboard</Link>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Link to="/login" onClick={() => setOpen(false)} className="pub-btn pub-btn-secondary">Login</Link>
              <Link to="/register" onClick={() => setOpen(false)} className="pub-btn pub-btn-primary">Sign up</Link>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
