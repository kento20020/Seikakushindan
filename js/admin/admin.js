// テスト協力モードの集計ページ（admin.html）。貼り付けたテキストはこのブラウザの中だけで処理し、どこにも送らない。
import { $, copyText, downloadText, store } from "./dom.js";
import { parseInput, analyzeParsed } from "./aggregate.js";
import { rescoreAll } from "./rescore.js";
import { participantCsvRows, itemCsvRows, toCsv, buildMarkdown } from "./export.js";
import * as V from "./views.js";

const LS_KEY = "seikaku16:fb-admin:text:v1";
const SAMPLE_URL = "./tests/fixtures/fb_sample_all.txt";    // 相対パス（GitHub Pages のサブパスでも動く）
const FB_URL = "https://kento20020.github.io/Seikakushindan/?fb=1#three";

const S = {
  parsed: null, model: null, rescore: null, includeRetests: false,
  items: { sort: { key: "id", dir: 1 }, onlyReview: false, kind: "all", unseen: false },
};

const ta = $("#fb-text"), info = $("#fb-info"), statusEl = $("#status"), results = $("#results"), secnav = $("#secnav");

// ---------------------------------------------------------------- 状態表示
let statusTimer = null;
function say(text, kind = "info") {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
  clearTimeout(statusTimer);
}

function updateInfo() {
  const text = ta.value;
  const n = (text.match(/16DFB1\|/g) || []).length;
  info.textContent = text.trim() ? `${text.length.toLocaleString("ja-JP")}文字／機械用の行（16DFB1|…）を ${n}件 検出` : "まだ何も貼られていません";
  $("#btn-run").disabled = !text.trim();
}

let saveTimer = null;
function onInput() {
  updateInfo();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set(LS_KEY, ta.value), 300);
}

// ---------------------------------------------------------------- 集計して描く
async function copyAndReport(text, id) {
  const ok = await copyText(text);
  const el = document.getElementById(`copied-${id}`);
  if (el) { el.textContent = ok ? "コピーしました" : "コピーできませんでした。下の欄を選んでコピーしてください"; el.dataset.ok = ok ? "1" : "0"; setTimeout(() => { el.textContent = ""; }, 4000); }
  return ok;
}

function outputBlocks() {
  const m = S.model;
  const common = { onCopy: copyAndReport, onDownload: downloadText };
  return [
    V.outputBlock({ id: "participants", title: "参加者×項目の CSV", desc: "1行＝1セッション（再検査も含め、集計対象かどうかを列で示す）。領域ごとの状態・W・self・act と照合結果、ブラインド、カード、振り返りを横に並べています。", text: toCsv(participantCsvRows(m)), filename: "fb_participants.csv", bom: true, type: "text/csv", ...common }),
    V.outputBlock({ id: "items", title: "設問ごとの CSV", desc: "出題された設問ごとに、表示・選択・差し替え・スキップ・回答時間・一言・振り返り・見直し理由。", text: toCsv(itemCsvRows(m)), filename: "fb_items.csv", bom: true, type: "text/csv", ...common }),
    V.outputBlock({ id: "md", title: "Claude に貼る用の要約（Markdown）", desc: "上の2〜7を表と箇条書きにまとめ、設問やパターンの文を引用してあります。そのままチャットに貼れます。", text: buildMarkdown(m, { rescore: S.rescore }), filename: "fb_summary.md", bom: false, type: "text/markdown", rows: 10, ...common }),
  ];
}

function render() {
  const m = S.model;
  const y = window.scrollY;
  results.replaceChildren(
    V.renderLoad(m, { includeRetests: S.includeRetests, onToggleRetests: (on) => { S.includeRetests = on; recompute(); render(); document.getElementById("inc-retests")?.focus(); } }),
    V.renderParticipants(m),
    V.renderDomain(m),
    V.renderBlind(m),
    V.renderCards(m),
    V.renderItemsSection(m, S.items),
    V.renderReview(m),
    V.renderRescore(S.rescore),
    V.renderOutput(outputBlocks()),
  );
  results.hidden = false;
  secnav.hidden = false;
  window.scrollTo(0, y);
}

function recompute() {
  S.model = analyzeParsed(S.parsed, { includeRetests: S.includeRetests });
  S.rescore = rescoreAll(S.model.sessions);
}

function run({ scroll = true } = {}) {
  const text = ta.value;
  if (!text.trim()) { say("テキストが空です。送られてきた本文を貼り付けてください。", "ng"); return; }
  store.set(LS_KEY, text);
  S.parsed = parseInput(text);
  recompute();
  render();
  const p = S.parsed;
  say(`集計しました：有効 ${p.sessions.length}件（${S.model.people}人）、読めなかった ${p.errors.length}件、重複 ${p.duplicates.length}件、再検査 ${p.groups.length}組`, p.errors.length ? "warn" : "ok");
  if (scroll) document.getElementById("s1")?.scrollIntoView({ block: "start" });
}

function clearAll() {
  ta.value = "";
  store.del(LS_KEY);
  S.parsed = S.model = S.rescore = null;
  results.replaceChildren();
  results.hidden = true;
  secnav.hidden = true;
  updateInfo();
  say("消去しました（貼り付けたテキストと、この端末に残していた控え）。", "info");
  ta.focus();
}

// ---------------------------------------------------------------- 入力の手段
async function addFiles(files) {
  const list = [...files];
  if (!list.length) return;
  const parts = [];
  for (const f of list) {
    try { parts.push(`（ファイル: ${f.name}）\n${await f.text()}`); }
    catch (e) { say(`${f.name} を読めませんでした：${e.message}`, "ng"); }
  }
  ta.value = [ta.value.trim(), ...parts].filter(Boolean).join("\n\n") + "\n";
  onInput();
  say(`${parts.length}個のファイルを貼り付け欄に追加しました。「集計する」を押してください。`, "ok");
}

async function loadSample() {
  if (ta.value.trim() && !confirm("貼り付け欄の内容をサンプルに置き換えます。よろしいですか？")) return;
  try {
    const res = await fetch(SAMPLE_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ta.value = await res.text();
    onInput();
    say("サンプル（テスト用に作った5人分＋途中で切れた1通・二重送信・再検査）を読み込みました。「集計する」を押してください。", "ok");
  } catch (e) {
    say(`サンプルを読み込めませんでした（${e.message}）。file:// で開いている場合は、公開ページかローカルサーバー経由で開いてください。`, "ng");
  }
}

// ---------------------------------------------------------------- 起動
function init() {
  $("#fb-url").textContent = FB_URL;
  $("#btn-copy-url").addEventListener("click", async (e) => {
    const ok = await copyText(FB_URL);
    e.target.textContent = ok ? "コピーしました" : "コピーできませんでした";
    setTimeout(() => { e.target.textContent = "URLをコピー"; }, 2500);
  });
  ta.addEventListener("input", onInput);
  $("#btn-run").addEventListener("click", () => run());
  $("#btn-sample").addEventListener("click", loadSample);
  $("#btn-clear").addEventListener("click", clearAll);
  $("#fb-files").addEventListener("change", async (e) => { await addFiles(e.target.files); e.target.value = ""; });
  ta.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
  ta.addEventListener("drop", async (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); await addFiles(e.dataTransfer.files); } });
  const saved = store.get(LS_KEY);
  if (saved && saved.trim()) {
    ta.value = saved;
    updateInfo();
    run({ scroll: false });
    say("前回貼り付けたテキストを復元して集計しました（「消去」で消せます）。", "info");
  } else updateInfo();
}

init();
