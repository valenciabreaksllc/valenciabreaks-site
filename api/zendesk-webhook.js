const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const INBOUND_TABLE = "work_queue";
const ZENDESK_URL_PREFIX = (subdomain, ticketId) => `https://${subdomain}.zendesk.com/agent/tickets/${ticketId}`;

const BRAND_ALIASES = [
  {
    label: "Vaulted Rarities",
    aliases: ["brand_vr", "vr", "vaulted rarities", "vaulted", "vaultedsupport", "support@vaultedrarities.com"],
  },
  {
    label: "PokeSpins",
    aliases: ["brand_ps", "ps", "pokespins", "poke spins"],
  },
  {
    label: "CardKing47",
    aliases: ["brand_ck", "ck", "cardking", "cardking47", "card king"],
  },
  {
    label: "PokieMart",
    aliases: ["brand_pm", "pm", "pokiemart", "pokie mart", "pokemart"],
  },
];

const ISSUE_RULES = [
  { label: "refund", patterns: [/refund/i] },
  { label: "return", patterns: [/return/i] },
  { label: "cancellation", patterns: [/\bcancel/i, /\bcancellation\b/i] },
  { label: "missing item", patterns: [/missing item/i, /\bmissing\b/i] },
  { label: "wrong item", patterns: [/wrong item/i] },
  { label: "damaged item", patterns: [/damaged item/i, /damaged/i] },
  { label: "delivered not received", patterns: [/delivered not received/i, /\bdnr\b/i, /not received/i] },
  { label: "tracking/no movement", patterns: [/tracking/i, /no movement/i, /no scan/i, /not moving/i] },
  { label: "replacement", patterns: [/replacement/i, /reship/i] },
  { label: "product question", patterns: [/product question/i, /question/i] },
];

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(toArray).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[,;\n]/)
      .map(item => item.trim())
      .filter(Boolean);
  }
  return [value].filter(Boolean);
}

function deepFindStrings(value, keyHints = []) {
  const out = [];
  const seen = new Set();
  const visit = (node, parentKey = "") => {
    if (!node) return;
    if (typeof node === "string") {
      const trimmed = node.trim();
      if (trimmed) out.push(trimmed);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(item => visit(item, parentKey));
      return;
    }
    if (typeof node === "object") {
      for (const [key, val] of Object.entries(node)) {
        const lowered = key.toLowerCase();
        if (keyHints.some(hint => lowered.includes(hint)) && typeof val === "string") {
          const trimmed = val.trim();
          if (trimmed && !seen.has(trimmed)) {
            seen.add(trimmed);
            out.push(trimmed);
          }
        }
        visit(val, key);
      }
    }
  };
  visit(value);
  return out;
}

function firstValue(payload, paths) {
  for (const path of paths) {
    let current = payload;
    let found = true;
    for (const segment of path) {
      if (current && typeof current === "object" && segment in current) {
        current = current[segment];
      } else {
        found = false;
        break;
      }
    }
    if (found && current != null && current !== "") return current;
  }
  return null;
}

function flattenPayload(payload) {
  const ticket = firstValue(payload, [
    ["ticket"],
    ["data", "ticket"],
    ["event", "ticket"],
    ["payload", "ticket"],
    ["ticket_data"],
  ]) || payload;
  const requester = firstValue(payload, [
    ["requester"],
    ["ticket", "requester"],
    ["data", "ticket", "requester"],
    ["ticket", "via", "source", "rel"],
  ]) || {};
  const comment = firstValue(payload, [
    ["comment"],
    ["ticket", "comment"],
    ["data", "ticket", "comment"],
    ["ticket", "latest_comment"],
    ["ticket", "description"],
  ]);

  return { ticket, requester, comment };
}

function extractTicketId(payload) {
  const ticket = firstValue(payload, [
    ["ticket"],
    ["data", "ticket"],
    ["event", "ticket"],
    ["payload", "ticket"],
    ["ticket_data"],
  ]) || payload;
  const candidates = [
    ticket?.id,
    payload?.ticket_id,
    payload?.ticketId,
    payload?.id,
    payload?.event_id,
    firstValue(payload, [["metadata", "ticket_id"]]),
  ];
  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (text) return text;
  }
  return "";
}

function extractTags(payload, ticket) {
  const tagSources = [
    ticket?.tags,
    payload?.tags,
    payload?.ticket?.tags,
    payload?.data?.ticket?.tags,
    payload?.metadata?.tags,
  ];
  const tags = [];
  for (const source of tagSources) {
    for (const tag of toArray(source)) {
      const text = normalizeText(tag);
      if (text) tags.push(text);
    }
  }
  return [...new Set(tags)];
}

function extractBrand(payload, ticket, requester) {
  const haystack = [
    ticket?.brand,
    payload?.brand,
    ticket?.recipient,
    ticket?.support_address,
    ticket?.recipient_email,
    ticket?.subject,
    ticket?.description,
    requester?.name,
    requester?.email,
    JSON.stringify(payload?.metadata || {}),
    ...extractTags(payload, ticket),
  ]
    .flatMap(value => toArray(value))
    .map(normalizeLower)
    .filter(Boolean);

  for (const config of BRAND_ALIASES) {
    if (haystack.some(text => config.aliases.some(alias => text.includes(alias)))) {
      return config.label;
    }
  }
  return "Unknown";
}

function extractIssueType(ticket, tags, subject, body) {
  const text = [subject, body, ...tags].map(normalizeLower).join(" ");
  for (const rule of ISSUE_RULES) {
    if (rule.patterns.some(pattern => pattern.test(text))) return rule.label;
  }
  return "general";
}

function extractRequester(payload, ticket) {
  const requester = firstValue(payload, [
    ["requester"],
    ["ticket", "requester"],
    ["data", "ticket", "requester"],
  ]) || {};
  return {
    name: normalizeText(requester?.name || ticket?.requester_name || ticket?.requester?.name),
    email: normalizeText(requester?.email || ticket?.requester_email || ticket?.requester?.email),
  };
}

function extractChannel(ticket, payload) {
  return normalizeText(
    ticket?.via?.channel ||
    ticket?.channel ||
    payload?.channel ||
    payload?.source ||
    payload?.via?.channel ||
    "zendesk"
  );
}

function extractStatus(ticket, payload) {
  return normalizeText(ticket?.status || payload?.status || "new");
}

function extractPriority(ticket, payload) {
  return normalizeText(ticket?.priority || payload?.priority || "");
}

function extractSubject(ticket, payload) {
  return normalizeText(ticket?.subject || payload?.subject || payload?.title || "");
}

function extractBody(ticket, payload) {
  return normalizeText(
    ticket?.description ||
    ticket?.latest_comment ||
    ticket?.comment ||
    payload?.description ||
    payload?.body ||
    payload?.latest_comment ||
    payload?.comment ||
    ""
  );
}

function extractTimestamps(ticket, payload) {
  return {
    createdAt: normalizeText(ticket?.created_at || payload?.created_at || payload?.createdAt || new Date().toISOString()),
    updatedAt: normalizeText(ticket?.updated_at || payload?.updated_at || payload?.updatedAt || new Date().toISOString()),
  };
}

function extractSupportAddress(ticket, payload) {
  return normalizeText(
    ticket?.recipient ||
    ticket?.support_address ||
    ticket?.to ||
    payload?.recipient ||
    payload?.support_address ||
    payload?.to ||
    ""
  );
}

function extractTicketUrl(ticket, payload, subdomain, ticketId) {
  return normalizeText(
    ticket?.url ||
    ticket?.html_url ||
    payload?.url ||
    payload?.html_url ||
    payload?.ticket_url ||
    payload?.ticketUrl ||
    (subdomain && ticketId ? ZENDESK_URL_PREFIX(subdomain, ticketId) : "")
  );
}

function extractMetadata(payload, ticket) {
  const meta = {
    zendesk: {
      ticket: ticket || null,
      payload: payload || null,
    },
  };
  return meta;
}

function buildQueueRow(payload, config) {
  const { ticket, requester, comment } = flattenPayload(payload);
  const ticketId = extractTicketId(payload);
  if (!ticketId) {
    return { error: "missing ticket id" };
  }

  const tags = extractTags(payload, ticket);
  const subject = extractSubject(ticket, payload);
  const body = extractBody(ticket, payload);
  const brand = extractBrand(payload, ticket, requester);
  const issueType = extractIssueType(ticket, tags, subject, body);
  const { createdAt, updatedAt } = extractTimestamps(ticket, payload);
  const supportAddress = extractSupportAddress(ticket, payload);
  const ticketUrl = extractTicketUrl(ticket, payload, config.subdomain, ticketId);
  const externalId = `zendesk:${ticketId}`;
  const source = "zendesk";
  const channel = extractChannel(ticket, payload);
  const status = extractStatus(ticket, payload);
  const priority = extractPriority(ticket, payload);
  const requesterDetails = extractRequester(payload, ticket);

  const metadata = {
    ...extractMetadata(payload, ticket),
    zendesk_ticket_id: ticketId,
    zendesk_ticket_url: ticketUrl,
    support_address: supportAddress || null,
  };

  return {
    row: {
      external_id: externalId,
      source,
      source_url: ticketUrl,
      brand,
      channel,
      subject,
      message_body: body || normalizeText(comment),
      status,
      priority,
      issue_type: issueType,
      customer_name: requesterDetails.name || null,
      sender_name: requesterDetails.name || null,
      sender_email: requesterDetails.email || null,
      tags,
      metadata,
      created_at: createdAt,
      updated_at: updatedAt,
    },
    ticketId,
    externalId,
    ticketUrl,
  };
}

function verifySecret(req) {
  const expected = normalizeText(process.env.ZENDESK_WEBHOOK_SECRET);
  if (!expected) return { ok: false, error: "missing secret" };

  const headers = req.headers || {};
  const candidates = [
    headers["x-zendesk-webhook-secret"],
    headers["x-op-zendesk-secret"],
  ]
    .filter(Boolean)
    .map(value => normalizeText(value))
    .filter(Boolean);

  const authorization = normalizeText(headers.authorization || headers.Authorization);
  if (authorization.toLowerCase().startsWith("bearer ")) {
    candidates.push(normalizeText(authorization.slice(7)));
  }

  const matched = candidates.some(candidate => {
    const a = Buffer.from(candidate);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });

  if (!matched) return { ok: false, error: "bad secret" };
  return { ok: true };
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("Invalid JSON body");
  }
}

async function upsertWorkQueue(client, row) {
  const result = await client
    .from(INBOUND_TABLE)
    .upsert([row], { onConflict: "external_id" })
    .select("*")
    .single();
  return result;
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-zendesk-webhook-secret, x-op-zendesk-secret");

  if (req.method === "OPTIONS") {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }

  const secretCheck = verifySecret(req);
  if (!secretCheck.ok) {
    return sendJson(res, 401, { ok: false, error: secretCheck.error });
  }

  const supabaseUrl = normalizeText(process.env.SUPABASE_URL);
  const serviceRoleKey = normalizeText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const zendeskSubdomain = normalizeText(process.env.ZENDESK_SUBDOMAIN);

  if (!supabaseUrl || !serviceRoleKey || !zendeskSubdomain) {
    return sendJson(res, 500, {
      ok: false,
      error: "Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or ZENDESK_SUBDOMAIN",
    });
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message || "Invalid request body" });
  }

  const built = buildQueueRow(payload, { subdomain: zendeskSubdomain });
  if (built.error) {
    return sendJson(res, 400, { ok: false, error: built.error });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    const { data, error } = await upsertWorkQueue(supabase, built.row);

    if (error) {
      return sendJson(res, 500, {
        ok: false,
        error: `Supabase insert/upsert failure: ${error.message}`,
      });
    }

    return sendJson(res, 200, {
      ok: true,
      source: "zendesk",
      ticket_id: built.ticketId,
      external_id: built.externalId,
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error.message || "Supabase insert/upsert failure",
    });
  }
}

module.exports = handler;
