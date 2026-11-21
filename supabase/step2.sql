-- 高次元SNS リラ ステップ2: ひろば・部活・プロフィール
-- Supabase の「SQL Editor」に全文を貼り付けて、Run を押します。
-- schema.sql(ステップ1)を実行したあとに使います。何度実行しても大丈夫なように書いてあります。

-- ========== プロフィールに足すもの ==========

alter table public.profiles add column if not exists colors text[];                         -- すきな色(3つ。#rrggbb)
alter table public.profiles add column if not exists likes text[] not null default '{}';   -- すきなこと
alter table public.profiles add column if not exists dream text not null default '';        -- ゆめ
alter table public.profiles add column if not exists icon_kind text not null default 'char'; -- アイコンの種類
alter table public.profiles add column if not exists icon_value text not null default '';   -- 絵文字、または写真の保存場所

do $$
begin
  alter table public.profiles add constraint profiles_icon_kind_check check (icon_kind in ('char', 'emoji', 'photo'));
exception
  when duplicate_object then null;
end;
$$;

-- ========== ひろばの投稿 ==========

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  description text not null default '',
  goal text not null default '',
  unit text not null default '回',
  target integer not null default 20 check (target between 1 and 100000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.club_members (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index if not exists club_members_user_idx on public.club_members (user_id);

create table if not exists public.club_progress (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null default 1 check (amount between 1 and 100),
  created_at timestamptz not null default now()
);
create index if not exists club_progress_club_idx on public.club_progress (club_id);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid references public.clubs(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'photo', 'aura', 'stamp')),
  body text not null default '' check (char_length(body) <= 2000),
  tag text check (tag in ('きもち', 'やってみたい')),
  file_path text,
  created_at timestamptz not null default now()
);
create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_club_idx on public.posts (club_id, created_at desc);
create index if not exists posts_author_idx on public.posts (author_id, created_at desc);

create table if not exists public.post_lights (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ========== 関数 ==========

-- 自分が入っている部活かどうか
create or replace function public.is_club_member(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.club_members
    where club_id = cid and user_id = auth.uid()
  );
$$;
revoke execute on function public.is_club_member(uuid) from public, anon;
grant execute on function public.is_club_member(uuid) to authenticated;

-- 部活を作った人は、自動でメンバーになる
create or replace function public.handle_new_club()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.club_members (club_id, user_id) values (new.id, new.created_by)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_club_created on public.clubs;
create trigger on_club_created
  after insert on public.clubs
  for each row execute function public.handle_new_club();

-- ========== 見える範囲のルール(RLS) ==========
-- ひろばと部活は、ログインしている身内なら誰でも見られる。書けるのは自分の名前でだけ。

alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.club_progress enable row level security;
alter table public.posts enable row level security;
alter table public.post_lights enable row level security;

drop policy if exists "clubs read" on public.clubs;
create policy "clubs read" on public.clubs
  for select to authenticated using (true);
drop policy if exists "clubs insert" on public.clubs;
create policy "clubs insert" on public.clubs
  for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "clubs update own" on public.clubs;
create policy "clubs update own" on public.clubs
  for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists "club members read" on public.club_members;
create policy "club members read" on public.club_members
  for select to authenticated using (true);
drop policy if exists "club members join" on public.club_members;
create policy "club members join" on public.club_members
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "club members leave" on public.club_members;
create policy "club members leave" on public.club_members
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "club progress read" on public.club_progress;
create policy "club progress read" on public.club_progress
  for select to authenticated using (true);
drop policy if exists "club progress add" on public.club_progress;
create policy "club progress add" on public.club_progress
  for insert to authenticated with check (user_id = auth.uid() and public.is_club_member(club_id));
drop policy if exists "club progress remove own" on public.club_progress;
create policy "club progress remove own" on public.club_progress
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "posts read" on public.posts;
create policy "posts read" on public.posts
  for select to authenticated using (true);
drop policy if exists "posts insert" on public.posts;
create policy "posts insert" on public.posts
  for insert to authenticated
  with check (author_id = auth.uid() and (club_id is null or public.is_club_member(club_id)));
drop policy if exists "posts delete own" on public.posts;
create policy "posts delete own" on public.posts
  for delete to authenticated using (author_id = auth.uid());

drop policy if exists "lights read" on public.post_lights;
create policy "lights read" on public.post_lights
  for select to authenticated using (true);
drop policy if exists "lights add" on public.post_lights;
create policy "lights add" on public.post_lights
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "lights remove" on public.post_lights;
create policy "lights remove" on public.post_lights
  for delete to authenticated using (user_id = auth.uid());

-- ========== 写真やスタンプの保存場所(ひろば・アイコン用) ==========
-- 置き場所は「自分のID/ファイル名」。読めるのはログインしている身内だけ、置けるのは自分のフォルダだけ。

insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 10485760)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists "media read" on storage.objects;
create policy "media read" on storage.objects
  for select to authenticated
  using (bucket_id = 'media');

drop policy if exists "media upload own" on storage.objects;
create policy "media upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media delete own" on storage.objects;
create policy "media delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ========== 最初からある部活 ==========

insert into public.clubs (name, description, goal, unit, target)
select '阿蘇が大好きな人の会', '阿蘇の景色や時間をわけあう部活', 'みんなで阿蘇の朝の写真を100枚あつめる', '枚', 100
where not exists (select 1 from public.clubs where name = '阿蘇が大好きな人の会');

insert into public.clubs (name, description, goal, unit, target)
select 'お馬さんと暮らしたい人の会', '馬のいる暮らしを、いっしょに形にしていく部活', 'お馬さんに会いに行った日を30日ためる', '日', 30
where not exists (select 1 from public.clubs where name = 'お馬さんと暮らしたい人の会');
