# VISHWAS alert server

Sends the SOS text message to **every** saved emergency contact automatically,
the moment SOS starts, through an SMS provider (Twilio). It exists because
iOS never lets an app send SMS silently, and Android only allows it to apps
with the restricted `SEND_SMS` permission (not possible in Expo Go). Without
this server the app falls back to opening Messages pre-filled for all contacts.

Node 20.6+; no npm dependencies.

## Endpoints

| Method | Path | Who calls it | What it does |
| --- | --- | --- | --- |
| POST | `/alerts/emergency` | app | Texts each valid contact separately; returns a status per contact. The same `sessionId` is never texted twice. |
| GET | `/alerts/:sessionId` | app | Current per-contact status (`sent`, `delivered`, `failed`, `invalidNumber`, `duplicate`). |
| POST | `/sms/status` | Twilio | Signed delivery reports, which turn `sent` into `delivered` or `failed`. |
| GET | `/health` | you | Liveness check. |

App calls need the `x-vishwas-key` header. Only messages starting with
`🚨 EMERGENCY ALERT!` are accepted (max 10 contacts, max 5 new alerts per
10 minutes per IP), so the server can't be used as a general SMS relay.

## Setup

1. Create a Twilio account and get an SMS-capable number (or a Messaging Service).
   - On a **trial account**, Twilio only texts numbers you have verified in the console.
   - **India:** Indian carriers require DLT registration (sender ID plus an approved
     template) for application SMS. Without it, messages to +91 numbers may be blocked.
     Register through Twilio or use an Indian provider; only `sms.js` needs to change.
2. Copy `.env.example` to `.env` and fill it in. Generate the app key with
   `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.
3. Run it with `npm start`. Deploy it anywhere that serves HTTPS (Render, Railway,
   Fly.io, a VPS behind Caddy, and so on). The app refuses plain-HTTP servers.
4. Set `PUBLIC_URL` to that HTTPS address so Twilio can send delivery reports.
5. In `mobile/.env.local`:
   ```
   EXPO_PUBLIC_VISHWAS_API_URL=https://your-server.example.com
   EXPO_PUBLIC_VISHWAS_API_KEY=<same value as VISHWAS_APP_KEY>
   ```
   Restart `npx expo start` after changing it.

For local testing, expose the server with a tunnel such as `cloudflared tunnel --url http://localhost:8787`
and use the `https://…` address it prints for both settings.

## WhatsApp (SOS text + audio/video clips)

When `TWILIO_WHATSAPP_FROM` is set, the SOS text with the location link also
goes to every contact on WhatsApp, and while the SOS runs the app uploads a
30-second audio and video clip every 30 s (`POST /alerts/:id/media`), which
the server sends to every contact on WhatsApp. Messages come from the
WhatsApp business number, never from the user's personal WhatsApp.

Testing with the Twilio WhatsApp Sandbox:
1. Twilio console → Messaging → Try it out → Send a WhatsApp message. Note the
   sandbox number (e.g. +1 415 523 8886) and its `join <code>` phrase.
2. Every emergency contact sends `join <code>` to that number from WhatsApp.
3. Set `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886` and `PUBLIC_URL` (the
   server's public HTTPS address — Twilio downloads the clips from it).

WhatsApp rule to know: free-form messages and media only reach a contact who
messaged the business number in the last 24 hours. In the sandbox that means
contacts re-send `join <code>` / any message periodically. In production you
need an approved WhatsApp sender plus an approved SOS message template; clips
then reach a contact once they reply to the first alert.

## Notes

- Results are kept in memory for 24 h. A restart forgets them, but a message
  already sent is never re-sent for that session.
- The emoji makes each SMS Unicode (70 characters per segment), so one alert is
  several segments. Twilio bills per segment.

`npm test` runs the server tests with a fake provider; it sends no real SMS.
