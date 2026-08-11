#!/usr/bin/env bash
# One-time local provisioning. The Google client secret is read from the user's
# terminal only; it is never printed, committed, or sent to Discord.
set -euo pipefail
umask 077

WORKER_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_ID="809951458535-dg6gjp5nk4fjrgs1kngrger4cni90er9.apps.googleusercontent.com"
WORKER_NAME="timeblock-calendar-connector"
WORKER_ORIGIN="https://${WORKER_NAME}.saharat-timeblock.workers.dev"
HERMES_DIR="$HOME/.hermes/integrations"
SECRETS_FILE="$(mktemp "${TMPDIR:-/tmp}/timeblock-calendar-secrets.XXXXXX")"

cleanup() {
  rm -f "$SECRETS_FILE"
}
trap cleanup EXIT

printf 'วาง Google OAuth client secret ใหม่ แล้วกด Enter (ค่าจะไม่แสดง): '
IFS= read -r -s GOOGLE_CLIENT_SECRET
printf '\n'

if [[ -z "$GOOGLE_CLIENT_SECRET" || "$GOOGLE_CLIENT_SECRET" == *$'\n'* || "$GOOGLE_CLIENT_SECRET" == *$'\r'* ]]; then
  printf 'Google OAuth client secret ไม่ถูกต้อง\n' >&2
  exit 1
fi

HERMES_API_TOKEN="$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=')"
TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"

{
  printf 'GOOGLE_CLIENT_ID=%s\n' "$CLIENT_ID"
  printf 'GOOGLE_CLIENT_SECRET=%s\n' "$GOOGLE_CLIENT_SECRET"
  printf 'HERMES_API_TOKEN=%s\n' "$HERMES_API_TOKEN"
  printf 'TOKEN_ENCRYPTION_KEY=%s\n' "$TOKEN_ENCRYPTION_KEY"
} > "$SECRETS_FILE"

cd "$WORKER_DIR"
npx wrangler deploy --secrets-file "$SECRETS_FILE"

# The Worker credential stays only in macOS Keychain; endpoint config has no secret.
security add-generic-password -U \
  -s ai.hermes.google-calendar \
  -a calendar-api-token \
  -w "$HERMES_API_TOKEN" >/dev/null
mkdir -p "$HERMES_DIR"
printf '{\n  "endpoint": "%s"\n}\n' "$WORKER_ORIGIN" > "$HERMES_DIR/google_calendar.json"
chmod 600 "$HERMES_DIR/google_calendar.json"

printf '\nDEPLOYED: %s\n' "$WORKER_ORIGIN"
printf 'NEXT: Open %s/oauth/start in Safari to authorize Google Calendar.\n' "$WORKER_ORIGIN"
