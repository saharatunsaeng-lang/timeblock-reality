# TimeBlock Calendar Connector

This Worker is the HTTPS OAuth broker and Google Calendar API boundary for Hermes. It is deliberately separate from the TimeBlock PWA and its push worker.

## Contract

- `GET /oauth/start`: starts Google OAuth with PKCE. Open this only in Safari.
- `GET /oauth/callback`: Google callback. The refresh token is encrypted before Durable Object storage.
- `GET /v1/status`, `/v1/calendars`, `/v1/events`: Hermes-only read endpoints.
- `POST /v1/preview-copy`: creates a live, read-only LD8 week-copy preview and a 30-minute confirmation ID.
- `POST /v1/confirm-copy`: one-time write endpoint. It rejects previews with collisions unless the caller explicitly sets `allowConflicts: true`.

All `/v1/*` requests require `Authorization: Bearer <HERMES_API_TOKEN>`. The token stays in the local macOS Keychain and in a Cloudflare Worker secret; it is never sent to Discord.

## One-time production setup

1. Deploy once to obtain the `workers.dev` URL.
2. In the Google Cloud OAuth client of type **Web application**, add exactly:
   `https://<worker>.workers.dev/oauth/callback`
3. Add Worker secrets interactively. Do not put them in `wrangler.jsonc` or Git:

   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put HERMES_API_TOKEN
   npx wrangler secret put TOKEN_ENCRYPTION_KEY
   ```

   `TOKEN_ENCRYPTION_KEY` must be a base64url encoded 32-byte value. Generate it locally without printing it into a shell history:

   ```bash
   openssl rand -base64 32 | tr '+/' '-_' | tr -d '=' | npx wrangler secret put TOKEN_ENCRYPTION_KEY
   ```

4. Open `https://<worker>.workers.dev/oauth/start` in iPhone Safari and approve Google Calendar once.

No calendar event is created by OAuth. Use the Hermes connector to preview before any write.

## Hermes local command

Run `hermes/install-google-calendar.sh` once on the Hermes Mac after the Worker has been deployed. It creates a symlink at `~/.hermes/integrations/google_calendar.py`.

The one-time `configure` command prompts for the API token without echoing or putting it in shell history. Normal usage is read-only unless a fresh confirmation ID is supplied:

```bash
python3 ~/.hermes/integrations/google_calendar.py status
python3 ~/.hermes/integrations/google_calendar.py calendars
python3 ~/.hermes/integrations/google_calendar.py preview-copy --source 2026-07-13 --target 2026-07-20
```

`confirm-copy` is intentionally separate and should only be called after Saharat explicitly confirms the returned preview in Discord.
