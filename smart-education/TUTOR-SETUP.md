# AI Tutor setup (`ask-tutor`)

## 1. Get a Gemini API key

https://aistudio.google.com/apikey → **Create API key**

Google is mid-migration between two valid key formats — either is fine here:

- `AIzaSy...` — legacy "Standard" key (being phased out; rejected outright from
  around September 2026 onward)
- `AQ.Ab...` — current "Auth" key — **this is what AI Studio issues by default now**

Both work against the native `generateContent` endpoint via the
`x-goog-api-key` header, which is what `ask-tutor/index.ts` uses. Anything
that isn't one of these two shapes (a service-account JSON, an OAuth token
copied from somewhere else) will fail.

If you see `401 ACCESS_TOKEN_TYPE_UNSUPPORTED` in the logs with a valid-looking
`AQ.` key, that's a known Google-side rollout issue affecting some accounts —
not a setup mistake. Regenerating the key sometimes clears it; otherwise it's
worth reporting at discuss.ai.google.dev.

## 2. Set the secrets

A local `.env` file is **not** used by a deployed Edge Function. Use secrets:

```bash
supabase secrets set GEMINI_API_KEY=AIzaSy...
supabase secrets set SCHOOL_NAME="ST.Thomas Public School"

# optional — only if the default model 404s for your key
supabase secrets set GEMINI_MODEL=gemini-2.0-flash
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically — do not set them yourself.

## 3. Deploy (required after every secret change)

```bash
supabase functions deploy ask-tutor
```

## 4. Test

Open the student portal → AI tutor → ask something.

If it still fails, open the browser console. The function now returns a `detail`
field with the exact upstream error, and `backend.js` logs it. You can also read
the full trace in **Supabase Dashboard → Edge Functions → ask-tutor → Logs**.

| Status | Meaning | Fix |
|---|---|---|
| 400 `API_KEY_INVALID` | Key is not a real AI Studio key | Create a new key (either `AIzaSy…` or `AQ.Ab…`) |
| 401 `ACCESS_TOKEN_TYPE_UNSUPPORTED` | Google-side rollout issue on some accounts with `AQ.` keys | Regenerate the key; report at discuss.ai.google.dev if it persists |
| 403 | Generative Language API disabled, or key restricted | Enable the API / remove referrer restrictions |
| 404 | Model name not available to this key or deprecated | Set `GEMINI_MODEL=gemini-2.5-flash` (default) or `gemini-3.1-flash-lite` |
| 429 | Free-tier quota used up | Wait a minute, or raise quota |
| 500 `GEMINI_API_KEY is missing` | Secret not set, or set but not redeployed | Re-run steps 2 and 3 |

## 5. Once it works

In `supabase/functions/ask-tutor/index.ts`, remove `detail` from the error
response so upstream messages are never shown to students.

## Security

Never paste an API key into chat, a screenshot, a commit, or any file under
`assets/`. If a key is exposed, revoke it in AI Studio and issue a new one.
Only the anon/publishable key belongs in `assets/js/core/config.js`; the service
role key must stay server-side.
