import {
  ARTIFACT_PATH_PREFIX,
  createAsyncAI,
  handleArtifactRequest,
  parseWebhook,
  WebhookVerificationError,
} from "ai-gateway-webhooks";

export {
  PredictionWorkflow,
  WebhookDeliveryWorkflow,
} from "ai-gateway-webhooks";

// Small Workers AI models so demo runs are fast and cheap. Third-party models
// ("openai/gpt-4.1-mini", …) work too via AI Gateway Unified Billing.
const TEXT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const IMAGE_MODEL = "@cf/bytedance/stable-diffusion-xl-lightning";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Signed, expiring artifact downloads (binary/large outputs stored in R2).
    if (url.pathname.startsWith(ARTIFACT_PATH_PREFIX)) {
      return handleArtifactRequest(request, env);
    }

    if (request.method === "POST" && url.pathname === "/predictions") {
      return queuePrediction(request, env);
    }

    if (request.method === "POST" && url.pathname === "/images") {
      return queueImage(request, env);
    }

    if (request.method === "POST" && url.pathname === "/hooks/ai") {
      return receiveWebhook(request, env);
    }

    if (request.method === "GET" && url.pathname.startsWith("/events/")) {
      return getEvent(url, env);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function queuePrediction(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { prompt?: string };
  const prompt = body.prompt ?? "Tell me a one-sentence fun fact.";

  // Deliver the webhook to this same Worker. Webhook URLs must be HTTPS, so
  // run this demo against the deployed workers.dev URL rather than a local
  // `wrangler dev` origin.
  const webhookUrl = new URL("/hooks/ai", request.url).toString();

  const ai = createAsyncAI(env);
  const prediction = await ai.run(
    TEXT_MODEL,
    { messages: [{ role: "user", content: prompt }] },
    {
      webhook: { url: webhookUrl },
      context: { demo: "webhooks-demo", promptChars: prompt.length },
    },
  );

  return Response.json(
    { ...prediction, watch: `/events/${prediction.id}` },
    { status: 202 },
  );
}

// Binary output (a PNG here) exceeds what fits in a webhook payload, so the
// library stores it in R2 and delivers a signed, expiring artifact URL.
async function queueImage(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { prompt?: string };
  const prompt = body.prompt ?? "A watercolor lighthouse at dusk";

  const webhookUrl = new URL("/hooks/ai", request.url).toString();

  const ai = createAsyncAI(env);
  const prediction = await ai.run(
    IMAGE_MODEL,
    { prompt },
    {
      webhook: { url: webhookUrl },
      context: { demo: "webhooks-demo", kind: "image" },
    },
  );

  return Response.json(
    { ...prediction, watch: `/events/${prediction.id}` },
    { status: 202 },
  );
}

async function receiveWebhook(request: Request, env: Env): Promise<Response> {
  try {
    const event = await parseWebhook(request, env.AI_WEBHOOK_SECRET);

    // A production receiver should deduplicate on the webhook-id header
    // before doing work; for the demo, overwriting the same KV key is fine.
    await env.EVENTS.put(
      event.data.prediction.id,
      JSON.stringify(event, null, 2),
      { expirationTtl: 24 * 60 * 60 },
    );

    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return new Response("Invalid webhook", { status: 401 });
    }
    throw error;
  }
}

async function getEvent(url: URL, env: Env): Promise<Response> {
  const predictionId = url.pathname.slice("/events/".length);
  const stored = await env.EVENTS.get(predictionId);

  if (!stored) {
    return new Response(
      "No event yet — inference may still be running. Try again shortly.\n",
      { status: 404 },
    );
  }

  return new Response(stored, {
    headers: { "content-type": "application/json" },
  });
}
