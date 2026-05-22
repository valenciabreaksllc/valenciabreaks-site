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

type SupportPlaybookEntry = {
  name: string;
  shortcut: string;
  category: string;
  tag: string;
  stage: string;
  trigger: string;
  requiresProof: boolean;
  requiresReview: boolean;
  finalAction: string;
  internalNotes: string;
  response: string;
};

const SUPPORT_PLAYBOOK: SupportPlaybookEntry[] = [
  {
    name: "Package Taking Too Long / No Scan",
    shortcut: "/noscan1",
    category: "Shipping",
    tag: "NO_SCAN",
    stage: "Stage 1",
    trigger: "Tracking only shows label created or no scan yet.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Close",
    internalNotes: "Use when internal system shows package handed to USPS or ready for pickup. No refund.",
    response: "Hello, thanks for reaching out. According to our internal systems, your package has been picked up by USPS and is currently awaiting its initial scan. Tracking updates may take some time to appear, and USPS may take 1 to 3 business days to apply the first scan. Please let us know if you have any other questions.",
  },
  {
    name: "In Transit Delay",
    shortcut: "/transit1",
    category: "Shipping",
    tag: "SHIPPING_DELAY",
    stage: "Stage 1",
    trigger: "Package is taking too long but tracking shows in transit.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Close",
    internalNotes: "Use when tracking is moving or still within expected delivery window.",
    response: "Hello, thanks for reaching out. According to the tracking information, your package is currently in transit with the carrier. Shipping updates can sometimes take time to appear between scans. We appreciate your patience and understanding.",
  },
  {
    name: "Signature Required",
    shortcut: "/sig1",
    category: "Shipping",
    tag: "SIGNATURE_REQUIRED",
    stage: "Stage 1",
    trigger: "Customer receives notice that signature is required or delivery attempt failed.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Wait on customer",
    internalNotes: "Use for high-value orders. USPS still has package. No refund.",
    response: "Hello, thank you for reaching out. Since this is a high-value order, a signature is required for delivery. We recommend contacting your local post office to arrange redelivery or pick up the package directly. Please note that if the package is not claimed, it may be returned to the sender.",
  },
  {
    name: "Returned Package",
    shortcut: "/return1",
    category: "Shipping",
    tag: "RETURNED_PACKAGE",
    stage: "Stage 1",
    trigger: "Customer thinks a package is being returned or marked return to sender.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Investigate",
    internalNotes: "Use when waiting for returned parcel to physically arrive.",
    response: "Hello, thanks for following up. We will keep an eye out for any returned packages associated with your order and will contact you as soon as we receive them or have an update.",
  },
  {
    name: "Internal Review / Stall",
    shortcut: "/admin2",
    category: "Admin",
    tag: "ADMIN",
    stage: "Stage 1",
    trigger: "Need time to investigate without promising resolution yet.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Investigate",
    internalNotes: "Standard holding response.",
    response: "Hello, thank you for providing that information. We are currently looking into this matter for you and reviewing everything on our end. Please allow some time for us to provide an update.",
  },
  {
    name: "Order Number Request",
    shortcut: "/admin5",
    category: "Admin",
    tag: "ADMIN",
    stage: "Stage 1",
    trigger: "Customer is asking about an order without enough order information.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Wait on customer",
    internalNotes: "Ask customer for order number.",
    response: "Hello, thanks for reaching out. Could you please share the order number you are referring to?",
  },
  {
    name: "Soft Close",
    shortcut: "/admin3",
    category: "Admin",
    tag: "ADMIN",
    stage: "Stage 3",
    trigger: "Issue resolved or no further action needed.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Close",
    internalNotes: "Friendly close.",
    response: "Of course. If you have any other questions or concerns, please let us know.",
  },
  {
    name: "Final Close",
    shortcut: "/admin4",
    category: "Admin",
    tag: "ADMIN",
    stage: "Stage 3",
    trigger: "Customer is repetitive, hostile, or circular with no new information.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Close",
    internalNotes: "Use to disengage. No debate.",
    response: "Hello, we understand your concerns and appreciate you sharing this information. At this time, we have provided all available details regarding your order and its status. Any further updates or refund decisions should be handled directly through TikTok.",
  },
  {
    name: "Missing Items Request Photos",
    shortcut: "/missing1",
    category: "Order Issue",
    tag: "MISSING_ITEMS",
    stage: "Stage 1",
    trigger: "Customer says package arrived but items, packs, bags, or boxes are missing.",
    requiresProof: true,
    requiresReview: false,
    finalAction: "Wait on customer",
    internalNotes: "Default response. Ask for package, packing slip, and all contents.",
    response: "Hello, thanks for reaching out. Could you please send us photos of the package, the packing slip, and all of the contents you received? Once we have those images, we will review everything and investigate the situation right away.",
  },
  {
    name: "Missing Items Under Review",
    shortcut: "/missing3",
    category: "Order Issue",
    tag: "MISSING_ITEMS",
    stage: "Stage 2",
    trigger: "Customer already sent missing item photos or proof.",
    requiresProof: false,
    requiresReview: true,
    finalAction: "Investigate",
    internalNotes: "Use while reviewing photos and order details.",
    response: "Hello, thank you for providing those images. We are currently reviewing everything on our end and investigating the situation. Please allow some time for us to provide an update.",
  },
  {
    name: "Missing Items Replacement Approved",
    shortcut: "/missing4",
    category: "Order Issue",
    tag: "MISSING_ITEMS",
    stage: "Stage 3",
    trigger: "Internal review confirms missing items should be replaced.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Replace",
    internalNotes: "Use only when mistake confirmed or approved exception.",
    response: "Hello, thank you for your patience. After further review, we will be shipping out the following replacement: [item]. Please allow some time for tracking updates once it has been sent.",
  },
  {
    name: "Wrong Item",
    shortcut: "/wrong2",
    category: "Order Issue",
    tag: "WRONG_ITEM",
    stage: "Stage 2",
    trigger: "Customer received the wrong item or wrong product.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Wait on customer",
    internalNotes: "Collect email for return label if exchange is needed.",
    response: "Hello, thanks for reaching out. Could you please provide your current email address so we can send over your return label?",
  },
  {
    name: "Opened Instead of Sealed",
    shortcut: "/sealed1",
    category: "Order Issue",
    tag: "SEALED_VS_OPENED",
    stage: "Stage 1",
    trigger: "Customer says they wanted the item sealed but it was opened live.",
    requiresProof: false,
    requiresReview: true,
    finalAction: "Investigate",
    internalNotes: "Review footage before deciding.",
    response: "Hello, thank you for providing that information. We are currently looking into this matter for you and reviewing everything on our end. Please allow some time for us to provide an update.",
  },
  {
    name: "Surprise Set Refund",
    shortcut: "/ssrefund1",
    category: "Refund",
    tag: "SURPRISE_SET",
    stage: "Stage 1",
    trigger: "Customer wants cancellation or refund for surprise set, randomized order, accidental bid, or live opening.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Direct to TikTok",
    internalNotes: "Use default policy response. Keep concise. Do not debate.",
    response: "Hello, thanks for reaching out. Unfortunately, due to TikTok guidelines, all sales on surprise sets are final in accordance with TikTok policy. Please contact TikTok directly for any further assistance.",
  },
  {
    name: "Refund Label Created",
    shortcut: "/refund1",
    category: "Refund",
    tag: "REFUND_REQUEST",
    stage: "Stage 1",
    trigger: "Customer asks for refund but shipping label already created and item not ripped.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Wait on customer",
    internalNotes: "Use only for this specific workflow. Do not use on surprise sets already opened.",
    response: "Hello, thanks for reaching out. Once a shipping label has been created, we are unable to process a refund at this stage. Once the package arrives, please submit the refund request through TikTok and we will review it promptly.",
  },
  {
    name: "Return Already Shipped",
    shortcut: "/refund2",
    category: "Refund",
    tag: "REFUND_REQUEST",
    stage: "Stage 1",
    trigger: "Customer wants return but item already shipped and should remain sealed and unused.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Wait on customer",
    internalNotes: "Return path only if sealed and unused after arrival.",
    response: "Hello, we understand your concern. Once the product arrives, if it is still sealed and unused, you can submit a return request through TikTok and we will review it through that process.",
  },
  {
    name: "Delivered But Not Received",
    shortcut: "/delivered1",
    category: "Missing Package",
    tag: "DELIVERED_NOT_RECEIVED",
    stage: "Stage 1",
    trigger: "Tracking shows delivered but customer says package was never received.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Wait on customer",
    internalNotes: "Ask customer to check area, neighbors, leasing office, parcel locker, and post office GPS scan. No replacement now.",
    response: "Hello, thanks for reaching out. According to the tracking information, the package was marked as delivered by the carrier. We recommend checking around the delivery area, with neighbors, or with your leasing office or mail room in case it was placed in a parcel locker or held there. You can also contact your local post office with your tracking number, as they can verify the GPS delivery scan and confirm where it was left.",
  },
  {
    name: "Missing Package Claim",
    shortcut: "/delivered3",
    category: "Missing Package",
    tag: "DELIVERED_NOT_RECEIVED",
    stage: "Stage 3",
    trigger: "Customer confirms non receipt after checking delivery area.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Investigate",
    internalNotes: "Open claim. Do not promise replacement or refund yet.",
    response: "Hello, thank you for confirming. We will proceed with opening a USPS missing package claim regarding the delivery. Once we receive an update, we will follow up with you to discuss the next steps.",
  },
  {
    name: "Pushes For Refund",
    shortcut: "/delivered5",
    category: "Missing Package",
    tag: "DELIVERED_NOT_RECEIVED",
    stage: "Stage 3",
    trigger: "Customer demands immediate replacement or refund before claim result.",
    requiresProof: false,
    requiresReview: true,
    finalAction: "Close",
    internalNotes: "Hold line. Keep claim path.",
    response: "Hello, thank you for reaching out. Since the package is marked as delivered by the carrier, we are unable to issue a replacement or refund at this stage. We are continuing to review the matter through the carrier claim process and will follow up once we have an update.",
  },
  {
    name: "Damage Request Photos",
    shortcut: "/damage1",
    category: "Damage",
    tag: "DAMAGE",
    stage: "Stage 1",
    trigger: "Customer says package or product arrived damaged, crushed, bent, or broken.",
    requiresProof: true,
    requiresReview: false,
    finalAction: "Wait on customer",
    internalNotes: "Request photos first. Do not take fault.",
    response: "Hello, thanks for reaching out. Please send us photos of the package and the damaged item so we can review everything on our end and determine the best next step.",
  },
  {
    name: "Damage Transit Likely",
    shortcut: "/damage2",
    category: "Damage",
    tag: "DAMAGE",
    stage: "Stage 2",
    trigger: "Customer provided photos and damage appears transit related.",
    requiresProof: false,
    requiresReview: true,
    finalAction: "Investigate",
    internalNotes: "Position as carrier-related. Review before replacing.",
    response: "Hello, thank you for providing the photos. Based on the information provided, this appears to have occurred during transit with the carrier. We are currently reviewing this on our end and will determine the best next step.",
  },
  {
    name: "Damage Goodwill Replacement",
    shortcut: "/damage3",
    category: "Damage",
    tag: "DAMAGE",
    stage: "Stage 3",
    trigger: "Approved replacement as goodwill for transit damage.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Replace",
    internalNotes: "Use when replacing even though carrier likely caused issue.",
    response: "Hello, thanks for reaching out. While this appears to be related to handling during transit with USPS, as a gesture of goodwill we will be sending you a replacement [product]. Please let us know if you have any other questions.",
  },
  {
    name: "Manufacturing Issue",
    shortcut: "/damage4",
    category: "Damage",
    tag: "DAMAGE",
    stage: "Stage 3",
    trigger: "Issue appears manufacturing-related and no replacement approved.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Close",
    internalNotes: "Use when sourced directly from distributor and not shop-caused.",
    response: "Hello, we appreciate you bringing this to our attention. Unfortunately, we are unable to make any changes or replacements as this appears to be a manufacturing issue.",
  },
  {
    name: "Giveaway Winner Request Address",
    shortcut: "/give1",
    category: "Giveaway",
    tag: "GIVEAWAY",
    stage: "Stage 1",
    trigger: "Customer says they won giveaway and asks how to claim.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Wait on customer",
    internalNotes: "Basic giveaway intake.",
    response: "Hello, thanks for reaching out and congratulations on winning the giveaway. Please provide your shipping address, and we will get that shipped out shortly.",
  },
  {
    name: "Giveaway Choose Prize",
    shortcut: "/give2",
    category: "Giveaway",
    tag: "GIVEAWAY",
    stage: "Stage 2",
    trigger: "Customer provided address and needs to pick prize type.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Wait on customer",
    internalNotes: "Use if prize requires choice.",
    response: "Thank you for providing your address. Could you please confirm whether you would prefer the MTG Premium Pack or the Pokemon Premium Pack for your giveaway prize?",
  },
  {
    name: "Giveaway Tracking Sent",
    shortcut: "/give3",
    category: "Giveaway",
    tag: "GIVEAWAY",
    stage: "Stage 3",
    trigger: "Prize shipped with tracking.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Close",
    internalNotes: "Send once prize ships.",
    response: "Hello, thanks for confirming. Here is your tracking number: [tracking]. Please allow some time for tracking updates, as USPS may take a bit to scan packages. Congratulations again on winning the giveaway.",
  },
  {
    name: "Discount Code",
    shortcut: "/goodwill1",
    category: "Goodwill",
    tag: "GOODWILL",
    stage: "Stage 3",
    trigger: "Minor dissatisfaction where approved to offer baseline goodwill.",
    requiresProof: false,
    requiresReview: false,
    finalAction: "Close",
    internalNotes: "Default goodwill only. Do not offer product unless clear mistake or VIP.",
    response: "Hello, thank you for reaching out. While we are unable to offer a refund or replacement in this case, we would like to offer a small gesture of goodwill. You are welcome to use the code [DISCOUNT] for 10% off a future order.",
  },
  {
    name: "VIP Recovery",
    shortcut: "/goodwill2",
    category: "Goodwill",
    tag: "VIP",
    stage: "Stage 3",
    trigger: "Known high spender or strong repeat customer with approved exception.",
    requiresProof: false,
    requiresReview: true,
    finalAction: "Close",
    internalNotes: "Use sparingly for valuable customers. Product goodwill only if approved.",
    response: "Hello, thank you for reaching out. We appreciate your continued support. While we are unable to offer a full refund or replacement in this case, we would like to offer a small gesture of goodwill. Please let us know if you have any other questions.",
  },
];

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

const messageText = (message: InboundMessage) =>
  [
    message.external_id,
    message.brand,
    message.source,
    message.channel,
    message.label,
    message.sender_name,
    message.sender_email,
    message.subject,
    message.message_body,
    message.priority,
    message.status,
    message.message_type,
  ].map((value) => safeText(value, 6000).toLowerCase()).join(" ");

const hasAny = (text: string, terms: string[]) => terms.some((term) => text.includes(term));

const addScore = (scores: Map<string, number>, shortcut: string, amount: number) => {
  scores.set(shortcut, (scores.get(shortcut) || 0) + amount);
};

const selectPlaybookCandidates = (message: InboundMessage) => {
  const text = messageText(message);
  const scores = new Map<string, number>();

  const scoreCategory = (category: string, amount: number) => {
    SUPPORT_PLAYBOOK.filter((entry) => entry.category === category)
      .forEach((entry) => addScore(scores, entry.shortcut, amount));
  };
  const scoreTag = (tag: string, amount: number) => {
    SUPPORT_PLAYBOOK.filter((entry) => entry.tag === tag)
      .forEach((entry) => addScore(scores, entry.shortcut, amount));
  };
  const scoreShortcut = (shortcut: string, amount: number) => addScore(scores, shortcut, amount);

  if (hasAny(text, ["tracking", "label created", "no scan", "initial scan", "awaiting scan", "preshipment", "pre-shipment"])) {
    scoreShortcut("/noscan1", 8);
  }
  if (hasAny(text, ["in transit", "delayed", "delay", "taking too long", "late", "stuck", "hasn't moved", "has not moved"])) {
    scoreShortcut("/transit1", 8);
  }
  if (hasAny(text, ["signature", "delivery attempt", "authorized recipient", "redelivery", "pick up", "pickup", "post office"])) {
    scoreShortcut("/sig1", 8);
  }
  if (hasAny(text, ["return to sender", "returned package", "being returned", "returned to sender", "returning to sender"])) {
    scoreShortcut("/return1", 8);
  }
  if (hasAny(text, ["missing item", "missing pack", "missing bag", "missing box", "missing card", "missing items", "not in the package"])) {
    scoreTag("MISSING_ITEMS", 8);
    scoreShortcut("/missing1", 4);
  }
  if (hasAny(text, ["wrong item", "wrong product", "sent wrong", "incorrect item", "incorrect product"])) {
    scoreTag("WRONG_ITEM", 8);
  }
  if (hasAny(text, ["sealed", "opened", "ripped live", "opened live", "wanted sealed", "ship sealed"])) {
    scoreTag("SEALED_VS_OPENED", 8);
  }
  if (hasAny(text, ["damaged", "damage", "crushed", "bent", "broken", "torn", "dented"])) {
    scoreCategory("Damage", 8);
    scoreShortcut("/damage1", 4);
  }
  if (hasAny(text, ["refund", "return request", "return", "cancel", "cancellation"])) {
    scoreCategory("Refund", 7);
  }
  if (hasAny(text, ["surprise set", "randomized", "randomised", "accidental bid", "unauthorized purchase", "opened live"])) {
    scoreShortcut("/ssrefund1", 10);
  }
  if (hasAny(text, ["delivered but not received", "never received", "marked delivered", "says delivered", "not received", "didn't receive", "did not receive"])) {
    scoreCategory("Missing Package", 9);
    scoreShortcut("/delivered1", 5);
  }
  if (hasAny(text, ["giveaway", "give away", "winner", "won"])) {
    scoreCategory("Giveaway", 8);
  }
  if (hasAny(text, ["vip", "goodwill", "discount", "coupon", "recovery"])) {
    scoreCategory("Goodwill", 6);
  }

  const hasOrderLikeText = hasAny(text, ["order", "#", "tracking", "label", "package"]);
  if (!hasOrderLikeText || hasAny(text, ["order number", "what order", "which order", "no order"])) {
    scoreShortcut("/admin5", 5);
  }
  if (!scores.size || hasAny(text, ["review", "investigate", "looking into", "unclear", "not sure", "help"])) {
    scoreShortcut("/admin2", scores.size ? 2 : 6);
  }

  const byShortcut = new Map(SUPPORT_PLAYBOOK.map((entry) => [entry.shortcut, entry]));
  const selected = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([shortcut]) => byShortcut.get(shortcut))
    .filter((entry): entry is SupportPlaybookEntry => Boolean(entry))
    .slice(0, 5);

  for (const shortcut of ["/admin2", "/admin5", "/missing1", "/delivered1", "/damage1"]) {
    if (selected.length >= 3) break;
    const entry = byShortcut.get(shortcut);
    if (entry && !selected.some((candidate) => candidate.shortcut === shortcut)) selected.push(entry);
  }

  return selected.slice(0, 5);
};

const SYSTEM_PROMPT = `You are the Ops Command Hub assistant for Jonny at Outer Planes / Vaulted / TikTok Shop support.
Analyze the support message and produce a concise operational recommendation.
The assistant should sound calm, direct, and useful.
Do not over-apologize.
Do not promise a refund, replacement, or cancellation without review.
Draft replies should sound like Jonny: friendly, short, clear, action-first, no corporate fluff.
Use the selected support playbook candidates before drafting.
Choose the closest candidate and use that candidate's response style and policy guidance.
Internal notes are for reasoning only and must never appear in draftReply.
draftReply must be paste-ready for TikTok Shop chat or email.
Ask for missing order details or evidence when needed.
If the selected playbook requires proof, ask for the specific proof or photos needed.
Do not promise refunds, replacements, cancellations, credits, or reshipments unless the selected playbook response clearly supports it.
Keep Jonny's support style: polite, steady, concise, evidence-first, no corporate fluff, no hype, no emojis, no em dashes.
Do not say "rest assured."
Do not say "we're here and rooting for you."
Do not say "your experience matters to us."
Do not say "we sincerely apologize" unless the company clearly made a mistake.
Do not over-apologize.
Do not mention AI, internal tools, policies, backend checks, confidence, or reasoning tags in draftReply.
Return only JSON matching the schema.

Case guidance:
- Refund / Return messages: identify as refund or return request. Recommend checking order/customer evidence before approving or rejecting. Missing info may include order number, return reason, evidence, photos.
- Replacement/shipping messages: identify as replacement or shipping review. Recommend verifying order, item, and evidence. Missing info may include order number, item, photo/evidence.
- TikTok Shop Chat: identify as TikTok Shop customer message. Recommend direct reply if enough information is present, otherwise ask for order details.
- Outlook: identify as email support request.
- Older messages: mention if older than 24 hours based on email_received_at or created_at if included.

reasoningTags must include metadata for the selected playbook candidate:
- shortcut:/example
- category:Category Name
- action:Final Action
- proof:required or proof:not_required
- review:yes or review:no`;

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

const buildUserPrompt = (message: InboundMessage, candidates: SupportPlaybookEntry[]) =>
  [
    "Analyze this inbound support message and return the structured assistant analysis.",
    "Select the closest support playbook candidate before writing draftReply.",
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
    "",
    "Selected Support Playbook Candidates:",
    JSON.stringify(candidates.map((entry) => ({
      name: entry.name,
      shortcut: entry.shortcut,
      category: entry.category,
      tag: entry.tag,
      stage: entry.stage,
      trigger: entry.trigger,
      requiresProof: entry.requiresProof,
      requiresReview: entry.requiresReview,
      finalAction: entry.finalAction,
      internalNotes: entry.internalNotes,
      response: entry.response,
    })), null, 2),
    "",
    "Important: internalNotes are never customer-facing. Do not include them in draftReply.",
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

    const playbookCandidates = selectPlaybookCandidates(message);

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
            content: [{ type: "input_text", text: buildUserPrompt(message, playbookCandidates) }],
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
