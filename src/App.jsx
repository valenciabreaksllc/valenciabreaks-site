import { useState, useEffect, useCallback } from "react";
import { createClient } from '@supabase/supabase-js';

// ─── SUPABASE CLIENT ──────────────────────────────────────────────────────────
const supabaseUrl = "https://hljotjdrgabhmqgorbpo.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhsam90amRyZ2FiaG1xZ29yYnBvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NjYzMzAsImV4cCI6MjA5NDE0MjMzMH0.KojT8NA3qias7s-ljAN92LTnpBWvtbJwxvAAUU5FIIw";
const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
const MAKE_INTAKE_WEBHOOK_URL = "https://hook.us2.make.com/ndd4uty3uvua7lmgqxg9lsmjvd61i3ih";

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
const SURPRISE_SET_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const SURPRISE_SET_STREAMS = [
  { key: "am", label: "AM Shift", time: "7:00 AM - 3:00 PM" },
  { key: "pm", label: "PM Shift", time: "3:30 PM - 11:30 PM" },
];
const SURPRISE_SET_STATUS_OPTIONS = ["Not Started", "Built", "Checked", "Live Ready"];
const SURPRISE_SET_TRACKER_BRANDS = [
  { brand: "Vaulted Rarities", code: "VR" },
  { brand: "PokeSpins", code: "PS" },
  { brand: "CardKing47", code: "CK" },
  { brand: "Pokiemart", code: "PM" },
];
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

const normalizeSurpriseSetBrandValue = (brandValue) => {
  const raw = String(brandValue || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "vr" || raw.includes("vaulted")) return "Vaulted Rarities";
  if (raw === "ps" || raw.includes("pokespins") || raw.includes("poke spins")) return "PokeSpins";
  if (raw === "ck" || raw === "ck47" || raw.includes("cardking47") || raw.includes("card king 47")) return "CardKing47";
  if (raw === "pm" || raw.includes("pokiemart") || raw.includes("pokie mart")) return "Pokiemart";
  return BRANDS.includes(brandValue) ? brandValue : "";
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

const getSetSheetSummary = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  return {
    totalRows: safeRows.length,
    totalQuantity: safeRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    unknownCount: safeRows.filter(row => row.type === "unknown").length,
  };
};

const escapeSpreadsheetCell = (value) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const buildSetSheetSpreadsheet = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const rowXml = safeRows.map(row => `
    <Row>
      <Cell><Data ss:Type="String">${escapeSpreadsheetCell(row.productName)}</Data></Cell>
      <Cell><Data ss:Type="Number">${Number(row.quantity || 0)}</Data></Cell>
      <Cell><Data ss:Type="${row.weight === "" ? "String" : "Number"}">${escapeSpreadsheetCell(row.weight)}</Data></Cell>
      <Cell><Data ss:Type="${row.height === "" ? "String" : "Number"}">${escapeSpreadsheetCell(row.height)}</Data></Cell>
      <Cell><Data ss:Type="${row.width === "" ? "String" : "Number"}">${escapeSpreadsheetCell(row.width)}</Data></Cell>
      <Cell><Data ss:Type="${row.length === "" ? "String" : "Number"}">${escapeSpreadsheetCell(row.length)}</Data></Cell>
    </Row>`).join("");
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="SetSheet">
    <Table>
      <Row>
        <Cell><Data ss:Type="String">Product Name</Data></Cell>
        <Cell><Data ss:Type="String">Quantity</Data></Cell>
        <Cell><Data ss:Type="String">Weight</Data></Cell>
        <Cell><Data ss:Type="String">Height</Data></Cell>
        <Cell><Data ss:Type="String">Width</Data></Cell>
        <Cell><Data ss:Type="String">Length</Data></Cell>
      </Row>${rowXml}
    </Table>
  </Worksheet>
</Workbook>`;
};

const downloadSetSheetRows = (rows, fileName) => {
  const workbook = buildSetSheetSpreadsheet(rows);
  const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeSetSheetFileName(fileName)}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
    "Refund request": `${greeting}\n\nI've received your refund request for ${oNum} and I'm reviewing it right away. We take all refund requests seriously and want to make sure this is handled fairly for you.\n\nTo process this quickly, could you confirm:\n• The reason for the refund request\n• Whether the item is still sealed or has been opened\n• Your preferred resolution - refund or replacement\n\nI'll follow up within 1 business day once I have those details.${sign}`,
    "Return request": `${greeting}\n\nThank you for reaching out about ${oNum}. I've received your return request and I'm reviewing your order now.\n\nTo make sure I process this correctly, could you confirm:\n• Whether the item is sealed or opened\n• The reason for the return request\n\nI'll follow up within 1 business day with next steps.${sign}`,
    "Surprise set dispute": `${greeting}\n\nThank you for reaching out about ${oNum}. I want to make sure this gets resolved for you.\n\nSurprise sets are curated ahead of each stream, and contents may vary from what is shown during live. To investigate your concern, could you please:\n• Share a short unboxing video or photos of the contents received\n• Describe the specific concern with the set\n\nOnce I've reviewed the details, I'll follow up with next steps.${sign}`,
    "Missing item": `${greeting}\n\nI'm sorry to hear ${oNum} arrived with a missing item - that's not the experience we want for you.\n\nTo investigate and process a resolution, could you please send:\n• A photo of the package as it arrived (outside and inside)\n• A photo of all items included in the shipment\n• A photo of the packing slip, if one was included\n\nI'll review everything and get back to you within 24 hours.${sign}`,
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

const ProgressBar = ({ pct, color = "bg-slate-500" }) => (
  <div className="w-full bg-gray-200 rounded-full h-1.5">
    <div className={`${color} h-1.5 rounded-full transition-all`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
  </div>
);

const BtnPrimary = ({ children, onClick, size = "sm", disabled = false }) => (
  <button onClick={onClick} disabled={disabled} className={`inline-flex items-center gap-1.5 bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold rounded-lg border border-slate-800 transition-colors cursor-pointer ${size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"}`}>{children}</button>
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
  <select value={value} onChange={e => onChange(e.target.value)} className={`bg-white border border-gray-300 text-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-500 w-full ${className}`}>
    {placeholder && <option value="">{placeholder}</option>}
    {options.map(o => <option key={o} value={o}>{o}</option>)}
  </select>
);
const Inp = ({ value, onChange, placeholder, type = "text", className = "" }) => (
  <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={`bg-white border border-gray-300 text-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-500 w-full placeholder-gray-400 ${className}`} />
);
const Txt = ({ value, onChange, placeholder, rows = 3, className = "" }) => (
  <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} className={`bg-white border border-gray-300 text-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-500 w-full placeholder-gray-400 resize-none ${className}`} />
);
const Chk = ({ checked, onChange, label }) => (
  <label className="flex items-center gap-2.5 cursor-pointer group">
    <div onClick={() => onChange(!checked)} className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${checked ? "bg-slate-700 border-slate-700" : "border-gray-300 hover:border-slate-400"}`}>
      {checked && <span className="text-white text-[9px] font-bold">✓</span>}
    </div>
    <span className={`text-sm ${checked ? "line-through text-gray-400" : "text-gray-700 group-hover:text-gray-900"}`}>{label}</span>
  </label>
);
const FL = ({ children }) => <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{children}</p>;

// ─── PATCH 3: ArchiveBtn - reusable trash icon button ────────────────────────
const ArchiveBtn = ({ ticketId, setTickets }) => {
  const handleArchive = async () => {
    const confirmed = window.confirm("Archive this ticket from the active queue?");
    if (!confirmed) return;
    const { error } = await archiveTicketInSupabase(ticketId, "manual archive");
    if (error) {
      alert(`Archive failed: ${error.message || "Unknown Supabase error"}`);
      return;
    }
    setTickets(prev => prev.filter(t => t.id !== ticketId));
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
  weekly: <path d="M2 12l3-5 3 2 3-6 3 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>,
  data: <><ellipse cx="8" cy="4" rx="5" ry="2" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M3 4v4c0 1.1 2.24 2 5 2s5-.9 5-2V4" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M3 8v4c0 1.1 2.24 2 5 2s5-.9 5-2V8" stroke="currentColor" strokeWidth="1.3" fill="none"/></>,
  inbox: <><rect x="1" y="3" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M1 6l7 4 7-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></>,
  actions: <><path d="M2 4h9M2 8h7M2 12h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="12" cy="11" r="3" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M14.5 13.5l1.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></>,
};
const NavItem = ({ id, label, active, onClick, badge, showLabel = true }) => (
  <button
    onClick={() => onClick(id)}
    title={!showLabel ? label : undefined}
    className={`relative w-full flex items-center ${showLabel ? "gap-2.5 px-3 justify-start" : "justify-center px-0"} py-2 rounded-lg text-sm font-medium transition-all text-left overflow-hidden ${active ? "bg-slate-700 text-white" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"}`}
  >
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={`flex-shrink-0 ${active ? "text-white" : "text-gray-400"}`}>{ICONS[id]}</svg>
    {showLabel && <span className="flex-1 truncate">{label}</span>}
    {badge > 0 && showLabel && <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">{badge}</span>}
    {badge > 0 && !showLabel && <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />}
  </button>
);

const NAV = [
  { section: null, items: [{ id: "dashboard", label: "Dashboard" }, { id: "inbox", label: "Command Inbox" }] },
  { section: "Operations", items: [{ id: "replacements", label: "Replacements" }, { id: "studio", label: "Inventory" }, { id: "sets", label: "Surprise Sets" }] },
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
  Critical: "bg-red-100 text-red-800 border-red-300",
  High:     "bg-red-50 text-red-700 border-red-200",
  Medium:   "bg-amber-50 text-amber-700 border-amber-200",
  Low:      "bg-gray-100 text-gray-600 border-gray-200",
};
const ACTION_STATUS_STYLE = {
  "Open":                "bg-blue-50 text-blue-700 border-blue-200",
  "In Progress":         "bg-purple-50 text-purple-700 border-purple-200",
  "Waiting on Customer": "bg-amber-50 text-amber-700 border-amber-200",
  "Replacement Needed":  "bg-orange-50 text-orange-700 border-orange-200",
  "Completed":           "bg-green-50 text-green-700 border-green-200",
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
    if (error) { alert(`Update failed: ${error.message}`); return; }
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
          { label: "Open",         count: openCount,     cls: "border-l-blue-500"  },
          { label: "Due Today",    count: dueTodayCount, cls: "border-l-amber-500" },
          { label: "Overdue",      count: overdueCount,  cls: "border-l-red-500"   },
          { label: "High Priority",count: highCount,     cls: "border-l-orange-500"},
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
                  {overdue && <Badge label="Overdue" className="bg-red-100 text-red-700 border-red-300" />}
                </div>
                {dueDisplay && (
                  <span className={`text-[10px] flex-shrink-0 whitespace-nowrap font-medium ${overdue ? "text-red-600" : "text-gray-400"}`}>{dueDisplay}</span>
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
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 disabled:opacity-50 cursor-pointer transition-colors">
                    In Progress
                  </button>
                )}
                {action.status !== "Waiting on Customer" && (
                  <button disabled={isBusy} onClick={() => handleStatus(action.id, "Waiting on Customer")}
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50 cursor-pointer transition-colors">
                    Waiting
                  </button>
                )}
                <button disabled={isBusy} onClick={() => handleStatus(action.id, "Completed")}
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50 cursor-pointer transition-colors">
                  ✓ Complete
                </button>
                {action.inbound_message_id && (
                  <button onClick={() => setActiveView("inbox")}
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors">
                    Open Message ↗
                  </button>
                )}
                {action.ticket_id && (
                  <button onClick={() => setActiveView("tickets")}
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors">
                    Open Ticket ↗
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
    .from("inbound_messages")
    .select("*")
    .is("archived_at", null)
    .order("received_at", { ascending: false })
    .limit(200);
  if (error) { console.error("Supabase inbound fetch error:", error); return { data: [], error }; }
  return { data: data || [], error: null };
};

const updateInboundStatusInSupabase = async (id, status) => {
  if (!supabase || !id) return { error: null };
  const { error } = await supabase
    .from("inbound_messages")
    .update({ status, updated_at: nowISO() })
    .eq("id", id);
  if (error) console.error("Supabase inbound status update error:", error);
  return { error };
};

const archiveInboundInSupabase = async (id) => {
  if (!supabase || !id) return { error: { message: "No Supabase client or id." } };
  const { error } = await supabase
    .from("inbound_messages")
    .update({ archived_at: nowISO(), updated_at: nowISO() })
    .eq("id", id);
  if (error) console.error("Supabase inbound archive error:", error);
  return { error };
};

// ─── REPLACEMENTS SUPABASE HELPERS ───────────────────────────────────────────

const fetchReplacementsFromSupabase = async () => {
  if (!supabase) return { data: [], error: { message: "No Supabase client." } };
  const { data, error } = await supabase
    .from("replacements")
    .select("id, date, brand, customer_name, order_number, reason, root_cause, replacement_items, notes, value, preventable, follow_up, status, archived_at, created_at, updated_at")
    .is("archived_at", null)
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
  if (!isTikTokShopMessage(msg)) {
    return { displayName: null, displayBody: msg.message_body || "", hasHistory: false };
  }

  const nameFromSubject = extractTikTokCustomerName(msg.subject);

  // Detect history presence before cleaning
  const rawLines = (msg.message_body || "").split(/\r?\n/).map(l => l.trim());
  const hasHistory = rawLines.some(l => /^your previous chat with\b/i.test(l));

  const displayBody = cleanTikTokBody(msg.message_body, nameFromSubject);

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


// ─── INBOX PRIORITY / STATUS STYLES ──────────────────────────────────────────
const INBOX_PRIORITY_STYLE = {
  "High":   "bg-red-50 text-red-700 border-red-200",
  "Medium": "bg-amber-50 text-amber-700 border-amber-200",
  "Low":    "bg-gray-100 text-gray-600 border-gray-200",
};
const INBOX_STATUS_STYLE = {
  "Needs Reply":    "bg-blue-50 text-blue-700 border-blue-200",
  "In Progress":   "bg-purple-50 text-purple-700 border-purple-200",
  "Ticket Created":"bg-cyan-50 text-cyan-700 border-cyan-200",
  "Closed":        "bg-green-50 text-green-700 border-green-200",
};
const TRIAGE_STATUS_STYLE = {
  "Untriaged":          "bg-gray-100 text-gray-500 border-gray-200",
  "Triaged":            "bg-teal-50 text-teal-700 border-teal-200",
  "Needs Human Review": "bg-orange-50 text-orange-700 border-orange-200",
  "Noise / Not CS":     "bg-gray-100 text-gray-400 border-gray-200",
  "High Priority":      "bg-red-50 text-red-700 border-red-200",
};
const RISK_LEVEL_STYLE = {
  "High":   "bg-red-50 text-red-700 border-red-200",
  "Medium": "bg-amber-50 text-amber-700 border-amber-200",
  "Low":    "bg-gray-100 text-gray-500 border-gray-200",
};
const INBOX_FILTER_OPTIONS = ["All", "TikTok Shop Chat", "Refunds / Returns", "Shopify", "Outlook", "Noise / Not CS", "Untriaged", "Needs Human Review", "High Priority", "Closed", "Archived"];

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
  const brand = String(msg.brand || "").trim();
  const rawBrand = brand.toLowerCase();
  if (brand && rawBrand !== "unassigned" && rawBrand !== "unknown") {
    return inferInboxBrandFromText(brand) || brand;
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
  const recv = msg.email_received_at;
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
  "TikTok Shop Chat": "bg-black text-white border-black",
  "TikTok Refund":    "bg-black text-white border-black",
  "Shopify":          "bg-green-700 text-white border-green-800",
  "Outlook":          "bg-slate-600 text-white border-slate-700",
  "Noise":            "bg-gray-200 text-gray-500 border-gray-300",
  "Other":            "bg-gray-100 text-gray-500 border-gray-200",
};

// Derive the best display title for a card given its source type.
const getInboundCardTitle = (msg, sourceType, displayName) => {
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
const CommandInboxView = ({ inboundMessages, setInboundMessages, inboundLoading, inboundError, onRefresh, setTickets, opsActions, setOpsActions, automationRules, automationRulesLoading }) => {
  const [busyId, setBusyId]     = useState(null);
  const [activeFilter, setActiveFilter] = useState("All");
  const [sortMode, setSortMode] = useState("Newest first");
  const [collapsedDrafts, setCollapsedDrafts] = useState({});
  const [expandedMessages, setExpandedMessages] = useState({});
  const emptyManualMessageForm = {
    platform: "TikTok DM",
    brand: "",
    customerName: "",
    sender: "",
    subject: "",
    body: "",
    priority: "Medium",
    notes: "",
  };
  const [manualMessageOpen, setManualMessageOpen] = useState(false);
  const [manualMessageSaving, setManualMessageSaving] = useState(false);
  const [manualMessageForm, setManualMessageForm] = useState(emptyManualMessageForm);

  const safeInboundMessages = Array.isArray(inboundMessages) ? inboundMessages : [];
  const safeOpsActions = Array.isArray(opsActions) ? opsActions : [];

  const needsReply    = safeInboundMessages.filter(m => m.status === "Needs Reply" || !m.status).length;
  const inProgress    = safeInboundMessages.filter(m => m.status === "In Progress").length;
  const ticketCreated = safeInboundMessages.filter(m => m.status === "Ticket Created").length;
  const complete      = safeInboundMessages.filter(m => m.status === "Closed" || m.status === "Archived" || m.archived_at).length;
  const openMessages  = safeInboundMessages.filter(m => m.status !== "Closed" && m.status !== "Archived" && !m.archived_at).length;

  // ── filter logic ─────────────────────────────────────────────────────────────
  const isUntriaged = (m) => !m.triage_status || m.triage_status === "Untriaged";
  const filtered = safeInboundMessages.filter(m => {
    if (activeFilter === "All")                 return true;
    if (activeFilter === "TikTok Shop Chat")      return classifyInboundSource(m) === "TikTok Shop Chat";
    if (activeFilter === "Refunds / Returns")   return classifyInboundSource(m) === "TikTok Refund";
    if (activeFilter === "Shopify")             return classifyInboundSource(m) === "Shopify";
    if (activeFilter === "Outlook")             return classifyInboundSource(m) === "Outlook";
    if (activeFilter === "Noise / Not CS")      return classifyInboundSource(m) === "Noise" ||
      m.triage_status === "Noise / Not CS" || m.issue_type === "Noise / Not CS";
    if (activeFilter === "Untriaged")           return isUntriaged(m);
    if (activeFilter === "Needs Human Review")  return m.needs_human_review === true || m.needs_human_review === "true" || m.triage_status === "Needs Human Review";
    if (activeFilter === "High Priority")       return m.risk_level === "High" || m.priority === "High" || m.triage_status === "High Priority";
    if (activeFilter === "Closed")              return m.status === "Closed" || m.status === "Archived" || m.archived_at;
    if (activeFilter === "Archived")            return false;
    return true;
  });
  const getSortTime = (message) => new Date(message.email_received_at || message.created_at || 0).getTime() || 0;
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

  const toggleMessageExpanded = (id) => {
    setExpandedMessages(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const updateManualMessageForm = (field, value) => {
    setManualMessageForm(prev => ({ ...prev, [field]: value }));
  };

  const resetManualMessageForm = () => {
    setManualMessageForm(emptyManualMessageForm);
  };

  // ── handlers ──────────────────────────────────────────────────────────────────
  const handleManualMessageSubmit = async () => {
    const platform = manualMessageForm.platform.trim();
    const brand = manualMessageForm.brand.trim();
    const subject = manualMessageForm.subject.trim();
    const body = manualMessageForm.body.trim();
    const priority = manualMessageForm.priority.trim();
    const notes = manualMessageForm.notes.trim();

    if (!platform || !brand || !subject || !body || !priority) {
      alert("Platform, brand, subject, message body, and priority are required.");
      return;
    }
    if (!supabase) {
      alert("Manual message could not be saved because Supabase is unavailable.");
      return;
    }

    const timestamp = nowISO();
    const payload = {
      external_id: `manual-${Date.now()}-${uid()}`,
      source: "manual",
      channel: platform,
      label: "Manual",
      status: "Needs Reply",
      triage_status: "Untriaged",
      priority,
      brand,
      subject,
      message_body: notes ? `${body}\n\nInternal notes:\n${notes}` : body,
      sender_name: manualMessageForm.customerName.trim() || null,
      sender_email: manualMessageForm.sender.trim() || null,
      received_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
    };

    setManualMessageSaving(true);
    let data = null;
    try {
      const result = await supabase
        .from("inbound_messages")
        .insert([payload])
        .select("*")
        .single();
      if (result.error) {
        alert(`Manual message save failed: ${result.error.message}`);
        setManualMessageSaving(false);
        return;
      }
      data = result.data;
    } catch (err) {
      alert(`Manual message save failed: ${err?.message || "Unknown error"}`);
      setManualMessageSaving(false);
      return;
    }
    setManualMessageSaving(false);
    if (!data) {
      alert("Manual message save failed: no row was returned.");
      return;
    }

    setInboundMessages(prev => [data, ...prev]);
    resetManualMessageForm();
    setManualMessageOpen(false);
  };

  const handleArchive = async (id) => {
    if (!window.confirm("Archive this message from the inbox?")) return;
    setBusyId(id);
    const { error } = await archiveInboundInSupabase(id);
    setBusyId(null);
    if (error) { alert(`Archive failed: ${error.message}`); return; }
    setInboundMessages(prev => prev.filter(m => m.id !== id));
  };

  const handleStatus = async (id, status) => {
    setBusyId(id);
    const { error } = await updateInboundStatusInSupabase(id, status);
    setBusyId(null);
    if (error) { alert(`Update failed: ${error.message}`); return; }
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
    if (error) { setBusyId(null); alert(`Ticket create failed: ${error.message}`); return; }
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
        alert("An open action already exists for this message.");
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
    if (error) { alert(`Create action failed: ${error.message}`); return; }
    // Push returned row into local Next Actions state so it shows immediately
    if (inserted) setOpsActions(prev => [inserted, ...prev]);
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
      alert(`Triage failed: ${err?.message || "Unknown error. Check Supabase Edge Function logs."}`);
    } finally {
      setBusyId(null);
    }
  };

  const [draftBusyId, setDraftBusyId] = useState(null);   // separate from action busyId
  const [copiedDraftId, setCopiedDraftId] = useState(null);

  const handleCopyDraft = async (msg) => {
    try {
      await navigator.clipboard.writeText(msg.ai_draft || "");
      setCopiedDraftId(msg.id);
      setTimeout(() => setCopiedDraftId(null), 2000);
      return true;
    } catch (_) {
      alert("Could not copy draft. Please copy it manually.");
      return false;
    }
  };

  const handleCopyReply = async (msg) => {
    const replyText = msg.approved_reply || msg.ai_draft || "";
    if (!replyText) {
      alert("Generate or approve a draft first.");
      return;
    }

    try {
      await navigator.clipboard.writeText(replyText);
      setCopiedDraftId(msg.id);
      setTimeout(() => setCopiedDraftId(null), 2000);
    } catch (_) {
      alert("Could not copy draft. Please copy it manually.");
    }
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
      alert(`Draft failed: ${err?.message || "Unknown error. Check Supabase Edge Function logs."}`);
    } finally {
      setDraftBusyId(null);
    }
  };

  const handleApproveDraft = async (msg) => {
    if (!msg.ai_draft) return;
    const now = nowISO();
    // 1. Update inbound_messages: copy draft → approved_reply, set draft_status
    const { error: updateErr } = await supabase
      .from("inbound_messages")
      .update({ approved_reply: msg.ai_draft, draft_status: "Approved", updated_at: now })
      .eq("id", msg.id);
    if (updateErr) { alert(`Approve failed: ${updateErr.message}`); return; }

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
              .from("inbound_messages")
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
      // Rule-driven if rule exists; safe default = draft only if needs_human_review
      const shouldDraft = rule
        ? rule.auto_draft === true
        : (triaged.needs_human_review === true || triaged.needs_human_review === "true");

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
            onClick={() => setManualMessageOpen(true)}
            disabled={queueRunning || inboundLoading}
            className="inline-flex flex-1 items-center justify-center gap-1.5 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 font-medium rounded-lg border border-gray-300 transition-colors cursor-pointer px-3 py-1.5 text-xs whitespace-nowrap sm:flex-none"
          >
            + Manual Message
          </button>
          {/* Check Gmail Now */}
          <div className="flex flex-1 flex-col gap-0.5 sm:flex-none">
            <button
              onClick={handleCheckGmailNow}
              disabled={isCheckingGmail || gmailCooldownSeconds > 0 || queueRunning || inboundLoading}
              className="inline-flex items-center justify-center gap-1.5 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 font-medium rounded-lg border border-gray-300 transition-colors cursor-pointer px-3 py-1.5 text-xs whitespace-nowrap"
            >
              {isCheckingGmail ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="animate-spin flex-shrink-0">
                    <path d="M10 6A4 4 0 1 1 6 2a4 4 0 0 1 2.83 1.17L10 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                    <path d="M8 4h2V2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Checking...
                </>
              ) : gmailCooldownSeconds > 0 ? `Available in ${gmailCooldownSeconds}s` : "Check Gmail Now"}
            </button>
            {lastGmailCheckAt && (
              <span className="text-[10px] text-gray-400 text-center">
                Last checked at {lastGmailCheckAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </span>
            )}
            {gmailCheckError && (
              <span className="text-[10px] text-red-500 text-center">{gmailCheckError}</span>
            )}
          </div>
          {/* Refresh */}
          <button
            onClick={onRefresh}
            disabled={inboundLoading || queueRunning}
            className="inline-flex flex-1 items-center justify-center gap-1.5 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 font-medium rounded-lg border border-gray-300 transition-colors cursor-pointer px-3 py-1.5 text-xs whitespace-nowrap sm:flex-none"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={inboundLoading ? "animate-spin" : ""}>
              <path d="M10 6A4 4 0 1 1 6 2a4 4 0 0 1 2.83 1.17L10 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M8 4h2V2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {inboundLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {manualMessageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3 py-6">
          <div className="w-full max-w-2xl rounded-lg border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div>
                <p className="text-sm font-bold text-gray-900">Manual Message</p>
                <p className="text-[11px] text-gray-400">Log a TikTok DM, Instagram DM, or other manual inquiry.</p>
              </div>
              <button
                onClick={() => setManualMessageOpen(false)}
                disabled={manualMessageSaving}
                className="text-sm font-semibold text-gray-400 transition-colors hover:text-gray-700 disabled:opacity-50"
              >
                Close
              </button>
            </div>
            <div className="max-h-[75vh] overflow-y-auto p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Platform</span>
                  <Sel value={manualMessageForm.platform} onChange={value => updateManualMessageForm("platform", value)} options={["TikTok DM", "Instagram DM", "Other"]} placeholder="" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Brand</span>
                  <Sel value={manualMessageForm.brand} onChange={value => updateManualMessageForm("brand", value)} options={BRANDS} placeholder="Select brand" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Customer name</span>
                  <Inp value={manualMessageForm.customerName} onChange={value => updateManualMessageForm("customerName", value)} placeholder="Customer name" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Customer handle or email</span>
                  <Inp value={manualMessageForm.sender} onChange={value => updateManualMessageForm("sender", value)} placeholder="@handle or email" />
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Subject / short title</span>
                  <Inp value={manualMessageForm.subject} onChange={value => updateManualMessageForm("subject", value)} placeholder="Short title" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Priority</span>
                  <Sel value={manualMessageForm.priority} onChange={value => updateManualMessageForm("priority", value)} options={["Low", "Medium", "High"]} placeholder="" />
                </label>
                <div className="hidden sm:block" />
                <label className="space-y-1 sm:col-span-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Message body</span>
                  <Txt value={manualMessageForm.body} onChange={value => updateManualMessageForm("body", value)} placeholder="Paste or type the customer message..." rows={5} />
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Optional notes</span>
                  <Txt value={manualMessageForm.notes} onChange={value => updateManualMessageForm("notes", value)} placeholder="Internal notes, context, or follow-up details..." rows={3} />
                </label>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-4 py-3">
              <button
                onClick={() => setManualMessageOpen(false)}
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
        const isDraftBusy = draftBusyId === msg.id;
        const statusStyle    = INBOX_STATUS_STYLE[msg.status]        || "bg-gray-100 text-gray-500 border-gray-200";
        const priorityStyle  = INBOX_PRIORITY_STYLE[msg.priority]    || "bg-gray-100 text-gray-500 border-gray-200";
        const triageStyle    = TRIAGE_STATUS_STYLE[msg.triage_status] || "bg-gray-100 text-gray-500 border-gray-200";
        const riskStyle      = RISK_LEVEL_STYLE[msg.risk_level]       || "bg-gray-100 text-gray-500 border-gray-200";
        const { displayName, displayBody, hasHistory } = getDisplayInboundMessage(msg);
        const showName       = displayName || msg.sender_name || msg.customer_name;
        const untriaged      = isUntriaged(msg);
        const sourceType     = classifyInboundSource(msg);
        const sourceBadgeCls = SOURCE_BADGE_STYLE[sourceType] || SOURCE_BADGE_STYLE["Other"];
        const cardTitle      = getInboundCardTitle(msg, sourceType, displayName);
        const ts             = getInboundTimestamp(msg);
        const orderNum       = msg.order_number || msg.orderNumber || null;
        const isRefund       = sourceType === "TikTok Refund";
        const isNoise        = sourceType === "Noise";
        const isMessageExpanded = expandedMessages[msg.id] === true;
        const sourceBadgeLabel = isRefund ? "Refund / Return" : sourceType;
        const displayBrand = getDisplayBrand(msg);
        const brandBorderCls = getInboxBrandBorderClass(displayBrand);
        const showSubjectLine = msg.subject && msg.subject !== cardTitle;
        const hasReplyText = Boolean(msg.approved_reply || msg.ai_draft);

        return (
          <Card key={msg.id} className={`w-full p-4 border-l-4 ${brandBorderCls} ${isNoise ? "opacity-75" : ""}`}>
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
                  : <Badge label={msg.triage_status} className={triageStyle} />
                }
                {msg.draft_status === "Approved" && (
                  <Badge label="Draft Approved" className="bg-green-50 text-green-700 border-green-200" />
                )}
                {(msg.needs_human_review === true || msg.needs_human_review === "true") && (
                  <Badge label="Human Review" className="bg-orange-50 text-orange-700 border-orange-200" />
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
            <p className={`text-xs font-bold mb-1.5 ${isRefund ? "text-orange-700" : "text-gray-900"}`}>{cardTitle}</p>

            {/* Refund-specific info row */}
            {isRefund && (
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 mb-2">
                {orderNum         && <span className="text-[11px] text-gray-600"><span className="font-semibold">Order:</span> {orderNum}</span>}
                {showName         && <span className="text-[11px] text-gray-600"><span className="font-semibold">Customer:</span> {showName}</span>}
                {msg.sender_email && <span className="text-[11px] text-gray-400">{msg.sender_email}</span>}
                <span className="text-[11px] text-orange-700 font-medium">Review in TikTok Seller Center</span>
              </div>
            )}

            {/* Non-refund sender line */}
            {!isRefund && showName && (
              <p className="text-xs text-gray-600 mb-1.5">
                <span className="font-semibold text-gray-800">{showName}</span>
                {!displayName && msg.sender_email && <span className="text-gray-400 ml-1">· {msg.sender_email}</span>}
              </p>
            )}

            {/* Subject */}
            {showSubjectLine && (
              <p className="text-xs text-gray-500 italic mb-1.5 truncate">
                <span className="not-italic font-medium text-gray-500">Subject:</span> {msg.subject}
              </p>
            )}

            {/* Message body */}
            {displayBody && (
              <div className="mb-2">
                <button
                  type="button"
                  onClick={() => toggleMessageExpanded(msg.id)}
                  aria-expanded={isMessageExpanded}
                  className={`text-[10px] font-semibold rounded border px-2 py-1 transition-colors cursor-pointer ${
                    isRefund
                      ? "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100"
                      : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-gray-700"
                  }`}
                >
                  {isMessageExpanded ? "Hide Message" : "View Message"}
                </button>
                {isMessageExpanded && (
                  <div className={`border rounded-lg px-3 py-2.5 mt-2 ${
                    isRefund ? "bg-orange-50 border-orange-100" : "bg-gray-50 border-gray-100"
                  }`}>
                    <p className={`text-xs leading-relaxed whitespace-pre-wrap ${
                      isRefund ? "text-orange-900" : "text-gray-700"
                    }`}>{displayBody}</p>
                  </div>
                )}
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
            {msg.ai_draft && (() => {
              const isDraftCollapsed = collapsedDrafts[msg.id] === true;
              const toggleCollapse = () => setCollapsedDrafts(prev => ({ ...prev, [msg.id]: !prev[msg.id] }));
              return (
              <div className="border border-blue-100 rounded-lg bg-blue-50 px-3 py-2.5 mb-3">
                <div className="flex flex-col gap-2 mb-1.5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">AI Draft</p>
                  <div className="flex items-center gap-2">
                    {msg.draft_status && (
                      <Badge label={msg.draft_status} className={msg.draft_status === "Approved" ? "bg-green-50 text-green-700 border-green-200" : "bg-blue-100 text-blue-600 border-blue-200"} />
                    )}
                    <button onClick={toggleCollapse} className="text-[10px] text-blue-400 hover:text-blue-700 cursor-pointer">
                      {isDraftCollapsed ? "Show Draft" : "Hide"}
                    </button>
                  </div>
                </div>
                {!isDraftCollapsed && (
                  <>
                    <p className="text-xs text-gray-800 leading-relaxed whitespace-pre-wrap">{msg.ai_draft}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2 border-t border-blue-100">
                      <button onClick={() => handleCopyDraft(msg)}
                        className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer transition-colors whitespace-nowrap">
                        {copiedDraftId === msg.id ? "Copied" : "Copy Draft"}
                      </button>
                      <button disabled={!hasReplyText} onClick={() => handleCopyReply(msg)}
                        title={hasReplyText ? "Copy the approved reply or AI draft" : "Generate or approve a draft first"}
                        className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-slate-700 bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors whitespace-nowrap">
                        {copiedDraftId === msg.id ? "Copied" : "Copy Reply"}
                      </button>
                      {msg.draft_status !== "Approved" && (
                        <button disabled={isDraftBusy || isBusy} onClick={() => handleApproveDraft(msg)}
                          className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-green-300 bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 cursor-pointer transition-colors whitespace-nowrap">
                          Approve Draft
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
            <div className="flex flex-wrap items-center gap-2">
              {hasReplyText && (!msg.ai_draft || collapsedDrafts[msg.id] === true) && (
                <button disabled={!hasReplyText} onClick={() => handleCopyReply(msg)}
                  title={hasReplyText ? "Copy the approved reply or AI draft" : "Generate or approve a draft first"}
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors whitespace-nowrap">
                  {copiedDraftId === msg.id ? "Copied" : "Copy Reply"}
                </button>
              )}
              {msg.status !== "Closed" && (
                <button disabled={isBusy} onClick={() => handleStatus(msg.id, "Closed")}
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer transition-colors whitespace-nowrap">
                  Mark Closed
                </button>
              )}
              <button disabled={isBusy} onClick={() => handleRunTriage(msg.id)}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer transition-colors whitespace-nowrap">
                {isBusy ? "Triaging..." : "Run Triage"}
              </button>
              <button disabled={isDraftBusy || isBusy} onClick={() => handleGenerateDraft(msg)}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer transition-colors whitespace-nowrap">
                {isDraftBusy ? "Drafting..." : "Generate Draft"}
              </button>
              <button disabled={isBusy} onClick={() => handleArchive(msg.id)}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer transition-colors whitespace-nowrap sm:ml-auto">
                <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
                  <path d="M1.5 3.5h10M5 3.5V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M2.5 3.5l.5 7a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1l.5-7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M5 6v3M8 6v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                Archive
              </button>
            </div>
          </Card>
        );
      })}
    </div>
  );
};

const buildSlackSummary = ({ tickets, replacements, studios, surpriseSets, raiseScores }) => {
  const safeReplacements = Array.isArray(replacements) ? replacements : [];
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
• ${safeTickets.length} tickets reviewed across VR, CK47, PS, and PM
• ${slaRisks.length} SLA risk ticket${slaRisks.length !== 1 ? "s" : ""} identified
• ${resolved.length} ticket${resolved.length !== 1 ? "s" : ""} resolved | ${escalated.length} escalated | ${open.length} still open

*Inventory & Studio Readiness*
• ${studioReady.map(s => s.id).join(", ")} stream-ready
• ${safeStudios.filter(s => !s.streamReady).map(s => s.id).join(", ") || "All studios"} ${safeStudios.filter(s => !s.streamReady).length > 0 ? "not ready" : "stream-ready"}
• Overall studio readiness: ${studioScore}%

*Shipping Loss Prevention*
• ${safeReplacements.length} replacement case${safeReplacements.length !== 1 ? "s" : ""} logged
• Estimated loss tracked: $${totalLoss.toFixed(2)}
• Preventable cases: ${safeReplacements.filter(r => r.preventable === "Yes").length}

*Surprise Set Execution*
• ${setsReady.length} of ${safeSurpriseSets.length} surprise set${safeSurpriseSets.length !== 1 ? "s" : ""} ready for live

*Raise Path - Self Score*
Consistency ${raiseScores.consistency}% | Accuracy ${raiseScores.accuracy}% | Loss Reduction ${raiseScores.lossReduction}% | Ownership ${raiseScores.ownership}% | Process ${raiseScores.processImprovement}%`;
};

const buildFullReport = ({ tickets, replacements, studios, surpriseSets, raiseScores, improvements, risks, nextFocus }) => {
  const safeReplacements = Array.isArray(replacements) ? replacements : [];
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
${topCauses.length > 0 ? `\n  Top root causes:\n${topCauses.map(([c, n]) => `  • ${c}: ${n} case${n > 1 ? "s" : ""}`).join("\n")}` : ""}

SURPRISE SET EXECUTION
─────────────────────────────
  Sets tracked:       ${safeSurpriseSets.length}
  Ready for live:     ${setsReady.length}
${safeSurpriseSets.map(s => `  • ${s.setName} (${s.brand}) - ${s.readyForLive ? "Ready" : "Not ready"}`).join("\n")}

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
  overdue_action:   { label: "Overdue Action",     color: "bg-red-100 text-red-700 border-red-300" },
  high_action:      { label: "High Priority",       color: "bg-red-50 text-red-700 border-red-200"  },
  inbox_urgent:     { label: "Urgent Message",      color: "bg-orange-50 text-orange-700 border-orange-200" },
  draft_ready:      { label: "Draft Ready",         color: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  ticket_open:      { label: "Open Ticket",         color: "bg-blue-50 text-blue-700 border-blue-200" },
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
    { label: "Msgs Needing Reply", value: msgsNeedingReply, accent: msgsNeedingReply > 0 ? "text-blue-600" : "text-gray-900",  border: "border-l-blue-400"   },
    { label: "Drafts Ready",       value: draftsReady,      accent: draftsReady > 0      ? "text-indigo-600" : "text-gray-900", border: "border-l-indigo-400" },
    { label: "Open Actions",       value: openActions,      accent: "text-gray-900",                                            border: "border-l-gray-300"   },
    { label: "Due Today",          value: dueTodayActions,  accent: dueTodayActions > 0  ? "text-amber-600" : "text-gray-900",  border: "border-l-amber-400"  },
    { label: "Overdue",            value: overdueActions,   accent: overdueActions > 0   ? "text-red-600"   : "text-gray-900",  border: "border-l-red-500"    },
    { label: "High Priority",      value: highActions,      accent: highActions > 0      ? "text-red-600"   : "text-gray-900",  border: "border-l-red-300"    },
    { label: "Waiting on Cust.",   value: waitingActions,   accent: "text-gray-900",                                            border: "border-l-gray-300"   },
    { label: "Tickets Today",      value: ticketsToday,     accent: "text-gray-900",                                            border: "border-l-gray-300"   },
  ];

  return (
    <Card className="p-0 overflow-hidden">
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${allClear ? "bg-green-500" : overdueActions > 0 ? "bg-red-500 animate-pulse" : "bg-amber-400"}`} />
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
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
            <span className="text-green-500 text-base">✓</span>
            <p className="text-sm font-medium text-green-800">You're clear right now. No urgent ops items.</p>
          </div>
        ) : (
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
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
                        {dueDisplay && <span className={`text-[10px] font-medium ${isOverdue({ due_at: item.due_at }) ? "text-red-600" : "text-amber-600"}`}>{isOverdue({ due_at: item.due_at }) ? "Overdue" : dueDisplay}</span>}
                      </div>
                      <p className="text-xs font-semibold text-gray-900 truncate">{item.title}</p>
                      {item.summary && <p className="text-[10px] text-gray-400 line-clamp-1 mt-0.5">{item.summary}</p>}
                    </div>
                    {/* Nav button */}
                    <button
                      onClick={() => setActiveView(item.nav)}
                      className="flex-shrink-0 text-[10px] font-medium text-slate-600 hover:text-slate-800 cursor-pointer whitespace-nowrap"
                    >
                      Open →
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
const NotificationDropdown = ({ inboundMessages, opsActions, replacements, setActiveView }) => {
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
  const followUpNeeded     = safeReplacements.filter(r => r.followUp === "Yes" || r.follow_up === "Yes").length;
  const overdueActionsCount = safeOpsActions.filter(isOverdue).length;

  const totalCount = Object.values(refundsByBrand).reduce((a, b) => a + b, 0)
    + Object.values(chatsByBrand).reduce((a, b) => a + b, 0)
    + draftsReady + followUpNeeded + overdueActionsCount;

  const items = [];
  Object.entries(refundsByBrand).forEach(([brand, n]) => {
    items.push({ label: `${brand}: ${n} refund/return${n > 1 ? "s" : ""}`, nav: "inbox", color: "text-orange-600" });
  });
  Object.entries(chatsByBrand).forEach(([brand, n]) => {
    items.push({ label: `${brand}: ${n} shop chat${n > 1 ? "s" : ""}`, nav: "inbox", color: "text-gray-700" });
  });
  if (draftsReady > 0)        items.push({ label: `${draftsReady} draft${draftsReady > 1 ? "s" : ""} ready to approve`, nav: "inbox", color: "text-indigo-600" });
  if (followUpNeeded > 0)     items.push({ label: `${followUpNeeded} replacement${followUpNeeded > 1 ? "s" : ""} need follow-up`, nav: "replacements", color: "text-amber-600" });
  if (overdueActionsCount > 0) items.push({ label: `${overdueActionsCount} overdue action${overdueActionsCount > 1 ? "s" : ""}`, nav: "actions", color: "text-red-600" });

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
        {totalCount > 0 && (
          <span className="absolute -top-1 -right-1 text-[9px] bg-red-500 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">
            {totalCount > 9 ? "9+" : totalCount}
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
            {items.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-gray-400">All clear. Nothing needs attention.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {items.map((item, i) => (
                  <button
                    key={i}
                    onClick={() => { setActiveView(item.nav); setOpen(false); }}
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors"
                  >
                    <p className={`text-xs font-medium ${item.color}`}>{item.label}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Tap to open {item.nav === "inbox" ? "Command Inbox" : item.nav === "replacements" ? "Replacements" : "Action Queue"}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

// ─── DASHBOARD VIEW ───────────────────────────────────────────────────────────
const DashboardView = ({ tickets, setTickets, replacements, studios, surpriseSets, raiseScores, inboundMessages, opsActions, setActiveView }) => {
  const [showForm, setShowForm] = useState(false);
  const emptyF = { brand: "", channel: "", issueType: "", priority: "Medium", slaRisk: "No", status: "New", notes: "", nextAction: "" };
  const [form, setForm] = useState(emptyF);
  const f = k => v => setForm(p => ({ ...p, [k]: v }));

  const addTicket = async () => {
    if (!form.brand || !form.issueType) return alert("Pick a brand and issue type first.");
    const newTicket = { ...form, createdAt: nowISO(), source: "command-center" };
    const { data, error } = await insertTicketToSupabase(newTicket);
    if (error) return alert(`Ticket save failed: ${error.message || "Unknown Supabase error"}`);
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

  // Primary counts driven by Command Inbox data
  const openInboxMessages   = safeInbound.filter(m => !m.archived_at && m.status !== "Closed" && m.status !== "Done");
  const replacementFollowUps = safeReplacements.filter(r => !r.archived_at && (r.followUp === "Yes" || r.follow_up === "Yes"));
  const msgsNeedingReply    = safeInbound.filter(m => (m.status === "Needs Reply" || !m.status) && !m.archived_at).length;
  const refundItems         = safeInbound.filter(m => isTikTokRefund(m) && !m.archived_at).length;
  const replacementFU       = replacementFollowUps.length;
  const actionRequiredCount = openInboxMessages.length + replacementFollowUps.length;
  const actionRequired      = actionRequiredCount; // alias used by metric card

  const totalLoss   = safeReplacements.reduce((a, r) => a + parseFloat(r.marketValue || r.market_value || 0), 0);
  const studioReady = safeStudios.filter(s => s.streamReady).length;
  const studioScore = safeStudios.length ? Math.round((studioReady / safeStudios.length) * 100) : 0;

  // Morning Brief - deterministic, no AI
  const morningBrief = (() => {
    const firstName = "Jonny";
    const allClear  = msgsNeedingReply === 0 && refundItems === 0 && replacementFU === 0;
    if (allClear) {
      return `Good morning ${firstName}! The inbox is clear right now. Check surprise sets, inventory readiness, and any manual DMs before the day starts.`;
    }
    const parts = [];
    if (msgsNeedingReply > 0) parts.push(`${msgsNeedingReply} message${msgsNeedingReply > 1 ? "s" : ""} needing reply`);
    if (refundItems > 0)      parts.push(`${refundItems} refund or return item${refundItems > 1 ? "s" : ""}`);
    if (replacementFU > 0)   parts.push(`${replacementFU} replacement${replacementFU > 1 ? "s" : ""} needing follow-up`);
    const list = parts.length === 1 ? parts[0]
      : parts.length === 2 ? `${parts[0]} and ${parts[1]}`
      : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
    return `Good morning ${firstName}! You have ${list}. Start with refunds or returns first, then clear the oldest inbox items.`;
  })();

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

      {/* Morning Brief */}
      <Card className="p-4 border-l-4 border-l-slate-400">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Morning Brief</p>
        <p className="text-sm text-gray-800 leading-relaxed">{morningBrief}</p>
      </Card>

      {/* Today's Ops Brief */}
      <DailyOpsBrief
        inboundMessages={safeInboundMessages}
        opsActions={safeOpsActions}
        tickets={safeTickets}
        setActiveView={setActiveView}
      />

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 border-l-4 border-l-slate-400">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Action Required</p>
          <p className={`text-4xl font-bold mt-1 ${actionRequired > 0 ? "text-red-600" : "text-gray-900"}`}>{actionRequired}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">inbox + replacements</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Refunds / Returns</p>
          <p className={`text-4xl font-bold mt-1 ${refundItems > 0 ? "text-orange-500" : "text-gray-900"}`}>{refundItems}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Est. Loss Tracked</p>
          <p className="text-4xl font-bold text-gray-700 mt-1">${totalLoss.toFixed(2)}</p>
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

      {/* 2-col layout - stacks on mobile */}
      <div className="flex flex-col md:flex-row gap-4">
        {/* Ticket table */}
        <div className="flex-1 min-w-0">
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
                        ? "bg-green-50 text-green-700 border-green-200"
                        : "bg-slate-100 text-slate-600 border-slate-200"}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">{row.ready}/{row.total} stream blocks live ready</p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right rail */}
        <div className="w-full md:w-72 flex-shrink-0 flex flex-col gap-4">
          <Card className="p-4">
            <p className="text-sm font-bold text-gray-900 mb-3">Inventory &amp; Studio Readiness</p>
            <div className="grid grid-cols-4 gap-2">
              {safeStudios.map(s => (
                <div key={s.id} className="text-center">
                  <p className="text-[10px] font-semibold text-gray-400 mb-1">{s.id}</p>
                  <input type="checkbox" checked={s.streamReady} readOnly className="accent-slate-700 mb-1" />
                  <p className={`text-[9px] font-bold ${s.streamReady ? "text-green-600" : "text-red-500"}`}>{s.streamReady ? "READY" : "NOT READY"}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Weekly report preview - real data */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-gray-900">Weekly Report Preview</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded p-3 text-[11px] text-gray-600 leading-relaxed space-y-1.5">
              <p className="font-semibold text-gray-800">Command Inbox</p>
              <p>• {safeInbound.length} active messages</p>
              <p>• {msgsNeedingReply} needing reply - {refundItems} refund/return item{refundItems !== 1 ? "s" : ""}</p>
              <p>• {actionRequiredCount} total action required</p>
              <p className="font-semibold text-gray-800 pt-1">Shipping Loss</p>
              <p>• {safeReplacements.length} replacement cases - ${totalLoss.toFixed(2)} tracked</p>
              <p>• {safeReplacements.filter(r => r.preventable === "Yes").length} preventable</p>
              <p className="font-semibold text-gray-800 pt-1">Studios</p>
              <p>• {studioReady}/{safeStudios.length} stream-ready - {studioScore}% readiness</p>
              <p className="font-semibold text-gray-800 pt-1">Sets</p>
              <p>• {surpriseReadyTotal}/{surpriseBlockTotal} stream blocks live ready</p>
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
        {t.nextAction && <p className="text-[10px] text-slate-600">→ {t.nextAction}</p>}
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
const REPLACEMENT_FILTERS = ["All", "CardKing47", "Vaulted Rarities", "PokeSpins", "Pokiemart", "Follow-Up Needed"];

const ReplacementLogView = ({ replacements, setReplacements, replacementsLoading, replacementsError, onRefresh }) => {
  const emptyF = {
    date: todayDate(), brand: "", orderNum: "", customerName: "",
    reason: "", rootCause: "", replacementItems: "", marketValue: "",
    preventable: "No", followUp: "No", notes: "", status: "Open",
  };
  const [form, setForm]         = useState(emptyF);
  const [show, setShow]         = useState(false);
  const [activeFilter, setActiveFilter] = useState("All");
  const [editRow, setEditRow]   = useState(null);   // row being edited
  const [editForm, setEditForm] = useState({});
  const [savingId, setSavingId] = useState(null);
  const f  = k => v => setForm(p => ({ ...p, [k]: v }));
  const ef = k => v => setEditForm(p => ({ ...p, [k]: v }));
  const safeReplacements = Array.isArray(replacements) ? replacements : [];

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
  const handleArchive = async (row) => {
    if (!window.confirm(`Archive replacement case ${row.orderNum || row.id}? It will be hidden but not deleted.`)) return;
    if (supabase && row.id && !/^[a-z0-9]{7}$/.test(row.id)) {
      // Only call Supabase for UUID-format ids (real rows); skip local uid() rows
      const { error } = await supabase
        .from("replacements")
        .update({ archived_at: nowISO(), updated_at: nowISO() })
        .eq("id", row.id);
      if (error) { alert(`Archive failed: ${error.message}`); return; }
    }
    setReplacements(prev => prev.filter(r => r.id !== row.id));
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
      if (error) { alert(`Save failed: ${error.message}`); setSavingId(null); return; }
    }
    setReplacements(prev => prev.map(r => r.id === editRow ? { ...r, ...updated } : r));
    setEditRow(null);
    setEditForm({});
    setSavingId(null);
  };

  // ── Filter + derived stats ──────────────────────────────────────────────────
  const displayRows = safeReplacements.filter(r => {
    if (activeFilter === "All")             return true;
    if (activeFilter === "Follow-Up Needed") return r.followUp === "Yes";
    return r.brand === activeFilter;
  });

  const loss = safeReplacements.reduce((a, r) => a + parseFloat(r.marketValue || 0), 0);
  const prev = safeReplacements.filter(r => r.preventable === "Yes").length;
  const fu   = safeReplacements.filter(r => r.followUp === "Yes").length;
  const rc   = ROOT_CAUSES.map(c => ({ c, n: safeReplacements.filter(r => r.rootCause === c).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);

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
        <Card className="p-4"><p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Cases Logged</p><p className="text-3xl font-bold text-gray-900 mt-1">{safeReplacements.length}</p></Card>
        <Card className="p-4"><p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Estimated Loss</p><p className="text-3xl font-bold text-red-600 mt-1">${loss.toFixed(2)}</p></Card>
        <Card className="p-4"><p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Preventable</p><p className="text-3xl font-bold text-amber-600 mt-1">{prev}</p><p className="text-xs text-gray-400 mt-0.5">{safeReplacements.length > 0 ? Math.round((prev / safeReplacements.length) * 100) : 0}% of total</p></Card>
        <Card className="p-4"><p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Follow-Up Needed</p><p className="text-3xl font-bold text-slate-700 mt-1">{fu}</p></Card>
      </div>

      {/* Root cause breakdown */}
      {rc.length > 0 && (
        <Card className="p-4">
          <p className="text-sm font-bold text-gray-900 mb-3">Root Cause Breakdown</p>
          <div className="space-y-2">{rc.slice(0, 5).map(({ c, n }) => <div key={c} className="flex items-center gap-3"><span className="text-xs text-gray-500 w-44 truncate">{c}</span><div className="flex-1"><ProgressBar pct={safeReplacements.length ? (n / safeReplacements.length) * 100 : 0} color="bg-red-400" /></div><span className="text-xs text-gray-400 w-6 text-right">{n}</span></div>)}</div>
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
                {["Date","Brand","Customer","Order #","Reason","Items","Notes","Value","Prev.","Follow-Up","Status","Actions"].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map(r => {
                const isEditing = editRow === r.id;
                return (
                  <tr key={r.id} className={`border-b border-gray-50 ${isEditing ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                    {isEditing ? (
                      /* ── Inline edit row ── */
                      <>
                        <td className="px-3 py-2">{r.date}</td>
                        <td className="px-3 py-2"><div className="flex items-center gap-1.5"><BrandPip brand={r.brand} /><span className="text-gray-700">{BRAND_SHORT[r.brand] || r.brand}</span></div></td>
                        <td className="px-3 py-2"><Inp value={editForm.customerName || ""} onChange={ef("customerName")} placeholder="Customer" className="w-28" /></td>
                        <td className="px-3 py-2"><Inp value={editForm.orderNum || ""} onChange={ef("orderNum")} placeholder="Order #" className="w-24" /></td>
                        <td className="px-3 py-2"><Inp value={editForm.reason || ""} onChange={ef("reason")} placeholder="Reason" className="w-32" /></td>
                        <td className="px-3 py-2"><Inp value={editForm.replacementItems || ""} onChange={ef("replacementItems")} placeholder="Items" className="w-36" /></td>
                        <td className="px-3 py-2"><Inp value={editForm.notes || ""} onChange={ef("notes")} placeholder="Notes" className="w-36" /></td>
                        <td className="px-3 py-2"><Inp type="number" value={editForm.marketValue ?? ""} onChange={ef("marketValue")} placeholder="0.00" className="w-16" /></td>
                        <td className="px-3 py-2">
                          <select value={editForm.preventable || "No"} onChange={e => ef("preventable")(e.target.value)} className="bg-white border border-gray-300 rounded text-xs px-1.5 py-1 w-14">
                            <option>Yes</option><option>No</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select value={editForm.followUp || "No"} onChange={e => ef("followUp")(e.target.value)} className="bg-white border border-gray-300 rounded text-xs px-1.5 py-1 w-14">
                            <option>Yes</option><option>No</option>
                          </select>
                        </td>
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
                        <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{r.date}</td>
                        <td className="px-3 py-2.5"><div className="flex items-center gap-1.5"><BrandPip brand={r.brand} /><span className="text-gray-700">{BRAND_SHORT[r.brand] || r.brand}</span></div></td>
                        <td className="px-3 py-2.5 text-gray-600 max-w-[100px] truncate">{r.customerName || r.customer_name || "-"}</td>
                        <td className="px-3 py-2.5 font-mono text-gray-800 whitespace-nowrap">{r.orderNum || r.order_number || "-"}</td>
                        <td className="px-3 py-2.5 text-gray-600 max-w-[120px] truncate">{r.reason || "-"}</td>
                        <td className="px-3 py-2.5 text-gray-500 max-w-[120px] truncate">{r.replacementItems || r.replacement_items || "-"}</td>
                        <td className="px-3 py-2.5 text-gray-400 max-w-[120px] truncate">{r.notes || "-"}</td>
                        <td className="px-3 py-2.5 text-green-700 font-bold whitespace-nowrap">${parseFloat(r.marketValue || r.market_value || 0).toFixed(2)}</td>
                        <td className="px-3 py-2.5"><Badge label={r.preventable} className={r.preventable === "Yes" ? "bg-red-50 text-red-700 border-red-200" : "bg-gray-100 text-gray-500 border-gray-200"} /></td>
                        <td className="px-3 py-2.5"><Badge label={r.followUp || r.follow_up} className={(r.followUp === "Yes" || r.follow_up === "Yes") ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-gray-100 text-gray-500 border-gray-200"} /></td>
                        <td className="px-3 py-2.5">
                          {r.status
                            ? <Badge label={r.status} className={r.status === "Reshipped" || r.status === "Resolved" ? "bg-green-50 text-green-700 border-green-200" : r.status === "Open" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-gray-100 text-gray-500 border-gray-200"} />
                            : <span className="text-gray-300">-</span>
                          }
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {/* Edit */}
                            <button
                              title="Edit this row"
                              onClick={() => { setEditRow(r.id); setEditForm({ ...r }); }}
                              className="text-gray-400 hover:text-blue-600 cursor-pointer text-sm leading-none"
                            >✎</button>
                            {/* Archive */}
                            <button
                              title="Archive this row"
                              onClick={() => handleArchive(r)}
                              className="text-gray-300 hover:text-red-500 cursor-pointer text-sm leading-none"
                            >🗑</button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {displayRows.length === 0 && (
                <tr><td colSpan={12} className="text-center py-8 text-gray-300">
                  {activeFilter === "All" ? "No replacement cases logged" : `No cases match "${activeFilter}"`}
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
const StudioReadinessView = ({ studios, setStudios }) => {
  const safeStudios = Array.isArray(studios) ? studios : [];
  const upd = (id, field, val) => setStudios(p => p.map(s => s.id === id ? { ...s, [field]: val } : s));
  const score = s => { let sc = 0; if (s.countCompleted) sc += 25; if (s.fullyStocked) sc += 25; if (s.discrepanciesLogged === 0 || s.discrepanciesResolved === s.discrepanciesLogged) sc += 25; if (s.streamReady) sc += 25; return sc; };
  const overall = safeStudios.length ? Math.round(safeStudios.reduce((a, s) => a + score(s), 0) / safeStudios.length) : 0;
  return (
    <div className="space-y-4">
      <div><h2 className="text-2xl font-bold text-gray-900">Inventory &amp; Studio Readiness</h2><p className="text-xs text-gray-400 mt-0.5">Track station counts, stock levels, and stream readiness · <span className="font-medium text-gray-500">{getWeekOfLabel()}</span></p></div>
      <Card className="p-4 flex items-center gap-6">
        <div className="text-center"><p className="text-xs text-gray-400 mb-1">Overall Readiness</p><p className={`text-5xl font-bold ${overall >= 75 ? "text-green-600" : overall >= 50 ? "text-amber-500" : "text-red-500"}`}>{overall}%</p></div>
        <div className="flex-1"><ProgressBar pct={overall} color={overall >= 75 ? "bg-green-500" : overall >= 50 ? "bg-amber-400" : "bg-red-500"} /><p className="text-xs text-gray-400 mt-1.5">{safeStudios.filter(s => s.streamReady).length}/{safeStudios.length} stations stream-ready</p></div>
      </Card>
      <div className="grid grid-cols-2 gap-4">
        {safeStudios.map(s => {
          const sc = score(s);
          const brandLabel = STUDIO_BRANDS[s.id];
          return (
            <Card key={s.id} className={`p-5 ${s.streamReady ? "border-green-300" : ""}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-gray-900">{s.id}</h3>
                  {brandLabel && <span className="text-[10px] text-gray-400 font-medium border border-gray-200 rounded px-1.5 py-0.5">{brandLabel}</span>}
                </div>
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
const SurpriseSetView = ({ surpriseSets, setSurpriseSets }) => {
  const defaultConverterForm = {
    brand: "Vaulted Rarities",
    warehouse: "US Warehouse",
    day: "Monday",
    shift: "am",
    fileName: "",
    input: "",
  };
  const [converterForm, setConverterForm] = useState(defaultConverterForm);
  const [converterRows, setConverterRows] = useState([]);
  const [converterError, setConverterError] = useState("");
  const [converterConverted, setConverterConverted] = useState(false);
  const [convertedEntries, setConvertedEntries] = useState(() => loadSetSheetConverterEntries());

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

  const updateConverterField = (field, value) => {
    setConverterForm(prev => ({ ...prev, [field]: value }));
  };

  const getTrackerBlock = (day, streamKey, brand) =>
    trackerBlocks.find(block => block.day === day && block.streamKey === streamKey && normalizeSurpriseSetBrandValue(block.brand) === brand);

  const patchTrackerBlock = (brand, day, streamKey, patch) => {
    setSurpriseSets(prev => normalizeWeeklySurpriseSets(prev).map(block => {
      const matches = block.day === day && block.streamKey === streamKey && normalizeSurpriseSetBrandValue(block.brand) === brand;
      if (!matches) return block;
      const next = { ...block, ...patch };
      const done = Boolean(next.readyForLive);
      return { ...next, status: done ? "Live Ready" : "Not Started" };
    }));
  };

  const toggleTrackerDone = (brand, day, streamKey, done) => {
    patchTrackerBlock(brand, day, streamKey, { readyForLive: done });
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
    const nextSummary = getSetSheetSummary(rows);
    const safeFileName = converterForm.fileName || `${BRAND_SHORT[converterForm.brand] || converterForm.brand}_${converterForm.day}_${converterForm.shift}_setsheet`;
    const entry = {
      id: uid(),
      createdAt: nowISO(),
      ...converterForm,
      fileName: safeFileName,
      rows,
      summary: nextSummary,
    };
    setConverterForm(prev => ({ ...prev, fileName: safeFileName }));
    setConverterRows(rows);
    setConverterConverted(true);
    setConvertedEntries(prev => [entry, ...(Array.isArray(prev) ? prev : [])].slice(0, 20));
    patchTrackerBlock(converterForm.brand, converterForm.day, converterForm.shift, {
      convertedSetSheet: true,
      readyForLive: true,
      setName: safeFileName,
      quantity: nextSummary.totalQuantity,
    });
  };

  const handleDownload = (entry = null) => {
    const rows = entry?.rows || converterRows;
    const fileName = entry?.fileName || converterForm.fileName || "setsheet_export";
    if (!Array.isArray(rows) || rows.length === 0) {
      setConverterError("Convert a surprise set before downloading.");
      return;
    }
    downloadSetSheetRows(rows, fileName);
    const brand = entry?.brand || converterForm.brand;
    const day = entry?.day || converterForm.day;
    const shift = entry?.shift || converterForm.shift;
    patchTrackerBlock(brand, day, shift, { downloadedSetSheet: true, readyForLive: true });
    if (entry?.id) {
      setConvertedEntries(prev => (Array.isArray(prev) ? prev : []).map(item => item.id === entry.id ? { ...item, downloadedAt: nowISO() } : item));
    }
  };

  const handleDownloadAll = () => {
    const safeEntries = Array.isArray(convertedEntries) ? convertedEntries : [];
    if (!safeEntries.length) {
      setConverterError("Convert at least one surprise set first.");
      return;
    }
    safeEntries.forEach(entry => handleDownload(entry));
  };

  const handleResetConverter = () => {
    setConverterForm(defaultConverterForm);
    setConverterRows([]);
    setConverterError("");
    setConverterConverted(false);
  };

  const handleAddAnother = () => {
    setConverterForm(prev => ({ ...prev, fileName: "", input: "" }));
    setConverterRows([]);
    setConverterError("");
    setConverterConverted(false);
  };

  const clearWeek = () => {
    if (!window.confirm("Clear this week's surprise set setup?")) return;
    const fresh = createDefaultWeeklySurpriseSets();
    try { localStorage.removeItem(SURPRISE_SET_STORAGE_KEY); } catch {}
    setSurpriseSets(fresh);
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
          { label: "Total stream blocks", value: totalBlocks, cls: "border-l-slate-400" },
          { label: "Done", value: liveReady, cls: "border-l-green-500" },
          { label: "Not Done", value: notDone, cls: "border-l-gray-400" },
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
              <Sel value={converterForm.brand} onChange={value => updateConverterField("brand", value)} options={BRANDS} placeholder="" />
            </label>
            <label className="space-y-1">
              <FL>Warehouse</FL>
              <Sel value={converterForm.warehouse} onChange={value => updateConverterField("warehouse", value)} options={SETSHEET_WAREHOUSES} placeholder="" />
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
            <label className="space-y-1 sm:col-span-2">
              <FL>File name</FL>
              <Inp value={converterForm.fileName} onChange={value => updateConverterField("fileName", value)} placeholder="name_date_channel" />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <FL>Insert surprise set</FL>
              <Txt value={converterForm.input} onChange={value => updateConverterField("input", value)} placeholder="Paste lines here..." rows={13} className="font-mono text-xs" />
            </label>
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
            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="text-lg font-bold text-gray-900">{summary.totalRows}</p><p className="text-[10px] text-gray-400">unique products</p></div>
                <div><p className="text-lg font-bold text-gray-900">{summary.totalQuantity}</p><p className="text-[10px] text-gray-400">total items</p></div>
                <div><p className="text-lg font-bold text-gray-900">{summary.unknownCount}</p><p className="text-[10px] text-gray-400">unknown items</p></div>
              </div>
              <div className="mt-3 max-h-44 overflow-auto rounded border border-gray-200 bg-white">
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

const REPORT_BRANDS = ["Vaulted Rarities", "CardKing47", "PokeSpins", "Pokiemart"];

const OpsImpactMetricCard = ({ label, value, accent = false, sub }) => (
  <div className={`bg-white border rounded-lg px-3 py-3 ${accent ? "border-l-4 border-l-slate-400 border-t border-r border-b border-gray-200" : "border-gray-200"}`}>
    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-tight">{label}</p>
    <p className={`text-2xl font-bold mt-1 ${accent ? "text-slate-800" : "text-gray-900"}`}>{value}</p>
    {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
  </div>
);

const WeeklyRaiseView = ({ tickets, replacements, studios, surpriseSets, raiseScores, setRaiseScores, inboundMessages }) => {
  // ── Safe arrays ─────────────────────────────────────────────────────────────
  const safeInbound      = Array.isArray(inboundMessages) ? inboundMessages : [];
  const safeReplacements = Array.isArray(replacements)    ? replacements    : [];
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
  const msgsImported    = safeInbound.filter(m => isThisWeek(m.received_at || m.created_at, week.start, week.end)).length || safeInbound.length;
  const needsReply      = safeInbound.filter(m => m.status === "Needs Reply" && !m.archived_at).length;
  const closedMsgs      = safeInbound.filter(m => m.status === "Closed").length;
  const refundsReviewed = safeInbound.filter(m => isTikTokRefund(m) && !m.archived_at).length;
  const replacementsLogged = safeReplacements.filter(r => isThisWeek(r.created_at || r.date, week.start, week.end)).length || safeReplacements.length;
  const followUpsNeeded = safeReplacements.filter(r => !r.archived_at && (r.followUp === "Yes" || r.follow_up === "Yes")).length;
  const studioReady     = safeStudios.filter(s => s.streamReady).length;
  const studioScore     = safeStudios.length ? Math.round((studioReady / safeStudios.length) * 100) : 0;
  const setsReady       = safeSets.filter(s => s.readyForLive).length;
  const draftsGenerated = safeInbound.filter(m => m.ai_draft).length;

  // ── Brand breakdown ──────────────────────────────────────────────────────────
  const brandRows = REPORT_BRANDS.map(brand => ({
    brand,
    open:        safeInbound.filter(m => m.brand === brand && m.status !== "Closed" && !m.archived_at).length,
    closed:      safeInbound.filter(m => m.brand === brand && m.status === "Closed").length,
    refunds:     safeInbound.filter(m => m.brand === brand && isTikTokRefund(m) && !m.archived_at).length,
    replacements: safeReplacements.filter(r => r.brand === brand).length,
  }));

  // ── Estimated time saved ─────────────────────────────────────────────────────
  const timeMins = (msgsImported * 2) + (draftsGenerated * 5) + (safeReplacements.length * 3) + (setsReady * 5);
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
      `  Formula: ${msgsImported} msgs x2 + ${draftsGenerated} drafts x5 + ${safeReplacements.length} replacements x3 + ${setsReady} sets x5`,
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
      alert("Could not copy summary. Please copy it manually.");
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
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors">
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
                  <td className="px-4 py-2.5 text-gray-600">{row.refunds > 0 ? <span className="text-orange-600 font-semibold">{row.refunds}</span> : <span className="text-gray-300">-</span>}</td>
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
          Formula: {msgsImported} messages x 2 min + {draftsGenerated} AI drafts x 5 min + {safeReplacements.length} replacements x 3 min + {setsReady} sets x 5 min
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
const DataManagementView = ({ tickets, replacements, studios, surpriseSets, setTickets, setReplacements, setStudios, setSurpriseSets, raiseScores }) => {
const [confirmClear, setConfirmClear] = useState(false);
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
        .from("tickets")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
    }
    setTickets([]);
    setReplacements([]);
    setStudios(FRESH_STUDIOS);
    setSurpriseSets([]);
    setConfirmClear(false);
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
    setConfirmClear(false);
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
  const [activeView, setActiveViewRaw] = useState(() => {
    const VALID_VIEWS = new Set(["dashboard","inbox","replacements","studio","sets","weekly","data"]);
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
  const [sidekickToast, setSidekickToast] = useState(false);

  // ── Inbox state ──────────────────────────────────────────────────────────────
  const [inboundMessages, setInboundMessages] = useState([]);
  const [inboundLoading, setInboundLoading] = useState(false);
  const [inboundError, setInboundError] = useState("");

  const refreshInbox = async () => {
    setInboundLoading(true);
    setInboundError("");
    const { data, error } = await fetchInboundMessagesFromSupabase();
    setInboundLoading(false);
    if (error) { setInboundError(`Inbox fetch failed: ${error.message}`); return; }
    setInboundMessages(data);
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

  const safeInboundMessages = Array.isArray(inboundMessages) ? inboundMessages : [];
  const safeReplacements = Array.isArray(replacements) ? replacements : [];
  const safeStudios = Array.isArray(studios) ? studios : [];
  const safeSurpriseSets = Array.isArray(surpriseSets) ? surpriseSets : [];
  const safeTickets = Array.isArray(tickets) ? tickets : [];
  const safeOpsActions = Array.isArray(opsActions) ? opsActions : [];

  const openCount = safeTickets.filter(t => t.status !== "Resolved").length;
  const criticalSlaCount = safeTickets.filter(isActiveSlaRisk).length;
  const inboxNeedsReplyCount = safeInboundMessages.filter(m => m.status === "Needs Reply" || !m.status).length;
  const opsOpenCount = safeOpsActions.length;

  const renderView = () => {
    const common = { tickets, setTickets, replacements, setReplacements, studios, setStudios, surpriseSets, setSurpriseSets, raiseScores, setRaiseScores };
    switch (activeView) {
      case "dashboard": return <DashboardView {...common} inboundMessages={inboundMessages} opsActions={opsActions} setActiveView={setActiveView} />;
      case "inbox": return <CommandInboxView inboundMessages={inboundMessages} setInboundMessages={setInboundMessages} inboundLoading={inboundLoading} inboundError={inboundError} onRefresh={refreshInbox} setTickets={setTickets} opsActions={opsActions} setOpsActions={setOpsActions} automationRules={automationRules} automationRulesLoading={automationRulesLoading} />;
      case "actions": return <NextActionQueueView opsActions={opsActions} setOpsActions={setOpsActions} opsLoading={opsLoading} opsError={opsError} onRefresh={refreshOpsActions} setActiveView={setActiveView} />;
      case "daily": return <DailyCommandView tickets={tickets} />;
      case "tickets": return <TicketQueueView tickets={tickets} setTickets={setTickets} />;
      case "browser": return <BrowserProfileView />;
      case "cs": return <CSTemplateView setTickets={setTickets} />;
      case "replacements": return <ReplacementLogView replacements={replacements} setReplacements={setReplacements} replacementsLoading={replacementsLoading} replacementsError={replacementsError} onRefresh={refreshReplacements} />;
      case "studio": return <StudioReadinessView studios={studios} setStudios={setStudios} />;
      case "sets": return <SurpriseSetView surpriseSets={surpriseSets} setSurpriseSets={setSurpriseSets} />;
      case "weekly": return <WeeklyRaiseView tickets={tickets} replacements={replacements} studios={studios} surpriseSets={surpriseSets} raiseScores={raiseScores} setRaiseScores={setRaiseScores} inboundMessages={inboundMessages} />;
      case "data": return <DataManagementView {...common} />;
      default: return <DashboardView {...common} inboundMessages={inboundMessages} opsActions={opsActions} setActiveView={setActiveView} />;
    }
  };

  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Current page label for mobile top bar
  const PAGE_LABELS = {
    dashboard: "Dashboard", inbox: "Command Inbox", actions: "Action Queue",
    daily: "Daily Command Board", tickets: "Tickets", replacements: "Replacements",
    studio: "Inventory", sets: "Surprise Sets", browser: "Browser Profiles",
    cs: "CS Templates", weekly: "Reports", data: "Settings",
  };

  // Nav click: close mobile drawer then switch view
  const handleNavClick = (id) => {
    setActiveView(id);
    setMobileNavOpen(false);
  };

  // Shared nav content rendered inside both the desktop sidebar and the mobile drawer
  const NavContent = ({ showLabels }) => (
    <>
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 space-y-4">
        {NAV.map((section, si) => (
          <div key={si}>
            {section.section && showLabels && (
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3 mb-1">{section.section}</p>
            )}
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
      {/* Sidekick toast */}
      {sidekickToast && (
        <div className="fixed right-4 bottom-20 z-[9999] flex items-center gap-2 rounded-lg border border-green-700 bg-green-600 px-4 py-3 text-sm font-semibold text-white shadow-lg" role="status">
          <span>✓</span>
          <span>Ticket pushed from OP Sidekick.</span>
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
            <p className="text-[10px] text-gray-400">Command Center v1.5</p>
          </div>
          <button onClick={() => setMobileNavOpen(false)} className="text-gray-400 hover:text-gray-700 text-xl leading-none p-1">×</button>
        </div>
        <NavContent showLabels={true} />
      </div>

      {/* ── DESKTOP SIDEBAR (hidden on mobile) ── */}
      <aside
        style={{ width: sidebar ? 224 : 56, transition: "width .2s" }}
        className="hidden md:flex flex-shrink-0 bg-white border-r border-gray-200 flex-col overflow-hidden"
      >
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 space-y-4">
          <button
            onClick={() => setSidebar(s => !s)}
            title={sidebar ? "Collapse sidebar" : "Expand sidebar"}
            className={`mb-2 flex h-8 items-center rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 ${sidebar ? "w-full justify-end px-3" : "w-full justify-center px-0"}`}
          >
            {sidebar ? "<" : ">"}
          </button>
          {NAV.map((section, si) => (
            <div key={si}>
              {section.section && sidebar && <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3 mb-1">{section.section}</p>}
              <div className="space-y-0.5">
                {section.items.map(item => (
                  <NavItem key={item.id} {...item} active={activeView === item.id} onClick={setActiveView}
                    showLabel={sidebar}
                    badge={item.id === "tickets" ? criticalSlaCount : item.id === "inbox" ? inboxNeedsReplyCount : item.id === "actions" ? opsOpenCount : 0} />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className={`border-t border-gray-100 px-3 py-3 flex-shrink-0 ${sidebar ? "flex justify-start" : "flex justify-center"}`}>
          <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-gray-600">JV</span>
          </div>
        </div>
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
              <p className="text-sm font-bold text-gray-900 leading-tight">Ops Command Hub v1.5</p>
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
            {inboxNeedsReplyCount > 0 && (
              <button onClick={() => handleNavClick("inbox")} className="relative text-gray-500">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2a5 5 0 0 1 5 5v3l2 2H2l2-2V7a5 5 0 0 1 5-5z" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M7 15.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                <span className="absolute -top-1 -right-1 text-[9px] bg-red-500 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">{inboxNeedsReplyCount > 9 ? "9+" : inboxNeedsReplyCount}</span>
              </button>
            )}
          </div>
        </div>

        {/* ── DESKTOP TOP BAR (hidden on mobile) ── */}
        <header className="hidden md:flex bg-white border-b border-gray-200 px-6 py-3 items-center justify-between flex-shrink-0">
          <p className="text-sm font-bold text-gray-900">Ops Command Hub v1.5</p>
          <div className="flex items-center gap-3">
            <NotificationDropdown
              inboundMessages={safeInboundMessages}
              opsActions={safeOpsActions}
              replacements={safeReplacements}
              setActiveView={setActiveView}
            />
          </div>
        </header>

        {/* ── PAGE CONTENT ── */}
        <main className="flex-1 overflow-y-auto pb-16 md:pb-0" style={{ background: "#f3f4f6" }}>
          <div className="max-w-screen-xl mx-auto px-3 md:px-6 py-4 md:py-5">{renderView()}</div>
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







