import { useState, useEffect, useCallback } from "react";
import { createClient } from '@supabase/supabase-js';

// ─── SUPABASE CLIENT ──────────────────────────────────────────────────────────
const supabaseUrl = "https://hljotjdrgabhmqgorbpo.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhsam90amRyZ2FiaG1xZ29yYnBvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NjYzMzAsImV4cCI6MjA5NDE0MjMzMH0.KojT8NA3qias7s-ljAN92LTnpBWvtbJwxvAAUU5FIIw";
const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const todayStr = () => new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
const nowStr = () => new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
const nowISO = () => new Date().toISOString();
const fmtDate = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const todayDate = () => new Date().toISOString().slice(0, 10);

// SLA: TikTok SPS window is 48h from creation. "At risk" = < 2h remaining AND not resolved.
const slaHoursRemaining = (createdAt) => {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageHrs = ageMs / 3600000;
  return Math.max(0, 48 - ageHrs);
};
const slaDisplay = (createdAt) => {
  const rem = slaHoursRemaining(createdAt);
  const h = Math.floor(rem);
  const m = Math.round((rem - h) * 60);
  return { display: `${h}h ${m}m`, urgent: rem < 2, warning: rem < 6, remaining: rem };
};
const isActiveSlaRisk = (t) => t.slaRisk === "Yes" && t.status !== "Resolved" && t.status !== "Escalated" && slaHoursRemaining(t.createdAt) < 2;

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const BRANDS = ["Vaulted Rarities", "CardKing47", "PokeSpins", "Pokiemart"];
const BRAND_SHORT = { "Vaulted Rarities": "VR", "CardKing47": "CK47", "PokeSpins": "PS", "Pokiemart": "PM" };
// Exact brand colors per spec
const BRAND_DOT = { "Vaulted Rarities": "#FACC15", "CardKing47": "#2563EB", "PokeSpins": "#DC2626", "Pokiemart": "#16A34A" };

const CHANNELS = ["TikTok Shop", "Refund / Return", "Shop Chat", "TikTok DM", "Instagram DM", "Email"];
const ISSUE_TYPES = ["Where is my order", "Refund request", "Return request", "Surprise set dispute", "Missing item", "Damaged item", "Wrong item", "Label created / no scan", "Hostile customer", "Other"];
const PRIORITIES = ["High", "Medium", "Low"];
const KANBAN_COLS = ["New", "In Progress", "Waiting on Customer", "Backend Lookup", "Resolved", "Escalated"];
const TONES = ["Friendly", "Firm", "Apology", "Investigation", "Final-sale policy"];
const ROOT_CAUSES = ["Carrier delay", "Lost in transit", "Wrong item packed", "Missing item in pack", "Damaged in shipping", "Customer error", "Warehouse error", "Surprise set dispute", "Other"];

// ─── SUPABASE DATA HELPERS ───────────────────────────────────────────────────
const normalizeBrandForApp = (brand, brandCode) => {
  const value = (brand || brandCode || "").toString().trim();
  const upper = value.toUpperCase();
  if (upper === "VR" || value === "Vaulted Rarities") return "Vaulted Rarities";
  if (upper === "CK47" || upper === "CK" || value === "CardKing47") return "CardKing47";
  if (upper === "PS" || value === "PokeSpins") return "PokeSpins";
  if (upper === "PM" || value === "Pokiemart") return "Pokiemart";
  return BRANDS.includes(value) ? value : "Vaulted Rarities";
};

const normalizeYesNo = (value) => {
  if (value === true) return "Yes";
  if (value === false) return "No";
  const raw = (value || "No").toString().trim().toLowerCase();
  return ["yes", "true", "1", "high", "sla"].includes(raw) ? "Yes" : "No";
};

const normalizeTicketStatus = (status) => {
  const raw = (status || "New").toString().trim();
  return KANBAN_COLS.includes(raw) ? raw : "New";
};

const normalizeTicketPriority = (priority) => {
  const raw = (priority || "Medium").toString().trim();
  return PRIORITIES.includes(raw) ? raw : "Medium";
};

const normalizeTicketIssue = (issueType) => {
  const raw = (issueType || "Other").toString().trim();
  const withoutQuestion = raw.replace(/\?$/, "");
  if (ISSUE_TYPES.includes(raw)) return raw;
  if (ISSUE_TYPES.includes(withoutQuestion)) return withoutQuestion;
  return "Other";
};

const mapDbTicketToApp = (row = {}) => {
  const brand = normalizeBrandForApp(row.brand, row.brand_code || row.brandCode || row.brandcode);
  const createdAt = row.created_at || row.createdAt || nowISO();
  return {
    id: row.id || `DB-${uid()}`,
    source: row.source || "supabase",
    brand,
    brandCode: row.brand_code || row.brandCode || row.brandcode || BRAND_SHORT[brand],
    channel: row.channel || "TikTok Shop",
    issueType: normalizeTicketIssue(row.issue_type || row.issueType || row.issuetype),
    priority: normalizeTicketPriority(row.priority),
    slaRisk: normalizeYesNo(row.sla_risk ?? row.slaRisk ?? row.slarisk),
    status: normalizeTicketStatus(row.status),
    orderNumber: row.order_number || row.orderNumber || row.ordernumber || "",
    customerName: row.customer_name || row.customerName || row.customername || "",
    notes: row.notes || "",
    nextAction: row.next_action || row.nextAction || row.nextaction || "",
    createdAt,
    updatedAt: row.updated_at || row.updatedAt || createdAt,
  };
};

const appTicketToDbRow = (ticket = {}) => {
  const brand = normalizeBrandForApp(ticket.brand, ticket.brandCode || ticket.brand_code);
  const createdAt = ticket.createdAt || ticket.created_at || nowISO();
  return {
    // Let Supabase generate the UUID primary key. Do not send local/string ids.
    source: ticket.source || "command-center",
    brand,
    brand_code: ticket.brandCode || ticket.brand_code || BRAND_SHORT[brand],
    channel: ticket.channel || "TikTok Shop",
    issue_type: normalizeTicketIssue(ticket.issueType || ticket.issue_type),
    priority: normalizeTicketPriority(ticket.priority),
    sla_risk: normalizeYesNo(ticket.slaRisk ?? ticket.sla_risk),
    status: normalizeTicketStatus(ticket.status),
    order_number: ticket.orderNumber || ticket.order_number || "",
    customer_name: ticket.customerName || ticket.customer_name || "",
    notes: ticket.notes || "",
    next_action: ticket.nextAction || ticket.next_action || "",
    created_at: createdAt,
    updated_at: nowISO(),
  };
};

const fetchTicketsFromSupabase = async () => {
  if (!supabase) {
    console.warn("Supabase env vars missing. Showing an empty ticket queue.");
    return { data: [], error: null };
  }

  const { data, error } = await supabase
    .from("tickets")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Supabase fetch error:", error);
    return { data: [], error };
  }

  return { data: (data || []).map(mapDbTicketToApp), error: null };
};

const insertTicketToSupabase = async (ticket) => {
  const appTicket = mapDbTicketToApp(ticket);
  const row = appTicketToDbRow(appTicket);

  if (!supabase) {
    const error = { message: "Supabase env vars are missing. Check .env.local, then restart npm run start." };
    console.error("Supabase insert error:", error);
    return { data: null, error };
  }

  const { data, error } = await supabase
    .from("tickets")
    .insert([row])
    .select("*")
    .single();

  if (error) {
    console.error("Supabase insert error:", error);
    return { data: null, error };
  }

  return { data: mapDbTicketToApp(data), error: null };
};

const updateTicketStatusInSupabase = async (id, status) => {
  if (!supabase || !id) return { error: null };
  const { error } = await supabase
    .from("tickets")
    .update({ status: normalizeTicketStatus(status), updated_at: nowISO() })
    .eq("id", id);
  if (error) console.error("Supabase status update error:", error);
  return { error };
};


const STATUS_STYLE = {
  "New": "bg-blue-50 text-blue-700 border-blue-200",
  "In Progress": "bg-purple-50 text-purple-700 border-purple-200",
  "Waiting on Customer": "bg-amber-50 text-amber-700 border-amber-200",
  "Backend Lookup": "bg-cyan-50 text-cyan-700 border-cyan-200",
  "Resolved": "bg-green-50 text-green-700 border-green-200",
  "Escalated": "bg-red-50 text-red-700 border-red-200",
};
const PRIORITY_STYLE = {
  "High": "bg-red-50 text-red-700 border-red-200",
  "Medium": "bg-amber-50 text-amber-700 border-amber-200",
  "Low": "bg-gray-100 text-gray-600 border-gray-200",
};

// ─── SAMPLE DATA ──────────────────────────────────────────────────────────────
// SLA window = 48h from creation. To demo an "urgent" alert, create one ticket ~47.5h ago.
const DEMO_TICKETS = [
  { id: uid(), brand: "Vaulted Rarities", channel: "Shop Chat", issueType: "Where is my order", priority: "High", slaRisk: "Yes", status: "New", notes: "Customer ordered 5 days ago. Tracking shows label created but carrier has not scanned.", nextAction: "Backend lookup: verify tracking / label status in TikTok Seller Center", createdAt: new Date(Date.now() - 47.6 * 3600000).toISOString() },
  { id: uid(), brand: "Vaulted Rarities", channel: "TikTok DM", issueType: "Missing item", priority: "High", slaRisk: "Yes", status: "New", notes: "Customer says package arrived but one item is missing from sealed pack.", nextAction: "Request unboxing photo and packing slip photo from customer", createdAt: new Date(Date.now() - 47.2 * 3600000).toISOString() },
  { id: uid(), brand: "Vaulted Rarities", channel: "Email", issueType: "Hostile customer", priority: "High", slaRisk: "Yes", status: "In Progress", notes: "Customer threatening chargeback and public social media post. Requires same-day response.", nextAction: "Backend lookup: confirm order details, then issue de-escalation response", createdAt: new Date(Date.now() - 46 * 3600000).toISOString() },
  { id: uid(), brand: "CardKing47", channel: "Shop Chat", issueType: "Where is my order", priority: "Medium", slaRisk: "No", status: "Resolved", notes: "Carrier scan confirmed delivery. Customer acknowledged receipt.", nextAction: "Closed", createdAt: new Date(Date.now() - 5 * 24 * 3600000).toISOString() },
  { id: uid(), brand: "PokeSpins", channel: "Refund / Return", issueType: "Surprise set dispute", priority: "Medium", slaRisk: "No", status: "Resolved", notes: "Customer disputed contents of surprise set. Unboxing video reviewed and contents confirmed correct.", nextAction: "Closed", createdAt: new Date(Date.now() - 5 * 24 * 3600000).toISOString() },
  { id: uid(), brand: "CardKing47", channel: "TikTok DM", issueType: "Label created / no scan", priority: "High", slaRisk: "Yes", status: "Resolved", notes: "Label created 3 days prior with no carrier scan. Carrier located package after trace request.", nextAction: "Closed — carrier trace resolved", createdAt: new Date(Date.now() - 5 * 24 * 3600000).toISOString() },
  { id: uid(), brand: "CardKing47", channel: "Shop Chat", issueType: "Damaged item", priority: "Medium", slaRisk: "No", status: "Resolved", notes: "Item arrived damaged in transit. Photos confirmed. Replacement sent via priority mail.", nextAction: "Closed", createdAt: new Date(Date.now() - 5 * 24 * 3600000).toISOString() },
  { id: uid(), brand: "CardKing47", channel: "TikTok DM", issueType: "Wrong item", priority: "Medium", slaRisk: "No", status: "Resolved", notes: "Wrong card set packed. Correct item reshipped same day.", nextAction: "Closed", createdAt: new Date(Date.now() - 5 * 24 * 3600000).toISOString() },
  { id: uid(), brand: "PokeSpins", channel: "TikTok DM", issueType: "Missing item", priority: "Low", slaRisk: "No", status: "Resolved", notes: "Customer reported missing item. Order confirmed delivered in full per carrier tracking.", nextAction: "Closed", createdAt: new Date(Date.now() - 5 * 24 * 3600000).toISOString() },
  { id: uid(), brand: "Pokiemart", channel: "Shop Chat", issueType: "Refund request", priority: "Medium", slaRisk: "No", status: "Resolved", notes: "Refund processed for order that did not arrive within window.", nextAction: "Closed", createdAt: new Date(Date.now() - 5 * 24 * 3600000).toISOString() },
  { id: uid(), brand: "Pokiemart", channel: "Shop Chat", issueType: "Missing item", priority: "Medium", slaRisk: "No", status: "In Progress", notes: "Customer claims item missing from order. Photo request sent.", nextAction: "Awaiting photo proof from customer", createdAt: new Date(Date.now() - 2 * 3600000).toISOString() },
  { id: uid(), brand: "PokeSpins", channel: "Refund / Return", issueType: "Return request", priority: "Low", slaRisk: "No", status: "Backend Lookup", notes: "Customer requesting return on sealed product. Checking return eligibility.", nextAction: "Backend lookup: confirm order details and review return policy", createdAt: new Date(Date.now() - 3600000).toISOString() },
];

const DEMO_REPLACEMENTS = [
  { id: uid(), date: "2025-05-08", brand: "Vaulted Rarities", orderNum: "VR-10291", reason: "Missing item in sealed pack", rootCause: "Warehouse error", marketValue: 34.99, preventable: "Yes", followUp: "Yes", notes: "Warehouse audit requested for Pack A batch. Follow up with ops team." },
  { id: uid(), date: "2025-05-07", brand: "CardKing47", orderNum: "CK-88731", reason: "Damaged in shipping", rootCause: "Damaged in shipping", marketValue: 22.50, preventable: "No", followUp: "No", notes: "Carrier claim filed. Replacement shipped via priority mail." },
  { id: uid(), date: "2025-05-06", brand: "PokeSpins", orderNum: "PS-55201", reason: "Wrong item packed", rootCause: "Wrong item packed", marketValue: 45.00, preventable: "Yes", followUp: "Yes", notes: "Packing verification process needs update. Follow up with warehouse." },
  { id: uid(), date: "2025-05-05", brand: "Vaulted Rarities", orderNum: "VR-10155", reason: "Lost in transit", rootCause: "Lost in transit", marketValue: 89.99, preventable: "No", followUp: "No", notes: "Insurance claim submitted. Carrier investigation opened." },
];

const DEMO_STUDIOS = [
  { id: "TT-01", countCompleted: true, fullyStocked: true, discrepanciesLogged: 1, discrepanciesResolved: 1, streamReady: true, notes: "All clear. Extra card sleeves needed before next week." },
  { id: "TT-02", countCompleted: true, fullyStocked: true, discrepanciesLogged: 3, discrepanciesResolved: 3, streamReady: true, notes: "Booster boxes restocked. All discrepancies resolved." },
  { id: "TT-03", countCompleted: true, fullyStocked: true, discrepanciesLogged: 0, discrepanciesResolved: 0, streamReady: true, notes: "Clean count. No issues." },
  { id: "TT-04", countCompleted: false, fullyStocked: false, discrepanciesLogged: 2, discrepanciesResolved: 0, streamReady: false, notes: "Count not started. Restock pending. Two open discrepancies." },
];

// Fresh starter state: keeps the 4 studio stations visible, but with no fake completed work.
const FRESH_STUDIOS = [
  { id: "TT-01", countCompleted: false, fullyStocked: false, discrepanciesLogged: 0, discrepanciesResolved: 0, streamReady: false, notes: "" },
  { id: "TT-02", countCompleted: false, fullyStocked: false, discrepanciesLogged: 0, discrepanciesResolved: 0, streamReady: false, notes: "" },
  { id: "TT-03", countCompleted: false, fullyStocked: false, discrepanciesLogged: 0, discrepanciesResolved: 0, streamReady: false, notes: "" },
  { id: "TT-04", countCompleted: false, fullyStocked: false, discrepanciesLogged: 0, discrepanciesResolved: 0, streamReady: false, notes: "" },
];

const DEMO_SETS = [
  { id: uid(), brand: "Vaulted Rarities", streamer: "Jonny", date: "2025-05-08", setName: "May Holo Bundle A", quantity: 50, warehouseListReceived: true, convertedSetSheet: true, importedDesktop: true, quantitiesVerified: true, readyForLive: true },
  { id: uid(), brand: "CardKing47", streamer: "Jonny", date: "2025-05-09", setName: "CK Graded Pack Set", quantity: 30, warehouseListReceived: true, convertedSetSheet: true, importedDesktop: false, quantitiesVerified: false, readyForLive: false },
  { id: uid(), brand: "PokeSpins", streamer: "Jonny", date: "2025-05-10", setName: "PokeSpins Mystery Box", quantity: 20, warehouseListReceived: false, convertedSetSheet: false, importedDesktop: false, quantitiesVerified: false, readyForLive: false },
];

const SHIFT_START = [
  "Review all open TikTok tickets",
  "Check SLA risks — flag and escalate any tickets under 2 hours",
  "Sweep all Shop Chats for missed messages",
  "Review shipping queue for label-created / no-scan tickets",
  "Check surprise set readiness for today's stream",
  "Verify studio readiness for active stations",
  "Review replacement log from prior shift",
  "Run backend lookups for any pending ticket actions",
];
const SHIFT_END = [
  "All P1 tickets resolved or escalated",
  "Shop chat sweep complete and logged",
  "Replacement log updated with today's cases",
  "Studio inventory notes updated",
  "Surprise sets marked ready or flagged for next stream",
  "Weekly raise tracker updated",
  "Data exported / backed up to JSON",
  "Next shift priority queue prepped",
];

// ─── CS TEMPLATES ─────────────────────────────────────────────────────────────
const QUICK_TEMPLATES = [
  { label: "Where is my order?", issueType: "Where is my order", tone: "Friendly" },
  { label: "Label created / no scan", issueType: "Label created / no scan", tone: "Investigation" },
  { label: "Photo request", issueType: "Missing item", tone: "Friendly" },
  { label: "Surprise set dispute", issueType: "Surprise set dispute", tone: "Investigation" },
  { label: "Refund / return", issueType: "Refund request", tone: "Apology" },
  { label: "Hostile customer", issueType: "Hostile customer", tone: "Firm" },
];

const generateTemplate = (brand, issueType, tone, orderNum, customerName) => {
  const cName = customerName || "there";
  const oNum = orderNum ? `Order #${orderNum}` : "your order";
  const greetings = {
    Friendly: `Hi ${cName}!`,
    Firm: `Hi ${cName},`,
    Apology: `Hi ${cName}, I'm so sorry to hear about this.`,
    Investigation: `Hi ${cName}, thank you for reaching out.`,
    "Final-sale policy": `Hi ${cName}, thank you for contacting ${brand} support.`,
  };
  const greeting = greetings[tone] || `Hi ${cName},`;
  const sign = `\nBest,\n${brand} Support`;
  const templates = {
    "Where is my order": `${greeting}\n\nThank you for reaching out about ${oNum}. I can see your order has been processed and a shipping label has been created. Carriers can take 24–48 hours to scan packages after pickup, especially during high-volume periods.\n\nI'm monitoring your shipment and will follow up as soon as there's a tracking update. If you don't see movement within 2 business days, please let me know and I'll open a carrier investigation right away.\n\nThank you for your patience.${sign}`,
    "Label created / no scan": `${greeting}\n\nThank you for checking in on ${oNum}. I can confirm your shipping label was created and the order has been handed off to the carrier. I'm currently seeing that the package has not received a carrier scan yet — this can happen during high-volume pickup windows.\n\nI've flagged this for investigation. If we don't see a scan update within 48 hours, I will file a carrier trace on your behalf and keep you updated.\n\nThank you for your patience.${sign}`,
    "Refund request": `${greeting}\n\nI've received your refund request for ${oNum} and I'm reviewing it right away. We take all refund requests seriously and want to make sure this is handled fairly for you.\n\nTo process this quickly, could you confirm:\n• The reason for the refund request\n• Whether the item is still sealed or has been opened\n• Your preferred resolution — refund or replacement\n\nI'll follow up within 1 business day once I have those details.${sign}`,
    "Return request": `${greeting}\n\nThank you for reaching out about ${oNum}. I've received your return request and I'm reviewing your order now.\n\nTo make sure I process this correctly, could you confirm:\n• Whether the item is sealed or opened\n• The reason for the return request\n\nI'll follow up within 1 business day with next steps.${sign}`,
    "Surprise set dispute": `${greeting}\n\nThank you for reaching out about ${oNum}. I want to make sure this gets resolved for you.\n\nSurprise sets are curated ahead of each stream, and contents may vary from what is shown during live. To investigate your concern, could you please:\n• Share a short unboxing video or photos of the contents received\n• Describe the specific concern with the set\n\nOnce I've reviewed the details, I'll follow up with next steps.${sign}`,
    "Missing item": `${greeting}\n\nI'm sorry to hear ${oNum} arrived with a missing item — that's not the experience we want for you.\n\nTo investigate and process a resolution, could you please send:\n• A photo of the package as it arrived (outside and inside)\n• A photo of all items included in the shipment\n• A photo of the packing slip, if one was included\n\nI'll review everything and get back to you within 24 hours.${sign}`,
    "Damaged item": `${greeting}\n\nI'm so sorry to hear that ${oNum} arrived damaged. That's not acceptable and I want to make this right for you immediately.\n\nTo file a damage claim and process your replacement or refund, I'll need:\n• Clear photos of the damaged item(s)\n• A photo of the outer packaging showing any damage\n\nPlease send those over and I'll prioritize your case right away.${sign}`,
    "Wrong item": `${greeting}\n\nThank you for letting me know about ${oNum}. I apologize for the mix-up on our end.\n\nTo get the correct item to you as quickly as possible, could you please:\n• Send a photo of the item(s) you received\n• Confirm the item(s) you originally ordered\n\nOnce I verify the details, I'll get a replacement shipped out promptly.${sign}`,
    "Hostile customer": `${greeting}\n\nThank you for reaching out. I understand you're frustrated and I assure you that we take your concern seriously.\n\nI am reviewing ${oNum} now and will respond with a complete update by end of day. We are committed to resolving this professionally and fairly.\n\nIf you'd prefer to continue this conversation through another channel, please let me know.${sign}`,
  };
  return templates[issueType] || `${greeting}\n\nThank you for reaching out about ${oNum}. I'm reviewing your case now and will follow up with an update shortly.${sign}`;
};

// ─── PRIMITIVES ───────────────────────────────────────────────────────────────
const Card = ({ children, className = "" }) => (
  <div className={`bg-white border border-gray-200 rounded-lg ${className}`}>{children}</div>
);

const Badge = ({ label, className = "" }) => (
  <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded border font-medium ${className}`}>{label}</span>
);
const StatusBadge = ({ status }) => <Badge label={status} className={STATUS_STYLE[status] || "bg-gray-100 text-gray-600 border-gray-200"} />;
const PriorityBadge = ({ priority }) => <Badge label={priority} className={PRIORITY_STYLE[priority] || "bg-gray-100 text-gray-600 border-gray-200"} />;

const BrandPip = ({ brand, size = "sm" }) => (
  <span
    className={`inline-block rounded-sm flex-shrink-0 ${size === "lg" ? "w-3 h-3" : "w-2.5 h-2.5"}`}
    style={{ backgroundColor: BRAND_DOT[brand] || "#9ca3af" }}
  />
);

const ProgressBar = ({ pct, color = "bg-blue-500" }) => (
  <div className="w-full bg-gray-200 rounded-full h-1.5">
    <div className={`${color} h-1.5 rounded-full transition-all`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
  </div>
);

const BtnPrimary = ({ children, onClick, size = "sm", disabled = false }) => (
  <button onClick={onClick} disabled={disabled} className={`inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg border border-blue-700 transition-colors cursor-pointer ${size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"}`}>{children}</button>
);
const BtnSecondary = ({ children, onClick, size = "sm" }) => (
  <button onClick={onClick} className={`inline-flex items-center gap-1.5 bg-white hover:bg-gray-50 text-gray-700 font-medium rounded-lg border border-gray-300 transition-colors cursor-pointer ${size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"}`}>{children}</button>
);
const BtnSuccess = ({ children, onClick, size = "sm" }) => (
  <button onClick={onClick} className={`inline-flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg border border-green-700 transition-colors cursor-pointer ${size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"}`}>{children}</button>
);
const BtnDanger = ({ children, onClick, size = "sm" }) => (
  <button onClick={onClick} className={`inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg border border-red-700 transition-colors cursor-pointer ${size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"}`}>{children}</button>
);

const Sel = ({ value, onChange, options, placeholder = "Select...", className = "" }) => (
  <select value={value} onChange={e => onChange(e.target.value)} className={`bg-white border border-gray-300 text-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 w-full ${className}`}>
    {placeholder && <option value="">{placeholder}</option>}
    {options.map(o => <option key={o} value={o}>{o}</option>)}
  </select>
);
const Inp = ({ value, onChange, placeholder, type = "text", className = "" }) => (
  <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={`bg-white border border-gray-300 text-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 w-full placeholder-gray-400 ${className}`} />
);
const Txt = ({ value, onChange, placeholder, rows = 3, className = "" }) => (
  <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} className={`bg-white border border-gray-300 text-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 w-full placeholder-gray-400 resize-none ${className}`} />
);
const Chk = ({ checked, onChange, label }) => (
  <label className="flex items-center gap-2.5 cursor-pointer group">
    <div onClick={() => onChange(!checked)} className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${checked ? "bg-blue-600 border-blue-600" : "border-gray-300 hover:border-blue-400"}`}>
      {checked && <span className="text-white text-[9px] font-bold">✓</span>}
    </div>
    <span className={`text-sm ${checked ? "line-through text-gray-400" : "text-gray-700 group-hover:text-gray-900"}`}>{label}</span>
  </label>
);
const FL = ({ children }) => <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{children}</p>;

// ─── SIDEBAR NAV ICONS ────────────────────────────────────────────────────────
const ICONS = {
  dashboard: <path d="M2 2h5v5H2zm7 0h5v5H9zM2 9h5v5H2zm7 0h5v5H9z" fill="currentColor" opacity=".7" />,
  daily: <><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M5 1v3M11 1v3M2 7h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></>,
  tickets: <><path d="M2 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4z" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M5 7h6M5 10h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></>,
  browser: <><rect x="1" y="2" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M1 6h14" stroke="currentColor" strokeWidth="1.3"/><circle cx="4" cy="4" r="1" fill="currentColor"/><circle cx="7" cy="4" r="1" fill="currentColor"/></>,
  cs: <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-3 2v-2H3a1 1 0 0 1-1-1V3z" stroke="currentColor" strokeWidth="1.3" fill="none"/>,
  replacements: <><rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M5 5h6M5 8h6M5 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></>,
  studio: <><rect x="1" y="5" width="6" height="9" rx="1" stroke="currentColor" strokeWidth="1.3" fill="none"/><rect x="9" y="2" width="6" height="12" rx="1" stroke="currentColor" strokeWidth="1.3" fill="none"/></>,
  sets: <path d="M8 1l2 5h5l-4 3 1.5 5L8 11l-4.5 3L5 9 1 6h5L8 1z" stroke="currentColor" strokeWidth="1.2" fill="none"/>,
  weekly: <path d="M2 12l3-5 3 2 3-6 3 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>,
  data: <><ellipse cx="8" cy="4" rx="5" ry="2" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M3 4v4c0 1.1 2.24 2 5 2s5-.9 5-2V4" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M3 8v4c0 1.1 2.24 2 5 2s5-.9 5-2V8" stroke="currentColor" strokeWidth="1.3" fill="none"/></>,
};
const NavItem = ({ id, label, active, onClick, badge }) => (
  <button onClick={() => onClick(id)} className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all text-left ${active ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"}`}>
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={`flex-shrink-0 ${active ? "text-white" : "text-gray-400"}`}>{ICONS[id]}</svg>
    <span className="flex-1 truncate">{label}</span>
    {badge > 0 && <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">{badge}</span>}
  </button>
);

const NAV = [
  { section: null, items: [{ id: "dashboard", label: "Dashboard" }] },
  { section: "Operations", items: [{ id: "daily", label: "Daily Command Board" }, { id: "tickets", label: "Tickets" }, { id: "replacements", label: "Replacements" }, { id: "studio", label: "Inventory" }] },
  { section: "Content", items: [{ id: "sets", label: "Surprise Sets" }, { id: "browser", label: "Browser Profiles" }, { id: "cs", label: "CS Templates" }] },
  { section: "Reporting", items: [{ id: "weekly", label: "Report" }, { id: "data", label: "Settings" }] },
];

// ─── REPORT GENERATION ────────────────────────────────────────────────────────
const buildSlackSummary = ({ tickets, replacements, studios, surpriseSets, raiseScores }) => {
  const open = tickets.filter(t => t.status !== "Resolved" && t.status !== "Escalated");
  const resolved = tickets.filter(t => t.status === "Resolved");
  const escalated = tickets.filter(t => t.status === "Escalated");
  const slaRisks = tickets.filter(t => t.slaRisk === "Yes");
  const totalLoss = replacements.reduce((a, r) => a + parseFloat(r.marketValue || 0), 0);
  const studioReady = studios.filter(s => s.streamReady);
  const studioScore = Math.round((studioReady.length / studios.length) * 100);
  const setsReady = surpriseSets.filter(s => s.readyForLive);

  return `*Jonny Ops — Weekly Shift Summary*

*TikTok SPS / Customer Support*
• ${tickets.length} tickets reviewed across VR, CK47, PS, and PM
• ${slaRisks.length} SLA risk ticket${slaRisks.length !== 1 ? "s" : ""} identified
• ${resolved.length} ticket${resolved.length !== 1 ? "s" : ""} resolved | ${escalated.length} escalated | ${open.length} still open

*Inventory & Studio Readiness*
• ${studioReady.map(s => s.id).join(", ")} stream-ready
• ${studios.filter(s => !s.streamReady).map(s => s.id).join(", ") || "All studios"} ${studios.filter(s => !s.streamReady).length > 0 ? "not ready" : "stream-ready"}
• Overall studio readiness: ${studioScore}%

*Shipping Loss Prevention*
• ${replacements.length} replacement case${replacements.length !== 1 ? "s" : ""} logged
• Estimated loss tracked: $${totalLoss.toFixed(2)}
• Preventable cases: ${replacements.filter(r => r.preventable === "Yes").length}

*Surprise Set Execution*
• ${setsReady.length} of ${surpriseSets.length} surprise set${surpriseSets.length !== 1 ? "s" : ""} ready for live

*Raise Path — Self Score*
Consistency ${raiseScores.consistency}% | Accuracy ${raiseScores.accuracy}% | Loss Reduction ${raiseScores.lossReduction}% | Ownership ${raiseScores.ownership}% | Process ${raiseScores.processImprovement}%`;
};

const buildFullReport = ({ tickets, replacements, studios, surpriseSets, raiseScores, improvements, risks, nextFocus }) => {
  const open = tickets.filter(t => t.status !== "Resolved" && t.status !== "Escalated");
  const resolved = tickets.filter(t => t.status === "Resolved");
  const escalated = tickets.filter(t => t.status === "Escalated");
  const slaRisks = tickets.filter(t => t.slaRisk === "Yes");
  const byBrand = BRANDS.map(b => ({ brand: b, total: tickets.filter(t => t.brand === b).length, resolved: tickets.filter(t => t.brand === b && t.status === "Resolved").length }));
  const totalLoss = replacements.reduce((a, r) => a + parseFloat(r.marketValue || 0), 0);
  const preventable = replacements.filter(r => r.preventable === "Yes");
  const studioReady = studios.filter(s => s.streamReady);
  const studioScore = Math.round((studioReady.length / studios.length) * 100);
  const openDiscrepancies = studios.reduce((a, s) => a + Math.max(0, s.discrepanciesLogged - s.discrepanciesResolved), 0);
  const setsReady = surpriseSets.filter(s => s.readyForLive);

  const rcCounts = {};
  replacements.forEach(r => { rcCounts[r.rootCause] = (rcCounts[r.rootCause] || 0) + 1; });
  const topCauses = Object.entries(rcCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return `JONNY OPS — WEEKLY RAISE TRACKER REPORT
Week of ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
Prepared by: Jonny Valencia
${"─".repeat(52)}

TIKTOK SPS / CUSTOMER SUPPORT
─────────────────────────────
Reviewed ${tickets.length} support tickets across all four brands this week.

By brand:
${byBrand.map(b => `  ${b.brand.padEnd(20)} ${b.total} tickets  (${b.resolved} resolved)`).join("\n")}

Summary:
  Resolved:        ${resolved.length}
  Open:            ${open.length}
  Escalated:       ${escalated.length}
  SLA risks flagged: ${slaRisks.length}
  SLA risks (active, < 2h): ${tickets.filter(t => isActiveSlaRisk(t)).length}

INVENTORY & STUDIO READINESS
─────────────────────────────
${studios.map(s => `  ${s.id}: ${s.streamReady ? "Stream-ready" : "NOT READY"} — ${s.notes}`).join("\n")}

  Overall readiness:     ${studioScore}%
  Open discrepancies:    ${openDiscrepancies}
  Studios counted:       ${studios.filter(s => s.countCompleted).length}/${studios.length}

SHIPPING LOSS PREVENTION
─────────────────────────────
  Replacement cases logged:   ${replacements.length}
  Estimated loss tracked:     $${totalLoss.toFixed(2)}
  Preventable cases:          ${preventable.length}${preventable.length > 0 ? ` (${preventable.map(r => r.orderNum).join(", ")})` : ""}
  Follow-up required:         ${replacements.filter(r => r.followUp === "Yes").length}
${topCauses.length > 0 ? `\n  Top root causes:\n${topCauses.map(([c, n]) => `  • ${c}: ${n} case${n > 1 ? "s" : ""}`).join("\n")}` : ""}

SURPRISE SET EXECUTION
─────────────────────────────
  Sets tracked:       ${surpriseSets.length}
  Ready for live:     ${setsReady.length}
${surpriseSets.map(s => `  • ${s.setName} (${s.brand}) — ${s.readyForLive ? "Ready" : "Not ready"}`).join("\n")}

RAISE PATH — SELF ASSESSMENT
─────────────────────────────
  Consistency:          ${raiseScores.consistency}%
  Accuracy:             ${raiseScores.accuracy}%
  Loss Reduction:       ${raiseScores.lossReduction}%
  Ownership:            ${raiseScores.ownership}%
  Process Improvement:  ${raiseScores.processImprovement}%

PROCESS IMPROVEMENTS
─────────────────────────────
${improvements || "  No process improvements noted this week."}

RISKS / BLOCKERS
─────────────────────────────
${risks || "  No active risks or blockers noted."}

NEXT WEEK FOCUS
─────────────────────────────
${nextFocus || "  No focus areas set for next week."}

${"─".repeat(52)}
Generated by Jonny Ops Command Center v1.1
${new Date().toLocaleString()}`.trim();
};

// ─── DASHBOARD VIEW ───────────────────────────────────────────────────────────
const DashboardView = ({ tickets, setTickets, replacements, studios, surpriseSets, raiseScores }) => {
  const [showForm, setShowForm] = useState(false);
  const emptyF = { brand: "", channel: "", issueType: "", priority: "Medium", slaRisk: "No", status: "New", notes: "", nextAction: "" };
  const [form, setForm] = useState(emptyF);
  const f = k => v => setForm(p => ({ ...p, [k]: v }));

  // Supabase insert, then add the inserted row to the visible queue
  const addTicket = async () => {
    if (!form.brand || !form.issueType) return alert("Pick a brand and issue type first.");
    const newTicket = { ...form, createdAt: nowISO(), source: "command-center" };
    const { data, error } = await insertTicketToSupabase(newTicket);
    if (error) return alert(`Ticket save failed: ${error.message || "Unknown Supabase error"}`);
    setTickets(prev => [data, ...prev]);
    setForm(emptyF);
    setShowForm(false);
  };

  const open = tickets.filter(t => t.status !== "Resolved").length;
  const criticalSla = tickets.filter(isActiveSlaRisk);
  const totalLoss = replacements.reduce((a, r) => a + parseFloat(r.marketValue || 0), 0);
  const studioReady = studios.filter(s => s.streamReady).length;
  const studioScore = Math.round((studioReady / studios.length) * 100);

  const SET_STEPS = ["warehouseListReceived", "convertedSetSheet", "importedDesktop", "quantitiesVerified", "readyForLive"];
  const SET_LABELS = { warehouseListReceived: "Warehouse List", convertedSetSheet: "SetSheet", importedDesktop: "Imported", quantitiesVerified: "Verified", readyForLive: "Ready" };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
          <p className="text-xs text-gray-400 mt-0.5">{todayStr()}</p>
        </div>
        <div className="flex gap-2">
          <BtnSecondary size="sm">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="1" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M1 5h11M4 1v4M9 1v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            Main Page ▾
          </BtnSecondary>
          <BtnPrimary size="sm" onClick={() => setShowForm(s => !s)}>+ New Ticket</BtnPrimary>
        </div>
      </div>

      {showForm && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-gray-900">New Ticket</p>
            <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <Sel value={form.brand} onChange={f("brand")} options={BRANDS} placeholder="Brand *" />
            <Sel value={form.channel} onChange={f("channel")} options={CHANNELS} placeholder="Channel *" />
            <Sel value={form.issueType} onChange={f("issueType")} options={ISSUE_TYPES} placeholder="Issue Type *" />
            <Sel value={form.priority} onChange={f("priority")} options={PRIORITIES} placeholder="Priority" />
            <Sel value={form.slaRisk} onChange={f("slaRisk")} options={["Yes", "No"]} placeholder="SLA Risk" />
            <Sel value={form.status} onChange={f("status")} options={KANBAN_COLS} placeholder="Status" />
          </div>
          <Txt value={form.notes} onChange={f("notes")} placeholder="Notes..." rows={2} className="mb-2" />
          <Inp value={form.nextAction} onChange={f("nextAction")} placeholder="Next action..." className="mb-3" />
          <div className="flex gap-2"><BtnPrimary onClick={addTicket} size="sm">Add Ticket</BtnPrimary><BtnSecondary onClick={() => setShowForm(false)} size="sm">Cancel</BtnSecondary></div>
        </Card>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Open Tickets</p>
          <p className="text-4xl font-bold text-gray-900 mt-1">{open}</p>
        </Card>
        <Card className="p-4 border-l-4 border-l-blue-500">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">SLA Risks</p>
          <p className={`text-4xl font-bold mt-1 ${criticalSla.length > 0 ? "text-red-600" : "text-blue-600"}`}>{criticalSla.length}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">&lt; 2h remaining</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Estimated Loss</p>
          <p className="text-4xl font-bold text-green-600 mt-1">${totalLoss.toFixed(2)}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Studio Readiness</p>
            <span className={`w-2 h-2 rounded-full ${studioScore >= 75 ? "bg-green-500" : "bg-amber-400"}`} />
          </div>
          <p className={`text-4xl font-bold ${studioScore >= 75 ? "text-gray-900" : "text-amber-600"}`}>{studioScore}%</p>
          <p className="text-xs text-gray-400 mt-0.5">Stream-Ready</p>
          <div className="mt-2"><ProgressBar pct={studioScore} color={studioScore >= 75 ? "bg-green-500" : "bg-amber-400"} /></div>
        </Card>
      </div>

      {/* Critical SLA Alert — only shows tickets actually < 2h */}
      {criticalSla.length > 0 && (
        <div className="bg-red-600 rounded-lg px-5 py-3">
          <p className="text-white text-xs font-bold uppercase tracking-widest mb-1">Critical SLA Alert Zone</p>
          <div className="space-y-1">
            {criticalSla.map(t => {
              const cd = slaDisplay(t.createdAt);
              return (
                <p key={t.id} className="text-white text-sm font-mono">
                  <span className="font-bold">{t.brand}</span> — {t.issueType} — <span className="text-red-200">{cd.display} remaining</span>
                </p>
              );
            })}
          </div>
        </div>
      )}

      {/* 2-col layout */}
      <div className="flex gap-4">
        {/* Ticket table */}
        <div className="flex-1 min-w-0">
          <Card className="flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-900">TikTok SPS Defense Queue</p>
              <BtnPrimary size="sm" onClick={() => setShowForm(true)}>+ New Ticket</BtnPrimary>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-2.5 font-semibold text-gray-500 w-28">Brand</th>
                    <th className="text-left px-2 py-2.5 font-semibold text-gray-500">Issue Type</th>
                    <th className="text-left px-2 py-2.5 font-semibold text-gray-500 w-28">Status</th>
                    <th className="text-left px-2 py-2.5 font-semibold text-gray-500 w-20">SLA</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.slice(0, 14).map(t => {
                    const cd = slaDisplay(t.createdAt);
                    const showSla = t.slaRisk === "Yes" && t.status !== "Resolved";
                    return (
                      <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <BrandPip brand={t.brand} />
                            <span className="text-gray-700 font-medium">{BRAND_SHORT[t.brand]}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2.5 text-gray-800">{t.issueType}</td>
                        <td className="px-2 py-2.5"><StatusBadge status={t.status} /></td>
                        <td className="px-2 py-2.5">
                          {showSla
                            ? <span className={`font-mono font-bold ${cd.urgent ? "text-red-600" : cd.warning ? "text-amber-500" : "text-gray-500"}`}>{cd.display}</span>
                            : <span className="text-gray-300 font-mono">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Right rail */}
        <div className="w-72 flex-shrink-0 flex flex-col gap-4">
          <Card className="p-4">
            <p className="text-sm font-bold text-gray-900 mb-3">Surprise Set Tracker</p>
            {surpriseSets.map(s => {
              const done = SET_STEPS.filter(st => s[st]).length;
              return (
                <div key={s.id} className="mb-3 last:mb-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5"><BrandPip brand={s.brand} /><span className="text-xs font-medium text-gray-700 truncate max-w-[110px]">{s.setName}</span></div>
                    <span className={`text-[10px] font-bold ${s.readyForLive ? "text-green-600" : "text-amber-500"}`}>{done}/{SET_STEPS.length}</span>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {SET_STEPS.map(step => (
                      <span key={step} className={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${s[step] ? "bg-green-600 text-white border-green-700" : "bg-gray-100 text-gray-400 border-gray-200"}`}>{SET_LABELS[step]}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </Card>

          <Card className="p-4">
            <p className="text-sm font-bold text-gray-900 mb-3">Inventory &amp; Studio Readiness</p>
            <div className="grid grid-cols-4 gap-2">
              {studios.map(s => (
                <div key={s.id} className="text-center">
                  <p className="text-[10px] font-semibold text-gray-400 mb-1">{s.id}</p>
                  <input type="checkbox" checked={s.streamReady} readOnly className="accent-blue-600 mb-1" />
                  <p className={`text-[9px] font-bold ${s.streamReady ? "text-green-600" : "text-red-500"}`}>{s.streamReady ? "READY" : "NOT READY"}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Weekly report preview — real data */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-gray-900">Weekly Report Preview</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded p-3 text-[11px] text-gray-600 leading-relaxed space-y-1.5">
              <p className="font-semibold text-gray-800">TikTok SPS / CS</p>
              <p>• {tickets.length} tickets across all brands</p>
              <p>• {tickets.filter(t => t.slaRisk === "Yes").length} SLA risks — {criticalSla.length} critical now</p>
              <p>• {tickets.filter(t => t.status === "Resolved").length} resolved this period</p>
              <p className="font-semibold text-gray-800 pt-1">Shipping Loss</p>
              <p>• {replacements.length} replacement cases — ${totalLoss.toFixed(2)} tracked</p>
              <p>• {replacements.filter(r => r.preventable === "Yes").length} preventable</p>
              <p className="font-semibold text-gray-800 pt-1">Studios</p>
              <p>• {studioReady}/{studios.length} stream-ready — {studioScore}% readiness</p>
              <p className="font-semibold text-gray-800 pt-1">Sets</p>
              <p>• {surpriseSets.filter(s => s.readyForLive).length}/{surpriseSets.length} sets ready for live</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

// ─── DAILY COMMAND BOARD ──────────────────────────────────────────────────────
const DailyCommandView = ({ tickets }) => {
  const [startC, setStartC] = useState(SHIFT_START.map(() => false));
  const [endC, setEndC] = useState(SHIFT_END.map(() => false));
  const sp = Math.round((startC.filter(Boolean).length / startC.length) * 100);
  const ep = Math.round((endC.filter(Boolean).length / endC.length) * 100);
  const crit = tickets.filter(isActiveSlaRisk);
  const high = tickets.filter(t => t.priority === "High" && t.status !== "Resolved");
  const rec = crit.length > 0
    ? `Resolve SLA critical ticket immediately: "${crit[0].issueType}" for ${crit[0].brand} — ${slaDisplay(crit[0].createdAt).display} remaining`
    : high.length > 0
    ? `Address high-priority ticket: "${high[0].issueType}" for ${high[0].brand}`
    : sp < 100
    ? `Complete start-of-shift checklist (${sp}% done)`
    : "All clear — run a proactive Shop Chat sweep across all brands";

  const priorities = [
    { label: "P1 — Refunds / Returns", count: tickets.filter(t => ["Refund request","Return request"].includes(t.issueType) && t.status !== "Resolved").length, cls: "border-red-300 bg-red-50 text-red-700" },
    { label: "P2 — Shop Chat Sweeps", count: tickets.filter(t => t.channel === "Shop Chat" && t.status === "New").length, cls: "border-amber-300 bg-amber-50 text-amber-700" },
    { label: "P3 — Inventory & Studio Readiness", count: 0, cls: "border-blue-300 bg-blue-50 text-blue-700" },
    { label: "P4 — Shipping Replacement Log", count: 0, cls: "border-purple-300 bg-purple-50 text-purple-700" },
    { label: "P5 — Surprise Sets", count: 0, cls: "border-pink-300 bg-pink-50 text-pink-700" },
  ];

  return (
    <div className="space-y-4">
      <div><h2 className="text-2xl font-bold text-gray-900">Daily Command Board</h2><p className="text-xs text-gray-400 mt-0.5">{todayStr()} · {nowStr()}</p></div>
      {crit.length > 0 && (
        <div className="bg-red-600 rounded-lg px-5 py-3">
          <p className="text-white text-xs font-bold uppercase tracking-widest mb-1">Critical SLA Alert Zone — Action Required Now</p>
          {crit.map(t => <p key={t.id} className="text-white text-sm font-mono">{t.brand} — {t.issueType} — {slaDisplay(t.createdAt).display} remaining</p>)}
        </div>
      )}
      <Card className="p-4 border-l-4 border-l-blue-500">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">What should I do next?</p>
        <p className="text-gray-900 text-sm font-medium">{rec}</p>
      </Card>
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2"><p className="text-sm font-bold text-gray-900">Start-of-Shift Checklist</p><span className="text-xs font-bold text-blue-600">{sp}%</span></div>
          <ProgressBar pct={sp} color="bg-blue-500" />
          <div className="mt-4 space-y-2.5">{SHIFT_START.map((item, i) => <Chk key={i} checked={startC[i]} onChange={v => { const n = [...startC]; n[i] = v; setStartC(n); }} label={item} />)}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2"><p className="text-sm font-bold text-gray-900">End-of-Shift Checklist</p><span className="text-xs font-bold text-green-600">{ep}%</span></div>
          <ProgressBar pct={ep} color="bg-green-500" />
          <div className="mt-4 space-y-2.5">{SHIFT_END.map((item, i) => <Chk key={i} checked={endC[i]} onChange={v => { const n = [...endC]; n[i] = v; setEndC(n); }} label={item} />)}</div>
        </Card>
      </div>
      <Card className="p-4">
        <p className="text-sm font-bold text-gray-900 mb-3">Priority Queue</p>
        <div className="space-y-2">{priorities.map((p, i) => <div key={i} className={`flex items-center justify-between border rounded-lg px-4 py-2.5 ${p.cls}`}><span className="text-sm font-medium">{p.label}</span><span className="text-lg font-bold">{p.count}</span></div>)}</div>
      </Card>
    </div>
  );
};

// ─── TICKET QUEUE (KANBAN) ────────────────────────────────────────────────────
const TicketQueueView = ({ tickets, setTickets }) => {
  const emptyF = { brand: "", channel: "", issueType: "", priority: "Medium", slaRisk: "No", status: "New", notes: "", nextAction: "" };
  const [form, setForm] = useState(emptyF);
  const [filter, setFilter] = useState({ brand: "", status: "", priority: "" });
  const [showForm, setShowForm] = useState(false);
  const [drag, setDrag] = useState(null);
  const f = k => v => setForm(p => ({ ...p, [k]: v }));

  // Supabase insert, then add the inserted row to the visible queue
  const add = async () => {
    if (!form.brand || !form.issueType) return alert("Pick a brand and issue type first.");
    const newTicket = { ...form, createdAt: nowISO(), source: "command-center" };
    const { data, error } = await insertTicketToSupabase(newTicket);
    if (error) return alert(`Ticket save failed: ${error.message || "Unknown Supabase error"}`);
    setTickets(prev => [data, ...prev]);
    setForm(emptyF);
    setShowForm(false);
  };

  const upd = async (id, status) => {
    setTickets(p => p.map(t => t.id === id ? { ...t, status } : t));
    await updateTicketStatusInSupabase(id, status);
  };
  const filtered = tickets.filter(t => (!filter.brand || t.brand === filter.brand) && (!filter.status || t.status === filter.status) && (!filter.priority || t.priority === filter.priority));

  const TCard = ({ ticket: t }) => {
    const cd = slaDisplay(t.createdAt);
    const showSla = t.slaRisk === "Yes" && t.status !== "Resolved";
    return (
      <div draggable onDragStart={() => setDrag(t)} className="bg-white border border-gray-200 rounded-lg p-3 mb-2 cursor-grab hover:border-blue-300 hover:shadow-sm transition-all">
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <BrandPip brand={t.brand} /><span className="text-[10px] font-semibold text-gray-700">{BRAND_SHORT[t.brand]}</span>
          <PriorityBadge priority={t.priority} />
          {showSla && cd.urgent && <Badge label="SLA CRITICAL" className="bg-red-600 text-white border-red-700 animate-pulse" />}
          {showSla && !cd.urgent && cd.warning && <Badge label="SLA RISK" className="bg-amber-50 text-amber-700 border-amber-200" />}
        </div>
        <p className="text-xs font-semibold text-gray-900 mb-1">{t.issueType}</p>
        <p className="text-[10px] text-gray-400 mb-1">{t.channel} · {fmtDate(t.createdAt)}</p>
        {showSla && <p className={`text-[10px] font-mono font-bold mb-1 ${cd.urgent ? "text-red-600" : cd.warning ? "text-amber-500" : "text-gray-500"}`}>SLA: {cd.display} remaining</p>}
        {t.notes && <p className="text-[10px] text-gray-500 mb-2 line-clamp-2">{t.notes}</p>}
        {t.nextAction && <p className="text-[10px] text-blue-600">→ {t.nextAction}</p>}
        <select value={t.status} onChange={e => upd(t.id, e.target.value)} className="mt-2 w-full bg-gray-50 border border-gray-200 text-gray-700 text-[10px] rounded px-1.5 py-1 focus:outline-none">{KANBAN_COLS.map(c => <option key={c}>{c}</option>)}</select>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h2 className="text-2xl font-bold text-gray-900">TikTok SPS Defense Queue</h2><p className="text-xs text-gray-400 mt-0.5">{tickets.length} total tickets</p></div>
        <BtnPrimary onClick={() => setShowForm(s => !s)} size="md">{showForm ? "✕ Close" : "+ New Ticket"}</BtnPrimary>
      </div>
      {showForm && (
        <Card className="p-4">
          <p className="text-sm font-bold text-gray-900 mb-3">New Ticket Intake</p>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <Sel value={form.brand} onChange={f("brand")} options={BRANDS} placeholder="Brand *" />
            <Sel value={form.channel} onChange={f("channel")} options={CHANNELS} placeholder="Channel *" />
            <Sel value={form.issueType} onChange={f("issueType")} options={ISSUE_TYPES} placeholder="Issue Type *" />
            <Sel value={form.priority} onChange={f("priority")} options={PRIORITIES} placeholder="Priority" />
            <Sel value={form.slaRisk} onChange={f("slaRisk")} options={["Yes", "No"]} placeholder="SLA Risk" />
            <Sel value={form.status} onChange={f("status")} options={KANBAN_COLS} placeholder="Status" />
          </div>
          <Txt value={form.notes} onChange={f("notes")} placeholder="Notes..." rows={2} className="mb-2" />
          <Inp value={form.nextAction} onChange={f("nextAction")} placeholder="Next action..." className="mb-3" />
          <BtnPrimary onClick={add} size="md">Add to Queue</BtnPrimary>
        </Card>
      )}
      <div className="flex gap-2">
        <Sel value={filter.brand} onChange={v => setFilter(p => ({ ...p, brand: v }))} options={BRANDS} placeholder="All Brands" className="flex-1" />
        <Sel value={filter.status} onChange={v => setFilter(p => ({ ...p, status: v }))} options={KANBAN_COLS} placeholder="All Statuses" className="flex-1" />
        <Sel value={filter.priority} onChange={v => setFilter(p => ({ ...p, priority: v }))} options={PRIORITIES} placeholder="All Priorities" className="flex-1" />
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 overflow-x-auto pb-2">
        {KANBAN_COLS.map(col => {
          const ct = filtered.filter(t => t.status === col);
          return (
            <div key={col} className="min-w-[160px]" onDragOver={e => e.preventDefault()} onDrop={() => { if (drag) { upd(drag.id, col); setDrag(null); } }}>
              <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-gray-200"><StatusBadge status={col} /><span className="text-xs text-gray-400">{ct.length}</span></div>
              {ct.map(t => <TCard key={t.id} ticket={t} />)}
              {ct.length === 0 && <div className="text-center text-gray-300 text-xs py-6 border border-dashed border-gray-200 rounded-lg">Empty</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── BROWSER PROFILE MAP ──────────────────────────────────────────────────────
const BrowserProfileView = () => {
  const profiles = [
    { brand: "Vaulted Rarities", tools: ["TikTok Seller Center", "TikTok Shop Chat", "TikTok DMs", "Instagram DMs", "Outlook Email", "TikTok Streamer Desktop"] },
    { brand: "CardKing47", tools: ["TikTok Seller Center", "TikTok Shop Chat", "TikTok DMs", "Instagram DMs", "TikTok Streamer Desktop"] },
    { brand: "PokeSpins", tools: ["TikTok Seller Center", "TikTok Shop Chat", "TikTok DMs", "TikTok Streamer Desktop"] },
    { brand: "Pokiemart", tools: ["TikTok Seller Center", "TikTok Shop Chat", "TikTok DMs"] },
  ];
  return (
    <div className="space-y-4">
      <div><h2 className="text-2xl font-bold text-gray-900">Browser Profile Map</h2><p className="text-xs text-gray-400 mt-0.5">Each TikTok Shop requires its own isolated browser profile</p></div>
      <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
        <p className="text-amber-800 font-bold text-sm mb-1">Critical Operating Rule</p>
        <p className="text-amber-700 text-sm">Never mix TikTok logins. Each brand stays in its own dedicated browser profile. Shopify is a backend lookup source only — it is never used to process TikTok orders or actions directly.</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {profiles.map(p => (
          <Card key={p.brand} className="p-5">
            <div className="flex items-center gap-2.5 mb-4"><BrandPip brand={p.brand} size="lg" /><h3 className="font-bold text-gray-900">{p.brand}</h3><span className="text-xs text-gray-400 ml-auto border border-gray-200 rounded px-2 py-0.5">Isolated Profile</span></div>
            <div className="space-y-2 mb-4">{p.tools.map(t => <div key={t} className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" /><span className="text-sm text-gray-700">{t}</span></div>)}</div>
            <div className="border-t border-gray-100 pt-3 flex items-center gap-2"><span className="text-gray-400 text-sm">Shopify</span><span className="text-sm text-gray-400">— backend lookup only</span><span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded border border-gray-200 ml-auto">Read-only</span></div>
          </Card>
        ))}
      </div>
      <Card className="p-4">
        <p className="text-sm font-bold text-gray-900 mb-3">Profile Isolation Rules</p>
        <div className="space-y-2">{["Never log into multiple TikTok Shop accounts in the same browser session","Use separate Chrome profiles or browser instances for each brand","Shopify is a backend lookup source — do not use it to perform TikTok order actions","Instagram DMs for Vaulted Rarities and CardKing47 stay in their respective profiles","Outlook Email is only used within the Vaulted Rarities profile"].map((r, i) => <div key={i} className="flex items-start gap-2"><span className="text-gray-400 flex-shrink-0 mt-0.5">{i + 1}.</span><span className="text-sm text-gray-600">{r}</span></div>)}</div>
      </Card>
    </div>
  );
};

// ─── CS TEMPLATES ─────────────────────────────────────────────────────────────
const CSTemplateView = ({ setTickets }) => {
  const [brand, setBrand] = useState("");
  const [issue, setIssue] = useState("");
  const [tone, setTone] = useState("Friendly");
  const [order, setOrder] = useState("");
  const [cname, setCname] = useState("");
  const [tpl, setTpl] = useState("");
  const [copied, setCopied] = useState(false);
  const [ticketCreated, setTicketCreated] = useState(false);

  const gen = useCallback((overrideIssue, overrideTone) => {
    const i = overrideIssue || issue;
    const t = overrideTone || tone;
    if (!brand || !i) return;
    setIssue(i);
    if (overrideTone) setTone(overrideTone);
    setTpl(generateTemplate(brand, i, t, order, cname));
    setTicketCreated(false);
  }, [brand, issue, tone, order, cname]);

  const copy = () => { navigator.clipboard.writeText(tpl); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  // Supabase insert, then add the inserted row to the visible queue
  const createTicket = async () => {
    if (!brand || !issue || !tpl) return;
    const newTicket = {
      brand,
      channel: "Shop Chat",
      issueType: issue,
      priority: "Medium",
      slaRisk: "No",
      status: "New",
      notes: `Template sent: ${issue}`,
      nextAction: "Awaiting customer response",
      createdAt: nowISO(),
      source: "cs-template",
    };
    const { data, error } = await insertTicketToSupabase(newTicket);
    if (error) return alert(`Ticket save failed: ${error.message || "Unknown Supabase error"}`);
    setTickets(prev => [data, ...prev]);
    setTicketCreated(true);
  };

  return (
    <div className="space-y-4">
      <div><h2 className="text-2xl font-bold text-gray-900">CS Template Quick Picker</h2><p className="text-xs text-gray-400 mt-0.5">Generate and send customer service replies</p></div>

      {/* Quick template buttons */}
      <Card className="p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Quick Templates</p>
        <div className="flex flex-wrap gap-2">
          {QUICK_TEMPLATES.map(qt => (
            <button key={qt.issueType} onClick={() => { setIssue(qt.issueType); setTone(qt.tone); if (brand) setTpl(generateTemplate(brand, qt.issueType, qt.tone, order, cname)); }}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors cursor-pointer ${issue === qt.issueType ? "bg-blue-600 text-white border-blue-700" : "bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:text-blue-700"}`}>
              {qt.label}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-5 gap-4">
        {/* Form */}
        <div className="col-span-2 space-y-3">
          <Card className="p-4">
            <p className="text-sm font-bold text-gray-900 mb-3">Response Settings</p>
            <div className="space-y-2">
              <div><FL>Brand *</FL><Sel value={brand} onChange={setBrand} options={BRANDS} placeholder="Select brand..." /></div>
              <div><FL>Issue Type *</FL><Sel value={issue} onChange={setIssue} options={ISSUE_TYPES} placeholder="Select issue..." /></div>
              <div><FL>Tone</FL><Sel value={tone} onChange={setTone} options={TONES} placeholder="Select tone..." /></div>
              <div><FL>Customer Name</FL><Inp value={cname} onChange={setCname} placeholder="e.g. Sarah" /></div>
              <div><FL>Order Number</FL><Inp value={order} onChange={setOrder} placeholder="e.g. VR-10291" /></div>
            </div>
            <div className="mt-4 flex gap-2">
              <BtnPrimary onClick={() => gen()} size="md" disabled={!brand || !issue}>Generate</BtnPrimary>
              <BtnSecondary onClick={() => { setTpl(""); setOrder(""); setCname(""); setTicketCreated(false); }} size="md">Clear</BtnSecondary>
            </div>
          </Card>
        </div>

        {/* Preview */}
        <div className="col-span-3">
          <Card className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-900">Template Preview</p>
              {tpl && (
                <div className="flex gap-2">
                  <BtnSuccess onClick={copy} size="sm">{copied ? "Copied!" : "Copy"}</BtnSuccess>
                  <BtnSecondary onClick={createTicket} size="sm" disabled={ticketCreated}>
                    {ticketCreated ? "Ticket created" : "Create ticket"}
                  </BtnSecondary>
                </div>
              )}
            </div>
            <div className="p-4 flex-1">
              {tpl
                ? <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">{tpl}</pre>
                : <div className="h-full flex flex-col items-center justify-center text-center py-12">
                    <p className="text-gray-400 text-sm mb-1">Generated response will appear here.</p>
                    <p className="text-gray-300 text-xs">Select a brand and issue type, then click Generate or use a quick template above.</p>
                  </div>
              }
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

// ─── REPLACEMENT LOG ──────────────────────────────────────────────────────────
const ReplacementLogView = ({ replacements, setReplacements }) => {
  const emptyF = { date: todayDate(), brand: "", orderNum: "", reason: "", rootCause: "", marketValue: "", preventable: "No", followUp: "No", notes: "" };
  const [form, setForm] = useState(emptyF);
  const [show, setShow] = useState(false);
  const f = k => v => setForm(p => ({ ...p, [k]: v }));
  const add = () => {
    if (!form.brand || !form.orderNum) return;
    setReplacements(p => [{ id: uid(), ...form, marketValue: parseFloat(form.marketValue) || 0 }, ...p]);
    setForm(emptyF); setShow(false);
  };
  const loss = replacements.reduce((a, r) => a + parseFloat(r.marketValue || 0), 0);
  const prev = replacements.filter(r => r.preventable === "Yes").length;
  const fu = replacements.filter(r => r.followUp === "Yes").length;
  const rc = ROOT_CAUSES.map(c => ({ c, n: replacements.filter(r => r.rootCause === c).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h2 className="text-2xl font-bold text-gray-900">Shipping Replacement &amp; Loss Log</h2><p className="text-xs text-gray-400 mt-0.5">Track every replacement case and estimated loss</p></div>
        <BtnPrimary onClick={() => setShow(s => !s)} size="md">{show ? "✕ Close" : "+ Log Replacement"}</BtnPrimary>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Card className="p-4"><p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Cases Logged</p><p className="text-3xl font-bold text-gray-900 mt-1">{replacements.length}</p></Card>
        <Card className="p-4"><p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Estimated Loss</p><p className="text-3xl font-bold text-red-600 mt-1">${loss.toFixed(2)}</p></Card>
        <Card className="p-4"><p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Preventable</p><p className="text-3xl font-bold text-amber-600 mt-1">{prev}</p><p className="text-xs text-gray-400 mt-0.5">{replacements.length > 0 ? Math.round((prev / replacements.length) * 100) : 0}% of total</p></Card>
        <Card className="p-4"><p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Follow-Up Needed</p><p className="text-3xl font-bold text-blue-600 mt-1">{fu}</p></Card>
      </div>
      {rc.length > 0 && (
        <Card className="p-4">
          <p className="text-sm font-bold text-gray-900 mb-3">Root Cause Breakdown</p>
          <div className="space-y-2">{rc.slice(0, 5).map(({ c, n }) => <div key={c} className="flex items-center gap-3"><span className="text-xs text-gray-500 w-44 truncate">{c}</span><div className="flex-1"><ProgressBar pct={(n / replacements.length) * 100} color="bg-red-400" /></div><span className="text-xs text-gray-400 w-6 text-right">{n}</span></div>)}</div>
        </Card>
      )}
      {show && (
        <Card className="p-4">
          <p className="text-sm font-bold text-gray-900 mb-3">Log New Replacement Case</p>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div><FL>Date</FL><Inp type="date" value={form.date} onChange={f("date")} /></div>
            <div><FL>Brand *</FL><Sel value={form.brand} onChange={f("brand")} options={BRANDS} placeholder="Select..." /></div>
            <div><FL>Order # *</FL><Inp value={form.orderNum} onChange={f("orderNum")} placeholder="e.g. VR-10291" /></div>
            <div><FL>Market Value ($)</FL><Inp type="number" value={form.marketValue} onChange={f("marketValue")} placeholder="0.00" /></div>
            <div className="col-span-2"><FL>Replacement Reason</FL><Inp value={form.reason} onChange={f("reason")} placeholder="e.g. Missing item in sealed pack" /></div>
            <div><FL>Root Cause</FL><Sel value={form.rootCause} onChange={f("rootCause")} options={ROOT_CAUSES} placeholder="Select..." /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><FL>Preventable</FL><Sel value={form.preventable} onChange={f("preventable")} options={["Yes", "No"]} placeholder="" /></div>
              <div><FL>Follow-Up</FL><Sel value={form.followUp} onChange={f("followUp")} options={["Yes", "No"]} placeholder="" /></div>
            </div>
            <div className="col-span-2"><FL>Notes</FL><Txt value={form.notes} onChange={f("notes")} rows={2} /></div>
          </div>
          <BtnPrimary onClick={add} size="md">Log Replacement</BtnPrimary>
        </Card>
      )}
      <Card>
        <p className="text-sm font-bold text-gray-900 px-4 pt-4 pb-2">Replacement Cases</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="bg-gray-50 border-y border-gray-100">{["Date", "Brand", "Order #", "Reason", "Root Cause", "Value", "Prev.", "Follow-Up"].map(h => <th key={h} className="text-left px-4 py-2.5 font-semibold text-gray-500">{h}</th>)}</tr></thead>
            <tbody>
              {replacements.map(r => (
                <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-500">{r.date}</td>
                  <td className="px-4 py-2.5"><div className="flex items-center gap-1.5"><BrandPip brand={r.brand} /><span className="text-gray-700">{r.brand}</span></div></td>
                  <td className="px-4 py-2.5 font-mono text-gray-800">{r.orderNum}</td>
                  <td className="px-4 py-2.5 text-gray-600 max-w-[140px] truncate">{r.reason}</td>
                  <td className="px-4 py-2.5 text-gray-600">{r.rootCause}</td>
                  <td className="px-4 py-2.5 text-green-700 font-bold">${parseFloat(r.marketValue || 0).toFixed(2)}</td>
                  <td className="px-4 py-2.5"><Badge label={r.preventable} className={r.preventable === "Yes" ? "bg-red-50 text-red-700 border-red-200" : "bg-gray-100 text-gray-500 border-gray-200"} /></td>
                  <td className="px-4 py-2.5"><Badge label={r.followUp} className={r.followUp === "Yes" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-gray-100 text-gray-500 border-gray-200"} /></td>
                </tr>
              ))}
              {replacements.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-gray-300">No replacement cases logged</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

// ─── STUDIO READINESS ─────────────────────────────────────────────────────────
const StudioReadinessView = ({ studios, setStudios }) => {
  const upd = (id, field, val) => setStudios(p => p.map(s => s.id === id ? { ...s, [field]: val } : s));
  const score = s => { let sc = 0; if (s.countCompleted) sc += 25; if (s.fullyStocked) sc += 25; if (s.discrepanciesLogged === 0 || s.discrepanciesResolved === s.discrepanciesLogged) sc += 25; if (s.streamReady) sc += 25; return sc; };
  const overall = Math.round(studios.reduce((a, s) => a + score(s), 0) / studios.length);
  return (
    <div className="space-y-4">
      <div><h2 className="text-2xl font-bold text-gray-900">Inventory &amp; Studio Readiness</h2><p className="text-xs text-gray-400 mt-0.5">Track station counts, stock levels, and stream readiness</p></div>
      <Card className="p-4 flex items-center gap-6">
        <div className="text-center"><p className="text-xs text-gray-400 mb-1">Overall Readiness</p><p className={`text-5xl font-bold ${overall >= 75 ? "text-green-600" : overall >= 50 ? "text-amber-500" : "text-red-500"}`}>{overall}%</p></div>
        <div className="flex-1"><ProgressBar pct={overall} color={overall >= 75 ? "bg-green-500" : overall >= 50 ? "bg-amber-400" : "bg-red-500"} /><p className="text-xs text-gray-400 mt-1.5">{studios.filter(s => s.streamReady).length}/{studios.length} stations stream-ready</p></div>
      </Card>
      <div className="grid grid-cols-2 gap-4">
        {studios.map(s => {
          const sc = score(s);
          return (
            <Card key={s.id} className={`p-5 ${s.streamReady ? "border-green-300" : ""}`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-900">{s.id}</h3>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${sc >= 75 ? "text-green-600" : sc >= 50 ? "text-amber-500" : "text-red-500"}`}>{sc}%</span>
                  <Badge label={s.streamReady ? "Stream Ready" : "Not Ready"} className={s.streamReady ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"} />
                </div>
              </div>
              <ProgressBar pct={sc} color={sc >= 75 ? "bg-green-500" : sc >= 50 ? "bg-amber-400" : "bg-red-500"} />
              <div className="mt-3 space-y-2">
                {[["countCompleted", "Count Completed"], ["fullyStocked", "Fully Stocked"], ["streamReady", "Stream Ready"]].map(([field, label]) => (
                  <label key={field} className="flex items-center justify-between cursor-pointer">
                    <span className="text-xs text-gray-500">{label}</span>
                    <input type="checkbox" checked={s[field]} onChange={e => upd(s.id, field, e.target.checked)} className="accent-blue-600" />
                  </label>
                ))}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Discrepancies</span>
                  <input type="number" min="0" value={s.discrepanciesLogged} onChange={e => upd(s.id, "discrepanciesLogged", parseInt(e.target.value) || 0)} className="w-10 border border-gray-300 rounded text-xs px-1 py-0.5 text-gray-700" />
                  <span className="text-gray-400 text-xs">logged /</span>
                  <input type="number" min="0" value={s.discrepanciesResolved} onChange={e => upd(s.id, "discrepanciesResolved", parseInt(e.target.value) || 0)} className="w-10 border border-gray-300 rounded text-xs px-1 py-0.5 text-gray-700" />
                  <span className="text-gray-400 text-xs">resolved</span>
                </div>
              </div>
              <div className="mt-3"><Txt value={s.notes} onChange={v => upd(s.id, "notes", v)} placeholder="Station notes..." rows={2} /></div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

// ─── SURPRISE SET TRACKER ─────────────────────────────────────────────────────
const SurpriseSetView = ({ surpriseSets, setSurpriseSets }) => {
  const emptyF = { brand: "", streamer: "Jonny", date: todayDate(), setName: "", quantity: "", warehouseListReceived: false, convertedSetSheet: false, importedDesktop: false, quantitiesVerified: false, readyForLive: false };
  const [form, setForm] = useState(emptyF);
  const [show, setShow] = useState(false);
  const STEPS = ["warehouseListReceived", "convertedSetSheet", "importedDesktop", "quantitiesVerified", "readyForLive"];
  const SL = { warehouseListReceived: "Warehouse List", convertedSetSheet: "SetSheet", importedDesktop: "Imported", quantitiesVerified: "Qty Verified", readyForLive: "Ready for Live" };
  const f = k => v => setForm(p => ({ ...p, [k]: v }));
  const add = () => { if (!form.brand || !form.setName) return; setSurpriseSets(p => [{ id: uid(), ...form, quantity: parseInt(form.quantity) || 0 }, ...p]); setForm(emptyF); setShow(false); };
  const upd = (id, field, val) => setSurpriseSets(p => p.map(s => s.id === id ? { ...s, [field]: val } : s));
  const prog = s => Math.round((STEPS.filter(st => s[st]).length / STEPS.length) * 100);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h2 className="text-2xl font-bold text-gray-900">Surprise Set Tracker</h2><p className="text-xs text-gray-400 mt-0.5">{surpriseSets.filter(s => s.readyForLive).length}/{surpriseSets.length} sets ready for live</p></div>
        <BtnPrimary onClick={() => setShow(s => !s)} size="md">{show ? "✕ Close" : "+ Add Set"}</BtnPrimary>
      </div>
      {show && (
        <Card className="p-4">
          <p className="text-sm font-bold text-gray-900 mb-3">New Surprise Set</p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <Sel value={form.brand} onChange={f("brand")} options={BRANDS} placeholder="Brand *" />
            <Inp value={form.streamer} onChange={f("streamer")} placeholder="Streamer" />
            <Inp type="date" value={form.date} onChange={f("date")} />
            <Inp value={form.quantity} onChange={f("quantity")} placeholder="Quantity" type="number" />
            <div className="col-span-2"><Inp value={form.setName} onChange={f("setName")} placeholder="Set Name *" /></div>
          </div>
          <div className="flex flex-wrap gap-4 mb-3">{STEPS.map(step => <label key={step} className="flex items-center gap-2 cursor-pointer text-xs text-gray-600"><input type="checkbox" checked={form[step]} onChange={e => setForm(p => ({ ...p, [step]: e.target.checked }))} className="accent-blue-600" />{SL[step]}</label>)}</div>
          <BtnPrimary onClick={add} size="md">Add Set</BtnPrimary>
        </Card>
      )}
      <div className="space-y-3">
        {surpriseSets.map(s => (
          <Card key={s.id} className={`p-4 ${s.readyForLive ? "border-green-300" : ""}`}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <BrandPip brand={s.brand} />
                  <span className="text-sm font-bold text-gray-900">{s.setName}</span>
                  <span className="text-xs text-gray-400">{s.brand}</span>
                  <Badge label={s.readyForLive ? "Ready for Live" : "Not Ready"} className={s.readyForLive ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-500 border-gray-200"} />
                </div>
                <p className="text-xs text-gray-400">{s.date} · Streamer: {s.streamer} · Qty: {s.quantity}</p>
              </div>
              <span className={`text-lg font-bold ${prog(s) === 100 ? "text-green-600" : "text-amber-500"}`}>{prog(s)}%</span>
            </div>
            <ProgressBar pct={prog(s)} color={prog(s) === 100 ? "bg-green-500" : "bg-amber-400"} />
            <div className="flex flex-wrap gap-4 mt-3">
              {STEPS.map(step => (
                <label key={step} className="flex items-center gap-1.5 cursor-pointer text-xs">
                  <input type="checkbox" checked={s[step]} onChange={e => upd(s.id, step, e.target.checked)} className="accent-blue-600" />
                  <span className={s[step] ? "text-green-600 font-medium" : "text-gray-400"}>{SL[step]}</span>
                </label>
              ))}
            </div>
          </Card>
        ))}
        {surpriseSets.length === 0 && <div className="text-center py-12 text-gray-300">No surprise sets added yet</div>}
      </div>
    </div>
  );
};

// ─── WEEKLY RAISE TRACKER ─────────────────────────────────────────────────────
const WeeklyRaiseView = ({ tickets, replacements, studios, surpriseSets, raiseScores, setRaiseScores }) => {
  const [improvements, setImprovements] = useState("");
  const [risks, setRisks] = useState("");
  const [nextFocus, setNextFocus] = useState("");
  const [mode, setMode] = useState("full");
  const [copied, setCopied] = useState(false);

  const data = { tickets, replacements, studios, surpriseSets, raiseScores, improvements, risks, nextFocus };
  const report = mode === "slack" ? buildSlackSummary(data) : buildFullReport(data);

  const copy = () => { navigator.clipboard.writeText(report); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const exportTxt = () => {
    const b = new Blob([report], { type: "text/plain" });
    const u = URL.createObjectURL(b);
    const a = document.createElement("a"); a.href = u; a.download = `jonny-ops-report-${todayDate()}.txt`; a.click();
    URL.revokeObjectURL(u);
  };

  const RF = [
    { key: "consistency", label: "Consistency" },
    { key: "accuracy", label: "Accuracy" },
    { key: "lossReduction", label: "Loss Reduction" },
    { key: "ownership", label: "Ownership" },
    { key: "processImprovement", label: "Process Improvement" },
  ];

  return (
    <div className="space-y-4">
      <div><h2 className="text-2xl font-bold text-gray-900">Weekly Raise Tracker Report</h2><p className="text-xs text-gray-400 mt-0.5">Leadership-ready — auto-generated from your logged data</p></div>
      <Card className="p-4">
        <p className="text-sm font-bold text-gray-900 mb-3">Raise Path Self-Score</p>
        <div className="space-y-3">
          {RF.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-36">{label}</span>
              <input type="range" min="0" max="100" step="5" value={raiseScores[key]} onChange={e => setRaiseScores(s => ({ ...s, [key]: parseInt(e.target.value) }))} className="flex-1 accent-blue-600" />
              <span className="text-xs text-gray-500 w-8 text-right font-mono">{raiseScores[key]}%</span>
            </div>
          ))}
        </div>
      </Card>
      <div className="space-y-3">
        <div><FL>Process Improvements Made This Week</FL><Txt value={improvements} onChange={setImprovements} placeholder="e.g. Added photo request step to damage workflow. Cleaned up Shop Chat sweep process." rows={3} /></div>
        <div><FL>Risks / Blockers</FL><Txt value={risks} onChange={setRisks} placeholder="e.g. TT-04 still not stream-ready. 3 SLA risk tickets require same-day action." rows={3} /></div>
        <div><FL>Next Week's Focus</FL><Txt value={nextFocus} onChange={setNextFocus} placeholder="e.g. Clear SLA risk queue. Complete TT-04 readiness. Review repeat replacement root causes." rows={2} /></div>
      </div>
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex gap-2">
            <button onClick={() => setMode("full")} className={`text-xs px-3 py-1.5 rounded-lg border font-medium cursor-pointer transition-colors ${mode === "full" ? "bg-blue-600 text-white border-blue-700" : "bg-white text-gray-700 border-gray-300 hover:border-blue-400"}`}>Full Report</button>
            <button onClick={() => setMode("slack")} className={`text-xs px-3 py-1.5 rounded-lg border font-medium cursor-pointer transition-colors ${mode === "slack" ? "bg-blue-600 text-white border-blue-700" : "bg-white text-gray-700 border-gray-300 hover:border-blue-400"}`}>Slack Summary</button>
          </div>
          <div className="flex gap-2">
            <BtnSuccess onClick={copy} size="sm">{copied ? "Copied!" : "Copy"}</BtnSuccess>
            <BtnSecondary onClick={exportTxt} size="sm">Export TXT</BtnSecondary>
          </div>
        </div>
        <pre className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-gray-700 whitespace-pre-wrap font-mono max-h-96 overflow-y-auto leading-relaxed">{report}</pre>
      </Card>
    </div>
  );
};

// ─── DATA MANAGEMENT ──────────────────────────────────────────────────────────
const DataManagementView = ({ tickets, replacements, studios, surpriseSets, setTickets, setReplacements, setStudios, setSurpriseSets, raiseScores }) => {
  const [confirmClear, setConfirmClear] = useState(false);
  const [importErr, setImportErr] = useState("");
  const [saved, setSaved] = useState(false);

  const dl = (data, name, type) => {
    const b = new Blob([data], { type }); const u = URL.createObjectURL(b);
    const a = document.createElement("a"); a.href = u; a.download = name; a.click();
    URL.revokeObjectURL(u);
  };

  const exportJSON = () => {
    const data = { tickets, replacements, studios, surpriseSets, exportedAt: nowISO() };
    dl(JSON.stringify(data, null, 2), `jonny-ops-backup-${todayDate()}.json`, "application/json");
  };
  const exportTicketsCSV = () => {
    const rows = tickets.map(t => [t.id, `"${t.brand}"`, `"${t.channel}"`, `"${t.issueType}"`, t.priority, t.slaRisk, t.status, `"${t.notes?.replace(/"/g, '""')}"`, `"${t.nextAction?.replace(/"/g, '""')}"`, t.createdAt]);
    dl([["ID", "Brand", "Channel", "Issue Type", "Priority", "SLA Risk", "Status", "Notes", "Next Action", "Created At"], ...rows].map(r => r.join(",")).join("\n"), `tiktok-tickets-${todayDate()}.csv`, "text/csv");
  };
  const exportReplacementsCSV = () => {
    const rows = replacements.map(r => [r.id, r.date, `"${r.brand}"`, r.orderNum, `"${r.reason?.replace(/"/g, '""')}"`, `"${r.rootCause}"`, r.marketValue, r.preventable, r.followUp, `"${r.notes?.replace(/"/g, '""')}"`]);
    dl([["ID", "Date", "Brand", "Order #", "Reason", "Root Cause", "Market Value", "Preventable", "Follow-Up", "Notes"], ...rows].map(r => r.join(",")).join("\n"), `replacement-log-${todayDate()}.csv`, "text/csv");
  };
  const exportReport = () => {
    const rpt = buildFullReport({ tickets, replacements, studios, surpriseSets, raiseScores, improvements: "", risks: "", nextFocus: "" });
    dl(rpt, `jonny-ops-report-${todayDate()}.txt`, "text/plain");
  };

  const importJSON = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.tickets) setTickets(data.tickets);
        if (data.replacements) setReplacements(data.replacements);
        if (data.studios) setStudios(data.studios);
        if (data.surpriseSets) setSurpriseSets(data.surpriseSets);
        setImportErr("");
        setSaved(true); setTimeout(() => setSaved(false), 3000);
      } catch (err) {
        setImportErr("Invalid JSON file. Please use a valid Jonny Ops backup.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const clearAll = () => {
    setTickets([]); setReplacements([]); setStudios(FRESH_STUDIOS); setSurpriseSets([]);
    setConfirmClear(false);
  };

  const resetFresh = () => {
    setTickets([]);
    setReplacements([]);
    setStudios(FRESH_STUDIOS);
    setSurpriseSets([]);
    setConfirmClear(false);
  };

  return (
    <div className="space-y-4">
      <div><h2 className="text-2xl font-bold text-gray-900">Data Management</h2><p className="text-xs text-gray-400 mt-0.5">Export, import, and manage your ops data</p></div>

      {saved && <div className="bg-green-50 border border-green-300 rounded-lg px-4 py-3 text-green-800 text-sm font-medium">Data imported successfully.</div>}
      {importErr && <div className="bg-red-50 border border-red-300 rounded-lg px-4 py-3 text-red-800 text-sm">{importErr}</div>}

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <p className="text-sm font-bold text-gray-900 mb-1">Export JSON Backup</p>
          <p className="text-xs text-gray-400 mb-3">Full backup — tickets, replacements, studios, sets</p>
          <BtnPrimary onClick={exportJSON} size="md">Export JSON Backup</BtnPrimary>
        </Card>
        <Card className="p-4">
          <p className="text-sm font-bold text-gray-900 mb-1">Import JSON Backup</p>
          <p className="text-xs text-gray-400 mb-3">Restore from a previous JSON export</p>
          <label className="inline-flex items-center gap-1.5 bg-white hover:bg-gray-50 text-gray-700 font-medium rounded-lg border border-gray-300 transition-colors cursor-pointer px-4 py-2 text-sm">
            Import JSON
            <input type="file" accept=".json" onChange={importJSON} className="hidden" />
          </label>
        </Card>
        <Card className="p-4">
          <p className="text-sm font-bold text-gray-900 mb-1">Export Tickets CSV</p>
          <p className="text-xs text-gray-400 mb-3">{tickets.length} tickets → spreadsheet</p>
          <BtnSecondary onClick={exportTicketsCSV} size="md">Export Tickets CSV</BtnSecondary>
        </Card>
        <Card className="p-4">
          <p className="text-sm font-bold text-gray-900 mb-1">Export Replacements CSV</p>
          <p className="text-xs text-gray-400 mb-3">{replacements.length} cases → spreadsheet</p>
          <BtnSecondary onClick={exportReplacementsCSV} size="md">Export Replacements CSV</BtnSecondary>
        </Card>
        <Card className="p-4">
          <p className="text-sm font-bold text-gray-900 mb-1">Export Weekly Report</p>
          <p className="text-xs text-gray-400 mb-3">Auto-generate report from current data</p>
          <BtnSecondary onClick={exportReport} size="md">Export Report TXT</BtnSecondary>
        </Card>
        <Card className="p-4">
          <p className="text-sm font-bold text-gray-900 mb-1">Session Stats</p>
          <div className="space-y-1.5 mt-2">
            {[["Tickets", tickets.length], ["Replacements", replacements.length], ["Studios tracked", studios.length], ["Surprise sets", surpriseSets.length]].map(([k, v]) => <div key={k} className="flex justify-between text-xs"><span className="text-gray-400">{k}</span><span className="font-semibold text-gray-800">{v}</span></div>)}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <p className="text-sm font-bold text-gray-900 mb-3">Reset &amp; Clear</p>
        {!confirmClear ? (
          <div className="flex gap-2">
            <BtnSecondary onClick={resetFresh} size="md">Reset to Fresh Data</BtnSecondary>
            <BtnDanger onClick={() => setConfirmClear(true)} size="md">Clear All Data</BtnDanger>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-sm text-gray-700">This will erase all tickets, replacements, and sets. Are you sure?</p>
            <BtnDanger onClick={clearAll} size="md">Yes, Clear All</BtnDanger>
            <BtnSecondary onClick={() => setConfirmClear(false)} size="md">Cancel</BtnSecondary>
          </div>
        )}
      </Card>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm font-bold text-blue-800 mb-1">Supabase Sync Active</p>
        <p className="text-xs text-blue-700">All ticket data is read from and written to your Supabase <code className="font-mono bg-blue-100 px-1 rounded">tickets</code> table. Export a JSON backup regularly for off-database safety.</p>
      </div>
    </div>
  );
};

// ─── OP SIDEKICK HASH BRIDGE ─────────────────────────────────────────────────
const normalizeSidekickBrand = (brand, brandCode) => {
  const value = (brand || brandCode || "").toString().trim();
  const upper = value.toUpperCase();
  if (upper === "VR" || value === "Vaulted Rarities") return "Vaulted Rarities";
  if (upper === "CK47" || upper === "CK" || value === "CardKing47") return "CardKing47";
  if (upper === "PS" || value === "PokeSpins") return "PokeSpins";
  if (upper === "PM" || value === "Pokiemart") return "Pokiemart";
  return BRANDS.includes(value) ? value : "Vaulted Rarities";
};

const normalizeSidekickIssue = (issueType) => {
  const raw = (issueType || "Other").toString().trim();
  const withoutQuestion = raw.replace(/\?$/, "");
  if (ISSUE_TYPES.includes(raw)) return raw;
  if (ISSUE_TYPES.includes(withoutQuestion)) return withoutQuestion;
  return "Other";
};

const normalizeSidekickStatus = (status) => {
  const raw = (status || "New").toString().trim();
  return KANBAN_COLS.includes(raw) ? raw : "New";
};

const normalizeSidekickPriority = (priority) => {
  const raw = (priority || "Medium").toString().trim();
  return PRIORITIES.includes(raw) ? raw : "Medium";
};

const normalizeSidekickSlaRisk = (slaRisk) => {
  if (slaRisk === true) return "Yes";
  if (slaRisk === false) return "No";
  const raw = (slaRisk || "No").toString().trim().toLowerCase();
  return ["yes", "true", "1", "high", "sla"].includes(raw) ? "Yes" : "No";
};

const decodeSidekickPayload = (encoded) => {
  if (!encoded) return null;
  const cleaned = encoded.trim();
  try {
    return JSON.parse(decodeURIComponent(cleaned));
  } catch (err) { /* fall through */ }
  try {
    const base64 = cleaned.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    return JSON.parse(decodeURIComponent(escape(window.atob(padded))));
  } catch (err) {
    return null;
  }
};

const getSidekickTicketFromHash = () => {
  const hash = window.location.hash || "";
  if (!hash.includes("sidekick_ticket=")) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const rawTicket = decodeSidekickPayload(params.get("sidekick_ticket"));
  if (!rawTicket || typeof rawTicket !== "object") return null;

  const brand = normalizeSidekickBrand(rawTicket.brand, rawTicket.brandCode);
  const orderNumber = rawTicket.orderNumber || rawTicket.orderNum || rawTicket.order || "";
  const customerName = rawTicket.customerName || rawTicket.customer || rawTicket.customer_name || "";
  const issueType = normalizeSidekickIssue(rawTicket.issueType || rawTicket.type);
  const notes = rawTicket.notes || rawTicket.description || rawTicket.message || "";
  const nextAction = rawTicket.nextAction || rawTicket.next_action || "Review in TikTok Seller Center and update status.";

  return {
    id: rawTicket.id || `SK-${uid()}`,
    brand,
    brandCode: BRAND_SHORT[brand],
    channel: rawTicket.channel || "TikTok Shop",
    issueType,
    priority: normalizeSidekickPriority(rawTicket.priority),
    slaRisk: normalizeSidekickSlaRisk(rawTicket.slaRisk),
    status: normalizeSidekickStatus(rawTicket.status),
    orderNumber,
    customerName,
    notes,
    nextAction,
    createdAt: rawTicket.createdAt || nowISO(),
    source: "OP Sidekick",
  };
};

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function JonnyOpsCommandCenter() {
  const [activeView, setActiveView] = useState("dashboard");
  // ── CHANGE 3: Start with empty array; Supabase fetch populates on mount ──
  const [tickets, setTickets] = useState([]);
  const [replacements, setReplacements] = useState([]);
  const [studios, setStudios] = useState(FRESH_STUDIOS);
  const [surpriseSets, setSurpriseSets] = useState([]);
  const [raiseScores, setRaiseScores] = useState({ consistency: 72, accuracy: 68, lossReduction: 55, ownership: 80, processImprovement: 60 });
  const [sidebar, setSidebar] = useState(true);
  const [sidekickToast, setSidekickToast] = useState(false);

  // Fetch all tickets from Supabase on mount, ordered by created_at desc
  useEffect(() => {
    const fetchTickets = async () => {
      const { data } = await fetchTicketsFromSupabase();
      if (data) setTickets(data);
    };
    fetchTickets();
  }, []);

  // OP Sidekick — INSERT into Supabase, then refresh list
  useEffect(() => {
    const ticket = getSidekickTicketFromHash();
    if (!ticket) return;

    const insertSidekickTicket = async () => {
      const { data, error } = await insertTicketToSupabase({ ...ticket, source: "OP Sidekick" });
      if (error) {
        alert(`Sidekick ticket save failed: ${error.message || "Unknown Supabase error"}`);
        return;
      }
      setTickets(prev => [data, ...prev]);
      setActiveView("tickets");
      setSidekickToast(true);
      setTimeout(() => setSidekickToast(false), 3500);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    };

    insertSidekickTicket();
  }, []);

  // ── CHANGE 6: No localStorage save/load anywhere in this file ──

  const openCount = tickets.filter(t => t.status !== "Resolved").length;
  const criticalSlaCount = tickets.filter(isActiveSlaRisk).length;

  const renderView = () => {
    const common = { tickets, setTickets, replacements, setReplacements, studios, setStudios, surpriseSets, setSurpriseSets, raiseScores, setRaiseScores };
    switch (activeView) {
      case "dashboard": return <DashboardView {...common} />;
      case "daily": return <DailyCommandView tickets={tickets} />;
      case "tickets": return <TicketQueueView tickets={tickets} setTickets={setTickets} />;
      case "browser": return <BrowserProfileView />;
      case "cs": return <CSTemplateView setTickets={setTickets} />;
      case "replacements": return <ReplacementLogView replacements={replacements} setReplacements={setReplacements} />;
      case "studio": return <StudioReadinessView studios={studios} setStudios={setStudios} />;
      case "sets": return <SurpriseSetView surpriseSets={surpriseSets} setSurpriseSets={setSurpriseSets} />;
      case "weekly": return <WeeklyRaiseView tickets={tickets} replacements={replacements} studios={studios} surpriseSets={surpriseSets} raiseScores={raiseScores} setRaiseScores={setRaiseScores} />;
      case "data": return <DataManagementView {...common} />;
      default: return null;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#f3f4f6", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      {sidekickToast && (
        <div
          className="fixed right-6 bottom-20 z-[9999] flex items-center gap-2 rounded-lg border border-green-700 bg-green-600 px-4 py-3 text-sm font-semibold text-white shadow-lg"
          role="status"
        >
          <span>✓</span>
          <span>Ticket pushed from OP Sidekick.</span>
        </div>
      )}

      {/* Sidebar */}
      <aside style={{ width: sidebar ? 224 : 56, transition: "width .2s" }} className="flex-shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="white" strokeWidth="1.4"/><path d="M8 5.5v2.5l1.5 1.5" stroke="white" strokeWidth="1.4" strokeLinecap="round"/></svg>
          </div>
          {sidebar && <div className="overflow-hidden flex-1"><p className="text-sm font-bold text-gray-900 truncate">Jonny Ops</p><p className="text-[10px] text-gray-400 truncate">Command Center v1.1</p></div>}
          <button onClick={() => setSidebar(s => !s)} className="text-gray-300 hover:text-gray-600 flex-shrink-0 text-xs ml-auto">{sidebar ? "«" : "»"}</button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          {NAV.map((section, si) => (
            <div key={si}>
              {section.section && sidebar && <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3 mb-1">{section.section}</p>}
              <div className="space-y-0.5">
                {section.items.map(item => (
                  <NavItem key={item.id} {...item} active={activeView === item.id} onClick={setActiveView}
                    badge={item.id === "tickets" ? criticalSlaCount : 0} />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-gray-100 px-3 py-3 flex-shrink-0">
          {sidebar ? (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0"><span className="text-xs font-bold text-gray-600">JV</span></div>
              <div className="overflow-hidden"><p className="text-xs font-semibold text-gray-700 truncate">Jonny Valencia</p><p className="text-[10px] text-gray-400 truncate">Outerplanesgames</p></div>
            </div>
          ) : (
            <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center mx-auto"><span className="text-xs font-bold text-gray-600">JV</span></div>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
          <p className="text-sm font-bold text-gray-900">Jonny Ops Command Center</p>
          <div className="flex items-center gap-3">
            {criticalSlaCount > 0 && (
              <button onClick={() => setActiveView("tickets")} className="flex items-center gap-1.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-3 py-1.5 cursor-pointer transition-colors">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-xs font-bold text-red-700">{criticalSlaCount} SLA Critical</span>
              </button>
            )}
            <button className="text-gray-400 hover:text-gray-600">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.4"/><path d="M9 8v4M9 6.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            </button>
            <div className="relative">
              <button onClick={() => setActiveView("tickets")} className="text-gray-400 hover:text-gray-600">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2a5 5 0 0 1 5 5v3l2 2H2l2-2V7a5 5 0 0 1 5-5z" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M7 15.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              </button>
              {openCount > 0 && <span className="absolute -top-1 -right-1 text-[9px] bg-red-500 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">{openCount > 9 ? "9+" : openCount}</span>}
            </div>
            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center"><span className="text-xs font-bold text-gray-600">JV</span></div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto" style={{ background: "#f3f4f6" }}>
          <div className="max-w-screen-xl mx-auto px-6 py-5">{renderView()}</div>
        </main>
      </div>
    </div>
  );
}