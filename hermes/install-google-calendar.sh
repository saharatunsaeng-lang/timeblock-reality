#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
target="$HOME/.hermes/integrations/google_calendar.py"
mkdir -p "$(dirname "$target")"
ln -sfn "$root/hermes/google_calendar.py" "$target"
chmod 700 "$root/hermes/google_calendar.py"
echo "Installed $target"
