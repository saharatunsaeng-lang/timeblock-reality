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
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
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
    commands.add_parser("calendars")
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
    args = parser.parse_args()

    if args.command == "configure":
        configure(args)
    elif args.command == "status":
        print_json(call("/v1/status"))
    elif args.command == "calendars":
        print_json(call("/v1/calendars"))
    elif args.command == "events":
        from urllib.parse import urlencode
        query = urlencode([("start", args.start), ("end", args.end), *[("calendar", name) for name in args.calendar]])
        print_json(call("/v1/events?" + query))
    elif args.command == "preview-copy":
        print_json(call("/v1/preview-copy", "POST", {"source": args.source, "target": args.target}))
    else:
        payload = {"confirmationId": args.confirmation_id, "allowConflicts": args.allow_conflicts}
        print_json(call("/v1/confirm-copy", "POST", payload))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("ข้อผิดพลาด: " + str(exc), file=sys.stderr)
        raise SystemExit(1)
