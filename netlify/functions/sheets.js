const https = require("https");

const SHEET_ID = "1y_QNvwgMSRydeeY2etGJUBREn-kDNRd9MuxV9nlJ2wc";
const SHEETS_KEY = process.env.GOOGLE_SHEETS_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const BASE = "https://sheets.googleapis.com/v4/spreadsheets/" + SHEET_ID;

function httpsRequest(url, method, body, extraHeaders) {
  method = method || "GET";
  extraHeaders = extraHeaders || {};
  return new Promise(function(resolve, reject) {
    var urlObj = new URL(url);
    var options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: Object.assign({ "Content-Type": "application/json" }, extraHeaders),
    };
    var req = https.request(options, function(res) {
      var data = "";
      res.on("data", function(chunk) { data += chunk; });
      res.on("end", function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

function anthropicRequest(payload) {
  return httpsRequest(
    "https://api.anthropic.com/v1/messages",
    "POST",
    JSON.stringify(payload),
    { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" }
  );
}

function extractText(content) {
  return (content || []).filter(function(b) { return b.type === "text"; }).map(function(b) { return b.text; }).join("");
}

function parseJsonArray(text) {
  var m = text.match(/\[[\s\S]*?\]/);
  if (!m) return [];
  try { return JSON.parse(m[0]); } catch(e) { return []; }
}

function parseJsonObject(text) {
  var m = text.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch(e) { return null; }
}

exports.handler = async function(event) {
  var headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: headers, body: "" };
  }

  var body = {};
  try { body = JSON.parse(event.body || "{}"); } catch(e) {}
  var action = body.action;
  var range = body.range;
  var values = body.values;

  try {

    // ── PDF EXTRACTION ──────────────────────────────────────────────────
    if (action === "extractpdf") {
      if (!ANTHROPIC_KEY) return { statusCode: 500, headers: headers, body: JSON.stringify({ error: "ANTHROPIC_API_KEY niet ingesteld." }) };
      if (!body.pdfBase64) return { statusCode: 400, headers: headers, body: JSON.stringify({ error: "Geen PDF data." }) };

      var pdfSystem = "Je bent vastgoeddata-extractor voor Costa Capital. Geef UITSLUITEND geldig JSON zonder markdown: {\"name\":\"Naam object\",\"type\":\"Hotel/Boutique hotel/Resort/Aparthotel/Portfolio/Development/Nursing home/Mixed use/Overig\",\"stars\":\"Aantal sterren bijv. 5 sterren (leeg indien nvt)\",\"location\":\"Locatie stad of regio\",\"price\":\"Vraagprijs met valuta\",\"rooms\":\"Aantal kamers\",\"size\":\"Oppervlakte m2\",\"status\":\"Beschikbaar\",\"description\":\"Max 2 zinnen kernbeschrijving\",\"matchCriteria\":\"Trefwoorden kommagescheiden voor koperskoppeling\"}";

      var pdfResult = await anthropicRequest({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: pdfSystem,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: body.pdfBase64 } },
            { type: "text", text: "Extraheer vastgoeddata. Bestand: " + (body.filename || "document.pdf") }
          ]
        }]
      });

      if (pdfResult.status !== 200) return { statusCode: pdfResult.status, headers: headers, body: JSON.stringify({ error: "API fout: " + JSON.stringify(pdfResult.body).slice(0, 200) }) };

      var pdfText = extractText(pdfResult.body.content);
      var extracted = parseJsonObject(pdfText);
      if (!extracted) return { statusCode: 500, headers: headers, body: JSON.stringify({ error: "Geen JSON gevonden: " + pdfText.slice(0, 200) }) };
      return { statusCode: 200, headers: headers, body: JSON.stringify({ extracted: extracted }) };
    }

    // ── LIVE BUYER SEARCH ───────────────────────────────────────────────
    if (action === "search") {
      if (!ANTHROPIC_KEY) return { statusCode: 500, headers: headers, body: JSON.stringify({ error: "ANTHROPIC_API_KEY niet ingesteld." }) };

      var searchSystem = "Dealflow-assistent Costa Capital. Zoek ECHTE RECENTE kopers/investeerders voor vastgoed. UITSLUITEND JSON array: [{\"name\":\"Naam\",\"company\":\"Organisatie\",\"deal_type\":\"Type\",\"activity\":\"Wat recent gedaan\",\"why_match\":\"Waarom match\",\"linkedin_likely\":true,\"source\":\"Bron\"}]. 4-8 resultaten. Feitelijk.";

      var searchResult = await anthropicRequest({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        system: searchSystem,
        messages: [{ role: "user", content: "Zoek kopers en investeerders voor: " + body.criteria }]
      });

      if (searchResult.status !== 200) return { statusCode: searchResult.status, headers: headers, body: JSON.stringify({ error: "API fout: " + JSON.stringify(searchResult.body).slice(0, 200) }) };

      var searchText = extractText(searchResult.body.content);
      var results = parseJsonArray(searchText);
      return { statusCode: 200, headers: headers, body: JSON.stringify({ results: results }) };
    }

    // ── AI CRM MATCH ────────────────────────────────────────────────────
    if (action === "aimatch") {
      if (!ANTHROPIC_KEY) return { statusCode: 500, headers: headers, body: JSON.stringify({ error: "ANTHROPIC_API_KEY niet ingesteld." }) };

      var candidates = body.candidates || [];
      var obj = body.object || {};
      if (candidates.length === 0) return { statusCode: 200, headers: headers, body: JSON.stringify({ matches: [] }) };

      var contactList = candidates.map(function(c, i) {
        return (i+1) + ". " + c.name + (c.company ? " (" + c.company + ")" : "") + (c.notes ? " | " + c.notes.slice(0, 120) : "") + (c.linkedinFirstDegree ? " [LI]" : "");
      }).join("\n");

      var matchSystem = "Je bent dealflow-analist voor Costa Capital. Analyseer welke contacten de beste match zijn voor een vastgoedobject op basis van bedrijf en achtergrond. Zoek online naar recente vastgoedactiviteit van veelbelovende namen. UITSLUITEND JSON array: [{\"name\":\"Exacte naam\",\"reason\":\"Waarom match\",\"activity\":\"Recente activiteit online of leeg\",\"score\":8,\"linkedin\":true}]. Max 8 beste matches gesorteerd op score.";

      var matchMsg = "Object: " + obj.name + " | Type: " + obj.type + " | Locatie: " + obj.location + " | Prijs: " + obj.price + " | Sterren: " + (obj.stars || "onbekend") + "\n\nAnalyseer en zoek online naar vastgoedactiviteit:\n\n" + contactList + "\n\nWelke zijn de beste potentiele kopers?";

      var matchResult = await anthropicRequest({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        system: matchSystem,
        messages: [{ role: "user", content: matchMsg }]
      });

      if (matchResult.status !== 200) return { statusCode: matchResult.status, headers: headers, body: JSON.stringify({ error: "API fout: " + JSON.stringify(matchResult.body).slice(0, 200) }) };

      var matchText = extractText(matchResult.body.content);
      var matches = parseJsonArray(matchText);
      return { statusCode: 200, headers: headers, body: JSON.stringify({ matches: matches }) };
    }

    // ── GOOGLE SHEETS ───────────────────────────────────────────────────
    if (!SHEETS_KEY) return { statusCode: 500, headers: headers, body: JSON.stringify({ error: "GOOGLE_SHEETS_API_KEY niet ingesteld." }) };

    if (action === "sheetinfo") {
      var r = await httpsRequest(BASE + "?key=" + SHEETS_KEY + "&fields=sheets.properties.title");
      return { statusCode: 200, headers: headers, body: JSON.stringify(r.body) };
    }

    if (action === "get") {
      var r = await httpsRequest(BASE + "/values/" + encodeURIComponent(range) + "?key=" + SHEETS_KEY);
      return { statusCode: 200, headers: headers, body: JSON.stringify(r.body) };
    }

    if (action === "append") {
      var r = await httpsRequest(BASE + "/values/" + encodeURIComponent(range) + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS&key=" + SHEETS_KEY, "POST", { values: values });
      return { statusCode: 200, headers: headers, body: JSON.stringify(r.body) };
    }

    if (action === "update") {
      var r = await httpsRequest(BASE + "/values/" + encodeURIComponent(range) + "?valueInputOption=RAW&key=" + SHEETS_KEY, "PUT", { values: values });
      return { statusCode: 200, headers: headers, body: JSON.stringify(r.body) };
    }

    if (action === "clear") {
      var r = await httpsRequest(BASE + "/values/" + encodeURIComponent(range) + ":clear?key=" + SHEETS_KEY, "POST", {});
      return { statusCode: 200, headers: headers, body: JSON.stringify(r.body) };
    }

    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: "Onbekende actie: " + action }) };

  } catch(e) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: e.message }) };
  }
};
