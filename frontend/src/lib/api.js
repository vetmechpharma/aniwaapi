// Central axios client + auth context
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import axios from "axios";

const BACKEND = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND}/api`;

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
  useEffect(() => {
    check();
  }, [check]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    setUser(data);
    return data;
  };
  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {}
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, refresh: check }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
