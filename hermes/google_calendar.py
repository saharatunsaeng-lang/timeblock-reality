#!/usr/bin/env python3
"""Hermes Google Calendar connector.

The API token is retained only in macOS Keychain. This command never prints it.
Writes require a short-lived confirmation ID returned by a preview command.
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

SERVICE = "ai.hermes.google-calendar"
ACCOUNT = "calendar-api-token"
CONFIG = Path.home() / ".hermes" / "integrations" / "google_calendar.json"


def keychain_get() -> str | None:
    result = subprocess.run(
        ["security", "find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"],
        text=True,
        capture_output=True,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def keychain_put(value: str) -> None:
    subprocess.run(
        ["security", "add-generic-password", "-U", "-s", SERVICE, "-a", ACCOUNT, "-w", value],
        text=True,
        capture_output=True,
        check=True,
    )


def endpoint() -> str:
    if not CONFIG.exists():
        raise RuntimeError("ยังไม่ได้ตั้งค่า Calendar connector")
    value = json.loads(CONFIG.read_text(encoding="utf-8")).get("endpoint", "").rstrip("/")
    if not value.startswith("https://"):
        raise RuntimeError("Calendar connector endpoint ไม่ถูกต้อง")
    return value


def call(path: str, method: str = "GET", payload: dict | None = None) -> dict:
    token = keychain_get()
    if not token:
        raise RuntimeError("ไม่พบ Hermes Calendar credential")
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        endpoint() + path,
        data=data,
        method=method,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            # Cloudflare may reject Python's default user-agent before the Worker runs.
            "User-Agent": "curl/8.0 HermesCalendarConnector/1.0",
        },
    )
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(body).get("error", body)
        except json.JSONDecodeError:
            detail = body
        raise RuntimeError(f"Calendar API ตอบ {error.code}: {detail}") from error


def print_json(value: dict) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def configure(args: argparse.Namespace) -> None:
    api_token = getpass.getpass("Calendar connector API token: ").strip()
    if not api_token:
        raise RuntimeError("Calendar connector API token ต้องไม่ว่าง")
    keychain_put(api_token)
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    CONFIG.write_text(json.dumps({"endpoint": args.endpoint.rstrip("/")}, indent=2) + "\n", encoding="utf-8")
    os.chmod(CONFIG, 0o600)
    print("ตั้งค่า Hermes Google Calendar connector สำเร็จ")


def main() -> None:
    parser = argparse.ArgumentParser(description="Hermes Google Calendar connector")
    commands = parser.add_subparsers(dest="command", required=True)
    config = commands.add_parser("configure")
    config.add_argument("--endpoint", required=True)
    commands.add_parser("status")
    commands.add_parser("create-pairing")
    commands.add_parser("calendars")
    sheet_metadata = commands.add_parser("sheet-metadata")
    sheet_metadata.add_argument("--spreadsheet-id", required=True)
    sheet_values = commands.add_parser("sheet-values")
    sheet_values.add_argument("--spreadsheet-id", required=True)
    sheet_values.add_argument("--range", required=True)
    events = commands.add_parser("events")
    events.add_argument("--start", required=True)
    events.add_argument("--end", required=True)
    events.add_argument("--calendar", action="append", default=[])
    preview = commands.add_parser("preview-copy")
    preview.add_argument("--source", required=True)
    preview.add_argument("--target", required=True)
    confirm = commands.add_parser("confirm-copy")
    confirm.add_argument("--confirmation-id", required=True)
    confirm.add_argument("--allow-conflicts", action="store_true")
    confirm.add_argument("--max-events", type=int)
    preview_update_plan = commands.add_parser("preview-update-plan")
    preview_update_plan.add_argument("--calendar", required=True)
    preview_update_plan.add_argument("--summary", required=True)
    preview_update_plan.add_argument("--current-start", required=True)
    preview_update_plan.add_argument("--current-end", required=True)
    preview_update_plan.add_argument("--replacement-start", required=True)
    preview_update_plan.add_argument("--replacement-end", required=True)
    confirm_update_plan = commands.add_parser("confirm-update-plan")
    confirm_update_plan.add_argument("--confirmation-id", required=True)
    confirm_update_plan.add_argument("--allow-conflicts", action="store_true")
    preview_create_plan = commands.add_parser("preview-create-plan")
    preview_create_plan.add_argument("--calendar", required=True)
    preview_create_plan.add_argument("--events-json", required=True, help="JSON array of timed Calendar event objects")
    confirm_create_plan = commands.add_parser("confirm-create-plan")
    confirm_create_plan.add_argument("--confirmation-id", required=True)
    confirm_create_plan.add_argument("--allow-conflicts", action="store_true")
    plan_create_status = commands.add_parser("plan-create-status")
    plan_create_status.add_argument("--confirmation-id", required=True)
    delete_duplicate = commands.add_parser("delete-exact-duplicate")
    delete_duplicate.add_argument("--calendar", required=True)
    delete_duplicate.add_argument("--start", required=True)
    delete_duplicate.add_argument("--end", required=True)
    delete_duplicate.add_argument("--summary", required=True)
    delete_duplicate.add_argument("--start-time", required=True)
    delete_duplicate.add_argument("--end-time", required=True)
    args = parser.parse_args()

    if args.command == "configure":
        configure(args)
    elif args.command == "status":
        print_json(call("/v1/status"))
    elif args.command == "create-pairing":
        print_json(call("/v1/create-pairing", "POST"))
    elif args.command == "calendars":
        print_json(call("/v1/calendars"))
    elif args.command == "sheet-metadata":
        print_json(call("/v1/sheets/" + args.spreadsheet_id + "/metadata"))
    elif args.command == "sheet-values":
        from urllib.parse import urlencode
        print_json(call("/v1/sheets/" + args.spreadsheet_id + "/values?" + urlencode({"range": args.range})))
    elif args.command == "events":
        from urllib.parse import urlencode
        query = urlencode([("start", args.start), ("end", args.end), *[("calendar", name) for name in args.calendar]])
        print_json(call("/v1/events?" + query))
    elif args.command == "preview-copy":
        print_json(call("/v1/preview-copy", "POST", {"source": args.source, "target": args.target}))
    elif args.command == "preview-update-plan":
        print_json(call("/v1/preview-update-plan", "POST", {
            "calendar": args.calendar,
            "summary": args.summary,
            "currentStart": args.current_start,
            "currentEnd": args.current_end,
            "replacementStart": args.replacement_start,
            "replacementEnd": args.replacement_end,
        }))
    elif args.command == "confirm-update-plan":
        print_json(call("/v1/confirm-update-plan", "POST", {"confirmationId": args.confirmation_id, "allowConflicts": args.allow_conflicts}))
    elif args.command == "preview-create-plan":
        try:
            events = json.loads(args.events_json)
        except json.JSONDecodeError as error:
            raise RuntimeError("events-json ต้องเป็น JSON array ที่ถูกต้อง") from error
        print_json(call("/v1/preview-create-plan", "POST", {"calendar": args.calendar, "events": events}))
    elif args.command == "confirm-create-plan":
        print_json(call("/v1/confirm-create-plan", "POST", {"confirmationId": args.confirmation_id, "allowConflicts": args.allow_conflicts}))
    elif args.command == "plan-create-status":
        from urllib.parse import urlencode
        print_json(call("/v1/plan-create-status?" + urlencode({"confirmationId": args.confirmation_id})))
    elif args.command == "delete-exact-duplicate":
        event = {
            "summary": args.summary,
            "start": {"dateTime": args.start_time, "timeZone": "Asia/Bangkok"},
            "end": {"dateTime": args.end_time, "timeZone": "Asia/Bangkok"},
        }
        print_json(call("/v1/delete-exact-duplicate", "POST", {"calendar": args.calendar, "start": args.start, "end": args.end, "event": event}))
    else:
        payload = {"confirmationId": args.confirmation_id, "allowConflicts": args.allow_conflicts}
        if args.max_events is not None:
            payload["maxEvents"] = args.max_events
        print_json(call("/v1/confirm-copy", "POST", payload))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("ข้อผิดพลาด: " + str(exc), file=sys.stderr)
        raise SystemExit(1)
