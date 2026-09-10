# Contributing to Floodcast-Gurugram

Thanks for looking. This project has one rule that outranks every other
convention here, so it comes first.

## The rule: never present an estimate as a measurement

Most of this repository is ordinary React and Python. The part that is not
ordinary is that every number the app shows carries a claim about where it
came from, and the app says which is which on a page of its own.

Concretely, a change is not acceptable if it:

- adds a flood point without a source that names the place
- turns an estimate into a figure that reads like a measurement
- fills an empty state with plausible-looking sample data
- removes or weakens a provenance label to make a screen look tidier

An empty state beats a plausible fake. If the data is not there, the app says
so. That is the whole premise, and a pull request that quietly breaks it will
be turned down however good the code is.

## Adding or correcting a flood point

The register is generated, not hand-edited. Editing `data/hotspots_extended.csv`
directly will be overwritten the next time the generators run, and CI will
fail because the committed data no longer matches its source.

The chain is four scripts, run from the repository root in this order:

```bash
python3 data/generate_hotspots.py            # the 36-row MCG snapshot, frozen
python3 data/generate_expansion.py           # to 64 rows
python3 data/generate_2026_monsoon_update.py # to 73 rows
python3 data/export_to_frontend.py           # writes frontend/src/data/*.json
```

To add a point, edit the newest generator, add a row with its `data_confidence`
and a `source_note` that names the source, rerun all four, and update
`docs/DATA_PROVENANCE.md` in the same commit. Then run:

```bash
python3 scripts/check_data_integrity.py
```

`generate_hotspots.py` is deliberately frozen. It reproduces MCG's official
pre-monsoon classification as it stood, and changing it would make that
snapshot untraceable. New findings are additive, in a later stage.

### What counts as a source

| Tier | What it takes |
|---|---|
| `confirmed_named_mcg_zone1` | Named in MCG's official Zone 1 list |
| `confirmed_named_2026_monsoon` | Named by a dated, on-record institutional source from the current season |
| `confirmed_named_multi_source` | Named as a flood point by more than one independent report |
| `plausible_real_unconfirmed_flood_status` | A real locality, no source confirming it floods |
| `reconstructed_estimate` | Structural placeholder, no source at all |

"Somebody told me it floods" is the fourth tier, not the first. That is fine,
and it must be labelled as such.

## Code

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm test         # vitest, no network, no keys
npm run lint     # oxlint
npm run build    # tsc -b && vite build
```

All four must pass before a pull request. CI runs the same commands plus a
data-reproducibility job.

House style, matching what is already there:

- Comments explain **why**, not what. If a line needs a comment to say what it
  does, rename something instead.
- Tests guard product invariants, not plumbing. "A risk number always carries
  a time window" is worth a test. A getter is not.
- No em dashes or en dashes anywhere, including code comments and commit
  messages. Use a comma, a colon, brackets, or two sentences.
- Prefer a mechanism that stays true over a value typed in once. A rule in SQL
  and a test that fails when two constants drift apart are both cheaper than
  remembering.

## Reporting a flood point through the app

You do not need to touch the repository at all. Open the live app, use the
Report tab, take a photo, confirm the location. It goes into a moderation queue
and appears on the map for twelve hours once approved. Three reports at one
place across two separate days promote it into a flood point in its own right.

That path is the intended one for local knowledge. This file is for people who
want to change the code.

## Security

Please do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
