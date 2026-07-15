# webhooks-demo

End-to-end demo of [ai-gateway-webhooks](https://github.com/corywilkerson/ai-gateway-webhooks) in a single Worker at `hooks.cory.land`: it queues async AI predictions against itself, receives the signed lifecycle webhook, verifies the signature, and stores the event in KV.

```sh
# queue a prediction — returns immediately
curl -s -X POST https://hooks.cory.land/predictions \
  -H "content-type: application/json" \
  -d '{"prompt": "In one sentence, why are webhooks better than polling?"}'
# → {"id":"pred_…","status":"queued","createdAt":"…","watch":"/events/pred_…"}

# fetch the verified webhook event once inference completes
curl -s https://hooks.cory.land/events/pred_…
```

## Setup

```sh
npm install
npx wrangler kv namespace create EVENTS   # put the id in wrangler.jsonc
npm run deploy
npm run secrets                           # generate + upload AI_WEBHOOK_SECRET
```

The Worker deploys only to the `hooks.cory.land` custom domain (`workers_dev` is disabled).

## Access

`/predictions` and `/events/*` are meant to sit behind Cloudflare Access — queuing predictions spends Workers AI money and events contain model output. `/hooks/ai` must **bypass** Access: the delivery Workflow POSTs to it from outside any Access session, and it is already protected by HMAC signature verification (forged requests get a 401 from `parseWebhook`).

Zero Trust setup: one self-hosted app for `hooks.cory.land/hooks/ai` with a Bypass policy (Everyone), and one for `hooks.cory.land` with an Allow policy for your identity. Access matches the most specific application first.

Note: the demo installs `ai-gateway-webhooks` from a local tarball (`file:../predictions/…`) until the package is published to npm.
