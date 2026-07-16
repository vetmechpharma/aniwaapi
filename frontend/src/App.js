import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/api";
import { Toaster } from "sonner";

// Public
import Landing from "@/pages/Landing";
import Features from "@/pages/Features";
import Pricing from "@/pages/Pricing";
import Contact from "@/pages/Contact";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";

// App
import DashboardLayout from "@/components/DashboardLayout";
import AdminLayout from "@/components/AdminLayout";
import Overview from "@/pages/Overview";
import Sessions from "@/pages/Sessions";
import Send from "@/pages/Send";
import Rules from "@/pages/Rules";
import Webhooks from "@/pages/Webhooks";
import Logs from "@/pages/Logs";
import ApiKeys from "@/pages/ApiKeys";
import ApiDocs from "@/pages/ApiDocs";
import Billing from "@/pages/Billing";

// Admin
import AdminOverview from "@/pages/admin/AdminOverview";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminPlans from "@/pages/admin/AdminPlans";
import AdminPayments from "@/pages/admin/AdminPayments";
import AdminSettings from "@/pages/admin/AdminSettings";
import AdminMessages from "@/pages/admin/AdminMessages";
import AdminSmtp from "@/pages/admin/AdminSmtp";
import AdminSendMessage from "@/pages/admin/AdminSendMessage";

function Loader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="mono text-[#25D366] text-sm">CONNECTING<span className="blink">_</span></div>
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
  if (user.role !== "admin") return <Navigate to="/app" replace />;
  return children;
}

function LoginGate() {
  const { user } = useAuth();
  if (user === null) return <Loader />;
  if (user && user !== false) return <Navigate to={user.role === "admin" ? "/admin" : "/app"} replace />;
  return <Login />;
}

function HomeGate() {
  // Public landing is always the front page — logged-in users use the nav bar's Dashboard button
  const { user } = useAuth();
  if (user === null) return <Loader />;
  return <Landing />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster theme="dark" richColors position="bottom-right" />
        <Routes>
          {/* Public marketing site */}
          <Route path="/" element={<HomeGate />} />
          <Route path="/features" element={<Features />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/login" element={<LoginGate />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Authenticated app */}
          <Route path="/app" element={<Protected><DashboardLayout /></Protected>}>
            <Route index element={<Overview />} />
            <Route path="sessions" element={<Sessions />} />
            <Route path="send" element={<Send />} />
            <Route path="rules" element={<Rules />} />
            <Route path="webhooks" element={<Webhooks />} />
            <Route path="logs" element={<Logs />} />
            <Route path="keys" element={<ApiKeys />} />
            <Route path="docs" element={<ApiDocs />} />
            <Route path="billing" element={<Billing />} />
          </Route>

          {/* Admin panel — uses its own light-theme layout */}
          <Route path="/admin" element={<AdminOnly><AdminLayout /></AdminOnly>}>
            <Route index element={<AdminOverview />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="plans" element={<AdminPlans />} />
            <Route path="payments" element={<AdminPayments />} />
            <Route path="messages" element={<AdminMessages />} />
            <Route path="send" element={<AdminSendMessage />} />
            <Route path="smtp" element={<AdminSmtp />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
