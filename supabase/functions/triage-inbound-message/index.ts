// supabase/functions/triage-inbound-message/index.ts
// Deploy: supabase functions deploy triage-inbound-message
// Secret:  supabase secrets set OPENAI_API_KEY=sk-...

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Types ─────────────────────────────────────────────────────────────────────
interface TriageResult {
  issue_type: string;
  priority: "High" | "Medium" | "Low";
  customer_intent: string;
  risk_level: string;
  triage_summary: string;
  next_action: string;
  recommended_reply_type: string;
  needs_human_review: boolean;
  confidence_score: number;
}

// ── CORS headers ──────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const INBOUND_MESSAGES_TABLE = "work_queue";

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a customer support triage assistant for an e-commerce company that sells trading cards and mystery boxes on TikTok Shop, Instagram, and email.

Classify inbound messages and return ONLY a valid JSON object — no markdown, no explanation, no extra keys.

Required JSON shape:
{
  "issue_type": string,
  "priority": "High" | "Medium" | "Low",
  "customer_intent": string,
  "risk_level": string,
  "triage_summary": string,
  "next_action": string,
  "recommended_reply_type": string,
  "needs_human_review": boolean,
  "confidence_score": number
}

Classification rules:
- Marketing emails, Facebook admin notifications, app notifications, promo blasts, chatbot/admin spam, repeated automated prompts, Loox review requests, Shopify app emails, DHL/carrier receipts, or any non-customer message:
  issue_type = "Noise / Not CS", priority = "Low", risk_level = "Normal", recommended_reply_type = "archive_noise", needs_human_review = false

- Customer reports delivered but not received:
  issue_type = "Missing Package", priority = "High", risk_level = "Refund Risk", needs_human_review = true

- Customer reports item missing from order:
  issue_type = "Missing Item", priority = "High", risk_level = "Replacement Needed", needs_human_review = true

- Customer received wrong item:
  issue_type = "Wrong Item", priority = "High", risk_level = "Replacement Needed", needs_human_review = true

- Customer requests refund:
  issue_type = "Refund Request", priority = "High", risk_level = "SLA Risk", needs_human_review = true

- Customer requests return:
  issue_type = "Return Request", priority = "High", risk_level = "SLA Risk", needs_human_review = true

- Customer asks to cancel, refund, reverse, or undo a surprise set, randomized order, accidental bid, or live opening purchase:
  issue_type = "Surprise Set Policy", priority = "High", risk_level = "TikTok Policy", recommended_reply_type = "surprise_set_final_sale", needs_human_review = true

- Customer asks for free product, compensation, credit, discount, refund, replacement, or reship as a resolution:
  priority = "High", risk_level = "Compensation Review", needs_human_review = true

- Customer asks for refund or cancellation after label created, tracking provided, or item shipped:
  issue_type = "Refund Request", priority = "High", risk_level = "TikTok Policy", recommended_reply_type = "label_created_policy", needs_human_review = true

- Customer mentions chargeback, dispute, scam, fraud, legal threat, or angry escalation:
  issue_type = "Escalated Customer", priority = "High", risk_level = "Customer Escalation", needs_human_review = true

- Customer needs a replacement, reship, refund, return, cancellation, or credit approval:
  priority = "High", needs_human_review = true

- Customer reports missing item, wrong item, damaged item, or delivered-not-received without enough order details or photo/evidence:
  priority = "High", risk_level = "Needs Investigation", needs_human_review = true

- Message is unclear, missing the order number needed to act, or confidence is low:
  priority = "Medium", risk_level = "Needs Investigation", needs_human_review = true

- Normal customer reply, thank you, follow-up, or general question:
  issue_type = "Customer Follow-Up", priority = "Medium", risk_level = "Normal", needs_human_review = false

Field constraints:
- triage_summary: plain sentence, under 25 words, describes the customer situation
- next_action: direct internal instruction for the CS agent, e.g. "Check order status and respond with tracking update."
- customer_intent: short phrase, e.g. "Track missing package", "Request refund", "Follow up on order"
- confidence_score: integer 0-100 representing classification confidence`;

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    // ── Parse body ────────────────────────────────────────────────────────────
    const { message_id } = await req.json();
    if (!message_id) {
      return new Response(JSON.stringify({ error: "message_id is required" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── Supabase client (service role — can write back) ───────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Fetch the work_queue row ──────────────────────────────────────────────
    const { data: msg, error: fetchError } = await supabase
      .from(INBOUND_MESSAGES_TABLE)
      .select("id, brand, channel, label, sender_name, sender_email, subject, message_body, customer_name")
      .eq("id", message_id)
      .single();

    if (fetchError || !msg) {
      return new Response(
        JSON.stringify({ error: fetchError?.message || "Message not found" }),
        { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ── Build user prompt ─────────────────────────────────────────────────────
    const userPrompt = [
      `Brand: ${msg.brand || "Unknown"}`,
      `Channel: ${msg.channel || "Unknown"}`,
      `Label: ${msg.label || "None"}`,
      `Sender: ${msg.sender_name || msg.customer_name || "Unknown"}${msg.sender_email ? ` <${msg.sender_email}>` : ""}`,
      `Subject: ${msg.subject || "(no subject)"}`,
      `Message:\n${msg.message_body || "(empty)"}`,
    ].join("\n");

    // ── Call OpenAI ───────────────────────────────────────────────────────────
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY secret is not set in Supabase." }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 400,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: userPrompt   },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      return new Response(
        JSON.stringify({ error: `OpenAI error ${openaiRes.status}: ${errText}` }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const openaiJson = await openaiRes.json();
    const raw = openaiJson.choices?.[0]?.message?.content?.trim() ?? "";

    // ── Parse triage JSON ─────────────────────────────────────────────────────
    let triage: TriageResult;
    try {
      // Strip accidental markdown fences if the model adds them
      const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      triage = JSON.parse(clean);
    } catch {
      return new Response(
        JSON.stringify({ error: "OpenAI returned non-JSON output.", raw }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ── Write triage results back to Supabase ─────────────────────────────────
    const now = new Date().toISOString();
    const normalizedRisk = String(triage.risk_level || "").toLowerCase();
    const triageStatus = triage.needs_human_review
      ? (normalizedRisk.includes("investigation") || normalizedRisk.includes("unclear") ? "Needs Investigation" : "Needs Human Review")
      : "Triaged";
    const updatePayload = {
      issue_type:             triage.issue_type             ?? null,
      priority:               triage.priority               ?? null,
      customer_intent:        triage.customer_intent        ?? null,
      risk_level:             triage.risk_level             ?? null,
      triage_summary:         triage.triage_summary         ?? null,
      next_action:            triage.next_action            ?? null,
      recommended_reply_type: triage.recommended_reply_type ?? null,
      needs_human_review:     triage.needs_human_review     ?? false,
      confidence_score:       triage.confidence_score       ?? null,
      triage_status:          triageStatus,
      triaged_at:             now,
      updated_at:             now,
    };

    const { data: updated, error: updateError } = await supabase
      .from(INBOUND_MESSAGES_TABLE)
      .update(updatePayload)
      .eq("id", message_id)
      .select("*")
      .single();

    if (updateError) {
      return new Response(
        JSON.stringify({ error: `DB update failed: ${updateError.message}` }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ── Return updated row ────────────────────────────────────────────────────
    return new Response(
      JSON.stringify({ message: updated }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unexpected error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
