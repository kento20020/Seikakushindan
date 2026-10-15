// 相談モードの回答の層の設定。説明：docs/consult-ai.md
// 今は AI を呼ばない（aiEndpoint: null → 決まった文型で答える template_responder.js）。
// 中継（workers/consult-proxy.js）を置いたら、aiEndpoint に URL を入れるか、aiEndpointHosts に中継のホストを入れて ?ai=<URL> で開く。
// ?ai= は aiEndpointHosts に載っているホストだけが有効（既定は空＝いまは ?ai= を無視する）。

export const CONSULT_CONFIG = Object.freeze({
  /** 中継の URL（自前の Cloudflare Worker など）。null なら AI を呼ばず、決まった文型で答える */
  aiEndpoint: null,
  /** 中継に頼むモデル */
  model: "claude-haiku-5-5",
  /** 出力の上限トークン */
  maxTokens: 1200,
  /** 中継の応答を待つ上限（ミリ秒）。過ぎたら決まった文型に戻す */
  timeoutMs: 20000,
  /** 1層目（固定のシステムプロンプト）の版。1層目の中身（texts.js・お手本）を変えたら上げる */
  promptVersion: "2026-10-15",
  /**
   * ?ai= で受け付ける中継のホスト名（完全一致。ポートは見ない。例 "consult-proxy.example.workers.dev"）。
   * 既定は空＝?ai= はどんな URL でも無視する。自分の Worker のホストだけを入れること
   * （入れないと、細工したリンクから相談文が他人のサーバーに送られうる。docs/consult-ai.md の公開前チェック）。
   * 上の aiEndpoint（コードに書いた URL）はこの一覧と関係なく使われる
   */
  aiEndpointHosts: Object.freeze([]),
});

/**
 * location.search の文字列（"?ai=https://…" など）から中継の URL を読む。
 * ?ai= を受け付けるのは、https: の URL で、ホスト名が allowHosts（既定は CONSULT_CONFIG.aiEndpointHosts）にそのまま載っているときだけ。
 * 一覧が空（既定）なら、どんな ?ai= も null。ない・URL として読めない・https: でない・認証情報つき・載っていないホスト → null。
 * @param {string} search  location.search（先頭の "?" はあってもなくてもよい）
 * @param {{ allowHosts?: readonly string[]|null }} [opts]  受け付けるホスト名（完全一致・大文字小文字は区別しない。"example.com" は "a.example.com" を含まない）
 * @returns {string|null}  正規化した URL（href）
 */
export function resolveAiEndpoint(search, { allowHosts = CONSULT_CONFIG.aiEndpointHosts } = {}) {
  if (typeof search !== "string" || !search) return null;
  const hosts = Array.isArray(allowHosts) ? allowHosts.filter(x => typeof x === "string" && x.trim()).map(x => x.trim().toLowerCase()) : [];
  if (!hosts.length) return null;   // 載せたホストがなければ ?ai= は使わない
  let raw;
  try { raw = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("ai"); } catch { return null; }
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
  if (!hosts.includes(url.hostname.toLowerCase())) return null;
  return url.href;
}

/** 使う中継の URL：有効な ?ai=（aiEndpointHosts に載っているホスト）があればそれ、なければ CONSULT_CONFIG.aiEndpoint（どちらもなければ null） */
export function currentAiEndpoint(search, opts) {
  return resolveAiEndpoint(search, opts) ?? CONSULT_CONFIG.aiEndpoint;
}
