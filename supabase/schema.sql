-- 高次元SNS ステップ1: 最小のトーク
-- Supabase の「SQL Editor」に全文を貼り付けて、Run を押します。
-- 何度実行しても大丈夫なように書いてあります。

-- ========== テーブル ==========

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  color_a text not null default '#ff8fc2',
  color_b text not null default '#ffc58a',
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'dm' check (kind in ('dm', 'group')),
  title text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx on public.conversation_members (user_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'image', 'file', 'voice')),
  body text,
  file_path text,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at desc);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ========== 関数 ==========

-- 自分が入っているトークかどうか
create or replace function public.is_member(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = cid and user_id = auth.uid()
  );
$$;

-- 新しく登録した人のプロフィールを自動で作る(色は人ごとに自動で決まる)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  palette text[] := array[
    '#ff8fc2,#ffc58a', '#7fd6ff,#a99bff', '#9ef0c6,#ffe58a',
    '#c9a8ff,#ff9ec7', '#ffd08a,#ff8fc2', '#8fe3ff,#9ef0c6'
  ];
  pick text;
begin
  pick := palette[(abs(hashtext(new.id::text)::bigint) % 6) + 1];
  insert into public.profiles (id, name, email, color_a, color_b)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.email, ''),
    split_part(pick, ',', 1),
    split_part(pick, ',', 2)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 1対1のトークを始める(すでにあればそれを返す)
create or replace function public.start_dm(other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cid uuid;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if other is null or other = me then
    raise exception 'invalid user';
  end if;
  if not exists (select 1 from public.profiles where id = other) then
    raise exception 'user not found';
  end if;

  select c.id into cid
  from public.conversations c
  where c.kind = 'dm'
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = me)
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = other)
  limit 1;

  if cid is null then
    insert into public.conversations (kind, created_by) values ('dm', me) returning id into cid;
    insert into public.conversation_members (conversation_id, user_id) values (cid, me), (cid, other);
  end if;

  return cid;
end;
$$;

revoke execute on function public.start_dm(uuid) from public, anon;
grant execute on function public.start_dm(uuid) to authenticated;
revoke execute on function public.is_member(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;

-- ========== 見える範囲のルール(RLS) ==========

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "conversations read" on public.conversations;
create policy "conversations read" on public.conversations
  for select to authenticated using (public.is_member(id));

drop policy if exists "members read" on public.conversation_members;
create policy "members read" on public.conversation_members
  for select to authenticated using (public.is_member(conversation_id));

drop policy if exists "messages read" on public.messages;
create policy "messages read" on public.messages
  for select to authenticated using (public.is_member(conversation_id));

drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.is_member(conversation_id));

drop policy if exists "push own" on public.push_subscriptions;
create policy "push own" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ========== リアルタイム(新着をすぐ表示する) ==========

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
end;
$$;

-- ========== 画像などの保存場所 ==========

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat', 'chat', false, 10485760)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists "chat files read" on storage.objects;
create policy "chat files read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat'
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
        then public.is_member(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

drop policy if exists "chat files upload" on storage.objects;
create policy "chat files upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat'
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
        then public.is_member(((storage.foldername(name))[1])::uuid)
      else false
    end
  );
