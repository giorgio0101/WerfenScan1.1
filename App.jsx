import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

// ════════════════════════════════════════════════════════════
//  ⚙️  PASTE YOUR ANTHROPIC API KEY HERE  ⚙️
//  Get it at: https://console.anthropic.com → API Keys
//  Example:   "sk-ant-api03-XXXXXXXXXXXX..."
// ════════════════════════════════════════════════════════════
const ANTHROPIC_API_KEY = "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";

// ════════════════════════════════════════════════════════════
//  ☁️  SHARED CLOUD DATABASE (SUPABASE)  ☁️
//  All parts & scans are shared across every device.
//  Setup once — see GUIDA-SUPABASE.md:
//   1. supabase.com → create free project
//   2. SQL Editor → run the SQL from the guide
//   3. Project Settings → API → copy the two values below
// ════════════════════════════════════════════════════════════
const SUPABASE_URL      = "https://upztxixdnnvhqnirxpye.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwenR4aXhkbm52aHFuaXJ4cHllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NzkxNzEsImV4cCI6MjA5NTU1NTE3MX0._p2toNqZrr2Rlk4FgOOQRSnSQjxuvv94iELwamTokfk";

const cloudReady =
  SUPABASE_URL !== "https://xxxx.supabase.co" &&
  SUPABASE_ANON_KEY !== "eyJhbGc...";

const supabase = cloudReady ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// ===================== THEME =====================
const T = {
  blueDark:    "#0A0980",
  blue:        "rgb(18, 15, 146)",
  blueLight:   "#3F3CB8",
  bluePale:    "#E8E7F8",
  orange:      "#FF6820",
  orangeLight: "#FF8C4A",
  orangePale:  "#FFF1E8",
  bg:          "#F4F5FB",
  card:        "#FFFFFF",
  text:        "#0F1140",
  textMid:     "#4B4F73",
  textLight:   "#8A8FB0",
  border:      "#DCDEF0",
  success:     "#059669",
  error:       "#DC2626",
  shadow:      "0 2px 12px rgba(18,15,146,0.10)",
  shadowLg:    "0 8px 32px rgba(18,15,146,0.18)",
};

const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif`;

const GLOBAL_STYLES = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
  html, body {
    font-family: ${FONT};
    background: ${T.bg};
    color: ${T.text};
    -webkit-font-smoothing: antialiased;
    -webkit-tap-highlight-color: transparent;
    width: 100%;
    overflow-x: hidden;
  }
  body { overscroll-behavior-y: contain; line-height: 1.4; }
  #root { width: 100%; overflow-x: hidden; }

  /* Inputs at 16px+ so iOS Safari/Chrome never auto-zooms on focus */
  input, textarea, select, button {
    font-family: ${FONT};
    outline: none;
    font-size: 16px;
  }
  button { cursor: pointer; border: none; -webkit-appearance: none; appearance: none; }
  textarea { resize: vertical; }
  input[type="file"] { display: none; }

  /* All images responsive by default — never overflow the screen */
  img { max-width: 100%; height: auto; }

  /* Tables scroll horizontally on small screens instead of breaking layout */
  table { width: 100%; border-collapse: collapse; }
  .table-scroll { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }

  /* Long codes / words wrap instead of overflowing */
  .wrap-anywhere { overflow-wrap: anywhere; word-break: break-word; }

  @keyframes spin    { to { transform: rotate(360deg); } }
  @keyframes fadeUp  { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
  @keyframes fadeIn  { from { opacity:0; } to { opacity:1; } }
  @keyframes pulse   { 0%,100%{opacity:1;} 50%{opacity:0.5;} }
  .fade-up  { animation: fadeUp  0.4s ease both; }
  .fade-in  { animation: fadeIn  0.3s ease both; }
  .tap-sc   { transition: transform 0.12s; }
  .tap-sc:active { transform: scale(0.96); }
`;

// ===================== LOCAL STORAGE (per-device settings only) =====================
const db = {
  get: async (key) => {
    try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; }
    catch (e) { console.error("db.get error:", e); return null; }
  },
  set: async (key, val) => {
    try { localStorage.setItem(key, JSON.stringify(val)); }
    catch (e) { console.error("db.set error:", e); }
  },
};

// ===================== SHARED CLOUD DATA LAYER (Supabase) =====================
// Parts & scan history live here so every device sees the same data.
const cloud = {
  async loadParts() {
    const { data, error } = await supabase
      .from("parts").select("*").order("created_at", { ascending: false });
    if (error) { console.error("loadParts:", error); throw error; }
    return (data || []).map(p => ({
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description || "",
      category: p.category || "",
      compatibility: p.compatibility || [],
      imageBase64: p.image_base64 || "",
    }));
  },
  async addPart(part) {
    const { data, error } = await supabase.from("parts").insert([{
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      code: part.code.trim(),
      name: part.name.trim(),
      description: part.description || "",
      category: part.category || "",
      compatibility: part.compatibility || [],
      image_base64: part.imageBase64 || "",
    }]).select().single();
    if (error) throw error;
    return { ...data, imageBase64: data.image_base64 || "", compatibility: data.compatibility || [] };
  },
  async updatePart(id, part) {
    const { data, error } = await supabase.from("parts").update({
      code: part.code.trim(),
      name: part.name.trim(),
      description: part.description || "",
      category: part.category || "",
      compatibility: part.compatibility || [],
      image_base64: part.imageBase64 || "",
    }).eq("id", id).select().single();
    if (error) throw error;
    return { ...data, imageBase64: data.image_base64 || "", compatibility: data.compatibility || [] };
  },
  async deletePart(id) {
    const { error } = await supabase.from("parts").delete().eq("id", id);
    if (error) throw error;
  },
  async loadHistory() {
    const { data, error } = await supabase
      .from("scan_history").select("*").order("timestamp", { ascending: false }).limit(60);
    if (error) { console.error("loadHistory:", error); return []; }
    return (data || []).map(h => ({
      matched: h.matched,
      confidence: h.confidence,
      reasoning: h.reasoning,
      image: h.image_base64 || "",
      timestamp: h.timestamp,
      part: h.part_name ? { name: h.part_name, code: h.part_code } : null,
    }));
  },
  async addHistory(item) {
    const { error } = await supabase.from("scan_history").insert([{
      matched: !!item.matched,
      confidence: item.confidence || 0,
      reasoning: item.reasoning || "",
      image_base64: item.image || "",
      part_name: item.part?.name || null,
      part_code: item.part?.code || null,
      timestamp: item.timestamp || new Date().toISOString(),
    }]);
    if (error) console.error("addHistory:", error);
  },
};

function djbHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function compressImage(file, maxSize = 600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("File read error"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Image load error"));
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round((h / w) * maxSize); w = maxSize; }
          else       { w = Math.round((w / h) * maxSize); h = maxSize; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ===================== SPINNER =====================
function Spinner({ size = 28, color = T.blue }) {
  return (
    <div style={{
      width: size, height: size,
      border: `3px solid ${T.bluePale}`,
      borderTop: `3px solid ${color}`,
      borderRadius: "50%",
      animation: "spin 0.75s linear infinite",
      flexShrink: 0,
    }} />
  );
}

// ===================== TAGLINE =====================
function Tagline({ light = false }) {
  return (
    <div style={{
      position: "fixed",
      bottom: "max(12px, env(safe-area-inset-bottom))",
      right: 18,
      fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
      fontStyle: "italic",
      color: light ? "rgba(255,255,255,0.6)" : T.textLight,
      pointerEvents: "none",
      zIndex: 50,
    }}>Powering Patient Care</div>
  );
}

// ===================== CONFIRM DIALOG =====================
function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(10,9,128,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 9999, padding: 24, animation: "fadeIn 0.2s ease"
    }}>
      <div style={{
        background: T.card, borderRadius: 20, padding: 28,
        maxWidth: 320, width: "100%", boxShadow: T.shadowLg,
        animation: "fadeUp 0.2s ease"
      }}>
        <p style={{ color: T.text, fontSize: 16, fontWeight: 600, lineHeight: 1.5, marginBottom: 20 }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: 12, borderRadius: 12,
            background: T.bg, color: T.textMid, fontSize: 15, fontWeight: 600,
            border: `1px solid ${T.border}`
          }}>Cancel</button>
          <button onClick={onConfirm} style={{
            flex: 1, padding: 12, borderRadius: 12,
            background: T.error, color: "white", fontSize: 15, fontWeight: 700,
          }}>Delete</button>
        </div>
      </div>
    </div>
  );
}

// ===================== LOGIN SCREEN =====================
function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleAdminLogin() {
    if (!password.trim()) { setError("Please enter the password"); return; }
    setLoading(true);
    const stored = await db.get("admin_password");
    const defaultHash = djbHash("admin123");
    const inputHash = djbHash(password);
    const ok = stored ? inputHash === stored : inputHash === defaultHash;
    if (ok) {
      if (!stored) await db.set("admin_password", defaultHash);
      onLogin({ role: "admin" });
    } else {
      setError("Incorrect password");
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: `linear-gradient(160deg, ${T.blueDark} 0%, ${T.blue} 55%, ${T.blueLight} 100%)`,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: 24, position: "relative", overflow: "hidden"
    }}>
      <style>{GLOBAL_STYLES}</style>
      <div style={{ position: "absolute", top: -80, right: -80, width: 280, height: 280, borderRadius: "50%", background: "rgba(255,104,32,0.13)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: -60, left: -60, width: 200, height: 200, borderRadius: "50%", background: "rgba(63,60,184,0.22)", pointerEvents: "none" }} />

      <div className="fade-up" style={{ textAlign: "center", marginBottom: 48, position: "relative", zIndex: 1 }}>
        <div style={{
          width: 88, height: 88, borderRadius: 24, margin: "0 auto 16px",
          background: `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 12px 40px rgba(255,104,32,0.45)", fontSize: 40
        }}>🔧</div>
        <div style={{ color: "white", fontSize: 30, fontWeight: 800, letterSpacing: "-0.8px" }}>WERFEN SCAN</div>
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, marginTop: 4, fontWeight: 500 }}>
          Spare Parts Recognition — AI Powered
        </div>
      </div>

      {!mode && (
        <div className="fade-up" style={{
          width: "100%", maxWidth: 360,
          background: "rgba(255,255,255,0.10)", backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid rgba(255,255,255,0.18)", borderRadius: 24, padding: 28,
          animationDelay: "0.1s", position: "relative", zIndex: 1
        }}>
          <p style={{ color: "rgba(255,255,255,0.85)", textAlign: "center", marginBottom: 20, fontSize: 16, fontWeight: 500 }}>
            Select account type
          </p>
          <button onClick={() => onLogin({ role: "user" })} className="tap-sc" style={{
            width: "100%", padding: 18, borderRadius: 16, marginBottom: 12,
            background: `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})`,
            color: "white", fontSize: 16, fontWeight: 700,
            boxShadow: "0 6px 24px rgba(255,104,32,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10
          }}>
            <span style={{ fontSize: 22 }}>📷</span> User Account
          </button>
          <button onClick={() => setMode("admin")} className="tap-sc" style={{
            width: "100%", padding: 18, borderRadius: 16,
            background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)",
            color: "white", fontSize: 16, fontWeight: 600,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10
          }}>
            <span style={{ fontSize: 22 }}>⚙️</span> Administrator Account
          </button>
        </div>
      )}

      {mode === "admin" && (
        <div className="fade-up" style={{
          width: "100%", maxWidth: 360,
          background: "rgba(255,255,255,0.10)", backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid rgba(255,255,255,0.18)", borderRadius: 24, padding: 28,
          position: "relative", zIndex: 1
        }}>
          <h3 style={{ color: "white", marginBottom: 20, textAlign: "center", fontSize: 18, fontWeight: 700 }}>
            Administrator Login
          </h3>
          <input
            type="password" placeholder="Password" autoComplete="current-password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && handleAdminLogin()}
            style={{
              width: "100%", padding: "15px 18px", borderRadius: 14, marginBottom: 8,
              background: "rgba(255,255,255,0.15)",
              border: `1px solid ${error ? T.orange : "rgba(255,255,255,0.25)"}`,
              color: "white", fontSize: 16,
            }}
          />
          {error && <p style={{ color: T.orangeLight, fontSize: 13, marginBottom: 10 }}>⚠️ {error}</p>}
          <button onClick={handleAdminLogin} disabled={loading} className="tap-sc" style={{
            width: "100%", padding: 15, borderRadius: 14, marginBottom: 10,
            background: loading ? "rgba(255,255,255,0.2)" : `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})`,
            color: "white", fontSize: 16, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8
          }}>
            {loading ? <><Spinner size={18} color="white" /> Logging in...</> : "Log In →"}
          </button>
          <button onClick={() => { setMode(null); setError(""); setPassword(""); }} style={{
            width: "100%", padding: 10, borderRadius: 12,
            background: "transparent", color: "rgba(255,255,255,0.6)", fontSize: 14
          }}>← Back</button>
          <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, textAlign: "center", marginTop: 12 }}>
            Default password: admin123
          </p>
        </div>
      )}

      <Tagline light />
    </div>
  );
}

// ===================== HEADER =====================
function Header({ title, subtitle, onLogout }) {
  return (
    <div style={{
      background: `linear-gradient(135deg, ${T.blueDark}, ${T.blue})`,
      padding: "14px 20px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      position: "sticky", top: 0, zIndex: 100,
      boxShadow: "0 4px 20px rgba(18,15,146,0.25)"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 11,
          background: `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, boxShadow: "0 4px 12px rgba(255,104,32,0.35)"
        }}>🔧</div>
        <div>
          <div style={{ color: "white", fontWeight: 700, fontSize: 17, letterSpacing: "-0.3px" }}>{title}</div>
          <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: 500 }}>{subtitle}</div>
        </div>
      </div>
      <button onClick={onLogout} style={{
        background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)",
        color: "rgba(255,255,255,0.85)", borderRadius: 10, padding: "7px 14px",
        fontSize: 13, fontWeight: 600
      }}>Log Out</button>
    </div>
  );
}

// ===================== TAB BAR =====================
function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{
      position: "fixed", bottom: 0,
      left: "50%", transform: "translateX(-50%)",
      width: "100%", maxWidth: 520,
      background: T.card, borderTop: `1px solid ${T.border}`,
      display: "flex",
      paddingBottom: "max(10px, env(safe-area-inset-bottom))",
      paddingTop: 6,
      boxShadow: "0 -4px 24px rgba(18,15,146,0.09)", zIndex: 100
    }}>
      {tabs.map(t => {
        const on = active === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", gap: 3,
            background: "transparent", padding: "6px 0",
            color: on ? T.blue : T.textLight,
            borderBottom: `2.5px solid ${on ? T.orange : "transparent"}`,
            transition: "all 0.18s"
          }}>
            <span style={{ fontSize: 21, lineHeight: 1 }}>{t.icon}</span>
            <span style={{ fontSize: 10, fontWeight: on ? 700 : 500, letterSpacing: 0.3 }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ===================== USER APP =====================
function UserApp({ parts, reloadParts, loadError, onLogout }) {
  const [tab, setTab] = useState("scan");
  const [history, setHistory] = useState([]);

  useEffect(() => {
    cloud.loadHistory().then(setHistory).catch(() => {});
  }, []);

  async function addToHistory(item) {
    setHistory(prev => [item, ...prev].slice(0, 60));
    await cloud.addHistory(item);
  }

  return (
    <div style={{ minHeight: "100vh", background: T.bg, maxWidth: 520, margin: "0 auto" }}>
      <Header title="WERFEN SCAN" subtitle="User — Spare Parts Recognition" onLogout={onLogout} />
      <div style={{ paddingBottom: 90 }}>
        {tab === "scan"    && <ScanScreen parts={parts} onAddHistory={addToHistory} reloadParts={reloadParts} loadError={loadError} />}
        {tab === "catalog" && <CatalogScreen parts={parts} reloadParts={reloadParts} />}
        {tab === "history" && <HistoryScreen history={history} />}
      </div>
      <TabBar
        tabs={[
          { id: "scan",    label: "Scan",    icon: "📷" },
          { id: "catalog", label: "Catalog", icon: "📚" },
          { id: "history", label: "History", icon: "🕐" },
        ]}
        active={tab}
        onChange={setTab}
      />
      <Tagline />
    </div>
  );
}

// ===================== SCAN SCREEN =====================
function ScanScreen({ parts, onAddHistory }) {
  const [image, setImage]         = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState("");
  const fileRef = useRef();

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const compressed = await compressImage(file, 800, 0.85);
      setImage(compressed);
      setResult(null);
      setError("");
    } catch {
      setError("Could not load the image. Please try again.");
    }
  }

  async function analyze() {
    if (!image) return;
    if (parts.length === 0) {
      setError("The database is empty. Ask the administrator to add spare parts first.");
      return;
    }

    // ── Key check: uses top-level constant OR the one saved in Settings ──
    const apiKey = ANTHROPIC_API_KEY.trim() || (await db.get("anthropic_key")) || "";
    if (!apiKey) {
      setError("API Key not configured. Paste your Anthropic key in the ANTHROPIC_API_KEY constant at the top of App.jsx, or enter it in Administrator → Settings.");
      return;
    }
    // ─────────────────────────────────────────────────────────────────────

    setAnalyzing(true);
    setError("");

    try {
      const partsCtx = parts.map(p => ({
        id: p.id, code: p.code, name: p.name,
        description: p.description,
        category: p.category || "",
        compatibility: p.compatibility || []
      }));

      const [meta, base64] = image.split(",");
      const mediaType = meta.split(";")[0].split(":")[1];

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // ── THE THREE CRITICAL HEADERS ──────────────────────────
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          // ────────────────────────────────────────────────────────
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: base64 }
              },
              {
                type: "text",
                text: `You are a specialist technician for industrial spare part visual recognition.
Carefully analyze this image and compare it with the database below.

PARTS DATABASE:
${JSON.stringify(partsCtx, null, 2)}

Identify the matching part by analyzing: shape, color, size, component type, visible markings, physical characteristics.

Reply ONLY with valid JSON (no extra text, no markdown, no backticks):
- If match found: {"matched":true,"id":"<exact id>","confidence":<0-100>,"reasoning":"<concise technical explanation of what you recognized and why it matches>"}
- If no match: {"matched":false,"confidence":0,"reasoning":"<describe what you see and why no part matches>"}`
              }
            ]
          }]
        })
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error?.message || `HTTP ${res.status} — check your API Key`);
      }

      const data = await res.json();
      const raw   = (data.content || []).map(c => c.text || "").join("");
      const clean = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      const matchedPart = parsed.matched ? parts.find(p => p.id === parsed.id) : null;

      const finalResult = {
        ...parsed,
        part: matchedPart || null,
        timestamp: new Date().toISOString(),
        image,
      };
      setResult(finalResult);
      onAddHistory(finalResult);
    } catch (e) {
      console.error("AI error:", e);
      setError(`AI analysis failed: ${e.message || "check your connection and API Key."}`);
    }
    setAnalyzing(false);
  }

  function reset() { setImage(null); setResult(null); setError(""); }

  if (result) return <ResultCard result={result} onReset={reset} />;

  return (
    <div style={{ padding: 16 }}>
      {/* Camera zone */}
      <div
        onClick={() => !analyzing && fileRef.current.click()}
        className="tap-sc"
        style={{
          borderRadius: 20, overflow: "hidden", marginBottom: 16,
          minHeight: 240, display: "flex", alignItems: "center", justifyContent: "center",
          background: image ? "black" : T.card,
          border: `2px dashed ${image ? T.blue : T.border}`,
          cursor: "pointer", position: "relative",
          boxShadow: image ? T.shadowLg : T.shadow
        }}
      >
        {image ? (
          <>
            <img src={image} alt="part" style={{ width: "100%", maxHeight: 320, objectFit: "cover", display: "block" }} />
            {analyzing && (
              <div style={{
                position: "absolute", inset: 0, background: "rgba(18,15,146,0.65)",
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 12
              }}>
                <Spinner size={40} color="white" />
                <p style={{ color: "white", fontWeight: 600, fontSize: 15 }}>AI analysis in progress...</p>
                <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>Comparing with parts database</p>
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: "center", padding: 32 }}>
            <div style={{
              width: 80, height: 80, borderRadius: 20, margin: "0 auto 16px",
              background: T.bluePale, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36
            }}>📷</div>
            <p style={{ color: T.blue, fontWeight: 700, fontSize: 17 }}>Take or upload a photo</p>
            <p style={{ color: T.textLight, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              Photograph the spare part<br />to identify
            </p>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleFile} />
      </div>

      {!image && (
        <div style={{
          background: T.orangePale, borderRadius: 14, padding: "14px 16px", marginBottom: 16,
          display: "flex", gap: 10, alignItems: "flex-start", border: `1px solid ${T.orange}33`
        }}>
          <span style={{ fontSize: 20 }}>💡</span>
          <div>
            <p style={{ color: T.orange, fontSize: 13, fontWeight: 700 }}>How to use WERFEN SCAN</p>
            <p style={{ color: T.textMid, fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
              Photograph a spare part or component. The AI will compare it with the database and show you the part number, description and compatibility. You can also search manually in the Catalog tab.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div style={{
          background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 14,
          padding: "14px 16px", marginBottom: 12, color: T.error, fontSize: 14, lineHeight: 1.5
        }}>⚠️ {error}</div>
      )}

      {image && !analyzing && (
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={reset} style={{
            flex: 1, padding: 14, borderRadius: 14,
            background: T.card, color: T.textMid, fontSize: 15, fontWeight: 600,
            border: `1.5px solid ${T.border}`
          }}>✕ Remove</button>
          <button onClick={analyze} className="tap-sc" style={{
            flex: 2, padding: 14, borderRadius: 14,
            background: `linear-gradient(135deg, ${T.blue}, ${T.blueLight})`,
            color: "white", fontSize: 15, fontWeight: 700,
            boxShadow: "0 4px 20px rgba(18,15,146,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8
          }}>
            <span>🔍</span> Identify Part
          </button>
        </div>
      )}

      {parts.length > 0 && (
        <div style={{
          marginTop: 20, background: T.card, borderRadius: 14,
          padding: "12px 16px", display: "flex", alignItems: "center",
          border: `1px solid ${T.border}`, gap: 10
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18
          }}>📦</div>
          <div>
            <p style={{ color: T.text, fontWeight: 700, fontSize: 15 }}>{parts.length} parts in the database</p>
            <p style={{ color: T.textLight, fontSize: 12 }}>Ready for scanning</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ===================== CATALOG SCREEN =====================
function CatalogScreen({ parts }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);

  const filtered = parts.filter(p =>
    p.name?.toLowerCase().includes(search.toLowerCase()) ||
    p.code?.toLowerCase().includes(search.toLowerCase()) ||
    p.category?.toLowerCase().includes(search.toLowerCase()) ||
    p.description?.toLowerCase().includes(search.toLowerCase())
  );

  if (selected) return <PartDetail part={selected} onBack={() => setSelected(null)} />;

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 16, letterSpacing: "-0.4px" }}>
        Parts Catalog
      </h2>
      <div style={{ position: "relative", marginBottom: 16 }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: T.textLight }}>🔍</span>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, code, category..."
          style={{
            width: "100%", padding: "13px 16px 13px 42px", borderRadius: 14,
            border: `1.5px solid ${T.border}`, background: T.card, fontSize: 15, color: T.text
          }}
        />
      </div>
      {parts.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 24px" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📦</div>
          <p style={{ color: T.text, fontWeight: 700, fontSize: 16 }}>Database is empty</p>
          <p style={{ color: T.textLight, fontSize: 14, marginTop: 6 }}>Ask the administrator to add parts</p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🔍</div>
          <p style={{ color: T.text, fontWeight: 700 }}>No results for "{search}"</p>
        </div>
      ) : (
        filtered.map((part, i) => (
          <div key={part.id} onClick={() => setSelected(part)} className="fade-in tap-sc" style={{
            background: T.card, borderRadius: 16, marginBottom: 10,
            border: `1px solid ${T.border}`, padding: 14,
            display: "flex", gap: 12, alignItems: "center",
            boxShadow: T.shadow, animationDelay: `${i * 0.03}s`, cursor: "pointer"
          }}>
            {part.imageBase64 ? (
              <img src={part.imageBase64} alt="" style={{ width: 64, height: 64, borderRadius: 12, objectFit: "cover", flexShrink: 0 }} />
            ) : (
              <div style={{ width: 64, height: 64, borderRadius: 12, flexShrink: 0, background: T.bluePale, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>🔩</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "monospace", color: T.blue, fontSize: 12, fontWeight: 600 }}>{part.code}</div>
              <div style={{ fontWeight: 700, color: T.text, fontSize: 15, marginTop: 2 }}>{part.name}</div>
              {part.category && (
                <span style={{
                  display: "inline-block", marginTop: 4,
                  background: T.orangePale, color: T.orange,
                  borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 600
                }}>{part.category}</span>
              )}
            </div>
            <span style={{ color: T.textLight, fontSize: 18 }}>›</span>
          </div>
        ))
      )}
    </div>
  );
}

function PartDetail({ part, onBack }) {
  return (
    <div className="fade-up" style={{ padding: 16 }}>
      <button onClick={onBack} className="tap-sc" style={{
        background: T.card, border: `1px solid ${T.border}`,
        color: T.blue, borderRadius: 12, padding: "8px 14px",
        fontSize: 14, fontWeight: 600, marginBottom: 14
      }}>← Back</button>
      <div style={{ background: T.card, borderRadius: 20, overflow: "hidden", boxShadow: T.shadowLg, border: `1px solid ${T.border}` }}>
        {part.imageBase64 ? (
          <img src={part.imageBase64} alt="" style={{ width: "100%", height: 220, objectFit: "cover", display: "block" }} />
        ) : (
          <div style={{ height: 160, background: T.bluePale, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 60 }}>🔩</div>
        )}
        <div style={{ padding: 20 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: T.bluePale, borderRadius: 12, padding: "8px 14px" }}>
              <span>🏷️</span>
              <span style={{ fontFamily: "monospace", color: T.blue, fontWeight: 700, fontSize: 16 }}>{part.code}</span>
            </div>
            {part.category && (
              <div style={{ display: "inline-flex", alignItems: "center", background: T.orangePale, borderRadius: 10, padding: "8px 12px" }}>
                <span style={{ color: T.orange, fontSize: 13, fontWeight: 600 }}>{part.category}</span>
              </div>
            )}
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 10, lineHeight: 1.2 }}>{part.name}</h2>
          {part.description && <p style={{ fontSize: 15, color: T.textMid, lineHeight: 1.6, marginBottom: 18 }}>{part.description}</p>}
          {part.compatibility?.length > 0 && (
            <div>
              <p style={{ fontSize: 11, color: T.textLight, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Compatibility</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {part.compatibility.map((c, i) => (
                  <span key={i} style={{ background: T.bluePale, color: T.blue, borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600 }}>⚙️ {c}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===================== RESULT CARD =====================
function ResultCard({ result, onReset }) {
  const { matched, part, confidence, reasoning } = result;
  return (
    <div className="fade-up" style={{ padding: 16 }}>
      <div style={{ background: T.card, borderRadius: 20, overflow: "hidden", boxShadow: T.shadowLg, border: `1px solid ${T.border}` }}>
        <div style={{
          background: matched ? `linear-gradient(135deg, ${T.blueDark}, ${T.blue})` : `linear-gradient(135deg, #374151, #6B7280)`,
          padding: 20, display: "flex", alignItems: "center", justifyContent: "space-between"
        }}>
          <div>
            <div style={{ color: "white", fontWeight: 700, fontSize: 17 }}>
              {matched ? "✅ Part Identified" : "❌ No Match Found"}
            </div>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 3 }}>
              AI confidence: {confidence}%
            </div>
          </div>
          <div style={{
            background: matched ? `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})` : "rgba(255,255,255,0.15)",
            borderRadius: 14, padding: "8px 14px", color: "white", fontSize: 18, fontWeight: 800
          }}>{confidence}%</div>
        </div>
        <div style={{ height: 4, background: T.border }}>
          <div style={{ height: "100%", width: `${confidence}%`, background: `linear-gradient(90deg, ${T.orange}, ${T.orangeLight})`, transition: "width 0.8s ease" }} />
        </div>
        <div style={{ padding: 20 }}>
          {matched && part ? (
            <>
              {part.imageBase64 && <img src={part.imageBase64} alt="" style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 14, marginBottom: 16 }} />}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: T.bluePale, borderRadius: 12, padding: "8px 14px" }}>
                  <span>🏷️</span>
                  <span style={{ fontFamily: "monospace", color: T.blue, fontWeight: 700, fontSize: 16 }}>{part.code}</span>
                </div>
                {part.category && (
                  <div style={{ display: "inline-flex", alignItems: "center", background: T.orangePale, borderRadius: 10, padding: "8px 12px" }}>
                    <span style={{ color: T.orange, fontSize: 13, fontWeight: 600 }}>{part.category}</span>
                  </div>
                )}
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 800, color: T.text, marginBottom: 8, lineHeight: 1.2 }}>{part.name}</h3>
              <p style={{ fontSize: 14, color: T.textMid, lineHeight: 1.6, marginBottom: 16 }}>{part.description}</p>
              {part.compatibility?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <p style={{ fontSize: 11, color: T.textLight, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Compatibility</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {part.compatibility.map((c, i) => (
                      <span key={i} style={{ background: T.bluePale, color: T.blue, borderRadius: 8, padding: "5px 12px", fontSize: 13, fontWeight: 600 }}>⚙️ {c}</span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ background: "#F8FAFC", borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <p style={{ color: T.textMid, fontSize: 14, lineHeight: 1.6 }}>
                The AI found no match. Try searching manually in the Catalog or contact the administrator.
              </p>
            </div>
          )}
          <div style={{ background: T.orangePale, border: `1px solid ${T.orange}33`, borderRadius: 12, padding: "12px 14px", marginBottom: 20 }}>
            <p style={{ color: "#92400E", fontSize: 13, lineHeight: 1.5 }}>
              <strong>💡 AI Analysis: </strong>{reasoning}
            </p>
          </div>
          <button onClick={onReset} className="tap-sc" style={{
            width: "100%", padding: 15, borderRadius: 14,
            background: `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})`,
            color: "white", fontSize: 16, fontWeight: 700,
            boxShadow: "0 4px 20px rgba(255,104,32,0.3)"
          }}>📷 New Scan</button>
        </div>
      </div>
    </div>
  );
}

// ===================== HISTORY SCREEN =====================
function HistoryScreen({ history }) {
  if (!history.length) return (
    <div style={{ textAlign: "center", padding: "64px 24px" }}>
      <div style={{ fontSize: 52, marginBottom: 14 }}>🕐</div>
      <p style={{ color: T.text, fontWeight: 700, fontSize: 17 }}>No scans yet</p>
      <p style={{ color: T.textLight, fontSize: 14, marginTop: 6 }}>Your scans will appear here</p>
    </div>
  );
  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 16, letterSpacing: "-0.4px" }}>
        Scan History
        <span style={{ marginLeft: 8, background: T.bluePale, color: T.blue, fontSize: 13, borderRadius: 8, padding: "2px 8px", fontWeight: 700, verticalAlign: "middle" }}>{history.length}</span>
      </h2>
      {history.map((item, i) => (
        <div key={i} className="fade-in" style={{
          background: T.card, borderRadius: 16, marginBottom: 10,
          border: `1px solid ${T.border}`, display: "flex",
          alignItems: "center", gap: 12, padding: 12,
          boxShadow: T.shadow, animationDelay: `${i * 0.04}s`
        }}>
          {item.image ? (
            <img src={item.image} alt="" style={{ width: 62, height: 62, borderRadius: 12, objectFit: "cover", flexShrink: 0 }} />
          ) : (
            <div style={{ width: 62, height: 62, borderRadius: 12, flexShrink: 0, background: T.bluePale, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>🔩</div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {item.matched && item.part ? (
              <>
                <div style={{ fontWeight: 700, color: T.text, fontSize: 15 }}>{item.part.name}</div>
                <div style={{ fontFamily: "monospace", color: T.blue, fontSize: 12, marginTop: 2 }}>{item.part.code}</div>
              </>
            ) : (
              <div style={{ fontWeight: 600, color: T.textMid, fontSize: 14 }}>No match found</div>
            )}
            <div style={{ color: T.textLight, fontSize: 11, marginTop: 4 }}>
              {new Date(item.timestamp).toLocaleString("en-GB")}
            </div>
          </div>
          <div style={{
            background: item.matched ? T.bluePale : "#F1F5F9",
            color: item.matched ? T.blue : T.textMid,
            borderRadius: 10, padding: "5px 10px", fontSize: 13, fontWeight: 700, flexShrink: 0
          }}>{item.confidence}%</div>
        </div>
      ))}
    </div>
  );
}

// ===================== ADMIN APP =====================
function AdminApp({ parts, onAddPart, onUpdatePart, onDeletePart, reloadParts, loadError, onLogout }) {
  const [tab, setTab] = useState("parts");
  const [editingPart, setEditingPart] = useState(null);

  function handleEdit(part)  { setEditingPart(part); setTab("add"); }
  function handleAddNew()    { setEditingPart(null); setTab("add"); }
  function handleDone()      { setEditingPart(null); setTab("parts"); reloadParts(); }

  return (
    <div style={{ minHeight: "100vh", background: T.bg, maxWidth: 520, margin: "0 auto" }}>
      <Header title="WERFEN SCAN Admin" subtitle="Administrator Area" onLogout={onLogout} />
      <div style={{ paddingBottom: 90 }}>
        {tab === "parts" && <PartsListScreen parts={parts} onEdit={handleEdit} onAdd={handleAddNew} onDeletePart={onDeletePart} reloadParts={reloadParts} loadError={loadError} />}
        {tab === "add"   && <AddEditPartScreen parts={parts} editingPart={editingPart} onAddPart={onAddPart} onUpdatePart={onUpdatePart} onDone={handleDone} />}
        {tab === "settings" && <SettingsScreen partsCount={parts.length} />}
      </div>
      <TabBar
        tabs={[
          { id: "parts",    label: "Parts",    icon: "🔧" },
          { id: "add",      label: editingPart ? "Edit" : "Add",  icon: "➕" },
          { id: "settings", label: "Settings", icon: "⚙️" },
        ]}
        active={tab}
        onChange={t => {
          if (t === "add") handleAddNew();
          else { setEditingPart(null); setTab(t); }
        }}
      />
      <Tagline />
    </div>
  );
}

// ===================== PARTS LIST SCREEN =====================
function PartsListScreen({ parts, onEdit, onAdd, onDeletePart, reloadParts, loadError }) {
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const filtered = parts.filter(p =>
    p.name?.toLowerCase().includes(search.toLowerCase()) ||
    p.code?.toLowerCase().includes(search.toLowerCase()) ||
    p.category?.toLowerCase().includes(search.toLowerCase())
  );

  async function deletePart(id) {
    try { await onDeletePart(id); }
    catch (e) { console.error(e); alert("Could not delete the part. Check your connection."); }
    setConfirmDelete(null);
  }

  async function refresh() {
    setRefreshing(true);
    await reloadParts();
    setRefreshing(false);
  }

  return (
    <div style={{ padding: 16 }}>
      {confirmDelete && (
        <ConfirmDialog
          message="Delete this part from the shared database? This cannot be undone and affects all devices."
          onConfirm={() => deletePart(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {loadError && (
        <div style={{
          background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 14,
          padding: "12px 14px", marginBottom: 12, color: T.error, fontSize: 13, lineHeight: 1.5
        }}>⚠️ {loadError}</div>
      )}

      <div style={{
        background: `linear-gradient(135deg, ${T.blue}, ${T.blueLight})`,
        borderRadius: 18, padding: "18px 20px", marginBottom: 16,
        display: "flex", alignItems: "center", justifyContent: "space-between"
      }}>
        <div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Shared Database ☁️</div>
          <div style={{ color: "white", fontSize: 28, fontWeight: 800, marginTop: 2 }}>{parts.length}</div>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>registered parts</div>
        </div>
        <button onClick={onAdd} className="tap-sc" style={{
          padding: "12px 20px", borderRadius: 14,
          background: `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})`,
          color: "white", fontSize: 15, fontWeight: 700,
          boxShadow: "0 4px 16px rgba(255,104,32,0.4)"
        }}>+ Add</button>
      </div>

      <button onClick={refresh} disabled={refreshing} style={{
        width: "100%", padding: 11, borderRadius: 12, marginBottom: 16,
        background: T.bluePale, color: T.blue, fontSize: 14, fontWeight: 700,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8
      }}>
        {refreshing ? <><Spinner size={16} /> Refreshing...</> : "↻ Refresh from cloud"}
      </button>

      <div style={{ position: "relative", marginBottom: 16 }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: T.textLight }}>🔍</span>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, code or category..."
          style={{ width: "100%", padding: "13px 16px 13px 42px", borderRadius: 14, border: `1.5px solid ${T.border}`, background: T.card, fontSize: 15, color: T.text }}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 16px" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📦</div>
          <p style={{ color: T.text, fontWeight: 700 }}>{parts.length === 0 ? "Database is empty" : "No results"}</p>
          <p style={{ color: T.textLight, fontSize: 14, marginTop: 4 }}>{parts.length === 0 ? "Add the first part to get started" : "Try a different search term"}</p>
          {parts.length === 0 && (
            <button onClick={onAdd} className="tap-sc" style={{
              marginTop: 18, padding: "12px 24px", borderRadius: 14,
              background: `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})`,
              color: "white", fontSize: 15, fontWeight: 700,
              boxShadow: "0 4px 16px rgba(255,104,32,0.35)"
            }}>+ Add first part</button>
          )}
        </div>
      ) : (
        filtered.map((part, i) => (
          <div key={part.id} className="fade-in" style={{
            background: T.card, borderRadius: 16, marginBottom: 10,
            border: `1px solid ${T.border}`, overflow: "hidden",
            boxShadow: T.shadow, animationDelay: `${i * 0.03}s`
          }}>
            <div style={{ display: "flex", gap: 12, padding: 14 }}>
              {part.imageBase64 ? (
                <img src={part.imageBase64} alt="" style={{ width: 68, height: 68, borderRadius: 12, objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <div style={{ width: 68, height: 68, borderRadius: 12, flexShrink: 0, background: T.bluePale, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🔩</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "monospace", color: T.blue, fontSize: 12, fontWeight: 600 }}>{part.code}</div>
                <div style={{ fontWeight: 700, color: T.text, fontSize: 15, marginTop: 2 }}>{part.name}</div>
                {part.category && (
                  <span style={{ display: "inline-block", marginTop: 4, background: T.orangePale, color: T.orange, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>{part.category}</span>
                )}
                {part.compatibility?.length > 0 && (
                  <div style={{ color: T.textLight, fontSize: 11, marginTop: 4 }}>
                    ⚙️ {part.compatibility.slice(0, 2).join(", ")}
                    {part.compatibility.length > 2 && ` +${part.compatibility.length - 2}`}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "flex", borderTop: `1px solid ${T.border}` }}>
              <button onClick={() => onEdit(part)} style={{ flex: 1, padding: 11, background: "transparent", color: T.blue, fontSize: 14, fontWeight: 600, borderRight: `1px solid ${T.border}` }}>✏️ Edit</button>
              <button onClick={() => setConfirmDelete(part.id)} style={{ flex: 1, padding: 11, background: "transparent", color: T.error, fontSize: 14, fontWeight: 600 }}>🗑️ Delete</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ===================== ADD/EDIT PART SCREEN =====================
function AddEditPartScreen({ parts, editingPart, onAddPart, onUpdatePart, onDone }) {
  const isEdit = !!editingPart;
  const [form, setForm] = useState(editingPart
    ? { ...editingPart }
    : { code: "", name: "", description: "", category: "", compatibility: [], imageBase64: "" }
  );
  const [compatInput, setCompatInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [imgLoading, setImgLoading] = useState(false);
  // Prevents Android double-trigger on touch
  const pickingRef = useRef(false);

  function field(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleImage(e) {
    const file = e.target.files?.[0];
    pickingRef.current = false;
    if (!file) return;
    // DO NOT reset e.target.value here on Android — do it after processing
    setImgLoading(true);
    try {
      const compressed = await compressImage(file, 500, 0.78);
      field("imageBase64", compressed);
      // Safe to reset now
      try { e.target.value = ""; } catch (_) {}
    } catch {
      setErrors(e2 => ({ ...e2, image: "Could not load the image. Try again." }));
    }
    setImgLoading(false);
  }

  function addCompat() {
    const val = compatInput.trim();
    if (!val || form.compatibility?.includes(val)) return;
    field("compatibility", [...(form.compatibility || []), val]);
    setCompatInput("");
  }

  function validate() {
    const e = {};
    if (!form.code.trim()) e.code = "Part code is required";
    if (!form.name.trim()) e.name = "Part name is required";
    const dup = parts.find(p => p.code.toLowerCase() === form.code.trim().toLowerCase() && p.id !== editingPart?.id);
    if (dup) e.code = "This code already exists in the database";
    return e;
  }

  async function save() {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    const cleaned = { ...form, code: form.code.trim(), name: form.name.trim() };
    try {
      if (isEdit) {
        await onUpdatePart(editingPart.id, cleaned);
      } else {
        await onAddPart(cleaned);
      }
      setSaving(false);
      onDone();
    } catch (e) {
      console.error("save error:", e);
      setErrors({ general: `Could not save to the cloud: ${e.message || "check your connection."}` });
      setSaving(false);
    }
  }

  const inp = (key) => ({
    width: "100%", padding: "13px 16px", borderRadius: 14,
    border: `1.5px solid ${errors[key] ? T.error : T.border}`,
    background: T.card, fontSize: 15, color: T.text,
  });

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 20, letterSpacing: "-0.4px" }}>
        {isEdit ? "✏️ Edit Part" : "➕ New Part"}
      </h2>

      {/* Photo — uses <label> for reliable Android file picker (no JS .click()) */}
      <label htmlFor="admin-photo-input" style={{
        display: "block", borderRadius: 18, overflow: "hidden", marginBottom: 12,
        border: `2px dashed ${form.imageBase64 ? T.blue : T.border}`,
        minHeight: 150,
        background: form.imageBase64 ? "black" : T.card,
        cursor: imgLoading ? "default" : "pointer", position: "relative"
      }}>
        {imgLoading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, minHeight: 150 }}>
            <Spinner size={32} />
            <p style={{ color: T.textMid, fontSize: 13 }}>Processing image...</p>
          </div>
        ) : form.imageBase64 ? (
          <img src={form.imageBase64} alt="" style={{ width: "100%", maxHeight: 220, objectFit: "cover", display: "block" }} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 150, padding: 24 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📷</div>
            <p style={{ color: T.blue, fontWeight: 700 }}>Add part photo</p>
            <p style={{ color: T.textLight, fontSize: 12, marginTop: 4 }}>Tap to take a photo or choose from gallery</p>
          </div>
        )}
        {/* NO capture="environment" here — lets Android show camera + gallery choice */}
        <input
          id="admin-photo-input"
          type="file"
          accept="image/*"
          disabled={imgLoading}
          onChange={handleImage}
          style={{ display: "none" }}
        />
      </label>
      {form.imageBase64 && (
        <button onClick={() => field("imageBase64", "")} style={{
          width: "100%", padding: 9, borderRadius: 10, marginBottom: 14,
          background: "#FEF2F2", color: T.error, fontSize: 13, fontWeight: 600,
          border: "1px solid #FECACA"
        }}>🗑️ Remove photo</button>
      )}

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.textMid, marginBottom: 6 }}>Part Code *</label>
        <input value={form.code}
          onChange={e => { field("code", e.target.value); setErrors(e2 => ({ ...e2, code: "" })); }}
          placeholder="e.g. PART-001, CBN-2240-A"
          style={{ ...inp("code"), fontFamily: "monospace", letterSpacing: 0.5 }}
        />
        {errors.code && <p style={{ color: T.error, fontSize: 12, marginTop: 4 }}>⚠️ {errors.code}</p>}
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.textMid, marginBottom: 6 }}>Part Name *</label>
        <input value={form.name}
          onChange={e => { field("name", e.target.value); setErrors(e2 => ({ ...e2, name: "" })); }}
          placeholder="e.g. Ball bearing, Hydraulic valve"
          style={inp("name")}
        />
        {errors.name && <p style={{ color: T.error, fontSize: 12, marginTop: 4 }}>⚠️ {errors.name}</p>}
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.textMid, marginBottom: 6 }}>Category / Type</label>
        <input value={form.category} onChange={e => field("category", e.target.value)}
          placeholder="e.g. Mechanical, Electronics, Hydraulic"
          style={inp("category")}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.textMid, marginBottom: 6 }}>Technical Description</label>
        <textarea value={form.description} onChange={e => field("description", e.target.value)}
          placeholder="Material, dimensions, technical specs, installation notes..."
          rows={4}
          style={{ ...inp("description"), lineHeight: 1.5, paddingTop: 12 }}
        />
      </div>

      <div style={{ marginBottom: 22 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.textMid, marginBottom: 6 }}>Machine / Model Compatibility</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input value={compatInput}
            onChange={e => setCompatInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCompat(); } }}
            placeholder="e.g. CNC Lathe Mazak, Hydraulic press"
            style={{ ...inp(), flex: 1, fontSize: 14 }}
          />
          <button onClick={addCompat} style={{
            padding: "13px 18px", borderRadius: 14,
            background: `linear-gradient(135deg, ${T.blue}, ${T.blueLight})`,
            color: "white", fontWeight: 700, fontSize: 18
          }}>+</button>
        </div>
        {(form.compatibility || []).length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {form.compatibility.map((c, i) => (
              <span key={i} style={{
                background: T.bluePale, color: T.blue, borderRadius: 9,
                padding: "6px 12px", fontSize: 13, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 6
              }}>
                ⚙️ {c}
                <span onClick={() => field("compatibility", form.compatibility.filter((_, idx) => idx !== i))}
                  style={{ cursor: "pointer", color: T.error, fontWeight: 800, fontSize: 15, lineHeight: 1 }}>×</span>
              </span>
            ))}
          </div>
        ) : (
          <p style={{ color: T.textLight, fontSize: 12 }}>Add compatible machines/models (press Enter or +)</p>
        )}
      </div>

      {errors.general && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 12, padding: "12px 14px", marginBottom: 14, color: T.error, fontSize: 14 }}>
          ⚠️ {errors.general}
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={onDone} style={{
          flex: 1, padding: 14, borderRadius: 14,
          background: T.card, color: T.textMid, fontSize: 15, fontWeight: 600,
          border: `1.5px solid ${T.border}`
        }}>Cancel</button>
        <button onClick={save} disabled={saving} className="tap-sc" style={{
          flex: 2, padding: 14, borderRadius: 14,
          background: saving ? T.textLight : `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})`,
          color: "white", fontSize: 15, fontWeight: 700,
          boxShadow: saving ? "none" : "0 4px 20px rgba(255,104,32,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8
        }}>
          {saving ? <><Spinner size={18} color="white" /> Saving...</> : (isEdit ? "💾 Save Changes" : "✅ Add to Database")}
        </button>
      </div>
    </div>
  );
}

// ===================== SETTINGS SCREEN =====================
function SettingsScreen({ partsCount }) {
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdFeedback, setPwdFeedback] = useState({ msg: "", type: "" });
  const [savingPwd, setSavingPwd] = useState(false);

  const [apiKey, setApiKey] = useState("");
  const [apiSaved, setApiSaved] = useState(false);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);

  useEffect(() => {
    db.get("anthropic_key").then(k => { if (k) setApiKey(k); });
  }, []);

  async function saveApiKey() {
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    await db.set("anthropic_key", trimmed);
    setApiSaved(true);
    setTimeout(() => setApiSaved(false), 3000);
  }

  async function changePassword() {
    if (!oldPwd || !newPwd || !confirmPwd) { setPwdFeedback({ msg: "Fill in all fields", type: "error" }); return; }
    if (newPwd !== confirmPwd) { setPwdFeedback({ msg: "New passwords do not match", type: "error" }); return; }
    if (newPwd.length < 4) { setPwdFeedback({ msg: "Password must be at least 4 characters", type: "error" }); return; }
    setSavingPwd(true);
    const stored = await db.get("admin_password") || djbHash("admin123");
    if (djbHash(oldPwd) !== stored) {
      setPwdFeedback({ msg: "Current password is incorrect", type: "error" });
      setSavingPwd(false); return;
    }
    await db.set("admin_password", djbHash(newPwd));
    setPwdFeedback({ msg: "✅ Password updated successfully!", type: "success" });
    setOldPwd(""); setNewPwd(""); setConfirmPwd("");
    setSavingPwd(false);
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Stats */}
      <div style={{
        background: `linear-gradient(135deg, ${T.blueDark}, ${T.blue})`,
        borderRadius: 20, padding: "24px 20px", marginBottom: 16,
        display: "flex", alignItems: "center", gap: 20
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16,
          background: `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})`,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28,
          boxShadow: "0 4px 16px rgba(255,104,32,0.4)"
        }}>📦</div>
        <div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Total Parts</div>
          <div style={{ color: "white", fontSize: 36, fontWeight: 800, lineHeight: 1.1 }}>{partsCount}</div>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>in the database</div>
        </div>
      </div>

      {/* ── AI API KEY ─────────────────────────────────────────────── */}
      <div style={{ background: T.card, borderRadius: 20, padding: 20, border: `1px solid ${T.border}`, boxShadow: T.shadow, marginBottom: 16 }}>
        <h3 style={{ fontWeight: 800, color: T.text, marginBottom: 6, fontSize: 17 }}>🤖 Anthropic API Key</h3>
        <p style={{ color: T.textMid, fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>
          Required for AI scanning. Get your key at{" "}
          <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{ color: T.blue, fontWeight: 600 }}>console.anthropic.com</a>
        </p>

        {/* ✅ Option 1 — Recommended for StackBlitz */}
        <div style={{ background: T.bluePale, borderRadius: 14, padding: "12px 14px", marginBottom: 14 }}>
          <p style={{ color: T.blue, fontSize: 13, fontWeight: 700, marginBottom: 4 }}>✅ Option 1 — Recommended (StackBlitz)</p>
          <p style={{ color: T.textMid, fontSize: 12, lineHeight: 1.6 }}>
            Open <strong>App.jsx</strong> → find the first line at the top:<br />
            <code style={{ background: "#fff", borderRadius: 6, padding: "2px 6px", fontSize: 11, display: "inline-block", marginTop: 4 }}>
              const ANTHROPIC_API_KEY = "";
            </code><br />
            Paste your key between the quotes and save.
          </p>
        </div>

        {/* Option 2 — localStorage fallback */}
        <p style={{ color: T.textMid, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          Option 2 — Save here (stored in this browser only)
        </p>
        <div style={{ position: "relative", marginBottom: 10 }}>
          <input
            type={apiKeyVisible ? "text" : "password"}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-ant-api03-..."
            style={{
              width: "100%", padding: "13px 48px 13px 16px", borderRadius: 14,
              border: `1.5px solid ${T.border}`, background: T.bg, fontSize: 14,
              color: T.text, fontFamily: "monospace"
            }}
          />
          <button onClick={() => setApiKeyVisible(v => !v)} style={{
            position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
            background: "transparent", color: T.textLight, fontSize: 16
          }}>{apiKeyVisible ? "🙈" : "👁️"}</button>
        </div>
        <button onClick={saveApiKey} className="tap-sc" style={{
          width: "100%", padding: 13, borderRadius: 14,
          background: apiSaved ? T.success : `linear-gradient(135deg, ${T.blue}, ${T.blueLight})`,
          color: "white", fontSize: 15, fontWeight: 700,
          transition: "background 0.3s"
        }}>
          {apiSaved ? "✅ Saved!" : "💾 Save API Key"}
        </button>
        <p style={{ color: ANTHROPIC_API_KEY.trim() || apiKey ? T.success : T.error, fontSize: 12, marginTop: 8, textAlign: "center" }}>
          {ANTHROPIC_API_KEY.trim()
            ? "✅ Key set in code — AI scanning active"
            : apiKey
              ? "✅ Key set via Settings — AI scanning active"
              : "⚠️ No API Key — AI scanning disabled"
          }
        </p>
      </div>
      {/* ─────────────────────────────────────────────────────────── */}

      {/* Password */}
      <div style={{ background: T.card, borderRadius: 20, padding: 20, border: `1px solid ${T.border}`, boxShadow: T.shadow, marginBottom: 16 }}>
        <h3 style={{ fontWeight: 800, color: T.text, marginBottom: 18, fontSize: 17 }}>🔐 Change Administrator Password</h3>
        {[
          { val: oldPwd, set: setOldPwd, label: "Current password",    ph: "Enter current password" },
          { val: newPwd, set: setNewPwd, label: "New password",         ph: "At least 4 characters" },
          { val: confirmPwd, set: setConfirmPwd, label: "Confirm new password", ph: "Repeat new password" },
        ].map(({ val, set, label, ph }, idx) => (
          <div key={idx} style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.textMid, marginBottom: 6 }}>{label}</label>
            <input
              type="password" value={val}
              onChange={e => { set(e.target.value); setPwdFeedback({ msg: "", type: "" }); }}
              placeholder={ph}
              style={{ width: "100%", padding: "13px 16px", borderRadius: 14, border: `1.5px solid ${T.border}`, background: T.bg, fontSize: 15, color: T.text }}
            />
          </div>
        ))}
        {pwdFeedback.msg && (
          <div style={{
            padding: "12px 14px", borderRadius: 12, marginBottom: 14, fontSize: 14,
            background: pwdFeedback.type === "success" ? "#F0FDF4" : "#FEF2F2",
            color: pwdFeedback.type === "success" ? T.success : T.error,
            border: `1px solid ${pwdFeedback.type === "success" ? "#86EFAC" : "#FECACA"}`
          }}>{pwdFeedback.msg}</div>
        )}
        <button onClick={changePassword} disabled={savingPwd} className="tap-sc" style={{
          width: "100%", padding: 14, borderRadius: 14,
          background: `linear-gradient(135deg, ${T.blue}, ${T.blueLight})`,
          color: "white", fontSize: 15, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8
        }}>
          {savingPwd ? <><Spinner size={18} color="white" /> Updating...</> : "🔐 Update Password"}
        </button>
      </div>

      <div style={{ background: T.card, borderRadius: 16, padding: 16, border: `1px solid ${T.border}`, textAlign: "center" }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🔧</div>
        <div style={{ color: T.text, fontWeight: 700, fontSize: 15 }}>WERFEN SCAN v2.0</div>
        <div style={{ color: T.textLight, fontSize: 13, marginTop: 4 }}>
          Industrial Spare Parts Recognition<br />
          Powered by Claude AI (Anthropic)
        </div>
      </div>
    </div>
  );
}

// ===================== SETUP SCREEN (cloud not configured) =====================
function SetupScreen() {
  return (
    <div style={{
      minHeight: "100vh",
      background: `linear-gradient(160deg, ${T.blueDark}, ${T.blue})`,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 24
    }}>
      <style>{GLOBAL_STYLES}</style>
      <div style={{
        background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.2)",
        borderRadius: 24, padding: 28, maxWidth: 380, width: "100%"
      }}>
        <div style={{ fontSize: 40, textAlign: "center", marginBottom: 16 }}>☁️</div>
        <h2 style={{ color: "white", fontWeight: 800, textAlign: "center", marginBottom: 10, fontSize: 20 }}>
          Connect the shared database
        </h2>
        <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, lineHeight: 1.6, textAlign: "center", marginBottom: 20 }}>
          To share parts across all devices, configure Supabase.
        </p>
        {[
          { n: "1", t: "Create a free project", s: "at supabase.com" },
          { n: "2", t: "Run the SQL", s: "from GUIDA-SUPABASE.md in the SQL Editor" },
          { n: "3", t: "Copy URL and Anon Key", s: "from Project Settings → API" },
          { n: "4", t: "Paste into App.jsx", s: "SUPABASE_URL and SUPABASE_ANON_KEY at the top" },
        ].map(({ n, t, s }) => (
          <div key={n} style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 14 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, flexShrink: 0,
              background: `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "white", fontWeight: 800, fontSize: 13
            }}>{n}</div>
            <div>
              <div style={{ color: "white", fontWeight: 600, fontSize: 14 }}>{t}</div>
              <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, marginTop: 2 }}>{s}</div>
            </div>
          </div>
        ))}
      </div>
      <Tagline light />
    </div>
  );
}

// ===================== ROOT =====================
export default function App() {
  const [user, setUser] = useState(null);
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  async function reloadParts() {
    if (!cloudReady) return;
    try {
      const p = await cloud.loadParts();
      setParts(p);
      setLoadError("");
    } catch (e) {
      setLoadError("Could not reach the cloud database. Check your connection and the Supabase keys.");
    }
  }

  useEffect(() => {
    if (!cloudReady) { setLoading(false); return; }
    reloadParts().finally(() => setLoading(false));
  }, []);

  async function handleAddPart(partData) {
    const newPart = await cloud.addPart(partData);
    setParts(prev => [newPart, ...prev]);
  }
  async function handleUpdatePart(id, partData) {
    const updated = await cloud.updatePart(id, partData);
    setParts(prev => prev.map(p => (p.id === id ? updated : p)));
  }
  async function handleDeletePart(id) {
    await cloud.deletePart(id);
    setParts(prev => prev.filter(p => p.id !== id));
  }

  if (!cloudReady) return <SetupScreen />;

  if (loading) return (
    <div style={{
      minHeight: "100vh",
      background: `linear-gradient(160deg, ${T.blueDark}, ${T.blue})`,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 20
    }}>
      <style>{GLOBAL_STYLES}</style>
      <div style={{
        width: 72, height: 72, borderRadius: 20,
        background: `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 34, boxShadow: "0 8px 32px rgba(255,104,32,0.4)",
        animation: "pulse 1.2s ease infinite"
      }}>🔧</div>
      <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 16, fontWeight: 600 }}>Loading WERFEN SCAN...</p>
      <Tagline light />
    </div>
  );

  if (!user) return <LoginScreen onLogin={setUser} />;

  if (user.role === "admin") return (
    <AdminApp
      parts={parts}
      onAddPart={handleAddPart}
      onUpdatePart={handleUpdatePart}
      onDeletePart={handleDeletePart}
      reloadParts={reloadParts}
      loadError={loadError}
      onLogout={() => setUser(null)}
    />
  );

  return <UserApp parts={parts} reloadParts={reloadParts} loadError={loadError} onLogout={() => setUser(null)} />;
}
