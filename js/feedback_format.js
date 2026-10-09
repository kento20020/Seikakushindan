// テスト協力モードの送信用テキスト（docs/feedback-spec.md §2）。参加者側・集計側の共通部品。
// 機械用の行：16DFB1|<crc32 8桁16進>|<1行のJSON>|END

export const FB_TAG = "16DFB1";
export const FB_VERSION = 1;

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }
  return CRC_TABLE;
}

/** 文字列（UTF-8 として）の CRC-32 を8桁の16進で返す */
export function crc32hex(str) {
  const bytes = new TextEncoder().encode(str);
  const t = crcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return ((c ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, "0");
}

/** 機械用の1行を作る */
export function encodeLine(payload) {
  const json = JSON.stringify(payload);
  return `${FB_TAG}|${crc32hex(json)}|${json}|END`;
}

/** 送信用テキスト全体（人が読む要約行＋案内＋機械用の行） */
export function encodeText(payload, summaryLines = []) {
  return [...summaryLines, "（ここから下の行も消さずに、全部送ってください）", encodeLine(payload)].join("\n");
}

/**
 * 貼り付けられたテキスト（複数人分が混ざっていてよい）から全件を取り出す。
 * 返り値 { items: [{payload, crc, index}], errors: [{index, reason, excerpt}] }
 */
export function decodeAll(text) {
  const items = [], errors = [];
  // 本文は次の開始タグをまたがない（途中で切れた1件が、後ろの人の分まで飲み込まないように）
  const re = new RegExp(`${FB_TAG}\\|([0-9a-fA-F]{8})\\|((?:(?!${FB_TAG}\\|)[\\s\\S])*?)\\|END`, "g");
  let m, index = 0;
  while ((m = re.exec(text))) {
    index++;
    const crc = m[1].toLowerCase();
    const json = m[2].replace(/[\r\n]/g, "");
    const excerpt = json.slice(0, 60);
    if (crc32hex(json) !== crc) { errors.push({ index, reason: "CRC不一致（途中で切れた・書き換わった可能性）", excerpt }); continue; }
    try {
      const payload = JSON.parse(json);
      if (payload?.v !== FB_VERSION) { errors.push({ index, reason: `未対応の版 v=${payload?.v}`, excerpt }); continue; }
      items.push({ payload, crc, index });
    } catch (e) {
      errors.push({ index, reason: "JSONとして読めない: " + e.message, excerpt });
    }
  }
  // 開始タグはあるのに END が無い（途中で切れた）ものも数える
  const starts = (text.match(new RegExp(FB_TAG + "\\|", "g")) || []).length;
  if (starts > index) errors.push({ index: index + 1, reason: `終わり（|END）が見つからない行が ${starts - index} 件（途中で切れた可能性）`, excerpt: "" });
  return { items, errors };
}
