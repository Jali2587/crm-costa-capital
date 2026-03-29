const https = require("https");

const SHEET_ID = "1y_QNvwgMSRydeeY2etGJUBREn-kDNRd9MuxV9nlJ2wc";
const SHEETS_KEY = process.env.GOOGLE_SHEETS_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;

function httpsRequest(url, method = "GET", body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: { "Content-Type": "application/json", ...headers },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) {}
  const { action, range, values, pdfBase64, filename } = body;

  try {
    // ── PDF EXTRACTION via Anthropic API ────────────────────────────────
    if (action === "extractpdf") {
      if (!ANTHROPIC_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "ANTHROPIC_API_KEY niet ingesteld in Netlify environment variables." }) };
      }
      if (!pdfBase64) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Geen PDF data ontvangen." }) };
      }

      const payload = JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: 'Je bent vastgoeddata-extractor voor Costa Capital. Geef UITSLUITEND geldig JSON zonder markdown of uitleg:\n{"name":"Naam object","type":"Hotel/Boutique hotel/Resort/Aparthotel/Portfolio/Development/Nursing home/Mixed use/Overig","stars":"Aantal sterren bijv. 5 sterren (leeg indien nvt)","location":"Locatie stad of regio","price":"Vraagprijs met valuta bijv. EUR 400.000.000","rooms":"Aantal kamers bijv. 188 kamers","size":"Oppervlakte bijv. 42.074 m2","status":"Beschikbaar","description":"Max 2 zinnen kernbeschrijving","matchCriteria":"Trefwoorden kommagescheiden voor koperskoppeling"}',
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
            { type: "text", text: `Extraheer vastgoeddata uit dit document en geef alleen JSON terug. Bestandsnaam: ${filename || "document.pdf"}` }
          ]
        }]
      });

      const result = await httpsRequest(
        "https://api.anthropic.com/v1/messages",
        "POST",
        payload,
        {
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        }
      );

      if (result.status !== 200) {
        return { statusCode: result.status, headers, body: JSON.stringify({ error: `Anthropic API fout: ${JSON.stringify(result.body).slice(0, 300)}` }) };
      }

      const text = (result.body.content || []).filter(b => b.type === "text").map(b => b.text).join("");
      const match = text.match(/\{[\s\S]*?\}/);
      if (!match) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Geen JSON in API antwoord: " + text.slice(0, 200) }) };
      }

      let extracted;
      try { extracted = JSON.parse(match[0]); }
      catch (e) { return { statusCode: 500, headers, body: JSON.stringify({ error: "JSON parse fout: " + match[0].slice(0, 100) }) }; }

      return { statusCode: 200, headers, body: JSON.stringify({ extracted }) };
    }

    // ── GOOGLE SHEETS ────────────────────────────────────────────────────
    if (!SHEETS_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "GOOGLE_SHEETS_API_KEY niet ingesteld in Netlify." }) };
    }

    // ── LIVE BUYER SEARCH via Anthropic API ─────────────────────────────
    if (action === "search") {
      if (!ANTHROPIC_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "ANTHROPIC_API_KEY niet ingesteld in Netlify environment variables." }) };
      }
      const { criteria } = body;
      const payload = JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        system: 'Dealflow-assistent Costa Capital. Zoek ECHTE RECENTE kopers en investeerders voor vastgoed. Geef UITSLUITEND een JSON array:
[{"name":"Naam","company":"Organisatie","deal_type":"Type deal","activity":"Wat ze recent deden","why_match":"Waarom goede match","linkedin_likely":true,"source":"Bron"}]
4-8 resultaten. Feitelijk, geen verzonnen namen.',
        messages: [{ role: "user", content: `Zoek kopers en investeerders voor vastgoed met criteria: ${criteria}` }]
      });
      const result = await httpsRequest(
        "https://api.anthropic.com/v1/messages",
        "POST",
        payload,
        { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }
      );
      if (result.status !== 200) {
        return { statusCode: result.status, headers, body: JSON.stringify({ error: `API fout: ${JSON.stringify(result.body).slice(0,300)}` }) };
      }
      const text = (result.body.content || []).filter(b => b.type === "text").map(b => b.text).join("");
      const match = text.match(/\[[\s\S]*?\]/);
      let results = [];
      if (match) { try { results = JSON.parse(match[0]); } catch(e) {} }
      return { statusCode: 200, headers, body: JSON.stringify({ results }) };
    }

    // ── AI CRM MATCH (Laag 2: slim matchen op CRM contacten) ─────────────
    if (action === "aimatch") {
      if (!ANTHROPIC_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "ANTHROPIC_API_KEY niet ingesteld." }) };
      }
      const { object, candidates } = body;
      if (!candidates || candidates.length === 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ matches: [] }) };
      }
      const contactList = candidates.map((c, i) =>
        i+1 + ". " + c.name + (c.company ? " (" + c.company + ")" : "") + (c.notes ? " | " + c.notes.slice(0,120) : "") + (c.linkedinFirstDegree ? " [LI-1e-lijn]" : "")
      ).join("\n");

      const payload = JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        system: "Je bent dealflow-analist voor Costa Capital. Analyseer welke contacten de beste match zijn voor een vastgoedobject op basis van hun bedrijf en achtergrond. Zoek online naar recente vastgoedactiviteit van de meest veelbelovende namen. Geef UITSLUITEND JSON array: [{name:Exacte naam uit lijst,reason:Waarom match,activity:Recente online activiteit of leeg,score:1-10,linkedin:true/false}] Maximaal 8 beste matches gesorteerd op score.",
        messages: [{
          role: "user",
          content: "Object: " + object.name + " | Type: " + object.type + " | Locatie: " + object.location + " | Prijs: " + object.price + " | Sterren: " + (object.stars || "onbekend") + "\n\nAnalyseer deze contacten en zoek online naar hun recente vastgoedactiviteit:\n\n" + contactList + "\n\nWelke zijn de beste potentiele kopers voor dit object?"
        }]
      });

      const result = await httpsRequest(
        "https://api.anthropic.com/v1/messages", "POST", payload,
        { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }
      );
      if (result.status !== 200) {
        return { statusCode: result.status, headers, body: JSON.stringify({ error: "API fout: " + JSON.stringify(result.body).slice(0,200) }) };
      }
      const aiText = (result.body.content || []).filter(b => b.type === "text").map(b => b.text).join("");
      const aiM = aiText.match(/\[([\s\S]*?)\]/);
      let matches = [];
      if (aiM) { try { matches = JSON.parse("[" + aiM[1] + "]"); } catch(e) {
        try { matches = JSON.parse(aiText.match(/\[[\s\S]*\]/)[0]); } catch(e2) {}
      }}
      return { statusCode: 200, headers, body: JSON.stringify({ matches }) };
    }

    if (action === "sheetinfo") {
      const r = await httpsRequest(`${BASE}?key=${SHEETS_KEY}&fields=sheets.properties.title`);
      return { statusCode: 200, headers, body: JSON.stringify(r.body) };
    }

    if (action === "get") {
      const r = await httpsRequest(`${BASE}/values/${encodeURIComponent(range)}?key=${SHEETS_KEY}`);
      return { statusCode: 200, headers, body: JSON.stringify(r.body) };
    }

    if (action === "append") {
      const url = `${BASE}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS&key=${SHEETS_KEY}`;
      const r = await httpsRequest(url, "POST", { values });
      return { statusCode: 200, headers, body: JSON.stringify(r.body) };
    }

    if (action === "update") {
      const url = `${BASE}/values/${encodeURIComponent(range)}?valueInputOption=RAW&key=${SHEETS_KEY}`;
      const r = await httpsRequest(url, "PUT", { values });
      return { statusCode: 200, headers, body: JSON.stringify(r.body) };
    }

    if (action === "clear") {
      const url = `${BASE}/values/${encodeURIComponent(range)}:clear?key=${SHEETS_KEY}`;
      const r = await httpsRequest(url, "POST", {});
      return { statusCode: 200, headers, body: JSON.stringify(r.body) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Onbekende actie: " + action }) };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
