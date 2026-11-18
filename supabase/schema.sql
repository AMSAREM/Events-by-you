-- Events App — Supabase PostgreSQL Schema, Triggers & Row Level Security (Single Source of Truth)
-- Run this script in your Supabase Project SQL Editor.

create extension if not exists "pgcrypto";

-- 1. Organizer Profiles (1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Organiser',
  first_name text not null default 'Organiser',
  role text not null default 'Lead Organiser',
  app_role text not null default 'organizer' check (app_role in ('creator', 'organizer', 'gate_staff')),
  email text not null,
  studio text not null default 'Events Studio',
  plan text not null default 'Starter' check (plan in ('Starter', 'Pro Organizer', 'Enterprise')),
  sms_credits integer not null default 20,
  capacity_alert_threshold integer not null default 90,
  avatar_url text,
  reply_to_email text,
  timezone text default 'Africa/Accra',
  two_factor_enabled boolean not null default false,
  sender_id text default 'EVENTSAPP',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists app_role text not null default 'organizer' check (app_role in ('creator', 'organizer', 'gate_staff'));

-- Automatically provision a profile when a user signs up via Supabase Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  full_name text;
  requested_app_role text;
begin
  full_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(new.email, 'Organiser'), '@', 1));
  requested_app_role := case
    when (new.raw_user_meta_data ->> 'app_role') = 'gate_staff' then 'gate_staff'
    else 'organizer'
  end;
  insert into public.profiles (id, email, name, first_name, role, app_role, studio)
  values (
    new.id,
    coalesce(new.email, ''),
    full_name,
    split_part(full_name, ' ', 1),
    case when requested_app_role = 'gate_staff' then 'Gate Check-In Staff' else 'Lead Organiser' end,
    requested_app_role,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'studio'), ''), 'Events Studio')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Role helpers & anti-privilege-escalation guard
create or replace function public.current_app_role()
returns text
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select app_role from public.profiles where id = auth.uid()), 'organizer');
$$;

create or replace function public.is_creator()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and app_role = 'creator'
  );
$$;

create or replace function public.protect_profile_privilege_columns()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Service role / postgres superuser bypasses auth.uid()
  if auth.uid() is not null and not public.is_creator() then
    new.app_role := old.app_role;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_privilege on public.profiles;
create trigger trg_protect_profile_privilege
  before update on public.profiles
  for each row execute procedure public.protect_profile_privilege_columns();

-- 2. Events
create table if not exists public.events (
  id text primary key,
  organizer_id uuid not null references public.profiles(id) on delete cascade,
  slug text not null unique,
  title text not null,
  subtitle text not null default '',
  category text not null default 'Events',
  status text not null default 'upcoming' check (status in ('live', 'upcoming', 'draft', 'past')),
  date text not null,
  iso_date text not null,
  time text not null,
  venue text not null,
  city text not null,
  capacity integer not null default 100,
  registered integer not null default 0,
  checked_in integer not null default 0,
  sms_dispatched integer not null default 0,
  ticket_price integer not null default 0,
  revenue integer not null default 0,
  organizer text not null default 'Organiser',
  artwork text not null default 'architecture' check (artwork in ('architecture', 'sound', 'typography', 'hardware', 'spatial', 'forum')),
  broadcast_error text,
  flyer_url text,
  venue_format text default 'in-person' check (venue_format in ('in-person', 'virtual', 'hybrid')),
  sender_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_events_organizer on public.events(organizer_id);
create index if not exists idx_events_status on public.events(status);

-- 3. Attendees
create table if not exists public.attendees (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  name text not null,
  email text not null,
  phone text not null,
  organization text not null default 'General Guest',
  tier text not null default 'General' check (tier in ('VIP', 'General', 'Speaker', 'Press')),
  checked_in boolean not null default false,
  checked_in_at text,
  ticket_code text not null,
  sms_status text not null default 'Arkesel Sent' check (sms_status in ('Arkesel Sent', 'Resend Delivered', 'Pending')),
  payment_status text not null default 'paid' check (payment_status in ('paid', 'failed')),
  created_at timestamptz not null default now(),
  unique (event_id, phone)
);

create index if not exists idx_attendees_event on public.attendees(event_id);

-- 4. Schedule Blocks
create table if not exists public.schedule_blocks (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  time text not null,
  duration text not null,
  title text not null,
  stage text not null,
  lead text not null,
  completed boolean not null default false,
  day text not null default 'Sat' check (day in ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat')),
  created_at timestamptz not null default now()
);

create index if not exists idx_schedule_event on public.schedule_blocks(event_id);

-- 5. System Alerts
create table if not exists public.system_alerts (
  id text primary key,
  organizer_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  detail text not null,
  category text not null check (category in ('capacity', 'broadcast', 'payment')),
  event_id text references public.events(id) on delete set null,
  timestamp text not null default 'Just now',
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_alerts_organizer on public.system_alerts(organizer_id);

-- 6. Disposable Camera Roll Settings
create table if not exists public.disposable_roll_settings (
  event_id text primary key references public.events(id) on delete cascade,
  exposures_limit integer not null default 24 check (exposures_limit in (12, 24, 36)),
  darkroom_mode boolean not null default false,
  updated_at timestamptz not null default now()
);

-- 7. Disposable Camera Shots
create table if not exists public.disposable_shots (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  frame_number integer not null,
  data_url text not null,
  captured_by text not null,
  caption text,
  film_stock text not null default 'ilford-bw' check (film_stock in ('ilford-bw', 'kodak-gold', 'fuji-c200', 'cinestill-800t')),
  date_stamp text not null,
  captured_at text not null,
  developed boolean not null default true,
  likes integer not null default 0,
  liked boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_disposable_shots_event on public.disposable_shots(event_id);

-- Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.attendees enable row level security;
alter table public.schedule_blocks enable row level security;
alter table public.system_alerts enable row level security;
alter table public.disposable_roll_settings enable row level security;
alter table public.disposable_shots enable row level security;

-- Profiles RLS
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id or public.is_creator());

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles
  for insert with check (auth.uid() = id and app_role in ('organizer', 'gate_staff'));

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id or public.is_creator());

-- Events RLS
drop policy if exists "Public can view live or upcoming events" on public.events;
create policy "Public can view live or upcoming events" on public.events
  for select using (status in ('live', 'upcoming') or auth.uid() = organizer_id or public.is_creator());

drop policy if exists "Organizers can insert own events" on public.events;
create policy "Organizers can insert own events" on public.events
  for insert with check (auth.uid() = organizer_id and public.current_app_role() in ('creator', 'organizer'));

drop policy if exists "Organizers can update own events" on public.events;
create policy "Organizers can update own events" on public.events
  for update using ((auth.uid() = organizer_id and public.current_app_role() in ('creator', 'organizer')) or public.is_creator());

drop policy if exists "Organizers can delete own events" on public.events;
create policy "Organizers can delete own events" on public.events
  for delete using ((auth.uid() = organizer_id and public.current_app_role() in ('creator', 'organizer')) or public.is_creator());

-- Attendees RLS (strict organizer access for list/check-in)
drop policy if exists "Organizers can manage attendees of own events" on public.attendees;
create policy "Organizers can manage attendees of own events" on public.attendees
  for all using (
    exists (
      select 1 from public.events e
      where e.id = attendees.event_id and e.organizer_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = attendees.event_id and e.organizer_id = auth.uid()
    )
  );

-- Schedule Blocks RLS
drop policy if exists "Organizers can manage schedule blocks of own events" on public.schedule_blocks;
create policy "Organizers can manage schedule blocks of own events" on public.schedule_blocks
  for all using (
    exists (
      select 1 from public.events e
      where e.id = schedule_blocks.event_id and e.organizer_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = schedule_blocks.event_id and e.organizer_id = auth.uid()
    )
  );

-- System Alerts RLS
drop policy if exists "Organizers can manage own alerts" on public.system_alerts;
create policy "Organizers can manage own alerts" on public.system_alerts
  for all using (auth.uid() = organizer_id)
  with check (auth.uid() = organizer_id);

-- Disposable Roll Settings RLS
drop policy if exists "Organizers can manage roll settings of own events" on public.disposable_roll_settings;
create policy "Organizers can manage roll settings of own events" on public.disposable_roll_settings
  for all using (
    exists (
      select 1 from public.events e
      where e.id = disposable_roll_settings.event_id and e.organizer_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = disposable_roll_settings.event_id and e.organizer_id = auth.uid()
    )
  );

-- Disposable Shots RLS
drop policy if exists "Organizers can manage camera shots of own events" on public.disposable_shots;
create policy "Organizers can manage camera shots of own events" on public.disposable_shots
  for all using (
    exists (
      select 1 from public.events e
      where e.id = disposable_shots.event_id and e.organizer_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = disposable_shots.event_id and e.organizer_id = auth.uid()
    )
  );

-- Atomic Public RSVP Registration RPC (usable safely by public guests without exposing attendee roster PII)
create or replace function public.register_public_attendee(
  p_id text,
  p_event_id text,
  p_name text,
  p_email text,
  p_phone text,
  p_organization text default 'Fast Pass Attendee',
  p_tier text default 'General',
  p_ticket_code text default '#EVT-2026-0001'
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_event public.events;
  v_attendee public.attendees;
begin
  select * into v_event from public.events where id = p_event_id and status in ('live', 'upcoming') for update;
  if not found then
    raise exception 'Event not found or not open for registration';
  end if;

  if exists (select 1 from public.attendees where event_id = p_event_id and phone = p_phone) then
    raise exception 'DUPLICATE_PHONE:% already holds a pass for %', p_phone, v_event.title;
  end if;

  insert into public.attendees (
    id, event_id, name, email, phone, organization, tier, checked_in, ticket_code, sms_status, payment_status
  ) values (
    p_id, p_event_id, p_name, p_email, p_phone, coalesce(nullif(p_organization, ''), 'Fast Pass Attendee'), p_tier, false, p_ticket_code, 'Arkesel Sent', 'paid'
  )
  returning * into v_attendee;

  update public.events
  set
    registered = registered + 1,
    sms_dispatched = sms_dispatched + 1,
    revenue = revenue + ticket_price
  where id = p_event_id
  returning * into v_event;

  return jsonb_build_object(
    'attendee', to_jsonb(v_attendee),
    'event', to_jsonb(v_event)
  );
end;
$$;

grant execute on function public.register_public_attendee(text, text, text, text, text, text, text, text) to anon, authenticated;

-- 8. Apps Creator Console — Registered Apps & API Clients
create table if not exists public.creator_apps (
  id text primary key,
  organizer_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  slug text not null,
  description text not null default '',
  app_type text not null default 'widget' check (app_type in ('kiosk', 'webhook-worker', 'widget', 'mobile-app')),
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  status text not null default 'active' check (status in ('active', 'paused')),
  event_id text references public.events(id) on delete set null,
  client_id text not null unique,
  secret_hash text not null,
  secret_prefix text not null,
  webhook_secret text not null,
  scopes text[] not null default array['events:read', 'attendees:read'],
  webhook_url text,
  webhook_events text[] not null default array[]::text[],
  allowed_origins text[] not null default array[]::text[],
  requests_count integer not null default 0,
  last_used_at text,
  created_at timestamptz not null default now()
);

create index if not exists idx_creator_apps_organizer on public.creator_apps(organizer_id);

-- 9. Apps Creator Console — Invocation & Webhook Delivery Logs
create table if not exists public.creator_app_logs (
  id text primary key,
  app_id text not null references public.creator_apps(id) on delete cascade,
  event_type text not null,
  method text not null,
  endpoint text not null,
  status_code integer not null,
  latency_ms integer not null default 0,
  request_summary text not null default '',
  response_summary text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_creator_app_logs_app on public.creator_app_logs(app_id);

alter table public.creator_apps enable row level security;
alter table public.creator_app_logs enable row level security;

drop policy if exists "Organizers can manage own creator apps" on public.creator_apps;
create policy "Organizers can manage own creator apps" on public.creator_apps
  for all using (public.is_creator() and auth.uid() = organizer_id)
  with check (public.is_creator() and auth.uid() = organizer_id);

drop policy if exists "Organizers can view logs of own creator apps" on public.creator_app_logs;
create policy "Organizers can view logs of own creator apps" on public.creator_app_logs
  for all using (
    public.is_creator() and exists (
      select 1 from public.creator_apps a
      where a.id = creator_app_logs.app_id and a.organizer_id = auth.uid()
    )
  )
  with check (
    public.is_creator() and exists (
      select 1 from public.creator_apps a
      where a.id = creator_app_logs.app_id and a.organizer_id = auth.uid()
    )
  );

