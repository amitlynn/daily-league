// Pure stats engine. Works in browser (window.Stats) and node (module.exports).
(function (root) {
  const DAY = 86400000;
  const toMs = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const fromMs = ms => new Date(ms).toISOString().slice(0, 10);
  const addDays = (d, n) => fromMs(toMs(d) + n * DAY);
  const diffDays = (a, b) => Math.round((toMs(a) - toMs(b)) / DAY);
  const weekStart = d => addDays(d, -new Date(toMs(d)).getUTCDay()); // Sunday
  const monthStart = d => d.slice(0, 8) + "01";
  const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

  // Annotate every result with rank, n (players that day), pct (0-100, null if alone)
  function annotate(results, games) {
    const gmap = Object.fromEntries(games.map(g => [g.id, g]));
    const groups = {};
    for (const r of results) (groups[r.game_id + "|" + r.play_date] ||= []).push(r);
    for (const key in groups) {
      const list = groups[key];
      const g = gmap[list[0].game_id];
      const hb = g ? g.higher_better : true;
      const better = (a, b) => (hb ? a > b : a < b);
      const n = list.length;
      for (const r of list) {
        const s = +r.score;
        let worse = 0, ties = 0, betterCount = 0;
        for (const o of list) {
          if (o === r) continue;
          const os = +o.score;
          if (os === s) ties++;
          else if (better(s, os)) worse++;
          else betterCount++;
        }
        r.n = n;
        r.rank = betterCount + 1;
        // percentile comes from the game itself ("Top X%") -> stored as "better than (100-X)%"
        r.pct = r.top_pct != null ? 100 - +r.top_pct : null;
        r.win = n > 1 && r.rank === 1;
      }
    }
    return groups;
  }

  // streaks from a sorted unique list of dates
  function streaks(dates, today) {
    const ds = [...new Set(dates)].sort();
    let best = 0, run = 0, prev = null, bestEnd = null;
    for (const d of ds) {
      run = prev && diffDays(d, prev) === 1 ? run + 1 : 1;
      if (run > best) { best = run; bestEnd = d; }
      prev = d;
    }
    let current = 0;
    if (ds.length) {
      const last = ds[ds.length - 1];
      const gap = diffDays(today, last);
      if (gap <= 1) {
        current = 1;
        for (let i = ds.length - 1; i > 0; i--) {
          if (diffDays(ds[i], ds[i - 1]) === 1) current++; else break;
        }
      }
    }
    return { current, best, bestEnd, days: ds.length };
  }

  function inRange(d, from, to) { return (!from || d >= from) && (!to || d <= to); }

  // Ranking table for a period, optionally one game
  function ranking(results, { from, to, game } = {}) {
    const by = {};
    for (const r of results) {
      if (!inRange(r.play_date, from, to)) continue;
      if (game && r.game_id !== game) continue;
      const p = (by[r.player_id] ||= { player_id: r.player_id, entries: 0, pcts: [], wins: 0, podiums: 0, days: new Set(), scores: [] });
      p.entries++;
      p.days.add(r.play_date);
      p.scores.push(+r.score);
      if (r.pct != null) p.pcts.push(r.pct);
      if (r.win) p.wins++;
      if (r.n > 1 && r.rank <= 3) p.podiums++;
    }
    const rows = Object.values(by).map(p => ({
      player_id: p.player_id,
      entries: p.entries,
      days: p.days.size,
      wins: p.wins,
      podiums: p.podiums,
      avgPct: avg(p.pcts),
      avgScore: avg(p.scores),
      rated: p.pcts.length
    }));
    rows.sort((a, b) => (b.avgPct ?? -1) - (a.avgPct ?? -1) || b.wins - a.wins || b.entries - a.entries);
    return rows;
  }

  function bestScore(list, hb) {
    let best = null;
    for (const r of list) if (!best || (hb ? +r.score > +best.score : +r.score < +best.score)) best = r;
    return best;
  }

  function playerStats(pid, results, games, today) {
    const mine = results.filter(r => r.player_id === pid);
    const per = games.map(g => {
      const list = mine.filter(r => r.game_id === g.id);
      const st = streaks(list.map(r => r.play_date), today);
      const pcts = list.filter(r => r.pct != null).map(r => r.pct);
      return {
        game: g, count: list.length,
        avgScore: avg(list.map(r => +r.score)),
        best: bestScore(list, g.higher_better),
        avgPct: avg(pcts),
        wins: list.filter(r => r.win).length,
        streak: st.current, bestStreak: st.best
      };
    });
    const all = streaks(mine.map(r => r.play_date), today);
    const pcts = mine.filter(r => r.pct != null).map(r => r.pct);
    return {
      entries: mine.length,
      avgPct: avg(pcts),
      wins: mine.filter(r => r.win).length,
      podiums: mine.filter(r => r.n > 1 && r.rank <= 3).length,
      streak: all.current, bestStreak: all.best, days: all.days,
      per, mine
    };
  }

  function headToHead(a, b, results) {
    const idx = {};
    for (const r of results) if (r.player_id === a || r.player_id === b) (idx[r.game_id + "|" + r.play_date] ||= {})[r.player_id] = r;
    let aw = 0, bw = 0, t = 0;
    for (const k in idx) {
      const x = idx[k][a], y = idx[k][b];
      if (!x || !y) continue;
      if (x.rank < y.rank) aw++; else if (y.rank < x.rank) bw++; else t++;
    }
    return { a: aw, b: bw, ties: t };
  }

  function records(results, games, players, today) {
    const pids = players.map(p => p.id);
    const out = { perGame: [], overall: [] };
    const top = (arr, key, minCount = 0, filter) => {
      let best = null;
      for (const x of arr) {
        if (filter && !filter(x)) continue;
        if (x[key] == null || x[key] <= 0) continue;
        if (!best || x[key] > best[key]) best = x;
      }
      if (best) best = { ...best, tied: arr.filter(x => (!filter || filter(x)) && x[key] === best[key]).map(x => x.pid) };
      return best;
    };
    for (const g of games) {
      const list = results.filter(r => r.game_id === g.id);
      if (!list.length) { out.perGame.push({ game: g, empty: true }); continue; }
      const stats = pids.map(pid => {
        const l = list.filter(r => r.player_id === pid);
        const st = streaks(l.map(r => r.play_date), today);
        const pc = l.filter(r => r.pct != null).map(r => r.pct);
        return { pid, days: l.length, best: st.best, cur: st.current, wins: l.filter(r => r.win).length, avgPct: avg(pc), rated: pc.length };
      });
      out.perGame.push({
        game: g,
        bestScore: bestScore(list, g.higher_better),
        longestStreak: top(stats, "best"),
        currentStreak: top(stats, "cur"),
        mostDays: top(stats, "days"),
        mostWins: top(stats, "wins"),
        bestAvg: top(stats, "avgPct", 0, x => x.rated >= 5)
      });
    }
    // overall
    const ps = pids.map(pid => {
      const l = results.filter(r => r.player_id === pid);
      const st = streaks(l.map(r => r.play_date), today);
      const pc = l.filter(r => r.pct != null).map(r => r.pct);
      // per day aggregation
      const byDay = {};
      for (const r of l) (byDay[r.play_date] ||= []).push(r);
      let fullDays = 0, perfectDays = 0, maxInDay = 0;
      for (const d in byDay) {
        const dl = byDay[d];
        maxInDay = Math.max(maxInDay, dl.length);
        if (dl.length >= games.length && games.length) fullDays++;
        if (dl.length >= 2 && dl.every(r => r.win)) perfectDays++;
      }
      return {
        pid, entries: l.length, best: st.best, cur: st.current, days: st.days,
        wins: l.filter(r => r.win).length,
        podiums: l.filter(r => r.n > 1 && r.rank <= 3).length,
        avgPct: avg(pc), rated: pc.length, fullDays, perfectDays, maxInDay
      };
    });
    // daily champion counts
    const champ = {};
    const dates = [...new Set(results.map(r => r.play_date))];
    for (const d of dates) {
      const day = dailyOverall(results, d);
      if (day.length > 1 && day[0].avgPct != null) champ[day[0].player_id] = (champ[day[0].player_id] || 0) + 1;
    }
    ps.forEach(p => (p.champDays = champ[p.pid] || 0));
    out.overall = [
      ["🔥", "הסטריק הכי ארוך (כל משחק)", top(ps, "best"), "best", "ימים"],
      ["⚡", "הסטריק הפעיל הכי ארוך", top(ps, "cur"), "cur", "ימים"],
      ["📆", "הכי הרבה ימי משחק", top(ps, "days"), "days", "ימים"],
      ["🎯", "הכי הרבה תוצאות", top(ps, "entries"), "entries", "תוצאות"],
      ["🥇", "הכי הרבה ניצחונות במשחק", top(ps, "wins"), "wins", "ניצחונות"],
      ["👑", "הכי הרבה פעמים אלוף היום", top(ps, "champDays"), "champDays", "ימים"],
      ["🏅", "הכי הרבה פודיומים", top(ps, "podiums"), "podiums", "פעמים"],
      ["📈", "האחוזון הממוצע הכי טוב (מינ׳ 10)", top(ps, "avgPct", 0, x => x.rated >= 10), "avgPct", "%"],
      ["💯", "ימים מושלמים (ניצח בכל מה ששיחק, 2+)", top(ps, "perfectDays"), "perfectDays", "ימים"],
      ["🧩", "ימים מלאים (כל המשחקים)", top(ps, "fullDays"), "fullDays", "ימים"]
    ];
    return out;
  }

  // Overall daily ranking (avg percentile over games played that day)
  function dailyOverall(results, date) {
    const by = {};
    for (const r of results) {
      if (r.play_date !== date) continue;
      const p = (by[r.player_id] ||= { player_id: r.player_id, games: 0, pcts: [], wins: 0 });
      p.games++;
      if (r.pct != null) p.pcts.push(r.pct);
      if (r.win) p.wins++;
    }
    const rows = Object.values(by).map(p => ({ ...p, avgPct: avg(p.pcts) }));
    rows.sort((a, b) => (b.avgPct ?? -1) - (a.avgPct ?? -1) || b.games - a.games || b.wins - a.wins);
    return rows;
  }

  // weekly avg percentile series for a player (last N weeks)
  function weeklySeries(pid, results, today, weeks = 8) {
    const out = [];
    let ws = weekStart(today);
    for (let i = weeks - 1; i >= 0; i--) {
      const from = addDays(ws, -7 * i), to = addDays(from, 6);
      const pc = results.filter(r => r.player_id === pid && r.pct != null && r.play_date >= from && r.play_date <= to).map(r => r.pct);
      out.push({ from, v: avg(pc) });
    }
    return out;
  }

  const api = { annotate, streaks, ranking, playerStats, headToHead, records, dailyOverall, weeklySeries, addDays, diffDays, weekStart, monthStart, avg };
  if (typeof module !== "undefined") module.exports = api; else root.Stats = api;
})(this);
