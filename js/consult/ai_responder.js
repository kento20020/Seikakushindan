// AI で「次の一手カード」を作る（自前の中継 workers/consult-proxy.js を呼ぶ）。説明：docs/consult-ai.md
// ブラウザに API キーは置かない。中継の約束（proxy contract）：
//   POST <endpoint>  Content-Type: application/json
//     { version, model, l1, l2, l3, schema, maxTokens }   … version は 1層目の版、schema は CARD_JSON_SCHEMA
//   → 200 { card }（カードの JSON）／ 4xx・5xx { error }
// 返ってきたカードは validateCard で点検し、通らなければ例外（respond.js が決まった文型に戻す）。
import { CONSULT_CONFIG } from "./config.js";
import { CARD_JSON_SCHEMA, validateCard } from "./card.js";
import { buildPrompt } from "./prompt.js";

/** ブラウザの fetch は window から切り離して呼ぶと失敗するので、包んで呼ぶ */
const defaultFetch = (...args) => globalThis.fetch(...args);

/** AI の回答が使えなかったときの例外。errors に理由（点検の結果など）を入れる */
export class AiResponseError extends Error {
  constructor(message, errors = [message]) {
    super(message);
    this.name = "AiResponseError";
    this.errors = errors;
  }
}

/**
 * 中継を呼んでカードを作る。
 * @param {import("./context.js").ConsultContext} ctx
 * @param {{ endpoint: string, fetchImpl?: typeof fetch, timeoutMs?: number, model?: string, maxTokens?: number, prompt?: object }} opts
 *   prompt を渡すと作り直さずに使う（respond.js が作ったものを渡す）
 * @returns {Promise<import("./card.js").ConsultCard>}
 * @throws {AiResponseError}  HTTP の失敗・時間切れ・形の崩れ・点検の不合格
 */
export async function aiRespond(ctx, { endpoint, fetchImpl = defaultFetch, timeoutMs = CONSULT_CONFIG.timeoutMs,
  model = CONSULT_CONFIG.model, maxTokens = CONSULT_CONFIG.maxTokens, prompt } = {}) {
  if (!endpoint) throw new AiResponseError("中継の URL がない");
  if (typeof fetchImpl !== "function" || typeof globalThis.fetch !== "function" && fetchImpl === defaultFetch) throw new AiResponseError("fetch が使えない");
  if (ctx?.result?.action === "safety") throw new AiResponseError("安全ゲートのカードは AI に書かせない");
  const p = prompt ?? buildPrompt(ctx);
  const body = { version: p.version, model, l1: p.l1, l2: p.l2, l3: p.l3, schema: CARD_JSON_SCHEMA, maxTokens };

  const ac = typeof AbortController === "function" ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { ac?.abort(); reject(new AiResponseError(`時間切れ（${timeoutMs}ms）`)); }, timeoutMs);
  });
  let json;
  try {
    const res = await Promise.race([
      fetchImpl(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ac?.signal }),
      timeout,
    ]);
    if (!res || !res.ok) throw new AiResponseError(`HTTP ${res?.status ?? "?"}`);
    json = await Promise.race([res.json(), timeout]);
  } catch (e) {
    if (e instanceof AiResponseError) throw e;
    throw new AiResponseError(e?.name === "AbortError" ? `時間切れ（${timeoutMs}ms）` : `通信の失敗：${e?.message ?? e}`);
  } finally {
    clearTimeout(timer);
  }
  if (!json || typeof json !== "object") throw new AiResponseError("応答が JSON の object ではない");
  if (json.error) throw new AiResponseError(`中継のエラー：${String(json.error).slice(0, 200)}`);
  const card = json.card;
  const v = validateCard(card, ctx);
  if (!v.ok) throw new AiResponseError(`カードが点検を通らない（${v.errors.length}件）`, v.errors);
  return card;
}
