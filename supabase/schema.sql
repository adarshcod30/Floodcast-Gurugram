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
