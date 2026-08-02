import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// ════════════════════════════════════════════════════════════
//  ☁️  SUPABASE  ☁️
//  Settings → API → "Project URL" (NON l'endpoint REST: niente /rest/v1)
// ════════════════════════════════════════════════════════════
const SUPABASE_URL      = "https://upztxixdnnvhqnirxpye.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwenR4aXhkbm52aHFuaXJ4cHllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NzkxNzEsImV4cCI6MjA5NTU1NTE3MX0._p2toNqZrr2Rlk4FgOOQRSnSQjxuvv94iELwamTokfk";

// ⚠️ L'email dell'account amministratore creato su Supabase.
//    Deve combaciare ESATTAMENTE con quella usata nelle policy RLS.
//    Precompilata con la tua: cambiala qui E in SETUP.md se ne usi un'altra.
const ADMIN_EMAIL = "giorgiocanada6@gmail.com";

// 🔑 La chiave Anthropic NON sta più qui: vive nelle Environment
//    Variables di Vercel e viene usata solo da /api/analyze.

// Tollera slash finale ed endpoint REST copiato per errore dalla dashboard
const normalizeSupabaseUrl = (v) =>
  String(v || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "").replace(/\/+$/, "");

const SUPABASE_URL_CLEAN = normalizeSupabaseUrl(SUPABASE_URL);
const SUPABASE_KEY_CLEAN = String(SUPABASE_ANON_KEY || "").trim();
const isPlaceholder = (v) => !v || /YOUR[-_]|<.*>|INCOLLA|PASTE|EXAMPLE|xxxx/i.test(v);

let cloudConfigProblem = "";
if (isPlaceholder(SUPABASE_URL) || !SUPABASE_URL_CLEAN)
  cloudConfigProblem = "SUPABASE_URL non configurato.";
else if (!/^https:\/\/[^\s/]+\.[^\s/]+$/.test(SUPABASE_URL_CLEAN))
  cloudConfigProblem = `SUPABASE_URL non valido: "${SUPABASE_URL}" — serve https://xxxx.supabase.co, senza percorsi tipo /rest/v1.`;
else if (isPlaceholder(SUPABASE_ANON_KEY) || !SUPABASE_KEY_CLEAN)
  cloudConfigProblem = "SUPABASE_ANON_KEY non configurata.";
else if (!/^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(SUPABASE_KEY_CLEAN))
  cloudConfigProblem = "SUPABASE_ANON_KEY non ha formato JWT (deve iniziare con 'ey').";

const cloudReady = !cloudConfigProblem;
const supabase = cloudReady ? createClient(SUPABASE_URL_CLEAN, SUPABASE_KEY_CLEAN) : null;

const isAdminEmail = (email) =>
  !!email && email.trim().toLowerCase() === ADMIN_EMAIL.trim().toLowerCase();

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

  input, textarea, select, button {
    font-family: ${FONT};
    outline: none;
    font-size: 16px;
  }
  button { cursor: pointer; border: none; -webkit-appearance: none; appearance: none; }
  textarea { resize: vertical; }
  input[type="file"] { display: none; }
  img { max-width: 100%; height: auto; }
  table { width: 100%; border-collapse: collapse; }
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

function GlobalStyles() {
  return <style>{GLOBAL_STYLES}</style>;
}

// ===================== CLOUD DATA LAYER =====================
const cloud = {
  async loadParts() {
    const { data, error } = await supabase
      .from("parts").select("*").order("created_at", { ascending: false });
    if (error) { console.error("loadParts:", error.message, error.code); throw error; }
    return (data || []).map(p => ({
      id: p.id,
      code: p.code || "",
      name: p.name || "",
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
    if (error) { console.error("loadHistory:", error.message, error.code); return []; }
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
    if (error) console.error("addHistory:", error.message, error.code);
  },
};

// ===================== IMAGE HELPERS =====================
function compressImage(file, maxSize = 1000, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Image processing timed out")), 20000);
    const done = (val) => { clearTimeout(timer); resolve(val); };
    const fail = (err) => { clearTimeout(timer); reject(err); };
    let settled = false;

    function drawAndExport(bitmapOrImg, natW, natH) {
      if (settled) return;
      settled = true;
      try {
        let w = natW, h = natH;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round((h / w) * maxSize); w = maxSize; }
          else       { w = Math.round((w / h) * maxSize); h = maxSize; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bitmapOrImg, 0, 0, w, h);
        if (bitmapOrImg.close) bitmapOrImg.close();
        done(canvas.toDataURL("image/jpeg", quality));
      } catch (e) { fail(e); }
    }

    if (typeof createImageBitmap === "function") {
      createImageBitmap(file, { imageOrientation: "from-image" })
        .then(bmp => drawAndExport(bmp, bmp.width, bmp.height))
        .catch(() => { if (!settled) fallbackPath(); });
    } else {
      fallbackPath();
    }

    function fallbackPath() {
      try {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); drawAndExport(img, img.width, img.height); };
        img.onerror = () => { URL.revokeObjectURL(url); fail(new Error("Image load error")); };
        img.src = url;
      } catch (e) { fail(e); }
    }
  });
}

function makeThumb(dataUrl, maxSize = 200, quality = 0.65) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round((h / w) * maxSize); w = maxSize; }
          else       { w = Math.round((w / h) * maxSize); h = maxSize; }
        }
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => resolve("");
      img.src = dataUrl;
    } catch { resolve(""); }
  });
}

// ===================== SPINNER / TAGLINE / DIALOG =====================
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

function Tagline({ light = false, raised = false }) {
  return (
    <div style={{
      position: "fixed",
      bottom: raised
        ? "calc(max(12px, env(safe-area-inset-bottom)) + 64px)"
        : "max(12px, env(safe-area-inset-bottom))",
      right: 18,
      fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
      fontStyle: "italic",
      color: light ? "rgba(255,255,255,0.6)" : T.textLight,
      pointerEvents: "none",
      zIndex: 50,
    }}>Powering Patient Care</div>
  );
}

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

// ===================== PHOTO PICKER =====================
// L'<input> è FUORI dal <label>: se fosse annidato e allo stesso tempo
// referenziato da htmlFor, il browser inoltrerebbe il click due volte
// e su Android la fotocamera si riaprirebbe dopo lo scatto.
function PhotoPicker({ id, disabled, onFile, children, style }) {
  return (
    <>
      <label htmlFor={id} style={style}>{children}</label>
      <input
        id={id}
        type="file"
        accept="image/*"
        disabled={disabled}
        onChange={onFile}
        style={{ display: "none" }}
      />
    </>
  );
}

// ===================== LOGIN SCREEN (Supabase Auth) =====================
function LoginScreen() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password) { setError("Inserisci email e password"); return; }
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "Email o password non corretti"
          : error.message
      );
      setLoading(false);
    }
    // In caso di successo onAuthStateChange in App fa il resto.
  }

  const inputStyle = {
    width: "100%", padding: "15px 18px", borderRadius: 14, marginBottom: 10,
    background: "rgba(255,255,255,0.15)",
    border: `1px solid ${error ? T.orange : "rgba(255,255,255,0.25)"}`,
    color: "white", fontSize: 16,
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: `linear-gradient(160deg, ${T.blueDark} 0%, ${T.blue} 55%, ${T.blueLight} 100%)`,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: 24, position: "relative", overflow: "hidden"
    }}>
      <div style={{ position: "absolute", top: -80, right: -80, width: 280, height: 280, borderRadius: "50%", background: "rgba(255,104,32,0.13)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: -60, left: -60, width: 200, height: 200, borderRadius: "50%", background: "rgba(63,60,184,0.22)", pointerEvents: "none" }} />

      <div className="fade-up" style={{ textAlign: "center", marginBottom: 40, position: "relative", zIndex: 1 }}>
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

      <div className="fade-up" style={{
        width: "100%", maxWidth: 360,
        background: "rgba(255,255,255,0.10)", backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid rgba(255,255,255,0.18)", borderRadius: 24, padding: 28,
        position: "relative", zIndex: 1
      }}>
        <h3 style={{ color: "white", marginBottom: 18, textAlign: "center", fontSize: 18, fontWeight: 700 }}>
          Accedi
        </h3>

        <input
          type="email" placeholder="Email" autoComplete="username"
          inputMode="email" autoCapitalize="none" autoCorrect="off"
          value={email}
          onChange={e => { setEmail(e.target.value); setError(""); }}
          style={inputStyle}
        />
        <input
          type="password" placeholder="Password" autoComplete="current-password"
          value={password}
          onChange={e => { setPassword(e.target.value); setError(""); }}
          onKeyDown={e => e.key === "Enter" && handleLogin()}
          style={inputStyle}
        />

        {error && <p style={{ color: T.orangeLight, fontSize: 13, marginBottom: 10 }}>⚠️ {error}</p>}

        <button onClick={handleLogin} disabled={loading} className="tap-sc" style={{
          width: "100%", padding: 15, borderRadius: 14,
          background: loading ? "rgba(255,255,255,0.2)" : `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})`,
          color: "white", fontSize: 16, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8
        }}>
          {loading ? <><Spinner size={18} color="white" /> Accesso in corso...</> : "Accedi →"}
        </button>

        <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, textAlign: "center", marginTop: 14, lineHeight: 1.5 }}>
          L'accesso resta memorizzato su questo dispositivo.<br />
          Le credenziali le fornisce l'amministratore.
        </p>
      </div>

      <Tagline light />
    </div>
  );
}

// ===================== HEADER / TABBAR =====================
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
    const thumb = item.image ? await makeThumb(item.image) : "";
    await cloud.addHistory({ ...item, image: thumb });
  }

  return (
    <div style={{ minHeight: "100vh", background: T.bg, maxWidth: 520, margin: "0 auto" }}>
      <Header title="WERFEN SCAN" subtitle="Spare Parts Recognition" onLogout={onLogout} />
      <div style={{ paddingBottom: 90 }}>
        {tab === "scan"    && <ScanScreen parts={parts} onAddHistory={addToHistory} reloadParts={reloadParts} loadError={loadError} />}
        {tab === "catalog" && <CatalogScreen parts={parts} />}
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
      <Tagline raised />
    </div>
  );
}

// ===================== SCAN SCREEN =====================
function ScanScreen({ parts, onAddHistory, reloadParts, loadError }) {
  const [image, setImage]         = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState("");
  const [imgLoading, setImgLoading] = useState(false);

  async function handleFile(e) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setImgLoading(true);
    setError("");
    try {
      const compressed = await compressImage(file, 1000, 0.8);
      setImage(compressed);
      setResult(null);
    } catch (err) {
      console.error("compressImage:", err);
      setError("Impossibile caricare l'immagine. Riprova.");
    } finally {
      // Sempre, anche dopo un errore: altrimenti riselezionare la STESSA
      // foto non farebbe più scattare onChange e l'app sembrerebbe bloccata.
      try { input.value = ""; } catch { /* ignore */ }
      setImgLoading(false);
    }
  }

  async function analyze() {
    if (!image) return;
    if (parts.length === 0) {
      setError("Il database è vuoto. Chiedi all'amministratore di caricare i ricambi.");
      return;
    }

    setAnalyzing(true);
    setError("");

    try {
      // La sessione Supabase autorizza la chiamata al proxy.
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Sessione scaduta. Esegui di nuovo il login.");

      const [meta, base64] = image.split(",");
      const mediaType = meta.split(";")[0].split(":")[1];

      const partsCtx = parts.map(p => ({
        id: p.id, code: p.code, name: p.name,
        description: p.description,
        category: p.category || "",
        compatibility: p.compatibility || []
      }));

      // 🔑 Nessuna chiave qui: la aggiunge il server in /api/analyze
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          image: { media_type: mediaType, data: base64 },
          parts: partsCtx,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);

      const matchedPart = payload.matched ? parts.find(p => p.id === payload.id) : null;

      const finalResult = {
        matched: !!payload.matched && !!matchedPart,
        confidence: Number(payload.confidence) || 0,
        reasoning: payload.reasoning || "",
        part: matchedPart || null,
        timestamp: new Date().toISOString(),
        image,
      };
      setResult(finalResult);
      onAddHistory(finalResult);
    } catch (e) {
      console.error("AI error:", e);
      setError(`Analisi fallita: ${e.message || "controlla la connessione."}`);
    } finally {
      setAnalyzing(false);
    }
  }

  function reset() { setImage(null); setResult(null); setError(""); }

  if (result) return <ResultCard result={result} onReset={reset} />;

  return (
    <div style={{ padding: 16 }}>
      {loadError && (
        <div style={{
          background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 14,
          padding: "12px 14px", marginBottom: 12, color: T.error, fontSize: 13, lineHeight: 1.5
        }}>
          ⚠️ {loadError}
          <button onClick={reloadParts} style={{
            marginTop: 8, width: "100%", padding: 9, borderRadius: 10,
            background: T.card, color: T.error, fontSize: 13, fontWeight: 700,
            border: "1px solid #FECACA"
          }}>↻ Riprova</button>
        </div>
      )}

      <PhotoPicker
        id="scan-photo-input"
        disabled={analyzing || imgLoading}
        onFile={handleFile}
        style={{
          display: "flex", borderRadius: 20, overflow: "hidden", marginBottom: 16,
          minHeight: 240, alignItems: "center", justifyContent: "center",
          background: image ? "black" : T.card,
          border: `2px dashed ${image ? T.blue : T.border}`,
          cursor: (analyzing || imgLoading) ? "default" : "pointer", position: "relative",
          boxShadow: image ? T.shadowLg : T.shadow
        }}
      >
        {imgLoading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, minHeight: 240 }}>
            <Spinner size={36} />
            <p style={{ color: T.textMid, fontWeight: 600, fontSize: 14 }}>Elaborazione foto...</p>
          </div>
        ) : image ? (
          <>
            <img src={image} alt="part" style={{ width: "100%", maxHeight: 320, objectFit: "cover", display: "block" }} />
            {analyzing && (
              <div style={{
                position: "absolute", inset: 0, background: "rgba(18,15,146,0.65)",
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 12
              }}>
                <Spinner size={40} color="white" />
                <p style={{ color: "white", fontWeight: 600, fontSize: 15 }}>Analisi AI in corso...</p>
                <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>Confronto con il database ricambi</p>
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: "center", padding: 32 }}>
            <div style={{
              width: 80, height: 80, borderRadius: 20, margin: "0 auto 16px",
              background: T.bluePale, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36
            }}>📷</div>
            <p style={{ color: T.blue, fontWeight: 700, fontSize: 17 }}>Scatta o carica una foto</p>
            <p style={{ color: T.textLight, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              Fotografa il ricambio<br />da identificare
            </p>
          </div>
        )}
      </PhotoPicker>

      {!image && (
        <div style={{
          background: T.orangePale, borderRadius: 14, padding: "14px 16px", marginBottom: 16,
          display: "flex", gap: 10, alignItems: "flex-start", border: `1px solid ${T.orange}33`
        }}>
          <span style={{ fontSize: 20 }}>💡</span>
          <div>
            <p style={{ color: T.orange, fontSize: 13, fontWeight: 700 }}>Come usare WERFEN SCAN</p>
            <p style={{ color: T.textMid, fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
              Fotografa un ricambio o componente. L'AI lo confronta con il database e mostra codice, descrizione e compatibilità. Puoi anche cercare manualmente nella scheda Catalog.
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
          }}>✕ Rimuovi</button>
          <button onClick={analyze} className="tap-sc" style={{
            flex: 2, padding: 14, borderRadius: 14,
            background: `linear-gradient(135deg, ${T.blue}, ${T.blueLight})`,
            color: "white", fontSize: 15, fontWeight: 700,
            boxShadow: "0 4px 20px rgba(18,15,146,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8
          }}>
            <span>🔍</span> Identifica ricambio
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
            <p style={{ color: T.text, fontWeight: 700, fontSize: 15 }}>{parts.length} ricambi nel database</p>
            <p style={{ color: T.textLight, fontSize: 12 }}>Pronto per la scansione</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ===================== CATALOG =====================
function CatalogScreen({ parts }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);

  const q = search.toLowerCase();
  const filtered = parts.filter(p =>
    p.name?.toLowerCase().includes(q) ||
    p.code?.toLowerCase().includes(q) ||
    p.category?.toLowerCase().includes(q) ||
    p.description?.toLowerCase().includes(q)
  );

  if (selected) return <PartDetail part={selected} onBack={() => setSelected(null)} />;

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 16, letterSpacing: "-0.4px" }}>
        Catalogo ricambi
      </h2>
      <div style={{ position: "relative", marginBottom: 16 }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: T.textLight }}>🔍</span>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Cerca per nome, codice, categoria..."
          style={{
            width: "100%", padding: "13px 16px 13px 42px", borderRadius: 14,
            border: `1.5px solid ${T.border}`, background: T.card, fontSize: 15, color: T.text
          }}
        />
      </div>
      {parts.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 24px" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📦</div>
          <p style={{ color: T.text, fontWeight: 700, fontSize: 16 }}>Database vuoto</p>
          <p style={{ color: T.textLight, fontSize: 14, marginTop: 6 }}>Chiedi all'amministratore di caricare i ricambi</p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🔍</div>
          <p style={{ color: T.text, fontWeight: 700 }}>Nessun risultato per "{search}"</p>
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
              <div className="wrap-anywhere" style={{ fontFamily: "monospace", color: T.blue, fontSize: 12, fontWeight: 600 }}>{part.code}</div>
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
      }}>← Indietro</button>
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
              <span className="wrap-anywhere" style={{ fontFamily: "monospace", color: T.blue, fontWeight: 700, fontSize: 16 }}>{part.code}</span>
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
              <p style={{ fontSize: 11, color: T.textLight, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Compatibilità</p>
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
  const pct = Math.max(0, Math.min(100, Number(confidence) || 0));
  return (
    <div className="fade-up" style={{ padding: 16 }}>
      <div style={{ background: T.card, borderRadius: 20, overflow: "hidden", boxShadow: T.shadowLg, border: `1px solid ${T.border}` }}>
        <div style={{
          background: matched ? `linear-gradient(135deg, ${T.blueDark}, ${T.blue})` : `linear-gradient(135deg, #374151, #6B7280)`,
          padding: 20, display: "flex", alignItems: "center", justifyContent: "space-between"
        }}>
          <div>
            <div style={{ color: "white", fontWeight: 700, fontSize: 17 }}>
              {matched ? "✅ Ricambio identificato" : "❌ Nessuna corrispondenza"}
            </div>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 3 }}>
              Confidenza AI: {pct}%
            </div>
          </div>
          <div style={{
            background: matched ? `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})` : "rgba(255,255,255,0.15)",
            borderRadius: 14, padding: "8px 14px", color: "white", fontSize: 18, fontWeight: 800
          }}>{pct}%</div>
        </div>
        <div style={{ height: 4, background: T.border }}>
          <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${T.orange}, ${T.orangeLight})`, transition: "width 0.8s ease" }} />
        </div>
        <div style={{ padding: 20 }}>
          {matched && part ? (
            <>
              {part.imageBase64 && <img src={part.imageBase64} alt="" style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 14, marginBottom: 16 }} />}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: T.bluePale, borderRadius: 12, padding: "8px 14px" }}>
                  <span>🏷️</span>
                  <span className="wrap-anywhere" style={{ fontFamily: "monospace", color: T.blue, fontWeight: 700, fontSize: 16 }}>{part.code}</span>
                </div>
                {part.category && (
                  <div style={{ display: "inline-flex", alignItems: "center", background: T.orangePale, borderRadius: 10, padding: "8px 12px" }}>
                    <span style={{ color: T.orange, fontSize: 13, fontWeight: 600 }}>{part.category}</span>
                  </div>
                )}
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 800, color: T.text, marginBottom: 8, lineHeight: 1.2 }}>{part.name}</h3>
              {part.description && <p style={{ fontSize: 14, color: T.textMid, lineHeight: 1.6, marginBottom: 16 }}>{part.description}</p>}
              {part.compatibility?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <p style={{ fontSize: 11, color: T.textLight, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Compatibilità</p>
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
                L'AI non ha trovato corrispondenze. Prova a cercare manualmente nel Catalogo o contatta l'amministratore.
              </p>
            </div>
          )}
          {reasoning && (
            <div style={{ background: T.orangePale, border: `1px solid ${T.orange}33`, borderRadius: 12, padding: "12px 14px", marginBottom: 20 }}>
              <p style={{ color: "#92400E", fontSize: 13, lineHeight: 1.5 }}>
                <strong>💡 Analisi AI: </strong>{reasoning}
              </p>
            </div>
          )}
          <button onClick={onReset} className="tap-sc" style={{
            width: "100%", padding: 15, borderRadius: 14,
            background: `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})`,
            color: "white", fontSize: 16, fontWeight: 700,
            boxShadow: "0 4px 20px rgba(255,104,32,0.3)"
          }}>📷 Nuova scansione</button>
        </div>
      </div>
    </div>
  );
}

// ===================== HISTORY =====================
function HistoryScreen({ history }) {
  if (!history.length) return (
    <div style={{ textAlign: "center", padding: "64px 24px" }}>
      <div style={{ fontSize: 52, marginBottom: 14 }}>🕐</div>
      <p style={{ color: T.text, fontWeight: 700, fontSize: 17 }}>Nessuna scansione</p>
      <p style={{ color: T.textLight, fontSize: 14, marginTop: 6 }}>Le tue scansioni compariranno qui</p>
    </div>
  );
  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 16, letterSpacing: "-0.4px" }}>
        Cronologia
        <span style={{ marginLeft: 8, background: T.bluePale, color: T.blue, fontSize: 13, borderRadius: 8, padding: "2px 8px", fontWeight: 700, verticalAlign: "middle" }}>{history.length}</span>
      </h2>
      {history.map((item, i) => (
        <div key={`${item.timestamp}-${i}`} className="fade-in" style={{
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
                <div className="wrap-anywhere" style={{ fontFamily: "monospace", color: T.blue, fontSize: 12, marginTop: 2 }}>{item.part.code}</div>
              </>
            ) : (
              <div style={{ fontWeight: 600, color: T.textMid, fontSize: 14 }}>Nessuna corrispondenza</div>
            )}
            <div style={{ color: T.textLight, fontSize: 11, marginTop: 4 }}>
              {new Date(item.timestamp).toLocaleString("it-IT")}
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
function AdminApp({ parts, onAddPart, onUpdatePart, onDeletePart, reloadParts, loadError, onLogout, userEmail }) {
  const [tab, setTab] = useState("parts");
  const [editingPart, setEditingPart] = useState(null);

  function handleEdit(part)  { setEditingPart(part); setTab("add"); }
  function handleAddNew()    { setEditingPart(null); setTab("add"); }
  function handleDone()      { setEditingPart(null); setTab("parts"); reloadParts(); }

  return (
    <div style={{ minHeight: "100vh", background: T.bg, maxWidth: 520, margin: "0 auto" }}>
      <Header title="WERFEN SCAN Admin" subtitle="Area amministratore" onLogout={onLogout} />
      <div style={{ paddingBottom: 90 }}>
        {tab === "parts" && <PartsListScreen parts={parts} onEdit={handleEdit} onAdd={handleAddNew} onDeletePart={onDeletePart} reloadParts={reloadParts} loadError={loadError} />}
        {/* La key forza il remount passando da Edit a New Part: senza,
            il form resterebbe precompilato col ricambio in modifica. */}
        {tab === "add" && (
          <AddEditPartScreen
            key={editingPart?.id || "new"}
            parts={parts}
            editingPart={editingPart}
            onAddPart={onAddPart}
            onUpdatePart={onUpdatePart}
            onDone={handleDone}
          />
        )}
        {tab === "settings" && <SettingsScreen partsCount={parts.length} userEmail={userEmail} />}
      </div>
      <TabBar
        tabs={[
          { id: "parts",    label: "Ricambi",  icon: "🔧" },
          { id: "add",      label: editingPart ? "Modifica" : "Aggiungi", icon: "➕" },
          { id: "settings", label: "Impostazioni", icon: "⚙️" },
        ]}
        active={tab}
        onChange={t => {
          if (t === "add") handleAddNew();
          else { setEditingPart(null); setTab(t); }
        }}
      />
      <Tagline raised />
    </div>
  );
}

// ===================== PARTS LIST =====================
function PartsListScreen({ parts, onEdit, onAdd, onDeletePart, reloadParts, loadError }) {
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState("");

  const q = search.toLowerCase();
  const filtered = parts.filter(p =>
    p.name?.toLowerCase().includes(q) ||
    p.code?.toLowerCase().includes(q) ||
    p.category?.toLowerCase().includes(q)
  );

  async function deletePart(id) {
    setActionError("");
    try { await onDeletePart(id); }
    catch (e) {
      console.error(e);
      setActionError(`Impossibile eliminare: ${e.message || "controlla la connessione"}. Se hai attivato RLS, le scritture sono consentite solo all'account admin.`);
    }
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
          message="Eliminare questo ricambio dal database condiviso? L'operazione è irreversibile e vale per tutti i dispositivi."
          onConfirm={() => deletePart(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {(loadError || actionError) && (
        <div style={{
          background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 14,
          padding: "12px 14px", marginBottom: 12, color: T.error, fontSize: 13, lineHeight: 1.5
        }}>⚠️ {loadError || actionError}</div>
      )}

      <div style={{
        background: `linear-gradient(135deg, ${T.blue}, ${T.blueLight})`,
        borderRadius: 18, padding: "18px 20px", marginBottom: 16,
        display: "flex", alignItems: "center", justifyContent: "space-between"
      }}>
        <div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Database condiviso ☁️</div>
          <div style={{ color: "white", fontSize: 28, fontWeight: 800, marginTop: 2 }}>{parts.length}</div>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>ricambi registrati</div>
        </div>
        <button onClick={onAdd} className="tap-sc" style={{
          padding: "12px 20px", borderRadius: 14,
          background: `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})`,
          color: "white", fontSize: 15, fontWeight: 700,
          boxShadow: "0 4px 16px rgba(255,104,32,0.4)"
        }}>+ Aggiungi</button>
      </div>

      <button onClick={refresh} disabled={refreshing} style={{
        width: "100%", padding: 11, borderRadius: 12, marginBottom: 16,
        background: T.bluePale, color: T.blue, fontSize: 14, fontWeight: 700,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8
      }}>
        {refreshing ? <><Spinner size={16} /> Aggiornamento...</> : "↻ Ricarica dal cloud"}
      </button>

      <div style={{ position: "relative", marginBottom: 16 }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: T.textLight }}>🔍</span>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Cerca per nome, codice o categoria..."
          style={{ width: "100%", padding: "13px 16px 13px 42px", borderRadius: 14, border: `1.5px solid ${T.border}`, background: T.card, fontSize: 15, color: T.text }}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 16px" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📦</div>
          <p style={{ color: T.text, fontWeight: 700 }}>{parts.length === 0 ? "Database vuoto" : "Nessun risultato"}</p>
          <p style={{ color: T.textLight, fontSize: 14, marginTop: 4 }}>{parts.length === 0 ? "Aggiungi il primo ricambio" : "Prova un altro termine"}</p>
          {parts.length === 0 && (
            <button onClick={onAdd} className="tap-sc" style={{
              marginTop: 18, padding: "12px 24px", borderRadius: 14,
              background: `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})`,
              color: "white", fontSize: 15, fontWeight: 700,
              boxShadow: "0 4px 16px rgba(255,104,32,0.35)"
            }}>+ Aggiungi il primo</button>
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
                <div className="wrap-anywhere" style={{ fontFamily: "monospace", color: T.blue, fontSize: 12, fontWeight: 600 }}>{part.code}</div>
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
              <button onClick={() => onEdit(part)} style={{ flex: 1, padding: 11, background: "transparent", color: T.blue, fontSize: 14, fontWeight: 600, borderRight: `1px solid ${T.border}` }}>✏️ Modifica</button>
              <button onClick={() => setConfirmDelete(part.id)} style={{ flex: 1, padding: 11, background: "transparent", color: T.error, fontSize: 14, fontWeight: 600 }}>🗑️ Elimina</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ===================== ADD / EDIT PART =====================
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

  function field(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleImage(e) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setImgLoading(true);
    setErrors(prev => ({ ...prev, image: "" }));
    try {
      const compressed = await compressImage(file, 800, 0.78);
      field("imageBase64", compressed);
    } catch (err) {
      console.error("compressImage:", err);
      setErrors(prev => ({ ...prev, image: "Impossibile caricare l'immagine. Riprova." }));
    } finally {
      try { input.value = ""; } catch { /* ignore */ }
      setImgLoading(false);
    }
  }

  function addCompat() {
    const val = compatInput.trim();
    if (!val || form.compatibility?.includes(val)) return;
    field("compatibility", [...(form.compatibility || []), val]);
    setCompatInput("");
  }

  function validate() {
    const e = {};
    if (!form.code.trim()) e.code = "Il codice è obbligatorio";
    if (!form.name.trim()) e.name = "Il nome è obbligatorio";
    const dup = parts.find(p =>
      p.code?.toLowerCase() === form.code.trim().toLowerCase() && p.id !== editingPart?.id
    );
    if (dup) e.code = "Questo codice esiste già nel database";
    return e;
  }

  async function save() {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    const cleaned = { ...form, code: form.code.trim(), name: form.name.trim() };
    try {
      if (isEdit) await onUpdatePart(editingPart.id, cleaned);
      else        await onAddPart(cleaned);
      onDone();
    } catch (e) {
      console.error("save error:", e);
      setErrors({ general: `Salvataggio fallito: ${e.message || "controlla la connessione"}.` });
    } finally {
      setSaving(false);
    }
  }

  const inp = (key) => ({
    width: "100%", padding: "13px 16px", borderRadius: 14,
    border: `1.5px solid ${key && errors[key] ? T.error : T.border}`,
    background: T.card, fontSize: 15, color: T.text,
  });

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 20, letterSpacing: "-0.4px" }}>
        {isEdit ? "✏️ Modifica ricambio" : "➕ Nuovo ricambio"}
      </h2>

      <PhotoPicker
        id="admin-photo-input"
        disabled={imgLoading}
        onFile={handleImage}
        style={{
          display: "block", borderRadius: 18, overflow: "hidden", marginBottom: 12,
          border: `2px dashed ${form.imageBase64 ? T.blue : T.border}`,
          minHeight: 150,
          background: form.imageBase64 ? "black" : T.card,
          cursor: imgLoading ? "default" : "pointer", position: "relative"
        }}
      >
        {imgLoading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, minHeight: 150 }}>
            <Spinner size={32} />
            <p style={{ color: T.textMid, fontSize: 13 }}>Elaborazione immagine...</p>
          </div>
        ) : form.imageBase64 ? (
          <img src={form.imageBase64} alt="" style={{ width: "100%", maxHeight: 220, objectFit: "cover", display: "block" }} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 150, padding: 24 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📷</div>
            <p style={{ color: T.blue, fontWeight: 700 }}>Aggiungi foto del ricambio</p>
            <p style={{ color: T.textLight, fontSize: 12, marginTop: 4 }}>Tocca per scattare o scegliere dalla galleria</p>
          </div>
        )}
      </PhotoPicker>

      {errors.image && <p style={{ color: T.error, fontSize: 12, marginBottom: 10 }}>⚠️ {errors.image}</p>}

      {form.imageBase64 && (
        <button onClick={() => field("imageBase64", "")} style={{
          width: "100%", padding: 9, borderRadius: 10, marginBottom: 14,
          background: "#FEF2F2", color: T.error, fontSize: 13, fontWeight: 600,
          border: "1px solid #FECACA"
        }}>🗑️ Rimuovi foto</button>
      )}

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.textMid, marginBottom: 6 }}>Codice ricambio *</label>
        <input value={form.code}
          onChange={e => { field("code", e.target.value); setErrors(prev => ({ ...prev, code: "" })); }}
          placeholder="es. PART-001, CBN-2240-A"
          style={{ ...inp("code"), fontFamily: "monospace", letterSpacing: 0.5 }}
        />
        {errors.code && <p style={{ color: T.error, fontSize: 12, marginTop: 4 }}>⚠️ {errors.code}</p>}
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.textMid, marginBottom: 6 }}>Nome ricambio *</label>
        <input value={form.name}
          onChange={e => { field("name", e.target.value); setErrors(prev => ({ ...prev, name: "" })); }}
          placeholder="es. Cuscinetto a sfere, Valvola idraulica"
          style={inp("name")}
        />
        {errors.name && <p style={{ color: T.error, fontSize: 12, marginTop: 4 }}>⚠️ {errors.name}</p>}
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.textMid, marginBottom: 6 }}>Categoria / Tipo</label>
        <input value={form.category} onChange={e => field("category", e.target.value)}
          placeholder="es. Meccanica, Elettronica, Idraulica"
          style={inp("category")}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.textMid, marginBottom: 6 }}>Descrizione tecnica</label>
        <textarea value={form.description} onChange={e => field("description", e.target.value)}
          placeholder="Forma, colore, materiale, dimensioni, sigle visibili... — è questo il testo su cui l'AI riconosce il pezzo"
          rows={4}
          style={{ ...inp("description"), lineHeight: 1.5, paddingTop: 12 }}
        />
        <p style={{ color: T.textLight, fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
          💡 L'AI confronta la foto scattata con <strong>questa descrizione</strong>, non con la foto qui sopra.
          Descrivi forma, colore, materiale, dimensioni indicative e marcature visibili.
        </p>
      </div>

      <div style={{ marginBottom: 22 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.textMid, marginBottom: 6 }}>Compatibilità macchine / modelli</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input value={compatInput}
            onChange={e => setCompatInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCompat(); } }}
            placeholder="es. Tornio CNC Mazak, Pressa idraulica"
            style={{ ...inp(null), flex: 1, fontSize: 14 }}
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
          <p style={{ color: T.textLight, fontSize: 12 }}>Aggiungi macchine/modelli compatibili (Invio o +)</p>
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
        }}>Annulla</button>
        <button onClick={save} disabled={saving} className="tap-sc" style={{
          flex: 2, padding: 14, borderRadius: 14,
          background: saving ? T.textLight : `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})`,
          color: "white", fontSize: 15, fontWeight: 700,
          boxShadow: saving ? "none" : "0 4px 20px rgba(255,104,32,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8
        }}>
          {saving ? <><Spinner size={18} color="white" /> Salvataggio...</> : (isEdit ? "💾 Salva modifiche" : "✅ Aggiungi al database")}
        </button>
      </div>
    </div>
  );
}

// ===================== SETTINGS =====================
function SettingsScreen({ partsCount, userEmail }) {
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [feedback, setFeedback] = useState({ msg: "", type: "" });
  const [saving, setSaving] = useState(false);

  async function changePassword() {
    if (!newPwd || !confirmPwd) { setFeedback({ msg: "Compila entrambi i campi", type: "error" }); return; }
    if (newPwd !== confirmPwd)  { setFeedback({ msg: "Le password non coincidono", type: "error" }); return; }
    if (newPwd.length < 8)      { setFeedback({ msg: "La password deve avere almeno 8 caratteri", type: "error" }); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPwd });
    if (error) setFeedback({ msg: error.message, type: "error" });
    else {
      setFeedback({ msg: "✅ Password aggiornata", type: "success" });
      setNewPwd(""); setConfirmPwd("");
    }
    setSaving(false);
  }

  return (
    <div style={{ padding: 16 }}>
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
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Ricambi totali</div>
          <div style={{ color: "white", fontSize: 36, fontWeight: 800, lineHeight: 1.1 }}>{partsCount}</div>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>nel database</div>
        </div>
      </div>

      {/* Chiave AI — ora server-side */}
      <div style={{ background: T.card, borderRadius: 20, padding: 20, border: `1px solid ${T.border}`, boxShadow: T.shadow, marginBottom: 16 }}>
        <h3 style={{ fontWeight: 800, color: T.text, marginBottom: 8, fontSize: 17 }}>🤖 Chiave AI</h3>
        <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 12, padding: "12px 14px" }}>
          <p style={{ color: T.success, fontSize: 13, fontWeight: 700, marginBottom: 4 }}>✅ Configurata sul server</p>
          <p style={{ color: T.textMid, fontSize: 12, lineHeight: 1.6 }}>
            La chiave Anthropic vive nelle Environment Variables di Vercel e non raggiunge mai
            il browser. Vale automaticamente per ogni dispositivo: non c'è nulla da inserire qui.
            Per sostituirla: Vercel → Settings → Environment Variables → <code>ANTHROPIC_API_KEY</code>,
            poi Redeploy.
          </p>
        </div>
      </div>

      {/* Account */}
      <div style={{ background: T.card, borderRadius: 20, padding: 20, border: `1px solid ${T.border}`, boxShadow: T.shadow, marginBottom: 16 }}>
        <h3 style={{ fontWeight: 800, color: T.text, marginBottom: 6, fontSize: 17 }}>👤 Account</h3>
        <p className="wrap-anywhere" style={{ color: T.textMid, fontSize: 13, marginBottom: 18 }}>
          Connesso come <strong>{userEmail}</strong>
        </p>

        <h4 style={{ fontWeight: 700, color: T.text, marginBottom: 12, fontSize: 15 }}>🔐 Cambia password</h4>
        {[
          { val: newPwd, set: setNewPwd, label: "Nuova password", ph: "Almeno 8 caratteri" },
          { val: confirmPwd, set: setConfirmPwd, label: "Conferma password", ph: "Ripeti la password" },
        ].map(({ val, set, label, ph }, idx) => (
          <div key={idx} style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.textMid, marginBottom: 6 }}>{label}</label>
            <input
              type="password" value={val} autoComplete="new-password"
              onChange={e => { set(e.target.value); setFeedback({ msg: "", type: "" }); }}
              placeholder={ph}
              style={{ width: "100%", padding: "13px 16px", borderRadius: 14, border: `1.5px solid ${T.border}`, background: T.bg, fontSize: 15, color: T.text }}
            />
          </div>
        ))}
        {feedback.msg && (
          <div style={{
            padding: "12px 14px", borderRadius: 12, marginBottom: 14, fontSize: 14,
            background: feedback.type === "success" ? "#F0FDF4" : "#FEF2F2",
            color: feedback.type === "success" ? T.success : T.error,
            border: `1px solid ${feedback.type === "success" ? "#86EFAC" : "#FECACA"}`
          }}>{feedback.msg}</div>
        )}
        <button onClick={changePassword} disabled={saving} className="tap-sc" style={{
          width: "100%", padding: 14, borderRadius: 14,
          background: `linear-gradient(135deg, ${T.blue}, ${T.blueLight})`,
          color: "white", fontSize: 15, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8
        }}>
          {saving ? <><Spinner size={18} color="white" /> Aggiornamento...</> : "🔐 Aggiorna password"}
        </button>
      </div>

      <div style={{ background: T.card, borderRadius: 16, padding: 16, border: `1px solid ${T.border}`, textAlign: "center" }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🔧</div>
        <div style={{ color: T.text, fontWeight: 700, fontSize: 15 }}>WERFEN SCAN v3.0</div>
        <div style={{ color: T.textLight, fontSize: 13, marginTop: 4 }}>
          Industrial Spare Parts Recognition<br />
          Powered by Claude AI (Anthropic)
        </div>
      </div>
    </div>
  );
}

// ===================== SETUP / LOADING =====================
function SetupScreen() {
  return (
    <div style={{
      minHeight: "100vh",
      background: `linear-gradient(160deg, ${T.blueDark}, ${T.blue})`,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 24
    }}>
      <div style={{
        background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.2)",
        borderRadius: 24, padding: 28, maxWidth: 380, width: "100%"
      }}>
        <div style={{ fontSize: 40, textAlign: "center", marginBottom: 16 }}>☁️</div>
        <h2 style={{ color: "white", fontWeight: 800, textAlign: "center", marginBottom: 10, fontSize: 20 }}>
          Configura il database condiviso
        </h2>

        {cloudConfigProblem && (
          <div style={{
            background: "rgba(255,104,32,0.15)", border: `1px solid ${T.orange}`,
            borderRadius: 12, padding: "10px 12px", marginBottom: 16
          }}>
            <p className="wrap-anywhere" style={{ color: "#FFD9C2", fontSize: 12, lineHeight: 1.5 }}>
              ⚠️ {cloudConfigProblem}
            </p>
          </div>
        )}

        {[
          { n: "1", t: "Crea un progetto gratuito", s: "su supabase.com" },
          { n: "2", t: "Esegui l'SQL", s: "nello SQL Editor" },
          { n: "3", t: "Copia URL e Anon Key", s: "da Settings → API → Project URL" },
          { n: "4", t: "Incolla in App.jsx", s: "SUPABASE_URL e SUPABASE_ANON_KEY in cima" },
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

function LoadingScreen({ label = "Caricamento WERFEN SCAN..." }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: `linear-gradient(160deg, ${T.blueDark}, ${T.blue})`,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 20
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: 20,
        background: `linear-gradient(135deg, ${T.orange}, ${T.orangeLight})`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 34, boxShadow: "0 8px 32px rgba(255,104,32,0.4)",
        animation: "pulse 1.2s ease infinite"
      }}>🔧</div>
      <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 16, fontWeight: 600 }}>{label}</p>
      <Tagline light />
    </div>
  );
}

// ===================== ROOT =====================
export default function App() {
  const [session, setSession]         = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [parts, setParts]             = useState([]);
  const [partsLoading, setPartsLoading] = useState(false);
  const [loadError, setLoadError]     = useState("");

  // Sessione Supabase: persiste in localStorage, quindi il login
  // resta valido tra le aperture dell'app sullo stesso dispositivo.
  useEffect(() => {
    if (!cloudReady) { setAuthChecked(true); return; }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session ?? null);
      setAuthChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  async function reloadParts() {
    if (!cloudReady) return;
    try {
      const p = await cloud.loadParts();
      setParts(p);
      setLoadError("");
    } catch (e) {
      console.error("reloadParts:", e.message, e.code);
      setLoadError("Impossibile raggiungere il database. Controlla la connessione.");
    }
  }

  // I ricambi si caricano solo a sessione attiva (RLS richiede autenticazione)
  useEffect(() => {
    if (!cloudReady || !session) { setParts([]); return; }
    setPartsLoading(true);
    reloadParts().finally(() => setPartsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

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
  async function handleLogout() {
    await supabase.auth.signOut();
    setParts([]);
  }

  const email = session?.user?.email || "";

  let screen;
  if (!cloudReady)        screen = <SetupScreen />;
  else if (!authChecked)  screen = <LoadingScreen />;
  else if (!session)      screen = <LoginScreen />;
  else if (partsLoading)  screen = <LoadingScreen label="Caricamento ricambi..." />;
  else if (isAdminEmail(email)) screen = (
    <AdminApp
      parts={parts}
      onAddPart={handleAddPart}
      onUpdatePart={handleUpdatePart}
      onDeletePart={handleDeletePart}
      reloadParts={reloadParts}
      loadError={loadError}
      onLogout={handleLogout}
      userEmail={email}
    />
  );
  else screen = (
    <UserApp
      parts={parts}
      reloadParts={reloadParts}
      loadError={loadError}
      onLogout={handleLogout}
    />
  );

  return (
    <>
      <GlobalStyles />
      {screen}
    </>
  );
}
