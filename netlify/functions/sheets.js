const https = require("https");

const SHEET_ID = "1y_QNvwgMSRydeeY2etGJUBREn-kDNRd9MuxV9nlJ2wc";
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;

function httpsRequest(url, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: { "Content-Type": "application/json" },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({ error: data }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
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
  const { action, range, values } = body;

  try {
    if (!API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "GOOGLE_SHEETS_API_KEY niet ingesteld in Netlify environment variables." }) };
    }

    if (action === "sheetinfo") {
      const data = await httpsRequest(`${BASE}?key=${API_KEY}&fields=sheets.properties.title`);
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (action === "get") {
      const data = await httpsRequest(`${BASE}/values/${encodeURIComponent(range)}?key=${API_KEY}`);
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (action === "append") {
      const url = `${BASE}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS&key=${API_KEY}`;
      const data = await httpsRequest(url, "POST", { values });
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (action === "update") {
      const url = `${BASE}/values/${encodeURIComponent(range)}?valueInputOption=RAW&key=${API_KEY}`;
      const data = await httpsRequest(url, "PUT", { values });
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (action === "clear") {
      const url = `${BASE}/values/${encodeURIComponent(range)}:clear?key=${API_KEY}`;
      const data = await httpsRequest(url, "POST", {});
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Onbekende actie: " + action }) };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
