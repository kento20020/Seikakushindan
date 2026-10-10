// 三択診断タブの「ロジック」と「設問」サブ画面
import { h, num, signed, table } from "./dom.js";
import { ROLE_CLASS, kindLabel } from "./labels.js";
import { PATTERN_BY_ID } from "../data/patterns.js";
import { DOMAINS, TRAITS, STATE_LABEL, TH } from "../engine.js";
import { TH3, SHARE_SCALE, S18_TIE_N, S18_SCALE, LEFT_RATE_HIGH, LEFT_RATE_LOW, META3_BY_ID, STATE_ORDER,
  describeCondition3, patternMargin3, wMargin, tieMargin, CONFLICT_GAP, CONTRA_ALIGN_REASON, contraExcluded3 } from "../engine3.js";
import { STAGES3, MAX_SWAPS, SRC_LABEL, ROUND_USE, X_AMBIG_LOW, X_AMBIG_HIGH, X_MIN_M, bankFor } from "../adaptive3.js";
import { THREE_VERSIONS, versionOf } from "../three_version.js";
import { store3, runSample3, runProfile3, SAMPLES3, PROFILE_SAMPLES3 } from "./three_store.js";

const HI = TH3.high, LO = TH3.low + 1;

/** 設問の版のバッジ（質問・結果・ロジック・設問の画面） */
export function verBadge(v) {
  const V = versionOf(v);
  return h("span", { class: ["t3-ver", `t3-ver-${V.id}`], "data-qv": V.id, title: `設問の版 ${V.label}（${V.bankVersion}）` }, `設問 ${V.id}`);
}

// ================================================================ ロジック
const TH3_ROWS = [
  ["high", "高", `level がこの値以上なら「高」。基本4問の X なら 3勝（75）以上`],
  ["low", "低", `level が ${LO}（＝low＋1）以下なら「低」。基本4問なら 1勝（25）以下。中は ${LO}以上${HI}未満`],
  ["domShare", "優勢の取り分", "W で片側を選んだ割合がこれ以上、かつ差が domDiff 以上なら、その側が左右で「優勢」"],
  ["domDiff", "優勢の差", "W の A側とB側の数の差。2:2・3:2 は拮抗、3:1・4:2 は優勢"],
  ["levelFloor", "優勢に要る強さ", "クロス・特殊の「優勢:〇〇」は、左右で優勢 かつ level がこの値以上（基本4問で2勝以上）"],
  ["tieScale", "拮抗の刻み", "差が2に届かないときの余裕：(差 − 2) × この値。2:2 → −25、3:2 → −12.5"],
];
const CONSTRAINTS3 = [
  ["5択版と同じ選択", "主軸1＋補強1〜2＋矛盾0〜1（2〜4本）。engine.js の select に評価関数（evaluateAll3）を渡して共用"],
  ["形状は1本まで", "特殊D（S18〜S20）は「地」として1本だけ。S16・S17 は三択版では判定しない"],
  ["同じ領域の基本解釈は1本", "被覆領域の基本 ×0.5、包含除外、重なり ×0.8、混雑 ×0.6"],
  ["矛盾枠2本まで", "2本目の特殊の矛盾 ×0.7、3本選んだ時点で矛盾0本なら4本目は矛盾候補を優先"],
  [`採用下限 ＝ ${TH.floorRatio} × 最上位`, "2本選んだあとは、有効スコアが下限未満なら打ち切る"],
];

export function profilePicker3(r) {
  const sel = h("select", { id: "t3-logic-pick", "aria-label": "表示するプロファイル", onchange: (e) => {
    const v = e.target.value; if (!v) return;
    const [kind, i] = v.split(":");
    if (kind === "s") runSample3(+i, "logic"); else runProfile3(+i, "logic");
  } },
    h("option", { value: "" }, r ? `表示中：${r.source?.name ?? "あなたの回答"}` : "プロファイルを選ぶ"),
    SAMPLES3.map((s, i) => h("option", { value: `s:${i}` }, s.label)),
    PROFILE_SAMPLES3.map((p, i) => h("option", { value: `p:${i}` }, p.label)));
  return h("div", { class: "picker" }, h("label", { for: "t3-logic-pick" }, "プロファイル"), sel,
    r ? null : h("p", { class: "note" }, "三択で答えるか、サンプルを選ぶと、閾値以外の表も計算されます。"));
}

export function renderLogic3() {
  const r = store3.result;
  const qv = r?.version ?? store3.qv, V = versionOf(qv);
  return [
    h("div", { class: "page-head" },
      h("h1", null, "三択版の判定ロジック", verBadge(qv)),
      h("p", { class: "lead" }, "W（同じ場面の左右）で領域内の優勢を、X（別の領域の行動文どうしの比較）で傾向ごとの強さ（0〜100）を出し、172本のパターンの条件を三択用に読み替えて充足を判定します。選択のルールは5択版と同じです。仕様は docs/three-choice-logic.md。",
        `この画面は「${V.label}」のロジックです${r ? "（表示中の結果の版）" : "（開始画面で選んでいる版）"}。`),
      profilePicker3(r)),
    h("section", { class: "block", id: "t3-logic-versions" }, h("h2", null, "設問の版（v1／v2）の違い"), versionTable(qv), V.logic.lowConf ? lowConfBlock(r) : null),
    h("section", { class: "block" }, h("h2", null, "集計"), aggregateBlock()),
    h("section", { class: "block" }, h("h2", null, "閾値（TH3）"),
      table(["名前", "値", "意味"], TH3_ROWS.map(([k, name, desc]) => h("tr", null,
        h("td", null, h("b", null, name), h("br"), h("code", null, `TH3.${k}`)), h("td", { class: "numcell" }, String(TH3[k])), h("td", null, desc))), { class: "wide" })),
    h("section", { class: "block" }, h("h2", null, "左右（W）の優勢の余裕"), wMarginBlock()),
    h("section", { class: "block" }, h("h2", null, "領域の7状態"), stateTable3(), r ? domainStateTable3(r) : null),
    h("section", { class: "block" }, h("h2", null, "クロス・特殊・形状"), rulesBlock()),
    r ? h("section", { class: "block" }, h("h2", null, "発火した全パターン", h("small", null, `　${r.select.hits.length}本`)), hitsTable3(r)) : null,
    r ? h("section", { class: "block" }, h("h2", null, "選択トレース"), traceBlock3(r)) : null,
    h("section", { class: "block" }, h("h2", null, "選択の制約"),
      h("dl", { class: "rules" }, [...CONSTRAINTS3, ...(V.logic.lowConf ? CONSTRAINTS3_V2 : [])].map(([k, v]) => [h("dt", null, k), h("dd", null, v)]))),
  ];
}

const CONSTRAINTS3_V2 = [
  ["確度低 ×0.8（v2）", `確度低の領域（優勢（弱）か、W と X の向きが逆）を含むパターンはスコア ×${THREE_VERSIONS.v2.logic.lowConfFactor}。形状（S16〜S20）は対象外。選択の前に掛ける`],
  ["矛盾枠の向き（v2）", `矛盾枠のクロス・特殊は、条件の「優勢:t」の領域で level(t) ＞ level(反対側) のときだけ成立（同じ値は不成立。余裕 −1「${CONTRA_ALIGN_REASON}」）。基本の状態5（両方強い）は対象外`],
];

/** v1／v2 の違いの表（docs/three-choice-logic.md の表と同じ内容） */
function versionTable(qv) {
  const V1 = THREE_VERSIONS.v1, V2 = THREE_VERSIONS.v2;
  const rows = [
    ["設問バンク", `questions3.js（${V1.bankVersion}）`, `questions3_v2.js（${V2.bankVersion}）。W 10問を書き換え、X の組を4か所入れ替え（「設問」の「v1 からの変更」）`],
    ["W追加の条件", "左右が拮抗した領域だけ", "拮抗 ＞ W と X の向きが逆 ＞ 優勢（弱）の順。同じ種類の中は領域番号順"],
    ["X追加の条件", `level ${X_AMBIG_LOW}〜${X_AMBIG_HIGH} か回答数${X_MIN_M}未満`, "同じ＋向きが逆の領域の両傾向（最優先）"],
    ["追加の上限", `W ${V1.caps.wExtra}・X ${V1.caps.xExtra}（領域・傾向あたり${V1.caps.wPerDomain}）`, `W ${V2.caps.wExtra}・X ${V2.caps.xExtra}（同${V2.caps.wPerDomain}）`],
    ["確度低の扱い", "なし", `確度低の領域を含むパターン（形状 S16〜S20 を除く）のスコア ×${V2.logic.lowConfFactor}`],
    ["矛盾枠", "条件どおり", "関係する領域で「優勢側の level ＞ 反対側の level」のときだけ"],
    ["場面例", "本文どおり", "js/data/scenes_v2.js の差し替え（極端な場面を日常的に）"],
    ["練習カード", "なし", "1問目の前に採点しない練習カード"],
  ];
  return [
    table(["項目", "v1", "v2"], rows.map(([k, a, b]) => h("tr", null, h("th", { scope: "row" }, k),
      h("td", { class: qv === "v1" ? "t3-ver-now" : null }, a), h("td", { class: qv === "v2" ? "t3-ver-now" : null }, b))), { class: "wide t3-ver-table" }),
    h("p", { class: "note" }, "既定の版は js/three_version.js の DEFAULT_THREE_VERSION。URL に ?qv=v1 か ?qv=v2 を付けると、その版で始められます（途中再開は始めた版のまま）。"),
  ];
}

/** 確度低（v2）の定義と、表示中のプロファイルでの該当（確度低の領域・向きの条件で外れた矛盾枠） */
function lowConfBlock(r) {
  const defs = h("dl", { class: "rules" },
    h("dt", null, "向きが逆（conflict）"), h("dd", null, `W で傾向 t が優勢（wMargin(t) ≥ 0）なのに、level(反対側) − level(t) ≥ ${CONFLICT_GAP}`),
    h("dt", null, "優勢（弱）（weak）"), h("dd", null, `W で t が優勢で、level(t) < ${HI}（状態 1w／3w）`),
    h("dt", null, "確度低（lowConf）"), h("dd", null, "最終結果で weak か conflict が残った領域。結果・ロジック・AI 用テキストに「確度低」と出し、その領域を含むパターン（形状を除く）のスコアを ×0.8"),
    h("dt", null, "矛盾枠の向き"), h("dd", null, `矛盾枠のクロス・特殊は、条件の各「優勢:t」の領域で level(t) ＞ level(反対側)。満たさなければ余裕 −1（${CONTRA_ALIGN_REASON}）`));
  if (!r) return [h("h3", null, "確度低（v2）"), defs];
  const lowDs = Object.keys(r.lowConf || {});
  const excluded = contraExcluded3(r.profile3);
  return [
    h("h3", null, "確度低（v2）"), defs,
    h("h3", null, "このプロファイルの確度低", h("small", null, lowDs.length ? `　${lowDs.length}領域` : "　なし")),
    lowDs.length ? table(["領域", "理由", "内容"], lowDs.map(d => h("tr", { "data-domain": d },
      h("td", null, `${d} ${DOMAINS[d].name}`), h("td", null, r.lowConf[d].labels.join("・")), h("td", null, r.lowConf[d].text))), { class: "wide t3-lowconf-table" }) : null,
    h("h3", null, "向きの条件で外れた矛盾枠", h("small", null, excluded.length ? `　${excluded.length}本` : "　なし")),
    excluded.length ? h("ul", { class: "margins t3-contra-out" }, excluded.map(x => h("li", { class: "neg" },
      h("span", null, h("code", null, x.meta.id), `　${PATTERN_BY_ID[x.meta.id]?.headline ?? ""}：`, x.bad.map(b => `${b.t} ${num(b.L)} ≤ ${b.other} ${num(b.Lo)}`).join("、")), h("b", null, "−1")))) :
      h("p", { class: "note" }, "v1 のロジックなら発火する矛盾枠のうち、向きの条件で外れたものはありません。"),
  ];
}

function aggregateBlock() {
  return h("dl", { class: "rules" },
    h("dt", null, "W：領域 d の左右"), h("dd", null, "a ＝ A側を選んだ数、b ＝ B側を選んだ数、n ＝ a＋b。「答えずに進む」と差し替え前の設問は数えない。取り分 ＝ 片側の数 ÷ n"),
    h("dt", null, "X：傾向 t の強さ"), h("dd", null, "level ＝ 選ばれた数 ÷ t を含む比較に答えた数 × 100（答えた数が0なら50）。基本4問なら 0/25/50/75/100、追加後は5分の1・6分の1刻み"),
    h("dt", null, "X は相対評価"), h("dd", null, "自分の中でどの傾向が強いかの順位なので、全員の平均が50付近に固定される。黙従（全部に同意）の偏りは消えるが、「全体的に高い／低い」は測れない"),
    h("dt", null, "回答の様子"), h("dd", null, `左を選んだ割合が ${LEFT_RATE_HIGH} 以上か ${LEFT_RATE_LOW} 以下なら位置の偏りとして注意を出す（判定には使わない）`));
}

function wMarginBlock() {
  const ex = [[2, 2], [3, 2], [3, 1], [4, 2], [4, 1], [4, 0], [5, 1], [6, 0], [3, 3]];
  const D = DOMAINS[1];
  const rows = ex.map(([a, b]) => {
    const p = { levels: {}, w: { 1: { a, b, n: a + b } } };
    const m = wMargin(p, 1, D.a), t = tieMargin(p, 1);
    return h("tr", null, h("td", null, `${a}:${b}`), h("td", { class: "numcell" }, `${Math.round(a / (a + b) * 100)}%`),
      h("td", { class: "numcell" }, signed(m)), h("td", { class: "numcell" }, signed(t)), h("td", null, m >= 0 ? "A側が優勢" : "拮抗"));
  });
  return [
    h("p", { class: "note" }, `n<2 は未測定（−100）。mW ＝ (取り分 − ${TH3.domShare}) × ${SHARE_SCALE}。差が ${TH3.domDiff} 未満なら mW ＝ min(mW, (差 − ${TH3.domDiff}) × ${TH3.tieScale})。拮抗の余裕 ＝ −max(mWA, mWB)。クロス・特殊の「優勢:t」＝ min(mW, level − ${TH3.levelFloor})。`),
    table(["A:B", "取り分", "A側の優勢の余裕", "拮抗の余裕", "判定"], rows),
  ];
}

function genericCondition3(s) {
  const D = DOMAINS[1];
  const text = describeCondition3({ cond: { type: "basic", d: 1, s } });
  const prefix = `${D.name}：${STATE_LABEL[s]}（`;
  const inner = text.startsWith(prefix) && text.endsWith("）") ? text.slice(prefix.length, -1) : text;
  return inner.replaceAll(D.a, "A").replaceAll(D.b, "B");
}

function stateTable3() {
  return [
    h("p", { class: "note" }, `LA・LB は同じ領域の2傾向の level。中 ＝ ${LO}以上${HI}未満（仕様の式は 66 − L。6分の1刻みの 66.7 が「高」にも「中」にも入らない隙間をなくすため、${HI}未満は中として扱う）。`),
    table(["状態", "名前", "条件（A・Bは同じ領域の2傾向）"],
      STATE_ORDER.map(s => h("tr", null, h("td", null, s), h("td", null, STATE_LABEL[s]), h("td", null, genericCondition3(s))))),
  ];
}

function domainStateTable3(r) {
  return [
    h("h3", null, "このプロファイルの各領域"),
    h("p", { class: "note" }, "各状態の余裕（≥0 で成立）。成立したうち余裕が最大の状態を採ります（太字）。"),
    table(["領域", "A:B", "mWA", "mWB", "拮抗", "LA", "LB", ...STATE_ORDER, "状態"],
      Object.keys(DOMAINS).map(d => {
        const D = DOMAINS[d], st = r.states[d];
        return h("tr", { "data-domain": d },
          h("td", null, `${d} ${D.name}`), h("td", { class: "numcell" }, `${st.a}:${st.b}`),
          h("td", { class: "numcell" }, signed(st.mWA)), h("td", { class: "numcell" }, signed(st.mWB)), h("td", { class: "numcell" }, signed(st.tie)),
          h("td", { class: "numcell" }, num(st.LA)), h("td", { class: "numcell" }, num(st.LB)),
          STATE_ORDER.map(s => h("td", { class: ["numcell", st.margins[s] < 0 && "t3-neg", st.state === s && "t3-best"] }, signed(st.margins[s]))),
          h("td", null, st.label, st.check ? h("span", { class: "flag flag-warn t3-inline" }, "要確認") : null));
      }), { class: "wide t3-states-table" }),
  ];
}

function rulesBlock() {
  return h("dl", { class: "rules" },
    h("dt", null, "クロス X??-q"), h("dd", null, "min(優勢:ta, 優勢:tb)。優勢:t ＝ min(左右の優勢の余裕, level − 37.5)。5択版の「対決で補完」は無い（W 自体が対決なので）"),
    h("dt", null, "特殊A（優勢×3）"), h("dd", null, "3つの「優勢:t」の最小値"),
    h("dt", null, "特殊B（ねじれ）"), h("dd", null, `高:t ＝ min(level − ${HI}, level − 対の level)、中:t ＝ min(level − ${LO}, ${HI - 1} − level)、優勢:t は上と同じ`),
    h("dt", null, "特殊C（両方強いの重なり）"), h("dd", null, `高 4つ（level − ${HI}）に加えて、両領域とも左右が拮抗（拮抗の余裕 ≥ 0）`),
    h("dt", null, "S16・S17"), h("dd", null, "常に不成立（余裕 −1、理由「相対評価のため全体水準は測れない」）"),
    h("dt", null, "S18 相手次第で別人"), h("dd", null, `左右が拮抗した領域の数 − ${S18_TIE_N}（8領域中${S18_TIE_N}領域以上で成立）。尺度 ${S18_SCALE}`),
    h("dt", null, "S19・S20"), h("dd", null, "全領域で A側／B側の「優勢:t」の最小値"),
    h("dt", null, "重要度・尺度・矛盾枠"), h("dd", null, "patterns_meta.js の値をそのまま使う（S18 の尺度だけ 2）"));
}

function hitsTable3(r) {
  const chosenRole = Object.fromEntries(r.select.chosen.map(x => [x.meta.id, x.role]));
  const rows = [];
  r.select.hits.forEach((hit, i) => {
    const m = hit.meta, role = chosenRole[m.id];
    const detailId = `t3-hit-detail-${i}`;
    const detail = h("tr", { class: "detail-row", id: detailId, hidden: true },
      h("td", { colspan: 8 },
        h("p", null, h("b", null, "条件："), describeCondition3(m)),
        h("ul", { class: "margins" }, hit.details.map(d => h("li", { class: d.factor ? "t3-factor" : d.margin < 0 ? "neg" : "" }, h("span", null, d.label), h("b", null, d.factor ? `×${d.factor}` : signed(d.margin))))),
        h("p", { class: "note" }, `充足度 ＝ 0.4 ＋ 0.6 × min(1, 余裕 ${num(hit.margin)} ÷ 尺度 ${num(m.scale)}) ＝ ${hit.sat.toFixed(3)}` +
          (hit.factor ? `。スコア ＝ 重要度 ${num(m.importance)} × 充足度 ＝ ${hit.baseScore.toFixed(2)}、確度低で ×${hit.factor} ＝ ${hit.score.toFixed(2)}` : ""))));
    const toggle = h("button", { class: "expander", "aria-expanded": "false", "aria-controls": detailId, "aria-label": `${m.id} の内訳`, onclick: (e) => {
      const open = e.currentTarget.getAttribute("aria-expanded") === "true";
      e.currentTarget.setAttribute("aria-expanded", String(!open));
      detail.hidden = open;
    } });
    rows.push(h("tr", { class: role ? `is-chosen role-${ROLE_CLASS[role]}` : "" },
      h("td", null, toggle),
      h("td", null, h("code", null, m.id), role ? h("span", { class: "mini-badge" }, role) : null),
      h("td", null, kindLabel(m), m.contra ? h("span", { class: "contra-tag" }, "矛盾枠") : null),
      h("td", null, PATTERN_BY_ID[m.id]?.headline ?? m.headline),
      h("td", { class: "numcell" }, num(m.importance)),
      h("td", { class: "numcell" }, signed(hit.margin)),
      h("td", { class: "numcell" }, hit.sat.toFixed(2)),
      h("td", { class: "numcell" }, hit.score.toFixed(2), hit.factor ? h("small", { class: "t3-lowconf-mark", title: `確度低の領域を含むため ×${hit.factor}（${hit.baseScore.toFixed(2)} → ${hit.score.toFixed(2)}）` }, ` ×${hit.factor}`) : null)));
    rows.push(detail);
  });
  const notJudged = ["S16", "S17"].map(id => { const details = []; patternMargin3(META3_BY_ID[id], r.profile3, details); return [id, details[0]]; });
  return [
    h("p", { class: "note" }, "スコア ＝ 重要度 × 充足度。余裕は部分条件のうち最小のもの。行の ▸ で部分条件ごとの余裕を表示します。"),
    table(["", "ID", "種別", "見出し", "重要度", "余裕", "充足度", "スコア"], rows, { class: "hits" }),
    h("h3", null, "判定しないパターン"),
    h("ul", { class: "margins t3-notjudged" }, notJudged.map(([id, d]) => h("li", { class: "neg" },
      h("span", null, h("code", null, id), `　${PATTERN_BY_ID[id]?.headline ?? ""}：${d.label}`), h("b", null, signed(d.margin))))),
  ];
}

function traceBlock3(r) {
  const { trace, floor, top } = r.select;
  return [
    h("p", { class: "note" }, `形状以外の最上位スコア ${top.toFixed(2)} × ${TH.floorRatio} ＝ 採用下限 ${floor.toFixed(2)}。各ステップで候補（スコア上位12本）の有効スコアを計算し、最大のものを採用します。灰色は制約で除外された候補です。`),
    trace.map(step => h("div", { class: "tstep" },
      h("h3", null, `ステップ${step.k}`,
        step.chosen ? h("span", { class: "tchosen" }, `採用：${step.chosen}（有効 ${step.chosenEff.toFixed(2)}）`) : h("span", { class: "tchosen none" }, "採用なし")),
      step.note ? h("p", { class: "tnote" }, step.note.trim()) : null,
      table(["ID", "見出し", "スコア", "有効スコア", "理由"],
        step.candidates.map(c => h("tr", { class: [c.eff === null && "excluded", c.id === step.chosen && "picked", c.eff !== null && c.eff < floor && "below"] },
          h("td", null, h("code", null, c.id)),
          h("td", null, PATTERN_BY_ID[c.id]?.headline ?? ""),
          h("td", { class: "numcell" }, c.score.toFixed(2)),
          h("td", { class: "numcell" }, c.eff === null ? "除外" : c.eff.toFixed(2)),
          h("td", null, c.reasons.join("、") || (c.eff !== null && c.eff < floor ? "採用下限未満" : "")))), { class: "trace" }))),
  ];
}

// ================================================================ 設問
let filterValue = "all";

export function renderQuestions3() {
  const hist = store3.session ? store3.session.history() : {};
  // 表示する設問バンク：セッションの版（無ければ開始画面で選んでいる版）
  const qv = store3.session?.config?.version ?? store3.qv;
  const B = bankFor(qv), V = versionOf(qv), caps = V.caps;
  const { W_ITEMS, X_ITEMS, W_BASE, W_POOL } = B;
  const QUESTIONS3 = B.bank;
  const wRows = [];
  for (const d of Object.keys(DOMAINS)) {
    [...W_BASE[d], ...W_POOL[d]].forEach((id, i) => wRows.push(wRow(W_ITEMS[id], hist[id], i === 0)));
  }
  const xRows = Object.values(X_ITEMS).map(q => xRow(q, hist[q.id]));
  const filter = h("select", { id: "t3-q-filter", "aria-label": "表示する設問", onchange: (e) => { filterValue = e.target.value; applyFilter(e.target.closest(".t3-body")); } },
    [["all", "すべての設問"], ["answered", "回答した設問"], ["swapped", "差し替えた設問"], ["skipped", "答えずに進んだ設問"], ["extra", "追加で聞いた設問"]]
      .map(([v, t]) => h("option", { value: v, selected: v === filterValue }, t)));
  const nodes = [
    h("div", { class: "page-head" },
      h("h1", null, "三択版の設問", verBadge(qv)),
      h("p", { class: "lead" }, `設問の版 ${V.label}（${V.bankVersion}）${store3.session ? "＝表示中のセッションの版" : "＝開始画面で選んでいる版"}。W は各領域6場面（基本4＋予備2）＝48組。差し替え・追加には5択版の対決 Q73〜Q80（2つの言い換え）と D1x〜D8x も使います（A行動／B行動の向きに揃えて表示）。X は16傾向×4本の行動文を xRounds の組み合わせで比べます。`)),
    h("section", { class: "block" }, h("h2", null, "出し方と差し替え"),
      h("dl", { class: "rules" },
        h("dt", null, "段階"), h("dd", null, `${STAGES3.join(" → ")}。W基本32・X基本32、W追加は領域あたり${caps.wPerDomain}・全体${caps.wExtra}、X追加は傾向あたり${caps.xPerTrait}・全体${caps.xExtra}（最大${64 + caps.wExtra + caps.xExtra}問）`),
        h("dt", null, "左右の並び"), h("dd", null, "W は A行動を左に出す枠と右に出す枠が各領域で半々（領域＋枠番号が奇数なら B行動が左）。X は組の左右そのまま"),
        h("dt", null, "問題を変える"), h("dd", null, `1枠${MAX_SWAPS}回まで。W：未使用の予備 → 対決の言い換え（a・b）→ 追加対決 D?x。X：ラウンド7 → 未使用のラウンド5〜6（同じ傾向を含む組）。使い切ったら「答えずに進む」`),
        h("dt", null, "W追加"), h("dd", null, V.logic.wExtra.length > 1
          ? `左右が拮抗した領域（差<${TH3.domDiff} または 取り分<${TH3.domShare}）→ W と X の向きが逆の領域（W で優勢なのに反対側の level が${CONFLICT_GAP}以上高い）→ 優勢（弱）の領域（優勢側の level が${HI}未満）の順に、予備 → 対決の順で。1問ごとに再集計し、どれにも当たらなくなった領域は打ち切る`
          : `左右が拮抗した領域（差<${TH3.domDiff} または 取り分<${TH3.domShare}）に、予備 → 対決の順。1問ごとに再集計し、優勢が決まった領域は打ち切る`),
        h("dt", null, "X追加"), h("dd", null, `level が ${X_AMBIG_LOW}〜${X_AMBIG_HIGH}、または比較の回答数が${X_MIN_M}未満の傾向を含む、ラウンド5〜6の組。左右の優勢が決まった領域の傾向を優先` +
          (V.logic.xExtraConflict ? "。v2 は W と X の向きが逆の領域の両傾向も足し、それを最優先にする" : "")))),
    QUESTIONS3.changesFromV1 ? changesBlock(QUESTIONS3.changesFromV1, B) : null,
    h("section", { class: "block" },
      h("h2", null, "設問一覧"),
      h("div", { class: "picker" }, h("label", { for: "t3-q-filter" }, "絞り込み"), filter,
        store3.session ? null : h("p", { class: "note" }, "三択で答えるかサンプルを読み込むと、回答履歴の列に「差し替え」「スキップ」「追加」の印が入ります。")),
      h("h3", null, "W（同じ場面の左右）", h("small", null, `　48組＋対決由来${Object.keys(W_ITEMS).length - 48}`)),
      table(["設問", "区分", "領域", "場面", "A行動", "B行動", "回答履歴"], wRows, { class: "t3-qtable t3-wtable" }),
      h("h3", null, "X（比較）の組", h("small", null, "　7ラウンド×8組")),
      table(["設問", "ラウンド", "左の行動文", "右の行動文", "回答履歴"], xRows, { class: "t3-qtable t3-xtable" })),
    h("section", { class: "block" }, h("h2", null, "X の行動文（16傾向×4本）"),
      h("p", { class: "note" }, "ラウンド r で傾向 t が使う行動文は (r − 1) を4で割った余り＋1 番目。5択版の表現B（行動形）を基本に、Q19・Q32・Q40・Q61・Q67 の文は書き換えています。"),
      table(["領域", "傾向", "行動文1", "行動文2", "行動文3", "行動文4"],
        TRAITS.map((t, i) => {
          const d = Math.floor(i / 2) + 1, first = i % 2 === 0;
          return h("tr", { class: first ? "grp-first" : "" },
            first ? h("td", { rowspan: 2 }, `${d} ${DOMAINS[d].name}`) : null,
            h("td", null, h("b", null, t)), QUESTIONS3.statements[t].map(s => h("td", { class: "t3-stmt" }, s)));
        }), { class: "t3-stmts" })),
    h("section", { class: "block" }, h("h2", null, "X の組み合わせ（xRounds）"),
      h("p", { class: "note" }, "8領域の総当たり7ラウンド。各ラウンドは16傾向を8組に分け、同じ領域どうしは組まない。ラウンド1〜4＝基本、5〜6＝追加、7＝差し替え用。"),
      table(["ラウンド", "用途", ...QUESTIONS3.xRounds[0].map((_, i) => `組${i + 1}`)],
        QUESTIONS3.xRounds.map((round, ri) => h("tr", null,
          h("td", null, `R${ri + 1}`), h("td", null, ROUND_USE[ri + 1]),
          round.map((_, pi) => { const q = X_ITEMS[`X${ri + 1}-${pi + 1}`]; return h("td", { class: "t3-pairc" }, h("code", null, q.id), h("br"), `${q.left}／${q.right}`); }))),
        { class: "t3-rounds" })),
  ];
  queueMicrotask(() => { const el = document.querySelector("#view-three .t3-body"); if (el) applyFilter(el); });
  return nodes;
}

/** v2 の設問バンクの「v1 からの変更」（changesFromV1）。W は書き換え前 → 後、X は組の入れ替え（前の組は v1 の xRounds から） */
function changesBlock(ch, B) {
  const B1 = bankFor("v1");
  const wSide = (x, D) => [h("div", { class: "t3-chg-stem" }, x.stem), h("div", null, h("span", { class: "dv-a" }, `${D.a}：`), x.a), h("div", null, h("span", { class: "dv-b" }, `${D.b}：`), x.b)];
  const wRows = (ch.w || []).map(c => {
    const D = DOMAINS[B.W_ITEMS[c.id]?.domain ?? +c.id.slice(1, 2)];
    return h("tr", { "data-id": c.id },
      h("td", null, h("code", null, c.id)),
      h("td", { class: "wtext t3-chg-before" }, wSide(c.before, D)),
      h("td", { class: "wtext t3-chg-after" }, wSide(c.after, D)),
      h("td", { class: "wtext" }, c.why));
  });
  const pairs = (X, ids) => ids.map(id => X[id] ? h("div", null, h("code", null, id), ` ${X[id].left}／${X[id].right}`) : null);
  const xRows = (ch.x || []).map(c => h("tr", { "data-id": c.ids.join(",") },
    h("td", null, c.ids.map(id => h("code", { class: "t3-chg-id" }, id))),
    h("td", { class: "wtext t3-chg-before" }, pairs(B1.X_ITEMS, c.ids)),
    h("td", { class: "wtext t3-chg-after" }, pairs(B.X_ITEMS, c.ids)),
    h("td", { class: "wtext" }, c.why)));
  return h("section", { class: "block", id: "t3-changes" }, h("h2", null, "v1 からの変更", h("small", null, `　W ${wRows.length}問・X ${xRows.length}か所`)),
    h("p", { class: "note" }, ch.note || ""),
    h("h3", null, "W（場面・A行動・B行動の書き換え）"),
    table(["設問", "v1（前）", "v2（後）", "理由"], wRows, { class: "wide t3-qtable-plain t3-changes-w" }),
    h("h3", null, "X（組の入れ替え）"),
    table(["設問", "v1 の組", "v2 の組", "理由"], xRows, { class: "wide t3-qtable-plain t3-changes-x" }));
}

function applyFilter(el) {
  if (!el) return;
  for (const tr of el.querySelectorAll("table.t3-qtable tbody tr")) {
    const d = tr.dataset;
    tr.hidden = !(filterValue === "all" || d[filterValue] === "1");
  }
}

function histCell(hist) {
  if (!hist?.length) return "—";
  return hist.map(e => {
    const stage = STAGES3[e.stage - 1];
    const text = e.status === "answered" ? `${stage}：${e.picked}（${e.side === "left" ? "左" : "右"}）`
      : e.status === "swapped" ? `${stage}：差し替え前` : e.status === "skipped" ? `${stage}：答えず` : `${stage}：表示中`;
    return h("span", { class: ["hist", e.extra && "hist-extra", `t3-h-${e.status}`] }, text,
      e.status === "swapped" ? h("small", null, "差し替え") : null,
      e.status === "skipped" ? h("small", null, "スキップ") : null,
      e.extra ? h("small", null, "追加") : null);
  });
}
const flags = (hist) => ({
  answered: hist?.some(e => e.status === "answered") ? "1" : "0",
  swapped: hist?.some(e => e.status === "swapped") ? "1" : "0",
  skipped: hist?.some(e => e.status === "skipped") ? "1" : "0",
  extra: hist?.some(e => e.extra) ? "1" : "0",
});

function wRow(q, hist, first) {
  const D = DOMAINS[q.domain];
  return h("tr", { dataset: flags(hist), id: `t3-q-${q.id}`, class: first ? "grp-first" : "" },
    h("td", null, h("code", null, q.id)),
    h("td", null, SRC_LABEL[q.src]),
    h("td", null, `${q.domain} ${D.name}`),
    h("td", { class: "wtext" }, q.stem),
    h("td", { class: "wtext" }, h("span", { class: "dv-a" }, `${D.a}：`), q.a),
    h("td", { class: "wtext" }, h("span", { class: "dv-b" }, `${D.b}：`), q.b),
    h("td", null, histCell(hist)));
}

function xRow(q, hist) {
  return h("tr", { dataset: flags(hist), id: `t3-q-${q.id}`, class: q.index === 0 ? "grp-first" : "" },
    h("td", null, h("code", null, q.id)),
    h("td", null, `R${q.round}・${ROUND_USE[q.round]}`),
    h("td", { class: "wtext" }, h("b", null, `${q.left}：`), q.leftText),
    h("td", { class: "wtext" }, h("b", null, `${q.right}：`), q.rightText),
    h("td", null, histCell(hist)));
}
