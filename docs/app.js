"use strict";

// Cloudflare Worker URL（共有データの読み書き先）
// localStorage に MARUTAS_WORKER_URL があればそちらを優先（テスト/切替用）
// 空文字にすると localStorage のみのローカルモードになる
const DEFAULT_WORKER_URL = "https://marutas-1to1.yugo-katsuyama.workers.dev";
const WORKER_URL = (localStorage.getItem("MARUTAS_WORKER_URL") ?? DEFAULT_WORKER_URL).replace(/\/$/, "");

const STORAGE_KEY = "marutas_1to1_state_v1";
const ME_KEY = "marutas_1to1_me_v1";
const DOW_LABELS = { mon:"月", tue:"火", wed:"水", thu:"木", fri:"金", sat:"土", sun:"日" };
const DOW_ORDER = ["mon","tue","wed","thu","fri","sat","sun"];
const MODE_LABELS = { any: "どちらでも", online: "オンライン", real: "リアル" };
const MATCHING_DAYS = 14;
const MIN_DURATION_MIN = 60;

let state = null;
let me = null;

// ---------- Boot ----------
window.addEventListener("DOMContentLoaded", async () => {
  state = await loadState();
  me = localStorage.getItem(ME_KEY) || state.members[0].id;
  renderHeader();
  bindTabs();
  bindAvailabilityButtons();
  bindReportForm();
  bindFilterBar();
  renderAll();
});

// ---------- Data layer ----------
async function loadState() {
  // 本番（Worker 設定済み）: 常に最新の共有データを Worker 経由で取得
  if (WORKER_URL) {
    try {
      const res = await fetch(WORKER_URL + "/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      setDataSourceLabel("🟢 共有サーバー");
      return data;
    } catch (e) {
      console.error("Worker GET 失敗", e);
      setDataSourceLabel("🔴 共有サーバー接続失敗", true);
    }
  }
  // 開発モード: localStorage に下書きがあればそれを優先、なければ state.json
  const local = localStorage.getItem(STORAGE_KEY);
  if (local) {
    try {
      setDataSourceLabel("localStorage（ローカル下書き）");
      return JSON.parse(local);
    } catch (e) { /* fall through */ }
  }
  try {
    const res = await fetch("data/state.json", { cache: "no-store" });
    const data = await res.json();
    setDataSourceLabel("data/state.json（ローカル初期データ）");
    return data;
  } catch (e) {
    setDataSourceLabel("デフォルト");
    return { schema_version: 1, members: [], availability: {}, sessions: [] };
  }
}

function setDataSourceLabel(text, isError) {
  const el = document.getElementById("data-source-label");
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? "#dc2626" : "";
}

// localStorage 退避（Worker 失敗時のドラフト保存用）
function persistLocal() {
  state.updated_at = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function workerPost(path, body) {
  if (!WORKER_URL) throw new Error("Worker URL 未設定");
  const res = await fetch(WORKER_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}

// ---------- Header ----------
function renderHeader() {
  const sel = document.getElementById("me-select");
  sel.innerHTML = "";
  for (const m of state.members) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.alias ? `${m.name}（${m.alias}）` : m.name;
    if (m.id === me) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => {
    me = sel.value;
    localStorage.setItem(ME_KEY, me);
    renderAll();
  });
}

// ---------- Tabs ----------
function bindTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });
}

// ---------- Render orchestration ----------
function renderAll() {
  renderDashboard();
  renderAvailability();
  renderMatching();
  renderReport();
}

// ---------- Dashboard ----------
function renderDashboard() {
  const members = state.members;
  const pairs = enumeratePairs(members);
  const doneCount = pairs.filter(p => isPairDone(p[0].id, p[1].id)).length;

  const overall = pairs.length === 0 ? 0 : Math.round((doneCount / pairs.length) * 100);
  document.getElementById("overall-rate").textContent = overall + "%";
  document.getElementById("overall-detail").textContent = `${doneCount} / ${pairs.length} ペア`;

  const myPairs = pairs.filter(p => p[0].id === me || p[1].id === me);
  const myDone = myPairs.filter(p => isPairDone(p[0].id, p[1].id)).length;
  const myRate = myPairs.length === 0 ? 0 : Math.round((myDone / myPairs.length) * 100);
  document.getElementById("my-rate").textContent = myRate + "%";
  document.getElementById("my-detail").textContent = `${myDone} / ${myPairs.length} 人`;

  renderMatrix();
  renderMyPending(myPairs);
}

function renderMatrix() {
  const table = document.getElementById("matrix");
  table.innerHTML = "";
  const members = state.members;

  // Header row
  const headRow = document.createElement("tr");
  headRow.appendChild(document.createElement("th")); // corner
  for (const m of members) {
    const th = document.createElement("th");
    th.textContent = m.alias || m.name;
    if (m.id === me) th.classList.add("cell-highlight");
    headRow.appendChild(th);
  }
  table.appendChild(headRow);

  // Body
  for (const rowMember of members) {
    const tr = document.createElement("tr");
    const rowHead = document.createElement("th");
    rowHead.classList.add("row-head");
    rowHead.textContent = rowMember.alias || rowMember.name;
    if (rowMember.id === me) rowHead.classList.add("cell-highlight");
    tr.appendChild(rowHead);

    for (const colMember of members) {
      const td = document.createElement("td");
      if (rowMember.id === colMember.id) {
        td.classList.add("cell-self");
        td.textContent = "—";
      } else {
        const status = pairStatus(rowMember.id, colMember.id);
        td.classList.add(`cell-${status}`);
        if (status === "done") td.textContent = "✓";
        if (status === "doing") td.textContent = "△";
        if (rowMember.id === me || colMember.id === me) td.classList.add("cell-highlight");
        td.title = `${rowMember.name} × ${colMember.name}: ${statusLabel(status)}`;
        td.addEventListener("click", () => showPairDetail(rowMember, colMember));
      }
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
}

function renderMyPending(myPairs) {
  const ul = document.getElementById("my-pending");
  ul.innerHTML = "";
  const pending = myPairs.filter(p => !isPairDone(p[0].id, p[1].id));
  if (pending.length === 0) {
    const li = document.createElement("li");
    li.textContent = "🎉 全員と1to1完了済みです！";
    ul.appendChild(li);
    return;
  }
  for (const [a, b] of pending) {
    const partner = a.id === me ? b : a;
    const candidates = matchPair(a, b);
    const li = document.createElement("li");
    const left = document.createElement("span");
    left.textContent = partner.alias ? `${partner.name}（${partner.alias}）` : partner.name;
    const right = document.createElement("span");
    right.className = "pair-card-count" + (candidates.length === 0 ? " zero" : "");
    right.textContent = `候補 ${candidates.length}枠`;
    li.appendChild(left);
    li.appendChild(right);
    ul.appendChild(li);
  }
}

function showPairDetail(a, b) {
  if (a.id === me || b.id === me) {
    document.querySelector(`.tab-btn[data-tab="matching"]`).click();
    setTimeout(() => {
      const target = document.getElementById(`pair-${pairKey(a.id, b.id)}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  } else {
    alert(`${a.name} × ${b.name}\nステータス: ${statusLabel(pairStatus(a.id, b.id))}\n（自分が含まれるペアはマッチングタブで詳細確認できます）`);
  }
}

// ---------- Availability tab ----------
function bindAvailabilityButtons() {
  document.getElementById("add-recurring").addEventListener("click", () => {
    ensureMember(me);
    state.availability[me].recurring.push({ dow: ["mon"], start: "10:00", end: "11:00", mode: "any" });
    renderAvailability();
  });
  document.getElementById("add-specific").addEventListener("click", () => {
    ensureMember(me);
    state.availability[me].specific.push({ date: todayISO(), start: "10:00", end: "11:00", mode: "any" });
    renderAvailability();
  });
  document.getElementById("save-availability").addEventListener("click", saveAvailability);
}

async function saveAvailability() {
  ensureMember(me);
  state.availability[me].note = document.getElementById("note-input").value;
  state.availability[me].updated_at = new Date().toISOString();

  if (WORKER_URL) {
    flashSaveStatus("保存中…");
    try {
      const data = await workerPost("/api/availability", {
        memberId: me,
        recurring: state.availability[me].recurring,
        specific: state.availability[me].specific,
        note: state.availability[me].note,
      });
      state = data.state;
      flashSaveStatus("✓ 共有サーバーに保存しました", "success");
    } catch (e) {
      persistLocal();
      flashSaveStatus("✗ サーバー保存失敗: " + e.message + "（localStorageには退避済）", "error");
    }
  } else {
    persistLocal();
    flashSaveStatus("✓ 保存しました（localStorage / ローカルのみ）", "success");
  }
  renderAll();
}

function ensureMember(id) {
  if (!state.availability[id]) {
    state.availability[id] = { recurring: [], specific: [], note: "", updated_at: "" };
  }
}

function renderAvailability() {
  ensureMember(me);
  const av = state.availability[me];
  renderRecurringList(av.recurring);
  renderSpecificList(av.specific);
  document.getElementById("note-input").value = av.note || "";
}

function renderRecurringList(list) {
  const wrap = document.getElementById("recurring-list");
  wrap.innerHTML = "";
  list.forEach((slot, idx) => {
    const row = document.createElement("div");
    row.className = "slot-row";

    // DOW picker
    const dowWrap = document.createElement("div");
    dowWrap.className = "dow-picker";
    DOW_ORDER.forEach(d => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dow-btn" + (slot.dow.includes(d) ? " active" : "");
      btn.textContent = DOW_LABELS[d];
      btn.addEventListener("click", () => {
        if (slot.dow.includes(d)) slot.dow = slot.dow.filter(x => x !== d);
        else slot.dow = [...slot.dow, d];
        renderRecurringList(list);
      });
      dowWrap.appendChild(btn);
    });
    row.appendChild(dowWrap);

    row.appendChild(timeInput("開始", slot.start, v => slot.start = v));
    row.appendChild(timeInput("終了", slot.end,   v => slot.end = v));
    row.appendChild(modeSelect(slot.mode, v => slot.mode = v));

    const rm = document.createElement("button");
    rm.className = "remove-slot";
    rm.textContent = "削除";
    rm.addEventListener("click", () => {
      list.splice(idx, 1);
      renderRecurringList(list);
    });
    row.appendChild(rm);

    wrap.appendChild(row);
  });
  if (list.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "定期枠は未登録です。「＋ 定期枠を追加」から登録してください。";
    wrap.appendChild(empty);
  }
}

function renderSpecificList(list) {
  const wrap = document.getElementById("specific-list");
  wrap.innerHTML = "";
  list.forEach((slot, idx) => {
    const row = document.createElement("div");
    row.className = "slot-row";

    const dateLabel = document.createElement("label");
    dateLabel.textContent = "日付";
    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.value = slot.date;
    dateInput.addEventListener("change", () => slot.date = dateInput.value);
    dateLabel.appendChild(dateInput);
    row.appendChild(dateLabel);

    row.appendChild(timeInput("開始", slot.start, v => slot.start = v));
    row.appendChild(timeInput("終了", slot.end,   v => slot.end = v));
    row.appendChild(modeSelect(slot.mode, v => slot.mode = v));

    const rm = document.createElement("button");
    rm.className = "remove-slot";
    rm.textContent = "削除";
    rm.addEventListener("click", () => {
      list.splice(idx, 1);
      renderSpecificList(list);
    });
    row.appendChild(rm);

    wrap.appendChild(row);
  });
  if (list.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "個別枠は未登録です。「＋ 個別枠を追加」から登録してください。";
    wrap.appendChild(empty);
  }
}

function timeInput(labelText, value, onChange) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "time";
  input.value = value;
  input.addEventListener("change", () => onChange(input.value));
  label.appendChild(input);
  return label;
}

function modeSelect(value, onChange) {
  const label = document.createElement("label");
  label.textContent = "形式";
  const sel = document.createElement("select");
  for (const k of Object.keys(MODE_LABELS)) {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = MODE_LABELS[k];
    if (k === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => onChange(sel.value));
  label.appendChild(sel);
  return label;
}

function flashSaveStatus(text, kind) {
  const el = document.getElementById("save-status");
  el.textContent = text;
  el.className = "save-status " + (kind || "");
  setTimeout(() => { el.textContent = ""; el.className = "save-status"; }, 3000);
}

// ---------- Matching tab ----------
function bindFilterBar() {
  document.getElementById("filter-mine").addEventListener("change", renderMatching);
  document.getElementById("filter-mode").addEventListener("change", renderMatching);
}

function renderMatching() {
  const wrap = document.getElementById("matching-list");
  wrap.innerHTML = "";
  const filterMine = document.getElementById("filter-mine")?.checked;
  const filterMode = document.getElementById("filter-mode")?.value || "all";

  const pairs = enumeratePairs(state.members)
    .filter(p => !isPairDone(p[0].id, p[1].id))
    .filter(p => !filterMine || p[0].id === me || p[1].id === me)
    .map(p => ({ pair: p, candidates: matchPair(p[0], p[1]) }))
    .map(x => ({
      ...x,
      candidates: filterMode === "all"
        ? x.candidates
        : x.candidates.filter(c => c.mode === filterMode || (filterMode === "any" && c.mode === "any"))
    }))
    .sort((a, b) => a.candidates.length - b.candidates.length);

  if (pairs.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "未完了ペアはありません。";
    wrap.appendChild(p);
    return;
  }

  for (const { pair, candidates } of pairs) {
    const [a, b] = pair;
    const card = document.createElement("div");
    card.className = "pair-card";
    card.id = `pair-${pairKey(a.id, b.id)}`;

    const header = document.createElement("div");
    header.className = "pair-card-header";
    const title = document.createElement("div");
    title.className = "pair-card-title";
    title.textContent = `${nameOf(a)} × ${nameOf(b)}`;
    const count = document.createElement("span");
    count.className = "pair-card-count" + (candidates.length === 0 ? " zero" : "");
    count.textContent = `候補 ${candidates.length}枠`;
    header.appendChild(title);
    header.appendChild(count);
    card.appendChild(header);

    if (candidates.length === 0) {
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = "両者の空き枠が合いません。どちらかが空き枠を追加すると候補が出ます。";
      card.appendChild(note);
    } else {
      const list = document.createElement("ul");
      list.className = "candidate-list";
      candidates.slice(0, 12).forEach(c => {
        const chip = document.createElement("li");
        chip.className = "candidate-chip " + c.mode;
        chip.textContent = `${formatJP(c.date)} ${c.start}–${c.end}${c.mode === "any" ? "" : " " + MODE_LABELS[c.mode]}`;
        list.appendChild(chip);
      });
      card.appendChild(list);
      if (candidates.length > 12) {
        const more = document.createElement("p");
        more.className = "hint";
        more.textContent = `… 他 ${candidates.length - 12} 枠`;
        card.appendChild(more);
      }
    }
    wrap.appendChild(card);
  }
}

// ---------- Report tab ----------
function bindReportForm() {
  const form = document.getElementById("report-form");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const partner = document.getElementById("report-partner").value;
    const date = document.getElementById("report-date").value;
    const start = document.getElementById("report-start").value;
    const duration = parseInt(document.getElementById("report-duration").value, 10);
    const mode = document.getElementById("report-mode").value;
    if (!partner || !date || !start) return;

    const session = {
      pair: [me, partner].sort(),
      datetime: `${date}T${start}:00+09:00`,
      duration_min: duration,
      mode,
      reported_by: me,
      reported_at: new Date().toISOString(),
    };

    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      if (WORKER_URL) {
        const data = await workerPost("/api/sessions", { action: "add", session });
        state = data.state;
        alert("✓ 共有サーバーに記録しました！");
      } else {
        if (!state.sessions) state.sessions = [];
        state.sessions.push(session);
        persistLocal();
        alert("✓ 記録しました（localStorage / ローカルのみ）");
      }
      form.reset();
      document.getElementById("report-duration").value = "90";
      renderAll();
    } catch (e2) {
      alert("✗ 記録失敗: " + e2.message);
    } finally {
      btn.disabled = false;
    }
  });
}

function renderReport() {
  const sel = document.getElementById("report-partner");
  sel.innerHTML = "";
  const others = state.members.filter(m => m.id !== me);
  for (const m of others) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = nameOf(m);
    sel.appendChild(opt);
  }

  const ul = document.getElementById("sessions-list");
  ul.innerHTML = "";
  const sorted = [...state.sessions].sort((a, b) => (a.datetime < b.datetime ? 1 : -1));
  if (sorted.length === 0) {
    const li = document.createElement("li");
    li.textContent = "まだ記録されたセッションはありません。";
    ul.appendChild(li);
    return;
  }
  for (const s of sorted) {
    const [aId, bId] = s.pair;
    const a = state.members.find(m => m.id === aId);
    const b = state.members.find(m => m.id === bId);
    const li = document.createElement("li");
    const when = s.datetime.slice(0, 16).replace("T", " ");
    li.textContent = `${when}  ${nameOf(a)} × ${nameOf(b)}  ${s.duration_min}分  ${MODE_LABELS[s.mode]}`;
    ul.appendChild(li);
  }
}

// ---------- Pair / Status logic ----------
function enumeratePairs(members) {
  const out = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      out.push([members[i], members[j]]);
    }
  }
  return out;
}

function pairKey(a, b) {
  return [a, b].sort().join("__");
}

function isPairDone(aId, bId) {
  const key = pairKey(aId, bId);
  return state.sessions.some(s => pairKey(s.pair[0], s.pair[1]) === key);
}

function pairStatus(aId, bId) {
  if (isPairDone(aId, bId)) return "done";
  const a = state.members.find(m => m.id === aId);
  const b = state.members.find(m => m.id === bId);
  const candidates = matchPair(a, b);
  return candidates.length > 0 ? "doing" : "pending";
}

function statusLabel(s) {
  return s === "done" ? "完了" : s === "doing" ? "候補あり" : "候補なし";
}

function nameOf(m) {
  return m.alias ? `${m.name}（${m.alias}）` : m.name;
}

// ---------- Matching algorithm ----------
function matchPair(a, b) {
  const slotsA = expandSlots(a.id, MATCHING_DAYS);
  const slotsB = expandSlots(b.id, MATCHING_DAYS);
  const candidates = [];
  // group by date for O(n) per date
  const byDateB = new Map();
  for (const s of slotsB) {
    if (!byDateB.has(s.date)) byDateB.set(s.date, []);
    byDateB.get(s.date).push(s);
  }
  for (const s of slotsA) {
    const sameDay = byDateB.get(s.date) || [];
    for (const t of sameDay) {
      const overlap = intersectSlot(s, t);
      if (!overlap) continue;
      candidates.push(overlap);
    }
  }
  // merge duplicates / overlaps on same date
  candidates.sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
  return candidates;
}

function expandSlots(memberId, days) {
  const av = state.availability[memberId];
  if (!av) return [];
  const out = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const iso = isoDate(d);
    const dow = DOW_ORDER[(d.getDay() + 6) % 7]; // JS Sun=0 → our index
    for (const r of av.recurring || []) {
      if ((r.dow || []).includes(dow)) {
        out.push({ date: iso, start: r.start, end: r.end, mode: r.mode || "any" });
      }
    }
  }
  for (const s of av.specific || []) {
    if (!s.date) continue;
    const dDate = new Date(s.date + "T00:00:00");
    const diff = Math.floor((dDate - today) / 86400000);
    if (diff >= 0 && diff < days) {
      out.push({ date: s.date, start: s.start, end: s.end, mode: s.mode || "any" });
    }
  }
  return out;
}

function intersectSlot(a, b) {
  const start = a.start > b.start ? a.start : b.start;
  const end   = a.end   < b.end   ? a.end   : b.end;
  if (start >= end) return null;
  if (diffMinutes(start, end) < MIN_DURATION_MIN) return null;
  const mode = combineModes(a.mode, b.mode);
  if (!mode) return null;
  return { date: a.date, start, end, mode };
}

function combineModes(a, b) {
  if (a === b) return a;
  if (a === "any") return b;
  if (b === "any") return a;
  return null; // online vs real → incompatible
}

function diffMinutes(start, end) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

// ---------- Date helpers ----------
function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function todayISO() { return isoDate(new Date()); }

function formatJP(iso) {
  const d = new Date(iso + "T00:00:00");
  const dow = ["日","月","火","水","木","金","土"][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${dow})`;
}
