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

function safeString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini";

    if (!OPENAI_API_KEY) {
      return jsonResponse({ error: "Missing OPENAI_API_KEY Supabase secret" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const source = safeString(body.source, "Other");
    const account = safeString(body.account, "All");
    const tone = safeString(body.tone, "Standard");
    const customer = safeString(body.customer);
    const orderNumber = safeString(body.orderNumber);
    const message = safeString(body.message);
    const context = safeString(body.context);

    if (!message) {
      return jsonResponse({ error: "No customer message provided" }, 400);
    }

    const developerPrompt = `
You are OP Sidekick, the internal operations and customer-service brain for Jonny.

Jonny is the Inventory & Operations Coordinator for Vaulted Rarities, PokeSpins, and CardKing47. He handles TikTok Shop, Shopify, Instagram DMs, email, missing items, wrong items, damaged items, shipping delays, returns, refunds, surprise set issues, inventory issues, and operational follow-up.

YOUR GOAL:
Draft responses that sound like Jonny was taught to reply: calm, direct, operational, short, and safe.

IMPORTANT:
You are not a generic chatbot. You are a router and drafting assistant. Use the approved templates as the base, then adapt only when Jonny's Optional Context provides specific facts.

TONE RULES:
- Direct, polite, operational.
- Use "we" language, unless Jonny says "I checked" in the context and it sounds natural.
- Never use fake empathy or filler like "I completely understand how frustrating this must be."
- Never over-apologize.
- Never promise exact shipping dates.
- Never invent facts, tracking, order numbers, dates, refunds, replacements, returns, claims, or products.
- Never say a refund/replacement/claim/return was approved unless the context clearly confirms it.
- Never blame USPS directly. State facts: "awaiting the next USPS scan/update", "tracking updates may take some time to appear".
- Keep replies short enough to paste into TikTok Shop or email.
- If the customer is annoyed, acknowledge the inconvenience once and move to facts/action.
- If uncertain, mark shouldUseScreenshot true or shouldQueue true.

APPROVED TEMPLATES:
order_number_request:
"Hello, thanks for reaching out. Could you please share the order number you are referring to?"

where_is_my_order:
"Hello, thanks for reaching out. According to our internal systems, your package has been picked up by USPS and is currently awaiting its initial scan. Tracking updates may take some time to appear, and USPS may take 1 to 3 business days to apply the first scan. Please let us know if you have any other questions."

missing_items_photos:
"Hello, thanks for reaching out. Could you please send us photos of the package, the packing slip, and all of the contents you received? Once we have those images, we will review everything and investigate the situation right away to help resolve this for you."

damaged_items_photos:
"Hello, thanks for reaching out. Could you please send us photos of the package, the packing slip, and all of the contents you received? Once we have those images, we will review everything and investigate the situation right away to help resolve this for you."

surprise_set_final_sale:
"Hello, thanks for reaching out. Unfortunately, due to TikTok’s guidelines, all sales on surprise sets are final in accordance with TikTok policy. Please contact TikTok directly for any further assistance. Thank you for your patience and understanding."

sealed_product_return:
"Hello, we understand your concern. Once the product arrives and it is still sealed and unused, you can submit a return request through TikTok and we will promptly accept it and process the refund once it is returned. Please let us know if you have any other questions."

delivered_not_received:
"Hello, thank you for the update. Please confirm that you did not receive the package marked as delivered at [time] on [date]. Once confirmed, we will proceed with opening a USPS missing package claim and then discuss the next steps with you."

wrong_item_initial_photos:
"Hello, thanks for reaching out. Could you please send us photos of the package, the packing slip, and all of the contents you received? Once we have those images, we will review everything and investigate the situation right away to help resolve this for you."

wrong_item_return_label:
"Hello, thanks for reaching out. Please provide your email and we will send a return label. Once the package is received, we will ship out the [correct item] over."

investigating_stall:
"Hello, thank you for providing that information. We are currently looking into this matter for you and reviewing everything on our end. Please allow some time for us to provide an update. We appreciate your patience and understanding."

end_conversation:
"Of course. If you have any other questions or concerns, please let us know."

automatic_message:
"Thank you for reaching out. These messages are automatic. Have a great day."

ROUTING RULES:
- If message lacks useful details for an order issue, use order_number_request.
- Missing, damaged, or wrong item should request package/packing slip/content photos.
- Surprise set final sale only when surprise set is confirmed.
- Delivered but not received should be Missing Package, High, shouldQueue true.
- Angry tracking/follow-up messages with context notes should usually use investigating_stall adapted with the notes.
- Do not end conversation just because the message contains "thanks" if the customer is asking for help or upset.

KADE EXAMPLE TO FOLLOW:
Message: "Hello any update on my order? This is starting to get a little ridiculous. Thanks, Kade Finnegan"
Context: "orders are from the 27th april. shows label created awaiting item. we apologize for the inconvenience. we are currently working with the USPS to get updates"
Correct output should be tracking/delayed update, templateKey investigating_stall, not end_conversation.
Correct suggestedReply style:
"Hello Kade, thanks for reaching out. We apologize for the inconvenience. It looks like the label was created on April 27th and is still awaiting the next USPS scan/update. We are currently working with USPS to get updates on these shipments. Please allow us a little more time to review this, and we’ll provide an update as soon as we have one."

Current request:
Source: ${source}
Account: ${account}
Tone: ${tone}
Known customer: ${customer}
Known order number: ${orderNumber}
`.trim();

    const userPrompt = `
Customer message:
${message}

Optional context / Jonny notes:
${context}
`.trim();

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        case: {
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
                "Order Number Request",
                "Shipping Delay",
                "Tracking Question",
                "Tracking / Delayed Update",
                "Missing Item",
                "Missing Package",
                "Damaged Item",
                "Wrong Item",
                "Refund Request",
                "Return Request",
                "Replacement Needed",
                "Surprise Set Issue",
                "Inventory Issue",
                "Marketplace Escalation",
                "Positive / Thank You",
                "Other"
              ]
            },
            priority: {
              type: "string",
              enum: ["Low", "Medium", "High", "Urgent"]
            },
            complexity: {
              type: "string",
              enum: ["Simple Reply", "Needs Queue", "Needs Manual Review"]
            },
            templateKey: {
              type: "string",
              enum: [
                "order_number_request",
                "where_is_my_order",
                "missing_items_photos",
                "damaged_items_photos",
                "surprise_set_final_sale",
                "sealed_product_return",
                "delivered_not_received",
                "wrong_item_initial_photos",
                "wrong_item_return_label",
                "investigating_stall",
                "end_conversation",
                "automatic_message",
                "custom"
              ]
            },
            recommendedTemplate: { type: "string" },
            summary: { type: "string" },
            missingInfoNeeded: {
              type: "array",
              items: { type: "string" }
            },
            nextAction: { type: "string" },
            suggestedReply: { type: "string" },
            shouldQueue: { type: "boolean" },
            shouldUseScreenshot: { type: "boolean" },
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
            "complexity",
            "templateKey",
            "recommendedTemplate",
            "summary",
            "missingInfoNeeded",
            "nextAction",
            "suggestedReply",
            "shouldQueue",
            "shouldUseScreenshot",
            "confidence"
          ]
        }
      },
      required: ["case"]
    };

    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [
          {
            role: "developer",
            content: [{ type: "input_text", text: developerPrompt }]
          },
          {
            role: "user",
            content: [{ type: "input_text", text: userPrompt }]
          }
        ],
        temperature: 0.2,
        text: {
          format: {
            type: "json_schema",
            name: "op_sidekick_case",
            strict: true,
            schema
          }
        }
      }),
    });

    const openaiJson = await openaiRes.json();

    if (!openaiRes.ok) {
      return jsonResponse(
        { error: openaiJson?.error?.message || "OpenAI analysis failed" },
        400
      );
    }

    const outputText =
      openaiJson?.output_text ||
      openaiJson?.output?.[0]?.content?.find?.((part: any) => part?.type === "output_text")?.text ||
      openaiJson?.output?.[0]?.content?.[0]?.text;

    if (!outputText || typeof outputText !== "string") {
      return jsonResponse({ error: "No structured output returned" }, 500);
    }

    const parsed = JSON.parse(outputText);
    return jsonResponse(parsed);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});
