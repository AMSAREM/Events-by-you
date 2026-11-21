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
  phone text,
  phone_verified boolean not null default false,
  studio text not null default 'Events Studio',
  plan text not null default 'Starter' check (plan in ('Starter', 'Pro Organizer', 'Enterprise')),
  sms_credits integer not null default 0,
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

alter table public.profiles
  add column if not exists phone text;

alter table public.profiles
  add column if not exists phone_verified boolean not null default false;

alter table public.profiles
  add column if not exists plan_billing_cycle text default 'monthly' check (plan_billing_cycle in ('monthly', 'annual'));

alter table public.profiles
  add column if not exists plan_expires_at timestamptz;

create unique index if not exists idx_profiles_unique_phone
  on public.profiles (phone)
  where phone is not null and phone <> '';

-- Automatically provision a profile when a user signs up via Supabase Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  full_name text;
  requested_app_role text;
  user_phone text;
  is_phone_verified boolean;
begin
  full_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(new.email, 'Organiser'), '@', 1));
  requested_app_role := case
    when (new.raw_user_meta_data ->> 'app_role') = 'gate_staff' then 'gate_staff'
    else 'organizer'
  end;
  user_phone := nullif(trim(coalesce(new.phone, new.raw_user_meta_data ->> 'phone', '')), '');
  is_phone_verified := coalesce((new.raw_user_meta_data ->> 'phone_verified')::boolean, new.phone_confirmed_at is not null, false);
  insert into public.profiles (id, email, phone, phone_verified, name, first_name, role, app_role, studio)
  values (
    new.id,
    coalesce(new.email, ''),
    user_phone,
    is_phone_verified,
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
    new.phone_verified := old.phone_verified;
    new.plan := old.plan;
    new.plan_billing_cycle := old.plan_billing_cycle;
    new.plan_expires_at := old.plan_expires_at;
    new.sms_credits := old.sms_credits;
  end if;
  -- Never allow promoting another user row to creator from authenticated updates
  if auth.uid() is not null and new.app_role = 'creator' and old.app_role is distinct from 'creator' then
    new.app_role := old.app_role;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_privilege on public.profiles;
create trigger trg_protect_profile_privilege
  before update on public.profiles
  for each row execute procedure public.protect_profile_privilege_columns();

create or replace function public.enforce_single_creator_role()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.app_role = 'creator' and exists (
    select 1 from public.profiles
    where app_role = 'creator' and id <> new.id
  ) then
    raise exception 'The creator role is exclusive and cannot be assigned to another user.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_single_creator_role on public.profiles;
create trigger trg_enforce_single_creator_role
  before insert or update on public.profiles
  for each row execute procedure public.enforce_single_creator_role();

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
  qr_pass_published boolean not null default false,
  design_theme text,
  validation_config jsonb,
  extra_data_config jsonb,
  created_at timestamptz not null default now()
);

alter table public.events
  add column if not exists qr_pass_published boolean not null default false;
alter table public.events
  add column if not exists design_theme text;
alter table public.events
  add column if not exists validation_config jsonb;
alter table public.events
  add column if not exists extra_data_config jsonb;
alter table public.events
  add column if not exists message_config jsonb;

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
  validation_group text,
  invite_code_used text,
  gift_entry jsonb,
  custom_responses jsonb,
  created_at timestamptz not null default now(),
  unique (event_id, phone)
);

alter table public.attendees add column if not exists validation_group text;
alter table public.attendees add column if not exists invite_code_used text;
alter table public.attendees add column if not exists gift_entry jsonb;
alter table public.attendees add column if not exists custom_responses jsonb;

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
  shooter_key text,
  caption text,
  film_stock text not null default 'ilford-bw' check (film_stock in ('ilford-bw', 'kodak-gold', 'fuji-c200', 'cinestill-800t')),
  date_stamp text not null,
  captured_at text not null,
  developed boolean not null default true,
  likes integer not null default 0,
  liked boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.disposable_shots
  add column if not exists shooter_key text;

create index if not exists idx_disposable_shots_event on public.disposable_shots(event_id);
create index if not exists idx_disposable_shots_shooter on public.disposable_shots(event_id, shooter_key);

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

-- Attendees RLS (strict creator/owner access for publishing QR passes & managing roster)
drop policy if exists "Organizers can manage attendees of own events" on public.attendees;
create policy "Organizers can manage attendees of own events" on public.attendees
  for select using (
    exists (
      select 1 from public.events e
      where e.id = attendees.event_id and e.organizer_id = auth.uid()
    )
  );

drop policy if exists "Event creators can issue attendee QR passes" on public.attendees;
create policy "Event creators can issue attendee QR passes" on public.attendees
  for insert with check (
    public.current_app_role() in ('creator', 'organizer')
    and exists (
      select 1 from public.events e
      where e.id = attendees.event_id
        and e.organizer_id = auth.uid()
        and e.qr_pass_published = true
    )
  );

drop policy if exists "Organizers can update attendee check-ins" on public.attendees;
create policy "Organizers can update attendee check-ins" on public.attendees
  for update using (
    exists (
      select 1 from public.events e
      where e.id = attendees.event_id and e.organizer_id = auth.uid()
    )
  );

drop policy if exists "Event creators can remove attendees" on public.attendees;
create policy "Event creators can remove attendees" on public.attendees
  for delete using (
    public.current_app_role() in ('creator', 'organizer')
    and exists (
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
  p_ticket_code text default '#EVT-2026-0001',
  p_validation_group text default null,
  p_invite_code_used text default null,
  p_gift_entry jsonb default null,
  p_custom_responses jsonb default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_event public.events;
  v_attendee public.attendees;
  v_owner_plan text;
  v_owner_expires timestamptz;
  v_effective_cap integer;
begin
  select * into v_event from public.events where id = p_event_id and status in ('live', 'upcoming') for update;
  if not found then
    raise exception 'Event not found or not open for registration';
  end if;

  if not v_event.qr_pass_published then
    raise exception 'QR_PASS_NOT_PUBLISHED:%', v_event.title;
  end if;

  select plan, plan_expires_at into v_owner_plan, v_owner_expires
  from public.profiles
  where id = v_event.organizer_id;

  if coalesce(v_owner_plan, 'Starter') = 'Starter'
     or (v_owner_expires is not null and v_owner_expires < now()) then
    v_effective_cap := least(greatest(1, coalesce(v_event.capacity, 50)), 50);
  else
    v_effective_cap := greatest(1, coalesce(v_event.capacity, 100));
  end if;

  if coalesce(v_event.registered, 0) >= v_effective_cap then
    raise exception 'CAPACITY_REACHED:% has reached its attendee limit (% seats).', v_event.title, v_effective_cap;
  end if;

  if exists (select 1 from public.attendees where event_id = p_event_id and phone = p_phone) then
    raise exception 'DUPLICATE_PHONE:% already holds a pass for %', p_phone, v_event.title;
  end if;

  insert into public.attendees (
    id, event_id, name, email, phone, organization, tier, checked_in, ticket_code, sms_status, payment_status, validation_group, invite_code_used, gift_entry, custom_responses
  ) values (
    p_id, p_event_id, p_name, p_email, p_phone, coalesce(nullif(p_organization, ''), 'Fast Pass Attendee'), p_tier, false, p_ticket_code, 'Arkesel Sent', 'paid', p_validation_group, p_invite_code_used, p_gift_entry, p_custom_responses
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

grant execute on function public.register_public_attendee(text, text, text, text, text, text, text, text, text, text, jsonb, jsonb) to anon, authenticated;

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

-- 10. Serverless Auth OTP Challenges (Service-Role Only — RLS Enabled, No Public Policies)
create table if not exists public.auth_otp_challenges (
  id text primary key,
  phone text,
  email text,
  code_hash text not null,
  purpose text not null check (purpose in ('signup', 'login', 'recovery', 'test')),
  attempts integer not null default 0,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_auth_otp_phone on public.auth_otp_challenges(phone) where phone is not null;
create index if not exists idx_auth_otp_email on public.auth_otp_challenges(email) where email is not null;
create index if not exists idx_auth_otp_expires on public.auth_otp_challenges(expires_at);

alter table public.auth_otp_challenges enable row level security;

-- 11. Serverless Staged Pending Signups (Service-Role Only — RLS Enabled, No Public Policies)
create table if not exists public.pending_signups (
  phone text primary key,
  email text not null,
  password_enc text not null,
  name text not null,
  studio text not null,
  country_gateway text not null default 'GH',
  app_role text not null default 'organizer' check (app_role in ('organizer', 'gate_staff')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_pending_signups_email on public.pending_signups(email);
create index if not exists idx_pending_signups_expires on public.pending_signups(expires_at);

alter table public.pending_signups enable row level security;

-- 12. Arkesel SMS Bundle Purchase Ledger & Atomic Credit Allocation
create table if not exists public.sms_bundle_purchases (
  id text primary key,
  organizer_id uuid not null references public.profiles(id) on delete cascade,
  bundle_id text not null,
  bundle_name text not null,
  credits integer not null check (credits > 0),
  amount_ghs numeric(10, 2) not null check (amount_ghs > 0),
  payment_channel text not null,
  provider text not null check (provider in ('paystack', 'arkesel_manual', 'sandbox')),
  reference text not null unique,
  status text not null check (status in ('pending_payment', 'pending_verification', 'credited', 'rejected', 'failed')),
  rejection_reason text,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

create index if not exists idx_sms_bundle_purchases_organizer
  on public.sms_bundle_purchases(organizer_id, created_at desc);

create index if not exists idx_sms_bundle_purchases_status
  on public.sms_bundle_purchases(status, created_at desc);

alter table public.sms_bundle_purchases enable row level security;

drop policy if exists "Organizers view own SMS bundle purchases" on public.sms_bundle_purchases;
create policy "Organizers view own SMS bundle purchases" on public.sms_bundle_purchases
  for select using (auth.uid() = organizer_id or public.is_creator());

create or replace function public.credit_organizer_sms_bundle(
  p_purchase_id text,
  p_payment_channel text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_purchase public.sms_bundle_purchases;
  v_profile public.profiles;
  v_now timestamptz := now();
begin
  select * into v_purchase
  from public.sms_bundle_purchases
  where id = p_purchase_id
  for update;

  if not found then
    raise exception 'PURCHASE_NOT_FOUND';
  end if;

  if v_purchase.status = 'credited' then
    select * into v_profile from public.profiles where id = v_purchase.organizer_id;
    return jsonb_build_object(
      'alreadyCredited', true,
      'purchase', to_jsonb(v_purchase),
      'smsCredits', coalesce(v_profile.sms_credits, 0)
    );
  end if;

  if v_purchase.status = 'rejected' then
    raise exception 'PURCHASE_REJECTED';
  end if;

  update public.sms_bundle_purchases
  set
    status = 'credited',
    payment_channel = coalesce(nullif(trim(p_payment_channel), ''), payment_channel),
    verified_at = v_now
  where id = p_purchase_id
  returning * into v_purchase;

  update public.profiles
  set
    sms_credits = greatest(0, sms_credits) + v_purchase.credits,
    updated_at = v_now
  where id = v_purchase.organizer_id
  returning * into v_profile;

  return jsonb_build_object(
    'alreadyCredited', false,
    'purchase', to_jsonb(v_purchase),
    'smsCredits', coalesce(v_profile.sms_credits, 0)
  );
end;
$$;

grant execute on function public.credit_organizer_sms_bundle(text, text) to service_role;

-- 13. Organizer Subscription Payments Ledger & Atomic Plan Activation
create table if not exists public.subscription_payments (
  id text primary key,
  organizer_id uuid not null references public.profiles(id) on delete cascade,
  plan_id text not null check (plan_id in ('pro', 'enterprise')),
  plan_name text not null check (plan_name in ('Pro Organizer', 'Enterprise')),
  billing_cycle text not null check (billing_cycle in ('monthly', 'annual')),
  amount_usd numeric(10, 2) not null check (amount_usd > 0),
  amount_ghs numeric(10, 2) not null check (amount_ghs > 0),
  payment_channel text not null,
  provider text not null check (provider in ('paystack', 'manual', 'sandbox')),
  reference text not null unique,
  status text not null check (status in ('pending_payment', 'pending_verification', 'active', 'rejected', 'failed')),
  rejection_reason text,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

create index if not exists idx_subscription_payments_organizer
  on public.subscription_payments(organizer_id, created_at desc);

create index if not exists idx_subscription_payments_status
  on public.subscription_payments(status, created_at desc);

alter table public.subscription_payments enable row level security;

drop policy if exists "Organizers view own subscription payments" on public.subscription_payments;
create policy "Organizers view own subscription payments" on public.subscription_payments
  for select using (auth.uid() = organizer_id or public.is_creator());

create or replace function public.activate_organizer_subscription(
  p_payment_id text,
  p_payment_channel text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_payment public.subscription_payments;
  v_profile public.profiles;
  v_now timestamptz := now();
  v_end timestamptz;
begin
  select * into v_payment
  from public.subscription_payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'SUBSCRIPTION_PAYMENT_NOT_FOUND';
  end if;

  if v_payment.status = 'active' then
    select * into v_profile from public.profiles where id = v_payment.organizer_id;
    return jsonb_build_object(
      'alreadyActivated', true,
      'payment', to_jsonb(v_payment),
      'plan', v_profile.plan,
      'planBillingCycle', v_profile.plan_billing_cycle,
      'planExpiresAt', v_profile.plan_expires_at
    );
  end if;

  if v_payment.status = 'rejected' then
    raise exception 'SUBSCRIPTION_PAYMENT_REJECTED';
  end if;

  v_end := v_now + (case when v_payment.billing_cycle = 'annual' then interval '365 days' else interval '30 days' end);

  update public.subscription_payments
  set
    status = 'active',
    payment_channel = coalesce(nullif(trim(p_payment_channel), ''), payment_channel),
    period_start = v_now,
    period_end = v_end,
    verified_at = v_now
  where id = p_payment_id
  returning * into v_payment;

  update public.profiles
  set
    plan = v_payment.plan_name,
    plan_billing_cycle = v_payment.billing_cycle,
    plan_expires_at = v_end,
    updated_at = v_now
  where id = v_payment.organizer_id
  returning * into v_profile;

  return jsonb_build_object(
    'alreadyActivated', false,
    'payment', to_jsonb(v_payment),
    'plan', v_profile.plan,
    'planBillingCycle', v_profile.plan_billing_cycle,
    'planExpiresAt', v_profile.plan_expires_at
  );
end;
$$;

grant execute on function public.activate_organizer_subscription(text, text) to service_role;

notify pgrst, 'reload schema';
