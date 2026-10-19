// 診断結果の絵の一覧（#images。タブなし）。仕様：docs/app-screens.md §14（決定 U34。まんなかの絵は U36 でそろった）
//   持ち主の依頼「診断結果のどんな画像が設定されているのかを確認できる画面」。絵が無い枠は「準備中」と出す（今は新しい画面の24枠すべてに絵がある）
//   上：「←」・題「診断結果の絵」（h1）
//   前置きと数のまとめ（新しい画面の24枠のうち、絵がある数。axis_art.js の axisArtSlots から数える）
//   「どの絵が出るか」：●の割合で A寄り・まんなか・B寄りを選ぶ決まり（axis_art.js の artSide と同じ）、出る場所、
//     まんなかの絵が準備中の軸があるときだけ、その代わりの出し方（midWait。今は出ない）
//   診断の結果があるときだけ、印を付ける（axis_art.js の slotMarks）
//     「あなたの結果」＝8つの軸の行に選ばれる枠（絵が無い枠にも付く）、「いちばん上の絵」＝結果とホームのいちばん上に出ている枠
//   節「新しい画面（8つの軸 × 3パターン）」：軸ごとに A寄り・まんなか・B寄りの3枠（絵か「準備中」の枠・名前・比率・状態・ファイル名）
//   節「今の画面（../#three）の傾向の絵」：js/data/type_images.js の16枠（軸ごとに A・B）。新しい画面では使っていない
//   数はどれもデータから数える（絵が届いて枠が埋まれば、数も印も自動で変わる）。見た目は app/css/app.css（a-im-）
import { h, topBar, sectionHead, badge, rowLink } from "./ui.js";
import { store3, restore3 } from "../../js/ui/three_store.js";
import { DOMAINS } from "../../js/engine3.js";
import { TYPE_IMAGES, isReady } from "../../js/data/type_images.js";
import { AXIS_ART, ART_SIZE, axisArtSlots, slotMarks } from "./axis_art.js";
import { axisView } from "./summary.js";

/** 今の画面の傾向の絵の大きさ（img/types/。960×960） */
const TYPE_SIZE = 960;

/**
 * 今の画面の傾向の絵（js/data/type_images.js）の16枠。軸の順・A → B。DOM を使わない（テストでも使う）
 *   { key: "1A", domain, side: "A" | "B", label: 傾向の名前, ready, file, alt, path }
 *   file はサイトのルートからの相対パス（app/ からは ../ を付ける）。絵が無ければ file・alt は null、path は置く場所（img/types/<キー>.jpg）
 */
export function typeImageSlots(images = TYPE_IMAGES) {
  return Object.values(images)
    .map(e => {
      const ready = isReady(e);
      return { key: e.key, domain: e.domain, side: e.side, label: e.tendency, ready,
        file: ready ? e.file : null, alt: ready ? e.alt : null, path: ready ? e.file : `img/types/${e.key}.jpg` };
    })
    .sort((x, y) => (x.domain - y.domain) || x.side.localeCompare(y.side));
}

const countOf = (list) => {
  const ready = list.filter(s => s.ready).length;
  return { all: list.length, ready, pending: list.length - ready };
};
const pendingText = (c) => (c.pending ? `（準備中 ${c.pending}枠）` : "（準備中はありません）");
// 印（結果があるときだけ）：[文, badge の色]
const MARK = { yours: ["あなたの結果", "rose"], hero: ["いちばん上の絵", "ink"] };

export function render(root) {
  restore3();
  const r = store3.result ?? null;
  const slots = axisArtSlots();
  let marks = { picked: [], hero: null, art: null };
  if (r) { try { marks = slotMarks(r); } catch (err) { console.error(err); } }
  root.append(h("div", { class: "a-im" },
    topBar({ title: "診断結果の絵", heading: true }),
    intro(slots),
    rulesCard(slots, r, marks),
    axisSection(slots, marks),
    typeSection(typeImageSlots()),
    h("div", { class: "a-card a-rows-card a-im-foot" },
      h("div", { class: "a-rows" },
        r ? rowLink({ href: "#result", ic: "paper", text: "結果を見る" }) : null,
        rowLink({ href: "#mypage", ic: "person", text: "マイページへ戻る" })))));
}

// ---------------------------------------------------------------- 前置き・どの絵が出るか
function intro(slots) {
  const c = countOf(slots);
  return h("div", { class: "a-im-intro" },
    h("p", { class: "a-lead" }, "診断結果に出る絵の一覧です。絵がまだ無い枠は「準備中」と出ます。"),
    h("p", { class: "a-im-count", "data-count": "axes" }, `新しい画面：${c.all}枠のうち ${c.ready}枠に絵があります`, h("span", { class: "a-nowrap" }, pendingText(c))));
}

function rulesCard(slots, r, marks) {
  const midWait = slots.some(s => s.side === "mid" && !s.ready);
  return h("section", { class: "a-card a-im-rules", "aria-labelledby": "a-im-rules-h" },
    h("h2", { class: "a-im-rules-h", id: "a-im-rules-h" }, "どの絵が出るか"),
    h("ul", { class: "a-im-points" },
      h("li", null, "軸ごとに、A（左の傾向）を選んだ割合が半分より多ければ A寄り、少なければ B寄り、ちょうど半分ならまんなかの絵です。割合は、結果の「8つの軸」の●と同じです。"),
      h("li", null, "出る場所：結果の画面のいちばん上（主軸に合う傾向の軸）、結果の「8つの軸」の各行、ホームのいちばん上（診断のあと）。"),
      // まんなかの絵が準備中の枠があるときだけ（今は24枠すべてに絵があるので出ない）
      midWait ? h("li", null, "まんなかの絵が準備中の軸では、8つの軸の行は軸の番号の丸、いちばん上の絵は主軸に合う傾向の側（A寄りか B寄り）の絵を代わりに出しています。") : null),
    r ? legend(r, marks) : h("p", { class: "a-note a-im-marknote" }, "診断のあとは、あなたの結果で出る絵に印が付きます。"));
}

/** 印の見方（結果があるとき）。いちばん上の絵が代わりの側の絵（bySide。答えが無い軸か、まんなかの絵が準備中の軸）なら、そのわけを1文 */
function legend(r, marks) {
  const art = marks.art;
  let why = null;
  if (art?.bySide) {
    const name = DOMAINS[art.domain]?.name ?? "";
    let side = null;
    try { side = axisView(r, art.domain)?.side ?? null; } catch { side = null; }
    why = side === "mid"
      ? `この結果では「${name}」の軸がまんなかなので、いちばん上には${art.tendency}寄りの絵を代わりに出しています。`
      : `この結果では「${name}」の軸に答えが無いので、いちばん上には${art.tendency}寄りの絵を代わりに出しています。`;
  }
  return h("div", { class: "a-im-marknote" },
    h("ul", { class: "a-im-legend" },
      h("li", null, badge(MARK.yours[0], { tone: MARK.yours[1] }), h("span", null, "あなたの結果で、8つの軸の行に選ばれる絵")),
      h("li", null, badge(MARK.hero[0], { tone: MARK.hero[1] }), h("span", null, "結果の画面とホームのいちばん上に出ている絵"))),
    why ? h("p", { class: "a-note" }, why) : null);
}

// ---------------------------------------------------------------- 新しい画面（8つの軸 × 3パターン）
function axisSection(slots, marks) {
  const picked = new Set(marks.picked);
  return h("section", { class: "a-im-sec", "aria-labelledby": "a-im-axes-h" },
    // 「（8つの軸 × 3パターン）」は途中で切らずに次の行へ（a-im-keep。幅が足りないときだけ中で折り返す）
    sectionHead(h("span", null, "新しい画面", h("span", { class: "a-im-keep" }, "（8つの軸 × 3パターン）")), { id: "a-im-axes-h" }),
    h("p", { class: "a-note a-im-sec-note" },
      "左から A寄り（75:25）・まんなか（50:50）・B寄り（25:75）。絵は app/img/axes/ にあります（521×521）。絵を差し替えるときは、同じ名前のファイルを置き換えます。"),
    h("ul", { class: "a-im-list" }, Object.values(AXIS_ART).map(t => {
      const list = slots.filter(s => s.domain === t.domain);
      const c = countOf(list);
      const li = h("li", { class: "a-card a-im-axis", "data-domain": t.domain },
        h("div", { class: "a-im-axis-head" },
          h("h3", { class: "a-im-axis-name" }, `${t.domain} ${t.name}`),
          h("p", { class: "a-im-axis-count" }, `${c.all}枠のうち ${c.ready}枠`),
          h("p", { class: "a-im-axis-color" }, h("i", { class: "a-im-dot", "aria-hidden": "true" }), `軸の色：${t.colorName}`)),
        h("ul", { class: "a-im-grid" }, list.map(s => slotView({
          id: s.id, src: s.file, alt: s.alt, size: ART_SIZE, axis: true,
          name: s.label, sub: s.ratio, ready: s.ready, path: s.path,
          marks: [picked.has(s.id) && "yours", marks.hero === s.id && "hero"].filter(Boolean),
        }))));
      li.style.setProperty("--axis", t.color);
      li.style.setProperty("--axis-deep", t.deep);
      return li;
    })));
}

// ---------------------------------------------------------------- 今の画面（../#three）の傾向の絵
function typeSection(types) {
  const c = countOf(types);
  return h("section", { class: "a-im-sec", "aria-labelledby": "a-im-types-h" },
    sectionHead("今の画面（../#three）の傾向の絵", { id: "a-im-types-h" }),
    h("p", { class: "a-note a-im-sec-note" },
      "今の診断画面（../#three）の結果に出る絵です。新しい画面では使っていません。絵は img/types/ にあります（960×960。置き方は docs/type-images.md）。"),
    h("p", { class: "a-im-count", "data-count": "types" }, `${c.all}枠のうち ${c.ready}枠に絵があります`, h("span", { class: "a-nowrap" }, pendingText(c))),
    h("ul", { class: "a-im-list" }, Object.keys(DOMAINS).map(Number).map(d => {
      const list = types.filter(s => s.domain === d);
      const n = countOf(list);
      return h("li", { class: "a-card a-im-axis a-im-axis-type", "data-domain": d },
        h("div", { class: "a-im-axis-head" },
          h("h3", { class: "a-im-axis-name" }, `${d} ${DOMAINS[d].name}`),
          h("p", { class: "a-im-axis-count" }, `${n.all}枠のうち ${n.ready}枠`)),
        h("ul", { class: "a-im-grid a-im-grid-2" }, list.map(s => slotView({
          id: s.key, src: s.file ? `../${s.file}` : null, alt: s.alt, size: TYPE_SIZE,
          name: s.label, sub: s.side === "A" ? "A（左の傾向）" : "B（右の傾向）", ready: s.ready, path: s.path,
        }))));
    })));
}

// ---------------------------------------------------------------- 1枠
/**
 * 1枠：正方形の絵（無ければ同じ大きさの「準備中」の枠）→ 名前 → 比率（A・B）→ 状態 → ファイル名 → 印（3列の文の高さをそろえるため、印は最後）
 *   axis … 軸の絵（新しい画面と同じ明るさで見せる。.a-pic と同じ）
 */
function slotView({ id, src, alt, size, axis = false, name, sub, ready, path, marks = [] }) {
  const file = String(path).split("/").pop();
  return h("li", { class: ["a-im-slot", marks.includes("yours") && "is-yours", ready ? "is-ready" : "is-pending"], "data-slot": id, "data-ready": ready ? "true" : "false" },
    ready
      ? h("div", { class: ["a-im-frame", axis && "a-im-frame-axis"] },
        h("img", { src, alt: alt || "", width: size, height: size, loading: "lazy", decoding: "async" }))
      : h("div", { class: "a-im-frame a-im-pending" }, h("span", null, "準備中")),
    h("p", { class: "a-im-name" }, name),
    h("p", { class: "a-im-ratio" }, sub),
    h("p", { class: ["a-im-state", ready ? "is-ready" : "is-pending"] }, ready ? "設定済み" : "準備中"),
    h("p", { class: "a-im-file" }, ready ? file : `${file} を置くと出ます`),
    marks.length ? h("p", { class: "a-im-marks" }, marks.map(m => badge(MARK[m][0], { tone: MARK[m][1] }))) : null);
}
