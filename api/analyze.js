// ════════════════════════════════════════════════════════════════════
//  api/analyze.js — Vercel Serverless Function
//
//  La chiave Anthropic vive SOLO qui, nelle Environment Variables di
//  Vercel. Non viene mai inviata al browser e non è estraibile dai
//  DevTools: il client parla con questo endpoint, non con Anthropic.
//
//  Variabili d'ambiente richieste su Vercel:
//    ANTHROPIC_API_KEY   la chiave (sk-ant-api03-...)
//    SUPABASE_URL        https://xxxx.supabase.co   (senza /rest/v1)
//    SUPABASE_ANON_KEY   la chiave anon del progetto
//  Opzionale:
//    AI_MODEL            default "claude-opus-5"
//    AI_MAX_PHOTOS       quante foto del catalogo mandare (default 300, 0 = nessuna)
// ════════════════════════════════════════════════════════════════════

// ── Quanto può durare la funzione su Vercel ──────────────────
// Il piano gratuito taglia a 10 secondi netti. Una scansione che porta con
// sé 300 foto del catalogo non ci sta: la funzione veniva uccisa a metà e il
// tecnico leggeva un errore di rete su una richiesta che Anthropic stava
// ancora servendo — e che veniva comunque pagata.
//
// 300 secondi è il tetto del piano Pro. Non è un costo: si paga il tempo
// effettivamente usato, non quello concesso. Serve da rete di sicurezza per
// la prima scansione dopo un cambio al catalogo, l'unica lenta davvero:
// quelle successive leggono dalla cache e chiudono in pochi secondi.
//
// ⚠️ Se il progetto NON è Next.js questa è la forma giusta. In alternativa,
//    equivalente, in vercel.json:
//      { "functions": { "api/analyze.js": { "maxDuration": 300 } } }
export const config = { maxDuration: 300 };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL         = process.env.AI_MODEL || "claude-opus-5";

// ── Quanto catalogo entra in una scansione ───────────────────
// Claude Opus 5 legge fino a 1.000.000 di token. Ogni ricambio, in forma
// compatta e con la descrizione accorciata, ne occupa 70-80: 3000 ricambi
// sono ~240.000 token, un quarto della finestra. Ci stanno comodamente.
//
// Il limite NON è più tecnico, è economico: quei 240.000 token si pagano a
// ogni scansione. Con ~30 scansioni al giorno è una spesa accettabile; il
// filtro macchinario resta il modo per ridurla di oltre dieci volte quando
// e se servirà, ma non è più obbligatorio per far funzionare la scansione.
//
// ⚠️ Quel che conta davvero è che il taglio sia RUMOROSO. Nella prima
//    versione era 500 con lettura "order=id.asc": con 2000 ricambi ne
//    arrivavano all'AI i 500 più VECCHI e gli altri sparivano in silenzio.
//    Ora, se il catalogo eccede, il tecnico lo legge a schermo.
const MAX_PARTS       = 3000;
const PROMPT_DESC_MAX = 600;       // caratteri di descrizione mandati all'AI
const MAX_SCORES      = 150;       // contatori feedback nel prompt (i più votati)
const MAX_FEEDBACK    = 2000;      // valutazioni lette per costruire i contatori
const MAX_CONFUSIONS  = 30;        // coppie di confusione passate nel prompt
const MAX_IMAGE_CHARS = 8_000_000; // ~6 MB di base64

// ── Le foto del catalogo viaggiano col testo ─────────────────
// Ogni ricambio che ha una copertina parte con la sua foto: il modello
// confronta lo scatto del tecnico con la descrizione E con l'immagine. È il
// doppio controllo — un ricambio che sulla carta combacia ma visivamente è
// tutt'altro non passa più.
//
// Due tetti, di natura diversa. Non confonderli:
//
//   • 600 immagini per richiesta è il limite dell'API, e non si aggira:
//     oltre, la richiesta viene RIFIUTATA. (Sui modelli con finestra da
//     200k sono 100; Opus 5 ne ha 1M, quindi vale 600.)
//   • MAX_PHOTOS è il tetto nostro, ed è economico. Una foto da 512px costa
//     ⌈512/28⌉² ≈ 361 token: 300 foto sono ~108.000 token per scansione,
//     che in cache si pagano un decimo dalla seconda in poi.
//
// Con 2000 ricambi le foto non ci stanno tutte, ed è il filtro macchinario
// a farle rientrare. Quando non bastano, il taglio è rumoroso come quello
// del catalogo: log nel server e avviso a schermo al tecnico.
//
// ⚠️ Si manda la versione da 512px (colonna photo_url), NON la miniatura da
//    128px della lista: sotto i 200 pixel il modello sbaglia di più, quindi
//    quella miniatura peggiorerebbe il riconoscimento invece di aiutarlo.
// ⚠️ Una delle 600 è la foto appena scattata dal tecnico: nel conteggio
//    dell'API vale esattamente quanto le altre. Il tetto per le copertine
//    è quindi 599, non 600 — mandarne 600 fa rifiutare l'intera richiesta.
const API_MAX_IMAGES = 600;
const MAX_CATALOG_PHOTOS = API_MAX_IMAGES - 1;
const RAW_PHOTOS = Number.parseInt(process.env.AI_MAX_PHOTOS ?? "", 10);
const MAX_PHOTOS = Number.isFinite(RAW_PHOTOS)
  ? Math.max(0, Math.min(MAX_CATALOG_PHOTOS, RAW_PHOTOS))
  : 300;

// ── Riuso del catalogo fra una scansione e l'altra ───────────
// Il catalogo è identico a ogni scansione: senza cache lo si ripaga per
// intero ogni volta. Con la cache la prima lettura costa il 25% in più e
// tutte le successive circa un decimo.
//
// Il conto cambia col traffico, e va detto chiaramente:
//   • sotto ~3 scansioni l'ora la cache scade prima di essere riusata e
//     si paga solo il sovrapprezzo di scrittura — leggermente in perdita
//   • a regime (decine di tecnici) il risparmio sfiora il 90%
//
// Per questo è regolabile: "1h" (default, adatto alla crescita prevista),
// "5m" (finestra breve, sovrapprezzo minore), "off" (nessuna cache).
const CACHE_TTL = (process.env.AI_CACHE_TTL || "1h").trim().toLowerCase();
const CACHE_CONTROL =
  CACHE_TTL === "off" ? null :
  CACHE_TTL === "5m"  ? { type: "ephemeral" } :
                        { type: "ephemeral", ttl: "1h" };

// ── Quanto deve ragionare il modello ─────────────────────────
// ⚠️ Su Claude Opus 5 il ragionamento è ATTIVO per impostazione predefinita.
//    Non passare il parametro "thinking" non vuol dire spento: vuol dire
//    automatico. Sui modelli precedenti era il contrario, ed è la trappola
//    che rendeva insufficiente il vecchio tetto di 3000 token.
//
// Riconoscere un ricambio industriale fra cento simili, da una foto scattata
// in officina, non è un compito banale: "low" potrebbe essere tarato basso.
// Resta il default per non cambiare i risultati alle spalle di nessuno, ma
// ora è regolabile da Vercel senza toccare il codice. Come misurare quale
// livello conviene: sezione "Taratura" in SETUP.md.
const EFFORTS = ["low", "medium", "high", "xhigh"];
const RAW_EFFORT = (process.env.AI_EFFORT || "low").trim().toLowerCase();
const EFFORT = EFFORTS.includes(RAW_EFFORT) ? RAW_EFFORT : "low";

// max_tokens è un tetto su RAGIONAMENTO + RISPOSTA insieme, non sulla sola
// risposta. Deve quindi crescere con l'effort: alzare la manopola senza
// alzare il tetto significa solo troncare più spesso.
//
// La risposta utile è un JSON da poche righe: tutto il resto di questo
// budget è spazio per ragionare. Un tetto alto non costa nulla di per sé —
// si pagano i token generati, non quelli concessi.
const MAX_TOKENS_BY_EFFORT = { low: 4000, medium: 8000, high: 16000, xhigh: 24000 };
const MAX_TOKENS = MAX_TOKENS_BY_EFFORT[EFFORT];

// Estrae il primo oggetto JSON bilanciato, anche se il modello
// aggiunge prosa o code-fence attorno.
function extractJson(raw) {
  const cleaned = String(raw).replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* continua */ }

  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error("Nessun oggetto JSON nella risposta AI");

  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
    }
  }
  throw new Error("JSON malformato nella risposta AI");
}

// ════════════════════════════════════════════════════════════
//  Il prompt è diviso in due per una ragione precisa.
//
//  La cache di Anthropic funziona sul PREFISSO: riusa la parte iniziale
//  della richiesta solo finché resta identica byte per byte. Basta un
//  carattere diverso all'inizio e tutto ciò che segue va ripagato.
//
//  Quindi:
//    buildCatalogText    → il catalogo, seguito dalle foto di copertina.
//                          Cambia solo quando l'admin modifica un ricambio.
//    buildTurnPrompt     → contatori dei feedback e lingua. Cambiano di
//                          continuo, quindi stanno DOPO il punto di cache,
//                          insieme alla foto appena scattata.
//
//  I contatori dei feedback erano cuciti dentro le schede dei ricambi: un
//  singolo 👍 di un tecnico cambiava il catalogo e invalidava la cache per
//  tutti. Ora viaggiano separati e si riferiscono ai ricambi per id.
//
//  ⚠️ Il catalogo NON sta più nel blocco "system". Non è una preferenza di
//     stile: "system" accetta solo testo, e da quando ogni ricambio porta
//     con sé la propria foto il catalogo contiene immagini. Sta quindi nel
//     primo messaggio utente, col marcatore di cache sull'ultimo blocco
//     stabile — quello che segue (feedback, lingua, foto del tecnico) resta
//     fuori dalla cache come prima.
// ════════════════════════════════════════════════════════════

const SYSTEM_PROMPT =
  "You are a specialist technician for industrial spare part visual recognition. " +
  "Identify parts by analyzing shape, color, size, component type, visible markings " +
  "and physical characteristics.";

function buildCatalogText(parts) {
  // Serializzazione compatta, non indentata. Con 1200 ricambi l'indentazione
  // costava il 30-40% dei token in spazi bianchi: token pagati per allineare
  // un testo che nessun essere umano leggerà mai.
  //
  // photo_url resta fuori: la foto arriva come immagine subito sotto, e
  // ripeterne l'indirizzo nel JSON sarebbe testo pagato per niente.
  return `PARTS DATABASE (one JSON object per line):
${parts.map(({ photo, ...row }) => JSON.stringify(row)).join("\n")}`;
}

// Come vanno lette le foto del catalogo. Senza queste righe il modello le
// tratta come prove decisive: sono scatti di riferimento, spesso di un altro
// esemplare, con luce e sfondo diversi da quelli dell'officina. Un fondo
// diverso non è una smentita; un profilo diverso sì.
const PHOTO_LEGEND = `Each "REFERENCE PHOTO" above shows the catalogue part whose id precedes it.

How to weigh them:
- They are reference shots, often of a different unit of the same part, taken under
  different lighting and background than the technician's photo. Differences in
  lighting, background, angle or wear are NOT evidence of a mismatch.
- Shape, proportions, colour of the part itself, connector and thread layout, and
  printed or stamped markings ARE evidence. A clear mismatch there rules a part out
  even when its written description fits.
- Not every part has a reference photo. A part without one is not less likely to be
  the right answer — judge it on its description alone.
- Never answer with the id of a reference photo you were not given; the id must come
  from the PARTS DATABASE.`;

function buildTurnPrompt(scores, confusions, lang) {
  // Il campo "reasoning" viene mostrato al tecnico: deve essere nella sua
  // lingua. Sta qui e non nel blocco in cache, altrimenti italiano e inglese
  // userebbero due cache separate invece di condividerne una.
  const language = lang === "en" ? "English" : "Italian";

  // I feedback dei tecnici entrano nel contesto della richiesta. Non
  // riaddestrano il modello — lo informano: contano quante volte un ricambio
  // è stato confermato e quali coppie vengono storicamente scambiate.
  const scoreSection = scores.length
    ? `
TECHNICIAN FEEDBACK — PER-PART TRACK RECORD (refers to the "id" field above):
${scores.map(s => JSON.stringify(s)).join("\n")}

A high "confirmed" count means that part's description has proven reliable. A high
"reported_wrong" count means it has been proposed incorrectly before — treat it with
more scrutiny and require clearer visual evidence before choosing it.
`
    : "";

  const confusionSection = confusions.length
    ? `
TECHNICIAN FEEDBACK — RECURRING CONFUSIONS:
${confusions.map(c => JSON.stringify(c)).join("\n")}

Each entry means: technicians reported that a part identified as "wrongly_identified_as"
turned out to be "actually_was", that many times. When the image could plausibly match
either side of such a pair, weigh the evidence more carefully and prefer the part whose
specific visual details actually appear in the photo. Do not blindly flip to the other
part — use these only as a warning that the two are easily mistaken.
`
    : "";

  return `${scoreSection}${confusionSection}
Identify which catalogue part the photo above shows.

Reply ONLY with valid JSON (no extra text, no markdown, no backticks).
Write the "reasoning" value in ${language}, under 40 words. Keys stay in English:
- If match found: {"matched":true,"id":"<exact id>","confidence":<0-100>,"reasoning":"<concise technical explanation>"}
- If no match: {"matched":false,"confidence":0,"reasoning":"<describe what you see and why no part matches>"}`;
}

// ── Lettura dal database, con il token di chi ha chiamato ─────
// Le query girano con l'identità del tecnico, non con una chiave di servizio:
// valgono le stesse policy RLS del client, quindi una sessione scaduta o un
// utente senza permessi non ottiene nulla nemmeno passando da qui.
async function supabaseSelect(supabaseUrl, supabaseAnon, token, path) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: supabaseAnon, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase ${res.status} su ${path.split("?")[0]}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Aggrega le valutazioni dei tecnici: quante conferme e quante smentite per
// ricambio, e quali coppie vengono scambiate più spesso. Prima girava sul
// telefono di ogni tecnico a ogni avvio dell'app.
function aggregateFeedback(rows) {
  const byPart = new Map();
  const pairs  = new Map();

  for (const f of rows || []) {
    const pid = f.predicted_part_id;
    if (pid) {
      const s = byPart.get(pid) || { ok: 0, ko: 0 };
      if (f.is_correct) s.ok++; else s.ko++;
      byPart.set(pid, s);
    }
    if (!f.is_correct && pid && f.correct_part_id && pid !== f.correct_part_id) {
      const key = `${pid}>${f.correct_part_id}`;
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
  }

  // Ordinamento deterministico: due scansioni con gli stessi dati devono
  // produrre lo stesso testo, altrimenti il modello riceve rumore inutile.
  // Solo i ricambi con un bilancio significativo, e non tutti: con un
  // catalogo grande questa sezione sta nella parte NON in cache, quindi
  // ogni voce si ripaga a ogni singola scansione. I ricambi con una sola
  // valutazione non dicono nulla di statisticamente utile.
  const scores = [...byPart.entries()]
    .filter(([, s]) => s.ok + s.ko >= 2)
    .sort((a, b) => (b[1].ok + b[1].ko) - (a[1].ok + a[1].ko) || a[0].localeCompare(b[0]))
    .slice(0, MAX_SCORES)
    .map(([id, s]) => ({ id, confirmed: s.ok, reported_wrong: s.ko }));

  const confusions = [...pairs.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_CONFUSIONS)
    .map(([key, times]) => {
      const [predicted, actual] = key.split(">");
      return { wrongly_identified_as: predicted, actually_was: actual, times };
    });

  return { scores, confusions };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Metodo non consentito." });
  }

  const apiKey       = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl  = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const supabaseAnon = process.env.SUPABASE_ANON_KEY;

  if (!apiKey || !supabaseUrl || !supabaseAnon) {
    console.error("Env mancanti:", {
      ANTHROPIC_API_KEY: !!apiKey,
      SUPABASE_URL: !!supabaseUrl,
      SUPABASE_ANON_KEY: !!supabaseAnon,
    });
    return res.status(500).json({
      error: "Server non configurato. Controlla le Environment Variables su Vercel.",
    });
  }

  // ── 1. Il chiamante deve avere una sessione Supabase valida ────────
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return res.status(401).json({ error: "Autenticazione richiesta. Esegui il login." });
  }

  let userEmail = null;
  try {
    const who = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseAnon, Authorization: `Bearer ${token}` },
    });
    if (!who.ok) {
      return res.status(401).json({ error: "Sessione non valida o scaduta. Rifai il login." });
    }
    const user = await who.json();
    userEmail = user?.email || null;
  } catch (e) {
    console.error("Verifica sessione fallita:", e);
    return res.status(503).json({ error: "Impossibile verificare la sessione." });
  }

  // ── 1b. …e la sessione non deve essere scaduta ─────────────────────
  // Il token resta tecnicamente valido finché Supabase lo rinnova: sono le
  // nostre regole (24h dal login, 12h di inattività) a doverlo fermare, e
  // vivono nel database. Senza questo controllo un client manomesso non
  // leggerebbe più il catalogo — le policy RLS lo bloccano — ma potrebbe
  // continuare a consumare crediti Anthropic da qui.
  try {
    const state = await fetch(`${supabaseUrl}/rest/v1/rpc/touch_session`, {
      method: "POST",
      headers: {
        apikey: supabaseAnon,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    // 404 = funzione non installata: si prosegue con la sola verifica del
    // token, come prima che esistesse questo controllo.
    if (state.ok) {
      const verdict = await state.json();
      if (verdict === "idle" || verdict === "age") {
        return res.status(401).json({
          error: verdict === "idle"
            ? "Sessione chiusa per inattività. Rifai il login."
            : "Sessione scaduta. Rifai il login.",
        });
      }
    }
  } catch (e) {
    console.error("touch_session:", e);   // rete instabile: non blocco la scansione
  }

  // ── 2. Validazione input ───────────────────────────────────────────
  // Dal client arriva solo la foto e la lingua. Il catalogo NON viaggia più
  // dal telefono: lo legge il server qui sotto, direttamente dal database.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const image = body?.image;

  if (!image?.data || !image?.media_type) {
    return res.status(400).json({ error: "Immagine mancante o malformata." });
  }
  if (image.data.length > MAX_IMAGE_CHARS) {
    return res.status(413).json({ error: "Immagine troppo grande." });
  }

  // ── 3. Catalogo e valutazioni, letti dal database ──────────────────
  // Prima facevano un giro assurdo: il telefono li scaricava da Supabase, li
  // rispediva qui, e da qui ripartivano verso Anthropic. Ora restano dove
  // sono. Il client risparmia decine di KB in upload a ogni scansione, e il
  // catalogo diventa identico byte per byte fra una scansione e l'altra —
  // condizione necessaria perché la cache funzioni.
  //
  // L'ordinamento per id non è un dettaglio: è ciò che rende il testo
  // riproducibile. Con un ordine variabile la cache non aggancerebbe mai.
  // Filtro macchinario: quando il tecnico dice su cosa sta lavorando, il
  // catalogo mandato all'AI si restringe da migliaia di pezzi a decine.
  // È il modo giusto di stare dentro il tetto — alzarlo e basta sposta il
  // problema e moltiplica il costo di ogni scansione.
  const machine = String(body?.machine ?? "").trim().slice(0, 120);
  const machineFilter = machine
    ? `&compatibility=cs.${encodeURIComponent(JSON.stringify([machine]))}`
    : "";

  // La colonna photo_url arriva con ai-photos.sql. Se il codice va in
  // produzione prima dell'SQL, PostgREST risponde 400 su una colonna che non
  // esiste: senza questa rete di sicurezza ogni scansione morirebbe lì. Si
  // riprova senza, e le foto del catalogo semplicemente non partono.
  // Si chiede una riga in più del tetto: se arriva, il catalogo eccede
  // e bisogna dirlo invece di tagliare in silenzio.
  const PART_COLS = "id,code,name,description,category,compatibility";
  const partsQuery = (cols) =>
    `parts?select=${cols}${machineFilter}&order=created_at.desc&limit=${MAX_PARTS + 1}`;

  let photoColumn = true;
  const fetchParts = async () => {
    try {
      return await supabaseSelect(supabaseUrl, supabaseAnon, token,
        partsQuery(`${PART_COLS},photo_url`));
    } catch (e) {
      console.error("photo_url non leggibile, scansione senza foto del catalogo:", e.message);
      photoColumn = false;
      return supabaseSelect(supabaseUrl, supabaseAnon, token, partsQuery(PART_COLS));
    }
  };

  let safeParts, scores, safeConfusions, truncated = false;
  try {
    const [partRows, feedbackRows] = await Promise.all([
      fetchParts(),
      supabaseSelect(supabaseUrl, supabaseAnon, token,
        `scan_feedback?select=predicted_part_id,correct_part_id,is_correct&order=created_at.desc&limit=${MAX_FEEDBACK}`)
        .catch((e) => { console.error("feedback:", e.message); return []; }),
    ]);

    if (!Array.isArray(partRows) || partRows.length === 0) {
      return res.status(400).json({
        error: machine
          ? `Nessun ricambio associato a "${machine}". Scegli un altro macchinario o rimuovi il filtro.`
          : "Nessun ricambio nel database da confrontare.",
      });
    }

    // Il catalogo supera quanto entra in una scansione. Si tiene la parte
    // più recente e si segnala: chi scansiona deve sapere che il confronto
    // non ha coperto tutto, altrimenti legge "non trovato" e ci crede.
    truncated = partRows.length > MAX_PARTS;
    if (truncated) {
      console.error("CATALOGO TRONCATO:", partRows.length - 1, "ricambi disponibili,",
        MAX_PARTS, "inviati al modello. Filtro macchinario:", machine || "nessuno");
    }

    // I limiti per campo restano: non per diffidenza verso il client, ma
    // perché una descrizione sterminata gonfia il prompt di ogni scansione.
    // Nell'app la descrizione resta intera: qui si accorcia solo per l'AI.
    safeParts = partRows.slice(0, MAX_PARTS).map((p) => ({
      id: String(p?.id ?? "").slice(0, 100),
      code: String(p?.code ?? "").slice(0, 100),
      name: String(p?.name ?? "").slice(0, 200),
      description: String(p?.description ?? "").slice(0, PROMPT_DESC_MAX),
      category: String(p?.category ?? "").slice(0, 100),
      compatibility: Array.isArray(p?.compatibility)
        ? p.compatibility.slice(0, 30).map((c) => String(c).slice(0, 120))
        : [],
      // Va a finire in un blocco "image" con source di tipo url: è Anthropic
      // a scaricare la foto, non questa funzione. Per questo il bucket deve
      // restare pubblico — e per questo si accetta solo https, per non
      // trasformare un valore sporco nel database in una richiesta altrove.
      photo: /^https:\/\/[^\s"'<>]+$/i.test(String(p?.photo_url ?? ""))
        ? String(p.photo_url)
        : "",
    }));

    ({ scores, confusions: safeConfusions } = aggregateFeedback(feedbackRows));
  } catch (e) {
    console.error("lettura catalogo:", e);
    return res.status(503).json({ error: "Impossibile leggere il catalogo. Riprova." });
  }

  // ── 3b. Le foto di copertina che accompagnano il catalogo ──────────
  // L'ordine è quello del catalogo (created_at.desc, già fissato sopra):
  // deterministico, quindi la cache aggancia. Se le foto eccedono il tetto
  // partono quelle dei ricambi più recenti, e il taglio viene detto.
  const withPhoto  = safeParts.filter((p) => p.photo);
  const photoParts = withPhoto.slice(0, MAX_PHOTOS);
  const photosLeftOut = withPhoto.length - photoParts.length;
  if (photosLeftOut > 0) {
    console.error("FOTO TRONCATE:", withPhoto.length, "ricambi con copertina,",
      photoParts.length, "foto inviate al modello. Filtro macchinario:", machine || "nessuno");
  }

  // Il prefisso stabile: catalogo, foto, legenda. Il marcatore di cache va
  // sull'ULTIMO di questi blocchi — tutto ciò che lo precede entra in cache
  // con lui, tutto ciò che segue si ripaga a ogni scansione.
  const stableContent = [{ type: "text", text: buildCatalogText(safeParts) }];
  for (const p of photoParts) {
    stableContent.push({ type: "text", text: `REFERENCE PHOTO — part id ${p.id} (code ${p.code}):` });
    stableContent.push({ type: "image", source: { type: "url", url: p.photo } });
  }
  if (photoParts.length) stableContent.push({ type: "text", text: PHOTO_LEGEND });
  if (CACHE_CONTROL) stableContent[stableContent.length - 1].cache_control = CACHE_CONTROL;

  // ── 4. Chiamata ad Anthropic con la chiave server-side ─────────────
  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        output_config: { effort: EFFORT },
        // In "system" resta solo il ruolo: è testo puro, ed è ciò che il
        // blocco accetta. Il catalogo è sceso nel messaggio perché contiene
        // immagini — ma resta comunque dentro il prefisso in cache, che parte
        // da "system" e arriva fino al marcatore.
        //
        // Nota: sotto ~512 token il riuso non scatta e non viene segnalato
        // alcun errore. Con un catalogo di pochi ricambi è normale vedere
        // cache_read a zero: non è un guasto, è il catalogo troppo corto.
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: [
            ...stableContent,
            // Da qui in poi tutto ciò che cambia a ogni scansione: la foto
            // appena scattata, i contatori dei feedback, la lingua.
            //
            // L'etichetta prima dell'immagine non è cortesia: nel messaggio
            // ci sono ora centinaia di foto, e questa è l'unica che il
            // modello deve identificare invece di usare come riferimento.
            { type: "text", text: "PHOTO TO IDENTIFY — taken by the technician just now:" },
            {
              type: "image",
              source: { type: "base64", media_type: image.media_type, data: image.data },
            },
            { type: "text", text: buildTurnPrompt(scores, safeConfusions, body?.lang) },
          ],
        }],
      }),
    });

    if (!upstream.ok) {
      const errBody = await upstream.json().catch(() => ({}));
      const msg = errBody?.error?.message || `Errore Anthropic (HTTP ${upstream.status})`;
      console.error("Anthropic error:", upstream.status, msg, "user:", userEmail);
      // Non riesponiamo il corpo grezzo: potrebbe contenere dettagli interni.
      return res.status(upstream.status === 401 ? 500 : upstream.status).json({
        error: upstream.status === 401
          ? "Chiave API non valida lato server. Controlla ANTHROPIC_API_KEY su Vercel."
          : msg,
      });
    }

    const data = await upstream.json();

    // Senza questa riga la cache è un atto di fede. Nei log di Vercel:
    //   cache_read alto e input basso  → sta funzionando
    //   cache_read sempre 0            → qualcosa invalida il prefisso
    //   cache_write a ogni scansione   → la cache scade prima di essere
    //                                     riusata: troppo poco traffico,
    //                                     oppure il catalogo cambia spesso
    const u = data.usage || {};
    console.log("ai_usage", JSON.stringify({
      parts: safeParts.length,
      // Le foto sono la voce di spesa nuova: ~361 token l'una alla prima
      // scansione, un decimo su quelle che leggono dalla cache. Se "photos"
      // è 0 con un catalogo pieno di copertine, la causa è photo_column
      // (SQL non applicato) o AI_MAX_PHOTOS a zero — non un guasto dell'AI.
      photos: photoParts.length,
      photos_left_out: photosLeftOut,
      photo_column: photoColumn,
      input: u.input_tokens ?? 0,
      cache_write: u.cache_creation_input_tokens ?? 0,
      cache_read: u.cache_read_input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      machine: machine || null,
      truncated,
      ttl: CACHE_TTL,
      effort: EFFORT,
      max_tokens: MAX_TOKENS,
      stop: data.stop_reason,
      user: userEmail,
    }));

    if (data.stop_reason === "refusal") {
      return res.status(422).json({ error: "L'AI ha rifiutato di analizzare questa immagine." });
    }

    // Risposta troncata: il modello ha esaurito il budget prima di finire.
    // Senza questo controllo il JSON monco finiva nel parser e il tecnico
    // leggeva "JSON malformato nella risposta AI" — un messaggio che non gli
    // dice niente, su una scansione che è già stata pagata.
    //
    // Se compare nei log è un problema di taratura, non un caso sfortunato:
    // MAX_TOKENS_BY_EFFORT va alzato per il livello di effort in uso.
    if (data.stop_reason === "max_tokens") {
      console.error("TRONCATO: alza MAX_TOKENS_BY_EFFORT per effort", EFFORT,
        `(attuale ${MAX_TOKENS}, output ${u.output_tokens ?? 0})`);
      return res.status(503).json({
        error: "L'analisi si è interrotta prima di concludere. Riprova; se succede spesso, avvisa l'amministratore.",
      });
    }

    // Solo i blocchi di testo: il ragionamento arriva in blocchi di tipo
    // diverso e non va dato in pasto al parser.
    const raw = (data.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text || "")
      .join("");

    let parsed;
    try {
      parsed = extractJson(raw);
    } catch (e) {
      // Il modello ha risposto qualcosa che non è il JSON richiesto. Il
      // dettaglio serve a chi legge i log, non al tecnico in officina.
      console.error("Risposta non interpretabile:", e.message, "| grezzo:", raw.slice(0, 400));
      return res.status(502).json({
        error: "L'AI ha risposto in un formato inatteso. Riprova.",
      });
    }

    return res.status(200).json({
      matched: !!parsed.matched,
      id: parsed.id ?? null,
      confidence: Number(parsed.confidence) || 0,
      reasoning: String(parsed.reasoning ?? ""),
      // Il client lo mostra al tecnico: un "non trovato" su un confronto
      // parziale non significa che il pezzo non sia a catalogo.
      partial: truncated ? { compared: safeParts.length } : null,
      // Due tagli diversi, due avvisi diversi. Qui il confronto ha coperto
      // tutto il catalogo a parole, ma non tutte le foto: il tecnico deve
      // sapere che su quei ricambi il controllo visivo non c'è stato.
      photosPartial: photosLeftOut > 0
        ? { sent: photoParts.length, total: withPhoto.length }
        : null,
      usage: data.usage ?? null,
    });
  } catch (e) {
    console.error("analyze error:", e);
    return res.status(500).json({ error: `Analisi fallita: ${e.message || "errore interno"}` });
  }
}
