// Central axios client + auth context + realtime WS
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";

const BACKEND = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND}/api`;
const WS_URL = `${BACKEND.replace(/^http/, "ws")}/api/ws`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

export function formatError(e) {
  const d = e?.response?.data?.detail;
  if (!d) return e?.message || "Request failed";
  if (typeof d === "string") return d;
  if (Array.isArray(d))
    return d
      .map((x) => (x && typeof x.msg === "string" ? x.msg : JSON.stringify(x)))
      .filter(Boolean)
      .join("; ");
  if (typeof d === "object" && d.msg) return d.msg;
  return JSON.stringify(d);
}

const AuthContext = createContext(null);
const RealtimeContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null=loading, false=guest, obj=authed

  const check = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      setUser(false);
    }
  }, []);
  useEffect(() => { check(); }, [check]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    setUser(data);
    return data;
  };
  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, refresh: check }}>
      <RealtimeProvider enabled={!!user && user !== false}>{children}</RealtimeProvider>
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }

/**
 * Realtime WebSocket:
 * subscribers = Map<eventType, Set<callback(payload)>>
 * eventType: "message" | "status" | "connection" | "any"
 */
function RealtimeProvider({ enabled, children }) {
  const subsRef = useRef(new Map());
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);

  const subscribe = useCallback((type, cb) => {
    const m = subsRef.current;
    if (!m.has(type)) m.set(type, new Set());
    m.get(type).add(cb);
    return () => {
      m.get(type)?.delete(cb);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
      setConnected(false);
      return;
    }
    let closed = false;
    let retry = 0;

    function connect() {
      if (closed) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => { retry = 0; setConnected(true); };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        retry = Math.min(retry + 1, 5);
        setTimeout(connect, 1000 * retry);
      };
      ws.onerror = () => { /* onclose will fire */ };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          const m = subsRef.current;
          m.get(data.type)?.forEach((cb) => { try { cb(data); } catch {} });
          m.get("any")?.forEach((cb) => { try { cb(data); } catch {} });
        } catch {}
      };
    }
    connect();

    // Heartbeat every 30s
    const hb = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try { wsRef.current.send("ping"); } catch {}
      }
    }, 30000);

    return () => {
      closed = true;
      clearInterval(hb);
      if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
    };
  }, [enabled]);

  return (
    <RealtimeContext.Provider value={{ subscribe, connected }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() { return useContext(RealtimeContext) || { subscribe: () => () => {}, connected: false }; }
