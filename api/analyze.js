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
// ════════════════════════════════════════════════════════════════════

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL         = process.env.AI_MODEL || "claude-opus-5";

const MAX_PARTS       = 500;       // tetto anti-abuso sul contesto
const MAX_IMAGE_CHARS = 8_000_000; // ~6 MB di base64

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

function buildPrompt(parts) {
  return `You are a specialist technician for industrial spare part visual recognition.
Carefully analyze this image and compare it with the database below.

PARTS DATABASE:
${JSON.stringify(parts, null, 2)}

Identify the matching part by analyzing: shape, color, size, component type, visible markings, physical characteristics.

Reply ONLY with valid JSON (no extra text, no markdown, no backticks). Keep "reasoning" under 40 words:
- If match found: {"matched":true,"id":"<exact id>","confidence":<0-100>,"reasoning":"<concise technical explanation>"}
- If no match: {"matched":false,"confidence":0,"reasoning":"<describe what you see and why no part matches>"}`;
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

  // ── 2. Validazione input ───────────────────────────────────────────
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const image = body?.image;
  const parts = body?.parts;

  if (!image?.data || !image?.media_type) {
    return res.status(400).json({ error: "Immagine mancante o malformata." });
  }
  if (image.data.length > MAX_IMAGE_CHARS) {
    return res.status(413).json({ error: "Immagine troppo grande." });
  }
  if (!Array.isArray(parts) || parts.length === 0) {
    return res.status(400).json({ error: "Nessun ricambio nel database da confrontare." });
  }

  // Non ci fidiamo del client: teniamo solo i campi testuali che servono,
  // e tagliamo eventuali payload gonfiati ad arte.
  const safeParts = parts.slice(0, MAX_PARTS).map((p) => ({
    id: String(p?.id ?? "").slice(0, 100),
    code: String(p?.code ?? "").slice(0, 100),
    name: String(p?.name ?? "").slice(0, 200),
    description: String(p?.description ?? "").slice(0, 1500),
    category: String(p?.category ?? "").slice(0, 100),
    compatibility: Array.isArray(p?.compatibility)
      ? p.compatibility.slice(0, 30).map((c) => String(c).slice(0, 120))
      : [],
  }));

  // ── 3. Chiamata ad Anthropic con la chiave server-side ─────────────
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
        max_tokens: 3000,
        output_config: { effort: "low" },
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: image.media_type, data: image.data },
            },
            { type: "text", text: buildPrompt(safeParts) },
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

    if (data.stop_reason === "refusal") {
      return res.status(422).json({ error: "L'AI ha rifiutato di analizzare questa immagine." });
    }

    const raw = (data.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text || "")
      .join("");

    const parsed = extractJson(raw);

    return res.status(200).json({
      matched: !!parsed.matched,
      id: parsed.id ?? null,
      confidence: Number(parsed.confidence) || 0,
      reasoning: String(parsed.reasoning ?? ""),
      usage: data.usage ?? null,
    });
  } catch (e) {
    console.error("analyze error:", e);
    return res.status(500).json({ error: `Analisi fallita: ${e.message || "errore interno"}` });
  }
}
