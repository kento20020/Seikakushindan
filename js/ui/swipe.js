// 汎用のスワイプ操作（Pointer Events。マウスのドラッグも同じ扱い）。ビルドなし・外部ライブラリなし。
//
//   const detach = attachSwipe(el, {
//     onLeft, onRight, onUp, onDown,  // 確定したときに呼ぶ。渡した向きだけが有効（渡さない向きは抵抗がかかって元に戻る）
//     onProgress,                     // ({ dir, progress, ready, dragging, committing, axis, dx, dy }) 指の動きに合わせて呼ぶ
//                                     //   dir：いま離すと確定する向き（有効な向きだけ。無効・離したあとは null）／progress：0〜1
//     onStart, onEnd,                 // ドラッグの開始（動きがスロップを越えた時）／すべて終わった時（{ committed }）
//     ignore,                         // このセレクタに当たる要素から始めた操作は無視する（既定は a, button, input …）
//     target,                         // ({ axis, dir, start }) → 動かす要素（任意。既定は el。返さない・要素でないときも el）
//                                     //   axis："x"|"y"／dir：いまの向き（有効・無効を問わない）／start：pointerdown の target 要素
//                                     //   ドラッグ中の更新ごとに呼ぶ。返す要素が前と変わったら、前の要素は snapMs で元の位置へ戻してから片付ける
//     allow,                          // (dir, { start }) → その向きを有効にするか（任意）。ハンドラがあり、かつ allow が true（または無し）の向きだけ有効
//     maxTilt ほか DEFAULTS の値も上書きできる
//   });
//   detach();                         // リスナーと途中の状態を片付ける。呼び出し側が再描画するたびに呼ぶこと
//
// 判定：向きは移動量の大きい軸（縦横が拮抗したときは直前の軸を保つ）。
//   確定 ＝ 横は |dx| ≥ max(80px, 幅の25%)、縦は |dy| ≥ 80px。または直近100msの速さが 0.6px/ms 以上で 30px 以上動いた（フリック）。
//   足りなければ 150ms で元に戻す。確定したら 180ms で画面外へ飛ばしてから onLeft などを呼ぶ。
// 動かすのは el 自身（target を渡せば、その要素）の transform / transition / opacity / will-change。確定（画面外へ飛ばす。位置は動かす要素の
//   getBoundingClientRect で計る）・戻す・detach は、そのとき動かしている要素に対して行い、1回のジェスチャーで動かした要素は最後に必ず片付ける。
// スワイプを始められる範囲は el 全体（target を渡しても同じ）。touch-action: none を el に付ける（el の外は縦スクロールのまま）。
// prefers-reduced-motion のときは飛ばす・戻すアニメーションをせず、すぐ確定／すぐ戻す（指に付いてくる動きだけは残す）。

const DEFAULTS = {
  slop: 10,                        // これ未満の動きはタップ扱い（クリックはそのまま通る）
  minX: 80, ratioX: 0.25, minY: 80,
  flickSpeed: 0.6, flickMin: 30, flickWindow: 100,
  exitMs: 180, snapMs: 150,
  maxTilt: 8,                      // 横ドラッグの傾き（度）。確定距離で最大
  resist: 0.3,                     // 無効な向きのドラッグは、この割合しか動かさない
  axisBias: 12,                    // 軸を切り替えるのに必要な差（px）
  ignore: "a, button, input, select, textarea, summary, label, [data-no-swipe]",
};
const HANDLER = { left: "onLeft", right: "onRight", up: "onUp", down: "onDown" };

export const prefersReducedMotion = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
export const isCoarsePointer = () => !!globalThis.matchMedia?.("(pointer: coarse)").matches;

export function attachSwipe(el, opts = {}) {
  const opt = (k) => opts[k] ?? DEFAULTS[k];
  const handler = (dir) => opts[HANDLER[dir]];
  const call = (fn, ...args) => { if (typeof fn === "function") { try { fn(...args); } catch (err) { console.error(err); } } };

  let ptr = null;          // 追跡中の指（マウス）。ドラッグが始まると dragging = true
  let busy = false;        // 確定アニメーション中（新しい操作は受けない）
  let detached = false;
  let active = false;      // onStart を呼んでから onEnd を呼ぶまで
  let committed = false;
  let exitTimer = 0, snapTimer = 0, offClick = null;
  let cur = null;               // いま動かしている要素（target で決める。既定は el）。つかみ直したときは null から選び直す
  const moved = new Set();      // onStart から onEnd までに動かした要素（最後に必ず片付ける）
  const parked = new Map();     // 途中で動かす要素が変わって、元の位置へ戻している要素 → 片付けのタイマー
  const prevTouchAction = el.style.touchAction;
  el.style.touchAction = "none";

  const clearStyle = (x) => { x.style.transition = ""; x.style.transform = ""; x.style.opacity = ""; x.style.willChange = ""; };
  function clearStyles() {
    for (const t of parked.values()) clearTimeout(t);
    parked.clear();
    for (const x of moved) clearStyle(x);
    moved.clear();
    clearStyle(el);
    cur = null;
  }
  // 動かす要素を選ぶ（target が無い・返さない・要素でないときは el）
  function pick(info) {
    if (typeof opts.target !== "function") return el;
    let t = null;
    try { t = opts.target(info); } catch (err) { console.error(err); }
    return t && t.style ? t : el;
  }
  // 指に付いてこさせる（戻している途中なら、その片付けは取りやめる）
  function grab(x) {
    clearTimeout(parked.get(x)); parked.delete(x);
    x.style.transition = "none";
    x.style.willChange = "transform";
    moved.add(x);
  }
  // 動かす要素が変わったとき、前の要素を snapMs で元の位置へ戻してから片付ける
  function park(x) {
    if (prefersReducedMotion()) { clearStyle(x); return; }
    const ms = opt("snapMs");
    x.style.transition = `transform ${ms}ms ease-out, opacity ${ms}ms ease-out`;
    x.style.transform = "";
    x.style.opacity = "";
    clearTimeout(parked.get(x));
    parked.set(x, setTimeout(() => { parked.delete(x); if (x !== cur) clearStyle(x); }, ms + 30));
  }
  const releaseCapture = (id) => { try { if (el.hasPointerCapture?.(id)) el.releasePointerCapture(id); } catch { /* 既に外れている */ } };
  function endGesture() {
    if (!active) return;
    active = false;
    const c = committed; committed = false;
    call(opts.onEnd, { committed: c });
  }

  // ドラッグ直後に出る click を一度だけ握りつぶす（選択肢のボタンから始めてドラッグしたとき、回答にならないように）
  function swallowClick() {
    offClick?.();
    let t = 0;
    const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); off(); };
    const off = () => { clearTimeout(t); el.removeEventListener("click", stop, true); if (offClick === off) offClick = null; };
    el.addEventListener("click", stop, true);
    t = setTimeout(off, 300);
    offClick = off;
  }

  // ---------------------------------------------------------------- 入力
  function down(e) {
    if (detached || busy || !e.isPrimary) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const hit = e.target instanceof Element ? e.target.closest(opt("ignore")) : null;
    if (hit && hit !== el && el.contains(hit)) return;
    if (ptr) cancel();   // 前の指の pointerup を取りこぼしていた
    ptr = { id: e.pointerId, x0: e.clientX, y0: e.clientY, samples: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }],
      start: e.target instanceof Element ? e.target : null, dragging: false, width: 0, axis: null, dir: null, d: 0, th: 0, enabled: false, progress: 0, tx: 0, ty: 0, dx: 0, dy: 0 };
  }

  function move(e) {
    const p = ptr;
    if (!p || e.pointerId !== p.id) return;
    p.samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    while (p.samples.length > 2 && p.samples[0].t < e.timeStamp - 2 * opt("flickWindow")) p.samples.shift();
    const dx = e.clientX - p.x0, dy = e.clientY - p.y0;
    if (!p.dragging) {
      if (Math.hypot(dx, dy) < opt("slop")) return;
      begin(p, e);
    }
    update(p, dx, dy);
  }

  function begin(p, e) {
    p.dragging = true;
    p.width = el.offsetWidth;
    clearTimeout(snapTimer); snapTimer = 0;     // 戻している途中でつかみ直した
    cur = null;                                  // 動かす要素は最初の update で選び直す（戻している途中の要素は、選ばれなければそのまま戻る）
    // 登場アニメーション・見本の動きの途中でも指に付いてくるように、el と中の要素のアニメーションを止める。
    //   中の要素の CSS の transition（色の変化・戻している途中の動きなど）は止めない（el 自身のものは今までどおり止める）
    const CT = globalThis.CSSTransition;
    for (const a of el.getAnimations?.({ subtree: true }) ?? []) {
      if (a.effect?.target === el || !(typeof CT === "function" && a instanceof CT)) a.cancel();
    }
    try { el.setPointerCapture(e.pointerId); } catch { /* 取れなくても動く */ }
    try { globalThis.getSelection?.()?.removeAllRanges(); } catch { /* 無視 */ }
    if (!active) { active = true; committed = false; call(opts.onStart); }
  }

  function update(p, dx, dy) {
    const ax = Math.abs(dx), ay = Math.abs(dy), bias = opt("axisBias");
    if (!p.axis) p.axis = ax >= ay ? "x" : "y";
    else if (p.axis === "x" && ay > ax + bias) p.axis = "y";
    else if (p.axis === "y" && ax > ay + bias) p.axis = "x";
    const horizontal = p.axis === "x";
    const d = horizontal ? dx : dy;
    const dir = horizontal ? (d < 0 ? "left" : "right") : (d < 0 ? "up" : "down");
    const th = horizontal ? Math.max(opt("minX"), opt("ratioX") * p.width) : opt("minY");
    const enabled = typeof handler(dir) === "function" && allowed(dir, p);
    const progress = enabled ? Math.min(1, Math.abs(d) / th) : 0;
    // 見た目の移動量はスロップ分を引く（つかんだ瞬間にカードが飛ばないように）。無効な向きは抵抗をかける
    const shown = (d - Math.sign(d) * Math.min(Math.abs(d), opt("slop"))) * (enabled ? 1 : opt("resist"));
    const rot = horizontal && enabled ? Math.sign(d) * opt("maxTilt") * progress : 0;
    p.tx = horizontal ? shown : 0; p.ty = horizontal ? 0 : shown;
    Object.assign(p, { dir, d, th, enabled, progress, dx, dy });
    const t = pick({ axis: p.axis, dir, start: p.start });
    if (t !== cur) { if (cur) park(cur); grab(t); cur = t; }
    t.style.transform = `translate3d(${p.tx}px, ${p.ty}px, 0) rotate(${rot}deg)`;
    call(opts.onProgress, { dir: enabled ? dir : null, progress, ready: enabled && progress >= 1, dragging: true, committing: false, axis: p.axis, dx, dy });
  }

  function allowed(dir, p) {
    if (typeof opts.allow !== "function") return true;
    try { return !!opts.allow(dir, { start: p.start }); } catch (err) { console.error(err); return false; }
  }

  // 直近 flickWindow ms の、軸方向の速さ（px/ms。符号つき）
  function velocity(p, now) {
    const w = p.samples.filter(s => s.t >= now - opt("flickWindow"));
    if (w.length < 2) return 0;
    const a = w[0], b = w[w.length - 1];
    const dt = Math.max(now, b.t) - a.t;
    if (dt <= 0) return 0;
    return (p.axis === "x" ? b.x - a.x : b.y - a.y) / dt;
  }

  function up(e) {
    const p = ptr;
    if (!p || e.pointerId !== p.id) return;
    ptr = null;
    releaseCapture(p.id);
    if (!p.dragging) return;                 // ただのタップ。クリックはそのまま通す
    swallowClick();
    update(p, e.clientX - p.x0, e.clientY - p.y0);
    const v = velocity(p, e.timeStamp);
    const far = p.enabled && Math.abs(p.d) >= p.th;
    const flick = p.enabled && Math.abs(p.d) >= opt("flickMin") && Math.abs(v) >= opt("flickSpeed") && Math.sign(v) === Math.sign(p.d);
    if (far || flick) commit(p); else settle();
  }

  function cancel() {
    const p = ptr;
    if (!p) return;
    ptr = null;
    releaseCapture(p.id);
    if (p.dragging) settle();
  }

  // ---------------------------------------------------------------- 確定・戻す
  function commit(p) {
    const dir = p.dir;
    committed = true; busy = true;
    call(opts.onProgress, { dir, progress: 1, ready: true, dragging: false, committing: true, axis: p.axis, dx: p.dx, dy: p.dy });
    const finish = () => {
      exitTimer = 0;
      if (detached) return;
      call(handler(dir));                    // 再描画されると呼び出し側が detach() する
      busy = false;
      if (!detached) settle();               // 何も変わらなかった（差し替えられない等）ときはカードを戻す
    };
    if (prefersReducedMotion()) { finish(); return; }
    const t = cur ?? el;
    const r = t.getBoundingClientRect(), m = 24;
    let tx = p.tx, ty = p.ty;
    if (dir === "left") tx -= r.right + m;
    else if (dir === "right") tx += globalThis.innerWidth - r.left + m;
    else if (dir === "up") ty -= r.bottom + m;
    else ty += globalThis.innerHeight - r.top + m;
    const rot = dir === "left" ? -opt("maxTilt") : dir === "right" ? opt("maxTilt") : 0;
    const ms = opt("exitMs");
    t.style.transition = `transform ${ms}ms ease-in, opacity ${ms}ms ease-in`;
    t.style.transform = `translate3d(${tx}px, ${ty}px, 0) rotate(${rot}deg)`;
    t.style.opacity = "0";
    exitTimer = setTimeout(finish, ms);
  }

  function settle() {
    call(opts.onProgress, { dir: null, progress: 0, ready: false, dragging: false, committing: false, axis: null, dx: 0, dy: 0 });
    if (prefersReducedMotion()) { clearStyles(); endGesture(); return; }
    const ms = opt("snapMs"), t = cur ?? el;
    t.style.transition = `transform ${ms}ms ease-out, opacity ${ms}ms ease-out`;
    t.style.transform = "";
    t.style.opacity = "";
    snapTimer = setTimeout(() => { snapTimer = 0; clearStyles(); endGesture(); }, ms + 30);
  }

  // ---------------------------------------------------------------- 取り付け・取り外し
  const listeners = [
    ["pointerdown", down], ["pointermove", move], ["pointerup", up], ["pointercancel", cancel],
    // 指の捕まえ先が子（ボタン）から el に移ったときに子で出る lostpointercapture は、バブリングしてくるので除く
    ["lostpointercapture", (e) => { if (e.target === el && ptr?.dragging && e.pointerId === ptr.id) cancel(); }],
  ];
  for (const [type, fn] of listeners) el.addEventListener(type, fn);

  return function detach() {
    if (detached) return;
    detached = true;
    clearTimeout(exitTimer); clearTimeout(snapTimer);
    for (const [type, fn] of listeners) el.removeEventListener(type, fn);
    if (ptr) releaseCapture(ptr.id);
    ptr = null;
    offClick?.();
    el.style.touchAction = prevTouchAction;
    clearStyles();
    endGesture();
  };
}
