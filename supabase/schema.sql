-- WishLink database setup
-- Paste this entire file into Supabase Dashboard > SQL Editor > New query > Run.
-- The app uses the public/publishable (anon) key only. Never expose service_role keys.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.wishes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 90),
  price numeric(12,2) check (price is null or price >= 0),
  category text not null default 'Everything',
  product_url text,
  image_url text,
  notes text check (notes is null or char_length(notes) <= 240),
  delivered boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  wish_id uuid not null references public.wishes(id) on delete cascade,
  gifter_name text,
  message text check (message is null or char_length(message) <= 180),
  reveal_name boolean not null default false,
  status text not null default 'reserved' check (status in ('reserved','cancelled')),
  created_at timestamptz not null default now()
);

-- Only one active reservation can exist per wish. This is enforced in the database,
-- so two visitors cannot successfully reserve the same gift at the same time.
create unique index if not exists one_active_reservation_per_wish
on public.reservations(wish_id) where status = 'reserved';

alter table public.profiles enable row level security;
alter table public.wishes enable row level security;
alter table public.reservations enable row level security;

-- Owners can read and update only their own profile.
drop policy if exists "owner reads own profile" on public.profiles;
create policy "owner reads own profile" on public.profiles for select to authenticated using (auth.uid() = id);
drop policy if exists "owner creates own profile" on public.profiles;
create policy "owner creates own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists "owner updates own profile" on public.profiles;
create policy "owner updates own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Owners manage only their own wishlist entries.
drop policy if exists "owner reads own wishes" on public.wishes;
create policy "owner reads own wishes" on public.wishes for select to authenticated using (auth.uid() = owner_id);
drop policy if exists "owner adds own wishes" on public.wishes;
create policy "owner adds own wishes" on public.wishes for insert to authenticated with check (auth.uid() = owner_id);
drop policy if exists "owner edits own wishes" on public.wishes;
create policy "owner edits own wishes" on public.wishes for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "owner deletes own wishes" on public.wishes;
create policy "owner deletes own wishes" on public.wishes for delete to authenticated using (auth.uid() = owner_id);

-- Reservation rows are deliberately NOT directly readable by the public.
-- Only the owner can see reservation details, including revealed names/messages.
drop policy if exists "owner reads reservations for own wishes" on public.reservations;
create policy "owner reads reservations for own wishes" on public.reservations
for select to authenticated using (
  exists (select 1 from public.wishes w where w.id = wish_id and w.owner_id = auth.uid())
);

-- RPC: public profile lookup (does not expose email or auth user ID).
create or replace function public.get_public_profile(p_username text)
returns table(username text)
language sql
security definer
set search_path = public
stable
as $$
  select p.username from public.profiles p where p.username = lower(p_username) limit 1;
$$;

-- RPC: public wishlist data. Does not reveal gifter identities or messages.
create or replace function public.get_public_wishlist(p_username text)
returns table(
  id uuid, name text, price numeric, category text, product_url text,
  image_url text, notes text, delivered boolean, reserved boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select w.id, w.name, w.price, w.category, w.product_url, w.image_url, w.notes,
         w.delivered,
         exists(select 1 from public.reservations r where r.wish_id = w.id and r.status = 'reserved') as reserved
  from public.wishes w
  join public.profiles p on p.id = w.owner_id
  where p.username = lower(p_username)
  order by w.created_at desc;
$$;

-- RPC: reserve atomically. The caller chooses whether their name is revealed.
create or replace function public.reserve_wish(
  p_wish_id uuid,
  p_gifter_name text default null,
  p_message text default null,
  p_reveal_name boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if not exists (select 1 from public.wishes where id = p_wish_id and delivered = false) then
    raise exception 'This wish is no longer available.';
  end if;
  insert into public.reservations(wish_id, gifter_name, message, reveal_name, status)
  values (
    p_wish_id,
    case when p_reveal_name then nullif(left(trim(coalesce(p_gifter_name,'')),80),'') else null end,
    nullif(left(trim(coalesce(p_message,'')),180),''),
    coalesce(p_reveal_name,false),
    'reserved'
  ) returning id into new_id;
  return new_id;
exception when unique_violation then
  raise exception 'This wish has already been reserved.';
end;
$$;

-- Owner-only RPC: return reservation details for their own wishlist.
create or replace function public.get_my_reservations()
returns table(
  wish_id uuid, gifter_name text, message text, reveal_name boolean, created_at timestamptz
)
language sql
security invoker
stable
as $$
  select r.wish_id,
         case when r.reveal_name then r.gifter_name else null end,
         r.message, r.reveal_name, r.created_at
  from public.reservations r
  join public.wishes w on w.id = r.wish_id
  where w.owner_id = auth.uid() and r.status = 'reserved';
$$;

grant execute on function public.get_public_profile(text) to anon, authenticated;
grant execute on function public.get_public_wishlist(text) to anon, authenticated;
grant execute on function public.reserve_wish(uuid,text,text,boolean) to anon, authenticated;
grant execute on function public.get_my_reservations() to authenticated;


-- Owner-only RPC: release an active reservation (used if owner moves a delivered
-- item back to the available list). It does not expose reservation details publicly.
create or replace function public.release_my_reservation(p_wish_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.reservations r
  set status = 'cancelled'
  from public.wishes w
  where r.wish_id = w.id
    and r.wish_id = p_wish_id
    and w.owner_id = auth.uid()
    and r.status = 'reserved';
end;
$$;
grant execute on function public.release_my_reservation(uuid) to authenticated;
