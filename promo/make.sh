#!/bin/zsh
# 树仁搭子宣传片：一键生成
#   1. 渲染两张打卡照片场景（photos.html）
#   2. 用服务器真实的水印代码盖章（stamp.ts → server/watermark.ts）
#   3. 导出音效提示表 → 合成音效（audio.py，只用 numpy；没有配乐、没有人声，加 --music 才有配乐）
#   4. 逐帧渲染 film.html → 合成带音效的 MP4
# 需要：Node（项目依赖已安装）、Google Chrome、ffmpeg、python3 + numpy
set -e
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-audit --no-fund
mkdir -p build out
node render.mjs --page photos.html --q scene=a --shot build/desk-a.jpg --w 960 --h 1280
node render.mjs --page photos.html --q scene=b --shot build/desk-b.jpg --w 960 --h 1280
(cd .. && npx tsx promo/stamp.ts)
node render.mjs --events build/events.json
python3 audio.py build/events.json build/sfx.wav 52
node render.mjs --video build/silent.mp4 --fps ${FPS:-30}
cp build/silent.mp4 out/树仁搭子-宣传片-无声.mp4
# 音效已在 audio.py 里调好响度（约 -20 LUFS），这里不再做 loudnorm
ffmpeg -v error -y -i build/silent.mp4 -i build/sfx.wav -map 0:v -map 1:a -c:v copy \
  -ar 48000 -c:a aac -b:a 192k -shortest -movflags +faststart out/树仁搭子-宣传片.mp4
ls -la out
