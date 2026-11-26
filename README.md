# ליגת המשחקים היומיים

Static site (GitHub Pages) + Supabase (project `daily-games-league`).

## Add a game
Run in Supabase SQL:

```sql
insert into public.games (id, name, url, emoji, score_label, higher_better, min_score, max_score, decimals, hint, sort_order)
values ('game-id', 'Game Name', 'https://game.url/', '🎮', 'ניקוד', true, 0, null, 0, 'מה לכתוב', 60);
```

No code change needed. `higher_better=false` for games where a lower score wins.

## Stats
- Percentile per game per day = share of other players you beat (ties = half). Solo days have no percentile.
- Daily overall = average percentile of the games you played that day. Missing games never count against you.
