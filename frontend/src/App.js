import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/api";
import { Toaster } from "sonner";

import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import Pricing from "@/pages/Pricing";
import DashboardLayout from "@/components/DashboardLayout";
import Overview from "@/pages/Overview";
import Sessions from "@/pages/Sessions";
import Send from "@/pages/Send";
import Rules from "@/pages/Rules";
import Webhooks from "@/pages/Webhooks";
import Logs from "@/pages/Logs";
import ApiKeys from "@/pages/ApiKeys";
import ApiDocs from "@/pages/ApiDocs";
import Billing from "@/pages/Billing";
import AdminOverview from "@/pages/admin/AdminOverview";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminPlans from "@/pages/admin/AdminPlans";
import AdminPayments from "@/pages/admin/AdminPayments";
import AdminSettings from "@/pages/admin/AdminSettings";

function Loader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="mono text-[#00E559] text-sm">CONNECTING<span className="blink">_</span></div>
    </div>
  );
}

function Protected({ children }) {
  const { user } = useAuth();
  if (user === null) return <Loader />;
  if (user === false) return <Navigate to="/login" replace />;
  return children;
}

function AdminOnly({ children }) {
  const { user } = useAuth();
  if (user === null) return <Loader />;
  if (user === false) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/" replace />;
  return children;
}

function LoginGate() {
  const { user } = useAuth();
  if (user === null) return <Loader />;
  if (user && user !== false) {
    // Redirect admins to admin panel, users to overview
    return <Navigate to={user.role === "admin" ? "/admin" : "/"} replace />;
  }
  return <Login />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster theme="dark" richColors position="bottom-right" />
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginGate />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/pricing" element={<Pricing />} />

          {/* Authenticated */}
          <Route path="/" element={<Protected><DashboardLayout /></Protected>}>
            <Route index element={<Overview />} />
            <Route path="sessions" element={<Sessions />} />
            <Route path="send" element={<Send />} />
            <Route path="rules" element={<Rules />} />
            <Route path="webhooks" element={<Webhooks />} />
            <Route path="logs" element={<Logs />} />
            <Route path="keys" element={<ApiKeys />} />
            <Route path="docs" element={<ApiDocs />} />
            <Route path="billing" element={<Billing />} />

            {/* Admin */}
            <Route path="admin" element={<AdminOnly><AdminOverview /></AdminOnly>} />
            <Route path="admin/users" element={<AdminOnly><AdminUsers /></AdminOnly>} />
            <Route path="admin/plans" element={<AdminOnly><AdminPlans /></AdminOnly>} />
            <Route path="admin/payments" element={<AdminOnly><AdminPayments /></AdminOnly>} />
            <Route path="admin/settings" element={<AdminOnly><AdminSettings /></AdminOnly>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
