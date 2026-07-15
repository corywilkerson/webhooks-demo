# webhooks-demo

A single Cloudflare Worker that demos [ai-gateway-webhooks](https://github.com/corywilkerson/ai-gateway-webhooks) end to end: it queues async Workers AI predictions, points the lifecycle webhook back at itself, verifies each delivery's signature, and stores the events in KV.

```
POST /predictions ──▶ prediction Workflow runs inference
                            │
                            ▼
      signed webhook ──▶ POST /hooks/ai ──▶ verified with parseWebhook() ──▶ KV
                                                                              │
GET /events/<prediction id> ◀─────────────────────────────────────────────────┘
```

| Route | What it does |
| --- | --- |
| `POST /predictions` | Queues a prediction from `{"prompt": "…"}`; returns `{"id": "pred_…"}` immediately |
| `POST /hooks/ai` | Receives the webhook; rejects anything without a valid signature |
| `GET /events/:id` | Returns the stored event for a prediction |

## Deploy your own

```sh
npm install
npx wrangler kv namespace create EVENTS   # put the returned id in wrangler.jsonc
npx wrangler deploy
npm run secrets                           # generate + upload AI_WEBHOOK_SECRET
```

`wrangler.jsonc` pins this instance's custom domain and KV namespace id — swap in your own domain under `routes`, or delete `routes` and set `"workers_dev": true` to use your `workers.dev` URL.

## Try it

```sh
curl -s -X POST https://<your-worker>/predictions \
  -H "content-type: application/json" \
  -d '{"prompt": "In one sentence, why are webhooks better than polling?"}'
# → {"id":"pred_…","status":"queued","createdAt":"…","watch":"/events/pred_…"}

# a few seconds later:
curl -s https://<your-worker>/events/pred_…
```

Webhook URLs must be HTTPS, so run against your deployed URL — local `wrangler dev` serves plain HTTP and the webhook URL won't validate.

## Locking it down

`POST /predictions` spends Workers AI money and `GET /events/*` exposes model output, so don't leave them public. This instance uses Cloudflare Access (Zero Trust → Access → Applications) with two self-hosted apps:

1. `<your-host>/hooks/ai` — policy **Bypass, Everyone**. The delivery Workflow POSTs here from outside any Access session, and the route is already authenticated by HMAC signature verification — forged requests get a 401.
2. `<your-host>` — policy **Allow**, your identity.

Access applies the most specific matching application, so the webhook path stays reachable while everything else gets a login wall.

## License

[MIT](./LICENSE)
