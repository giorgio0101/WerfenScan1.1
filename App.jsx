import { useState, useEffect, useRef, createContext, useContext } from "react";
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

// ── Scadenza della sessione ──────────────────────────────────
// Due limiti indipendenti: chiude la sessione il primo che scatta.
//   • SESSION_MAX_HOURS — tempo massimo dal login, anche usando l'app
//   • IDLE_MAX_HOURS    — nessuna interazione per N ore
// Per cambiare le durate basta il numero. EXPIRE_ADMIN_TOO estende le
// regole anche all'amministratore: oggi è escluso per non ritrovarsi
// buttato fuori mentre lavora al catalogo.
//
// ⚠️ Questi tre valori sono replicati nelle funzioni SQL session_state()
//    e nella sezione 4b di SETUP.md. Se cambi qui, cambia anche là:
//    il database applica le SUE regole, non queste.
const SESSION_MAX_HOURS = 24;
const IDLE_MAX_HOURS    = 12;
const EXPIRE_ADMIN_TOO  = false;

const LOGIN_AT_KEY  = "werfen_login_at";
const LAST_SEEN_KEY = "werfen_last_seen";

// Ogni quanto, al massimo, l'attività viene riscritta su localStorage:
// senza freno un semplice scroll scriverebbe centinaia di volte al minuto.
const TOUCH_THROTTLE_MS = 60_000;

const HOUR_MS = 3600 * 1000;

function readStamp(key) {
  try {
    const n = Number(localStorage.getItem(key));
    return n > 0 ? n : null;
  } catch { return null; }
}
function writeStamp(key, ts) {
  try { localStorage.setItem(key, String(ts)); } catch { /* ignore */ }
}

function rememberLoginTime() {
  const now = Date.now();
  writeStamp(LOGIN_AT_KEY, now);
  writeStamp(LAST_SEEN_KEY, now);
}
function forgetLoginTime() {
  try {
    localStorage.removeItem(LOGIN_AT_KEY);
    localStorage.removeItem(LAST_SEEN_KEY);
  } catch { /* ignore */ }
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

const expiryExempt = (session) =>
  !EXPIRE_ADMIN_TOO && isAdminEmail(session?.user?.email);

// Motivo della scadenza — "age" | "idle" | null — così la schermata di
// login può spiegare *perché* la sessione è stata chiusa.
function expiryReason(session) {
  if (!session || expiryExempt(session)) return null;
  const now = Date.now();

  const start = sessionStartedAt(session);
  if (start && now - start > SESSION_MAX_HOURS * HOUR_MS) return "age";

  const seen = readStamp(LAST_SEEN_KEY);
  // Nessun timestamp di attività: sessione aperta prima di questo
  // aggiornamento, o localStorage ripulito. Si riparte da adesso — non si
  // butta fuori nessuno per un dato che non è mai stato scritto.
  if (!seen) { writeStamp(LAST_SEEN_KEY, now); return null; }
  if (now - seen > IDLE_MAX_HOURS * HOUR_MS) return "idle";

  return null;
}

// Segna un'interazione dell'utente. Verifica da sé anche l'inattività: se
// il tempo era già scaduto NON aggiorna il timestamp, altrimenti il primo
// tocco al risveglio cancellerebbe la prova dell'inattività prima che il
// controllo periodico se ne accorga. true = la sessione va chiusa.
function touchActivity(session) {
  if (!session || expiryExempt(session)) return false;
  const now  = Date.now();
  const seen = readStamp(LAST_SEEN_KEY);
  if (seen && now - seen > IDLE_MAX_HOURS * HOUR_MS) return true;
  if (!seen || now - seen > TOUCH_THROTTLE_MS) writeStamp(LAST_SEEN_KEY, now);
  return false;
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
    "error.sessionUnverified": "Il catalogo risulta vuoto, ma la verifica della sessione non ha risposto: probabilmente è un problema di permessi, non un database senza ricambi. Avvisa l'amministratore.",

    "login.title": "Accedi",
    "login.email": "Email",
    "login.password": "Password",
    "login.fillBoth": "Inserisci email e password",
    "login.badCredentials": "Email o password non corretti",
    "login.submit": "Accedi →",
    "login.loading": "Accesso in corso...",
    "login.note": "L'accesso resta memorizzato su questo dispositivo. Le credenziali le fornisce l'amministratore.",
    "login.forgot": "Password dimenticata?",
    "login.forgotTitle": "Recupero password",
    "login.forgotBody": "Inserisci la tua email: ricevi un link per impostare una nuova password. Vale 60 minuti.",
    "login.forgotSend": "Invia il link →",
    "login.forgotSending": "Invio in corso...",
    "login.forgotSent": "✉️ Se quell'indirizzo è registrato, il link è partito. Controlla la posta, anche nello spam.",
    "login.forgotBack": "← Torna all'accesso",
    "login.newPwdTitle": "Nuova password",
    "login.newPwdBody": "Scegli la password che userai d'ora in poi su questo e sugli altri dispositivi.",
    "login.newPwd": "Nuova password",
    "login.newPwdConfirm": "Ripeti la password",
    "login.newPwdShort": "La password deve avere almeno 8 caratteri",
    "login.newPwdMismatch": "Le due password non coincidono",
    "login.newPwdSave": "🔐 Imposta password",
    "login.newPwdSaving": "Salvataggio...",
    "login.expired": "Sessione scaduta dopo {h} ore. Accedi di nuovo con le tue credenziali.",
    "login.expiredIdle": "Sessione chiusa dopo {h} ore di inattività. Accedi di nuovo con le tue credenziali.",
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
    "cat.tooMany": "Mostrati i primi {n}. Restringi la ricerca per vedere gli altri.",
    "cat.pickMachine": "Scegli il macchinario su cui stai lavorando. Le foto si caricano solo da qui in poi.",
    "cat.machineParts": "{n} ricambi",
    "cat.root": "Catalogo",
    "cat.folderParts": "{n} ricambi",
    "cat.folderSplit": "{d} qui · {n} in tutto",
    "cat.hasSubfolders": "contiene altre cartelle",
    "cat.emptyFolder": "Cartella vuota",
    "cat.searchIn": "Cerca in {m}...",
    "cat.noMachines": "Nessun macchinario",
    "cat.noMachinesHint": "I ricambi non hanno il campo compatibilità compilato. Chiedi all'amministratore di aggiungerlo, oppure cerca direttamente per codice.",
    "cat.emptyMachine": "Nessun ricambio per questo macchinario",
    "scan.machine": "Macchinario",
    "scan.machineAll": "Tutti i macchinari",
    "scan.machineHint": "Facoltativo. Senza filtro il confronto usa tutto il catalogo; sceglierlo lo restringe a quella macchina — più preciso e molto più economico.",
    "scan.partialTitle": "Confronto parziale",
    "scan.partialBody": "Il catalogo è troppo grande: sono stati confrontati {n} ricambi, non tutti. Scegli il macchinario per un confronto completo.",
    "scan.photosPartialTitle": "Controllo visivo parziale",
    "scan.photosPartialBody": "All'AI sono arrivate {n} foto di riferimento su {tot}: sui ricambi restanti il confronto è avvenuto solo sulla descrizione scritta. Scegli il macchinario per avere anche le loro foto.",
    "cat.search": "Cerca per nome, codice, categoria...",
    "cat.empty": "Database vuoto",
    "cat.emptyHint": "Chiedi all'amministratore di caricare i ricambi",
    "cat.noResults": "Nessun risultato per \"{q}\"",

    "hist.title": "Cronologia",
    "hist.last": "Ultimi {n} giorni",
    "hist.autoDelete": "Le scansioni si cancellano da sole dopo {n} giorni.",
    "hist.part": "Ricambio",
    "hist.filterPart": "Filtra per codice o nome",
    "hist.clear": "🗑️ Svuota tutta la cronologia",
    "hist.clearing": "Eliminazione...",
    "hist.confirmClear": "Svuotare tutta la tua cronologia delle scansioni? L'operazione è irreversibile. Riguarda solo il tuo account: le scansioni degli altri tecnici non vengono toccate.",
    "hist.cleared": "✅ {n} scansioni eliminate.",
    "hist.clearedNone": "Non c'era nulla da eliminare.",
    "hist.loading": "Caricamento cronologia...",
    "hist.noResults": "Nessun risultato",
    "hist.noneInPeriod": "Nessuna scansione negli ultimi {n} giorni",
    "hist.noMatchText": "Nessuna scansione corrisponde a \"{q}\"",
    "hist.hintScan": "Le scansioni che farai compariranno qui",
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
    "error.sessionUnverified": "The catalogue looks empty, but the session check did not respond: this is most likely a permissions problem, not a database without parts. Please tell the administrator.",

    "login.title": "Sign in",
    "login.email": "Email",
    "login.password": "Password",
    "login.fillBoth": "Enter email and password",
    "login.badCredentials": "Incorrect email or password",
    "login.submit": "Sign in →",
    "login.loading": "Signing in...",
    "login.note": "You stay signed in on this device. Credentials are provided by the administrator.",
    "login.forgot": "Forgot your password?",
    "login.forgotTitle": "Password recovery",
    "login.forgotBody": "Enter your email: you'll get a link to set a new password. It's valid for 60 minutes.",
    "login.forgotSend": "Send the link →",
    "login.forgotSending": "Sending...",
    "login.forgotSent": "✉️ If that address is registered, the link is on its way. Check your inbox, and your spam folder.",
    "login.forgotBack": "← Back to sign in",
    "login.newPwdTitle": "New password",
    "login.newPwdBody": "Choose the password you'll use from now on, here and on your other devices.",
    "login.newPwd": "New password",
    "login.newPwdConfirm": "Repeat the password",
    "login.newPwdShort": "The password must be at least 8 characters",
    "login.newPwdMismatch": "The two passwords don't match",
    "login.newPwdSave": "🔐 Set password",
    "login.newPwdSaving": "Saving...",
    "login.expired": "Session expired after {h} hours. Please sign in again with your credentials.",
    "login.expiredIdle": "Signed out after {h} hours of inactivity. Please sign in again with your credentials.",
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
    "cat.tooMany": "Showing the first {n}. Narrow your search to see the others.",
    "cat.pickMachine": "Pick the machine you are working on. Photos only load from here on.",
    "cat.machineParts": "{n} parts",
    "cat.root": "Catalogue",
    "cat.folderParts": "{n} parts",
    "cat.folderSplit": "{d} here · {n} in total",
    "cat.hasSubfolders": "contains more folders",
    "cat.emptyFolder": "Empty folder",
    "cat.searchIn": "Search in {m}...",
    "cat.noMachines": "No machines",
    "cat.noMachinesHint": "Parts have no compatibility field filled in. Ask the administrator to add it, or search by code directly.",
    "cat.emptyMachine": "No parts for this machine",
    "scan.machine": "Machine",
    "scan.machineAll": "All machines",
    "scan.machineHint": "Optional. Without a filter the comparison uses the whole catalogue; picking one narrows it to that machine — more accurate and far cheaper.",
    "scan.partialTitle": "Partial comparison",
    "scan.partialBody": "The catalogue is too large: {n} parts were compared, not all of them. Pick the machine for a complete comparison.",
    "scan.photosPartialTitle": "Partial visual check",
    "scan.photosPartialBody": "The AI received {n} reference photos out of {tot}: for the remaining parts the comparison used the written description only. Pick the machine to include their photos too.",
    "cat.search": "Search by name, code, category...",
    "cat.empty": "Database is empty",
    "cat.emptyHint": "Ask the administrator to add parts",
    "cat.noResults": "No results for \"{q}\"",

    "hist.title": "History",
    "hist.last": "Last {n} days",
    "hist.autoDelete": "Scans are deleted automatically after {n} days.",
    "hist.part": "Part",
    "hist.filterPart": "Filter by code or name",
    "hist.clear": "🗑️ Clear all history",
    "hist.clearing": "Deleting...",
    "hist.confirmClear": "Clear your whole scan history? This cannot be undone. It only affects your account: other technicians' scans are untouched.",
    "hist.cleared": "✅ {n} scans deleted.",
    "hist.clearedNone": "There was nothing to delete.",
    "hist.loading": "Loading history...",
    "hist.noResults": "No results",
    "hist.noneInPeriod": "No scans in the last {n} days",
    "hist.noMatchText": "No scan matches \"{q}\"",
    "hist.hintScan": "The scans you make will show up here",
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
    /* ⚠️ clip, NON hidden — su Android era il motivo per cui la pagina non
       si scorreva col dito, e il guasto è istruttivo.

       "overflow-x: hidden" su un elemento NON taglia e basta: lo trasforma in
       un contenitore di scorrimento, e l'asse verticale passa da "visible" ad
       "auto". Con quella regola su html E su body, il body diventava uno
       scroller alto quanto il suo contenuto — quindi con ZERO pixel da
       scorrere — che intercettava il gesto del dito. Normalmente lo avrebbe
       passato alla pagina sotto, ma "overscroll-behavior-y: contain" serve
       proprio a impedire quel passaggio: il gesto moriva lì e la schermata
       restava immobile. Rotella e scorrimento da codice continuavano a
       funzionare, per questo su desktop non si vedeva, e iOS gestisce la
       propagazione in modo diverso, per questo sull'iPhone non si vedeva.

       "overflow-x: clip" taglia senza creare nessuno scroller. La riga
       "hidden" resta prima come ripiego per i browser che non conoscono clip
       (Chrome < 90, Safari < 16), e su quelli il guasto non torna lo stesso
       perché contain si è spostato su html — vedi sotto. */
    overflow-x: hidden;
    overflow-x: clip;
  }
  /* ⚠️ contain va su HTML, che è l'elemento che scorre davvero, non su body.
     Sul body serviva a togliere il "tira per aggiornare" di Android, ma se
     per qualunque ragione il body torna a essere uno scroller, lì contain
     blocca il dito invece della pagina. Su html fa la stessa cosa senza
     poter bloccare niente. */
  html { overscroll-behavior-y: contain; }
  body { line-height: 1.4; }
  #root { width: 100%; overflow-x: hidden; overflow-x: clip; }

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
  // Registra l'attività sul server e chiede il verdetto:
  //   "ok" | "age" | "idle" | "unavailable"
  // È il database a decidere — l'orologio del telefono e il localStorage sono
  // manipolabili, le sue tabelle no.
  //
  // "unavailable" quando la chiamata non riesce: funzione SQL non installata,
  // permesso mancante, rete caduta. L'app prosegue lo stesso — preferisco un
  // tecnico che lavora a un tecnico bloccato — ma il caso NON viene più
  // confuso con "ok".
  //
  // La distinzione è nata da un guasto vero: proseguire in silenzio, mentre
  // le policy RLS negavano ogni riga, faceva apparire il catalogo vuoto senza
  // che nulla segnalasse il perché. Fallire in modo permissivo va bene;
  // fallire in modo invisibile no.
  async touchSession() {
    if (!supabase) return "ok";
    const { data, error } = await supabase.rpc("touch_session");
    if (error) { console.error("touchSession:", error.message, error.code); return "unavailable"; }
    return data === "idle" || data === "age" ? data : "ok";
  },
  // ── Il catalogo non vive più nel client ───────────────────
  // All'avvio si chiede soltanto QUANTI ricambi esistono: un numero, non un
  // elenco. Tutto il resto arriva su richiesta — la ricerca, il dettaglio,
  // i simili. Con 2000 ricambi il vecchio caricamento iniziale era ~1 MB di
  // testo per ogni apertura dell'app, su ogni telefono.


  // Righe leggere per gli elenchi: niente descrizioni, niente immagini,
  // solo l'URL della miniatura. Con ricerca vuota restituisce i più recenti.
  // L'elenco dei macchinari, ricavato dalle compatibilità dei ricambi. Solo
  // testo: è la schermata che si apre per prima, e non scarica immagini.
  async listMachines() {
    const { data, error } = await supabase.rpc("list_machines");
    if (error) { console.error("listMachines:", error.message, error.code); return []; }
    return (data || []).map(m => ({ machine: m.machine, parts: m.parts }));
  },

  // Quanti ricambi vedrebbe l'AI con questo filtro: serve ad avvisare prima
  // di scansionare, non dopo.
  async countParts(machine) {
    const { data, error } = await supabase.rpc("count_parts", { machine: machine || null });
    if (error) { console.error("countParts:", error.message, error.code); throw error; }
    return data ?? 0;
  },

  // I figli diretti di una cartella: solo nomi e conteggi, nessuna immagine.
  // Il conteggio comprende tutto il sottoalbero, quindi una cartella che
  // dice 8 può mostrarne 2 sfusi più 6 divisi in sottocartelle.
  // includeEmpty distingue i due mestieri: il tecnico non deve vedere
  // cartelle vuote (in officina sono vicoli ciechi), l'amministratore sì —
  // altrimenti una cartella appena creata sparirebbe un istante dopo.
  async listFolders(machine, parentPath, includeEmpty = false) {
    const { data, error } = await supabase.rpc("list_folders", {
      machine: machine || null,
      parent_path: parentPath || null,
      include_empty: !!includeEmpty,
    });
    if (error) { console.error("listFolders:", error.message, error.code); return []; }
    return (data || []).map(f => ({
      folder: f.folder,
      // "direct" è quel che si vedrà aprendo la cartella, "parts" tutto il
      // ramo. Mostrarne uno solo faceva sembrare i numeri sbagliati: la
      // cartella dichiarava 8 e aperta ne mostrava 2.
      parts: f.parts ?? 0,
      direct: f.direct_parts ?? 0,
      hasChildren: !!f.has_children,
    }));
  },

  // Creare e cancellare cartelle tocca solo l'elenco di quelle fatte a mano:
  // i ricambi non si spostano e non si perdono. Cancellare una cartella che
  // contiene ancora qualcosa non la fa sparire — continua a esistere perché
  // c'è un ricambio che la nomina. È una rete di sicurezza voluta.
  // Tutte e tre passano dal database e non scrivono sulla tabella da qui.
  // Il motivo è che ognuna tocca due tabelle, e soprattutto che le funzioni
  // CONTROLLANO di aver fatto qualcosa: senza, un account senza permessi
  // preme il pulsante, le policy filtrano le righe in silenzio e l'app
  // mostra "riuscito" su un'operazione che non è avvenuta.
  async createFolder(path) {
    const { data, error } = await supabase.rpc("create_folder", { new_path: path || "" });
    if (error) { console.error("createFolder:", error.message, error.code); throw error; }
    return data;
  },

  // Spostare ed eliminare sono lo stesso gesto: eliminare vuol dire
  // spostare nella cartella genitore. Restituisce quanti ricambi si sono
  // mossi — nessuno viene mai cancellato.
  //
  // Il lavoro lo fa il database in una transazione sola: farlo da qui
  // significherebbe tre chiamate che possono fallire a metà, lasciando i
  // ricambi in una cartella che non esiste più.
  async renameFolder(fromPath, toPath) {
    const from = normalizeFolder(fromPath);
    if (!from) throw new Error("Percorso di partenza mancante.");
    const { data, error } = await supabase.rpc("rename_folder", {
      from_path: from,
      to_path: normalizeFolder(toPath),
    });
    if (error) { console.error("renameFolder:", error.message, error.code); throw error; }
    return data ?? 0;
  },

  // Spostare un singolo ricambio è solo un cambio di campo: non passa da
  // rename_folder, che riscrive interi rami. Le policy su "parts" fanno da
  // guardia — un tecnico che ci provasse aggiornerebbe zero righe.
  async movePart(id, folder) {
    const { error } = await supabase.from("parts")
      .update({ folder: normalizeFolder(folder) })
      .eq("id", id);
    if (error) { console.error("movePart:", error.message, error.code); throw error; }
  },

  // Eliminare APPIATTISCE il ramo nel genitore: i ricambi della cartella e
  // di tutte le sue sottocartelle finiscono lì, le sottocartelle spariscono.
  //
  // ⚠️ Prima le sottocartelle venivano PROMOSSE di un livello: eliminando
  //    "Idraulica" ricompariva "Valvole" al primo livello, e l'elenco poteva
  //    allungarsi dopo un'eliminazione. Da fuori sembrava che le cartelle
  //    non si eliminassero mai. Per spostare un ramo conservandone la forma
  //    c'è renameFolder — quello è "sposta", questo è "elimina".
  async deleteFolder(path) {
    const { data, error } = await supabase.rpc("delete_folder", { target: path || "" });
    if (error) { console.error("deleteFolder:", error.message, error.code); throw error; }
    return data ?? 0;
  },

  // I percorsi già in uso, per suggerirli mentre l'admin scrive. Evita che
  // "Idraulica" e "idraulica" diventino due cartelle diverse.
  async listAllFolders() {
    const { data, error } = await supabase.rpc("list_all_folders");
    if (error) { console.error("listAllFolders:", error.message, error.code); return []; }
    return (data || []).map(f => f.folder).filter(Boolean);
  },

  // ⚠️ "folder" è il terzo parametro, non il limite: la firma è cambiata
  //    quando sono arrivate le cartelle. Una chiamata vecchia a tre argomenti
  //    passerebbe il limite come percorso e non troverebbe niente.
  // rootOnly: solo i ricambi che non stanno in nessuna cartella. È la
  // schermata d'ingresso dell'amministratore — quelli da sistemare.
  // ⚠️ La chiave è "folder_path", non "folder". Chiamarla "folder" faceva
  //    collidere il nome col nome della colonna dentro la funzione SQL, e
  //    PostgreSQL dà la precedenza alla colonna: il filtro diventava
  //    "p.folder = p.folder", sempre vero, e OGNI cartella mostrava l'intero
  //    catalogo. Non rinominarla.
  async searchParts(q, machine, folder, limit = 50, rootOnly = false) {
    const { data, error } = await supabase.rpc("search_parts", {
      q: q || null, machine: machine || null, folder_path: folder || null,
      lim: limit, root_only: !!rootOnly,
    });
    if (error) { console.error("searchParts:", error.message, error.code); throw error; }
    return (data || []).map(p => ({
      id: p.id,
      code: p.code || "",
      name: p.name || "",
      category: p.category || "",
      folder: p.folder || "",
      thumbUrl: p.thumb_url || "",
    }));
  },

  // Candidati plausibili quando l'AI sbaglia e il tecnico deve correggere.
  // La somiglianza la calcola il database per trigrammi: regge gli errori di
  // battitura, e non richiede di avere il catalogo in memoria.
  async similarParts(id, limit = 5) {
    const { data, error } = await supabase.rpc("similar_parts", { part_id: id, lim: limit });
    if (error) { console.error("similarParts:", error.message, error.code); return []; }
    return (data || []).map(p => ({
      id: p.id,
      code: p.code || "",
      name: p.name || "",
      category: p.category || "",
      thumbUrl: p.thumb_url || "",
    }));
  },

  // La scheda completa: si carica aprendo un ricambio o dopo una scansione,
  // mai per un elenco.
  async getPart(id) {
    // La colonna "folder" arriva con folders.sql. Questa è la scheda che si
    // apre subito dopo una scansione riuscita: se il codice fosse in
    // produzione prima dell'SQL, senza il ripiego il tecnico vedrebbe
    // "nessuna corrispondenza" su un riconoscimento andato a buon fine.
    const COLS = "id,code,name,description,category,compatibility,thumb_url";
    let { data, error } = await supabase
      .from("parts").select(`${COLS},folder`).eq("id", id).single();
    if (error) {
      console.error("getPart senza folder:", error.message, error.code);
      ({ data, error } = await supabase
        .from("parts").select(COLS).eq("id", id).single());
    }
    if (error) { console.error("getPart:", error.message, error.code); throw error; }
    return {
      id: data.id,
      code: data.code || "",
      name: data.name || "",
      description: data.description || "",
      category: data.category || "",
      folder: data.folder || "",     // assente finché folders.sql non è applicato
      compatibility: data.compatibility || [],
      thumbUrl: data.thumb_url || "",
    };
  },

  // Controllo dei codici doppi in fase di salvataggio. Una ricerca puntuale
  // su indice: prima scorreva l'intero catalogo tenuto nel client.
  //
  // ⚠️ L'IDENTITÀ DI UN CODICE È ESATTA, MAIUSCOLE COMPRESE. "AABB123" e
  //    "aaBB123" sono due ricambi DIVERSI, e devono poter stare tutti e due
  //    in archivio: è una regola del magazzino, non una svista da correggere.
  //    Per questo il confronto che BLOCCA usa .eq() e non .ilike().
  //
  //    In più .ilike() era sbagliato anche di suo: in SQL "_" e "%" dentro il
  //    valore sono jolly, quindi un codice come "AB_12" risultava uguale a
  //    "AB812" e l'app rifiutava un codice legittimo dicendo che esisteva già.
  //    È la stessa trappola dei LIKE tolti dalle cartelle.
  //
  // Restituisce { esatto, varianti }: "esatto" è il doppione vero e blocca il
  // salvataggio; "varianti" sono i codici che differiscono SOLO per maiuscole
  // e servono ad avvisare senza impedire niente — sono legittimi, ma sono
  // anche il modo tipico in cui un refuso si traveste da ricambio nuovo.
  async partByCode(code, exceptId) {
    const pulito = (code || "").trim();
    if (!pulito) return { esatto: null, varianti: [] };

    let esatta = supabase.from("parts").select("id,code").eq("code", pulito);
    if (exceptId) esatta = esatta.neq("id", exceptId);
    const { data: uguali, error } = await esatta.limit(1);
    if (error) { console.error("partByCode:", error.message, error.code); return { esatto: null, varianti: [] }; }

    // I jolly vanno neutralizzati: qui ILIKE serve davvero (cerchiamo le
    // grafie diverse), ma "_" deve valere un underscore e basta.
    const perIlike = pulito.replace(/([\\%_])/g, "\\$1");
    let simili = supabase.from("parts").select("id,code").ilike("code", perIlike);
    if (exceptId) simili = simili.neq("id", exceptId);
    const { data: vicini } = await simili.limit(5);

    return {
      esatto: uguali?.[0] || null,
      varianti: (vicini || []).filter(v => v.code !== pulito),
    };
  },

  // Galleria di un singolo ricambio, su richiesta: dopo una scansione o
  // aprendo il dettaglio. Restituisce coppie { full, thumb }.
  async loadPartImages(id) {
    const { data, error } = await supabase
      .from("parts").select("images,image_base64").eq("id", id).single();
    if (error) { console.error("loadPartImages:", error.message, error.code); throw error; }
    const imgs = normalizeImages(data?.images);
    if (imgs.length) return imgs;
    // Ricambio mai risalvato: vale ancora la vecchia immagine singola.
    return data?.image_base64 ? [{ full: data.image_base64, thumb: data.image_base64 }] : [];
  },

  // ── Foto su Storage ───────────────────────────────────────
  // I file prendono un nome casuale, non l'indice nell'array: così spostare
  // una foto in copertina non rinomina niente e non costringe a ricaricare.
  async uploadPhoto(partId, dataUrl, suffix, stamp) {
    if (!dataUrl) return "";          // versione non generata: si prosegue senza
    const mark = stamp || Math.random().toString(36).slice(2, 10);
    const path = `${partId}/${mark}${suffix}.${extOf(dataUrl)}`;
    const { error } = await supabase.storage.from(PHOTO_BUCKET)
      .upload(path, dataUrlToBlob(dataUrl), { cacheControl: "31536000", upsert: true });
    if (error) throw error;
    return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  },

  async uploadPhotoPair(partId, image) {
    const stamp = Math.random().toString(36).slice(2, 10);
    return {
      full:  await cloud.uploadPhoto(partId, image.full,  "",   stamp),
      thumb: await cloud.uploadPhoto(partId, image.thumb, "_t", stamp),
      ai:    await cloud.uploadPhoto(partId, image.ai,    "_a", stamp),
    };
  },

  // Carica le foto nuove, lascia stare quelle già su Storage, e rimuove i
  // file rimasti orfani. Senza quest'ultimo passaggio ogni modifica a un
  // ricambio lascerebbe indietro file che nessuno cancellerà mai più.
  async savePartPhotos(partId, images) {
    const saved = [];
    for (const img of images) {
      if (!isStored(img.full)) {
        saved.push(await cloud.uploadPhotoPair(partId, img));
        continue;
      }
      // Foto già su Storage: si tiene com'è. Se le manca la versione per
      // l'AI — perché è stata caricata prima che esistesse — si prova a
      // generarla adesso dalla piena, così basta riaprire il ricambio e
      // salvarlo invece di ricaricare la foto a mano.
      //
      // Se non riesce (foto irraggiungibile, CORS, browser vecchio) il
      // salvataggio prosegue lo stesso: quel ricambio viaggerà verso l'AI
      // col solo testo, come faceva prima. Non vale far fallire un
      // salvataggio per una versione accessoria.
      let ai = img.ai || "";
      if (!ai) {
        try {
          const regenerated = await makeThumb(img.full, PHOTO_AI_PX, PHOTO_AI_Q);
          if (regenerated) ai = await cloud.uploadPhoto(partId, regenerated, "_a");
        } catch (e) {
          console.error("foto per l'AI non rigenerata:", e?.message);
        }
      }
      saved.push({ full: img.full, thumb: img.thumb || img.full, ai });
    }
    try {
      const { data: files } = await supabase.storage.from(PHOTO_BUCKET).list(partId);
      // ⚠️ Tutte e tre le versioni vanno in "keep". Dimenticarne una qui non
      // dà errore: il file viene caricato e cancellato come orfano un istante
      // dopo, e il ricambio resta con un indirizzo che non risponde più.
      const keep = new Set(saved.flatMap(s =>
        [s.full, s.thumb, s.ai].filter(Boolean).map(u => u.split("/").pop())));
      const stale = (files || []).filter(f => !keep.has(f.name)).map(f => `${partId}/${f.name}`);
      if (stale.length) await supabase.storage.from(PHOTO_BUCKET).remove(stale);
    } catch (e) {
      // Un orfano costa qualche KB: non vale il fallimento di un salvataggio
      // che per il resto è andato a buon fine.
      console.error("pulizia foto:", e?.message);
    }
    return saved;
  },

  // ── IMPORT DI MASSA ───────────────────────────────────────
  // Non passa da addPart, e non è pigrizia: addPart chiama savePartPhotos,
  // che anche con zero foto fa comunque il giro di pulizia degli orfani su
  // Storage — una chiamata di rete per ricambio, cioè duemila viaggi per
  // niente su un import che di foto non ne ha nessuna.

  // Tutti i codici già a catalogo. Si scarica la sola colonna "code" a pagine
  // da mille: su duemila ricambi sono poche decine di KB, e confrontare in
  // memoria evita duemila interrogazioni una per codice.
  //
  // ⚠️ "esatti" è la STESSA espressione del vincolo nel database, btrim(code)
  //    senza lower(): l'identità di un codice comprende le maiuscole, e
  //    "AABB123" accanto a "aaBB123" sono due ricambi che devono entrare
  //    tutti e due. Confrontare in minuscolo, come faceva la prima versione,
  //    avrebbe fatto saltare il secondo dicendo che c'era già.
  //
  //    "perMinuscolo" non serve a decidere niente: serve solo ad avvisare che
  //    due grafie si somigliano, perché è così che un refuso entra in
  //    magazzino travestito da ricambio nuovo.
  async codiciEsistenti() {
    const esatti = new Set();
    const perMinuscolo = new Map();
    const PAGINA = 1000;
    for (let da = 0; ; da += PAGINA) {
      const { data, error } = await supabase
        .from("parts").select("code").range(da, da + PAGINA - 1);
      if (error) { console.error("codiciEsistenti:", error.message, error.code); throw error; }
      for (const r of data || []) {
        const c = String(r.code ?? "").trim();
        if (!c) continue;
        esatti.add(c);
        const k = c.toLowerCase();
        if (!perMinuscolo.has(k)) perMinuscolo.set(k, []);
        if (!perMinuscolo.get(k).includes(c)) perMinuscolo.get(k).push(c);
      }
      if (!data || data.length < PAGINA) return { esatti, perMinuscolo };
    }
  },

  // Fa esistere le cartelle anche quando sono vuote, in UNA chiamata sola
  // invece di una create_folder per cartella. part_folders.path è chiave
  // primaria, quindi "path" è un bersaglio di conflitto che PostgREST sa
  // esprimere — a differenza di lower(btrim(code)) su parts.
  //
  // ⚠️ .select("path") non è decorativo: sotto RLS una scrittura non
  //    permessa tocca zero righe IN SILENZIO e l'app direbbe "riuscito". È
  //    lo stesso guasto che in folders.sql ha costretto a far sollevare
  //    un'eccezione a create_folder.
  async assicuraCartelle(percorsi) {
    const puliti = [...new Set((percorsi || []).map(normalizeFolder).filter(Boolean))];
    if (!puliti.length) return 0;
    const { data, error } = await supabase
      .from("part_folders")
      .upsert(puliti.map(path => ({ path })), { onConflict: "path" })
      .select("path");
    if (error) {
      console.error("assicuraCartelle:", error.message, error.code);
      if (error.code === "42501") {
        throw new Error("Le cartelle non sono state create: questo account non ha i permessi di scrittura. Entra con l'account amministratore.");
      }
      throw error;
    }
    return (data || []).length;
  },

  // Scrive un blocco e PRETENDE la prova che sia entrato. Senza .select("id")
  // supabase-js manda "return=minimal", data torna null e non esiste modo di
  // sapere se le righe ci sono davvero.
  async _scriviBlocco(blocco) {
    const { data, error } = await supabase
      .from("parts").insert(blocco.map(({ _riga, ...riga }) => riga)).select("id");
    if (error) throw error;
    if ((data || []).length !== blocco.length) {
      throw new Error(`scritte ${(data || []).length} righe su ${blocco.length}`);
    }
    return data.length;
  },

  // Un insert è atomico: una riga rifiutata fa cadere tutto il blocco. Invece
  // di far fallire l'import, il blocco si dimezza finché il colpevole non
  // resta solo — log2(300) ≈ 9 tentativi invece di 300, e alla fine si sa
  // QUALE riga e PERCHÉ.
  async _scriviDimezzando(blocco, scartate) {
    try {
      return await cloud._scriviBlocco(blocco);
    } catch (e) {
      if (blocco.length === 1) {
        const r = blocco[0];
        const motivo = e.code === "23505"
          ? "codice già presente a catalogo"
          : `rifiutato dal database: ${e.message || e.code || "errore"}`;
        scartate.push({ nRiga: r._riga, motivo, riga: [r.code, r.name] });
        return 0;
      }
      // 42501 è un permesso mancante: dimezzare non serve a niente, nessuna
      // metà passerà mai. Si ferma subito e lo si dice.
      if (e.code === "42501") throw e;
      const meta = Math.ceil(blocco.length / 2);
      const a = await cloud._scriviDimezzando(blocco.slice(0, meta), scartate);
      const b = await cloud._scriviDimezzando(blocco.slice(meta), scartate);
      return a + b;
    }
  },

  // Scrive i ricambi a blocchi, avvisando dell'avanzamento e fermandosi se
  // glielo si chiede. Restituisce { scritti, idScritti, scartate }.
  //
  // ⚠️ Solo insert, mai update: un ricambio già a catalogo viene saltato
  //    prima di arrivare qui. Aggiornare da CSV vorrebbe dire sovrascrivere
  //    descrizioni e foto di schede curate a mano con celle magari vuote, ed
  //    è esattamente il guasto che nell'area amministratore era già costato
  //    la cancellazione silenziosa di descrizione e compatibilità.
  async importaRicambi(righe, { blocco = 300, onProgress, fermato } = {}) {
    const scartate = [];
    const idScritti = [];
    let scritti = 0;

    for (let i = 0; i < righe.length; i += blocco) {
      if (fermato && fermato()) break;
      const pezzo = righe.slice(i, i + blocco);
      let entrati;
      try {
        entrati = await cloud._scriviBlocco(pezzo);
        idScritti.push(...pezzo.map(r => r.id));
      } catch (e) {
        console.error("importaRicambi blocco:", e.message, e.code);
        if (e.code === "42501") {
          throw new Error("Scrittura rifiutata: questo account non ha i permessi sul catalogo. Entra con l'account amministratore.");
        }
        // Il blocco è caduto per colpa di qualche riga: si isola dimezzando,
        // così le righe sane entrano lo stesso.
        const primaDegliScarti = scartate.length;
        entrati = await cloud._scriviDimezzando(pezzo, scartate);
        const cadute = new Set(scartate.slice(primaDegliScarti).map(s => s.nRiga));
        idScritti.push(...pezzo.filter(r => !cadute.has(r._riga)).map(r => r.id));
      }
      scritti += entrati;
      if (onProgress) onProgress(Math.min(i + blocco, righe.length), righe.length);
    }
    return { scritti, idScritti, scartate };
  },

  // L'annullamento subito dopo l'import. Gli id li abbiamo generati noi e
  // sono in memoria, quindi la cancellazione è chirurgica per costruzione.
  //
  // ⚠️ A blocchi da cento e non da trecento: PostgREST mette il filtro "in"
  //    nella query string, e trecento id da venti caratteri la sfondano.
  // ⚠️ Mai con .like("id", "p_" + t0 + "%"): negli id il carattere "_" è il
  //    jolly di LIKE, la stessa trappola che nelle cartelle faceva agganciare
  //    rami estranei.
  async eliminaRicambiPerId(ids) {
    let tolti = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const pezzo = ids.slice(i, i + 100);
      const { data, error } = await supabase
        .from("parts").delete().in("id", pezzo).select("id");
      if (error) {
        console.error("eliminaRicambiPerId:", error.message, error.code);
        if (error.code === "42501") {
          throw new Error("Annullamento rifiutato: questo account non ha i permessi di cancellazione.");
        }
        throw error;
      }
      tolti += (data || []).length;
    }
    return tolti;
  },

  // Le cartelle che esistono già nel catalogo, tutte, compresi i livelli
  // intermedi. Serve alla schermata di import, dove si sceglie dove far
  // nascere i ricambi.
  //
  // ⚠️ Se la funzione SQL non risponde — o non è mai stata installata — NON
  //    si restituisce un elenco vuoto: un menu vuoto sembrerebbe "non hai
  //    cartelle", che è una bugia, e questo progetto ha già pagato caro il
  //    costo delle liste vuote in silenzio. Si ricava l'albero dai dati.
  async cartelleCatalogo() {
    const viste = new Set();
    const aggiungi = (p) => {
      const pulito = normalizeFolder(p);
      if (!pulito) return;
      const parti = pulito.split("/");
      for (let i = 1; i <= parti.length; i++) viste.add(parti.slice(0, i).join("/"));
    };

    for (const f of await cloud.listAllFolders()) aggiungi(f);
    if (viste.size) return [...viste].sort();

    const { data: create } = await supabase.from("part_folders").select("path").limit(2000);
    for (const r of create || []) aggiungi(r.path);
    const PAGINA = 1000;
    for (let da = 0; ; da += PAGINA) {
      const { data, error } = await supabase.from("parts").select("folder").range(da, da + PAGINA - 1);
      if (error) { console.error("cartelleCatalogo:", error.message, error.code); break; }
      for (const r of data || []) aggiungi(r.folder);
      if (!data || data.length < PAGINA) break;
    }
    return [...viste].sort();
  },

  // Il rapporto sulle valutazioni dei tecnici. Un oggetto solo, calcolato
  // dal database: contare persone distinte in memoria avrebbe voluto dire
  // scaricare tutte le righe sul telefono dell'amministratore.
  //
  // ⚠️ Lo stesso taglio che applica analyze.js — le valutazioni anteriori
  //    all'ultima modifica della scheda non contano. Deve essere lo stesso,
  //    o si tarerebbe l'AI guardando numeri che il modello non vede.
  async feedbackReport(giorni = 90) {
    const { data, error } = await supabase.rpc("feedback_report", { giorni });
    if (error) {
      console.error("feedbackReport:", error.message, error.code);
      // 42883 = la funzione non esiste: feedback.sql non è stato eseguito.
      // È un caso da spiegare, non un guasto da nascondere.
      throw new Error(error.code === "42883"
        ? "Manca la funzione feedback_report: esegui feedback.sql in Supabase (punto 4m del SETUP)."
        : error.message);
    }
    return data || null;
  },

  // ── FOTO IN BLOCCO ────────────────────────────────────────

  // L'elenco dei codici con il loro id, per abbinare i nomi dei file. Si
  // scaricano tre colonne sole: thumb_url serve unicamente a sapere SE il
  // ricambio ha già una copertina, non a mostrarla.
  async mappaCodici() {
    const perCodice = new Map();      // codice esatto → { id, conFoto }
    const perMinuscolo = new Map();   // minuscolo → [codici esatti]
    const PAGINA = 1000;
    for (let da = 0; ; da += PAGINA) {
      const { data, error } = await supabase
        .from("parts").select("id,code,thumb_url").range(da, da + PAGINA - 1);
      if (error) { console.error("mappaCodici:", error.message, error.code); throw error; }
      for (const r of data || []) {
        const code = String(r.code ?? "").trim();
        if (!code) continue;
        perCodice.set(code, { id: r.id, conFoto: !!r.thumb_url });
        const k = code.toLowerCase();
        if (!perMinuscolo.has(k)) perMinuscolo.set(k, []);
        perMinuscolo.get(k).push(code);
      }
      if (!data || data.length < PAGINA) return { perCodice, perMinuscolo };
    }
  },

  // Aggiorna SOLO le tre colonne delle foto.
  //
  // ⚠️ Non passa da updatePart, e non è una scorciatoia: updatePart riscrive
  //    anche codice, nome, descrizione, categoria, cartella e compatibilità
  //    con quello che ha nel form. È esattamente il meccanismo che, partendo
  //    da una riga di elenco senza descrizione, aveva già cancellato in
  //    silenzio le descrizioni dei ricambi modificati dalla lista. Qui si
  //    stanno caricando fotografie: nient'altro deve muoversi.
  async aggiornaFotoRicambio(id, immagini) {
    const salvate = await cloud.savePartPhotos(id, immagini);
    const { data, error } = await supabase
      .from("parts")
      .update({
        images: salvate,
        thumb_url: salvate[0]?.thumb || null,
        photo_url: salvate[0]?.ai || null,
      })
      .eq("id", id)
      .select("id");
    if (error) {
      console.error("aggiornaFotoRicambio:", error.message, error.code);
      if (error.code === "42501") {
        throw new Error("Questo account non ha i permessi di scrittura sul catalogo.");
      }
      throw error;
    }
    // Sotto RLS un update non permesso tocca zero righe IN SILENZIO e
    // tornerebbe "riuscito": la prova che la riga esiste ancora ed è stata
    // scritta è che torni indietro il suo id.
    if (!data || !data.length) {
      throw new Error("Nessuna riga aggiornata: il ricambio è stato eliminato, oppure mancano i permessi.");
    }
    return salvate.length;
  },

  async addPart(part) {
    const id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const images = await cloud.savePartPhotos(id, part.images || []);
    const { data, error } = await supabase.from("parts").insert([{
      id,
      code: part.code.trim(),
      name: part.name.trim(),
      description: part.description || "",
      category: part.category || "",
      folder: normalizeFolder(part.folder),
      compatibility: part.compatibility || [],
      images,
      thumb_url: images[0]?.thumb || null,
      // La copertina in versione media: è l'unica foto che il server manda
      // all'AI, e sta in una colonna sua perché va letta per migliaia di
      // ricambi a ogni scansione — scavarla dal jsonb "images" costerebbe.
      photo_url: images[0]?.ai || null,
    }]).select("id,code,name,description,category,folder,compatibility,thumb_url,created_at").single();
    if (error) throw error;
    return { ...data, thumbUrl: data.thumb_url || "", compatibility: data.compatibility || [] };
  },

  async updatePart(id, part) {
    const images = await cloud.savePartPhotos(id, part.images || []);
    const { data, error } = await supabase.from("parts").update({
      code: part.code.trim(),
      name: part.name.trim(),
      description: part.description || "",
      category: part.category || "",
      folder: normalizeFolder(part.folder),
      compatibility: part.compatibility || [],
      images,
      thumb_url: images[0]?.thumb || null,
      photo_url: images[0]?.ai || null,
      image_base64: null,      // migrato: il vecchio formato non serve più
    }).eq("id", id).select("id,code,name,description,category,folder,compatibility,thumb_url,created_at").single();
    if (error) throw error;
    return { ...data, thumbUrl: data.thumb_url || "", compatibility: data.compatibility || [] };
  },

  // Le foto vanno cancellate PRIMA della riga: se sparisse prima il ricambio,
  // resterebbero file senza più nessuno che sappia a chi appartenevano.
  async deletePart(id) {
    try {
      const { data: files } = await supabase.storage.from(PHOTO_BUCKET).list(id);
      if (files?.length) {
        await supabase.storage.from(PHOTO_BUCKET).remove(files.map(f => `${id}/${f.name}`));
      }
    } catch (e) {
      console.error("cancellazione foto:", e?.message);
    }
    const { error } = await supabase.from("parts").delete().eq("id", id);
    if (error) throw error;
  },
  // Carica la finestra di conservazione. Non ci sono più intervalli scelti
  // dall'utente: oltre HISTORY_RETENTION_DAYS non esiste nulla da cercare,
  // perché il database ha già cancellato le righe.
  async loadHistory({ limit = 300 } = {}) {
    const { data, error } = await supabase
      .from("scan_history")
      .select("matched,confidence,image_base64,timestamp,part_name,part_code")
      .gte("timestamp", retentionCutoffIso())
      .order("timestamp", { ascending: false }).limit(limit);
    if (error) { console.error("loadHistory:", error.message, error.code); throw error; }
    // reasoning non viene scaricato: nessuna schermata lo mostra, e su 300
    // righe sarebbero decine di KB di testo trasferiti per niente.
    return (data || []).map(h => ({
      matched: h.matched,
      confidence: h.confidence,
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
      reasoning: (item.reasoning || "").slice(0, HISTORY_REASONING_MAX),
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

  // L'aggregazione dei feedback vive ora sul server (analyze.js): girava sul
  // telefono di ogni tecnico a ogni avvio dell'app — 2000 righe scaricate e
  // ricontate da cento dispositivi per produrre lo stesso identico risultato,
  // che poi veniva rispedito al server da cui erano arrivate.

  // Piano B della potatura automatica: se pg_cron non è attivo sul progetto,
  // è l'apertura dell'app a innescare la pulizia. Costa una scansione di
  // indice che di norma non trova nulla, quindi si può chiamare a ogni avvio.
  // Non blocca niente: un errore qui non deve impedire di lavorare.
  async purgeOldHistory() {
    const { error } = await supabase.rpc("purge_old_history");
    if (error) console.error("purgeOldHistory:", error.message, error.code);
  },

  // È l'ambito della policy a decidere quante righe spariscono, non un
  // parametro: un tecnico cancella le proprie, l'admin quelle di tutti.
  // Stessa chiamata, stesso codice, nessun ruolo da passare dal client —
  // che è anche il motivo per cui un tecnico non può fingersi admin.
  // Il filtro sul timestamp c'è sempre: PostgREST rifiuta una DELETE nuda.
  async clearHistory() {
    const { error, count } = await supabase.from("scan_history")
      .delete({ count: "exact" })
      .gte("timestamp", "1970-01-01T00:00:00.000Z");
    if (error) throw error;
    return count ?? 0;
  },
};

// ── Ricerca digitata ─────────────────────────────────────────
// Ogni tasto premuto sarebbe una richiesta al database: si aspetta che il
// dito si fermi. 250 ms è la soglia sotto cui la digitazione sembra continua
// e sopra cui l'attesa si nota.
//
// Il calcolo dei ricambi simili viveva qui e contava le parole in comune fra
// le descrizioni. Ora lo fa il database per trigrammi (similar_parts in
// server-search.sql): regge gli errori di battitura, e soprattutto non
// richiede di tenere l'intero catalogo nella memoria del telefono.
const SEARCH_DEBOUNCE_MS = 250;
const SCAN_MACHINE_KEY = "werfen_scan_machine";

function useDebounced(value, ms = SEARCH_DEBOUNCE_MS) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

// ── Conservazione della cronologia ───────────────────────────
// Le scansioni più vecchie di HISTORY_RETENTION_DAYS vengono cancellate dal
// database (funzione purge_old_history in history-retention.sql). Il client
// non si fida della potatura: filtra comunque sulla stessa finestra, così un
// cron in ritardo non fa comparire scansioni che l'utente crede sparite.
//
// ⚠️ Il numero è replicato in history-retention.sql. Cambiarlo qui soltanto
//    non allunga la conservazione: il database continua a potare a 7 giorni.
const HISTORY_RETENTION_DAYS = 7;

// Miniatura della cronologia: piccola per scelta. Con 100 tecnici che scansionano
// ogni giorno, la differenza fra 10 KB e 3 KB per riga decide se il database sta
// dentro il piano gratuito o no. Serve a farsi riconoscere in una lista, non a
// esaminare il pezzo: per quello c'è la galleria del ricambio.
const HISTORY_THUMB_PX = 160;
const HISTORY_THUMB_Q  = 0.5;

// Il "perché" dell'AI non viene mostrato in nessuna schermata: si conserva solo
// come traccia per capire a posteriori un riconoscimento sbagliato. Tagliato,
// perché il modello a volte ignora il limite di 40 parole del prompt.
const HISTORY_REASONING_MAX = 300;

const retentionCutoffIso = () =>
  new Date(Date.now() - HISTORY_RETENTION_DAYS * 24 * HOUR_MS).toISOString();

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
        // WebP anche qui: alleggerisce sia le foto del catalogo sia la foto
        // spedita a /api/analyze, che parte da un telefono in officina.
        done(encodeSmallest(canvas, quality));
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

// ── Foto dei ricambi ─────────────────────────────────────────
// Tre versioni di ogni foto, generate al caricamento. Servono a scopi
// diversi e non vanno confuse:
//
//   miniatura → riconoscere un pezzo in una lista. Deve pesare niente.
//   media     → è la copia che va all'AI insieme al catalogo. 512 pixel non
//               è un numero a caso: sotto i 200 il modello sbaglia di più,
//               e ogni raddoppio del lato quadruplica i token da pagare.
//   piena     → esaminarlo: filettature, marcature, profilo laterale.
//               È più definita del vecchio formato 800px, perché è quella
//               che il tecnico confronta con la foto appena scattata.
//
// Il peso complessivo cambia poco. Cambia QUANDO si scarica: la piena solo
// aprendo quel ricambio, la miniatura solo se compare fra i risultati di
// una ricerca, la media mai — la scarica Anthropic, non il telefono.
// All'avvio dell'app non si scarica nessuna delle tre.
// Righe disegnate nel catalogo. Senza ricerca ne bastano poche: sono lì per
// far capire che il catalogo non è vuoto, non per essere sfogliate.
const CATALOG_PREVIEW_ROWS = 25;
const CATALOG_MAX_ROWS     = 100;

const PHOTO_BUCKET   = "part-photos";
const PHOTO_FULL_PX  = 1400, PHOTO_FULL_Q  = 0.72;   // ~110 KB
const PHOTO_AI_PX    = 512,  PHOTO_AI_Q    = 0.6;    // ~25 KB — 361 token per l'AI
const PHOTO_THUMB_PX = 128,  PHOTO_THUMB_Q = 0.5;    // ~3,5 KB

// Le immagini nascono come data URL (servono per l'anteprima nel form) e
// vanno caricate come file binari: questa è la conversione fra i due mondi.
function dataUrlToBlob(dataUrl) {
  const [meta, b64] = String(dataUrl).split(",");
  const mime = meta.slice(5).split(";")[0] || "image/jpeg";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

const extOf = (dataUrl) => (String(dataUrl).startsWith("data:image/webp") ? "webp" : "jpg");
const isStored = (v) => typeof v === "string" && /^https?:\/\//.test(v);

// ── Percorsi delle cartelle ──────────────────────────────────
// "  /Idraulica// Valvole/ " → "Idraulica/Valvole"
//
// Le barre di troppo e gli spazi ai bordi sono l'errore di battitura più
// probabile in un campo di testo libero, e nell'albero non sarebbero un
// dettaglio estetico: "Idraulica" e "Idraulica/" diventerebbero due cartelle
// distinte, con gli stessi ricambi divisi fra le due senza che si capisca
// perché. Si normalizza in scrittura, una volta sola.
//
// Vuoto è una posizione legittima: il ricambio sta nella radice del suo
// macchinario. Viene salvato come stringa vuota e non come null — è ciò che
// impedisce all'SQL di riempimento iniziale di rimetterlo in una cartella se
// venisse rieseguito per sbaglio.
const MAX_FOLDER_CHARS = 200;
const normalizeFolder = (v) =>
  String(v ?? "")
    .split("/")
    .map(s => s.trim())
    .filter(Boolean)
    .join("/")
    .slice(0, MAX_FOLDER_CHARS);

// I singoli livelli di un percorso, per le briciole di pane.
const folderSegments = (path) => (normalizeFolder(path) ? normalizeFolder(path).split("/") : []);

// ===================== IMPORT CSV: LEGGERE IL FILE =====================
// Tutto quello che serve a trasformare un file scelto dall'amministratore in
// righe pronte da scrivere. Nessuna libreria: TextDecoder e File bastano, e
// una dipendenza in più, su un progetto fatto di file singoli senza repo git,
// è un peso che poi non si toglie più.
//
// Il file arriva quasi sempre da Excel su Windows in italiano, che è il caso
// peggiore possibile: separatore punto e virgola, accenti in ANSI, virgolette
// raddoppiate. Ogni scelta qui sotto nasce da uno di quei tre.

// Il modello da scaricare. "sep=;" lo capiscono sia Excel sia il parser qui
// sotto: aprendolo con un doppio clic le colonne sono già divise, invece di
// finire tutte schiacciate nella prima.
const MODELLO_CSV = [
  "sep=;",
  "codice;nome;descrizione;categoria;compatibilita;cartella",
  'VAL-001;Valvola a sfera 1/2";Ottone nichelato, attacco filettato, PN40. Sede in PTFE.;Valvole;Mazak 200;Idraulica/Valvole',
  "GUA-114;Guarnizione OR 114;Viton nero, 14x2 mm, resistente a oli minerali.;Guarnizioni;Mazak 200|Mazak 300;Idraulica/Guarnizioni",
  "FIL-330;Filtro aria compresso;Cartuccia 5 micron con scarico automatico.;Filtri;;Pneumatica",
].join("\r\n");

// Normalizza un'intestazione per il confronto: via BOM residuo, accenti,
// maiuscole e punteggiatura. Così "Cod. Art.", "COD_ART" e "CodArt" sono la
// stessa chiave, e "Compatibilità", "COMPATIBILITA'" e "Compatibilita" pure.
const csvKey = (s) => String(s ?? "")
  .replace(/^﻿/, "")
  // Le intestazioni NUMERATE sono comunissime negli export dei gestionali:
  // "1. Part Number", "2) Nome", "3 - Descrizione". Il numero non fa parte
  // del nome della colonna, e lasciandolo attaccato "3. Description" non
  // combacia con nessun alias: la colonna risulta sconosciuta, e la
  // descrizione va mappata a mano su un file in cui era ovvia.
  .replace(/^\s*\d{1,3}\s*[.):-]\s*/, "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "");

// Gli alias ambigui ("articolo", "rif", "descrizione articolo") stanno in
// FONDO alla lista del loro campo: una colonna chiamata esplicitamente
// "codice" deve vincere su di loro.
const CSV_ALIAS = {
  codice: ["codice", "codice ricambio", "cod", "cod.", "codice articolo", "cod. art.", "codart",
           "codice pezzo", "codice prodotto", "matricola", "riferimento", "sigla",
           "code", "part code", "part number", "part no", "p/n", "pn", "sku", "item code",
           "item number", "ref", "articolo", "art"],
  nome: ["nome", "nome ricambio", "nome pezzo", "denominazione", "descrizione breve", "titolo",
         "designazione", "dicitura", "name", "part name", "title", "short description", "label",
         "descrizione articolo"],
  descrizione: ["descrizione", "descrizione tecnica", "descrizione lunga", "descrizione estesa",
                "desc", "dettaglio", "dettagli", "note", "note tecniche", "caratteristiche",
                "specifiche", "description", "long description", "details", "notes", "remarks"],
  categoria: ["categoria", "tipo", "tipologia", "famiglia", "gruppo", "gruppo merceologico",
              "classe", "settore", "reparto", "category", "type", "family", "group", "class"],
  compatibilita: ["compatibilita", "compatibilita'", "compatibilità", "compatibile", "compatibile con",
                  "macchina", "macchine", "macchinario", "macchinari", "modello", "modelli",
                  "applicazione", "applicazioni", "montato su", "usato su", "impianto", "impianti",
                  "linea", "compatibility", "compatible", "machine", "machines", "model", "models",
                  "equipment", "used on", "fits"],
  cartella: ["cartella", "percorso", "percorso cartella", "path", "folder", "folder path",
             "directory", "dir", "albero", "posizione catalogo", "collocazione", "sezione",
             "location", "tree"],
};

const CSV_CAMPI = [
  { campo: "codice",        etichetta: "Codice",        obbligatorio: true  },
  { campo: "nome",          etichetta: "Nome",          obbligatorio: true  },
  { campo: "descrizione",   etichetta: "Descrizione",   obbligatorio: false },
  { campo: "categoria",     etichetta: "Categoria",     obbligatorio: false },
  { campo: "compatibilita", etichetta: "Compatibilità", obbligatorio: false },
  { campo: "cartella",      etichetta: "Cartella",      obbligatorio: false },
];

// Chiave normalizzata → campo. La tabella sopra resta leggibile con accenti e
// punti, il confronto avviene normalizzato.
const CSV_MAPPA_ALIAS = (() => {
  const m = new Map();
  for (const [campo, lista] of Object.entries(CSV_ALIAS))
    for (const a of lista) if (!m.has(csvKey(a))) m.set(csvKey(a), campo);
  return m;
})();

// ── Byte → testo ────────────────────────────────────────────
// Si legge come ArrayBuffer e non con readAsText: readAsText decide UTF-8 per
// conto suo, e su un file ANSI gli accenti diventano U+FFFD PRIMA che il
// parser veda qualcosa. Da lì non si torna indietro.
async function leggiTestoCSV(file) {
  const buf = new Uint8Array(await file.arrayBuffer());

  // Un .xlsx è uno zip: intercettarlo qui evita di macinare binario e
  // produrre migliaia di righe senza senso.
  if (buf[0] === 0x50 && buf[1] === 0x4B) {
    throw new Error("Questo è un file Excel (.xlsx), non un CSV. In Excel: File → Salva con nome → CSV UTF-8.");
  }

  // Il BOM è l'unico indizio certo: se c'è, non si indovina niente. Va TOLTO,
  // o la prima intestazione diventa "﻿codice" e non combacia con nessun
  // alias: la colonna del codice risulterebbe sconosciuta per una ragione che
  // a schermo non si vede.
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF)
    return { testo: new TextDecoder("utf-8").decode(buf.subarray(3)), codifica: "UTF-8 con BOM" };
  if (buf[0] === 0xFF && buf[1] === 0xFE)
    return { testo: new TextDecoder("utf-16le").decode(buf.subarray(2)), codifica: "UTF-16 LE" };
  if (buf[0] === 0xFE && buf[1] === 0xFF)
    return { testo: new TextDecoder("utf-16be").decode(buf.subarray(2)), codifica: "UTF-16 BE" };

  // Niente BOM. "fatal: true" trasforma la prova in un test esatto invece che
  // in un'euristica: in Windows-1252 la "à" è il byte singolo 0xE0, che in
  // UTF-8 annuncia una sequenza di 3 byte che non arriva mai. Il decoder
  // lancia, e il catch sa con certezza cos'ha in mano.
  try {
    const testo = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    // Un file può essere UTF-8 valido e comunque sbagliato: UTF-8 letto come
    // 1252 e risalvato (export aperto in Excel, modificato, salvato). Nessuna
    // eccezione scatta e "à" si legge "Ã ". Non si ripara indovinando su
    // migliaia di descrizioni: si avvisa e si chiede di riesportare.
    const doppia = /Ã[-¿]|â€/.test(testo);
    return {
      testo,
      codifica: "UTF-8",
      avviso: doppia
        ? "Il file sembra codificato due volte: al posto degli accenti si leggono \"Ã¨\" e \"â€™\". Riesportalo come CSV UTF-8."
        : "",
    };
  } catch {
    // windows-1252, non iso-8859-1: differiscono nella fascia 0x80-0x9F, dove
    // 1252 tiene le virgolette tipografiche e il trattino lungo — cioè quello
    // che finisce in una descrizione incollata da Word.
    return { testo: new TextDecoder("windows-1252").decode(buf), codifica: "Windows-1252 (ANSI)" };
  }
}

// ── Il parser: una macchina a stati, non uno split ──────────
// Il CSV non è un formato regolare: un a-capo dentro le virgolette (una
// descrizione tecnica su più righe) significa una cosa diversa dallo stesso
// a-capo fuori, e nessuna espressione regolare li distingue in modo
// affidabile. Serve scorrere il testo con un booleano in mano.
function analizzaCSV(testo, sep) {
  const righe = [];
  let riga = [], campo = "", dentro = false, i = 0, rigaApertura = 0;
  const n = testo.length;

  while (i < n) {
    const c = testo[i];

    if (dentro) {
      if (c === '"') {
        // "" è UNA virgoletta letterale e la cella CONTINUA: è così che Excel
        // scrive 'Guarnizione 3/4"'. Chiudere sulla prima sballerebbe tutte
        // le colonne da lì in poi, e anche il conteggio delle righe.
        if (testo[i + 1] === '"') { campo += '"'; i += 2; continue; }
        dentro = false; i++; continue;
      }
      // Qui l'a-capo NON chiude la riga. Il CRLF si normalizza a \n: il
      // ritorno carrello di Windows salvato nel database riemerge come
      // riquadro strano nella scheda del ricambio sul telefono.
      if (c === "\r") { campo += "\n"; i += (testo[i + 1] === "\n" ? 2 : 1); continue; }
      campo += c; i++; continue;
    }

    // La virgoletta apre solo a cella ancora vuota: così 12" — i pollici,
    // misura frequentissima su un ricambio — resta letterale. Si tollerano
    // spazi fra separatore e virgoletta, che diversi gestionali scrivono.
    if (c === '"' && /^[ \t]*$/.test(campo)) {
      campo = ""; dentro = true; rigaApertura = righe.length + 1; i++; continue;
    }
    if (c === sep) { riga.push(campo); campo = ""; i++; continue; }
    if (c === "\r" || c === "\n") {
      i += (c === "\r" && testo[i + 1] === "\n") ? 2 : 1;   // CRLF = un terminatore solo
      riga.push(campo); campo = "";
      righe.push(riga); riga = [];
      continue;
    }
    campo += c; i++;
  }

  // L'ultima riga si emette solo se contiene qualcosa: spingerla sempre crea
  // una riga fantasma in fondo a ogni file che finisce con un a-capo, cioè
  // quasi tutti, e l'import annuncerebbe una riga in più senza codice.
  if (campo !== "" || riga.length) { riga.push(campo); righe.push(riga); }

  // Virgolette mai chiuse: da lì in poi metà file finisce in una cella sola.
  // Senza questo controllo l'anteprima mostra quaranta righe su duemila e
  // sembra un file troncato, invece che una virgoletta dimenticata.
  if (dentro) throw new Error(`Virgolette aperte alla riga ${rigaApertura} e mai chiuse. Controlla quella riga.`);
  return righe;
}

// ── Il separatore, senza chiederlo ──────────────────────────
// Excel in italiano salva con ";" (il separatore di elenco di Windows con
// locale IT), "CSV UTF-8" con ",", "Testo delimitato da tabulazioni" con TAB.
// L'ordine dei candidati è la preferenza a parità di punteggio.
const CSV_SEPARATORI = [";", "\t", ",", "|"];

function trovaSeparatoreCSV(testo) {
  // Excel a volte dichiara il separatore da solo. Vince su tutto, e la riga
  // va CONSUMATA: se resta diventa una riga di dati fasulla e l'intestazione
  // slitta di uno.
  const m = /^sep=(.)\r?\n/i.exec(testo);
  if (m) return { sep: m[1], testo: testo.slice(m[0].length) };

  // Si conta col parser VERO, non con una regex: una descrizione che contiene
  // "12,5 mm; acciaio inox" voterebbe per il separatore sbagliato. Solo i
  // primi 64 KB, perché serve a contare le colonne e non a leggere i dati:
  // con quattro candidati, parsare cinque megabyte quattro volte è lavoro
  // buttato. Il troncamento può tagliare a metà una cella fra virgolette, e
  // non importa.
  const assaggio = testo.slice(0, 65536);
  let migliore = { sep: ";", punteggio: -1 };
  for (const sep of CSV_SEPARATORI) {
    let righe;
    try { righe = analizzaCSV(assaggio, sep); } catch { continue; }
    righe = righe.filter(r => r.some(c => c.trim() !== "")).slice(0, 6);
    if (!righe.length) continue;
    const colonne = righe[0].length;
    if (colonne < 2) continue;                       // una colonna sola = non è quello
    const coerenti = righe.filter(r => r.length === colonne).length;
    // Più colonne, ma solo se regolari: un separatore sbagliato compare un
    // numero casuale di volte per riga e i conteggi ballano.
    const punteggio = colonne * 100 + coerenti;
    if (punteggio > migliore.punteggio) migliore = { sep, punteggio };
  }
  // Nessun candidato convince: non si tira a indovinare su duemila righe, la
  // schermata mostra il selettore e lo fa scegliere.
  return { sep: migliore.punteggio < 0 ? null : migliore.sep, testo };
}

// ── Le colonne ──────────────────────────────────────────────
// NON scrive niente e non decide niente: restituisce la corrispondenza
// trovata perché la schermata la faccia CONFERMARE. È il punto esatto in cui
// un import scrive duemila nomi nel campo sbagliato senza dare nessun errore:
// il file è valido, il database è contento, e il catalogo è da rifare a mano.
function mappaColonneCSV(intestazione) {
  const mappa = {};
  const sconosciute = [];
  (intestazione || []).forEach((testa, i) => {
    const campo = CSV_MAPPA_ALIAS.get(csvKey(testa));
    if (!campo) { sconosciute.push({ indice: i, testa }); return; }
    // La compatibilità è l'unico campo che prende PIÙ colonne, e tiene un
    // array anche quando ne ha una sola. Un elenco di magazzino tiene spesso
    // un macchinario per colonna ("Modello 1", "Modello 2", "Si adatta a"):
    // prenderne una e basta butterebbe via le altre senza dire niente.
    if (campo === "compatibilita") {
      mappa.compatibilita = [...(mappa.compatibilita || []), i];
      return;
    }
    if (mappa[campo] === undefined) mappa[campo] = i;   // primo arrivato vince
    else sconosciute.push({ indice: i, testa });
  });
  // Nome e descrizione, in un catalogo ricambi, sono quasi sempre la stessa
  // frase: il nome è "Valvola a sfera 1/2 ottone" e la descrizione la ripete
  // più distesa. Il nome è obbligatorio, e un file che non ha una colonna sua
  // non deve per questo bloccare l'import: si prende quella della
  // descrizione. Resta cambiabile a mano nella schermata delle colonne.
  if (mappa.nome === undefined && mappa.descrizione !== undefined) mappa.nome = mappa.descrizione;
  return { mappa, sconosciute, senzaIntestazione: Object.keys(mappa).length === 0 };
}

// ── I valori dentro una cella ───────────────────────────────
// Backslash e spazi unicode PRIMA di normalizeFolder, che fa solo split("/"):
// "Idraulica\Valvole" copiato da un percorso Windows diventerebbe UNA
// cartella col backslash dentro il nome, e uno spazio unificatore finale
// (copia-incolla dal web o da un PDF) sopravvive a trim() e sdoppia la
// cartella nell'albero senza che la differenza si veda.
const cartellaDaCella = (v) =>
  normalizeFolder(String(v ?? "").replace(/\\/g, "/").replace(/[   ]/g, " "));

// A cascata: "|", ";" e a-capo sono sempre separatori; la virgola solo se non
// c'è nessuno degli altri — così "Tornio CNC Mazak, modello 200" resta intero
// quando accanto c'è già un ";" a dividere davvero.
const compatDaCella = (v) => {
  const s = String(v ?? "");
  const pezzi = /[|;\n]/.test(s) ? s.split(/[|;\n]+/) : s.split(",");
  return pezzi.map(x => x.trim()).filter(Boolean);
};

// ⚠️ La forma canonica non è un vezzo. list_machines raggruppa per il VALORE
//    ESATTO della stringa e il filtro usa l'operatore jsonb "?", anch'esso
//    esatto: "Mazak 200", "MAZAK 200" e "Mazak 200 " diventerebbero TRE
//    macchinari distinti nel menu, ognuno con una fetta dei ricambi e nessuno
//    con tutti. Si tiene la prima grafia incontrata e la si riusa per tutte
//    le righe successive.
function canonizzatore() {
  const visti = new Map();
  return (nome) => {
    const k = csvKey(nome);
    if (!k) return "";
    if (!visti.has(k)) visti.set(k, String(nome).replace(/\s+/g, " ").trim());
    return visti.get(k);
  };
}

// ── Righe → ricambi, con il rapporto degli scarti ───────────
// Non scrive niente: è la schermata a decidere se e quando.
//
// ⚠️ Gli id li generiamo qui con un CONTATORE, non con i quattro caratteri
//    casuali di addPart. Generando duemila id in un ciclo stretto Date.now()
//    resta fermo per centinaia di righe di fila, e dentro lo stesso
//    millisecondo l'unicità sarebbe appesa al caso: una collisione sulla
//    chiave primaria fa fallire un blocco intero, e l'utente si ritrova un
//    errore che parla di duplicati mentre guarda un file in cui i codici sono
//    tutti diversi. Col contatore è unico per costruzione, ed è anche
//    deterministico: riprovare dopo una caduta di rete non genera id nuovi.
function costruisciRicambi(righe, mappa, primaRigaDati, opzioni = {}) {
  // cartellaFissa: null o assente = la cartella si legge dalla colonna del
  // file; una stringa (anche vuota, che vuol dire radice) = tutti i ricambi
  // di questo import finiscono lì, e la colonna viene ignorata.
  const { cartellaFissa = null } = opzioni;
  const usaColonnaCartella = cartellaFissa === null || cartellaFissa === undefined;
  const pronti = [], scarti = [];
  const canon = canonizzatore();
  const codiciVisti = new Map();
  const grafie = new Map();          // minuscolo → prima grafia incontrata
  const varianti = [];               // codici uguali a meno di maiuscole
  const cartelle = new Set();
  const macchinari = new Set();
  const t0 = Date.now();
  let colonneInEccesso = 0;
  // I valori della mappa possono essere un numero o un array (compatibilità).
  const larghezza = Math.max(
    ...Object.values(mappa).flatMap(v => (Array.isArray(v) ? v : [v])).map(Number), -1) + 1;

  for (let r = primaRigaDati; r < righe.length; r++) {
    const riga = righe[r];
    const nRiga = r + 1;                       // il numero che l'utente vede nel foglio

    // Riga vuota: si salta in silenzio, non è un errore. Sono i separatori di
    // sezione e la coda del file.
    if (!riga.some(c => String(c).trim() !== "")) continue;
    if (riga.length > larghezza && riga.slice(larghezza).some(c => String(c).trim() !== "")) colonneInEccesso++;

    // Righe più corte dell'intestazione sono NORMALI: molti gestionali non
    // scrivono i separatori finali quando le ultime colonne sono vuote.
    const cella = (campo) =>
      (mappa[campo] === undefined ? "" : String(riga[mappa[campo]] ?? "").trim());

    const code = cella("codice");
    const name = cella("nome");
    // Obbligatori esattamente come nel form. Qui cadono da sole anche le
    // righe di totale tipo "TOTALE 2000 articoli".
    if (!code) { scarti.push({ nRiga, motivo: "codice mancante", riga }); continue; }
    if (!name) { scarti.push({ nRiga, motivo: "nome mancante", riga }); continue; }
    if (code.length > 100) { scarti.push({ nRiga, motivo: "codice più lungo di 100 caratteri", riga }); continue; }

    // Stessa espressione del vincolo nel database, btrim(code): il confronto
    // è ESATTO, maiuscole comprese. Va fatto QUI perché un insert di trecento
    // righe è atomico, e un solo doppione vero le fa fallire tutte e trecento.
    if (codiciVisti.has(code)) {
      scarti.push({ nRiga, motivo: `codice doppio nel file, già alla riga ${codiciVisti.get(code)}`, riga });
      continue;
    }
    codiciVisti.set(code, nRiga);

    // Due codici che differiscono SOLO per le maiuscole sono legittimi e
    // vengono scritti tutti e due. Ma sono anche il modo in cui un refuso
    // entra in magazzino travestito da ricambio nuovo: non si scarta niente,
    // si mette in fila un avviso e decide chi guarda.
    const kMin = code.toLowerCase();
    if (grafie.has(kMin)) {
      if (grafie.get(kMin) !== code) varianti.push({ nRiga, code, gemello: grafie.get(kMin) });
    } else {
      grafie.set(kMin, code);
    }

    // Excel l'ha rovinato? Il dato originale non si recupera, ma accorgersene
    // prima di scrivere duemila righe sì.
    const rovinato = /^\d+([.,]\d+)?[eE][+-]?\d+$/.test(code) ? "convertito in notazione scientifica da Excel"
                   : /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(code) ? "convertito in data da Excel" : "";
    if (rovinato) { scarti.push({ nRiga, motivo: `codice ${rovinato}`, riga }); continue; }

    const folder = usaColonnaCartella ? cartellaDaCella(cella("cartella")) : normalizeFolder(cartellaFissa);
    // Ogni colonna scelta viene divisa per conto suo, e solo dopo si unisce:
    // unire prima i testi cambierebbe le regole di divisione dentro la cella
    // ("Mazak, Haas" in una colonna sola si divide sulla virgola, accanto a
    // un'altra colonna non più). Il Set toglie i doppioni fra colonne.
    const colonneCompat = mappa.compatibilita === undefined
      ? []
      : (Array.isArray(mappa.compatibilita) ? mappa.compatibilita : [mappa.compatibilita]);
    const compatibility = [...new Set(
      colonneCompat.flatMap(i => compatDaCella(String(riga[i] ?? ""))).map(canon).filter(Boolean)
    )];
    if (folder) cartelle.add(folder);
    for (const m of compatibility) macchinari.add(m);

    pronti.push({
      id: `p_${t0}_${String(pronti.length).padStart(4, "0")}`,
      code,
      name,
      description: cella("descrizione"),
      category: cella("categoria"),
      folder,                       // stringa vuota per la radice, mai null
      compatibility,
      images: [],
      thumb_url: null,
      photo_url: null,
      _riga: nRiga,                 // solo per il rapporto: non va nel database
    });
  }

  return {
    pronti, scarti, colonneInEccesso, varianti,
    cartelle: [...cartelle].sort(),
    macchinari: [...macchinari].sort(),
  };
}

// Una cella pronta per un CSV: virgolette solo quando servono, raddoppiate
// dentro. È lo stesso contratto che il parser qui sopra sa leggere, così il
// file degli scarti si corregge e si ricarica senza conversioni.
const cellaCSV = (v) => {
  const s = String(v ?? "");
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Scrive un file sul disco dell'amministratore. Il ﻿ iniziale è il BOM:
// senza, Excel riapre il rapporto degli scarti con gli accenti rotti, e
// sarebbe beffardo proprio su un file che serve a riparare.
function scaricaTesto(nomeFile, testo) {
  const url = URL.createObjectURL(new Blob(["﻿" + testo], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeFile;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Rilasciare subito libererebbe l'oggetto prima che il browser lo legga.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ── ABBINARE UNA FOTO AL SUO RICAMBIO ───────────────────────
// Il nome del file È il codice. Le varianti ammesse servono a mettere più
// foto sullo stesso ricambio: "AB-1234 (2).jpg", "AB-1234_2.jpg", "AB-1234-2".
//
// ⚠️ La forma senza suffisso si prova SEMPRE per prima, e c'è un motivo
//    preciso: un codice può finire davvero per "-2". Se si spezzasse prima di
//    aver cercato il nome intero, la foto di "AB-2" finirebbe su "AB" come
//    seconda immagine, e il ricambio giusto resterebbe senza.
const SUFFISSI_FOTO = [
  /^(.+?)\s*\((\d{1,3})\)$/,   // AB-1234 (2).jpg   ← copia di Windows
  /^(.+?)_(\d{1,3})$/,         // AB-1234_2.jpg
  /^(.+?)-(\d{1,3})$/,         // AB-1234-2.jpg
];

function abbinaFoto(nomeFile, perCodice, perMinuscolo) {
  const base = String(nomeFile).replace(/\.[a-z0-9]{1,5}$/i, "").trim();

  const prova = (nome, ordine) => {
    // 1. Identità esatta, maiuscole comprese: è la regola dell'archivio e
    //    qui vince sempre, prima di qualunque tentativo più morbido.
    if (perCodice.has(nome)) {
      const r = perCodice.get(nome);
      return { esito: "esatto", code: nome, id: r.id, conFoto: r.conFoto, ordine };
    }
    // 2. Solo allora si guarda senza maiuscole, e SOLO se non c'è ambiguità.
    //    Windows non distingue "AB.jpg" da "ab.jpg" nella stessa cartella,
    //    quindi da un nome di file non si può ricostruire la grafia esatta:
    //    se in archivio ci sono due ricambi che differiscono solo per le
    //    maiuscole, questa foto può appartenere a uno qualsiasi dei due e
    //    indovinare vorrebbe dire metterla, una volta su due, sul pezzo
    //    sbagliato. Meglio dirlo e farla assegnare a mano.
    const gemelli = perMinuscolo.get(nome.toLowerCase()) || [];
    if (gemelli.length === 1) {
      const c = gemelli[0], r = perCodice.get(c);
      return { esito: "maiuscole", code: c, id: r.id, conFoto: r.conFoto, ordine };
    }
    if (gemelli.length > 1) return { esito: "ambiguo", gemelli, ordine };
    return null;
  };

  const intero = prova(base, 1);
  if (intero) return intero;

  for (const re of SUFFISSI_FOTO) {
    const m = re.exec(base);
    if (!m) continue;
    const spezzato = prova(m[1].trim(), Number(m[2]) || 1);
    if (spezzato) return spezzato;
  }
  return { esito: "assente" };
}

// Normalizza le generazioni di dati che si sono succedute. I ricambi più
// vecchi hanno un array di stringhe base64, poi sono arrivate le coppie di
// URL, ora c'è anche la versione per l'AI. Tutte devono continuare a
// funzionare finché quel ricambio non viene risalvato.
//
// "ai" resta vuoto sui ricambi caricati prima: quelli viaggiano verso il
// modello col solo testo, come facevano tutti fino a ieri. Non è un guasto
// da inseguire, è il passato che scade da solo man mano che si risalva.
function normalizeImages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(Boolean).map(img =>
    typeof img === "string"
      ? { full: img, thumb: img, ai: "" }                          // vecchio formato
      : {
          full:  img.full || "",
          thumb: img.thumb || img.full || "",
          ai:    img.ai || "",
        }
  ).filter(img => img.full);
}

// A parità di qualità percepita il WebP pesa circa un terzo in meno del JPEG.
// Attenzione al tranello: i browser che non lo sanno produrre NON danno errore,
// restituiscono un PNG — che è più pesante del JPEG di partenza. Per questo si
// controlla il prefisso di ciò che è tornato davvero, invece di fidarsi.
function encodeSmallest(canvas, quality) {
  try {
    const webp = canvas.toDataURL("image/webp", quality);
    if (webp.startsWith("data:image/webp")) return webp;
  } catch { /* niente WebP: si prosegue in JPEG */ }
  return canvas.toDataURL("image/jpeg", quality);
}

// Accetta sia un data URL (il caso normale: foto appena scattata) sia un
// indirizzo su Storage (il caso di recupero: rigenerare la versione per l'AI
// di un ricambio caricato prima che esistesse).
//
// ⚠️ crossOrigin va impostato PRIMA di src, e serve solo al secondo caso:
//    senza, il canvas viene marcato "sporco" e toDataURL lancia. Sui data URL
//    non cambia nulla. Se il server non manda gli header CORS l'immagine non
//    carica e si finisce in onerror — vuoto, non un errore da gestire.
function makeThumb(dataUrl, maxSize = 200, quality = 0.65) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
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
        resolve(encodeSmallest(c, quality));
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

// ===================== DIALOGO CON CAMPO =====================
// Come ConfirmDialog, ma c'è qualcosa da scrivere.
//
// window.prompt non è un'alternativa: su un telefono è una finestra di
// sistema che diversi browser incorporati bloccano senza dire niente, non si
// può etichettare, e non c'è modo di mostrare come verrà salvato il valore.
function PromptDialog({ title, hint, placeholder, confirmLabel, initial = "", onConfirm, onCancel }) {
  const [value, setValue] = useState(initial);
  const clean = normalizeFolder(value);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(4,2,107,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 9999, padding: 24, animation: "fadeIn 0.2s ease"
    }}>
      <div style={{
        background: T.card, borderRadius: 20, padding: 24,
        maxWidth: 360, width: "100%", boxShadow: T.shadowLg,
        animation: "fadeUp 0.2s ease"
      }}>
        <p style={{ color: T.text, fontSize: 16, fontWeight: 700, marginBottom: hint ? 6 : 16 }}>
          {title}
        </p>
        {hint && (
          <p style={{ color: T.textLight, fontSize: 12.5, lineHeight: 1.5, marginBottom: 14 }}>{hint}</p>
        )}
        <input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && clean) onConfirm(clean); }}
          placeholder={placeholder}
          style={{
            width: "100%", padding: "12px 14px", borderRadius: 12,
            border: `1.5px solid ${T.border}`, background: T.bg,
            fontSize: 15, color: T.text, marginBottom: 6
          }}
        />
        {/* Si mostra come verrà salvata davvero: barre doppie e spazi ai bordi
            spariscono, e vederlo qui evita di scoprirlo nell'albero. */}
        <div style={{ minHeight: 18, marginBottom: 12 }}>
          {clean && clean !== value.trim() && (
            <span style={{ color: T.blue, fontSize: 11.5 }}>
              Verrà creata come: <strong>{clean}</strong>
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: 12, borderRadius: 12,
            background: T.bg, color: T.textMid, fontSize: 15, fontWeight: 600,
            border: `1px solid ${T.border}`
          }}>Annulla</button>
          <button onClick={() => clean && onConfirm(clean)} disabled={!clean} style={{
            flex: 1, padding: 12, borderRadius: 12,
            background: clean ? T.blue : T.border,
            color: "white", fontSize: 15, fontWeight: 700,
            cursor: clean ? "pointer" : "default"
          }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ===================== SCEGLI UNA CARTELLA =====================
// Si naviga come il catalogo, un livello alla volta, e si conferma dove si
// è arrivati. Un elenco piatto di tutti i percorsi sarebbe stato più veloce
// da scrivere e inservibile: con un albero vero diventa un muro di righe
// quasi identiche, e su un telefono non si legge.
//
// excludePath serve a spostare una CARTELLA: non la si può mettere dentro
// se stessa. Il ramo escluso sparisce dall'elenco, quindi non c'è modo di
// entrarci e trovarsi in un vicolo cieco con un pulsante disattivato.
function FolderPickerDialog({ title, hint, rootLabel, excludePath = "", onPick, onCancel }) {
  const [path, setPath] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const here = path.join("/");
  const excluded = normalizeFolder(excludePath);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    cloud.listFolders(null, here, true)
      .then(f => { if (alive) setFolders(f); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [here]);

  const visible = folders.filter(f => {
    if (!excluded) return true;
    const full = here ? `${here}/${f.folder}` : f.folder;
    return full !== excluded && !full.startsWith(`${excluded}/`);
  });

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(4,2,107,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 9999, padding: 20, animation: "fadeIn 0.2s ease"
    }}>
      <div style={{
        background: T.card, borderRadius: 20, padding: 20,
        maxWidth: 380, width: "100%", maxHeight: "80vh",
        display: "flex", flexDirection: "column",
        boxShadow: T.shadowLg, animation: "fadeUp 0.2s ease"
      }}>
        <p style={{ color: T.text, fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{title}</p>
        {hint && <p style={{ color: T.textLight, fontSize: 12.5, lineHeight: 1.5, marginBottom: 12 }}>{hint}</p>}

        <FolderBreadcrumb
          machine={null}
          path={path}
          rootLabel={rootLabel}
          onMachine={() => setPath([])}
          onPath={setPath}
        />

        <div style={{ flex: 1, overflowY: "auto", marginBottom: 14, minHeight: 80 }}>
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "24px 0" }}><Spinner size={24} /></div>
          ) : visible.length === 0 ? (
            <p style={{ color: T.textLight, fontSize: 13, textAlign: "center", padding: "24px 0" }}>
              Nessuna sottocartella qui dentro.
            </p>
          ) : visible.map(f => (
            <div key={f.folder} onClick={() => setPath([...path, f.folder])} className="tap-sc" style={{
              display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
              padding: "11px 12px", borderRadius: 12, marginBottom: 6,
              background: T.bg, border: `1px solid ${T.border}`
            }}>
              <span style={{ fontSize: 18 }}>📁</span>
              <span style={{ flex: 1, minWidth: 0, color: T.text, fontSize: 14.5, fontWeight: 600 }}>{f.folder}</span>
              <span style={{ color: T.textLight, fontSize: 12 }}>{f.parts || ""}</span>
              <span style={{ color: T.textLight, fontSize: 16 }}>›</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: 12, borderRadius: 12,
            background: T.bg, color: T.textMid, fontSize: 15, fontWeight: 600,
            border: `1px solid ${T.border}`
          }}>Annulla</button>
          <button onClick={() => onPick(here)} className="tap-sc" style={{
            flex: 2, padding: 12, borderRadius: 12,
            background: T.blue, color: "white", fontSize: 15, fontWeight: 700,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
          }}>
            {here ? `Metti in "${path[path.length - 1]}"` : "Metti al primo livello"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===================== PHOTO PICKER =====================
// L'<input> è FUORI dal <label>: se fosse annidato e allo stesso tempo
// referenziato da htmlFor, il browser inoltrerebbe il click due volte
// e su Android la fotocamera si riaprirebbe dopo lo scatto.
function PhotoPicker({ id, disabled, onFile, children, style, accept = "image/*", multiple = false }) {
  return (
    <>
      <label htmlFor={id} style={style}>{children}</label>
      <input
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
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
        {/* Solo la foto in vista si scarica a piena definizione: aprire un
            ricambio con 6 foto costa una foto piena, non sei. */}
        <img src={images[i].full} alt="" loading="lazy" style={{
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
          {/* La striscia usa le miniature: sei anteprime costano ~20 KB */}
          {images.map((img, n) => (
            <button key={n} onClick={() => setIdx(n)} aria-label={`Foto ${n + 1}`} style={{
              flexShrink: 0, width: 54, height: 54, borderRadius: 10,
              overflow: "hidden", padding: 0, background: T.card,
              border: n === i ? `2.5px solid ${T.blue}` : `1px solid ${T.border}`,
              opacity: n === i ? 1 : 0.7,
            }}>
              <img src={img.thumb} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ===================== CAMPO PASSWORD =====================
// Password con l'occhio per rileggerla mentre la si scrive. Non è un vezzo:
// si entra da un telefono, spesso in officina e spesso con i guanti, e una
// password scritta alla cieca è il primo motivo per cui un accesso fallisce
// tre volte di fila — e alla terza il tecnico chiama l'amministratore.
//
// ⚠️ Il pulsante è type="button" ESPLICITO. Dentro un form, un <button> senza
//    type vale "submit": premere l'occhio manderebbe il login invece di
//    mostrare la password.
//
// La visibilità non è ricordata da nessuna parte e riparte sempre nascosta:
// una password che resta in chiaro perché "l'ultima volta l'avevo mostrata"
// è un regalo a chi guarda lo schermo da dietro.
function CampoPassword({
  value, onChange, placeholder, onKeyDown, style,
  autoComplete = "current-password", colore = "white",
}) {
  const [visibile, setVisibile] = useState(false);
  const etichetta = visibile ? "Nascondi la password" : "Mostra la password";
  return (
    <div style={{ position: "relative", marginBottom: style?.marginBottom ?? 0 }}>
      <input
        type={visibile ? "text" : "password"}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoCapitalize="none" autoCorrect="off" spellCheck={false}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        // Lo spazio a destra tiene il testo lontano dall'occhio: senza, una
        // password lunga ci finisce sotto e non si legge proprio quando la
        // si è appena scoperta.
        style={{ ...style, marginBottom: 0, paddingRight: 50 }}
      />
      <button
        type="button"
        onClick={() => setVisibile(v => !v)}
        aria-label={etichetta}
        title={etichetta}
        style={{
          position: "absolute", right: 4, top: 0, bottom: 0, width: 44,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "transparent", border: "none", padding: 0,
          fontSize: 17, color: colore, opacity: visibile ? 1 : 0.6, cursor: "pointer",
        }}>
        {visibile ? "🙈" : "👁️"}
      </button>
    </div>
  );
}

// ===================== LOGIN SCREEN (Supabase Auth) =====================
function LoginScreen({ expiredReason }) {
  const { t } = useT();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [mode, setMode]         = useState("login");   // "login" | "forgot"
  const [sent, setSent]         = useState(false);

  // Il link di recupero riapre l'app: redirectTo deve puntare alla stessa
  // origine, altrimenti Supabase rifiuta il rimando.
  //
  // Nota sulla risposta: si mostra sempre lo stesso messaggio, anche quando
  // l'email non è registrata. Dire "questo indirizzo non esiste" regalerebbe
  // a chiunque un modo per scoprire quali email hanno un account.
  async function sendRecovery() {
    if (!email.trim()) { setError(t("login.fillBoth")); return; }
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    if (error) console.error("resetPassword:", error.message);
    setSent(true);
    setLoading(false);
  }

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
          {mode === "forgot" ? t("login.forgotTitle") : t("login.title")}
        </h3>

        {expiredReason && (
          <div style={{
            background: "rgba(232,119,34,0.18)", border: `1px solid ${T.orange}`,
            borderRadius: 12, padding: "10px 12px", marginBottom: 14
          }}>
            <p style={{ color: "#FFD9C2", fontSize: 12.5, lineHeight: 1.5 }}>
              ⏱️ {expiredReason === "idle"
                    ? t("login.expiredIdle", { h: IDLE_MAX_HOURS })
                    : t("login.expired",     { h: SESSION_MAX_HOURS })}
            </p>
          </div>
        )}

        {mode === "forgot" ? (
          <>
            <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 12.5, lineHeight: 1.55, marginBottom: 14 }}>
              {t("login.forgotBody")}
            </p>

            {sent ? (
              <div style={{
                background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)",
                borderRadius: 12, padding: "12px 14px", marginBottom: 14
              }}>
                <p style={{ color: "white", fontSize: 12.5, lineHeight: 1.55 }}>{t("login.forgotSent")}</p>
              </div>
            ) : (
              <>
                <input
                  type="email" placeholder={t("login.email")} autoComplete="username"
                  inputMode="email" autoCapitalize="none" autoCorrect="off"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(""); }}
                  onKeyDown={e => e.key === "Enter" && sendRecovery()}
                  style={inputStyle}
                />
                {error && <p style={{ color: T.orangeLight, fontSize: 13, marginBottom: 10 }}>⚠️ {error}</p>}
                <button onClick={sendRecovery} disabled={loading} className="tap-sc" style={{
                  width: "100%", padding: 15, borderRadius: 14,
                  background: loading ? "rgba(255,255,255,0.2)" : T.orange,
                  color: "white", fontSize: 16, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8
                }}>
                  {loading ? <><Spinner size={18} color="white" /> {t("login.forgotSending")}</> : t("login.forgotSend")}
                </button>
              </>
            )}

            <button onClick={() => { setMode("login"); setSent(false); setError(""); }} style={{
              width: "100%", marginTop: 12, padding: 10, background: "transparent",
              color: "rgba(255,255,255,0.75)", fontSize: 13.5, fontWeight: 600,
            }}>{t("login.forgotBack")}</button>
          </>
        ) : (
          <>
            <input
              type="email" placeholder={t("login.email")} autoComplete="username"
              inputMode="email" autoCapitalize="none" autoCorrect="off"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(""); }}
              style={inputStyle}
            />
            <CampoPassword
              placeholder={t("login.password")} autoComplete="current-password"
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

            <button onClick={() => { setMode("forgot"); setError(""); }} style={{
              width: "100%", marginTop: 12, padding: 10, background: "transparent",
              color: "rgba(255,255,255,0.75)", fontSize: 13.5, fontWeight: 600,
            }}>{t("login.forgot")}</button>

            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, textAlign: "center", marginTop: 10, lineHeight: 1.5 }}>
              {t("login.note")}
            </p>
          </>
        )}
      </div>

      <Tagline light />
    </div>
  );
}

// ===================== NUOVA PASSWORD (dal link di recupero) =====================
// Ci si arriva aprendo il link ricevuto per email: supabase-js riconosce il
// token nell'indirizzo, apre una sessione temporanea ed emette l'evento
// PASSWORD_RECOVERY. Fino a che la password non è stata cambiata questa
// schermata copre l'app — altrimenti quella sessione darebbe accesso al
// catalogo a chiunque abbia intercettato il link.
function NewPasswordScreen({ onDone }) {
  const { t } = useT();
  const [pwd, setPwd]         = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError]     = useState("");
  const [saving, setSaving]   = useState(false);

  async function save() {
    if (pwd.length < 8)   { setError(t("login.newPwdShort")); return; }
    if (pwd !== confirm)  { setError(t("login.newPwdMismatch")); return; }
    setSaving(true);
    setError("");
    const { error } = await supabase.auth.updateUser({ password: pwd });
    if (error) { setError(error.message); setSaving(false); return; }
    // Si esce e si rientra con la password nuova: così la sessione nasce da
    // un accesso vero e i timer di scadenza ripartono da adesso.
    await supabase.auth.signOut();
    onDone();
  }

  const inputStyle = {
    width: "100%", padding: "15px 18px", borderRadius: 14, marginBottom: 10,
    background: "rgba(255,255,255,0.15)",
    border: `1px solid ${error ? T.orange : "rgba(255,255,255,0.25)"}`,
    color: "white", fontSize: 16,
  };

  return (
    <div className="screen-full" style={{
      background: T.blue, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 20
    }}>
      <div className="fade-up" style={{
        width: "100%", maxWidth: 360,
        background: "rgba(255,255,255,0.10)", backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid rgba(255,255,255,0.18)", borderRadius: 24, padding: 28,
      }}>
        <div style={{ fontSize: 34, textAlign: "center", marginBottom: 10 }}>🔐</div>
        <h3 style={{ color: "white", marginBottom: 8, textAlign: "center", fontSize: 18, fontWeight: 700 }}>
          {t("login.newPwdTitle")}
        </h3>
        <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 12.5, lineHeight: 1.55, marginBottom: 16, textAlign: "center" }}>
          {t("login.newPwdBody")}
        </p>

        {/* Qui l'occhio conta ancora di più che nel login: si sta SCEGLIENDO
            una password, e sbagliarla due volte di fila nello stesso modo
            significa restare fuori senza capire perché. */}
        <CampoPassword
          placeholder={t("login.newPwd")} autoComplete="new-password"
          value={pwd} onChange={e => { setPwd(e.target.value); setError(""); }}
          style={inputStyle}
        />
        <CampoPassword
          placeholder={t("login.newPwdConfirm")} autoComplete="new-password"
          value={confirm} onChange={e => { setConfirm(e.target.value); setError(""); }}
          onKeyDown={e => e.key === "Enter" && save()}
          style={inputStyle}
        />

        {error && <p style={{ color: T.orangeLight, fontSize: 13, marginBottom: 10 }}>⚠️ {error}</p>}

        <button onClick={save} disabled={saving} className="tap-sc" style={{
          width: "100%", padding: 15, borderRadius: 14,
          background: saving ? "rgba(255,255,255,0.2)" : T.orange,
          color: "white", fontSize: 16, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8
        }}>
          {saving ? <><Spinner size={18} color="white" /> {t("login.newPwdSaving")}</> : t("login.newPwdSave")}
        </button>
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
function UserApp({ partsCount, sessionUnverified, reloadParts, loadError, onLogout, userEmail }) {
  const [tab, setTab] = useState("scan");
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const { t, lang } = useT();

  // La valutazione si scrive e basta. Non serve più rileggere e riaggregare
  // tutti i feedback: a usarli è il server, alla scansione successiva.
  async function handleFeedback(payload) {
    await cloud.addFeedback(payload);
  }

  useEffect(() => {
    let alive = true;
    setHistoryLoading(true);
    setHistoryError(false);
    // Prima si pota, poi si legge: così l'elenco non mostra per un istante
    // scansioni che stanno per sparire.
    cloud.purgeOldHistory()
      .then(() => cloud.loadHistory())
      .then(h => { if (alive) setHistory(h); })
      .catch(() => { if (alive) setHistoryError(true); })
      .finally(() => { if (alive) setHistoryLoading(false); });
    return () => { alive = false; };
  }, []);

  async function addToHistory(item) {
    setHistory(prev => [item, ...prev]);
    const thumb = item.image
      ? await makeThumb(item.image, HISTORY_THUMB_PX, HISTORY_THUMB_Q)
      : "";
    await cloud.addHistory({ ...item, image: thumb });
  }

  async function clearHistory() {
    const n = await cloud.clearHistory();
    if (n > 0) setHistory([]);
    return n;
  }

  return (
    <div className="app-shell">
      <Header title="WERFEN SCAN" subtitle={userEmail || t("app.subtitle")} onLogout={onLogout} showLang />
      <div className="app-content">
        {/* Il caso che ha reso difficile diagnosticare il catalogo vuoto: la
            verifica di sessione non risponde, le policy RLS negano ogni riga,
            e a schermo sembra semplicemente che non ci siano ricambi. */}
        {sessionUnverified && partsCount === 0 && (
          <div style={{
            margin: 16, background: "#FEF2F2", border: "1px solid #FECACA",
            borderRadius: 14, padding: "12px 14px", color: T.error,
            fontSize: 13, lineHeight: 1.5
          }}>⚠️ {t("error.sessionUnverified")}</div>
        )}
        {tab === "scan"    && <ScanScreen partsCount={partsCount} onAddHistory={addToHistory} reloadParts={reloadParts} loadError={loadError} onFeedback={handleFeedback} />}
        {tab === "catalog" && <CatalogScreen partsCount={partsCount} />}
        {tab === "history" && (
          <HistoryScreen
            history={history}
            loading={historyLoading}
            error={historyError}
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
function ScanScreen({ partsCount, onAddHistory, reloadParts, loadError, onFeedback }) {
  const { t, lang } = useT();
  const [image, setImage]         = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState("");
  const [imgLoading, setImgLoading] = useState(false);
  const [machines, setMachines]   = useState([]);

  // Il macchinario scelto resta memorizzato: chi lavora tutto il giorno sulla
  // stessa macchina lo seleziona una volta e non ci pensa più.
  const [machine, setMachineState] = useState(() => {
    try { return localStorage.getItem(SCAN_MACHINE_KEY) || ""; } catch { return ""; }
  });
  function setMachine(m) {
    setMachineState(m);
    try {
      if (m) localStorage.setItem(SCAN_MACHINE_KEY, m);
      else   localStorage.removeItem(SCAN_MACHINE_KEY);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    let alive = true;
    cloud.listMachines().then(m => { if (alive) setMachines(m); });
    return () => { alive = false; };
  }, []);

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
    if (partsCount === 0) {
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

      // Si spedisce solo la foto. Catalogo e valutazioni dei tecnici li legge
      // il server dal database: rispedirglieli da qui significava caricare
      // decine di KB su rete mobile per riportargli dati che aveva già.
      //
      // 🔑 Nessuna chiave qui: la aggiunge il server in /api/analyze
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          image: { media_type: mediaType, data: base64 },
          machine,  // vuoto = tutto il catalogo, entro il tetto del prompt
          lang,     // il server chiede all'AI di rispondere in questa lingua
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);

      // Il server risponde con l'id del ricambio: la scheda si chiede adesso,
      // una riga sola. Prima si cercava in un catalogo tenuto tutto in memoria.
      const matchedPart = payload.matched && payload.id
        ? await cloud.getPart(payload.id).catch(() => null)
        : null;

      const finalResult = {
        matched: !!payload.matched && !!matchedPart,
        confidence: Number(payload.confidence) || 0,
        reasoning: payload.reasoning || "",
        part: matchedPart || null,
        partial: payload.partial || null,   // il confronto ha coperto tutto?
        photosPartial: payload.photosPartial || null,   // ...e con quante foto?
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
    <ResultCard result={result} onReset={reset} onFeedback={onFeedback} />
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

      {/* Restringere al macchinario è ciò che rende sostenibile un catalogo
          da migliaia di pezzi: il confronto passa da tutto il magazzino alle
          poche decine di ricambi di quella macchina. */}
      {machines.length > 0 && (
        <div style={{
          background: T.card, border: `1px solid ${T.border}`, borderRadius: 14,
          padding: "12px 14px", marginBottom: 12
        }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: T.textMid, marginBottom: 6 }}>
            🗂️ {t("scan.machine")}
          </label>
          <select
            value={machine} onChange={e => setMachine(e.target.value)} disabled={analyzing}
            style={{
              width: "100%", padding: "11px 12px", borderRadius: 12,
              border: `1.5px solid ${machine ? T.blue : T.border}`,
              background: T.bg, fontSize: 15, color: T.text,
            }}>
            <option value="">{t("scan.machineAll")}</option>
            {machines.map(m => (
              <option key={m.machine} value={m.machine}>{m.machine} ({m.parts})</option>
            ))}
          </select>
          {!machine && (
            <p style={{ color: T.textLight, fontSize: 11.5, marginTop: 7, lineHeight: 1.5 }}>
              {t("scan.machineHint")}
            </p>
          )}
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

      {partsCount > 0 && (
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
            <p style={{ color: T.text, fontWeight: 700, fontSize: 15 }}>{t("scan.partsCount", { n: partsCount })}</p>
            <p style={{ color: T.textLight, fontSize: 12 }}>{t("scan.ready")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ===================== BRICIOLE DI PANE =====================
// Dove sono e come risalire. Ogni pezzo è toccabile: tornare su di tre
// livelli non deve costare tre tocchi su un tasto "indietro" — su un telefono
// tenuto con una mano sola quella differenza si sente.
//
// La usano sia il tecnico sia l'amministratore: la navigazione è la stessa,
// cambia solo cosa si può fare una volta arrivati.
function FolderBreadcrumb({ machine, path, onMachine, onPath, rootLabel }) {
  const steps = [
    { key: "root", label: rootLabel, go: () => { onMachine(null); onPath([]); } },
    ...(machine ? [{ key: "machine", label: `🗂️ ${machine}`, go: () => onPath([]) }] : []),
    ...path.map((seg, i) => ({ key: `s${i}`, label: seg, go: () => onPath(path.slice(0, i + 1)) })),
  ];

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", marginBottom: 12 }}>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0 }}>
            {i > 0 && <span style={{ color: T.textLight, fontSize: 13 }}>›</span>}
            <button onClick={s.go} className="tap-sc" style={{
              background: last ? T.blue : T.bluePale,
              color: last ? "white" : T.blue,
              border: `1px solid ${T.blue}33`,
              borderRadius: 10, padding: "6px 10px",
              fontSize: 13, fontWeight: 600,
              maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{s.label}</button>
          </span>
        );
      })}
    </div>
  );
}

// ===================== CATALOG =====================
function CatalogScreen({ partsCount }) {
  const { t } = useT();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [machine, setMachine] = useState("");       // "" = tutti i macchinari
  const [machines, setMachines] = useState([]);
  const [path, setPath] = useState([]);             // cartella aperta, un segmento per livello
  const [folders, setFolders] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed]   = useState(false);

  const q = useDebounced(search.trim());
  const searching = q.length > 0;
  const folderPath = path.join("/");

  // ⚠️ Il macchinario è un FILTRO, non un cancello. Prima era il primo
  //    livello obbligatorio del catalogo: si arrivava alle cartelle solo dopo
  //    aver aperto un macchinario. Con un ricambio generico — compatibilità
  //    vuota, perché va bene su tutto — list_machines() non restituisce
  //    niente e il tecnico si trovava davanti a una schermata cieca, senza
  //    modo di raggiungere le cartelle che l'amministratore vede benissimo.
  //
  //    Ora l'albero è lo stesso nelle due aree: si apre sulle cartelle, e il
  //    macchinario semmai le restringe.
  useEffect(() => {
    let alive = true;
    cloud.listMachines().then(m => { if (alive) setMachines(m || []); });
    return () => { alive = false; };
  }, []);

  // Le sottocartelle di dove ci si trova. Durante una ricerca non si mostrano:
  // i risultati arrivano da tutto il sottoalbero, e disegnare sopra di loro
  // delle cartelle da aprire suggerirebbe il contrario.
  //
  // include_empty come in amministrazione: il tecnico deve vedere lo STESSO
  // albero, o una cartella ancora da riempire sembrerebbe non esistere e
  // nessuno saprebbe dove cercare.
  useEffect(() => {
    if (searching) { setFolders([]); return; }
    let alive = true;
    cloud.listFolders(machine, folderPath, true).then(f => { if (alive) setFolders(f); });
    return () => { alive = false; };
  }, [machine, folderPath, searching]);

  // I ricambi che stanno ESATTAMENTE qui. Quelli delle sottocartelle si
  // vedono entrandoci — si scende finché non si arriva ai pezzi, e ogni
  // schermata mostra una cosa sola: o dove andare, o cosa c'è.
  //
  // Cercando è diverso: search_parts allarga a tutto il sottoalbero, perché
  // scrivere una parola dentro una cartella e non trovare ciò che sta due
  // livelli sotto sarebbe la cosa più frustrante possibile.
  //
  // Alla radice "esattamente qui" vuol dire i ricambi che non stanno in
  // nessuna cartella: quelli generici, e quelli non ancora sistemati.
  const rootOnly = !searching && path.length === 0;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    cloud.searchParts(q, machine, folderPath, CATALOG_MAX_ROWS, rootOnly)
      .then(r => { if (alive) setResults(r); })
      .catch(() => { if (alive) { setResults([]); setFailed(true); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [q, machine, folderPath, rootOnly]);

  if (selected) return <PartDetail part={selected} onBack={() => setSelected(null)} />;

  const visible = results;
  const atLimit = results.length >= CATALOG_MAX_ROWS;
  // Un livello vuoto è diverso da una ricerca senza risultati: qui non c'è
  // né una cartella da aprire né un ricambio da vedere.
  const nothingHere = folders.length === 0 && results.length === 0;

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 16, letterSpacing: "-0.4px" }}>
        {t("cat.title")}
      </h2>

      {/* Il macchinario restringe l'albero, non lo sostituisce. Compare solo
          se qualche ricambio dichiara una compatibilità: con un catalogo di
          pezzi generici non serve a niente e occuperebbe spazio per nulla. */}
      {machines.length > 0 && (
        <select
          value={machine}
          onChange={e => { setMachine(e.target.value); setPath([]); }}
          style={{
            width: "100%", padding: "12px 14px", borderRadius: 14, marginBottom: 12,
            border: `1.5px solid ${machine ? T.blue : T.border}`,
            background: T.card, fontSize: 15, color: T.text,
          }}>
          <option value="">⚙️ {t("scan.machineAll")}</option>
          {machines.map(m => (
            <option key={m.machine} value={m.machine}>{m.machine} ({m.parts})</option>
          ))}
        </select>
      )}

      {path.length > 0 && (
        <FolderBreadcrumb
          machine={null}
          path={path}
          rootLabel={`← ${t("cat.root")}`}
          onMachine={() => setPath([])}
          onPath={setPath}
        />
      )}

      <div style={{ position: "relative", marginBottom: 16 }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: T.textLight }}>🔍</span>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder={machine ? t("cat.searchIn", { m: machine }) : t("cat.search")}
          style={{
            width: "100%", padding: "13px 16px 13px 42px", borderRadius: 14,
            border: `1.5px solid ${T.border}`, background: T.card, fontSize: 15, color: T.text
          }}
        />
      </div>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "48px 0" }}>
          <Spinner size={30} />
        </div>
      ) : failed ? (
        <div style={{
          background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 14,
          padding: "12px 14px", color: T.error, fontSize: 13, lineHeight: 1.5
        }}>⚠️ {t("error.dbUnreachable")}</div>
      ) : nothingHere ? (
        // Tre situazioni che si assomigliano e hanno rimedi diversi: una
        // ricerca a vuoto, una cartella ancora da riempire, e un catalogo
        // che non ha proprio niente dentro.
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>
            {partsCount === 0 && !searching ? "📦" : "🔍"}
          </div>
          <p style={{ color: T.text, fontWeight: 700 }}>
            {searching ? t("cat.noResults", { q: search })
              : path.length ? t("cat.emptyFolder")
              : partsCount === 0 ? t("cat.empty")
              : machine ? t("cat.emptyMachine")
              : t("cat.emptyFolder")}
          </p>
          {partsCount === 0 && !searching && (
            <p style={{ color: T.textLight, fontSize: 14, marginTop: 6, lineHeight: 1.5 }}>
              {t("cat.emptyHint")}
            </p>
          )}
        </div>
      ) : (
        <>
        {/* Prima dove si può scendere, poi cosa c'è a questo livello. Nella
            maggior parte delle schermate una delle due parti è vuota, ed è
            giusto così: o si sceglie una strada, o si guardano i pezzi. */}
        {!searching && folders.map((f, i) => (
          <div key={f.folder} onClick={() => setPath([...path, f.folder])} className="fade-in tap-sc" style={{
            background: T.card, borderRadius: 16, marginBottom: 10,
            border: `1px solid ${T.border}`, padding: 14, cursor: "pointer",
            display: "flex", gap: 12, alignItems: "center",
            boxShadow: T.shadow, animationDelay: `${i * 0.03}s`
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: T.orangePale,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22
            }}>📁</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: T.text, fontSize: 15.5 }}>{f.folder}</div>
              {/* Due numeri quando differiscono: "qui" è quel che si vedrà
                  aprendo la cartella, "in tutto" comprende le sottocartelle.
                  Mostrarne uno solo faceva sembrare il conteggio sbagliato —
                  la cartella dichiarava 8 e aperta ne mostrava 2. */}
              <div style={{ color: T.textLight, fontSize: 12.5, marginTop: 2 }}>
                {f.direct === f.parts
                  ? t("cat.folderParts", { n: f.parts })
                  : t("cat.folderSplit", { d: f.direct, n: f.parts })}
                {f.hasChildren ? ` · ${t("cat.hasSubfolders")}` : ""}
              </div>
            </div>
            <span style={{ color: T.textLight, fontSize: 18 }}>›</span>
          </div>
        ))}
        {visible.map((part, i) => (
          <div key={part.id} onClick={() => setSelected(part)} className="fade-in tap-sc" style={{
            background: T.card, borderRadius: 16, marginBottom: 10,
            border: `1px solid ${T.border}`, padding: 14,
            display: "flex", gap: 12, alignItems: "center",
            boxShadow: T.shadow, animationDelay: `${i * 0.03}s`, cursor: "pointer"
          }}>
            {/* loading="lazy": il browser scarica la miniatura solo quando la
                riga entra davvero nello schermo, non perché è nell'elenco. */}
            {part.thumbUrl ? (
              <img src={part.thumbUrl} alt="" loading="lazy" decoding="async" style={{ width: 64, height: 64, borderRadius: 12, objectFit: "cover", flexShrink: 0, background: T.bluePale }} />
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
        ))}
        {atLimit && (
          <p style={{ textAlign: "center", color: T.textLight, fontSize: 13, padding: "14px 8px", lineHeight: 1.5 }}>
            {t("cat.tooMany", { n: CATALOG_MAX_ROWS })}
          </p>
        )}
        </>
      )}
    </div>
  );
}

function PartDetail({ part: light, onBack }) {
  const { t } = useT();
  const [images, setImages] = useState([]);
  // La riga che arriva dall'elenco è leggera: codice, nome, categoria. La
  // descrizione e le compatibilità si chiedono solo ora, insieme alle foto —
  // sono il grosso del peso, e servono a un ricambio alla volta.
  const [part, setPart] = useState(light);

  useEffect(() => {
    let alive = true;
    cloud.getPart(light.id)
      .then(full => { if (alive) setPart(full); })
      .catch(() => {});
    cloud.loadPartImages(light.id)
      .then(imgs => { if (alive && imgs.length) setImages(imgs); })
      .catch(() => {});
    return () => { alive = false; };
  }, [light.id]);

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
            {/* Dove sta il pezzo nel catalogo. Serve a chi ci è arrivato da una
                ricerca o da una scansione, e quindi non ha attraversato l'albero. */}
            {part.folder && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: "8px 12px" }}>
                <span style={{ fontSize: 13 }}>📁</span>
                <span style={{ color: T.textMid, fontSize: 13, fontWeight: 600 }}>
                  {folderSegments(part.folder).join(" › ")}
                </span>
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
function ResultCard({ result, onReset, onFeedback }) {
  const { t } = useT();
  const { matched, part, confidence, reasoning } = result;
  const pct = Math.max(0, Math.min(100, Number(confidence) || 0));

  // Galleria del pezzo riconosciuto: è qui che serve di più, perché il
  // tecnico confronta la foto appena scattata con le angolazioni di riferimento.
  // Parte dalla miniatura già in memoria — compare subito, sfocata — e viene
  // sostituita dalla galleria a piena definizione appena arriva.
  const [gallery, setGallery] = useState(
    part?.thumbUrl ? [{ full: part.thumbUrl, thumb: part.thumbUrl }] : []
  );
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

  // Candidati plausibili: li calcola il database per somiglianza. Si chiedono
  // solo quando il tecnico dice "sbagliato", non a ogni scansione riuscita.
  const [similar, setSimilar] = useState([]);
  useEffect(() => {
    if (phase !== "wrong" || !part?.id || similar.length) return;
    let alive = true;
    cloud.similarParts(part.id, 5).then(r => { if (alive) setSimilar(r); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, part?.id]);

  // Ricerca libera fra i ricambi, per quando i simili non bastano.
  const sq = useDebounced(search.trim());
  const [searchResults, setSearchResults] = useState([]);
  useEffect(() => {
    if (!sq) { setSearchResults([]); return; }
    let alive = true;
    cloud.searchParts(sq, null, null, 6)   // nessun macchinario, nessuna cartella
      .then(r => { if (alive) setSearchResults(r); })
      .catch(() => { if (alive) setSearchResults([]); });
    return () => { alive = false; };
  }, [sq]);

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
      {p.thumbUrl
        ? <img src={p.thumbUrl} alt="" loading="lazy" style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
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
          {/* Un "non trovato" su un confronto parziale non vuol dire che il
              pezzo non sia a catalogo: va detto, o il tecnico ci crede. */}
          {result.partial && (
            <div style={{
              background: T.orangePale, border: `1px solid ${T.orange}`,
              borderRadius: 12, padding: "12px 14px", marginBottom: 16
            }}>
              <p style={{ color: "#92400E", fontSize: 13, fontWeight: 700, marginBottom: 3 }}>
                ⚠️ {t("scan.partialTitle")}
              </p>
              <p style={{ color: "#92400E", fontSize: 12.5, lineHeight: 1.5 }}>
                {t("scan.partialBody", { n: result.partial.compared })}
              </p>
            </div>
          )}
          {/* Taglio diverso, avviso diverso: qui il catalogo è stato letto
              tutto, ma su una parte dei ricambi il confronto è avvenuto solo
              sulla descrizione, senza foto di riferimento. */}
          {result.photosPartial && (
            <div style={{
              background: T.orangePale, border: `1px solid ${T.orange}`,
              borderRadius: 12, padding: "12px 14px", marginBottom: 16
            }}>
              <p style={{ color: "#92400E", fontSize: 13, fontWeight: 700, marginBottom: 3 }}>
                ⚠️ {t("scan.photosPartialTitle")}
              </p>
              <p style={{ color: "#92400E", fontSize: 12.5, lineHeight: 1.5 }}>
                {t("scan.photosPartialBody", {
                  n: result.photosPartial.sent,
                  tot: result.photosPartial.total,
                })}
              </p>
            </div>
          )}
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
function HistoryScreen({ history, loading, error, onClear }) {
  const { t, lang } = useT();
  const [open, setOpen]                 = useState(false);
  const [text, setText]                 = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing]         = useState(false);
  const [clearError, setClearError]     = useState("");
  const [clearNote, setClearNote]       = useState("");

  // Il filtro lavora in locale sulle righe già scaricate. Non serve un filtro
  // sul database: la finestra di conservazione è di pochi giorni, quindi qui
  // dentro non ci sono mai più di poche centinaia di scansioni.
  const q = text.trim().toLowerCase();
  const shown = q
    ? history.filter(h =>
        (h.part?.name || "").toLowerCase().includes(q) ||
        (h.part?.code || "").toLowerCase().includes(q))
    : history;

  const inputStyle = {
    width: "100%", padding: "11px 12px", borderRadius: 12,
    border: `1.5px solid ${T.border}`, background: T.bg, fontSize: 15, color: T.text,
  };
  const smallLabel = { display: "block", fontSize: 12, fontWeight: 600, color: T.textMid, marginBottom: 5 };

  async function doClear() {
    setClearing(true); setClearError(""); setClearNote("");
    try {
      const n = await onClear();
      // Zero righe cancellate senza errore è il sintomo della policy di DELETE
      // mancante: va detto, altrimenti l'utente crede di aver svuotato tutto.
      setClearNote(n > 0 ? t("hist.cleared", { n }) : t("hist.clearedNone"));
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
          <p style={{ color: T.textLight, fontSize: 12, marginTop: 3 }}>
            {t("hist.last", { n: HISTORY_RETENTION_DAYS })}
          </p>
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
          <label style={smallLabel}>{t("hist.part")}</label>
          <input value={text} onChange={e => setText(e.target.value)}
            placeholder={t("hist.filterPart")}
            style={{ ...inputStyle, marginBottom: 12 }} />

          <p style={{ color: T.textLight, fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}>
            ⏳ {t("hist.autoDelete", { n: HISTORY_RETENTION_DAYS })}
          </p>

          <button onClick={() => setConfirmClear(true)} disabled={clearing} style={{
            width: "100%", padding: 11, borderRadius: 12,
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

      {clearNote && (
        <div style={{
          background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 14,
          padding: "12px 14px", marginBottom: 12, color: T.success, fontSize: 13, lineHeight: 1.5
        }}>{clearNote}</div>
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
            {q ? t("hist.noResults") : t("hist.noneInPeriod", { n: HISTORY_RETENTION_DAYS })}
          </p>
          <p style={{ color: T.textLight, fontSize: 14, marginTop: 6, lineHeight: 1.5 }}>
            {q ? t("hist.noMatchText", { q: text }) : t("hist.hintScan")}
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
function AdminApp({ partsCount, onAddPart, onUpdatePart, onDeletePart, reloadParts, loadError, onLogout, userEmail }) {
  const [tab, setTab] = useState("parts");
  const [editingPart, setEditingPart] = useState(null);

  // Cambiando questo numero la lista rilancia la sua ricerca: è il modo di
  // farla aggiornare senza tenere il catalogo in uno stato condiviso.
  const [listVersion, setListVersion] = useState(0);
  // Rilancia la ricerca della lista E rilegge il totale dal server. Prima
  // rifaceva solo la prima: il numerone "ricambi registrati" veniva tenuto
  // con l'aritmetica locale (+1 / −1) e restava sbagliato dopo una modifica
  // fatta da un altro dispositivo, senza che nessun pulsante lo correggesse.
  const refreshList = () => { setListVersion(v => v + 1); reloadParts(); };

  // La cartella da cui è partito "+ Aggiungi": chi crea una cartella, ci
  // entra e aggiunge un pezzo si aspetta che il pezzo finisca lì, non che
  // debba riscrivere il percorso a mano nel form.
  const [newPartFolder, setNewPartFolder] = useState("");
  // La cartella che si sta sfogliando nella lista. Vive qui e non là dentro
  // perché serve anche al tasto "➕ Aggiungi" della barra in basso, che
  // cambia schermata: senza, si perdeva la cartella aperta e il ricambio
  // nasceva alla radice proprio mentre lo stavi mettendo a posto.
  const [browsingFolder, setBrowsingFolder] = useState("");

  function handleEdit(part)  { setEditingPart(part); setTab("add"); }
  function handleAddNew(folder) {
    setEditingPart(null);
    setNewPartFolder(typeof folder === "string" ? folder : browsingFolder);
    setTab("add");
  }
  function handleDone()      { setEditingPart(null); setNewPartFolder(""); setTab("parts"); reloadParts(); refreshList(); }

  return (
    <div className="app-shell">
      <Header title="WERFEN SCAN Admin" subtitle="Area amministratore" onLogout={onLogout} />
      <div className="app-content">
        {tab === "parts" && <PartsListScreen partsCount={partsCount} version={listVersion} onRefresh={refreshList} onEdit={handleEdit} onAdd={handleAddNew} onBrowse={setBrowsingFolder} onDeletePart={onDeletePart} onImport={() => setTab("import")} onFoto={() => setTab("foto")} loadError={loadError} />}
        {/* Non è una voce della barra in basso: l'import si fa una volta o
            due nella vita del catalogo, e una quarta voce fissa costerebbe
            spazio su ogni schermata per sempre. Ci si arriva dal catalogo. */}
        {tab === "import" && <ImportScreen onDone={handleDone} onBack={() => setTab("parts")} />}
        {tab === "foto" && <FotoBulkScreen onDone={handleDone} onBack={() => setTab("parts")} />}
        {/* La key forza il remount passando da Edit a New Part: senza,
            il form resterebbe precompilato col ricambio in modifica. */}
        {tab === "add" && (
          <AddEditPartScreen
            key={editingPart?.id || `new:${newPartFolder}`}
            editingPart={editingPart}
            defaultFolder={newPartFolder}
            onAddPart={onAddPart}
            onUpdatePart={onUpdatePart}
            onDone={handleDone}
          />
        )}
        {tab === "settings" && <SettingsScreen partsCount={partsCount} userEmail={userEmail} />}
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
function PartsListScreen({ partsCount, version, onRefresh, onEdit, onAdd, onBrowse, onDeletePart, onImport, onFoto, loadError }) {
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [machine, setMachine] = useState("");
  const [machines, setMachines] = useState([]);
  const [path, setPath] = useState([]);
  const [folders, setFolders] = useState([]);
  const [newFolder, setNewFolder] = useState(false);       // dialogo di creazione aperto
  const [confirmFolder, setConfirmFolder] = useState(null); // cartella in attesa di conferma
  const [folderMenu, setFolderMenu] = useState(null);       // cartella col menu ⋯ aperto
  const [renamingFolder, setRenamingFolder] = useState(null); // cartella da rinominare
  const [movingFolder, setMovingFolder] = useState(null);   // cartella da spostare altrove
  const [partMenu, setPartMenu] = useState(null);           // ricambio col menu ⋯ aperto
  const [movingPart, setMovingPart] = useState(null);       // ricambio da spostare
  const [folderVersion, setFolderVersion] = useState(0);    // ricarica l'albero dopo una modifica

  // Stessa ricerca lato server e stesse regole sulle immagini della schermata
  // tecnico: l'area amministratore non è esente dal risparmio, ci si passa
  // anzi più tempo. "version" cambia dopo ogni salvataggio o eliminazione e
  // fa ripartire la query.
  const q = useDebounced(search.trim());
  const searching = q.length > 0;
  const folderPath = path.join("/");
  // Anche una cartella aperta conta come navigazione: senza, entrando in una
  // cartella dalla radice si vedrebbero solo le prime righe senza foto.
  const browsing = searching || !!machine || path.length > 0;

  useEffect(() => {
    let alive = true;
    cloud.listMachines().then(m => { if (alive) setMachines(m); });
    return () => { alive = false; };
  }, [version]);

  // Il percorso si azzera nell'handler del menu a tendina, non qui: farlo in
  // un effetto lasciava un render intermedio con macchinario NUOVO e cartella
  // VECCHIA, e faceva partire due giri di richieste, il primo su un percorso
  // che in quel macchinario non esiste.

  // La cartella aperta va comunicata al contenitore: il tasto "➕ Aggiungi"
  // della barra in basso cambia schermata, e senza questo il nuovo ricambio
  // nascerebbe alla radice proprio mentre lo stai mettendo a posto.
  useEffect(() => { onBrowse?.(folderPath); }, [folderPath, onBrowse]);

  // Le cartelle di questo livello, comprese quelle vuote: è la differenza
  // fra chi consulta il catalogo e chi lo costruisce. Si vedono anche senza
  // aver scelto un macchinario — riordinare non si fa una macchina alla volta.
  useEffect(() => {
    if (searching) { setFolders([]); return; }
    let alive = true;
    cloud.listFolders(machine, folderPath, true).then(f => { if (alive) setFolders(f); });
    return () => { alive = false; };
  }, [machine, folderPath, searching, version, folderVersion]);

  // Ogni livello mostra solo ciò che sta esattamente lì, come per il tecnico.
  // Alla radice questo vuol dire i ricambi che non hanno nessuna cartella:
  // quelli da sistemare. È anche ciò che tiene la schermata d'ingresso senza
  // immagini — caricare le miniature dell'intero catalogo per poi scendere
  // subito in una cartella sarebbe traffico buttato.
  const rootOnly = !searching && path.length === 0;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    cloud.searchParts(q, machine, folderPath, browsing ? CATALOG_MAX_ROWS : CATALOG_PREVIEW_ROWS, rootOnly)
      .then(r => { if (alive) setFiltered(r); })
      .catch(() => { if (alive) setFiltered([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [q, machine, folderPath, browsing, rootOnly, version]);

  // ── Creare e togliere cartelle ─────────────────────────────
  async function addFolder(name) {
    setNewFolder(false);
    setActionError("");
    try {
      await cloud.createFolder([...path, name].join("/"));
      setFolderVersion(v => v + 1);
    } catch (e) {
      setActionError(`Impossibile creare la cartella: ${e.message || "controlla la connessione"}. La creazione è consentita solo all'account amministratore.`);
    }
  }

  // Spostare una cartella: la destinazione scelta diventa il suo nuovo
  // genitore, il nome resta. "Idraulica/Valvole" messa in "Fluidi" diventa
  // "Fluidi/Valvole", e tutto quello che c'era dentro la segue.
  async function moveFolder(destination) {
    const f = movingFolder;
    setMovingFolder(null);
    setActionError("");
    if (!f) return;
    const from = [...path, f.folder].join("/");
    const to   = destination ? `${destination}/${f.folder}` : f.folder;
    if (from === to) return;
    try {
      await cloud.renameFolder(from, to);
      setFolderVersion(v => v + 1);
      onRefresh();
    } catch (e) {
      setActionError(`Impossibile spostare la cartella: ${e.message || "controlla la connessione"}.`);
    }
  }

  // Rinominare è lo stesso gesto dello spostare, visto da vicino: cambia
  // l'ultimo pezzo del percorso invece del prefisso. Per questo usa la stessa
  // funzione, e per questo scrivendo "Valvole/Sicurezza" si ottengono due
  // livelli in un colpo.
  async function renameFolderTo(newName) {
    const f = renamingFolder;
    setRenamingFolder(null);
    setActionError("");
    if (!f) return;
    const from = [...path, f.folder].join("/");
    const to   = [...path, newName].join("/");
    if (from === to) return;
    try {
      await cloud.renameFolder(from, to);
      setFolderVersion(v => v + 1);
      onRefresh();
    } catch (e) {
      setActionError(`Impossibile rinominare la cartella: ${e.message || "controlla la connessione"}.`);
    }
  }

  async function movePartTo(destination) {
    const p = movingPart;
    setMovingPart(null);
    setActionError("");
    if (!p) return;
    try {
      await cloud.movePart(p.id, destination);
      setFolderVersion(v => v + 1);
      onRefresh();
    } catch (e) {
      setActionError(`Impossibile spostare il ricambio: ${e.message || "controlla la connessione"}. L'operazione è consentita solo all'account amministratore.`);
    }
  }

  async function removeFolder(f) {
    setConfirmFolder(null);
    setActionError("");
    try {
      await cloud.deleteFolder([...path, f.folder].join("/"));
      setFolderVersion(v => v + 1);
      // I ricambi hanno cambiato cartella: senza questo la lista resterebbe
      // a mostrare lo stato di un istante fa.
      onRefresh();
    } catch (e) {
      setActionError(`Impossibile eliminare la cartella: ${e.message || "controlla la connessione"}. L'operazione è consentita solo all'account amministratore.`);
    }
  }

  async function deletePart(id) {
    setActionError("");
    try { await onDeletePart(id); onRefresh(); }
    catch (e) {
      console.error(e);
      setActionError(`Impossibile eliminare: ${e.message || "controlla la connessione"}. Se hai attivato RLS, le scritture sono consentite solo all'account admin.`);
    }
    setConfirmDelete(null);
  }

  async function refresh() {
    setRefreshing(true);
    onRefresh();
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

      {newFolder && (
        <PromptDialog
          title={path.length ? `Nuova cartella dentro "${path[path.length - 1]}"` : "Nuova cartella"}
          hint={'Solo il nome, non il percorso: la posizione è quella in cui ti trovi. Puoi comunque scrivere "Valvole/Sicurezza" per creare due livelli in un colpo.'}
          placeholder="es. Valvole"
          confirmLabel="Crea"
          onConfirm={addFolder}
          onCancel={() => setNewFolder(false)}
        />
      )}

      {/* Il messaggio dice esattamente dove finiscono i ricambi. "Elimina"
          su una cartella piena è il gesto che spaventa di più: se non si
          legge cosa succede al contenuto, non lo si tocca mai. */}
      {confirmFolder && (
        <ConfirmDialog
          message={
            confirmFolder.parts === 0
              ? `Eliminare la cartella "${confirmFolder.folder}"? È vuota: sparisce solo dall'elenco, nessun ricambio viene toccato.`
              : `Eliminare la cartella "${confirmFolder.folder}"? I suoi ${confirmFolder.parts} ricambi NON vengono cancellati: passano tutti a ${path.length ? `"${path[path.length - 1]}"` : "nessuna cartella"}` +
                (confirmFolder.hasChildren
                  ? ", comprese le sottocartelle, che spariscono."
                  : ".")
          }
          onConfirm={() => removeFolder(confirmFolder)}
          onCancel={() => setConfirmFolder(null)}
        />
      )}

      {/* Il menu ⋯ della cartella. Stessa forma di quello del ricambio: le
          azioni sulla struttura stanno tutte in un posto solo. */}
      {folderMenu && (
        <div
          onClick={() => setFolderMenu(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(4,2,107,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 9999, padding: 24, animation: "fadeIn 0.2s ease"
          }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: T.card, borderRadius: 20, padding: 20,
            maxWidth: 340, width: "100%", boxShadow: T.shadowLg,
            animation: "fadeUp 0.2s ease"
          }}>
            <p style={{ color: T.text, fontSize: 15.5, fontWeight: 700 }}>
              📁 {folderMenu.folder}
            </p>
            <p style={{ color: T.textLight, fontSize: 12.5, marginTop: 4, marginBottom: 16 }}>
              {folderMenu.parts === 0
                ? "vuota"
                : folderMenu.direct === folderMenu.parts
                  ? `${folderMenu.parts} ricambi`
                  : `${folderMenu.direct} qui · ${folderMenu.parts} in tutto`}
            </p>
            {[
              { label: "✏️ Rinomina",   go: () => setRenamingFolder(folderMenu) },
              { label: "⇄ Sposta in…",  go: () => setMovingFolder(folderMenu) },
            ].map(a => (
              <button key={a.label} onClick={() => { a.go(); setFolderMenu(null); }} className="tap-sc" style={{
                width: "100%", padding: 13, borderRadius: 12, marginBottom: 10,
                background: T.bluePale, color: T.blue, fontSize: 15, fontWeight: 700,
                border: `1px solid ${T.blue}33`, textAlign: "left", paddingLeft: 16
              }}>{a.label}</button>
            ))}
            <button
              onClick={() => { setConfirmFolder(folderMenu); setFolderMenu(null); }}
              className="tap-sc"
              style={{
                width: "100%", padding: 13, borderRadius: 12, marginBottom: 10,
                background: "#FEF2F2", color: T.error, fontSize: 15, fontWeight: 700,
                border: "1px solid #FECACA", textAlign: "left", paddingLeft: 16
              }}>🗑️ Elimina</button>
            <button onClick={() => setFolderMenu(null)} style={{
              width: "100%", padding: 12, borderRadius: 12,
              background: T.bg, color: T.textMid, fontSize: 15, fontWeight: 600,
              border: `1px solid ${T.border}`
            }}>Annulla</button>
          </div>
        </div>
      )}

      {renamingFolder && (
        <PromptDialog
          title={`Rinomina "${renamingFolder.folder}"`}
          hint={"Solo il nome, non il percorso: la cartella resta dov'è. Quello che contiene la segue, ricambi e sottocartelle."}
          placeholder="es. Valvole"
          initial={renamingFolder.folder}
          confirmLabel="Rinomina"
          onConfirm={renameFolderTo}
          onCancel={() => setRenamingFolder(null)}
        />
      )}

      {movingFolder && (
        <FolderPickerDialog
          title={`Sposta "${movingFolder.folder}"`}
          hint={"Scegli la cartella che la conterrà. Quello che c'è dentro la segue, ricambi e sottocartelle."}
          rootLabel="🏠 Primo livello"
          excludePath={[...path, movingFolder.folder].join("/")}
          onPick={moveFolder}
          onCancel={() => setMovingFolder(null)}
        />
      )}

      {/* Il menu ⋯ del ricambio. Oggi ha una voce sola, ed è il posto giusto
          dove metterne altre: fuori dal form di modifica, che serve a
          cambiare cosa È il pezzo, non dove sta. */}
      {partMenu && (
        <div
          onClick={() => setPartMenu(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(4,2,107,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 9999, padding: 24, animation: "fadeIn 0.2s ease"
          }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: T.card, borderRadius: 20, padding: 20,
            maxWidth: 340, width: "100%", boxShadow: T.shadowLg,
            animation: "fadeUp 0.2s ease"
          }}>
            <p className="wrap-anywhere" style={{ color: T.text, fontSize: 15.5, fontWeight: 700 }}>
              {partMenu.name}
            </p>
            <p style={{ color: T.textLight, fontSize: 12.5, marginTop: 4, marginBottom: 16, lineHeight: 1.5 }}>
              {partMenu.folder
                ? <>Ora in: <strong>{folderSegments(partMenu.folder).join(" › ")}</strong></>
                : "Ora non è in nessuna cartella"}
            </p>
            <button
              onClick={() => { setMovingPart(partMenu); setPartMenu(null); }}
              className="tap-sc"
              style={{
                width: "100%", padding: 13, borderRadius: 12, marginBottom: 10,
                background: T.bluePale, color: T.blue, fontSize: 15, fontWeight: 700,
                border: `1px solid ${T.blue}33`, textAlign: "left", paddingLeft: 16
              }}>📁 Sposta in…</button>
            <button onClick={() => setPartMenu(null)} style={{
              width: "100%", padding: 12, borderRadius: 12,
              background: T.bg, color: T.textMid, fontSize: 15, fontWeight: 600,
              border: `1px solid ${T.border}`
            }}>Annulla</button>
          </div>
        </div>
      )}

      {movingPart && (
        <FolderPickerDialog
          title={`Sposta "${movingPart.name}"`}
          hint="Scegli dove metterlo. Puoi scendere nelle sottocartelle prima di confermare."
          rootLabel="🏠 Nessuna cartella"
          onPick={movePartTo}
          onCancel={() => setMovingPart(null)}
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
          <div style={{ color: "white", fontSize: 28, fontWeight: 800, marginTop: 2 }}>{partsCount}</div>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>ricambi registrati</div>
        </div>
        {/* Il ricambio nasce nella cartella in cui ti trovi: se hai appena
            creato "Idraulica/Valvole" e ci sei dentro, non devi riscriverla. */}
        <button onClick={() => onAdd(folderPath)} className="tap-sc" style={{
          padding: "12px 20px", borderRadius: 14,
          background: T.orange,
          color: "white", fontSize: 15, fontWeight: 700
        }}>+ Aggiungi</button>
      </div>

      {/* Le due porte del caricamento di massa stanno qui e non nella barra
          in basso: si aprono una volta o due nella vita del catalogo, e due
          voci fisse fra le tre di sempre costerebbero spazio su ogni
          schermata per sempre. Prima i ricambi, poi le loro foto: è anche
          l'ordine in cui vanno fatte le cose, perché le foto riconoscono i
          codici e non il contrario. */}
      <div style={{ display: "flex", gap: 7, marginBottom: 16 }}>
        <button onClick={refresh} disabled={refreshing} style={{
          flex: 1, padding: 11, borderRadius: 12,
          background: T.bluePale, color: T.blue, fontSize: 13.5, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6
        }}>
          {refreshing ? <Spinner size={16} /> : "↻ Ricarica"}
        </button>
        <button onClick={onImport} className="tap-sc" style={{
          flex: 1, padding: 11, borderRadius: 12,
          background: T.bluePale, color: T.blue, fontSize: 13.5, fontWeight: 700
        }}>📥 CSV</button>
        <button onClick={onFoto} className="tap-sc" style={{
          flex: 1, padding: 11, borderRadius: 12,
          background: T.bluePale, color: T.blue, fontSize: 13.5, fontWeight: 700
        }}>📷 Foto</button>
      </div>

      {/* ⚠️ Questo NON è un filtro per cartelle, ed è stato scambiato per
          tale: elenca i MACCHINARI, ricavati dal campo compatibilità dei
          ricambi. Eliminare una cartella non toglierà mai una voce da qui.
          Portava l'icona 🗂️, la stessa delle cartelle: cambiata in ⚙️, e
          l'etichetta ora lo dice a parole. */}
      {machines.length > 0 && (
        <>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: T.textLight, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.6 }}>
          Filtra per macchinario (compatibilità)
        </label>
        <select
          value={machine} onChange={e => { setMachine(e.target.value); setPath([]); }}
          style={{
            width: "100%", padding: "12px 14px", borderRadius: 14, marginBottom: 10,
            border: `1.5px solid ${machine ? T.blue : T.border}`,
            background: T.card, fontSize: 15, color: T.text,
          }}>
          <option value="">⚙️ Tutti i macchinari</option>
          {machines.map(m => (
            <option key={m.machine} value={m.machine}>{m.machine} ({m.parts})</option>
          ))}
        </select>
        </>
      )}

      <div style={{ position: "relative", marginBottom: 16 }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: T.textLight }}>🔍</span>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Cerca per nome, codice o categoria..."
          style={{ width: "100%", padding: "13px 16px 13px 42px", borderRadius: 14, border: `1.5px solid ${T.border}`, background: T.card, fontSize: 15, color: T.text }}
        />
      </div>

      {(machine || path.length > 0) && (
        <FolderBreadcrumb
          machine={machine}
          path={path}
          rootLabel="← Tutto"
          onMachine={(m) => { setMachine(m || ""); setPath([]); }}
          onPath={setPath}
        />
      )}

      {rootOnly && filtered.length > 0 && (
        <p style={{ color: T.textLight, fontSize: 12.5, marginTop: 4, marginBottom: 12, lineHeight: 1.5 }}>
          🔩 Qui sotto i ricambi <strong>non ancora assegnati a una cartella</strong>
          {!browsing && ` (i ${CATALOG_PREVIEW_ROWS} più recenti)`}. Aprine uno e compila
          il campo "Cartella" per metterlo a posto.
        </p>
      )}

      {/* Le cartelle stanno fuori dal ramo di caricamento dei ricambi: sono
          due interrogazioni diverse, e far sparire l'albero mentre si carica
          l'elenco farebbe lampeggiare la schermata a ogni tocco. */}
      {!searching && (
        <button onClick={() => setNewFolder(true)} className="tap-sc" style={{
          width: "100%", padding: 12, borderRadius: 14, marginBottom: 10,
          background: T.card, color: T.blue, fontSize: 14.5, fontWeight: 700,
          border: `1.5px dashed ${T.blue}66`,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8
        }}>
          📁 + Nuova cartella{path.length ? ` in "${path[path.length - 1]}"` : ""}
        </button>
      )}

      {!searching && folders.map((f, i) => (
        <div key={f.folder} onClick={() => setPath([...path, f.folder])} className="fade-in tap-sc" style={{
          background: T.card, borderRadius: 16, marginBottom: 10,
          border: `1px solid ${T.border}`, padding: 14, cursor: "pointer",
          display: "flex", gap: 12, alignItems: "center",
          boxShadow: T.shadow, animationDelay: `${i * 0.03}s`
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: T.orangePale,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22
          }}>📁</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: T.text, fontSize: 15.5 }}>{f.folder}</div>
            <div style={{ color: T.textLight, fontSize: 12.5, marginTop: 2 }}>
              {f.parts === 0
                ? "vuota"
                : f.direct === f.parts
                  ? `${f.parts} ricambi`
                  : `${f.direct} qui · ${f.parts} in tutto`}
              {f.hasChildren ? " · contiene altre cartelle" : ""}
            </div>
          </div>
          {/* Un pulsante solo invece di tre icone in fila: su un telefono
              tre bersagli da 30 pixel accanto a una riga che è già toccabile
              sono un invito a sbagliare. stopPropagation, o il tocco
              aprirebbe la cartella invece del menu. */}
          <button
            onClick={(e) => { e.stopPropagation(); setFolderMenu(f); }}
            aria-label={`Azioni per la cartella ${f.folder}`}
            style={{
              width: 34, height: 34, borderRadius: 10, flexShrink: 0,
              background: T.bg, color: T.textMid, fontSize: 17, fontWeight: 700,
              border: `1px solid ${T.border}`, lineHeight: 1, padding: 0
            }}>⋯</button>
          <span style={{ color: T.textLight, fontSize: 18 }}>›</span>
        </div>
      ))}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
          <Spinner size={30} />
        </div>
      ) : filtered.length === 0 && folders.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 16px" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📦</div>
          <p style={{ color: T.text, fontWeight: 700 }}>
            {partsCount === 0 ? "Database vuoto" : (!searching && path.length) ? "Cartella vuota" : "Nessun risultato"}
          </p>
          <p style={{ color: T.textLight, fontSize: 14, marginTop: 4 }}>
            {partsCount === 0 ? "Aggiungi il primo ricambio"
              : (!searching && path.length) ? "Nessun ricambio è assegnato a questa cartella"
              : "Prova un altro termine"}
          </p>
          {partsCount === 0 && (
            // onClick={onAdd} passerebbe l'evento del click come cartella, e
            // il primo ricambio nascerebbe dentro "[object Object]".
            // Le parentesi qui non sono uno stile.
            <button onClick={() => onAdd("")} className="tap-sc" style={{
              marginTop: 18, padding: "12px 24px", borderRadius: 14,
              background: T.orange,
              color: "white", fontSize: 15, fontWeight: 700
            }}>+ Aggiungi il primo</button>
          )}
          {partsCount === 0 && (
            <div style={{ marginTop: 14 }}>
              <button onClick={onImport} style={{
                padding: "11px 20px", borderRadius: 14,
                background: "transparent", color: T.blue, fontSize: 14.5, fontWeight: 700,
                border: `1.5px solid ${T.border}`
              }}>📥 Oppure importa un CSV</button>
              <div style={{ color: T.textLight, fontSize: 12.5, marginTop: 8 }}>
                Per caricarne molti in una volta sola
              </div>
            </div>
          )}
        </div>
      ) : (
        // La miniatura si vede sempre, a ogni livello. La regola precedente
        // — foto solo fra i risultati di una ricerca — veniva dall'epoca in
        // cui le immagini stavano in base64 dentro il database e ogni riga
        // dell'elenco se le trascinava dietro. Oggi thumb_url è un indirizzo,
        // pesa 3,5 KB e con loading="lazy" si scarica solo per le righe che
        // entrano davvero nello schermo: nasconderla non fa più risparmiare
        // niente, e un catalogo di ricambi senza fotografie non si sfoglia.
        filtered.map((part, i) => (
          <div key={part.id} className="fade-in" style={{
            background: T.card, borderRadius: 16, marginBottom: 10,
            border: `1px solid ${T.border}`, overflow: "hidden",
            boxShadow: T.shadow, animationDelay: `${i * 0.03}s`
          }}>
            <div style={{ display: "flex", gap: 12, padding: 14 }}>
              {part.thumbUrl ? (
                <img src={part.thumbUrl} alt="" loading="lazy" decoding="async" style={{ width: 68, height: 68, borderRadius: 12, objectFit: "cover", flexShrink: 0, background: T.bluePale }} />
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
              <button onClick={() => setConfirmDelete(part.id)} style={{ flex: 1, padding: 11, background: "transparent", color: T.error, fontSize: 14, fontWeight: 600, borderRight: `1px solid ${T.border}` }}>🗑️ Elimina</button>
              {/* Dove sta un pezzo non è una sua proprietà da riscrivere in un
                  form insieme al codice e alla descrizione: è un'azione. Per
                  questo sta qui e non dentro "Modifica". */}
              <button
                onClick={() => setPartMenu(part)}
                aria-label={`Altre azioni per ${part.name}`}
                style={{ flex: "0 0 58px", padding: 11, background: "transparent", color: T.textMid, fontSize: 17, fontWeight: 700 }}
              >⋯</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ===================== ADD / EDIT PART =====================
function AddEditPartScreen({ editingPart, defaultFolder = "", onAddPart, onUpdatePart, onDone }) {
  const isEdit = !!editingPart;
  // I valori predefiniti stanno PRIMA dello spread: la riga che arriva
  // dall'elenco non ha le chiavi description e compatibility, e senza questi
  // valori i campi partirebbero "undefined" — cioè non controllati da React.
  const [form, setForm] = useState(editingPart
    ? { code: "", name: "", description: "", category: "", folder: "", compatibility: [], ...editingPart, images: [] }
    : { code: "", name: "", description: "", category: "", folder: normalizeFolder(defaultFolder), compatibility: [], images: [] }
  );
  // Quali campi ha già toccato chi sta scrivendo. Serve al riempimento
  // ritardato qui sotto: se la scheda completa arriva dal server mentre si
  // sta scrivendo, non deve sovrascrivere quello che si è appena digitato.
  const touched = useRef(new Set());
  const [galleryLoading, setGalleryLoading] = useState(!!editingPart);
  // I percorsi già in uso, suggeriti mentre si scrive. Se la chiamata
  // fallisce si resta senza suggerimenti: il campo è testo libero comunque.
  const [folderHints, setFolderHints] = useState([]);
  const [pickingFolder, setPickingFolder] = useState(false);
  useEffect(() => {
    let alive = true;
    cloud.listAllFolders().then(f => { if (alive) setFolderHints(f); });
    return () => { alive = false; };
  }, []);

  // In modifica servono due cose che la riga dell'elenco non porta con sé.
  //
  // ⚠️ La seconda riparava una perdita di dati vera: la riga che arriva da
  //    searchParts contiene solo id, codice, nome, categoria, cartella e
  //    miniatura. Il form partiva da quella, quindi description e
  //    compatibility erano "undefined", e al salvataggio updatePart scriveva
  //    `part.description || ""` → stringa vuota. Ogni "Modifica" fatta
  //    dall'elenco CANCELLAVA la descrizione tecnica e le compatibilità del
  //    ricambio: proprio il testo su cui l'AI lo riconosce.
  //
  // Si riempiono solo i campi ancora vuoti (?? e non =), così se la risposta
  // arriva tardi non sovrascrive quello che nel frattempo si è già scritto.
  useEffect(() => {
    if (!editingPart) return;
    let alive = true;
    Promise.all([
      cloud.loadPartImages(editingPart.id).catch(() => []),
      cloud.getPart(editingPart.id).catch(() => null),
    ])
      .then(([imgs, full]) => {
        if (!alive) return;
        setForm(f => {
          const next = { ...f, images: imgs };
          if (full) {
            for (const k of ["code", "name", "category", "folder", "description", "compatibility"]) {
              if (!touched.current.has(k)) next[k] = full[k];
            }
          }
          return next;
        });
      })
      .finally(() => { if (alive) setGalleryLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [compatInput, setCompatInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  // Avviso che NON blocca: un codice uguale a meno di maiuscole.
  const [avvisoCodice, setAvvisoCodice] = useState("");
  const [imgLoading, setImgLoading] = useState(false);

  function field(key, val) {
    touched.current.add(key);
    setForm(f => ({ ...f, [key]: val }));
  }

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
      // Le tre versioni nascono qui, sul telefono di chi carica: al server
      // arrivano già pronte, non c'è nessuna elaborazione lato cloud.
      // Si ridimensiona sempre partendo dalla piena, non dall'originale:
      // una sola decodifica del file scattato, tre riduzioni sulla stessa.
      const full  = await compressImage(file, PHOTO_FULL_PX, PHOTO_FULL_Q);
      const ai    = await makeThumb(full, PHOTO_AI_PX, PHOTO_AI_Q);
      const thumb = await makeThumb(full, PHOTO_THUMB_PX, PHOTO_THUMB_Q);
      setForm(f => ({ ...f, images: [...(f.images || []), { full, thumb, ai }] }));
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

  // Il controllo dei doppioni interroga il database invece di scorrere un
  // catalogo tenuto in memoria: è una ricerca su indice, e soprattutto vede
  // anche i ricambi aggiunti da un altro dispositivo un minuto fa.
  // ⚠️ Blocca SOLO il codice identico. Un codice che differisce per le
  //    maiuscole è un ricambio diverso e deve poter entrare: quello diventa
  //    un avviso che non impedisce il salvataggio.
  async function validate() {
    const e = {};
    if (!form.code.trim()) e.code = "Il codice è obbligatorio";
    if (!form.name.trim()) e.name = "Il nome è obbligatorio";
    if (!e.code) {
      const { esatto, varianti } = await cloud.partByCode(form.code, editingPart?.id);
      if (esatto) e.code = "Questo codice esiste già nel database";
      setAvvisoCodice(!esatto && varianti.length
        ? `In archivio c'è già ${varianti.map(v => v.code).join(", ")}: differisce solo per le maiuscole. Se è lo stesso pezzo, correggi; se sono due pezzi diversi, vai avanti.`
        : "");
    }
    return e;
  }

  async function save() {
    setSaving(true);
    const errs = await validate();
    if (Object.keys(errs).length) { setErrors(errs); setSaving(false); return; }
    // Le miniature esistono già: la copertina è semplicemente quella della
    // prima foto. Il caricamento su Storage avviene dentro add/updatePart.
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
      {pickingFolder && (
        <FolderPickerDialog
          title="Dove va questo ricambio"
          hint="Scendi fino alla cartella giusta e conferma. Per crearne una nuova, chiudi e scrivi il percorso nel campo."
          rootLabel="🏠 Nessuna cartella"
          onPick={(dest) => { field("folder", dest); setPickingFolder(false); }}
          onCancel={() => setPickingFolder(false)}
        />
      )}

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
          {(form.images || []).map((img, i) => (
            <div key={i} style={{
              position: "relative", borderRadius: 12, overflow: "hidden",
              border: `1.5px solid ${i === 0 ? T.blue : T.border}`,
              aspectRatio: "1 / 1", background: T.bg
            }}>
              {/* L'anteprima usa la miniatura: nel form basta riconoscere
                  quale foto è quale, non esaminarla. */}
              <img src={img.thumb} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
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
        {!errors.code && avvisoCodice && (
          <p style={{ color: T.orange, fontSize: 12, marginTop: 4, lineHeight: 1.45 }}>⚠️ {avvisoCodice}</p>
        )}
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

      {/* Categoria e cartella dicono due cose diverse e non vanno fuse:
          la categoria è CHE COSA è il pezzo e resta scritta sulla scheda,
          la cartella è DOVE sta nel catalogo. All'inizio coincidono, perché
          l'SQL ha riempito la seconda con la prima. */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.textMid, marginBottom: 6 }}>Cartella nel catalogo</label>
        {/* Due modi per la stessa cosa, e servono tutti e due: il pulsante
            per scegliere una cartella che esiste già — che è il caso
            normale, e non obbliga a ricordare come si scrive il percorso —
            e il campo di testo per inventarne una nuova al volo mentre si
            carica il pezzo. */}
        <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          <input
            value={form.folder || ""}
            onChange={e => field("folder", e.target.value)}
            list="folder-suggestions"
            placeholder="es. Idraulica/Valvole/Sicurezza"
            style={{ ...inp("folder"), flex: 1, minWidth: 0 }}
          />
          <button
            type="button"
            onClick={() => setPickingFolder(true)}
            className="tap-sc"
            style={{
              flexShrink: 0, padding: "0 14px", borderRadius: 12,
              background: T.bluePale, color: T.blue, fontSize: 14, fontWeight: 700,
              border: `1px solid ${T.blue}33`, whiteSpace: "nowrap"
            }}>📁 Scegli</button>
        </div>
        <datalist id="folder-suggestions">
          {folderHints.map(f => <option key={f} value={f} />)}
        </datalist>
        {normalizeFolder(form.folder) && (
          <p style={{ color: T.textMid, fontSize: 12.5, marginTop: 6, fontWeight: 600 }}>
            📁 {folderSegments(form.folder).join(" › ")}
          </p>
        )}
        <p style={{ color: T.textLight, fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
          Usa la <strong>/</strong> per le sottocartelle. Lasciala vuota e il ricambio
          resta in cima, fra quelli ancora da sistemare.
        </p>
        {/* Si mostra come verrà salvata davvero: barre doppie e spazi ai bordi
            spariscono, e vederlo subito evita di scoprirlo nell'albero. */}
        {normalizeFolder(form.folder) !== (form.folder || "").trim() && (
          <p style={{ color: T.blue, fontSize: 11.5, marginTop: 4 }}>
            Verrà salvata come: <strong>{normalizeFolder(form.folder) || "(nessuna cartella)"}</strong>
          </p>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.textMid, marginBottom: 6 }}>Descrizione tecnica</label>
        <textarea value={form.description} onChange={e => field("description", e.target.value)}
          placeholder="Forma, colore, materiale, dimensioni, sigle visibili... — è questo il testo su cui l'AI riconosce il pezzo"
          rows={4}
          style={{ ...inp("description"), lineHeight: 1.5, paddingTop: 12 }}
        />
        <p style={{ color: T.textLight, fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
          💡 L'AI confronta la foto scattata con <strong>questa descrizione</strong> e con la
          foto di copertina qui sopra. La descrizione pesa di più: la foto è uno scatto solo,
          con la sua luce, mentre il tecnico fotografa in officina.
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

// ===================== IMPORT CSV =====================
// Cinque fermate, una sola scrittura: file → colonne → conferma → scrittura →
// esito. La fermata che conta davvero è la seconda.
//
// ⚠️ Il danno peggiore di un import non è fallire: è RIUSCIRE con la colonna
//    sbagliata. Duemila righe col fornitore dentro il nome, o la descrizione
//    breve al posto di quella tecnica. Quell'errore non produce nessun
//    messaggio da nessuna parte — il file è valido, il database è contento,
//    l'indice unico guarda solo il codice — e l'unica cosa al mondo che può
//    fermarlo è una persona che guarda dei valori veri prima di scrivere.
//    Per questo la corrispondenza delle colonne è una schermata sua, con
//    sotto ogni scelta tre valori presi dal file, e non una riga in un
//    riepilogo che si scorre.
function ImportScreen({ onDone, onBack }) {
  const [fase, setFase]         = useState("file");
  const [nomeFile, setNomeFile] = useState("");
  const [errore, setErrore]     = useState("");
  const [avviso, setAvviso]     = useState("");
  const [codifica, setCodifica] = useState("");
  const [sep, setSep]           = useState(";");
  const [testo, setTesto]       = useState("");
  const [righe, setRighe]       = useState([]);
  const [conIntestazione, setConIntestazione] = useState(true);
  const [mappa, setMappa]       = useState({});
  // Dove nascono i ricambi di questo import: "__col__" = dalla colonna del
  // file, "" = nessuna cartella, altrimenti il percorso scelto nel catalogo.
  const [cartellaScelta, setCartellaScelta] = useState("");
  const [cartelleCatalogo, setCartelleCatalogo] = useState([]);
  const [analisi, setAnalisi]   = useState(null);
  const [esistenti, setEsistenti] = useState(null);
  const [caricando, setCaricando] = useState(false);
  const [progresso, setProgresso] = useState({ fatti: 0, totale: 0 });
  const [esito, setEsito]       = useState(null);
  const [chiedoAnnulla, setChiedoAnnulla] = useState(false);
  const [trascina, setTrascina] = useState(false);
  const fermato = useRef(false);

  const primaRigaDati = conIntestazione ? 1 : 0;

  // ── Lettura del file ──────────────────────────────────────
  async function apriFile(file) {
    if (!file) return;
    setErrore(""); setAvviso(""); setEsito(null); setAnalisi(null);
    setNomeFile(file.name);
    try {
      const letto = await leggiTestoCSV(file);
      const trovato = trovaSeparatoreCSV(letto.testo);
      if (!trovato.sep) {
        setTesto(trovato.testo); setCodifica(letto.codifica); setSep(";");
        rianalizza(trovato.testo, ";");
        setErrore("Non riesco a capire da solo come sono divise le colonne. Controlla il separatore qui sotto: nell'anteprima devi vedere più di una colonna.");
        setFase("mappa");
        return;
      }
      setCodifica(letto.codifica);
      setAvviso(letto.avviso || "");
      setTesto(trovato.testo);
      setSep(trovato.sep);
      rianalizza(trovato.testo, trovato.sep);
      cloud.cartelleCatalogo()
        .then(setCartelleCatalogo)
        .catch(e => console.error("cartelle:", e));
      setFase("mappa");
    } catch (e) {
      console.error("import: lettura", e);
      setErrore(e.message || "Non riesco a leggere questo file.");
    }
  }

  // Rifà il parsing quando cambia il separatore scelto a mano. La
  // corrispondenza delle colonne si ricalcola da zero: con un separatore
  // diverso le colonne sono altre, e tenere la vecchia mappa vorrebbe dire
  // puntare a numeri che non significano più niente.
  function rianalizza(txt, separatore) {
    try {
      const r = analizzaCSV(txt, separatore);
      setRighe(r);
      const { mappa: m } = mappaColonneCSV(r[0] || []);
      setMappa(m);
      // Se il file ha una colonna cartella si parte da quella; altrimenti i
      // ricambi nascono nella radice e si sceglie dal menu.
      setCartellaScelta(m.cartella !== undefined ? "__col__" : "");
      setErrore("");
    } catch (e) {
      setRighe([]); setMappa({});
      setErrore(e.message);
    }
  }

  // ── Conteggi, prima di scrivere ───────────────────────────
  async function preparaConferma() {
    setCaricando(true); setErrore("");
    try {
      const a = costruisciRicambi(righe, mappa, primaRigaDati, {
        cartellaFissa: cartellaScelta === "__col__" ? null : cartellaScelta,
      });
      // I codici già a catalogo si leggono ADESSO, non in fase di scrittura:
      // il numero che l'amministratore legge prima di premere dev'essere
      // quello vero, non una stima.
      const gia = await cloud.codiciEsistenti();
      setAnalisi(a); setEsistenti(gia);
      setFase("conferma");
    } catch (e) {
      console.error("import: conferma", e);
      setErrore(e.message || "Non riesco a leggere i codici già a catalogo.");
    } finally {
      setCaricando(false);
    }
  }

  // ── La scrittura ──────────────────────────────────────────
  async function scrivi() {
    if (!daScrivere.length) return;
    fermato.current = false;
    setFase("scrive");
    setProgresso({ fatti: 0, totale: daScrivere.length });
    try {
      // Prima le cartelle: se questo account non ha i permessi, si scopre
      // ora, su una chiamata sola, e non a metà dei ricambi.
      await cloud.assicuraCartelle(analisi.cartelle);
      const r = await cloud.importaRicambi(daScrivere, {
        onProgress: (fatti, totale) => setProgresso({ fatti, totale }),
        fermato: () => fermato.current,
      });
      setEsito({ ...r, interrotto: fermato.current });
      setFase("esito");
    } catch (e) {
      console.error("import: scrittura", e);
      setErrore(e.message || "Scrittura interrotta da un errore.");
      setEsito({ scritti: 0, idScritti: [], scartate: [], errore: true });
      setFase("esito");
    }
  }

  async function annullaImport() {
    setChiedoAnnulla(false);
    setCaricando(true);
    try {
      const tolti = await cloud.eliminaRicambiPerId(esito.idScritti);
      setEsito(e => ({ ...e, annullati: tolti, idScritti: [] }));
    } catch (e) {
      setErrore(e.message || "Annullamento non riuscito.");
    } finally {
      setCaricando(false);
    }
  }

  // ── Derivati ──────────────────────────────────────────────
  const intestazione = righe[0] || [];
  // ⚠️ DEVE restare quassù, sopra colonneLibere e le levette della
  //    compatibilità. Dichiarata più in basso, le costanti che la usano la
  //    leggerebbero prima che esista: JavaScript solleva un ReferenceError
  //    mentre disegna, React smonta tutto e la schermata diventa NERA. Non è
  //    un errore che esbuild veda, né che si noti senza aprire quella
  //    schermata: lo trova test-tdz.mjs.
  const nColonne = righe.reduce((n, r) => Math.max(n, r.length), 0);
  const etichettaColonna = (i) =>
    (conIntestazione && intestazione[i] ? `${i + 1}. ${intestazione[i]}` : `Colonna ${i + 1}`);

  // Accetta un indice o un elenco di indici: la compatibilità ne usa più di
  // uno, e gli esempi vanno mostrati uniti come li vedrà il ricambio.
  const esempiColonna = (scelta) => {
    const indici = scelta === undefined ? [] : (Array.isArray(scelta) ? scelta : [scelta]);
    const fuori = [];
    for (let r = primaRigaDati; r < righe.length && fuori.length < 3; r++) {
      const v = indici.map(i => String(righe[r]?.[i] ?? "").trim()).filter(Boolean).join(" · ");
      if (v) fuori.push(v.length > 42 ? v.slice(0, 42) + "…" : v);
    }
    return fuori;
  };

  const colonneCompat = mappa.compatibilita === undefined
    ? []
    : (Array.isArray(mappa.compatibilita) ? mappa.compatibilita : [mappa.compatibilita]);

  // Le colonne già assegnate a un altro campo non sono macchinari: mostrarle
  // fra le levette è rumore da scorrere prima di arrivare a quelle vere.
  // Restano visibili se sono GIÀ selezionate come compatibilità, perché
  // niente deve sparire da sotto le mani di chi sta scegliendo.
  const colonneAltrove = new Set(
    Object.entries(mappa)
      .filter(([campo]) => campo !== "compatibilita")
      .flatMap(([, v]) => (Array.isArray(v) ? v : [v]))
      .map(Number)
  );
  const colonneLibere = Array.from({ length: nColonne }, (_, i) => i).filter(i => {
    if (colonneCompat.includes(i)) return true;    // già scelta: non sparisce
    if (colonneAltrove.has(i)) return false;       // assegnata a un altro campo
    // Anche una colonna NON assegnata può essere palesemente di un altro
    // campo: un file con due colonne "descrizione" ne usa una sola, e la
    // seconda resta libera pur non avendo niente a che fare coi macchinari.
    const campo = conIntestazione ? CSV_MAPPA_ALIAS.get(csvKey(intestazione[i])) : undefined;
    return !campo || campo === "compatibilita";
  });

  // Sulle levette il numero d'ordine sparisce: serviva solo a distinguere due
  // colonne che si chiamano allo stesso modo, e allora lo si rimette a quelle
  // e basta.
  const nomiLevette = colonneLibere.map(i => (conIntestazione ? String(intestazione[i] ?? "").trim() : ""));
  const etichettaLevetta = (i) => {
    const pos = colonneLibere.indexOf(i);
    const nome = pos < 0 ? "" : nomiLevette[pos];
    if (!nome) return `Colonna ${i + 1}`;
    return nomiLevette.filter(x => x === nome).length > 1 ? `${nome} (${i + 1})` : nome;
  };

  const cambiaCompat = (i) => setMappa(m => {
    const attive = m.compatibilita === undefined
      ? [] : (Array.isArray(m.compatibilita) ? m.compatibilita : [m.compatibilita]);
    const nuove = attive.includes(i) ? attive.filter(x => x !== i) : [...attive, i].sort((a, b) => a - b);
    const n = { ...m };
    if (nuove.length) n.compatibilita = nuove; else delete n.compatibilita;
    return n;
  });
  const mancanoObbligatorie = CSV_CAMPI.filter(c => c.obbligatorio && mappa[c.campo] === undefined);

  // Identità esatta: un codice che differisce solo per le maiuscole da uno
  // già a catalogo NON è "già presente", è un ricambio nuovo e va scritto.
  const giaPresenti = analisi && esistenti
    ? analisi.pronti.filter(p => esistenti.esatti.has(p.code))
    : [];
  const daScrivere = analisi && esistenti
    ? analisi.pronti.filter(p => !esistenti.esatti.has(p.code))
    : [];
  // Le somiglianze da far vedere: dentro il file, e verso il catalogo.
  const variantiCatalogo = analisi && esistenti
    ? daScrivere
        .map(p => ({ code: p.code, nRiga: p._riga, gemelli: (esistenti.perMinuscolo.get(p.code.toLowerCase()) || []).filter(c => c !== p.code) }))
        .filter(v => v.gemelli.length)
    : [];
  const nVarianti = (analisi?.varianti?.length || 0) + variantiCatalogo.length;
  const righeLette = analisi ? analisi.pronti.length + analisi.scarti.length : 0;
  // Colonne in eccesso su tante righe non è un file sciatto: è il separatore
  // sbagliato o una virgoletta non chiusa, e va detto forte.
  const eccessoGrave = analisi && righeLette > 0 && analisi.colonneInEccesso > righeLette * 0.05;

  function scaricaScarti() {
    const tutti = [...(analisi?.scarti || []), ...(esito?.scartate || [])];
    const righeCsv = [
      "sep=;",
      ["riga_originale", "motivo_scarto", ...CSV_CAMPI.map(c => c.campo)].join(";"),
      ...tutti.map(s => [
        s.nRiga,
        s.motivo,
        ...CSV_CAMPI.map(c => {
          const m = mappa[c.campo];
          if (m === undefined) return "";
          return (Array.isArray(m) ? m : [m])
            .map(i => String(s.riga?.[i] ?? "").trim()).filter(Boolean).join(" | ");
        }),
      ].map(cellaCSV).join(";")),
    ];
    scaricaTesto("scarti-import.csv", righeCsv.join("\r\n"));
  }

  // ── Pezzi di interfaccia ──────────────────────────────────
  const Riquadro = ({ children, colore = T.border, fondo = T.card }) => (
    <div style={{
      background: fondo, border: `1.5px solid ${colore}`, borderRadius: 16,
      padding: 14, marginBottom: 12, fontSize: 13.5, color: T.textMid, lineHeight: 1.5,
    }}>{children}</div>
  );

  const Numerone = ({ n, testo: etichetta, colore }) => (
    <div style={{ flex: 1, textAlign: "center", padding: "10px 4px" }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: colore, letterSpacing: "-0.5px" }}>
        {n.toLocaleString("it-IT")}
      </div>
      <div style={{ fontSize: 11.5, color: T.textLight, fontWeight: 600, marginTop: 2 }}>{etichetta}</div>
    </div>
  );

  const bottonePrimario = {
    width: "100%", padding: 15, borderRadius: 14, background: T.blue, color: "white",
    fontSize: 15.5, fontWeight: 700, marginTop: 6,
  };
  const bottoneChiaro = {
    width: "100%", padding: 13, borderRadius: 14, background: "transparent",
    color: T.blue, fontSize: 14.5, fontWeight: 600, border: `1.5px solid ${T.border}`, marginTop: 8,
  };

  return (
    <div style={{ padding: 16 }}>
      {chiedoAnnulla && (
        <ConfirmDialog
          message={`Elimino i ${esito.idScritti.length.toLocaleString("it-IT")} ricambi appena importati? I ricambi che c'erano prima non vengono toccati.`}
          onConfirm={annullaImport}
          onCancel={() => setChiedoAnnulla(false)}
        />
      )}

      <h2 style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 4, letterSpacing: "-0.4px" }}>
        📥 Importa da CSV
      </h2>
      <div style={{ fontSize: 13, color: T.textLight, marginBottom: 18 }}>
        {nomeFile ? nomeFile : "Carica molti ricambi in una volta sola"}
        {codifica && fase !== "file" ? ` · ${codifica}` : ""}
      </div>

      {errore && (
        <div style={{
          background: "#FEF2F2", border: `1.5px solid ${T.error}`, color: T.error,
          borderRadius: 14, padding: 13, marginBottom: 12, fontSize: 13.5, fontWeight: 600, lineHeight: 1.5,
        }}>{errore}</div>
      )}

      {/* ── 1. IL FILE ──────────────────────────────────── */}
      {fase === "file" && (
        <>
          <div
            onDragOver={e => { e.preventDefault(); setTrascina(true); }}
            onDragLeave={() => setTrascina(false)}
            onDrop={e => {
              e.preventDefault(); setTrascina(false);
              apriFile(e.dataTransfer?.files?.[0]);
            }}
            style={{
              border: `2px dashed ${trascina ? T.blue : T.border}`,
              background: trascina ? T.bluePale : T.card,
              borderRadius: 18, padding: "34px 18px", textAlign: "center", marginBottom: 14,
            }}>
            <div style={{ fontSize: 38, marginBottom: 8 }}>📄</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>
              Trascina qui il file CSV
            </div>
            <div style={{ fontSize: 12.5, color: T.textLight, marginBottom: 14 }}>
              oppure
            </div>
            {/* Stessa forma del PhotoPicker: l'input resta FUORI dal label,
                perché annidato e insieme referenziato da htmlFor il click
                arriverebbe doppio. */}
            <PhotoPicker
              id="csv-import"
              accept=".csv,text/csv,text/plain"
              onFile={e => apriFile(e.target.files?.[0])}
              style={{
                display: "inline-block", padding: "12px 22px", borderRadius: 14,
                background: T.blue, color: "white", fontSize: 14.5, fontWeight: 700, cursor: "pointer",
              }}>
              Scegli il file
            </PhotoPicker>
          </div>

          <Riquadro>
            <b style={{ color: T.text }}>Come dev'essere fatto il file.</b> Una riga per
            ricambio e una prima riga con i nomi delle colonne. Servono almeno
            <b> codice</b> e <b>nome</b>; <i>descrizione</i>, <i>categoria</i>,
            <i> compatibilità</i> e <i>cartella</i> sono facoltative.
            I nomi delle colonne li riconosco da solo anche se li scrivi in altro
            modo — e comunque te li faccio confermare prima di scrivere niente.
          </Riquadro>

          <button style={bottoneChiaro} onClick={() => scaricaTesto("modello-werfen.csv", MODELLO_CSV)}>
            ⬇️ Scarica il modello CSV
          </button>
          <button style={bottoneChiaro} onClick={onBack}>← Torna al catalogo</button>
        </>
      )}

      {/* ── 2. LE COLONNE ───────────────────────────────── */}
      {fase === "mappa" && (
        <>
          <Riquadro colore={T.orange} fondo={T.orangePale}>
            <b style={{ color: T.text }}>Guarda i valori, non i nomi.</b> Sotto ogni
            campo ci sono tre valori veri presi dal tuo file: se sono quelli
            giusti, la colonna è giusta. È l'unico controllo che impedisce di
            riempire duemila schede col dato sbagliato, perché un file con le
            colonne invertite è perfettamente valido e nessun errore lo segnala.
          </Riquadro>

          {avviso && (
            <Riquadro colore={T.orange} fondo={T.orangePale}>⚠️ {avviso}</Riquadro>
          )}

          <div style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 13, color: T.textMid, fontWeight: 600 }}>Colonne divise da</label>
            <select
              value={sep}
              onChange={e => { setSep(e.target.value); rianalizza(testo, e.target.value); }}
              style={{ padding: "9px 12px", borderRadius: 12, border: `1.5px solid ${T.border}`, background: T.card, fontSize: 14, color: T.text }}>
              <option value=";">punto e virgola  ;</option>
              <option value=",">virgola  ,</option>
              <option value={"\t"}>tabulazione</option>
              <option value="|">barra verticale  |</option>
            </select>
            <span style={{ fontSize: 12.5, color: T.textLight }}>
              {nColonne} colonne · {Math.max(0, righe.length - primaRigaDati).toLocaleString("it-IT")} righe
            </span>
          </div>

          <label style={{ display: "flex", gap: 9, alignItems: "flex-start", marginBottom: 14, fontSize: 13.5, color: T.textMid }}>
            <input
              type="checkbox"
              checked={conIntestazione}
              onChange={e => setConIntestazione(e.target.checked)}
              style={{ marginTop: 3, width: 17, height: 17, flexShrink: 0 }}
            />
            <span>La prima riga contiene i <b>nomi delle colonne</b> e non un ricambio</span>
          </label>

          {CSV_CAMPI.map(c => {
            const scelta = mappa[c.campo];
            // La cartella non si legge quasi mai dal file: si sceglie fra
            // quelle che esistono. Gli esempi presi dalle celle hanno senso
            // solo quando la colonna la si sta usando davvero.
            const daColonna = c.campo !== "cartella" || cartellaScelta === "__col__";
            const esempi = daColonna ? esempiColonna(scelta) : [];
            const manca = c.obbligatorio && scelta === undefined;
            const comeDescrizione = c.campo === "nome"
              && scelta !== undefined && scelta === mappa.descrizione;
            const selettore = {
              padding: "9px 10px", borderRadius: 11, border: `1.5px solid ${T.border}`,
              background: T.card, fontSize: 13.5, color: T.text, maxWidth: "58%",
            };
            return (
              <div key={c.campo} style={{
                background: T.card, border: `1.5px solid ${manca ? T.error : T.border}`,
                borderRadius: 14, padding: 12, marginBottom: 9,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
                      {c.etichetta}{c.obbligatorio && <span style={{ color: T.error }}> *</span>}
                    </div>
                    {comeDescrizione && (
                      <div style={{ fontSize: 11.5, color: T.textLight, marginTop: 2 }}>
                        stessa colonna della descrizione
                      </div>
                    )}
                  </div>

                  {c.campo === "cartella" ? (
                    // ⚠️ Qui le opzioni sono le CARTELLE DEL CATALOGO, non le
                    //    colonne del file: dove va un ricambio è una decisione
                    //    che si prende guardando l'archivio, non il foglio.
                    //    La colonna resta disponibile in fondo, per i file che
                    //    ce l'hanno davvero.
                    <select value={cartellaScelta} onChange={e => setCartellaScelta(e.target.value)} style={selettore}>
                      <option value="">🏠 Nessuna cartella</option>
                      {cartelleCatalogo.map(p => <option key={p} value={p}>📁 {p}</option>)}
                      {mappa.cartella !== undefined && (
                        <option value="__col__">📄 dalla colonna «{etichettaColonna(mappa.cartella)}»</option>
                      )}
                    </select>
                  ) : c.campo === "compatibilita" ? (
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: colonneCompat.length ? T.blue : T.textLight }}>
                      {colonneCompat.length ? `${colonneCompat.length} scelte` : "nessuna"}
                    </span>
                  ) : (
                    <select
                      value={scelta === undefined ? "" : String(scelta)}
                      onChange={e => {
                        const v = e.target.value;
                        setMappa(m => {
                          const n = { ...m };
                          if (v === "") delete n[c.campo]; else n[c.campo] = Number(v);
                          return n;
                        });
                      }}
                      style={selettore}>
                      <option value="">— nessuna —</option>
                      {Array.from({ length: nColonne }, (_, i) => (
                        <option key={i} value={String(i)}>{etichettaColonna(i)}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* La compatibilità prende PIÙ colonne: un elenco di magazzino
                    tiene spesso un macchinario per colonna, e con una sola
                    scelta gli altri sparirebbero senza dire niente. */}
                {c.campo === "compatibilita" && (
                  <>
                    <div style={{ fontSize: 11.5, color: T.textLight, margin: "8px 0 7px", lineHeight: 1.45 }}>
                      Tocca tutte le colonne che contengono un macchinario: finiscono
                      insieme sullo stesso ricambio, e diventano le voci del menu che
                      il tecnico usa per filtrare.
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {colonneLibere.map(i => {
                        const attiva = colonneCompat.includes(i);
                        return (
                          <button key={i} onClick={() => cambiaCompat(i)} style={{
                            padding: "7px 10px", borderRadius: 10, fontSize: 12, fontWeight: 600,
                            border: `1.5px solid ${attiva ? T.blue : T.border}`,
                            background: attiva ? T.bluePale : T.card,
                            color: attiva ? T.blue : T.textMid,
                            maxWidth: "100%", whiteSpace: "nowrap",
                            overflow: "hidden", textOverflow: "ellipsis",
                          }}>{attiva ? "✓ " : ""}{etichettaLevetta(i)}</button>
                        );
                      })}
                      {colonneLibere.length === 0 && (
                        <span style={{ fontSize: 12, color: T.textLight }}>
                          Tutte le colonne del file sono già assegnate a un altro campo.
                        </span>
                      )}
                    </div>
                  </>
                )}

                {esempi.length > 0 && (
                  <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 7, marginTop: 8 }}>
                    {esempi.map((v, i) => (
                      <div key={i} className="wrap-anywhere" style={{ fontSize: 12, color: T.textMid, marginTop: 2 }}>
                        <span style={{ color: T.textLight }}>·</span> {v}
                      </div>
                    ))}
                  </div>
                )}

                {c.campo === "cartella" && cartellaScelta !== "__col__" && (
                  <div style={{
                    borderTop: `1px solid ${T.border}`, paddingTop: 7, marginTop: 8,
                    fontSize: 12, color: T.textMid, lineHeight: 1.45,
                  }}>
                    {cartellaScelta
                      ? <>Tutti i ricambi di questo import vanno in <b>{cartellaScelta}</b></>
                      : "I ricambi nascono fuori da ogni cartella. Li trovi in cima all'elenco dell'amministratore e li sposti quando vuoi."}
                  </div>
                )}

                {manca && (
                  <div style={{ fontSize: 12, color: T.error, fontWeight: 600, marginTop: 6 }}>
                    Senza questo campo non si può importare.
                  </div>
                )}
              </div>
            );
          })}

          <button
            style={{ ...bottonePrimario, background: mancanoObbligatorie.length ? T.textLight : T.blue }}
            disabled={!!mancanoObbligatorie.length || caricando || !righe.length}
            onClick={preparaConferma}>
            {caricando ? "Controllo il catalogo…" : "Le colonne sono giuste →"}
          </button>
          <button style={bottoneChiaro} onClick={() => { setFase("file"); setNomeFile(""); }}>
            ← Cambia file
          </button>
        </>
      )}

      {/* ── 3. LA CONFERMA ──────────────────────────────── */}
      {fase === "conferma" && analisi && (
        <>
          <div style={{
            background: T.card, border: `1.5px solid ${T.border}`, borderRadius: 18,
            display: "flex", marginBottom: 12, overflow: "hidden",
          }}>
            <Numerone n={daScrivere.length}   testo="da scrivere"   colore={T.blue} />
            <div style={{ width: 1, background: T.border }} />
            <Numerone n={giaPresenti.length}  testo="già a catalogo" colore={T.textLight} />
            <div style={{ width: 1, background: T.border }} />
            <Numerone n={analisi.scarti.length} testo="con errori"   colore={analisi.scarti.length ? T.orange : T.textLight} />
          </div>

          {/* La somma scritta per esteso: è quello che rende visibile un
              difetto di classificazione PRIMA di scrivere. Se i conti non
              tornano con quello che ti aspetti, la colonna è sbagliata. */}
          <div style={{ fontSize: 12.5, color: T.textLight, textAlign: "center", marginBottom: 14 }}>
            {daScrivere.length.toLocaleString("it-IT")} + {giaPresenti.length.toLocaleString("it-IT")} + {analisi.scarti.length.toLocaleString("it-IT")} = {righeLette.toLocaleString("it-IT")} righe lette dal file
          </div>

          {eccessoGrave && (
            <Riquadro colore={T.error} fondo="#FEF2F2">
              <b style={{ color: T.error }}>Il file sembra diviso male.</b> {analisi.colonneInEccesso.toLocaleString("it-IT")} righe
              hanno più colonne dell'intestazione. Di solito vuol dire che il
              separatore non è quello giusto, o che da qualche parte c'è una
              virgoletta aperta e mai chiusa. Torna indietro e controlla
              l'anteprima prima di scrivere.
            </Riquadro>
          )}

          <Riquadro colore={T.orange} fondo={T.orangePale}>
            <b style={{ color: T.text }}>⚠️ Cosa succede quando premi</b>
            <div style={{ marginTop: 6 }}>
              · Aggiungo <b>{daScrivere.length.toLocaleString("it-IT")} ricambi nuovi</b><br />
              · <b>Non modifico e non cancello niente</b> di quello che c'è già<br />
              · Salto <b>{giaPresenti.length.toLocaleString("it-IT")} codici</b> perché sono già a catalogo<br />
              · I ricambi nascono <b>senza foto</b>: si aggiungono dopo, aprendoli
              {analisi.cartelle.length > 0 && <><br />· Creo <b>{analisi.cartelle.length} cartelle</b></>}
            </div>
          </Riquadro>

          {nVarianti > 0 && (
            <Riquadro colore={T.orange} fondo={T.orangePale}>
              <b style={{ color: T.text }}>
                {nVarianti.toLocaleString("it-IT")} codici differiscono da un altro solo per le maiuscole.
              </b>
              <div style={{ marginTop: 6 }}>
                Verranno scritti <b>tutti</b>, perché sono ricambi diversi: è la
                regola dell'archivio. Guardali però una volta, perché è così che
                un refuso si traveste da ricambio nuovo.
              </div>
              <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 12, color: T.textMid }}>
                {[...(analisi.varianti || []).map(v => ({ ...v, gemelli: [v.gemello] })), ...variantiCatalogo]
                  .slice(0, 8)
                  .map(v => (
                    <div key={`${v.nRiga}-${v.code}`}>riga {v.nRiga}: {v.code} ≠ {v.gemelli.join(", ")}</div>
                  ))}
                {nVarianti > 8 && <div>… e altri {nVarianti - 8}</div>}
              </div>
            </Riquadro>
          )}

          {analisi.macchinari.length > 0 && (
            <Riquadro>
              <b style={{ color: T.text }}>{analisi.macchinari.length} macchinari</b> trovati
              nella compatibilità: {analisi.macchinari.slice(0, 12).join(" · ")}
              {analisi.macchinari.length > 12 ? ` … e altri ${analisi.macchinari.length - 12}` : ""}
              <div style={{ marginTop: 6, color: T.textLight, fontSize: 12.5 }}>
                Se sono molti più di quelli che hai davvero, la colonna della
                compatibilità contiene qualcos'altro: ogni grafia diversa
                diventa un macchinario a sé nel menu del tecnico.
              </div>
            </Riquadro>
          )}

          {analisi.scarti.length > 0 && (
            <Riquadro colore={T.orange}>
              <b style={{ color: T.text }}>{analisi.scarti.length} righe non verranno scritte.</b>
              <div style={{ marginTop: 6 }}>
                {[...new Set(analisi.scarti.map(s => s.motivo.replace(/, già alla riga \d+/, "")))].slice(0, 5).map(m => (
                  <div key={m}>· {m}</div>
                ))}
              </div>
              <button
                style={{ ...bottoneChiaro, marginTop: 10, padding: 11 }}
                onClick={scaricaScarti}>
                ⬇️ Scarica le righe scartate
              </button>
            </Riquadro>
          )}

          <button
            style={{ ...bottonePrimario, background: daScrivere.length ? T.orange : T.textLight }}
            disabled={!daScrivere.length}
            onClick={scrivi}>
            ✅ Scrivi {daScrivere.length.toLocaleString("it-IT")} ricambi nel catalogo
          </button>
          <button style={bottoneChiaro} onClick={() => setFase("mappa")}>← Rivedi le colonne</button>
        </>
      )}

      {/* ── 4. LA SCRITTURA ─────────────────────────────── */}
      {fase === "scrive" && (
        <div style={{ textAlign: "center", padding: "28px 8px" }}>
          <Spinner size={34} />
          <div style={{ fontSize: 17, fontWeight: 700, color: T.text, marginTop: 16 }}>
            {progresso.fatti.toLocaleString("it-IT")} di {progresso.totale.toLocaleString("it-IT")}
          </div>
          <div style={{
            height: 10, background: T.bluePale, borderRadius: 6, overflow: "hidden",
            margin: "14px 0 10px",
          }}>
            <div style={{
              height: "100%", background: T.blue, borderRadius: 6,
              width: `${progresso.totale ? Math.round((progresso.fatti / progresso.totale) * 100) : 0}%`,
              transition: "width 0.3s",
            }} />
          </div>
          <div style={{ fontSize: 13, color: T.textLight, marginBottom: 18 }}>
            Non chiudere la pagina. Si scrive a blocchi da 300.
          </div>
          <button
            style={{ ...bottoneChiaro, color: T.error, borderColor: T.border }}
            onClick={() => { fermato.current = true; }}>
            Interrompi
          </button>
        </div>
      )}

      {/* ── 5. L'ESITO ──────────────────────────────────── */}
      {fase === "esito" && esito && (
        <>
          <div style={{ textAlign: "center", padding: "10px 0 18px" }}>
            <div style={{ fontSize: 44 }}>{esito.errore ? "⚠️" : esito.interrotto ? "⏸️" : "✅"}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.text, marginTop: 8 }}>
              {esito.scritti.toLocaleString("it-IT")} ricambi nel catalogo
            </div>
            {(esito.interrotto || esito.errore) && (
              <div style={{ fontSize: 13.5, color: T.textMid, marginTop: 6 }}>
                {esito.interrotto ? "Import interrotto da te." : "Import fermato da un errore."}
              </div>
            )}
          </div>

          {(esito.interrotto || esito.errore) && (
            <Riquadro colore={T.orange} fondo={T.orangePale}>
              <b style={{ color: T.text }}>Riprova con lo stesso identico file.</b> I
              ricambi già scritti verranno riconosciuti dal codice e saltati da
              soli: verranno aggiunti solo quelli che mancano. Non serve
              preparare un file ridotto, e ripassare due volte non crea doppioni.
            </Riquadro>
          )}

          {esito.annullati > 0 && (
            <Riquadro colore={T.error} fondo="#FEF2F2">
              Import annullato: {esito.annullati.toLocaleString("it-IT")} ricambi eliminati.
            </Riquadro>
          )}

          {(esito.scartate?.length > 0 || analisi?.scarti?.length > 0) && (
            <Riquadro colore={T.orange}>
              <b style={{ color: T.text }}>
                {((esito.scartate?.length || 0) + (analisi?.scarti?.length || 0)).toLocaleString("it-IT")} righe non sono entrate.
              </b>
              <div style={{ marginTop: 4 }}>
                Il file che scarichi ha le stesse colonne dell'originale più il
                numero di riga e il motivo: si corregge e si ricarica così com'è.
              </div>
              <button style={{ ...bottoneChiaro, marginTop: 10, padding: 11 }} onClick={scaricaScarti}>
                ⬇️ Scarica le righe scartate
              </button>
            </Riquadro>
          )}

          <button style={bottonePrimario} onClick={onDone}>Vai al catalogo</button>

          {esito.idScritti?.length > 0 && (
            <button
              style={{ ...bottoneChiaro, color: T.error }}
              disabled={caricando}
              onClick={() => setChiedoAnnulla(true)}>
              ↩️ Annulla l'import ({esito.idScritti.length.toLocaleString("it-IT")} ricambi)
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ===================== FOTO IN BLOCCO =====================
// Si trascina dentro una cartella di fotografie e ognuna va sul suo ricambio,
// riconosciuta dal nome del file. Le tre versioni — piena 1400px, copertina
// 512px per l'AI, miniatura 128px — le genera questo browser, esattamente
// come quando si carica una foto sola dal form: il telefono del tecnico non
// deve scaricare un pixel in più del necessario.
//
// ⚠️ Non tocca nient'altro del ricambio. Codice, nome, descrizione, cartella
//    e compatibilità restano quelli che sono: qui si stanno caricando
//    fotografie, e un import che "sistema" anche il resto è il modo in cui si
//    perde una descrizione scritta a mano.
function FotoBulkScreen({ onDone, onBack }) {
  const [fase, setFase]         = useState("file");
  const [errore, setErrore]     = useState("");
  const [caricando, setCaricando] = useState(false);
  const [abbinamenti, setAbbinamenti] = useState([]);
  const [soloSenzaFoto, setSoloSenzaFoto] = useState(true);
  const [progresso, setProgresso] = useState({ fatti: 0, totale: 0 });
  const [esito, setEsito]       = useState(null);
  const [trascina, setTrascina] = useState(false);
  const fermato = useRef(false);

  async function scegliFoto(lista) {
    const files = [...(lista || [])].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (!files.length) {
      setErrore("Non ho trovato nessuna immagine fra i file scelti.");
      return;
    }
    setErrore(""); setCaricando(true); setEsito(null);
    try {
      const { perCodice, perMinuscolo } = await cloud.mappaCodici();
      if (!perCodice.size) {
        setErrore("Il catalogo è vuoto: prima vanno caricati i ricambi, poi le loro foto.");
        setCaricando(false);
        return;
      }
      const fatti = files
        .map(file => ({ file, nome: file.name, ...abbinaFoto(file.name, perCodice, perMinuscolo) }))
        // Più foto sullo stesso ricambio nell'ordine del suffisso, e a parità
        // di suffisso in ordine di nome: così "(2)" arriva prima di "(10)" e
        // la copertina è sempre quella che l'occhio si aspetta.
        .sort((a, b) => (a.ordine || 1) - (b.ordine || 1) || a.nome.localeCompare(b.nome, "it"));
      setAbbinamenti(fatti);
      setFase("anteprima");
    } catch (e) {
      console.error("foto in blocco: lettura catalogo", e);
      setErrore(e.message || "Non riesco a leggere i codici dal catalogo.");
    } finally {
      setCaricando(false);
    }
  }

  // ── Raggruppa per ricambio ────────────────────────────────
  const gruppi = [];
  const perId = new Map();
  for (const a of abbinamenti) {
    if (a.esito !== "esatto" && a.esito !== "maiuscole") continue;
    if (!perId.has(a.id)) {
      const g = { id: a.id, code: a.code, conFoto: a.conFoto, files: [] };
      perId.set(a.id, g); gruppi.push(g);
    }
    perId.get(a.id).files.push(a);
  }
  const daFare      = gruppi.filter(g => !soloSenzaFoto || !g.conFoto);
  const saltati     = gruppi.length - daFare.length;
  const nonAbbinate = abbinamenti.filter(a => a.esito === "assente");
  const ambigue     = abbinamenti.filter(a => a.esito === "ambiguo");
  const fotoDaCaricare = daFare.reduce((n, g) => n + g.files.length, 0);

  // ── Il caricamento vero ───────────────────────────────────
  async function carica() {
    fermato.current = false;
    setFase("carica");
    setProgresso({ fatti: 0, totale: fotoDaCaricare });
    const errori = [];
    let ricambiFatti = 0, fotoFatte = 0;

    for (const g of daFare) {
      if (fermato.current) break;
      try {
        const esistenti = await cloud.loadPartImages(g.id);
        const spazio = MAX_PART_IMAGES - esistenti.length;
        if (spazio <= 0) {
          for (const f of g.files) errori.push({ nome: f.nome, motivo: `${g.code} ha già ${MAX_PART_IMAGES} foto` });
          setProgresso(p => ({ ...p, fatti: p.fatti + g.files.length }));
          continue;
        }
        const nuove = [];
        for (const f of g.files.slice(0, spazio)) {
          if (fermato.current) break;
          try {
            // Le stesse tre versioni del form, con le stesse misure: una foto
            // caricata da qui e una caricata dal telefono devono pesare
            // uguale, o il risparmio sui dati del tecnico salta da una parte.
            const full  = await compressImage(f.file, PHOTO_FULL_PX, PHOTO_FULL_Q);
            const ai    = await makeThumb(full, PHOTO_AI_PX, PHOTO_AI_Q);
            const thumb = await makeThumb(full, PHOTO_THUMB_PX, PHOTO_THUMB_Q);
            nuove.push({ full, thumb: thumb || full, ai });
          } catch (e) {
            errori.push({ nome: f.nome, motivo: "immagine illeggibile o troppo grande" });
          }
          setProgresso(p => ({ ...p, fatti: p.fatti + 1 }));
        }
        for (const f of g.files.slice(spazio)) {
          errori.push({ nome: f.nome, motivo: `${g.code} arriva al massimo di ${MAX_PART_IMAGES} foto` });
          setProgresso(p => ({ ...p, fatti: p.fatti + 1 }));
        }
        if (nuove.length) {
          await cloud.aggiornaFotoRicambio(g.id, [...esistenti, ...nuove]);
          ricambiFatti++; fotoFatte += nuove.length;
        }
      } catch (e) {
        console.error("foto in blocco:", g.code, e);
        // Un ricambio che fallisce non ferma gli altri: il rapporto finale
        // dirà quali sono rimasti indietro, e si ripassa solo su quelli.
        for (const f of g.files) errori.push({ nome: f.nome, motivo: e.message || "scrittura non riuscita" });
        if (/permess/i.test(e.message || "")) { setErrore(e.message); break; }
      }
    }
    setEsito({ ricambiFatti, fotoFatte, errori, interrotto: fermato.current });
    setFase("esito");
  }

  function scaricaNonAbbinate() {
    const righe = [
      "sep=;",
      "file;motivo",
      ...nonAbbinate.map(a => [a.nome, "nessun ricambio con questo codice"].map(cellaCSV).join(";")),
      ...ambigue.map(a => [a.nome, `più ricambi uguali a meno di maiuscole: ${a.gemelli.join(", ")}`].map(cellaCSV).join(";")),
      ...(esito?.errori || []).map(e => [e.nome, e.motivo].map(cellaCSV).join(";")),
    ];
    scaricaTesto("foto-non-caricate.csv", righe.join("\r\n"));
  }

  const Riquadro = ({ children, colore = T.border, fondo = T.card }) => (
    <div style={{
      background: fondo, border: `1.5px solid ${colore}`, borderRadius: 16,
      padding: 14, marginBottom: 12, fontSize: 13.5, color: T.textMid, lineHeight: 1.5,
    }}>{children}</div>
  );
  const bottonePrimario = {
    width: "100%", padding: 15, borderRadius: 14, background: T.blue, color: "white",
    fontSize: 15.5, fontWeight: 700, marginTop: 6,
  };
  const bottoneChiaro = {
    width: "100%", padding: 13, borderRadius: 14, background: "transparent",
    color: T.blue, fontSize: 14.5, fontWeight: 600, border: `1.5px solid ${T.border}`, marginTop: 8,
  };

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 4, letterSpacing: "-0.4px" }}>
        📷 Foto in blocco
      </h2>
      <div style={{ fontSize: 13, color: T.textLight, marginBottom: 18 }}>
        Una cartella di fotografie, ognuna sul suo ricambio
      </div>

      {errore && (
        <div style={{
          background: "#FEF2F2", border: `1.5px solid ${T.error}`, color: T.error,
          borderRadius: 14, padding: 13, marginBottom: 12, fontSize: 13.5, fontWeight: 600, lineHeight: 1.5,
        }}>{errore}</div>
      )}

      {/* ── 1. LE FOTO ──────────────────────────────────── */}
      {fase === "file" && (
        <>
          <div
            onDragOver={e => { e.preventDefault(); setTrascina(true); }}
            onDragLeave={() => setTrascina(false)}
            onDrop={e => { e.preventDefault(); setTrascina(false); scegliFoto(e.dataTransfer?.files); }}
            style={{
              border: `2px dashed ${trascina ? T.blue : T.border}`,
              background: trascina ? T.bluePale : T.card,
              borderRadius: 18, padding: "34px 18px", textAlign: "center", marginBottom: 14,
            }}>
            <div style={{ fontSize: 38, marginBottom: 8 }}>🖼️</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>
              Trascina qui le fotografie
            </div>
            <div style={{ fontSize: 12.5, color: T.textLight, marginBottom: 14 }}>oppure</div>
            <PhotoPicker
              id="foto-blocco"
              multiple
              disabled={caricando}
              onFile={e => scegliFoto(e.target.files)}
              style={{
                display: "inline-block", padding: "12px 22px", borderRadius: 14,
                background: T.blue, color: "white", fontSize: 14.5, fontWeight: 700, cursor: "pointer",
              }}>
              {caricando ? "Leggo il catalogo…" : "Scegli le foto"}
            </PhotoPicker>
          </div>

          <Riquadro>
            <b style={{ color: T.text }}>Il nome del file è il codice.</b> `AB-1234.jpg`
            va sul ricambio `AB-1234`. Per mettere più foto sullo stesso pezzo:
            <span style={{ fontFamily: "monospace" }}> AB-1234 (2).jpg</span>,
            <span style={{ fontFamily: "monospace" }}> AB-1234_2.jpg</span> o
            <span style={{ fontFamily: "monospace" }}> AB-1234-3.jpg</span>. La prima
            diventa la copertina, ed è l'unica che viaggia verso l'AI.
            Massimo {MAX_PART_IMAGES} foto per ricambio.
          </Riquadro>

          <Riquadro colore={T.orange} fondo={T.orangePale}>
            <b style={{ color: T.text }}>Le maiuscole contano, ma i nomi dei file no.</b>{" "}
            Windows non distingue <span style={{ fontFamily: "monospace" }}>AB.jpg</span> da{" "}
            <span style={{ fontFamily: "monospace" }}>ab.jpg</span>, quindi se in
            archivio hai due ricambi che differiscono solo per le maiuscole non
            c'è modo di sapere a quale appartenga la foto: quei file te li
            segnalo e restano da assegnare a mano, aprendo il ricambio.
          </Riquadro>

          <button style={bottoneChiaro} onClick={onBack}>← Torna al catalogo</button>
        </>
      )}

      {/* ── 2. L'ANTEPRIMA ──────────────────────────────── */}
      {fase === "anteprima" && (
        <>
          <div style={{
            background: T.card, border: `1.5px solid ${T.border}`, borderRadius: 18,
            display: "flex", marginBottom: 12, overflow: "hidden",
          }}>
            <div style={{ flex: 1, textAlign: "center", padding: "10px 4px" }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: T.blue }}>{fotoDaCaricare}</div>
              <div style={{ fontSize: 11.5, color: T.textLight, fontWeight: 600 }}>foto</div>
            </div>
            <div style={{ width: 1, background: T.border }} />
            <div style={{ flex: 1, textAlign: "center", padding: "10px 4px" }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: T.blue }}>{daFare.length}</div>
              <div style={{ fontSize: 11.5, color: T.textLight, fontWeight: 600 }}>ricambi</div>
            </div>
            <div style={{ width: 1, background: T.border }} />
            <div style={{ flex: 1, textAlign: "center", padding: "10px 4px" }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: (nonAbbinate.length + ambigue.length) ? T.orange : T.textLight }}>
                {nonAbbinate.length + ambigue.length}
              </div>
              <div style={{ fontSize: 11.5, color: T.textLight, fontWeight: 600 }}>senza ricambio</div>
            </div>
          </div>

          <label style={{ display: "flex", gap: 9, alignItems: "flex-start", marginBottom: 14, fontSize: 13.5, color: T.textMid }}>
            <input type="checkbox" checked={soloSenzaFoto}
              onChange={e => setSoloSenzaFoto(e.target.checked)}
              style={{ marginTop: 3, width: 17, height: 17, flexShrink: 0 }} />
            <span>
              <b>Salta i ricambi che hanno già una foto</b> ({saltati} in questo gruppo)
              <div style={{ color: T.textLight, fontSize: 12.5, marginTop: 2 }}>
                Tienilo acceso e ripassare la stessa cartella non aggiunge doppioni.
                Spegnilo solo se stai aggiungendo di proposito altre foto a
                ricambi che ne hanno già una.
              </div>
            </span>
          </label>

          {daFare.length > 0 && (
            <Riquadro>
              <b style={{ color: T.text }}>Primi abbinamenti</b>
              <div style={{ marginTop: 6, fontFamily: "monospace", fontSize: 12 }}>
                {daFare.slice(0, 8).map(g => (
                  <div key={g.id} className="wrap-anywhere">
                    {g.files.map(f => f.nome).join(", ")} → <b>{g.code}</b>
                  </div>
                ))}
                {daFare.length > 8 && <div>… e altri {daFare.length - 8} ricambi</div>}
              </div>
            </Riquadro>
          )}

          {ambigue.length > 0 && (
            <Riquadro colore={T.orange} fondo={T.orangePale}>
              <b style={{ color: T.text }}>{ambigue.length} foto non so a chi darle.</b>
              <div style={{ marginTop: 6 }}>
                Il nome corrisponde a più ricambi che differiscono solo per le
                maiuscole, e dal nome di un file la grafia esatta non si
                ricostruisce. Vanno caricate a mano aprendo il ricambio giusto.
              </div>
              <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 12 }}>
                {ambigue.slice(0, 5).map(a => (
                  <div key={a.nome} className="wrap-anywhere">{a.nome} → {a.gemelli.join(" · ")}</div>
                ))}
              </div>
            </Riquadro>
          )}

          {nonAbbinate.length > 0 && (
            <Riquadro colore={T.orange}>
              <b style={{ color: T.text }}>{nonAbbinate.length} foto senza un ricambio.</b>
              <div style={{ marginTop: 6 }}>
                Nessun codice a catalogo corrisponde al nome del file. Se i
                ricambi non li hai ancora caricati, fallo prima: le foto
                riconoscono i codici, non il contrario.
              </div>
              <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 12 }}>
                {nonAbbinate.slice(0, 5).map(a => <div key={a.nome} className="wrap-anywhere">{a.nome}</div>)}
                {nonAbbinate.length > 5 && <div>… e altre {nonAbbinate.length - 5}</div>}
              </div>
              <button style={{ ...bottoneChiaro, marginTop: 10, padding: 11 }} onClick={scaricaNonAbbinate}>
                ⬇️ Scarica l'elenco
              </button>
            </Riquadro>
          )}

          <Riquadro colore={T.orange} fondo={T.orangePale}>
            <b style={{ color: T.text }}>⚠️ Cosa succede quando premi</b>
            <div style={{ marginTop: 6 }}>
              · Carico <b>{fotoDaCaricare} foto</b> su <b>{daFare.length} ricambi</b><br />
              · Di ogni foto genero tre versioni: piena, copertina per l'AI, miniatura<br />
              · <b>Non tocco nient'altro</b>: codice, nome, descrizione e cartella restano quelli<br />
              · Le foto già presenti su un ricambio <b>non vengono sostituite</b>: le nuove vanno in coda
            </div>
          </Riquadro>

          <button
            style={{ ...bottonePrimario, background: fotoDaCaricare ? T.orange : T.textLight }}
            disabled={!fotoDaCaricare}
            onClick={carica}>
            ✅ Carica {fotoDaCaricare} foto
          </button>
          <button style={bottoneChiaro} onClick={() => { setFase("file"); setAbbinamenti([]); }}>
            ← Scegli altre foto
          </button>
        </>
      )}

      {/* ── 3. IL CARICAMENTO ───────────────────────────── */}
      {fase === "carica" && (
        <div style={{ textAlign: "center", padding: "28px 8px" }}>
          <Spinner size={34} />
          <div style={{ fontSize: 17, fontWeight: 700, color: T.text, marginTop: 16 }}>
            {progresso.fatti} di {progresso.totale} foto
          </div>
          <div style={{ height: 10, background: T.bluePale, borderRadius: 6, overflow: "hidden", margin: "14px 0 10px" }}>
            <div style={{
              height: "100%", background: T.blue, borderRadius: 6,
              width: `${progresso.totale ? Math.round((progresso.fatti / progresso.totale) * 100) : 0}%`,
              transition: "width 0.3s",
            }} />
          </div>
          <div style={{ fontSize: 13, color: T.textLight, marginBottom: 18 }}>
            Ogni foto viene rimpicciolita qui prima di partire: è la parte lenta,
            ed è anche quella che fa risparmiare dati ai tecnici. Non chiudere la pagina.
          </div>
          <button style={{ ...bottoneChiaro, color: T.error }} onClick={() => { fermato.current = true; }}>
            Interrompi
          </button>
        </div>
      )}

      {/* ── 4. L'ESITO ──────────────────────────────────── */}
      {fase === "esito" && esito && (
        <>
          <div style={{ textAlign: "center", padding: "10px 0 18px" }}>
            <div style={{ fontSize: 44 }}>{esito.interrotto ? "⏸️" : esito.errori.length ? "⚠️" : "✅"}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.text, marginTop: 8 }}>
              {esito.fotoFatte} foto su {esito.ricambiFatti} ricambi
            </div>
            {esito.interrotto && (
              <div style={{ fontSize: 13.5, color: T.textMid, marginTop: 6 }}>Caricamento interrotto da te.</div>
            )}
          </div>

          {(esito.interrotto || esito.errori.length > 0) && (
            <Riquadro colore={T.orange} fondo={T.orangePale}>
              <b style={{ color: T.text }}>Ripassa pure la stessa cartella.</b> Con
              "salta i ricambi che hanno già una foto" acceso, quelli sistemati
              vengono lasciati stare e si riprende da dove eri rimasto.
            </Riquadro>
          )}

          {(esito.errori.length > 0 || nonAbbinate.length > 0 || ambigue.length > 0) && (
            <Riquadro colore={T.orange}>
              <b style={{ color: T.text }}>
                {esito.errori.length + nonAbbinate.length + ambigue.length} foto non sono entrate.
              </b>
              <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 12 }}>
                {esito.errori.slice(0, 6).map((e, i) => (
                  <div key={i} className="wrap-anywhere">{e.nome} — {e.motivo}</div>
                ))}
              </div>
              <button style={{ ...bottoneChiaro, marginTop: 10, padding: 11 }} onClick={scaricaNonAbbinate}>
                ⬇️ Scarica l'elenco completo
              </button>
            </Riquadro>
          )}

          <button style={bottonePrimario} onClick={onDone}>Vai al catalogo</button>
          <button style={bottoneChiaro} onClick={() => { setFase("file"); setAbbinamenti([]); setEsito(null); }}>
            📷 Carica altre foto
          </button>
        </>
      )}
    </div>
  );
}

// ===================== SETTINGS =====================
// ===================== PANNELLO RICONOSCIMENTO =====================
// Quello che i tecnici hanno risposto, nella stessa forma in cui lo legge
// l'AI. Serve a una decisione precisa: alzare o no AI_EFFORT, e su quali
// schede vale la pena lavorare.
//
// ⚠️ Ogni numero che parla di persone conta PERSONE DISTINTE. Dieci conferme
//    di dieci tecnici sono dieci pareri indipendenti; dieci conferme dello
//    stesso tecnico sono un parere ripetuto dieci volte. Mostrarli con lo
//    stesso numero farebbe prendere decisioni sbagliate, ed è il motivo per
//    cui accanto a "volte" c'è sempre "persone".
function FeedbackPanel() {
  const [giorni, setGiorni] = useState(90);
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState("");
  const [caricando, setCaricando] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCaricando(true); setErrore("");
    cloud.feedbackReport(giorni)
      .then(r => { if (vivo) setDati(r); })
      .catch(e => { if (vivo) { setErrore(e.message || "Rapporto non disponibile."); setDati(null); } })
      .finally(() => { if (vivo) setCaricando(false); });
    return () => { vivo = false; };
  }, [giorni]);

  const t = dati?.totali || {};
  const valutazioni = Number(t.valutazioni || 0);
  const corrette = Number(t.corrette || 0);
  const percentuale = valutazioni ? Math.round((corrette / valutazioni) * 100) : null;
  const settimane = dati?.settimane || [];
  const mancati = dati?.mancati || [];
  const peggiori = dati?.peggiori || [];
  const confusioni = dati?.confusioni || [];

  const Titoletto = ({ children }) => (
    <div style={{ fontSize: 12.5, fontWeight: 700, color: T.textMid, margin: "16px 0 8px" }}>{children}</div>
  );
  const Riga = ({ code, name, persone, volte, extra }) => (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "7px 0", borderTop: `1px solid ${T.border}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="wrap-anywhere" style={{ fontFamily: "monospace", fontSize: 11.5, color: T.blue, fontWeight: 700 }}>{code}</div>
        <div className="wrap-anywhere" style={{ fontSize: 12.5, color: T.text }}>{name}{extra}</div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{persone}</div>
        <div style={{ fontSize: 10.5, color: T.textLight }}>{persone === 1 ? "tecnico" : "tecnici"} · {volte}×</div>
      </div>
    </div>
  );

  return (
    <div style={{ background: T.card, borderRadius: 20, padding: 20, border: `1px solid ${T.border}`, boxShadow: T.shadow, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <h3 style={{ fontWeight: 800, color: T.text, fontSize: 17, flex: 1 }}>📊 Riconoscimento</h3>
        <select value={giorni} onChange={e => setGiorni(Number(e.target.value))}
          style={{ padding: "7px 9px", borderRadius: 10, border: `1.5px solid ${T.border}`, background: T.card, fontSize: 12.5, color: T.text }}>
          <option value={30}>30 giorni</option>
          <option value={90}>90 giorni</option>
          <option value={365}>un anno</option>
        </select>
      </div>

      {caricando && <div style={{ padding: "18px 0", textAlign: "center" }}><Spinner size={22} /></div>}

      {!caricando && errore && (
        <div style={{ background: "#FEF2F2", border: `1px solid ${T.error}`, borderRadius: 12, padding: 12, fontSize: 12.5, color: T.error, lineHeight: 1.5 }}>
          {errore}
        </div>
      )}

      {!caricando && !errore && valutazioni === 0 && (
        <p style={{ color: T.textMid, fontSize: 13, lineHeight: 1.6, marginTop: 6 }}>
          Nessuna valutazione in questo periodo. I tecnici rispondono 👍 o 👎 sotto
          ogni scansione: finché non arrivano risposte, l'AI lavora solo sul testo
          delle schede e non c'è niente da misurare.
        </p>
      )}

      {!caricando && !errore && valutazioni > 0 && (
        <>
          <div style={{ display: "flex", marginTop: 10, borderRadius: 14, overflow: "hidden", border: `1px solid ${T.border}` }}>
            {[
              { n: `${percentuale}%`, e: "corrette", c: percentuale >= 80 ? T.success : percentuale >= 60 ? T.orange : T.error },
              { n: valutazioni, e: "valutazioni", c: T.text },
              { n: Number(t.tecnici || 0), e: Number(t.tecnici) === 1 ? "tecnico" : "tecnici", c: T.text },
            ].map((b, i) => (
              <div key={i} style={{ flex: 1, textAlign: "center", padding: "10px 4px", borderLeft: i ? `1px solid ${T.border}` : "none" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: b.c }}>{b.n}</div>
                <div style={{ fontSize: 11, color: T.textLight, fontWeight: 600 }}>{b.e}</div>
              </div>
            ))}
          </div>

          {settimane.length > 1 && (
            <>
              <Titoletto>Andamento per settimana</Titoletto>
              {settimane.map(s => {
                const v = Number(s.valutazioni || 0), c = Number(s.corrette || 0);
                const p = v ? Math.round((c / v) * 100) : 0;
                return (
                  <div key={s.settimana} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                    <span style={{ fontSize: 11, color: T.textLight, width: 62, flexShrink: 0 }}>{s.settimana}</span>
                    <div style={{ flex: 1, height: 8, background: T.bluePale, borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ width: `${p}%`, height: "100%", background: p >= 80 ? T.success : p >= 60 ? T.orange : T.error }} />
                    </div>
                    <span style={{ fontSize: 11, color: T.textMid, width: 58, textAlign: "right", flexShrink: 0 }}>{p}% · {v}</span>
                  </div>
                );
              })}
            </>
          )}

          {mancati.length > 0 && (
            <>
              <Titoletto>🔍 Non li trova: schede da riscrivere</Titoletto>
              <p style={{ fontSize: 11.5, color: T.textLight, lineHeight: 1.5, marginBottom: 2 }}>
                L'AI ha risposto "nessuna corrispondenza" e il tecnico ha trovato il
                pezzo da solo. È la lista su cui conviene lavorare per prima: quasi
                sempre la descrizione è povera, o manca la foto.
              </p>
              {mancati.map(m => (
                <Riga key={m.id} code={m.code} name={m.name} persone={Number(m.trovato_da)} volte={Number(m.volte)}
                  extra={m.con_foto ? "" : <span style={{ color: T.orange, fontWeight: 600 }}> · senza foto</span>} />
              ))}
            </>
          )}

          {peggiori.length > 0 && (
            <>
              <Titoletto>👎 Più segnalati come sbagliati</Titoletto>
              {peggiori.map(p => <Riga key={p.id} code={p.code} name={p.name} persone={Number(p.segnalato_da)} volte={Number(p.volte)} />)}
            </>
          )}

          {confusioni.length > 0 && (
            <>
              <Titoletto>🔀 Coppie che si confondono</Titoletto>
              {confusioni.map((c, i) => (
                <Riga key={i} code={`${c.proposto_code} → ${c.vero_code}`}
                  name={`${c.proposto_name} scambiato per ${c.vero_name}`}
                  persone={Number(c.tecnici)} volte={Number(c.volte)} />
              ))}
            </>
          )}

          <p style={{ fontSize: 11.5, color: T.textLight, lineHeight: 1.6, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
            Questi numeri sono gli stessi che legge l'AI a ogni scansione. Una scheda
            entra nel suo contesto con <b>due tecnici diversi</b> che l'hanno valutata,
            oppure con tre valutazioni della stessa persona. Correggere una scheda
            <b> azzera i giudizi precedenti</b>: quelli parlavano di un altro testo.
          </p>
        </>
      )}
    </div>
  );
}

function SettingsScreen({ partsCount, userEmail }) {
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [feedback, setFeedback] = useState({ msg: "", type: "" });
  const [saving, setSaving] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeMsg, setPurgeMsg] = useState({ msg: "", type: "" });

  // Da admin la stessa chiamata cancella le scansioni di tutti: è la policy
  // "history_delete_admin" a decidere l'ambito, non un parametro del client.
  async function purgeHistory() {
    setPurging(true); setPurgeMsg({ msg: "", type: "" });
    try {
      const n = await cloud.clearHistory();
      setPurgeMsg(n > 0
        ? { msg: `✅ ${n} scansioni eliminate da tutti i tecnici.`, type: "success" }
        : { msg: "Non c'era nulla da eliminare.", type: "success" });
    } catch (e) {
      console.error("purgeHistory:", e);
      setPurgeMsg({ msg: `Eliminazione non riuscita: ${e.message || ""}`, type: "error" });
    } finally {
      setPurging(false);
      setConfirmPurge(false);
    }
  }

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
      {confirmPurge && (
        <ConfirmDialog
          message={`Eliminare la cronologia delle scansioni di TUTTI i tecnici? L'operazione è irreversibile. Le scansioni si cancellano comunque da sole dopo ${HISTORY_RETENTION_DAYS} giorni: usa questo comando solo se serve liberare spazio subito.`}
          onConfirm={purgeHistory}
          onCancel={() => setConfirmPurge(false)}
        />
      )}

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

      <FeedbackPanel />

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
            <CampoPassword
              value={val} autoComplete="new-password"
              onChange={e => { set(e.target.value); setFeedback({ msg: "", type: "" }); }}
              placeholder={ph}
              colore={T.textLight}
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

      {/* Cronologia */}
      <div style={{ background: T.card, borderRadius: 20, padding: 20, border: `1px solid ${T.border}`, boxShadow: T.shadow, marginBottom: 16 }}>
        <h3 style={{ fontWeight: 800, color: T.text, marginBottom: 6, fontSize: 17 }}>🕐 Cronologia scansioni</h3>
        <p style={{ color: T.textMid, fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
          Le scansioni si cancellano da sole dopo <strong>{HISTORY_RETENTION_DAYS} giorni</strong>: il
          database non cresce e non serve fare manutenzione. Questo comando le elimina
          subito, per tutti i tecnici — serve solo se devi liberare spazio immediatamente.
        </p>
        {purgeMsg.msg && (
          <div style={{
            padding: "12px 14px", borderRadius: 12, marginBottom: 14, fontSize: 14,
            background: purgeMsg.type === "success" ? "#F0FDF4" : "#FEF2F2",
            color: purgeMsg.type === "success" ? T.success : T.error,
            border: `1px solid ${purgeMsg.type === "success" ? "#86EFAC" : "#FECACA"}`
          }}>{purgeMsg.msg}</div>
        )}
        <button onClick={() => setConfirmPurge(true)} disabled={purging} style={{
          width: "100%", padding: 13, borderRadius: 12,
          background: "#FEF2F2", color: T.error, fontSize: 14, fontWeight: 700,
          border: "1px solid #FECACA",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8
        }}>
          {purging ? <><Spinner size={16} color={T.error} /> Eliminazione...</> : "🗑️ Svuota la cronologia di tutti"}
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
  const [partsCount, setPartsCount]   = useState(0);
  const [sessionUnverified, setSessionUnverified] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [partsLoading, setPartsLoading] = useState(false);
  const [loadError, setLoadError]     = useState("");
  const [expiredReason, setExpiredReason] = useState(null);   // "age" | "idle" | null
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

  // Chiude la sessione spiegandone il motivo. Unico punto da cui si esce
  // per scadenza, chiamato sia dai timer locali sia dal verdetto del server.
  async function expireSession(reason) {
    setExpiredReason(reason === "idle" ? "idle" : "age");
    forgetLoginTime();
    await supabase.auth.signOut();
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
      // Arrivo dal link di recupero: la sessione esiste ma non vale come
      // accesso finché la password non è stata reimpostata.
      if (event === "PASSWORD_RECOVERY") { setRecovering(true); return; }
      if (event === "SIGNED_IN")  { rememberLoginTime(); setExpiredReason(null); }
      if (event === "SIGNED_OUT") { forgetLoginTime(); }
      setSession(s ?? null);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  // Chiusura automatica della sessione: SESSION_MAX_HOURS dal login oppure
  // IDLE_MAX_HOURS senza interazioni. Il controllo gira all'avvio, ogni
  // minuto, a ogni ritorno in primo piano e a ogni tocco dell'utente.
  // I due eventi di risveglio coprono il caso tipico — telefono riaperto il
  // giorno dopo — dove nessun timer sarebbe rimasto in esecuzione.
  //
  // In parallelo, ogni SERVER_TOUCH_MS la stessa domanda viene girata al
  // database: se lui dice che la sessione è scaduta vince lui, anche quando
  // l'orologio locale è d'accordo sul contrario.
  useEffect(() => {
    if (!session) return;
    let done = false;
    let lastServerTouch = 0;
    const SERVER_TOUCH_MS = 5 * 60 * 1000;

    const expire = (reason) => {
      if (done) return;
      done = true;
      expireSession(reason);
    };

    const check = () => {
      const reason = expiryReason(session);
      if (reason) expire(reason);
    };

    const serverCheck = async (force = false) => {
      if (done) return;
      const now = Date.now();
      if (!force && now - lastServerTouch < SERVER_TOUCH_MS) return;
      lastServerTouch = now;
      const state = await cloud.touchSession();
      if (state !== "ok") expire(state);
    };

    // Interazione reale: touchActivity verifica prima se il tempo era già
    // scaduto e solo dopo rinnova il timestamp.
    const onActivity = () => {
      if (done) return;
      if (touchActivity(session)) expire("idle");
      else serverCheck();
    };

    check();
    const id = setInterval(() => { check(); serverCheck(); }, 60_000);

    const onWake = () => { if (!document.hidden) { check(); serverCheck(true); } };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);

    // capture: l'evento si intercetta anche se un handler lo ferma prima.
    // passive: nessun preventDefault, così lo scroll non rallenta.
    const ACTIVITY = ["pointerdown", "keydown", "wheel", "touchstart"];
    const opts = { capture: true, passive: true };
    ACTIVITY.forEach(ev => window.addEventListener(ev, onActivity, opts));

    return () => {
      done = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      ACTIVITY.forEach(ev => window.removeEventListener(ev, onActivity, opts));
    };
  }, [session]);

  // All'avvio non si carica più il catalogo: solo quanti ricambi esistono.
  // Serve a due cose — impedire una scansione contro un database vuoto e
  // mostrare il totale nelle impostazioni — e costa una manciata di byte.
  async function reloadParts() {
    if (!cloudReady) return;
    try {
      setPartsCount(await cloud.countParts());
      setLoadError("");
    } catch (e) {
      console.error("reloadParts:", e.message, e.code);
      setLoadError("Impossibile raggiungere il database. Controlla la connessione.");
    }
  }

  // La sessione va registrata sul server PRIMA di leggere qualunque cosa:
  // finché touch_session() non l'ha vista, le policy RLS non restituiscono
  // righe e il catalogo sembrerebbe vuoto senza spiegazione.
  useEffect(() => {
    if (!cloudReady || !session) { setPartsCount(0); return; }
    setPartsLoading(true);
    cloud.touchSession()
      .then(state => {
        // "unavailable" non chiude la sessione: si prosegue. Ma viene
        // ricordato, perché se poi il catalogo risulta vuoto la causa
        // probabile è questa e non un database davvero senza ricambi.
        setSessionUnverified(state === "unavailable");
        return state === "ok" || state === "unavailable"
          ? reloadParts()
          : expireSession(state);
      })
      .finally(() => setPartsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // Le liste non vivono più qui: ognuna ricarica la propria ricerca dopo una
  // modifica. Qui resta solo il totale da tenere allineato.
  async function handleAddPart(partData) {
    await cloud.addPart(partData);
    setPartsCount(n => n + 1);
  }
  async function handleUpdatePart(id, partData) {
    await cloud.updatePart(id, partData);
  }
  async function handleDeletePart(id) {
    await cloud.deletePart(id);
    setPartsCount(n => Math.max(0, n - 1));
  }
  async function handleLogout() {
    await supabase.auth.signOut();
    setPartsCount(0);
  }

  const email = session?.user?.email || "";

  let screen;
  if (!cloudReady)        screen = <SetupScreen />;
  else if (!authChecked)  screen = <LoadingScreen />;
  // Prima di tutto il resto: chi arriva dal link di recupero non entra
  // nell'app finché non ha scelto la password nuova.
  else if (recovering)    screen = <NewPasswordScreen onDone={() => setRecovering(false)} />;
  else if (!session)      screen = <LoginScreen expiredReason={expiredReason} />;
  else if (partsLoading)  screen = <LoadingScreen labelKey="loading.parts" />;
  else if (isAdminEmail(email)) screen = (
    <AdminApp
      partsCount={partsCount}
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
      partsCount={partsCount}
      sessionUnverified={sessionUnverified}
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
