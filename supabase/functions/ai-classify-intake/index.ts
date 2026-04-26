import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

type CSTemplate = {
  name?: string;
  category?: string;
  trigger?: string;
  requiresRefund?: string;
  requiresReview?: string;
  finalAction?: string;
  internalNotes?: string;
  responseStarter?: string;
};

function safeTemplates(templates: unknown): CSTemplate[] {
  if (!Array.isArray(templates)) return [];

  return templates
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as CSTemplate;

      return {
        name: String(row.name || "").slice(0, 200),
        category: String(row.category || "").slice(0, 100),
        trigger: String(row.trigger || "").slice(0, 300),
        requiresRefund: String(row.requiresRefund || "").slice(0, 10),
        requiresReview: String(row.requiresReview || "").slice(0, 10),
        finalAction: String(row.finalAction || "").slice(0, 300),
        internalNotes: String(row.internalNotes || "").slice(0, 500),
        responseStarter: String(row.responseStarter || "").slice(0, 1000),
      };
    });
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
    const source = String(body.source || "").slice(0, 80);
    const account = String(body.account || "").slice(0, 40);
    const customer = String(body.customer || "").slice(0, 120);
    const orderNumber = String(body.orderNumber || "").slice(0, 120);
    const rawMessage = String(body.rawMessage || "").slice(0, 2000);
    const csTemplates = safeTemplates(body.csTemplates);

    const templatesText = csTemplates
      .map((t) => `Name: ${t.name}\nCategory: ${t.category}\nTrigger: ${t.trigger}\nRequires Refund: ${t.requiresRefund}\nRequires Review: ${t.requiresReview}\nFinal Action: ${t.finalAction}\nInternal Notes: ${t.internalNotes}\nResponse Starter: ${t.responseStarter}`)
      .join("\n\n---\n\n");

    const prompt = `
You are a customer service AI assistant for OP Comics, classifying and drafting responses for incoming customer inquiries.

Incoming inquiry details:
- Source: ${source}
- Account: ${account}
- Customer: ${customer}
- Order Number: ${orderNumber}
- Raw Message: ${rawMessage}

Customer Service Templates (use as context for drafting professional responses):
${templatesText}

Classify the inquiry and draft a response.

Return ONLY valid JSON with exactly these keys:
- issue_type: One of [Missing Item, Wrong Item, Missing Package, Damaged Item, Refund Request, Return Request, Order Update, Inventory Issue, Surprise Set Issue, General Question]
- priority: One of [Low, Medium, High, Urgent]
- status: One of [New, In Progress, Needs Review, Follow Up, Waiting on Customer, Waiting on Team, Resolved]
- next_action: Brief internal next step
- send_to: One of [Daily Follow-Up, Issues Caught + Resolved, Replacement / Loss Log, Inventory Exception, Weekly Review]
- draft_response: Professional, helpful, concise customer response. Do not promise refunds or replacements unless the issue clearly requires review. Recommend review when evidence/order verification is needed.
- internal_notes: Brief notes for internal use

Sound professional, helpful, and concise.
`;

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1000,
        temperature: 0.3,
      }),
    });

    if (!openaiResponse.ok) {
      throw new Error(`OpenAI API error: ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new Error("No response from OpenAI");
    }

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      throw new Error("Invalid JSON response from OpenAI");
    }

    // Validate required keys
    const requiredKeys = ["issue_type", "priority", "status", "next_action", "send_to", "draft_response", "internal_notes"];
    for (const key of requiredKeys) {
      if (!(key in result)) {
        throw new Error(`Missing key: ${key}`);
      }
    }

    return jsonResponse(result);
  } catch (error) {
    console.error("Error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
});