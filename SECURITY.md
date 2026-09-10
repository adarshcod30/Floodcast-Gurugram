# Security

## Reporting a vulnerability

Please report privately rather than opening a public issue. Use GitHub's
[private vulnerability reporting](https://github.com/adarshcod30/Floodcast-Gurugram/security/advisories/new)
on this repository.

Expect an acknowledgement within a few days. This is a personal project, not a
funded one, so please size your expectations accordingly. I would still much
rather hear about a problem than not.

## What is and is not a secret here

The Supabase **publishable key is committed on purpose**, in
`frontend/.env.production`. That is not an oversight and it is not a finding.
A publishable key ships inside the JavaScript of every Supabase app, so anyone
can read it with view-source. Keeping it out of git would add friction and
protect nothing.

It is safe because it grants no authority. Everything is enforced by row level
security in Postgres, verified against that exact key rather than assumed:

| Attempt with the public key | Result |
|---|---|
| File a pending report | 201, allowed and intended |
| Insert an already-approved report | 401, policy violation |
| Read a report that is awaiting review | `[]`, invisible |
| Approve or reject any report | 0 rows changed |
| Delete any report or place | 0 rows, no DELETE policy exists for anyone |
| Call `delete_report` / `delete_place` | Refused, EXECUTE is revoked from `anon` |
| Delete a photo from the bucket | Refused, the delete policy requires a moderator |
| File a second report for the same place within 6 hours | Refused by a trigger, unless the water is deeper |
| File a report with no `device_id` | Refused, so the limit cannot be skipped |
| Rename or hide a place | 401, permission denied |
| Edit a report count or a measured threshold | denied by column grant |
| Upload anything that is not a JPEG | 400, the bucket rejects the mime type |
| Report a coordinate outside Gurugram | 400, CHECK constraint rejects it |

The `service_role` key bypasses every one of those policies. It is a real
secret, it is not in this repository, and it must never be placed anywhere
under `frontend/`, because everything there is compiled into a public bundle.

## Known and accepted limitations

Stated here rather than discovered later.

**The photo bucket is public-read.** A photo is technically fetchable before
it is approved by anyone who knows its path. Paths are a date plus a random
UUID, so they are not enumerable, and the path itself is only ever disclosed
through the reports table, which does not return unapproved rows to anonymous
readers. In practice an unreviewed photo's location is a 128-bit secret. That
is obscurity, not a permission boundary. Closing it properly means a private
bucket and an edge function minting a signed URL on approval.

**The report limit identifies a browser, not a person.** Reports are scoped to
one per `(device_id, place)` per six hours, with deeper water always allowed
through. `device_id` is a uuid this app generates and keeps in `localStorage`.
Clearing site data, a private window, or posting straight to the API with a
random uuid each time all defeat it. It is a civility limit: it stops a
double-tapped submit and casual repetition, and the interface says so rather
than implying enforcement it does not have.

**There is still no per-IP limit.** PostgREST does not expose the client
address to a policy, so that needs an edge function in front of the insert.
Remaining abuse is bounded by moderation (nothing is public until approved),
the 1 MB per-file cap, and the storage quota. A determined flooder rotating
device ids can still fill the bucket.

**Deletion is audited, not prevented.** A moderator can permanently delete a
report or a place. Every deletion writes the full row, the reason and the
moderator's id into `moderation_deletions` first, so a compromised moderator
account can destroy data but cannot do it quietly. A leaked publishable key
cannot delete anything at all: there is no `DELETE` policy on any table and
`EXECUTE` on both functions is revoked from `anon`.

**A camera photo is a signal, not proof.** The `capture` attribute is a hint
browsers may ignore, EXIF timestamps are trivially editable, and the public key
means anyone can post straight to the API without touching the app at all. The
app does not claim otherwise anywhere in its interface. Moderation is what
decides.

## Reports of these are not vulnerabilities

- The publishable key being in the repository or the bundle
- The photo bucket being public-read, which is documented above
- The report limit being defeatable by clearing storage, which is documented above
- The absence of a per-IP limit, which is documented above
- Anything reachable only with the `service_role` key, which is not published
