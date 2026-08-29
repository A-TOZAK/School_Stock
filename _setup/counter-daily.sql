-- School Stock アクセスカウンター：日づけ別の集計を足すSQL（あとから足す・任意）
-- ────────────────────────────────────────────────────────────
-- いまの counts テーブルは「はじめてからの合計」しか持っていません。
-- これを実行すると「その日ぶん」も貯まり、集計ページに直近の折れ線が出ます。
-- 既にあるデータはそのまま。実行しても今の計測は止まりません。
--
-- 手順
--   1. Supabase の SQL Editor にこの中身を丸ごと貼って Run
--   2. assets/counter-config.js に daily: true を足して push
--      window.SS_COUNTER = { url: "...", key: "...", daily: true };
--   ※ 2 をやるまでは、これまでどおり合計だけを数えます（安全）

-- 1) その日ぶんの表（住所×日づけ で1行）
create table if not exists public.counts_daily (
  key text not null,
  d   date not null default (now() at time zone 'Asia/Tokyo')::date,
  n   bigint not null default 0,
  primary key (key, d)
);
create index if not exists counts_daily_d_idx on public.counts_daily (d);

-- 2) 合計と「その日ぶん」を一度に+1する関数。ページ側はこちらを呼ぶ。
create or replace function public.bump2(k text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  insert into public.counts as c (key, n) values (k, 1)
  on conflict (key) do update set n = c.n + 1;

  insert into public.counts_daily as t (key, d, n) values (k, today, 1)
  on conflict (key, d) do update set n = t.n + 1;
end;
$$;

-- 3) 日ごとの合計だけを返す眺め（集計ページはこれを読む＝軽い）
--    pv = ページ表示 / dl = ダウンロード。それ以外の目印（dev: src:）は数えない。
create or replace view public.counts_daily_summary as
select d,
       sum(n) filter (where key like 'pv:%') as pv,
       sum(n) filter (where key like 'dl:%') as dl
from public.counts_daily
group by d;

-- 4) 読むのはだれでもOK・書き込みは関数ごし（counts と同じ守り方）
alter table public.counts_daily enable row level security;
drop policy if exists "counts_daily are readable" on public.counts_daily;
create policy "counts_daily are readable" on public.counts_daily
  for select using (true);

grant execute on function public.bump2(text) to anon;
grant select on public.counts_daily to anon;
grant select on public.counts_daily_summary to anon;

-- 掃除（任意・行が増えすぎたら年に1回ほど）
--   delete from public.counts_daily where d < current_date - 400;
