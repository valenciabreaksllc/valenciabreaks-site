const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AssistantPriority = "Low" | "Medium" | "High";
type AssistantConfidence = "Low" | "Medium" | "High";

type InboundMessage = {
  external_id?: string;
  brand?: string;
  source?: string;
  channel?: string;
  label?: string;
  sender_name?: string;
  sender_email?: string;
  subject?: string;
  message_body?: string;
  priority?: string;
  status?: string;
  email_received_at?: string;
  created_at?: string;
  message_type?: string;
};

type AssistantAnalysis = {
  situation: string;
  recommendedNextStep: string;
  missingInfo: string[];
  draftReply: string;
  suggestedPriority: AssistantPriority;
  suggestedStatus: string;
  confidence: AssistantConfidence;
  reasoningTags: string[];
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

const safeText = (value: unknown, maxLength = 4000) =>
  String(value || "").slice(0, maxLength);

const normalizePriority = (value: unknown): AssistantPriority => {
  if (value === "Low" || value === "Medium" || value === "High") return value;
  return "Medium";
};

const normalizeConfidence = (value: unknown): AssistantConfidence => {
  if (value === "Low" || value === "Medium" || value === "High") return value;
  return "Medium";
};

const normalizeStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => safeText(item, 120).trim()).filter(Boolean).slice(0, 8);
};

const normalizeAnalysis = (value: Record<string, unknown>): AssistantAnalysis => ({
  situation: safeText(value.situation, 500) || "This message needs support review.",
  recommendedNextStep:
    safeText(value.recommendedNextStep, 500) ||
    "Review the customer message and respond with the next clear step.",
  missingInfo: normalizeStringArray(value.missingInfo),
  draftReply:
    safeText(value.draftReply, 1000) ||
    "Hey, thanks for reaching out. I can help with this. Can you send over your order number or a little more detail so I can check it for you?",
  suggestedPriority: normalizePriority(value.suggestedPriority),
  suggestedStatus: safeText(value.suggestedStatus, 120) || "Needs Reply",
  confidence: normalizeConfidence(value.confidence),
  reasoningTags: normalizeStringArray(value.reasoningTags),
});

const SYSTEM_PROMPT = `You are the Ops Command Hub assistant for Jonny at Outer Planes / Vaulted / TikTok Shop support.
Analyze the support message and produce a concise operational recommendation.
The assistant should sound calm, direct, and useful.
Do not over-apologize.
Do not promise a refund, replacement, or cancellation without review.
Draft replies should sound like Jonny: friendly, short, clear, action-first, no corporate fluff.
Ask for missing order details or evidence when needed.
Return only JSON matching the schema.

Case guidance:
- Refund / Return messages: identify as refund or return request. Recommend checking order/customer evidence before approving or rejecting. Missing info may include order number, return reason, evidence, photos.
- Replacement/shipping messages: identify as replacement or shipping review. Recommend verifying order, item, and evidence. Missing info may include order number, item, photo/evidence.
- TikTok Shop Chat: identify as TikTok Shop customer message. Recommend direct reply if enough information is present, otherwise ask for order details.
- Outlook: identify as email support request.
- Older messages: mention if older than 24 hours based on email_received_at or created_at if included.`;

const assistantJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    situation: { type: "string" },
    recommendedNextStep: { type: "string" },
    missingInfo: {
      type: "array",
      items: { type: "string" },
    },
    draftReply: { type: "string" },
    suggestedPriority: {
      type: "string",
      enum: ["Low", "Medium", "High"],
    },
    suggestedStatus: { type: "string" },
    confidence: {
      type: "string",
      enum: ["Low", "Medium", "High"],
    },
    reasoningTags: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "situation",
    "recommendedNextStep",
    "missingInfo",
    "draftReply",
    "suggestedPriority",
    "suggestedStatus",
    "confidence",
    "reasoningTags",
  ],
};

const buildUserPrompt = (message: InboundMessage) =>
  [
    "Analyze this inbound support message and return the structured assistant analysis.",
    "",
    `External ID: ${safeText(message.external_id, 200)}`,
    `Brand: ${safeText(message.brand, 120)}`,
    `Source: ${safeText(message.source, 120)}`,
    `Channel: ${safeText(message.channel, 120)}`,
    `Label: ${safeText(message.label, 120)}`,
    `Sender Name: ${safeText(message.sender_name, 120)}`,
    `Sender Email: ${safeText(message.sender_email, 160)}`,
    `Subject: ${safeText(message.subject, 300)}`,
    `Priority: ${safeText(message.priority, 80)}`,
    `Status: ${safeText(message.status, 80)}`,
    `Email Received At: ${safeText(message.email_received_at, 80)}`,
    `Created At: ${safeText(message.created_at, 80)}`,
    `Message Type: ${safeText(message.message_type, 120)}`,
    "",
    "Message Body:",
    safeText(message.message_body, 6000) || "(empty)",
  ].join("\n");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const message = body?.message as InboundMessage | undefined;

    if (!message || typeof message !== "object") {
      return jsonResponse({ error: "Missing message." }, 400);
    }

    const openAIKey = Deno.env.get("OPENAI_API_KEY");
    if (!openAIKey) {
      return jsonResponse(
        {
          error: "Assistant generation failed.",
          details: "OPENAI_API_KEY is not configured.",
        },
        500,
      );
    }

    const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAIKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: SYSTEM_PROMPT }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: buildUserPrompt(message) }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "message_assistant_analysis",
            strict: true,
            schema: assistantJsonSchema,
          },
        },
        temperature: 0.2,
        max_output_tokens: 1000,
      }),
    });

    const openAIData = await openAIResponse.json().catch(() => null);

    if (!openAIResponse.ok) {
      return jsonResponse(
        {
          error: "Assistant generation failed.",
          details:
            safeText(openAIData?.error?.message, 300) ||
            `OpenAI request failed with status ${openAIResponse.status}.`,
        },
        500,
      );
    }

    const outputText =
      openAIData?.output_text ||
      openAIData?.output?.[0]?.content?.find((item: { type?: string }) => item?.type === "output_text")?.text ||
      "";

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      return jsonResponse(
        {
          error: "Assistant generation failed.",
          details: "Model returned invalid JSON.",
        },
        500,
      );
    }

    return jsonResponse(normalizeAnalysis(parsed));
  } catch (error) {
    return jsonResponse(
      {
        error: "Assistant generation failed.",
        details: error instanceof Error ? safeText(error.message, 300) : "Unexpected error.",
      },
      500,
    );
  }
});
