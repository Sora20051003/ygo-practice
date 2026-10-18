-- 遊戯王 展開練習：Supabase の準備
-- Supabase の管理画面 →「SQL Editor」→「New query」に、このファイルの中身を全部貼り付けて「Run」を押す。
-- 何度実行しても大丈夫（すでにあるものは作り直さない／決まりは作り直す）。
-- 表ごとに「だれが読める・書けるか」を決めている（Row Level Security）。

-- ========== デッキ（本人だけが読み書き） ==========
create table if not exists public.user_decks (
  uid uuid primary key references auth.users on delete cascade,
  decks jsonb not null default '[]'::jsonb,
  current_deck text,
  updated_at timestamptz not null default now()
);
alter table public.user_decks enable row level security;
drop policy if exists "decks: own" on public.user_decks;
create policy "decks: own" on public.user_decks for all to authenticated
  using (uid = auth.uid()) with check (uid = auth.uid() and jsonb_array_length(decks) <= 500);

-- ========== 管理者（1人だけ。最初に登録した人） ==========
create table if not exists public.app_owner (
  id int primary key default 1 check (id = 1),
  uid uuid not null references auth.users on delete cascade,
  email text,
  at timestamptz not null default now()
);
alter table public.app_owner enable row level security;
drop policy if exists "owner: read" on public.app_owner;
create policy "owner: read" on public.app_owner for select to authenticated using (true);
drop policy if exists "owner: claim" on public.app_owner;
create policy "owner: claim" on public.app_owner for insert to authenticated with check (uid = auth.uid());
-- 変更・削除はできない（変えるときは Supabase の管理画面の Table Editor で）

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from public.app_owner where uid = auth.uid()) $$;

-- ========== アカウントの記録（本人が書く。読めるのは本人と管理者） ==========
create table if not exists public.profiles (
  uid uuid primary key references auth.users on delete cascade,
  name text, email text, device text, provider text, version text,
  deck_count int,
  last_seen timestamptz, last_login timestamptz, created_at timestamptz
);
alter table public.profiles enable row level security;
drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own" on public.profiles for insert to authenticated with check (uid = auth.uid());
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles for update to authenticated using (uid = auth.uid()) with check (uid = auth.uid());
drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin" on public.profiles for select to authenticated using (uid = auth.uid() or public.is_admin());

-- ========== 対戦の部屋 ==========
-- 部屋（部屋コードを知っている人が参加できる。読むのはログインしていれば可）
create table if not exists public.rooms (
  code text primary key,
  host uuid not null references auth.users on delete cascade,
  guest uuid references auth.users on delete set null,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.rooms enable row level security;
drop policy if exists "rooms: read" on public.rooms;
create policy "rooms: read" on public.rooms for select to authenticated using (true);
drop policy if exists "rooms: create" on public.rooms;
create policy "rooms: create" on public.rooms for insert to authenticated with check (host = auth.uid());
-- 参加と書き換えは下の関数で行う（同時に書いても壊れないように）

-- 各プレイヤーの盤面（相手に見せてよい情報だけ）：本人だけが書ける
create table if not exists public.room_players (
  code text not null references public.rooms on delete cascade,
  uid uuid not null references auth.users on delete cascade,
  json text,
  at timestamptz not null default now(),
  primary key (code, uid)
);
alter table public.room_players enable row level security;
drop policy if exists "players: read" on public.room_players;
create policy "players: read" on public.room_players for select to authenticated using (true);
drop policy if exists "players: write own" on public.room_players;
create policy "players: write own" on public.room_players for all to authenticated using (uid = auth.uid()) with check (uid = auth.uid());

-- チャット・コイン・ダメージなどの出来事：書いた本人の名前でだけ追加できる
create table if not exists public.room_events (
  id bigint generated always as identity primary key,
  code text not null references public.rooms on delete cascade,
  from_uid uuid not null references auth.users on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.room_events enable row level security;
drop policy if exists "events: read" on public.room_events;
create policy "events: read" on public.room_events for select to authenticated using (true);
drop policy if exists "events: add own" on public.room_events;
create policy "events: add own" on public.room_events for insert to authenticated with check (from_uid = auth.uid());

-- 部屋に参加する（まだ相手がいない部屋だけ）
create or replace function public.join_room(p_code text, p_name text) returns void
  language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  if auth.uid() is null then raise exception 'NOT_LOGGED_IN'; end if;
  select * into r from public.rooms where code = p_code for update;
  if not found then raise exception 'NO_ROOM'; end if;
  if r.host = auth.uid() or r.guest = auth.uid() then return; end if;   -- 入り直し
  if r.guest is not null then raise exception 'FULL'; end if;
  update public.rooms
    set guest = auth.uid(),
        data = data || jsonb_build_object('guest', auth.uid()::text, 'guestName', left(coalesce(p_name, ''), 40))
    where code = p_code;
end $$;

-- 部屋の情報を書き換える（参加者だけ）。キーは「ready.<uid>」のように . で区切った場所も指定できる
create or replace function public.patch_room(p_code text, p_patch jsonb) returns void
  language plpgsql security definer set search_path = public as $$
declare d jsonb; k text; v jsonb; path text[]; i int;
begin
  select data into d from public.rooms where code = p_code and (host = auth.uid() or guest = auth.uid()) for update;
  if not found then raise exception 'NO_ROOM'; end if;
  for k, v in select * from jsonb_each(p_patch) loop
    path := string_to_array(k, '.');
    -- 途中の入れ物がなければ作る
    for i in 1 .. array_length(path, 1) - 1 loop
      if jsonb_typeof(d #> path[1:i]) is distinct from 'object' then
        d := jsonb_set(d, path[1:i], '{}'::jsonb, true);
      end if;
    end loop;
    d := jsonb_set(d, path, v, true);
  end loop;
  update public.rooms set data = d where code = p_code;
end $$;

grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.patch_room(text, jsonb) to authenticated;
grant execute on function public.is_admin() to authenticated;

-- 変わったことをすぐ知らせる（Realtime）
do $$ begin
  begin alter publication supabase_realtime add table public.user_decks; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.rooms; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.room_players; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.room_events; exception when duplicate_object then null; end;
end $$;

-- 古い部屋は消してよい（7日より前のもの）。必要なら手で実行：
-- delete from public.rooms where created_at < now() - interval '7 days';
