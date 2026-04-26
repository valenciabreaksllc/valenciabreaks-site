// Supabase Edge Function: ai-review-work-queue
// - Keeps OpenAI API key private (stored as Supabase secret OPENAI_API_KEY)
// - Accepts JSON: { workQueueItems: [...] }
// - Returns JSON:
//   recommended_next_step, risks, follow_ups, suggested_process_improvement, daily_recap
//
// Deploy:
// - supabase functions deploy ai-review-work-queue
// - supabase secrets set OPENAI_API_KEY=...
//
// Note: This function uses the OpenAI Responses API.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

function badRequest(message: string) {
  return json({ error: message }, { status: 400 });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers":
          "authorization, x-client-info, apikey, content-type",
        "access-control-allow-methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") return json({ error: "Use POST" }, { status: 405 });

  if (!OPENAI_API_KEY) {
    return json(
      { error: "Missing OPENAI_API_KEY secret on Supabase." },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const workQueueItems = (body as any)?.workQueueItems;
  if (!Array.isArray(workQueueItems)) {
    return badRequest("Body must include workQueueItems: []");
  }

  // Keep input small + predictable
  const trimmed = workQueueItems.slice(0, 200).map((x: any) => ({
    id: String(x?.id ?? ""),
    receivedTime: String(x?.receivedTime ?? ""),
    source: String(x?.source ?? ""),
    account: String(x?.account ?? ""),
    customer: String(x?.customer ?? ""),
    orderNumber: String(x?.orderNumber ?? ""),
    issueType: String(x?.issueType ?? ""),
    priority: String(x?.priority ?? ""),
    status: String(x?.status ?? ""),
    nextAction: String(x?.nextAction ?? ""),
    sendTo: String(x?.sendTo ?? ""),
    notes: String(x?.notes ?? ""),
    archived: Boolean(x?.archived ?? false),
    archivedAt: x?.archivedAt ?? null,
    resolvedAt: x?.resolvedAt ?? null,
  }));

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      recommended_next_step: { type: "string" },
      risks: { type: "array", items: { type: "string" } },
      follow_ups: { type: "array", items: { type: "string" } },
      suggested_process_improvement: { type: "string" },
      daily_recap: { type: "string" },
    },
    required: [
      "recommended_next_step",
      "risks",
      "follow_ups",
      "suggested_process_improvement",
      "daily_recap",
    ],
  } as const;

  const instructions =
    "You are an operations assistant for an Inventory / Operations Coordinator. " +
    "You will review a Live Work Queue list. " +
    "Be practical and concise. Prioritize: urgent/high items, needs review, follow-ups, waiting states, and anything with financial or customer-risk. " +
    "Output must follow the provided JSON schema exactly.";

  const userPrompt =
    "Work queue items (JSON):\n" + JSON.stringify(trimmed) + "\n\n" +
    "Rules:\n" +
    "- Ignore archived items unless they still represent an active risk.\n" +
    "- Prefer a single clear recommended_next_step.\n" +
    "- risks: short bullets.\n" +
    "- follow_ups: short actionable bullets.\n" +
    "- suggested_process_improvement: 1 improvement.\n" +
    "- daily_recap: 6-12 lines, ops-friendly (not chatty).";

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      // Cost-conscious model
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: instructions },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "work_queue_review",
          schema,
          strict: true,
        },
      },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return json(
      { error: "OpenAI request failed", status: resp.status, detail: text },
      { status: 502 },
    );
  }

  const data = await resp.json();
  // Responses API returns the structured JSON in output_text when using json_schema.
  // We also defensively try to parse from common fields.
  const outputText: string =
    data?.output_text ??
    data?.output?.[0]?.content?.[0]?.text ??
    "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    return json(
      { error: "Model did not return valid JSON.", raw: outputText },
      { status: 502 },
    );
  }

  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers":
        "authorization, x-client-info, apikey, content-type",
    },
  });
});

