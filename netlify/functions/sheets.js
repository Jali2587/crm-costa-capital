const SHEET_ID = "1y_QNvwgMSRydeeY2etGJUBREn-kDNRd9MuxV9nlJ2wc";
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;

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

  const { action, range, values } = JSON.parse(event.body || "{}");

  try {
    let url, options;

    if (action === "get") {
      url = `${BASE}/values/${encodeURIComponent(range)}?key=${API_KEY}`;
      const r = await fetch(url);
      const data = await r.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (action === "append") {
      url = `${BASE}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS&key=${API_KEY}`;
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values }) });
      const data = await r.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (action === "update") {
      url = `${BASE}/values/${encodeURIComponent(range)}?valueInputOption=RAW&key=${API_KEY}`;
      const r = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values }) });
      const data = await r.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (action === "clear") {
      url = `${BASE}/values/${encodeURIComponent(range)}:clear?key=${API_KEY}`;
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" } });
      const data = await r.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (action === "sheetinfo") {
      url = `${BASE}?key=${API_KEY}&fields=sheets.properties.title`;
      const r = await fetch(url);
      const data = await r.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action" }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
