# マルタス班 1to1 スケジューラ ⤴️

marutasu の分科会「マルタス班盛り上げ隊⤴️」メンバー7名が、3か月以内に **全員相互1to1（21ペア）** を完了するための日程調整Webアプリ。

## 🌐 公開URL

**https://yugokatsuyama-dot.github.io/marutas-1to1/**

## 🎯 機能

- **進捗マトリクス**: 7×7・21ペアの完了/未完了を可視化
- **空き枠登録**: 定期枠（曜日×時間帯）+ 個別枠（特定日）
- **マッチング候補**: 未完了ペアの「合う日時」を直近14日から自動抽出
- **完了報告**: 実施した1to1を信頼ベースで記録

## 📁 構成

```
.
├── docs/              # GitHub Pages 公開対象
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── data/state.json
├── 要件定義.md
└── README.md
```

## 🚀 ローカル動作確認

```sh
python -m http.server 8765 --directory docs
# → http://localhost:8765
```

## 📋 メンバー

hisanori tada（ジェンヌ） / 西村 僚 / Kana Okada / 小倉よしき / 佐藤慎吾 / Goh / かつやまゆうご

## 📜 ライセンス

内部利用のみ（ライセンス未設定）
