import React from "react";
import { API } from "@/lib/api";

const BASE = API.replace(/\/api$/, "");

const endpoints = [
  {
    method: "POST",
    path: "/api/v1/send/text",
    title: "Send text message",
    body: `{
  "session_id": "primary",
  "to": "14155551234",
  "text": "Hello from my API"
}`,
    curl: (base) => `curl -X POST "${base}/api/v1/send/text" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"session_id":"primary","to":"14155551234","text":"Hello"}'`,
  },
  {
    method: "POST",
    path: "/api/v1/send/media",
    title: "Send media (multipart)",
    body: `Multipart form:
  session_id: primary
  to: 14155551234
  media_type: image | video | audio | document
  caption: (optional)
  file: <binary>`,
    curl: (base) => `curl -X POST "${base}/api/v1/send/media" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -F "session_id=primary" \\
  -F "to=14155551234" \\
  -F "media_type=image" \\
  -F "caption=Hello" \\
  -F "file=@/path/to/image.jpg"`,
  },
  {
    method: "POST",
    path: "/api/v1/broadcast",
    title: "Broadcast text to multiple recipients",
    body: `{
  "session_id": "primary",
  "recipients": ["14155551234", "14155559999"],
  "text": "Announcement"
}`,
    curl: (base) => `curl -X POST "${base}/api/v1/broadcast" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"session_id":"primary","recipients":["14155551234"],"text":"Hi"}'`,
  },
  {
    method: "GET",
    path: "/api/v1/sessions",
    title: "List sessions and connection status",
    body: "-- no body --",
    curl: (base) => `curl "${base}/api/v1/sessions" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
  },
  {
    method: "GET",
    path: "/api/v1/sessions/{sid}/groups",
    title: "List groups for a session",
    body: "-- no body --",
    curl: (base) => `curl "${base}/api/v1/sessions/primary/groups" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
  },
];

const webhookExample = `{
  "session_id": "primary",
  "direction": "incoming",
  "remote_jid": "14155551234@s.whatsapp.net",
  "message_id": "3EB0...",
  "push_name": "Alice",
  "text": "hello",
  "media_type": null,
  "timestamp": 1735000000,
  "created_at": "2026-01-15T10:00:00+00:00"
}`;

export default function ApiDocs() {
  return (
    <div className="p-6 md:p-10 max-w-6xl">
      <div className="mb-10">
        <div className="mono text-[11px] uppercase tracking-widest text-zinc-500 mb-1">/docs</div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-white">API Reference</h1>
        <p className="text-zinc-400 mt-2 text-sm max-w-2xl">
          Use these endpoints from your CRM, backend, or scripts. All calls require a Bearer API key
          (create one in <span className="text-[#00E559] mono">API Keys</span>).
          Interactive Swagger UI:{" "}
          <a className="text-[#00E559] underline mono" href={`${BASE}/docs`} target="_blank" rel="noreferrer" data-testid="swagger-link">
            {BASE}/docs
          </a>
        </p>
      </div>

      <div className="wa-card p-6 mb-8">
        <div className="mono text-xs uppercase tracking-widest text-zinc-500 mb-3">Base URL</div>
        <code className="mono text-[#00E559] text-sm block break-all">{BASE}</code>
      </div>

      <div className="wa-card p-6 mb-8">
        <div className="mono text-xs uppercase tracking-widest text-zinc-500 mb-3">Authentication</div>
        <p className="text-zinc-300 text-sm mb-3">Send your API key in the <code className="mono text-[#00E559]">Authorization</code> header on every request:</p>
        <pre className="terminal">{`Authorization: Bearer YOUR_API_KEY`}</pre>
      </div>

      <h2 className="text-2xl font-medium text-white mt-10 mb-4">Endpoints</h2>

      <div className="space-y-6">
        {endpoints.map((e) => (
          <div key={e.path + e.method} className="wa-card p-6" data-testid={`endpoint-${e.method}-${e.path.replace(/\//g, "_")}`}>
            <div className="flex items-center gap-3 mb-3">
              <span className={
                "wa-badge " +
                (e.method === "GET" ? "wa-badge-blue" : "wa-badge-green")
              }>{e.method}</span>
              <code className="mono text-white text-sm">{e.path}</code>
            </div>
            <div className="text-zinc-300 text-sm mb-4">{e.title}</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="mono text-[10px] uppercase text-zinc-500 mb-1">REQUEST BODY</div>
                <pre className="terminal text-white" style={{ color: "#fff" }}>{e.body}</pre>
              </div>
              <div>
                <div className="mono text-[10px] uppercase text-zinc-500 mb-1">CURL</div>
                <pre className="terminal">{e.curl(BASE)}</pre>
              </div>
            </div>
          </div>
        ))}
      </div>

      <h2 className="text-2xl font-medium text-white mt-10 mb-4">Webhook Payload (incoming messages)</h2>
      <div className="wa-card p-6">
        <p className="text-zinc-300 text-sm mb-4">
          When configured, we POST this JSON body to your webhook URL every time a new message arrives on that session.
        </p>
        <pre className="terminal">{webhookExample}</pre>
      </div>

      <h2 className="text-2xl font-medium text-white mt-10 mb-4">Notes</h2>
      <ul className="text-zinc-300 text-sm space-y-2 list-disc pl-6">
        <li><span className="mono text-[#00E559]">to</span> can be a phone number with country code (digits only), or a full JID like <span className="mono">14155551234@s.whatsapp.net</span> / <span className="mono">12345-6789@g.us</span> for groups.</li>
        <li>Media uploads are limited to 50 MB per file.</li>
        <li>This is an <strong>unofficial</strong> WhatsApp API. Use only for personal / server automation. WhatsApp may ban accounts if abused - do not use for marketing spam.</li>
        <li>Broadcasts are throttled internally (~500ms per recipient) to reduce ban risk.</li>
      </ul>
    </div>
  );
}
