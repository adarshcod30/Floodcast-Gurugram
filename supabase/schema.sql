-- FloodCast Gurugram: citizen report storage.
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New
-- query -> paste -> Run). It is idempotent, so running it twice is safe.
--
-- THE SECURITY MODEL IN ONE PARAGRAPH
-- The anon key shipped in the frontend bundle is public and is meant to be.
-- Everything that matters is enforced here by row level security, not by the
-- client. An anonymous visitor may insert a report, and it can only ever
-- land as 'pending'. An anonymous visitor may read only reports that a
-- moderator has explicitly approved, and only for 12 hours. Approving is
-- restricted to signed-in users. A hostile client holding the anon key can
-- do nothing an ordinary visitor cannot.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),

  -- Where the water is. Constrained to the Gurugram area so a bad or
  -- spoofed coordinate cannot drop a marker in another country.
  lat          double precision not null check (lat  between 28.30 and 28.60),
  lon          double precision not null check (lon  between 76.80 and 77.25),
  -- Device-reported GPS accuracy in metres. Kept so the UI can distinguish
  -- a 5 m fix from a 2 km one instead of drawing both as a precise point.
  accuracy_m   double precision check (accuracy_m is null or accuracy_m >= 0),

  depth        text not null check (depth in ('ankle','knee','waist','impassable')),
  note         text check (note is null or char_length(note) <= 280),
  photo_path   text check (photo_path is null or char_length(photo_path) <= 200),

  status       text not null default 'pending'
                 check (status in ('pending','approved','rejected')),
  reviewed_at  timestamptz
);

create index if not exists reports_status_created_idx
  on public.reports (status, created_at desc);

alter table public.reports enable row level security;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- Anyone may file a report, but only ever as 'pending'. The WITH CHECK is
-- what stops a crafted request from inserting a row pre-approved and
-- publishing itself without review.
--
-- A CLIENT WRITING TO THIS TABLE MUST NOT ASK FOR THE ROW BACK.
-- PostgREST turns `Prefer: return=representation` into INSERT ... RETURNING,
-- and RETURNING needs SELECT permission on the new row. The new row is
-- 'pending', which anonymous callers are not allowed to read, so Postgres
-- rejects the whole statement with "new row violates row-level security
-- policy" even though the insert itself was fine. The error names the
-- insert, but the read is what failed. Use `Prefer: return=minimal`.
drop policy if exists "anon can file a pending report" on public.reports;
create policy "anon can file a pending report"
  on public.reports for insert
  to anon, authenticated
  with check (status = 'pending' and reviewed_at is null);

-- Anyone may read approved reports, and only for 12 hours. A road that
-- flooded this morning has usually drained by evening, so an old report
-- shown as current would be actively misleading.
drop policy if exists "anon reads approved recent reports" on public.reports;
create policy "anon reads approved recent reports"
  on public.reports for select
  to anon
  using (status = 'approved' and created_at > now() - interval '12 hours');

-- ---------------------------------------------------------------------------
-- Who counts as a moderator
-- ---------------------------------------------------------------------------
--
-- Being signed in is NOT enough, and this is the important part.
--
-- Supabase allows public email signup by default (disable_signup = false),
-- so the `authenticated` role means "anyone who owns an email address", not
-- "someone trusted". An earlier version of this file granted moderation to
-- `authenticated` outright, which meant a stranger could sign up, confirm,
-- read every pending report and approve whatever they liked.
--
-- Membership is checked in the database instead, so it still holds if public
-- signup is re-enabled later or an OAuth provider is switched on.

create table if not exists public.moderators (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  added_at   timestamptz not null default now()
);

alter table public.moderators enable row level security;

-- Deliberately no policies: the table is invisible and unwritable through
-- the API for anon and authenticated alike. Membership is granted from the
-- dashboard or a migration, never self-service.
revoke all on public.moderators from anon, authenticated;

create or replace function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.moderators m where m.user_id = auth.uid());
$$;

-- Postgres grants EXECUTE to PUBLIC by default, which would expose this at
-- /rest/v1/rpc/is_moderator to anonymous callers. It leaks nothing (auth.uid()
-- is null for anon, so it answers false), but a SECURITY DEFINER function
-- that reads the allowlist should not be reachable by callers who never
-- evaluate a policy using it.
revoke execute on function public.is_moderator() from public;
revoke execute on function public.is_moderator() from anon;
grant  execute on function public.is_moderator() to authenticated;

-- TWO SUPABASE ADVISORIES REMAIN AFTER THIS FILE, AND BOTH ARE INTENDED.
--
-- "RLS enabled, no policy" on public.moderators: that is the point. RLS on
-- with zero policies denies everything, and the REVOKE above removes the
-- privilege as well. It is the most locked-down state available, not an
-- oversight to be fixed by adding a policy.
--
-- "Signed-in users can execute SECURITY DEFINER function" for
-- is_moderator(): required. The reports policies call it, and RLS evaluates
-- policy functions with the caller's own privileges, so `authenticated`
-- must hold EXECUTE. A signed-in user who calls it directly learns only
-- whether they themselves are a moderator, which they already know.

-- Moderators see everything, including what is waiting and what was
-- rejected. Nobody else does.
drop policy if exists "moderators read all" on public.reports;
create policy "moderators read all"
  on public.reports for select
  to authenticated
  using (public.is_moderator());

-- Only an allowlisted moderator can change a report's status.
drop policy if exists "moderators review" on public.reports;
create policy "moderators review"
  on public.reports for update
  to authenticated
  using (public.is_moderator())
  with check (public.is_moderator() and status in ('approved','rejected'));

-- Nobody deletes through the API. Removal is a dashboard operation, so a
-- compromised key cannot erase the record of what was reported.

-- ---------------------------------------------------------------------------
-- Photo storage
-- ---------------------------------------------------------------------------

-- 1 MB ceiling and JPEG only. The client downscales to roughly 300 KB, so
-- this is a backstop against someone bypassing the app, not a normal limit.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', true, 1048576, array['image/jpeg'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "anon uploads report photos" on storage.objects;
create policy "anon uploads report photos"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'report-photos');

drop policy if exists "anyone reads report photos" on storage.objects;
create policy "anyone reads report photos"
  on storage.objects for select
  using (bucket_id = 'report-photos');

-- HONEST LIMITATION, stated rather than hidden.
--
-- The bucket is public-read, so a photo is technically fetchable before it
-- is approved by anyone who knows its path. Paths are a date plus a random
-- UUID, so they are not enumerable, and crucially the path itself is only
-- ever disclosed through the reports table, which does not return unapproved
-- rows to anonymous readers. In practice an unreviewed photo's location is a
-- 128-bit secret.
--
-- It is still obscurity rather than a permission boundary. Closing it
-- properly means keeping the bucket private and having an edge function mint
-- a signed URL on approval. That is the right fix if this ever carries
-- anything sensitive, and it is deliberately not pretended to be done here.
--
-- Similarly, there is no per-IP rate limit on inserts: PostgREST does not
-- expose the client address to a policy. Abuse is bounded by moderation
-- (nothing is public until approved), the 1 MB per-file cap, and the storage
-- quota. A determined flooder can still fill the bucket, and stopping that
-- needs an edge function in front of the insert.

-- ---------------------------------------------------------------------------
-- Places the reports find, and the thresholds they measure
-- ---------------------------------------------------------------------------
--
-- Everything above this line stores what people report. Everything below it
-- is what the project does with those reports, and it is the part that makes
-- the register stop being a fixed list.
--
-- Two mechanisms, both deliberately dull:
--
--   1. CLUSTERING AND PROMOTION. Reports within 500 m are one place. A place
--      reported three times across two separate days becomes a flood point in
--      its own right. It is drawn on the map with its own provenance and is
--      never merged into the 73 researched rows.
--
--   2. CALIBRATION. Every approved report gets the rainfall that fell before
--      it attached (Open-Meteo, from the moderator's browser). A place seen
--      knee-deep or worse on two separate days publishes the lightest rain
--      that ever did it, and the app scores that place against the measured
--      number instead of the shipped estimate.
--
-- The thresholds in hotspots.json are engineering estimates by severity tier.
-- This is how they stop being estimates, one report at a time.

-- Haversine. PostGIS would be the textbook answer, and it is a large
-- extension to enable for one distance function on a table that will hold
-- hundreds of rows, not millions.
create or replace function public.metres_between(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
) returns double precision
language sql immutable parallel safe as $$
  select 2 * 6371000 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ^ 2
  ))
$$;

create table if not exists public.observed_places (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),

  -- The running mean of its reports' coordinates, so the pin drifts towards
  -- where people actually stand rather than sitting on whoever reported first.
  lat           double precision not null,
  lon           double precision not null,

  -- Reserved for a moderator naming a place, or tying one to a register row.
  -- The app does the register matching itself, in the browser, because the
  -- register lives in the bundle and copying it here would let the two drift.
  hotspot_id    text,
  label         text,

  report_count  int not null default 0,
  distinct_days int not null default 0,
  worst_depth   text,
  first_seen    timestamptz,
  last_seen     timestamptz,

  promoted      boolean not null default false,
  promoted_at   timestamptz,

  observed_threshold_mm_hr double precision,
  threshold_days           int not null default 0,
  calibration_pairs        int not null default 0
);

comment on column public.observed_places.observed_threshold_mm_hr is
  'Lightest peak rainfall ever seen to put knee-deep or worse water here. A lower bound on what floods this place, not a fitted parameter. Null until the calibration rule is met.';

alter table public.reports
  add column if not exists place_id        uuid references public.observed_places(id),
  add column if not exists rain_peak_mm_hr double precision,
  add column if not exists rain_total_mm   double precision,
  add column if not exists rain_window_hr  int,
  add column if not exists rain_source     text;

create index if not exists reports_place_idx on public.reports (place_id);

-- The three rules, each in one place so the SQL, the UI copy and the docs
-- cannot drift apart. Changing a rule means changing exactly one function.

-- Nobody stands in the same puddle twice.
create or replace function public.report_cluster_radius_m()
returns double precision language sql immutable as $$ select 500.0::double precision $$;

-- Three reports, two separate days. The day count is what does the work:
-- four reports during one storm are four people describing one event, and an
-- event is not a place that floods.
create or replace function public.promotion_rule()
returns table (min_reports int, min_days int)
language sql immutable as $$ select 3, 2 $$;

--   min_depth_rank  knee. Ankle-deep water is a puddle in a bad kerb, not a
--                   flood, and calibrating on it would make every threshold
--                   read far lower than reality.
--   min_rain_mm_hr  Below 1 mm/hr the water was not caused by that rain: a
--                   burst main, a blocked drain backing up, water arriving
--                   from a catchment upstream. Real, worth reporting, and
--                   says nothing about a rainfall threshold.
--   min_days        Two separate days. One storm is one event.
create or replace function public.calibration_rule()
returns table (min_depth_rank int, min_rain_mm_hr double precision, min_days int)
language sql immutable as $$ select 2, 1.0::double precision, 2 $$;

-- Recompute one place from its reports. Cheap, and called on every write, so
-- the aggregates are never stale and there is no job to forget to run.
create or replace function public.refresh_observed_place(p_place uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r_count int; d_count int; w_depth text;
  f_seen timestamptz; l_seen timestamptz;
  c_lat double precision; c_lon double precision;
  min_r int; min_d int;
  cal_rank int; cal_rain double precision; cal_days int;
  obs_threshold double precision; obs_days int; obs_pairs int;
begin
  select count(*),
         count(distinct (created_at at time zone 'Asia/Kolkata')::date),
         avg(lat), avg(lon), min(created_at), max(created_at),
         (array_agg(depth order by case depth
            when 'impassable' then 4 when 'waist' then 3
            when 'knee' then 2 else 1 end desc))[1]
    into r_count, d_count, c_lat, c_lon, f_seen, l_seen, w_depth
  from public.reports
  where place_id = p_place and status = 'approved';

  select min_reports, min_days into min_r, min_d from public.promotion_rule();
  select min_depth_rank, min_rain_mm_hr, min_days
    into cal_rank, cal_rain, cal_days
  from public.calibration_rule();

  -- The calibration set: approved reports here that were serious enough to
  -- count as flooding, and that have rainfall attached which could plausibly
  -- have caused it.
  select min(rain_peak_mm_hr),
         count(distinct (created_at at time zone 'Asia/Kolkata')::date),
         count(*)
    into obs_threshold, obs_days, obs_pairs
  from public.reports
  where place_id = p_place
    and status = 'approved'
    and rain_peak_mm_hr is not null
    and rain_peak_mm_hr >= cal_rain
    and (case depth when 'impassable' then 4 when 'waist' then 3
                    when 'knee' then 2 else 1 end) >= cal_rank;

  update public.observed_places p
     set report_count  = coalesce(r_count, 0),
         distinct_days = coalesce(d_count, 0),
         worst_depth   = w_depth,
         first_seen    = f_seen,
         last_seen     = l_seen,
         lat           = coalesce(c_lat, p.lat),
         lon           = coalesce(c_lon, p.lon),
         promoted      = (coalesce(r_count,0) >= min_r and coalesce(d_count,0) >= min_d),
         promoted_at   = case
                           when (coalesce(r_count,0) >= min_r and coalesce(d_count,0) >= min_d)
                                and p.promoted_at is null then now()
                           when not (coalesce(r_count,0) >= min_r and coalesce(d_count,0) >= min_d)
                                then null
                           else p.promoted_at
                         end,
         calibration_pairs = coalesce(obs_pairs, 0),
         threshold_days    = coalesce(obs_days, 0),
         -- Published only once it rests on separate days. Until then the
         -- pairs are counted, so the UI can show progress, but no number is
         -- claimed.
         observed_threshold_mm_hr =
           case when coalesce(obs_days,0) >= cal_days
                then round(obs_threshold::numeric, 1)::double precision
                else null end
   where p.id = p_place;
end $function$;

-- Clustering happens on approval, not on submission, so an unreviewed report
-- cannot invent a place or move an existing one.
create or replace function public.assign_report_place()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare target uuid;
begin
  if new.status <> 'approved' then
    return new;
  end if;

  if new.place_id is null then
    select id into target
      from public.observed_places
     where metres_between(lat, lon, new.lat, new.lon) <= report_cluster_radius_m()
     order by metres_between(lat, lon, new.lat, new.lon)
     limit 1;

    if target is null then
      insert into public.observed_places (lat, lon)
      values (new.lat, new.lon)
      returning id into target;
    end if;

    new.place_id := target;
  end if;

  return new;
end $function$;

-- Two triggers because the aggregate has to include the row that caused it.
-- BEFORE decides which place the report belongs to; AFTER recomputes that
-- place once the row has actually landed. Doing both in BEFORE would count
-- every report one short.
create or replace function public.after_report_place()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.place_id is not null then
    perform public.refresh_observed_place(new.place_id);
  end if;
  if tg_op = 'UPDATE' and old.place_id is not null and old.place_id <> new.place_id then
    perform public.refresh_observed_place(old.place_id);
  end if;
  return null;
end $function$;

drop trigger if exists reports_assign_place on public.reports;
create trigger reports_assign_place
  before insert or update of status on public.reports
  for each row execute function public.assign_report_place();

-- Fires on any UPDATE, not just status, because attaching rainfall to an
-- already-approved report changes what that place has measured.
drop trigger if exists reports_refresh_place on public.reports;
create trigger reports_refresh_place
  after insert or update on public.reports
  for each row execute function public.after_report_place();

alter table public.observed_places enable row level security;

-- A place exists only because reports created it, and those reports were
-- approved before they got here, so there is nothing to hide. The
-- report_count > 0 clause keeps an orphaned row (every report at a place
-- deleted) out of the public listing rather than showing an empty pin.
drop policy if exists "anyone reads observed places" on public.observed_places;
create policy "anyone reads observed places"
  on public.observed_places for select
  to anon, authenticated
  using (report_count > 0);

-- No insert, update or delete policy: places are written only by the
-- triggers above, which run as definer. A leaked anon key cannot invent a
-- flood point or move one.

-- ---------------------------------------------------------------------------
-- Backfilling reports approved before these triggers existed
-- ---------------------------------------------------------------------------
--
-- Setting status to its own value fires the BEFORE trigger (it is declared
-- UPDATE OF status, which fires on the column being assigned, not on the
-- value changing), so old rows find their place through exactly the same
-- code path as new ones rather than a second implementation.
--
--   update public.reports set status = status
--    where status = 'approved' and place_id is null;
