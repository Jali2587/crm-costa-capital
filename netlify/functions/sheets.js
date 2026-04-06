const https = require("https");

const SHEET_ID = "1y_QNvwgMSRydeeY2etGJUBREn-kDNRd9MuxV9nlJ2wc";
const SHEETS_KEY = process.env.GOOGLE_SHEETS_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Content-Type": "application/json"
};

function req(url, method, body, hdrs) {
  return new Promise(function(resolve, reject) {
    var u = new URL(url);
    var bodyData = body ? JSON.stringify(body) : null;
    var opt = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: method || "GET",
      headers: Object.assign({"Content-Type": "application/json"}, hdrs || {})
    };
    if (bodyData) opt.headers["Content-Length"] = Buffer.byteLength(bodyData);
    var r = https.request(opt, function(res) {
      var d = "";
      res.on("data", function(c) { d += c; });
      res.on("end", function() {
        try { resolve({s: res.statusCode, b: JSON.parse(d)}); }
        catch(e) { resolve({s: res.statusCode, b: d}); }
      });
    });
    r.on("error", reject);
    if (bodyData) r.write(bodyData);
    r.end();
  });
}

function sheetsUrl(path) {
  var base = "https://sheets.googleapis.com/v4/spreadsheets/" + SHEET_ID + path;
  return base + (path.includes("?") ? "&" : "?") + "key=" + SHEETS_KEY;
}

function ok(body) {
  return {statusCode: 200, headers: CORS, body: JSON.stringify(body)};
}
function err(msg, code) {
  return {statusCode: code || 500, headers: CORS, body: JSON.stringify({error: msg})};
}

exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") return {statusCode: 200, headers: CORS, body: ""};

  var body;
  try { body = JSON.parse(event.body || "{}"); }
  catch(e) { return err("Invalid JSON", 400); }

  var action = body.action;

  try {
    if (action === "sheetinfo") {
      var r = await req(sheetsUrl("?fields=sheets.properties.title"));
      return ok(r.b);
    }

    if (action === "get") {
      var r = await req(sheetsUrl("/values/" + encodeURIComponent(body.range)));
      return ok(r.b);
    }

    if (action === "append") {
      var r = await req(
        sheetsUrl("/values/" + encodeURIComponent(body.range) + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS"),
        "POST", {values: body.values}
      );
      if (r.s !== 200) return err("Sheets fout " + r.s + ": " + JSON.stringify(r.b), r.s);
      return ok(r.b);
    }

    if (action === "update") {
      var r = await req(
        sheetsUrl("/values/" + encodeURIComponent(body.range) + "?valueInputOption=RAW"),
        "PUT", {values: body.values}
      );
      if (r.s !== 200) return err("Sheets fout " + r.s + ": " + JSON.stringify(r.b), r.s);
      return ok(r.b);
    }

    if (action === "clear") {
      var r = await req(sheetsUrl("/values/" + encodeURIComponent(body.range) + ":clear"), "POST", {});
      return ok(r.b);
    }

    if (action === "extractpdf" || action === "search" || action === "aimatch") {
      if (!ANTHROPIC_KEY) return err("ANTHROPIC_API_KEY niet ingesteld");

      var payload;

      if (action === "extractpdf") {
        payload = {
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: 'Vastgoeddata-extractor. Geef ALLEEN geldig JSON: {"name":"string","type":"Hotel/Boutique hotel/Resort/Aparthotel/Portfolio/Development/Nursing home/Mixed use/Overig","stars":"string","location":"string","price":"string","rooms":"string","size":"string","status":"Beschikbaar","description":"string","matchCriteria":"string"}',
          messages: [{role: "user", content: [
            {type: "document", source: {type: "base64", media_type: "application/pdf", data: body.pdfBase64}},
            {type: "text", text: "Extraheer vastgoeddata als JSON. Bestand: " + (body.filename || "doc.pdf")}
          ]}]
        };
      }

      if (action === "search") {
        payload = {
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          tools: [{type: "web_search_20250305", name: "web_search"}],
          system: 'Zoek ECHTE RECENTE kopers voor vastgoed. Antwoord ALLEEN als JSON array: [{"name":"string","company":"string","deal_type":"string","activity":"string","why_match":"string","linkedin_likely":true,"source":"string"}]',
          messages: [{role: "user", content: "Zoek kopers voor: " + body.criteria}]
        };
      }

      if (action === "aimatch") {
        var list = (body.candidates || []).map(function(c, i) {
          return (i+1) + ". " + c.name + (c.company ? " (" + c.company + ")" : "") + (c.notes ? " | " + c.notes.slice(0,100) : "") + (c.linkedinFirstDegree ? " [LI]" : "");
        }).join("\n");
        var obj = body.object || {};
        payload = {
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          tools: [{type: "web_search_20250305", name: "web_search"}],
          system: 'Analyseer welke contacten match zijn voor het object. Zoek online naar hun activiteit. Antwoord ALLEEN als JSON array: [{"name":"string","reason":"string","activity":"string","score":8,"linkedin":true}]',
          messages: [{role: "user", content: "Object: " + obj.name + " | " + obj.type + " | " + obj.location + " | " + obj.price + "\n\nContacten:\n" + list}]
        };
      }

      var r = await req(
        "https://api.anthropic.com/v1/messages",
        "POST", payload,
        {"x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01"}
      );

      if (r.s !== 200) return err("Anthropic fout " + r.s + ": " + JSON.stringify(r.b).slice(0,300), r.s);

      var text = (r.b.content || []).filter(function(x) { return x.type === "text"; }).map(function(x) { return x.text; }).join("");

      if (action === "extractpdf") {
        var m = text.match(/\{[\s\S]*\}/);
        if (!m) return err("Geen JSON in antwoord: " + text.slice(0,200));
        try { return ok({extracted: JSON.parse(m[0])}); }
        catch(e) { return err("Parse fout: " + m[0].slice(0,100)); }
      }

      var m2 = text.match(/\[[\s\S]*\]/);
      var arr = [];
      if (m2) { try { arr = JSON.parse(m2[0]); } catch(e) {} }

      if (action === "search") return ok({results: arr});
      if (action === "aimatch") return ok({matches: arr});
    }

    return err("Onbekende actie: " + action, 400);

  } catch(e) {
    return err(e.message);
  }
};
