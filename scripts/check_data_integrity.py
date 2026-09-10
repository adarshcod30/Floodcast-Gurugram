"""
Prove the committed datasets say the same thing in every format they ship in.

WHY THIS EXISTS RATHER THAN A BYTE COMPARISON

CI regenerates the register from the generators and fails if the result
differs from what is committed. That check is the reason anyone can trust the
sourcing in docs/DATA_PROVENANCE.md: the JSON the app ships is traceable, line
by line, to a script anybody can rerun.

Byte comparison works for the CSV and the JSON. It does not work for Parquet,
because a Parquet file records the writing library's version in its footer.
The same 73 rows written by pyarrow 24 on a laptop and by whatever pip
resolves on a runner produce files that differ in length while containing
identical data, which fails a byte check for a reason that has nothing to do
with the data being wrong.

Loosening the check to "ignore Parquet" would leave a real hole: a Parquet
file could silently drift out of step with its CSV and nothing would notice.
So Parquet is checked by content instead, which is a stronger test than bytes
anyway. It catches drift and ignores the container.

Run from the repository root:  python3 scripts/check_data_integrity.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SHIPPED = ROOT / "frontend" / "src" / "data"

# Every dataset that exists in more than one format, and how many rows it is
# supposed to have. The counts are asserted so a truncated regeneration fails
# loudly rather than passing an equality check against an equally empty file.
PAIRS = [
    ("hotspots", 36),
    ("hotspots_extended", 73),
    ("attractions", 8),
]

# What the app actually loads. If these drift from the CSV the register is
# still traceable on disk and wrong in the browser, which is the worst case.
SHIPPED_FILES = [
    ("hotspots.json", "hotspots_extended", 73),
    ("attractions.json", "attractions", 8),
]


def fail(message: str) -> None:
    print(f"  FAIL  {message}")
    globals()["FAILURES"] += 1


FAILURES = 0


def main() -> int:
    print("Checking committed datasets agree across formats\n")

    frames: dict[str, pd.DataFrame] = {}

    for name, expected_rows in PAIRS:
        csv_path = DATA / f"{name}.csv"
        parquet_path = DATA / f"{name}.parquet"

        if not csv_path.exists():
            fail(f"{csv_path.relative_to(ROOT)} is missing")
            continue

        csv = pd.read_csv(csv_path)
        frames[name] = csv

        if len(csv) != expected_rows:
            fail(f"{name}.csv has {len(csv)} rows, expected {expected_rows}")
            continue

        if not parquet_path.exists():
            fail(f"{parquet_path.relative_to(ROOT)} is missing")
            continue

        parquet = pd.read_parquet(parquet_path)

        if list(parquet.columns) != list(csv.columns):
            fail(f"{name}.parquet columns differ from {name}.csv")
            continue

        # Compared as values rather than as files. Dtypes can differ
        # legitimately (CSV has no type system, Parquet does), so the
        # comparison is on the data each format represents.
        if not parquet.astype(str).equals(csv.astype(str)):
            diff = parquet.astype(str).compare(csv.astype(str))
            fail(f"{name}.parquet content differs from {name}.csv:\n{diff.head(10)}")
            continue

        print(f"  ok    {name}: {len(csv)} rows, csv and parquet identical")

    for filename, source, expected_rows in SHIPPED_FILES:
        path = SHIPPED / filename
        if not path.exists():
            fail(f"{path.relative_to(ROOT)} is missing")
            continue

        shipped = json.loads(path.read_text())
        if len(shipped) != expected_rows:
            fail(f"{filename} has {len(shipped)} rows, expected {expected_rows}")
            continue

        source_frame = frames.get(source)
        if source_frame is None:
            fail(f"{filename} cannot be checked, {source}.csv did not load")
            continue

        # The export drops columns the app never reads, so this checks that
        # every row survived and kept its identity, not that the shapes match.
        key = "hotspot_id" if "hotspot_id" in source_frame.columns else "name"
        shipped_keys = sorted(str(row[key]) for row in shipped)
        source_keys = sorted(source_frame[key].astype(str))
        if shipped_keys != source_keys:
            missing = set(source_keys) - set(shipped_keys)
            extra = set(shipped_keys) - set(source_keys)
            fail(f"{filename} rows differ from {source}.csv (missing {missing}, extra {extra})")
            continue

        print(f"  ok    {filename}: {len(shipped)} rows, all present in {source}.csv")

    print()
    if FAILURES:
        print(f"{FAILURES} check(s) failed.")
        return 1

    print("Every dataset agrees across csv, parquet and the shipped json.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
