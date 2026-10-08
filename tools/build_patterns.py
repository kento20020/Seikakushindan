#!/usr/bin/env python3
"""Parse docs/design.md -> js/data/patterns_text_cross.js / patterns_text_special.js

Japanese text is kept verbatim; only field-label prefixes, the 「」 around the
headline, and leading list markers are stripped.
"""
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DOC = REPO / "docs" / "design.md"
OUT_CROSS = REPO / "js" / "data" / "patterns_text_cross.js"
OUT_SPECIAL = REPO / "js" / "data" / "patterns_text_special.js"

anomalies = []


def warn(msg):
    anomalies.append(msg)
    print("ANOMALY:", msg)


lines = DOC.read_text(encoding="utf-8").split("\n")

# ---- locate groups & patterns -------------------------------------------
RE_CROSS_GROUP = re.compile(r"^## クロス解釈 (X\d\d) (.+)$")
RE_SPECIAL_GROUP = re.compile(r"^## 特殊([A-D]) (.+)$")
RE_PATTERN = re.compile(r"^### ((?:X\d\d-\d)|(?:S\d\d))( .*)?$")
RE_H2 = re.compile(r"^## ")

# collect sections: each starts at a ## or ### heading and ends at next heading
heads = []  # (lineno0, level, text)
for i, l in enumerate(lines):
    m = re.match(r"^(#{1,6}) (.*)$", l)
    if m:
        heads.append((i, len(m.group(1)), l))


def section_body(idx):
    """lines between heading idx and the next heading of any level (<=3)."""
    start = heads[idx][0] + 1
    end = heads[idx + 1][0] if idx + 1 < len(heads) else len(lines)
    return lines[start:end]


FIELDS = [
    ("cond", "条件"),
    ("headline", "短い見出し"),
    ("one", "一言説明"),
    ("detail", "詳細説明"),
    ("scenes", "具体的な場面例"),
    ("unique_x", "掛け合わせで初めて言えること"),
    ("unique_s", "基本・クロスとの違い"),
    ("caveat", "誤解しやすい点"),
]
LABEL_TO_KEY = {lab: key for key, lab in FIELDS}
RE_FIELD = re.compile(r"^- (" + "|".join(re.escape(l) for _, l in FIELDS) + r")：(.*)$")
RE_SCENE = re.compile(r"^  - (.*)$")


def parse_pattern(pid, body, kind):
    rec = {}
    cur_key = None
    scenes = []
    for l in body:
        if not l.strip():
            continue
        m = RE_FIELD.match(l)
        if m:
            key = LABEL_TO_KEY[m.group(1)]
            if key in rec or (key == "scenes" and scenes):
                warn(f"{pid}: duplicate field {m.group(1)}")
            cur_key = key
            val = m.group(2).strip()
            if key == "scenes":
                if val:
                    warn(f"{pid}: scenes label has inline text: {val!r}")
                    scenes.append(val)
            else:
                rec[key] = val
            continue
        ms = RE_SCENE.match(l)
        if ms and cur_key == "scenes":
            scenes.append(ms.group(1).strip())
            continue
        # continuation line of the previous field (nothing is dropped)
        if cur_key and cur_key != "scenes":
            warn(f"{pid}: continuation line appended to {cur_key}: {l[:40]!r}")
            rec[cur_key] += "\n" + l.strip()
        else:
            warn(f"{pid}: unparsed line: {l[:60]!r}")
    rec["scenes"] = scenes
    # normalise: unique
    if kind == "cross":
        if "unique_s" in rec:
            warn(f"{pid}: cross has 基本・クロスとの違い")
        rec["unique"] = rec.pop("unique_x", "")
        rec.pop("unique_s", None)
    else:
        if "unique_x" in rec:
            warn(f"{pid}: special has 掛け合わせで初めて言えること")
        rec["unique"] = rec.pop("unique_s", "")
        rec.pop("unique_x", None)
    # headline: strip 「」
    h = rec.get("headline", "")
    if h.startswith("「") and h.endswith("」"):
        h = h[1:-1]
    else:
        warn(f"{pid}: headline lacks surrounding 「」: {h!r}")
        h = h.strip("「」")
    rec["headline"] = h
    # output order
    ordered = {
        k: rec.get(k, "")
        for k in ("headline", "one", "detail", "scenes", "unique", "caveat", "cond")
    }
    missing = [k for k in ordered if not ordered[k]]
    if missing:
        warn(f"{pid}: empty fields {missing}")
    if len(scenes) != 2:
        warn(f"{pid}: scenes count = {len(scenes)}")
    return ordered


def group_intro(idx):
    """Plain-text paragraph(s) directly under a ## group heading."""
    body = section_body(idx)
    paras, cur = [], []
    for l in body:
        if l.strip():
            cur.append(l.strip())
        elif cur:
            paras.append(" ".join(cur))
            cur = []
    if cur:
        paras.append(" ".join(cur))
    return "\n\n".join(paras)


cross = {}
special = {}
cross_intro = {}
special_intro = {}
cross_group_titles = {}
special_group_titles = {}

for idx, (ln, level, text) in enumerate(heads):
    m = RE_CROSS_GROUP.match(text)
    if m:
        gid = m.group(1)
        if gid in cross_intro:
            warn(f"duplicate cross group {gid}")
        cross_intro[gid] = group_intro(idx)
        cross_group_titles[gid] = m.group(2)
        continue
    m = RE_SPECIAL_GROUP.match(text)
    if m:
        gid = m.group(1)
        special_intro[gid] = group_intro(idx)
        special_group_titles[gid] = m.group(2)
        continue
    m = RE_PATTERN.match(text)
    if m:
        pid = m.group(1)
        body = section_body(idx)
        if pid.startswith("X"):
            if pid in cross:
                warn(f"duplicate pattern {pid}")
            cross[pid] = parse_pattern(pid, body, "cross")
        else:
            if pid in special:
                warn(f"duplicate pattern {pid}")
            special[pid] = parse_pattern(pid, body, "special")

# ---- verify counts ---------------------------------------------------------
if len(cross) != 80:
    warn(f"cross count = {len(cross)} (expected 80)")
if len(special) != 20:
    warn(f"special count = {len(special)} (expected 20)")
if len(cross_intro) != 20:
    warn(f"cross group intro count = {len(cross_intro)} (expected 20)")
if sorted(special_intro) != ["A", "B", "C", "D"]:
    warn(f"special groups = {sorted(special_intro)}")
for gid, txt in list(cross_intro.items()) + list(special_intro.items()):
    if not txt:
        warn(f"empty group intro: {gid}")
# every cross group should have 4 patterns
for gid in cross_intro:
    for q in range(1, 5):
        if f"{gid}-{q}" not in cross:
            warn(f"missing cross pattern {gid}-{q}")

# ---- emit ------------------------------------------------------------------
def dump(obj):
    return json.dumps(obj, ensure_ascii=False, indent=1)


OUT_CROSS.write_text(
    "// クロス解釈 80本の本文（docs/design.md から自動生成: scratchpad/build_patterns.py）。\n"
    "// 見出し(headline)・条件(cond)の構造化データは patterns_meta.js。ここは文書どおりの原文。\n"
    "// フィールド: headline=短い見出し（「」なし） / one=一言説明 / detail=詳細説明 / scenes=具体的な場面例(2件) /\n"
    "//             unique=掛け合わせで初めて言えること / caveat=誤解しやすい点 / cond=条件（文書記載のまま）\n"
    "export const CROSS_TEXT = " + dump(cross) + ";\n",
    encoding="utf-8",
)

OUT_SPECIAL.write_text(
    "// 特殊・矛盾パターン 20本の本文とグループ導入文（docs/design.md から自動生成: scratchpad/build_patterns.py）。\n"
    "// フィールド: headline / one / detail / scenes(2件) / unique=基本・クロスとの違い / caveat / cond\n"
    "export const SPECIAL_TEXT = " + dump(special) + ";\n\n"
    "// クロス解釈 各グループ（## クロス解釈 Xab …）見出し直下の導入文\n"
    "export const CROSS_GROUP_INTRO = " + dump(cross_intro) + ";\n\n"
    "// 特殊 各グループ（## 特殊A〜D …）見出し直下の導入文\n"
    "export const SPECIAL_GROUP_INTRO = " + dump(special_intro) + ";\n",
    encoding="utf-8",
)

print(f"cross={len(cross)} special={len(special)} cross_intro={len(cross_intro)} "
      f"special_intro={len(special_intro)} anomalies={len(anomalies)}")
print("wrote", OUT_CROSS)
print("wrote", OUT_SPECIAL)
sys.exit(0)
