import { useState, useEffect, createContext, useContext } from "react";
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

// ── Durata massima della sessione ────────────────────────────
// Dopo SESSION_MAX_HOURS dal login l'utente viene disconnesso e deve
// riautenticarsi. Si applica ai tecnici; l'admin ne è escluso.
// Per applicarlo anche all'admin: togli la riga isAdminEmail() in
// sessionExpired(). Per cambiare la durata: modifica il numero qui sotto.
const SESSION_MAX_HOURS = 24;
const LOGIN_AT_KEY = "werfen_login_at";

function rememberLoginTime() {
  try { localStorage.setItem(LOGIN_AT_KEY, String(Date.now())); } catch { /* ignore */ }
}
function forgetLoginTime() {
  try { localStorage.removeItem(LOGIN_AT_KEY); } catch { /* ignore */ }
}

// Momento di inizio sessione. Incrocia due fonti e tiene la più vecchia,
// così un refresh del token non fa ripartire il conteggio:
//  - last_sign_in_at, fornito dal server al login
//  - il timestamp locale salvato al momento del login
function sessionStartedAt(session) {
  const stamps = [];
  const serverTs = session?.user?.last_sign_in_at;
  if (serverTs) {
    const t = new Date(serverTs).getTime();
    if (!Number.isNaN(t)) stamps.push(t);
  }
  try {
    const local = Number(localStorage.getItem(LOGIN_AT_KEY));
    if (local > 0) stamps.push(local);
  } catch { /* ignore */ }
  return stamps.length ? Math.min(...stamps) : null;
}

function sessionExpired(session) {
  if (!session) return false;
  if (isAdminEmail(session.user?.email)) return false;   // l'admin non scade
  const start = sessionStartedAt(session);
  if (!start) return false;
  return Date.now() - start > SESSION_MAX_HOURS * 3600 * 1000;
}

// ═══════════════════ LINGUE ═══════════════════
// La preferenza vive nei metadati dell'utente Supabase: è quindi legata alla
// persona, non al dispositivo, e lo segue su qualunque telefono. La copia in
// localStorage serve solo a dipingere subito la schermata di login, prima che
// la sessione sia disponibile.
const LANGS = ["it", "en"];
const LANG_KEY = "werfen_lang";
const DEFAULT_LANG = "it";

const STRINGS = {
  it: {
    "app.subtitle": "Riconoscimento ricambi — con AI",
    "common.cancel": "Annulla",
    "common.delete": "Elimina",
    "common.retry": "↻ Riprova",
    "common.back": "← Indietro",
    "error.dbUnreachable": "Impossibile raggiungere il database. Controlla la connessione.",

    "login.title": "Accedi",
    "login.email": "Email",
    "login.password": "Password",
    "login.fillBoth": "Inserisci email e password",
    "login.badCredentials": "Email o password non corretti",
    "login.submit": "Accedi →",
    "login.loading": "Accesso in corso...",
    "login.note": "L'accesso resta memorizzato su questo dispositivo. Le credenziali le fornisce l'amministratore.",
    "login.expired": "Sessione scaduta dopo {h} ore. Accedi di nuovo con le tue credenziali.",
    "header.logout": "Esci",

    "tab.scan": "Scansiona",
    "tab.catalog": "Catalogo",
    "tab.history": "Cronologia",

    "scan.takePhoto": "Scatta o carica una foto",
    "scan.photoHint": "Fotografa il ricambio da identificare",
    "scan.processing": "Elaborazione foto...",
    "scan.analyzing": "Analisi AI in corso...",
    "scan.comparing": "Confronto con il database ricambi",
    "scan.howToTitle": "Come usare WERFEN SCAN",
    "scan.howToBody": "Fotografa un ricambio o componente. L'AI lo confronta con il database e mostra codice, descrizione e compatibilità. Puoi anche cercare manualmente nella scheda Catalogo.",
    "scan.remove": "✕ Rimuovi",
    "scan.identify": "Identifica ricambio",
    "scan.partsCount": "{n} ricambi nel database",
    "scan.ready": "Pronto per la scansione",
    "scan.dbEmpty": "Il database è vuoto. Chiedi all'amministratore di caricare i ricambi.",
    "scan.imgError": "Impossibile caricare l'immagine. Riprova.",
    "scan.sessionExpired": "Sessione scaduta. Esegui di nuovo il login.",
    "scan.failed": "Analisi fallita: {msg}",
    "scan.checkConnection": "controlla la connessione.",

    "result.identified": "✅ Ricambio identificato",
    "result.noMatch": "❌ Nessuna corrispondenza",
    "result.confidence": "Confidenza AI: {n}%",
    "result.compat": "Compatibilità",
    "result.noMatchBody": "L'AI non ha trovato corrispondenze. Prova a cercare manualmente nel Catalogo o contatta l'amministratore.",
    "result.aiAnalysis": "💡 Analisi AI: ",
    "result.newScan": "📷 Nuova scansione",

    "fb.question": "Il riconoscimento è corretto?",
    "fb.hint": "Le risposte dei tecnici affinano le scansioni successive.",
    "fb.correct": "Corretto",
    "fb.wrong": "👎 Sbagliato",
    "fb.thanks": "✅ Grazie, feedback registrato",
    "fb.whichWas": "Qual era il ricambio giusto?",
    "fb.similar": "I più simili per forma, colore e categoria:",
    "fb.searchCatalog": "Cerca il ricambio corretto nel catalogo.",
    "fb.searchOther": "Cerca un altro ricambio...",
    "fb.none": "Nessuno di questi",
    "fb.failed": "Invio non riuscito: {msg}.",

    "cat.title": "Catalogo ricambi",
    "cat.search": "Cerca per nome, codice, categoria...",
    "cat.empty": "Database vuoto",
    "cat.emptyHint": "Chiedi all'amministratore di caricare i ricambi",
    "cat.noResults": "Nessun risultato per \"{q}\"",

    "hist.title": "Cronologia",
    "hist.last": "Ultimi {n} giorni",
    "hist.range": "Dal {a} al {b}",
    "hist.from": "Dal giorno",
    "hist.to": "Al giorno",
    "hist.part": "Ricambio",
    "hist.filterPart": "Filtra per codice o nome",
    "hist.apply": "Applica",
    "hist.clear": "🗑️ Svuota tutta la cronologia",
    "hist.clearing": "Eliminazione...",
    "hist.confirmClear": "Svuotare tutta la tua cronologia delle scansioni? L'operazione è irreversibile. Riguarda solo il tuo account: le scansioni degli altri tecnici non vengono toccate.",
    "hist.loading": "Caricamento cronologia...",
    "hist.noResults": "Nessun risultato",
    "hist.noneInPeriod": "Nessuna scansione nel periodo",
    "hist.noMatchText": "Nessuna scansione corrisponde a \"{q}\"",
    "hist.hintFilter": "Tocca 🔎 in alto per cercare in un periodo precedente",
    "hist.hintWiden": "Prova ad allargare l'intervallo di date",
    "hist.noMatchLabel": "Nessuna corrispondenza",
    "hist.clearFailed": "Eliminazione non riuscita: {msg}.",
    "hist.loadFailed": "Impossibile caricare la cronologia.",

    "loading.app": "Caricamento WERFEN SCAN...",
    "loading.parts": "Caricamento ricambi...",
  },

  en: {
    "app.subtitle": "Spare Parts Recognition — AI Powered",
    "common.cancel": "Cancel",
    "common.delete": "Delete",
    "common.retry": "↻ Retry",
    "common.back": "← Back",
    "error.dbUnreachable": "Could not reach the database. Check your connection.",

    "login.title": "Sign in",
    "login.email": "Email",
    "login.password": "Password",
    "login.fillBoth": "Enter email and password",
    "login.badCredentials": "Incorrect email or password",
    "login.submit": "Sign in →",
    "login.loading": "Signing in...",
    "login.note": "You stay signed in on this device. Credentials are provided by the administrator.",
    "login.expired": "Session expired after {h} hours. Please sign in again with your credentials.",
    "header.logout": "Log out",

    "tab.scan": "Scan",
    "tab.catalog": "Catalogue",
    "tab.history": "History",

    "scan.takePhoto": "Take or upload a photo",
    "scan.photoHint": "Photograph the spare part to identify",
    "scan.processing": "Processing photo...",
    "scan.analyzing": "AI analysis in progress...",
    "scan.comparing": "Comparing with the parts database",
    "scan.howToTitle": "How to use WERFEN SCAN",
    "scan.howToBody": "Photograph a spare part or component. The AI compares it with the database and shows the part code, description and compatibility. You can also search manually in the Catalogue tab.",
    "scan.remove": "✕ Remove",
    "scan.identify": "Identify part",
    "scan.partsCount": "{n} parts in the database",
    "scan.ready": "Ready for scanning",
    "scan.dbEmpty": "The database is empty. Ask the administrator to add spare parts.",
    "scan.imgError": "Could not load the image. Please try again.",
    "scan.sessionExpired": "Session expired. Please sign in again.",
    "scan.failed": "Analysis failed: {msg}",
    "scan.checkConnection": "check your connection.",

    "result.identified": "✅ Part identified",
    "result.noMatch": "❌ No match found",
    "result.confidence": "AI confidence: {n}%",
    "result.compat": "Compatibility",
    "result.noMatchBody": "The AI found no match. Try searching manually in the Catalogue or contact the administrator.",
    "result.aiAnalysis": "💡 AI analysis: ",
    "result.newScan": "📷 New scan",

    "fb.question": "Is the recognition correct?",
    "fb.hint": "Technicians' answers refine future scans.",
    "fb.correct": "Correct",
    "fb.wrong": "👎 Wrong",
    "fb.thanks": "✅ Thanks, feedback recorded",
    "fb.whichWas": "Which was the correct part?",
    "fb.similar": "Most similar by shape, colour and category:",
    "fb.searchCatalog": "Search the correct part in the catalogue.",
    "fb.searchOther": "Search another part...",
    "fb.none": "None of these",
    "fb.failed": "Could not send: {msg}.",

    "cat.title": "Parts catalogue",
    "cat.search": "Search by name, code, category...",
    "cat.empty": "Database is empty",
    "cat.emptyHint": "Ask the administrator to add parts",
    "cat.noResults": "No results for \"{q}\"",

    "hist.title": "History",
    "hist.last": "Last {n} days",
    "hist.range": "From {a} to {b}",
    "hist.from": "From",
    "hist.to": "To",
    "hist.part": "Part",
    "hist.filterPart": "Filter by code or name",
    "hist.apply": "Apply",
    "hist.clear": "🗑️ Clear all history",
    "hist.clearing": "Deleting...",
    "hist.confirmClear": "Clear your whole scan history? This cannot be undone. It only affects your account: other technicians' scans are untouched.",
    "hist.loading": "Loading history...",
    "hist.noResults": "No results",
    "hist.noneInPeriod": "No scans in this period",
    "hist.noMatchText": "No scan matches \"{q}\"",
    "hist.hintFilter": "Tap 🔎 above to search an earlier period",
    "hist.hintWiden": "Try widening the date range",
    "hist.noMatchLabel": "No match",
    "hist.clearFailed": "Could not delete: {msg}.",
    "hist.loadFailed": "Could not load the history.",

    "loading.app": "Loading WERFEN SCAN...",
    "loading.parts": "Loading parts...",
  },
};

function translate(lang, key, vars) {
  const table = STRINGS[lang] || STRINGS[DEFAULT_LANG];
  let s = table[key] ?? STRINGS[DEFAULT_LANG][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

function readCachedLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (LANGS.includes(v)) return v;
  } catch { /* ignore */ }
  const nav = typeof navigator !== "undefined" ? (navigator.language || "") : "";
  return nav.toLowerCase().startsWith("en") ? "en" : DEFAULT_LANG;
}

const LangContext = createContext(null);
function useT() {
  return useContext(LangContext) || {
    lang: DEFAULT_LANG,
    t: (k, v) => translate(DEFAULT_LANG, k, v),
    setLang: () => {},
  };
}

// Selettore compatto IT | EN
function LangSwitch({ light = false }) {
  const { lang, setLang } = useT();
  const base = {
    padding: "5px 9px", fontSize: 12, fontWeight: 700, lineHeight: 1,
    background: "transparent", borderRadius: 8,
  };
  return (
    <div style={{
      display: "inline-flex", gap: 2, padding: 2, borderRadius: 10,
      background: light ? "rgba(255,255,255,0.12)" : T.bluePale,
      border: light ? "1px solid rgba(255,255,255,0.2)" : `1px solid ${T.border}`,
    }}>
      {LANGS.map(code => {
        const on = lang === code;
        return (
          <button key={code} onClick={() => setLang(code)} aria-pressed={on} style={{
            ...base,
            background: on ? (light ? "rgba(255,255,255,0.9)" : T.blue) : "transparent",
            color: on ? (light ? T.blue : "white") : (light ? "rgba(255,255,255,0.75)" : T.textMid),
          }}>{code.toUpperCase()}</button>
        );
      })}
    </div>
  );
}

// ===================== THEME =====================
// Palette. I due colori istituzionali sono `blue` e `orange`; le varianti
// dark/light/pale sono derivate da quelli mantenendo gli stessi rapporti.
const T = {
  blueDark:    "#04026B",           // rgb(4, 2, 107)
  blue:        "rgb(6, 3, 141)",    // ← colore istituzionale
  blueLight:   "#3330B3",           // rgb(51, 48, 179)
  bluePale:    "#E9E8F5",
  orange:      "rgb(232, 119, 34)", // ← colore istituzionale
  orangeLight: "#E89B4C",           // rgb(232, 155, 76)
  orangePale:  "#FDF4ED",
  bg:          "#F4F5FB",
  card:        "#FFFFFF",
  text:        "#0F1140",
  textMid:     "#4B4F73",
  textLight:   "#8A8FB0",
  border:      "#DCDEF0",
  success:     "#059669",
  error:       "#DC2626",
  shadow:      "0 2px 12px rgba(6,3,141,0.10)",
  shadowLg:    "0 8px 32px rgba(6,3,141,0.18)",
};

const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif`;

// ── Modalità di visualizzazione ──────────────────────────────
//  standalone = avviata dalla schermata Home (iOS "Aggiungi a Home",
//               Android "Installa app"): niente barra del browser, contenuto
//               a tutto schermo, status bar sovrapposta al contenuto.
//  browser    = aperta come scheda normale in Chrome/Safari.
// Il valore è fissato al caricamento: la modalità non cambia a runtime.
function detectStandalone() {
  if (typeof window === "undefined") return false;
  const mm = (q) => window.matchMedia && window.matchMedia(q).matches;
  return (
    window.navigator?.standalone === true ||   // iOS, aggiunta alla Home
    mm("(display-mode: standalone)") ||        // PWA installata
    mm("(display-mode: fullscreen)") ||
    mm("(display-mode: minimal-ui)")
  );
}
const IS_STANDALONE = detectStandalone();

if (typeof document !== "undefined") {
  document.documentElement.classList.add(IS_STANDALONE ? "mode-standalone" : "mode-browser");
}

const GLOBAL_STYLES = `
  :root {
    /* Margini di sicurezza: valgono 0 nel browser, diventano l'altezza della
       status bar / home indicator quando l'app parte dalla Home. Richiedono
       viewport-fit=cover nel meta viewport di index.html. */
    --safe-top:    env(safe-area-inset-top, 0px);
    --safe-bottom: env(safe-area-inset-bottom, 0px);
    --safe-left:   env(safe-area-inset-left, 0px);
    --safe-right:  env(safe-area-inset-right, 0px);
    --app-w: 520px;
    --tabbar-h: 58px;
  }

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

  /* Colonna dell'app. 100dvh segue il ridimensionamento della barra di
     Chrome su mobile; 100vh resta come fallback per i browser più vecchi. */
  .app-shell {
    width: 100%;
    max-width: var(--app-w);
    margin: 0 auto;
    min-height: 100vh;
    min-height: 100dvh;
    background: ${T.bg};
    position: relative;
  }
  .app-content {
    padding-left: var(--safe-left);
    padding-right: var(--safe-right);
    padding-bottom: calc(var(--tabbar-h) + var(--safe-bottom) + 32px);
  }

  /* Schermate a tutta pagina (login, setup, caricamento) */
  .screen-full {
    min-height: 100vh;
    min-height: 100dvh;
    padding-top:    calc(24px + var(--safe-top));
    padding-bottom: calc(24px + var(--safe-bottom));
    padding-left:   calc(24px + var(--safe-left));
    padding-right:  calc(24px + var(--safe-right));
  }

  /* Su schermi larghi la colonna diventa una scheda, invece di galleggiare
     su un fondo bianco a tutta larghezza. */
  @media (min-width: 700px) {
    body { background: #EBECF4; }
    .app-shell {
      box-shadow: 0 0 0 1px ${T.border}, 0 20px 60px rgba(6,3,141,0.10);
    }
  }

  /* Avviata dalla Home: niente selezione testo accidentale sui comandi,
     per un comportamento più vicino a quello di un'app nativa. */
  html.mode-standalone button,
  html.mode-standalone label {
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }

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

  .thumbs { -webkit-overflow-scrolling: touch; scrollbar-width: thin; }
  .thumbs::-webkit-scrollbar { height: 4px; }
  .thumbs::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 4px; }

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
  // Le liste NON scaricano la galleria: solo la copertina, che è una
  // miniatura. Con più foto per ricambio, un select("*") su cento pezzi
  // significherebbe decine di megabyte a ogni avvio.
  async loadParts() {
    const { data, error } = await supabase
      .from("parts")
      .select("id,code,name,description,category,compatibility,image_base64,created_at")
      .order("created_at", { ascending: false });
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
  // Galleria di un singolo ricambio, caricata su richiesta.
  // Se il ricambio è precedente alla galleria, ricade sulla vecchia
  // immagine singola: nessun record resta senza foto.
  async loadPartImages(id) {
    const { data, error } = await supabase
      .from("parts").select("images,image_base64").eq("id", id).single();
    if (error) { console.error("loadPartImages:", error.message, error.code); throw error; }
    const arr = Array.isArray(data?.images) ? data.images.filter(Boolean) : [];
    if (arr.length) return arr;
    return data?.image_base64 ? [data.image_base64] : [];
  },

  async addPart(part) {
    const images = (part.images || []).filter(Boolean);
    const { data, error } = await supabase.from("parts").insert([{
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      code: part.code.trim(),
      name: part.name.trim(),
      description: part.description || "",
      category: part.category || "",
      compatibility: part.compatibility || [],
      images,
      image_base64: part.coverBase64 || "",   // miniatura di copertina
    }]).select("id,code,name,description,category,compatibility,image_base64,created_at").single();
    if (error) throw error;
    return { ...data, imageBase64: data.image_base64 || "", compatibility: data.compatibility || [] };
  },
  async updatePart(id, part) {
    const images = (part.images || []).filter(Boolean);
    const { data, error } = await supabase.from("parts").update({
      code: part.code.trim(),
      name: part.name.trim(),
      description: part.description || "",
      category: part.category || "",
      compatibility: part.compatibility || [],
      images,
      image_base64: part.coverBase64 || "",
    }).eq("id", id).select("id,code,name,description,category,compatibility,image_base64,created_at").single();
    if (error) throw error;
    return { ...data, imageBase64: data.image_base64 || "", compatibility: data.compatibility || [] };
  },
  async deletePart(id) {
    const { error } = await supabase.from("parts").delete().eq("id", id);
    if (error) throw error;
  },
  // Carica la cronologia in un intervallo di date. Il filtro è applicato dal
  // database, non dal client: così si possono cercare scansioni vecchie senza
  // scaricare tutto lo storico.
  async loadHistory({ from, to, limit = 300 } = {}) {
    let query = supabase
      .from("scan_history").select("*")
      .order("timestamp", { ascending: false }).limit(limit);
    if (from) query = query.gte("timestamp", from);
    if (to)   query = query.lte("timestamp", to);
    const { data, error } = await query;
    if (error) { console.error("loadHistory:", error.message, error.code); throw error; }
    return (data || []).map(h => ({
      matched: h.matched,
      confidence: h.confidence,
      reasoning: h.reasoning,
      image: h.image_base64 || "",
      timestamp: h.timestamp,
      part: h.part_name ? { name: h.part_name, code: h.part_code } : null,
    }));
  },
  // Ogni scansione viene marcata con l'utente che l'ha eseguita.
  // Le policy RLS impediscono di scrivere righe intestate ad altri e di
  // leggere quelle altrui: l'isolamento è imposto dal database, non da qui.
  async addHistory(item) {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) { console.error("addHistory: nessuna sessione attiva"); return; }
    const { error } = await supabase.from("scan_history").insert([{
      user_id: userId,
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
  // ── Feedback sulle scansioni ──────────────────────────────
  // Registra se il riconoscimento era corretto e, quando sbagliato, qual era
  // il ricambio giusto. È il materiale che alimenta il contesto delle
  // scansioni successive.
  async addFeedback({ predictedPartId, correctPartId, isCorrect, confidence }) {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) throw new Error("Sessione non attiva");
    const { error } = await supabase.from("scan_feedback").insert([{
      user_id: userId,
      predicted_part_id: predictedPartId || null,
      correct_part_id: correctPartId || null,
      is_correct: !!isCorrect,
      confidence: confidence ?? null,
    }]);
    if (error) throw error;
  },

  // Aggrega i feedback di tutti i tecnici: conteggi per ricambio e coppie
  // di confusione ricorrenti. Serve al prompt, non all'interfaccia.
  async loadFeedbackStats() {
    const { data, error } = await supabase
      .from("scan_feedback")
      .select("predicted_part_id, correct_part_id, is_correct")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) {
      console.error("loadFeedbackStats:", error.message, error.code);
      return { byPart: {}, confusions: [] };
    }
    const byPart = {};
    const pairs = {};
    for (const f of data || []) {
      const pid = f.predicted_part_id;
      if (pid) {
        byPart[pid] = byPart[pid] || { ok: 0, ko: 0 };
        if (f.is_correct) byPart[pid].ok++; else byPart[pid].ko++;
      }
      if (!f.is_correct && pid && f.correct_part_id && pid !== f.correct_part_id) {
        const key = `${pid}>${f.correct_part_id}`;
        pairs[key] = (pairs[key] || 0) + 1;
      }
    }
    const confusions = Object.entries(pairs)
      .map(([k, count]) => {
        const [predicted, actual] = k.split(">");
        return { predicted, actual, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    return { byPart, confusions };
  },

  // Svuota la cronologia dell'utente collegato. Non serve filtrare per utente
  // qui: la policy RLS limita la DELETE alle sole righe di chi la esegue.
  // Il filtro sul timestamp c'è sempre: PostgREST rifiuta una DELETE nuda.
  async clearHistory({ from, to } = {}) {
    let query = supabase.from("scan_history").delete()
      .gte("timestamp", from || "1970-01-01T00:00:00.000Z");
    if (to) query = query.lte("timestamp", to);
    const { error } = await query;
    if (error) throw error;
  },
};

// ── Ricambi simili ───────────────────────────────────────────
// Quando l'AI sbaglia, proponiamo i candidati più plausibili invece di far
// scorrere tutto il catalogo. La somiglianza è calcolata sulle parole in
// comune fra descrizioni, nomi e categoria — quindi su colore, forma e
// materiale, che è come sono scritte le descrizioni. Nessun modello dietro:
// è un confronto testuale, deterministico e leggibile.
const STOPWORDS = new Set([
  "di","del","della","delle","dei","con","per","in","il","la","le","lo","gli",
  "una","uno","che","non","più","circa","alla","allo","sul","sulla","dal",
  "and","the","with","for","mm","cm","tipo","parte","pezzo",
]);

function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-zà-ù0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function partTokens(p) {
  return new Set([...tokenize(p.name), ...tokenize(p.description), ...tokenize(p.category)]);
}

function findSimilarParts(parts, target, limit = 5) {
  if (!target) return parts.slice(0, limit);
  const t = partTokens(target);
  return parts
    .filter(p => p.id !== target.id)
    .map(p => {
      let shared = 0;
      partTokens(p).forEach(w => { if (t.has(w)) shared++; });
      const sameCategory =
        p.category && target.category &&
        p.category.trim().toLowerCase() === target.category.trim().toLowerCase();
      return { part: p, score: shared + (sameCategory ? 2 : 0) };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.part);
}

// ── Intervalli di date per la cronologia ─────────────────────
const HISTORY_DEFAULT_DAYS = 7;

const pad2 = (n) => String(n).padStart(2, "0");
const toDateInput = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fmtDay = (input) => {
  if (!input) return "";
  const [y, m, d] = input.split("-");
  return `${d}/${m}/${y}`;
};
function startOfDayIso(input) {
  const d = new Date(`${input}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function endOfDayIso(input) {
  const d = new Date(`${input}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
// Ultimi 7 giorni = oggi più i 6 precedenti, dalla mezzanotte.
function defaultHistoryRange() {
  const today = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (HISTORY_DEFAULT_DAYS - 1));
  from.setHours(0, 0, 0, 0);
  return {
    preset: "7d",
    from: from.toISOString(),
    to: null,                       // aperto fino ad adesso
    fromInput: toDateInput(from),
    toInput: toDateInput(today),
  };
}

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

// Allineata al bordo destro della colonna dell'app, non della finestra:
// su desktop restava altrimenti staccata, in fondo allo schermo.
function Tagline({ light = false, raised = false }) {
  return (
    <div style={{
      position: "fixed", left: 0, right: 0,
      bottom: raised
        ? "calc(var(--tabbar-h) + var(--safe-bottom) + 10px)"
        : "calc(12px + var(--safe-bottom))",
      display: "flex", justifyContent: "center",
      pointerEvents: "none", zIndex: 50,
    }}>
      <div style={{
        width: "100%", maxWidth: "var(--app-w)",
        paddingRight: "calc(18px + var(--safe-right))",
        textAlign: "right",
        fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
        fontStyle: "italic",
        color: light ? "rgba(255,255,255,0.6)" : T.textLight,
      }}>Powering Patient Care</div>
    </div>
  );
}

function ConfirmDialog({ message, onConfirm, onCancel }) {
  const { t } = useT();
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(4,2,107,0.45)",
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
          }}>{t("common.cancel")}</button>
          <button onClick={onConfirm} style={{
            flex: 1, padding: 12, borderRadius: 12,
            background: T.error, color: "white", fontSize: 15, fontWeight: 700,
          }}>{t("common.delete")}</button>
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

// ===================== GALLERIA =====================
// Immagine grande più striscia di miniature. Le foto da angolazioni diverse
// servono al tecnico per confrontare i dettagli che una sola inquadratura
// non mostra: filettature, marcature, profilo laterale.
const MAX_PART_IMAGES = 6;

function Gallery({ images, height = 200 }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [images]);
  if (!images?.length) return null;
  const i = Math.min(idx, images.length - 1);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ position: "relative" }}>
        <img src={images[i]} alt="" style={{
          width: "100%", height, objectFit: "cover",
          borderRadius: 14, display: "block", background: T.bluePale
        }} />
        {images.length > 1 && (
          <div style={{
            position: "absolute", right: 10, bottom: 10,
            background: "rgba(0,0,0,0.55)", color: "white",
            fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "3px 8px"
          }}>{i + 1} / {images.length}</div>
        )}
      </div>

      {images.length > 1 && (
        <div className="thumbs" style={{ display: "flex", gap: 6, marginTop: 8, overflowX: "auto", paddingBottom: 2 }}>
          {images.map((src, n) => (
            <button key={n} onClick={() => setIdx(n)} aria-label={`Foto ${n + 1}`} style={{
              flexShrink: 0, width: 54, height: 54, borderRadius: 10,
              overflow: "hidden", padding: 0, background: T.card,
              border: n === i ? `2.5px solid ${T.blue}` : `1px solid ${T.border}`,
              opacity: n === i ? 1 : 0.7,
            }}>
              <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ===================== LOGIN SCREEN (Supabase Auth) =====================
function LoginScreen({ expired }) {
  const { t } = useT();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password) { setError(t("login.fillBoth")); return; }
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? t("login.badCredentials")
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
    <div className="screen-full" style={{
      background: T.blue,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      position: "relative", overflow: "hidden"
    }}>
      <div className="fade-up" style={{ textAlign: "center", marginBottom: 40, position: "relative", zIndex: 1 }}>
        <div style={{
          width: 88, height: 88, borderRadius: 24, margin: "0 auto 16px",
          background: T.orange,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 40
        }}>🔧</div>
        <div style={{ color: "white", fontSize: 30, fontWeight: 800, letterSpacing: "-0.8px" }}>WERFEN SCAN</div>
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, marginTop: 4, fontWeight: 500 }}>
          {t("app.subtitle")}
        </div>
        <div style={{ marginTop: 16 }}><LangSwitch light /></div>
      </div>

      <div className="fade-up" style={{
        width: "100%", maxWidth: 360,
        background: "rgba(255,255,255,0.10)", backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid rgba(255,255,255,0.18)", borderRadius: 24, padding: 28,
        position: "relative", zIndex: 1
      }}>
        <h3 style={{ color: "white", marginBottom: 18, textAlign: "center", fontSize: 18, fontWeight: 700 }}>
          {t("login.title")}
        </h3>

        {expired && (
          <div style={{
            background: "rgba(232,119,34,0.18)", border: `1px solid ${T.orange}`,
            borderRadius: 12, padding: "10px 12px", marginBottom: 14
          }}>
            <p style={{ color: "#FFD9C2", fontSize: 12.5, lineHeight: 1.5 }}>
              ⏱️ {t("login.expired", { h: SESSION_MAX_HOURS })}
            </p>
          </div>
        )}

        <input
          type="email" placeholder={t("login.email")} autoComplete="username"
          inputMode="email" autoCapitalize="none" autoCorrect="off"
          value={email}
          onChange={e => { setEmail(e.target.value); setError(""); }}
          style={inputStyle}
        />
        <input
          type="password" placeholder={t("login.password")} autoComplete="current-password"
          value={password}
          onChange={e => { setPassword(e.target.value); setError(""); }}
          onKeyDown={e => e.key === "Enter" && handleLogin()}
          style={inputStyle}
        />

        {error && <p style={{ color: T.orangeLight, fontSize: 13, marginBottom: 10 }}>⚠️ {error}</p>}

        <button onClick={handleLogin} disabled={loading} className="tap-sc" style={{
          width: "100%", padding: 15, borderRadius: 14,
          background: loading ? "rgba(255,255,255,0.2)" : T.orange,
          color: "white", fontSize: 16, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8
        }}>
          {loading ? <><Spinner size={18} color="white" /> {t("login.loading")}</> : t("login.submit")}
        </button>

        <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, textAlign: "center", marginTop: 14, lineHeight: 1.5 }}>
          {t("login.note")}
        </p>
      </div>

      <Tagline light />
    </div>
  );
}

// ===================== HEADER / TABBAR =====================
function Header({ title, subtitle, onLogout, showLang = false }) {
  const { t } = useT();
  return (
    <div style={{
      background: T.blue,
      padding: "14px 20px",
      // Avviata dalla Home la status bar si sovrappone al contenuto: senza
      // questo padding l'orologio coprirebbe il titolo. Nel browser vale 0.
      paddingTop:   "calc(14px + var(--safe-top))",
      paddingLeft:  "calc(20px + var(--safe-left))",
      paddingRight: "calc(20px + var(--safe-right))",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      position: "sticky", top: 0, zIndex: 100,
      boxShadow: "0 4px 20px rgba(6,3,141,0.25)"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 11,
          background: T.orange,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20
        }}>🔧</div>
        <div>
          <div style={{ color: "white", fontWeight: 700, fontSize: 17, letterSpacing: "-0.3px" }}>{title}</div>
          <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: 500 }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {showLang && <LangSwitch light />}
        <button onClick={onLogout} style={{
          background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)",
          color: "rgba(255,255,255,0.85)", borderRadius: 10, padding: "7px 12px",
          fontSize: 13, fontWeight: 600, whiteSpace: "nowrap"
        }}>{t("header.logout")}</button>
      </div>
    </div>
  );
}

function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{
      position: "fixed", bottom: 0,
      left: "50%", transform: "translateX(-50%)",
      width: "100%", maxWidth: "var(--app-w)",
      background: T.card, borderTop: `1px solid ${T.border}`,
      display: "flex",
      paddingBottom: "calc(10px + var(--safe-bottom))",
      paddingLeft: "var(--safe-left)",
      paddingRight: "var(--safe-right)",
      paddingTop: 6,
      boxShadow: "0 -4px 24px rgba(6,3,141,0.09)", zIndex: 100
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
function UserApp({ parts, reloadParts, loadError, onLogout, userEmail }) {
  const [tab, setTab] = useState("scan");
  const [history, setHistory] = useState([]);
  const [range, setRange] = useState(defaultHistoryRange);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const [feedbackStats, setFeedbackStats] = useState({ byPart: {}, confusions: [] });
  const { t, lang } = useT();

  // I feedback aggregati di tutti i tecnici, caricati una volta e aggiornati
  // dopo ogni nuova valutazione.
  useEffect(() => {
    let alive = true;
    cloud.loadFeedbackStats()
      .then(s => { if (alive) setFeedbackStats(s); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  async function handleFeedback(payload) {
    await cloud.addFeedback(payload);
    const fresh = await cloud.loadFeedbackStats().catch(() => null);
    if (fresh) setFeedbackStats(fresh);
  }

  // Ricarica dal database ogni volta che cambia l'intervallo selezionato.
  useEffect(() => {
    let alive = true;
    setHistoryLoading(true);
    setHistoryError(false);
    cloud.loadHistory({ from: range.from, to: range.to })
      .then(h => { if (alive) setHistory(h); })
      .catch(() => { if (alive) setHistoryError(true); })
      .finally(() => { if (alive) setHistoryLoading(false); });
    return () => { alive = false; };
  }, [range.from, range.to]);

  async function addToHistory(item) {
    setHistory(prev => [item, ...prev]);
    const thumb = item.image ? await makeThumb(item.image) : "";
    await cloud.addHistory({ ...item, image: thumb });
  }

  function applyRange(fromInput, toInput) {
    setRange({
      preset: "custom",
      from: startOfDayIso(fromInput),
      to: endOfDayIso(toInput),
      fromInput,
      toInput,
    });
  }
  function resetRange() { setRange(defaultHistoryRange()); }

  async function clearHistory() {
    await cloud.clearHistory();
    setHistory([]);
  }

  return (
    <div className="app-shell">
      <Header title="WERFEN SCAN" subtitle={userEmail || t("app.subtitle")} onLogout={onLogout} showLang />
      <div className="app-content">
        {tab === "scan"    && <ScanScreen parts={parts} onAddHistory={addToHistory} reloadParts={reloadParts} loadError={loadError} feedbackStats={feedbackStats} onFeedback={handleFeedback} />}
        {tab === "catalog" && <CatalogScreen parts={parts} />}
        {tab === "history" && (
          <HistoryScreen
            history={history}
            range={range}
            loading={historyLoading}
            error={historyError}
            onApply={applyRange}
            onReset={resetRange}
            onClear={clearHistory}
          />
        )}
      </div>
      <TabBar
        tabs={[
          { id: "scan",    label: t("tab.scan"),    icon: "📷" },
          { id: "catalog", label: t("tab.catalog"), icon: "📚" },
          { id: "history", label: t("tab.history"), icon: "🕐" },
        ]}
        active={tab}
        onChange={setTab}
      />
      <Tagline raised />
    </div>
  );
}

// ===================== SCAN SCREEN =====================
function ScanScreen({ parts, onAddHistory, reloadParts, loadError, feedbackStats, onFeedback }) {
  const { t, lang } = useT();
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
      setError(t("scan.imgError"));
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
      setError(t("scan.dbEmpty"));
      return;
    }

    setAnalyzing(true);
    setError("");

    try {
      // La sessione Supabase autorizza la chiamata al proxy.
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error(t("scan.sessionExpired"));

      const [meta, base64] = image.split(",");
      const mediaType = meta.split(";")[0].split(":")[1];

      // Ai dati di ogni ricambio affianchiamo il bilancio dei feedback
      // ricevuti: è così che le segnalazioni dei tecnici influenzano le
      // scansioni successive.
      const byPart = feedbackStats?.byPart || {};
      const partsCtx = parts.map(p => {
        const s = byPart[p.id];
        return {
          id: p.id, code: p.code, name: p.name,
          description: p.description,
          category: p.category || "",
          compatibility: p.compatibility || [],
          ...(s ? { confirmed_by_technicians: s.ok, reported_wrong: s.ko } : {}),
        };
      });

      // Coppie di confusione ricorrenti, tradotte in codici leggibili
      const labelOf = (id) => {
        const p = parts.find(x => x.id === id);
        return p ? `${p.code} (${p.name})` : id;
      };
      const confusions = (feedbackStats?.confusions || []).map(c => ({
        wrongly_identified_as: labelOf(c.predicted),
        actually_was: labelOf(c.actual),
        times: c.count,
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
          confusions,
          lang,     // il server chiede all'AI di rispondere in questa lingua
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
      setError(t("scan.failed", { msg: e.message || t("scan.checkConnection") }));
    } finally {
      setAnalyzing(false);
    }
  }

  function reset() { setImage(null); setResult(null); setError(""); }

  if (result) return (
    <ResultCard result={result} parts={parts} onReset={reset} onFeedback={onFeedback} />
  );

  return (
    <div style={{ padding: 16 }}>
      {loadError && (
        <div style={{
          background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 14,
          padding: "12px 14px", marginBottom: 12, color: T.error, fontSize: 13, lineHeight: 1.5
        }}>
          ⚠️ {t("error.dbUnreachable")}
          <button onClick={reloadParts} style={{
            marginTop: 8, width: "100%", padding: 9, borderRadius: 10,
            background: T.card, color: T.error, fontSize: 13, fontWeight: 700,
            border: "1px solid #FECACA"
          }}>{t("common.retry")}</button>
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
            <p style={{ color: T.textMid, fontWeight: 600, fontSize: 14 }}>{t("scan.processing")}</p>
          </div>
        ) : image ? (
          <>
            <img src={image} alt="part" style={{ width: "100%", maxHeight: 320, objectFit: "cover", display: "block" }} />
            {analyzing && (
              <div style={{
                position: "absolute", inset: 0, background: "rgba(6,3,141,0.65)",
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 12
              }}>
                <Spinner size={40} color="white" />
                <p style={{ color: "white", fontWeight: 600, fontSize: 15 }}>{t("scan.analyzing")}</p>
                <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>{t("scan.comparing")}</p>
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: "center", padding: 32 }}>
            <div style={{
              width: 80, height: 80, borderRadius: 20, margin: "0 auto 16px",
              background: T.bluePale, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36
            }}>📷</div>
            <p style={{ color: T.blue, fontWeight: 700, fontSize: 17 }}>{t("scan.takePhoto")}</p>
            <p style={{ color: T.textLight, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              {t("scan.photoHint")}
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
            <p style={{ color: T.orange, fontSize: 13, fontWeight: 700 }}>{t("scan.howToTitle")}</p>
            <p style={{ color: T.textMid, fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
              {t("scan.howToBody")}
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
          }}>{t("scan.remove")}</button>
          <button onClick={analyze} className="tap-sc" style={{
            flex: 2, padding: 14, borderRadius: 14,
            background: T.blue,
            color: "white", fontSize: 15, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8
          }}>
            <span>🔍</span> {t("scan.identify")}
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
            background: T.orange,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18
          }}>📦</div>
          <div>
            <p style={{ color: T.text, fontWeight: 700, fontSize: 15 }}>{t("scan.partsCount", { n: parts.length })}</p>
            <p style={{ color: T.textLight, fontSize: 12 }}>{t("scan.ready")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ===================== CATALOG =====================
function CatalogScreen({ parts }) {
  const { t } = useT();
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
        {t("cat.title")}
      </h2>
      <div style={{ position: "relative", marginBottom: 16 }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: T.textLight }}>🔍</span>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder={t("cat.search")}
          style={{
            width: "100%", padding: "13px 16px 13px 42px", borderRadius: 14,
            border: `1.5px solid ${T.border}`, background: T.card, fontSize: 15, color: T.text
          }}
        />
      </div>
      {parts.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 24px" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📦</div>
          <p style={{ color: T.text, fontWeight: 700, fontSize: 16 }}>{t("cat.empty")}</p>
          <p style={{ color: T.textLight, fontSize: 14, marginTop: 6 }}>{t("cat.emptyHint")}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🔍</div>
          <p style={{ color: T.text, fontWeight: 700 }}>{t("cat.noResults", { q: search })}</p>
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
  const { t } = useT();
  const [images, setImages] = useState(part.imageBase64 ? [part.imageBase64] : []);

  // La galleria si scarica solo qui, non nella lista del catalogo
  useEffect(() => {
    let alive = true;
    cloud.loadPartImages(part.id)
      .then(imgs => { if (alive && imgs.length) setImages(imgs); })
      .catch(() => {});
    return () => { alive = false; };
  }, [part.id]);

  return (
    <div className="fade-up" style={{ padding: 16 }}>
      <button onClick={onBack} className="tap-sc" style={{
        background: T.card, border: `1px solid ${T.border}`,
        color: T.blue, borderRadius: 12, padding: "8px 14px",
        fontSize: 14, fontWeight: 600, marginBottom: 14
      }}>{t("common.back")}</button>
      <div style={{ background: T.card, borderRadius: 20, overflow: "hidden", boxShadow: T.shadowLg, border: `1px solid ${T.border}` }}>
        <div style={{ padding: 20 }}>
          {images.length > 0 ? (
            <Gallery images={images} height={220} />
          ) : (
            <div style={{ height: 160, marginBottom: 16, borderRadius: 14, background: T.bluePale, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 60 }}>🔩</div>
          )}
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
              <p style={{ fontSize: 11, color: T.textLight, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>{t("result.compat")}</p>
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
function ResultCard({ result, parts = [], onReset, onFeedback }) {
  const { t } = useT();
  const { matched, part, confidence, reasoning } = result;
  const pct = Math.max(0, Math.min(100, Number(confidence) || 0));

  // Galleria del pezzo riconosciuto: è qui che serve di più, perché il
  // tecnico confronta la foto appena scattata con le angolazioni di riferimento.
  const [gallery, setGallery] = useState(part?.imageBase64 ? [part.imageBase64] : []);
  useEffect(() => {
    if (!part?.id) return;
    let alive = true;
    cloud.loadPartImages(part.id)
      .then(imgs => { if (alive && imgs.length) setGallery(imgs); })
      .catch(() => {});
    return () => { alive = false; };
  }, [part?.id]);

  // idle = in attesa di giudizio · wrong = sta indicando il pezzo giusto · done
  const [phase, setPhase]   = useState("idle");
  const [saving, setSaving] = useState(false);
  const [fbError, setFbError] = useState("");
  const [search, setSearch] = useState("");

  const similar = findSimilarParts(parts, part, 5);
  const sq = search.trim().toLowerCase();
  const searchResults = sq
    ? parts.filter(p =>
        (p.name || "").toLowerCase().includes(sq) ||
        (p.code || "").toLowerCase().includes(sq)
      ).slice(0, 6)
    : [];

  async function send(isCorrect, correctPartId) {
    setSaving(true); setFbError("");
    try {
      await onFeedback({
        isCorrect,
        predictedPartId: part?.id || null,
        correctPartId: correctPartId || null,
        confidence: pct,
      });
      setPhase("done");
    } catch (e) {
      console.error("feedback:", e);
      setFbError(t("fb.failed", { msg: e.message || "" }));
    } finally {
      setSaving(false);
    }
  }

  const pickStyle = {
    width: "100%", textAlign: "left", marginBottom: 6,
    background: T.card, border: `1px solid ${T.border}`, borderRadius: 12,
    padding: "10px 12px", display: "flex", alignItems: "center", gap: 10,
  };

  const PickButton = ({ p }) => (
    <button key={p.id} onClick={() => send(false, p.id)} disabled={saving} style={pickStyle}>
      {p.imageBase64
        ? <img src={p.imageBase64} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
        : <div style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0, background: T.bluePale, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>🔩</div>}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="wrap-anywhere" style={{ display: "block", fontFamily: "monospace", color: T.blue, fontSize: 11, fontWeight: 600 }}>{p.code}</span>
        <span style={{ display: "block", color: T.text, fontSize: 13.5, fontWeight: 600 }}>{p.name}</span>
      </span>
    </button>
  );
  return (
    <div className="fade-up" style={{ padding: 16 }}>
      <div style={{ background: T.card, borderRadius: 20, overflow: "hidden", boxShadow: T.shadowLg, border: `1px solid ${T.border}` }}>
        <div style={{
          background: matched ? T.blue : "#4B5563",
          padding: 20, display: "flex", alignItems: "center", justifyContent: "space-between"
        }}>
          <div>
            <div style={{ color: "white", fontWeight: 700, fontSize: 17 }}>
              {matched ? t("result.identified") : t("result.noMatch")}
            </div>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 3 }}>
              {t("result.confidence", { n: pct })}
            </div>
          </div>
          <div style={{
            background: matched ? T.orange : "rgba(255,255,255,0.15)",
            borderRadius: 14, padding: "8px 14px", color: "white", fontSize: 18, fontWeight: 800
          }}>{pct}%</div>
        </div>
        <div style={{ height: 4, background: T.border }}>
          <div style={{ height: "100%", width: `${pct}%`, background: T.orange, transition: "width 0.8s ease" }} />
        </div>
        <div style={{ padding: 20 }}>
          {matched && part ? (
            <>
              <Gallery images={gallery} height={190} />
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
                  <p style={{ fontSize: 11, color: T.textLight, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>{t("result.compat")}</p>
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
                {t("result.noMatchBody")}
              </p>
            </div>
          )}
          {reasoning && (
            <div style={{ background: T.orangePale, border: `1px solid ${T.orange}33`, borderRadius: 12, padding: "12px 14px", marginBottom: 20 }}>
              <p style={{ color: "#92400E", fontSize: 13, lineHeight: 1.5 }}>
                <strong>{t("result.aiAnalysis")}</strong>{reasoning}
              </p>
            </div>
          )}
          {/* ── Feedback ──────────────────────────────────────────── */}
          <div style={{
            background: T.bg, border: `1px solid ${T.border}`,
            borderRadius: 14, padding: 14, marginBottom: 16
          }}>
            {phase === "done" ? (
              <p style={{ color: T.success, fontSize: 14, fontWeight: 700, textAlign: "center" }}>
                {t("fb.thanks")}
              </p>
            ) : phase === "idle" ? (
              <>
                <p style={{ color: T.text, fontSize: 14, fontWeight: 700, marginBottom: 3 }}>
                  {t("fb.question")}
                </p>
                <p style={{ color: T.textLight, fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
                  {t("fb.hint")}
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => send(true, part?.id || null)} disabled={saving}
                    className="tap-sc" style={{
                      flex: 1, padding: 12, borderRadius: 12, background: T.success,
                      color: "white", fontSize: 14, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6
                    }}>
                    {saving ? <Spinner size={15} color="white" /> : "👍"} {t("fb.correct")}
                  </button>
                  <button onClick={() => { setPhase("wrong"); setFbError(""); }} disabled={saving}
                    style={{
                      flex: 1, padding: 12, borderRadius: 12, background: T.card,
                      color: T.error, fontSize: 14, fontWeight: 700,
                      border: `1.5px solid ${T.error}55`
                    }}>{t("fb.wrong")}</button>
                </div>
              </>
            ) : (
              <>
                <p style={{ color: T.text, fontSize: 14, fontWeight: 700, marginBottom: 3 }}>
                  {t("fb.whichWas")}
                </p>
                <p style={{ color: T.textLight, fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>
                  {similar.length > 0 ? t("fb.similar") : t("fb.searchCatalog")}
                </p>

                {similar.map(p => <PickButton key={p.id} p={p} />)}

                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder={t("fb.searchOther")}
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: 12, marginTop: 4,
                    marginBottom: searchResults.length ? 8 : 0,
                    border: `1.5px solid ${T.border}`, background: T.card,
                    fontSize: 14, color: T.text
                  }}
                />
                {searchResults.map(p => <PickButton key={`s-${p.id}`} p={p} />)}

                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button onClick={() => setPhase("idle")} disabled={saving} style={{
                    flex: 1, padding: 11, borderRadius: 12, background: T.card,
                    color: T.textMid, fontSize: 13.5, fontWeight: 600,
                    border: `1px solid ${T.border}`
                  }}>{t("common.back")}</button>
                  <button onClick={() => send(false, null)} disabled={saving} style={{
                    flex: 1, padding: 11, borderRadius: 12, background: T.card,
                    color: T.textMid, fontSize: 13.5, fontWeight: 600,
                    border: `1px solid ${T.border}`
                  }}>{t("fb.none")}</button>
                </div>
              </>
            )}
            {fbError && (
              <p style={{ color: T.error, fontSize: 12.5, marginTop: 10, lineHeight: 1.5 }}>⚠️ {fbError}</p>
            )}
          </div>

          <button onClick={onReset} className="tap-sc" style={{
            width: "100%", padding: 15, borderRadius: 14,
            background: T.orange,
            color: "white", fontSize: 16, fontWeight: 700
          }}>{t("result.newScan")}</button>
        </div>
      </div>
    </div>
  );
}

// ===================== HISTORY =====================
function HistoryScreen({ history, range, loading, error, onApply, onReset, onClear }) {
  const { t, lang } = useT();
  const [open, setOpen]                 = useState(false);
  const [fromInput, setFromInput]       = useState(range.fromInput);
  const [toInput, setToInput]           = useState(range.toInput);
  const [text, setText]                 = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing]         = useState(false);
  const [clearError, setClearError]     = useState("");

  // Riallinea i campi quando l'intervallo cambia da fuori (es. "Ultimi 7 giorni")
  useEffect(() => {
    setFromInput(range.fromInput);
    setToInput(range.toInput);
  }, [range.fromInput, range.toInput]);

  // Il filtro testuale lavora sui risultati già scaricati per l'intervallo:
  // le date filtrano sul database, il testo affina in locale.
  const q = text.trim().toLowerCase();
  const shown = q
    ? history.filter(h =>
        (h.part?.name || "").toLowerCase().includes(q) ||
        (h.part?.code || "").toLowerCase().includes(q))
    : history;

  const periodLabel = range.preset === "7d"
    ? t("hist.last", { n: HISTORY_DEFAULT_DAYS })
    : t("hist.range", { a: fmtDay(range.fromInput), b: fmtDay(range.toInput) });

  const dateStyle = {
    width: "100%", padding: "11px 12px", borderRadius: 12,
    border: `1.5px solid ${T.border}`, background: T.bg, fontSize: 15, color: T.text,
  };
  const smallLabel = { display: "block", fontSize: 12, fontWeight: 600, color: T.textMid, marginBottom: 5 };

  async function doClear() {
    setClearing(true); setClearError("");
    try {
      await onClear();
      setConfirmClear(false);
      setOpen(false);
    } catch (e) {
      console.error("clearHistory:", e);
      setClearError(t("hist.clearFailed", { msg: e.message || "" }));
      setConfirmClear(false);
    } finally {
      setClearing(false);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      {confirmClear && (
        <ConfirmDialog
          message={t("hist.confirmClear")}
          onConfirm={doClear}
          onCancel={() => setConfirmClear(false)}
        />
      )}

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: T.text, letterSpacing: "-0.4px" }}>
            {t("hist.title")}
            <span style={{ marginLeft: 8, background: T.bluePale, color: T.blue, fontSize: 13, borderRadius: 8, padding: "2px 8px", fontWeight: 700, verticalAlign: "middle" }}>{shown.length}</span>
          </h2>
          <p style={{ color: T.textLight, fontSize: 12, marginTop: 3 }}>{periodLabel}</p>
        </div>
        <button onClick={() => setOpen(o => !o)} className="tap-sc" aria-label="Filtri cronologia"
          style={{
            width: 42, height: 42, borderRadius: 12, flexShrink: 0, fontSize: 17,
            background: open ? T.blue : T.card,
            color: open ? "white" : T.blue,
            border: `1.5px solid ${open ? T.blue : T.border}`,
          }}>🔎</button>
      </div>

      {open && (
        <div className="fade-in" style={{
          background: T.card, border: `1px solid ${T.border}`, borderRadius: 16,
          padding: 14, marginBottom: 14, boxShadow: T.shadow
        }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={smallLabel}>{t("hist.from")}</label>
              <input type="date" value={fromInput} max={toInput}
                onChange={e => setFromInput(e.target.value)} style={dateStyle} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={smallLabel}>{t("hist.to")}</label>
              <input type="date" value={toInput} min={fromInput}
                onChange={e => setToInput(e.target.value)} style={dateStyle} />
            </div>
          </div>

          <label style={smallLabel}>{t("hist.part")}</label>
          <input value={text} onChange={e => setText(e.target.value)}
            placeholder={t("hist.filterPart")}
            style={{ ...dateStyle, marginBottom: 12 }} />

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onReset} style={{
              flex: 1, padding: 12, borderRadius: 12,
              background: T.bg, color: T.textMid, fontSize: 14, fontWeight: 600,
              border: `1px solid ${T.border}`
            }}>{t("hist.last", { n: HISTORY_DEFAULT_DAYS })}</button>
            <button onClick={() => onApply(fromInput, toInput)} className="tap-sc" style={{
              flex: 1, padding: 12, borderRadius: 12,
              background: T.blue, color: "white", fontSize: 14, fontWeight: 700
            }}>{t("hist.apply")}</button>
          </div>

          <button onClick={() => setConfirmClear(true)} disabled={clearing} style={{
            width: "100%", marginTop: 14, padding: 11, borderRadius: 12,
            background: "#FEF2F2", color: T.error, fontSize: 13.5, fontWeight: 700,
            border: "1px solid #FECACA",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8
          }}>
            {clearing ? <><Spinner size={15} color={T.error} /> {t("hist.clearing")}</> : t("hist.clear")}
          </button>
        </div>
      )}

      {(error || clearError) && (
        <div style={{
          background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 14,
          padding: "12px 14px", marginBottom: 12, color: T.error, fontSize: 13, lineHeight: 1.5
        }}>⚠️ {clearError || t("hist.loadFailed")}</div>
      )}

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "48px 0" }}>
          <Spinner size={30} />
          <p style={{ color: T.textMid, fontSize: 14, fontWeight: 600 }}>{t("hist.loading")}</p>
        </div>
      ) : shown.length === 0 ? (
        <div style={{ textAlign: "center", padding: "56px 24px" }}>
          <div style={{ fontSize: 52, marginBottom: 14 }}>🕐</div>
          <p style={{ color: T.text, fontWeight: 700, fontSize: 17 }}>
            {q ? t("hist.noResults") : t("hist.noneInPeriod")}
          </p>
          <p style={{ color: T.textLight, fontSize: 14, marginTop: 6, lineHeight: 1.5 }}>
            {q
              ? t("hist.noMatchText", { q: text })
              : range.preset === "7d"
                ? t("hist.hintFilter")
                : t("hist.hintWiden")}
          </p>
        </div>
      ) : (
        shown.map((item, i) => (
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
              <div style={{ fontWeight: 600, color: T.textMid, fontSize: 14 }}>{t("hist.noMatchLabel")}</div>
            )}
            <div style={{ color: T.textLight, fontSize: 11, marginTop: 4 }}>
              {new Date(item.timestamp).toLocaleString(lang === "en" ? "en-GB" : "it-IT")}
            </div>
          </div>
          <div style={{
            background: item.matched ? T.bluePale : "#F1F5F9",
            color: item.matched ? T.blue : T.textMid,
            borderRadius: 10, padding: "5px 10px", fontSize: 13, fontWeight: 700, flexShrink: 0
          }}>{item.confidence}%</div>
        </div>
        ))
      )}
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
    <div className="app-shell">
      <Header title="WERFEN SCAN Admin" subtitle="Area amministratore" onLogout={onLogout} />
      <div className="app-content">
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
        background: T.blue,
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
          background: T.orange,
          color: "white", fontSize: 15, fontWeight: 700
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
              background: T.orange,
              color: "white", fontSize: 15, fontWeight: 700
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
    ? { ...editingPart, images: [] }
    : { code: "", name: "", description: "", category: "", compatibility: [], images: [] }
  );
  const [galleryLoading, setGalleryLoading] = useState(!!editingPart);

  // In modifica la galleria non arriva con la lista: va richiesta a parte.
  useEffect(() => {
    if (!editingPart) return;
    let alive = true;
    cloud.loadPartImages(editingPart.id)
      .then(imgs => { if (alive) setForm(f => ({ ...f, images: imgs })); })
      .catch(() => {})
      .finally(() => { if (alive) setGalleryLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [compatInput, setCompatInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [imgLoading, setImgLoading] = useState(false);

  function field(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleImage(e) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    if ((form.images || []).length >= MAX_PART_IMAGES) {
      setErrors(prev => ({ ...prev, image: `Massimo ${MAX_PART_IMAGES} foto per ricambio.` }));
      try { input.value = ""; } catch { /* ignore */ }
      return;
    }
    setImgLoading(true);
    setErrors(prev => ({ ...prev, image: "" }));
    try {
      const compressed = await compressImage(file, 800, 0.78);
      setForm(f => ({ ...f, images: [...(f.images || []), compressed] }));
    } catch (err) {
      console.error("compressImage:", err);
      setErrors(prev => ({ ...prev, image: "Impossibile caricare l'immagine. Riprova." }));
    } finally {
      try { input.value = ""; } catch { /* ignore */ }
      setImgLoading(false);
    }
  }

  function removeImage(i) {
    setForm(f => ({ ...f, images: (f.images || []).filter((_, n) => n !== i) }));
  }

  // Promuove una foto a copertina spostandola in testa all'array
  function makeCover(i) {
    setForm(f => {
      const imgs = [...(f.images || [])];
      const [pick] = imgs.splice(i, 1);
      return { ...f, images: [pick, ...imgs] };
    });
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
    // La copertina è una miniatura della prima foto: è l'unica immagine che
    // viaggia con la lista dei ricambi, quindi va tenuta leggera.
    cleaned.coverBase64 = form.images?.[0]
      ? await makeThumb(form.images[0], 400, 0.75)
      : "";
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

      <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.textMid, marginBottom: 4 }}>
        Foto del ricambio ({(form.images || []).length}/{MAX_PART_IMAGES})
      </label>
      <p style={{ color: T.textLight, fontSize: 11, marginBottom: 10, lineHeight: 1.5 }}>
        Più angolazioni aiutano il tecnico a confrontare i dettagli. La prima foto è la
        copertina: è quella che compare nelle liste e nei risultati.
      </p>

      {galleryLoading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 0", marginBottom: 10 }}>
          <Spinner size={22} />
          <span style={{ color: T.textMid, fontSize: 13 }}>Caricamento foto...</span>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 10 }}>
          {(form.images || []).map((src, i) => (
            <div key={i} style={{
              position: "relative", borderRadius: 12, overflow: "hidden",
              border: `1.5px solid ${i === 0 ? T.blue : T.border}`,
              aspectRatio: "1 / 1", background: T.bg
            }}>
              <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              {i === 0 && (
                <span style={{
                  position: "absolute", left: 4, top: 4, background: T.blue, color: "white",
                  fontSize: 9, fontWeight: 700, borderRadius: 5, padding: "2px 5px", letterSpacing: 0.3
                }}>COPERTINA</span>
              )}
              <button onClick={() => removeImage(i)} aria-label="Rimuovi foto" style={{
                position: "absolute", right: 4, top: 4, width: 22, height: 22, borderRadius: 11,
                background: "rgba(0,0,0,0.6)", color: "white", fontSize: 14, fontWeight: 700,
                lineHeight: 1, padding: 0
              }}>×</button>
              {i !== 0 && (
                <button onClick={() => makeCover(i)} style={{
                  position: "absolute", left: 0, right: 0, bottom: 0, padding: "4px 0",
                  background: "rgba(0,0,0,0.55)", color: "white", fontSize: 10, fontWeight: 700
                }}>★ Copertina</button>
              )}
            </div>
          ))}

          {(form.images || []).length < MAX_PART_IMAGES && (
            <PhotoPicker
              id="admin-photo-input"
              disabled={imgLoading}
              onFile={handleImage}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: 4, aspectRatio: "1 / 1", borderRadius: 12,
                border: `2px dashed ${T.border}`, background: T.card,
                cursor: imgLoading ? "default" : "pointer"
              }}
            >
              {imgLoading ? <Spinner size={22} /> : (
                <>
                  <span style={{ fontSize: 22 }}>📷</span>
                  <span style={{ color: T.blue, fontSize: 11, fontWeight: 700 }}>Aggiungi</span>
                </>
              )}
            </PhotoPicker>
          )}
        </div>
      )}

      {errors.image && <p style={{ color: T.error, fontSize: 12, marginBottom: 10 }}>⚠️ {errors.image}</p>}

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
            background: T.blue,
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
          background: saving ? T.textLight : T.orange,
          color: "white", fontSize: 15, fontWeight: 700,
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
        background: T.blue,
        borderRadius: 20, padding: "24px 20px", marginBottom: 16,
        display: "flex", alignItems: "center", gap: 20
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16,
          background: T.orange,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28
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
          background: T.blue,
          color: "white", fontSize: 15, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8
        }}>
          {saving ? <><Spinner size={18} color="white" /> Aggiornamento...</> : "🔐 Aggiorna password"}
        </button>
      </div>

      <div style={{ background: T.card, borderRadius: 16, padding: 16, border: `1px solid ${T.border}`, textAlign: "center" }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🔧</div>
        <div style={{ color: T.text, fontWeight: 700, fontSize: 15 }}>WERFEN SCAN v3.1</div>
        <div style={{ color: T.textLight, fontSize: 13, marginTop: 4 }}>
          Industrial Spare Parts Recognition<br />
          Powered by Claude AI (Anthropic)
        </div>
        <div style={{
          marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}`,
          color: T.textLight, fontSize: 12
        }}>
          Modalità: <strong style={{ color: T.textMid }}>
            {IS_STANDALONE ? "📱 avviata dalla Home" : "🌐 scheda del browser"}
          </strong>
        </div>
      </div>
    </div>
  );
}

// ===================== SETUP / LOADING =====================
function SetupScreen() {
  return (
    <div className="screen-full" style={{
      background: T.blue,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center"
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
            background: "rgba(232,119,34,0.15)", border: `1px solid ${T.orange}`,
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
              background: T.orange,
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

function LoadingScreen({ labelKey = "loading.app" }) {
  const { t } = useT();
  return (
    <div className="screen-full" style={{
      background: T.blue,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 20
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: 20,
        background: T.orange,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 34,
        animation: "pulse 1.2s ease infinite"
      }}>🔧</div>
      <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 16, fontWeight: 600 }}>{t(labelKey)}</p>
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
  const [expiredNotice, setExpiredNotice] = useState(false);
  const [lang, setLangState] = useState(readCachedLang);

  // Appena la sessione è nota, adotta la lingua salvata sull'account:
  // la preferenza segue la persona, non il dispositivo.
  useEffect(() => {
    if (!session) return;
    const saved = session.user?.user_metadata?.language;
    if (saved && LANGS.includes(saved)) {
      // L'account ha già una preferenza: comanda quella.
      setLangState(saved);
      try { localStorage.setItem(LANG_KEY, saved); } catch { /* ignore */ }
    } else {
      // Primo accesso: adotta la lingua scelta sulla schermata di login,
      // così non cambia sotto gli occhi dell'utente subito dopo l'accesso.
      supabase.auth.updateUser({ data: { language: lang } })
        .catch(e => console.error("setLang:", e?.message));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  async function setLang(next) {
    if (!LANGS.includes(next)) return;
    setLangState(next);
    try { localStorage.setItem(LANG_KEY, next); } catch { /* ignore */ }
    if (session) {
      const { error } = await supabase.auth.updateUser({ data: { language: next } });
      if (error) console.error("setLang:", error.message);
    }
  }

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
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_IN")  { rememberLoginTime(); setExpiredNotice(false); }
      if (event === "SIGNED_OUT") { forgetLoginTime(); }
      setSession(s ?? null);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  // Scadenza della sessione dopo SESSION_MAX_HOURS.
  // Controlla all'avvio, ogni minuto, e ogni volta che l'app torna in primo
  // piano — il caso tipico è il telefono riaperto il giorno dopo, dove
  // nessun timer sarebbe rimasto in esecuzione.
  useEffect(() => {
    if (!session) return;
    let done = false;

    const check = async () => {
      if (done || !sessionExpired(session)) return;
      done = true;
      setExpiredNotice(true);
      forgetLoginTime();
      await supabase.auth.signOut();
    };

    check();
    const id = setInterval(check, 60_000);
    const onWake = () => { if (!document.hidden) check(); };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      done = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [session]);

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
  else if (!session)      screen = <LoginScreen expired={expiredNotice} />;
  else if (partsLoading)  screen = <LoadingScreen labelKey="loading.parts" />;
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
      userEmail={email}
    />
  );

  return (
    <LangContext.Provider value={{ lang, setLang, t: (k, v) => translate(lang, k, v) }}>
      <GlobalStyles />
      {screen}
    </LangContext.Provider>
  );
}
