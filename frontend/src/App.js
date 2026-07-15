import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/api";
import { Toaster } from "sonner";
import Login from "@/pages/Login";
import DashboardLayout from "@/components/DashboardLayout";
import Overview from "@/pages/Overview";
import Sessions from "@/pages/Sessions";
import Send from "@/pages/Send";
import Rules from "@/pages/Rules";
import Webhooks from "@/pages/Webhooks";
import Logs from "@/pages/Logs";
import ApiKeys from "@/pages/ApiKeys";
import ApiDocs from "@/pages/ApiDocs";

function Loader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="mono text-[#00E559] text-sm">
        CONNECTING<span className="blink">_</span>
      </div>
    </div>
  );
}

function Protected({ children }) {
  const { user } = useAuth();
  if (user === null) return <Loader />;
  if (user === false) return <Navigate to="/login" replace />;
  return children;
}

function LoginGate() {
  const { user } = useAuth();
  if (user === null) return <Loader />;
  if (user && user !== false) return <Navigate to="/" replace />;
  return <Login />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster theme="dark" richColors position="bottom-right" />
        <Routes>
          <Route path="/login" element={<LoginGate />} />
          <Route
            path="/"
            element={
              <Protected>
                <DashboardLayout />
              </Protected>
            }
          >
            <Route index element={<Overview />} />
            <Route path="sessions" element={<Sessions />} />
            <Route path="send" element={<Send />} />
            <Route path="rules" element={<Rules />} />
            <Route path="webhooks" element={<Webhooks />} />
            <Route path="logs" element={<Logs />} />
            <Route path="keys" element={<ApiKeys />} />
            <Route path="docs" element={<ApiDocs />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
