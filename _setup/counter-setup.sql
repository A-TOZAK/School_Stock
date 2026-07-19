-- School Stock アクセスカウンター：Supabase セットアップSQL
-- Supabase の SQL Editor に、この中身を丸ごと貼って「Run」するだけ。
-- 個人情報は一切保存しません。貯めるのは「住所（key）」と「回数（n）」だけ。

-- 1) 集計テーブル
create table if not exists public.counts (
  key text primary key,
  n   bigint not null default 0
);

-- 2) +1する関数（bump）。anonキーから安全に呼べるよう SECURITY DEFINER。
--    ページ側は fetch で /rest/v1/rpc/bump に {k:"pv:/..."} を投げる。
create or replace function public.bump(k text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.counts as c (key, n) values (k, 1)
  on conflict (key) do update set n = c.n + 1;
end;
$$;

-- 3) RLS（行レベルセキュリティ）を有効化
alter table public.counts enable row level security;

-- 4) だれでも「読む」だけは許可（集計ページ用。数字だけなので公開可）。
--    書き込みは許可しない＝必ず bump() 関数を通す。
drop policy if exists "counts are readable" on public.counts;
create policy "counts are readable" on public.counts
  for select using (true);

-- 5) anon（公開キー）が bump 関数を実行できるように許可
grant execute on function public.bump(text) to anon;
grant select on public.counts to anon;

-- 以上。Project Settings → API から Project URL と anon public key を
-- assets/counter-config.js に貼れば計測が始まります。
