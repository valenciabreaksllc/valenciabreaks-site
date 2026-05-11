const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function safeString(value, fallback = "Unknown") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function safeOptionalString(value, maxLength = 2000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeCase(raw, fileName) {
  const priority = ["Low", "Medium", "High"].includes(raw?.priority)
    ? raw.priority
    : "Medium";

  return {
    source: safeString(raw?.source || raw?.platform, "Unknown"),
    account: safeString(raw?.account, "All"),
    customer: safeString(raw?.customer, ""),
    orderNumber: safeString(raw?.orderNumber, ""),
    issueType: safeString(raw?.issueType, "General Question"),
    priority,
    template: safeString(raw?.template || raw?.recommendedTemplate, "General Review"),
    summary: safeString(raw?.summary, "AI reviewed the screenshot. Please verify details before replying."),
    nextAction: safeString(raw?.nextAction, "Review the screenshot, verify details, then copy the reply or add to queue."),
    suggestedReply: safeString(raw?.suggestedReply, "Hello, thanks for reaching out. I’m reviewing this now and will help get it sorted for you."),
    confidence:
      typeof raw?.confidence === "number"
        ? `${Math.round(raw.confidence * 100)}%`
        : safeString(raw?.confidence, "Needs review"),
    fileName,
  };
}

const promptText = `
You analyze screenshots from customer-service, marketplace, email, order, and shipping tools for a sports cards / breaks / collectibles operation.

Extract and classify the visible customer inquiry.

Return exactly one JSON object.

Fields:
- source: platform/source such as TikTok Shop Chat, eBay, Whatnot, Fanatics Live, Shopify, Gmail, Pirate Ship, ShipStation, Instagram, Facebook, Discord, Other, or Unknown.
- account: visible account/storefront/team such as VR, PS, CK, All, or Unknown.
- customer: visible customer name, buyer ID, username, email, or blank if not visible.
- orderNumber: visible order number, claim number, tracking number, or blank if not visible.
- issueType: one of General Question, Shipping Delay, Tracking Question, Missing Item, Damaged Item, Wrong Item, Refund Request, Cancellation Request, Address Issue, Payment Issue, Break Question, Combined Shipping, Order Status, Marketplace Escalation, Positive / Thank You, Other.
- priority: Low, Medium, or High.
- template: recommended internal reply template name.
- summary: short summary of what the customer is asking.
- nextAction: what the operator should do before replying.
- suggestedReply: professional copy-ready reply.
- confidence: number from 0 to 1.

Important:
- Never auto-send anything.
- Do not invent names, order numbers, tracking numbers, or account details.
- If a customer/order field is not visible, return an empty string for that field.
- Raise priority to High for refunds, disputes, angry customers, missing items, damaged items, wrong items, cancellations, chargebacks, marketplace cases, or deadlines.
- Keep suggestedReply concise, helpful, and safe to copy.
- Do not promise refunds, replacements, shipping dates, or outcomes unless visibly confirmed.
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    if (!OPENAI_API_KEY) {
      return jsonResponse({ error: "Missing OPENAI_API_KEY Supabase secret" }, 500);
    }

    const body = await req.json().catch(() => ({}));

    const fileName = safeString(body?.fileName, "screenshot.png");
    const mimeType = safeString(body?.mimeType, "image/png");
    const extraContext =
      safeOptionalString(body?.extraContext) ||
      safeOptionalString(body?.context?.extraContext);
    const extraContextText = extraContext
      ? `\n\nAdditional operator context, not visible in the screenshot:\n${extraContext}\n\nUse this only to guide tone, policy awareness, known order history, and next-step judgment. Do not invent visible facts.`
      : "";

    let imageUrl = "";

    if (typeof body?.imageBase64 === "string" && body.imageBase64.trim()) {
      const raw = body.imageBase64.trim();
      imageUrl = raw.startsWith("data:image/")
        ? raw
        : `data:${mimeType};base64,${raw}`;
    } else if (typeof body?.dataUrl === "string" && body.dataUrl.trim()) {
      imageUrl = body.dataUrl.trim();
    } else if (Array.isArray(body?.screenshots) && body.screenshots[0]?.dataUrl) {
      imageUrl = body.screenshots[0].dataUrl;
    }

    if (!imageUrl || !imageUrl.startsWith("data:image/")) {
      return jsonResponse(
        {
          error: "No readable screenshot image was provided",
          cases: [],
        },
        400
      );
    }

    const openaiPayload = {
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `${promptText}\n\nAnalyze this screenshot file: ${fileName}${extraContextText}`,
            },
            {
              type: "input_image",
              image_url: imageUrl,
              detail: "high",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "cs_inquiry_case",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              source: { type: "string" },
              account: { type: "string" },
              customer: { type: "string" },
              orderNumber: { type: "string" },
              issueType: {
                type: "string",
                enum: [
                  "General Question",
                  "Shipping Delay",
                  "Tracking Question",
                  "Missing Item",
                  "Damaged Item",
                  "Wrong Item",
                  "Refund Request",
                  "Cancellation Request",
                  "Address Issue",
                  "Payment Issue",
                  "Break Question",
                  "Combined Shipping",
                  "Order Status",
                  "Marketplace Escalation",
                  "Positive / Thank You",
                  "Other"
                ]
              },
              priority: {
                type: "string",
                enum: ["Low", "Medium", "High"]
              },
              template: { type: "string" },
              summary: { type: "string" },
              nextAction: { type: "string" },
              suggestedReply: { type: "string" },
              confidence: {
                type: "number",
                minimum: 0,
                maximum: 1
              }
            },
            required: [
              "source",
              "account",
              "customer",
              "orderNumber",
              "issueType",
              "priority",
              "template",
              "summary",
              "nextAction",
              "suggestedReply",
              "confidence"
            ]
          }
        }
      }
    };

    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(openaiPayload),
    });

    const openaiJson = await openaiRes.json();

    if (!openaiRes.ok) {
      return jsonResponse(
        {
          error: openaiJson?.error?.message || "OpenAI analysis failed",
          cases: [],
        },
        400
      );
    }

    const outputText =
      openaiJson?.output_text ||
      openaiJson?.output?.[0]?.content?.find?.((part) => part?.type === "output_text")?.text ||
      openaiJson?.output?.[0]?.content?.[0]?.text;

    let parsed = {};

    try {
      parsed = typeof outputText === "string" ? JSON.parse(outputText) : {};
    } catch (_err) {
      parsed = {};
    }

    const detectedCase = normalizeCase(parsed, fileName);

    return jsonResponse({
      case: detectedCase,
      cases: [detectedCase],
      items: [detectedCase],
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : String(error),
        cases: [],
      },
      500
    );
  }
});
