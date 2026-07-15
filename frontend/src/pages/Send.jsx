import React, { useEffect, useState } from "react";
import { api, formatError, API } from "@/lib/api";
import { PaperPlaneRight, FileArrowUp } from "@phosphor-icons/react";

export default function Send() {
  const [sessions, setSessions] = useState([]);
  const [tab, setTab] = useState("text");
  const [sid, setSid] = useState("");
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [caption, setCaption] = useState("");
  const [mediaType, setMediaType] = useState("image");
  const [file, setFile] = useState(null);
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/sessions").then(({ data }) => {
      const connected = (data.sessions || []).filter((s) => s.ready);
      setSessions(connected);
      if (connected.length > 0 && !sid) setSid(connected[0].id);
    }).catch(() => {});
  }, []);

  async function sendText() {
    setBusy(true); setResponse("SENDING...\n");
    try {
      const { data } = await api.post("/send/text", { session_id: sid, to, text });
      setResponse((r) => r + JSON.stringify(data, null, 2));
    } catch (e) { setResponse((r) => r + "\nERR: " + formatError(e)); }
    finally { setBusy(false); }
  }

  async function sendMedia() {
    if (!file) { setResponse("ERR: no file"); return; }
    setBusy(true); setResponse("UPLOADING...\n");
    try {
      const fd = new FormData();
      fd.append("session_id", sid);
      fd.append("to", to);
      fd.append("caption", caption);
      fd.append("media_type", mediaType);
      fd.append("file", file);
      const { data } = await api.post("/send/media", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResponse((r) => r + JSON.stringify(data, null, 2));
    } catch (e) { setResponse((r) => r + "\nERR: " + formatError(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="p-6 md:p-10">
      <div className="mb-8">
        <div className="mono text-[11px] uppercase tracking-widest text-zinc-500 mb-1">/send</div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-white">Send Playground</h1>
        <p className="text-zinc-400 mt-2 text-sm">Test the API by sending live messages from your connected sessions.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="wa-card p-6">
          <div className="flex gap-2 mb-6">
            <button
              className={`wa-btn ${tab === "text" ? "wa-btn-primary" : "wa-btn-secondary"}`}
              onClick={() => setTab("text")}
              data-testid="send-tab-text"
            >TEXT</button>
            <button
              className={`wa-btn ${tab === "media" ? "wa-btn-primary" : "wa-btn-secondary"}`}
              onClick={() => setTab("media")}
              data-testid="send-tab-media"
            >MEDIA</button>
          </div>

          <div className="mb-4">
            <label className="wa-label">SESSION</label>
            <select className="wa-select" value={sid} onChange={(e) => setSid(e.target.value)} data-testid="send-session-select">
              <option value="">-- select connected session --</option>
              {sessions.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}
            </select>
            {sessions.length === 0 && (
              <div className="mono text-[10px] text-yellow-500 mt-1">
                ! No connected sessions. Create/connect one in Sessions tab first.
              </div>
            )}
          </div>

          <div className="mb-4">
            <label className="wa-label">TO (phone with country code or full JID)</label>
            <input className="wa-input" placeholder="14155551234 or 14155551234@s.whatsapp.net or 12345-6789@g.us"
                   value={to} onChange={(e) => setTo(e.target.value)} data-testid="send-to-input" />
          </div>

          {tab === "text" ? (
            <>
              <div className="mb-4">
                <label className="wa-label">MESSAGE</label>
                <textarea className="wa-textarea" value={text} onChange={(e) => setText(e.target.value)} data-testid="send-text-input" />
              </div>
              <button className="wa-btn wa-btn-primary w-full justify-center" disabled={busy || !sid || !to || !text} onClick={sendText} data-testid="send-text-btn">
                <PaperPlaneRight size={14}/> {busy ? "SENDING..." : "SEND MESSAGE"}
              </button>
            </>
          ) : (
            <>
              <div className="mb-4">
                <label className="wa-label">MEDIA TYPE</label>
                <select className="wa-select" value={mediaType} onChange={(e) => setMediaType(e.target.value)} data-testid="send-media-type">
                  <option value="image">image</option>
                  <option value="video">video</option>
                  <option value="audio">audio</option>
                  <option value="document">document</option>
                </select>
              </div>
              <div className="mb-4">
                <label className="wa-label">FILE (max 50MB)</label>
                <input type="file" className="wa-input" onChange={(e) => setFile(e.target.files?.[0])} data-testid="send-media-file" />
              </div>
              <div className="mb-4">
                <label className="wa-label">CAPTION (optional)</label>
                <input className="wa-input" value={caption} onChange={(e) => setCaption(e.target.value)} data-testid="send-media-caption" />
              </div>
              <button className="wa-btn wa-btn-primary w-full justify-center" disabled={busy || !sid || !to || !file} onClick={sendMedia} data-testid="send-media-btn">
                <FileArrowUp size={14}/> {busy ? "UPLOADING..." : "SEND MEDIA"}
              </button>
            </>
          )}
        </div>

        <div>
          <div className="mono text-[11px] uppercase tracking-widest text-zinc-500 mb-2">RESPONSE</div>
          <pre className="terminal" data-testid="send-response">{response || "// waiting for send...\n// $ _"}</pre>
        </div>
      </div>
    </div>
  );
}
