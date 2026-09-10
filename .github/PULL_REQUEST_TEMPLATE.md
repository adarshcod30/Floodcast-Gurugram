## What this changes

<!-- One or two sentences. What is different after this merges? -->

## Why

<!-- The problem, not the solution. What was wrong or missing? -->

## Provenance check

Tick what applies, delete what does not.

- [ ] This does not add, change, or remove any flood point
- [ ] It adds or changes data, and `docs/DATA_PROVENANCE.md` is updated in this
      same pull request with the source for every new row
- [ ] Every new number is labelled in the interface as sourced, measured, or
      estimated, matching what it actually is
- [ ] No empty state was filled with sample or placeholder data

## Verification

<!-- What did you actually run, and what did it say? Paste output rather than
     asserting it passed. -->

```
cd frontend
npm run lint
npm test
npm run build
```

- [ ] Lint, tests and build pass locally
- [ ] If data changed: all four generators rerun, and
      `python3 scripts/check_data_integrity.py` passes
- [ ] Checked in the browser, not only in the terminal
