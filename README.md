# webhooks-demo

End-to-end demo of [ai-gateway-webhooks](https://github.com/corywilkerson/ai-gateway-webhooks) in a single Worker: it queues async AI predictions against itself, receives the signed lifecycle webhook, verifies the signature, and stores the event in KV.

```sh
# queue a prediction — returns immediately
curl -s -X POST https://webhooks-demo.<your-subdomain>.workers.dev/predictions \
  -H "content-type: application/json" \
  -d '{"prompt": "In one sentence, why are webhooks better than polling?"}'
# → {"id":"pred_…","status":"queued","createdAt":"…","watch":"/events/pred_…"}

# fetch the verified webhook event once inference completes
curl -s https://webhooks-demo.<your-subdomain>.workers.dev/events/pred_…
```

## Setup

```sh
npm install
npx wrangler kv namespace create EVENTS   # put the id in wrangler.jsonc
npm run deploy
npm run secrets                           # generate + upload AI_WEBHOOK_SECRET
```

Webhook URLs must be HTTPS, and this demo targets its own deployed origin — so exercise it against the `workers.dev` URL rather than local `wrangler dev`.

Note: the demo installs `ai-gateway-webhooks` from a local tarball (`file:../predictions/…`) until the package is published to npm.
