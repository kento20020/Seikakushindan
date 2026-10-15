// 回答の入口：中継の URL がなければ決まった文型、あれば AI を試して、だめなら決まった文型に戻す。説明：docs/consult-ai.md
// 画面はこれだけを呼べばよい（buildContext → respond → カードを表示、refineQuestions で問いを出す）。
import { templateRespond } from "./template_responder.js";
import { aiRespond } from "./ai_responder.js";
import { buildPrompt } from "./prompt.js";

/**
 * 次の一手カードを作る。
 *   - endpoint がない → 決まった文型（source "template"）
 *   - 安全ゲート → いつも決まった文型（窓口の番号を AI に書かせない）
 *   - endpoint がある → AI（source "ai"）。失敗（HTTP・時間切れ・点検の不合格）したら retries 回まで試し、だめなら決まった文型に戻して errors に理由を入れる
 * prompt はいつも返す（開発者向けの表示用。l1・l2・l3・version）
 * @param {import("./context.js").ConsultContext} ctx
 * @param {{ endpoint?: string|null, fetchImpl?: typeof fetch, timeoutMs?: number, retries?: number }} [opts]
 * @returns {Promise<{ card: import("./card.js").ConsultCard, source: "template"|"ai", errors: string[], prompt: { l1: string, l2: string, l3: string, version: string } }>}
 */
export async function respond(ctx, { endpoint = null, fetchImpl, timeoutMs, retries = 0 } = {}) {
  const prompt = buildPrompt(ctx);
  if (!endpoint || ctx.result.action === "safety") return { card: templateRespond(ctx), source: "template", errors: [], prompt };
  const errors = [];
  for (let i = 0; i <= retries; i++) {
    try {
      const card = await aiRespond(ctx, { endpoint, fetchImpl, timeoutMs, prompt });
      return { card, source: "ai", errors, prompt };
    } catch (e) {
      errors.push(...(Array.isArray(e?.errors) ? e.errors : [String(e?.message ?? e)]));
    }
  }
  return { card: templateRespond(ctx), source: "template", errors, prompt };
}
