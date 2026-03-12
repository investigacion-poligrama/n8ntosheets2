// app/api/n8n/route.js
export const runtime = "edge";

const N8N_URL = "https://auto.n8npoli.io/webhook/deco-padre";

export async function POST(req) {
  try {
    const body = await req.json();

    const r = await fetch(N8N_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // Si n8n respondió (200-399), lo consideramos “en cola”.
    if (r.status >= 200 && r.status < 400) {
      return new Response(JSON.stringify({ status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Si n8n respondió con error, propagamos el código y un texto breve
    const text = await r.text().catch(() => "");
    return new Response(JSON.stringify({ status: "error", code: r.status, body: text || null }), {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "proxy error", message: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function GET() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}