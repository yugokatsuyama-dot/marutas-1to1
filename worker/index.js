// マルタス班1to1スケジューラ - Cloudflare Worker
// 役割: フロントエンドからのPOSTを受け、GitHub Contents APIで state.json を更新する
//
// 必要な環境変数 (Cloudflare → Settings → Variables):
//   GITHUB_TOKEN  (Secret)  Fine-grained PAT, Contents: read+write を marutas-1to1 のみに付与
//   GITHUB_OWNER  (Var)     例: "yugokatsuyama-dot"
//   GITHUB_REPO   (Var)     例: "marutas-1to1"
//   GITHUB_BRANCH (Var)     例: "main"
//   STATE_PATH    (Var)     例: "docs/data/state.json"
//   ALLOWED_ORIGIN (Var)    例: "https://yugokatsuyama-dot.github.io"

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(env) },
  });
}

// UTF-8 base64 helpers (Japanese-safe)
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function base64ToUtf8(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

async function ghGet(env) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${env.STATE_PATH}?ref=${env.GITHUB_BRANCH}`;
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "marutas-1to1-worker",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub GET failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return { state: JSON.parse(base64ToUtf8(data.content)), sha: data.sha };
}

async function ghPut(env, newState, sha, message) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${env.STATE_PATH}`;
  const content = utf8ToBase64(JSON.stringify(newState, null, 2) + "\n");
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "marutas-1to1-worker",
    },
    body: JSON.stringify({ message, content, sha, branch: env.GITHUB_BRANCH }),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`GitHub PUT failed (${res.status}): ${text}`);
    err.status = res.status;
    throw err;
  }
  return await res.json();
}

// Optimistic concurrency: if PUT fails with 409 (sha mismatch), retry
async function mutate(env, mutator, message) {
  for (let i = 0; i < 3; i++) {
    const { state, sha } = await ghGet(env);
    mutator(state);
    state.updated_at = new Date().toISOString();
    try {
      await ghPut(env, state, sha, message);
      return state;
    } catch (e) {
      if (e.status !== 409 || i === 2) throw e;
    }
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(env) });

    try {
      // GET /api/state — fresh fetch (普段はraw.githubusercontent.com推奨だが、強制最新化用)
      if (url.pathname === "/api/state" && req.method === "GET") {
        const { state } = await ghGet(env);
        return json(env, state);
      }

      // POST /api/availability — メンバーの空き枠を上書き
      if (url.pathname === "/api/availability" && req.method === "POST") {
        const body = await req.json();
        if (!body.memberId) return json(env, { error: "memberId required" }, 400);
        const state = await mutate(env, (s) => {
          if (!s.availability) s.availability = {};
          s.availability[body.memberId] = {
            recurring: Array.isArray(body.recurring) ? body.recurring : [],
            specific: Array.isArray(body.specific) ? body.specific : [],
            note: body.note || "",
            updated_at: new Date().toISOString(),
          };
        }, `chore(data): update availability for ${body.memberId}`);
        return json(env, { ok: true, state });
      }

      // POST /api/sessions — 1to1完了報告の追加/削除
      if (url.pathname === "/api/sessions" && req.method === "POST") {
        const body = await req.json();
        if (body.action === "add") {
          if (!body.session || !Array.isArray(body.session.pair)) {
            return json(env, { error: "session.pair required" }, 400);
          }
          const state = await mutate(env, (s) => {
            if (!s.sessions) s.sessions = [];
            s.sessions.push({ ...body.session, reported_at: new Date().toISOString() });
          }, `feat(session): ${body.session.pair.join("×")} ${body.session.datetime || ""}`);
          return json(env, { ok: true, state });
        }
        if (body.action === "delete") {
          if (typeof body.index !== "number") return json(env, { error: "index required" }, 400);
          const state = await mutate(env, (s) => {
            if (Array.isArray(s.sessions)) s.sessions.splice(body.index, 1);
          }, `revert(session): delete index ${body.index}`);
          return json(env, { ok: true, state });
        }
        return json(env, { error: "unknown action" }, 400);
      }

      return json(env, { error: "Not found" }, 404);
    } catch (e) {
      console.error(e);
      return json(env, { error: String(e.message || e) }, 500);
    }
  },
};
