-- ImagineIt Fashion Library V2
-- Run this entire file in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'admin' check (role in ('admin','staff')),
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('Partywear','Bridal','Sarees','Eveningwear','Other')),
  size text not null default 'Free',
  color text,
  rental_price numeric(12,2) not null default 0,
  deposit numeric(12,2) not null default 0,
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.rentals (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  item_id uuid not null references public.items(id) on delete restrict,
  pickup_date date not null,
  return_date date not null,
  price numeric(12,2) not null default 0,
  deposit numeric(12,2) not null default 0,
  status text not null default 'active' check (status in ('active','returned','cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  constraint valid_rental_dates check (return_date >= pickup_date)
);

create index if not exists rentals_item_dates_idx on public.rentals(item_id,pickup_date,return_date);
create index if not exists rentals_return_date_idx on public.rentals(return_date);

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.items enable row level security;
alter table public.rentals enable row level security;

-- For V2 admin/staff use, authenticated users can read/write these tables.
-- Tighten these policies further when you add multiple staff roles.
drop policy if exists "authenticated profiles" on public.profiles;
create policy "authenticated profiles" on public.profiles for all to authenticated using (true) with check (true);

drop policy if exists "authenticated customers" on public.customers;
create policy "authenticated customers" on public.customers for all to authenticated using (true) with check (true);

drop policy if exists "authenticated items" on public.items;
create policy "authenticated items" on public.items for all to authenticated using (true) with check (true);

drop policy if exists "authenticated rentals" on public.rentals;
create policy "authenticated rentals" on public.rentals for all to authenticated using (true) with check (true);

-- Automatically create a profile for every new authenticated user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles(id,full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Prevent overlapping active rentals for the same clothing item.
create or replace function public.prevent_rental_overlap()
returns trigger language plpgsql
as $$
begin
  if new.status = 'active' and exists (
    select 1 from public.rentals r
    where r.item_id = new.item_id
      and r.status = 'active'
      and r.id <> coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid)
      and daterange(r.pickup_date, r.return_date + 1, '[]')
          && daterange(new.pickup_date, new.return_date + 1, '[]')
  ) then
    raise exception 'This item is already booked for part of those dates.';
  end if;
  return new;
end;
$$;

drop trigger if exists rental_overlap_guard on public.rentals;
create trigger rental_overlap_guard
before insert or update on public.rentals
for each row execute procedure public.prevent_rental_overlap();

-- Optional sample data:
-- insert into public.items(name,category,size,color,rental_price,deposit)
-- values ('Blush Satin Evening Gown','Partywear','S','Blush Pink',4500,8000);
