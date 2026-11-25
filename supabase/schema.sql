create extension if not exists pgcrypto;
-- PROFILES
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique
    check (username ~ '^[a-z0-9_]{3,24}$'),
  created_at timestamptz not null default now()
);

-- WISHLIST
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
  purchased_by_owner boolean not null default false,
  actual_paid numeric(12,2) check (actual_paid is null or actual_paid >= 0),
  purchased_at date,
  created_at timestamptz not null default now()
);

-- Safe upgrades for databases that already have wishes.
alter table public.wishes
  add column if not exists purchased_by_owner boolean not null default false;
alter table public.wishes
  add column if not exists actual_paid numeric(12,2);
alter table public.wishes
  add column if not exists purchased_at date;

-- GIFT RESERVATIONS
create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  wish_id uuid not null references public.wishes(id) on delete cascade,
  gifter_name text,
  message text check (message is null or char_length(message) <= 180),
  reveal_name boolean not null default false,
  status text not null default 'reserved'
    check (status in ('reserved','cancelled')),
  created_at timestamptz not null default now()
);

create unique index if not exists one_active_reservation_per_wish
on public.reservations(wish_id) where status = 'reserved';

-- MONTHLY BUDGETS
create table if not exists public.shopping_budgets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  budget_month date not null,
  amount numeric(12,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique(owner_id, budget_month)
);

-- EXPENSES, PURCHASES AND GIFTS
create table if not exists public.shopping_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  wish_id uuid references public.wishes(id) on delete set null,
  transaction_type text not null
    check (transaction_type in ('purchase','gift','expense')),
  title text not null check (char_length(title) between 1 and 120),
  category text not null default 'Other',
  amount numeric(12,2) not null check (amount >= 0),
  merchant text,
  notes text,
  occurred_on date not null default current_date,
  created_at timestamptz not null default now()
);

-- Prevent duplicate purchase/gift transactions for a wishlist item.
create unique index if not exists one_wish_transaction
on public.shopping_transactions(wish_id)
where wish_id is not null;

-- ROW LEVEL SECURITY
alter table public.profiles enable row level security;
alter table public.wishes enable row level security;
alter table public.reservations enable row level security;
alter table public.shopping_budgets enable row level security;
alter table public.shopping_transactions enable row level security;

-- PROFILES
drop policy if exists "owner reads own profile" on public.profiles;
create policy "owner reads own profile"
on public.profiles for select to authenticated
using (auth.uid() = id);

drop policy if exists "owner creates own profile" on public.profiles;
create policy "owner creates own profile"
on public.profiles for insert to authenticated
with check (auth.uid() = id);

drop policy if exists "owner updates own profile" on public.profiles;
create policy "owner updates own profile"
on public.profiles for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- WISHES
drop policy if exists "owner reads own wishes" on public.wishes;
create policy "owner reads own wishes"
on public.wishes for select to authenticated
using (auth.uid() = owner_id);

drop policy if exists "owner adds own wishes" on public.wishes;
create policy "owner adds own wishes"
on public.wishes for insert to authenticated
with check (auth.uid() = owner_id);

drop policy if exists "owner edits own wishes" on public.wishes;
create policy "owner edits own wishes"
on public.wishes for update to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "owner deletes own wishes" on public.wishes;
create policy "owner deletes own wishes"
on public.wishes for delete to authenticated
using (auth.uid() = owner_id);

-- RESERVATIONS: private to the owner of the wish.
drop policy if exists "owner reads reservations for own wishes" on public.reservations;
create policy "owner reads reservations for own wishes"
on public.reservations for select to authenticated
using (
  exists (
    select 1 from public.wishes w
    where w.id = wish_id and w.owner_id = auth.uid()
  )
);

-- BUDGETS
drop policy if exists "owners manage own budgets" on public.shopping_budgets;
create policy "owners manage own budgets"
on public.shopping_budgets for all to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

-- TRANSACTIONS
drop policy if exists "owners manage own transactions" on public.shopping_transactions;
create policy "owners manage own transactions"
on public.shopping_transactions for all to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

-- PUBLIC PROFILE LOOKUP
create or replace function public.get_public_profile(p_username text)
returns table(username text)
language sql
security definer
set search_path = public
stable
as $$
  select p.username
  from public.profiles p
  where p.username = lower(p_username)
  limit 1;
$$;

-- PUBLIC WISHLIST: does not reveal gifter identities or messages.
create or replace function public.get_public_wishlist(p_username text)
returns table(
  id uuid,
  name text,
  price numeric,
  category text,
  product_url text,
  image_url text,
  notes text,
  delivered boolean,
  reserved boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    w.id, w.name, w.price, w.category, w.product_url,
    w.image_url, w.notes, w.delivered,
    exists (
      select 1 from public.reservations r
      where r.wish_id = w.id and r.status = 'reserved'
    ) as reserved
  from public.wishes w
  join public.profiles p on p.id = w.owner_id
  where p.username = lower(p_username)
  order by w.created_at desc;
$$;

-- ATOMIC PUBLIC RESERVATION
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
  if not exists (
    select 1 from public.wishes
    where id = p_wish_id and delivered = false
  ) then
    raise exception 'This wish is no longer available.';
  end if;

  insert into public.reservations(
    wish_id, gifter_name, message, reveal_name, status
  )
  values (
    p_wish_id,
    case
      when p_reveal_name
      then nullif(left(trim(coalesce(p_gifter_name,'')),80),'')
      else null
    end,
    nullif(left(trim(coalesce(p_message,'')),180),''),
    coalesce(p_reveal_name,false),
    'reserved'
  )
  returning id into new_id;

  return new_id;
exception
  when unique_violation then
    raise exception 'This wish has already been reserved.';
end;
$$;

-- OWNER-ONLY RESERVATION DETAILS
create or replace function public.get_my_reservations()
returns table(
  wish_id uuid,
  gifter_name text,
  message text,
  reveal_name boolean,
  created_at timestamptz
)
language sql
security invoker
stable
as $$
  select
    r.wish_id,
    case when r.reveal_name then r.gifter_name else null end,
    r.message,
    r.reveal_name,
    r.created_at
  from public.reservations r
  join public.wishes w on w.id = r.wish_id
  where w.owner_id = auth.uid() and r.status = 'reserved';
$$;

-- OWNER-ONLY RELEASE
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

grant execute on function public.get_public_profile(text) to anon, authenticated;
grant execute on function public.get_public_wishlist(text) to anon, authenticated;
grant execute on function public.reserve_wish(uuid,text,text,boolean) to anon, authenticated;
grant execute on function public.get_my_reservations() to authenticated;
grant execute on function public.release_my_reservation(uuid) to authenticated;

-- TABLE PERMISSIONS
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.wishes to authenticated;
grant select on public.reservations to authenticated;
grant select, insert, update, delete on public.shopping_budgets to authenticated;
grant select, insert, update, delete on public.shopping_transactions to authenticated;

-- PRODUCT IMAGE STORAGE
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wish-images',
  'wish-images',
  true,
  5242880,
  array['image/png','image/jpeg','image/jpg','image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/png','image/jpeg','image/jpg','image/webp'];

drop policy if exists "wish images public view" on storage.objects;
create policy "wish images public view"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'wish-images');

drop policy if exists "users upload own wish images" on storage.objects;
create policy "users upload own wish images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'wish-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "users update own wish images" on storage.objects;
create policy "users update own wish images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'wish-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'wish-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "users delete own wish images" on storage.objects;
create policy "users delete own wish images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'wish-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);