-- RealTimeChat E2EE schema. Run once in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 60),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- Message bodies are ciphertext envelopes only. No plaintext body column is stored.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  encrypted_payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_room_created_idx on public.messages(conversation_id, created_at);

-- Compatibility for a database that ran the earlier plaintext-message schema.
alter table public.messages add column if not exists encrypted_payload jsonb;
do $
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'body'
  ) then
    execute 'alter table public.messages alter column body drop not null';
  end if;
end
$;

-- Public ECDH identity keys. Private keys stay on each user's device in IndexedDB.
create table if not exists public.user_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  public_key jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.user_keys enable row level security;

create or replace function public.is_conversation_member(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = p_conversation_id and cm.user_id = auth.uid()
  );
$$;
revoke all on function public.is_conversation_member(uuid) from public;
grant execute on function public.is_conversation_member(uuid) to authenticated;

drop policy if exists "users can read shared participants public keys" on public.user_keys;
drop function if exists public.shares_conversation_with(uuid);

drop policy if exists "members can view their conversations" on public.conversations;
create policy "members can view their conversations" on public.conversations
for select to authenticated using (public.is_conversation_member(id));

drop policy if exists "members can view room membership" on public.conversation_members;
create policy "members can view room membership" on public.conversation_members
for select to authenticated using (public.is_conversation_member(conversation_id));

drop policy if exists "members can read room messages" on public.messages;
create policy "members can read room messages" on public.messages
for select to authenticated using (public.is_conversation_member(conversation_id));

drop policy if exists "members can send encrypted room messages" on public.messages;
create policy "members can send encrypted room messages" on public.messages
for insert to authenticated with check (
  user_id = auth.uid() and public.is_conversation_member(conversation_id)
);

drop policy if exists "users can read shared participants public keys" on public.user_keys;
create policy "users can read shared participants public keys" on public.user_keys
for select to authenticated using (
  user_id = auth.uid() or exists (
    select 1 from public.conversation_members mine
    join public.conversation_members peer on peer.conversation_id = mine.conversation_id
    where mine.user_id = auth.uid() and peer.user_id = user_keys.user_id
  )
);

drop policy if exists "users can publish own public key" on public.user_keys;
create policy "users can publish own public key" on public.user_keys
for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "users can update own public key" on public.user_keys;

create or replace function public.create_conversation(p_title text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 60 then
    raise exception 'Room name must be between 1 and 60 characters';
  end if;
  insert into public.conversations(title, created_by) values (trim(p_title), auth.uid()) returning id into new_id;
  insert into public.conversation_members(conversation_id, user_id) values (new_id, auth.uid());
  return new_id;
end;
$$;

create or replace function public.join_conversation(p_conversation_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not exists (select 1 from public.conversations c where c.id = p_conversation_id) then
    raise exception 'Room not found';
  end if;
  insert into public.conversation_members(conversation_id, user_id)
  values (p_conversation_id, auth.uid()) on conflict do nothing;
  return p_conversation_id;
end;
$$;

revoke all on function public.create_conversation(text) from public;
revoke all on function public.join_conversation(uuid) from public;
grant execute on function public.create_conversation(text) to authenticated;
grant execute on function public.join_conversation(uuid) to authenticated;
grant select on public.conversations, public.conversation_members, public.messages, public.user_keys to authenticated;
grant insert on public.messages to authenticated;
grant insert on public.user_keys to authenticated;

-- Private Realtime Broadcast topics use chat:<conversation UUID>.
alter table realtime.messages enable row level security;
drop policy if exists "conversation members can receive private chat events" on realtime.messages;
create policy "conversation members can receive private chat events"
on realtime.messages for select to authenticated
using (
  case
    when realtime.topic() ~ '^chat:[0-9a-fA-F-]{36}$'
    then public.is_conversation_member(split_part(realtime.topic(), ':', 2)::uuid)
    else false
  end
);
drop policy if exists "conversation members can send private chat events" on realtime.messages;
create policy "conversation members can send private chat events"
on realtime.messages for insert to authenticated
with check (
  case
    when realtime.topic() ~ '^chat:[0-9a-fA-F-]{36}$'
    then public.is_conversation_member(split_part(realtime.topic(), ':', 2)::uuid)
    else false
  end
);

-- Add the messages table to Supabase Realtime publication if it is not already present.
do $
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
exception when undefined_object then
  raise notice 'supabase_realtime publication is unavailable; enable messages Realtime in the Supabase dashboard.';
end
$;
