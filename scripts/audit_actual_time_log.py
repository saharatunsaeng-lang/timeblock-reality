#!/usr/bin/env python3
"""Read-only quality gate for TimeBlock Actual-Time Log.

This report deliberately separates raw recorded minutes from non-overlapping
coverage. Capacity learning must only use a recent, overlap-free sample.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path


DEFAULT_CALENDAR = "Actual-Time Log"
HERMES_CONNECTOR = Path.home() / ".hermes" / "integrations" / "google_calendar.py"


def parse_args() -> argparse.Namespace:
    today = date.today()
    parser = argparse.ArgumentParser(description="Audit Actual-Time Log quality without changing calendar data.")
    parser.add_argument("--start", default=(today - timedelta(days=14)).isoformat())
    parser.add_argument("--end", default=(today + timedelta(days=1)).isoformat(), help="Exclusive end date (YYYY-MM-DD).")
    parser.add_argument("--calendar", default=DEFAULT_CALENDAR)
    parser.add_argument("--min-days", type=int, default=3, help="Minimum distinct days required for learning.")
    parser.add_argument("--max-age-days", type=int, default=2, help="Newest actual may be this many days old.")
    return parser.parse_args()


def load_events(args: argparse.Namespace) -> list[dict]:
    command = [
        sys.executable,
        str(HERMES_CONNECTOR),
        "events",
        "--start",
        args.start,
        "--end",
        args.end,
        "--calendar",
        args.calendar,
    ]
    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "Calendar connector failed")
    payload = json.loads(result.stdout)
    calendars = payload.get("calendars", [])
    if not calendars or not calendars[0].get("found"):
        raise RuntimeError(f"Calendar not found: {args.calendar}")
    return calendars[0].get("events", [])


def event_interval(event: dict) -> tuple[datetime, datetime] | None:
    if event.get("allDay"):
        return None
    start_value = event.get("start", {}).get("dateTime")
    end_value = event.get("end", {}).get("dateTime")
    if not start_value or not end_value:
        return None
    return datetime.fromisoformat(start_value), datetime.fromisoformat(end_value)


def minutes_between(start: datetime, end: datetime) -> int:
    return max(0, round((end - start).total_seconds() / 60))


def audit(events: list[dict], args: argparse.Namespace) -> dict:
    valid: list[tuple[datetime, datetime, dict]] = []
    invalid: list[dict] = []
    for event in events:
        interval = event_interval(event)
        if not interval:
            invalid.append({"summary": event.get("summary", "Untitled"), "reason": "missing timed interval"})
            continue
        start, end = interval
        if end <= start:
            invalid.append({"summary": event.get("summary", "Untitled"), "reason": "non-positive duration"})
            continue
        valid.append((start, end, event))

    valid.sort(key=lambda item: item[0])
    overlap_minutes = 0
    overlap_pairs: list[dict] = []
    covered_minutes = 0
    coverage_end: datetime | None = None
    days: set[date] = set()
    domain_minutes: dict[str, int] = defaultdict(int)
    raw_minutes = 0

    for start, end, event in valid:
        duration = minutes_between(start, end)
        raw_minutes += duration
        days.add(start.date())
        domain_minutes[event.get("summary", "Untitled")] += duration
        if coverage_end is None or start >= coverage_end:
            covered_minutes += duration
            coverage_end = end
            continue
        overlap = minutes_between(start, min(end, coverage_end))
        if overlap:
            overlap_minutes += overlap
            overlap_pairs.append({
                "summary": event.get("summary", "Untitled"),
                "start": start.isoformat(),
                "overlapMinutes": overlap,
            })
        if end > coverage_end:
            covered_minutes += minutes_between(coverage_end, end)
            coverage_end = end

    freshest = max((end for _, end, _ in valid), default=None)
    today = date.today()
    age_days = (today - freshest.date()).days if freshest else None
    blockers: list[str] = []
    if not valid:
        blockers.append("no actual blocks in selected range")
    if len(days) < args.min_days:
        blockers.append(f"only {len(days)} distinct day(s); need {args.min_days}")
    if age_days is None or age_days > args.max_age_days:
        blockers.append(f"latest actual is {age_days if age_days is not None else 'unknown'} day(s) old; max is {args.max_age_days}")
    if invalid:
        blockers.append(f"{len(invalid)} invalid block(s)")
    if overlap_minutes:
        blockers.append(f"{overlap_minutes} overlapping minute(s)")

    return {
        "calendar": args.calendar,
        "range": {"start": args.start, "endExclusive": args.end},
        "learningReady": not blockers,
        "blockers": blockers,
        "sample": {
            "events": len(events),
            "validEvents": len(valid),
            "distinctDays": len(days),
            "freshestEnd": freshest.isoformat() if freshest else None,
            "ageDays": age_days,
            "rawMinutes": raw_minutes,
            "nonOverlappingMinutes": covered_minutes,
            "overlapMinutes": overlap_minutes,
        },
        "domainRawMinutes": dict(sorted(domain_minutes.items())),
        "invalidBlocks": invalid,
        "overlapExamples": overlap_pairs[:10],
    }


def main() -> int:
    args = parse_args()
    print(json.dumps(audit(load_events(args), args), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Audit failed: {error}", file=sys.stderr)
        raise SystemExit(1)
