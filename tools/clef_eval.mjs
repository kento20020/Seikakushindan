// Clef（Cloudflare の決めるためのモデル）で案D の読み取りを試し、規則・Clef・組み合わせを比べる道具。説明：docs/consult-reading.md
// CI では動かさない（tests/ には置かない）。テストの文と正解は tests/fixtures/consult_read_cases.mjs を共有する。
//
//   node tools/clef_eval.mjs                  … 大きい Clef（clef）で試す
//   node tools/clef_eval.mjs --model clef-flash
//   node tools/clef_eval.mjs --threshold 0.7  … 埋める基準を変える（既定 0.8）
//
// 鍵は環境変数で渡す（CLOUDFLARE_API_TOKEN・CLOUDFLARE_ACCOUNT_ID）。鍵の値は表示もログもしない。
// 鍵が無いときは、何をどこに設定すればよいかを出して、何も呼ばずに終わる（終了コード 0）。結果を作り話で出さない。
import { clefRequest, parseClefAnswers, CLEF_MODEL_ID, CLEF_MODELS, CLEF_THRESHOLD } from "../js/consult/clef.js";
import { extractRules } from "../js/consult/extract_rules.js";
import { readText, READ_KEYS } from "../js/consult/extract.js";
import { runQuestions } from "../js/consult/needed.js";
import { judge, normalizeInput } from "../js/consult/judge.js";
import { READ_CASES, answerFromTruth } from "../tests/fixtures/consult_read_cases.mjs";

// ---------------------------------------------------------------- 引数
const args = process.argv.slice(2);
const argOf = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const model = argOf("--model", "clef");
const threshold = Number(argOf("--threshold", CLEF_THRESHOLD));
if (!CLEF_MODELS.includes(model)) { console.error(`--model は ${CLEF_MODELS.join(" か ")} を指定してください`); process.exit(2); }
if (!(threshold > 0.5 && threshold <= 1)) { console.error("--threshold は 0.5 より大きく 1 以下で指定してください"); process.exit(2); }

// ---------------------------------------------------------------- 鍵
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) {
  const missing = [!token && "CLOUDFLARE_API_TOKEN", !account && "CLOUDFLARE_ACCOUNT_ID"].filter(Boolean);
  console.log(`Clef を呼ぶための鍵がないので、何も呼ばずに終わります（足りないもの：${missing.join("・")}）。

設定のしかた：
  1. Cloudflare のダッシュボードの Workers AI の画面で「Use REST API」→「Create a Workers AI API Token」を選び、トークンを作る
     （用意された型のままでよい。自分で作るなら権限は「Workers AI - Read」と「Workers AI - Edit」）。
  2. 同じ画面の「Account ID」を控える。
  3. この道具を動かす環境に、次の2つを環境変数として入れる：
       CLOUDFLARE_API_TOKEN  … 1 のトークン
       CLOUDFLARE_ACCOUNT_ID … 2 のアカウント ID
     Claude Code のクラウドの環境なら、環境の設定（環境変数・シークレット）に入れる。手元なら、シェルで export するか .env を読み込む。
  ※ トークンはチャットや Issue・コミットに貼らない。この道具はトークンの値を表示もログもしない。

詳しくは docs/consult-reading.md の「Clef を試す」。`);
  process.exit(0);
}

// ---------------------------------------------------------------- 呼び出し
const URL_BASE = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${CLEF_MODEL_ID}`;
async function callClef(text) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  const t0 = performance.now();
  try {
    const res = await fetch(URL_BASE, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(clefRequest(text, { model })),
      signal: ctl.signal,
    });
    const ms = performance.now() - t0;
    let body = null;
    try { body = await res.json(); } catch { /* 本文が JSON でない */ }
    if (!res.ok || (body && body.success === false)) {
      const msg = (body?.errors || []).map(e => `${e.code ?? ""} ${e.message ?? ""}`.trim()).join(" / ") || `HTTP ${res.status}`;
      return { ok: false, ms, error: msg };
    }
    return { ok: true, ms, body };
  } catch (e) {
    return { ok: false, ms: performance.now() - t0, error: e.name === "AbortError" ? "30秒で打ち切り" : String(e.message || e) };
  } finally { clearTimeout(timer); }
}

// ---------------------------------------------------------------- 比べる
const pad = (s, n) => { s = String(s); const w = [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0); return s + " ".repeat(Math.max(0, n - w)); };
const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(" ") || "（なし）";
const READERS = ["rules", "clef", "both"];
const LABEL = { rules: "規則", clef: "Clef", both: "組み合わせ" };
const perField = Object.fromEntries(READ_KEYS.map(k => [k, Object.fromEntries(READERS.map(r => [r, { filled: 0, ok: 0, ng: 0 }]))]));
const calib = [];   // Clef の答え：{ key, value, p, correct, filled }
const actions = Object.fromEntries(READERS.map(r => [r, { ok: 0, q: 0, n: 0 }]));
const times = [], tokens = [], errors = [];

console.log(`Clef（${model}、基準 ${threshold}）で ${READ_CASES.length} 件を読みます。\n`);
for (const c of READ_CASES) {
  const res = await callClef(c.text);
  if (!res.ok) { errors.push([c.id, res.error]); console.log(`■ ${c.id}：呼び出しに失敗（${res.error}）`); continue; }
  times.push(res.ms);
  const inner = res.body?.result ?? res.body;
  if (Number.isFinite(inner?.usage?.input_tokens)) tokens.push(inner.usage.input_tokens);
  const parsed = parseClefAnswers(res.body, { threshold });
  const rules = extractRules(c.text).fields;
  const combo = readText(c.text, { clef: parsed });
  const truth = normalizeInput(c.truth);
  const filledBy = { rules, clef: parsed.fields, both: combo.fields };
  for (const r of READERS) for (const [k, v] of Object.entries(filledBy[r])) {
    if (!perField[k]) continue;
    const s = perField[k][r]; s.filled++; if (v === truth[k]) s.ok++; else s.ng++;
  }
  // 確率の当てになり具合：選ばれた値（unknown 以外）と確率
  const answers = inner?.answers || {};
  for (const k of READ_KEYS) {
    const a = answers[k];
    if (a == null) continue;
    const value = a.type === "noul" || typeof a === "number" ? (Number(a.noul ?? a) >= 0.5) : a.choice;
    const p = parsed.confidence[k];
    if (value === "unknown" || p == null) continue;
    calib.push({ key: k, value, p, correct: value === truth[k], filled: k in parsed.fields });
  }
  // 最後の一手と問の数（正解の入力から答える）
  const want = judge(c.truth).action;
  for (const r of READERS) {
    const run = runQuestions({ ...filledBy[r], ...c.context }, answerFromTruth(c.truth));
    actions[r].n++; actions[r].q += run.asked.length; if (run.result.action === want) actions[r].ok++;
  }
  console.log(`■ ${c.id}（${res.ms.toFixed(0)}ms）「${c.text}」`);
  console.log(`   規則：${fmt(rules)}`);
  console.log(`   Clef：${fmt(parsed.fields)}${parsed.low.length ? `　迷い：${parsed.low.join("・")}` : ""}${parsed.unknown.length ? `　分からない：${parsed.unknown.join("・")}` : ""}`);
  console.log(`   確率：${Object.entries(parsed.confidence).map(([k, p]) => `${k} ${p.toFixed(2)}`).join("、")}`);
  if (combo.conflicts.length) console.log(`   食い違い：${combo.conflicts.map(k => `${k}（規則 ${combo.conflictValues[k].rules}／Clef ${combo.conflictValues[k].clef}）`).join("、")}`);
}

// ---------------------------------------------------------------- 表
console.log(`\n項目ごとの正解率（正しく埋めた数／埋めた数。正解は tests/fixtures/consult_read_cases.mjs の truth）`);
console.log(pad("項目", 14) + READERS.map(r => pad(LABEL[r], 18)).join(""));
for (const k of READ_KEYS) {
  const row = READERS.map(r => { const s = perField[k][r]; return pad(s.filled ? `${s.ok}/${s.filled}${s.ng ? `（誤り${s.ng}）` : ""}` : "—", 18); }).join("");
  console.log(pad(k, 14) + row);
}
const sum = (r, key) => READ_KEYS.reduce((a, k) => a + perField[k][r][key], 0);
console.log(pad("合計", 14) + READERS.map(r => pad(`${sum(r, "ok")}/${sum(r, "filled")}（誤り${sum(r, "ng")}）`, 18)).join(""));

console.log(`\n最後の一手（問に正解の入力から答えたとき）`);
for (const r of READERS) { const a = actions[r]; if (a.n) console.log(`  ${pad(LABEL[r], 12)} 正しい一手 ${a.ok}/${a.n}、問の平均 ${(a.q / a.n).toFixed(1)}`); }

console.log(`\nClef の確率の当てになり具合（選ばれた値ごと）`);
for (const [lo, hi] of [[0.95, 1.01], [0.9, 0.95], [0.8, 0.9], [0.6, 0.8], [0, 0.6]]) {
  const xs = calib.filter(x => x.p >= lo && x.p < hi);
  if (xs.length) console.log(`  確率 ${lo.toFixed(2)}〜${Math.min(hi, 1).toFixed(2)}：${xs.filter(x => x.correct).length}/${xs.length} が正解`);
}
const wrongHigh = new Map();   // 「項目=値」→ { n, maxP }
for (const x of calib) if (x.filled && !x.correct) {
  const k = `${x.key}=${x.value}`, o = wrongHigh.get(k) || { n: 0, maxP: 0 };
  o.n++; o.maxP = Math.max(o.maxP, x.p); wrongHigh.set(k, o);
}
if (wrongHigh.size) console.log(`  基準以上なのに違った答え：${[...wrongHigh].map(([k, o]) => `${k} ×${o.n}（最大 ${o.maxP.toFixed(2)}）`).join("、")}`);

if (times.length) {
  const sorted = [...times].sort((a, b) => a - b);
  console.log(`\nかかった時間（通信を含む）：真ん中 ${sorted[Math.floor(sorted.length / 2)].toFixed(0)}ms、最大 ${sorted.at(-1).toFixed(0)}ms`);
}
if (tokens.length) console.log(`入力トークン：平均 ${(tokens.reduce((a, b) => a + b, 0) / tokens.length).toFixed(0)}（質問の組を含む）`);
if (errors.length) console.log(`\n失敗：${errors.length} 件（${errors.map(([id, e]) => `${id}: ${e}`).join("、")}）`);
