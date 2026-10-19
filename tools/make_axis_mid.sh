#!/bin/bash
# まんなか（50:50）の軸の絵を、横長の8枚並びのまとめ画像から切り出す（決定 U36。docs/app-screens.md §13）
#   1枚ずつ切り出し → 一辺に合わせて拡大 → 地の明るさを A寄り・B寄りの絵にそろえる → 上に地の灰色を足して正方形に（継ぎ目はぼかす。リボンと人物はぼかさない）
# 使い方（ImageMagick 6 が要る。CI では動かさない）：
#   tools/make_axis_mid.sh docs/mockups/2026-10-18/axis-images/sheet-25-75-01-08-wide.jpg app/img/axes 521
set -euo pipefail
SRC=$1; OUT=$2; SIZE=$3
FADE=$(( SIZE * 32 / 521 ))           # 継ぎ目をぼかす高さ
XS=(30 463 899 1335); XE=(438 874 1311 1742)
YS=(92 491); YE=(435 826)
IN=4                                  # 枠の縁の白とのにじみを避ける
T=$(mktemp -d)
for d in 1 2 3 4 5 6 7 8; do
  i=$(( (d-1) % 4 )); j=$(( (d-1) / 4 ))
  x=$(( XS[i] + IN )); y=$(( YS[j] + IN ))
  w=$(( XE[i] - XS[i] - 2*IN + 1 )); h=$(( YE[j] - YS[j] - 2*IN + 1 ))
  # 切り出し → 一辺に合わせて拡大 → 地の明るさを a・b の絵（約 196,190,184）にそろえる
  convert "$SRC" -crop ${w}x${h}+${x}+${y} +repage -filter Lanczos -resize ${SIZE}x \
    -channel R -evaluate multiply 1.026 -channel G -evaluate multiply 1.0215 -channel B -evaluate multiply 1.022 +channel \
    "$T/p.png"
  ph=$(identify -format %h "$T/p.png")
  # 地の色＝切り出した絵のいちばん上の数行の平均
  bg=$(convert "$T/p.png" -crop ${SIZE}x6+0+0 +repage -scale 1x1! -format "rgb(%[fx:round(r*255)],%[fx:round(g*255)],%[fx:round(b*255)])" info:)
  # 上の FADE 画素だけ透明から不透明へ（継ぎ目を見せない）
  convert -size ${SIZE}x${FADE} gradient:black-white -size ${SIZE}x$(( ph - FADE )) xc:white -append "$T/g.png"
  #   地の色と違う所（リボン・人物）は、ぼかしの帯の中でもそのまま出す
  convert "$T/p.png" \( -size ${SIZE}x${ph} "xc:$bg" \) -compose difference -composite -colorspace gray \
    -threshold 4% -morphology dilate disk:2 -blur 0x1 "$T/c.png"
  convert "$T/g.png" "$T/c.png" -compose lighten -composite "$T/m.png"
  convert "$T/p.png" "$T/m.png" -alpha off -compose CopyOpacity -composite "$T/pa.png"
  convert -size ${SIZE}x${SIZE} "xc:$bg" -seed $d -attenuate 0.07 +noise Gaussian "$T/pa.png" -gravity south -compose over -composite \
    -strip -colorspace sRGB -sampling-factor 4:2:0 -quality 88 "$OUT/${d}-mid.jpg"
  echo "$d crop=${w}x${h}+${x}+${y} scaled_h=$ph bg=$bg"
done
rm -rf "$T"
