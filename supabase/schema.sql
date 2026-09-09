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

-- Moderators see everything, including what is waiting and what was
-- rejected.
drop policy if exists "moderators read all" on public.reports;
create policy "moderators read all"
  on public.reports for select
  to authenticated
  using (true);

-- Only a signed-in moderator can change a report's status.
drop policy if exists "moderators review" on public.reports;
create policy "moderators review"
  on public.reports for update
  to authenticated
  using (true)
  with check (status in ('approved','rejected'));

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
