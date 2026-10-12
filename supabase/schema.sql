-- Run this SQL in Supabase SQL Editor before using the chat.
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

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists messages_room_created_idx on public.messages(conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists "members can view their conversations" on public.conversations;
create policy "members can view their conversations" on public.conversations
for select to authenticated using (
  exists (select 1 from public.conversation_members cm where cm.conversation_id = conversations.id and cm.user_id = auth.uid())
);

drop policy if exists "members can view room membership" on public.conversation_members;
create policy "members can view room membership" on public.conversation_members
for select to authenticated using (
  exists (select 1 from public.conversation_members own where own.conversation_id = conversation_members.conversation_id and own.user_id = auth.uid())
);

drop policy if exists "members can read room messages" on public.messages;
create policy "members can read room messages" on public.messages
for select to authenticated using (
  exists (select 1 from public.conversation_members cm where cm.conversation_id = messages.conversation_id and cm.user_id = auth.uid())
);

drop policy if exists "members can send room messages" on public.messages;
create policy "members can send room messages" on public.messages
for insert to authenticated with check (
  user_id = auth.uid() and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id and cm.user_id = auth.uid()
  )
);

create or replace function public.create_conversation(p_title text)
returns uuid
language plpgsql
security definer
set search_path = ''
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
returns uuid
language plpgsql
security definer
set search_path = ''
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
grant select on public.conversations, public.conversation_members, public.messages to authenticated;
grant insert on public.messages to authenticated;

-- Enable private Broadcast authorization for topics formatted as chat:<conversation UUID>.
-- Realtime draft events are ephemeral Broadcast messages, never rows in public.messages.
alter table realtime.messages enable row level security;
drop policy if exists "conversation members can receive private chat events" on realtime.messages;
create policy "conversation members can receive private chat events"
on realtime.messages for select to authenticated
using (
  realtime.topic() like 'chat:%'
  and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id::text = split_part(realtime.topic(), ':', 2)
      and cm.user_id = auth.uid()
  )
);
drop policy if exists "conversation members can send private chat events" on realtime.messages;
create policy "conversation members can send private chat events"
on realtime.messages for insert to authenticated
with check (
  realtime.topic() like 'chat:%'
  and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id::text = split_part(realtime.topic(), ':', 2)
      and cm.user_id = auth.uid()
  )
);

-- Enable Realtime database changes for the messages table in the Supabase dashboard if not already enabled.
