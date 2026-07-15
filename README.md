# webhooks-demo

Cloudflare AI Gateway doesn't currently offer webhook delivery — if you kick off inference, something has to sit around and wait for the result. [ai-gateway-webhooks](https://github.com/corywilkerson/ai-gateway-webhooks) compensates: it manages the waiting for you in a durable Workflow, stores oversized or binary outputs as artifacts, and calls your configured webhook with a signed lifecycle event when the prediction starts, succeeds, or fails.

This repo is a single Worker demoing that end to end: it queues async Workers AI predictions, points the lifecycle webhook back at itself, verifies each delivery's signature, and stores the events in KV. Binary outputs (images) land in R2 and are delivered as signed, expiring artifact URLs.

```
POST /predictions or /images ──▶ prediction Workflow runs inference
                                       │
                                       ▼
             signed webhook ──▶ POST /hooks/ai ──▶ verified with parseWebhook() ──▶ KV
                                                                                     │
GET /events/<prediction id> ◀─────────────────────────────────────────────────────────┘
```

| Route | What it does |
| --- | --- |
| `POST /predictions` | Queues a text prediction from `{"prompt": "…"}`; returns `{"id": "pred_…"}` immediately |
| `POST /images` | Queues an image generation — binary output exercises R2 artifact storage |
| `GET /events/:id` | Returns the stored event for a prediction |
| `POST /hooks/ai` | Receives the webhook; rejects anything without a valid signature |
| `GET /_ai-gateway-webhooks/artifacts/*` | Serves stored artifacts for signed, unexpired URLs |

## Deploy your own

```sh
npm install
npx wrangler kv namespace create EVENTS                  # put the id in wrangler.jsonc
npx wrangler r2 bucket create <your-name>-ai-artifacts   # put the name in wrangler.jsonc
npx wrangler deploy
npm run secrets -- --with-artifacts                      # generate + upload both secrets
```

`wrangler.jsonc` pins this instance's hostnames and resource names — swap in your own.

**You need two hostnames on the same Worker** (both in `routes`): one for the API and webhooks, one for artifact downloads (`AI_WEBHOOK_PUBLIC_URL`). They must differ because the library rejects webhook URLs on `AI_WEBHOOK_PUBLIC_URL`'s own origin to prevent delivery loops — and this demo, unusually, delivers webhooks to itself. A real deployment whose receiver is elsewhere can use one hostname for both.

## Try it

```sh
curl -s -X POST https://<api-host>/predictions \
  -H "content-type: application/json" \
  -d '{"prompt": "In one sentence, why are webhooks better than polling?"}'
# → {"id":"pred_…","status":"queued","createdAt":"…","watch":"/events/pred_…"}

curl -s -X POST https://<api-host>/images \
  -H "content-type: application/json" \
  -d '{"prompt": "A watercolor lighthouse at dusk"}'

# a few seconds later:
curl -s https://<api-host>/events/pred_…
```

Webhook URLs must be HTTPS, so run against your deployed URL — local `wrangler dev` serves plain HTTP and the webhook URL won't validate.

## What the events look like

A text prediction (`prediction.succeeded`) — `output` is the model's response, inlined because it fits within the 256 KiB limit:

```json
{
  "id": "evt_27b0b93727224cf9994f9d15a3c9d363_completed",
  "type": "prediction.succeeded",
  "created_at": "2026-07-15T14:04:32.596Z",
  "data": {
    "prediction": {
      "id": "pred_27b0b93727224cf9994f9d15a3c9d363",
      "model": "@cf/meta/llama-3.2-3b-instruct",
      "context": { "demo": "webhooks-demo", "promptChars": 54 },
      "status": "succeeded",
      "created_at": "2026-07-15T14:04:28.605Z",
      "started_at": "2026-07-15T14:04:31.891Z",
      "completed_at": "2026-07-15T14:04:32.596Z",
      "output": {
        "response": "Webhooks are better than polling because they allow for a more efficient and scalable communication method, where the server only sends updates to the client when they occur, rather than the client constantly polling the server for changes.",
        "usage": {
          "prompt_tokens": 47,
          "completion_tokens": 43,
          "total_tokens": 90
        }
      },
      "error": null,
      "gateway_log_id": "01KXK1FV9KENMN7HWAP5KT1M32"
    }
  }
}
```

(`output` is shown trimmed — chat models return the full OpenAI-style completion object with `choices`, `usage`, and friends.)

An image prediction — the binary output was stored in R2, its content type sniffed from magic bytes, and `output` is a signed URL that expires after an hour:

```json
{
  "id": "evt_39741328634d41bcaec75486a547de51_completed",
  "type": "prediction.succeeded",
  "created_at": "2026-07-15T14:55:06.405Z",
  "data": {
    "prediction": {
      "id": "pred_39741328634d41bcaec75486a547de51",
      "model": "@cf/bytedance/stable-diffusion-xl-lightning",
      "context": { "demo": "webhooks-demo", "kind": "image" },
      "status": "succeeded",
      "created_at": "2026-07-15T14:54:58.000Z",
      "started_at": "2026-07-15T14:55:01.896Z",
      "completed_at": "2026-07-15T14:55:06.405Z",
      "output": {
        "type": "artifact",
        "url": "https://<artifacts-host>/_ai-gateway-webhooks/artifacts/predictions%2Fpred_39741328634d41bcaec75486a547de51%2Foutput?expires=1784130906&signature=rRvRVRNiMU…",
        "content_type": "image/jpeg",
        "size": 125732,
        "expires_at": "2026-07-15T15:55:06.000Z"
      },
      "error": null,
      "gateway_log_id": "01KXK4CAWDJY2SNXQPWMDRAEWV"
    }
  }
}
```

A failed prediction (`prediction.failed`) carries a sanitized error — no provider details leak into webhooks. Look up `gateway_log_id` in your AI Gateway logs for the real cause:

```json
{
  "type": "prediction.failed",
  "data": {
    "prediction": {
      "status": "failed",
      "output": null,
      "error": { "code": "inference_error", "message": "AI inference failed." },
      "gateway_log_id": "01KXK1ANHC921HKS3ECHYZQ96Y"
    }
  }
}
```

## Locking it down

`POST /predictions` and `/images` spend Workers AI money and `GET /events/*` exposes model output, so don't leave them public. How you protect them is up to you — an API key or session check in the fetch handler, a WAF rule, mTLS, or whatever your app already uses for auth.

Whatever you pick, two routes must stay reachable without it:

- `/hooks/ai` — the delivery Workflow POSTs there from outside any user session; it's already authenticated by HMAC signature verification (forged requests get a 401).
- the artifacts host — artifact URLs are meant to be consumed by whoever receives the webhook; they're self-authenticating (HMAC-signed path + expiry, tampering gets a 403).

For reference, this instance uses Cloudflare Access (Zero Trust → Access → Applications) with two self-hosted apps on the API host:

1. `<api-host>/hooks/ai` — policy **Bypass, Everyone**.
2. `<api-host>` — policy **Allow**, your identity.

Access applies the most specific matching application, so the webhook path stays reachable while everything else gets a login wall. The artifacts host has no Access application at all.

## License

[MIT](./LICENSE)
