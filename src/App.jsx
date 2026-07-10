import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from '@supabase/supabase-js';

// ─── SUPABASE CLIENT ──────────────────────────────────────────────────────────
const supabaseUrl = "https://hljotjdrgabhmqgorbpo.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhsam90amRyZ2FiaG1xZ29yYnBvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NjYzMzAsImV4cCI6MjA5NDE0MjMzMH0.KojT8NA3qias7s-ljAN92LTnpBWvtbJwxvAAUU5FIIw";
const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
const MAKE_INTAKE_WEBHOOK_URL = "https://hook.us2.make.com/ndd4uty3uvua7lmgqxg9lsmjvd61i3ih";
const LAST_SEEN_MESSAGE_STORAGE_KEY = "ops_command_hub_last_seen_message_at";
const INBOUND_MESSAGES_TABLE = "work_queue";
const SHELL_UNLOCK_STORAGE_KEY = "jonny_ops_shell_unlocked_v3";

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
const BRAND_DOT = { "Vaulted Rarities": "#FACC15", "Vaulted": "#FACC15", "VR": "#FACC15", "CardKing47": "#2563EB", "CardKing": "#2563EB", "CK47": "#2563EB", "CK": "#2563EB", "PokeSpins": "#DC2626", "PS": "#DC2626", "Pokiemart": "#16A34A", "PokieMart": "#16A34A", "PM": "#16A34A", "Unassigned": "#CBD5E1" };
const brandChannelConfig = {
  vaultedRarities: {
    label: "Vaulted Rarities",
    aliases: ["Vaulted Rarities", "VR", "Vaulted", "VaultedSupport"],
    tiktokShopChatUrl: "https://seller-us.tiktok.com/chat/inbox/current?from=customer_enter_from_order_list&lang=en&oec_seller_id=7496129140166986165&shop_region=US&version=v2",
    windowTarget: "tiktok_shop_chat_vaulted_rarities",
  },
  pokeSpins: {
    label: "PokeSpins",
    aliases: ["PokeSpins", "PS", "Poke Spins"],
    tiktokShopChatUrl: "https://seller-us.tiktok.com/chat/inbox/current?oec_seller_id=7494390620994242403&shop_region=US&lang=en&from=seller_center_navigation_im",
    windowTarget: "tiktok_shop_chat_pokespins",
  },
  cardKing47: {
    label: "CardKing47",
    aliases: ["CardKing47", "CK", "CardKing", "Card King"],
    tiktokShopChatUrl: "https://seller-us.tiktok.com/chat/inbox/current?oec_seller_id=7496169249187334473&shop_region=US&lang=en&from=seller_center_navigation_im",
    windowTarget: "tiktok_shop_chat_cardking47",
  },
  pokieMart: {
    label: "PokieMart",
    aliases: ["PokieMart", "Pokiemart", "PM", "Pokie Mart", "PokeMart"],
    tiktokShopChatUrl: "https://seller-us.tiktok.com/chat/inbox/current?from=seller_center_navigation_im&oec_seller_id=7494572492552308160&shop_region=US&lang=en",
    windowTarget: "tiktok_shop_chat_pokiemart",
  },
};
const replacementBrandLabel = (brand) => {
  if (brand === "CardKing47" || brand === "CardKing") return "CardKing";
  if (brand === "PokeSpins" || brand === "PS") return "PokeSpins";
  return brand || "";
};

const CHANNELS = ["TikTok Shop", "Refund / Return", "Shop Chat", "TikTok DM", "Instagram DM", "Email"];
const ISSUE_TYPES = ["Where is my order", "Refund request", "Return request", "Surprise set dispute", "Missing item", "Damaged item", "Wrong item", "Label created / no scan", "Hostile customer", "Other"];
const PRIORITIES = ["High", "Medium", "Low"];
const KANBAN_COLS = ["New", "In Progress", "Waiting on Customer", "Backend Lookup", "Resolved", "Escalated"];
const TONES = ["Friendly", "Firm", "Apology", "Investigation", "Final-sale policy"];
const ROOT_CAUSES = ["Carrier delay", "Lost in transit", "Wrong item packed", "Missing item in pack", "Damaged in shipping", "Customer error", "Warehouse error", "Surprise set dispute", "Other"];

// ─── AUTO-ARCHIVE AGE THRESHOLDS (req 6) ─────────────────────────────────────
const RESOLVED_MAX_DAYS = 7;
const ESCALATED_MAX_DAYS = 14;

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

// ─── PATCH 1: fetchTicketsFromSupabase - active-only + auto-archive filter ───
// Fetches only rows where archived_at IS NULL.
// Resolved tickets older than 7 days and Escalated tickets older than 14 days
// are excluded client-side so they silently age out without touching Supabase.
const fetchTicketsFromSupabase = async () => {
  if (!supabase) {
    console.warn("Supabase env vars missing. Showing an empty ticket queue.");
    return { data: [], error: null };
  }

  const { data, error } = await supabase
    .from("tickets")
    .select("*")
    .is("archived_at", null)          // active-only: archived rows excluded
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    console.error("Supabase fetch error:", error);
    return { data: [], error };
  }

  const now = Date.now();
  const active = (data || [])
    .map(mapDbTicketToApp)
    .filter(t => {
      const ageDays = (now - new Date(t.createdAt).getTime()) / 86400000;
      if (t.status === "Resolved"  && ageDays > RESOLVED_MAX_DAYS)  return false;
      if (t.status === "Escalated" && ageDays > ESCALATED_MAX_DAYS) return false;
      return true;
    });

  return { data: active, error: null };
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

// ─── PATCH 2: archiveTicketInSupabase helper ──────────────────────────────────
const archiveTicketInSupabase = async (id, reason) => {
  if (!supabase || !id) return { error: { message: "No Supabase client or id." } };
  const { error } = await supabase
    .from("tickets")
    .update({
      archived_at: nowISO(),
      archived_reason: reason || "manual archive",
      updated_at: nowISO(),
    })
    .eq("id", id);
  if (error) console.error("Supabase archive error:", error);
  return { error };
};

const STATUS_STYLE = {
  "New": "bg-slate-50 text-slate-700 border-slate-200",
  "In Progress": "bg-slate-100 text-slate-700 border-slate-200",
  "Waiting on Customer": "bg-gray-50 text-gray-700 border-gray-200",
  "Backend Lookup": "bg-gray-50 text-gray-700 border-gray-200",
  "Resolved": "bg-gray-100 text-gray-600 border-gray-200",
  "Escalated": "bg-black text-white border-black",
};
const PRIORITY_STYLE = {
  "High": "bg-black text-white border-black",
  "Medium": "bg-slate-50 text-slate-700 border-slate-200",
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
  { id: uid(), brand: "CardKing47", channel: "TikTok DM", issueType: "Label created / no scan", priority: "High", slaRisk: "Yes", status: "Resolved", notes: "Label created 3 days prior with no carrier scan. Carrier located package after trace request.", nextAction: "Closed - carrier trace resolved", createdAt: new Date(Date.now() - 5 * 24 * 3600000).toISOString() },
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

// Station-to-brand mapping
const STUDIO_BRANDS = {
  "TT-01": "Vaulted",
  "TT-02": "PokeSpins",
  "TT-03": "CardKing47",
  "TT-04": "Pokiemart",
};

// Returns "Week of M/D" based on the most recent Sunday
const getWeekOfLabel = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // rewind to Sunday
  return `Week of ${d.getMonth() + 1}/${d.getDate()}`;
};

const getWeekStartISO = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
};

const addDaysISO = (iso, days) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const SURPRISE_SET_STORAGE_KEY = "ops_surprise_sets_weekly_v1";
const SETSHEET_CONVERTER_STORAGE_KEY = "ops_setsheet_converter_v1";
const SURPRISE_SET_BOARD_STORAGE_KEY = "ops_surprise_set_board_v1";
const SURPRISE_SET_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SURPRISE_SET_STREAMS = [
  { key: "am", label: "AM Shift", time: "7:00 AM - 3:00 PM" },
  { key: "pm", label: "PM Shift", time: "3:30 PM - 11:30 PM" },
];
const SURPRISE_SET_BOARD_STATUS_OPTIONS = ["Draft", "Parsed", "Needs Review", "Converted", "Downloaded", "Uploaded", "Live Ready"];
const SURPRISE_SET_BOARD_FOCUS_OPTIONS = ["All", "VR", "PS", "CK", "PM"];
const SURPRISE_SET_STATUS_OPTIONS = ["Not Started", "Built", "Checked", "Live Ready"];
const SURPRISE_SET_TRACKER_BRANDS = [
  { brand: "Vaulted Rarities", code: "VR" },
  { brand: "PokeSpins", code: "PS" },
  { brand: "CardKing47", code: "CK" },
  { brand: "PokieMart", code: "PM" },
];
const SURPRISE_SET_REQUIRED_BOARD_BRANDS = SURPRISE_SET_TRACKER_BRANDS.filter(item => item.code !== "VR");
const SETSHEET_WAREHOUSES = ["US Warehouse"];
const SETSHEET_BOX_DEFAULTS = { weight: "0.88", height: "9", width: "7", length: "4" };
const SETSHEET_PACK_DEFAULTS = { weight: "0.12", height: "11", width: "8", length: "1" };
const SETSHEET_BOX_KEYWORDS = [
  "COMMANDER DECK",
  "STARTER COMMANDER DECK",
  "SECRET LAIR",
  "VAULT BOX",
  "VR BOX",
  "RED BOX",
  "COLLECTOR CHEST",
  "CHEST",
  "ETB",
  "BOX",
  "PRERELEASE KIT",
  "BUNDLE",
  "DECK",
];
const SETSHEET_PACK_KEYWORDS = ["PLAY PACK", "PACK", "BAG", "VR BAG", "RIPPIEZ", "CGC", "PSA"];
const SETSHEET_TEMPLATE_CONFIGS = {
  cardKingVaulted: {
    path: "/templates/CARDKING-VAULTED-TEMPLATE.xlsx",
    label: "CardKing / Vaulted template",
    usesWarehouse: true,
  },
  pokeSpinsPokieMart: {
    path: "/templates/POKESPINS-POKIEMART-TEMPLATE.xlsx",
    label: "PokeSpins / PokieMart template",
    usesWarehouse: false,
  },
};

const SURPRISE_SET_BOARD_BRAND_COLORS = {
  VR: "#FACC15",
  PS: "#DC2626",
  CK: "#2563EB",
  PM: "#16A34A",
};

const normalizeSurpriseSetBrandValue = (brandValue) => {
  const raw = String(brandValue || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "vr" || raw.includes("vaulted")) return "Vaulted Rarities";
  if (raw === "ps" || raw.includes("pokespins") || raw.includes("poke spins")) return "PokeSpins";
  if (raw === "ck" || raw === "ck47" || raw.includes("cardking47") || raw.includes("card king 47")) return "CardKing47";
  if (raw === "pm" || raw.includes("pokiemart") || raw.includes("pokie mart")) return "PokieMart";
  return BRANDS.includes(brandValue) ? brandValue : "";
};

const getSetSheetTemplateConfig = (brandValue) => {
  const brand = normalizeSurpriseSetBrandValue(brandValue);
  if (brand === "PokeSpins" || brand === "PokieMart") return SETSHEET_TEMPLATE_CONFIGS.pokeSpinsPokieMart;
  return SETSHEET_TEMPLATE_CONFIGS.cardKingVaulted;
};

const getSurpriseSetBrandCode = (brandValue) => {
  const brand = normalizeSurpriseSetBrandValue(brandValue);
  const found = SURPRISE_SET_TRACKER_BRANDS.find(item => item.brand === brand);
  return found?.code || "";
};

const getSurpriseSetBrandFromCode = (code) => {
  const found = SURPRISE_SET_TRACKER_BRANDS.find(item => item.code === code);
  return found?.brand || "";
};

const getSurpriseSetDateForDay = (day, weekStart = getWeekStartISO()) => {
  const dayIndex = SURPRISE_SET_DAYS.indexOf(day);
  return dayIndex >= 0 ? addDaysISO(weekStart, dayIndex + 1) : todayDate();
};

const getDefaultSurpriseSetBoardDay = () => {
  const todayName = getDayNameFromDate(todayDate());
  return SURPRISE_SET_DAYS.includes(todayName) ? todayName : "Monday";
};

const normalizeSurpriseSetBoardStatus = (value) =>
  SURPRISE_SET_BOARD_STATUS_OPTIONS.includes(value) ? value : "Draft";

const normalizeSurpriseSetBoardEntry = (entry = {}) => {
  const brand = normalizeSurpriseSetBrandValue(entry.brand) || getSurpriseSetBrandFromCode(entry.brandCode) || "Vaulted Rarities";
  const brandCode = getSurpriseSetBrandCode(brand);
  const day = SURPRISE_SET_DAYS.includes(entry.day) ? entry.day : getDefaultSurpriseSetBoardDay();
  const shift = entry.shift === "pm" ? "pm" : "am";
  return {
    id: entry.id || uid(),
    brand,
    brandCode,
    day,
    shift,
    streamer: entry.streamer || "",
    streamDate: entry.streamDate || getSurpriseSetDateForDay(day),
    setNumber: String(entry.setNumber || "1"),
    surpriseSetName: entry.surpriseSetName || "",
    startingBid: entry.startingBid || "",
    hardFloor: entry.hardFloor || "",
    stretch: entry.stretch || "",
    fileName: entry.fileName || "",
    input: entry.input || "",
    rows: Array.isArray(entry.rows) ? entry.rows : [],
    summary: entry.summary || getSetSheetSummary(entry.rows || []),
    status: normalizeSurpriseSetBoardStatus(entry.status),
    convertedAt: entry.convertedAt || "",
    downloadedAt: entry.downloadedAt || "",
    uploadedAt: entry.uploadedAt || "",
    notes: entry.notes || "",
    warnings: Array.isArray(entry.warnings) ? entry.warnings.filter(Boolean) : [],
    importSource: entry.importSource || "",
    sheetTab: entry.sheetTab || "",
    columnGroup: entry.columnGroup || "",
    sourceProductUnits: Array.isArray(entry.sourceProductUnits) ? entry.sourceProductUnits : [],
    exportDebug: entry.exportDebug || null,
  };
};

const loadSurpriseSetBoardEntries = () => {
  try {
    const saved = localStorage.getItem(SURPRISE_SET_BOARD_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeSurpriseSetBoardEntry) : [];
  } catch {
    return [];
  }
};

const getNextSurpriseSetNumber = (entries, brand, day, shift) => {
  const current = (Array.isArray(entries) ? entries : [])
    .filter(item => normalizeSurpriseSetBrandValue(item.brand) === normalizeSurpriseSetBrandValue(brand) && item.day === day && item.shift === shift)
    .map(item => Number.parseInt(item.setNumber, 10))
    .filter(Number.isFinite);
  return String((current.length ? Math.max(...current) : 0) + 1);
};

const createSurpriseSetBoardDraft = ({ brand, day, shift, entries }) => {
  const normalizedBrand = normalizeSurpriseSetBrandValue(brand) || "Vaulted Rarities";
  const safeDay = SURPRISE_SET_DAYS.includes(day) ? day : getDefaultSurpriseSetBoardDay();
  const safeShift = shift === "pm" ? "pm" : "am";
  return normalizeSurpriseSetBoardEntry({
    id: uid(),
    brand: normalizedBrand,
    brandCode: getSurpriseSetBrandCode(normalizedBrand),
    day: safeDay,
    shift: safeShift,
    streamDate: getSurpriseSetDateForDay(safeDay),
    setNumber: getNextSurpriseSetNumber(entries, normalizedBrand, safeDay, safeShift),
    status: "Draft",
  });
};

const getSurpriseSetBoardMetrics = (entries, day) => {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const dayEntries = safeEntries.filter(item => item.day === day);
  const hasSlot = (targetDay, brand, shift) =>
    safeEntries.some(item => item.day === targetDay && normalizeSurpriseSetBrandValue(item.brand) === brand && item.shift === shift);
  const missingSlots = SURPRISE_SET_DAYS.reduce((daySum, targetDay) =>
    daySum + SURPRISE_SET_REQUIRED_BOARD_BRANDS.reduce((brandSum, { brand }) =>
      brandSum + SURPRISE_SET_STREAMS.filter(stream => !hasSlot(targetDay, brand, stream.key)).length, 0), 0);
  return {
    planned: safeEntries.length,
    converted: safeEntries.filter(item => ["Converted", "Downloaded", "Uploaded", "Live Ready"].includes(item.status)).length,
    downloaded: safeEntries.filter(item => ["Downloaded", "Uploaded", "Live Ready"].includes(item.status)).length,
    uploaded: safeEntries.filter(item => ["Uploaded", "Live Ready"].includes(item.status)).length,
    dayPlanned: dayEntries.length,
    missingSlots,
  };
};

const getSurpriseSetBrainNotes = (entries, day) => {
  const dayEntries = (Array.isArray(entries) ? entries : []).filter(item => item.day === day);
  const notes = [];
  SURPRISE_SET_REQUIRED_BOARD_BRANDS.forEach(({ brand, code }) => {
    SURPRISE_SET_STREAMS.forEach(stream => {
      const slotEntries = dayEntries.filter(item => normalizeSurpriseSetBrandValue(item.brand) === brand && item.shift === stream.key);
      if (!slotEntries.length) {
        notes.push(`${code} ${stream.label.replace(" Shift", "")} has no sets planned for ${day}.`);
        return;
      }
      const convertedNotDownloaded = slotEntries.filter(item => item.status === "Converted").length;
      const downloadedNotUploaded = slotEntries.filter(item => item.status === "Downloaded").length;
      const uploaded = slotEntries.filter(item => ["Uploaded", "Live Ready"].includes(item.status)).length;
      if (convertedNotDownloaded) notes.push(`${code} ${stream.label.replace(" Shift", "")} has ${convertedNotDownloaded} set${convertedNotDownloaded === 1 ? "" : "s"} converted but not downloaded.`);
      if (downloadedNotUploaded) notes.push(`${code} ${stream.label.replace(" Shift", "")} has ${downloadedNotUploaded} set${downloadedNotUploaded === 1 ? "" : "s"} downloaded but not uploaded.`);
      if (uploaded === slotEntries.length) notes.push(`All ${code} sets for ${day} ${stream.label.replace(" Shift", "")} are uploaded.`);
    });
  });
  notes.unshift("VR default recurring surprise set is active.");
  const next = notes.find(note => note.includes("not uploaded")) || notes.find(note => note.includes("not downloaded")) || notes.find(note => note.includes("no sets planned")) || `All planned sets for ${day} are ready.`;
  return { notes: notes.slice(0, 8), next };
};

const getSurpriseSetFlags = (status) => {
  const current = SURPRISE_SET_STATUS_OPTIONS.includes(status) ? status : "Not Started";
  return {
    warehouseListReceived: ["Built", "Checked", "Live Ready"].includes(current),
    convertedSetSheet: ["Built", "Checked", "Live Ready"].includes(current),
    downloadedSetSheet: ["Checked", "Live Ready"].includes(current),
    importedDesktop: ["Checked", "Live Ready"].includes(current),
    quantitiesVerified: ["Checked", "Live Ready"].includes(current),
    readyForLive: current === "Live Ready",
  };
};

const normalizeSurpriseSetStatus = (value, readyForLive) => {
  if (readyForLive === true) return "Live Ready";
  const raw = (value || "Not Started").toString().trim();
  return SURPRISE_SET_STATUS_OPTIONS.includes(raw) ? raw : "Not Started";
};

const createDefaultWeeklySurpriseSets = (weekStart = getWeekStartISO()) =>
  SURPRISE_SET_DAYS.flatMap((day, dayIndex) =>
    SURPRISE_SET_STREAMS.flatMap(stream =>
      SURPRISE_SET_TRACKER_BRANDS.map(({ brand }) => {
        const status = "Not Started";
        return {
          id: `${weekStart}-${day.toLowerCase()}-${stream.key}-${brand.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          weekStart,
          day,
          date: addDaysISO(weekStart, dayIndex + 1),
          streamKey: stream.key,
          streamLabel: stream.label,
          streamTime: stream.time,
          brand,
          streamer: "Jonny",
          setName: "",
          status,
          notes: "",
          quantity: 0,
          ...getSurpriseSetFlags(status),
        };
      })
    )
  );

const normalizeWeeklySurpriseSets = (items = [], weekStart = getWeekStartISO()) => {
  const safeItems = Array.isArray(items) ? items : [];
  const existing = new Map(safeItems.map(item => {
    const day = item.day || "";
    const streamKey = item.streamKey || (["PM Stream", "PM Shift"].includes(item.streamLabel) ? "pm" : ["AM Stream", "AM Shift"].includes(item.streamLabel) ? "am" : "");
    const brand = normalizeSurpriseSetBrandValue(item.brand);
    return [`${day}-${streamKey}-${brand || "unassigned"}`, item];
  }));

  const normalizedTemplates = createDefaultWeeklySurpriseSets(weekStart).map(template => {
    const saved = existing.get(`${template.day}-${template.streamKey}-${template.brand}`) || {};
    const status = normalizeSurpriseSetStatus(saved.status, saved.readyForLive);
    const statusFlags = getSurpriseSetFlags(status);
    return {
      ...template,
      ...saved,
      id: template.id,
      weekStart,
      day: template.day,
      date: template.date,
      streamKey: template.streamKey,
      streamLabel: template.streamLabel,
      streamTime: template.streamTime,
      brand: normalizeSurpriseSetBrandValue(saved.brand) || template.brand,
      streamer: saved.streamer || "Jonny",
      setName: saved.setName || "",
      status,
      notes: saved.notes || "",
      warehouseListReceived: typeof saved.warehouseListReceived === "boolean" ? saved.warehouseListReceived : statusFlags.warehouseListReceived,
      convertedSetSheet: typeof saved.convertedSetSheet === "boolean" ? saved.convertedSetSheet : statusFlags.convertedSetSheet,
      downloadedSetSheet: typeof saved.downloadedSetSheet === "boolean" ? saved.downloadedSetSheet : statusFlags.downloadedSetSheet,
      importedDesktop: typeof saved.importedDesktop === "boolean" ? saved.importedDesktop : statusFlags.importedDesktop,
      quantitiesVerified: typeof saved.quantitiesVerified === "boolean" ? saved.quantitiesVerified : statusFlags.quantitiesVerified,
      readyForLive: typeof saved.readyForLive === "boolean" ? saved.readyForLive : statusFlags.readyForLive,
    };
  });

  const unassignedLegacy = safeItems.filter(item => {
    const day = item.day || "";
    const streamKey = item.streamKey || (["PM Stream", "PM Shift"].includes(item.streamLabel) ? "pm" : ["AM Stream", "AM Shift"].includes(item.streamLabel) ? "am" : "");
    return day && streamKey && !normalizeSurpriseSetBrandValue(item.brand);
  }).map(item => ({
    ...item,
    id: item.id || `${weekStart}-${String(item.day || "unassigned").toLowerCase()}-${item.streamKey || "shift"}-unassigned-${uid()}`,
    weekStart,
    brand: "",
    status: normalizeSurpriseSetStatus(item.status, item.readyForLive),
  }));

  return [...normalizedTemplates, ...unassignedLegacy];
};

const loadWeeklySurpriseSets = () => {
  const weekStart = getWeekStartISO();
  try {
    const saved = localStorage.getItem(SURPRISE_SET_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const savedWeek = parsed?.weekStart || weekStart;
      const items = Array.isArray(parsed) ? parsed : parsed?.items;
      if (savedWeek === weekStart && Array.isArray(items)) return normalizeWeeklySurpriseSets(items, weekStart);
    }
  } catch {}
  return createDefaultWeeklySurpriseSets(weekStart);
};

const detectSetSheetType = (productName) => {
  const name = String(productName || "").toUpperCase();
  if (SETSHEET_PACK_KEYWORDS.some(keyword => name.includes(keyword))) return "pack";
  if (SETSHEET_BOX_KEYWORDS.some(keyword => name.includes(keyword))) return "box";
  return "unknown";
};

const normalizeSetSheetProductName = (name) =>
  String(name || "").replace(/\t/g, " ").replace(/\s+/g, " ").trim();

const getSetSheetDefaults = (type) => {
  if (type === "box") return SETSHEET_BOX_DEFAULTS;
  if (type === "pack") return SETSHEET_PACK_DEFAULTS;
  return { weight: "", height: "", width: "", length: "" };
};

const buildSourceProductUnit = (productName, meta = {}) => {
  const rawProductName = String(productName ?? "").replace(/\t/g, " ").replace(/\s+/g, " ").trim();
  const normalizedProductName = normalizeSetSheetProductName(rawProductName);
  if (!normalizedProductName) return null;
  const type = detectSetSheetType(normalizedProductName);
  const defaults = getSetSheetDefaults(type);
  return {
    channel: meta.channel || "",
    sheetTab: meta.sheetTab || "",
    columnGroup: meta.columnGroup || "",
    sourceRowNumber: meta.sourceRowNumber || "",
    rawProductName,
    normalizedProductName,
    unitQuantityContribution: Number(meta.unitQuantityContribution || 1) || 1,
    weight: meta.weight ?? defaults.weight,
    height: meta.height ?? defaults.height,
    width: meta.width ?? defaults.width,
    length: meta.length ?? defaults.length,
  };
};

const buildSourceProductUnitsFromLines = (productLines = [], meta = {}) =>
  (Array.isArray(productLines) ? productLines : [])
    .map((line, index) => buildSourceProductUnit(line, { ...meta, sourceRowNumber: meta.sourceRowNumber || index + 1 }))
    .filter(Boolean);

const buildSetSheetRowsFromSourceProductUnits = (sourceProductUnits = []) =>
  (Array.isArray(sourceProductUnits) ? sourceProductUnits : [])
    .map((unit, index) => ({
      order: index + 1,
      productName: unit.rawProductName || unit.normalizedProductName || "",
      quantity: unit.unitQuantityContribution || 1,
      type: detectSetSheetType(unit.rawProductName || unit.normalizedProductName),
      weight: unit.weight ?? "",
      height: unit.height ?? "",
      width: unit.width ?? "",
      length: unit.length ?? "",
    }))
    .filter(row => normalizeSetSheetProductName(row.productName));

const getSourceProductUnitCount = (sourceProductUnits = []) =>
  (Array.isArray(sourceProductUnits) ? sourceProductUnits : []).reduce((sum, unit) => {
    const count = Number(unit?.unitQuantityContribution);
    return sum + (Number.isFinite(count) && count > 0 ? count : 1);
  }, 0);

const parseSetSheetLine = (line, index) => {
  const productName = normalizeSetSheetProductName(line);
  if (!productName) return null;
  const type = detectSetSheetType(productName);
  const defaults = getSetSheetDefaults(type);
  return {
    order: index + 1,
    productName,
    quantity: 1,
    type,
    weight: defaults.weight,
    height: defaults.height,
    width: defaults.width,
    length: defaults.length,
  };
};

const combineSetSheetRowsKeepOrder = (rows) => {
  const combined = new Map();
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const key = normalizeSetSheetProductName(row.productName).toUpperCase();
    if (!combined.has(key)) {
      combined.set(key, { ...row });
    } else {
      const existing = combined.get(key);
      existing.quantity += row.quantity;
    }
  });
  return Array.from(combined.values()).map((row, index) => ({ ...row, order: index + 1 }));
};

const reverseSetSheetRows = (rows) =>
  [...(Array.isArray(rows) ? rows : [])].reverse().map((row, index) => ({ ...row, order: index + 1 }));

const sanitizeSetSheetFileName = (name) => {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "setsheet_export";
  return trimmed.replace(/[<>:"/\\|?*]+/g, "").replace(/\s+/g, "_");
};

const parseSetSheetInput = (input) => {
  const parsed = String(input || "")
    .split(/\r?\n/)
    .map((line, index) => parseSetSheetLine(line, index))
    .filter(Boolean);
  return reverseSetSheetRows(combineSetSheetRowsKeepOrder(parsed));
};

const getSetSheetRowQuantity = (row) => {
  const number = Number(row?.quantity);
  if (!Number.isFinite(number) || number <= 0) return 1;
  return Math.max(1, Math.floor(number));
};

const getSetSheetSummary = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  return {
    totalRows: safeRows.length,
    totalQuantity: safeRows.reduce((sum, row) => sum + getSetSheetRowQuantity(row), 0),
    unknownCount: safeRows.filter(row => row.type === "unknown").length,
  };
};

const SETSHEET_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SETSHEET_TIKTOK_ROW_LIMIT = 500;
const toSetSheetNumberCell = (value) => {
  if (value === "" || value == null) return "";
  const number = Number(value);
  return Number.isFinite(number) ? number : "";
};
const SETSHEET_PRODUCT_NAME_LIMIT = 254;
const normalizeSetSheetExportKeyPart = (value) =>
  normalizeSetSheetProductName(value).toUpperCase();
const withTikTokUniqueProductSuffix = (productName, occurrence, usedNames) => {
  const baseName = normalizeSetSheetProductName(productName) || "Surprise Item";
  const suffix = occurrence > 1 ? ` #${String(occurrence).padStart(3, "0")}` : "";
  const maxBaseLength = Math.max(1, SETSHEET_PRODUCT_NAME_LIMIT - suffix.length);
  let candidate = `${baseName.slice(0, maxBaseLength).trim()}${suffix}`;
  let guard = occurrence;
  while (usedNames.has(normalizeSetSheetExportKeyPart(candidate))) {
    guard += 1;
    const nextSuffix = ` #${String(guard).padStart(3, "0")}`;
    candidate = `${baseName.slice(0, Math.max(1, SETSHEET_PRODUCT_NAME_LIMIT - nextSuffix.length)).trim()}${nextSuffix}`;
  }
  usedNames.add(normalizeSetSheetExportKeyPart(candidate));
  return candidate;
};
const buildSetSheetExportRows = (rows, sourceProductUnits = []) => {
  const sourceRows = Array.isArray(sourceProductUnits) && sourceProductUnits.length
    ? buildSetSheetRowsFromSourceProductUnits(sourceProductUnits)
    : (Array.isArray(rows) ? rows : []);
  const nameCounts = new Map();
  const usedNames = new Set();
  const exportRows = [];
  sourceRows.forEach(row => {
    const productName = normalizeSetSheetProductName(row?.productName);
    if (!productName) return;
    const quantity = getSetSheetRowQuantity(row);
    for (let index = 0; index < quantity; index += 1) {
      const baseKey = normalizeSetSheetExportKeyPart(productName);
      const occurrence = (nameCounts.get(baseKey) || 0) + 1;
      nameCounts.set(baseKey, occurrence);
      exportRows.push({
        ...row,
        productName: withTikTokUniqueProductSuffix(productName, occurrence, usedNames),
        quantity: 1,
        weight: toSetSheetNumberCell(row.weight),
        height: toSetSheetNumberCell(row.height),
        width: toSetSheetNumberCell(row.width),
        length: toSetSheetNumberCell(row.length),
      });
    }
  });
  return exportRows.map((row, index) => ({ ...row, order: index + 1 }));
};
const findDuplicateSetSheetExportRows = (rows) => {
  const seen = new Set();
  const duplicates = [];
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const key = normalizeSetSheetExportKeyPart(row.productName);
    if (seen.has(key)) duplicates.push(key);
    else seen.add(key);
  });
  return duplicates;
};
const getSetSheetExpectedProductCount = (rows, options = {}) => {
  if (Array.isArray(options.sourceProductUnits) && options.sourceProductUnits.length) {
    return getSourceProductUnitCount(options.sourceProductUnits);
  }
  const previewCount = Number(options.previewProductCount);
  if (Number.isFinite(previewCount) && previewCount >= 0) return previewCount;
  return getSetSheetSummary(rows).totalQuantity;
};
const getSetSheetExportDebug = (sourceRows, exportRows, previewProductCount) => ({
  parsedProducts: previewProductCount,
  sourceUnits: previewProductCount,
  exportQuantity: getSetSheetSummary(exportRows).totalQuantity,
  xlsxRows: Array.isArray(exportRows) ? exportRows.length : 0,
  sourceRows: Array.isArray(sourceRows) ? sourceRows.length : 0,
});
const getSetSheetExportRowsForEntry = (entry = {}) => {
  const rows = Array.isArray(entry.rows) && entry.rows.length ? entry.rows : parseSetSheetInput(entry.input);
  return {
    sourceRows: Array.isArray(entry.sourceProductUnits) && entry.sourceProductUnits.length ? entry.sourceProductUnits : rows,
    exportRows: buildSetSheetExportRows(rows, entry.sourceProductUnits),
    sourceCount: getSetSheetExpectedProductCount(rows, { sourceProductUnits: entry.sourceProductUnits, previewProductCount: entry.summary?.totalQuantity }),
  };
};
const formatExportAuditRow = (row) => {
  if (row?.rawProductName || row?.normalizedProductName) {
    return `${row.sourceRowNumber || "-"} | ${row.rawProductName || row.normalizedProductName} | qty ${row.unitQuantityContribution || 1}`;
  }
  return `${row.productName || ""} | qty ${getSetSheetRowQuantity(row)}`;
};
const buildSetSheetExportAuditText = (entry = {}) => {
  const { sourceRows, exportRows, sourceCount } = getSetSheetExportRowsForEntry(entry);
  const exportQuantity = getSetSheetSummary(exportRows).totalQuantity;
  return [
    `Set: ${entry.surpriseSetName || entry.fileName || "Untitled set"}`,
    `Source count: ${sourceCount}`,
    `Export quantity: ${exportQuantity}`,
    `Export row count: ${exportRows.length}`,
    "",
    "First 10 source rows:",
    ...sourceRows.slice(0, 10).map(formatExportAuditRow),
    "",
    "Last 10 source rows:",
    ...sourceRows.slice(-10).map(formatExportAuditRow),
    "",
    "Final export rows:",
    ...exportRows.map(row => `${row.productName} | ${row.quantity} | ${row.weight} | ${row.height} | ${row.width} | ${row.length}`),
  ].join("\n");
};

const ZIP_TEXT_DECODER = new TextDecoder();
const ZIP_TEXT_ENCODER = new TextEncoder();
let crc32TableCache = null;

const getZipU16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);
const getZipU32 = (bytes, offset) => (
  (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
);
const setZipU16 = (bytes, offset, value) => {
  bytes[offset] = value & 255;
  bytes[offset + 1] = (value >>> 8) & 255;
};
const setZipU32 = (bytes, offset, value) => {
  bytes[offset] = value & 255;
  bytes[offset + 1] = (value >>> 8) & 255;
  bytes[offset + 2] = (value >>> 16) & 255;
  bytes[offset + 3] = (value >>> 24) & 255;
};
const concatZipParts = (parts) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  parts.forEach(part => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
};
const getCrc32Table = () => {
  if (crc32TableCache) return crc32TableCache;
  crc32TableCache = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc32TableCache[i] = c >>> 0;
  }
  return crc32TableCache;
};
const getCrc32 = (bytes) => {
  const table = getCrc32Table();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = table[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const streamZipBytes = async (bytes, streamType, format) => {
  if (typeof streamType !== "function") throw new Error("This browser cannot patch XLSX templates.");
  const input = new Blob([bytes]).stream().pipeThrough(new streamType(format));
  return new Uint8Array(await new Response(input).arrayBuffer());
};
const inflateZipEntry = async (entry) => {
  if (entry.method === 0) return entry.compressedData;
  if (entry.method === 8) return streamZipBytes(entry.compressedData, DecompressionStream, "deflate-raw");
  throw new Error("Unsupported XLSX template compression.");
};
const deflateZipEntry = async (bytes, method) => {
  if (method === 0) return bytes;
  if (method === 8) return streamZipBytes(bytes, CompressionStream, "deflate-raw");
  throw new Error("Unsupported XLSX template compression.");
};
const parseXlsxZip = (arrayBuffer) => {
  const bytes = new Uint8Array(arrayBuffer);
  const minOffset = Math.max(0, bytes.length - 65557);
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= minOffset; i -= 1) {
    if (getZipU32(bytes, i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Invalid XLSX template.");
  const entryCount = getZipU16(bytes, eocdOffset + 10);
  const centralDirectoryOffset = getZipU32(bytes, eocdOffset + 16);
  const commentLength = getZipU16(bytes, eocdOffset + 20);
  const eocdComment = bytes.slice(eocdOffset + 22, eocdOffset + 22 + commentLength);
  const entries = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (getZipU32(bytes, offset) !== 0x02014b50) throw new Error("Invalid XLSX central directory.");
    const nameLength = getZipU16(bytes, offset + 28);
    const extraLength = getZipU16(bytes, offset + 30);
    const commentLen = getZipU16(bytes, offset + 32);
    const localOffset = getZipU32(bytes, offset + 42);
    const nameBytes = bytes.slice(offset + 46, offset + 46 + nameLength);
    const centralExtra = bytes.slice(offset + 46 + nameLength, offset + 46 + nameLength + extraLength);
    const comment = bytes.slice(offset + 46 + nameLength + extraLength, offset + 46 + nameLength + extraLength + commentLen);
    const localNameLength = getZipU16(bytes, localOffset + 26);
    const localExtraLength = getZipU16(bytes, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressedSize = getZipU32(bytes, offset + 20);
    entries.push({
      versionMade: getZipU16(bytes, offset + 4),
      versionNeeded: getZipU16(bytes, offset + 6),
      flags: getZipU16(bytes, offset + 8) & ~8,
      method: getZipU16(bytes, offset + 10),
      modTime: getZipU16(bytes, offset + 12),
      modDate: getZipU16(bytes, offset + 14),
      crc: getZipU32(bytes, offset + 16),
      compressedSize,
      uncompressedSize: getZipU32(bytes, offset + 24),
      diskStart: getZipU16(bytes, offset + 34),
      internalAttrs: getZipU16(bytes, offset + 36),
      externalAttrs: getZipU32(bytes, offset + 38),
      name: ZIP_TEXT_DECODER.decode(nameBytes),
      nameBytes,
      localExtra: bytes.slice(localOffset + 30 + localNameLength, dataStart),
      centralExtra,
      comment,
      compressedData: bytes.slice(dataStart, dataStart + compressedSize),
    });
    offset += 46 + nameLength + extraLength + commentLen;
  }
  return { entries, eocdComment };
};
const buildXlsxZip = (zip) => {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  zip.entries.forEach(entry => {
    const localHeader = new Uint8Array(30 + entry.nameBytes.length + entry.localExtra.length);
    setZipU32(localHeader, 0, 0x04034b50);
    setZipU16(localHeader, 4, entry.versionNeeded);
    setZipU16(localHeader, 6, entry.flags);
    setZipU16(localHeader, 8, entry.method);
    setZipU16(localHeader, 10, entry.modTime);
    setZipU16(localHeader, 12, entry.modDate);
    setZipU32(localHeader, 14, entry.crc);
    setZipU32(localHeader, 18, entry.compressedData.length);
    setZipU32(localHeader, 22, entry.uncompressedSize);
    setZipU16(localHeader, 26, entry.nameBytes.length);
    setZipU16(localHeader, 28, entry.localExtra.length);
    localHeader.set(entry.nameBytes, 30);
    localHeader.set(entry.localExtra, 30 + entry.nameBytes.length);
    localParts.push(localHeader, entry.compressedData);

    const centralHeader = new Uint8Array(46 + entry.nameBytes.length + entry.centralExtra.length + entry.comment.length);
    setZipU32(centralHeader, 0, 0x02014b50);
    setZipU16(centralHeader, 4, entry.versionMade);
    setZipU16(centralHeader, 6, entry.versionNeeded);
    setZipU16(centralHeader, 8, entry.flags);
    setZipU16(centralHeader, 10, entry.method);
    setZipU16(centralHeader, 12, entry.modTime);
    setZipU16(centralHeader, 14, entry.modDate);
    setZipU32(centralHeader, 16, entry.crc);
    setZipU32(centralHeader, 20, entry.compressedData.length);
    setZipU32(centralHeader, 24, entry.uncompressedSize);
    setZipU16(centralHeader, 28, entry.nameBytes.length);
    setZipU16(centralHeader, 30, entry.centralExtra.length);
    setZipU16(centralHeader, 32, entry.comment.length);
    setZipU16(centralHeader, 34, entry.diskStart);
    setZipU16(centralHeader, 36, entry.internalAttrs);
    setZipU32(centralHeader, 38, entry.externalAttrs);
    setZipU32(centralHeader, 42, offset);
    centralHeader.set(entry.nameBytes, 46);
    centralHeader.set(entry.centralExtra, 46 + entry.nameBytes.length);
    centralHeader.set(entry.comment, 46 + entry.nameBytes.length + entry.centralExtra.length);
    centralParts.push(centralHeader);
    offset += localHeader.length + entry.compressedData.length;
  });
  const centralDirectory = concatZipParts(centralParts);
  const eocd = new Uint8Array(22 + zip.eocdComment.length);
  setZipU32(eocd, 0, 0x06054b50);
  setZipU16(eocd, 8, zip.entries.length);
  setZipU16(eocd, 10, zip.entries.length);
  setZipU32(eocd, 12, centralDirectory.length);
  setZipU32(eocd, 16, offset);
  setZipU16(eocd, 20, zip.eocdComment.length);
  eocd.set(zip.eocdComment, 22);
  return concatZipParts([...localParts, centralDirectory, eocd]);
};
const normalizeXlsxPath = (basePath, target) => {
  const cleanTarget = String(target || "").replace(/^\/+/, "");
  if (!cleanTarget) return "";
  if (target.startsWith("/")) return cleanTarget;
  const baseParts = basePath.split("/");
  baseParts.pop();
  cleanTarget.split("/").forEach(part => {
    if (!part || part === ".") return;
    if (part === "..") baseParts.pop();
    else baseParts.push(part);
  });
  return baseParts.join("/");
};
const getXmlAttribute = (tag, name) => {
  const match = String(tag || "").match(new RegExp(`\\b${name}=(["'])([^"']*)\\1`, "i"));
  return match ? match[2] : "";
};
const findSetSheetPath = async (zip) => {
  const workbookEntry = zip.entries.find(entry => entry.name === "xl/workbook.xml");
  const relsEntry = zip.entries.find(entry => entry.name === "xl/_rels/workbook.xml.rels");
  if (!workbookEntry || !relsEntry) throw new Error("Template workbook metadata is missing.");
  const workbookXml = ZIP_TEXT_DECODER.decode(await inflateZipEntry(workbookEntry));
  const relsXml = ZIP_TEXT_DECODER.decode(await inflateZipEntry(relsEntry));
  const sheetTags = Array.from(workbookXml.matchAll(/<sheet\b[^>]*>/gi)).map(match => match[0]);
  const sheetTag =
    sheetTags.find(tag => getXmlAttribute(tag, "name").toLowerCase() === "setsheet") ||
    sheetTags.find(tag => getXmlAttribute(tag, "name").toLowerCase() === "surprise_set_batch_template") ||
    sheetTags.find(tag => getXmlAttribute(tag, "state").toLowerCase() !== "hidden") ||
    sheetTags[0];
  if (!sheetTag) throw new Error("SetSheet worksheet was not found in the template.");
  const relationshipId = getXmlAttribute(sheetTag, "r:id");
  if (!relationshipId) throw new Error("SetSheet worksheet relationship was not found.");
  const relPattern = new RegExp(`<Relationship\\b[^>]*Id=(["'])${relationshipId}\\1[^>]*Target=(["'])([^"']+)\\2`, "i");
  const relMatch = relsXml.match(relPattern);
  if (!relMatch) throw new Error("SetSheet worksheet target was not found.");
  return normalizeXlsxPath("xl/workbook.xml", relMatch[3]);
};
const getCellColumn = (cellRef) => String(cellRef || "").replace(/\d+/g, "").toUpperCase();
const sortSetSheetRowCells = (row) => {
  const cells = Array.from(row.children);
  cells
    .sort((a, b) => getCellColumn(a.getAttribute("r")).localeCompare(getCellColumn(b.getAttribute("r")), undefined, { numeric: true }))
    .forEach(cell => row.appendChild(cell));
};
const sortSetSheetRows = (sheetData) => {
  Array.from(sheetData.children)
    .sort((a, b) => Number(a.getAttribute("r") || 0) - Number(b.getAttribute("r") || 0))
    .forEach(row => sheetData.appendChild(row));
};
const patchSetSheetXml = (worksheetXml, rows) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(worksheetXml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("SetSheet XML could not be parsed.");
  const sheetData = doc.getElementsByTagName("sheetData")[0];
  if (!sheetData) throw new Error("SetSheet worksheet data was not found.");
  const ns = sheetData.namespaceURI || "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rowsByNumber = new Map(Array.from(sheetData.children).map(row => [Number(row.getAttribute("r")), row]));
  const cellAttributesByRef = new Map();
  for (let rowNumber = 2; rowNumber <= 501; rowNumber += 1) {
    const row = rowsByNumber.get(rowNumber);
    if (!row) continue;
    Array.from(row.children).forEach(cell => {
      const col = getCellColumn(cell.getAttribute("r"));
      if (["A", "B", "C", "D", "E", "F"].includes(col)) {
        cellAttributesByRef.set(cell.getAttribute("r"), Array.from(cell.attributes).map(attr => [attr.name, attr.value]));
        cell.remove();
      }
    });
  }
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    let rowNode = rowsByNumber.get(rowNumber);
    if (!rowNode) {
      rowNode = doc.createElementNS(ns, "row");
      rowNode.setAttribute("r", String(rowNumber));
      sheetData.appendChild(rowNode);
      rowsByNumber.set(rowNumber, rowNode);
    }
    const values = [
      { col: "A", type: "string", value: row.productName || "" },
      { col: "B", type: "number", value: toSetSheetNumberCell(row.quantity) || 0 },
      { col: "C", type: "number", value: toSetSheetNumberCell(row.weight) },
      { col: "D", type: "number", value: toSetSheetNumberCell(row.height) },
      { col: "E", type: "number", value: toSetSheetNumberCell(row.width) },
      { col: "F", type: "number", value: toSetSheetNumberCell(row.length) },
    ];
    values.forEach(cellValue => {
      const cell = doc.createElementNS(ns, "c");
      (cellAttributesByRef.get(`${cellValue.col}${rowNumber}`) || []).forEach(([name, value]) => {
        if (name !== "r" && name !== "t") cell.setAttribute(name, value);
      });
      cell.setAttribute("r", `${cellValue.col}${rowNumber}`);
      if (cellValue.type === "string" || cellValue.value === "") {
        cell.setAttribute("t", "inlineStr");
        const isNode = doc.createElementNS(ns, "is");
        const textNode = doc.createElementNS(ns, "t");
        textNode.textContent = String(cellValue.value ?? "");
        isNode.appendChild(textNode);
        cell.appendChild(isNode);
      } else {
        const valueNode = doc.createElementNS(ns, "v");
        valueNode.textContent = String(cellValue.value);
        cell.appendChild(valueNode);
      }
      rowNode.appendChild(cell);
    });
    sortSetSheetRowCells(rowNode);
  });
  sortSetSheetRows(sheetData);
  return new XMLSerializer().serializeToString(doc);
};
const buildSetSheetSpreadsheetFromTemplate = async (rows, options = {}) => {
  const templateConfig = getSetSheetTemplateConfig(options.brand);
  const response = await fetch(templateConfig.path);
  if (!response.ok) throw new Error(`Could not load ${templateConfig.label}.`);
  const zip = parseXlsxZip(await response.arrayBuffer());
  const sheetPath = await findSetSheetPath(zip);
  const sheetEntry = zip.entries.find(entry => entry.name === sheetPath);
  if (!sheetEntry) throw new Error("SetSheet worksheet file was not found in the template.");
  const worksheetXml = ZIP_TEXT_DECODER.decode(await inflateZipEntry(sheetEntry));
  const patchedXml = patchSetSheetXml(worksheetXml, rows);
  const patchedBytes = ZIP_TEXT_ENCODER.encode(patchedXml);
  sheetEntry.compressedData = await deflateZipEntry(patchedBytes, sheetEntry.method);
  sheetEntry.uncompressedSize = patchedBytes.length;
  sheetEntry.crc = getCrc32(patchedBytes);
  return buildXlsxZip(zip);
};

const downloadSetSheetRows = async (rows, fileName, options = {}) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const previewProductCount = getSetSheetExpectedProductCount(safeRows, options);
  const sourceRowsForDebug = Array.isArray(options.sourceProductUnits) && options.sourceProductUnits.length
    ? options.sourceProductUnits
    : safeRows;
  const exportRows = buildSetSheetExportRows(safeRows, options.sourceProductUnits);
  const exportDebug = getSetSheetExportDebug(sourceRowsForDebug, exportRows, previewProductCount);
  if (findDuplicateSetSheetExportRows(exportRows).length) {
    return {
      ok: false,
      error: "Duplicate final product names found. Export must make each TikTok row unique before upload.",
      exportDebug,
    };
  }
  if (exportDebug.xlsxRows !== previewProductCount || exportDebug.exportQuantity !== previewProductCount) {
    return {
      ok: false,
      error: `Export quantity mismatch: source has ${previewProductCount}, XLSX would export ${exportDebug.exportQuantity}.`,
      exportDebug,
    };
  }
  if (exportRows.length > SETSHEET_TIKTOK_ROW_LIMIT) {
    return {
      ok: false,
      error: `TikTok allows up to ${SETSHEET_TIKTOK_ROW_LIMIT} rows per SetSheet. This export would write ${exportRows.length} rows. Review or split this set before downloading.`,
      exportDebug,
    };
  }
  try {
    const workbook = await buildSetSheetSpreadsheetFromTemplate(exportRows, options);
    const blob = new Blob([workbook], { type: SETSHEET_XLSX_MIME });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sanitizeSetSheetFileName(fileName)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return { ok: true, exportDebug };
  } catch (error) {
    return { ok: false, error: error?.message || "Could not build the TikTok template file.", exportDebug };
  }
};

const loadSetSheetConverterEntries = () => {
  try {
    const saved = localStorage.getItem(SETSHEET_CONVERTER_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const getLocalISODate = (date = new Date()) => {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return [
    String(local.getFullYear()),
    String(local.getMonth() + 1).padStart(2, "0"),
    String(local.getDate()).padStart(2, "0"),
  ].join("-");
};

const SURPRISE_SET_ACCOUNT_OPTIONS = ["Vaulted Rarities", "PokeSpins", "CardKing47", "PokieMart"];
const TIKTOK_UPLOAD_CHECKLIST = [
  "Create surprise set",
  "Paste surprise set name",
  "Enter starting bid",
  "Import Excel or CSV",
  "Upload converted file",
  "Confirm product count",
  "Submit",
];

const formatSetDateForFileName = (isoDate) => {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  return `${match[2]}${match[3]}`;
};

const normalizeSetSheetFilePart = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const buildSurpriseSetFileName = ({ streamer, streamDate, setNumber }) => {
  const parts = [
    normalizeSetSheetFilePart(streamer || "stream"),
    formatSetDateForFileName(streamDate) || formatSetDateForFileName(todayDate()),
    normalizeSetSheetFilePart(setNumber || "1"),
  ].filter(Boolean);
  return sanitizeSetSheetFileName(parts.join("_"));
};

const titleCaseSurpriseSetName = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, char => char.toUpperCase());

const getDayNameFromDate = (isoDate) => {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString("en-US", { weekday: "long" });
};

const parseWarehouseSheetDate = (month, day, year) => {
  const safeYear = year ? Number(year) : new Date().getFullYear();
  const safeMonth = Number(month);
  const safeDay = Number(day);
  if (!safeYear || safeMonth < 1 || safeMonth > 12 || safeDay < 1 || safeDay > 31) return "";
  const date = new Date(safeYear, safeMonth - 1, safeDay);
  if (date.getFullYear() !== safeYear || date.getMonth() !== safeMonth - 1 || date.getDate() !== safeDay) return "";
  return [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
};

const detectWarehouseSheetDateStreamer = (lines) => {
  const cleanLines = Array.isArray(lines) ? lines : [];
  const dateFirstPattern = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b\s*(?:\(([A-Za-z][A-Za-z\s.'-]{1,24})\)|([A-Za-z][A-Za-z\s.'-]{1,24}))?/;
  const streamerFirstPattern = /^\s*([A-Za-z][A-Za-z\s.'-]{1,24})\s+\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;
  for (let index = 0; index < cleanLines.length; index += 1) {
    const line = cleanLines[index];
    const streamerFirst = line.match(streamerFirstPattern);
    if (streamerFirst) {
      const isoDate = parseWarehouseSheetDate(streamerFirst[2], streamerFirst[3], streamerFirst[4]);
      if (isoDate) return { lineIndex: index, streamDate: isoDate, streamer: titleCaseSurpriseSetName(streamerFirst[1]) };
    }
    const dateFirst = line.match(dateFirstPattern);
    if (dateFirst) {
      const isoDate = parseWarehouseSheetDate(dateFirst[1], dateFirst[2], dateFirst[3]);
      if (isoDate) return { lineIndex: index, streamDate: isoDate, streamer: titleCaseSurpriseSetName(dateFirst[4] || dateFirst[5] || "") };
    }
  }
  return null;
};

const detectWarehouseSheetMoneyValue = (lines, label) => {
  const pattern = new RegExp(`^\\s*${label}\\s*:?\\s*\\$?\\s*([0-9]+(?:\\.[0-9]{1,2})?)\\b`, "i");
  const line = (Array.isArray(lines) ? lines : []).find(item => pattern.test(item));
  const match = line ? line.match(pattern) : null;
  return match ? match[1] : "";
};

const detectWarehouseSheetBrand = (rawText) => {
  const text = String(rawText || "");
  const normalized = text.toLowerCase();
  if (/\bpoke\s*spins\b|\bpokespins\b/i.test(text) || /\bbrand\s*[:\-]?\s*ps\b/i.test(text)) return "PokeSpins";
  if (/\bpokie\s*mart\b|\bpokiemart\b/i.test(text) || /\bbrand\s*[:\-]?\s*pm\b/i.test(text)) return "PokieMart";
  if (/\bcard\s*king\s*47\b|\bcardking47\b|\bcardking\b/i.test(text) || /\bbrand\s*[:\-]?\s*ck47?\b/i.test(text)) return "CardKing47";
  if (/\bvaulted\s*rarities\b|\bvaulted\b/i.test(text) || /\bbrand\s*[:\-]?\s*vr\b/i.test(text)) return "Vaulted Rarities";

  const standaloneLines = text.split(/\r?\n/).map(line => line.trim().toUpperCase()).filter(Boolean);
  if (standaloneLines.some(line => line === "PS")) return "PokeSpins";
  if (standaloneLines.some(line => line === "POKIE MART")) return "PokieMart";
  if (standaloneLines.some(line => line === "CK" || line === "CK47")) return "CardKing47";
  if (standaloneLines.some(line => line === "VR" || line === "VAULTED RARITIES")) return "Vaulted Rarities";
  if (/\bvr\s+bag\b/i.test(normalized)) return "";
  return "";
};

const detectWarehouseSheetShift = (rawText) => {
  const text = String(rawText || "");
  if (/\b(day\s*shift|morning|am)\b/i.test(text)) return "am";
  if (/\b(night|evening|pm)\b/i.test(text)) return "pm";
  return "";
};

const isWarehouseSetupLine = (line) => /^\s*(?:=CONCATENATE\("?\s*)?(hard\s*floor|target|stretch)\b/i.test(line);
const isWarehouseTotalLine = (line) => /\b(sub\s*total|subtotal|grand\s*total|total|sum)\b/i.test(line);
const isWarehouseDateOnlyLine = (line) => /^\s*\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s*$/i.test(line);
const isWarehouseFormulaLine = (line) => /^\s*=/.test(line) || /\t\s*=/.test(line);
const isWarehouseImageLogoLine = (line) => /\b(image|logo|photo|thumbnail)\b/i.test(line);

const isMeaningfulWarehouseProductCell = (value) => {
  const cell = normalizeSetSheetProductName(value);
  if (!cell) return false;
  if (cell.length < 3) return false;
  if (/^\$?\d+(?:\.\d{1,2})?$/.test(cell)) return false;
  if (/^\d+\s*x?$/i.test(cell)) return false;
  if (/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/.test(cell)) return false;
  if (/^(qty|quantity|price|cost|total|target|stretch|hard floor|image|logo|sku|asin|product|product name|item|item name|name|description)$/i.test(cell)) return false;
  if (/^(am|pm|yes|no)$/i.test(cell)) return false;
  if (!/[A-Za-z]/.test(cell)) return false;
  return true;
};

const scoreWarehouseProductCell = (value) => {
  const cell = normalizeSetSheetProductName(value);
  if (!isMeaningfulWarehouseProductCell(cell)) return -1;
  let score = Math.min(cell.length, 80);
  if (/[A-Za-z].*[A-Za-z]/.test(cell)) score += 8;
  if (/\b(pack|box|bag|deck|bundle|booster|etb|tin|case|set|collection|rip|rippiez|psa|cgc|vault)\b/i.test(cell)) score += 14;
  if (/\$/.test(cell)) score -= 10;
  if (/^\d+\s+[A-Za-z]/.test(cell)) score -= 4;
  return score;
};

const pickWarehouseProductNameFromRow = (line) => {
  const cells = String(line || "").split("\t").map(cell => normalizeSetSheetProductName(cell)).filter(Boolean);
  const candidates = cells.length ? cells : [normalizeSetSheetProductName(line)];
  const scored = candidates
    .map(cell => ({ cell, score: scoreWarehouseProductCell(cell) }))
    .filter(item => item.score >= 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.cell || "";
};

const isStrongWarehouseSetNameLine = (line) => {
  const clean = normalizeSetSheetProductName(line);
  if (!clean || isWarehouseSetupLine(clean) || isWarehouseTotalLine(clean) || isWarehouseDateOnlyLine(clean)) return false;
  if (/^\$?\d+(?:\.\d{1,2})?$/.test(clean)) return false;
  if (/^\d+$/.test(clean)) return false;
  if (!/[A-Za-z]/.test(clean)) return false;
  return clean.length >= 5;
};

const parseWarehouseSheetPaste = (rawText, currentForm = {}) => {
  const raw = String(rawText || "");
  const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const warnings = [];
  const confidenceNotes = [];
  const detectedDateStreamer = detectWarehouseSheetDateStreamer(lines);
  const streamDate = detectedDateStreamer?.streamDate || "";
  const streamer = detectedDateStreamer?.streamer || "";
  const day = streamDate ? getDayNameFromDate(streamDate) : "";
  const hardFloor = detectWarehouseSheetMoneyValue(lines, "HARD\\s*FLOOR");
  const target = detectWarehouseSheetMoneyValue(lines, "TARGET");
  const stretch = detectWarehouseSheetMoneyValue(lines, "STRETCH");
  const startingBid = target || hardFloor || "";
  const detectedBrand = detectWarehouseSheetBrand(raw);
  const shift = detectWarehouseSheetShift(raw);

  if (!detectedBrand) warnings.push("Brand not detected. Kept current selection.");
  if (!shift) warnings.push("Shift not detected. Kept current selection.");
  if (streamer && streamDate) confidenceNotes.push(`Detected ${streamer} on ${streamDate}.`);
  if (target) confidenceNotes.push(`Detected target $${target}.`);
  if (hardFloor) confidenceNotes.push(`Detected hard floor $${hardFloor}.`);
  if (stretch) confidenceNotes.push(`Detected stretch $${stretch}.`);

  let surpriseSetName = "";
  const setupLineIndexes = new Set();
  if (typeof detectedDateStreamer?.lineIndex === "number") setupLineIndexes.add(detectedDateStreamer.lineIndex);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isWarehouseSetupLine(line)) setupLineIndexes.add(index);
    if (!surpriseSetName && detectedDateStreamer && index > detectedDateStreamer.lineIndex && isStrongWarehouseSetNameLine(line)) {
      surpriseSetName = normalizeSetSheetProductName(line);
      setupLineIndexes.add(index);
    }
  }
  if (surpriseSetName) confidenceNotes.push(`Detected surprise set name ${surpriseSetName}.`);

  const productLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => {
      if (setupLineIndexes.has(index)) return false;
      if (isWarehouseSetupLine(line) || isWarehouseTotalLine(line) || isWarehouseDateOnlyLine(line) || isWarehouseFormulaLine(line)) return false;
      if (/^\d+(?:\t\d+)*$/.test(line)) return false;
      return true;
    })
    .map(({ line }) => pickWarehouseProductNameFromRow(line))
    .filter(Boolean);

  if (!productLines.length) warnings.push("No product rows detected.");
  if (!streamDate) confidenceNotes.push("Stream date not detected.");
  if (!streamer) confidenceNotes.push("Streamer not detected.");

  return {
    detectedBrand,
    streamer,
    streamDate,
    day,
    shift,
    setNumber: currentForm?.setNumber || "",
    surpriseSetName,
    startingBid,
    hardFloor,
    target,
    stretch,
    productLines,
    confidenceNotes,
    warnings,
  };
};

const getAutopilotDateForRange = (range, selectedDay = "") => {
  if (range === "Tomorrow") return addDaysISO(getLocalISODate(), 1);
  if (range === "Next 2 Days") return addDaysISO(getLocalISODate(), 1);
  if (range === "Selected Day" || range === "Full Week") return getSurpriseSetDateForDay(selectedDay || getDefaultSurpriseSetBoardDay());
  return getLocalISODate();
};

const getAutopilotDatesForRange = (range, selectedDay = "") => {
  const today = getLocalISODate();
  if (range === "Tomorrow") return [addDaysISO(today, 1)];
  if (range === "Next 2 Days") return [addDaysISO(today, 1), addDaysISO(today, 2)];
  if (range === "Selected Day") return [getSurpriseSetDateForDay(selectedDay || getDefaultSurpriseSetBoardDay())];
  if (range === "Full Week") return SURPRISE_SET_DAYS.map(day => getSurpriseSetDateForDay(day));
  return [today];
};

const AUTOPILOT_IGNORED_SHEET_TAB_PATTERN = /\b(template|templates|schedule|employee|week-to-week|strixhaven|no more)\b|^sheet\d+$/i;
const AUTOPILOT_CRITICAL_WARNING_PATTERNS = [
  /missing target/i,
  /missing date/i,
  /missing streamer/i,
  /no product rows/i,
  /could not detect setup block/i,
  /review shift assignment/i,
  /ambiguous column group/i,
];

const getAutopilotSelectedBrands = (options = {}) => {
  const selected = Array.isArray(options.selectedChannels) ? options.selectedChannels : [];
  const brands = selected
    .map(code => getSurpriseSetBrandFromCode(code))
    .filter(Boolean)
    .filter(brand => ["CardKing47", "PokeSpins", "PokieMart"].includes(brand));
  if (brands.length) return brands;
  if (["CK", "PS", "PM"].includes(options.focusChannel)) return [getSurpriseSetBrandFromCode(options.focusChannel)];
  return ["CardKing47"];
};

const getAutopilotBrandFromChannelCode = (code) => {
  const clean = String(code || "").trim().toUpperCase();
  if (clean === "VR" || clean === "VAULTED") return "Vaulted Rarities";
  if (clean === "CK" || clean === "CK47") return "CardKing47";
  if (clean === "PS") return "PokeSpins";
  if (clean === "PM") return "PokieMart";
  return "";
};

const isAutopilotCriticalWarning = (warning) =>
  AUTOPILOT_CRITICAL_WARNING_PATTERNS.some(pattern => pattern.test(String(warning || "")));

const hasAutopilotCriticalWarnings = (warnings = []) =>
  (Array.isArray(warnings) ? warnings : []).some(isAutopilotCriticalWarning);

const getAutopilotSetupHeader = (line) => {
  const clean = normalizeSetSheetProductName(line);
  if (!clean) return null;
  const parenStreamerDate = clean.match(/^\s*\(([A-Za-z][A-Za-z\s.'-]{1,24})\)\s*\((\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\)(?:\s*\+.*)?$/i);
  if (parenStreamerDate) {
    const isoDate = parseWarehouseSheetDate(parenStreamerDate[2], parenStreamerDate[3], parenStreamerDate[4]);
    if (isoDate) return { streamDate: isoDate, streamer: titleCaseSurpriseSetName(parenStreamerDate[1]) };
  }
  const dateFirst = clean.match(/^\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*(?:\(([A-Za-z][A-Za-z\s.'-]{1,24})\)|([A-Za-z][A-Za-z\s.'-]{1,24}))?(?:\s+(?:BUILT|DONE|NOT\s*DONE))?(?:\s*\+.*)?$/i);
  if (dateFirst && (dateFirst[4] || dateFirst[5])) {
    const isoDate = parseWarehouseSheetDate(dateFirst[1], dateFirst[2], dateFirst[3]);
    if (isoDate) return { streamDate: isoDate, streamer: titleCaseSurpriseSetName(dateFirst[4] || dateFirst[5]) };
  }
  const streamerFirst = clean.match(/^\s*([A-Za-z][A-Za-z\s.'-]{1,24})\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s+(?:BUILT|DONE|NOT\s*DONE))?(?:\s*\+.*)?$/i);
  if (streamerFirst) {
    const isoDate = parseWarehouseSheetDate(streamerFirst[2], streamerFirst[3], streamerFirst[4]);
    if (isoDate) return { streamDate: isoDate, streamer: titleCaseSurpriseSetName(streamerFirst[1]) };
  }
  return null;
};

const detectAutopilotDateStreamerFromTabName = (tabName) => {
  const raw = normalizeSetSheetProductName(tabName);
  const clean = raw
    .replace(/\((?:BUILT|NOT\s*DONE|DONE)\)/ig, "")
    .replace(/\b(BUILT|NOT\s*DONE|DONE)\b/ig, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const slashHeader = getAutopilotSetupHeader(clean);
  if (slashHeader) return slashHeader;
  const compact = clean.match(/\b([A-Za-z][A-Za-z\s.'-]{1,24})\s+(\d{1,2})(\d{2})\b/i);
  if (compact) {
    const isoDate = parseWarehouseSheetDate(compact[2], compact[3], "");
    if (isoDate) return { streamDate: isoDate, streamer: titleCaseSurpriseSetName(compact[1]) };
  }
  return null;
};

const detectAutopilotShiftFromText = (text) => {
  const clean = String(text || "");
  if (/\b(morning|day\s*shift|day|am)\b/i.test(clean)) return "am";
  if (/\b(night|evening|pm)\b/i.test(clean)) return "pm";
  return "";
};

const getAutopilotSheetTabInfo = (tabName = "", tabIndex = 0) => {
  const header = detectAutopilotDateStreamerFromTabName(tabName);
  return {
    tabOrder: tabIndex + 1,
    tabName,
    streamDate: header?.streamDate || "",
    streamer: header?.streamer || "",
    built: /\bBUILT\b/i.test(String(tabName || "")),
    explicitShift: detectAutopilotShiftFromText(tabName),
  };
};

const buildAutopilotTabShiftMap = (channel = "", tabs = []) => {
  const tabInfos = (Array.isArray(tabs) ? tabs : []).map((tab, tabIndex) => ({
    ...getAutopilotSheetTabInfo(tab?.tabName || "", tabIndex),
    ignored: AUTOPILOT_IGNORED_SHEET_TAB_PATTERN.test(normalizeSetSheetProductName(tab?.tabName || "")),
  }));
  const groups = new Map();
  tabInfos.forEach(info => {
    if (info.ignored || !info.streamDate || !info.streamer) return;
    const key = `${String(channel || "").toUpperCase()}|${info.streamDate}`;
    groups.set(key, [...(groups.get(key) || []), info]);
  });
  const shiftMap = new Map();
  groups.forEach(group => {
    const uniqueOrder = [];
    const seenStreamers = new Set();
    group.forEach(info => {
      const streamerKey = normalizeSetSheetProductName(info.streamer).toLowerCase();
      if (seenStreamers.has(streamerKey)) return;
      seenStreamers.add(streamerKey);
      uniqueOrder.push(info);
    });
    const assignedByStreamer = new Map();
    uniqueOrder.forEach((info, orderIndex) => {
      const warnings = [];
      let assignedShift = info.explicitShift;
      if (!assignedShift) {
        if (orderIndex === 0) assignedShift = "am";
        else if (orderIndex === 1) assignedShift = "pm";
        else assignedShift = "Extra / Needs Review";
      }
      if (!info.explicitShift && uniqueOrder.length === 1) {
        warnings.push("Only one streamer tab found for this date. Shift assumed AM.");
      }
      if (!info.explicitShift && uniqueOrder.length > 2 && orderIndex >= 2) {
        warnings.push("More than two streamer tabs found for this date. Review shift assignment.");
      }
      assignedByStreamer.set(normalizeSetSheetProductName(info.streamer).toLowerCase(), {
        assignedShift,
        streamerTabCount: uniqueOrder.length,
        tabDateOrder: orderIndex + 1,
        warnings,
      });
    });
    group.forEach(info => {
      const assigned = assignedByStreamer.get(normalizeSetSheetProductName(info.streamer).toLowerCase());
      shiftMap.set(info.tabOrder, { ...info, ...(assigned || {}), warnings: assigned?.warnings || [] });
    });
  });
  tabInfos.forEach(info => {
    if (!shiftMap.has(info.tabOrder)) {
      shiftMap.set(info.tabOrder, { ...info, assignedShift: info.explicitShift || "", streamerTabCount: 0, tabDateOrder: 0, warnings: [] });
    }
  });
  return shiftMap;
};

const detectAutopilotDateStreamerFromText = (text) => {
  const lines = String(text || "").split(/\r?\n/).map(line => normalizeSetSheetProductName(line)).filter(Boolean);
  for (const line of lines) {
    const header = getAutopilotSetupHeader(line);
    if (header) return header;
  }
  const tabHeader = detectAutopilotDateStreamerFromTabName(text);
  if (tabHeader) return tabHeader;
  return null;
};

const detectSurpriseSetBlocks = (rawText) => {
  const lines = String(rawText || "").split(/\r?\n/);
  const headerMatches = lines
    .map((line, lineIndex) => ({ lineIndex, header: getAutopilotSetupHeader(line) }))
    .filter(item => item.header);
  const blocks = headerMatches.map((match, index) => {
    const startIndex = index === 0 ? 0 : headerMatches[index - 1].lineIndex + 1;
    const endIndex = headerMatches[index + 1]?.lineIndex ?? lines.length;
    return {
      header: match.header,
      startIndex,
      lines: lines.slice(startIndex, endIndex),
    };
  });
  return blocks.map(block => ({ ...block, text: block.lines.join("\n") }));
};

const detectAutopilotBrand = (rawText) => {
  const text = String(rawText || "");
  if (/\b(card\s*king\s*47|cardking47|cardking)\b/i.test(text)) return "CardKing47";
  if (/\b(poke\s*spins|pokespins)\b/i.test(text)) return "PokeSpins";
  if (/\b(pokie\s*mart|pokiemart)\b/i.test(text)) return "PokieMart";
  if (/\b(channel|brand|account)\s*[:\-]?\s*(CK47|CK)\b/i.test(text)) return "CardKing47";
  if (/\b(channel|brand|account)\s*[:\-]?\s*PS\b/i.test(text)) return "PokeSpins";
  if (/\b(channel|brand|account)\s*[:\-]?\s*PM\b/i.test(text)) return "PokieMart";
  const standaloneLines = text.split(/\r?\n/).map(line => normalizeSetSheetProductName(line).toUpperCase()).filter(Boolean);
  if (standaloneLines.some(line => line === "CK" || line === "CK47")) return "CardKing47";
  if (standaloneLines.some(line => line === "PS")) return "PokeSpins";
  if (standaloneLines.some(line => line === "PM")) return "PokieMart";
  return "";
};

const detectAutopilotPrice = (lines, label) => {
  const pattern = new RegExp(`\\b${label}\\b\\s*:?\\s*\\$?\\s*([0-9]+(?:\\.[0-9]{1,2})?)\\b`, "i");
  const adjacentPattern = new RegExp(`\\b${label}\\b\\t+\\$?\\s*([0-9]+(?:\\.[0-9]{1,2})?)\\b`, "i");
  const line = (Array.isArray(lines) ? lines : []).find(item => pattern.test(item) || adjacentPattern.test(item));
  const match = line ? (line.match(pattern) || line.match(adjacentPattern)) : null;
  return match ? match[1] : "";
};

const isAutopilotIgnoredProductLine = (line) => {
  const clean = normalizeSetSheetProductName(line);
  if (!clean) return true;
  if (isSurpriseSetNonProductLabel(clean)) return true;
  if (getAutopilotSetupHeader(clean)) return true;
  if (isWarehouseSetupLine(clean) || isWarehouseTotalLine(clean) || isWarehouseDateOnlyLine(clean) || isWarehouseFormulaLine(clean) || isWarehouseImageLogoLine(clean)) return true;
  if (/^\$?\d+(?:\.\d{1,2})?$/.test(clean)) return true;
  if (/^\d+(?:\t\d+)*$/.test(clean)) return true;
  if (/^(target|stretch|hard floor|total|subtotal|grand total)$/i.test(clean)) return true;
  if (/\b(built|not\s*done|done)\b/i.test(clean) && clean.length < 36) return true;
  if (/^(note|notes|setup|status|streamer|host|tab|sheet|channel|channel label|spreadsheet|group set)\b/i.test(clean)) return true;
  return false;
};

const isAutopilotStopScanLine = (line) => {
  const clean = normalizeSetSheetProductName(line);
  if (!clean) return false;
  if (getAutopilotSetupHeader(clean)) return true;
  if (isWarehouseTotalLine(clean) || isWarehouseImageLogoLine(clean)) return true;
  if (/\b(grand\s*total|subtotal|summary|recap|logo|image|notes?|built|not\s*done|done)\b/i.test(clean)) return true;
  if (/^(channel|channel label|tab|spreadsheet|group set)\s*:/i.test(clean)) return true;
  return false;
};

const hasAutopilotQuantityCell = (line) => {
  const cells = String(line || "").split("\t").map(cell => normalizeSetSheetProductName(cell)).filter(Boolean);
  return cells.length > 1 && cells.some(cell => /^\d{1,4}$/.test(cell)) && cells.some(cell => /[A-Za-z]/.test(cell));
};

const collectAutopilotProductRowsAboveSetup = (lines, setupLineIndex) => {
  const products = [];
  let blankRun = 0;
  let sawProduct = false;

  for (let index = setupLineIndex - 1; index >= 0; index -= 1) {
    const line = lines[index] || "";
    const clean = normalizeSetSheetProductName(line);
    if (!clean) {
      blankRun += 1;
      if (sawProduct && blankRun > 3) break;
      continue;
    }
    blankRun = 0;
    if (isAutopilotStopScanLine(clean)) {
      if (sawProduct) break;
      continue;
    }
    if (isAutopilotIgnoredProductLine(clean)) continue;
    const productName = pickWarehouseProductNameFromRow(clean);
    if (isSurpriseSetNonProductLabel(productName)) continue;
    if (!productName) continue;
    products.push(productName);
    sawProduct = true;
  }

  return { productLines: products.reverse(), capped: false };
};

const collectAutopilotProductRowsFromWholeBlock = (lines) => {
  const productLines = [];
  for (const line of lines) {
    if (isAutopilotIgnoredProductLine(line)) continue;
    const productName = pickWarehouseProductNameFromRow(line);
    if (isSurpriseSetNonProductLabel(productName)) continue;
    if (!productName) continue;
    productLines.push(productName);
  }
  return { productLines, capped: false };
};

const extractProductLinesFromSheetBlock = (blockText) => {
  const lines = String(blockText || "").split(/\r?\n/);
  const setupLineIndex = lines.findIndex(line => getAutopilotSetupHeader(line));
  if (setupLineIndex > 0) return collectAutopilotProductRowsAboveSetup(lines, setupLineIndex);
  return collectAutopilotProductRowsFromWholeBlock(lines);
};

const normalizeAutopilotSheetCell = (value) => String(value ?? "").trim();

const valuesToTabSeparatedText = (values = [], startCol = 0, endCol = Infinity) =>
  (Array.isArray(values) ? values : [])
    .map(row => (Array.isArray(row) ? row : [])
      .slice(startCol, Number.isFinite(endCol) ? endCol : undefined)
      .map(normalizeAutopilotSheetCell)
      .join("\t")
      .replace(/\t+$/g, "")
      .trimEnd())
    .filter(line => normalizeSetSheetProductName(line))
    .join("\n");

const hasAutopilotSheetGroupData = (values = [], startCol = 0, endCol = Infinity) =>
  (Array.isArray(values) ? values : []).some(row => {
    const cells = (Array.isArray(row) ? row : []).slice(startCol, Number.isFinite(endCol) ? endCol : undefined);
    return cells.some(cell => /[A-Za-z]/.test(normalizeAutopilotSheetCell(cell)));
  });

const addAutopilotChannelMetadataToBlock = (blockText, channel, tabName = "") => {
  const lines = String(blockText || "").split(/\r?\n/);
  const headerIndex = lines.findIndex(line => getAutopilotSetupHeader(line));
  const fallbackHeader = detectAutopilotDateStreamerFromText(tabName);
  const cleanChannel = normalizeSetSheetProductName(channel).toUpperCase();
  const channelSuffix = ["CK", "PS", "PM"].includes(cleanChannel) ? ` + CHANNEL: ${cleanChannel}` : "";
  if (headerIndex < 0) return blockText;
  return lines.map((line, index) => index === headerIndex ? `${line}${channelSuffix}${fallbackHeader ? ` + TAB: ${tabName}` : ""}` : line).join("\n");
};

const findAutopilotSetupColumns = (values = []) => {
  const columns = new Set();
  (Array.isArray(values) ? values : []).forEach(row => {
    (Array.isArray(row) ? row : []).forEach((cell, columnIndex) => {
      if (getAutopilotSetupHeader(cell)) columns.add(columnIndex);
    });
  });
  return Array.from(columns).sort((a, b) => a - b);
};

const getAutopilotColumnLetter = (index) => {
  let value = Number(index) + 1;
  let label = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    label = String.fromCharCode(65 + mod) + label;
    value = Math.floor((value - mod) / 26);
  }
  return label;
};

const getAutopilotGroupLabel = (startCol, endCol) =>
  `${getAutopilotColumnLetter(startCol)}-${getAutopilotColumnLetter(Math.max(startCol, endCol - 1))}`;

const getAutopilotColumnGroupsForTab = (channel, values = []) => {
  const safeValues = Array.isArray(values) ? values : [];
  const setupColumns = findAutopilotSetupColumns(safeValues);
  const channelCode = String(channel || "").toUpperCase();
  if (setupColumns.length > 1) {
    return setupColumns.map((startCol, index) => ({
      startCol,
      endCol: Math.min(setupColumns[index + 1] ?? startCol + (channelCode === "CK" ? 4 : 5), startCol + (channelCode === "CK" ? 4 : 5)),
    }));
  }
  if (setupColumns.length === 1) {
    const startCol = setupColumns[0];
    return [{ startCol, endCol: startCol + (channelCode === "CK" ? 4 : 5) }];
  }
  if (channelCode === "CK") return [{ startCol: 0, endCol: 4 }, { startCol: 4, endCol: 8 }];
  return [{ startCol: 0, endCol: 5 }, { startCol: 5, endCol: 10 }, { startCol: 10, endCol: 15 }];
};

const getAutopilotRowCellsForGroup = (row = [], startCol = 0, endCol = Infinity) =>
  (Array.isArray(row) ? row : []).slice(startCol, Number.isFinite(endCol) ? endCol : undefined).map(normalizeSetSheetProductName);

const isAutopilotBlankGroupRow = (row = []) => !row.some(Boolean);
const getAutopilotGroupLine = (row = []) => row.filter(Boolean).join("\t");

const isCardKingSetLabelCandidate = (value) => {
  const clean = normalizeSetSheetProductName(value);
  if (!clean) return false;
  const compact = clean.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  if (!/[A-Za-z0-9]/.test(compact)) return false;
  if (getAutopilotSetupHeader(compact) || isWarehouseSetupLine(compact) || isWarehouseFormulaLine(compact)) return false;
  if (/^(hard\s*floor|target|stretch|retail|cost|total|subtotal|built|not\s*done|done)\b/i.test(compact)) return false;
  if (/^\$?\s*\d+(?:\.\d{1,2})?$/.test(compact)) return false;
  if (/\b(black|white|red|blue|green)\s+vr\b/i.test(compact)) return false;
  if (/\b(vr\s*(box|bag)|vault|pack|booster|bundle|commander|deck|collector\s*booster|play\s*booster)\b/i.test(compact)) return false;
  if (/\b(surprise|rapid\s*fire|fabled|cache)\b|50\s*\/\s*50/i.test(compact)) return true;
  return /\bmagic\b/i.test(compact) && compact.length <= 48 && (/\b(morning|night|day)\b/i.test(compact) || /\d+\s*$/.test(compact));
};

const isSurpriseSetNonProductLabel = (value) => {
  const clean = normalizeSetSheetProductName(value);
  if (!clean) return true;
  const compact = clean.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  if (isCardKingSetLabelCandidate(compact)) return true;
  if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(compact)) return true;
  if (/\b(morning|night|evening|day)\s+magic\s*\d*\b/i.test(compact)) return true;
  if (/^magic\s*\d+$/i.test(compact)) return true;
  if (/^surprise\s*\d+$/i.test(compact)) return true;
  if (/\bcollectors?\s+cache(?:\s+surprise)?\s*\d*\b/i.test(compact)) return true;
  if (/\bcache\s+surprise\s*\d*\b/i.test(compact)) return true;
  if (/^(hard\s*floor|target|stretch|retail|cost|total|subtotal|built|not\s*done|done)\b/i.test(compact)) return true;
  return false;
};

const isAutopilotProductNameCell = (value) => {
  const clean = normalizeSetSheetProductName(value);
  if (!clean || !/[A-Za-z]/.test(clean)) return false;
  if (isAutopilotIgnoredProductLine(clean) || isAutopilotStopScanLine(clean)) return false;
  if (/^(retail|cost)$/i.test(clean)) return false;
  return true;
};

const isValidSurpriseProductRow = (row = {}, groupMeta = {}) => {
  const cells = Array.isArray(row.cells) ? row.cells : [];
  const productName = cells[0] || "";
  const line = getAutopilotGroupLine(cells);
  if (!productName || !line) return false;
  if (!isAutopilotProductNameCell(productName)) return false;
  if (isSurpriseSetNonProductLabel(productName) || isSurpriseSetNonProductLabel(line)) return false;
  if (getAutopilotSetupHeader(productName) || getAutopilotSetupHeader(line)) return false;
  if (isWarehouseSetupLine(productName) || isWarehouseSetupLine(line)) return false;
  if (isWarehouseFormulaLine(productName) || /^=/.test(productName)) return false;
  if (/^\$?\s*\d+(?:\.\d{1,2})?$/.test(productName)) return false;
  if (/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/.test(productName)) return false;
  if (/\b(retail|cost|total|subtotal|hard\s*floor|target|stretch)\b/i.test(line)) return false;
  if (groupMeta.channelCode === "CK" && /\b(magic|collectors?\s+cache|cache\s+surprise)\b/i.test(productName) && /\d|\b(morning|night|thursday|friday|monday|tuesday|wednesday|saturday|sunday)\b/i.test(productName)) return false;
  return true;
};

const findAutopilotSetupRowsInGroup = (groupRows = [], tabFallback = null) => {
  const matches = [];
  groupRows.forEach((row, index) => {
    const headers = row.cells.map(getAutopilotSetupHeader).filter(Boolean);
    if (headers[0]) matches.push({ index, rowNumber: row.rowNumber, header: headers[0], line: getAutopilotGroupLine(row.cells) });
  });
  if (!matches.length && tabFallback) {
    groupRows.forEach((row, index) => {
      const line = getAutopilotGroupLine(row.cells);
      if (/\b(hard\s*floor|target|stretch)\b/i.test(line)) matches.push({ index, rowNumber: row.rowNumber, header: tabFallback, line });
    });
  }
  return matches;
};

const detectAutopilotPriceFromGroupRows = (groupRows = [], setupIndex = 0, label = "TARGET") => {
  const pattern = new RegExp(`\\b${label}\\b\\s*:?\\s*\\$?\\s*([0-9]+(?:\\.[0-9]{1,2})?)\\b`, "i");
  for (let index = setupIndex; index < Math.min(groupRows.length, setupIndex + 8); index += 1) {
    const cells = groupRows[index]?.cells || [];
    const inline = getAutopilotGroupLine(cells).match(pattern);
    if (inline) return inline[1];
    const labelIndex = cells.findIndex(cell => new RegExp(`\\b${label}\\b`, "i").test(cell));
    if (labelIndex >= 0) {
      const nextNumeric = cells.slice(labelIndex + 1).find(cell => /^\$?\s*[0-9]+(?:\.[0-9]{1,2})?$/.test(cell));
      if (nextNumeric) return nextNumeric.replace(/[^0-9.]/g, "");
    }
  }
  return "";
};

const findAutopilotSetNameFromGroupRows = (groupRows = [], setupIndex = 0, channelCode = "", setNumber = "1") => {
  if (String(channelCode || "").toUpperCase() === "CK") {
    let blankRun = 0;
    for (let index = setupIndex - 1; index >= Math.max(0, setupIndex - 25); index -= 1) {
      const row = groupRows[index];
      const firstCell = row?.cells?.[0] || "";
      const line = getAutopilotGroupLine(row?.cells || []);
      if (!line) {
        blankRun += 1;
        if (blankRun > 3) break;
        continue;
      }
      blankRun = 0;
      if (getAutopilotSetupHeader(line) || isWarehouseSetupLine(line)) continue;
      if (isCardKingSetLabelCandidate(firstCell) || isCardKingSetLabelCandidate(line)) return firstCell || line;
    }
  }
  for (let index = setupIndex + 1; index < Math.min(groupRows.length, setupIndex + 5); index += 1) {
    const firstCell = groupRows[index]?.cells?.[0] || "";
    if (isStrongWarehouseSetNameLine(firstCell) && !isWarehouseSetupLine(firstCell)) return firstCell;
  }
  return String(channelCode || "").toUpperCase() === "CK" ? `CardKing Magic Set ${setNumber}` : "";
};

const collectAutopilotProductRowsForGroup = (groupRows = [], setupIndex = 0, groupMeta = {}) => {
  const productLines = [];
  const sourceProductUnits = [];
  let startRow = "";
  let endRow = "";
  const lowerBound = Number.isFinite(groupMeta.previousSetupIndex) ? groupMeta.previousSetupIndex : -1;
  for (let index = setupIndex - 1; index >= 0; index -= 1) {
    if (index <= lowerBound) break;
    const row = groupRows[index];
    if (!row) continue;
    if (isAutopilotBlankGroupRow(row.cells)) continue;
    const line = getAutopilotGroupLine(row.cells);
    if (getAutopilotSetupHeader(line)) break;
    if (isAutopilotStopScanLine(line) || /\b(retail|cost)\b/i.test(line)) {
      continue;
    }
    const productName = row.cells[0] || "";
    if (!isValidSurpriseProductRow(row, groupMeta)) continue;
    productLines.push(productName);
    const unit = buildSourceProductUnit(productName, {
      channel: groupMeta.channelCode,
      sheetTab: groupMeta.sheetTab,
      columnGroup: groupMeta.columnGroup,
      sourceRowNumber: row.rowNumber,
    });
    if (unit) sourceProductUnits.push(unit);
    startRow = row.rowNumber;
    if (!endRow) endRow = row.rowNumber;
  }
  return {
    productLines: productLines.reverse(),
    sourceProductUnits: sourceProductUnits.reverse(),
    capped: false,
    productStartRow: startRow || "",
    productEndRow: endRow || "",
  };
};

const buildAutopilotPreviewRowsFromSheetTab = ({ channel, channelLabel, spreadsheetName, tabName, values, tabOrder, tabShiftMeta }, selectedDates = []) => {
  if (AUTOPILOT_IGNORED_SHEET_TAB_PATTERN.test(normalizeSetSheetProductName(tabName))) return { previewRows: [], ignored: 1 };
  const channelCode = String(channel || "").trim().toUpperCase();
  const brand = getAutopilotBrandFromChannelCode(channelCode);
  const tabFallback = detectAutopilotDateStreamerFromTabName(tabName);
  const groups = getAutopilotColumnGroupsForTab(channelCode, values);
  const previewRows = [];
  groups.forEach((group, groupIndex) => {
    const groupRows = (Array.isArray(values) ? values : []).map((row, rowIndex) => ({ rowNumber: rowIndex + 1, cells: getAutopilotRowCellsForGroup(row, group.startCol, group.endCol) }));
    if (!groupRows.some(row => !isAutopilotBlankGroupRow(row.cells))) return;
    const setupRows = findAutopilotSetupRowsInGroup(groupRows, tabFallback);
    setupRows.forEach((setup, verticalIndex) => {
      const header = setup.header || tabFallback || {
        streamDate: tabShiftMeta?.streamDate || "",
        streamer: tabShiftMeta?.streamer || "",
      };
      const streamDate = header.streamDate || "";
      if (selectedDates.length && streamDate && !selectedDates.includes(streamDate)) return;
      const setNumber = String(groupIndex + verticalIndex + 1);
      const columnGroup = getAutopilotGroupLabel(group.startCol, group.endCol);
      const productResult = collectAutopilotProductRowsForGroup(groupRows, setup.index, {
        channelCode,
        sheetTab: tabName,
        columnGroup,
        previousSetupIndex: setupRows[verticalIndex - 1]?.index ?? -1,
      });
      const hardFloor = detectAutopilotPriceFromGroupRows(groupRows, setup.index, "HARD\\s*FLOOR");
      const target = detectAutopilotPriceFromGroupRows(groupRows, setup.index, "TARGET");
      const stretch = detectAutopilotPriceFromGroupRows(groupRows, setup.index, "STRETCH");
      const explicitShift = detectAutopilotShiftFromText(`${tabName}\n${setup.line}`);
      const shift = explicitShift || tabShiftMeta?.assignedShift || "";
      let surpriseSetName = findAutopilotSetNameFromGroupRows(groupRows, setup.index, channelCode, setNumber);
      const warnings = [...(tabShiftMeta?.warnings || [])];
      if (!target) warnings.push("Missing target");
      if (!streamDate) warnings.push("Missing date");
      if (!header.streamer) warnings.push("Missing streamer");
      if (!shift) warnings.push("Missing shift");
      if (!productResult.productLines.length) warnings.push("No product rows found.");
      if (!surpriseSetName) {
        surpriseSetName = channelCode === "CK" ? `CardKing Magic Set ${setNumber}` : `${channelCode || "Set"} Surprise Set ${setNumber}`;
        warnings.push("Set name generated.");
      } else if (channelCode === "CK" && /^CardKing Magic Set/i.test(surpriseSetName)) {
        warnings.push("Set name generated.");
      }
      if (!brand) warnings.push("Ambiguous column group");
      previewRows.push({
        id: `${channelCode}-${tabName}-${columnGroup}-${setup.rowNumber}-${setNumber}`.replace(/[^A-Za-z0-9_-]+/g, "_"),
        include: !hasAutopilotCriticalWarnings(warnings),
        channel: channelCode,
        brand: brand || "CardKing47",
        channelLabel,
        spreadsheetName,
        sheetTab: tabName,
        tabOrder: tabOrder || tabShiftMeta?.tabOrder || "",
        tabDateOrder: tabShiftMeta?.tabDateOrder || "",
        columnGroup,
        setupRowNumber: setup.rowNumber,
        productStartRow: productResult.productStartRow,
        productEndRow: productResult.productEndRow,
        rowRangeUsed: productResult.productStartRow && productResult.productEndRow ? `${productResult.productStartRow}-${productResult.productEndRow}` : "-",
        streamDate,
        day: streamDate ? getDayNameFromDate(streamDate) : getDefaultSurpriseSetBoardDay(),
        streamer: header.streamer || "",
        shift: shift || "Unknown",
        setNumber,
        surpriseSetName,
        startingBid: target,
        hardFloor,
        stretch,
        productLines: productResult.productLines,
        sourceProductUnits: productResult.sourceProductUnits,
        productCount: getSourceProductUnitCount(productResult.sourceProductUnits),
        warnings,
      });
    });
  });
  return { previewRows, ignored: 0 };
};

const buildAutopilotPreviewRowsFromSheetsImport = (payload = {}, selectedDates = []) => {
  const channelMap = payload?.data?.channels || payload?.channels || {};
  let ignoredTabs = 0;
  const previewRows = Object.entries(channelMap).flatMap(([channel, channelData]) => {
    const tabs = Array.isArray(channelData?.tabs) ? channelData.tabs : [];
    const shiftMap = buildAutopilotTabShiftMap(channel, tabs);
    return tabs.flatMap((tab, tabIndex) => {
      const tabOrder = tabIndex + 1;
      const result = buildAutopilotPreviewRowsFromSheetTab({
        channel,
        channelLabel: channelData?.label || "",
        spreadsheetName: channelData?.spreadsheetName || "",
        tabName: tab?.tabName || channelData?.spreadsheetName || channel,
        tabOrder,
        tabShiftMeta: shiftMap.get(tabOrder),
        values: tab?.values || [],
      }, selectedDates);
      ignoredTabs += result.ignored || 0;
      return result.previewRows;
    });
  });
  return { previewRows, ignoredTabs };
};

const formatAutopilotShiftLabel = (shift) => {
  const clean = String(shift || "").trim();
  if (clean === "am") return "AM";
  if (clean === "pm") return "PM";
  if (/^extra/i.test(clean)) return "Extra";
  return clean || "Unknown";
};

const blockHasAutopilotSignal = (blockText, tabName = "") => {
  const text = String(blockText || "");
  if (detectSurpriseSetBlocks(text).length) return true;
  return Boolean(detectAutopilotDateStreamerFromText(tabName) && /(target|hard\s*floor|stretch)/i.test(text));
};

const ensureAutopilotSetupLine = (blockText, tabName, channel) => {
  if (detectSurpriseSetBlocks(blockText).length) return blockText;
  const fallback = detectAutopilotDateStreamerFromText(tabName);
  if (!fallback) return blockText;
  const cleanChannel = normalizeSetSheetProductName(channel).toUpperCase();
  const channelSuffix = ["CK", "PS", "PM"].includes(cleanChannel) ? ` + CHANNEL: ${cleanChannel}` : "";
  const datePart = `${Number(fallback.streamDate.slice(5, 7))}/${Number(fallback.streamDate.slice(8, 10))}`;
  return `${blockText}\n${datePart} (${fallback.streamer})${channelSuffix}`;
};

const buildAutopilotBlocksFromSheetTab = ({ channel, channelLabel, spreadsheetName, tabName, values }) => {
  if (AUTOPILOT_IGNORED_SHEET_TAB_PATTERN.test(normalizeSetSheetProductName(tabName))) return [];
  const safeValues = Array.isArray(values) ? values : [];
  const columnGroups = getAutopilotColumnGroupsForTab(channel, safeValues);

  return columnGroups
    .map(({ startCol, endCol }, index) => {
      if (!hasAutopilotSheetGroupData(safeValues, startCol, endCol)) return "";
      const blockText = valuesToTabSeparatedText(safeValues, startCol, endCol);
      if (!blockText) return "";
      if (!blockHasAutopilotSignal(blockText, tabName)) return "";
      const withSetup = ensureAutopilotSetupLine(blockText, tabName, channel);
      const withChannel = addAutopilotChannelMetadataToBlock(withSetup, channel, tabName);
      const meta = [
        `CHANNEL: ${channel}`,
        channelLabel ? `CHANNEL LABEL: ${channelLabel}` : "",
        tabName ? `TAB: ${tabName}` : "",
        spreadsheetName ? `SPREADSHEET: ${spreadsheetName}` : "",
        String(channel || "").toUpperCase() === "CK" ? `GROUP SET: ${index + 1}` : "",
      ].filter(Boolean).join("\n");
      return `${meta}\n${withChannel}`;
    })
    .filter(Boolean);
};

const buildAutopilotBlocksFromSheetsImport = (payload = {}) => {
  const channelMap = payload?.data?.channels || payload?.channels || {};
  return Object.entries(channelMap).flatMap(([channel, channelData]) =>
    (Array.isArray(channelData?.tabs) ? channelData.tabs : []).flatMap(tab =>
      buildAutopilotBlocksFromSheetTab({
        channel,
        channelLabel: channelData?.label || "",
        spreadsheetName: channelData?.spreadsheetName || "",
        tabName: tab?.tabName || channelData?.spreadsheetName || channel,
        values: tab?.values || [],
      })
    )
  );
};

const countAutopilotSheetTabs = (payload = {}) => {
  const channelMap = payload?.data?.channels || payload?.channels || {};
  return Object.values(channelMap).reduce((sum, channelData) =>
    sum + (Array.isArray(channelData?.tabs) ? channelData.tabs.length : 0), 0);
};

const normalizeImportedSet = (block, fallbackOptions = {}) => {
  const rawLines = String(block?.text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const warnings = [];
  const streamDate = block?.header?.streamDate || getAutopilotDateForRange(fallbackOptions.dateRange, fallbackOptions.selectedDay);
  const streamer = block?.header?.streamer || "";
  const day = getDayNameFromDate(streamDate) || fallbackOptions.selectedDay || getDefaultSurpriseSetBoardDay();
  const detectedBrand = detectAutopilotBrand(block?.text);
  const fallbackBrands = getAutopilotSelectedBrands(fallbackOptions);
  const brand = detectedBrand || fallbackBrands[0] || "CardKing47";
  const detectedShift = detectWarehouseSheetShift(block?.text);
  const fallbackShift = ["am", "pm"].includes(fallbackOptions.currentShift) ? fallbackOptions.currentShift : "";
  const shift = detectedShift || fallbackShift || "am";
  const hardFloor = detectAutopilotPrice(rawLines, "HARD\\s*FLOOR");
  const target = detectAutopilotPrice(rawLines, "TARGET");
  const stretch = detectAutopilotPrice(rawLines, "STRETCH");
  const startingBid = target || hardFloor || "";
  const setupLineIndex = rawLines.findIndex(line => getAutopilotSetupHeader(line));
  let surpriseSetName = "";

  for (let index = Math.max(setupLineIndex + 1, 0); index < rawLines.length; index += 1) {
    const line = rawLines[index];
    if (isStrongWarehouseSetNameLine(line) && !isWarehouseFormulaLine(line) && !isWarehouseSetupLine(line)) {
      surpriseSetName = normalizeSetSheetProductName(line);
      break;
    }
  }
  if (!surpriseSetName) {
    const tabLine = rawLines.find(line => /^TAB\s*:/i.test(line));
    if (tabLine) {
      surpriseSetName = normalizeSetSheetProductName(tabLine.replace(/^TAB\s*:\s*/i, "").replace(/\b(BUILT|NOT\s*DONE|DONE)\b/ig, ""));
    }
  }

  if (!detectedBrand) warnings.push("Channel not detected. Used selected channel.");
  if (!detectedShift && !fallbackShift) warnings.push("Shift not detected.");
  if (!target) warnings.push("Target price missing.");
  if (!startingBid) warnings.push("Starting bid needs review.");
  if (!streamer || !block?.header?.streamDate) warnings.push("Could not detect setup block.");
  if (!surpriseSetName) warnings.push("Surprise set name needs review.");

  const extractedProducts = extractProductLinesFromSheetBlock(block?.text);
  const productLines = extractedProducts.productLines.filter(line => line !== surpriseSetName);
  const sourceProductUnits = buildSourceProductUnitsFromLines(productLines, {
    channel: getSurpriseSetBrandCode(brand),
  });
  if (!productLines.length) warnings.push("No product rows found.");

  return {
    brand,
    brandCode: getSurpriseSetBrandCode(brand),
    day: SURPRISE_SET_DAYS.includes(day) ? day : getDefaultSurpriseSetBoardDay(),
    shift,
    streamer,
    streamDate,
    setNumber: "",
    surpriseSetName,
    startingBid,
    hardFloor,
    stretch,
    input: productLines.join("\n"),
    productLines,
    sourceProductUnits,
    warnings,
  };
};

const buildImportedSetCard = (importedSet) => {
  const sourceProductUnits = Array.isArray(importedSet.sourceProductUnits) && importedSet.sourceProductUnits.length
    ? importedSet.sourceProductUnits
    : buildSourceProductUnitsFromLines(importedSet.productLines || String(importedSet.input || "").split(/\r?\n/), {
        channel: importedSet.brandCode || getSurpriseSetBrandCode(importedSet.brand),
        sheetTab: importedSet.sheetTab || "",
        columnGroup: importedSet.columnGroup || "",
      });
  const rows = sourceProductUnits.length ? parseSetSheetInput(sourceProductUnits.map(unit => unit.rawProductName || unit.normalizedProductName).join("\n")) : parseSetSheetInput(importedSet.input);
  const summary = { ...getSetSheetSummary(rows), totalQuantity: sourceProductUnits.length ? getSourceProductUnitCount(sourceProductUnits) : getSetSheetSummary(rows).totalQuantity };
  const converted = rows.length > 0 && !importedSet.needsReview;
  const warnings = [...(importedSet.warnings || [])];
  if (!converted && !warnings.includes("No product rows found.")) warnings.push("No product rows found.");
  const normalized = normalizeSurpriseSetBoardEntry({
    ...importedSet,
    fileName: buildSurpriseSetFileName(importedSet),
    rows,
    summary,
    sourceProductUnits,
    status: converted ? "Converted" : "Needs Review",
    convertedAt: converted ? nowISO() : "",
    warnings,
    importSource: "Sheet Autopilot",
    sheetTab: importedSet.sheetTab || "",
    columnGroup: importedSet.columnGroup || "",
  });
  return {
    ...normalized,
    fileName: normalized.fileName || buildSurpriseSetFileName(normalized),
  };
};

const getAutopilotWarningChipLabel = (warning) => {
  const text = String(warning || "");
  if (/shift/i.test(text)) return "Shift review";
  if (/target/i.test(text)) return "Missing target";
  if (/product|count/i.test(text)) return "Review products";
  return text;
};

const getAutopilotBoardMatchKey = (entry) => [
  entry.brandCode || getSurpriseSetBrandCode(entry.brand),
  entry.streamDate || entry.day,
  entry.shift,
  String(entry.streamer || "").trim().toLowerCase(),
  String(entry.setNumber || "1"),
  String(entry.sheetTab || "").trim().toLowerCase(),
  String(entry.columnGroup || "").trim().toLowerCase(),
].join("|");

const mergeImportedSetIntoBoard = (boardEntries, importedSet) => {
  const existingEntries = Array.isArray(boardEntries) ? boardEntries.map(normalizeSurpriseSetBoardEntry) : [];
  const sameGroup = existingEntries.filter(entry =>
    (entry.brandCode || getSurpriseSetBrandCode(entry.brand)) === importedSet.brandCode &&
    entry.day === importedSet.day &&
    entry.shift === importedSet.shift &&
    String(entry.streamer || "").trim().toLowerCase() === String(importedSet.streamer || "").trim().toLowerCase() &&
    entry.streamDate === importedSet.streamDate
  );
  const setNumber = importedSet.setNumber || String(sameGroup.length + 1);
  const card = buildImportedSetCard({ ...importedSet, setNumber });
  const matchKey = getAutopilotBoardMatchKey(card);
  const existing = existingEntries.find(entry => getAutopilotBoardMatchKey(entry) === matchKey);
  const mergedCard = existing ? normalizeSurpriseSetBoardEntry({ ...existing, ...card, id: existing.id }) : card;
  const nextBoard = existing
    ? existingEntries.map(entry => entry.id === existing.id ? mergedCard : entry)
    : [...existingEntries, mergedCard];
  return { boardEntries: nextBoard, card: mergedCard, updated: Boolean(existing) };
};

const parseAutopilotImport = (rawText, options = {}) => {
  const blocks = detectSurpriseSetBlocks(rawText);
  const warnings = [];
  if (!blocks.length) warnings.push("Could not detect setup block.");
  const groupCounts = {};
  const importedSets = blocks.map(block => normalizeImportedSet(block, options)).map(item => {
    const key = [item.brandCode, item.day, item.shift, item.streamer, item.streamDate].join("|");
    groupCounts[key] = (groupCounts[key] || 0) + 1;
    return { ...item, setNumber: String(groupCounts[key]) };
  });
  return { importedSets, warnings };
};

const DEMO_SETS = [
  { id: uid(), brand: "Vaulted Rarities", streamer: "Jonny", date: "2025-05-08", setName: "May Holo Bundle A", quantity: 50, warehouseListReceived: true, convertedSetSheet: true, importedDesktop: true, quantitiesVerified: true, readyForLive: true },
  { id: uid(), brand: "CardKing47", streamer: "Jonny", date: "2025-05-09", setName: "CK Graded Pack Set", quantity: 30, warehouseListReceived: true, convertedSetSheet: true, importedDesktop: false, quantitiesVerified: false, readyForLive: false },
  { id: uid(), brand: "PokeSpins", streamer: "Jonny", date: "2025-05-10", setName: "PokeSpins Mystery Box", quantity: 20, warehouseListReceived: false, convertedSetSheet: false, importedDesktop: false, quantitiesVerified: false, readyForLive: false },
];

const SHIFT_START = [
  "Open Daily Ops Brief",
  "Refresh Command Inbox",
  "Run Process Queue",
  "Review drafts ready for approval",
  "Review refunds and returns",
  "Review replacements needing follow-up",
  "Sweep TikTok Shop Chats manually if needed",
  "Check Surprise Sets for today and tomorrow",
];
const SHIFT_END = [
  "Clear high-priority inbox items",
  "Approve or copy all safe drafts",
  "Update replacement and reship log",
  "Complete or update Action Queue items",
  "Schedule or check surprise sets for tomorrow",
  "Confirm no overdue actions",
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
    "Where is my order": `${greeting}\n\nThank you for reaching out about ${oNum}. I can see your order has been processed and a shipping label has been created. Carriers can take 24-48 hours to scan packages after pickup, especially during high-volume periods.\n\nI'm monitoring your shipment and will follow up as soon as there's a tracking update. If you don't see movement within 2 business days, please let me know and I'll open a carrier investigation right away.\n\nThank you for your patience.${sign}`,
    "Label created / no scan": `${greeting}\n\nThank you for checking in on ${oNum}. I can confirm your shipping label was created and the order has been handed off to the carrier. I'm currently seeing that the package has not received a carrier scan yet - this can happen during high-volume pickup windows.\n\nI've flagged this for investigation. If we don't see a scan update within 48 hours, I will file a carrier trace on your behalf and keep you updated.\n\nThank you for your patience.${sign}`,
    "Refund request": `${greeting}\n\nI've received your refund request for ${oNum} and I'm reviewing it right away. We take all refund requests seriously and want to make sure this is handled fairly for you.\n\nTo process this quickly, could you confirm:\n- The reason for the refund request\n- Whether the item is still sealed or has been opened\n- Your preferred resolution - refund or replacement\n\nI'll follow up within 1 business day once I have those details.${sign}`,
    "Return request": `${greeting}\n\nThank you for reaching out about ${oNum}. I've received your return request and I'm reviewing your order now.\n\nTo make sure I process this correctly, could you confirm:\n- Whether the item is sealed or opened\n- The reason for the return request\n\nI'll follow up within 1 business day with next steps.${sign}`,
    "Surprise set dispute": `${greeting}\n\nThank you for reaching out about ${oNum}. I want to make sure this gets resolved for you.\n\nSurprise sets are curated ahead of each stream, and contents may vary from what is shown during live. To investigate your concern, could you please:\n- Share a short unboxing video or photos of the contents received\n- Describe the specific concern with the set\n\nOnce I've reviewed the details, I'll follow up with next steps.${sign}`,
    "Missing item": `${greeting}\n\nI'm sorry to hear ${oNum} arrived with a missing item - that's not the experience we want for you.\n\nTo investigate and process a resolution, could you please send:\n- A photo of the package as it arrived (outside and inside)\n- A photo of all items included in the shipment\n- A photo of the packing slip, if one was included\n\nI'll review everything and get back to you within 24 hours.${sign}`,
    "Damaged item": `${greeting}\n\nI'm so sorry to hear that ${oNum} arrived damaged. That's not acceptable and I want to make this right for you immediately.\n\nTo file a damage claim and process your replacement or refund, I'll need:\n- Clear photos of the damaged item(s)\n- A photo of the outer packaging showing any damage\n\nPlease send those over and I'll prioritize your case right away.${sign}`,
    "Wrong item": `${greeting}\n\nThank you for letting me know about ${oNum}. I apologize for the mix-up on our end.\n\nTo get the correct item to you as quickly as possible, could you please:\n- Send a photo of the item(s) you received\n- Confirm the item(s) you originally ordered\n\nOnce I verify the details, I'll get a replacement shipped out promptly.${sign}`,
    "Hostile customer": `${greeting}\n\nThank you for reaching out. I understand you're frustrated and I assure you that we take your concern seriously.\n\nI am reviewing ${oNum} now and will respond with a complete update by end of day. We are committed to resolving this professionally and fairly.\n\nIf you'd prefer to continue this conversation through another channel, please let me know.${sign}`,
  };
  return templates[issueType] || `${greeting}\n\nThank you for reaching out about ${oNum}. I'm reviewing your case now and will follow up with an update shortly.${sign}`;
};

// ─── PRIMITIVES ───────────────────────────────────────────────────────────────
const Card = ({ children, className = "", ...props }) => (
  <div {...props} className={`bg-white border border-gray-200 rounded-xl shadow-sm ${className}`}>{children}</div>
);

const Badge = ({ label, className = "" }) => (
  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none ${className}`}>{label}</span>
);
const StatusBadge = ({ status }) => <Badge label={status} className={STATUS_STYLE[status] || "bg-gray-100 text-gray-600 border-gray-200"} />;
const PriorityBadge = ({ priority }) => <Badge label={priority} className={PRIORITY_STYLE[priority] || "bg-gray-100 text-gray-600 border-gray-200"} />;

const BrandPip = ({ brand, size = "sm" }) => (
  <span
    className={`inline-block rounded-sm flex-shrink-0 ${size === "lg" ? "w-3 h-3" : "w-2.5 h-2.5"}`}
    style={{ backgroundColor: BRAND_DOT[brand] || "#9ca3af" }}
  />
);

const ProgressBar = ({ pct, color = "bg-slate-500" }) => (
  <div className="w-full bg-gray-200 rounded-full h-1.5">
    <div className={`${color} h-1.5 rounded-full transition-all`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
  </div>
);

const BtnPrimary = ({ children, onClick, size = "sm", disabled = false }) => (
  <button onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-800 bg-slate-700 font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ${size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"}`}>{children}</button>
);
const BtnSecondary = ({ children, onClick, size = "sm", disabled = false }) => (
  <button onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 ${size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"}`}>{children}</button>
);
const BtnSuccess = ({ children, onClick, size = "sm", disabled = false }) => (
  <button onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-800 bg-slate-700 font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ${size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"}`}>{children}</button>
);
const BtnDanger = ({ children, onClick, size = "sm", disabled = false }) => (
  <button onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 ${size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"}`}>{children}</button>
);

const Sel = ({ value, onChange, options, placeholder = "Select...", className = "" }) => (
  <select value={value} onChange={e => onChange(e.target.value)} className={`w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 transition-colors focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-100 ${className}`}>
    {placeholder && <option value="">{placeholder}</option>}
    {options.map(o => <option key={o} value={o}>{o}</option>)}
  </select>
);
const Inp = ({ value, onChange, placeholder, type = "text", className = "" }) => (
  <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={`w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 transition-colors focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-100 ${className}`} />
);
const Txt = ({ value, onChange, placeholder, rows = 3, className = "" }) => (
  <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} className={`w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 transition-colors focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-100 ${className}`} />
);
const Chk = ({ checked, onChange, label }) => (
  <label className="flex items-center gap-2.5 cursor-pointer group">
    <div onClick={() => onChange(!checked)} className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${checked ? "bg-slate-700 border-slate-700" : "border-gray-300 hover:border-slate-400"}`}>
      {checked && <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-white"><path d="M2 5.2 4.1 7.2 8 2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}
    </div>
    <span className={`text-sm ${checked ? "line-through text-gray-400" : "text-gray-700 group-hover:text-gray-900"}`}>{label}</span>
  </label>
);
const FL = ({ children }) => <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{children}</p>;

const showOpsToast = (message, options = {}) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("ops-hub-toast", {
    detail: {
      id: Date.now() + Math.random(),
      message,
      type: options.type || "info",
      title: options.title || "",
    },
  }));
};

const showOpsConfirm = ({ title, body, confirmLabel, variant = "archive", onConfirm }) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("ops-hub-confirm", {
    detail: { title, body, confirmLabel, variant, onConfirm },
  }));
};

const OpsConfirmModal = ({ config, onCancel, onConfirm, busy }) => {
  if (!config) return null;
  const isDanger = ["delete", "clear", "archive"].includes(config.variant);
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 px-4 py-6">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
        <div className="mb-4">
          <p className="text-lg font-bold text-gray-900">{config.title}</p>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">{config.body}</p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex items-center justify-center rounded-lg border px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${isDanger ? "border-slate-900 bg-slate-800 hover:bg-slate-900" : "border-slate-800 bg-slate-700 hover:bg-slate-800"}`}
          >
            {busy ? "Working..." : config.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const OpsToastStack = ({ toasts, onDismiss }) => (
  <div className="fixed right-4 top-16 z-[9999] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
    {toasts.map(toast => (
      <div key={toast.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-lg" role="status">
        <div className="flex items-start justify-between gap-3">
          <div>
            {toast.title && <p className="text-sm font-bold text-gray-900">{toast.title}</p>}
            <p className={`${toast.title ? "mt-1 " : ""}text-xs leading-relaxed text-gray-600`}>{toast.message}</p>
          </div>
          <button
            onClick={() => onDismiss(toast.id)}
            className="text-xs font-semibold text-gray-400 transition-colors hover:text-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    ))}
  </div>
);

// ─── PATCH 3: ArchiveBtn - reusable trash icon button ────────────────────────
const ArchiveBtn = ({ ticketId, setTickets }) => {
  const runArchive = async () => {
    const { error } = await archiveTicketInSupabase(ticketId, "manual archive");
    if (error) {
      showOpsToast(`Archive failed: ${error.message || "Unknown Supabase error"}`, { type: "error" });
      return;
    }
    setTickets(prev => prev.filter(t => t.id !== ticketId));
    showOpsToast("Ticket archived.");
  };

  const handleArchive = () => {
    showOpsConfirm({
      title: "Archive ticket?",
      body: "This ticket will be hidden from the active queue. You can still keep the record in Supabase.",
      confirmLabel: "Archive Ticket",
      variant: "archive",
      onConfirm: runArchive,
    });
  };

  return (
    <button
      onClick={handleArchive}
      title="Archive ticket"
      className="flex-shrink-0 text-gray-300 hover:text-red-400 transition-colors cursor-pointer p-0.5 rounded"
    >
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path d="M1.5 3.5h10M5 3.5V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M2.5 3.5l.5 7a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1l.5-7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M5 6v3M8 6v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    </button>
  );
};

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
  pricecheck: <><path d="M3 3h10v10H3z" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M5 6h6M5 9h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M11 9.5c0 .83-.67 1.5-1.5 1.5S8 10.33 8 9.5 8.67 8 9.5 8 11 8.67 11 9.5z" stroke="currentColor" strokeWidth="1.1" fill="none"/></>,
  weekly: <path d="M2 12l3-5 3 2 3-6 3 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>,
  data: <><ellipse cx="8" cy="4" rx="5" ry="2" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M3 4v4c0 1.1 2.24 2 5 2s5-.9 5-2V4" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M3 8v4c0 1.1 2.24 2 5 2s5-.9 5-2V8" stroke="currentColor" strokeWidth="1.3" fill="none"/></>,
  inbox: <><rect x="1" y="3" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M1 6l7 4 7-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></>,
  actions: <><path d="M2 4h9M2 8h7M2 12h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="12" cy="11" r="3" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M14.5 13.5l1.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></>,
};
const NavItem = ({ id, label, active, onClick, badge, showLabel = true }) => (
  <button
    onClick={() => onClick(id)}
    title={!showLabel ? label : undefined}
    className={`relative w-full flex items-center ${showLabel ? "gap-2.5 px-3 justify-start" : "justify-center px-0"} py-2 rounded-lg text-sm font-medium transition-all text-left overflow-hidden ${active ? "bg-slate-800 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"}`}
  >
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={`flex-shrink-0 ${active ? "text-white" : "text-gray-400"}`}>{ICONS[id]}</svg>
    {showLabel && <span className="flex-1 truncate">{label}</span>}
    {badge > 0 && showLabel && <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">{badge}</span>}
    {badge > 0 && !showLabel && <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />}
  </button>
);

const NAV = [
  { section: null, items: [{ id: "dashboard", label: "Dashboard" }, { id: "inbox", label: "Command Inbox" }] },
  { section: "Operations", items: [{ id: "replacements", label: "Replacements" }, { id: "studio", label: "Inventory" }, { id: "pricecheck", label: "Price Check" }, { id: "sets", label: "Surprise Sets" }] },
  { section: "Reporting", items: [{ id: "weekly", label: "Reports" }, { id: "data", label: "Settings" }] },
];

// ─── OPS ACTIONS SUPABASE HELPERS ────────────────────────────────────────────

const ACTION_PRIORITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

const fetchOpsActionsFromSupabase = async () => {
  if (!supabase) return { data: [], error: { message: "No Supabase client." } };
  const { data, error } = await supabase
    .from("ops_actions")
    .select("*")
    .neq("status", "Completed")
    .order("due_at",    { ascending: true,  nullsFirst: false })
    .order("created_at",{ ascending: true })
    .limit(200);
  if (error) { console.error("ops_actions fetch error:", error); return { data: [], error }; }
  // Client-side priority sort on top of Supabase ordering
  const sorted = (data || []).slice().sort((a, b) => {
    const pa = ACTION_PRIORITY_ORDER[a.priority] ?? 9;
    const pb = ACTION_PRIORITY_ORDER[b.priority] ?? 9;
    return pa - pb;
  });
  return { data: sorted, error: null };
};

const updateOpsActionStatusInSupabase = async (id, status) => {
  if (!supabase || !id) return { error: null };
  const payload = { status, updated_at: nowISO() };
  if (status === "Completed") payload.completed_at = nowISO();
  const { error } = await supabase.from("ops_actions").update(payload).eq("id", id);
  if (error) console.error("ops_actions status update error:", error);
  return { error };
};

const insertOpsActionToSupabase = async (row) => {
  if (!supabase) return { data: null, error: { message: "No Supabase client." } };
  const { data, error } = await supabase.from("ops_actions").insert([row]).select("*").single();
  if (error) console.error("ops_actions insert error:", error);
  return { data, error };
};

// Deterministic due_at from priority
const defaultDueAt = (priority) => {
  const d = new Date();
  if (priority === "Critical" || priority === "High") {
    d.setHours(23, 59, 59, 0); // end of today
    return d.toISOString();
  }
  if (priority === "Medium") {
    d.setDate(d.getDate() + 1);
    d.setHours(23, 59, 59, 0);
    return d.toISOString();
  }
  return null; // Low - no due date
};

// Derive action_type from triage fields
const deriveActionType = (msg) => {
  const rt = (msg.recommended_reply_type || "").toLowerCase();
  const it = (msg.issue_type || "").toLowerCase();
  if (rt === "archive_noise" || it === "noise / not cs") return "Noise / Archive";
  if (it.includes("missing package"))    return "Investigate Shipment";
  if (it.includes("missing item"))       return "Replacement Needed";
  if (it.includes("wrong item"))         return "Replacement Needed";
  if (it.includes("refund"))             return "Process Refund";
  if (it.includes("return"))             return "Process Return";
  if (it.includes("follow-up") || it.includes("follow up")) return "Customer Follow-Up";
  if (msg.needs_human_review === true || msg.needs_human_review === "true") return "Human Review Required";
  return "Follow Up";
};

// Derive short title for the action card
const deriveActionTitle = (msg) => {
  const name = msg.customer_name || msg.sender_name || "Customer";
  const it   = msg.issue_type || "inquiry";
  return `${it} - ${name}`.slice(0, 80);
};

// ─── ACTION PRIORITY / STATUS STYLES ─────────────────────────────────────────
const ACTION_PRIORITY_STYLE = {
  Critical: "bg-black text-white border-black",
  High:     "bg-black text-white border-black",
  Medium:   "bg-slate-50 text-slate-700 border-slate-200",
  Low:      "bg-gray-100 text-gray-600 border-gray-200",
};
const ACTION_STATUS_STYLE = {
  "Open":                "bg-slate-50 text-slate-700 border-slate-200",
  "In Progress":         "bg-slate-100 text-slate-700 border-slate-200",
  "Waiting on Customer": "bg-gray-50 text-gray-700 border-gray-200",
  "Replacement Needed":  "bg-gray-50 text-gray-700 border-gray-200",
  "Completed":           "bg-gray-100 text-gray-600 border-gray-200",
};
const ACTION_FILTERS = ["All", "Due Today", "Overdue", "High Priority", "Waiting on Customer", "Replacement Needed"];

// ─── NEXT ACTION QUEUE VIEW ───────────────────────────────────────────────────
const NextActionQueueView = ({ opsActions, setOpsActions, opsLoading, opsError, onRefresh, setActiveView }) => {
  const [activeFilter, setActiveFilter] = useState("All");
  const [busyId, setBusyId] = useState(null);

  const now = new Date();
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

  const isOverdue   = (a) => a.due_at && new Date(a.due_at) < now;
  const isDueToday  = (a) => a.due_at && new Date(a.due_at) <= todayEnd && !isOverdue(a);
  const isHighPlus  = (a) => a.priority === "High" || a.priority === "Critical";

  const openCount     = opsActions.length;
  const dueTodayCount = opsActions.filter(isDueToday).length;
  const overdueCount  = opsActions.filter(isOverdue).length;
  const highCount     = opsActions.filter(isHighPlus).length;

  const filtered = opsActions.filter(a => {
    if (activeFilter === "All")                  return true;
    if (activeFilter === "Due Today")            return isDueToday(a);
    if (activeFilter === "Overdue")              return isOverdue(a);
    if (activeFilter === "High Priority")        return isHighPlus(a);
    if (activeFilter === "Waiting on Customer")  return a.status === "Waiting on Customer";
    if (activeFilter === "Replacement Needed")   return a.status === "Replacement Needed" || a.action_type === "Replacement Needed";
    return true;
  });

  const handleStatus = async (id, status) => {
    setBusyId(id);
    const { error } = await updateOpsActionStatusInSupabase(id, status);
    setBusyId(null);
    if (error) { showOpsToast(`Update failed: ${error.message}`, { type: "error" }); return; }
    if (status === "Completed") {
      setOpsActions(prev => prev.filter(a => a.id !== id));
    } else {
      setOpsActions(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    }
  };

  const fmtDue = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    const isToday = d.toDateString() === now.toDateString();
    return isToday ? "Due today" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Next Action Queue</h2>
          <p className="text-xs text-gray-400 mt-0.5">{opsActions.length} open actions</p>
        </div>
        <button onClick={onRefresh} disabled={opsLoading}
          className="inline-flex items-center gap-1.5 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 font-medium rounded-lg border border-gray-300 transition-colors cursor-pointer px-3 py-1.5 text-xs">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={opsLoading ? "animate-spin" : ""}>
            <path d="M10 6A4 4 0 1 1 6 2a4 4 0 0 1 2.83 1.17L10 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <path d="M8 4h2V2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {opsLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {opsError && <div className="bg-red-50 border border-red-300 rounded-lg px-4 py-3 text-red-800 text-sm">{opsError}</div>}

      {/* Count chips */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Open",         count: openCount,     cls: "border-l-slate-300" },
          { label: "Due Today",    count: dueTodayCount, cls: "border-l-slate-300" },
          { label: "Overdue",      count: overdueCount,  cls: "border-l-slate-300" },
          { label: "High Priority",count: highCount,     cls: "border-l-slate-300" },
        ].map(({ label, count, cls }) => (
          <Card key={label} className={`p-4 border-l-4 ${cls}`}>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{count}</p>
          </Card>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1 no-scrollbar">
        {ACTION_FILTERS.map(opt => (
          <button key={opt} onClick={() => setActiveFilter(opt)}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors cursor-pointer ${
              activeFilter === opt
                ? "bg-slate-700 text-white border-slate-800"
                : "bg-white text-gray-600 border-gray-300 hover:border-slate-400 hover:text-slate-700"
            }`}>
            {opt}
          </button>
        ))}
        <span className="text-[10px] text-gray-400 ml-1">{filtered.length} shown</span>
      </div>

      {/* Loading skeleton */}
      {opsLoading && opsActions.length === 0 && (
        <div className="space-y-2">
          {[1,2,3].map(i => (
            <div key={i} className="bg-white border border-gray-200 rounded-lg p-4 animate-pulse">
              <div className="h-3 bg-gray-200 rounded w-1/3 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-2/3" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!opsLoading && filtered.length === 0 && !opsError && (
        <div className="text-center py-16 text-gray-300">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="mx-auto mb-3">
            <rect x="4" y="6" width="32" height="28" rx="3" stroke="currentColor" strokeWidth="1.8" fill="none"/>
            <path d="M12 15h16M12 21h12M12 27h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          <p className="text-sm font-medium">{activeFilter === "All" ? "Queue is clear" : `No actions match "${activeFilter}"`}</p>
          <p className="text-xs mt-1">{activeFilter === "All" ? "No open actions." : "Try a different filter."}</p>
        </div>
      )}

      {/* Action cards */}
      <div className="space-y-2">
        {filtered.map(action => {
          const isBusy     = busyId === action.id;
          const overdue    = isOverdue(action);
          const dueDisplay = fmtDue(action.due_at);
          const prStyle    = ACTION_PRIORITY_STYLE[action.priority] || "bg-gray-100 text-gray-500 border-gray-200";
          const stStyle    = ACTION_STATUS_STYLE[action.status]     || "bg-gray-100 text-gray-500 border-gray-200";

          return (
            <Card key={action.id} className={`p-4 ${overdue ? "border-red-200" : ""}`}>
              {/* Header row */}
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  {action.brand && <BrandPip brand={action.brand} />}
                  {action.brand && <span className="text-xs font-semibold text-gray-700">{BRAND_SHORT[action.brand] || action.brand}</span>}
                  {action.action_type && <span className="text-[10px] text-gray-500 border border-gray-200 bg-gray-50 rounded px-1.5 py-0.5">{action.action_type}</span>}
                  {action.priority && <Badge label={action.priority} className={prStyle} />}
                  {action.status   && <Badge label={action.status}   className={stStyle} />}
                  {overdue && <Badge label="Overdue" className="bg-black text-white border-black" />}
                </div>
                {dueDisplay && (
                  <span className={`text-[10px] flex-shrink-0 whitespace-nowrap font-medium ${overdue ? "text-black" : "text-gray-400"}`}>{dueDisplay}</span>
                )}
              </div>

              {/* Title + details */}
              {action.title   && <p className="text-xs font-semibold text-gray-900 mb-1">{action.title}</p>}
              {action.details && <p className="text-[11px] text-gray-500 mb-2 line-clamp-3 leading-relaxed">{action.details}</p>}

              {/* Customer info */}
              {(action.customer_name || action.customer_email) && (
                <p className="text-[10px] text-gray-400 mb-2">
                  {action.customer_name && <span className="font-medium text-gray-600">{action.customer_name}</span>}
                  {action.customer_email && <span className="ml-1">· {action.customer_email}</span>}
                </p>
              )}

              {/* Action buttons */}
              <div className="flex flex-wrap gap-1.5">
                {action.status !== "In Progress" && (
                  <button disabled={isBusy} onClick={() => handleStatus(action.id, "In Progress")}
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer transition-colors">
                    In Progress
                  </button>
                )}
                {action.status !== "Waiting on Customer" && (
                  <button disabled={isBusy} onClick={() => handleStatus(action.id, "Waiting on Customer")}
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer transition-colors">
                    Waiting
                  </button>
                )}
                <button disabled={isBusy} onClick={() => handleStatus(action.id, "Completed")}
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-slate-800 bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer transition-colors">
                  Complete
                </button>
                {action.inbound_message_id && (
                  <button onClick={() => setActiveView("inbox")}
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors">
                    Open Message
                  </button>
                )}
                {action.ticket_id && (
                  <button onClick={() => setActiveView("tickets")}
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors">
                    Open Ticket
                  </button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

// ─── AUTOMATION RULES SUPABASE HELPERS ───────────────────────────────────────

const fetchAutomationRulesFromSupabase = async () => {
  if (!supabase) return { data: [], error: { message: "No Supabase client." } };
  const { data, error } = await supabase
    .from("automation_rules")
    .select("*")
    .eq("is_enabled", true)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) { console.error("automation_rules fetch error:", error); return { data: [], error }; }
  return { data: data || [], error: null };
};

// Match priority (highest to lowest specificity):
//   1. brand + channel + issue_type + recommended_reply_type
//   2. brand + issue_type
//   3. channel + issue_type
//   4. issue_type only
//   5. recommended_reply_type only
//   6. null (no match)
const findAutomationRule = (rules, msg) => {
  if (!rules || rules.length === 0) return null;
  const brand   = (msg.brand                   || "").toLowerCase();
  const channel = (msg.channel                 || "").toLowerCase();
  const issue   = (msg.issue_type              || "").toLowerCase();
  const rrt     = (msg.recommended_reply_type  || "").toLowerCase();

  const match = (rule) => {
    const rb  = (rule.brand                  || "").toLowerCase();
    const rc  = (rule.channel                || "").toLowerCase();
    const ri  = (rule.issue_type             || "").toLowerCase();
    const rr  = (rule.recommended_reply_type || "").toLowerCase();
    return { rb, rc, ri, rr };
  };

  // Tier 1: all four fields
  let found = rules.find(r => {
    const { rb, rc, ri, rr } = match(r);
    return rb && rc && ri && rr && rb === brand && rc === channel && ri === issue && rr === rrt;
  });
  if (found) return found;

  // Tier 2: brand + issue_type
  found = rules.find(r => {
    const { rb, ri } = match(r);
    return rb && ri && rb === brand && ri === issue;
  });
  if (found) return found;

  // Tier 3: channel + issue_type
  found = rules.find(r => {
    const { rc, ri } = match(r);
    return rc && ri && rc === channel && ri === issue;
  });
  if (found) return found;

  // Tier 4: issue_type only
  found = rules.find(r => {
    const { rb, rc, ri } = match(r);
    return ri && !rb && !rc && ri === issue;
  });
  if (found) return found;

  // Tier 5: recommended_reply_type only
  found = rules.find(r => {
    const { rb, rc, ri, rr } = match(r);
    return rr && !rb && !rc && !ri && rr === rrt;
  });
  return found || null;
};

// ─── INBOUND MESSAGE SUPABASE HELPERS ────────────────────────────────────────

const fetchInboundMessagesFromSupabase = async () => {
  if (!supabase) return { data: [], error: { message: "No Supabase client." } };
  const { data, error } = await supabase
    .from(INBOUND_MESSAGES_TABLE)
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .order("received_time", { ascending: false })
    .limit(300);
  if (error) { console.error("Supabase inbound fetch error:", error); return { data: [], error }; }
  return { data: data || [], error: null };
};

const updateInboundStatusInSupabase = async (id, status) => {
  if (!supabase || !id) return { error: null };
  const { error } = await supabase
    .from(INBOUND_MESSAGES_TABLE)
    .update({ status, updated_at: nowISO() })
    .eq("id", id);
  if (error) console.error("Supabase inbound status update error:", error);
  return { error };
};

const archiveInboundInSupabase = async (id) => {
  if (!supabase || !id) return { error: { message: "No Supabase client or id." } };
  const { error } = await supabase
    .from(INBOUND_MESSAGES_TABLE)
    .update({ archived_at: nowISO(), updated_at: nowISO() })
    .eq("id", id);
  if (error) console.error("Supabase inbound archive error:", error);
  return { error };
};

// ─── REPLACEMENTS SUPABASE HELPERS ───────────────────────────────────────────

const closeAndArchiveInboundInSupabase = async (id) => {
  if (!supabase || !id) return { error: { message: "No Supabase client or id." } };
  const { error } = await supabase
    .from(INBOUND_MESSAGES_TABLE)
    .update({ status: "Closed", archived_at: nowISO(), updated_at: nowISO() })
    .eq("id", id);
  if (error) console.error("Supabase inbound close/archive error:", error);
  return { error };
};

const fetchReplacementsFromSupabase = async () => {
  if (!supabase) return { data: [], error: { message: "No Supabase client." } };
  const { data, error } = await supabase
    .from("replacements")
    .select("id, date, brand, customer_name, order_number, reason, root_cause, replacement_items, notes, value, preventable, follow_up, status, archived_at, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) {
    console.error("Supabase replacements fetch error:", error);
    return { data: [], error };
  }
  // Normalise snake_case DB columns → camelCase used by the UI
  const rows = (data || []).map(r => ({
    id:                r.id,
    date:              r.date              || r.created_at?.slice(0, 10) || "",
    brand:             r.brand             || "",
    customerName:      r.customer_name     || "",
    orderNum:          r.order_number      || "",
    reason:            r.reason            || "",
    rootCause:         r.root_cause        || "",
    replacementItems:  r.replacement_items || "",
    notes:             r.notes             || "",
    marketValue:       parseFloat(r.value  || 0),
    preventable:       r.preventable       || "No",
    followUp:          r.follow_up         || "No",
    status:            r.status            || "Open",
    archived_at:       r.archived_at,
    created_at:        r.created_at,
    updated_at:        r.updated_at,
  }));
  return { data: rows, error: null };
};

const dbReplacementToApp = (r = {}) => ({
  id:                r.id,
  date:              r.date              || r.created_at?.slice(0, 10) || "",
  brand:             r.brand             || "",
  customerName:      r.customer_name     || "",
  orderNum:          r.order_number      || "",
  reason:            r.reason            || "",
  rootCause:         r.root_cause        || "",
  replacementItems:  r.replacement_items || "",
  notes:             r.notes             || "",
  marketValue:       parseFloat(r.value  || 0),
  preventable:       r.preventable       || "No",
  followUp:          r.follow_up         || "No",
  status:            r.status            || "Open",
  archived_at:       r.archived_at,
  created_at:        r.created_at,
  updated_at:        r.updated_at,
});

const insertReplacementToSupabase = async (row = {}) => {
  const appRow = {
    id: row.id,
    date: row.date || todayDate(),
    brand: row.brand || "",
    customerName: row.customerName || "",
    orderNum: row.orderNum || "",
    reason: row.reason || "Customer support replacement case",
    rootCause: row.rootCause || "Needs review",
    replacementItems: row.replacementItems || "",
    notes: row.notes || "",
    marketValue: parseFloat(row.marketValue || 0) || 0,
    preventable: row.preventable || "No",
    followUp: row.followUp || "Yes",
    status: row.status || "Follow-up Needed",
    created_at: row.created_at || nowISO(),
    updated_at: nowISO(),
  };

  if (!supabase) {
    return { data: { ...appRow, id: row.id || uid() }, error: null };
  }

  const payload = {
    date: appRow.date,
    brand: appRow.brand || null,
    customer_name: appRow.customerName || null,
    order_number: appRow.orderNum || null,
    reason: appRow.reason || null,
    root_cause: appRow.rootCause || null,
    replacement_items: appRow.replacementItems || null,
    notes: appRow.notes || null,
    value: appRow.marketValue || 0,
    preventable: appRow.preventable || "No",
    follow_up: appRow.followUp || "Yes",
    status: appRow.status || "Follow-up Needed",
    created_at: appRow.created_at,
    updated_at: appRow.updated_at,
  };

  const { data, error } = await supabase
    .from("replacements")
    .insert([payload])
    .select("id, date, brand, customer_name, order_number, reason, root_cause, replacement_items, notes, value, preventable, follow_up, status, archived_at, created_at, updated_at")
    .single();

  if (error) {
    console.error("Supabase replacement insert error:", error);
    return { data: null, error };
  }
  return { data: dbReplacementToApp(data), error: null };
};

// ─── TIKTOK SHOP CHAT EMAIL NORMALIZER ───────────────────────────────────────
// Cleans TikTok Seller Assistant email boilerplate for display only.
// Raw message_body in Supabase is NEVER modified.

const isTikTokShopMessage = (msg) =>
  msg.channel === "TikTok Shop" ||
  (msg.subject || "").toLowerCase().includes("a new message from tiktok shop customer");

// Extract username from subject: "A new message from TikTok Shop customer <username>"
const extractTikTokCustomerName = (subject) => {
  const m = (subject || "").match(/tiktok shop customer\s+(\S+)/i);
  return m ? m[1].trim() : null;
};

// Phrases that mark the END of the new-message section (history boundary).
// The first line matching any of these terminates extraction.
const TIKTOK_HISTORY_BOUNDARIES = [
  /^reply in chat\s*$/i,
  /^you can also respond by directly replying to this email/i,
  /^if you think this message doesn't need a response/i,
  /^your previous chat with\b/i,
];

// Phrases that mark the START of the new-message section.
const TIKTOK_NEW_MSG_START = /^you have received new messages from\s*:?\s*$/i;

// Returns true for lines that are junk within the new-message window.
const isTikTokJunkLine = (line, username) => {
  if (!line) return true;
  // Lone username repetition
  if (username && line.toLowerCase() === username.toLowerCase()) return true;
  // Pure digits e.g. "96"
  if (/^\d+$/.test(line)) return true;
  // Pure symbols / pipes
  if (/^[|/\\\-*=~`]+$/.test(line)) return true;
  // Timestamp lines e.g. "1:03PM, May 14"
  if (/^\d{1,2}:\d{2}\s*(AM|PM),?\s+\w+\.?\s+\d{1,2}$/i.test(line)) return true;
  // Snapshot note
  if (/note:\s*the information seen in this email is snapshot data/i.test(line)) return true;
  // Bare URLs
  if (/^https?:\/\/\S+$/i.test(line)) return true;
  // Markdown links
  if (/^\[.*\]\(https?:\/\/.*\)$/.test(line)) return true;
  return false;
};

// Core parser: isolates the new-message section then strips junk lines.
const cleanTikTokBody = (raw, username) => {
  if (!raw) return "";

  const allLines = raw.split(/\r?\n/).map(l => l.trim());

  // ── Step 1: find start of new-message section ──────────────────────────────
  let start = 0;
  for (let i = 0; i < allLines.length; i++) {
    if (TIKTOK_NEW_MSG_START.test(allLines[i])) {
      start = i + 1; // section begins on the line AFTER the header
      break;
    }
  }

  // ── Step 2: find end of new-message section (history boundary) ─────────────
  let end = allLines.length;
  for (let i = start; i < allLines.length; i++) {
    if (TIKTOK_HISTORY_BOUNDARIES.some(re => re.test(allLines[i]))) {
      end = i;
      break;
    }
  }

  // ── Step 3: slice to new-message window, strip junk ─────────────────────────
  const window = allLines.slice(start, end);
  const kept = window.filter(line => !isTikTokJunkLine(line, username));

  return kept.join("\n").trim();
};

// Public entry point - returns { displayName, displayBody, hasHistory }.
// hasHistory = true when a "Your previous chat with" boundary was found,
// used to show the optional collapsed note in the card.
// Non-TikTok messages pass through unchanged.
const getDisplayInboundMessage = (msg) => {
  const isZendesk = String(msg?.source || "").toLowerCase() === "zendesk";
  if (isZendesk) {
    const notes = String(msg?.notes || "").trim();
    return {
      displayName: msg?.customer || msg?.sender_name || msg?.sender_email || msg?.account || null,
      displayBody: notes,
      hasHistory: false,
    };
  }
  const body = msg?.message || msg?.message_body || msg?.message_text || "";
  if (!isTikTokShopMessage(msg)) {
    return { displayName: null, displayBody: body, hasHistory: false };
  }

  const nameFromSubject = extractTikTokCustomerName(msg.subject);

  // Detect history presence before cleaning
  const rawLines = body.split(/\r?\n/).map(l => l.trim());
  const hasHistory = rawLines.some(l => /^your previous chat with\b/i.test(l));

  const displayBody = cleanTikTokBody(body, nameFromSubject);

  // Username fallback: first non-empty line after new-message header
  let nameFromBody = null;
  for (let i = 0; i < rawLines.length; i++) {
    if (TIKTOK_NEW_MSG_START.test(rawLines[i])) {
      for (let j = i + 1; j < rawLines.length; j++) {
        if (rawLines[j]) { nameFromBody = rawLines[j]; break; }
      }
      break;
    }
  }

  const displayName =
    nameFromSubject || nameFromBody || msg.customer_name || msg.sender_name || null;

  return { displayName, displayBody, hasHistory };
};

const parseZendeskNotes = (notes) => {
  const text = String(notes || "");
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const valueFrom = (label) => {
    const regex = new RegExp(`^${label}:\\s*(.+)$`, "i");
    for (const line of lines) {
      const match = line.match(regex);
      if (match?.[1]) return match[1].trim();
    }
    return "";
  };
  const preview = valueFrom("Latest message/description preview") || valueFrom("Message preview");
  const subject = valueFrom("Subject");
  const requesterEmail = valueFrom("Requester email");
  const ticketId = valueFrom("Zendesk Ticket ID");
  const url = valueFrom("Zendesk URL");
  return { subject, preview, requesterEmail, ticketId, url };
};


// ─── INBOX PRIORITY / STATUS STYLES ──────────────────────────────────────────
const INBOX_PRIORITY_STYLE = {
  "High":   "bg-black text-white border-black",
  "Medium": "bg-slate-50 text-slate-700 border-slate-200",
  "Low":    "bg-gray-100 text-gray-600 border-gray-200",
};
const INBOX_STATUS_STYLE = {
  "Needs Reply":    "bg-slate-50 text-slate-700 border-slate-200",
  "In Progress":   "bg-slate-100 text-slate-700 border-slate-200",
  "Ticket Created":"bg-gray-50 text-gray-700 border-gray-200",
  "Draft Ready":   "bg-gray-50 text-gray-700 border-gray-200",
  "Closed":        "bg-gray-100 text-gray-600 border-gray-200",
};
const TRIAGE_STATUS_STYLE = {
  "Untriaged":          "bg-gray-100 text-gray-500 border-gray-200",
  "Triaged":            "bg-slate-50 text-slate-700 border-slate-200",
  "Needs Human Review": "bg-black text-white border-black",
  "Needs Investigation":"bg-amber-50 text-amber-700 border-amber-200",
  "Noise / Not CS":     "bg-gray-100 text-gray-400 border-gray-200",
  "High Priority":      "bg-black text-white border-black",
};
const RISK_LEVEL_STYLE = {
  "High":   "bg-black text-white border-black",
  "Medium": "bg-slate-50 text-slate-700 border-slate-200",
  "Low":    "bg-gray-100 text-gray-500 border-gray-200",
};
const INBOX_FILTER_OPTIONS = ["All", "Zendesk", "TikTok Shop Chat", "Refunds / Returns", "Shopify", "Outlook", "Noise / Not CS", "Untriaged", "Needs Human Review", "High Priority", "Closed", "Archived"];

const INBOX_BRAND_BORDER_CLASS = {
  "Vaulted Rarities": "border-l-yellow-400",
  "Vaulted": "border-l-yellow-400",
  "VR": "border-l-yellow-400",
  "PokeSpins": "border-l-red-600",
  "PS": "border-l-red-600",
  "CardKing47": "border-l-blue-600",
  "CardKing": "border-l-blue-600",
  "CK47": "border-l-blue-600",
  "CK": "border-l-blue-600",
  "Pokiemart": "border-l-green-600",
  "PokieMart": "border-l-green-600",
  "PM": "border-l-green-600",
  "Unknown": "border-l-slate-300",
  "Unassigned": "border-l-slate-300",
};

const getInboxBrandBorderClass = (brand) => {
  const value = (brand || "").trim();
  if (INBOX_BRAND_BORDER_CLASS[value]) return INBOX_BRAND_BORDER_CLASS[value];
  const lower = value.toLowerCase();
  if (lower.includes("vaulted")) return INBOX_BRAND_BORDER_CLASS["Vaulted"];
  if (lower.includes("pokespins")) return INBOX_BRAND_BORDER_CLASS["PokeSpins"];
  if (lower.includes("cardking47")) return INBOX_BRAND_BORDER_CLASS["CardKing47"];
  if (lower.includes("pokiemart")) return INBOX_BRAND_BORDER_CLASS["Pokiemart"];
  return INBOX_BRAND_BORDER_CLASS["Unknown"];
};

const inferInboxBrandFromText = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  const spaced = ` ${lower.replace(/[^a-z0-9]+/g, " ")} `;
  const hasToken = (token) => spaced.includes(` ${token} `);

  if (lower.includes("tts_vaulted") || lower.includes("vaulted rarities") || lower.includes("vaulted") || hasToken("vr")) return "Vaulted Rarities";
  if (lower.includes("tts_cardking") || lower.includes("cardking47") || lower.includes("cardking") || hasToken("ck47") || hasToken("ck")) return "CardKing47";
  if (lower.includes("tts_pokespins") || lower.includes("pokespins") || hasToken("ps")) return "PokeSpins";
  if (lower.includes("tts_pokiemart") || lower.includes("pokiemart") || lower.includes("pokie mart") || hasToken("pm")) return "PokieMart";
  return "";
};

const getDisplayBrand = (message) => {
  const msg = message || {};
  const preferred = [msg.account, msg.brand];
  for (const candidate of preferred) {
    const value = String(candidate || "").trim();
    const rawValue = value.toLowerCase();
    if (value && rawValue !== "unassigned" && rawValue !== "unknown") {
      return inferInboxBrandFromText(value) || value;
    }
  }

  const sources = [msg.label, msg.external_id, msg.source, msg.channel, msg.subject];
  for (const source of sources) {
    const inferred = inferInboxBrandFromText(source);
    if (inferred) return inferred;
  }
  return "Unassigned";
};

// ─── INBOX MESSAGE CLASSIFICATION HELPERS ────────────────────────────────────

// Format an ISO timestamp in Pacific time. Gracefully returns "" on bad input.
const fmtPacific = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
      hour12: true,
    });
  } catch { return ""; }
};

// Returns the best display timestamp + a label ("Received" or "Imported").
const getInboundTimestamp = (msg) => {
  const recv = msg.received_at || msg.email_received_at || msg.received_time;
  if (recv) return { iso: recv, label: "Received", display: fmtPacific(recv) };
  if (msg.created_at) return { iso: msg.created_at, label: "Imported", display: fmtPacific(msg.created_at) };
  return { iso: null, label: "", display: "" };
};

// Detect if an inbound message is a TikTok refund/return notification.
const isTikTokRefund = (msg) => {
  const subject = msg.subject || "";
  const subj = subject.toLowerCase();
  const lbl = (msg.label || "").toLowerCase();
  const chan = (msg.channel || "").toLowerCase();
  const src = (msg.source || "").toLowerCase();
  const messageType = (msg.message_type || msg.messageType || "").toLowerCase();
  const issueType = (msg.issue_type || msg.issueType || "").toLowerCase();
  const customerIntent = (msg.customer_intent || msg.customerIntent || "").toLowerCase();
  const hasRefundReturn = (...values) => values.some(value =>
    /\b(refund|return)\b/i.test(String(value || "").replace(/[_/-]+/g, " "))
  );
  const hasTikTokSource = [chan, src, lbl].some(value => value.includes("tiktok") || value.includes("tik tok"));
  const compactMessageType = messageType.replace(/[^a-z0-9]/g, "");
  const clearlyTikTokRefundType =
    messageType === "tiktok refund" ||
    (messageType.includes("tiktok") && hasRefundReturn(messageType)) ||
    (compactMessageType.includes("tiktok") && (compactMessageType.includes("refund") || compactMessageType.includes("return")));
  const hasRefundNotificationSubject =
    /return\s*\/?\s*refund request received/i.test(subject) ||
    /refund request received/i.test(subject) ||
    /return request received/i.test(subject);
  const isTikTokShopChatSubject = subj.includes("a new message from tiktok shop customer");

  if (clearlyTikTokRefundType) return true;
  if (!hasTikTokSource) return false;
  if (hasRefundNotificationSubject) return true;
  if (isTikTokShopChatSubject) return false;
  return hasRefundReturn(messageType, subj, issueType, customerIntent);
};

// Returns a source category string for a message.
const classifyInboundSource = (msg) => {
  if (String(msg?.source || "").toLowerCase() === "zendesk") return "Zendesk";
  if (isTikTokRefund(msg)) return "TikTok Refund";
  const chan  = (msg.channel || "").toLowerCase();
  const src   = (msg.source  || "").toLowerCase();
  const lbl   = (msg.label   || "").toLowerCase();
  const subj  = (msg.subject || "").toLowerCase();
  const noise = (msg.triage_status || "") === "Noise / Not CS" ||
                (msg.issue_type    || "") === "Noise / Not CS";
  if (noise) return "Noise";
  if (chan.includes("tiktok") || lbl.includes("tiktok") ||
      subj.includes("tiktok shop customer") || src.includes("tiktok")) return "TikTok Shop Chat";
  if (chan.includes("shopify") || src.includes("shopify") ||
      lbl.includes("shopify") || subj.includes("shopify")) return "Shopify";
  if (chan.includes("outlook") || chan.includes("email") ||
      src.includes("outlook") || lbl.includes("outlook") ||
      (msg.sender_email || "").includes("outlook")) return "Outlook";
  return "Other";
};

// Source type badge styles
const SOURCE_BADGE_STYLE = {
  "Zendesk":          "bg-slate-800 text-white border-slate-900",
  "TikTok Shop Chat": "bg-black text-white border-black",
  "TikTok Refund":    "bg-black text-white border-black",
  "Shopify":          "bg-slate-700 text-white border-slate-800",
  "Outlook":          "bg-slate-600 text-white border-slate-700",
  "Noise":            "bg-gray-200 text-gray-500 border-gray-300",
  "Other":            "bg-gray-100 text-gray-500 border-gray-200",
};

// Derive the best display title for a card given its source type.
const getInboundCardTitle = (msg, sourceType, displayName) => {
  if (sourceType === "Zendesk") {
    return msg.order_number || msg.orderNumber || msg.subject || msg.issue_type || "Zendesk Ticket";
  }
  if (sourceType === "TikTok Refund") {
    const orderStr = (msg.order_number || msg.orderNumber || "").trim();
    return orderStr ? `Refund / Return Request - Order ${orderStr}` : "Refund / Return Request";
  }
  if (sourceType === "TikTok Shop Chat") {
    return displayName ? `Message from ${displayName}` : (msg.subject || "TikTok Shop Chat");
  }
  if (sourceType === "Shopify") {
    const who = msg.customer_name || msg.sender_name || msg.sender_email || "";
    return who ? `Shopify - ${who}` : (msg.subject || "Shopify Contact");
  }
  if (sourceType === "Outlook") {
    const who = msg.sender_name || msg.sender_email || "";
    return [who, msg.subject].filter(Boolean).join(" - ") || "Outlook Email";
  }
  return msg.subject || msg.issue_type || "Inbound Message";
};



// ─── COMMAND INBOX VIEW ───────────────────────────────────────────────────────
const isCommandInboxAssistantOpenStatus = (status) => {
  const normalized = String(status || "").trim();
  return !["Closed", "Archived", "Resolved"].includes(normalized);
};

const hasCommandInboxAssistantKeyword = (text, keywords) => {
  const normalized = String(text || "").toLowerCase();
  return keywords.some(keyword => normalized.includes(keyword));
};

const buildLocalAssistantAnalysis = (message) => {
  const msg = message || {};
  const { displayBody } = getDisplayInboundMessage(msg);
  const sourceType = classifyInboundSource(msg);
  const subject = String(msg.subject || "");
  const channel = String(msg.channel || "");
  const messageType = String(msg.message_type || msg.messageType || "");
  const issueType = String(msg.issue_type || msg.issueType || "");
  const customerIntent = String(msg.customer_intent || msg.customerIntent || "");
  const combinedText = [subject, channel, messageType, issueType, customerIntent, displayBody].join(" ");
  const lowerCombined = combinedText.toLowerCase();
  const timestamp = msg.email_received_at || msg.created_at;
  const ageMs = timestamp ? Date.now() - (new Date(timestamp).getTime() || Date.now()) : 0;
  const isOverdue = ageMs > 24 * 60 * 60 * 1000 && isCommandInboxAssistantOpenStatus(msg.status);
  const isHighPriority = String(msg.priority || msg.risk_level || "").toLowerCase() === "high";
  const hasOrderNumber = Boolean(msg.order_number || msg.orderNumber || /\b(order|order number|order #|#)\s*[:#-]?\s*[a-z0-9-]{4,}/i.test(combinedText));
  const hasEvidence = Boolean(msg.evidence || msg.evidence_url || /\b(photo|picture|image|screenshot|evidence|video)\b/i.test(combinedText));
  const hasItem = Boolean(msg.item || msg.product || msg.replacement_item || /\b(item|product|card|pack|box|order)\b/i.test(combinedText));
  const hasReason = /\b(reason|because|damaged|missing|wrong|lost|return|refund|broken)\b/i.test(combinedText);
  const isRefundCase =
    sourceType === "TikTok Refund" ||
    channel.toLowerCase() === "refund / return" ||
    messageType.toLowerCase().includes("refund") ||
    messageType.toLowerCase().includes("return") ||
    /\b(refund|return)\b/i.test(subject);
  const isReplacementCase = hasCommandInboxAssistantKeyword(lowerCombined, [
    "replacement",
    "missing item",
    "missing",
    "damaged",
    "shipping",
    "lost",
    "arrived wrong",
    "wrong item",
    "wrong product",
  ]);
  const isTikTokChat = sourceType === "TikTok Shop Chat" || channel.toLowerCase() === "tiktok shop chat";
  const isOutlook = sourceType === "Outlook" || channel.toLowerCase() === "outlook" || String(msg.source || "").toLowerCase().includes("outlook support");
  const missingInfo = [];
  const reasoningTags = [];
  let situation = "This looks like a general customer support message.";
  let recommendedNextStep = "Review the full message, confirm the customer need, and reply with the next clear step.";
  let draftReply = "Hey, thanks for reaching out. I can help with this. Can you send over your order number or a little more detail so I can check it for you?";
  let suggestedPriority = "Medium";
  let suggestedStatus = "Needs Reply";
  let confidence = "Medium";

  if (isRefundCase) {
    situation = "This appears to be a refund or return request.";
    recommendedNextStep = "Review the order and customer evidence before approving or rejecting anything.";
    draftReply = "Hey, thanks for reaching out. I can help review this for you. Can you send over your order number and a quick photo or details of what happened so I can check the refund request?";
    suggestedPriority = isOverdue ? "High" : "Medium";
    suggestedStatus = "Needs Review";
    confidence = "High";
    reasoningTags.push("refund_or_return");
    if (!hasOrderNumber) missingInfo.push("Order number");
    if (!hasReason) missingInfo.push("Return reason");
    if (!hasEvidence) missingInfo.push("Evidence");
  } else if (isReplacementCase) {
    situation = "This likely needs replacement or shipping review.";
    recommendedNextStep = "Verify the order, item, and evidence before sending a replacement.";
    draftReply = "Hey, I can help look into this. Can you send your order number and a photo of what arrived so I can confirm the issue and get this reviewed?";
    suggestedPriority = isOverdue ? "High" : "Medium";
    suggestedStatus = "Manual Review";
    confidence = "High";
    reasoningTags.push("replacement_or_shipping");
    if (!hasOrderNumber) missingInfo.push("Order number");
    if (!hasItem) missingInfo.push("Item");
    if (!hasEvidence) missingInfo.push("Photo or evidence");
  } else if (isTikTokChat) {
    situation = "This is a TikTok Shop customer message.";
    recommendedNextStep = "Answer directly if enough info is present, otherwise ask for order details.";
    suggestedPriority = "Medium";
    suggestedStatus = "Needs Reply";
    confidence = "Medium";
    reasoningTags.push("tiktok_shop_chat");
    if (!hasOrderNumber) missingInfo.push("Order details");
  } else if (isOutlook) {
    situation = "This is an email support request.";
    recommendedNextStep = "Review the full body and reply from the support voice.";
    suggestedPriority = "Medium";
    suggestedStatus = "Needs Reply";
    confidence = "Medium";
    reasoningTags.push("outlook_support");
    if (!hasOrderNumber) missingInfo.push("Order details if this is order related");
  } else {
    if (!hasOrderNumber) missingInfo.push("Order details if needed");
    reasoningTags.push("general_support");
  }

  if (isHighPriority) {
    recommendedNextStep = `Handle this before the normal queue. ${recommendedNextStep}`;
    suggestedPriority = "High";
    confidence = "High";
    reasoningTags.push("high_priority");
  }

  if (isOverdue) {
    recommendedNextStep = `This message is older than 24 hours. ${recommendedNextStep}`;
    suggestedPriority = "High";
    reasoningTags.push("overdue");
  }

  if (!missingInfo.length) missingInfo.push("No obvious missing info found.");

  return {
    situation,
    recommendedNextStep,
    missingInfo,
    draftReply,
    suggestedPriority,
    suggestedStatus,
    confidence,
    reasoningTags,
  };
};

const validateAssistantChoice = (value, allowed, fallback) =>
  allowed.includes(value) ? value : fallback;

const normalizeAssistantStringArray = (value, fallback = []) => {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value.map(item => String(item || "").trim()).filter(Boolean);
  return cleaned.length ? cleaned : fallback;
};

const sanitizeAssistantAnalysis = (message, data) => {
  const fallback = buildLocalAssistantAnalysis(message);
  const source = data && typeof data === "object" ? data : {};
  return {
    situation: String(source.situation || fallback.situation),
    recommendedNextStep: String(source.recommendedNextStep || fallback.recommendedNextStep),
    missingInfo: normalizeAssistantStringArray(source.missingInfo, fallback.missingInfo),
    draftReply: String(source.draftReply || fallback.draftReply),
    suggestedPriority: validateAssistantChoice(source.suggestedPriority, ["Low", "Medium", "High"], fallback.suggestedPriority),
    suggestedStatus: String(source.suggestedStatus || fallback.suggestedStatus),
    confidence: validateAssistantChoice(source.confidence, ["Low", "Medium", "High"], fallback.confidence),
    reasoningTags: normalizeAssistantStringArray(source.reasoningTags, fallback.reasoningTags),
  };
};

const getCommandInboxMessageText = (msg) => {
  const { displayBody } = getDisplayInboundMessage(msg || {});
  return [
    msg?.subject,
    msg?.message,
    msg?.message_body,
    msg?.message_text,
    displayBody,
    msg?.channel,
    msg?.message_type,
    msg?.issue_type,
    msg?.customer_intent,
    msg?.triage_summary,
    msg?.next_action,
    msg?.risk_level,
    msg?.priority,
  ].filter(Boolean).join(" ");
};

const getCommandInboxRiskFlag = (msg) => {
  if (!msg) return null;
  const sourceType = classifyInboundSource(msg);
  const text = getCommandInboxMessageText(msg);
  const lower = text.toLowerCase();
  const needsHuman = msg.needs_human_review === true || msg.needs_human_review === "true";
  const triageStatus = String(msg.triage_status || "");
  const riskLevel = String(msg.risk_level || "").toLowerCase();
  const priority = String(msg.priority || "").toLowerCase();
  const orderNumber = String(msg.order_number || msg.orderNumber || "").trim();
  const hasOrderNumber = Boolean(orderNumber || /\b(order\s*(number|#)?|order #|#)\s*(is|:|#|-)?\s*[a-z0-9-]{4,}/i.test(text));
  const hasEvidence = Boolean(
    msg.evidence ||
    msg.evidence_url ||
    msg.photo_url ||
    msg.attachment_url ||
    /\b(photo|picture|image|screenshot|video|evidence|attached|attachment)\b/i.test(text)
  );

  if (sourceType === "TikTok Refund" || /\b(refund|return|chargeback|cancel|cancellation|credit)\b/i.test(lower)) {
    return { label: "Needs Human Review", reason: "money" };
  }
  if (/\b(delivered but (not|never) received|says delivered|marked delivered|not received|never got|package missing|lost package)\b/i.test(lower)) {
    return { label: "Needs Human Review", reason: "delivered_not_received" };
  }
  if (/\b(replacement|reship|re-ship|send another|missing item|wrong item|wrong product|damaged|broken)\b/i.test(lower)) {
    if (!hasEvidence) return { label: "Needs Investigation", reason: "missing_evidence" };
    return { label: "Needs Human Review", reason: "replacement" };
  }
  if (/\b(angry|furious|scam|fraud|lawsuit|lawyer|attorney|bbb|chargeback|dispute|reporting you|terrible service)\b/i.test(lower)) {
    return { label: "Needs Human Review", reason: "customer_escalation" };
  }
  if (/\$\s?(1[0-9]{2,}|[2-9][0-9]{2,}|[1-9][0-9]{3,})\b|\b(high value|expensive|big order)\b/i.test(lower)) {
    return { label: "Needs Human Review", reason: "high_value" };
  }
  if (!hasOrderNumber && /\b(order|tracking|shipment|package|missing|wrong|damaged|refund|return|replacement|reship)\b/i.test(lower)) {
    return { label: "Needs Investigation", reason: "missing_order" };
  }
  if (priority === "high" || riskLevel === "high" || triageStatus === "High Priority") {
    return { label: "Needs Investigation", reason: "priority" };
  }
  if (String(msg.confidence_score || "") && Number(msg.confidence_score) < 60) {
    return { label: "Needs Investigation", reason: "low_confidence" };
  }
  if (String(msg.issue_type || "").toLowerCase().includes("unclear") || /\b(not sure|confused|unclear|help\??|what happened)\b/i.test(lower)) {
    return { label: "Needs Investigation", reason: "unclear" };
  }
  if ((needsHuman || triageStatus === "Needs Human Review") && riskLevel !== "normal") {
    return { label: "Needs Human Review", reason: "triage" };
  }
  if (triageStatus === "Needs Investigation" && riskLevel !== "normal") {
    return { label: "Needs Investigation", reason: "triage" };
  }
  return null;
};

const isCommandInboxAutoDraftEligible = (msg) => {
  if (!msg || msg.archived_at) return false;
  const status = String(msg.status || "").trim();
  const openForReply = !status || ["Needs Reply", "New", "Open"].includes(status);
  if (!openForReply) return false;
  if (msg.ai_draft || msg.approved_reply) return false;
  if (String(msg.draft_status || "").trim()) return false;
  if (classifyInboundSource(msg) === "Noise" || msg.issue_type === "Noise / Not CS") return false;
  return !getCommandInboxRiskFlag(msg);
};

const getInboundMetadata = (msg) => {
  const raw = msg?.metadata;
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
};

const getInboundUrlCandidate = (msg, keys = []) => {
  const metadata = getInboundMetadata(msg);
  for (const key of keys) {
    const value = msg?.[key] ?? metadata?.[key];
    if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) return value.trim();
  }
  return "";
};

const normalizeBrandAlias = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const getBrandChannelConfigForMessage = (msg) => {
  const metadata = getInboundMetadata(msg);
  const candidates = [
    msg?.brand,
    msg?.account,
    msg?.shop,
    msg?.source,
    msg?.source_label,
    metadata?.brand,
    metadata?.account,
    metadata?.shop,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeBrandAlias(candidate);
    const found = Object.values(brandChannelConfig).find(config =>
      config.aliases.some(alias => {
        const normalizedAlias = normalizeBrandAlias(alias);
        return normalizedCandidate === normalizedAlias || normalizedCandidate.includes(normalizedAlias);
      })
    );
    if (found) return found;
  }
  return null;
};

const getChannelDestinationForMessage = (msg) => {
  const sourceType = classifyInboundSource(msg);
  const channelText = [msg?.source, msg?.channel, msg?.message_type, msg?.label, msg?.source_label].filter(Boolean).join(" ").toLowerCase();
  const brandConfig = getBrandChannelConfigForMessage(msg);
  const explicitUrl = getInboundUrlCandidate(msg, [
    "chat_url", "chatUrl", "source_url", "sourceUrl", "customer_url", "customerUrl",
    "order_url", "orderUrl", "conversation_url", "conversationUrl", "thread_url",
    "threadUrl", "message_url", "messageUrl",
  ]);
  const isTikTokShopChat = sourceType === "TikTok Shop Chat" || channelText.includes("tiktok shop chat") || channelText.includes("shop chat");
  const isOtherSupportedChannel =
    sourceType === "Outlook" ||
    channelText.includes("outlook") ||
    channelText.includes("gmail") ||
    channelText.includes("instagram") ||
    channelText.includes("business suite") ||
    channelText.includes("meta business");

  if (explicitUrl) {
    return {
      url: explicitUrl,
      target: brandConfig?.windowTarget || (isTikTokShopChat ? "tiktok_shop_chat" : "customer_service_channel"),
    };
  }
  if (isTikTokShopChat && brandConfig?.tiktokShopChatUrl) {
    return { url: brandConfig.tiktokShopChatUrl, target: brandConfig.windowTarget };
  }
  if (isTikTokShopChat) return { url: "https://seller-us.tiktok.com/chat/inbox", target: "tiktok_shop_chat" };
  if (isOtherSupportedChannel) return { url: "", target: "customer_service_channel" };
  return { url: "", target: "customer_service_channel" };
};

const getInboundTags = (msg) => {
  const raw = msg?.tags;
  if (Array.isArray(raw)) return raw.map(tag => String(tag || "").trim()).filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(tag => String(tag || "").trim()).filter(Boolean);
    } catch {}
    return raw.split(",").map(tag => tag.trim()).filter(Boolean);
  }
  return [];
};

const getWorkQueueReplacementSourceId = (msg) => String(msg?.id || msg?.external_id || "").trim();

const getInboundReplacementDate = (msg) => {
  const value = msg?.received_at || msg?.email_received_at || msg?.received_time || msg?.created_at || nowISO();
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return String(value || todayDate()).slice(0, 10);
};

const getInboundOrderNumber = (msg) =>
  msg?.order_id || msg?.order_number || msg?.orderNumber || "";

const getExistingReplacementCaseForMessage = (msg, replacements) => {
  const metadata = getInboundMetadata(msg);
  const sourceId = getWorkQueueReplacementSourceId(msg);
  const replacementCaseId = metadata.replacement_case_id || msg?.replacement_case_id;
  const safeReplacements = Array.isArray(replacements) ? replacements : [];

  if (replacementCaseId) {
    const byId = safeReplacements.find(row => String(row.id) === String(replacementCaseId));
    if (byId) return byId;
    return { id: replacementCaseId };
  }
  if (!sourceId) return null;
  return safeReplacements.find(row =>
    String(row.sourceWorkQueueId || row.source_work_queue_id || "").trim() === sourceId ||
    String(row.notes || "").includes(`Source work_queue id: ${sourceId}`) ||
    String(row.notes || "").includes(`Source external id: ${sourceId}`)
  ) || null;
};

const buildReplacementCaseFromWorkQueue = (msg) => {
  const { displayName, displayBody } = getDisplayInboundMessage(msg || {});
  const sourceId = getWorkQueueReplacementSourceId(msg);
  const externalId = String(msg?.external_id || "").trim();
  const customer = displayName || msg?.customer_name || msg?.sender_name || msg?.sender_email || "";
  const account = msg?.account || msg?.brand || "";
  const subject = msg?.subject || "";
  const snippet = String(displayBody || msg?.message || msg?.message_body || msg?.message_text || "").replace(/\s+/g, " ").trim().slice(0, 280);
  const channelPlatform = msg?.channel || msg?.platform || msg?.source || msg?.message_type || "";
  const notes = [
    customer ? `Customer: ${customer}` : null,
    account ? `Account: ${account}` : null,
    subject ? `Subject: ${subject}` : null,
    snippet ? `Message snippet: ${snippet}` : null,
    channelPlatform ? `Channel/platform: ${channelPlatform}` : null,
    sourceId ? `Source work_queue id: ${sourceId}` : null,
    externalId && externalId !== sourceId ? `Source external id: ${externalId}` : null,
  ].filter(Boolean).join("\n");

  return {
    date: getInboundReplacementDate(msg),
    brand: getDisplayBrand(msg),
    customerName: customer,
    orderNum: getInboundOrderNumber(msg),
    reason: msg?.issue_type || msg?.subject || "Customer support replacement case",
    rootCause: "Needs review",
    replacementItems: msg?.item_name || "",
    marketValue: 0,
    preventable: "No",
    followUp: "Yes",
    notes,
    status: "Follow-up Needed",
    evidence: sourceId || externalId,
    sourceWorkQueueId: sourceId,
    channel: channelPlatform,
  };
};

const CommandInboxView = ({ inboundMessages, setInboundMessages, inboundLoading, inboundError, onRefresh, setTickets, replacements, setReplacements, setActiveView, setReplacementFocus, inboxFilter, onClearInboxFilter, opsActions, setOpsActions, automationRules, automationRulesLoading }) => {
  const [busyId, setBusyId]     = useState(null);
  const [activeFilter, setActiveFilter] = useState("All");
  const [sortMode, setSortMode] = useState("Newest first");
  const [collapsedDrafts, setCollapsedDrafts] = useState({});
  const [expandedMessages, setExpandedMessages] = useState({});
  const emptyManualMessageForm = {
    brand: "Vaulted Rarities",
    channel: "Manual",
    messageType: "Customer Support",
    customerName: "",
    sender: "",
    subject: "",
    body: "",
    priority: "Medium",
  };
  const [manualMessageOpen, setManualMessageOpen] = useState(false);
  const [manualMessageSaving, setManualMessageSaving] = useState(false);
  const [manualMessageError, setManualMessageError] = useState("");
  const [manualMessageSuccess, setManualMessageSuccess] = useState("");
  const [manualMessageForm, setManualMessageForm] = useState(emptyManualMessageForm);
  const [assistantMessageId, setAssistantMessageId] = useState(null);
  const [assistantResults, setAssistantResults] = useState({});
  const [assistantLoadingId, setAssistantLoadingId] = useState(null);
  const [copiedAssistantDraftId, setCopiedAssistantDraftId] = useState(null);
  const autoDraftedIdsRef = useRef(new Set());
  const [autoDraftBusyIds, setAutoDraftBusyIds] = useState({});
  const [autoDraftActivity, setAutoDraftActivity] = useState(null);

  const safeInboundMessages = Array.isArray(inboundMessages) ? inboundMessages : [];
  const safeOpsActions = Array.isArray(opsActions) ? opsActions : [];
  const safeReplacements = Array.isArray(replacements) ? replacements : [];

  const openInboxMessages = getOpenMessages(safeInboundMessages);
  const needsReply    = getNeedsReplyMessages(safeInboundMessages).length;
  const inProgress    = openInboxMessages.filter(m => normalizeWorkQueueStatus(m.status) === "in_progress").length;
  const ticketCreated = openInboxMessages.filter(m => normalizeWorkQueueStatus(m.status) === "ticket_created").length;
  const complete      = safeInboundMessages.filter(m => m.archived_at || ["closed", "archived", "resolved"].includes(normalizeWorkQueueStatus(m.status))).length;
  const openMessages  = openInboxMessages.length;
  const overdueMessages = getOverdueMessages(safeInboundMessages);
  const inboxFilterKey = JSON.stringify(inboxFilter || {});

  useEffect(() => {
    if (!inboxFilter) return;
    const nextFilter =
      inboxFilter.kind === "refunds" ? "Refunds / Returns" :
      inboxFilter.kind === "high-priority" ? "High Priority" :
      "All";
    setActiveFilter(nextFilter);
    if (inboxFilter.kind === "overdue") setSortMode("Oldest first");
    if (inboxFilter.messageId) {
      setExpandedMessages(prev => ({ ...prev, [inboxFilter.messageId]: true }));
      window.requestAnimationFrame(() => {
        document.getElementById(`inbox-message-${inboxFilter.messageId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
  }, [inboxFilterKey]);

  // ── filter logic ─────────────────────────────────────────────────────────────
  const isUntriaged = (m) => !m.triage_status || m.triage_status === "Untriaged";
  const filtered = safeInboundMessages.filter(m => {
    if (inboxFilter && !matchesCommandInboxFilter(m, inboxFilter)) return false;
    if (activeFilter === "All")                 return true;
    if (activeFilter === "Zendesk")             return classifyInboundSource(m) === "Zendesk";
    if (activeFilter === "TikTok Shop Chat")      return classifyInboundSource(m) === "TikTok Shop Chat";
    if (activeFilter === "Refunds / Returns")   return classifyInboundSource(m) === "TikTok Refund";
    if (activeFilter === "Shopify")             return classifyInboundSource(m) === "Shopify";
    if (activeFilter === "Outlook")             return classifyInboundSource(m) === "Outlook";
    if (activeFilter === "Noise / Not CS")      return classifyInboundSource(m) === "Noise" ||
      m.triage_status === "Noise / Not CS" || m.issue_type === "Noise / Not CS";
    if (activeFilter === "Untriaged")           return isUntriaged(m);
    if (activeFilter === "Needs Human Review")  return getCommandInboxRiskFlag(m)?.label === "Needs Human Review";
    if (activeFilter === "High Priority")       return isHighPriorityMessage(m);
    if (activeFilter === "Closed")              return m.status === "Closed" || m.status === "Archived" || m.archived_at;
    if (activeFilter === "Archived")            return false;
    return true;
  });
  const getSortTime = (message) => new Date(message.created_at || message.received_time || message.email_received_at || message.received_at || 0).getTime() || 0;
  const getPriorityRank = (priority) => ({ High: 0, Medium: 1, Low: 2 }[priority] ?? 3);
  const newestFirst = (a, b) => getSortTime(b) - getSortTime(a);
  const sortedFiltered = [...filtered].sort((a, b) => {
    if (sortMode === "Oldest first") return getSortTime(a) - getSortTime(b);
    if (sortMode === "Brand") {
      const brandCompare = getDisplayBrand(a).localeCompare(getDisplayBrand(b));
      return brandCompare || newestFirst(a, b);
    }
    if (sortMode === "Priority") {
      const priorityCompare = getPriorityRank(a.priority) - getPriorityRank(b.priority);
      return priorityCompare || newestFirst(a, b);
    }
    return newestFirst(a, b);
  });
  const inboxFilterLabel = inboxFilter
    ? [
        inboxFilter.kind === "overdue" ? "Overdue" :
        inboxFilter.kind === "refunds" ? "Refunds / Returns" :
        inboxFilter.kind === "high-priority" ? "High Priority" :
        "Open messages",
        inboxFilter.brand,
      ].filter(Boolean).join(" - ")
    : "";

  useEffect(() => {
    if (inboundLoading || !supabase?.functions?.invoke) return undefined;

    const currentMessages = Array.isArray(inboundMessages) ? inboundMessages : [];
    const openMessages = currentMessages.filter(m => !m.archived_at && !["Closed", "Archived", "Resolved"].includes(String(m.status || "").trim()));
    const reviewCount = openMessages.filter(m => getCommandInboxRiskFlag(m)?.label === "Needs Human Review").length;
    const investigationCount = openMessages.filter(m => getCommandInboxRiskFlag(m)?.label === "Needs Investigation").length;
    const candidates = currentMessages
      .filter(m => isCommandInboxAutoDraftEligible(m) && !autoDraftedIdsRef.current.has(m.id))
      .sort((a, b) => getSortTime(b) - getSortTime(a))
      .slice(0, 10);

    if (candidates.length === 0) {
      if (reviewCount || investigationCount) {
        setAutoDraftActivity({ prepared: 0, review: reviewCount, investigation: investigationCount });
      }
      return undefined;
    }

    let cancelled = false;
    const runAutoDrafts = async () => {
      let prepared = 0;
      for (const msg of candidates) {
        if (cancelled) return;
        autoDraftedIdsRef.current.add(msg.id);
        setAutoDraftBusyIds(prev => ({ ...prev, [msg.id]: true }));
        try {
          const { data, error } = await supabase.functions.invoke("draft-inbound-reply", {
            body: { message_id: msg.id, source: "auto" },
          });
          if (!error && data?.message) {
            prepared++;
            setInboundMessages(prev => prev.map(m => m.id === msg.id ? { ...m, ...data.message } : m));
          }
        } catch (err) {
          console.warn("Auto draft failed:", err?.message || err);
        } finally {
          setAutoDraftBusyIds(prev => {
            const next = { ...prev };
            delete next[msg.id];
            return next;
          });
        }
      }
      if (!cancelled) {
        setAutoDraftActivity({ prepared, review: reviewCount, investigation: investigationCount });
      }
    };

    runAutoDrafts();
    return () => { cancelled = true; };
  }, [inboundLoading, inboundMessages, setInboundMessages]);

  const toggleMessageExpanded = (id) => {
    setExpandedMessages(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleAskAssistant = async (msg) => {
    if (assistantLoadingId === msg.id) return;
    if (assistantMessageId === msg.id && assistantResults[msg.id]) {
      setAssistantMessageId(null);
      setCopiedAssistantDraftId(null);
      return;
    }

    setAssistantMessageId(msg.id);
    setCopiedAssistantDraftId(null);
    setAssistantLoadingId(msg.id);
    setAssistantResults(prev => ({ ...prev, [msg.id]: null }));

    const fallback = sanitizeAssistantAnalysis(msg, buildLocalAssistantAnalysis(msg));

    if (!supabase?.functions?.invoke) {
      setAssistantResults(prev => ({
        ...prev,
        [msg.id]: {
          analysis: fallback,
          source: "fallback",
          error: "AI assistant unavailable. Showing local fallback.",
        },
      }));
      setAssistantLoadingId(null);
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("generate-message-assistant", {
        body: { message: msg },
      });
      if (error) throw error;
      setAssistantResults(prev => ({
        ...prev,
        [msg.id]: {
          analysis: sanitizeAssistantAnalysis(msg, data),
          source: "ai",
          error: "",
        },
      }));
    } catch (err) {
      console.warn("AI assistant unavailable. Showing local fallback.", err?.message || err);
      setAssistantResults(prev => ({
        ...prev,
        [msg.id]: {
          analysis: fallback,
          source: "fallback",
          error: "AI assistant unavailable. Showing local fallback.",
        },
      }));
    } finally {
      setAssistantLoadingId(null);
    }
  };

  const markDraftCopiedLocally = (msgId) => {
    const now = nowISO();
    setInboundMessages(prev => prev.map(m => m.id === msgId ? {
      ...m,
      draft_copied_at: now,
    } : m));
  };

  const copyDraftOnly = async (msg, draftText, copiedStateSetter) => {
    const text = draftText || "";
    if (!text) {
      showOpsToast("Generate a draft first.", { type: "error" });
      return false;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      if (copiedStateSetter) {
        copiedStateSetter(`failed-${msg.id}`);
        setTimeout(() => copiedStateSetter(null), 2400);
      }
      showOpsToast("Could not copy draft. Please copy it manually.", { type: "error" });
      return false;
    }

    showOpsToast("Draft copied.");
    markDraftCopiedLocally(msg.id);
    if (copiedStateSetter) {
      copiedStateSetter(msg.id);
      setTimeout(() => copiedStateSetter(null), 2000);
    }
    return true;
  };

  const handleCopyChannelUrl = async (msg) => {
    const destination = getChannelDestinationForMessage(msg);
    if (!destination.url) {
      showOpsToast("No channel URL found.", { type: "error" });
      return false;
    }
    try {
      await navigator.clipboard.writeText(destination.url);
      showOpsToast("Channel URL copied.");
      return true;
    } catch (_) {
      showOpsToast("Could not copy channel URL.", { type: "error" });
      return false;
    }
  };

  const handleCopyAssistantDraft = async (msg, draftReply) => {
    await copyDraftOnly(msg, draftReply, setCopiedAssistantDraftId);
  };

  const updateManualMessageForm = (field, value) => {
    setManualMessageForm(prev => ({ ...prev, [field]: value }));
    setManualMessageError("");
    setManualMessageSuccess("");
  };

  const resetManualMessageForm = () => {
    setManualMessageForm(emptyManualMessageForm);
    setManualMessageError("");
  };

  // ── handlers ──────────────────────────────────────────────────────────────────
  const handleManualMessageSubmit = async () => {
    const brand = manualMessageForm.brand.trim();
    const channel = manualMessageForm.channel.trim();
    const messageType = manualMessageForm.messageType.trim();
    const subject = manualMessageForm.subject.trim();
    const body = manualMessageForm.body.trim();
    const priority = manualMessageForm.priority.trim();

    setManualMessageError("");
    setManualMessageSuccess("");

    if (!brand || !channel || !subject || !body) {
      setManualMessageError("Brand, channel, subject, and message body are required.");
      return;
    }
    if (!supabase) {
      setManualMessageError("Manual message could not be saved because Supabase is unavailable.");
      return;
    }

    const timestamp = nowISO();
    const payload = {
      external_id: `manual:${Date.now()}`,
      brand,
      source: "Manual",
      channel,
      label: "Manual Entry",
      sender_name: manualMessageForm.customerName.trim() || null,
      sender_email: manualMessageForm.sender.trim() || null,
      subject,
      message_body: body,
      priority,
      status: "Needs Reply",
      email_received_at: timestamp,
      message_type: messageType,
    };

    setManualMessageSaving(true);
    try {
      const result = await supabase
        .from(INBOUND_MESSAGES_TABLE)
        .insert([payload])
        .select("*")
        .single();
      if (result.error) {
        setManualMessageError(`Manual message save failed: ${result.error.message}`);
        setManualMessageSaving(false);
        return;
      }
      resetManualMessageForm();
      setManualMessageOpen(false);
      setManualMessageSuccess("Manual message added.");
      await onRefresh();
    } catch (err) {
      setManualMessageError(`Manual message save failed: ${err?.message || "Unknown error"}`);
      setManualMessageSaving(false);
      return;
    }
    setManualMessageSaving(false);
  };

  const runArchiveMessage = async (id) => {
    setBusyId(id);
    const { error } = await archiveInboundInSupabase(id);
    setBusyId(null);
    if (error) { showOpsToast(`Archive failed: ${error.message}`, { type: "error" }); return; }
    setInboundMessages(prev => prev.filter(m => m.id !== id));
    showOpsToast("Message archived.");
  };

  const handleArchive = (id) => {
    showOpsConfirm({
      title: "Archive message?",
      body: "This message will be removed from the active Command Inbox. The record stays in the work queue as archived.",
      confirmLabel: "Archive Message",
      variant: "archive",
      onConfirm: () => runArchiveMessage(id),
    });
  };

  const runCloseAndArchiveMessage = async (id) => {
    setBusyId(id);
    const { error } = await closeAndArchiveInboundInSupabase(id);
    setBusyId(null);
    if (error) { showOpsToast(`Close and archive failed: ${error.message}`, { type: "error" }); return; }
    setInboundMessages(prev => prev.filter(m => m.id !== id));
    showOpsToast("Message closed and archived.");
  };

  const handleCloseAndArchive = (id) => {
    showOpsConfirm({
      title: "Close and archive this message?",
      body: "This will mark the message as closed and remove it from the active inbox queue.",
      confirmLabel: "Close + Archive",
      variant: "archive",
      onConfirm: () => runCloseAndArchiveMessage(id),
    });
  };

  const handleStatus = async (id, status) => {
    setBusyId(id);
    const { error } = await updateInboundStatusInSupabase(id, status);
    setBusyId(null);
    if (error) { showOpsToast(`Update failed: ${error.message}`, { type: "error" }); return; }
    setInboundMessages(prev => prev.map(m => m.id === id ? { ...m, status } : m));
  };

  const handleCreateTicket = async (msg) => {
    setBusyId(msg.id);
    const { displayName, displayBody } = getDisplayInboundMessage(msg);
    const newTicket = {
      brand: normalizeBrandForApp(msg.brand),
      channel: msg.channel || "Shop Chat",
      issueType: normalizeTicketIssue(msg.issue_type),
      priority: normalizeTicketPriority(msg.priority),
      slaRisk: "No",
      status: "New",
      notes: [msg.subject, displayBody].filter(Boolean).join("\n\n"),
      nextAction: msg.next_action || "",
      orderNumber: msg.order_number || "",
      customerName: displayName || msg.customer_name || msg.sender_name || "",
      createdAt: nowISO(),
      source: "command-inbox",
    };
    const { data, error } = await insertTicketToSupabase(newTicket);
    if (error) { setBusyId(null); showOpsToast(`Ticket create failed: ${error.message}`, { type: "error" }); return; }
    setTickets(prev => [data, ...prev]);
    await updateInboundStatusInSupabase(msg.id, "Ticket Created");
    setBusyId(null);
    setInboundMessages(prev => prev.map(m => m.id === msg.id ? { ...m, status: "Ticket Created" } : m));
  };

  const handleCreateAction = async (msg) => {
    // Duplicate guard: check for an existing open action for this message
    if (supabase) {
      const { data: existing } = await supabase
        .from("ops_actions")
        .select("id")
        .eq("inbound_message_id", msg.id)
        .neq("status", "Completed")
        .limit(1);
      if (existing && existing.length > 0) {
        showOpsToast("An open action already exists for this message.", { type: "error" });
        return;
      }
    }

    setBusyId(msg.id);
    const { displayName, displayBody } = getDisplayInboundMessage(msg);
    const priority = normalizeTicketPriority(msg.priority);
    const details = [msg.triage_summary, msg.next_action, displayBody]
      .filter(Boolean).join("\n\n").slice(0, 1000);
    const row = {
      inbound_message_id: msg.id,
      brand:              msg.brand        || null,
      channel:            msg.channel      || null,
      customer_name:      displayName || msg.customer_name || msg.sender_name || null,
      customer_email:     msg.sender_email || null,
      action_type:        deriveActionType(msg),
      title:              deriveActionTitle(msg),
      details:            details          || null,
      priority,
      status:             "Open",
      due_at:             defaultDueAt(priority),
      source:             "command-inbox",
      created_at:         nowISO(),
      updated_at:         nowISO(),
    };
    const { data: inserted, error } = await insertOpsActionToSupabase(row);
    setBusyId(null);
    if (error) { showOpsToast(`Create action failed: ${error.message}`, { type: "error" }); return; }
    // Push returned row into local Next Actions state so it shows immediately
    if (inserted) setOpsActions(prev => [inserted, ...prev]);
  };

  const handleSendToReplacementLog = async (msg) => {
    const existing = getExistingReplacementCaseForMessage(msg, safeReplacements);
    if (existing) {
      const metadata = getInboundMetadata(msg);
      const tags = getInboundTags(msg);
      const nextTags = tags.includes("replacement") ? tags : [...tags, "replacement"];
      setInboundMessages(prev => prev.map(m => m.id === msg.id ? {
        ...m,
        metadata: { ...metadata, replacement_logged: true, replacement_case_id: existing.id },
        tags: nextTags,
      } : m));
      if (setReplacementFocus) {
        setReplacementFocus({ caseId: existing.id, showArchived: Boolean(existing.archived_at), requestedAt: Date.now() });
      }
      setActiveView("replacements");
      return;
    }

    setBusyId(msg.id);
    const replacementCase = buildReplacementCaseFromWorkQueue(msg);
    const { data: inserted, error } = await insertReplacementToSupabase(replacementCase);
    if (error) {
      setBusyId(null);
      showOpsToast(`Replacement log failed: ${error.message}`, { type: "error" });
      return;
    }

    const replacementRow = {
      ...inserted,
      evidence: replacementCase.evidence,
      sourceWorkQueueId: replacementCase.sourceWorkQueueId,
      channel: replacementCase.channel,
    };
    if (setReplacements) setReplacements(prev => [replacementRow, ...prev]);

    const metadata = getInboundMetadata(msg);
    const tags = getInboundTags(msg);
    const nextMetadata = { ...metadata, replacement_logged: true, replacement_case_id: replacementRow.id };
    const nextTags = tags.includes("replacement") ? tags : [...tags, "replacement"];

    if (supabase && msg.id) {
      const { error: updateError } = await supabase
        .from(INBOUND_MESSAGES_TABLE)
        .update({ metadata: nextMetadata, tags: nextTags, updated_at: nowISO() })
        .eq("id", msg.id);
      if (updateError) {
        console.warn("Replacement cross-link metadata update skipped:", updateError.message);
      }
    }

    setInboundMessages(prev => prev.map(m => m.id === msg.id ? {
      ...m,
      metadata: nextMetadata,
      tags: nextTags,
    } : m));
    setBusyId(null);
    showOpsToast("Replacement case logged.");
  };

  const handleRunTriage = async (msgId) => {
    setBusyId(msgId);
    try {
      const { data, error } = await supabase.functions.invoke("triage-inbound-message", {
        body: { message_id: msgId },
      });
      if (error) throw error;
      const updated = data?.message;
      if (updated) {
        setInboundMessages(prev => prev.map(m => m.id === msgId ? { ...m, ...updated } : m));
      }
    } catch (err) {
      showOpsToast(`Triage failed: ${err?.message || "Unknown error. Check Supabase Edge Function logs."}`, { type: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const [draftBusyId, setDraftBusyId] = useState(null);   // separate from action busyId
  const [copiedDraftId, setCopiedDraftId] = useState(null);

  const handleCopyDraft = async (msg) => {
    return copyDraftOnly(msg, msg.ai_draft || "", setCopiedDraftId);
  };

  const handleCopyReply = async (msg) => {
    const replyText = msg.approved_reply || msg.ai_draft || "";
    if (!replyText) {
      showOpsToast("Generate or approve a draft first.", { type: "error" });
      return;
    }

    await copyDraftOnly(msg, replyText, setCopiedDraftId);
  };

  const handleGenerateDraft = async (msg, instruction = null) => {
    setDraftBusyId(msg.id);
    try {
      const body = { message_id: msg.id };
      if (instruction) body.instruction = instruction;
      const { data, error } = await supabase.functions.invoke("draft-inbound-reply", { body });
      if (error) throw error;
      const updated = data?.message;
      if (updated) {
        setInboundMessages(prev => prev.map(m => m.id === msg.id ? { ...m, ...updated } : m));
      }
    } catch (err) {
      showOpsToast(`Draft failed: ${err?.message || "Unknown error. Check Supabase Edge Function logs."}`, { type: "error" });
    } finally {
      setDraftBusyId(null);
    }
  };

  const handleApproveDraft = async (msg) => {
    if (!msg.ai_draft) return;
    const now = nowISO();
    // 1. Update work_queue: copy draft -> approved_reply, set draft_status
    const { error: updateErr } = await supabase
      .from(INBOUND_MESSAGES_TABLE)
      .update({ approved_reply: msg.ai_draft, draft_status: "Approved", updated_at: now })
      .eq("id", msg.id);
    if (updateErr) { showOpsToast(`Approve failed: ${updateErr.message}`, { type: "error" }); return; }

    // 2. Insert into reply_examples for future few-shot context
    const { displayBody } = getDisplayInboundMessage(msg);
    await supabase.from("reply_examples").insert([{
      brand:            msg.brand           || null,
      channel:          msg.channel         || null,
      issue_type:       msg.issue_type      || null,
      customer_message: displayBody         || msg.message_body || null,
      triage_summary:   msg.triage_summary  || null,
      ai_draft:         msg.ai_draft,
      approved_reply:   msg.ai_draft,
      tone_notes:       msg.tone_notes      || null,
      created_at:       now,
    }]);

    // 3. Update local state
    setInboundMessages(prev => prev.map(m =>
      m.id === msg.id ? { ...m, approved_reply: msg.ai_draft, draft_status: "Approved" } : m
    ));
  };

  // ── Process Queue state ───────────────────────────────────────────────────────
  const [queueRunning, setQueueRunning]   = useState(false);
  const [queueProgress, setQueueProgress] = useState("");
  const [queueSummary, setQueueSummary]   = useState(null);

  // ── Check Gmail state ─────────────────────────────────────────────────────────
  const [isCheckingGmail, setIsCheckingGmail] = useState(false);
  const [lastGmailCheckAt, setLastGmailCheckAt] = useState(null);
  const [gmailCheckError, setGmailCheckError] = useState("");
  const [gmailCheckCooldownUntil, setGmailCheckCooldownUntil] = useState(0);
  const [gmailCooldownSeconds, setGmailCooldownSeconds] = useState(0);

  useEffect(() => {
    if (!gmailCheckCooldownUntil) {
      setGmailCooldownSeconds(0);
      return undefined;
    }

    const updateCooldown = () => {
      const seconds = Math.max(0, Math.ceil((gmailCheckCooldownUntil - Date.now()) / 1000));
      setGmailCooldownSeconds(seconds);
      if (seconds <= 0) setGmailCheckCooldownUntil(0);
    };

    updateCooldown();
    const timer = setInterval(updateCooldown, 1000);
    return () => clearInterval(timer);
  }, [gmailCheckCooldownUntil]);

  const handleCheckGmailNow = async () => {
    if (isCheckingGmail || gmailCooldownSeconds > 0) return;

    setIsCheckingGmail(true);
    setGmailCheckError("");
    setGmailCheckCooldownUntil(Date.now() + 120000);

    try {
      try {
        const res = await fetch(MAKE_INTAKE_WEBHOOK_URL, { method: "POST" });
        if (!res.ok) {
          const statusError = new Error(res.statusText || "Webhook request failed.");
          statusError.skipCorsFallback = true;
          throw statusError;
        }
      } catch (err) {
        if (err?.skipCorsFallback) throw err;
        await fetch(MAKE_INTAKE_WEBHOOK_URL, { method: "POST", mode: "no-cors" });
      }

      await new Promise(resolve => setTimeout(resolve, 8000));
      await onRefresh();
      setLastGmailCheckAt(new Date());
    } catch (_) {
      setGmailCheckError("Gmail check failed. Try again in a moment.");
    } finally {
      setIsCheckingGmail(false);
    }
  };

  const handleProcessQueue = async () => {
    const candidates = safeInboundMessages.filter(
      m => !m.triage_status || m.triage_status === "Untriaged"
    );
    if (candidates.length === 0) {
      setQueueSummary({ processed: 0, drafted: 0, actions: 0, skipped: 0, archivedNoise: 0, note: "No untriaged messages to process." });
      return;
    }

    setQueueRunning(true);
    setQueueSummary(null);
    let drafted = 0, actionsCreated = 0, skipped = 0, archivedNoise = 0;

    for (let i = 0; i < candidates.length; i++) {
      const msg = candidates[i];
      setQueueProgress(`Processing ${i + 1} of ${candidates.length}...`);

      // ── Step 1: Triage ──────────────────────────────────────────────────────
      let triaged = msg;
      try {
        const { data: tData, error: tErr } = await supabase.functions.invoke(
          "triage-inbound-message", { body: { message_id: msg.id } }
        );
        if (!tErr && tData?.message) {
          triaged = { ...msg, ...tData.message };
          setInboundMessages(prev => prev.map(m => m.id === msg.id ? triaged : m));
        }
      } catch (_) { /* non-fatal */ }

      // ── Step 2: Find matching automation rule ───────────────────────────────
      const rule = findAutomationRule(automationRules, triaged);

      // ── Step 3: Noise handling ──────────────────────────────────────────────
      const isNoise = triaged.triage_status === "Noise / Not CS" ||
        triaged.issue_type === "Noise / Not CS";

      if (isNoise) {
        // If rule says auto_archive_noise, archive it immediately
        if (rule?.auto_archive_noise) {
          try {
            await supabase
              .from(INBOUND_MESSAGES_TABLE)
              .update({ archived_at: nowISO(), updated_at: nowISO() })
              .eq("id", triaged.id);
            setInboundMessages(prev => prev.filter(m => m.id !== triaged.id));
            archivedNoise++;
          } catch (_) { /* non-fatal */ }
        } else {
          skipped++;
        }
        continue;
      }

      // ── Step 4: Draft ───────────────────────────────────────────────────────
      // Rule-driven if rule exists; safe default = draft only low-risk reply work.
      const shouldDraft = !getCommandInboxRiskFlag(triaged) && (
        rule ? rule.auto_draft === true : isCommandInboxAutoDraftEligible(triaged)
      );

      if (shouldDraft && !triaged.ai_draft) {
        try {
          const { data: dData, error: dErr } = await supabase.functions.invoke(
            "draft-inbound-reply", { body: { message_id: triaged.id } }
          );
          if (!dErr && dData?.message) {
            triaged = { ...triaged, ...dData.message };
            setInboundMessages(prev => prev.map(m => m.id === triaged.id ? triaged : m));
            drafted++;
          }
        } catch (_) { /* non-fatal */ }
      }

      // ── Step 5: Create action ───────────────────────────────────────────────
      // Rule-driven if rule exists; safe default = create if next_action is set
      const shouldCreateAction = rule
        ? rule.auto_create_action === true
        : !!triaged.next_action;

      if (shouldCreateAction) {
        const alreadyHasAction = safeOpsActions.some(
          a => a.inbound_message_id === triaged.id && a.status !== "Completed"
        );
        if (!alreadyHasAction) {
          const { displayName, displayBody } = getDisplayInboundMessage(triaged);
          const priority = normalizeTicketPriority(triaged.priority);
          const details  = [triaged.triage_summary, triaged.next_action, displayBody]
            .filter(Boolean).join("\n\n").slice(0, 1000);
          const row = {
            inbound_message_id: triaged.id,
            brand:              triaged.brand        || null,
            channel:            triaged.channel      || null,
            customer_name:      displayName || triaged.customer_name || triaged.sender_name || null,
            customer_email:     triaged.sender_email || null,
            action_type:        rule?.action_type || deriveActionType(triaged),
            title:              deriveActionTitle(triaged),
            details:            details || null,
            priority,
            status:             "Open",
            due_at:             defaultDueAt(priority),
            source:             "process-queue",
            created_at:         nowISO(),
            updated_at:         nowISO(),
          };
          const { data: inserted, error: aErr } = await insertOpsActionToSupabase(row);
          if (!aErr && inserted) {
            setOpsActions(prev => [inserted, ...prev]);
            actionsCreated++;
          }
        }
      }
    }

    setQueueRunning(false);
    setQueueProgress("");
    setQueueSummary({ processed: candidates.length, drafted, actions: actionsCreated, skipped, archivedNoise });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Command Inbox</h2>
          <p className="text-xs text-gray-400 mt-0.5">Active inbound messages: {openMessages} open</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {/* Manual Message */}
          <button
            onClick={() => { setManualMessageError(""); setManualMessageOpen(true); }}
            disabled={queueRunning || inboundLoading}
            className="inline-flex flex-1 items-center justify-center gap-1.5 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 font-medium rounded-lg border border-gray-300 transition-colors cursor-pointer px-3 py-1.5 text-xs whitespace-nowrap sm:flex-none"
          >
            + Manual Message
          </button>
          {/* Reload Queue */}
          <button
            onClick={onRefresh}
            disabled={inboundLoading || queueRunning}
            className="inline-flex flex-1 items-center justify-center gap-1.5 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 font-medium rounded-lg border border-gray-300 transition-colors cursor-pointer px-3 py-1.5 text-xs whitespace-nowrap sm:flex-none"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={inboundLoading ? "animate-spin" : ""}>
              <path d="M10 6A4 4 0 1 1 6 2a4 4 0 0 1 2.83 1.17L10 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M8 4h2V2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {inboundLoading ? "Reloading..." : "Reload Queue"}
          </button>
        </div>
      </div>

      {manualMessageSuccess && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-700">
          {manualMessageSuccess}
        </div>
      )}

      {overdueMessages.length > 0 && (
        <Card className="flex flex-col gap-3 border-black p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-gray-900">Assistant reminder: {overdueMessages.length} open message{overdueMessages.length !== 1 ? "s are" : " is"} older than 24 hours.</p>
          <button
            onClick={() => { setActiveFilter("All"); setSortMode("Oldest first"); }}
            className="inline-flex items-center justify-center rounded-lg border border-slate-800 bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
          >
            Review overdue
          </button>
        </Card>
      )}

      {manualMessageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3 py-6">
          <div className="w-full max-w-2xl rounded-lg border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div>
                <p className="text-sm font-bold text-gray-900">Manual Message</p>
                <p className="text-[11px] text-gray-400">Create an inbound message card manually.</p>
              </div>
              <button
                onClick={() => { setManualMessageOpen(false); setManualMessageError(""); }}
                disabled={manualMessageSaving}
                className="text-sm font-semibold text-gray-400 transition-colors hover:text-gray-700 disabled:opacity-50"
              >
                Close
              </button>
            </div>
            <div className="max-h-[75vh] overflow-y-auto p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Brand</span>
                  <Sel value={manualMessageForm.brand} onChange={value => updateManualMessageForm("brand", value)} options={["Vaulted Rarities", "CardKing47", "PokeSpins", "PokieMart", "Unassigned"]} placeholder="" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Channel</span>
                  <Sel value={manualMessageForm.channel} onChange={value => updateManualMessageForm("channel", value)} options={["Manual", "TikTok Shop Chat", "Refund / Return", "Outlook", "Loox / Reviews", "Replacement Issue", "Shipping Issue"]} placeholder="" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Message Type</span>
                  <Sel value={manualMessageForm.messageType} onChange={value => updateManualMessageForm("messageType", value)} options={["Customer Support", "TikTok Shop Chat", "TikTok Refund", "Replacement", "Shipping Issue", "Review Reply", "Other"]} placeholder="" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Priority</span>
                  <Sel value={manualMessageForm.priority} onChange={value => updateManualMessageForm("priority", value)} options={["Low", "Medium", "High"]} placeholder="" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Customer Name</span>
                  <Inp value={manualMessageForm.customerName} onChange={value => updateManualMessageForm("customerName", value)} placeholder="Customer name" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Customer Email or Handle</span>
                  <Inp value={manualMessageForm.sender} onChange={value => updateManualMessageForm("sender", value)} placeholder="@handle or email" />
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Subject</span>
                  <Inp value={manualMessageForm.subject} onChange={value => updateManualMessageForm("subject", value)} placeholder="Short title" />
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Message Body</span>
                  <Txt value={manualMessageForm.body} onChange={value => updateManualMessageForm("body", value)} placeholder="Paste or type the customer message..." rows={5} />
                </label>
              </div>
              {manualMessageError && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  {manualMessageError}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-4 py-3">
              <button
                onClick={() => { setManualMessageOpen(false); setManualMessageError(""); }}
                disabled={manualMessageSaving}
                className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleManualMessageSubmit}
                disabled={manualMessageSaving}
                className="inline-flex items-center justify-center rounded-lg border border-slate-800 bg-slate-700 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
              >
                {manualMessageSaving ? "Saving..." : "Save Manual Message"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Queue summary banner */}
      {queueSummary && (
        <div className="flex items-center justify-between bg-teal-50 border border-teal-200 rounded-lg px-4 py-3">
          <div className="flex items-center gap-4 flex-wrap">
            {queueSummary.note ? (
              <span className="text-xs text-teal-700 font-medium">{queueSummary.note}</span>
            ) : (
              <>
                <span className="text-xs text-teal-800 font-semibold">Queue complete</span>
                <span className="text-xs text-teal-700">Processed <strong>{queueSummary.processed}</strong></span>
                <span className="text-xs text-teal-700">Drafted <strong>{queueSummary.drafted}</strong></span>
                <span className="text-xs text-teal-700">Actions created <strong>{queueSummary.actions}</strong></span>
                {queueSummary.archivedNoise > 0 && <span className="text-xs text-gray-500">Archived noise <strong>{queueSummary.archivedNoise}</strong></span>}
                {queueSummary.skipped > 0 && <span className="text-xs text-gray-500">Skipped noise <strong>{queueSummary.skipped}</strong></span>}
              </>
            )}
          </div>
          <button onClick={() => setQueueSummary(null)} className="text-teal-400 hover:text-teal-700 text-lg leading-none ml-3 flex-shrink-0">×</button>
        </div>
      )}

      {autoDraftActivity && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
          <span className="font-semibold text-slate-800">Inbox activity</span>
          <span>Prepared <strong>{autoDraftActivity.prepared}</strong> replies.</span>
          <span><strong>{autoDraftActivity.review}</strong> need review.</span>
          <span><strong>{autoDraftActivity.investigation}</strong> need investigation.</span>
        </div>
      )}

      {/* Error banner */}
      {inboundError && (
        <div className="bg-red-50 border border-red-300 rounded-lg px-4 py-3 text-red-800 text-sm">{inboundError}</div>
      )}

      {/* Count chips */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Needs Reply", count: needsReply },
          { label: "In Progress", count: inProgress },
          { label: "Ticket Created", count: ticketCreated },
          { label: "Closed / Archived", count: complete },
        ].map(({ label, count }) => (
          <Card key={label} className="p-4">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{count}</p>
          </Card>
        ))}
      </div>

      {/* Filter control */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
            <span className="whitespace-nowrap">Filter:</span>
            <select
              value={activeFilter}
              onChange={e => setActiveFilter(e.target.value)}
              className="min-w-0 bg-transparent text-xs font-semibold text-slate-800 outline-none"
            >
              {INBOX_FILTER_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </label>
          <span className="text-[10px] text-gray-400">{sortedFiltered.length} shown</span>
          {activeFilter === "Archived" && (
            <span className="text-[10px] font-medium text-gray-400">Archived message viewer coming soon.</span>
          )}
          {inboxFilterLabel && (
            <button
              type="button"
              onClick={onClearInboxFilter}
              className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
              title="Clear dashboard filter"
            >
              Dashboard filter: {inboxFilterLabel} x
            </button>
          )}
        </div>
        <label className="inline-flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 sm:ml-auto">
          <span className="whitespace-nowrap">Sort:</span>
          <select
            value={sortMode}
            onChange={e => setSortMode(e.target.value)}
            className="min-w-0 bg-transparent text-xs font-semibold text-slate-800 outline-none"
          >
            {["Newest first", "Oldest first", "Brand", "Priority"].map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </label>
      </div>

      {/* Loading skeleton */}
      {inboundLoading && safeInboundMessages.length === 0 && (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="bg-white border border-gray-200 rounded-lg p-4 animate-pulse">
              <div className="h-3 bg-gray-200 rounded w-1/4 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-3/4" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!inboundLoading && sortedFiltered.length === 0 && !inboundError && (
        <div className="text-center py-16 text-gray-300">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="mx-auto mb-3 text-gray-200">
            <rect x="4" y="8" width="32" height="24" rx="3" stroke="currentColor" strokeWidth="1.8" fill="none"/>
            <path d="M4 14l16 10 16-10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          <p className="text-sm font-medium">{activeFilter === "Archived" ? "Archived message viewer coming soon" : activeFilter === "All" ? "Inbox is clear" : `No messages match "${activeFilter}"`}</p>
          <p className="text-xs mt-1">{activeFilter === "Archived" ? "Archived messages are not loaded in this active inbox view yet." : activeFilter === "All" ? "No active inbound messages." : "Try a different filter."}</p>
        </div>
      )}

      {/* Message cards */}
      {sortedFiltered.map(msg => {
        const isBusy      = busyId === msg.id;
        const isDraftBusy = draftBusyId === msg.id || autoDraftBusyIds[msg.id] === true;
        const statusStyle    = INBOX_STATUS_STYLE[msg.status]        || "bg-gray-100 text-gray-500 border-gray-200";
        const priorityStyle  = INBOX_PRIORITY_STYLE[msg.priority]    || "bg-gray-100 text-gray-500 border-gray-200";
        const riskStyle      = RISK_LEVEL_STYLE[msg.risk_level]       || "bg-gray-100 text-gray-500 border-gray-200";
        const { displayName, displayBody, hasHistory } = getDisplayInboundMessage(msg);
        const showName       = displayName || msg.sender_name || msg.customer_name;
        const untriaged      = isUntriaged(msg);
        const sourceType     = classifyInboundSource(msg);
        const sourceBadgeCls = SOURCE_BADGE_STYLE[sourceType] || SOURCE_BADGE_STYLE["Other"];
        const cardTitle      = getInboundCardTitle(msg, sourceType, displayName);
        const ts             = getInboundTimestamp(msg);
        const orderNum       = msg.order_number || msg.orderNumber || null;
        const isZendesk      = sourceType === "Zendesk";
        const zendeskNotes   = isZendesk ? parseZendeskNotes(msg.notes) : null;
        const zendeskSubject = zendeskNotes?.subject || "";
        const zendeskPreview = zendeskNotes?.preview || "";
        const zendeskRequester = zendeskNotes?.requesterEmail || "";
        const zendeskUrl     = zendeskNotes?.url || "";
        const isRefund       = sourceType === "TikTok Refund";
        const isNoise        = sourceType === "Noise";
        const isMessageExpanded = expandedMessages[msg.id] === true;
        const sourceBadgeLabel = isRefund ? "Refund / Return" : sourceType;
        const displayBrand = getDisplayBrand(msg);
        const brandBorderCls = getInboxBrandBorderClass(displayBrand);
        const displayCustomer = displayName || msg.sender_name || msg.customer_name || msg.customer || (isZendesk ? zendeskRequester : "");
        const showSubjectLine = isZendesk ? Boolean(zendeskSubject) : msg.subject && msg.subject !== cardTitle;
        const hasReplyText = Boolean(msg.approved_reply || msg.ai_draft);
        const isAssistantOpen = assistantMessageId === msg.id;
        const assistantState = isAssistantOpen ? assistantResults[msg.id] : null;
        const assistantAnalysis = assistantState?.analysis || null;
        const isAssistantLoading = assistantLoadingId === msg.id;
        const riskFlag = getCommandInboxRiskFlag(msg);
        const displayTriageStatus = !riskFlag && ["Needs Human Review", "Needs Investigation"].includes(String(msg.triage_status || ""))
          ? "Triaged"
          : msg.triage_status;
        const triageStyle = TRIAGE_STATUS_STYLE[displayTriageStatus] || "bg-gray-100 text-gray-500 border-gray-200";
        const existingReplacementCase = getExistingReplacementCaseForMessage(msg, safeReplacements);
        const replacementLogged = Boolean(existingReplacementCase || getInboundMetadata(msg).replacement_logged);
        const replacementArchived = Boolean(existingReplacementCase?.archived_at);
        const replacementButtonLabel = replacementArchived
          ? "View Archived Replacement"
          : replacementLogged
          ? "Open Replacement Case"
          : "Send to Replacement Log";

        return (
          <Card key={msg.id} id={`inbox-message-${msg.id}`} className={`w-full p-4 border-l-4 ${brandBorderCls} ${isNoise ? "opacity-75" : ""}`}>
            {/* Card header row */}
            <div className="flex flex-col gap-2 mb-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <BrandPip brand={displayBrand} />
                <span className={`text-xs font-semibold ${displayBrand === "Unassigned" ? "text-gray-400" : "text-gray-700"}`}>{displayBrand}</span>
                <Badge label={sourceBadgeLabel} className={`text-[10px] ${sourceBadgeCls}`} />
                {msg.channel && msg.channel !== "TikTok Shop" && msg.channel !== sourceBadgeLabel && (
                  <span className="text-[10px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">{msg.channel}</span>
                )}
                {msg.priority && <Badge label={msg.priority} className={priorityStyle} />}
                {msg.status   && <Badge label={msg.status}   className={statusStyle}   />}
                {untriaged
                  ? <Badge label="Untriaged" className="bg-gray-100 text-gray-400 border-gray-200" />
                  : <Badge label={displayTriageStatus} className={triageStyle} />
                }
                {msg.draft_status === "Approved" && (
                  <Badge label="Draft Approved" className="bg-slate-100 text-slate-700 border-slate-200" />
                )}
                {msg.ai_draft && msg.draft_status !== "Approved" && (
                  <Badge label="Draft Ready" className="bg-gray-50 text-gray-700 border-gray-200" />
                )}
                {riskFlag?.label === "Needs Human Review" && (
                  <Badge label="Needs Human Review" className="bg-black text-white border-black" />
                )}
                {riskFlag?.label === "Needs Investigation" && (
                  <Badge
                    label={riskFlag.label}
                    className="bg-amber-50 text-amber-700 border-amber-200"
                  />
                )}
                {replacementArchived ? (
                  <Badge label="Replacement Archived" className="bg-gray-100 text-gray-600 border-gray-200" />
                ) : replacementLogged && (
                  <Badge label="Replacement Logged" className="bg-slate-100 text-slate-700 border-slate-200" />
                )}
              </div>
              {/* Timestamp - Pacific time, labeled Received or Imported */}
              {ts.display && (
                <div className="flex flex-col items-start flex-shrink-0 sm:items-end">
                  <span className="text-[9px] text-gray-400 uppercase tracking-wide leading-none mb-0.5">{ts.label}</span>
                  <span className="text-[10px] text-gray-500 font-medium whitespace-nowrap">{ts.display} PT</span>
                </div>
              )}
            </div>

            {/* Card title - source-aware */}
            <p className="text-xs font-bold mb-1.5 text-gray-900">{cardTitle}</p>

            {/* Refund-specific info row */}
            {isRefund && (
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 mb-2">
                {orderNum         && <span className="text-[11px] text-gray-600"><span className="font-semibold">Order:</span> {orderNum}</span>}
                {displayCustomer   && <span className="text-[11px] text-gray-600"><span className="font-semibold">Customer:</span> {displayCustomer}</span>}
                {msg.sender_email && <span className="text-[11px] text-gray-400">{msg.sender_email}</span>}
                <span className="text-[11px] text-gray-700 font-medium">Review in TikTok Seller Center</span>
              </div>
            )}

            {/* Non-refund sender line */}
            {!isRefund && displayCustomer && (
              <p className="text-xs text-gray-600 mb-1.5">
                <span className="font-semibold text-gray-800">{displayCustomer}</span>
                {!displayName && msg.sender_email && <span className="text-gray-400 ml-1">· {msg.sender_email}</span>}
                {isZendesk && orderNum && <span className="text-gray-400 ml-1">· Ticket {orderNum}</span>}
              </p>
            )}

            {isZendesk && zendeskPreview && (
              <p className="text-xs text-gray-600 mb-1.5">
                <span className="font-semibold text-gray-700">Preview:</span> {zendeskPreview}
              </p>
            )}

            {/* Subject */}
            {showSubjectLine && (
              <p className="text-xs text-gray-500 italic mb-1.5 truncate">
                <span className="not-italic font-medium text-gray-500">Subject:</span> {isZendesk ? zendeskSubject : msg.subject}
              </p>
            )}

            {/* Message body */}
            {displayBody && isMessageExpanded && (
              <div className={`mb-2 rounded-lg border px-3 py-2.5 ${
                isRefund ? "bg-slate-50 border-slate-200" : "bg-gray-50 border-gray-100"
              }`}>
                <p className={`text-xs leading-relaxed whitespace-pre-wrap ${
                  isRefund ? "text-gray-800" : "text-gray-700"
                }`}>{displayBody}</p>
              </div>
            )}

            {/* History note */}
            {hasHistory && (
              <p className="text-[10px] text-gray-400 italic mb-2">Conversation history saved in raw email.</p>
            )}

            {/* ── Triage fields ── */}
            {(msg.issue_type || msg.customer_intent || msg.risk_level || msg.triage_summary || msg.next_action || msg.recommended_reply_type || msg.confidence_score != null) && (
              <div className="border border-gray-100 rounded-lg bg-gray-50 px-3 py-2.5 mb-3 space-y-1.5">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Triage</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {msg.issue_type && <span className="text-[11px] text-gray-600"><span className="font-semibold text-gray-700">Issue:</span> {msg.issue_type}</span>}
                  {msg.customer_intent && <span className="text-[11px] text-gray-600"><span className="font-semibold text-gray-700">Intent:</span> {msg.customer_intent}</span>}
                  {msg.risk_level && (
                    <span className="inline-flex items-center gap-1 text-[11px]">
                      <span className="font-semibold text-gray-700">Risk:</span>
                      <Badge label={msg.risk_level} className={riskStyle} />
                    </span>
                  )}
                  {msg.recommended_reply_type && <span className="text-[11px] text-gray-600"><span className="font-semibold text-gray-700">Reply type:</span> {msg.recommended_reply_type}</span>}
                  {msg.confidence_score != null && <span className="text-[11px] text-gray-600"><span className="font-semibold text-gray-700">Confidence:</span> {msg.confidence_score}%</span>}
                </div>
                {msg.triage_summary && <p className="text-[11px] text-gray-600"><span className="font-semibold text-gray-700">Summary:</span> {msg.triage_summary}</p>}
                {msg.next_action    && <p className="text-[11px] text-slate-600"><span className="font-semibold text-gray-700">Next:</span> {msg.next_action}</p>}
              </div>
            )}

            {/* ── AI Draft box ── */}
            {isAssistantOpen && (
              <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-gray-900">AI Assistant Helper</p>
                    <p className="mt-0.5 text-[10px] font-medium text-gray-400">
                      {isAssistantLoading ? "Assistant is reviewing..." : assistantState?.source === "ai" ? "AI generated" : "Rule-based preview"}
                    </p>
                  </div>
                  {assistantAnalysis && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge label={assistantAnalysis.suggestedPriority} className={INBOX_PRIORITY_STYLE[assistantAnalysis.suggestedPriority] || INBOX_PRIORITY_STYLE.Medium} />
                      <Badge label={assistantAnalysis.confidence} className={assistantAnalysis.confidence === "High" ? "bg-slate-100 text-slate-700 border-slate-200" : "bg-gray-100 text-gray-600 border-gray-200"} />
                    </div>
                  )}
                </div>
                {isAssistantLoading && !assistantAnalysis ? (
                  <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-3 text-xs font-medium text-gray-500">
                    Assistant is reviewing...
                  </div>
                ) : assistantAnalysis && (
                  <>
                    {assistantState?.error && (
                      <div className="mb-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] font-medium text-gray-500">
                        {assistantState.error}
                      </div>
                    )}
                    {assistantState?.source === "fallback" && (
                      <div className="mb-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] font-medium text-gray-400">
                        Using local fallback.
                      </div>
                    )}
                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Situation</p>
                        <p className="mt-1 text-xs leading-relaxed text-gray-700">{assistantAnalysis.situation}</p>
                      </div>
                      <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Recommended Next Step</p>
                        <p className="mt-1 text-xs leading-relaxed text-gray-700">{assistantAnalysis.recommendedNextStep}</p>
                      </div>
                      <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Missing Info</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {assistantAnalysis.missingInfo.map(item => (
                            <span key={item} className="rounded border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-600">{item}</span>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Suggested Priority</p>
                        <div className="mt-1">
                          <Badge label={assistantAnalysis.suggestedPriority} className={INBOX_PRIORITY_STYLE[assistantAnalysis.suggestedPriority] || INBOX_PRIORITY_STYLE.Medium} />
                        </div>
                      </div>
                      <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Suggested Status</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge label={assistantAnalysis.suggestedStatus} className="bg-gray-100 text-gray-700 border-gray-200" />
                          <span className="text-[10px] text-gray-400">Read-only suggestion</span>
                        </div>
                      </div>
                      <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Confidence</p>
                        <p className="mt-1 text-xs font-semibold text-gray-700">{assistantAnalysis.confidence}</p>
                      </div>
                    </div>
                    <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Draft Reply</p>
                        <button
                          type="button"
                          onClick={() => handleCopyAssistantDraft(msg, assistantAnalysis.draftReply)}
                          title="Copies reply text only."
                          className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          Copy Draft
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopyChannelUrl(msg)}
                          title="Copies the source channel URL. Does not open it."
                          className="rounded border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-500 hover:bg-gray-50"
                        >
                          Copy Channel URL
                        </button>
                      </div>
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-800">{assistantAnalysis.draftReply}</p>
                      {copiedAssistantDraftId === msg.id && (
                        <p className="mt-2 text-[10px] font-medium text-slate-500">Draft copied. Use Stream Deck to open the correct Shop Chat window.</p>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2">
                      {assistantAnalysis.reasoningTags.map(tag => (
                        <span key={tag} className="rounded border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-400">{tag.replace(/_/g, " ")}</span>
                      ))}
                      <span className="ml-auto text-[10px] text-gray-400">Backend AI connection can be added next.</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {isAssistantOpen && msg.ai_draft && (() => {
              const isDraftCollapsed = collapsedDrafts[msg.id] === true;
              const toggleCollapse = () => setCollapsedDrafts(prev => ({ ...prev, [msg.id]: !prev[msg.id] }));
              return (
              <div className="border border-slate-200 rounded-lg bg-slate-50 px-3 py-2.5 mb-3">
                <div className="flex flex-col gap-2 mb-1.5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">AI Draft</p>
                  <div className="flex items-center gap-2">
                    {msg.draft_status && (
                      <Badge label={msg.draft_status} className={msg.draft_status === "Approved" ? "bg-slate-100 text-slate-700 border-slate-200" : "bg-gray-100 text-gray-600 border-gray-200"} />
                    )}
                    <button onClick={toggleCollapse} className="text-[10px] text-slate-500 hover:text-slate-800 cursor-pointer">
                      {isDraftCollapsed ? "Show Draft" : "Hide"}
                    </button>
                  </div>
                </div>
                {!isDraftCollapsed && (
                  <>
                    <p className="text-xs text-gray-800 leading-relaxed whitespace-pre-wrap">{msg.ai_draft}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2 border-t border-slate-200">
                      <button onClick={() => handleCopyDraft(msg)}
                        title="Copies reply text only."
                        className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer transition-colors whitespace-nowrap">
                        Copy Draft
                      </button>
                      <button onClick={() => handleCopyChannelUrl(msg)}
                        title="Copies the source channel URL. Does not open it."
                        className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 cursor-pointer transition-colors whitespace-nowrap">
                        Copy Channel URL
                      </button>
                      <button disabled={!hasReplyText} onClick={() => handleCopyReply(msg)}
                        title={hasReplyText ? "Copy the approved reply or AI draft" : "Generate or approve a draft first"}
                        className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-slate-700 bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors whitespace-nowrap">
                        Copy Draft
                      </button>
                      {copiedDraftId === msg.id && (
                        <span className="text-[10px] font-medium text-slate-500">Draft copied. Use Stream Deck to open the correct Shop Chat window.</span>
                      )}
                      {msg.draft_status !== "Approved" && (
                        <button disabled={isDraftBusy || isBusy} onClick={() => handleApproveDraft(msg)}
                          className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-slate-700 bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer transition-colors whitespace-nowrap">
                          Mark Reviewed
                        </button>
                      )}
                      {[["redraft","Redraft"], ["make_shorter","Shorter"], ["make_warmer","Warmer"], ["make_firmer","Firmer"]].map(([inst, lbl]) => (
                        <button key={inst} disabled={isDraftBusy || isBusy} onClick={() => handleGenerateDraft(msg, inst)}
                          className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 cursor-pointer transition-colors whitespace-nowrap">
                          {isDraftBusy && inst === "redraft" ? "..." : lbl}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              );
            })()}

            {/* Action buttons */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
              {isZendesk && zendeskUrl && (
                <button
                  type="button"
                  onClick={() => window.open(zendeskUrl, "_blank", "noopener,noreferrer")}
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer transition-colors whitespace-nowrap"
                >
                  Open in Zendesk
                </button>
              )}
              <button
                type="button"
                disabled={!displayBody}
                onClick={() => setExpandedMessages(prev => ({ ...prev, [msg.id]: true }))}
                aria-expanded={isMessageExpanded}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors whitespace-nowrap"
              >
                View Message
              </button>
              <button disabled={isBusy || isAssistantLoading} onClick={() => handleAskAssistant(msg)}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer transition-colors whitespace-nowrap">
                {isAssistantLoading ? "Reviewing..." : isAssistantOpen ? "Hide Assistant" : "Ask Assistant"}
              </button>
              <button disabled={isBusy} onClick={() => handleSendToReplacementLog(msg)}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer transition-colors whitespace-nowrap">
                {isBusy ? "Sending..." : replacementButtonLabel}
              </button>
              <button disabled={isBusy} onClick={() => handleCloseAndArchive(msg.id)}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 disabled:opacity-50 cursor-pointer transition-colors whitespace-nowrap sm:ml-auto">
                {isBusy ? "Closing..." : "Mark Closed + Archive"}
              </button>
            </div>
          </Card>
        );
      })}
    </div>
  );
};

const buildSlackSummary = ({ tickets, replacements, studios, surpriseSets, raiseScores }) => {
  const safeReplacements = Array.isArray(replacements) ? replacements.filter(r => !r.archived_at) : [];
  const safeStudios = Array.isArray(studios) ? studios : [];
  const safeSurpriseSets = Array.isArray(surpriseSets) ? surpriseSets : [];
  const safeTickets = Array.isArray(tickets) ? tickets : [];
  const open = safeTickets.filter(t => t.status !== "Resolved" && t.status !== "Escalated");
  const resolved = safeTickets.filter(t => t.status === "Resolved");
  const escalated = safeTickets.filter(t => t.status === "Escalated");
  const slaRisks = safeTickets.filter(t => t.slaRisk === "Yes");
  const totalLoss = safeReplacements.reduce((a, r) => a + parseFloat(r.marketValue || 0), 0);
  const studioReady = safeStudios.filter(s => s.streamReady);
  const studioScore = safeStudios.length ? Math.round((studioReady.length / safeStudios.length) * 100) : 0;
  const setsReady = safeSurpriseSets.filter(s => s.readyForLive);

  return `*Jonny Ops - Weekly Shift Summary*

*TikTok SPS / Customer Support*
- ${safeTickets.length} tickets reviewed across VR, CK47, PS, and PM
- ${slaRisks.length} SLA risk ticket${slaRisks.length !== 1 ? "s" : ""} identified
- ${resolved.length} ticket${resolved.length !== 1 ? "s" : ""} resolved | ${escalated.length} escalated | ${open.length} still open

*Inventory & Studio Readiness*
- ${studioReady.map(s => s.id).join(", ")} stream-ready
- ${safeStudios.filter(s => !s.streamReady).map(s => s.id).join(", ") || "All studios"} ${safeStudios.filter(s => !s.streamReady).length > 0 ? "not ready" : "stream-ready"}
- Overall studio readiness: ${studioScore}%

*Shipping Loss Prevention*
- ${safeReplacements.length} replacement case${safeReplacements.length !== 1 ? "s" : ""} logged
- Estimated loss tracked: $${totalLoss.toFixed(2)}
- Preventable cases: ${safeReplacements.filter(r => r.preventable === "Yes").length}

*Surprise Set Execution*
- ${setsReady.length} of ${safeSurpriseSets.length} surprise set${safeSurpriseSets.length !== 1 ? "s" : ""} ready for live

*Raise Path - Self Score*
Consistency ${raiseScores.consistency}% | Accuracy ${raiseScores.accuracy}% | Loss Reduction ${raiseScores.lossReduction}% | Ownership ${raiseScores.ownership}% | Process ${raiseScores.processImprovement}%`;
};

const buildFullReport = ({ tickets, replacements, studios, surpriseSets, raiseScores, improvements, risks, nextFocus }) => {
  const safeReplacements = Array.isArray(replacements) ? replacements.filter(r => !r.archived_at) : [];
  const safeStudios = Array.isArray(studios) ? studios : [];
  const safeSurpriseSets = Array.isArray(surpriseSets) ? surpriseSets : [];
  const safeTickets = Array.isArray(tickets) ? tickets : [];
  const open = safeTickets.filter(t => t.status !== "Resolved" && t.status !== "Escalated");
  const resolved = safeTickets.filter(t => t.status === "Resolved");
  const escalated = safeTickets.filter(t => t.status === "Escalated");
  const slaRisks = safeTickets.filter(t => t.slaRisk === "Yes");
  const byBrand = BRANDS.map(b => ({ brand: b, total: safeTickets.filter(t => t.brand === b).length, resolved: safeTickets.filter(t => t.brand === b && t.status === "Resolved").length }));
  const totalLoss = safeReplacements.reduce((a, r) => a + parseFloat(r.marketValue || 0), 0);
  const preventable = safeReplacements.filter(r => r.preventable === "Yes");
  const studioReady = safeStudios.filter(s => s.streamReady);
  const studioScore = safeStudios.length ? Math.round((studioReady.length / safeStudios.length) * 100) : 0;
  const openDiscrepancies = safeStudios.reduce((a, s) => a + Math.max(0, s.discrepanciesLogged - s.discrepanciesResolved), 0);
  const setsReady = safeSurpriseSets.filter(s => s.readyForLive);

  const rcCounts = {};
  safeReplacements.forEach(r => { rcCounts[r.rootCause] = (rcCounts[r.rootCause] || 0) + 1; });
  const topCauses = Object.entries(rcCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return `JONNY OPS - WEEKLY RAISE TRACKER REPORT
Week of ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
Prepared by: Jonny Valencia
${"─".repeat(52)}

TIKTOK SPS / CUSTOMER SUPPORT
─────────────────────────────
Reviewed ${safeTickets.length} support tickets across all four brands this week.

By brand:
${byBrand.map(b => `  ${b.brand.padEnd(20)} ${b.total} tickets  (${b.resolved} resolved)`).join("\n")}

Summary:
  Resolved:        ${resolved.length}
  Open:            ${open.length}
  Escalated:       ${escalated.length}
  SLA risks flagged: ${slaRisks.length}
  SLA risks (active, < 2h): ${safeTickets.filter(t => isActiveSlaRisk(t)).length}

INVENTORY & STUDIO READINESS
─────────────────────────────
${safeStudios.map(s => `  ${s.id}: ${s.streamReady ? "Stream-ready" : "NOT READY"} - ${s.notes}`).join("\n")}

  Overall readiness:     ${studioScore}%
  Open discrepancies:    ${openDiscrepancies}
  Studios counted:       ${safeStudios.filter(s => s.countCompleted).length}/${safeStudios.length}

SHIPPING LOSS PREVENTION
─────────────────────────────
  Replacement cases logged:   ${safeReplacements.length}
  Estimated loss tracked:     $${totalLoss.toFixed(2)}
  Preventable cases:          ${preventable.length}${preventable.length > 0 ? ` (${preventable.map(r => r.orderNum).join(", ")})` : ""}
  Follow-up required:         ${safeReplacements.filter(r => r.followUp === "Yes").length}
${topCauses.length > 0 ? `\n  Top root causes:\n${topCauses.map(([c, n]) => `  - ${c}: ${n} case${n > 1 ? "s" : ""}`).join("\n")}` : ""}

SURPRISE SET EXECUTION
─────────────────────────────
  Sets tracked:       ${safeSurpriseSets.length}
  Ready for live:     ${setsReady.length}
${safeSurpriseSets.map(s => `  - ${s.setName} (${s.brand}) - ${s.readyForLive ? "Ready" : "Not ready"}`).join("\n")}

RAISE PATH - SELF ASSESSMENT
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

// ─── DAILY OPS BRIEF ─────────────────────────────────────────────────────────
// Pure computation - reads already-fetched state, no new Supabase calls.

const buildBriefSummary = ({ msgsNeedingReply, draftsReady, overdueActions, highActions, dueTodayActions, waitingActions }) => {
  const parts = [];
  if (overdueActions > 0)   parts.push(`${overdueActions} overdue action${overdueActions !== 1 ? "s" : ""}`);
  if (msgsNeedingReply > 0) parts.push(`${msgsNeedingReply} message${msgsNeedingReply !== 1 ? "s" : ""} needing reply`);
  if (draftsReady > 0)      parts.push(`${draftsReady} draft${draftsReady !== 1 ? "s" : ""} ready to approve`);
  if (highActions > 0)      parts.push(`${highActions} high-priority action${highActions !== 1 ? "s" : ""}`);
  if (dueTodayActions > 0)  parts.push(`${dueTodayActions} action${dueTodayActions !== 1 ? "s" : ""} due today`);
  if (waitingActions > 0)   parts.push(`${waitingActions} waiting on customer`);

  if (parts.length === 0) return null; // signal "all clear"

  const sentence = parts.length === 1
    ? `You have ${parts[0]}.`
    : parts.length === 2
    ? `You have ${parts[0]} and ${parts[1]}.`
    : `You have ${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}.`;

  return sentence;
};

const START_HERE_TYPE_LABEL = {
  overdue_action:   { label: "Overdue Action",     color: "bg-black text-white border-black" },
  high_action:      { label: "High Priority",       color: "bg-black text-white border-black" },
  inbox_urgent:     { label: "Urgent Message",      color: "bg-black text-white border-black" },
  draft_ready:      { label: "Draft Ready",         color: "bg-slate-50 text-slate-700 border-slate-200" },
  ticket_open:      { label: "Open Ticket",         color: "bg-slate-50 text-slate-700 border-slate-200" },
};

const DailyOpsBrief = ({ inboundMessages, opsActions, tickets, setActiveView }) => {
  const [refreshKey, setRefreshKey] = useState(0);
  const safeInboundMessages = Array.isArray(inboundMessages) ? inboundMessages : [];
  const safeOpsActions = Array.isArray(opsActions) ? opsActions : [];
  const safeTickets = Array.isArray(tickets) ? tickets : [];
  const now = new Date();
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  const isOverdue  = (a) => a.due_at && new Date(a.due_at) < now;
  const isDueToday = (a) => a.due_at && new Date(a.due_at) <= todayEnd && !isOverdue(a);
  const isHighPlus = (a) => a.priority === "High" || a.priority === "Critical";
  const isTicketNew = (t) => t.status === "New" || t.status === "In Progress";
  const createdToday = (iso) => { const d = new Date(iso); return d >= todayStart && d <= todayEnd; };

  // ── Metric counts ─────────────────────────────────────────────────────────────
  const msgsNeedingReply  = safeInboundMessages.filter(m => m.status === "Needs Reply" || !m.status).length;
  const draftsReady       = safeInboundMessages.filter(m => m.draft_status === "Draft Ready").length;
  const openActions       = safeOpsActions.length;
  const dueTodayActions   = safeOpsActions.filter(isDueToday).length;
  const overdueActions    = safeOpsActions.filter(isOverdue).length;
  const highActions       = safeOpsActions.filter(isHighPlus).length;
  const waitingActions    = safeOpsActions.filter(a => a.status === "Waiting on Customer").length;
  const ticketsToday      = safeTickets.filter(t => t.createdAt && createdToday(t.createdAt)).length;

  // ── Build Start Here list (max 5, priority-ordered) ───────────────────────────
  const startHere = [];

  // 1. Overdue ops_actions
  safeOpsActions
    .filter(isOverdue)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
    .forEach(a => {
      if (startHere.length >= 5) return;
      startHere.push({
        key:      `action-${a.id}`,
        type:     "overdue_action",
        brand:    a.brand,
        title:    a.title || a.action_type || "Action",
        summary:  a.details ? a.details.slice(0, 80) : null,
        priority: a.priority,
        due_at:   a.due_at,
        nav:      "actions",
      });
    });

  // 2. High/Critical ops_actions due today (not already listed)
  opsActions
    .filter(a => isDueToday(a) && isHighPlus(a))
    .sort((a, b) => (ACTION_PRIORITY_ORDER[a.priority] ?? 9) - (ACTION_PRIORITY_ORDER[b.priority] ?? 9))
    .forEach(a => {
      if (startHere.length >= 5) return;
      startHere.push({
        key:      `action-today-${a.id}`,
        type:     "high_action",
        brand:    a.brand,
        title:    a.title || a.action_type || "Action",
        summary:  a.details ? a.details.slice(0, 80) : null,
        priority: a.priority,
        due_at:   a.due_at,
        nav:      "actions",
      });
    });

  // 3. Urgent inbound messages (High/Critical, Needs Reply)
  inboundMessages
    .filter(m => (m.priority === "High" || m.priority === "Critical") && (m.status === "Needs Reply" || !m.status))
    .forEach(m => {
      if (startHere.length >= 5) return;
      const { displayName, displayBody } = getDisplayInboundMessage(m);
      startHere.push({
        key:      `inbox-urgent-${m.id}`,
        type:     "inbox_urgent",
        brand:    m.brand,
        title:    m.subject || m.issue_type || "Inbound message",
        summary:  displayName ? `From ${displayName}` : (displayBody ? displayBody.slice(0, 60) : null),
        priority: m.priority,
        due_at:   null,
        nav:      "inbox",
      });
    });

  // 4. Inbound messages with Draft Ready
  inboundMessages
    .filter(m => m.draft_status === "Draft Ready")
    .forEach(m => {
      if (startHere.length >= 5) return;
      const { displayName } = getDisplayInboundMessage(m);
      startHere.push({
        key:      `draft-${m.id}`,
        type:     "draft_ready",
        brand:    m.brand,
        title:    m.subject || m.issue_type || "Draft ready",
        summary:  displayName ? `From ${displayName} - approve or refine` : "Review and approve AI draft",
        priority: m.priority,
        due_at:   null,
        nav:      "inbox",
      });
    });

  // 5. Open tickets (New / In Progress)
  tickets
    .filter(isTicketNew)
    .slice(0, Math.max(0, 5 - startHere.length))
    .forEach(t => {
      startHere.push({
        key:      `ticket-${t.id}`,
        type:     "ticket_open",
        brand:    t.brand,
        title:    t.issueType || "Open ticket",
        summary:  t.notes ? t.notes.slice(0, 80) : null,
        priority: t.priority,
        due_at:   null,
        nav:      "tickets",
      });
    });

  const summary = buildBriefSummary({ msgsNeedingReply, draftsReady, overdueActions, highActions, dueTodayActions, waitingActions });
  const allClear = !summary && startHere.length === 0;

  const metrics = [
    { label: "Msgs Needing Reply", value: msgsNeedingReply, accent: "text-gray-900",                                            border: "border-l-slate-300"  },
    { label: "Drafts Ready",       value: draftsReady,      accent: "text-gray-900",                                            border: "border-l-slate-300"  },
    { label: "Open Actions",       value: openActions,      accent: "text-gray-900",                                            border: "border-l-gray-300"   },
    { label: "Due Today",          value: dueTodayActions,  accent: "text-gray-900",                                            border: "border-l-slate-300"  },
    { label: "Overdue",            value: overdueActions,   accent: overdueActions > 0   ? "text-black" : "text-gray-900",      border: "border-l-slate-300"  },
    { label: "High Priority",      value: highActions,      accent: highActions > 0      ? "text-black" : "text-gray-900",      border: "border-l-slate-300"  },
    { label: "Waiting on Cust.",   value: waitingActions,   accent: "text-gray-900",                                            border: "border-l-gray-300"   },
    { label: "Tickets Today",      value: ticketsToday,     accent: "text-gray-900",                                            border: "border-l-gray-300"   },
  ];

  return (
    <Card className="p-0 overflow-hidden">
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${allClear ? "bg-slate-400" : overdueActions > 0 ? "bg-black" : "bg-slate-500"}`} />
          <p className="text-sm font-bold text-gray-900">Today's Ops Brief</p>
          <span className="text-[10px] text-gray-400">{todayStr()}</span>
        </div>
        <button
          onClick={() => setRefreshKey(k => k + 1)}
          className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800 cursor-pointer transition-colors"
          title="Refresh brief"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M10 6A4 4 0 1 1 6 2a4 4 0 0 1 2.83 1.17L10 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <path d="M8 4h2V2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Refresh Brief
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* 8-up metric chips */}
        <div className="grid grid-cols-4 gap-2 md:grid-cols-8">
          {metrics.map(({ label, value, accent, border }) => (
            <div key={label} className={`bg-white border border-gray-100 border-l-2 ${border} rounded-lg px-2.5 py-2 text-center`}>
              <p className={`text-xl font-bold ${accent}`}>{value}</p>
              <p className="text-[9px] text-gray-400 font-medium uppercase tracking-wide leading-tight mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Plain-English summary */}
        {allClear ? (
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
            <p className="text-sm font-medium text-slate-700">You're clear right now. No urgent ops items.</p>
          </div>
        ) : (
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
            <p className="text-sm text-gray-800 leading-relaxed">{summary}</p>
          </div>
        )}

        {/* Start Here list */}
        {startHere.length > 0 && (
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Start Here</p>
            <div className="space-y-1.5">
              {startHere.map((item, idx) => {
                const typeInfo = START_HERE_TYPE_LABEL[item.type] || { label: item.type, color: "bg-gray-100 text-gray-500 border-gray-200" };
                const dueDisplay = item.due_at ? new Date(item.due_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
                return (
                  <div key={item.key} className="flex items-start gap-3 bg-white border border-gray-100 rounded-lg px-3 py-2.5 hover:border-gray-200 transition-colors">
                    {/* Index */}
                    <span className="text-[11px] font-bold text-gray-300 w-4 flex-shrink-0 mt-0.5">{idx + 1}</span>
                    {/* Brand pip */}
                    {item.brand && <BrandPip brand={item.brand} />}
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                        <Badge label={typeInfo.label} className={`text-[9px] ${typeInfo.color}`} />
                        {item.priority && <Badge label={item.priority} className={ACTION_PRIORITY_STYLE[item.priority] || "bg-gray-100 text-gray-500 border-gray-200"} />}
                        {dueDisplay && <span className={`text-[10px] font-medium ${isOverdue({ due_at: item.due_at }) ? "text-black" : "text-gray-500"}`}>{isOverdue({ due_at: item.due_at }) ? "Overdue" : dueDisplay}</span>}
                      </div>
                      <p className="text-xs font-semibold text-gray-900 truncate">{item.title}</p>
                      {item.summary && <p className="text-[10px] text-gray-400 line-clamp-1 mt-0.5">{item.summary}</p>}
                    </div>
                    {/* Nav button */}
                    <button
                      onClick={() => setActiveView(item.nav)}
                      className="flex-shrink-0 text-[10px] font-medium text-slate-600 hover:text-slate-800 cursor-pointer whitespace-nowrap"
                    >
                      Open
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};

// ─── NOTIFICATION DROPDOWN ────────────────────────────────────────────────────
const SystemStatusPanel = ({ inboundMessages, inboundLoading, inboundError, lastSyncAt }) => {
  const [open, setOpen] = useState(false);
  const safeInboundMessages = Array.isArray(inboundMessages) ? inboundMessages : [];
  const newestInboundTime = Math.max(0, ...safeInboundMessages.map(message => getMessageSortTimestamp(message)).filter(Boolean));
  const lastSyncLabel = lastSyncAt
    ? fmtPacific(lastSyncAt)
    : newestInboundTime
    ? fmtPacific(new Date(newestInboundTime).toISOString())
    : "Not synced yet";
  const rows = [
    { label: "Supabase connection", value: inboundError ? "Attention needed" : supabase ? "Connected" : "Unavailable" },
    { label: "Active table", value: "public.work_queue" },
    { label: "Last sync time", value: inboundLoading ? "Syncing now" : lastSyncLabel },
    { label: "Dashboard source", value: "Live queue" },
    { label: "AI intake status", value: supabase?.functions?.invoke ? "Ready" : "Unavailable" },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex h-8 items-center justify-center rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
        aria-label="System Status"
        title="System Status"
      >
        Status
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-50 w-72 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
            <div className="border-b border-gray-100 bg-gray-50 px-4 py-2.5">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-700">System Status</p>
            </div>
            <div className="divide-y divide-gray-50">
              {rows.map(row => (
                <div key={row.label} className="px-4 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{row.label}</p>
                  <p className="mt-0.5 text-xs font-semibold text-gray-800">{row.value}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const NotificationDropdown = ({ inboundMessages, opsActions, replacements, setActiveView, openCommandInbox, agentAlertCount = 0 }) => {
  const [open, setOpen] = useState(false);

  const safeInboundMessages = Array.isArray(inboundMessages) ? inboundMessages : [];
  const safeReplacements = Array.isArray(replacements) ? replacements : [];
  const safeOpsActions = Array.isArray(opsActions) ? opsActions : [];
  const now = new Date();
  const isOverdue = (a) => a.due_at && new Date(a.due_at) < now;

  // Group refund/return messages by brand
  const refundsByBrand = {};
  safeInboundMessages.forEach(m => {
    if (isTikTokRefund(m)) {
      const b = m.brand || "Unknown";
      refundsByBrand[b] = (refundsByBrand[b] || 0) + 1;
    }
  });

  // Group Shop Chat messages by brand
  const chatsByBrand = {};
  safeInboundMessages.forEach(m => {
    if (classifyInboundSource(m) === "TikTok Shop Chat" && !isTikTokRefund(m)) {
      const b = m.brand || "Unknown";
      chatsByBrand[b] = (chatsByBrand[b] || 0) + 1;
    }
  });

  const draftsReady        = safeInboundMessages.filter(m => m.draft_status === "Draft Ready").length;
  const followUpNeeded     = safeReplacements.filter(r => !r.archived_at && (r.followUp === "Yes" || r.follow_up === "Yes")).length;
  const overdueActionsCount = safeOpsActions.filter(isOverdue).length;
  const overdueInboxCount = getOverdueMessages(safeInboundMessages).length;
  const highPriorityInboxCount = getHighPriorityMessages(safeInboundMessages).length;

  const totalCount = Object.values(refundsByBrand).reduce((a, b) => a + b, 0)
    + Object.values(chatsByBrand).reduce((a, b) => a + b, 0)
    + draftsReady + followUpNeeded + overdueActionsCount;

  const items = [];
  Object.entries(refundsByBrand).forEach(([brand, n]) => {
    items.push({ label: `${brand}: ${n} refund/return${n > 1 ? "s" : ""}`, nav: "inbox", filter: { kind: "refunds", brand }, color: "text-gray-900" });
  });
  Object.entries(chatsByBrand).forEach(([brand, n]) => {
    items.push({ label: `${brand}: ${n} shop chat${n > 1 ? "s" : ""}`, nav: "inbox", filter: { kind: "open", brand }, color: "text-gray-700" });
  });
  if (draftsReady > 0)        items.push({ label: `${draftsReady} draft${draftsReady > 1 ? "s" : ""} ready to approve`, nav: "inbox", filter: { kind: "open" }, color: "text-gray-700" });
  if (overdueInboxCount > 0)  items.push({ label: `${overdueInboxCount} overdue inbox message${overdueInboxCount !== 1 ? "s" : ""}`, nav: "inbox", filter: { kind: "overdue" }, color: "text-gray-900" });
  if (highPriorityInboxCount > 0) items.push({ label: `${highPriorityInboxCount} high priority message${highPriorityInboxCount !== 1 ? "s" : ""}`, nav: "inbox", filter: { kind: "high-priority" }, color: "text-gray-900" });
  if (followUpNeeded > 0)     items.push({ label: `${followUpNeeded} replacement${followUpNeeded > 1 ? "s" : ""} need follow-up`, nav: "replacements", color: "text-gray-700" });
  if (overdueActionsCount > 0) items.push({ label: `${overdueActionsCount} overdue action${overdueActionsCount > 1 ? "s" : ""}`, nav: "actions", color: "text-gray-900" });
  const recentActivity = getOpenMessages(safeInboundMessages)
    .sort((a, b) => getMessageSortTimestamp(b) - getMessageSortTimestamp(a))
    .slice(0, 6)
    .map(message => {
      const { displayName } = getDisplayInboundMessage(message);
      const filterKind = isHighPriorityMessage(message) ? "high-priority" : isTikTokRefund(message) ? "refunds" : "open";
      return {
        id: message.id,
        customer: displayName || message.customer_name || message.sender_name || message.sender_email || "Customer",
        brand: getDisplayBrand(message),
        issueType: message.issue_type || message.message_type || classifyInboundSource(message),
        age: getMessageAgeLabel(message),
        preview: getMessagePreview(message, 88),
        filterKind,
      };
    });

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative text-gray-400 hover:text-gray-700 transition-colors"
        aria-label="Notifications"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M9 2a5 5 0 0 1 5 5v3l2 2H2l2-2V7a5 5 0 0 1 5-5z" stroke="currentColor" strokeWidth="1.4" fill="none"/>
          <path d="M7 15.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        {agentAlertCount > 0 && (
          <span className="absolute -top-1 -right-1 text-[9px] bg-red-500 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">
            {agentAlertCount > 9 ? "9+" : agentAlertCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Dropdown */}
          <div className="absolute right-0 top-8 z-50 w-72 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50">
              <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Notifications</p>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 text-lg leading-none">×</button>
            </div>
            {recentActivity.length === 0 && items.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-gray-400">All clear. Nothing needs attention.</p>
              </div>
            ) : (
              <div>
                {recentActivity.length > 0 && (
                  <div className="divide-y divide-gray-50">
                    {recentActivity.map(item => (
                      <button
                        key={item.id}
                        onClick={() => { openCommandInbox({ kind: item.filterKind, messageId: item.id }); setOpen(false); }}
                        className="w-full px-4 py-3 text-left transition-colors hover:bg-gray-50"
                      >
                        <p className="truncate text-xs font-bold text-gray-900">{item.customer}</p>
                        <p className="mt-0.5 truncate text-[10px] font-semibold text-gray-500">{item.brand} &middot; {item.issueType} &middot; {item.age}</p>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-gray-500">{item.preview}</p>
                      </button>
                    ))}
                  </div>
                )}
                {items.length > 0 && (
                  <div className="border-t border-gray-100 bg-gray-50 px-4 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Summary</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {items.slice(0, 5).map((item, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            if (item.nav === "inbox") openCommandInbox(item.filter || { kind: "open" });
                            else setActiveView(item.nav);
                            setOpen(false);
                          }}
                          className={`rounded border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold ${item.color} hover:bg-gray-50`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

// ─── DASHBOARD VIEW ───────────────────────────────────────────────────────────
const CLOSED_INBOUND_STATUSES = ["Closed", "Archived", "Resolved"];
const OPEN_INBOUND_STATUSES = ["Needs Reply", "In Progress", "Draft Ready", "Ticket Created", "Manual Review", ""];
const getMessageSortTimestamp = (message) =>
  new Date(message?.received_time || message?.received_at || message?.email_received_at || message?.created_at || 0).getTime() || 0;
const normalizeWorkQueueStatus = (status) =>
  String(status || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const getOpenMessages = (messages) => {
  const safeMessages = Array.isArray(messages) ? messages : [];
  return safeMessages.filter(message => !message?.archived_at);
};
const getNeedsReplyMessages = (messages) => getOpenMessages(messages).filter(message => {
  const status = normalizeWorkQueueStatus(message?.status);
  const tags = getInboundTags(message).map(tag => normalizeWorkQueueStatus(tag));
  return status === "needs_reply" || tags.includes("needs_reply");
});
const getRefundMessages = (messages) => getOpenMessages(messages).filter(message =>
  isTikTokRefund(message) ||
  String(message?.message_type || "").toLowerCase().includes("refund") ||
  String(message?.channel || "").toLowerCase().includes("refund") ||
  String(message?.channel || "").toLowerCase().includes("return")
);
const isHighPriorityMessage = (message) => {
  const text = [
    message?.issue_type,
    message?.message_type,
    message?.customer_intent,
    message?.triage_status,
    message?.risk_level,
    message?.priority,
    message?.subject,
    message?.message_body,
    message?.message,
    message?.triage_summary,
    message?.next_action,
  ].filter(Boolean).join(" ").toLowerCase();
  return (
    message?.priority === "High" ||
    message?.risk_level === "High" ||
    message?.triage_status === "High Priority" ||
    isTikTokRefund(message) ||
    /\b(refund|return|missing item|wrong item|damaged item|delivered not received|delivered-not-received|no movement|escalation|high value|high-value)\b/i.test(text)
  );
};
const getHighPriorityMessages = (messages) => getOpenMessages(messages).filter(isHighPriorityMessage);
const getOverdueMessages = (messages) => {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return getOpenMessages(messages).filter(message => {
    const ts = getMessageSortTimestamp(message);
    return ts > 0 && ts < dayAgo;
  });
};
const getMessagePreview = (message, max = 96) => {
  const { displayBody } = getDisplayInboundMessage(message || {});
  const raw = displayBody || message?.message_body || message?.message || message?.subject || "";
  const preview = String(raw).replace(/\s+/g, " ").trim();
  if (!preview) return "No preview available.";
  return preview.length > max ? `${preview.slice(0, max - 1).trim()}...` : preview;
};
const getMessageAgeLabel = (message) => {
  const ts = getMessageSortTimestamp(message);
  if (!ts) return "No timestamp";
  const diffMs = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};
const matchesCommandInboxFilter = (message, filter = {}) => {
  if (!message) return false;
  if (filter.messageId && message.id !== filter.messageId) return false;
  if (filter.brand && getDisplayBrand(message) !== filter.brand) return false;
  const kind = filter.kind || filter.filter || "all";
  if (kind === "open") return getOpenMessages([message]).length > 0;
  if (kind === "overdue") return getOverdueMessages([message]).length > 0;
  if (kind === "refunds") return getRefundMessages([message]).length > 0;
  if (kind === "high-priority") return getHighPriorityMessages([message]).length > 0;
  return true;
};
const getBrandCounts = (messages) => {
  const brands = ["Vaulted Rarities", "CardKing47", "PokeSpins", "PokieMart"];
  const openMessages = getOpenMessages(messages);
  const refundMessages = getRefundMessages(messages);
  return brands.map(brand => ({
    brand,
    open: openMessages.filter(message => getDisplayBrand(message) === brand).length,
    refunds: refundMessages.filter(message => getDisplayBrand(message) === brand).length,
  }));
};
const getTopBrand = (messages) => getBrandCounts(messages)
  .reduce((top, row) => row.open > top.open ? row : top, { brand: "Unassigned", open: 0, refunds: 0 });
const buildOpsAgentBrief = (messages) => {
  const openMessages = getOpenMessages(messages);
  const refundMessages = getRefundMessages(messages);
  const highPriorityMessages = getHighPriorityMessages(messages);
  const overdueMessages = getOverdueMessages(messages);
  const topBrand = getTopBrand(messages);
  if (refundMessages.length > 0) return `Refunds need attention first. I found ${refundMessages.length} refund or return message${refundMessages.length !== 1 ? "s" : ""} waiting${topBrand.open > 0 ? `, with ${topBrand.brand} carrying most of the open queue` : ""}.`;
  if (highPriorityMessages.length > 0) return `Start with high priority messages. There ${highPriorityMessages.length === 1 ? "is" : "are"} ${highPriorityMessages.length} urgent item${highPriorityMessages.length !== 1 ? "s" : ""} that should be reviewed before normal support.`;
  if (overdueMessages.length > 0) return `You have older messages starting to sit too long. I found ${overdueMessages.length} open message${overdueMessages.length !== 1 ? "s" : ""} older than 24 hours.`;
  if (openMessages.length > 0) return `The queue is active but manageable. I found ${openMessages.length} open message${openMessages.length !== 1 ? "s" : ""} waiting for a clean pass.`;
  return "The inbox looks clear right now. No major support issues need immediate action.";
};
const buildRecommendedNextAction = (messages) => {
  if (getHighPriorityMessages(messages).length > 0) return { action: "Review high priority messages first.", reason: "High priority items are the most likely to need a fast human decision." };
  if (getRefundMessages(messages).length > 0) return { action: "Review refund and return cases first.", reason: "Refunds usually need faster decisions and should not mix with normal chat." };
  if (getOverdueMessages(messages).length > 0) return { action: "Clear overdue messages before they get buried.", reason: "Older open messages are easier to miss once newer intake starts moving." };
  if (getNeedsReplyMessages(messages).length > 0) return { action: "Work the newest Needs Reply messages.", reason: "The queue is open, but there are no urgent refund or high priority signals right now." };
  return { action: "No urgent action. Keep monitoring.", reason: "The open queue is clear enough to stay in watch mode." };
};

const DashboardView = ({ tickets, setTickets, replacements, studios, surpriseSets, raiseScores, inboundMessages, opsActions, openCommandInbox, newMessageNoticeCount = 0 }) => {
  const [showForm, setShowForm] = useState(false);
  const emptyF = { brand: "", channel: "", issueType: "", priority: "Medium", slaRisk: "No", status: "New", notes: "", nextAction: "" };
  const [form, setForm] = useState(emptyF);
  const f = k => v => setForm(p => ({ ...p, [k]: v }));

  const addTicket = async () => {
    if (!form.brand || !form.issueType) return showOpsToast("Pick a brand and issue type first.", { type: "error" });
    const newTicket = { ...form, createdAt: nowISO(), source: "command-center" };
    const { data, error } = await insertTicketToSupabase(newTicket);
    if (error) return showOpsToast(`Ticket save failed: ${error.message || "Unknown Supabase error"}`, { type: "error" });
    setTickets(prev => [data, ...prev]);
    setForm(emptyF);
    setShowForm(false);
  };

  // Safe array guards - prevents crash if props arrive undefined during loading
  const safeInboundMessages = Array.isArray(inboundMessages) ? inboundMessages : [];
  const safeReplacements = Array.isArray(replacements) ? replacements : [];
  const safeStudios = Array.isArray(studios) ? studios : [];
  const safeSurpriseSets = Array.isArray(surpriseSets) ? surpriseSets : [];
  const safeTickets = Array.isArray(tickets) ? tickets : [];
  const safeOpsActions = Array.isArray(opsActions) ? opsActions : [];
  const safeInbound = safeInboundMessages;
  const activeReplacements = safeReplacements.filter(r => !r.archived_at);

  // Primary counts driven by Command Inbox data
  const openInboxMessages   = getOpenMessages(safeInbound);
  const replacementFollowUps = activeReplacements.filter(r => r.followUp === "Yes" || r.follow_up === "Yes");
  const msgsNeedingReply    = getNeedsReplyMessages(safeInbound).length;
  const refundItems         = getRefundMessages(safeInbound).length;
  const replacementFU       = replacementFollowUps.length;
  const actionRequiredCount = openInboxMessages.length + replacementFollowUps.length;
  const actionRequired      = actionRequiredCount; // alias used by metric card

  const totalLoss   = activeReplacements.reduce((a, r) => a + parseFloat(r.marketValue || r.market_value || 0), 0);
  const studioReady = safeStudios.filter(s => s.streamReady).length;
  const studioScore = safeStudios.length ? Math.round((studioReady / safeStudios.length) * 100) : 0;
  const highPriorityMessages = getHighPriorityMessages(safeInbound);
  const overdueMessages = getOverdueMessages(safeInbound);
  const brandCounts = getBrandCounts(safeInbound);
  const topBrand = getTopBrand(safeInbound);
  const recommendedNextAction = buildRecommendedNextAction(safeInbound);
  const opsAgentBrief = buildOpsAgentBrief(safeInbound);
  const manualEntries = openInboxMessages.filter(m => String(m.source || "").toLowerCase() === "manual").length;
  const inboundTimes = safeInbound.map(m => getMessageSortTimestamp(m)).filter(Boolean);
  const newestInboundTime = inboundTimes.length ? Math.max(...inboundTimes) : 0;
  const lastLoadedLabel = newestInboundTime ? fmtPacific(new Date(newestInboundTime).toISOString()) : "No inbox data loaded";
  const noticedRows = [
    topBrand.open > 0 ? `${topBrand.brand} has the most open messages.` : "No brand is carrying an open support spike right now.",
    refundItems > 0 ? "Refunds are active and should stay separate from normal chat." : "No refund or return messages are currently waiting.",
    overdueMessages.length > 0 ? `${overdueMessages.length} message${overdueMessages.length !== 1 ? "s are" : " is"} older than 24 hours.` : "No open messages are older than 24 hours.",
  ];
  const agentWatchlist = [
    refundItems > 0 ? { label: "Refund / Return queue", detail: `${refundItems} open` } : null,
    overdueMessages.length > 0 ? { label: "Oldest open messages", detail: `${overdueMessages.length} over 24 hours` } : null,
    topBrand.open > 0 ? { label: "Highest volume brand", detail: `${topBrand.brand}: ${topBrand.open} open` } : null,
    highPriorityMessages.length > 0 ? { label: "High priority messages", detail: `${highPriorityMessages.length} waiting` } : null,
    manualEntries > 0 ? { label: "Manual entries", detail: `${manualEntries} open` } : null,
  ].filter(Boolean).slice(0, 3);
  const agentAttention = [
    newMessageNoticeCount > 0 ? `${newMessageNoticeCount} new message${newMessageNoticeCount !== 1 ? "s" : ""} came in since the last check.` : null,
    refundItems > 0 ? "Refunds are active. Review those before normal chat." : null,
    overdueMessages.length > 0 ? "Older messages are starting to stack up." : null,
    highPriorityMessages.length > 0 ? "High priority messages are waiting for review." : null,
  ].filter(Boolean).slice(0, 3);

  const SET_STEPS = ["warehouseListReceived", "convertedSetSheet", "importedDesktop", "quantitiesVerified", "readyForLive"];
  const SET_LABELS = { warehouseListReceived: "Warehouse List", convertedSetSheet: "SetSheet", importedDesktop: "Imported", quantitiesVerified: "Verified", readyForLive: "Ready" };
  const surpriseReadinessBrands = [
    { key: "Vaulted Rarities", label: "Vaulted Rarities", aliases: ["vaulted", "vaulted rarities"] },
    { key: "PokeSpins", label: "PokeSpins", aliases: ["pokespins", "poke spins"] },
    { key: "CardKing47", label: "CardKing47", aliases: ["cardking47", "card king 47", "ck47"] },
    { key: "Pokiemart", label: "PokieMart", aliases: ["pokiemart", "pokie mart"] },
  ];
  const surpriseReadiness = surpriseReadinessBrands.map(brand => {
    const blocks = safeSurpriseSets.filter(block => {
      const rawBrand = String(block.brand || "").trim().toLowerCase();
      return rawBrand && brand.aliases.some(alias => rawBrand === alias || rawBrand.includes(alias));
    });
    const ready = blocks.filter(block => block.status === "Live Ready" || block.readyForLive === true).length;
    const total = blocks.length;
    return { ...brand, ready, total, status: total > 0 && ready === total ? "Ready" : "Needs Setup" };
  });
  const surpriseReadyTotal = surpriseReadiness.reduce((sum, row) => sum + row.ready, 0);
  const surpriseBlockTotal = surpriseReadiness.reduce((sum, row) => sum + row.total, 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
          <p className="text-xs text-gray-400 mt-0.5">{todayStr()}</p>
        </div>
      </div>

      {overdueMessages.length > 0 && (
        <Card className="flex flex-col gap-3 border-black p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-gray-900">Assistant reminder: {overdueMessages.length} open message{overdueMessages.length !== 1 ? "s are" : " is"} older than 24 hours.</p>
          <button
            onClick={() => openCommandInbox({ kind: "overdue" })}
            className="inline-flex items-center justify-center rounded-lg border border-slate-800 bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
          >
            Review overdue
          </button>
        </Card>
      )}

      {/* Ops Agent Assistant */}
      <Card className="p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-lg font-bold text-gray-900">Ops Agent Assistant</p>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Active now</span>
            </div>
            <p className="mt-3 text-sm font-semibold text-gray-900">Hello Jonny. I checked the queue.</p>
            <p className="mt-1 text-sm leading-relaxed text-gray-700">{opsAgentBrief}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => openCommandInbox({ kind: "refunds" })} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50">View Refunds</button>
            <button onClick={() => openCommandInbox({ kind: "high-priority" })} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50">View High Priority</button>
            <button onClick={() => openCommandInbox({ kind: "open" })} className="rounded-lg border border-slate-800 bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800">Open Command Inbox</button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr_0.9fr]">
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">What I noticed</p>
            <div className="mt-2 space-y-2">
              {noticedRows.map(row => (
                <p key={row} className="text-xs leading-relaxed text-gray-700">{row}</p>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-gray-100 bg-white p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Recommended Next Action</p>
            <p className="mt-2 text-sm font-bold text-gray-900">{recommendedNextAction.action}</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">Reason: {recommendedNextAction.reason}</p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Agent Watchlist</p>
            <div className="mt-2 space-y-2">
              {(agentWatchlist.length ? agentWatchlist : [{ label: "Inbox watch mode", detail: "No urgent queue pressure" }]).map(item => (
                <div key={item.label} className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-gray-700">{item.label}</span>
                  <span className="text-[11px] text-gray-400">{item.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-gray-100 bg-white p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Agent Attention</p>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
            {(agentAttention.length ? agentAttention : ["No urgent alerts right now."]).map(item => (
              <p key={item} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-700">{item}</p>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <p className="text-sm font-bold text-gray-900">Brand Snapshot</p>
            <span className="text-[10px] font-semibold text-gray-400">Last loaded: {lastLoadedLabel}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-3 md:grid-cols-4">
            {brandCounts.map(row => (
              <div
                role="button"
                tabIndex={0}
                key={row.brand}
                onClick={() => openCommandInbox({ kind: "open", brand: row.brand })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openCommandInbox({ kind: "open", brand: row.brand });
                  }
                }}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                <div className="flex items-center gap-2">
                  <BrandPip brand={row.brand} />
                  <p className="truncate text-xs font-semibold text-gray-800">{row.brand}</p>
                </div>
                <p className="mt-2 text-2xl font-bold text-gray-900">{row.open}</p>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    openCommandInbox({ kind: "refunds", brand: row.brand });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      openCommandInbox({ kind: "refunds", brand: row.brand });
                    }
                  }}
                  className="mt-1 inline-flex rounded border border-transparent text-[10px] font-semibold text-gray-500 hover:border-orange-200 hover:bg-orange-50 hover:px-1 hover:text-orange-700"
                >
                  {row.refunds} refund or return
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 border-l-4 border-l-slate-400">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Action Required</p>
          <p className="text-4xl font-bold mt-1 text-gray-900">{actionRequired}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">inbox + replacements</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Refunds / Returns</p>
          <p className={`text-4xl font-bold mt-1 ${refundItems > 0 ? "text-black" : "text-gray-900"}`}>{refundItems}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Est. Loss Tracked</p>
          <p className="text-4xl font-bold text-gray-700 mt-1">${totalLoss.toFixed(2)}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Studio Readiness</p>
            <span className="w-2 h-2 rounded-full bg-slate-400" />
          </div>
          <p className="text-4xl font-bold text-gray-900">{studioScore}%</p>
          <p className="text-xs text-gray-400 mt-0.5">Stream-Ready</p>
          <div className="mt-2"><ProgressBar pct={studioScore} color="bg-slate-500" /></div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="p-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <p className="text-sm font-bold text-gray-900">Surprise Set Readiness</p>
              <span className="text-[10px] font-semibold text-gray-400">{surpriseReadyTotal}/{surpriseBlockTotal} live ready</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-3">
              {surpriseReadiness.map(row => (
                <div key={row.key} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <BrandPip brand={row.key} />
                      <p className="truncate text-xs font-semibold text-slate-800">{row.label}</p>
                    </div>
                    <Badge
                      label={row.status}
                      className={row.status === "Ready"
                        ? "bg-slate-100 text-slate-700 border-slate-200"
                        : "bg-gray-100 text-gray-500 border-gray-200"}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">{row.ready}/{row.total} stream blocks live ready</p>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <p className="text-sm font-bold text-gray-900 mb-3">Inventory &amp; Studio Readiness</p>
            <div className="grid grid-cols-4 gap-2">
              {safeStudios.map(s => (
                <div key={s.id} className="text-center">
                  <p className="text-[10px] font-semibold text-gray-400 mb-1">{s.id}</p>
                  <input type="checkbox" checked={s.streamReady} readOnly className="accent-slate-700 mb-1" />
                  <p className="text-[9px] font-bold text-gray-500">{s.streamReady ? "READY" : "NOT READY"}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-gray-900">Weekly Report Preview</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded p-3 text-[11px] text-gray-600 leading-relaxed space-y-1.5">
              <p className="font-semibold text-gray-800">Command Inbox</p>
              <p>{openInboxMessages.length} active messages</p>
              <p>{msgsNeedingReply} needing reply - {refundItems} refund/return item{refundItems !== 1 ? "s" : ""}</p>
              <p>{actionRequiredCount} total action required</p>
              <p className="font-semibold text-gray-800 pt-1">Shipping Loss</p>
              <p>{activeReplacements.length} replacement cases - ${totalLoss.toFixed(2)} tracked</p>
              <p>{activeReplacements.filter(r => r.preventable === "Yes").length} preventable</p>
              <p className="font-semibold text-gray-800 pt-1">Studios</p>
              <p>{studioReady}/{safeStudios.length} stream-ready - {studioScore}% readiness</p>
              <p className="font-semibold text-gray-800 pt-1">Sets</p>
              <p>{surpriseReadyTotal}/{surpriseBlockTotal} stream blocks live ready</p>
            </div>
          </Card>
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
    ? `Resolve SLA critical ticket immediately: "${crit[0].issueType}" for ${crit[0].brand} - ${slaDisplay(crit[0].createdAt).display} remaining`
    : high.length > 0
    ? `Address high-priority ticket: "${high[0].issueType}" for ${high[0].brand}`
    : sp < 100
    ? `Complete start-of-shift checklist (${sp}% done)`
    : "All clear - run a proactive Shop Chat sweep across all brands";

  const priorities = [
    { label: "P1 - Refunds / Returns", count: tickets.filter(t => ["Refund request","Return request"].includes(t.issueType) && t.status !== "Resolved").length, cls: "border-red-300 bg-red-50 text-red-700" },
    { label: "P2 - Shop Chat Sweeps", count: tickets.filter(t => t.channel === "Shop Chat" && t.status === "New").length, cls: "border-amber-300 bg-amber-50 text-amber-700" },
    { label: "P3 - Inventory & Studio Readiness", count: 0, cls: "border-blue-300 bg-blue-50 text-blue-700" },
    { label: "P4 - Shipping Replacement Log", count: 0, cls: "border-purple-300 bg-purple-50 text-purple-700" },
    { label: "P5 - Surprise Sets", count: 0, cls: "border-pink-300 bg-pink-50 text-pink-700" },
  ];

  return (
    <div className="space-y-4">
      <div><h2 className="text-2xl font-bold text-gray-900">Daily Command Board</h2><p className="text-xs text-gray-400 mt-0.5">{todayStr()} · {nowStr()}</p></div>
      {crit.length > 0 && (
        <div className="bg-red-600 rounded-lg px-5 py-3">
          <p className="text-white text-xs font-bold uppercase tracking-widest mb-1">Critical SLA Alert Zone - Action Required Now</p>
          {crit.map(t => <p key={t.id} className="text-white text-sm font-mono">{t.brand} - {t.issueType} - {slaDisplay(t.createdAt).display} remaining</p>)}
        </div>
      )}
      <Card className="p-4 border-l-4 border-l-blue-500">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">What should I do next?</p>
        <p className="text-gray-900 text-sm font-medium">{rec}</p>
      </Card>
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2"><p className="text-sm font-bold text-gray-900">Start-of-Shift Checklist</p><span className="text-xs font-bold text-slate-600">{sp}%</span></div>
          <ProgressBar pct={sp} color="bg-slate-600" />
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
    if (!form.brand || !form.issueType) return showOpsToast("Pick a brand and issue type first.", { type: "error" });
    const newTicket = { ...form, createdAt: nowISO(), source: "command-center" };
    const { data, error } = await insertTicketToSupabase(newTicket);
    if (error) return showOpsToast(`Ticket save failed: ${error.message || "Unknown Supabase error"}`, { type: "error" });
    setTickets(prev => [data, ...prev]);
    setForm(emptyF);
    setShowForm(false);
  };

  const upd = async (id, status) => {
    setTickets(p => p.map(t => t.id === id ? { ...t, status } : t));
    await updateTicketStatusInSupabase(id, status);
  };
  const filtered = tickets.filter(t => (!filter.brand || t.brand === filter.brand) && (!filter.status || t.status === filter.status) && (!filter.priority || t.priority === filter.priority));

  // ── PATCH 4b: TCard gets archive button in top-right corner ──────────────
  const TCard = ({ ticket: t }) => {
    const cd = slaDisplay(t.createdAt);
    const showSla = t.slaRisk === "Yes" && t.status !== "Resolved";
    return (
      <div draggable onDragStart={() => setDrag(t)} className="bg-white border border-gray-200 rounded-lg p-3 mb-2 cursor-grab hover:border-blue-300 hover:shadow-sm transition-all">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <BrandPip brand={t.brand} /><span className="text-[10px] font-semibold text-gray-700">{BRAND_SHORT[t.brand]}</span>
            <PriorityBadge priority={t.priority} />
            {showSla && cd.urgent && <Badge label="SLA CRITICAL" className="bg-red-600 text-white border-red-700 animate-pulse" />}
            {showSla && !cd.urgent && cd.warning && <Badge label="SLA RISK" className="bg-amber-50 text-amber-700 border-amber-200" />}
          </div>
          <ArchiveBtn ticketId={t.id} setTickets={setTickets} />
        </div>
        <p className="text-xs font-semibold text-gray-900 mb-1">{t.issueType}</p>
        <p className="text-[10px] text-gray-400 mb-1">{t.channel} · {fmtDate(t.createdAt)}</p>
        {showSla && <p className={`text-[10px] font-mono font-bold mb-1 ${cd.urgent ? "text-red-600" : cd.warning ? "text-amber-500" : "text-gray-500"}`}>SLA: {cd.display} remaining</p>}
        {t.notes && <p className="text-[10px] text-gray-500 mb-2 line-clamp-2">{t.notes}</p>}
        {t.nextAction && <p className="text-[10px] text-slate-600">{t.nextAction}</p>}
        <select value={t.status} onChange={e => upd(t.id, e.target.value)} className="mt-2 w-full bg-gray-50 border border-gray-200 text-gray-700 text-[10px] rounded px-1.5 py-1 focus:outline-none">{KANBAN_COLS.map(c => <option key={c}>{c}</option>)}</select>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h2 className="text-2xl font-bold text-gray-900">TikTok SPS Defense Queue</h2><p className="text-xs text-gray-400 mt-0.5">{tickets.length} total tickets</p></div>
        <BtnPrimary onClick={() => setShowForm(s => !s)} size="md">{showForm ? "Close" : "+ New Ticket"}</BtnPrimary>
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
        <p className="text-amber-700 text-sm">Never mix TikTok logins. Each brand stays in its own dedicated browser profile. Shopify is a backend lookup source only - it is never used to process TikTok orders or actions directly.</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {profiles.map(p => (
          <Card key={p.brand} className="p-5">
            <div className="flex items-center gap-2.5 mb-4"><BrandPip brand={p.brand} size="lg" /><h3 className="font-bold text-gray-900">{p.brand}</h3><span className="text-xs text-gray-400 ml-auto border border-gray-200 rounded px-2 py-0.5">Isolated Profile</span></div>
            <div className="space-y-2 mb-4">{p.tools.map(t => <div key={t} className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" /><span className="text-sm text-gray-700">{t}</span></div>)}</div>
            <div className="border-t border-gray-100 pt-3 flex items-center gap-2"><span className="text-gray-400 text-sm">Shopify</span><span className="text-sm text-gray-400">- backend lookup only</span><span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded border border-gray-200 ml-auto">Read-only</span></div>
          </Card>
        ))}
      </div>
      <Card className="p-4">
        <p className="text-sm font-bold text-gray-900 mb-3">Profile Isolation Rules</p>
        <div className="space-y-2">{["Never log into multiple TikTok Shop accounts in the same browser session","Use separate Chrome profiles or browser instances for each brand","Shopify is a backend lookup source - do not use it to perform TikTok order actions","Instagram DMs for Vaulted Rarities and CardKing47 stay in their respective profiles","Outlook Email is only used within the Vaulted Rarities profile"].map((r, i) => <div key={i} className="flex items-start gap-2"><span className="text-gray-400 flex-shrink-0 mt-0.5">{i + 1}.</span><span className="text-sm text-gray-600">{r}</span></div>)}</div>
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
    if (error) return showOpsToast(`Ticket save failed: ${error.message || "Unknown Supabase error"}`, { type: "error" });
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
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors cursor-pointer ${issue === qt.issueType ? "bg-slate-700 text-white border-slate-800" : "bg-white text-gray-700 border-gray-300 hover:border-slate-400 hover:text-slate-700"}`}>
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
const REPLACEMENT_STATUS_OPTIONS = ["Open", "Reshipped", "Refunded", "Resolved", "Pending"];
const REPLACEMENT_FILTERS = ["Active", "All", "Archived", "CardKing47", "Vaulted Rarities", "PokeSpins", "Pokiemart", "Follow-Up Needed"];
const DANTE_DEPT_FAULT_OPTIONS = ["James", "JB", "Jojo", "Gio", "Gurt", "Bernardo", "Sarah", "Streamer"];

const getReplacementValue = (row, keys, fallback = "") => {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return fallback;
};

const formatDanteDate = (value) => {
  if (!value) return "";
  const dateOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) return `${Number(dateOnly[2])}/${Number(dateOnly[3])}/${dateOnly[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
};

const normalizeDanteReason = (value) => {
  const raw = String(value || "").trim();
  const lower = raw.toLowerCase();
  if (!raw) return "";
  if (lower.includes("wrong")) return "Wrong Item Sent";
  if (lower.includes("damaged") || lower.includes("damage")) return "Damaged in Shipping";
  if (lower.includes("missing")) return "Missing Item";
  return raw;
};

const getDanteDeptFault = (row) => {
  const raw = String(getReplacementValue(row, ["dept_fault", "department_fault"], "")).trim();
  return DANTE_DEPT_FAULT_OPTIONS.includes(raw) ? raw : raw;
};

const getDanteBrand = (row) => {
  const raw = String(row?.brand || row?.brand_code || row?.brandCode || "").trim();
  const lower = raw.toLowerCase();
  if (!raw) return "";
  if (lower.includes("vaulted") || lower === "vr") return "Vaulted Rarities";
  if (lower.includes("cardking") || lower === "ck" || lower === "ck47") return "CardKing47";
  if (lower.includes("pokespins") || lower === "ps") return "PokeSpins";
  if (lower.includes("pokiemart") || lower === "pm") return "Pokiemart";
  return normalizeBrandForApp(raw);
};

const getDanteChannelPlatform = (row) => {
  const brand = getDanteBrand(row);
  const noteChannelMatch = String(row?.notes || "").match(/Channel\/platform:\s*([^\n]+)/i);
  const channel = String(getReplacementValue(row, ["channel", "platform", "source"], noteChannelMatch?.[1] || "")).toLowerCase();
  const isTikTok = channel.includes("tiktok") || channel.includes("tik tok") || channel.includes("shop");
  const isWhatnot = channel.includes("whatnot");
  if (brand === "Vaulted Rarities" && isWhatnot) return "VR Whatnot";
  if (brand === "Vaulted Rarities" && isTikTok) return "VR TikTok";
  if (brand === "CardKing47" && isWhatnot) return "CK Whatnot";
  if (brand === "CardKing47" && isTikTok) return "CK TikTok";
  if (brand === "PokeSpins" && isTikTok) return "PS TikTok";
  if (brand === "Pokiemart" && isTikTok) return "PM TikTok";
  return "";
};

const getReplacementEvidenceFromNotes = (notes) => {
  const text = String(notes || "");
  const match = text.match(/Source (?:work_queue|external) id:\s*([^\n]+)/i);
  return match ? match[1].trim() : "";
};

const getDanteReplacementFields = (row) => {
  const item = String(getReplacementValue(row, ["items", "item", "product", "replacement_item", "replacementItems", "replacement_items"], "")).trim();
  const reason = normalizeDanteReason(getReplacementValue(row, ["reason", "issue_type"], ""));
  const existingNotes = String(getReplacementValue(row, ["notes", "description"], "")).trim();
  const notes = existingNotes || ([reason, item].filter(Boolean).length === 2 ? `Customer reported ${reason} for ${item}.` : "");
  const value = Number(getReplacementValue(row, ["market_value", "marketValue", "value", "estimated_loss"], 0)) || 0;
  return {
    date: formatDanteDate(getReplacementValue(row, ["date", "created_at"], "")),
    order: String(getReplacementValue(row, ["order_number", "orderNum", "orderNo", "order", "order_id"], "")).trim(),
    item,
    reason,
    deptFault: getDanteDeptFault(row),
    marketValue: `$${value.toFixed(2)}`,
    channelPlatform: getDanteChannelPlatform(row),
    notes,
    evidence: String(getReplacementValue(row, ["evidence", "evidence_url"], "")).trim() || getReplacementEvidenceFromNotes(notes),
  };
};

const buildDanteReplacementRow = (row) => {
  const d = getDanteReplacementFields(row);
  return [d.date, d.order, d.item, d.reason, d.deptFault, d.marketValue, d.channelPlatform, d.notes, d.evidence]
    .map(value => String(value ?? "").replace(/\r?\n/g, " ").trim())
    .join("\t");
};

const ReplacementLogView = ({ replacements, setReplacements, replacementsLoading, replacementsError, onRefresh, replacementFocus }) => {
  const emptyF = {
    date: todayDate(), brand: "", orderNum: "", customerName: "",
    reason: "", rootCause: "", replacementItems: "", marketValue: "",
    preventable: "No", followUp: "No", notes: "", status: "Open",
  };
  const [form, setForm]         = useState(emptyF);
  const [show, setShow]         = useState(false);
  const [activeFilter, setActiveFilter] = useState("Active");
  const [editRow, setEditRow]   = useState(null);   // row being edited
  const [editForm, setEditForm] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [copyStatus, setCopyStatus] = useState("");
  const f  = k => v => setForm(p => ({ ...p, [k]: v }));
  const ef = k => v => setEditForm(p => ({ ...p, [k]: v }));
  const safeReplacements = Array.isArray(replacements) ? replacements : [];

  useEffect(() => {
    if (!replacementFocus?.caseId) return;
    setActiveFilter(replacementFocus.showArchived ? "Archived" : "Active");
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-replacement-row-id="${replacementFocus.caseId}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => clearTimeout(timer);
  }, [replacementFocus, safeReplacements.length]);

  // ── Add new row (local-only until Supabase migration of replacements table) ──
  const add = () => {
    if (!form.brand || !form.orderNum) return;
    setReplacements(p => [{
      id: uid(), ...form,
      marketValue: parseFloat(form.marketValue) || 0,
    }, ...p]);
    setForm(emptyF); setShow(false);
  };

  // ── Archive row (soft-delete via Supabase, fall back to local remove) ──────
  const runArchiveReplacement = async (row) => {
    if (supabase && row.id && !/^[a-z0-9]{7}$/.test(row.id)) {
      // Only call Supabase for UUID-format ids (real rows); skip local uid() rows
      const { error } = await supabase
        .from("replacements")
        .update({ archived_at: nowISO(), updated_at: nowISO() })
        .eq("id", row.id);
      if (error) { showOpsToast(`Archive failed: ${error.message}`, { type: "error" }); return; }
    }
    setReplacements(prev => prev.map(r => r.id === row.id ? { ...r, archived_at: nowISO(), updated_at: nowISO() } : r));
    showOpsToast("Replacement case archived.");
  };

  const handleArchive = (row) => {
    showOpsConfirm({
      title: "Archive replacement case?",
      body: `Replacement case ${row.orderNum || row.id} will be hidden from the active loss log. The record is archived, not hard-deleted.`,
      confirmLabel: "Archive Case",
      variant: "archive",
      onConfirm: () => runArchiveReplacement(row),
    });
  };

  // ── Save inline edit ────────────────────────────────────────────────────────
  const handleSaveEdit = async () => {
    const updated = {
      ...editForm,
      marketValue: parseFloat(editForm.marketValue) || 0,
      updated_at: nowISO(),
    };
    setSavingId(editRow);
    if (supabase && editRow && !/^[a-z0-9]{7}$/.test(editRow)) {
      const { error } = await supabase
        .from("replacements")
        .update({
          order_number:       updated.orderNum         || null,
          customer_name:      updated.customerName     || null,
          reason:             updated.reason           || null,
          root_cause:         updated.rootCause        || null,
          replacement_items:  updated.replacementItems || null,
          notes:              updated.notes            || null,
          market_value:       updated.marketValue      || 0,
          preventable:        updated.preventable      || "No",
          follow_up:          updated.followUp         || "No",
          status:             updated.status           || "Open",
          updated_at:         updated.updated_at,
        })
        .eq("id", editRow);
      if (error) { showOpsToast(`Save failed: ${error.message}`, { type: "error" }); setSavingId(null); return; }
    }
    setReplacements(prev => prev.map(r => r.id === editRow ? { ...r, ...updated } : r));
    setEditRow(null);
    setEditForm({});
    setSavingId(null);
  };

  // ── Filter + derived stats ──────────────────────────────────────────────────
  const displayRows = safeReplacements.filter(r => {
    if (activeFilter === "All")              return true;
    if (activeFilter === "Active")           return !r.archived_at;
    if (activeFilter === "Archived")         return Boolean(r.archived_at);
    if (activeFilter === "Follow-Up Needed") return !r.archived_at && r.followUp === "Yes";
    return !r.archived_at && r.brand === activeFilter;
  });

  const activeReplacements = safeReplacements.filter(r => !r.archived_at);
  const loss = activeReplacements.reduce((a, r) => a + parseFloat(r.marketValue || 0), 0);
  const prev = activeReplacements.filter(r => r.preventable === "Yes").length;
  const fu   = activeReplacements.filter(r => r.followUp === "Yes").length;
  const rc   = ROOT_CAUSES.map(c => ({ c, n: activeReplacements.filter(r => r.rootCause === c).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);

  const handleCopyDanteRows = async () => {
    setCopyStatus("");
    if (displayRows.length === 0) {
      setCopyStatus("No visible replacement rows to copy.");
      setTimeout(() => setCopyStatus(""), 3000);
      return;
    }
    try {
      await navigator.clipboard.writeText(displayRows.map(buildDanteReplacementRow).join("\n"));
      setCopyStatus("Copied Dante rows.");
    } catch {
      setCopyStatus("Copy failed. Try again.");
    }
    setTimeout(() => setCopyStatus(""), 3000);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Shipping Replacement &amp; Loss Log</h2>
          <p className="text-xs text-gray-400 mt-0.5">Track every replacement case and estimated loss</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyDanteRows}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            Export TXT
          </button>
          <button
            onClick={onRefresh}
            disabled={replacementsLoading}
            className="inline-flex items-center gap-1.5 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 font-medium rounded-lg border border-gray-300 transition-colors cursor-pointer px-3 py-1.5 text-xs"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={replacementsLoading ? "animate-spin" : ""}>
              <path d="M10 6A4 4 0 1 1 6 2a4 4 0 0 1 2.83 1.17L10 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M8 4h2V2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {replacementsLoading ? "Loading..." : "Refresh"}
          </button>
          <BtnPrimary onClick={() => setShow(s => !s)} size="md">{show ? "Close" : "+ Log Replacement"}</BtnPrimary>
        </div>
      </div>

      {copyStatus && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-700">
          {copyStatus}
        </div>
      )}

      {/* Error banner */}
      {replacementsError && (
        <div className="bg-red-50 border border-red-300 rounded-lg px-4 py-3 text-red-800 text-sm">{replacementsError}</div>
      )}

      {/* Loading skeleton */}
      {replacementsLoading && safeReplacements.length === 0 && (
        <div className="space-y-2">
          {[1,2,3].map(i => (
            <div key={i} className="bg-white border border-gray-200 rounded-lg p-4 animate-pulse">
              <div className="h-3 bg-gray-200 rounded w-1/3 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-2/3" />
            </div>
          ))}
        </div>
      )}

      {/* Metric chips */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4"><p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Cases Logged</p><p className="text-3xl font-bold text-gray-900 mt-1">{activeReplacements.length}</p></Card>
        <Card className="p-4"><p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Estimated Loss</p><p className="text-3xl font-bold text-gray-900 mt-1">${loss.toFixed(2)}</p></Card>
        <Card className="p-4"><p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Preventable</p><p className="text-3xl font-bold text-gray-900 mt-1">{prev}</p><p className="text-xs text-gray-400 mt-0.5">{activeReplacements.length > 0 ? Math.round((prev / activeReplacements.length) * 100) : 0}% of total</p></Card>
        <Card className="p-4"><p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Follow-Up Needed</p><p className="text-3xl font-bold text-slate-700 mt-1">{fu}</p></Card>
      </div>

      {/* Root cause breakdown */}
      {rc.length > 0 && (
        <Card className="p-4">
          <p className="text-sm font-bold text-gray-900 mb-3">Root Cause Breakdown</p>
          <div className="space-y-2">{rc.slice(0, 5).map(({ c, n }) => <div key={c} className="flex items-center gap-3"><span className="text-xs text-gray-500 w-44 truncate">{c}</span><div className="flex-1"><ProgressBar pct={activeReplacements.length ? (n / activeReplacements.length) * 100 : 0} color="bg-slate-500" /></div><span className="text-xs text-gray-400 w-6 text-right">{n}</span></div>)}</div>
        </Card>
      )}

      {/* New entry form */}
      {show && (
        <Card className="p-4">
          <p className="text-sm font-bold text-gray-900 mb-3">Log New Replacement Case</p>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div><FL>Date</FL><Inp type="date" value={form.date} onChange={f("date")} /></div>
            <div><FL>Brand *</FL><Sel value={form.brand} onChange={f("brand")} options={BRANDS} placeholder="Select..." /></div>
            <div><FL>Order # *</FL><Inp value={form.orderNum} onChange={f("orderNum")} placeholder="e.g. VR-10291" /></div>
            <div><FL>Customer Name</FL><Inp value={form.customerName} onChange={f("customerName")} placeholder="e.g. John Doe" /></div>
            <div><FL>Market Value ($)</FL><Inp type="number" value={form.marketValue} onChange={f("marketValue")} placeholder="0.00" /></div>
            <div><FL>Status</FL><Sel value={form.status} onChange={f("status")} options={REPLACEMENT_STATUS_OPTIONS} placeholder="" /></div>
            <div className="col-span-2"><FL>Replacement Reason</FL><Inp value={form.reason} onChange={f("reason")} placeholder="e.g. Missing item in sealed pack" /></div>
            <div><FL>Root Cause</FL><Sel value={form.rootCause} onChange={f("rootCause")} options={ROOT_CAUSES} placeholder="Select..." /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><FL>Preventable</FL><Sel value={form.preventable} onChange={f("preventable")} options={["Yes", "No"]} placeholder="" /></div>
              <div><FL>Follow-Up</FL><Sel value={form.followUp} onChange={f("followUp")} options={["Yes", "No"]} placeholder="" /></div>
            </div>
            <div className="col-span-2"><FL>Replacement Items</FL><Inp value={form.replacementItems} onChange={f("replacementItems")} placeholder="e.g. 1x Holo Pack, 1x Booster" /></div>
            <div className="col-span-2"><FL>Notes</FL><Txt value={form.notes} onChange={f("notes")} rows={2} /></div>
          </div>
          <BtnPrimary onClick={add} size="md">Log Replacement</BtnPrimary>
        </Card>
      )}

      {/* Filter control */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
          <span className="whitespace-nowrap">Filter:</span>
          <select
            value={activeFilter}
            onChange={e => setActiveFilter(e.target.value)}
            className="min-w-0 bg-transparent text-xs font-semibold text-slate-800 outline-none"
          >
            {REPLACEMENT_FILTERS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </label>
        <span className="text-[10px] text-gray-400">{displayRows.length} shown</span>
      </div>

      {/* Table */}
      <Card>
        <p className="text-sm font-bold text-gray-900 px-4 pt-4 pb-2">Replacement Cases</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-y border-gray-100">
                {["Date","Order #","Item","Reason for Error","Dept Fault","Market Value ($)","Channel/Platform","Notes","Evidence","Status","Actions"].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map(r => {
                const isEditing = editRow === r.id;
                const dante = getDanteReplacementFields(r);
                const isFocused = replacementFocus?.caseId && String(replacementFocus.caseId) === String(r.id);
                const isArchived = Boolean(r.archived_at);
                return (
                  <tr
                    key={r.id}
                    data-replacement-row-id={r.id}
                    className={`border-b border-gray-50 ${isFocused ? "bg-slate-100 ring-1 ring-inset ring-slate-300" : isEditing ? "bg-slate-50" : isArchived ? "bg-gray-50 text-gray-500" : "hover:bg-gray-50"}`}
                  >
                    {isEditing ? (
                      /* ── Inline edit row ── */
                      <>
                        <td className="px-3 py-2"><Inp type="date" value={editForm.date || ""} onChange={ef("date")} className="w-32" /></td>
                        <td className="px-3 py-2"><Inp value={editForm.orderNum || editForm.order_number || ""} onChange={ef("orderNum")} placeholder="Order #" className="w-24" /></td>
                        <td className="px-3 py-2"><Inp value={editForm.replacementItems || editForm.replacement_items || editForm.item || ""} onChange={ef("replacementItems")} placeholder="Item" className="w-40" /></td>
                        <td className="px-3 py-2"><Inp value={editForm.reason || ""} onChange={ef("reason")} placeholder="Reason" className="w-40" /></td>
                        <td className="px-3 py-2"><Inp value={editForm.dept_fault || editForm.department_fault || ""} onChange={ef("dept_fault")} placeholder="Dept" className="w-28" /></td>
                        <td className="px-3 py-2"><Inp type="number" value={editForm.marketValue ?? editForm.market_value ?? ""} onChange={ef("marketValue")} placeholder="0.00" className="w-20" /></td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{getDanteChannelPlatform(editForm) || dante.channelPlatform || "-"}</td>
                        <td className="px-3 py-2"><Inp value={editForm.notes || ""} onChange={ef("notes")} placeholder="Notes" className="w-44" /></td>
                        <td className="px-3 py-2"><Inp value={editForm.evidence || editForm.evidence_url || ""} onChange={ef("evidence")} placeholder="Evidence" className="w-36" /></td>
                        <td className="px-3 py-2">
                          <select value={editForm.status || "Open"} onChange={e => ef("status")(e.target.value)} className="bg-white border border-gray-300 rounded text-xs px-1.5 py-1 w-24">
                            {REPLACEMENT_STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <button disabled={savingId === r.id} onClick={handleSaveEdit}
                              className="text-[10px] font-semibold text-white bg-slate-700 hover:bg-slate-800 disabled:opacity-50 px-2 py-0.5 rounded cursor-pointer">
                              {savingId === r.id ? "..." : "Save"}
                            </button>
                            <button onClick={() => { setEditRow(null); setEditForm({}); }}
                              className="text-[10px] text-gray-500 hover:text-gray-800 cursor-pointer px-1">
                              Cancel
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      /* ── Read row ── */
                      <>
                        <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{dante.date || "-"}</td>
                        <td className="px-3 py-2.5 font-mono text-gray-800 whitespace-nowrap">{dante.order || "-"}</td>
                        <td className="px-3 py-2.5 text-gray-600 max-w-[160px] truncate">{dante.item || "-"}</td>
                        <td className="px-3 py-2.5 text-gray-600 max-w-[150px] truncate">{dante.reason || "-"}</td>
                        <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{dante.deptFault || "-"}</td>
                        <td className="px-3 py-2.5 text-gray-900 font-bold whitespace-nowrap">{dante.marketValue}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <BrandPip brand={r.brand} />
                            <span className="text-gray-700">{dante.channelPlatform || replacementBrandLabel(r.brand) || "-"}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-gray-500 max-w-[180px] truncate">{dante.notes || "-"}</td>
                        <td className="px-3 py-2.5 text-gray-400 max-w-[120px] truncate">{dante.evidence || "-"}</td>
                        <td className="px-3 py-2.5">
                          {isArchived
                            ? <Badge label="Archived" className="bg-gray-100 text-gray-600 border-gray-200" />
                            : r.status
                            ? <Badge label={r.status} className={r.status === "Reshipped" || r.status === "Resolved" ? "bg-gray-100 text-gray-600 border-gray-200" : r.status === "Open" ? "bg-slate-50 text-slate-700 border-slate-200" : "bg-gray-100 text-gray-500 border-gray-200"} />
                            : <span className="text-gray-300">-</span>
                          }
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {/* Edit */}
                            <button
                              title="Edit this row"
                              onClick={() => { setEditRow(r.id); setEditForm({ ...r }); }}
                              className="text-[10px] font-semibold text-gray-500 hover:text-slate-800 cursor-pointer leading-none"
                            >Edit</button>
                            {!isArchived && (
                              <button
                                title="Archive this row"
                                onClick={() => handleArchive(r)}
                                className="text-[10px] font-semibold text-gray-400 hover:text-red-600 cursor-pointer leading-none"
                              >Archive</button>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {displayRows.length === 0 && (
                <tr><td colSpan={11} className="text-center py-8 text-gray-300">
                  {activeFilter === "Archived" ? "No archived replacement cases" : activeFilter === "Active" ? "No active replacement cases logged" : activeFilter === "All" ? "No replacement cases logged" : `No cases match "${activeFilter}"`}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

// ─── STUDIO READINESS ─────────────────────────────────────────────────────────
const LegacyStudioReadinessView = ({ studios, setStudios }) => {
  const safeStudios = Array.isArray(studios) ? studios : [];
  const upd = (id, field, val) => setStudios(p => p.map(s => s.id === id ? { ...s, [field]: val } : s));
  const score = s => { let sc = 0; if (s.countCompleted) sc += 25; if (s.fullyStocked) sc += 25; if (s.discrepanciesLogged === 0 || s.discrepanciesResolved === s.discrepanciesLogged) sc += 25; if (s.streamReady) sc += 25; return sc; };
  const overall = safeStudios.length ? Math.round(safeStudios.reduce((a, s) => a + score(s), 0) / safeStudios.length) : 0;
  return (
    <div className="space-y-4">
      <div><h2 className="text-2xl font-bold text-gray-900">Inventory &amp; Studio Readiness</h2><p className="text-xs text-gray-400 mt-0.5">Track station counts, stock levels, and stream readiness · <span className="font-medium text-gray-500">{getWeekOfLabel()}</span></p></div>
      <Card className="p-4 flex items-center gap-6">
        <div className="text-center"><p className="text-xs text-gray-400 mb-1">Overall Readiness</p><p className="text-5xl font-bold text-gray-900">{overall}%</p></div>
        <div className="flex-1"><ProgressBar pct={overall} color="bg-slate-500" /><p className="text-xs text-gray-400 mt-1.5">{safeStudios.filter(s => s.streamReady).length}/{safeStudios.length} stations stream-ready</p></div>
      </Card>
      <div className="grid grid-cols-2 gap-4">
        {safeStudios.map(s => {
          const sc = score(s);
          const brandLabel = STUDIO_BRANDS[s.id];
          return (
            <Card key={s.id} className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-gray-900">{s.id}</h3>
                  {brandLabel && <span className="text-[10px] text-gray-400 font-medium border border-gray-200 rounded px-1.5 py-0.5">{brandLabel}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-900">{sc}%</span>
                  <Badge label={s.streamReady ? "Stream Ready" : "Not Ready"} className={s.streamReady ? "bg-slate-100 text-slate-700 border-slate-200" : "bg-gray-100 text-gray-500 border-gray-200"} />
                </div>
              </div>
              <ProgressBar pct={sc} color="bg-slate-500" />
              <div className="mt-3 space-y-2">
                {[["countCompleted", "Count Completed"], ["fullyStocked", "Fully Stocked"], ["streamReady", "Stream Ready"]].map(([field, label]) => (
                  <label key={field} className="flex items-center justify-between cursor-pointer">
                    <span className="text-xs text-gray-500">{label}</span>
                    <input type="checkbox" checked={s[field]} onChange={e => upd(s.id, field, e.target.checked)} className="accent-slate-700" />
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
const INVENTORY_CONTROL_SAMPLE_ROWS = [
  { id: "inv-vr-lorwyn-play", studio: "VR", zone: "Row 3C", internalName: "Lorwyn Play", shopifyTitle: "Lorwyn Eclipsed Play Booster Pack", sku: "VR-LORWYN-PLAY", countUnit: "Pack", conversion: "1 pack = 1 unit", shopifyQty: 42, physicalQty: "", notes: "" },
  { id: "inv-ps-chaos-etb", studio: "PS", zone: "PS3A", internalName: "Chaos Rising ETB", shopifyTitle: "Chaos Rising Elite Trainer Box", sku: "PS-CHAOS-ETB", countUnit: "Box", conversion: "1 box = 1 unit", shopifyQty: 18, physicalQty: "", notes: "" },
  { id: "inv-ck-lorwyn-pack", studio: "CK", zone: "Shelf 1", internalName: "Lorwyn Eclipsed Pack", shopifyTitle: "Lorwyn Eclipsed Collector Pack", sku: "CK-LORWYN-PACK", countUnit: "Pack", conversion: "1 pack = 1 unit", shopifyQty: 64, physicalQty: "", notes: "" },
  { id: "inv-pm-perfect-etb", studio: "PM", zone: "Holding", internalName: "Perfect Order ETB", shopifyTitle: "Perfect Order Elite Trainer Box", sku: "PM-PERFECT-ETB", countUnit: "Box", conversion: "1 box = 1 unit", shopifyQty: 22, physicalQty: "", notes: "" },
];
const createInventoryControlState = () => ({ inventoryControlVersion: 1, sessionActive: false, sessionStartedAt: "", lastShopifySnapshotAt: "", snapshotImportedCount: 0, snapshotSourceName: "", snapshotText: "", studioFilter: "All", statusFilter: "All", varianceOnly: false, search: "", rows: INVENTORY_CONTROL_SAMPLE_ROWS, history: [] });
const normalizeInventoryStudioCode = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  if (raw.includes("VAULTED") || raw === "VR") return "VR";
  if (raw.includes("POKESPINS") || raw === "PS") return "PS";
  if (raw.includes("CARDKING") || raw === "CK" || raw === "CK47") return "CK";
  if (raw.includes("POKIEMART") || raw.includes("POKIE") || raw === "PM") return "PM";
  return raw || "VR";
};
const normalizeInventoryControlState = (value) => value && !Array.isArray(value) && value.inventoryControlVersion
  ? { ...createInventoryControlState(), ...value, rows: Array.isArray(value.rows) ? value.rows : INVENTORY_CONTROL_SAMPLE_ROWS, history: Array.isArray(value.history) ? value.history : [] }
  : createInventoryControlState();
const parseInventoryDelimitedLine = (line, delimiter) => {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
};
const parseInventorySnapshotRows = (rawText) => {
  const lines = String(rawText || "").split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = parseInventoryDelimitedLine(lines[0], delimiter).map(header => header.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  const findHeader = (...names) => names.map(name => headers.indexOf(name)).find(index => index >= 0);
  const titleIndex = findHeader("title", "producttitle", "product", "name");
  const skuIndex = findHeader("sku", "variantsku");
  const qtyIndex = findHeader("quantity", "available", "onhand", "inventoryquantity", "variantinventoryqty");
  const variantIndex = findHeader("variant", "varianttitle", "option1value");
  const locationIndex = findHeader("location", "inventorylocation");
  const vendorIndex = findHeader("vendor", "producttype", "type");
  const statusIndex = findHeader("status", "productstatus", "publishedstatus");
  return lines.slice(1).map((line, index) => {
    const cells = parseInventoryDelimitedLine(line, delimiter);
    const status = String(cells[statusIndex] || "").trim().toLowerCase();
    if (statusIndex >= 0 && status && status !== "active") return null;
    const title = cells[titleIndex] || cells[0] || "";
    const variant = cells[variantIndex] || "";
    const vendor = cells[vendorIndex] || "";
    return { id: `shopify-${Date.now()}-${index}`, importedAt: nowISO(), sourceStatus: status || "active", studio: normalizeInventoryStudioCode(vendor || cells[locationIndex] || title), zone: cells[locationIndex] || "Unmapped", internalName: variant || title, shopifyTitle: title, variantTitle: variant, sku: cells[skuIndex] || "", vendor, productType: cells[vendorIndex] || "", countUnit: "Unit", conversion: "1 Shopify unit = 1 physical unit", shopifyQty: Number(cells[qtyIndex] || 0) || 0, physicalQty: "", notes: "" };
  }).filter(row => row && (row.shopifyTitle || row.sku));
};
const getInventoryVariance = (row) => row.physicalQty === "" || row.physicalQty == null ? null : (Number(row.physicalQty) || 0) - (Number(row.shopifyQty) || 0);
const getInventoryRiskLabel = (row) => {
  const variance = getInventoryVariance(row);
  if (!row.shopifyTitle) return "Mapping Issue";
  if (row.recountNeeded) return "Recount Needed";
  if (variance == null) return "Not Counted";
  if ((Number(row.physicalQty) || 0) === 0 && (Number(row.shopifyQty) || 0) > 0) return "Oversell Risk";
  if ((Number(row.physicalQty) || 0) > 0 && (Number(row.shopifyQty) || 0) === 0) return "Missed Sales Risk";
  if (Math.abs(variance) >= 10) return "Recount Needed";
  return variance === 0 ? "Matched" : "Variance";
};
const getInventoryStatus = (row) => {
  const variance = getInventoryVariance(row);
  if (row.updatedAt) return "Updated";
  if (!row.shopifyTitle) return "Mapping Issue";
  if (row.recountNeeded) return "Recount Needed";
  if (variance == null) return "Not Counted";
  if (variance === 0) return "Matched";
  return "Ready to Update";
};
const isInventoryReadyToUpdate = (row) => {
  const variance = getInventoryVariance(row);
  return variance != null && variance !== 0 && getInventoryStatus(row) === "Ready to Update";
};
const StudioReadinessView = ({ studios, setStudios }) => {
  const inventory = normalizeInventoryControlState(studios);
  const rows = Array.isArray(inventory.rows) ? inventory.rows : [];
  const filteredRows = rows.filter(row => {
    const studioMatches = inventory.studioFilter === "All" || row.studio === inventory.studioFilter;
    const status = getInventoryStatus(row);
    const risk = getInventoryRiskLabel(row);
    const statusMatches = inventory.statusFilter === "All" || status === inventory.statusFilter || risk === inventory.statusFilter || (inventory.statusFilter === "Variance" && getInventoryVariance(row) !== 0 && getInventoryVariance(row) != null);
    const varianceMatches = !inventory.varianceOnly || (getInventoryVariance(row) !== 0 && getInventoryVariance(row) != null);
    const search = String(inventory.search || "").trim().toLowerCase();
    const haystack = [row.internalName, row.shopifyTitle, row.sku, row.zone, row.location, row.vendor, row.productType].join(" ").toLowerCase();
    const searchMatches = !search || haystack.includes(search);
    return studioMatches && statusMatches && varianceMatches && searchMatches;
  });
  const varianceRows = rows.filter(row => { const variance = getInventoryVariance(row); return variance != null && variance !== 0; });
  const updateQueue = rows.filter(isInventoryReadyToUpdate);
  const countedRows = rows.filter(row => getInventoryVariance(row) != null);
  const updateInventory = (patch) => setStudios(prev => ({ ...normalizeInventoryControlState(prev), ...patch }));
  const updateRow = (id, patch) => updateInventory({ rows: rows.map(row => row.id === id ? { ...row, ...patch } : row) });
  const importSnapshot = () => {
    const parsedRows = parseInventorySnapshotRows(inventory.snapshotText);
    if (!parsedRows.length) return updateInventory({ lastImportMessage: "Snapshot not imported yet. Paste Shopify export rows first." });
    updateInventory({ rows: parsedRows, lastShopifySnapshotAt: nowISO(), snapshotImportedCount: parsedRows.length, snapshotSourceName: inventory.snapshotSourceName || "Manual Shopify export", lastImportMessage: `Imported ${parsedRows.length} active Shopify row${parsedRows.length === 1 ? "" : "s"}.` });
  };
  const clearSnapshot = () => updateInventory({ lastShopifySnapshotAt: "", snapshotImportedCount: 0, snapshotSourceName: "", snapshotText: "", rows: INVENTORY_CONTROL_SAMPLE_ROWS, lastImportMessage: "Snapshot cleared." });
  const handleSnapshotFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    updateInventory({ snapshotText: text, snapshotSourceName: file.name, lastImportMessage: `Loaded ${file.name}. Click Import Current Active Products to freeze it.` });
  };
  const saveCount = () => {
    const entry = { id: uid(), at: nowISO(), totalCounted: countedRows.length, variances: varianceRows.length, updatedRows: rows.filter(row => row.updatedAt).length, notes: "Manual count checkpoint saved." };
    updateInventory({ history: [entry, ...(inventory.history || [])].slice(0, 8), lastImportMessage: "Count saved." });
  };
  const resetSession = () => {
    showOpsConfirm({
      title: "Clear this data?",
      body: "This will reset the current Inventory Control count session and clear the active count workspace.",
      confirmLabel: "Clear",
      variant: "clear",
      onConfirm: () => {
        updateInventory(createInventoryControlState());
        showOpsToast("Inventory count session reset.");
      },
    });
  };
  const exportUpdateTxt = async () => {
    const body = [
      "Shopify Title\tSKU\tCurrent Shopify Qty\tNew Physical Qty\tVariance\tNotes",
      ...updateQueue.map(row => [row.shopifyTitle, row.sku || "", row.shopifyQty, row.physicalQty, getInventoryVariance(row), row.notes || ""].join("\t")),
    ].join("\n");
    try { await navigator.clipboard.writeText(body); } catch {}
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-update-queue-${todayDate()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    updateInventory({ lastImportMessage: `Exported ${updateQueue.length} update row${updateQueue.length === 1 ? "" : "s"}.` });
  };
  const markSelectedUpdated = () => updateInventory({ rows: rows.map(row => row.selectedForUpdate && isInventoryReadyToUpdate(row) ? { ...row, updatedAt: nowISO(), selectedForUpdate: false } : row) });
  const readiness = ["VR", "PS", "CK", "PM"].map(studio => {
    const brandRows = rows.filter(row => row.studio === studio);
    return { studio, ready: brandRows.length > 0 && brandRows.every(row => getInventoryVariance(row) != null) };
  });
  const metricCards = [["SKUs imported", inventory.snapshotImportedCount || rows.length], ["Counted rows", countedRows.length], ["Variances found", varianceRows.length], ["Ready to update", updateQueue.length], ["Updated rows", rows.filter(row => row.updatedAt).length], ["Snapshot imported at", inventory.lastShopifySnapshotAt ? fmtDate(inventory.lastShopifySnapshotAt) : "Not imported"]];
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div><h2 className="text-2xl font-bold text-gray-900">Inventory Control</h2><p className="text-xs text-gray-400 mt-0.5">Count physical stock, compare to Shopify, and build the update queue.</p></div>
        <div className="flex flex-wrap gap-2"><BtnPrimary onClick={() => updateInventory({ sessionActive: true, sessionStartedAt: nowISO(), lastImportMessage: "Physical Count started." })} size="md">Start Physical Count</BtnPrimary><button onClick={saveCount} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">Save Count</button><button onClick={resetSession} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50">Reset Session</button></div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">{metricCards.map(([label, value]) => <Card key={label} className="p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</p><p className="mt-1 text-xl font-bold text-gray-900">{value}</p></Card>)}</div>
      <Card className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-bold text-gray-900">Studio Readiness</p><p className="text-xs text-gray-400">Quick count coverage by active inventory lane.</p></div><div className="flex flex-wrap gap-2">{readiness.map(item => <span key={item.studio} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${item.ready ? "border-slate-200 bg-slate-50 text-slate-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{item.studio} {item.ready ? "ready" : "open"}</span>)}</div></div></Card>
      <Card className="p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0 flex-1"><p className="text-sm font-bold text-gray-900">Import Current Active Products</p><p className="text-xs text-gray-400 mt-0.5">Paste or upload the current Shopify product export to freeze active quantities for this count.</p><div className="mt-3 grid gap-2 sm:grid-cols-[220px_1fr]"><Inp value={inventory.snapshotSourceName || ""} onChange={value => updateInventory({ snapshotSourceName: value })} placeholder="Source name, e.g. Shopify export" /><input type="file" accept=".csv,.txt,.tsv" onChange={handleSnapshotFile} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-700" /></div><Txt value={inventory.snapshotText || ""} onChange={value => updateInventory({ snapshotText: value })} rows={5} className="mt-3 font-mono text-xs" placeholder="Paste Shopify export here" /></div><div className="flex shrink-0 flex-col gap-2 lg:w-56"><BtnPrimary onClick={importSnapshot} size="md">Import Current Active Products</BtnPrimary><button onClick={clearSnapshot} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">Clear Snapshot</button><div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">{inventory.lastImportMessage || (inventory.lastShopifySnapshotAt ? `${inventory.snapshotSourceName || "Snapshot"} imported ${fmtDate(inventory.lastShopifySnapshotAt)}` : "Snapshot not imported yet")}</div></div></div></Card>
      <Card className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-bold text-gray-900">Room Map / Count List</p><p className="text-xs text-gray-400 mt-0.5">Enter physical quantities. Variance calculates automatically.</p></div><div className="flex flex-wrap gap-2"><Sel value={inventory.studioFilter || "All"} onChange={value => updateInventory({ studioFilter: value })} options={["All", "VR", "PS", "CK", "PM"]} placeholder="" /><Sel value={inventory.statusFilter || "All"} onChange={value => updateInventory({ statusFilter: value })} options={["All", "Not Counted", "Matched", "Variance", "Oversell Risk", "Missed Sales Risk", "Recount Needed", "Ready to Update", "Updated"]} placeholder="" /><label className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700"><input type="checkbox" checked={Boolean(inventory.varianceOnly)} onChange={e => updateInventory({ varianceOnly: e.target.checked })} className="accent-slate-700" />Variance only</label><Inp value={inventory.search || ""} onChange={value => updateInventory({ search: value })} className="w-56" placeholder="Search product, SKU, location" /></div></div><div className="mt-3 overflow-x-auto"><table className="min-w-[1280px] w-full text-left text-xs"><thead className="border-y border-gray-100 bg-gray-50 text-gray-500"><tr>{["Studio / Brand", "Zone / Location", "Internal Name", "Shopify Title", "SKU", "Shopify Qty", "Physical Qty", "Variance", "Status", "Notes", "Recount"].map(label => <th key={label} className="px-3 py-2 font-bold">{label}</th>)}</tr></thead><tbody className="divide-y divide-gray-50">{filteredRows.map(row => { const variance = getInventoryVariance(row); const status = getInventoryStatus(row); const risk = getInventoryRiskLabel(row); const displayStatus = ["Oversell Risk", "Missed Sales Risk"].includes(risk) ? risk : status; return <tr key={row.id} className="hover:bg-gray-50"><td className="px-3 py-2 font-bold text-gray-700">{row.studio}</td><td className="px-3 py-2 text-gray-600">{row.zone}</td><td className="px-3 py-2 text-gray-800">{row.internalName}</td><td className="px-3 py-2 text-gray-600">{row.shopifyTitle || <span className="text-amber-700">Missing title</span>}</td><td className="px-3 py-2 font-mono text-gray-500">{row.sku || "-"}</td><td className="px-3 py-2 font-mono text-gray-700">{row.shopifyQty}</td><td className="px-3 py-2"><Inp type="number" value={row.physicalQty} onChange={value => updateRow(row.id, { physicalQty: value })} className="w-24" /></td><td className={`px-3 py-2 font-bold ${variance == null ? "text-gray-300" : variance === 0 ? "text-gray-500" : variance < 0 ? "text-red-700" : "text-emerald-700"}`}>{variance == null ? "-" : variance}</td><td className="px-3 py-2"><Badge label={displayStatus} className={displayStatus === "Ready to Update" ? "border-slate-200 bg-slate-50 text-slate-700" : displayStatus === "Recount Needed" || displayStatus === "Mapping Issue" || displayStatus === "Oversell Risk" || displayStatus === "Missed Sales Risk" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-gray-200 bg-gray-50 text-gray-500"} /></td><td className="px-3 py-2"><Inp value={row.notes || ""} onChange={value => updateRow(row.id, { notes: value })} className="w-44" placeholder="Count notes" /></td><td className="px-3 py-2"><input type="checkbox" checked={Boolean(row.recountNeeded)} onChange={e => updateRow(row.id, { recountNeeded: e.target.checked })} className="accent-slate-700" /></td></tr>; })}</tbody></table></div></Card>
      <div className="grid gap-4 xl:grid-cols-2"><Card className="p-4"><p className="text-sm font-bold text-gray-900">Variance Review</p><div className="mt-3 space-y-2">{varianceRows.length ? varianceRows.map(row => <div key={row.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2"><div className="flex items-center justify-between gap-3"><p className="text-xs font-bold text-gray-900">{row.internalName}</p><Badge label={getInventoryRiskLabel(row)} className="border-amber-200 bg-amber-50 text-amber-800" /></div><p className="mt-1 text-[11px] text-gray-500">{row.studio} / {row.zone} - Shopify {row.shopifyQty}, physical {row.physicalQty}, variance {getInventoryVariance(row)}</p></div>) : <p className="text-xs text-gray-400">No mismatches yet.</p>}</div></Card><Card className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-bold text-gray-900">Update Shopify Queue</p><p className="text-xs text-gray-400">Export-only for now. No Shopify writes happen here.</p></div><div className="flex gap-2"><button onClick={exportUpdateTxt} disabled={!updateQueue.length} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">Export Shopify Update TXT</button><BtnPrimary onClick={markSelectedUpdated} size="md">Mark Selected Updated</BtnPrimary></div></div><div className="mt-3 space-y-2">{updateQueue.length ? updateQueue.map(row => <div key={row.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2"><div className="flex items-center justify-between gap-3"><label className="flex min-w-0 items-center gap-2"><input type="checkbox" checked={Boolean(row.selectedForUpdate)} onChange={e => updateRow(row.id, { selectedForUpdate: e.target.checked })} className="accent-slate-700" /><span className="truncate text-xs font-bold text-gray-900">{row.shopifyTitle}</span></label><button onClick={() => updateRow(row.id, { updatedAt: nowISO(), selectedForUpdate: false })} className="shrink-0 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">Mark Updated</button></div><p className="mt-1 text-[11px] text-gray-500">SKU {row.sku || "-"} - Old {row.shopifyQty} - New {row.physicalQty} - Variance {getInventoryVariance(row)}{row.notes ? ` - ${row.notes}` : ""}</p></div>) : <p className="text-xs text-gray-400">No rows ready to update.</p>}</div></Card></div>
      <Card className="p-4"><p className="text-sm font-bold text-gray-900">Variance History</p><div className="mt-3 space-y-2">{(inventory.history || []).length ? inventory.history.map(entry => <div key={entry.id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600"><span className="font-bold text-gray-900">{fmtDate(entry.at)}</span> - counted {entry.totalCounted}, variances {entry.variances}, updated {entry.updatedRows}. {entry.notes}</div>) : <p className="text-xs text-gray-400">No saved count sessions yet.</p>}</div></Card>
    </div>
  );
};

const LegacySurpriseSetView = ({ surpriseSets, setSurpriseSets }) => {
  const defaultConverterForm = {
    brand: "Vaulted Rarities",
    warehouse: "US Warehouse",
    day: "Monday",
    shift: "am",
    streamer: "",
    streamDate: todayDate(),
    setNumber: "1",
    surpriseSetName: "",
    startingBid: "",
    fileName: "",
    input: "",
  };
  const [converterForm, setConverterForm] = useState(defaultConverterForm);
  const [converterRows, setConverterRows] = useState([]);
  const [converterError, setConverterError] = useState("");
  const [converterConverted, setConverterConverted] = useState(false);
  const [convertedEntries, setConvertedEntries] = useState(() => loadSetSheetConverterEntries());
  const [setupCopyStatus, setSetupCopyStatus] = useState("");
  const [uploadedBatchIds, setUploadedBatchIds] = useState({});
  const [smartPasteText, setSmartPasteText] = useState("");
  const [smartPasteResult, setSmartPasteResult] = useState(null);

  useEffect(() => {
    setSurpriseSets(prev => normalizeWeeklySurpriseSets(prev));
  }, [setSurpriseSets]);

  useEffect(() => {
    try { localStorage.setItem(SETSHEET_CONVERTER_STORAGE_KEY, JSON.stringify(convertedEntries.slice(0, 20))); } catch {}
  }, [convertedEntries]);

  const weeklyBlocks = normalizeWeeklySurpriseSets(surpriseSets);
  const safeSurpriseSets = Array.isArray(weeklyBlocks) ? weeklyBlocks : [];
  const trackerBlocks = safeSurpriseSets.filter(block => normalizeSurpriseSetBrandValue(block.brand));
  const totalBlocks = trackerBlocks.length;
  const liveReady = trackerBlocks.filter(s => s.status === "Live Ready" || s.readyForLive).length;
  const notDone = Math.max(0, totalBlocks - liveReady);
  const summary = getSetSheetSummary(converterRows);
  const activeConvertedEntry = converterConverted
    ? (Array.isArray(convertedEntries) ? convertedEntries : []).find(entry => entry.fileName === converterForm.fileName) || (Array.isArray(convertedEntries) ? convertedEntries[0] : null)
    : null;
  const activeUploaded = Boolean(activeConvertedEntry && (uploadedBatchIds[activeConvertedEntry.id] || activeConvertedEntry.uploadedAt));
  const selectedTemplateConfig = getSetSheetTemplateConfig(converterForm.brand);

  const updateConverterField = (field, value) => {
    setConverterForm(prev => ({ ...prev, [field]: value }));
  };

  const copySetupValue = async (value, successMessage) => {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      setSetupCopyStatus(successMessage);
      setTimeout(() => setSetupCopyStatus(""), 2200);
    } catch {
      setSetupCopyStatus("Copy failed. Try again.");
      setTimeout(() => setSetupCopyStatus(""), 2600);
    }
  };

  const copyExportAudit = async (entry) => {
    try {
      await navigator.clipboard.writeText(buildSetSheetExportAuditText(entry));
      setSetupCopyStatus("Copied export audit.");
      setTimeout(() => setSetupCopyStatus(""), 2200);
    } catch {
      setSetupCopyStatus("Export audit copy failed.");
      setTimeout(() => setSetupCopyStatus(""), 2600);
    }
  };

  const handleAnalyzeSmartPaste = () => {
    const result = parseWarehouseSheetPaste(smartPasteText, converterForm);
    setSmartPasteResult(result);
    setConverterError("");
    setConverterConverted(false);
    setConverterForm(prev => {
      const next = { ...prev };
      if (result.detectedBrand) next.brand = result.detectedBrand;
      if (result.streamer) next.streamer = result.streamer;
      if (result.streamDate) next.streamDate = result.streamDate;
      if (result.day) next.day = result.day;
      if (result.shift) next.shift = result.shift;
      if (result.setNumber) next.setNumber = result.setNumber;
      if (result.surpriseSetName) next.surpriseSetName = result.surpriseSetName;
      if (result.startingBid) next.startingBid = result.startingBid;
      if (Array.isArray(result.productLines) && result.productLines.length) next.input = result.productLines.join("\n");
      if (!next.fileName) next.fileName = buildSurpriseSetFileName(next);
      return next;
    });
    setConverterRows([]);
  };

  const getTrackerBlock = (day, streamKey, brand) =>
    trackerBlocks.find(block => block.day === day && block.streamKey === streamKey && normalizeSurpriseSetBrandValue(block.brand) === normalizeSurpriseSetBrandValue(brand));

  const patchTrackerBlock = (brand, day, streamKey, patch) => {
    setSurpriseSets(prev => normalizeWeeklySurpriseSets(prev).map(block => {
      const matches = block.day === day && block.streamKey === streamKey && normalizeSurpriseSetBrandValue(block.brand) === normalizeSurpriseSetBrandValue(brand);
      if (!matches) return block;
      const next = { ...block, ...patch };
      const done = Boolean(next.readyForLive);
      return { ...next, status: done ? "Live Ready" : "Not Started" };
    }));
  };

  const toggleTrackerDone = (brand, day, streamKey, done) => {
    patchTrackerBlock(brand, day, streamKey, { readyForLive: done });
  };

  const handleMarkUploaded = (entry = activeConvertedEntry) => {
    if (!entry) return;
    setUploadedBatchIds(prev => ({ ...prev, [entry.id]: true }));
    setConvertedEntries(prev => (Array.isArray(prev) ? prev : []).map(item => item.id === entry.id ? { ...item, uploadedAt: nowISO() } : item));
    patchTrackerBlock(entry.brand, entry.day, entry.shift, {
      readyForLive: true,
      setName: entry.surpriseSetName || entry.fileName,
      quantity: entry.summary?.totalQuantity || 0,
    });
  };

  const handleConvert = () => {
    setConverterError("");
    setConverterConverted(false);
    const rows = parseSetSheetInput(converterForm.input);
    if (!rows.length) {
      setConverterRows([]);
      setConverterError("Paste some surprise set lines first.");
      return;
    }
    const sourceProductUnits = buildSourceProductUnitsFromLines(String(converterForm.input || "").split(/\r?\n/), {
      channel: converterForm.brandCode || getSurpriseSetBrandCode(converterForm.brand),
    });
    const nextSummary = { ...getSetSheetSummary(rows), totalQuantity: sourceProductUnits.length ? getSourceProductUnitCount(sourceProductUnits) : getSetSheetSummary(rows).totalQuantity };
    const safeFileName = converterForm.fileName || buildSurpriseSetFileName(converterForm);
    const entry = {
      id: uid(),
      createdAt: nowISO(),
      ...converterForm,
      fileName: safeFileName,
      templatePath: getSetSheetTemplateConfig(converterForm.brand).path,
      usesWarehouse: getSetSheetTemplateConfig(converterForm.brand).usesWarehouse,
      rows,
      summary: nextSummary,
      sourceProductUnits,
    };
    setConverterForm(prev => ({ ...prev, fileName: safeFileName }));
    setConverterRows(rows);
    setConverterConverted(true);
    setConvertedEntries(prev => [entry, ...(Array.isArray(prev) ? prev : [])].slice(0, 20));
    patchTrackerBlock(converterForm.brand, converterForm.day, converterForm.shift, {
      convertedSetSheet: true,
      setName: converterForm.surpriseSetName || safeFileName,
      quantity: nextSummary.totalQuantity,
    });
  };

  const handleDownload = async (entry = null) => {
    const rows = entry?.rows || converterRows;
    const fileName = entry?.fileName || converterForm.fileName || "setsheet_export";
    if (!Array.isArray(rows) || rows.length === 0) {
      setConverterError("Convert a surprise set before downloading.");
      return { ok: false };
    }
    const downloadResult = await downloadSetSheetRows(rows, fileName, {
      brand: entry?.brand || converterForm.brand,
      warehouse: entry?.warehouse || converterForm.warehouse,
      previewProductCount: entry?.summary?.totalQuantity || getSetSheetSummary(rows).totalQuantity,
      sourceProductUnits: entry?.sourceProductUnits,
    });
    if (!downloadResult.ok) {
      setConverterError(downloadResult.error);
      return downloadResult;
    }
    const brand = entry?.brand || converterForm.brand;
    const day = entry?.day || converterForm.day;
    const shift = entry?.shift || converterForm.shift;
    patchTrackerBlock(brand, day, shift, { downloadedSetSheet: true });
    if (entry?.id) {
      setConvertedEntries(prev => (Array.isArray(prev) ? prev : []).map(item => item.id === entry.id ? { ...item, downloadedAt: nowISO(), exportDebug: downloadResult.exportDebug } : item));
    }
    return downloadResult;
  };

  const handleDownloadAll = async () => {
    const safeEntries = Array.isArray(convertedEntries) ? convertedEntries : [];
    if (!safeEntries.length) {
      setConverterError("Convert at least one surprise set first.");
      return;
    }
    for (const entry of safeEntries) {
      const result = await handleDownload(entry);
      if (!result?.ok) break;
    }
  };

  const handleResetConverter = () => {
    setConverterForm(defaultConverterForm);
    setConverterRows([]);
    setConverterError("");
    setConverterConverted(false);
    setSetupCopyStatus("");
    setSmartPasteText("");
    setSmartPasteResult(null);
  };

  const handleAddAnother = () => {
    setConverterForm(prev => {
      const currentNumber = Number.parseInt(prev.setNumber, 10);
      const nextNumber = Number.isFinite(currentNumber) ? currentNumber + 1 : (Array.isArray(convertedEntries) ? convertedEntries.length + 2 : 2);
      return {
        ...prev,
        setNumber: String(nextNumber),
        surpriseSetName: "",
        startingBid: "",
        fileName: "",
        input: "",
      };
    });
    setConverterRows([]);
    setConverterError("");
    setConverterConverted(false);
    setSetupCopyStatus("");
    setSmartPasteResult(null);
  };

  const runClearWeek = () => {
    const fresh = createDefaultWeeklySurpriseSets();
    try { localStorage.removeItem(SURPRISE_SET_STORAGE_KEY); } catch {}
    setSurpriseSets(fresh);
    showOpsToast("Surprise set week cleared.");
  };

  const clearWeek = () => {
    showOpsConfirm({
      title: "Clear this data?",
      body: "This will clear this week's surprise set setup and reload the default weekly blocks.",
      confirmLabel: "Clear",
      variant: "clear",
      onConfirm: runClearWeek,
    });
  };

  const dayShort = { Monday: "M", Tuesday: "T", Wednesday: "W", Thursday: "T", Friday: "F" };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Surprise Sets</h2>
          <p className="text-xs text-gray-400 mt-0.5">{getWeekOfLabel()} - SetSheet converter and weekly readiness tracker</p>
        </div>
        <button
          onClick={clearWeek}
          className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50"
        >
          Clear Week
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "Total stream blocks", value: totalBlocks, cls: "border-l-slate-300" },
          { label: "Done", value: liveReady, cls: "border-l-slate-300" },
          { label: "Not Done", value: notDone, cls: "border-l-slate-300" },
        ].map(item => (
          <Card key={item.label} className={`p-3 border-l-4 ${item.cls}`}>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{item.label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{item.value}</p>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_420px]">
        <Card className="p-4">
          <div className="border-b border-gray-100 pb-3">
            <p className="text-sm font-bold text-gray-900">SetSheet Converter</p>
            <p className="mt-0.5 text-xs text-gray-400">Paste a surprise set, convert it, then download the file.</p>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <FL>Account / Brand</FL>
              <Sel value={converterForm.brand} onChange={value => updateConverterField("brand", value)} options={SURPRISE_SET_ACCOUNT_OPTIONS} placeholder="" />
            </label>
            <label className="space-y-1">
              <FL>Warehouse</FL>
              {selectedTemplateConfig.usesWarehouse ? (
                <Sel value={converterForm.warehouse} onChange={value => updateConverterField("warehouse", value)} options={SETSHEET_WAREHOUSES} placeholder="" />
              ) : (
                <input
                  disabled
                  value="No warehouse column"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-400"
                  readOnly
                />
              )}
            </label>
            <label className="space-y-1">
              <FL>Day</FL>
              <Sel value={converterForm.day} onChange={value => updateConverterField("day", value)} options={SURPRISE_SET_DAYS} placeholder="" />
            </label>
            <label className="space-y-1">
              <FL>Shift</FL>
              <select
                value={converterForm.shift}
                onChange={event => updateConverterField("shift", event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-slate-500 focus:outline-none"
              >
                <option value="am">AM</option>
                <option value="pm">PM</option>
              </select>
            </label>
            <label className="space-y-1">
              <FL>Streamer</FL>
              <Inp value={converterForm.streamer} onChange={value => updateConverterField("streamer", value)} placeholder="Jimmy, Baxter, Zman" />
            </label>
            <label className="space-y-1">
              <FL>Stream Date</FL>
              <Inp type="date" value={converterForm.streamDate} onChange={value => updateConverterField("streamDate", value)} />
            </label>
            <label className="space-y-1">
              <FL>Set Number</FL>
              <Inp type="number" min="1" value={converterForm.setNumber} onChange={value => updateConverterField("setNumber", value)} placeholder="1" />
            </label>
            <label className="space-y-1">
              <FL>Starting Bid</FL>
              <Inp type="number" min="0" step="0.01" value={converterForm.startingBid} onChange={value => updateConverterField("startingBid", value)} placeholder="1" />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <FL>Surprise Set Name</FL>
              <Inp value={converterForm.surpriseSetName} onChange={value => updateConverterField("surpriseSetName", value)} placeholder="Name to paste into TikTok" />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <FL>File name</FL>
              <Inp value={converterForm.fileName} onChange={value => updateConverterField("fileName", value)} placeholder={buildSurpriseSetFileName(converterForm)} />
            </label>
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:col-span-2">
              <div>
                <p className="text-xs font-bold text-gray-900">Smart Paste from Warehouse Sheet</p>
                <p className="mt-0.5 text-[11px] text-gray-400">Paste the copied Google Sheet block once, then analyze it to fill the builder.</p>
              </div>
              <Txt
                value={smartPasteText}
                onChange={setSmartPasteText}
                placeholder="Paste warehouse sheet block here..."
                rows={5}
                className="font-mono text-xs"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleAnalyzeSmartPaste}
                  disabled={!smartPasteText.trim()}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-800 bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Analyze Sheet Paste
                </button>
                {smartPasteResult && (
                  <span className="text-[11px] font-medium text-gray-500">
                    Detected {[
                      smartPasteResult.streamer,
                      smartPasteResult.streamDate ? smartPasteResult.streamDate.slice(5).replace("-", "/") : "",
                      smartPasteResult.surpriseSetName,
                      smartPasteResult.target ? `target $${smartPasteResult.target}` : smartPasteResult.hardFloor ? `hard floor $${smartPasteResult.hardFloor}` : "",
                      `${smartPasteResult.productLines.length} product lines`,
                    ].filter(Boolean).join(", ")}.
                  </span>
                )}
              </div>
              {smartPasteResult?.warnings?.length > 0 && (
                <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
                  {smartPasteResult.warnings.map(warning => <p key={warning}>{warning}</p>)}
                </div>
              )}
              {smartPasteResult?.confidenceNotes?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {smartPasteResult.confidenceNotes.map(note => (
                    <span key={note} className="rounded-full border border-gray-200 bg-white px-2 py-1 text-[10px] font-medium text-gray-500">{note}</span>
                  ))}
                </div>
              )}
            </div>
            <label className="space-y-1 sm:col-span-2">
              <FL>Insert surprise set</FL>
              <Txt value={converterForm.input} onChange={value => updateConverterField("input", value)} placeholder="Paste lines here..." rows={13} className="font-mono text-xs" />
            </label>
          </div>
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
            Template: {selectedTemplateConfig.label}
            <span className="text-gray-300"> - </span>
            {selectedTemplateConfig.usesWarehouse ? "Warehouse column enabled" : "No warehouse column"}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <BtnPrimary onClick={handleConvert}>Convert</BtnPrimary>
            <button
              onClick={() => handleDownload()}
              disabled={!converterRows.length}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Download file
            </button>
            <BtnSecondary onClick={handleResetConverter}>Reset</BtnSecondary>
            <BtnSecondary onClick={handleAddAnother}>Add another surprise set</BtnSecondary>
            <button
              onClick={handleDownloadAll}
              disabled={!convertedEntries.length}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Download all converted files
            </button>
          </div>
          {converterError && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{converterError}</div>
          )}
          {converterConverted && (
            <div className="mt-4 space-y-3">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-gray-900">Completed Setup Summary</p>
                    <p className="mt-0.5 text-[11px] text-gray-400">Use these details while creating the TikTok surprise set.</p>
                  </div>
                  {activeConvertedEntry && (
                    <button
                      onClick={() => handleMarkUploaded(activeConvertedEntry)}
                      disabled={activeUploaded}
                      className="inline-flex items-center justify-center rounded-lg border border-slate-800 bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-default disabled:opacity-80"
                    >
                      {activeUploaded ? "Uploaded to TikTok" : "Mark Uploaded"}
                    </button>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs lg:grid-cols-4">
                  {[
                    ["Account / Brand", activeConvertedEntry?.brand || converterForm.brand],
                    ["Streamer", activeConvertedEntry?.streamer || converterForm.streamer || "-"],
                    ["Stream Date", activeConvertedEntry?.streamDate || converterForm.streamDate || "-"],
                    ["Set Number", activeConvertedEntry?.setNumber || converterForm.setNumber || "-"],
                    ["Surprise Set Name", activeConvertedEntry?.surpriseSetName || converterForm.surpriseSetName || "-"],
                    ["Starting Bid", activeConvertedEntry?.startingBid || converterForm.startingBid || "-"],
                    ["File Name", activeConvertedEntry?.fileName || converterForm.fileName],
                    ["Uploaded Status", activeUploaded ? "Uploaded to TikTok" : "Not uploaded yet"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
                      <p className="mt-1 truncate font-semibold text-gray-800">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div><p className="text-lg font-bold text-gray-900">{summary.totalRows}</p><p className="text-[10px] text-gray-400">unique products found</p></div>
                  <div><p className="text-lg font-bold text-gray-900">{summary.totalQuantity}</p><p className="text-[10px] text-gray-400">total items counted</p></div>
                  <div><p className="text-lg font-bold text-gray-900">{summary.unknownCount}</p><p className="text-[10px] text-gray-400">unknown items</p></div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => copySetupValue(activeConvertedEntry?.surpriseSetName || converterForm.surpriseSetName, "Copied name.")}
                    className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    Copy Name
                  </button>
                  <button
                    onClick={() => copySetupValue(activeConvertedEntry?.startingBid || converterForm.startingBid, "Copied bid.")}
                    className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    Copy Bid
                  </button>
                  <button
                    onClick={() => copySetupValue(activeConvertedEntry?.fileName || converterForm.fileName, "Copied file name.")}
                    className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    Copy File Name
                  </button>
                  {setupCopyStatus && <span className="text-[11px] font-medium text-gray-500">{setupCopyStatus}</span>}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <p className="text-xs font-bold text-gray-900">TikTok Upload Checklist</p>
                <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {TIKTOK_UPLOAD_CHECKLIST.map(item => (
                    <div key={item} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-[11px] font-medium text-gray-600">
                      <span className="h-3 w-3 rounded border border-gray-300 bg-white" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-bold text-gray-900">Converted Product Preview</p>
                <div className="mt-2 max-h-44 overflow-auto rounded border border-gray-200 bg-white">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-gray-50 text-gray-400">
                    <tr>
                      <th className="px-2 py-1 font-semibold">Product</th>
                      <th className="px-2 py-1 font-semibold">Qty</th>
                      <th className="px-2 py-1 font-semibold">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {converterRows.map(row => (
                      <tr key={`${row.order}-${row.productName}`}>
                        <td className="px-2 py-1 text-gray-700">{row.productName}</td>
                        <td className="px-2 py-1 text-gray-600">{row.quantity}</td>
                        <td className="px-2 py-1 text-gray-500">{row.type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}
          {convertedEntries.length > 0 && (
            <div className="mt-4 border-t border-gray-100 pt-3">
              <p className="text-xs font-bold text-gray-800">Converted files</p>
              <div className="mt-2 space-y-2">
                {convertedEntries.slice(0, 5).map(entry => (
                  <div key={entry.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-gray-800">{entry.fileName}</p>
                      <p className="text-[10px] text-gray-400">{entry.day} {String(entry.shift).toUpperCase()} - {entry.summary?.totalQuantity || 0} items</p>
                      {entry.exportDebug && (
                        <p className="text-[10px] text-gray-400">Source units: {entry.exportDebug.sourceUnits || entry.exportDebug.parsedProducts} - Export quantity: {entry.exportDebug.exportQuantity} - Export rows: {entry.exportDebug.xlsxRows}</p>
                      )}
                    </div>
                    <button onClick={() => handleDownload(entry)} className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">Download</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
            <div>
              <p className="text-sm font-bold text-gray-900">Weekly Surprise Set Tracker</p>
              <p className="mt-0.5 text-xs text-gray-400">Done boxes by day, brand, and shift.</p>
            </div>
            <span className="text-[10px] font-semibold text-gray-400">{liveReady}/{totalBlocks} done</span>
          </div>
          <div className="mt-4 space-y-2">
            <div className="grid grid-cols-[30px_repeat(4,minmax(0,1fr))] items-center gap-2">
              <div />
              {SURPRISE_SET_TRACKER_BRANDS.map(({ brand, code }) => (
                <div key={brand} className="flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  <BrandPip brand={brand} />
                  {code}
                </div>
              ))}
            </div>
            {SURPRISE_SET_DAYS.map(day => (
              <div key={day} className="grid grid-cols-[30px_repeat(4,minmax(0,1fr))] items-center gap-2">
                <div className="flex h-12 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-sm font-bold text-gray-700">
                  {dayShort[day]}
                </div>
                {SURPRISE_SET_TRACKER_BRANDS.map(({ brand }) => (
                  <div key={`${day}-${brand}`} className="rounded-lg border border-gray-200 bg-white p-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      {SURPRISE_SET_STREAMS.map(stream => {
                        const block = getTrackerBlock(day, stream.key, brand);
                        const done = Boolean(block?.readyForLive || block?.status === "Live Ready");
                        return (
                          <button
                            key={`${day}-${brand}-${stream.key}`}
                            type="button"
                            onClick={() => toggleTrackerDone(brand, day, stream.key, !done)}
                            className={`h-8 rounded-md border text-[10px] font-bold transition-colors ${done ? "border-slate-700 bg-slate-700 text-white" : "border-gray-300 bg-gray-50 text-gray-500 hover:bg-gray-100"}`}
                            aria-pressed={done}
                          >
                            {stream.key.toUpperCase()}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

// ─── WEEKLY RAISE TRACKER ─────────────────────────────────────────────────────
// ─── OPERATIONS IMPACT REPORT ────────────────────────────────────────────────

// Week range helpers
const getWeekRange = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay()); // Sunday
  const end = new Date(start);
  end.setDate(start.getDate() + 6);        // Saturday
  const fmt = (dt) => dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const fmtFull = (dt) => dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return {
    label:   `Week of ${start.getMonth() + 1}/${start.getDate()}`,
    range:   `${fmt(start)} - ${fmtFull(end)}`,
    start,
    end,
  };
};

const isThisWeek = (isoStr, weekStart, weekEnd) => {
  if (!isoStr) return false;
  try {
    const d = new Date(isoStr);
    return d >= weekStart && d <= weekEnd;
  } catch { return false; }
};

const REPORT_BRANDS = ["Vaulted Rarities", "CardKing47", "PokeSpins", "PokieMart"];

const OpsImpactMetricCard = ({ label, value, accent = false, sub }) => (
  <div className={`bg-white border rounded-lg px-3 py-3 ${accent ? "border-l-4 border-l-slate-400 border-t border-r border-b border-gray-200" : "border-gray-200"}`}>
    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-tight">{label}</p>
    <p className={`text-2xl font-bold mt-1 ${accent ? "text-slate-800" : "text-gray-900"}`}>{value}</p>
    {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
  </div>
);

const SurpriseSetView = ({ surpriseSets, setSurpriseSets }) => {
  const [selectedDay, setSelectedDay] = useState(getDefaultSurpriseSetBoardDay());
  const [focusChannel, setFocusChannel] = useState("All");
  const [boardEntries, setBoardEntries] = useState(() => loadSurpriseSetBoardEntries());
  const [builderForm, setBuilderForm] = useState(null);
  const [converterError, setConverterError] = useState("");
  const [convertedEntries, setConvertedEntries] = useState(() => loadSetSheetConverterEntries());
  const [setupCopyStatus, setSetupCopyStatus] = useState("");
  const [smartPasteResult, setSmartPasteResult] = useState(null);
  const [autopilotRange, setAutopilotRange] = useState("Today");
  const [autopilotChannels, setAutopilotChannels] = useState(["CK", "PS", "PM"]);
  const [autopilotOpen, setAutopilotOpen] = useState(false);
  const [autopilotPaste, setAutopilotPaste] = useState("");
  const [autopilotSummary, setAutopilotSummary] = useState(null);
  const [agentActivity, setAgentActivity] = useState(["Sheet Autopilot is ready for a warehouse paste."]);
  const [autopilotLoading, setAutopilotLoading] = useState(false);
  const [autopilotError, setAutopilotError] = useState("");
  const [autopilotPreviewRows, setAutopilotPreviewRows] = useState([]);

  useEffect(() => {
    setSurpriseSets(prev => normalizeWeeklySurpriseSets(prev));
  }, [setSurpriseSets]);

  useEffect(() => {
    try { localStorage.setItem(SETSHEET_CONVERTER_STORAGE_KEY, JSON.stringify(convertedEntries.slice(0, 20))); } catch {}
  }, [convertedEntries]);

  useEffect(() => {
    try { localStorage.setItem(SURPRISE_SET_BOARD_STORAGE_KEY, JSON.stringify(boardEntries)); } catch {}
  }, [boardEntries]);

  const weeklyBlocks = normalizeWeeklySurpriseSets(surpriseSets);
  const safeSurpriseSets = Array.isArray(weeklyBlocks) ? weeklyBlocks : [];
  const trackerBlocks = safeSurpriseSets.filter(block => normalizeSurpriseSetBrandValue(block.brand));
  const dayEntries = boardEntries.filter(entry => entry.day === selectedDay);
  const visibleBrands = focusChannel === "All"
    ? SURPRISE_SET_REQUIRED_BOARD_BRANDS
    : SURPRISE_SET_TRACKER_BRANDS.filter(item => item.code === focusChannel);
  const metrics = getSurpriseSetBoardMetrics(boardEntries, selectedDay);
  const brain = getSurpriseSetBrainNotes(boardEntries, selectedDay);
  const selectedTemplateConfig = getSetSheetTemplateConfig(builderForm?.brand || "Vaulted Rarities");
  const builderSummary = getSetSheetSummary(builderForm?.rows || []);

  const updateBuilderField = (field, value) => {
    setBuilderForm(prev => {
      if (!prev) return prev;
      const next = { ...prev, [field]: value };
      if (field === "brand") next.brandCode = getSurpriseSetBrandCode(value);
      if (field === "day" && SURPRISE_SET_DAYS.includes(value) && !next.streamDate) {
        next.streamDate = getSurpriseSetDateForDay(value);
      }
      return next;
    });
  };

  const copySetupValue = async (value, successMessage) => {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      setSetupCopyStatus(successMessage);
      setTimeout(() => setSetupCopyStatus(""), 2200);
    } catch {
      setSetupCopyStatus("Copy failed. Try again.");
      setTimeout(() => setSetupCopyStatus(""), 2600);
    }
  };

  const getTrackerBlock = (day, streamKey, brand) =>
    trackerBlocks.find(block => block.day === day && block.streamKey === streamKey && normalizeSurpriseSetBrandValue(block.brand) === normalizeSurpriseSetBrandValue(brand));

  const patchTrackerBlock = (brand, day, streamKey, patch) => {
    setSurpriseSets(prev => normalizeWeeklySurpriseSets(prev).map(block => {
      const matches = block.day === day && block.streamKey === streamKey && normalizeSurpriseSetBrandValue(block.brand) === normalizeSurpriseSetBrandValue(brand);
      if (!matches) return block;
      const next = { ...block, ...patch };
      const done = Boolean(next.readyForLive);
      return { ...next, status: done ? "Live Ready" : next.status || "Not Started" };
    }));
  };

  const upsertBoardEntry = (entry) => {
    const normalized = normalizeSurpriseSetBoardEntry(entry);
    setBoardEntries(prev => {
      const exists = prev.some(item => item.id === normalized.id);
      return exists ? prev.map(item => item.id === normalized.id ? normalized : item) : [...prev, normalized];
    });
    return normalized;
  };

  const openBuilder = (entry) => {
    setBuilderForm(normalizeSurpriseSetBoardEntry(entry));
    setSmartPasteResult(null);
    setConverterError("");
  };

  const handleAddSet = (brand, shift) => {
    const draft = createSurpriseSetBoardDraft({ brand, day: selectedDay, shift, entries: boardEntries });
    setBoardEntries(prev => [...prev, draft]);
    openBuilder(draft);
  };

  const handleDeleteSet = (entryId) => {
    setBoardEntries(prev => prev.filter(item => item.id !== entryId));
    setConvertedEntries(prev => (Array.isArray(prev) ? prev : []).filter(item => item.id !== entryId));
    if (builderForm?.id === entryId) setBuilderForm(null);
  };

  const handleSaveBuilder = () => {
    if (!builderForm) return;
    const saved = upsertBoardEntry(builderForm);
    setBuilderForm(saved);
    setSetupCopyStatus("Saved.");
    setTimeout(() => setSetupCopyStatus(""), 1800);
  };

  const handleResetBuilder = () => {
    if (!builderForm) return;
    const reset = normalizeSurpriseSetBoardEntry({
      ...builderForm,
      streamer: "",
      surpriseSetName: "",
      startingBid: "",
      hardFloor: "",
      stretch: "",
      fileName: "",
      input: "",
      rows: [],
      summary: getSetSheetSummary([]),
      status: "Draft",
      convertedAt: "",
      downloadedAt: "",
      uploadedAt: "",
      notes: "",
      warnings: [],
      importSource: "",
    });
    upsertBoardEntry(reset);
    setBuilderForm(reset);
    setSmartPasteResult(null);
    setConverterError("");
  };

  const handleAddAnother = () => {
    const source = builderForm || {
      brand: focusChannel === "All" ? "PokeSpins" : getSurpriseSetBrandFromCode(focusChannel),
      day: selectedDay,
      shift: "am",
    };
    handleAddSet(source.brand, source.shift);
  };

  const handleAnalyzeSmartPaste = () => {
    if (!builderForm) return;
    const result = parseWarehouseSheetPaste(builderForm.input, builderForm);
    setSmartPasteResult(result);
    setConverterError("");
    setBuilderForm(prev => {
      if (!prev) return prev;
      const next = { ...prev };
      if (result.detectedBrand) {
        next.brand = result.detectedBrand;
        next.brandCode = getSurpriseSetBrandCode(result.detectedBrand);
      }
      if (result.streamer) next.streamer = result.streamer;
      if (result.streamDate) next.streamDate = result.streamDate;
      if (result.day) next.day = result.day;
      if (result.shift) next.shift = result.shift;
      if (result.setNumber) next.setNumber = result.setNumber;
      if (result.surpriseSetName) next.surpriseSetName = result.surpriseSetName;
      if (result.startingBid) next.startingBid = result.startingBid;
      if (result.hardFloor) next.hardFloor = result.hardFloor;
      if (result.stretch) next.stretch = result.stretch;
      if (Array.isArray(result.productLines) && result.productLines.length) next.input = result.productLines.join("\n");
      if (!next.fileName) next.fileName = buildSurpriseSetFileName(next);
      next.status = "Parsed";
      return next;
    });
  };

  const handleConvertSet = () => {
    if (!builderForm) return;
    setConverterError("");
    const rows = parseSetSheetInput(builderForm.input);
    if (!rows.length) {
      setConverterError("Paste some surprise set lines first.");
      return;
    }
    const sourceProductUnits = buildSourceProductUnitsFromLines(String(builderForm.input || "").split(/\r?\n/), {
      channel: builderForm.brandCode || getSurpriseSetBrandCode(builderForm.brand),
      sheetTab: builderForm.sheetTab || "",
      columnGroup: builderForm.columnGroup || "",
    });
    const summary = { ...getSetSheetSummary(rows), totalQuantity: sourceProductUnits.length ? getSourceProductUnitCount(sourceProductUnits) : getSetSheetSummary(rows).totalQuantity };
    const safeFileName = builderForm.fileName || buildSurpriseSetFileName(builderForm);
    const converted = normalizeSurpriseSetBoardEntry({
      ...builderForm,
      fileName: safeFileName,
      rows,
      summary,
      sourceProductUnits,
      status: "Converted",
      convertedAt: nowISO(),
    });
    const templateConfig = getSetSheetTemplateConfig(converted.brand);
    const entry = {
      id: converted.id,
      createdAt: converted.convertedAt,
      brand: converted.brand,
      warehouse: templateConfig.usesWarehouse ? SETSHEET_WAREHOUSES[0] : "",
      day: converted.day,
      shift: converted.shift,
      streamer: converted.streamer,
      streamDate: converted.streamDate,
      setNumber: converted.setNumber,
      surpriseSetName: converted.surpriseSetName,
      startingBid: converted.startingBid,
      fileName: converted.fileName,
      input: converted.input,
      templatePath: templateConfig.path,
      usesWarehouse: templateConfig.usesWarehouse,
      rows,
      summary,
      sourceProductUnits,
    };
    upsertBoardEntry(converted);
    setBuilderForm(converted);
    setConvertedEntries(prev => [entry, ...(Array.isArray(prev) ? prev.filter(item => item.id !== entry.id) : [])].slice(0, 20));
    patchTrackerBlock(converted.brand, converted.day, converted.shift, {
      convertedSetSheet: true,
      setName: converted.surpriseSetName || safeFileName,
      quantity: summary.totalQuantity,
    });
  };

  const handleDownloadSet = async (entry = builderForm) => {
    if (!entry) return { ok: false };
    const rows = Array.isArray(entry.rows) && entry.rows.length ? entry.rows : parseSetSheetInput(entry.input);
    const fileName = entry.fileName || buildSurpriseSetFileName(entry);
    if (!Array.isArray(rows) || rows.length === 0) {
      setConverterError("Convert a surprise set before downloading.");
      return { ok: false };
    }
    const downloadResult = await downloadSetSheetRows(rows, fileName, {
      brand: entry.brand,
      warehouse: entry.warehouse || SETSHEET_WAREHOUSES[0],
      previewProductCount: entry.summary?.totalQuantity || getSetSheetSummary(rows).totalQuantity,
      sourceProductUnits: entry.sourceProductUnits,
    });
    if (!downloadResult.ok) {
      setConverterError(downloadResult.error);
      return downloadResult;
    }
    const downloaded = normalizeSurpriseSetBoardEntry({
      ...entry,
      rows,
      fileName,
      summary: getSetSheetSummary(rows),
      status: ["Uploaded", "Live Ready"].includes(entry.status) ? entry.status : "Downloaded",
      downloadedAt: entry.downloadedAt || nowISO(),
      exportDebug: downloadResult.exportDebug,
    });
    upsertBoardEntry(downloaded);
    if (builderForm?.id === downloaded.id) setBuilderForm(downloaded);
    setConvertedEntries(prev => (Array.isArray(prev) ? prev : []).map(item => item.id === downloaded.id ? { ...item, downloadedAt: downloaded.downloadedAt, exportDebug: downloadResult.exportDebug } : item));
    patchTrackerBlock(downloaded.brand, downloaded.day, downloaded.shift, { downloadedSetSheet: true });
    return downloadResult;
  };

  const handleMarkUploaded = (entry = builderForm) => {
    if (!entry) return;
    const uploaded = normalizeSurpriseSetBoardEntry({
      ...entry,
      status: "Live Ready",
      uploadedAt: entry.uploadedAt || nowISO(),
    });
    upsertBoardEntry(uploaded);
    if (builderForm?.id === uploaded.id) setBuilderForm(uploaded);
    setConvertedEntries(prev => (Array.isArray(prev) ? prev : []).map(item => item.id === uploaded.id ? { ...item, uploadedAt: uploaded.uploadedAt, status: uploaded.status } : item));
    patchTrackerBlock(uploaded.brand, uploaded.day, uploaded.shift, {
      readyForLive: true,
      setName: uploaded.surpriseSetName || uploaded.fileName,
      quantity: uploaded.summary?.totalQuantity || 0,
    });
  };

  const handleDownloadAll = async () => {
    const safeEntries = Array.isArray(convertedEntries) ? convertedEntries : [];
    if (!safeEntries.length) {
      setConverterError("Convert at least one surprise set first.");
      return;
    }
    for (const entry of safeEntries) {
      const result = await handleDownloadSet(entry);
      if (!result?.ok) break;
    }
  };

  const handleToggleAutopilotChannel = (code) => {
    setAutopilotChannels(prev => {
      const safePrev = Array.isArray(prev) ? prev : [];
      if (safePrev.includes(code)) return safePrev.filter(item => item !== code);
      return [...safePrev, code];
    });
  };

  const runAutopilotImport = (rawText, importMeta = {}) => {
    setConverterError("");
    setAutopilotError("");
    const result = parseAutopilotImport(rawText, {
      dateRange: autopilotRange,
      selectedChannels: autopilotChannels,
      focusChannel,
      selectedDay,
      currentShift: builderForm?.shift,
    });
    if (!result.importedSets.length) {
      const nextSummary = { imported: 0, converted: 0, warnings: result.warnings.length, warningList: result.warnings };
      setAutopilotSummary(nextSummary);
      setAgentActivity(["Could not detect setup block."]);
      return nextSummary;
    }

    const convertedFileEntries = [];
    const importedCards = [];
    let nextBoardEntries = boardEntries;
    let updatedCount = 0;
    result.importedSets.forEach(importedSet => {
      const merge = mergeImportedSetIntoBoard(nextBoardEntries, importedSet);
      nextBoardEntries = merge.boardEntries;
      importedCards.push(merge.card);
      if (merge.updated) updatedCount += 1;
      if (merge.card.status === "Converted" && merge.card.rows.length) {
        const templateConfig = getSetSheetTemplateConfig(merge.card.brand);
        convertedFileEntries.push({
          id: merge.card.id,
          createdAt: merge.card.convertedAt,
          brand: merge.card.brand,
          warehouse: templateConfig.usesWarehouse ? SETSHEET_WAREHOUSES[0] : "",
          day: merge.card.day,
          shift: merge.card.shift,
          streamer: merge.card.streamer,
          streamDate: merge.card.streamDate,
          setNumber: merge.card.setNumber,
          surpriseSetName: merge.card.surpriseSetName,
          startingBid: merge.card.startingBid,
          fileName: merge.card.fileName,
          input: merge.card.input,
          templatePath: templateConfig.path,
          usesWarehouse: templateConfig.usesWarehouse,
          rows: merge.card.rows,
          summary: merge.card.summary,
          sourceProductUnits: merge.card.sourceProductUnits,
        });
        patchTrackerBlock(merge.card.brand, merge.card.day, merge.card.shift, {
          convertedSetSheet: true,
          setName: merge.card.surpriseSetName || merge.card.fileName,
          quantity: merge.card.summary?.totalQuantity || 0,
        });
      }
    });

    setBoardEntries(nextBoardEntries);
    if (importedCards[0]) {
      setSelectedDay(importedCards[0].day);
      setBuilderForm(importedCards[0]);
    }
    if (convertedFileEntries.length) {
      setConvertedEntries(prev => {
        const safePrev = Array.isArray(prev) ? prev : [];
        const importedIds = new Set(convertedFileEntries.map(entry => entry.id));
        return [...convertedFileEntries, ...safePrev.filter(entry => !importedIds.has(entry.id))].slice(0, 20);
      });
    }

    const allWarnings = [...result.warnings, ...importedCards.flatMap(card => card.warnings || [])];
    const uniqueWarnings = Array.from(new Set(allWarnings));
    const shiftReviewCount = importedCards.filter(card => (card.warnings || []).some(warning => warning.includes("Shift not detected"))).length;
    const missingTargetCount = importedCards.filter(card => (card.warnings || []).some(warning => warning.includes("Target price missing"))).length;
    const readyFiles = convertedFileEntries.map(entry => `${entry.brandCode || getSurpriseSetBrandCode(entry.brand)} ${entry.shift.toUpperCase()}`).filter(Boolean);
    const nextActivity = [
      importMeta.tabCount ? `Imported ${importMeta.tabCount} sheet tab${importMeta.tabCount === 1 ? "" : "s"}.` : "",
      importMeta.sourceLabel ? `Source: ${importMeta.sourceLabel}.` : "",
      `Imported ${importedCards.length} surprise set${importedCards.length === 1 ? "" : "s"}.`,
      `Created or updated ${importedCards.length} set card${importedCards.length === 1 ? "" : "s"}.`,
      `Converted ${convertedFileEntries.length} file${convertedFileEntries.length === 1 ? "" : "s"}.`,
      updatedCount ? `Updated ${updatedCount} existing set${updatedCount === 1 ? "" : "s"}.` : "",
      shiftReviewCount ? `${shiftReviewCount} set${shiftReviewCount === 1 ? "" : "s"} need shift review.` : "",
      missingTargetCount ? `Missing target price for ${missingTargetCount} set${missingTargetCount === 1 ? "" : "s"}.` : "",
      readyFiles[0] ? `${readyFiles[0]} is ready to download.` : "",
      uniqueWarnings.length ? `${uniqueWarnings.length} warning${uniqueWarnings.length === 1 ? "" : "s"}.` : "",
    ].filter(Boolean);
    setAgentActivity(nextActivity);
    const nextSummary = {
      imported: importedCards.length,
      converted: convertedFileEntries.length,
      warnings: uniqueWarnings.length,
      warningList: uniqueWarnings,
      tabs: importMeta.tabCount || 0,
    };
    setAutopilotSummary(nextSummary);
    return nextSummary;
  };

  const handleAnalyzeAutopilotImport = () => {
    runAutopilotImport(autopilotPaste, { sourceLabel: "paste" });
    setAutopilotOpen(false);
  };

  const handleToggleAutopilotPreviewRow = (rowId) => {
    setAutopilotPreviewRows(prev => (Array.isArray(prev) ? prev : []).map(row => row.id === rowId ? { ...row, include: !row.include } : row));
  };

  const handleImportFromSheets = async () => {
    const channels = autopilotChannels.length ? autopilotChannels : ["CK", "PS", "PM"];
    const dates = getAutopilotDatesForRange(autopilotRange, selectedDay);
    setAutopilotLoading(true);
    setAutopilotError("");
    setConverterError("");
    setAutopilotPreviewRows([]);
    try {
      if (!supabase?.functions?.invoke) throw new Error("Supabase functions unavailable.");
      const { data, error } = await supabase.functions.invoke("import-surprise-sets", {
        body: { channels, dates },
      });
      if (error || !data?.ok) throw error || new Error("Import failed.");
      const result = buildAutopilotPreviewRowsFromSheetsImport(data, dates);
      if (!result.previewRows.length) throw new Error("No matching sets returned.");
      setAutopilotPreviewRows(result.previewRows);
      const readyCount = result.previewRows.filter(row => !hasAutopilotCriticalWarnings(row.warnings)).length;
      const reviewCount = result.previewRows.length - readyCount;
      const warningCount = result.previewRows.reduce((sum, row) => sum + row.warnings.length, 0);
      setAutopilotSummary({
        imported: 0,
        converted: 0,
        warnings: warningCount,
        warningList: Array.from(new Set(result.previewRows.flatMap(row => row.warnings))).slice(0, 8),
        tabs: countAutopilotSheetTabs(data),
      });
      setAgentActivity([
        `Found ${result.previewRows.length} possible set${result.previewRows.length === 1 ? "" : "s"}.`,
        `${readyCount} ready to import.`,
        `${reviewCount} need review.`,
        `${result.ignoredTabs} ignored tab${result.ignoredTabs === 1 ? "" : "s"}.`,
        `${warningCount} warning${warningCount === 1 ? "" : "s"}.`,
      ]);
    } catch {
      setAutopilotError("Import From Sheets failed. Use Import From Paste as fallback.");
      setAgentActivity(["Import From Sheets failed. Use Import From Paste as fallback."]);
    } finally {
      setAutopilotLoading(false);
    }
  };

  const handleConfirmAutopilotImport = () => {
    const selectedRows = (Array.isArray(autopilotPreviewRows) ? autopilotPreviewRows : []).filter(row => row.include);
    if (!selectedRows.length) {
      setAutopilotError("Select at least one preview row before confirming import.");
      return;
    }
    const convertedFileEntries = [];
    const importedCards = [];
    let nextBoardEntries = boardEntries;
    let skipped = 0;
    selectedRows.forEach(row => {
      const critical = hasAutopilotCriticalWarnings(row.warnings);
      const importedSet = {
        brand: row.brand,
        brandCode: getSurpriseSetBrandCode(row.brand),
        day: row.day,
        shift: row.shift === "pm" ? "pm" : "am",
        streamer: row.streamer,
        streamDate: row.streamDate,
        setNumber: row.setNumber,
        surpriseSetName: row.surpriseSetName,
        startingBid: row.startingBid,
        hardFloor: row.hardFloor,
        stretch: row.stretch,
        input: row.productLines.join("\n"),
        productLines: row.productLines,
        sourceProductUnits: row.sourceProductUnits,
        warnings: row.warnings,
        needsReview: critical,
        sheetTab: row.sheetTab,
        columnGroup: row.columnGroup,
      };
      const merge = mergeImportedSetIntoBoard(nextBoardEntries, importedSet);
      nextBoardEntries = merge.boardEntries;
      importedCards.push(merge.card);
      if (merge.card.status === "Converted" && merge.card.rows.length) {
        const templateConfig = getSetSheetTemplateConfig(merge.card.brand);
        convertedFileEntries.push({
          id: merge.card.id,
          createdAt: merge.card.convertedAt,
          brand: merge.card.brand,
          warehouse: templateConfig.usesWarehouse ? SETSHEET_WAREHOUSES[0] : "",
          day: merge.card.day,
          shift: merge.card.shift,
          streamer: merge.card.streamer,
          streamDate: merge.card.streamDate,
          setNumber: merge.card.setNumber,
          surpriseSetName: merge.card.surpriseSetName,
          startingBid: merge.card.startingBid,
          fileName: merge.card.fileName,
          input: merge.card.input,
          templatePath: templateConfig.path,
          usesWarehouse: templateConfig.usesWarehouse,
          rows: merge.card.rows,
          summary: merge.card.summary,
          sourceProductUnits: merge.card.sourceProductUnits,
        });
        patchTrackerBlock(merge.card.brand, merge.card.day, merge.card.shift, {
          convertedSetSheet: true,
          setName: merge.card.surpriseSetName || merge.card.fileName,
          quantity: merge.card.summary?.totalQuantity || 0,
        });
      } else if (critical) {
        skipped += 1;
      }
    });
    setBoardEntries(nextBoardEntries);
    if (importedCards[0]) {
      setSelectedDay(importedCards[0].day);
      setBuilderForm(importedCards[0]);
    }
    if (convertedFileEntries.length) {
      setConvertedEntries(prev => {
        const safePrev = Array.isArray(prev) ? prev : [];
        const importedIds = new Set(convertedFileEntries.map(entry => entry.id));
        return [...convertedFileEntries, ...safePrev.filter(entry => !importedIds.has(entry.id))].slice(0, 20);
      });
    }
    setAutopilotPreviewRows([]);
    setAutopilotError("");
    setAgentActivity([
      `Imported ${importedCards.length} set${importedCards.length === 1 ? "" : "s"}.`,
      `Converted ${convertedFileEntries.length} file${convertedFileEntries.length === 1 ? "" : "s"}.`,
      `${skipped} need review.`,
      `${(Array.isArray(autopilotPreviewRows) ? autopilotPreviewRows : []).length - selectedRows.length} skipped.`,
    ]);
  };

  const runClearWeek = () => {
    const fresh = createDefaultWeeklySurpriseSets();
    try { localStorage.removeItem(SURPRISE_SET_STORAGE_KEY); } catch {}
    try { localStorage.removeItem(SURPRISE_SET_BOARD_STORAGE_KEY); } catch {}
    try { localStorage.removeItem(SETSHEET_CONVERTER_STORAGE_KEY); } catch {}
    setBoardEntries([]);
    setConvertedEntries([]);
    setBuilderForm(null);
    setAutopilotPreviewRows([]);
    setAutopilotSummary(null);
    setAgentActivity(["VR default recurring surprise set remains active."]);
    setSurpriseSets(fresh);
    showOpsToast("Surprise set week cleared.");
  };

  const clearWeek = () => {
    showOpsConfirm({
      title: "Clear this data?",
      body: "This will clear this week's surprise set setup, board entries, and converted set sheet history.",
      confirmLabel: "Clear",
      variant: "clear",
      onConfirm: runClearWeek,
    });
  };

  const renderSetCard = (entry) => {
    const productCount = entry.summary?.totalQuantity || entry.rows?.length || 0;
    const canDownload = Array.isArray(entry.rows) && entry.rows.length > 0;
    const exportAudit = canDownload ? getSetSheetExportRowsForEntry(entry) : null;
    return (
      <div key={entry.id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-gray-900">{entry.surpriseSetName || "Untitled set"}</p>
            <p className="mt-0.5 text-[11px] text-gray-400">{entry.streamer || "No streamer"} - Set {entry.setNumber || "1"}</p>
          </div>
          <span className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-500">{entry.status}</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
          <div className="rounded border border-gray-100 bg-gray-50 px-2 py-1.5">
            <p className="text-gray-400">Bid</p>
            <p className="font-bold text-gray-800">{entry.startingBid ? `$${entry.startingBid}` : "-"}</p>
          </div>
          <div className="rounded border border-gray-100 bg-gray-50 px-2 py-1.5">
            <p className="text-gray-400">Products</p>
            <p className="font-bold text-gray-800">{productCount}</p>
          </div>
          <div className="rounded border border-gray-100 bg-gray-50 px-2 py-1.5">
            <p className="text-gray-400">Date</p>
            <p className="font-bold text-gray-800">{entry.streamDate ? entry.streamDate.slice(5) : "-"}</p>
          </div>
        </div>
        {canDownload && (
          <p className="mt-2 text-[10px] font-medium text-gray-400">
            Source units: {entry.exportDebug?.sourceUnits || exportAudit?.sourceCount || productCount} - Export quantity: {entry.exportDebug?.exportQuantity || getSetSheetSummary(exportAudit?.exportRows || []).totalQuantity} - Export rows: {entry.exportDebug?.xlsxRows || exportAudit?.exportRows?.length || 0}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(entry.warnings || []).slice(0, 2).map(warning => (
            <span key={warning} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">{getAutopilotWarningChipLabel(warning)}</span>
          ))}
          <button onClick={() => openBuilder(entry)} className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">Edit</button>
          <button onClick={() => copySetupValue(entry.surpriseSetName, "Copied name.")} className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">Copy Name</button>
          <button onClick={() => copySetupValue(entry.startingBid, "Copied bid.")} className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">Copy Bid</button>
          <button onClick={() => handleDownloadSet(entry)} disabled={!canDownload} className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">Download</button>
          <button onClick={() => copyExportAudit(entry)} disabled={!canDownload} className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">Copy Export Audit</button>
          <button onClick={() => handleMarkUploaded(entry)} className="rounded border border-slate-800 bg-slate-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-slate-800">Mark Uploaded</button>
          <button onClick={() => handleDeleteSet(entry.id)} className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold text-gray-500 hover:bg-gray-50">Delete</button>
        </div>
      </div>
    );
  };

  const renderVrStatusCard = () => {
    const vrEntries = dayEntries.filter(entry => normalizeSurpriseSetBrandValue(entry.brand) === "Vaulted Rarities");
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="mb-3 flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SURPRISE_SET_BOARD_BRAND_COLORS.VR }} />
          <p className="text-sm font-bold text-gray-900">VR</p>
          <p className="text-[11px] font-medium text-gray-400">Vaulted Rarities</p>
        </div>
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2">
          <p className="text-xs font-bold text-gray-900">VR default set active</p>
          <p className="mt-0.5 text-[11px] text-gray-600">Vaulted Rarities uses the same recurring surprise set daily, so no AM or PM lane is required.</p>
        </div>
        {vrEntries.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Custom VR Exceptions</p>
            {vrEntries.map(renderSetCard)}
          </div>
        )}
        <button onClick={() => handleAddSet("Vaulted Rarities", "am")} className="mt-3 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
          Add Custom VR Set
        </button>
      </div>
    );
  };

  const renderSlot = (brand, shift) => {
    const slotEntries = dayEntries.filter(entry => normalizeSurpriseSetBrandValue(entry.brand) === brand && entry.shift === shift);
    const code = getSurpriseSetBrandCode(brand);
    return (
      <div key={`${brand}-${shift}`} className="min-h-[168px] rounded-lg border border-gray-200 bg-gray-50 p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SURPRISE_SET_BOARD_BRAND_COLORS[code] || "#CBD5E1" }} />
            {code} {shift.toUpperCase()}
          </div>
          <button onClick={() => handleAddSet(brand, shift)} className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">Add Set</button>
        </div>
        <div className="space-y-2">
          {slotEntries.length ? slotEntries.map(renderSetCard) : (
            <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white text-[11px] font-medium text-gray-400">
              No sets planned
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Surprise Set Command Board</h2>
          <p className="text-xs text-gray-400 mt-0.5">{getWeekOfLabel()} - Plan, convert, download, and upload by channel.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={clearWeek} className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50">
            Clear Week
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ["Planned Sets", metrics.planned],
          ["Converted", metrics.converted],
          ["Downloaded", metrics.downloaded],
          ["Uploaded", metrics.uploaded],
          ["Missing Slots", metrics.missingSlots],
        ].map(([label, value]) => (
          <Card key={label} className="border-l-4 border-l-slate-300 p-3">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900">Sheet Autopilot</p>
            <p className="mt-0.5 text-xs text-gray-400">Paste a copied warehouse sheet block and I'll build the set cards for review.</p>
            {agentActivity.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {agentActivity.slice(0, 6).map(item => (
                  <span key={item} className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-600">{item}</span>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="space-y-1">
              <FL>Date Range</FL>
              <Sel value={autopilotRange} onChange={setAutopilotRange} options={["Today", "Tomorrow", "Next 2 Days", "Selected Day", "Full Week"]} placeholder="" />
            </label>
            <div className="space-y-1">
              <FL>Channels</FL>
              <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                {["CK", "PS", "PM"].map(code => (
                  <button
                    key={code}
                    onClick={() => handleToggleAutopilotChannel(code)}
                    className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${autopilotChannels.includes(code) ? "bg-white text-gray-900 shadow-sm" : "text-gray-400 hover:text-gray-700"}`}
                  >
                    {code}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={handleImportFromSheets} disabled={autopilotLoading} className="inline-flex items-center justify-center rounded-lg border border-slate-800 bg-slate-700 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
              {autopilotLoading ? "Importing Sheets" : "Import From Sheets"}
            </button>
            <button onClick={() => setAutopilotOpen(true)} className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50">
              Import From Paste
            </button>
          </div>
        </div>
        {autopilotError && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{autopilotError}</div>
        )}
        {autopilotSummary && (
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            <span className="font-bold text-gray-900">Import summary:</span> {autopilotSummary.tabs ? `Imported ${autopilotSummary.tabs} tabs, ` : ""}imported {autopilotSummary.imported} sets, converted {autopilotSummary.converted} files, {autopilotSummary.warnings} warnings.
            {autopilotSummary.warningList?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {autopilotSummary.warningList.slice(0, 6).map(warning => (
                  <span key={warning} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">{warning}</span>
                ))}
              </div>
            )}
          </div>
        )}
        {autopilotPreviewRows.length > 0 && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-gray-900">Import Review Preview</p>
                <p className="mt-0.5 text-[11px] text-gray-400">Review parser choices before creating or updating board cards.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <BtnPrimary onClick={handleConfirmAutopilotImport}>Confirm Import</BtnPrimary>
                <BtnSecondary onClick={() => setAutopilotPreviewRows([])}>Cancel</BtnSecondary>
                <button onClick={() => setAutopilotOpen(true)} className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50">Import From Paste fallback</button>
              </div>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-[1400px] w-full text-left text-[11px]">
                <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
                  <tr>
                    {["Include", "Channel", "Sheet tab", "Tab order", "Column group", "Row range used", "Date", "Streamer", "Shift", "Set", "Surprise set name", "Target bid", "Hard floor", "Stretch", "Products", "First 3 products", "Last 3 products", "Warnings"].map(label => (
                      <th key={label} className="px-2 py-2 font-bold">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {autopilotPreviewRows.map(row => (
                    <tr key={row.id} className={hasAutopilotCriticalWarnings(row.warnings) ? "bg-amber-50/50" : "bg-white"}>
                      <td className="px-2 py-2"><input type="checkbox" checked={row.include} onChange={() => handleToggleAutopilotPreviewRow(row.id)} /></td>
                      <td className="px-2 py-2 font-bold text-gray-700">{row.channel}</td>
                      <td className="px-2 py-2 text-gray-600">{row.sheetTab}</td>
                      <td className="px-2 py-2 text-gray-600">{row.tabOrder || "-"}</td>
                      <td className="px-2 py-2 text-gray-600">{row.columnGroup}</td>
                      <td className="px-2 py-2 text-gray-600">{row.rowRangeUsed}</td>
                      <td className="px-2 py-2 text-gray-600">{row.streamDate || "-"}</td>
                      <td className="px-2 py-2 text-gray-600">{row.streamer || "-"}</td>
                      <td className="px-2 py-2 text-gray-600">{formatAutopilotShiftLabel(row.shift)}</td>
                      <td className="px-2 py-2 text-gray-600">{row.setNumber}</td>
                      <td className="px-2 py-2 font-semibold text-gray-800">{row.surpriseSetName}</td>
                      <td className="px-2 py-2 text-gray-600">{row.startingBid || "-"}</td>
                      <td className="px-2 py-2 text-gray-600">{row.hardFloor || "-"}</td>
                      <td className="px-2 py-2 text-gray-600">{row.stretch || "-"}</td>
                      <td className="px-2 py-2 font-bold text-gray-800">{row.productCount}</td>
                      <td className="px-2 py-2 text-gray-500">{row.productLines.slice(0, 3).join(", ") || "-"}</td>
                      <td className="px-2 py-2 text-gray-500">{row.productLines.slice(-3).join(", ") || "-"}</td>
                      <td className="px-2 py-2 text-amber-800">{row.warnings.join(", ") || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-[10px] text-gray-400">
              Debug detail is shown in Sheet tab, Column group, Row range used, and product count.
            </div>
          </div>
        )}
        {autopilotOpen && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-gray-900">Import From Paste</p>
                <p className="mt-0.5 text-[11px] text-gray-400">Paste setup blocks and product rows together.</p>
              </div>
              <button onClick={() => setAutopilotOpen(false)} className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
            </div>
            <Txt
              value={autopilotPaste}
              onChange={setAutopilotPaste}
              placeholder={"Paste the full copied Google Sheet block here, including product rows and setup lines like TARGET and STRETCH.\n\n5/26 (ZMAN) + 16 VR BAG + 16 Electric Vault\nCHAOS RISING SURPRISE\nHARD FLOOR: $17\nTARGET: $19\nSTRETCH: $21"}
              rows={11}
              className="mt-3 font-mono text-xs"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <BtnPrimary onClick={handleAnalyzeAutopilotImport}>Analyze Import</BtnPrimary>
              <BtnSecondary onClick={() => setAutopilotOpen(false)}>Cancel</BtnSecondary>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex-1 space-y-2">
            <FL>Live Week</FL>
            <div className="flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
              {SURPRISE_SET_DAYS.map(day => (
                <button
                  key={day}
                  onClick={() => setSelectedDay(day)}
                  className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${selectedDay === day ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:bg-white hover:text-gray-800"}`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-1">
            <label className="space-y-1">
              <FL>Focus Channel</FL>
              <Sel value={focusChannel} onChange={setFocusChannel} options={SURPRISE_SET_BOARD_FOCUS_OPTIONS} placeholder="" />
            </label>
          </div>
          {setupCopyStatus && <span className="text-[11px] font-medium text-gray-500">{setupCopyStatus}</span>}
        </div>
      </Card>

      <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
            <div>
              <p className="text-sm font-bold text-gray-900">{focusChannel === "All" ? "All Channels Board" : `${focusChannel} Focus Board`}</p>
              <p className="mt-0.5 text-xs text-gray-400">{selectedDay} - AM and PM build lanes</p>
            </div>
            <span className="text-[10px] font-semibold text-gray-400">{dayEntries.length} set{dayEntries.length === 1 ? "" : "s"} planned</span>
          </div>
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">
            Setup Brain: {brain.next}
          </div>
          <div className={focusChannel === "All" ? "mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4" : "mt-4 space-y-3"}>
            {(focusChannel === "All" || focusChannel === "VR") && renderVrStatusCard()}
            {visibleBrands.filter(({ code }) => code !== "VR").map(({ brand, code }) => (
              <div key={brand} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SURPRISE_SET_BOARD_BRAND_COLORS[code] || "#CBD5E1" }} />
                  <p className="text-sm font-bold text-gray-900">{code}</p>
                  <p className="text-[11px] font-medium text-gray-400">{brand}</p>
                </div>
                <div className={focusChannel === "All" ? "space-y-3" : "grid grid-cols-1 gap-3 lg:grid-cols-2"}>
                  {SURPRISE_SET_STREAMS.map(stream => renderSlot(brand, stream.key))}
                </div>
              </div>
            ))}
          </div>
      </Card>

      {builderForm ? (
        <Card className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-3">
            <div>
              <p className="text-sm font-bold text-gray-900">Set Builder</p>
              <p className="mt-0.5 text-xs text-gray-400">Paste, analyze, convert, download, and upload the selected set.</p>
            </div>
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[10px] font-bold uppercase text-gray-500">{builderForm.status}</span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1">
              <FL>Brand</FL>
              <Sel value={builderForm.brand} onChange={value => updateBuilderField("brand", value)} options={SURPRISE_SET_ACCOUNT_OPTIONS} placeholder="" />
            </label>
            <label className="space-y-1">
              <FL>Day</FL>
              <Sel value={builderForm.day} onChange={value => updateBuilderField("day", value)} options={SURPRISE_SET_DAYS} placeholder="" />
            </label>
            <label className="space-y-1">
              <FL>Shift</FL>
              <select value={builderForm.shift} onChange={event => updateBuilderField("shift", event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-slate-500 focus:outline-none">
                <option value="am">AM</option>
                <option value="pm">PM</option>
              </select>
            </label>
            <label className="space-y-1">
              <FL>Streamer</FL>
              <Inp value={builderForm.streamer} onChange={value => updateBuilderField("streamer", value)} placeholder="Jimmy, Baxter, Zman" />
            </label>
            <label className="space-y-1">
              <FL>Stream Date</FL>
              <Inp type="date" value={builderForm.streamDate} onChange={value => updateBuilderField("streamDate", value)} />
            </label>
            <label className="space-y-1">
              <FL>Set Number</FL>
              <Inp type="number" min="1" value={builderForm.setNumber} onChange={value => updateBuilderField("setNumber", value)} placeholder="1" />
            </label>
            <label className="space-y-1">
              <FL>Starting Bid</FL>
              <Inp type="number" min="0" step="0.01" value={builderForm.startingBid} onChange={value => updateBuilderField("startingBid", value)} placeholder="1" />
            </label>
            <label className="space-y-1">
              <FL>Hard Floor</FL>
              <Inp type="number" min="0" step="0.01" value={builderForm.hardFloor} onChange={value => updateBuilderField("hardFloor", value)} placeholder="17" />
            </label>
            <label className="space-y-1">
              <FL>Stretch</FL>
              <Inp type="number" min="0" step="0.01" value={builderForm.stretch} onChange={value => updateBuilderField("stretch", value)} placeholder="21" />
            </label>
            <label className="space-y-1">
              <FL>File Name</FL>
              <Inp value={builderForm.fileName} onChange={value => updateBuilderField("fileName", value)} placeholder={buildSurpriseSetFileName(builderForm)} />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <FL>Surprise Set Name</FL>
              <Inp value={builderForm.surpriseSetName} onChange={value => updateBuilderField("surpriseSetName", value)} placeholder="Name to paste into TikTok" />
            </label>
            <label className="space-y-1 sm:col-span-2 lg:col-span-4">
              <FL>Insert Surprise Set</FL>
              <Txt value={builderForm.input} onChange={value => updateBuilderField("input", value)} placeholder="Paste warehouse sheet block or clean product lines here..." rows={10} className="font-mono text-xs" />
            </label>
          </div>
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
            Template: {selectedTemplateConfig.label}
            <span className="text-gray-300"> - </span>
            {selectedTemplateConfig.usesWarehouse ? "Warehouse column enabled" : "No warehouse column"}
            <span className="text-gray-300"> - </span>
            {builderSummary.totalRows} unique products, {builderSummary.totalQuantity} total items
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={handleAnalyzeSmartPaste} disabled={!builderForm.input.trim()} className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">Analyze Sheet Paste</button>
            <BtnPrimary onClick={handleConvertSet}>Convert</BtnPrimary>
            <button onClick={() => handleDownloadSet(builderForm)} disabled={!builderForm.rows?.length} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">Download file</button>
            <button onClick={() => copySetupValue(builderForm.surpriseSetName, "Copied name.")} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50">Copy Name</button>
            <button onClick={() => copySetupValue(builderForm.startingBid, "Copied bid.")} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50">Copy Bid</button>
            <button onClick={() => handleMarkUploaded(builderForm)} className="inline-flex items-center justify-center rounded-lg border border-slate-800 bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800">Mark Uploaded</button>
            <BtnSecondary onClick={handleSaveBuilder}>Save</BtnSecondary>
            <BtnSecondary onClick={handleResetBuilder}>Reset</BtnSecondary>
            <BtnSecondary onClick={handleAddAnother}>Add another surprise set</BtnSecondary>
            <button onClick={handleDownloadAll} disabled={!convertedEntries.length} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">Download all converted files</button>
            <BtnSecondary onClick={() => setBuilderForm(null)}>Cancel</BtnSecondary>
          </div>
          {converterError && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{converterError}</div>}
          {builderForm.warnings?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {builderForm.warnings.map(warning => (
                <span key={warning} title={warning} className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">{getAutopilotWarningChipLabel(warning)}</span>
              ))}
            </div>
          )}
          {smartPasteResult && (
            <div className="mt-3 space-y-2">
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] font-medium text-gray-600">
                Detected {[
                  smartPasteResult.streamer,
                  smartPasteResult.streamDate ? smartPasteResult.streamDate.slice(5).replace("-", "/") : "",
                  smartPasteResult.surpriseSetName,
                  smartPasteResult.target ? `target $${smartPasteResult.target}` : smartPasteResult.hardFloor ? `hard floor $${smartPasteResult.hardFloor}` : "",
                  `${smartPasteResult.productLines.length} product lines`,
                ].filter(Boolean).join(", ")}.
              </div>
              {smartPasteResult.warnings?.length > 0 && (
                <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
                  {smartPasteResult.warnings.map(warning => <p key={warning}>{warning}</p>)}
                </div>
              )}
            </div>
          )}
        </Card>
      ) : (
        <Card className="p-4">
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center">
            <p className="text-sm font-bold text-gray-900">Selected Set Builder</p>
            <p className="text-xs text-gray-500">Select a set or add one to start building.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button onClick={handleAddAnother} className="inline-flex items-center justify-center rounded-lg border border-slate-800 bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800">Add another surprise set</button>
              <button onClick={handleDownloadAll} disabled={!convertedEntries.length} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">Download all converted files</button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

const WeeklyRaiseView = ({ tickets, replacements, studios, surpriseSets, raiseScores, setRaiseScores, inboundMessages }) => {
  // ── Safe arrays ─────────────────────────────────────────────────────────────
  const safeInbound      = Array.isArray(inboundMessages) ? inboundMessages : [];
  const safeReplacements = Array.isArray(replacements)    ? replacements    : [];
  const activeReplacements = safeReplacements.filter(r => !r.archived_at);
  const safeStudios      = Array.isArray(studios)         ? studios         : [];
  const safeSets         = Array.isArray(surpriseSets)    ? surpriseSets    : [];

  // ── Week range ───────────────────────────────────────────────────────────────
  const week = getWeekRange();

  // ── localStorage-persisted notes (all hooks at top level) ───────────────────
  const [wins,      setWins]      = useState(() => { try { return localStorage.getItem("ops_report_wins_v1")  || ""; } catch { return ""; } });
  const [risks,     setRisks]     = useState(() => { try { return localStorage.getItem("ops_report_risks_v1") || ""; } catch { return ""; } });
  const [nextFocus, setNextFocus] = useState(() => { try { return localStorage.getItem("ops_report_focus_v1") || ""; } catch { return ""; } });
  const [copied,    setCopied]    = useState(false);

  const saveWins      = (v) => { setWins(v);      try { localStorage.setItem("ops_report_wins_v1",  v); } catch {} };
  const saveRisks     = (v) => { setRisks(v);     try { localStorage.setItem("ops_report_risks_v1", v); } catch {} };
  const saveNextFocus = (v) => { setNextFocus(v); try { localStorage.setItem("ops_report_focus_v1", v); } catch {} };

  // ── Core metric counts ───────────────────────────────────────────────────────
  const msgsImported    = safeInbound.filter(m => isThisWeek(m.received_at || m.email_received_at || m.received_time || m.created_at, week.start, week.end)).length || safeInbound.length;
  const needsReply      = getNeedsReplyMessages(safeInbound).length;
  const closedMsgs      = safeInbound.filter(m => m.status === "Closed").length;
  const refundsReviewed = safeInbound.filter(m => isTikTokRefund(m) && !m.archived_at).length;
  const replacementsLogged = activeReplacements.filter(r => isThisWeek(r.created_at || r.date, week.start, week.end)).length || activeReplacements.length;
  const followUpsNeeded = activeReplacements.filter(r => r.followUp === "Yes" || r.follow_up === "Yes").length;
  const studioReady     = safeStudios.filter(s => s.streamReady).length;
  const studioScore     = safeStudios.length ? Math.round((studioReady / safeStudios.length) * 100) : 0;
  const setsReady       = safeSets.filter(s => s.readyForLive).length;
  const draftsGenerated = safeInbound.filter(m => m.ai_draft).length;

  // ── Brand breakdown ──────────────────────────────────────────────────────────
  const brandRows = REPORT_BRANDS.map(brand => ({
    brand,
    open:        getOpenMessages(safeInbound).filter(m => getDisplayBrand(m) === brand).length,
    closed:      safeInbound.filter(m => getDisplayBrand(m) === brand && m.status === "Closed").length,
    refunds:     safeInbound.filter(m => getDisplayBrand(m) === brand && isTikTokRefund(m) && !m.archived_at).length,
    replacements: activeReplacements.filter(r => r.brand === brand).length,
  }));

  // ── Estimated time saved ─────────────────────────────────────────────────────
  const timeMins = (msgsImported * 2) + (draftsGenerated * 5) + (activeReplacements.length * 3) + (setsReady * 5);
  const timeHours = (timeMins / 60).toFixed(1);

  // ── Plain-text summary builder ───────────────────────────────────────────────
  const buildSummary = () => {
    const sep = "─".repeat(52);
    const brandTable = brandRows.map(b =>
      `  ${b.brand.padEnd(18)} open: ${b.open}  closed: ${b.closed}  refunds: ${b.refunds}  replacements: ${b.replacements}`
    ).join("\n");
    return [
      "OPERATIONS IMPACT REPORT",
      week.range,
      sep,
      "",
      "TOP METRICS",
      `  Messages Imported:       ${msgsImported}`,
      `  Needs Reply:             ${needsReply}`,
      `  Closed Messages:         ${closedMsgs}`,
      `  Refunds / Returns:       ${refundsReviewed}`,
      `  Replacements Logged:     ${replacementsLogged}`,
      `  Follow-Ups Needed:       ${followUpsNeeded}`,
      `  Studio Readiness:        ${studioScore}%`,
      `  Surprise Sets Ready:     ${setsReady} of ${safeSets.length}`,
      "",
      "BRAND BREAKDOWN",
      brandTable,
      "",
      "ESTIMATED TIME SAVED",
      `  ~${timeMins} minutes  (~${timeHours} hours)`,
      `  Formula: ${msgsImported} msgs x2 + ${draftsGenerated} drafts x5 + ${activeReplacements.length} replacements x3 + ${setsReady} sets x5`,
      "",
      "PROCESS IMPROVEMENTS / WINS",
      wins || "  None noted.",
      "",
      "RISKS / BLOCKERS",
      risks || "  None noted.",
      "",
      "NEXT WEEK FOCUS",
      nextFocus || "  Not set.",
      "",
      sep,
      `Generated by Ops Command Hub  |  ${new Date().toLocaleString()}`,
    ].join("\n");
  };

  const handleCopy = () => {
    try {
      navigator.clipboard.writeText(buildSummary());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showOpsToast("Could not copy summary. Please copy it manually.", { type: "error" });
    }
  };

  const handleExport = () => {
    const b = new Blob([buildSummary()], { type: "text/plain" });
    const u = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = u;
    a.download = `ops-impact-report-${todayDate()}.txt`;
    a.click();
    URL.revokeObjectURL(u);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Operations Impact Report</h2>
          <p className="text-xs text-gray-400 mt-0.5">Weekly summary of workload, follow-ups, replacements, readiness, and system impact.</p>
          <p className="text-xs text-gray-500 font-medium mt-1">{week.label} <span className="text-gray-400 font-normal">· {week.range}</span></p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handleCopy}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer transition-colors">
            {copied ? "Copied!" : "Copy Summary"}
          </button>
          <button onClick={handleExport}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-700 text-white hover:bg-slate-800 cursor-pointer transition-colors">
            Export TXT
          </button>
        </div>
      </div>

      {/* Top Metric Cards - 4 col on md, 2 col on mobile */}
      <div>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Top Metrics</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <OpsImpactMetricCard label="Messages Imported"       value={msgsImported}      accent />
          <OpsImpactMetricCard label="Needs Reply"             value={needsReply}         sub="status: Needs Reply" />
          <OpsImpactMetricCard label="Closed Messages"         value={closedMsgs} />
          <OpsImpactMetricCard label="Refunds / Returns"       value={refundsReviewed}    sub="TikTok Shop only" />
          <OpsImpactMetricCard label="Replacements Logged"     value={replacementsLogged} />
          <OpsImpactMetricCard label="Follow-Ups Needed"       value={followUpsNeeded}    sub="replacements" />
          <OpsImpactMetricCard label="Studio Readiness"        value={`${studioScore}%`}  sub={`${studioReady} of ${safeStudios.length} ready`} />
          <OpsImpactMetricCard label="Surprise Sets Ready"     value={setsReady}          sub={`of ${safeSets.length} total`} />
        </div>
      </div>

      {/* Brand Breakdown */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <p className="text-xs font-bold text-gray-700">Brand Breakdown</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100">
                {["Brand", "Open", "Closed", "Refunds / Returns", "Replacements"].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {brandRows.map(row => (
                <tr key={row.brand} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-800">{row.brand}</td>
                  <td className="px-4 py-2.5 text-gray-600">{row.open}</td>
                  <td className="px-4 py-2.5 text-gray-600">{row.closed}</td>
                  <td className="px-4 py-2.5 text-gray-600">{row.refunds > 0 ? <span className="font-semibold text-black">{row.refunds}</span> : <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-2.5 text-gray-600">{row.replacements}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Estimated Time Saved */}
      <div className="bg-white border border-gray-200 rounded-lg px-4 py-4">
        <p className="text-xs font-bold text-gray-700 mb-2">Estimated Manual Time Saved</p>
        <div className="flex items-baseline gap-3 mb-2">
          <span className="text-3xl font-bold text-slate-800">{timeMins}</span>
          <span className="text-sm text-gray-500">minutes</span>
          <span className="text-lg font-semibold text-slate-600 ml-2">{timeHours}</span>
          <span className="text-sm text-gray-500">hours</span>
        </div>
        <p className="text-[10px] text-gray-400 leading-relaxed">
          Formula: {msgsImported} messages x 2 min + {draftsGenerated} AI drafts x 5 min + {activeReplacements.length} replacements x 3 min + {setsReady} sets x 5 min
        </p>
      </div>

      {/* Editable Notes */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Process Improvements / Wins This Week</label>
          <textarea
            value={wins}
            onChange={e => saveWins(e.target.value)}
            rows={3}
            placeholder="Example: Improved intake reliability, cleared refunds faster, logged replacement cases, completed surprise set setup."
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-700 placeholder-gray-400 resize-none focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Risks / Blockers</label>
          <textarea
            value={risks}
            onChange={e => saveRisks(e.target.value)}
            rows={3}
            placeholder="Example: TikTok DMs still require manual checks, replacement follow-ups need review, surprise set sheet import not automated yet."
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-700 placeholder-gray-400 resize-none focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Next Week's Focus</label>
          <textarea
            value={nextFocus}
            onChange={e => saveNextFocus(e.target.value)}
            rows={2}
            placeholder="Example: Improve AI reply tone, polish mobile inbox, add export for replacements, build morning brief agent."
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-700 placeholder-gray-400 resize-none focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
        </div>
      </div>
    </div>
  );
};

// ─── DATA MANAGEMENT ──────────────────────────────────────────────────────────
const parsePriceCheckCsv = (text) => {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(text || "");
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(cell);
      if (row.some(value => String(value || "").trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some(value => String(value || "").trim() !== "")) rows.push(row);
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map(header => String(header || "").trim());
  return { headers, rows: rows.slice(1).map(cells => headers.map((_, index) => cells[index] ?? "")) };
};

const priceCheckHeaderKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const findPriceCheckHeader = (headers, ...names) => {
  const keys = headers.map(priceCheckHeaderKey);
  return names.map(name => keys.indexOf(priceCheckHeaderKey(name))).find(index => index >= 0) ?? -1;
};
const csvEscape = (value) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const buildCsvText = (headers, rows) => [headers, ...rows].map(row => row.map(csvEscape).join(",")).join("\r\n");
const PRICE_CHECK_MATCH_STORAGE_KEY = "ops_price_check_tcg_mappings_v1";
const downloadTextFile = (content, fileName, type = "text/csv;charset=utf-8") => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};
const parsePriceNumber = (value) => {
  const number = Number(String(value ?? "").replace(/[$,]/g, "").trim());
  return Number.isFinite(number) ? number : null;
};
const formatPrice = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "";
};
const roundPriceUpToFiveCents = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return Math.ceil((number - 0.000001) * 20) / 20;
};
const getPriceCheckTitleFlags = (title) => {
  const lower = String(title || "").toLowerCase();
  return [
    lower.includes("combo") ? "Title contains combo" : null,
    lower.includes("premium pack") ? "Title contains premium pack" : null,
    lower.includes("rippiez") ? "Title contains Rippiez" : null,
    lower.includes("electric vault") ? "Title contains Electric Vault" : null,
    lower.includes("heart of gold") ? "Title contains Heart of Gold" : null,
    lower.includes("ultra vault") ? "Title contains Ultra Vault" : null,
    lower.includes("auction") ? "Title contains auction" : null,
    lower.includes("mystery") ? "Title contains mystery" : null,
    lower.includes("secret series") ? "Title contains Secret Series" : null,
    lower.includes("poke premium pack") ? "Title contains Poke Premium Pack" : null,
    lower.includes("raw pkmn single") ? "Title contains Raw PKMN Single" : null,
    lower.includes("mtg single card") ? "Title contains MTG Single Card" : null,
    lower.includes("vaulted rarities") ? "Title contains Vaulted Rarities" : null,
  ].filter(Boolean);
};
const isPriceCheckCustomProduct = (title) => getPriceCheckTitleFlags(title).length > 0;
const getPriceCheckAutoStatus = (title) => {
  const lower = String(title || "").toLowerCase();
  if (lower.includes("raw pkmn single") || lower.includes("mtg single card")) return "Needs Manual Price";
  return isPriceCheckCustomProduct(title) ? "Do Not Price" : "Needs TCG Check";
};
const stripPriceCheckHtml = (value) => String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const normalizePriceCheckMappingPart = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const getPriceCheckMappingKey = (row = {}) => [
  normalizePriceCheckMappingPart(row.handle),
  normalizePriceCheckMappingPart(row.sku),
  normalizePriceCheckMappingPart(row.title),
].join("|");
const loadPriceCheckMappings = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(PRICE_CHECK_MATCH_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};
const savePriceCheckMappings = (mappings) => {
  try { localStorage.setItem(PRICE_CHECK_MATCH_STORAGE_KEY, JSON.stringify(mappings || {})); } catch {}
};
const extractTcgProductId = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const patterns = [
    /\/product\/(\d+)/i,
    /[?&](?:productId|productid|ProductID)=(\d+)/,
    /\bproduct(?:id)?[=/:-](\d+)\b/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return match[1];
  }
  return /^\d+$/.test(raw) ? raw : "";
};
const cleanTcgSearchQuery = (title) => String(title || "")
  .replace(/\bMagic:\s*The\s*Gathering\s*-\s*/ig, "")
  .replace(/\bMTG\s*-\s*/ig, "")
  .replace(/\bPok[eé]mon\s*-\s*/ig, "")
  .replace(/\bPok[eé]mon\b/ig, "")
  .replace(/^\s*\d+\s*x\s+/i, "")
  .replace(/\s+/g, " ")
  .trim();
const getPriceCheckComputed = (row) => {
  const tcg = parsePriceNumber(row.tcgAverage);
  const current = parsePriceNumber(row.currentPrice);
  const override = parsePriceNumber(row.overrideFinalPrice);
  const suggested = tcg == null ? "" : tcg * 1.15;
  const rounded = override != null ? override : (suggested === "" ? "" : roundPriceUpToFiveCents(suggested));
  const diff = rounded !== "" && current != null ? rounded - current : "";
  const changePct = diff !== "" && current > 0 ? Math.abs(diff / current) : 0;
  const flags = [
    ...getPriceCheckTitleFlags(row.title),
    Number(row.inventoryQty || 0) === 0 ? "Inventory quantity is 0" : null,
    tcg == null ? "No TCG average entered" : null,
    changePct > 0.3 ? "Suggested price changes more than 30%" : null,
  ].filter(Boolean);
  const status =
    row.status === "Approved" ? "Approved" :
    row.status === "Skipped" ? "Skipped" :
    row.status === "Do Not Price" ? "Do Not Price" :
    row.status === "Needs Manual Price" ? "Needs Manual Price" :
    tcg == null ? "Needs TCG Check" :
    flags.length > 0 ? "Needs Review" :
    "TCG Price Entered";
  return { tcg, current, suggested, rounded, diff, changePct, flags, status };
};

const PriceCheckView = () => {
  const [sourceName, setSourceName] = useState("");
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState("");
  const [processing, setProcessing] = useState(false);
  const [viewMode, setViewMode] = useState("Card Review");
  const [activeFilter, setActiveFilter] = useState("All");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [manualRowId, setManualRowId] = useState(null);
  const [manualPrice, setManualPrice] = useState("");
  const [manualNote, setManualNote] = useState("");
  const titleIndex = findPriceCheckHeader(headers, "Title", "Product Title");
  const handleIndex = findPriceCheckHeader(headers, "Handle");
  const skuIndex = findPriceCheckHeader(headers, "Variant SKU", "SKU");
  const priceIndex = findPriceCheckHeader(headers, "Variant Price", "Price");
  const hasRequiredHeaders = headers.length > 0 && titleIndex >= 0 && handleIndex >= 0 && skuIndex >= 0 && priceIndex >= 0;
  const reviewRows = rows.map(row => ({ ...row, computed: getPriceCheckComputed(row) }));
  const filteredRows = reviewRows.filter(row => {
    if (activeFilter === "Ready to Approve") return row.computed.status === "TCG Price Entered";
    if (activeFilter === "Needs Match") return !row.tcgProductUrl && !row.tcgProductId && row.computed.status !== "Do Not Price";
    if (activeFilter === "Already Matched") return Boolean(row.tcgProductUrl || row.tcgProductId);
    if (activeFilter === "Needs Review") return row.computed.status === "Needs Review" || row.computed.status === "Needs TCG Check";
    if (activeFilter === "Approved") return row.computed.status === "Approved";
    if (activeFilter === "Skipped") return row.computed.status === "Skipped";
    if (activeFilter === "Do Not Price") return row.computed.status === "Do Not Price";
    if (activeFilter === "Needs Manual Price") return row.computed.status === "Needs Manual Price";
    if (activeFilter === "Ready for Live Check") return Boolean(row.tcgProductUrl || row.tcgProductId) && row.computed.status === "TCG Price Entered";
    return true;
  });
  const activeRow = filteredRows[Math.min(currentIndex, Math.max(0, filteredRows.length - 1))] || null;
  const approvedCount = reviewRows.filter(row => row.computed.status === "Approved").length;
  const needsReviewCount = reviewRows.filter(row => row.computed.status === "Needs Review" || row.computed.status === "Needs TCG Check").length;
  const readyCount = reviewRows.filter(row => row.computed.status === "TCG Price Entered").length;
  const skippedCount = reviewRows.filter(row => row.computed.status === "Skipped").length;
  const doNotPriceCount = reviewRows.filter(row => row.computed.status === "Do Not Price").length;

  const updateRow = (id, patch) => setRows(prev => prev.map(row => row.id === id ? { ...row, ...patch } : row));
  const moveCard = (delta) => setCurrentIndex(prev => {
    const max = Math.max(0, filteredRows.length - 1);
    return Math.min(max, Math.max(0, prev + delta));
  });
  const moveNextAfterAction = () => setTimeout(() => moveCard(1), 0);

  const handleFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setProcessing(true);
    setMessage("");
    const reader = new FileReader();
    reader.onload = () => {
      setTimeout(() => {
        const parsed = parsePriceCheckCsv(reader.result);
        if (!parsed.headers.length) {
          setMessage("No rows found in that CSV.");
          setHeaders([]);
          setRows([]);
          setProcessing(false);
          return;
        }
        const nextTitleIndex = findPriceCheckHeader(parsed.headers, "Title", "Product Title");
        const nextHandleIndex = findPriceCheckHeader(parsed.headers, "Handle");
        const nextSkuIndex = findPriceCheckHeader(parsed.headers, "Variant SKU", "SKU");
        const nextPriceIndex = findPriceCheckHeader(parsed.headers, "Variant Price", "Price");
        const nextQtyIndex = findPriceCheckHeader(parsed.headers, "Variant Inventory Qty", "Variant Inventory Quantity", "Inventory Quantity");
        const nextImageIndex = findPriceCheckHeader(parsed.headers, "Image Src", "Image URL", "Variant Image", "Image");
        const nextBodyIndex = findPriceCheckHeader(parsed.headers, "Body (HTML)", "Body HTML", "Description", "Short Description");
        const savedMappings = loadPriceCheckMappings();
        const normalized = parsed.rows.map((cells, index) => {
          const title = cells[nextTitleIndex] || "";
          const customFlags = getPriceCheckTitleFlags(title);
          const autoStatus = getPriceCheckAutoStatus(title);
          const baseRow = {
            id: `price-${Date.now()}-${index}`,
            originalCells: cells,
            title,
            handle: cells[nextHandleIndex] || "",
            sku: cells[nextSkuIndex] || "",
            currentPrice: cells[nextPriceIndex] || "",
            inventoryQty: nextQtyIndex >= 0 ? cells[nextQtyIndex] || "0" : "0",
            imageSrc: nextImageIndex >= 0 ? cells[nextImageIndex] || "" : "",
            description: nextBodyIndex >= 0 ? stripPriceCheckHtml(cells[nextBodyIndex]) : "",
            tcgAverage: "",
            tcgProductUrl: "",
            tcgProductId: "",
            matchSavedAt: "",
            overrideFinalPrice: "",
            status: autoStatus,
            notes: customFlags.length ? `Auto ${autoStatus}: ${customFlags.join("; ")}` : "",
          };
          const saved = savedMappings[getPriceCheckMappingKey(baseRow)];
          return saved ? {
            ...baseRow,
            tcgProductUrl: saved.tcgProductUrl || "",
            tcgProductId: saved.tcgProductId || "",
            matchSavedAt: saved.saved_at || "",
          } : baseRow;
        });
        setSourceName(file.name);
        setHeaders(parsed.headers);
        setRows(normalized);
        setCurrentIndex(0);
        setActiveFilter("All");
        setViewMode("Card Review");
        setMessage(`Loaded ${normalized.length} Shopify row${normalized.length === 1 ? "" : "s"} from ${file.name}.`);
        setProcessing(false);
      }, 650);
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const approveRow = (row) => {
    const computed = getPriceCheckComputed(row);
    if (computed.tcg == null || computed.rounded === "") {
      updateRow(row.id, { status: "Needs TCG Check", notes: "Enter a TCG verified average before approving." });
      return;
    }
    updateRow(row.id, { status: "Approved", notes: computed.flags.length ? `Approved with review flags: ${computed.flags.join("; ")}` : row.notes });
    moveNextAfterAction();
  };
  const openManualPrice = (row) => {
    const rowIndex = rows.findIndex(item => item.id === row.id);
    if (rowIndex >= 0) {
      setActiveFilter("All");
      setCurrentIndex(rowIndex);
      setViewMode("Card Review");
    }
    setManualRowId(row.id);
    setManualPrice(row.computed.rounded === "" ? "" : formatPrice(row.computed.rounded));
    setManualNote(row.notes || "");
  };
  const saveManualPrice = () => {
    const price = parsePriceNumber(manualPrice);
    if (price == null) {
      setMessage("Enter a valid manual final price.");
      return;
    }
    updateRow(manualRowId, { overrideFinalPrice: formatPrice(price), status: "Approved", notes: manualNote || "Manual final price override approved." });
    setManualRowId(null);
    setManualPrice("");
    setManualNote("");
    moveNextAfterAction();
  };
  const skipRow = (row) => {
    updateRow(row.id, { status: "Skipped" });
    moveNextAfterAction();
  };
  const doNotPriceRow = (row) => {
    updateRow(row.id, { status: "Do Not Price" });
    moveNextAfterAction();
  };
  const updateTcgUrl = (row, value) => {
    const productId = extractTcgProductId(value);
    updateRow(row.id, { tcgProductUrl: value, tcgProductId: productId || row.tcgProductId });
  };
  const updateTcgProductId = (row, value) => updateRow(row.id, { tcgProductId: extractTcgProductId(value) || value });
  const findOnTcgplayer = (row) => {
    const query = cleanTcgSearchQuery(row.title);
    if (!query) return;
    window.open(`https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(query)}`, "_blank", "noopener,noreferrer");
  };
  const saveTcgMatch = (row) => {
    const productId = row.tcgProductId || extractTcgProductId(row.tcgProductUrl);
    if (!row.tcgProductUrl && !productId) {
      setMessage("Add a TCGplayer Product URL or Product ID before saving the match.");
      return;
    }
    const saved_at = nowISO();
    const mappings = loadPriceCheckMappings();
    mappings[getPriceCheckMappingKey(row)] = {
      tcgProductUrl: row.tcgProductUrl || "",
      tcgProductId: productId || "",
      saved_at,
    };
    savePriceCheckMappings(mappings);
    updateRow(row.id, { tcgProductId: productId || "", matchSavedAt: saved_at });
    setMessage("TCGplayer match saved locally.");
  };
  const clearTcgMatch = (row) => {
    const mappings = loadPriceCheckMappings();
    delete mappings[getPriceCheckMappingKey(row)];
    savePriceCheckMappings(mappings);
    updateRow(row.id, { tcgProductUrl: "", tcgProductId: "", matchSavedAt: "" });
  };
  const exportApprovedShopifyCsv = () => {
    if (!hasRequiredHeaders || priceIndex < 0) {
      setMessage("Upload a Shopify CSV with Title, Handle, Variant SKU, and Variant Price columns first.");
      return;
    }
    const outputRows = rows.map(row => {
      const computed = getPriceCheckComputed(row);
      const nextCells = [...row.originalCells];
      if (computed.status === "Approved" && computed.rounded !== "") nextCells[priceIndex] = formatPrice(computed.rounded);
      return headers.map((_, index) => nextCells[index] ?? "");
    });
    downloadTextFile(buildCsvText(headers, outputRows), `shopify-approved-price-update-${todayDate()}.csv`);
  };
  const exportAuditCsv = () => {
    const auditHeaders = ["Product title", "SKU", "Old price", "New price", "TCG average", "Status", "Notes"];
    const auditRows = reviewRows.map(row => [
      row.title,
      row.sku,
      row.currentPrice,
      row.computed.status === "Approved" && row.computed.rounded !== "" ? formatPrice(row.computed.rounded) : row.currentPrice,
      row.tcgAverage,
      row.computed.status,
      [row.notes, ...row.computed.flags].filter(Boolean).join("; "),
    ]);
    downloadTextFile(buildCsvText(auditHeaders, auditRows), `price-review-audit-${todayDate()}.csv`);
  };

  if (!rows.length && !processing) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-xl p-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900">Shopify Price Review</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-gray-500">Import your Shopify product export to begin reviewing prices.</p>
          <label className="mt-6 inline-flex cursor-pointer items-center justify-center rounded-lg border border-slate-800 bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800">
            Import Product Sheet
            <input type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
          </label>
        </Card>
      </div>
    );
  }

  if (processing) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-xl p-8">
          <p className="text-xl font-bold text-gray-900">Loading products...</p>
          <div className="mt-5 space-y-3">
            {["Reading Shopify CSV", "Finding Variant Price", "Detecting custom products", "Building review queue"].map((item, index) => (
              <div key={item} className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <span className={`h-2 w-2 rounded-full ${index === 3 ? "bg-slate-700" : "bg-slate-300"}`} />
                <span className="text-sm font-semibold text-gray-700">{item}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  const statusClass = (status) =>
    status === "Approved" ? "border-slate-200 bg-slate-50 text-slate-700" :
    status === "Needs Review" || status === "Needs TCG Check" ? "border-amber-200 bg-amber-50 text-amber-800" :
    status === "Needs Manual Price" ? "border-orange-200 bg-orange-50 text-orange-800" :
    status === "Do Not Price" ? "border-gray-300 bg-gray-100 text-gray-600" :
    status === "Skipped" ? "border-gray-200 bg-gray-50 text-gray-500" :
    "border-gray-200 bg-white text-gray-600";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Shopify Price Review</h2>
          <p className="mt-0.5 text-xs text-gray-400">{sourceName ? `Source file: ${sourceName}` : "Manual TCGplayer average review. Export-only."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50">
            Import Product Sheet
            <input type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
          </label>
          <BtnPrimary onClick={exportApprovedShopifyCsv} disabled={!rows.length || !approvedCount}>Export Approved Shopify CSV</BtnPrimary>
          <BtnSecondary onClick={exportAuditCsv} disabled={!rows.length}>Export Review Audit CSV</BtnSecondary>
        </div>
      </div>

      {message && <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-700">{message}</div>}
      {!hasRequiredHeaders && headers.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800">This CSV is missing one or more required Shopify columns: Title, Handle, Variant SKU, Variant Price.</div>}

      <Card className="p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-sm font-bold text-gray-900">Product {filteredRows.length ? Math.min(currentIndex + 1, filteredRows.length) : 0} of {filteredRows.length}</p>
            <p className="text-xs text-gray-400">{rows.length} uploaded products in this review queue.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[["Approved", approvedCount], ["Needs Review", needsReviewCount], ["Ready to Approve", readyCount], ["Skipped", skippedCount], ["Do Not Price", doNotPriceCount]].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
                <p className="text-lg font-bold text-gray-900">{value}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
          {["All", "Needs Match", "Already Matched", "Ready to Approve", "Needs Review", "Needs Manual Price", "Ready for Live Check", "Approved", "Skipped", "Do Not Price"].map(filter => (
            <button key={filter} onClick={() => { setActiveFilter(filter); setCurrentIndex(0); }} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${activeFilter === filter ? "border-slate-800 bg-slate-700 text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}>{filter}</button>
          ))}
          <div className="ml-auto flex rounded-lg border border-gray-300 bg-white p-0.5">
            {["Card Review", "Table View"].map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)} className={`rounded-md px-3 py-1 text-xs font-semibold ${viewMode === mode ? "bg-slate-700 text-white" : "text-gray-600 hover:bg-gray-50"}`}>{mode}</button>
            ))}
          </div>
        </div>
      </Card>

      {viewMode === "Card Review" && activeRow && (
        <Card className="overflow-hidden">
          <div className="grid gap-0 lg:grid-cols-[340px_1fr]">
            <div className="border-b border-gray-100 bg-gray-50 p-4 lg:border-b-0 lg:border-r">
              {activeRow.imageSrc ? (
                <img src={activeRow.imageSrc} alt={activeRow.title} className="aspect-square w-full rounded-lg border border-gray-200 bg-white object-contain" />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-300">No product image</div>
              )}
              {activeRow.description && <p className="mt-3 line-clamp-6 text-xs leading-relaxed text-gray-500">{activeRow.description}</p>}
            </div>
            <div className="p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{activeRow.title || "Untitled product"}</h3>
                  <p className="mt-1 text-xs text-gray-400">{activeRow.handle || "No handle"} · SKU {activeRow.sku || "-"}</p>
                </div>
                <Badge label={activeRow.computed.status} className={statusClass(activeRow.computed.status)} />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                {[["Current Variant Price", formatPrice(activeRow.computed.current) || "-"], ["Variant Inventory Qty", activeRow.inventoryQty || "0"], ["Suggested price", activeRow.computed.suggested === "" ? "-" : formatPrice(activeRow.computed.suggested)], ["Final rounded price", activeRow.computed.rounded === "" ? "-" : formatPrice(activeRow.computed.rounded)]].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
                    <p className="mt-1 text-lg font-bold text-gray-900">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-[220px_1fr]">
                <label className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">TCG average / baseline</span>
                  <Inp type="number" value={activeRow.tcgAverage} onChange={value => updateRow(activeRow.id, { tcgAverage: value, status: value ? "TCG Price Entered" : "Needs TCG Check" })} placeholder="0.00" />
                </label>
                <div className="rounded-lg border border-gray-100 bg-white px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Difference from current price</p>
                  <p className={`mt-1 text-lg font-bold ${Number(activeRow.computed.diff) > 0 ? "text-emerald-700" : Number(activeRow.computed.diff) < 0 ? "text-red-700" : "text-gray-700"}`}>{activeRow.computed.diff === "" ? "-" : `${Number(activeRow.computed.diff) >= 0 ? "+" : ""}${formatPrice(activeRow.computed.diff)}`}</p>
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold text-gray-900">TCGplayer Match</p>
                  <Badge
                    label={activeRow.matchSavedAt ? "Match Saved" : activeRow.tcgProductUrl || activeRow.tcgProductId ? "Unsaved Match" : "Needs Match"}
                    className={activeRow.matchSavedAt ? "border-slate-200 bg-slate-50 text-slate-700" : activeRow.tcgProductUrl || activeRow.tcgProductId ? "border-amber-200 bg-amber-50 text-amber-800" : "border-gray-200 bg-white text-gray-500"}
                  />
                </div>
                <div className="grid gap-2 lg:grid-cols-[1fr_180px_auto_auto_auto]">
                  <Inp value={activeRow.tcgProductUrl || ""} onChange={value => updateTcgUrl(activeRow, value)} placeholder="TCGplayer Product URL" />
                  <Inp value={activeRow.tcgProductId || ""} onChange={value => updateTcgProductId(activeRow, value)} placeholder="Product ID" />
                  <BtnSecondary onClick={() => findOnTcgplayer(activeRow)}>Find on TCGplayer</BtnSecondary>
                  <BtnPrimary onClick={() => saveTcgMatch(activeRow)}>Save Match</BtnPrimary>
                  <button onClick={() => clearTcgMatch(activeRow)} className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50">Clear Match</button>
                </div>
                {activeRow.matchSavedAt && <p className="mt-2 text-[10px] font-medium text-gray-400">Saved {fmtDate(activeRow.matchSavedAt)}</p>}
              </div>
              {activeRow.computed.flags.length > 0 && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Safety flags</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-800">{activeRow.computed.flags.join("; ")}</p>
                </div>
              )}
              {activeRow.notes && <p className="mt-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-500">{activeRow.notes}</p>}

              {manualRowId === activeRow.id && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-bold text-gray-900">Manual Price</p>
                  <div className="mt-2 grid gap-2 md:grid-cols-[180px_1fr_auto]">
                    <Inp type="number" value={manualPrice} onChange={setManualPrice} placeholder="Final price" />
                    <Inp value={manualNote} onChange={setManualNote} placeholder="Optional approval note" />
                    <BtnPrimary onClick={saveManualPrice}>Save Manual Price</BtnPrimary>
                  </div>
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
                <BtnPrimary onClick={() => approveRow(activeRow)} disabled={activeRow.computed.rounded === ""}>Approve Price</BtnPrimary>
                <BtnSecondary onClick={() => openManualPrice(activeRow)}>Manual Price</BtnSecondary>
                <BtnSecondary onClick={() => skipRow(activeRow)}>Skip</BtnSecondary>
                <button onClick={() => doNotPriceRow(activeRow)} className="inline-flex items-center justify-center rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 transition-colors hover:bg-orange-100">Do Not Price</button>
                <div className="ml-auto flex gap-2">
                  <BtnSecondary onClick={() => moveCard(-1)} disabled={currentIndex <= 0}>Previous</BtnSecondary>
                  <BtnSecondary onClick={() => moveCard(1)} disabled={currentIndex >= filteredRows.length - 1}>Next</BtnSecondary>
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {viewMode === "Card Review" && !activeRow && (
        <Card className="p-10 text-center text-sm font-medium text-gray-300">No products match this filter.</Card>
      )}

      {viewMode === "Table View" && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-gray-900">Review Table</p>
              <p className="text-xs text-gray-400">Only approved rows export with changed Variant Price.</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1680px] w-full text-left text-xs">
              <thead className="border-y border-gray-100 bg-gray-50 text-gray-500">
                <tr>{["Product title", "Handle", "Variant SKU", "Current Variant Price", "Variant Inventory Qty", "TCG verified average", "Suggested price", "Final rounded price", "Difference", "Status", "Actions"].map(label => <th key={label} className="px-3 py-2 font-bold">{label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredRows.map(row => {
                  const c = row.computed;
                  return (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-semibold text-gray-800">{row.title || "-"}</td>
                      <td className="px-3 py-2 text-gray-500">{row.handle || "-"}</td>
                      <td className="px-3 py-2 font-mono text-gray-600">{row.sku || "-"}</td>
                      <td className="px-3 py-2 font-mono text-gray-700">{formatPrice(c.current)}</td>
                      <td className="px-3 py-2 font-mono text-gray-700">{row.inventoryQty || "0"}</td>
                      <td className="px-3 py-2"><Inp type="number" value={row.tcgAverage} onChange={value => updateRow(row.id, { tcgAverage: value, status: value ? "TCG Price Entered" : "Needs TCG Check" })} placeholder="0.00" className="w-28" /></td>
                      <td className="px-3 py-2 font-mono text-gray-700">{c.suggested === "" ? "-" : formatPrice(c.suggested)}</td>
                      <td className="px-3 py-2"><Inp type="number" value={row.overrideFinalPrice} onChange={value => updateRow(row.id, { overrideFinalPrice: value, status: value ? "Needs Review" : row.status })} placeholder={c.rounded === "" ? "Override" : formatPrice(c.rounded)} className="w-28" /></td>
                      <td className={`px-3 py-2 font-mono ${Number(c.diff) > 0 ? "text-emerald-700" : Number(c.diff) < 0 ? "text-red-700" : "text-gray-500"}`}>{c.diff === "" ? "-" : `${Number(c.diff) >= 0 ? "+" : ""}${formatPrice(c.diff)}`}</td>
                      <td className="px-3 py-2"><Badge label={c.status} className={statusClass(c.status)} />{c.flags.length > 0 && <p className="mt-1 max-w-[220px] text-[10px] leading-relaxed text-amber-700">{c.flags.join("; ")}</p>}</td>
                      <td className="px-3 py-2"><div className="flex flex-wrap gap-1.5"><button onClick={() => approveRow(row)} className="rounded border border-slate-800 bg-slate-700 px-2 py-1 text-[10px] font-semibold text-white hover:bg-slate-800">Approve Price</button><button onClick={() => openManualPrice(row)} className="rounded border border-gray-300 bg-white px-2 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50">Manual Price</button><button onClick={() => skipRow(row)} className="rounded border border-gray-300 bg-white px-2 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50">Skip</button><button onClick={() => doNotPriceRow(row)} className="rounded border border-orange-200 bg-orange-50 px-2 py-1 text-[10px] font-semibold text-orange-700 hover:bg-orange-100">Do Not Price</button></div></td>
                    </tr>
                  );
                })}
                {!filteredRows.length && <tr><td colSpan={11} className="px-3 py-10 text-center text-sm font-medium text-gray-300">No products match this filter.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};

const DataManagementView = ({ tickets, replacements, studios, surpriseSets, setTickets, setReplacements, setStudios, setSurpriseSets, raiseScores, setInboundMessages }) => {
const [importErr, setImportErr] = useState("");
const [clearErr, setClearErr] = useState("");
const [saved, setSaved] = useState(false);
const safeReplacements = Array.isArray(replacements) ? replacements : [];
const safeStudios = Array.isArray(studios) ? studios : [];
const safeSurpriseSets = Array.isArray(surpriseSets) ? surpriseSets : [];
const safeTickets = Array.isArray(tickets) ? tickets : [];

  const dl = (data, name, type) => {
    const b = new Blob([data], { type }); const u = URL.createObjectURL(b);
    const a = document.createElement("a"); a.href = u; a.download = name; a.click();
    URL.revokeObjectURL(u);
  };

  const exportJSON = () => {
    const data = { tickets: safeTickets, replacements: safeReplacements, studios: safeStudios, surpriseSets: safeSurpriseSets, exportedAt: nowISO() };
    dl(JSON.stringify(data, null, 2), `jonny-ops-backup-${todayDate()}.json`, "application/json");
  };
  const exportTicketsCSV = () => {
    const rows = safeTickets.map(t => [t.id, `"${t.brand}"`, `"${t.channel}"`, `"${t.issueType}"`, t.priority, t.slaRisk, t.status, `"${t.notes?.replace(/"/g, '""')}"`, `"${t.nextAction?.replace(/"/g, '""')}"`, t.createdAt]);
    dl([["ID", "Brand", "Channel", "Issue Type", "Priority", "SLA Risk", "Status", "Notes", "Next Action", "Created At"], ...rows].map(r => r.join(",")).join("\n"), `tiktok-tickets-${todayDate()}.csv`, "text/csv");
  };
  const exportReplacementsCSV = () => {
    const rows = safeReplacements.map(r => [r.id, r.date, `"${r.brand}"`, r.orderNum, `"${r.reason?.replace(/"/g, '""')}"`, `"${r.rootCause}"`, r.marketValue, r.preventable, r.followUp, `"${r.notes?.replace(/"/g, '""')}"`]);
    dl([["ID", "Date", "Brand", "Order #", "Reason", "Root Cause", "Market Value", "Preventable", "Follow-Up", "Notes"], ...rows].map(r => r.join(",")).join("\n"), `replacement-log-${todayDate()}.csv`, "text/csv");
  };
  const exportReport = () => {
    const rpt = buildFullReport({ tickets: safeTickets, replacements: safeReplacements, studios: safeStudios, surpriseSets: safeSurpriseSets, raiseScores, improvements: "", risks: "", nextFocus: "" });
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

// ── req 7: Clear All deletes every ticket from Supabase (hard delete) ──
const clearAll = async () => {
  setClearErr("");
  try {
    if (supabase) {
      const { error } = await supabase
        .from(INBOUND_MESSAGES_TABLE)
        .delete()
        .not("id", "is", null);
      if (error) throw error;
    }
    if (setInboundMessages) setInboundMessages([]);
    showOpsToast("Command Inbox queue cleared.");
  } catch (err) {
    console.error("Clear all failed:", err);
    setClearErr(`Clear failed: ${err.message || "Unknown Supabase error"}`);
  }
};

  const resetFresh = () => {
    setTickets([]);
    setReplacements([]);
    setStudios(FRESH_STUDIOS);
    setSurpriseSets([]);
    showOpsToast("Fresh local data loaded.");
  };

  const confirmResetFresh = () => {
    showOpsConfirm({
      title: "Clear this data?",
      body: "This will reset tickets, replacements, studios, and surprise sets in the local app state.",
      confirmLabel: "Clear",
      variant: "clear",
      onConfirm: resetFresh,
    });
  };

  const confirmClearAll = () => {
    showOpsConfirm({
      title: "Clear this data?",
      body: "This will erase all Command Inbox queue rows from Supabase. This cannot be undone from the app.",
      confirmLabel: "Clear",
      variant: "clear",
      onConfirm: clearAll,
    });
  };

  return (
    <div className="space-y-4">
      <div><h2 className="text-2xl font-bold text-gray-900">Data Management</h2><p className="text-xs text-gray-400 mt-0.5">Export, import, and manage your ops data</p></div>

      {saved && <div className="bg-green-50 border border-green-300 rounded-lg px-4 py-3 text-green-800 text-sm font-medium">Data imported successfully.</div>}
{importErr && <div className="bg-red-50 border border-red-300 rounded-lg px-4 py-3 text-red-800 text-sm">{importErr}</div>}
{clearErr && <div className="bg-red-50 border border-red-300 rounded-lg px-4 py-3 text-red-800 text-sm">{clearErr}</div>}

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <p className="text-sm font-bold text-gray-900 mb-1">Export JSON Backup</p>
          <p className="text-xs text-gray-400 mb-3">Full backup - tickets, replacements, studios, sets</p>
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
          <p className="text-xs text-gray-400 mb-3">{safeTickets.length} tickets to spreadsheet</p>
          <BtnSecondary onClick={exportTicketsCSV} size="md">Export Tickets CSV</BtnSecondary>
        </Card>
        <Card className="p-4">
          <p className="text-sm font-bold text-gray-900 mb-1">Export Replacements CSV</p>
          <p className="text-xs text-gray-400 mb-3">{safeReplacements.length} cases to spreadsheet</p>
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
            {[["Tickets", safeTickets.length], ["Replacements", safeReplacements.length], ["Studios tracked", safeStudios.length], ["Surprise sets", safeSurpriseSets.length]].map(([k, v]) => <div key={k} className="flex justify-between text-xs"><span className="text-gray-400">{k}</span><span className="font-semibold text-gray-800">{v}</span></div>)}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <p className="text-sm font-bold text-gray-900 mb-3">Reset &amp; Clear</p>
        <div className="flex gap-2">
          <BtnSecondary onClick={confirmResetFresh} size="md">Reset to Fresh Data</BtnSecondary>
          <BtnDanger onClick={confirmClearAll} size="md">Clear All Data</BtnDanger>
        </div>
      </Card>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <p className="text-sm font-bold text-slate-800 mb-1">Supabase Sync Active</p>
        <p className="text-xs text-slate-600">Command Inbox data is read from and written to your Supabase <code className="font-mono bg-white border border-slate-200 px-1 rounded">{INBOUND_MESSAGES_TABLE}</code> table. Export a JSON backup regularly for off-database safety.</p>
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
  const [activeView, setActiveViewRaw] = useState(() => {
    const VALID_VIEWS = new Set(["dashboard","inbox","replacements","studio","pricecheck","sets","weekly","data"]);
    try {
      const saved = localStorage.getItem("ops_active_view");
      if (saved && VALID_VIEWS.has(saved)) return saved;
    } catch {}
    return "dashboard";
  });
  const setActiveView = (v) => {
    setActiveViewRaw(v);
    try { localStorage.setItem("ops_active_view", v); } catch {}
  };
  const [tickets, setTickets] = useState([]);
  const [replacements, setReplacements] = useState([]);
  const [studios, setStudios] = useState(() => {
    try {
      const saved = localStorage.getItem("ops_studios_v1");
      if (saved) return JSON.parse(saved);
    } catch {}
    return FRESH_STUDIOS;
  });
  const [surpriseSets, setSurpriseSets] = useState(() => loadWeeklySurpriseSets());
  const [raiseScores, setRaiseScores] = useState({ consistency: 72, accuracy: 68, lossReduction: 55, ownership: 80, processImprovement: 60 });
  const [sidebar, setSidebar] = useState(() => {
    try {
      const saved = localStorage.getItem("ops_sidebar_expanded");
      if (saved != null) return saved === "true";
    } catch {}
    return false;
  });
  const [appLocked, setAppLocked] = useState(() => {
    try {
      if (localStorage.getItem(SHELL_UNLOCK_STORAGE_KEY) === "yes") return false;
      const saved = localStorage.getItem("ops_command_hub_locked");
      if (saved != null) return saved === "true";
    } catch {}
    return false;
  });
  const [sidekickToast, setSidekickToast] = useState(false);

  // ── Inbox state ──────────────────────────────────────────────────────────────
  const [inboundMessages, setInboundMessages] = useState([]);
  const [inboundLoading, setInboundLoading] = useState(false);
  const [inboundError, setInboundError] = useState("");
  const inboundWatcherInitialized = useRef(false);
  const [assistantToast, setAssistantToast] = useState(null);
  const [opsToasts, setOpsToasts] = useState([]);
  const [confirmConfig, setConfirmConfig] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [recentNewMessageCount, setRecentNewMessageCount] = useState(0);
  const [lastInboxSyncAt, setLastInboxSyncAt] = useState("");
  const [inboxFilter, setInboxFilter] = useState(null);

  const refreshInbox = async () => {
    setInboundLoading(true);
    setInboundError("");
    const { data, error } = await fetchInboundMessagesFromSupabase();
    setInboundLoading(false);
    if (error) { setInboundError(`Inbox fetch failed: ${error.message}`); return; }
    setInboundMessages(data);
    setLastInboxSyncAt(nowISO());
  };

  // ── Next Actions state ────────────────────────────────────────────────────────
  const [opsActions, setOpsActions] = useState([]);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsError, setOpsError]     = useState("");

  const refreshOpsActions = async () => {
    setOpsLoading(true);
    setOpsError("");
    const { data, error } = await fetchOpsActionsFromSupabase();
    setOpsLoading(false);
    if (error) { setOpsError(`Actions fetch failed: ${error.message}`); return; }
    setOpsActions(data);
  };

  // ── Automation Rules state ────────────────────────────────────────────────────
  const [automationRules, setAutomationRules]           = useState([]);
  const [automationRulesLoading, setAutomationRulesLoading] = useState(false);
  const [automationRulesError, setAutomationRulesError]     = useState("");

  // ── Replacements state ────────────────────────────────────────────────────────
  const [replacementsLoading, setReplacementsLoading] = useState(false);
  const [replacementsError,   setReplacementsError]   = useState("");
  const [replacementFocus, setReplacementFocus] = useState(null);

  const refreshReplacements = async () => {
    setReplacementsLoading(true);
    setReplacementsError("");
    const { data, error } = await fetchReplacementsFromSupabase();
    setReplacementsLoading(false);
    if (error) { setReplacementsError(`Replacements fetch failed: ${error.message}`); return; }
    setReplacements(data);
  };

  // Fetch active tickets from Supabase on mount (archived_at IS NULL, auto-age filter applied inside)
  useEffect(() => {
    const fetchTickets = async () => {
      const { data } = await fetchTicketsFromSupabase();
      if (data) setTickets(data);
    };
    fetchTickets();
  }, []);

  // Fetch inbound messages on mount
  useEffect(() => { refreshInbox(); }, []);

  useEffect(() => {
    const safeMessages = Array.isArray(inboundMessages) ? inboundMessages : [];
    if (!safeMessages.length) return;

    const latestTime = Math.max(...safeMessages.map(message => getMessageSortTimestamp(message)).filter(Boolean));
    if (!Number.isFinite(latestTime) || latestTime <= 0) return;

    const storedValue = Number(localStorage.getItem(LAST_SEEN_MESSAGE_STORAGE_KEY) || 0);
    if (!inboundWatcherInitialized.current) {
      inboundWatcherInitialized.current = true;
      if (latestTime > storedValue) {
        localStorage.setItem(LAST_SEEN_MESSAGE_STORAGE_KEY, String(latestTime));
      }
      return;
    }

    if (latestTime <= storedValue) return;

    const newMessages = safeMessages.filter(message => getMessageSortTimestamp(message) > storedValue);
    const newCount = newMessages.length;
    const latestMessage = [...newMessages].sort((a, b) => getMessageSortTimestamp(b) - getMessageSortTimestamp(a))[0];
    const hasRefundUpdate = newMessages.some(message => isTikTokRefund(message));
    const brand = latestMessage ? getDisplayBrand(latestMessage) : "Unassigned";
    const message =
      hasRefundUpdate ? "Refund queue updated." :
      newCount === 1 && brand !== "Unassigned" ? `New ${brand} message received.` :
      `${newCount} new message${newCount !== 1 ? "s" : ""} came in.`;

    setRecentNewMessageCount(newCount);
    setAssistantToast({ id: Date.now(), title: "Assistant update", message });
    localStorage.setItem(LAST_SEEN_MESSAGE_STORAGE_KEY, String(latestTime));
  }, [inboundMessages]);

  useEffect(() => {
    if (!assistantToast) return undefined;
    const timer = setTimeout(() => setAssistantToast(null), 5000);
    return () => clearTimeout(timer);
  }, [assistantToast]);

  useEffect(() => {
    const handleToast = (event) => {
      const toast = event.detail || {};
      const id = toast.id || Date.now();
      setOpsToasts(prev => [...prev, { ...toast, id }].slice(-4));
      setTimeout(() => {
        setOpsToasts(prev => prev.filter(item => item.id !== id));
      }, 4200);
    };
    const handleConfirm = (event) => {
      setConfirmConfig(event.detail || null);
      setConfirmBusy(false);
    };
    window.addEventListener("ops-hub-toast", handleToast);
    window.addEventListener("ops-hub-confirm", handleConfirm);
    return () => {
      window.removeEventListener("ops-hub-toast", handleToast);
      window.removeEventListener("ops-hub-confirm", handleConfirm);
    };
  }, []);

  const handleConfirmCancel = () => {
    if (confirmBusy) return;
    setConfirmConfig(null);
  };

  const handleConfirmRun = async () => {
    if (!confirmConfig?.onConfirm) {
      setConfirmConfig(null);
      return;
    }
    setConfirmBusy(true);
    try {
      await confirmConfig.onConfirm();
      setConfirmConfig(null);
    } catch (err) {
      showOpsToast(err?.message || "Action failed.", { type: "error" });
    } finally {
      setConfirmBusy(false);
    }
  };

  // Fetch ops actions on mount
  useEffect(() => { refreshOpsActions(); }, []);

  // Fetch replacements on mount
  useEffect(() => { refreshReplacements(); }, []);

  // Persist studio readiness to localStorage whenever it changes
  useEffect(() => {
    try { localStorage.setItem("ops_studios_v1", JSON.stringify(studios)); } catch {}
  }, [studios]);

  useEffect(() => {
    try { localStorage.setItem("ops_sidebar_expanded", String(sidebar)); } catch {}
  }, [sidebar]);

  // Persist weekly surprise set setup locally until a Supabase workflow exists
  useEffect(() => {
    try {
      localStorage.setItem(SURPRISE_SET_STORAGE_KEY, JSON.stringify({
        weekStart: getWeekStartISO(),
        items: surpriseSets,
      }));
    } catch {}
  }, [surpriseSets]);

  // Fetch automation rules on mount (non-blocking - queue falls back to safe defaults on error)
  useEffect(() => {
    const load = async () => {
      setAutomationRulesLoading(true);
      const { data, error } = await fetchAutomationRulesFromSupabase();
      setAutomationRulesLoading(false);
      if (error) { setAutomationRulesError(error.message); return; }
      setAutomationRules(data);
    };
    load();
  }, []);

  // OP Sidekick - INSERT into Supabase, then refresh list
  useEffect(() => {
    const ticket = getSidekickTicketFromHash();
    if (!ticket) return;

    const insertSidekickTicket = async () => {
      const { data, error } = await insertTicketToSupabase({ ...ticket, source: "OP Sidekick" });
      if (error) {
        showOpsToast(`Sidekick ticket save failed: ${error.message || "Unknown Supabase error"}`, { type: "error" });
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

  const safeInboundMessages = Array.isArray(inboundMessages) ? inboundMessages : [];
  const safeReplacements = Array.isArray(replacements) ? replacements : [];
  const safeStudios = Array.isArray(studios) ? studios : [];
  const safeSurpriseSets = Array.isArray(surpriseSets) ? surpriseSets : [];
  const safeTickets = Array.isArray(tickets) ? tickets : [];
  const safeOpsActions = Array.isArray(opsActions) ? opsActions : [];

  const openCommandInbox = (filter = { kind: "open" }) => {
    setInboxFilter({ ...filter, requestedAt: Date.now() });
    setActiveView("inbox");
  };

  const openCount = safeTickets.filter(t => t.status !== "Resolved").length;
  const criticalSlaCount = safeTickets.filter(isActiveSlaRisk).length;
  const inboxNeedsReplyCount = safeInboundMessages.filter(m => m.status === "Needs Reply" || !m.status).length;
  const opsOpenCount = safeOpsActions.length;
  const agentOverdueMessages = getOverdueMessages(safeInboundMessages);
  const agentRefundMessages = getRefundMessages(safeInboundMessages);
  const agentHighPriorityMessages = getHighPriorityMessages(safeInboundMessages);
  const agentAlertCount = [
    agentOverdueMessages.length > 0,
    agentRefundMessages.length > 0,
    agentHighPriorityMessages.length > 0,
  ].filter(Boolean).length;

  const renderView = () => {
    const common = { tickets, setTickets, replacements, setReplacements, studios, setStudios, surpriseSets, setSurpriseSets, raiseScores, setRaiseScores, setInboundMessages };
    switch (activeView) {
      case "dashboard": return <DashboardView {...common} inboundMessages={inboundMessages} opsActions={opsActions} openCommandInbox={openCommandInbox} newMessageNoticeCount={recentNewMessageCount} />;
      case "inbox": return <CommandInboxView inboundMessages={inboundMessages} setInboundMessages={setInboundMessages} inboundLoading={inboundLoading} inboundError={inboundError} onRefresh={refreshInbox} setTickets={setTickets} replacements={replacements} setReplacements={setReplacements} setActiveView={setActiveView} setReplacementFocus={setReplacementFocus} inboxFilter={inboxFilter} onClearInboxFilter={() => setInboxFilter(null)} opsActions={opsActions} setOpsActions={setOpsActions} automationRules={automationRules} automationRulesLoading={automationRulesLoading} />;
      case "actions": return <NextActionQueueView opsActions={opsActions} setOpsActions={setOpsActions} opsLoading={opsLoading} opsError={opsError} onRefresh={refreshOpsActions} setActiveView={setActiveView} />;
      case "daily": return <DailyCommandView tickets={tickets} />;
      case "tickets": return <TicketQueueView tickets={tickets} setTickets={setTickets} />;
      case "browser": return <BrowserProfileView />;
      case "cs": return <CSTemplateView setTickets={setTickets} />;
      case "replacements": return <ReplacementLogView replacements={replacements} setReplacements={setReplacements} replacementsLoading={replacementsLoading} replacementsError={replacementsError} onRefresh={refreshReplacements} replacementFocus={replacementFocus} />;
      case "studio": return <StudioReadinessView studios={studios} setStudios={setStudios} />;
      case "pricecheck": return <PriceCheckView />;
      case "sets": return <SurpriseSetView surpriseSets={surpriseSets} setSurpriseSets={setSurpriseSets} />;
      case "weekly": return <WeeklyRaiseView tickets={tickets} replacements={replacements} studios={studios} surpriseSets={surpriseSets} raiseScores={raiseScores} setRaiseScores={setRaiseScores} inboundMessages={inboundMessages} />;
      case "data": return <DataManagementView {...common} />;
      default: return <DashboardView {...common} inboundMessages={inboundMessages} opsActions={opsActions} openCommandInbox={openCommandInbox} newMessageNoticeCount={recentNewMessageCount} />;
    }
  };

  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Current page label for mobile top bar
  const PAGE_LABELS = {
    dashboard: "Dashboard", inbox: "Command Inbox", actions: "Action Queue",
    daily: "Daily Command Board", tickets: "Tickets", replacements: "Replacements",
    studio: "Inventory", pricecheck: "Price Check", sets: "Surprise Sets", browser: "Browser Profiles",
    cs: "CS Templates", weekly: "Reports", data: "Settings",
  };

  // Nav click: close mobile drawer then switch view
  const handleNavClick = (id) => {
    setActiveView(id);
    setMobileNavOpen(false);
  };

  const lockWorkspace = () => {
    try {
      localStorage.removeItem(SHELL_UNLOCK_STORAGE_KEY);
      localStorage.setItem("ops_command_hub_locked", "true");
    } catch {}
    setAppLocked(true);
    const root = document.getElementById("root");
    const passwordScreen = document.getElementById("password-screen");
    if (root) root.style.display = "none";
    if (passwordScreen) passwordScreen.style.display = "flex";
    window.location.reload();
  };

  const requestWorkspaceLock = () => {
    showOpsConfirm({
      title: "Lock Ops Command Hub?",
      body: "This will return the app to the password screen. You will need to unlock it again before continuing.",
      confirmLabel: "Lock Workspace",
      variant: "lock",
      onConfirm: lockWorkspace,
    });
  };

  // Shared nav content rendered inside both the desktop sidebar and the mobile drawer
  const NavContent = ({ showLabels }) => (
    <>
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 space-y-1.5">
        {NAV.map((section, si) => (
          <div key={si}>
            <div className="space-y-0.5">
              {section.items.map(item => (
                <NavItem key={item.id} {...item} active={activeView === item.id} onClick={handleNavClick}
                  showLabel={showLabels}
                  badge={item.id === "tickets" ? criticalSlaCount : item.id === "inbox" ? inboxNeedsReplyCount : item.id === "actions" ? opsOpenCount : 0} />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#f3f4f6", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <OpsToastStack toasts={opsToasts} onDismiss={id => setOpsToasts(prev => prev.filter(item => item.id !== id))} />
      <OpsConfirmModal config={confirmConfig} onCancel={handleConfirmCancel} onConfirm={handleConfirmRun} busy={confirmBusy} />

      {/* Sidekick toast */}
      {sidekickToast && (
        <div className="fixed right-4 bottom-20 z-[9999] flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-700 px-4 py-3 text-sm font-semibold text-white shadow-lg" role="status">
          <span>Saved.</span>
          <span>Ticket pushed from OP Sidekick.</span>
        </div>
      )}

      {assistantToast && (
        <div className="fixed right-4 top-16 z-[9999] w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-4 shadow-lg" role="status">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-gray-900">{assistantToast.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">{assistantToast.message}</p>
            </div>
            <button
              onClick={() => setAssistantToast(null)}
              className="text-xs font-semibold text-gray-400 transition-colors hover:text-gray-700"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── MOBILE DRAWER BACKDROP ── */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* ── MOBILE SLIDE-OUT DRAWER ── */}
      <div className={`fixed inset-y-0 left-0 z-50 w-72 bg-white flex flex-col shadow-xl transition-transform duration-200 md:hidden ${mobileNavOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {/* Drawer header */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex-1 overflow-hidden">
            <p className="text-sm font-bold text-gray-900">Ops Command Hub</p>
            <p className="text-[10px] text-gray-400">Command Center v3.0</p>
          </div>
          <button onClick={() => setMobileNavOpen(false)} className="text-xs font-semibold text-gray-400 hover:text-gray-700 p-1">Close</button>
        </div>
        <NavContent showLabels={true} />
      </div>

      {/* ── DESKTOP SIDEBAR (hidden on mobile) ── */}
      <aside
        style={{ width: sidebar ? 224 : 56, transition: "width .2s" }}
        className="hidden md:flex flex-shrink-0 bg-white border-r border-gray-200 flex-col overflow-hidden"
      >
        <nav className={`flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 ${sidebar ? "space-y-1.5" : "space-y-1"}`}>
          <button
            onClick={() => setSidebar(s => !s)}
            title={sidebar ? "Collapse sidebar" : "Expand sidebar"}
            className={`mb-3 flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 shadow-sm transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-800 ${sidebar ? "ml-auto" : "mx-auto"}`}
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className={`transition-transform ${sidebar ? "" : "rotate-180"}`}>
              <path d="M9 4 6 7.5 9 11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {NAV.map((section, si) => (
            <div key={si}>
              <div className={sidebar ? "space-y-0.5" : "space-y-1"}>
                {section.items.map(item => (
                  <NavItem key={item.id} {...item} active={activeView === item.id} onClick={setActiveView}
                    showLabel={sidebar}
                    badge={item.id === "tickets" ? criticalSlaCount : item.id === "inbox" ? inboxNeedsReplyCount : item.id === "actions" ? opsOpenCount : 0} />
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* ── MOBILE TOP BAR (hidden on desktop) ── */}
        <div className="flex md:hidden items-center justify-between bg-white border-b border-gray-200 px-4 py-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            {/* Hamburger */}
            <button
              onClick={() => setMobileNavOpen(true)}
              className="text-gray-600 hover:text-gray-900 p-1 -ml-1"
              aria-label="Open menu"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </button>
            <div>
              <p className="text-sm font-bold text-gray-900 leading-tight">Ops Command Hub v3.0</p>
              <p className="text-[10px] text-gray-400 leading-tight">{PAGE_LABELS[activeView] || activeView}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {criticalSlaCount > 0 && (
              <button onClick={() => handleNavClick("tickets")} className="flex items-center gap-1 bg-red-50 border border-red-200 rounded-lg px-2 py-1 cursor-pointer">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-bold text-red-700">{criticalSlaCount}</span>
              </button>
            )}
            <button
              onClick={() => openCommandInbox({ kind: "open" })}
              className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800"
              aria-label="Open notifications"
              title="Notifications"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2a5 5 0 0 1 5 5v3l2 2H2l2-2V7a5 5 0 0 1 5-5z" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M7 15.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              {inboxNeedsReplyCount > 0 && (
                <span className="absolute -top-1 -right-1 text-[9px] bg-red-500 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">{inboxNeedsReplyCount > 9 ? "9+" : inboxNeedsReplyCount}</span>
              )}
            </button>
            <button
              type="button"
              onClick={requestWorkspaceLock}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-gray-50 hover:text-slate-900"
              aria-label="Lock Workspace"
              title="Lock Workspace"
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <rect x="3.25" y="6.25" width="8.5" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M5.25 6.25V4.75a2.25 2.25 0 0 1 4.5 0v1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-gray-100 text-[10px] font-bold text-gray-700">
              JV
            </div>
          </div>
        </div>

        {/* ── DESKTOP TOP BAR (hidden on mobile) ── */}
        <header className="hidden md:flex bg-white border-b border-gray-200 px-6 py-3 items-center justify-between flex-shrink-0">
          <p className="text-sm font-bold text-gray-900">Ops Command Hub v3.0</p>
          <div className="flex items-center gap-3">
            <NotificationDropdown
              inboundMessages={safeInboundMessages}
              opsActions={safeOpsActions}
              replacements={safeReplacements}
              setActiveView={setActiveView}
              openCommandInbox={openCommandInbox}
              agentAlertCount={agentAlertCount}
            />
            <SystemStatusPanel
              inboundMessages={safeInboundMessages}
              inboundLoading={inboundLoading}
              inboundError={inboundError}
              lastSyncAt={lastInboxSyncAt}
            />
            <button
              type="button"
              onClick={requestWorkspaceLock}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-gray-50 hover:text-slate-900"
              aria-label="Lock Workspace"
              title="Lock Workspace"
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <rect x="3.25" y="6.25" width="8.5" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M5.25 6.25V4.75a2.25 2.25 0 0 1 4.5 0v1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-gray-100 text-xs font-bold text-gray-700">
              JV
            </div>
          </div>
        </header>

        {/* ── PAGE CONTENT ── */}
        <main className="flex-1 overflow-y-auto pb-16 md:pb-0" style={{ background: "#f3f4f6" }}>
          <div className="mx-auto max-w-[1440px] px-3 py-4 md:px-6 md:py-6">{renderView()}</div>
        </main>

        {/* ── MOBILE BOTTOM QUICK NAV ── */}
        <nav className="flex md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-200 safe-area-inset-bottom">
          {[
            { id: "dashboard",    label: "Home",         badge: 0,
              icon: <path d="M2 2h5v5H2zm7 0h5v5H9zM2 9h5v5H2zm7 0h5v5H9z" fill="currentColor" opacity=".7" /> },
            { id: "inbox",        label: "Inbox",        badge: inboxNeedsReplyCount,
              icon: <><rect x="1" y="3" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M1 6l7 4 7-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></> },
            { id: "replacements", label: "Reship",       badge: 0,
              icon: <><rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M5 5h6M5 8h6M5 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></> },
            { id: "studio",       label: "Inventory",    badge: 0,
              icon: <><rect x="1" y="5" width="6" height="9" rx="1" stroke="currentColor" strokeWidth="1.3" fill="none"/><rect x="9" y="2" width="6" height="12" rx="1" stroke="currentColor" strokeWidth="1.3" fill="none"/></> },
            { id: "weekly",       label: "Reports",      badge: 0,
              icon: <path d="M2 12l3-5 3 2 3-6 3 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/> },
          ].map(item => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 relative transition-colors ${isActive ? "text-slate-700" : "text-gray-400 hover:text-gray-700"}`}
              >
                <svg width="20" height="20" viewBox="0 0 16 16" fill="none" className={isActive ? "text-slate-700" : "text-gray-400"}>
                  {item.icon}
                </svg>
                <span className="text-[9px] font-medium leading-tight">{item.label}</span>
                {item.badge > 0 && (
                  <span className="absolute top-1.5 right-1/4 translate-x-1/2 bg-red-500 text-white text-[8px] font-bold rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-0.5">
                    {item.badge > 9 ? "9+" : item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}







