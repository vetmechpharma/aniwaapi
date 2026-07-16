import React, { useState } from "react";
import { API } from "@/lib/api";
import { Copy, Check } from "@phosphor-icons/react";

const BASE = API.replace(/\/api$/, "");

// Group endpoints by method / body type so users see all 3 request styles.
const endpoints = [
  // ===== GET =====
  {
    method: "GET",
    path: "/api/v1/sessions",
    scope: "sessions:read",
    title: "List all sessions and their live status",
    bodyType: "none",
    query: null,
    jsonBody: null,
    curl: `curl -X GET "${BASE}/api/v1/sessions" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
    js: `const r = await fetch("${BASE}/api/v1/sessions", {
  method: "GET",
  headers: { Authorization: "Bearer YOUR_API_KEY" },
});
const data = await r.json();`,
    py: `import requests
r = requests.get("${BASE}/api/v1/sessions",
    headers={"Authorization": "Bearer YOUR_API_KEY"})
print(r.json())`,
    response: `{
  "sessions": [
    {
      "id": "primary",
      "slug": "primary",
      "status": "connected",     // connected | connecting | reconnecting | qr | pairing | logged_out | disconnected | unknown
      "connected": true,         // ✅ boolean — use this in your CRM
      "ready": true,             // legacy alias of "connected"
      "phone": "919999999999",   // E.164 digits of the WhatsApp number (null if disconnected)
      "me": { "id": "919999999999:1@s.whatsapp.net", "name": "Your name" },
      "hasQr": false,
      "pairingCode": null,
      "lastError": null,
      "sidecar_reachable": true,
      "checked_at": "2026-02-14T10:22:31.456+00:00"
    }
  ]
}
// NOTE: for efficient polling, the LIST endpoint omits the large \`qr\` / \`qrDataUrl\`
// blobs. Fetch GET /api/v1/sessions/{slug} to receive them when hasQr = true.`,
  },
  {
    method: "GET",
    path: "/api/v1/sessions/{slug}",
    scope: "sessions:read",
    title: "Get one session's full status (CRM-friendly)",
    bodyType: "none",
    query: null,
    jsonBody: null,
    curl: `curl -X GET "${BASE}/api/v1/sessions/primary" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
    js: `const r = await fetch("${BASE}/api/v1/sessions/primary", {
  headers: { Authorization: "Bearer YOUR_API_KEY" },
});
const s = await r.json();
if (s.connected) {
  console.log("Ready to send from", s.phone);
} else {
  console.log("Not connected:", s.status);
}`,
    py: `import requests
r = requests.get("${BASE}/api/v1/sessions/primary",
    headers={"Authorization": "Bearer YOUR_API_KEY"})
s = r.json()
print("connected" if s["connected"] else "offline", "-", s["status"], "-", s.get("phone"))`,
    response: `{
  "id": "primary",
  "slug": "primary",
  "status": "connected",
  "connected": true,
  "ready": true,
  "phone": "919999999999",
  "me": { "id": "919999999999:1@s.whatsapp.net", "name": "Your name" },
  "hasQr": false,
  "pairingCode": null,
  "lastError": null,
  "sidecar_reachable": true,
  "checked_at": "2026-02-14T10:22:31.456+00:00"
}`,
  },
  {
    method: "GET",
    path: "/api/v1/sessions/{slug}/status",
    scope: "sessions:read",
    title: "Lightweight status ping (best for CRM polling)",
    bodyType: "none",
    query: null,
    jsonBody: null,
    curl: `curl -X GET "${BASE}/api/v1/sessions/primary/status" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
    js: `const { connected, status, phone } = await (await fetch(
  "${BASE}/api/v1/sessions/primary/status",
  { headers: { Authorization: "Bearer YOUR_API_KEY" } }
)).json();`,
    py: `import requests
data = requests.get("${BASE}/api/v1/sessions/primary/status",
    headers={"Authorization": "Bearer YOUR_API_KEY"}).json()
# data == { "connected": True, "status": "connected", "phone": "919...", ... }`,
    response: `{
  "id": "primary",
  "connected": true,
  "status": "connected",
  "phone": "919999999999",
  "sidecar_reachable": true,
  "checked_at": "2026-02-14T10:22:31.456+00:00"
}`,
  },
  {
    method: "GET",
    path: "/api/v1/sessions/{slug}/groups",
    scope: "groups:read",
    title: "List groups a session participates in",
    bodyType: "none",
    query: null,
    jsonBody: null,
    curl: `curl -X GET "${BASE}/api/v1/sessions/primary/groups" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
    js: `const r = await fetch("${BASE}/api/v1/sessions/primary/groups", {
  headers: { Authorization: "Bearer YOUR_API_KEY" },
});`,
    py: `import requests
r = requests.get(
    "${BASE}/api/v1/sessions/primary/groups",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
)`,
    response: `{
  "groups": [
    { "id": "12345-67890@g.us", "subject": "Team", "size": 12, "owner": "9198...@s.whatsapp.net" }
  ]
}`,
  },
  {
    method: "GET",
    path: "/api/v1/logs",
    scope: "logs:read",
    title: "Read recent messages (in + out) with filters",
    bodyType: "none",
    query: [
      { name: "session_id", type: "string", required: false, desc: "Filter by session slug" },
      { name: "direction",  type: "string", required: false, desc: "'incoming' or 'outgoing'" },
      { name: "limit",      type: "int",    required: false, desc: "Max results (1–500, default 100)" },
    ],
    jsonBody: null,
    curl: `curl -X GET "${BASE}/api/v1/logs?session_id=primary&direction=incoming&limit=50" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
    js: `const q = new URLSearchParams({ session_id: "primary", direction: "incoming", limit: "50" });
const r = await fetch("${BASE}/api/v1/logs?" + q, {
  headers: { Authorization: "Bearer YOUR_API_KEY" },
});`,
    py: `import requests
r = requests.get("${BASE}/api/v1/logs",
    params={"session_id": "primary", "direction": "incoming", "limit": 50},
    headers={"Authorization": "Bearer YOUR_API_KEY"})`,
    response: `{
  "messages": [
    { "id": "…", "session_id": "primary", "direction": "incoming", "remote_jid": "9198…@s.whatsapp.net",
      "text": "hi", "media_type": null, "status": "delivered", "timestamp": 1735000000 }
  ]
}`,
  },

  // ===== POST + application/json =====
  {
    method: "POST",
    path: "/api/v1/send/text",
    scope: "send:text",
    title: "Send a text message",
    bodyType: "json",
    query: null,
    jsonBody: {
      session_id: "primary",
      to: "919812345678",
      text: "Hello from my server!",
    },
    curl: `curl -X POST "${BASE}/api/v1/send/text" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "session_id": "primary",
    "to": "919812345678",
    "text": "Hello from my server!"
  }'`,
    js: `const r = await fetch("${BASE}/api/v1/send/text", {
  method: "POST",
  headers: {
    Authorization: "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    session_id: "primary",
    to: "919812345678",
    text: "Hello from my server!",
  }),
});
const data = await r.json();`,
    py: `import requests
r = requests.post("${BASE}/api/v1/send/text",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={"session_id": "primary", "to": "919812345678", "text": "Hello!"})
print(r.json())`,
    response: `{ "ok": true, "messageId": "3EB0...", "jid": "919812345678@s.whatsapp.net" }`,
  },
  {
    method: "POST",
    path: "/api/v1/broadcast",
    scope: "broadcast",
    title: "Send the same text to multiple recipients (throttled server-side)",
    bodyType: "json",
    query: null,
    jsonBody: {
      session_id: "primary",
      recipients: ["919812345678", "919887776655"],
      text: "Announcement!",
    },
    curl: `curl -X POST "${BASE}/api/v1/broadcast" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "session_id": "primary",
    "recipients": ["919812345678", "919887776655"],
    "text": "Announcement!"
  }'`,
    js: `const r = await fetch("${BASE}/api/v1/broadcast", {
  method: "POST",
  headers: { Authorization: "Bearer YOUR_API_KEY", "Content-Type": "application/json" },
  body: JSON.stringify({
    session_id: "primary",
    recipients: ["919812345678", "919887776655"],
    text: "Announcement!",
  }),
});`,
    py: `import requests
r = requests.post("${BASE}/api/v1/broadcast",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={"session_id": "primary",
          "recipients": ["919812345678", "919887776655"],
          "text": "Announcement!"})`,
    response: `{
  "ok": true,
  "results": [
    { "to": "919812345678", "ok": true, "messageId": "…" },
    { "to": "919887776655", "ok": true, "messageId": "…" }
  ]
}`,
  },

  // ===== POST + multipart/form-data =====
  {
    method: "POST",
    path: "/api/v1/send/media",
    scope: "send:media",
    title: "Send an image / video / audio / document (multipart upload)",
    bodyType: "form",
    query: null,
    jsonBody: null,
    formFields: [
      { name: "session_id", type: "text", required: true, desc: "Session slug (e.g. `primary`)" },
      { name: "to",         type: "text", required: true, desc: "Phone number or full JID" },
      { name: "media_type", type: "text", required: true, desc: "`image` | `video` | `audio` | `document`" },
      { name: "caption",    type: "text", required: false, desc: "Optional caption (text under media)" },
      { name: "file",       type: "file", required: true, desc: "Binary file, max 50 MB" },
    ],
    curl: `curl -X POST "${BASE}/api/v1/send/media" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -F "session_id=primary" \\
  -F "to=919812345678" \\
  -F "media_type=image" \\
  -F "caption=Look at this" \\
  -F "file=@/path/to/photo.jpg"`,
    js: `const fd = new FormData();
fd.append("session_id", "primary");
fd.append("to", "919812345678");
fd.append("media_type", "image");
fd.append("caption", "Look at this");
fd.append("file", fileInput.files[0]);   // from an <input type="file">

const r = await fetch("${BASE}/api/v1/send/media", {
  method: "POST",
  headers: { Authorization: "Bearer YOUR_API_KEY" },  // DO NOT set Content-Type — browser adds boundary
  body: fd,
});`,
    py: `import requests
files = {"file": open("/path/to/photo.jpg", "rb")}
data  = {"session_id": "primary", "to": "919812345678",
         "media_type": "image", "caption": "Look at this"}
r = requests.post("${BASE}/api/v1/send/media",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    data=data, files=files)`,
    response: `{ "ok": true, "messageId": "3EB0...", "jid": "919812345678@s.whatsapp.net" }`,
  },
];

function MethodBadge({ m }) {
  const style = m === "GET"
    ? { color: "#128C7E", background: "#F0FDF4", border: "1px solid #BBF7D0" }
    : { color: "#052E1B", background: "#25D366", border: "1px solid #25D366" };
  return (
    <span style={style} className="inline-block font-mono text-[11px] font-bold tracking-wider px-2.5 py-1 rounded">
      {m}
    </span>
  );
}
function BodyTypeBadge({ t }) {
  const label = { json: "application/json", form: "multipart/form-data", none: "no body" }[t];
  const cls = t === "none" ? "wa-badge" : (t === "json" ? "wa-badge wa-badge-blue" : "wa-badge wa-badge-yellow");
  return <span className={cls}>{label}</span>;
}

function CopyBlock({ text, testid }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group">
      <pre className="terminal !text-[12px] pr-14" data-testid={testid}>{text}</pre>
      <button
        onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
        className="wa-btn wa-btn-secondary absolute top-2 right-2 always-touch-visible md:opacity-0 md:group-hover:opacity-100 md:transition-opacity"
        title="Copy"
      >
        {copied ? <><Check size={12}/> COPIED</> : <><Copy size={12}/> COPY</>}
      </button>
    </div>
  );
}

function EndpointCard({ e }) {
  const [tab, setTab] = useState("curl");
  const code = e[tab];
  return (
    <div className="wa-card p-6 mb-6" data-testid={`endpoint-${e.method}-${e.path}`}>
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <MethodBadge m={e.method}/>
        <code className="mono text-white text-sm break-all">{e.path}</code>
        <BodyTypeBadge t={e.bodyType}/>
        <span className="wa-badge">scope: <span className="text-[#25D366] ml-1">{e.scope}</span></span>
      </div>
      <p className="text-zinc-300 text-sm mb-4">{e.title}</p>

      {/* Parameters */}
      {e.query && (
        <div className="mb-4">
          <div className="mono text-[10px] uppercase text-zinc-500 mb-2">QUERY PARAMS</div>
          <div className="wa-table-wrap">
            <table className="wa-table text-xs min-w-[540px]">
              <tbody>
                {e.query.map((q) => (
                  <tr key={q.name}>
                    <td className="mono text-[#25D366]">{q.name}</td>
                    <td className="mono text-zinc-400">{q.type}</td>
                    <td className="mono text-zinc-500">{q.required ? "required" : "optional"}</td>
                    <td className="text-zinc-300">{q.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {e.bodyType === "json" && e.jsonBody && (
        <div className="mb-4">
          <div className="mono text-[10px] uppercase text-zinc-500 mb-2">
            JSON BODY <span className="text-zinc-600">(Content-Type: application/json)</span>
          </div>
          <CopyBlock text={JSON.stringify(e.jsonBody, null, 2)} testid={`json-${e.path}`}/>
        </div>
      )}

      {e.bodyType === "form" && e.formFields && (
        <div className="mb-4">
          <div className="mono text-[10px] uppercase text-zinc-500 mb-2">
            FORM FIELDS <span className="text-zinc-600">(Content-Type: multipart/form-data)</span>
          </div>
          <div className="wa-table-wrap">
            <table className="wa-table text-xs min-w-[600px]">
              <tbody>
                {e.formFields.map((f) => (
                  <tr key={f.name}>
                    <td className="mono text-[#25D366]">{f.name}</td>
                    <td className="mono text-zinc-400">{f.type}</td>
                    <td className="mono text-zinc-500">{f.required ? "required" : "optional"}</td>
                    <td className="text-zinc-300" dangerouslySetInnerHTML={{ __html: f.desc.replace(/`([^`]+)`/g, '<code class="mono text-[#25D366]">$1</code>') }}/>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Language tabs */}
      <div className="flex gap-2 mb-2">
        {["curl", "js", "py"].map(t => (
          <button key={t}
            className={"wa-btn " + (tab === t ? "wa-btn-primary" : "wa-btn-secondary")}
            onClick={() => setTab(t)}>
            {t === "curl" ? "cURL" : t === "js" ? "JavaScript" : "Python"}
          </button>
        ))}
      </div>
      <CopyBlock text={code} testid={`code-${tab}-${e.path}`}/>

      {e.response && (
        <div className="mt-4">
          <div className="mono text-[10px] uppercase text-zinc-500 mb-2">RESPONSE (200 OK)</div>
          <pre className="terminal !text-[12px]" style={{ color: "#DCF8C6" }}>{e.response}</pre>
        </div>
      )}
    </div>
  );
}

const webhookExample = `{
  "session_id": "primary",
  "direction": "incoming",
  "remote_jid": "919812345678@s.whatsapp.net",
  "message_id": "3EB0...",
  "push_name": "Alice",
  "text": "hello",
  "media_type": null,
  "status": "delivered",
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
          Every endpoint here uses one of three request styles:
          <br/>
          <span className="mono text-[#25D366]">GET</span> (no body) ·{" "}
          <span className="mono text-[#25D366]">POST</span> with <span className="mono text-[#3388FF]">application/json</span> ·{" "}
          <span className="mono text-[#25D366]">POST</span> with <span className="mono text-[#FFB800]">multipart/form-data</span>.
          <br/>
          Full interactive Swagger UI:{" "}
          <a className="text-[#25D366] underline mono" href={`${BASE}/docs`} target="_blank" rel="noreferrer" data-testid="swagger-link">{BASE}/docs</a>
        </p>
      </div>

      <div className="wa-card p-6 mb-6">
        <div className="mono text-xs uppercase tracking-widest text-zinc-500 mb-3">Base URL</div>
        <code className="mono text-[#25D366] text-sm block break-all">{BASE}</code>
      </div>

      <div className="wa-card p-6 mb-8">
        <div className="mono text-xs uppercase tracking-widest text-zinc-500 mb-3">Authentication (every request)</div>
        <p className="text-zinc-300 text-sm mb-3">Send your API key in the <code className="mono text-[#25D366]">Authorization</code> header:</p>
        <pre className="terminal !text-[12px]">{`Authorization: Bearer YOUR_API_KEY`}</pre>
        <p className="text-zinc-400 text-xs mt-3">
          Create keys with fine-grained scopes and rate limits on the <a href="/app/keys" className="text-[#25D366] underline">API Keys</a> page.
        </p>
      </div>

      {/* Sections */}
      <h2 className="text-2xl font-medium text-white mt-10 mb-4">GET endpoints</h2>
      <p className="text-zinc-400 text-sm mb-4">Read-only. No request body. Query params (if any) go in the URL.</p>
      {endpoints.filter(e => e.method === "GET").map((e) => <EndpointCard key={e.path} e={e}/>)}

      <h2 className="text-2xl font-medium text-white mt-12 mb-4">POST with JSON body</h2>
      <p className="text-zinc-400 text-sm mb-4">
        Set <code className="mono text-[#25D366]">Content-Type: application/json</code> and send the body as a JSON string.
      </p>
      {endpoints.filter(e => e.method === "POST" && e.bodyType === "json").map((e) => <EndpointCard key={e.path} e={e}/>)}

      <h2 className="text-2xl font-medium text-white mt-12 mb-4">POST with form-data (file uploads)</h2>
      <p className="text-zinc-400 text-sm mb-4">
        Use <code className="mono text-[#25D366]">multipart/form-data</code> for any endpoint that accepts a file.
        <br/>
        <span className="text-yellow-500">Note (JS):</span> when using <code>FormData</code>, <strong>do NOT</strong> manually set <code className="mono">Content-Type</code> — the browser writes the correct boundary for you.
      </p>
      {endpoints.filter(e => e.method === "POST" && e.bodyType === "form").map((e) => <EndpointCard key={e.path} e={e}/>)}

      <h2 className="text-2xl font-medium text-white mt-12 mb-4">Webhook payload (incoming messages)</h2>
      <div className="wa-card p-6">
        <p className="text-zinc-300 text-sm mb-4">
          When configured on the <a href="/app/webhooks" className="text-[#25D366] underline">Webhooks page</a>, this JSON is POSTed to your URL every time a new message arrives.
        </p>
        <CopyBlock text={webhookExample} testid="webhook-example"/>
      </div>

      <h2 className="text-2xl font-medium text-white mt-12 mb-4">Error responses</h2>
      <div className="wa-card p-6">
        <div className="wa-table-wrap">
          <table className="wa-table min-w-[420px]">
            <thead><tr><th>CODE</th><th>MEANING</th></tr></thead>
            <tbody>
              <tr><td className="mono text-yellow-500">401</td><td>Missing or invalid Bearer token</td></tr>
              <tr><td className="mono text-yellow-500">402</td><td>Owner has no active subscription (or plan quota reached)</td></tr>
              <tr><td className="mono text-yellow-500">403</td><td>API key does not have the required scope</td></tr>
              <tr><td className="mono text-yellow-500">404</td><td>Session slug not found (for that owner)</td></tr>
              <tr><td className="mono text-yellow-500">409</td><td>Session is not connected (scan the QR first)</td></tr>
              <tr><td className="mono text-yellow-500">429</td><td>Rate limit exceeded (per-key) OR daily message quota hit</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <h2 className="text-2xl font-medium text-white mt-12 mb-4">Notes</h2>
      <ul className="text-zinc-300 text-sm space-y-2 list-disc pl-6">
        <li><span className="mono text-[#25D366]">to</span> accepts a phone number (digits only, with country code) or a full JID like <span className="mono">919812345678@s.whatsapp.net</span> — or a group JID <span className="mono">12345-6789@g.us</span>.</li>
        <li>Media uploads are limited to 50 MB per file.</li>
        <li>Broadcasts are throttled internally (~500 ms per recipient) to reduce ban risk.</li>
        <li><strong>This is an unofficial WhatsApp API</strong> — use only for personal / server automation. Avoid bulk marketing to protect your number.</li>
      </ul>
    </div>
  );
}
