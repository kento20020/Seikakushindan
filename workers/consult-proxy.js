// 相談モードの AI 中継（Cloudflare Worker の見本。まだデプロイしていない）。説明：docs/consult-ai.md
//
// 役割：ブラウザ（GitHub Pages）から3層のプロンプトを受け取り、Claude Messages API を呼んで、カードの JSON を返す。
//       API キーはこの Worker の秘密（env.ANTHROPIC_API_KEY）にだけ置き、ブラウザには出さない。
//
// 約束（js/consult/ai_responder.js と同じ）：
//   POST /   Content-Type: application/json
//     { version, model, l1, l2, l3, schema, maxTokens }
//   → 200 { card } ／ 4xx・5xx { error }
//
// キャッシュの置き方（Claude API のプロンプトキャッシュ）：
//   system   = l1（固定）            cache_control { type: "ephemeral", ttl: "1h" }
//   messages = [user: l2（人ごと）    cache_control { type: "ephemeral" }（5分）, l3（今回の相談。キャッシュしない）]
//   長い TTL（1h）を短い TTL（5分）より前に置く決まりを守っている。区切りは2つ（上限は4つ）。
//   Haiku 5.5 はプロンプトが 512 トークン以上でキャッシュされる（l1 だけで超える）。
// 出力の形：output_config.format = { type: "json_schema", schema }（structured outputs。beta ヘッダは要らない）。
//   JSON は content の text ブロックに入って返るので、それを JSON.parse する。
//
// デプロイ（例）：
//   npm create cloudflare@latest consult-proxy   （または wrangler.toml を用意）
//   wrangler secret put ANTHROPIC_API_KEY
//   wrangler deploy
//   → 出た URL を js/consult/config.js の aiEndpoint に入れるか、ページを ?ai=<URL> で開く
//
// 任意の設定（wrangler.toml の [vars]）：
//   ALLOWED_ORIGINS     … カンマ区切り。既定は https://kento20020.github.io
//   ALLOWED_L1_SHA256   … カンマ区切り。l1 の SHA-256（16進）。入れると、その l1 以外は断る（Worker を何でも聞ける中継にさせない）
//   RATE_LIMITER        … Cloudflare の Rate Limiting バインディング（[[unsafe.bindings]] type = "ratelimit"）。あれば IP ごとに回数を制限する

const DEFAULT_ORIGINS = ["https://kento20020.github.io"];
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
/** 受け付けるモデル（ブラウザから任意のモデルを指定させない） */
const ALLOWED_MODELS = new Set(["claude-haiku-5-5"]);
/** 受け付ける大きさの上限（字）。l1 は固定の約1.7万字、l2 は約500字、l3 は相談文600字を含めて約2000字 */
const MAX_CHARS = { l1: 40000, l2: 3000, l3: 6000 };
const MAX_TOKENS_CAP = 2000;

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS ? String(env.ALLOWED_ORIGINS).split(",").map(s => s.trim()) : DEFAULT_ORIGINS);
  const ok = origin && allowed.includes(origin);
  return {
    ok,
    headers: ok ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    } : { "Vary": "Origin" },
  };
}

const json = (obj, status, headers) => new Response(JSON.stringify(obj), { status, headers: { ...headers, "content-type": "application/json; charset=utf-8" } });

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** 受け取った本体の形を確かめる。おかしければ理由の文字列、よければ null */
function badRequest(b) {
  if (!b || typeof b !== "object") return "本体が JSON の object ではない";
  for (const k of ["version", "model", "l1", "l2", "l3"]) if (typeof b[k] !== "string") return `${k} がない`;
  if (!ALLOWED_MODELS.has(b.model)) return "使えないモデル";
  for (const [k, n] of Object.entries(MAX_CHARS)) if (b[k].length > n) return `${k} が長すぎる`;
  if (!b.l1 || !b.l3) return "l1 か l3 が空";
  if (!b.schema || typeof b.schema !== "object" || b.schema.type !== "object") return "schema がない";
  if (b.maxTokens != null && !(Number.isInteger(b.maxTokens) && b.maxTokens > 0)) return "maxTokens が正しくない";
  return null;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env);
    if (request.method === "OPTIONS") return new Response(null, { status: cors.ok ? 204 : 403, headers: cors.headers });
    if (request.method !== "POST") return json({ error: "POST だけを受け付けます" }, 405, { ...cors.headers, Allow: "POST, OPTIONS" });
    if (!cors.ok) return json({ error: "この送り元は受け付けていません" }, 403, cors.headers);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "中継の設定がまだです" }, 500, cors.headers);

    // 回数の制限（IP ごと）。TODO：公開前に必ず入れる。Rate Limiting バインディングがなければ、KV や Durable Object で数える
    if (env.RATE_LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return json({ error: "少し時間をおいてから試してください" }, 429, cors.headers);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: "本体が JSON ではない" }, 400, cors.headers); }
    const bad = badRequest(body);
    if (bad) return json({ error: bad }, 400, cors.headers);
    if (env.ALLOWED_L1_SHA256) {
      const allowed = String(env.ALLOWED_L1_SHA256).split(",").map(s => s.trim().toLowerCase());
      if (!allowed.includes(await sha256Hex(body.l1))) return json({ error: "1層目の版が違う" }, 400, cors.headers);
    }

    const payload = {
      model: body.model,
      max_tokens: Math.min(body.maxTokens ?? 1200, MAX_TOKENS_CAP),
      system: [{ type: "text", text: body.l1, cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [{
        role: "user",
        content: [
          { type: "text", text: body.l2 || "（人ごとの情報なし）", cache_control: { type: "ephemeral" } },
          { type: "text", text: body.l3 },
        ],
      }],
      output_config: { format: { type: "json_schema", schema: body.schema } },
    };

    let res;
    try {
      res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return json({ error: "AI に届かなかった" }, 502, cors.headers);
    }
    let data;
    try { data = await res.json(); } catch { return json({ error: `AI の応答が読めない（HTTP ${res.status}）` }, 502, cors.headers); }
    if (!res.ok) return json({ error: `AI のエラー（HTTP ${res.status}：${data?.error?.type ?? "unknown"}）` }, 502, cors.headers);
    if (data.stop_reason === "refusal") return json({ error: "AI が回答を断った" }, 502, cors.headers);
    if (data.stop_reason === "max_tokens") return json({ error: "AI の出力が途中で切れた" }, 502, cors.headers);
    const text = (data.content || []).find(b => b.type === "text")?.text;
    if (!text) return json({ error: "AI の応答に本文がない" }, 502, cors.headers);
    let card;
    try { card = JSON.parse(text); } catch { return json({ error: "AI の出力が JSON ではない" }, 502, cors.headers); }
    // 点検（validateCard）はブラウザ側で行う。ここではキャッシュの使われ方だけログに残す（相談文は残さない）
    console.log(JSON.stringify({ v: body.version, usage: data.usage }));
    return json({ card }, 200, cors.headers);
  },
};
