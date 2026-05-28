# Cloudflare Worker デプロイ手順

このWorkerはフロントエンド（GitHub Pages）から受けたPOSTを、GitHub Contents API経由で `docs/data/state.json` に commit する役割を担います。

## 前提

- Cloudflare アカウント（無料で OK）
- GitHub Fine-grained Personal Access Token

## デプロイ手順（Webダッシュボード方式・約10分）

### 1. GitHub PAT 発行
1. https://github.com/settings/personal-access-tokens/new を開く
2. 以下を設定:
   - **Token name**: `marutas-1to1-worker`
   - **Expiration**: 90日（または任意）
   - **Repository access**: `Only select repositories` → `marutas-1to1` を選択
   - **Permissions** → Repository permissions:
     - **Contents**: `Read and write`
     - **Metadata**: `Read-only`（自動）
3. **Generate token** を押す
4. 表示された `github_pat_xxxxxx...` をコピー（**再表示されないので必ず保存**）

### 2. Cloudflare Worker 作成
1. https://dash.cloudflare.com にログイン
2. 左サイドバー **Workers & Pages** → **Create application** → **Create Worker**
3. 名前を `marutas-1to1` に変更 → **Deploy**（テンプレ Hello World で一旦作成）
4. 作成された Worker のページで **Edit code** → 右側エディタに [worker/index.js](./index.js) の中身を貼り付け
5. 右上 **Save and deploy**

### 3. 環境変数 / Secret 設定
Worker の **Settings** → **Variables and Secrets** で以下を追加:

| Variable name | Type | Value |
|---|---|---|
| `GITHUB_TOKEN` | **Secret** | （手順1でコピーしたPAT） |
| `GITHUB_OWNER` | Text | `yugokatsuyama-dot` |
| `GITHUB_REPO` | Text | `marutas-1to1` |
| `GITHUB_BRANCH` | Text | `main` |
| `STATE_PATH` | Text | `docs/data/state.json` |
| `ALLOWED_ORIGIN` | Text | `https://yugokatsuyama-dot.github.io` |

設定後、再度 **Save and deploy** で反映。

### 4. Worker URL を控える
Worker のページ上部に表示されている URL（例: `https://marutas-1to1.<yourname>.workers.dev`）をコピー。
これを Claude に渡すと、フロントエンドを Worker 連携モードに切り替えます。

### 5. 動作確認
ブラウザで以下にアクセス:
```
https://marutas-1to1.<yourname>.workers.dev/api/state
```
JSON が返ってくれば成功（CORSエラーは出ません。直接ブラウザでGETするだけなので）。

## トラブルシュート

- **401 Bad credentials**: PAT が間違っているか期限切れ
- **404 Not found**: STATE_PATH のパスが違うか、GITHUB_REPO 名が違う
- **CORSエラー**: ALLOWED_ORIGIN が GitHub Pages の URL と完全一致しているか確認（末尾スラッシュなし）
