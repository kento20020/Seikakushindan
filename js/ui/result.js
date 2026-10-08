// 結果タブ：選ばれたパターン／16傾向スコア／回答品質・一貫性／AI統合用テキストとJSON保存
import { h, mount, num, pct, signed, table, toast, download, copyText } from "./dom.js";
import { store, PROFILE_SAMPLES, SAMPLES, runSample, loadProfileSample } from "./store.js";
import { TH, DOMAINS, domainStates } from "../engine.js";
import { PATTERN_BY_ID } from "../data/patterns.js";
import { ROLE_CLASS, kindLabel, domainLine, uniqueLabel } from "./labels.js";

const ROLE_ORDER = { "主軸": 0, "補強": 1, "矛盾": 2, "地（形状）": 3 };
/** 表示順：役割順、同じ役割の中は選ばれた順 */
export const byRole = (chosen) => chosen.map((hit, i) => ({ hit, i }))
  .sort((x, y) => (ROLE_ORDER[x.hit.role] ?? 9) - (ROLE_ORDER[y.hit.role] ?? 9) || x.i - y.i).map(x => x.hit);

export function renderResult(el) {
  const r = store.result;
  if (!r) return renderEmpty(el);
  const states = domainStates(r.profile);
  mount(el,
    header(r),
    h("section", { class: "block", "aria-labelledby": "res-patterns" },
      h("h2", { id: "res-patterns" }, "あなたを表す解釈"),
      h("p", { class: "note" }, "16の傾向スコアから条件を満たしたパターンを集め、重なりを避けながら2〜4本を選んでいます。主軸がいちばん中心にある動き方、補強はそれを支える動き方、矛盾は同時に抱えている逆向きの衝動です。"),
      h("div", { class: "pcards" }, byRole(r.select.chosen).map(hit => patternCard(hit, r))),
      r.select.chosen.length === 0 ? h("p", { class: "empty" }, "条件を満たすパターンがありませんでした。") : null),
    h("section", { class: "block", "aria-labelledby": "res-scores" },
      h("h2", { id: "res-scores" }, "16の傾向スコア"),
      scoreLegend(r),
      h("div", { class: "domains" }, Object.keys(DOMAINS).map(d => domainRow(+d, r, states[d])))),
    h("section", { class: "block", "aria-labelledby": "res-quality" },
      h("h2", { id: "res-quality" }, "回答の確かさ"),
      qualityBlock(r)),
    h("section", { class: "block", "aria-labelledby": "res-export" },
      h("h2", { id: "res-export" }, "結果を持ち出す"),
      exportBlock(r)),
  );
}

function renderEmpty(el) {
  mount(el,
    h("div", { class: "empty-state" },
      h("h1", null, "まだ結果がありません"),
      h("p", null, "診断に答えると、ここに結果が出ます。サンプルの回答で結果だけ見ることもできます。"),
      h("div", { class: "row wrap-row" },
        h("a", { class: "btn primary", href: "#diagnose" }, "診断をはじめる"),
        SAMPLES.map((s, i) => h("button", { class: "btn", onclick: () => runSample(i) }, `${s.name}で見る`))),
      h("div", { class: "row wrap-row" },
        PROFILE_SAMPLES.map((p, i) => h("button", { class: "btn small", onclick: () => loadProfileSample(i) }, p.name)))));
}

function header(r) {
  const src = r.source || {};
  const bits = [];
  if (r.config) bits.push(r.config.adaptive ? "可変モード" : "固定80問", r.config.startWording === 1 ? "表現Bで開始" : "表現Aで開始");
  if (r.stages) {
    const fu = r.stages.followups.length, ex = r.stages.extraDuels.length;
    if (r.config?.adaptive) bits.push(`追加 ${fu}問・追加対決 ${ex}問`);
  }
  if (src.type === "profile") bits.push("スコアだけのプロファイル（設問なし）");
  return h("div", { class: "res-head" },
    h("h1", null, "診断結果"),
    h("p", { class: "res-source" }, h("b", null, src.name || "あなたの回答"), bits.length ? h("span", null, bits.join("／")) : null));
}

// ---------------------------------------------------------------- パターンカード
function patternCard(hit, r) {
  const m = hit.meta;
  const p = PATTERN_BY_ID[m.id];
  const t = p?.text;
  const step = r.select.trace.find(s => s.chosen === m.id);
  const cand = step?.candidates.find(c => c.id === m.id);
  const reasons = cand?.reasons?.length ? `（${cand.reasons.join("、")}）` : "";
  const why = `重要度 ${num(m.importance)} × 充足度 ${hit.sat.toFixed(2)}（余裕 ${signed(hit.margin)}）＝ スコア ${hit.score.toFixed(2)}。` +
    (step ? `選択ステップ${step.k}で採用、有効スコア ${step.chosenEff.toFixed(2)}${reasons}。` : "");
  return h("article", { class: ["pcard", `role-${ROLE_CLASS[hit.role] || "support"}`], "data-id": m.id, "data-role": hit.role },
    h("div", { class: "pcard-top" },
      h("span", { class: "role-badge" }, hit.role),
      h("span", { class: "pkind" }, kindLabel(m)),
      h("span", { class: "pid" }, m.id)),
    h("h3", { class: "headline" }, p?.headline ?? m.headline),
    h("p", { class: "pdomains" }, domainLine(m), t?.weak ? "（弱い版：明確に優勢の本文を、重要度を下げて流用）" : ""),
    t ? [
      h("p", { class: "one" }, t.one),
      h("p", { class: "detail" }, t.detail),
      h("ul", { class: "scenes", "aria-label": "よくある場面" }, t.scenes.map(s => h("li", null, s))),
      t.unique ? h("div", { class: "aside unique" }, h("h4", null, uniqueLabel(m)), h("p", null, t.unique)) : null,
      h("div", { class: "aside caveat" }, h("h4", null, "誤解しやすい点"), h("p", null, t.caveat)),
    ] : h("p", { class: "empty" }, "本文がありません。"),
    h("p", { class: "why" }, h("b", null, "なぜ選ばれたか"), why));
}

// ---------------------------------------------------------------- 16傾向スコア
function scoreLegend(r) {
  return h("p", { class: "legend" },
    h("span", { class: "lg lg-a" }, "左：A側の傾向"), h("span", { class: "lg lg-b" }, "右：B側の傾向"),
    h("span", { class: "lg lg-tick" }, `目盛り：低 ${TH.low}以下／高 ${TH.high}以上`),
    r.informative ? h("span", { class: "lg" }, "●：4問のうち「どちらともいえない」以外で答えた数") : null);
}

function dots(n) {
  if (n == null) return null;
  return h("span", { class: "dots", role: "img", "aria-label": `はっきりした回答 ${n}/4` },
    [0, 1, 2, 3].map(i => h("i", { class: i < n ? "on" : "" })));
}

function bar(side, v) {
  return h("div", { class: ["sbar", `sbar-${side}`] },
    h("i", { class: "fill", style: { width: `${Math.max(0, Math.min(100, v))}%` } }),
    h("b", { class: "tick", style: { [side === "a" ? "right" : "left"]: `${TH.low}%` }, "aria-hidden": "true" }),
    h("b", { class: "tick", style: { [side === "a" ? "right" : "left"]: `${TH.high}%` }, "aria-hidden": "true" }));
}

function domainRow(d, r, st) {
  const D = DOMAINS[d];
  const va = r.scores[D.a], vb = r.scores[D.b];
  const dd = r.duelDetail?.find(x => x.domain === d);
  const duelText = !dd || (!dd.n && !dd.side) ? null
    : dd.side ? `対決：${dd.side}寄り ${num(dd.strength, 0)}${dd.n > 1 ? `（${dd.n}問の平均）` : ""}` : `対決：どちらとも${dd.n > 1 ? `（${dd.n}問の平均）` : ""}`;
  const lead = va - vb >= TH.diff ? "a" : vb - va >= TH.diff ? "b" : null;
  return h("div", { class: ["drow", lead && `lead-${lead}`], "data-domain": d },
    h("div", { class: "drow-head" },
      h("h3", null, h("span", { class: "dnum" }, d), D.name),
      h("span", { class: "state", title: st.id ? `${st.id}（余裕 ${signed(st.margin)}）` : "" }, st.label)),
    h("div", { class: "drow-bars" },
      h("div", { class: "half half-a" },
        h("div", { class: "tline" }, h("span", { class: "tname" }, D.a), dots(r.informative?.[D.a]), h("span", { class: "tnum" }, num(va))),
        bar("a", va)),
      h("div", { class: "half half-b" },
        h("div", { class: "tline" }, h("span", { class: "tnum" }, num(vb)), dots(r.informative?.[D.b]), h("span", { class: "tname" }, D.b)),
        bar("b", vb))),
    duelText ? h("p", { class: "drow-foot" }, duelText) : null);
}

// ---------------------------------------------------------------- 回答品質・一貫性・追加質問
function qualityBlock(r) {
  if (!r.quality) return h("p", { class: "note" }, "スコアだけのプロファイルなので、回答品質・一貫性・追加質問の情報はありません（回答品質はOKとして判定しています）。");
  const q = r.quality;
  const items = [
    h("div", { class: ["qstat", q.same <= 0.75 ? "ok" : "ng"] }, h("span", null, "同じ回答の割合"), h("b", null, pct(q.same)), h("small", null, "75%以下ならOK")),
    h("div", { class: ["qstat", q.sd >= 0.75 ? "ok" : "ng"] }, h("span", null, "回答のばらつき（SD）"), h("b", null, q.sd.toFixed(2)), h("small", null, "0.75以上ならOK")),
    h("div", { class: ["qstat", q.ok ? "ok" : "ng"] }, h("span", null, "判定"), h("b", null, q.ok ? "OK" : "NG"),
      h("small", null, q.ok ? "全体の形（形状パターン）も判定に使う" : "全体の形からの判定を保留")),
  ];
  const cons = r.consistency || [];
  const ng = cons.filter(c => c.flag === "不一致");
  const consTable = table(["設問", "傾向", "回答", "基本平均", "差", "判定"],
    cons.map(c => h("tr", { class: c.flag === "不一致" ? "row-ng" : "" },
      h("td", null, c.itemId), h("td", null, c.trait), h("td", null, num(c.answer)), h("td", null, num(c.mean, 2)),
      h("td", null, signed(c.delta, 2)), h("td", null, h("span", { class: ["flag", c.flag === "不一致" ? "flag-ng" : c.flag === "OK" ? "flag-ok" : ""] }, c.flag)))));

  const st = r.stages;
  const fuRows = (st?.followups || []).map(f => h("tr", { class: f.changed ? "row-changed" : "" },
    h("td", null, f.itemId), h("td", null, f.trait), h("td", null, f.wordingIndex === 0 ? "表現A" : "表現B"),
    h("td", null, `${f.first ?? "—"} → ${f.answer ?? "—"}`), h("td", null, f.changed ? "置き換え" : "変わらず")));
  const exRows = (st?.extraDuels || []).map(e => {
    const dd = r.duelDetail.find(x => x.domain === e.domain);
    return h("tr", null, h("td", null, e.itemId), h("td", null, DOMAINS[e.domain].name), h("td", null, num(e.answer)),
      h("td", null, dd?.side ? `${dd.side} ${num(dd.strength, 0)}` : "どちらとも"));
  });
  return [
    h("div", { class: "qstats" }, items),
    h("h3", null, "一貫性の確認", h("small", null, ng.length ? `　不一致 ${ng.length}問` : "　不一致なし")),
    h("p", { class: "note" }, `各領域に1問ある確認用の設問と、同じ傾向の基本4問の平均を比べています。差が${1.5}以上なら「不一致」。スコアには入れていません。`),
    consTable,
    r.config?.adaptive ? [
      h("h3", null, "追加で聞いた質問", h("small", null, `　${fuRows.length}問`)),
      fuRows.length ? table(["設問", "傾向", "表現", "回答（最初→追加）", "スコアへの反映"], fuRows)
        : h("p", { class: "note" }, "どの傾向もはっきり答えていたので、追加の質問はありませんでした。"),
      h("h3", null, "追加の対決", h("small", null, `　${exRows.length}問`)),
      exRows.length ? table(["設問", "領域", "回答", "対決の合計（平均）"], exRows)
        : h("p", { class: "note" }, "決めきれない領域がなかったので、追加の対決はありませんでした。"),
    ] : null,
  ];
}

// ---------------------------------------------------------------- 持ち出し
export function aiText(r) {
  const states = domainStates(r.profile);
  const lines = ["【16次元診断の結果（AI統合用）】", `対象：${r.source?.name ?? "あなたの回答"}`, "",
    "■ 選ばれた解釈パターン（主軸を中心に、矛盾は消さずに1人の人物像としてまとめてください）"];
  for (const hit of byRole(r.select.chosen)) {
    const p = PATTERN_BY_ID[hit.meta.id], t = p?.text;
    lines.push("", `［${hit.role}］${hit.meta.id}　${p?.headline ?? hit.meta.headline}`);
    if (t) {
      lines.push(`一言：${t.one}`, `詳細：${t.detail}`, "場面：", ...t.scenes.map(s => `・${s}`), `誤解しやすい点：${t.caveat}`);
    }
  }
  lines.push("", "■ 16傾向スコア（0〜100。左右は独立に測定）");
  for (const d of Object.keys(DOMAINS)) {
    const D = DOMAINS[d];
    const dd = r.duelDetail?.find(x => x.domain === +d);
    const duel = dd && (dd.side || dd.n) ? `、対決：${dd.side ? `${dd.side} ${num(dd.strength, 0)}` : "どちらとも"}` : "";
    lines.push(`${d}. ${D.name}：${D.a} ${num(r.scores[D.a])}／${D.b} ${num(r.scores[D.b])}（${states[d].label}${duel}）`);
  }
  if (r.quality) lines.push("", `■ 回答品質：同じ回答の割合 ${pct(r.quality.same)}、SD ${r.quality.sd.toFixed(2)}（${r.quality.ok ? "OK" : "NG"}）`);
  return lines.join("\n");
}

function exportJSON(r) {
  const states = domainStates(r.profile);
  return {
    type: "seikaku16-result", version: 1, createdAt: new Date().toISOString(),
    source: r.source, config: r.config ?? null,
    profile: r.profile, confidence: r.confidence, informative: r.informative, quality: r.quality, consistency: r.consistency,
    duelDetail: r.duelDetail, stages: r.stages,
    domainStates: Object.fromEntries(Object.entries(states).map(([d, s]) => [d, { state: s.state, label: s.label, id: s.id }])),
    chosen: r.select.chosen.map(hit => ({ id: hit.meta.id, role: hit.role, score: +hit.score.toFixed(4), headline: hit.meta.headline })),
    session: store.session ? store.session.toJSON() : null,
  };
}

function exportBlock(r) {
  const text = aiText(r);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return [
    h("p", { class: "note" }, "選ばれたパターンの本文と16スコアを、AIに渡せるプレーンテキストにまとめます。結果JSONは「JSONを読み込む」でこの画面に戻せます。"),
    h("div", { class: "row wrap-row" },
      h("button", { class: "btn primary", id: "btn-copy-ai", onclick: async () => toast(await copyText(text) ? "AI統合用テキストをコピーしました" : "コピーできませんでした。下のテキストを選んでコピーしてください") }, "AI統合用テキストをコピー"),
      h("button", { class: "btn", id: "btn-save-json", onclick: () => { download(`seikaku16-result-${stamp}.json`, JSON.stringify(exportJSON(r), null, 1)); toast("結果JSONを保存しました"); } }, "結果JSONを保存")),
    h("details", { class: "ai-preview" }, h("summary", null, "テキストを表示"), h("pre", { id: "ai-text" }, text)),
  ];
}
