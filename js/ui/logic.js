// ロジックタブ：閾値／7状態／発火した全パターン／選択トレース／選択の制約
import { h, mount, num, signed, table } from "./dom.js";
import { store, SAMPLES, PROFILE_SAMPLES, runSample, loadProfileSample } from "./store.js";
import { TH, DOMAINS, STATE_LABEL, describeCondition, domainStates } from "../engine.js";
import { PATTERN_BY_ID } from "../data/patterns.js";
import { ROLE_CLASS, kindLabel } from "./labels.js";

const STEP = 6.25;  // 4問平均のスコアは 6.25 刻み
const TH_ROWS = [
  ["high", "高", "この値以上を「高」とする。両方強い・明確に優勢・優勢だが他方も強い、の判定に使う", (v) => `実効 ${Math.ceil(v / STEP) * STEP}以上（4問平均 ${(Math.ceil(v / STEP) * STEP / 25 + 1).toFixed(2)}以上）`],
  ["low", "低", "この値以下を「低」とする。明確に優勢（他方が低）・両方弱い、の判定に使う", (v) => `実効 ${Math.floor(v / STEP) * STEP}以下（4問平均 ${(Math.floor(v / STEP) * STEP / 25 + 1).toFixed(2)}以下）`],
  ["diff", "優勢の左右差", "同じ領域のA・Bの差がこれ以上なら、高い側を「優勢」とする。未満なら両方強い／両方弱い／場面による", (v) => `実効 ${Math.ceil(v / STEP) * STEP}以上（4問平均の差 ${(Math.ceil(v / STEP) * STEP / 25).toFixed(2)}以上）`],
  ["domMin", "優勢側の最低値", "クロス・特殊の「優勢:〇〇」は、その傾向がこの値以上で、対の傾向より左右差ぶん大きいときに成り立つ", () => ""],
  ["duelMax", "対決で補える余裕の上限", "左右差が足りず優勢が決まらない領域は、対決で選ばれた側を優勢として扱う（余裕は 上限×強さ/100）。5件法の優勢と対決が逆なら同じだけ減点", () => "対決の強さは ±100／±50／0"],
  ["shapeN", "形状判定の傾向数", "16傾向のうちこの数以上が低い・高い・中間なら、プロファイル形状（特殊D）が成り立つ", () => "回答品質がNGのときは判定を保留"],
  ["floorRatio", "採用下限の比率", "形状以外の最上位スコア × この比率 を下回る候補は、3本目以降に採用しない", () => ""],
  ["maxContra", "矛盾枠の上限", "矛盾パターン（両方強い・ねじれ型など）は最大この本数まで", () => ""],
];

const CONSTRAINTS = [
  ["形状は1本まで", "プロファイル形状（特殊D）は人物像の「地」として1本だけ。主軸・補強とは別枠"],
  ["同じ領域の基本解釈は1本", "1つの領域から基本解釈を2本選ばない"],
  ["被覆領域の基本 ×0.5", "採用済みのクロス・特殊が覆う領域の基本解釈は有効スコアを半分にする（矛盾の基本は除外）"],
  ["包含除外", "採用済みパターンの領域集合に含まれるクロス・特殊は選ばない。同じ領域ペアのクロスも1本まで"],
  ["重なり ×0.8", "採用済みのクロス・特殊と領域が1つでも重なるクロス・特殊は ×0.8"],
  ["混雑 ×0.6", "同じ領域がすでに2本以上で使われているときは ×0.6（矛盾枠は除く）"],
  ["矛盾枠2本まで・2本目 ×0.7", "矛盾パターンは2本まで。特殊の矛盾を2本目に採るときは ×0.7"],
  ["4本目は矛盾優先", "3本選んだ時点で矛盾が0本なら、採用下限を超える矛盾候補を優先する"],
  ["採用下限 ＝ 0.35 × 最上位", "2本選んだあとは、有効スコアが下限未満なら打ち切る（最少2本・最大4本）"],
  ["役割", "主軸＝最上位の矛盾でないパターン。矛盾枠は順位に関係なく「矛盾」、形状は「地（形状）」、残りは「補強」"],
];

export function renderLogic(el) {
  const r = store.result;
  mount(el,
    h("div", { class: "page-head" },
      h("h1", null, "判定ロジック"),
      h("p", { class: "lead" }, "16の傾向スコア → 領域ごとの7状態 → 172本（156本＋弱い版16本）のパターンの充足判定 → 制約つきの貪欲選択、の順に計算しています。すべてルールだけで決まり、AIは使っていません。"),
      profilePicker(r)),
    h("section", { class: "block" }, h("h2", null, "閾値"), thresholdTable()),
    h("section", { class: "block" }, h("h2", null, "領域の7状態"), stateTable(), r ? domainStateTable(r) : null),
    r ? h("section", { class: "block" }, h("h2", null, "発火した全パターン", h("small", null, `　${r.select.hits.length}本`)), hitsTable(r)) : null,
    r ? h("section", { class: "block" }, h("h2", null, "選択トレース"), traceBlock(r)) : null,
    h("section", { class: "block" }, h("h2", null, "選択の制約"),
      h("dl", { class: "rules" }, CONSTRAINTS.map(([k, v]) => [h("dt", null, k), h("dd", null, v)]))),
  );
}

function profilePicker(r) {
  const sel = h("select", { id: "logic-pick", "aria-label": "表示するプロファイル", onchange: (e) => {
    const v = e.target.value; if (!v) return;
    const [kind, i] = v.split(":");
    if (kind === "s") runSample(+i, "logic"); else loadProfileSample(+i, "logic");
  } },
    h("option", { value: "" }, r ? `表示中：${r.source?.name ?? "あなたの回答"}` : "プロファイルを選ぶ"),
    SAMPLES.map((s, i) => h("option", { value: `s:${i}` }, s.name)),
    PROFILE_SAMPLES.map((p, i) => h("option", { value: `p:${i}` }, p.name)));
  return h("div", { class: "picker" },
    h("label", { for: "logic-pick" }, "プロファイル"), sel,
    r ? null : h("p", { class: "note" }, "診断の結果か、サンプルのプロファイルを選ぶと、閾値以外の表も計算されます。"),
    r ? referenceCheck(r) : null);
}

function referenceCheck(r) {
  const exp = r.source?.expected;
  if (!exp) return null;
  const got = r.select.chosen.map(x => x.meta.id);
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  return h("p", { class: ["refcheck", ok ? "ok" : "ng"] },
    `Python 参照実装（selector_v2.py）の選択 ${exp.join("・")} と ${ok ? "一致" : `不一致（こちらは ${got.join("・")}）`}`);
}

function thresholdTable() {
  return table(["名前", "値", "意味", "80問での実効"],
    TH_ROWS.map(([k, name, desc, eff]) => h("tr", null,
      h("td", null, h("b", null, name), h("br"), h("code", null, `TH.${k}`)), h("td", { class: "numcell" }, String(TH[k])), h("td", null, desc), h("td", null, eff(TH[k])))), { class: "wide" });
}

/** 状態の条件を A/B の一般形で（engine の describeCondition を領域1で呼んで傾向名を A/B に置き換える） */
function genericCondition(s) {
  const D = DOMAINS[1];
  const text = describeCondition({ cond: { type: "basic", d: 1, s } });
  // 形式は「領域名：状態名（条件）」。状態名にも全角括弧（例「Aが優勢（弱）」）があるので接頭辞ごと外す
  const prefix = `${D.name}：${STATE_LABEL[s]}（`;
  const inner = text.startsWith(prefix) && text.endsWith("）") ? text.slice(prefix.length, -1) : text;
  return inner.replaceAll(D.a, "A").replaceAll(D.b, "B");
}

function stateTable() {
  const order = ["1", "2", "3", "4", "5", "6", "7", "1w", "3w"];
  return table(["状態", "名前", "条件（A・Bは同じ領域の2傾向）"],
    order.map(s => h("tr", null, h("td", null, s), h("td", null, STATE_LABEL[s]), h("td", null, genericCondition(s)))));
}

function domainStateTable(r) {
  const states = domainStates(r.profile);
  return [
    h("h3", null, "このプロファイルの各領域"),
    table(["領域", "A", "B", "差（A−B）", "状態", "基本解釈", "余裕"],
      Object.keys(DOMAINS).map(d => {
        const D = DOMAINS[d], st = states[d];
        const va = r.scores[D.a], vb = r.scores[D.b];
        return h("tr", null,
          h("td", null, `${d} ${D.name}`), h("td", null, `${D.a} ${num(va)}`), h("td", null, `${D.b} ${num(vb)}`),
          h("td", { class: "numcell" }, signed(va - vb)), h("td", null, st.label), h("td", null, st.id ?? "—"), h("td", { class: "numcell" }, st.id ? signed(st.margin) : "—"));
      }), { class: "wide" }),
  ];
}

function hitsTable(r) {
  const chosenRole = Object.fromEntries(r.select.chosen.map(x => [x.meta.id, x.role]));
  const rows = [];
  r.select.hits.forEach((hit, i) => {
    const m = hit.meta, role = chosenRole[m.id];
    const detailId = `hit-detail-${i}`;
    const detail = h("tr", { class: "detail-row", id: detailId, hidden: true },
      h("td", { colspan: 8 },
        h("p", null, h("b", null, "条件："), describeCondition(m)),
        h("ul", { class: "margins" }, hit.details.map(d => h("li", { class: d.margin < 0 ? "neg" : "" }, h("span", null, d.label), h("b", null, signed(d.margin))))),
        h("p", { class: "note" }, `充足度 ＝ 0.4 ＋ 0.6 × min(1, 余裕 ${num(hit.margin)} ÷ 尺度 ${num(m.scale)}) ＝ ${hit.sat.toFixed(3)}`)));
    const toggle = h("button", { class: "expander", "aria-expanded": "false", "aria-controls": detailId, "aria-label": `${m.id} の内訳` , onclick: (e) => {
      const open = e.currentTarget.getAttribute("aria-expanded") === "true";
      e.currentTarget.setAttribute("aria-expanded", String(!open));
      detail.hidden = open;
    } }, "");
    rows.push(h("tr", { class: role ? `is-chosen role-${ROLE_CLASS[role]}` : "" },
      h("td", null, toggle),
      h("td", null, h("code", null, m.id), role ? h("span", { class: "mini-badge" }, role) : null),
      h("td", null, kindLabel(m), m.contra ? h("span", { class: "contra-tag" }, "矛盾枠") : null),
      h("td", null, PATTERN_BY_ID[m.id]?.headline ?? m.headline),
      h("td", { class: "numcell" }, num(m.importance)),
      h("td", { class: "numcell" }, signed(hit.margin)),
      h("td", { class: "numcell" }, hit.sat.toFixed(2)),
      h("td", { class: "numcell" }, hit.score.toFixed(2))));
    rows.push(detail);
  });
  return [
    h("p", { class: "note" }, "スコア ＝ 重要度 × 充足度。余裕は条件の境目からの距離（部分条件のうち最小のもの）。行の ▸ で部分条件ごとの余裕を表示します。"),
    table(["", "ID", "種別", "見出し", "重要度", "余裕", "充足度", "スコア"], rows, { class: "hits" }),
  ];
}

function traceBlock(r) {
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
