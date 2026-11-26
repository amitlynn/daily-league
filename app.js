/* ליגת המשחקים היומיים */
const C = window.CONFIG;
const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, { auth: { persistSession: false } });
const S = window.Stats;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const AVATARS = ["🙂","😎","🤓","🦊","🐼","🐸","🦁","🐯","🐵","🦄","🐙","🦖","👾","🤖","👻","🎃","⚽","🏀","🎬","🧠","🔥","⭐","🍕","🌮"];
const HE_DAYS = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

const state = {
  me: null, games: [], players: [], results: [], pmap: {}, gmap: {},
  viewDate: null, rankPeriod: "week", rankGame: "", rankOffset: 0, loaded: false
};

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: C.TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function niceDate(d) {
  const t = today();
  if (d === t) return "היום";
  if (d === S.addDays(t, -1)) return "אתמול";
  const dt = new Date(d + "T12:00:00Z");
  return `יום ${HE_DAYS[dt.getUTCDay()]}, ${dt.getUTCDate()}.${dt.getUTCMonth() + 1}`;
}
const shortDate = d => { const dt = new Date(d + "T12:00:00Z"); return `${dt.getUTCDate()}.${dt.getUTCMonth() + 1}`; };
function fmtScore(g, s) {
  if (s == null) return "—";
  const v = (+s).toFixed(g?.decimals ?? 0);
  return g && g.id === "fermi" ? v + "×" : (+v).toLocaleString("he-IL", { maximumFractionDigits: g?.decimals ?? 0 });
}
const fmtPct = p => { if (p == null) return "—"; const t = 100 - p; return "טופ " + (t < 1 ? t.toFixed(1) : Math.round(t)) + "%"; };
function toast(msg, err) {
  const t = $("#toast"); t.textContent = msg; t.className = "toast" + (err ? " err" : "");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), 2800);
}
const ERRORS = { NAME_TAKEN: "השם הזה כבר תפוס", NAME_LENGTH: "שם צריך להיות 2–20 תווים", BAD_CODE: "קוד לא נכון", AUTH: "בעיה בהתחברות – נסה שוב", NO_PROOF: "חייב צילום מסך", BAD_DATE: "אפשר להוסיף רק עד 3 ימים אחורה", SCORE_RANGE: "הניקוד מחוץ לטווח", NO_GAME: "משחק לא קיים", NO_PCT: "חייב להכניס אחוזון מהמשחק", PCT_RANGE: "אחוזון בין 0 ל-100" };
const errMsg = e => { const m = (e?.message || "") ; for (const k in ERRORS) if (m.includes(k)) return ERRORS[k]; return "שגיאה: " + m; };

/* ---------- auth (device based) ---------- */
function loadMe() { try { return JSON.parse(localStorage.getItem("dg_me")); } catch { return null; } }
function saveMe(m) { try { localStorage.setItem("dg_me", JSON.stringify(m)); } catch {} state.me = m; }

/* ---------- data ---------- */
async function loadAll() {
  const [g, p] = await Promise.all([
    sb.from("games").select("*").eq("active", true).order("sort_order"),
    sb.from("players").select("id,name,avatar,created_at").order("created_at")
  ]);
  if (g.error) throw g.error; if (p.error) throw p.error;
  let res = [], from = 0;
  while (true) {
    const r = await sb.from("results").select("id,player_id,game_id,play_date,score,top_pct,proof_url,note,created_at").order("play_date").range(from, from + 999);
    if (r.error) throw r.error;
    res = res.concat(r.data); if (r.data.length < 1000) break; from += 1000;
  }
  state.games = g.data; state.players = p.data; state.results = res;
  state.gmap = Object.fromEntries(g.data.map(x => [x.id, x]));
  state.pmap = Object.fromEntries(p.data.map(x => [x.id, x]));
  S.annotate(state.results, state.games);
  state.loaded = true;
  if (state.me && !state.pmap[state.me.id]) { localStorage.removeItem("dg_me"); state.me = null; }
  if (state.me) { const pm = state.pmap[state.me.id]; state.me.name = pm.name; state.me.avatar = pm.avatar; }
}
const P = id => state.pmap[id] || { name: "?", avatar: "❔" };
const pname = id => `<span class="av">${esc(P(id).avatar)}</span><span class="name grow">${esc(P(id).name)}</span>`;

/* ---------- router ---------- */
const routes = { today: viewToday, rank: viewRank, records: viewRecords, players: viewPlayers, player: viewPlayer, me: viewMe };
function render() {
  if (!state.loaded) return;
  if (!state.me) { $("#nav").classList.add("hidden"); $("#fab").classList.add("hidden"); $("#me-chip").innerHTML = ""; return viewWelcome(); }
  $("#nav").classList.remove("hidden"); $("#fab").classList.remove("hidden");
  $("#me-chip").innerHTML = `${esc(state.me.avatar)} ${esc(state.me.name)}`;
  const [r, arg] = (location.hash.slice(1) || "today").split("/");
  document.querySelectorAll(".nav a").forEach(a => a.classList.toggle("on", a.dataset.r === (r === "player" ? "players" : r)));
  (routes[r] || viewToday)(arg ? decodeURIComponent(arg) : undefined);
}
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });

/* ---------- welcome ---------- */
function viewWelcome() {
  let av = AVATARS[Math.floor(Math.random() * AVATARS.length)];
  $("#app").innerHTML = `
  <div class="hero"><div class="big">🏆</div><h2>ברוכים הבאים לליגה!</h2>
  <p class="muted">כל יום מוסיפים תוצאות של המשחקים היומיים ומתחרים בחברים.</p></div>
  <div class="card">
    <label>איך קוראים לך?</label>
    <input id="nm" maxlength="20" placeholder="השם שיופיע לכולם" autocomplete="off">
    <label>בחר אווטאר</label>
    <div class="avatars" id="avs">${AVATARS.map(a => `<button data-a="${a}" class="${a === av ? "on" : ""}">${a}</button>`).join("")}</div>
    <div style="height:14px"></div>
    <button class="btn block" id="go">יאללה, נכנסים</button>
    <p class="muted small" style="text-align:center">המכשיר הזה יזכור אותך. אין סיסמה.</p>
  </div>
  <div class="card"><h3>כבר יש לך משתמש במכשיר אחר?</h3>
    <p class="muted small">היכנס ל"אני" במכשיר הישן והעתק את קוד ההעברה.</p>
    <input id="code" placeholder="הדבק קוד העברה" autocomplete="off" dir="ltr">
    <div style="height:8px"></div><button class="btn sec block" id="login">התחבר עם קוד</button>
  </div>`;
  $("#avs").onclick = e => { const b = e.target.closest("button"); if (!b) return; av = b.dataset.a; document.querySelectorAll("#avs button").forEach(x => x.classList.toggle("on", x === b)); };
  $("#go").onclick = async () => {
    const name = $("#nm").value.trim(); if (name.length < 2) return toast("שם צריך להיות לפחות 2 תווים", 1);
    $("#go").disabled = true;
    const { data, error } = await sb.rpc("register_player", { p_name: name, p_avatar: av });
    $("#go").disabled = false;
    if (error) return toast(errMsg(error), 1);
    saveMe(data); await refresh(); location.hash = "#today"; toast("ברוך הבא, " + data.name + "!");
  };
  $("#login").onclick = async () => {
    const { data, error } = await sb.rpc("login_with_code", { p_code: $("#code").value.trim() });
    if (error) return toast(errMsg(error), 1);
    saveMe(data); await refresh(); location.hash = "#today"; toast("התחברת בתור " + data.name);
  };
}

/* ---------- today ---------- */
function viewToday() {
  const t = today();
  const d = state.viewDate || t;
  const dayRes = state.results.filter(r => r.play_date === d);
  const overall = S.dailyOverall(state.results, d);
  const myCount = dayRes.filter(r => r.player_id === state.me.id).length;
  let h = `
  <div class="datebar"><button id="dp">→</button>
    <div class="d">${niceDate(d)} <span class="muted small">${shortDate(d)}</span></div>
    <button id="dn" ${d >= t ? "disabled" : ""}>←</button></div>`;
  if (d === t) h += `<div class="card row between"><div><b>עשית ${myCount} מתוך ${state.games.length} היום</b>
    <div class="bar" style="margin-top:6px;width:180px"><i style="width:${(myCount / Math.max(1, state.games.length)) * 100}%"></i></div></div>
    <button class="btn small" onclick="openSubmit()">＋ הוסף</button></div>`;
  h += `<div class="card"><h3>👑 דירוג כללי – ${niceDate(d)}</h3>
    <p class="muted small" style="margin:-4px 0 8px">לפי ממוצע האחוזונים מהמשחקים עצמם (טופ X%). מי שלא שיחק במשחק לא נפגע.</p>`;
  h += overall.length ? `<div class="list">${overall.map((r, i) => `
     <a class="li ${r.player_id === state.me.id ? "me" : ""}" href="#player/${r.player_id}" style="text-decoration:none">
      <span class="pos p${i + 1}">${r.avgPct == null ? "·" : i + 1}</span>${pname(r.player_id)}
      <span class="badge">${r.games} משחקים</span>${r.wins ? `<span class="badge ok">🥇${r.wins}</span>` : ""}
      <span class="pct">${fmtPct(r.avgPct)}</span></a>`).join("")}</div>` : `<div class="empty">עוד אין תוצאות ליום הזה</div>`;
  h += `</div>`;
  for (const g of state.games) {
    const list = dayRes.filter(r => r.game_id === g.id).sort((a, b) => a.rank - b.rank);
    const mine = list.find(r => r.player_id === state.me.id);
    h += `<div class="card"><div class="game-head"><div class="emoji">${esc(g.emoji)}</div>
      <div class="grow"><h3 style="margin:0">${esc(g.name)}</h3><div class="muted small">${g.higher_better ? "גבוה יותר = טוב יותר" : "נמוך יותר = טוב יותר"} · ${list.length} שחקנים</div></div>
      <a class="btn small ghost" href="${esc(g.url)}" target="_blank" rel="noopener">שחק ↗</a>
      ${d >= S.addDays(t, -3) ? `<button class="btn small ${mine ? "sec" : ""}" onclick="openSubmit('${g.id}','${d}')">${mine ? "ערוך" : "＋"}</button>` : ""}</div>`;
    h += list.length ? `<div class="list">${list.map(r => `
      <div class="li ${r.player_id === state.me.id ? "me" : ""}">
        <span class="pos p${r.rank}">${r.rank}</span>${pname(r.player_id)}
        <span class="score">${fmtScore(g, r.score)}</span><span class="pct">${fmtPct(r.pct)}</span>
        <img class="thumb" src="${esc(r.proof_url)}" loading="lazy" onclick="openProof('${r.id}')" alt="">
      </div>`).join("")}</div>` : `<div class="empty">אף אחד עוד לא שיחק</div>`;
    h += `</div>`;
  }
  $("#app").innerHTML = h;
  $("#dp").onclick = () => { state.viewDate = S.addDays(d, -1); render(); };
  $("#dn").onclick = () => { if (d < t) { state.viewDate = S.addDays(d, 1); render(); } };
}

/* ---------- rankings ---------- */
function periodRange() {
  const t = today(), o = state.rankOffset;
  if (state.rankPeriod === "day") { const d = S.addDays(t, -o); return { from: d, to: d, label: niceDate(d) }; }
  if (state.rankPeriod === "week") { const f = S.addDays(S.weekStart(t), -7 * o); const to = S.addDays(f, 6); return { from: f, to, label: `${shortDate(f)} – ${shortDate(to)}` + (o === 0 ? " (השבוע)" : "") }; }
  if (state.rankPeriod === "month") {
    const [y, m] = t.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1 - o, 1));
    const f = dt.toISOString().slice(0, 10); const to = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    return { from: f, to, label: `${HE_MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}` };
  }
  return { from: null, to: null, label: "מאז ומעולם" };
}
function viewRank() {
  const pr = periodRange();
  const rows = S.ranking(state.results, { from: pr.from, to: pr.to, game: state.rankGame || null });
  const g = state.gmap[state.rankGame];
  const minRated = { day: 1, week: 2, month: 4, all: 6 }[state.rankPeriod] * (state.rankGame ? 1 : 1);
  const ranked = rows.filter(r => r.rated >= minRated), unranked = rows.filter(r => r.rated < minRated);
  let h = `<h2>📊 דירוג</h2>
  <div class="tabs">${[["day", "יומי"], ["week", "שבועי"], ["month", "חודשי"], ["all", "כל הזמנים"]].map(([k, v]) => `<button class="chip ${state.rankPeriod === k ? "on" : ""}" data-p="${k}">${v}</button>`).join("")}</div>
  <div class="tabs"><button class="chip ${!state.rankGame ? "on" : ""}" data-g="">כל המשחקים</button>${state.games.map(x => `<button class="chip ${state.rankGame === x.id ? "on" : ""}" data-g="${x.id}">${esc(x.emoji)} ${esc(x.name)}</button>`).join("")}</div>`;
  if (state.rankPeriod !== "all") h += `<div class="datebar"><button id="rp">→</button><div class="d">${pr.label}</div><button id="rn" ${state.rankOffset === 0 ? "disabled" : ""}>←</button></div>`;
  h += `<div class="card"><div class="muted small" style="margin-bottom:8px">מדורג לפי ממוצע האחוזון שהמשחקים עצמם נותנים (טופ X% – נמוך = טוב). צריך לפחות ${minRated} תוצאות כדי להיכנס לטבלה.</div>`;
  if (!rows.length) h += `<div class="empty">אין תוצאות בתקופה הזו</div>`;
  else {
    h += `<table><tr><th>#</th><th style="text-align:right">שחקן</th><th>אחוזון</th><th>🥇</th><th>תוצאות</th>${g ? `<th>ממוצע</th>` : `<th>ימים</th>`}</tr>`;
    ranked.forEach((r, i) => { h += `<tr><td><span class="pos p${i + 1}">${i + 1}</span></td><td><a href="#player/${r.player_id}" class="row" style="text-decoration:none">${pname(r.player_id)}</a></td><td class="pct" style="text-align:center">${fmtPct(r.avgPct)}</td><td>${r.wins}</td><td>${r.entries}</td><td>${g ? fmtScore(g, r.avgScore) : r.days}</td></tr>`; });
    unranked.forEach(r => { h += `<tr style="opacity:.55"><td>·</td><td><a href="#player/${r.player_id}" class="row" style="text-decoration:none">${pname(r.player_id)}</a></td><td style="text-align:center">${fmtPct(r.avgPct)}</td><td>${r.wins}</td><td>${r.entries}</td><td>${g ? fmtScore(g, r.avgScore) : r.days}</td></tr>`; });
    h += `</table>`;
  }
  h += `</div>`;
  $("#app").innerHTML = h;
  document.querySelectorAll("[data-p]").forEach(b => b.onclick = () => { state.rankPeriod = b.dataset.p; state.rankOffset = 0; render(); });
  document.querySelectorAll("[data-g]").forEach(b => b.onclick = () => { state.rankGame = b.dataset.g; render(); });
  if ($("#rp")) { $("#rp").onclick = () => { state.rankOffset++; render(); }; $("#rn").onclick = () => { if (state.rankOffset > 0) { state.rankOffset--; render(); } }; }
}

/* ---------- records ---------- */
function viewRecords() {
  const rec = S.records(state.results, state.games, state.players, today());
  const who = x => (x ? (x.tied || [x.pid]).slice(0, 4).map(id => `${esc(P(id).avatar)} ${esc(P(id).name)}`).join(", ") + ((x.tied || []).length > 4 ? ` ועוד ${x.tied.length - 4}` : "") : "—");
  let h = `<h2>🥇 שיאים</h2><div class="card"><h3>שיאים כלליים</h3>`;
  for (const [ic, title, x, key, unit] of rec.overall) {
    h += `<div class="rec"><div class="ic">${ic}</div><div class="grow"><div>${title}</div><div class="muted small">${who(x)}</div></div>
      <div class="score">${x ? (key === "avgPct" ? fmtPct(x[key]) : x[key] + " " + unit) : "—"}</div></div>`;
  }
  h += `</div>`;
  for (const pg of rec.perGame) {
    const g = pg.game;
    h += `<div class="card"><div class="game-head"><div class="emoji">${esc(g.emoji)}</div><h3 style="margin:0">${esc(g.name)}</h3></div>`;
    if (pg.empty) { h += `<div class="empty">עוד אין תוצאות</div></div>`; continue; }
    const b = pg.bestScore;
    const items = [
      ["🎯", "הניקוד הכי טוב", b ? `${esc(P(b.player_id).avatar)} ${esc(P(b.player_id).name)} · ${shortDate(b.play_date)}` : "—", b ? fmtScore(g, b.score) : "—", b ? `onclick="openProof('${b.id}')"` : ""],
      ["🔥", "הסטריק הכי ארוך", who(pg.longestStreak), pg.longestStreak ? pg.longestStreak.best + " ימים" : "—"],
      ["⚡", "סטריק פעיל", who(pg.currentStreak), pg.currentStreak ? pg.currentStreak.cur + " ימים" : "—"],
      ["📆", "הכי הרבה ימים", who(pg.mostDays), pg.mostDays ? pg.mostDays.days + " ימים" : "—"],
      ["🥇", "הכי הרבה ניצחונות", who(pg.mostWins), pg.mostWins ? pg.mostWins.wins : "—"],
      ["📈", "האחוזון הממוצע הכי טוב (מינ׳ 5)", who(pg.bestAvg), pg.bestAvg ? fmtPct(pg.bestAvg.avgPct) : "—"]
    ];
    for (const [ic, t, w, v, extra] of items) h += `<div class="rec" ${extra || ""}><div class="ic">${ic}</div><div class="grow"><div>${t}</div><div class="muted small">${w}</div></div><div class="score">${v}</div></div>`;
    h += `</div>`;
  }
  $("#app").innerHTML = h;
}

/* ---------- players ---------- */
function viewPlayers() {
  const t = today();
  const rows = state.players.map(p => ({ p, s: S.playerStats(p.id, state.results, state.games, t) }))
    .sort((a, b) => (b.s.avgPct ?? -1) - (a.s.avgPct ?? -1));
  let h = `<h2>👥 שחקנים (${state.players.length})</h2>`;
  h += `<div class="list">${rows.map(({ p, s }) => `
    <a class="li ${p.id === state.me.id ? "me" : ""}" href="#player/${p.id}" style="text-decoration:none">
      ${pname(p.id)}<span class="badge">🔥${s.streak}</span><span class="badge">${s.entries} תוצאות</span><span class="pct">${fmtPct(s.avgPct)}</span></a>`).join("")}</div>`;
  h += `<p class="muted small" style="text-align:center;margin-top:14px">שלח לחברים את הקישור לאתר כדי שיצטרפו 🔗</p>
  <button class="btn sec block" onclick="shareLink()">שתף קישור</button>`;
  $("#app").innerHTML = h;
}
function spark(series) {
  const pts = series.map((s, i) => [i, s.v]).filter(x => x[1] != null);
  if (pts.length < 2) return `<div class="muted small">אין מספיק נתונים לגרף</div>`;
  const W = 300, H = 60, n = series.length - 1;
  const xy = ([i, v]) => [W - (i / n) * W, H - 4 - (v / 100) * (H - 8)];
  const d = pts.map((p, k) => (k ? "L" : "M") + xy(p).map(x => x.toFixed(1)).join(",")).join(" ");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#2b3156" stroke-dasharray="4"/>
    <path d="${d}" fill="none" stroke="#22d3a6" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
    ${pts.map(p => { const [x, y] = xy(p); return `<circle cx="${x}" cy="${y}" r="3" fill="#7c5cff"/>`; }).join("")}</svg>`;
}
function viewPlayer(id) {
  const p = state.pmap[id]; if (!p) return viewPlayers();
  const t = today(); const s = S.playerStats(id, state.results, state.games, t);
  let h = `<div class="hero" style="padding:16px"><div class="big">${esc(p.avatar)}</div><h2 style="margin:6px">${esc(p.name)}</h2>
    <div class="muted small">הצטרף ב-${shortDate(p.created_at.slice(0, 10))}</div></div>
  <div class="grid3">
    <div class="stat"><b>${fmtPct(s.avgPct)}</b><span>אחוזון ממוצע</span></div>
    <div class="stat"><b>🔥 ${s.streak}</b><span>סטריק (שיא ${s.bestStreak})</span></div>
    <div class="stat"><b>${s.wins}</b><span>ניצחונות</span></div>
    <div class="stat"><b>${s.entries}</b><span>תוצאות</span></div>
    <div class="stat"><b>${s.days}</b><span>ימי משחק</span></div>
    <div class="stat"><b>${s.podiums}</b><span>פודיומים</span></div>
  </div>
  <div class="card" style="margin-top:12px"><h3>📈 אחוזון שבועי (8 שבועות)</h3>${spark(S.weeklySeries(id, state.results, t))}</div>
  <div class="card"><h3>לפי משחק</h3><table><tr><th>משחק</th><th>ימים</th><th>אחוזון</th><th>ממוצע</th><th>שיא</th><th>🥇</th><th>🔥</th></tr>
  ${s.per.map(x => `<tr><td>${esc(x.game.emoji)} ${esc(x.game.name)}</td><td>${x.count}</td><td class="pct" style="text-align:center">${fmtPct(x.avgPct)}</td><td>${fmtScore(x.game, x.avgScore)}</td><td>${x.best ? fmtScore(x.game, x.best.score) : "—"}</td><td>${x.wins}</td><td>${x.streak}<span class="muted small">/${x.bestStreak}</span></td></tr>`).join("")}
  </table><div class="muted small" style="margin-top:6px">🔥 = סטריק נוכחי / שיא</div></div>`;
  // calendar: last 28 days
  const start = S.addDays(S.weekStart(t), -21);
  h += `<div class="card"><h3>🗓️ 4 שבועות אחרונים</h3><div class="cal">${["א","ב","ג","ד","ה","ו","ש"].map(d => `<div style="background:none">${d}</div>`).join("")}`;
  for (let i = 0; i < 28; i++) {
    const d = S.addDays(start, i);
    const c = s.mine.filter(r => r.play_date === d).length;
    const op = c ? 0.25 + 0.75 * (c / state.games.length) : 0;
    h += `<div title="${d}" style="${d > t ? "opacity:.2;" : ""}${c ? `background:rgba(124,92,255,${op})` : ""}">${c || ""}</div>`;
  }
  h += `</div></div>`;
  if (id !== state.me.id) {
    const hh = S.headToHead(state.me.id, id, state.results);
    h += `<div class="card"><h3>⚔️ ראש בראש: אתה מול ${esc(p.name)}</h3>
      <div class="grid3"><div class="stat"><b>${hh.a}</b><span>ניצחת</span></div><div class="stat"><b>${hh.ties}</b><span>תיקו</span></div><div class="stat"><b>${hh.b}</b><span>הפסדת</span></div></div></div>`;
  } else {
    const rivals = state.players.filter(x => x.id !== id).map(x => ({ x, hh: S.headToHead(id, x.id, state.results) })).filter(r => r.hh.a + r.hh.b + r.hh.ties);
    if (rivals.length) h += `<div class="card"><h3>⚔️ ראש בראש מול כולם</h3><div class="list">${rivals.map(r => `<a class="li" href="#player/${r.x.id}" style="text-decoration:none">${pname(r.x.id)}<span class="score" style="color:var(--acc2)">${r.hh.a}</span>–<span class="score" style="color:var(--bad)">${r.hh.b}</span></a>`).join("")}</div></div>`;
  }
  const recent = [...s.mine].sort((a, b) => b.play_date.localeCompare(a.play_date)).slice(0, 15);
  h += `<div class="card"><h3>תוצאות אחרונות</h3><div class="list">${recent.map(r => `<div class="li"><span class="av">${esc(state.gmap[r.game_id]?.emoji)}</span><span class="grow">${esc(state.gmap[r.game_id]?.name)} <span class="muted small">${shortDate(r.play_date)}</span></span><span class="score">${fmtScore(state.gmap[r.game_id], r.score)}</span><span class="badge">${r.n > 1 ? `#${r.rank}/${r.n}` : "לבד"}</span><img class="thumb" src="${esc(r.proof_url)}" loading="lazy" onclick="openProof('${r.id}')" alt=""></div>`).join("") || `<div class="empty">אין עדיין</div>`}</div></div>`;
  $("#app").innerHTML = h;
}

/* ---------- me ---------- */
function viewMe() {
  const me = state.me;
  let av = me.avatar;
  const mine = state.results.filter(r => r.player_id === me.id).sort((a, b) => b.play_date.localeCompare(a.play_date) || a.game_id.localeCompare(b.game_id));
  let h = `<h2>⚙️ הפרופיל שלי</h2>
  <div class="card"><label>שם</label><input id="nm" value="${esc(me.name)}" maxlength="20">
    <label>אווטאר</label><div class="avatars" id="avs">${AVATARS.map(a => `<button data-a="${a}" class="${a === av ? "on" : ""}">${a}</button>`).join("")}</div>
    <div style="height:10px"></div><button class="btn block" id="save">שמור</button></div>
  <div class="card"><h3>📱 הוספה למסך הבית</h3>
    <p class="muted small">ב-Chrome: תפריט ⋮ ← "הוספה למסך הבית" / "התקנת אפליקציה". באייפון (Safari): כפתור שיתוף ← "הוסף למסך הבית".</p>
    <button class="btn sec block hidden" id="install">התקן עכשיו</button></div>
  <div class="card"><h3>🔑 קוד העברה למכשיר אחר</h3>
    <p class="muted small">אל תשתף אותו! עם הקוד הזה אפשר להתחבר אליך ממכשיר אחר.</p>
    <div class="code hidden" id="cd">${esc(me.secret)}</div><div style="height:8px"></div>
    <div class="row"><button class="btn sec grow" id="show">הצג קוד</button><button class="btn sec grow" id="copy">העתק</button></div></div>
  <div class="card"><h3>התוצאות שלי (${mine.length})</h3><div class="list">${mine.slice(0, 60).map(r => `
    <div class="li"><span class="av">${esc(state.gmap[r.game_id]?.emoji)}</span><span class="grow">${esc(state.gmap[r.game_id]?.name)} <span class="muted small">${shortDate(r.play_date)}</span></span>
    <span class="score">${fmtScore(state.gmap[r.game_id], r.score)}</span>
    <button class="btn small danger" data-del="${r.id}">מחק</button></div>`).join("") || `<div class="empty">אין עדיין</div>`}</div></div>
  <button class="btn ghost block" id="out">התנתק מהמכשיר</button>
  <p class="muted small" style="text-align:center">לפני שמתנתקים – שמור את קוד ההעברה!</p>`;
  $("#app").innerHTML = h;
  $("#avs").onclick = e => { const b = e.target.closest("button"); if (!b) return; av = b.dataset.a; document.querySelectorAll("#avs button").forEach(x => x.classList.toggle("on", x === b)); };
  $("#save").onclick = async () => {
    const { data, error } = await sb.rpc("update_profile", { p_id: me.id, p_secret: me.secret, p_name: $("#nm").value, p_avatar: av });
    if (error) return toast(errMsg(error), 1);
    saveMe(data); await refresh(); toast("נשמר ✓");
  };
  $("#show").onclick = () => $("#cd").classList.toggle("hidden");
  $("#copy").onclick = async () => { try { await navigator.clipboard.writeText(me.secret); toast("הקוד הועתק"); } catch { $("#cd").classList.remove("hidden"); toast("העתק ידנית", 1); } };
  $("#out").onclick = () => { if (confirm("להתנתק? בלי קוד ההעברה לא תוכל לחזור למשתמש.")) { localStorage.removeItem("dg_me"); state.me = null; render(); } };
  document.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (!confirm("למחוק את התוצאה?")) return;
    const { error } = await sb.rpc("delete_result", { p_id: me.id, p_secret: me.secret, p_result: b.dataset.del });
    if (error) return toast(errMsg(error), 1);
    await refresh(); toast("נמחק");
  });
  if (deferredInstall) { $("#install").classList.remove("hidden"); $("#install").onclick = () => deferredInstall.prompt(); }
}

/* ---------- submit ---------- */
async function compress(file) {
  try {
    const bmp = await createImageBitmap(file);
    const max = 1400, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.82));
    return blob || file;
  } catch { return file; }
}
function openSubmit(gameId, date) {
  const t = today();
  let g = gameId || (state.games.find(x => !state.results.some(r => r.player_id === state.me.id && r.game_id === x.id && r.play_date === t)) || state.games[0]).id;
  let d = date || t, file = null, pmode = "top";
  const dates = [0, 1, 2, 3].map(i => S.addDays(t, -i));
  const draw = () => {
    const G = state.gmap[g];
    const ex = state.results.find(r => r.player_id === state.me.id && r.game_id === g && r.play_date === d);
    $("#sheet").innerHTML = `
      <div class="row between"><h3 style="margin:0">הוספת תוצאה</h3><button class="btn small ghost" onclick="closeModal()">✕</button></div>
      <label>משחק</label><div class="chips">${state.games.map(x => { const done = state.results.some(r => r.player_id === state.me.id && r.game_id === x.id && r.play_date === d); return `<button class="chip ${x.id === g ? "on" : ""}" data-sg="${x.id}">${esc(x.emoji)} ${esc(x.name)}${done ? " ✓" : ""}</button>`; }).join("")}</div>
      <label>יום</label><div class="chips">${dates.map(x => `<button class="chip ${x === d ? "on" : ""}" data-sd="${x}">${niceDate(x)}</button>`).join("")}</div>
      <label>${esc(G.score_label)} ${G.hint ? `<span class="muted">· ${esc(G.hint)}</span>` : ""}</label>
      <input id="sc" type="number" inputmode="decimal" step="${G.decimals ? Math.pow(10, -G.decimals) : 1}" ${G.min_score != null ? `min="${G.min_score}"` : ""} ${G.max_score != null ? `max="${G.max_score}"` : ""} value="${ex ? +ex.score : ""}" placeholder="${G.higher_better ? "למשל 420" : "למשל 1.85"}">
      ${G.has_pct ? `<label>אחוזון מהמשחק (חובה) <span class="muted">· מה שהמשחק מראה בסוף</span></label>
      <div class="chips" style="margin-bottom:6px"><button class="chip ${pmode === "top" ? "on" : ""}" data-pm="top">Top X%</button><button class="chip ${pmode === "better" ? "on" : ""}" data-pm="better">Better than X%</button></div>
      <input id="pc" type="number" inputmode="decimal" step="0.1" min="0" max="100" value="${ex && ex.top_pct != null ? (pmode === "top" ? +ex.top_pct : 100 - ex.top_pct) : ""}" placeholder="${pmode === "top" ? "למשל 8 (Top 8%)" : "למשל 92 (Better than 92%)"}">` : ""}
      <label>צילום מסך (חובה)</label>
      <label class="drop" for="fl">📸 ${ex ? "אפשר להחליף צילום (או להשאיר את הקיים)" : "לחץ לבחירת צילום מסך"}</label>
      <input id="fl" type="file" accept="image/*" class="hidden">
      <img id="pv" class="preview ${file || ex ? "" : "hidden"}" src="${file ? URL.createObjectURL(file) : ex ? esc(ex.proof_url) : ""}">
      <div style="height:14px"></div>
      <button class="btn block" id="send">${ex ? "עדכן תוצאה" : "שלח תוצאה"}</button>
      <a class="btn ghost block" style="display:block;text-align:center;margin-top:8px;text-decoration:none" href="${esc(G.url)}" target="_blank" rel="noopener">עוד לא שיחקת? פתח את ${esc(G.name)} ↗</a>`;
    document.querySelectorAll("[data-sg]").forEach(b => b.onclick = () => { g = b.dataset.sg; file = null; draw(); });
    document.querySelectorAll("[data-sd]").forEach(b => b.onclick = () => { d = b.dataset.sd; file = null; draw(); });
    document.querySelectorAll("[data-pm]").forEach(b => b.onclick = () => { pmode = b.dataset.pm; draw(); });
    $("#fl").onchange = e => { file = e.target.files[0] || null; if (file) { $("#pv").src = URL.createObjectURL(file); $("#pv").classList.remove("hidden"); } };
    $("#send").onclick = async () => {
      const v = $("#sc").value.trim().replace(",", ".");
      if (v === "" || isNaN(+v)) return toast("הכנס ניקוד", 1);
      const score = +v;
      if (G.min_score != null && score < +G.min_score) return toast(`מינימום ${G.min_score}`, 1);
      if (G.max_score != null && score > +G.max_score) return toast(`מקסימום ${G.max_score}`, 1);
      let top = null;
      if (G.has_pct) {
        const pv = $("#pc").value.trim().replace(",", ".").replace("%", "");
        if (pv === "" || isNaN(+pv) || +pv < 0 || +pv > 100) return toast("הכנס אחוזון מהמשחק (0–100)", 1);
        top = pmode === "top" ? +pv : 100 - +pv;
      }
      if (!file && !ex) return toast("חייב לצרף צילום מסך 📸", 1);
      const btn = $("#send"); btn.disabled = true; btn.textContent = "שולח…";
      try {
        let url = ex?.proof_url;
        if (file) {
          const blob = await compress(file);
          const ext = blob.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() || "png").toLowerCase();
          const path = `${state.me.id}/${d}_${g}_${Date.now()}.${ext}`;
          const up = await sb.storage.from("proofs").upload(path, blob, { contentType: blob.type || "image/png", upsert: false });
          if (up.error) throw up.error;
          url = sb.storage.from("proofs").getPublicUrl(path).data.publicUrl;
        }
        const { error } = await sb.rpc("submit_result", { p_id: state.me.id, p_secret: state.me.secret, p_game: g, p_date: d, p_score: score, p_proof: url, p_top_pct: top, p_note: null });
        if (error) throw error;
        closeModal(); await refresh();
        const mine = state.results.find(r => r.player_id === state.me.id && r.game_id === g && r.play_date === d);
        toast(mine && mine.n > 1 ? `נשמר ✓ אתה במקום ${mine.rank} מתוך ${mine.n}` : "נשמר ✓");
      } catch (e) { toast(errMsg(e), 1); btn.disabled = false; btn.textContent = "נסה שוב"; }
    };
  };
  $("#modal").classList.remove("hidden"); draw();
}
function openProof(id) {
  const r = state.results.find(x => x.id === id); if (!r) return;
  const g = state.gmap[r.game_id];
  $("#sheet").innerHTML = `<div class="row between"><h3 style="margin:0">${esc(P(r.player_id).avatar)} ${esc(P(r.player_id).name)} · ${esc(g?.name)}</h3><button class="btn small ghost" onclick="closeModal()">✕</button></div>
    <p class="muted">${niceDate(r.play_date)} · ${fmtScore(g, r.score)} · ${fmtPct(r.pct)} במשחק · ${r.n > 1 ? `מקום ${r.rank} מתוך ${r.n} בחברים` : "היחיד מהחברים"}</p>
    <img class="full" src="${esc(r.proof_url)}" alt="צילום מסך">`;
  $("#modal").classList.remove("hidden");
}
function closeModal() { $("#modal").classList.add("hidden"); $("#sheet").innerHTML = ""; }
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
$("#fab").onclick = () => openSubmit();
async function shareLink() {
  const url = location.origin + location.pathname;
  try { if (navigator.share) await navigator.share({ title: "ליגת המשחקים היומיים", text: "בוא תתחרה איתנו במשחקים היומיים!", url }); else { await navigator.clipboard.writeText(url); toast("הקישור הועתק"); } } catch {}
}

/* ---------- boot ---------- */
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstall = e; });
async function refresh() {
  try { await loadAll(); render(); }
  catch (e) { console.error(e); if (!state.loaded) $("#app").innerHTML = `<div class="loading">שגיאה בטעינה. בדוק אינטרנט ונסה שוב.<br><br><button class="btn" onclick="refresh()">נסה שוב</button></div>`; else toast("שגיאה בטעינה", 1); }
}
state.me = loadMe();
refresh();
document.addEventListener("visibilitychange", () => { if (!document.hidden && $("#modal").classList.contains("hidden")) refresh(); });
setInterval(() => { if (!document.hidden && $("#modal").classList.contains("hidden")) refresh(); }, 90000);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
