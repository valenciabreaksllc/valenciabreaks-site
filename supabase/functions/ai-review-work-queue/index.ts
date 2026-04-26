const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type WorkQueueItem = {
  receivedTime?: string;
  source?: string;
  account?: string;
  customer?: string;
  orderNumber?: string;
  issueType?: string;
  priority?: string;
  status?: string;
  nextAction?: string;
  sendTo?: string;
  notes?: string;
  archived?: boolean;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function safeItems(items: unknown): WorkQueueItem[] {
  if (!Array.isArray(items)) return [];

  return items
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as WorkQueueItem;

      return {
        receivedTime: String(row.receivedTime || "").slice(0, 80),
        source: String(row.source || "").slice(0, 80),
        account: String(row.account || "").slice(0, 40),
        customer: String(row.customer || "").slice(0, 120),
        orderNumber: String(row.orderNumber || "").slice(0, 120),
        issueType: String(row.issueType || "").slice(0, 120),
        priority: String(row.priority || "").slice(0, 40),
        status: String(row.status || "").slice(0, 80),
        nextAction: String(row.nextAction || "").slice(0, 300),
        sendTo: String(row.sendTo || "").slice(0, 120),
        notes: String(row.notes || "").slice(0, 500),
        archived: Boolean(row.archived),
      };
    })
    .filter((item) => !item.archived)
    .slice(0, 50);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");

    if (!apiKey) {
      return jsonResponse(
        {
          error: "Missing OPENAI_API_KEY Supabase secret.",
        },
        500,
      );
    }

    const body = await req.json().catch(() => ({}));
    const workQueueItems = safeItems(body.workQueueItems);

    const prompt = `
You are an operations workflow reviewer for an Inventory & Operations Coordinator at OP Comics.

Review the active Live Work Queue items below and return practical next steps.

Focus on:
- urgent or high priority items
- unresolved customer issues
- TikTok Shop chat/refund/return issues
- VR Email
- TikTok DMs
- Instagram DMs
- inventory issues
- replacement/loss risks
- what should be worked on next
- what should be documented as performance proof

Return ONLY valid JSON with exactly these keys:
{
  "recommended_next_step": "string",
  "risks": ["string"],
  "follow_ups": ["string"],
  "suggested_process_improvement": "string",
  "daily_recap": "string"
}

Active Live Work Queue items:
${JSON.stringify(workQueueItems, null, 2)}
`;

    const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        input: prompt,
        text: {
          format: {
            type: "json_object",
          },
        },
      }),
    });

    const openAIData = await openAIResponse.json().catch(() => null);

    if (!openAIResponse.ok) {
      return jsonResponse(
        {
          error: "OpenAI request failed.",
          details: openAIData,
        },
        500,
      );
    }

    const outputText =
      openAIData?.output_text ||
      openAIData?.output?.[0]?.content?.[0]?.text ||
      "";

    let parsed;

    try {
      parsed = JSON.parse(outputText);
    } catch {
      parsed = {
        recommended_next_step: outputText || "No recommendation returned.",
        risks: [],
        follow_ups: [],
        suggested_process_improvement:
          "Review the queue manually and confirm high-priority follow-ups.",
        daily_recap: "AI returned text but not structured JSON.",
      };
    }

    return jsonResponse(parsed);
  } catch (error) {
    return jsonResponse(
      {
        error: "Edge Function crashed.",
        details: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});