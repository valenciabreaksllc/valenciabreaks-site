// supabase/functions/draft-inbound-reply/index.ts
// Deploy: supabase functions deploy draft-inbound-reply
// Secrets: OPENAI_API_KEY must be set via: supabase secrets set OPENAI_API_KEY=sk-...

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── CORS ──────────────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── TikTok body cleaner (mirrors App.jsx logic, server-side) ──────────────────
// Extracts only the new-message section, strips junk lines.
const HISTORY_BOUNDARIES = [
  /^reply in chat\s*$/i,
  /^you can also respond by directly replying to this email/i,
  /^if you think this message doesn't need a response/i,
  /^your previous chat with\b/i,
];
const NEW_MSG_START = /^you have received new messages from\s*:?\s*$/i;
const TIMESTAMP_RE = /^\d{1,2}:\d{2}\s*(AM|PM),?\s+\w+\.?\s+\d{1,2}$/i;

function isTikTokChannel(channel: string | null, subject: string | null): boolean {
  return channel === "TikTok Shop" ||
    (subject || "").toLowerCase().includes("a new message from tiktok shop customer");
}

function extractCustomerName(subject: string | null): string | null {
  const m = (subject || "").match(/tiktok shop customer\s+(\S+)/i);
  return m ? m[1].trim() : null;
}

function cleanTikTokBody(raw: string, username: string | null): string {
  if (!raw) return "";
  const lines = raw.split(/\r?\n/).map(l => l.trim());

  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (NEW_MSG_START.test(lines[i])) { start = i + 1; break; }
  }

  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (HISTORY_BOUNDARIES.some(re => re.test(lines[i]))) { end = i; break; }
  }

  return lines
    .slice(start, end)
    .filter(line => {
      if (!line) return false;
      if (username && line.toLowerCase() === username.toLowerCase()) return false;
      if (/^\d+$/.test(line)) return false;
      if (/^[|/\\–—\-=*~`]+$/.test(line)) return false;
      if (TIMESTAMP_RE.test(line)) return false;
      if (/note:\s*the information seen in this email is snapshot data/i.test(line)) return false;
      if (/^https?:\/\/\S+$/i.test(line)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

// ── Instruction modifiers ─────────────────────────────────────────────────────
const INSTRUCTION_PROMPTS: Record<string, string> = {
  redraft:       "Rewrite the reply completely. Keep the same intent but use different phrasing.",
  make_shorter:  "Rewrite the reply to be significantly shorter. Keep only what is essential.",
  make_warmer:   "Rewrite the reply with a warmer, more empathetic tone. Sound more human and caring.",
  make_firmer:   "Rewrite the reply with a firmer, clearer tone. Be direct and professional.",
};

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You write customer replies for Jonny Valencia's internal Ops Command Hub. The brands sell trading cards and mystery boxes on TikTok Shop and through email.

Write a customer reply based on the message and triage context provided. Return ONLY the reply text — no subject line, no preamble, no explanation, no markdown.

Rules:
- Sound like Jonny: short, friendly, direct, action-first, and human.
- Always use "Hello" instead of "Hey".
- Never start with "Hey".
- Usually write 1 to 3 short sentences.
- Do NOT use corporate support language.
- Do NOT say "we sincerely apologize" or "thank you for your patience and understanding".
- Do NOT say "what's up with".
- Do NOT say "I'll get back to you shortly".
- Do NOT invent tracking numbers, refund approvals, return approvals, cancellations, credits, replacements, reships, or any facts not given to you.
- Do NOT promise an outcome, refund, return, replacement, cancellation, credit, reship, or delivery date.
- If a message involves refunds, returns, replacements, chargebacks, delivered-not-received, missing items, wrong items, damaged items, missing evidence, or unclear order details, use cautious review language only.
- If you need more info from the customer to help them, ask for it clearly and specifically.
- Ask only for what is needed, such as order number, photo, or what arrived.
- Do NOT mention AI or that this is an automated reply.
- Do NOT include a subject line.
- For TikTok Shop messages: keep replies short and conversational, as if typing in a chat window.
- For email messages: keep it concise and friendly. A sign-off is optional.
- Use any provided reply examples as tone and format guidance only, do not copy them verbatim.
- Do not sign as a generic support team unless the existing approved examples clearly do that.`;

const SUPPORT_PLAYBOOK_PROMPT = `You write customer service drafts for Jonny Valencia's Ops Command Hub. The brands sell trading cards, mystery boxes, and surprise sets on TikTok Shop and through email.

Return ONLY the customer-facing reply text. No subject line, no preamble, no explanation, no markdown.

Voice rules:
- Always start with "Hello, thanks for reaching out" or "Hello, thank you for reaching out" unless it is a final close or chatbot/admin note.
- Always use "Hello". Never use "Hey".
- Write exactly one paragraph.
- Use no em dashes.
- Professional, calm, slightly empathetic, direct, and action-focused.
- Do not sound overly casual.
- Do not over-apologize.
- Do not say "what's up with".
- Do not say "I'll get back to you shortly".
- Do not use corporate filler unless the support policy requires a short patience or understanding line.
- Usually write 1 to 3 short sentences.

Policy rules:
- Never approve refunds, returns, replacements, credits, reships, cancellations, or free product automatically.
- Default to investigation first, resolution second.
- Do not admit fault unless clearly confirmed in the provided context.
- Do not give away product unless the context says a verified mistake, manager approval, VIP exception, or replacement approval already exists.
- For light goodwill, prefer discount-code language over free product.
- If an issue needs photos, order details, tracking verification, carrier confirmation, or internal review, ask for that next step and do not promise the final outcome.

Macro behavior:
- Tracking not updated or package taking too long: explain that high order volume can require 1 to 2 business days for processing and USPS may take another 1 to 2 business days for the initial scan. Mention TikTok automated messages only if the customer mentions TikTok messages.
- Delivered but not received: state that tracking shows delivered. Recommend checking the delivery area, neighbors, leasing office or mail room, parcel lockers, and contacting the local post office for the GPS delivery scan. If still missing, ask the customer to confirm non-receipt before opening a USPS missing package claim.
- Missing items, damaged items, or wrong contents: ask for photos of the package, packing slip, and all contents received. Say we will review and investigate. Do not immediately promise replacement.
- Damaged in transit: be slightly empathetic, position it as possibly carrier handling or transit related, and ask for photos. Do not blame the business unless confirmed.
- Surprise set accidental bid or refund: state that due to TikTok guidelines, all sales on surprise sets are final. Direct the customer to TikTok support if needed. Do not offer a refund or cancellation.
- Label created or already shipped refund: if a label has already been created or the item has shipped, do not promise cancellation. Use TikTok policy language and an investigation or platform-support path.
- Replacement shipped: give tracking only if provided in the context and mention USPS may take time to scan.
- Missing package claim: ask the customer to confirm non-receipt of the package marked delivered at the given date and time. Once confirmed, say we will proceed with a USPS missing package claim.
- Marketing or chatbot spam: keep it short. If relevant, explain they can disable marketing messages from the three dots or top-right menu.
- End conversation or final close: use calm final language and do not continue debating once all available information has been provided.

Style guides:
- Missing order number: ask for the order number so the order can be reviewed.
- Missing, damaged, or wrong contents: ask for photos of the package, packing slip, and all contents received.
- Delivered but not received: explain carrier delivery status and direct them to check nearby delivery locations and the local post office.
- Surprise set refund: cite TikTok guidelines, final sale policy, and TikTok support path.`;

// ── Main handler ──────────────────────────────────────────────────────────────
const JONNY_STYLE_OVERRIDE = `Final style override:
- Match Jonny's saved support macros: calm, professional, concise, and investigation-first.
- Start with Hello, never Hey.
- Keep the reply one paragraph.
- Use no em dashes.
- Do not promise refunds, returns, replacements, cancellations, credits, reships, tracking, or delivery outcomes.
- Do not sign as a generic support team unless an approved example clearly does that.
- Avoid long apologies, casual slang, and filler.
- For shipping questions with an order number, use this style: Hello, thanks for reaching out. I can check this for you. I'll take a look at order 12345 and see where the shipping is at.
- For missing order numbers, use this style: Hello, thanks for reaching out. Can you send over your order number so I can check this for you?`;

function polishJonnyDraft(value: string): string {
  let draft = (value || "").trim();
  draft = draft.replace(/[\r\n]+/g, " ");
  draft = draft.replace(/\s{2,}/g, " ");
  draft = draft.replace(/[—–]/g, "-");
  draft = draft.replace(/^hey[!,.]?\s*/i, "Hello, ");
  draft = draft.replace(/^hi[!,.]?\s*/i, "Hello, ");
  if (draft && !/^hello\b/i.test(draft) && !/^thank you\b/i.test(draft)) {
    draft = `Hello, thanks for reaching out. ${draft}`;
  }
  draft = draft.replace(/\bwhat'?s up with\b/gi, "where things are at with");
  draft = draft.replace(/\s*I['’]ll get back to you shortly[.!]?/gi, "");
  draft = draft.replace(/\s*I will get back to you shortly[.!]?/gi, "");
  draft = draft.replace(/\bwe sincerely apologize\b/gi, "we apologize");
  draft = draft.replace(/\bthank you for your patience and understanding\b/gi, "thank you for your understanding");
  return draft.trim();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const { message_id, instruction } = await req.json();
    if (!message_id) {
      return new Response(JSON.stringify({ error: "message_id is required" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── Supabase client ───────────────────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Fetch inbound message ─────────────────────────────────────────────────
    const { data: msg, error: fetchErr } = await supabase
      .from("inbound_messages")
      .select("*")
      .eq("id", message_id)
      .single();

    if (fetchErr || !msg) {
      return new Response(
        JSON.stringify({ error: fetchErr?.message || "Message not found" }),
        { status: 404, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // ── Fetch up to 5 reply examples (same brand + issue_type) ───────────────
    const { data: examples } = await supabase
      .from("reply_examples")
      .select("customer_message, approved_reply, tone_notes")
      .eq("brand", msg.brand)
      .eq("issue_type", msg.issue_type)
      .order("created_at", { ascending: false })
      .limit(5);

    // ── Build cleaned customer message ────────────────────────────────────────
    const isTikTok    = isTikTokChannel(msg.channel, msg.subject);
    const customerName = extractCustomerName(msg.subject);
    const cleanedBody = isTikTok
      ? cleanTikTokBody(msg.message_body, customerName)
      : (msg.message_body || "");

    // ── Compose user prompt ───────────────────────────────────────────────────
    const contextLines: string[] = [
      `Brand: ${msg.brand || "Unknown"}`,
      `Channel: ${msg.channel || "Unknown"}`,
      `Customer: ${customerName || msg.customer_name || msg.sender_name || "Unknown"}`,
    ];

    if (msg.issue_type)       contextLines.push(`Issue type: ${msg.issue_type}`);
    if (msg.triage_summary)   contextLines.push(`Triage summary: ${msg.triage_summary}`);
    if (msg.customer_intent)  contextLines.push(`Customer intent: ${msg.customer_intent}`);
    if (msg.risk_level)       contextLines.push(`Risk level: ${msg.risk_level}`);
    if (msg.tone_notes)       contextLines.push(`Tone notes: ${msg.tone_notes}`);

    contextLines.push(`\nCustomer message:\n${cleanedBody || "(no message body)"}`);

    if (examples && examples.length > 0) {
      const exampleBlock = examples
        .map((ex, i) =>
          `Example ${i + 1}:\nCustomer: ${ex.customer_message || ""}\nReply: ${ex.approved_reply || ""}`
        )
        .join("\n\n");
      contextLines.push(`\nPrevious approved replies for reference (tone/format only):\n${exampleBlock}`);
    }

    if (msg.ai_draft && instruction && INSTRUCTION_PROMPTS[instruction]) {
      contextLines.push(`\nCurrent draft:\n${msg.ai_draft}`);
      contextLines.push(`\nInstruction: ${INSTRUCTION_PROMPTS[instruction]}`);
    }

    const userPrompt = contextLines.join("\n");

    // ── Call OpenAI ───────────────────────────────────────────────────────────
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY secret is not set in Supabase." }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
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
        temperature: 0.4,
        max_tokens: 500,
        messages: [
          { role: "system", content: SUPPORT_PLAYBOOK_PROMPT },
          { role: "system", content: JONNY_STYLE_OVERRIDE },
          { role: "user",   content: userPrompt },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      return new Response(
        JSON.stringify({ error: `OpenAI error ${openaiRes.status}: ${errText}` }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const openaiJson = await openaiRes.json();
    const draft = polishJonnyDraft(openaiJson.choices?.[0]?.message?.content?.trim() ?? "");

    if (!draft) {
      return new Response(
        JSON.stringify({ error: "OpenAI returned an empty reply." }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // ── Save draft back to inbound_messages ───────────────────────────────────
    const now = new Date().toISOString();
    const { data: updated, error: updateErr } = await supabase
      .from("inbound_messages")
      .update({ ai_draft: draft, draft_status: "Draft Ready", updated_at: now })
      .eq("id", message_id)
      .select("*")
      .single();

    if (updateErr) {
      return new Response(
        JSON.stringify({ error: `DB update failed: ${updateErr.message}` }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ message: updated }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unexpected error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
