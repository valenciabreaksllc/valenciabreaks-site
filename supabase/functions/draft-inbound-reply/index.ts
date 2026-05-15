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
const SYSTEM_PROMPT = `You are a customer service agent for an e-commerce brand that sells trading cards and mystery boxes on TikTok Shop and through email.

Write a customer reply based on the message and triage context provided. Return ONLY the reply text — no subject line, no preamble, no explanation, no markdown.

Rules:
- Do NOT invent tracking numbers, refund approvals, replacements, or any facts not given to you.
- If you need more info from the customer to help them, ask for it clearly and specifically.
- Keep the tone friendly, direct, and human. No corporate fluff.
- Do NOT mention AI or that this is an automated reply.
- Do NOT include a subject line.
- For TikTok Shop messages: keep replies short and conversational, as if typing in a chat window.
- For email messages: use a slightly more complete support tone with a brief greeting and sign-off.
- Use any provided reply examples as tone and format guidance only — do not copy them verbatim.
- Sign off as the brand support team (e.g. "— PokeSpins Support"), not as a named agent.`;

// ── Main handler ──────────────────────────────────────────────────────────────
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
          { role: "system", content: SYSTEM_PROMPT },
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
    const draft = openaiJson.choices?.[0]?.message?.content?.trim() ?? "";

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