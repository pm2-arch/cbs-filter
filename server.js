// gaxios / node-fetch fix for Node.js 22 + Cloud Run:
// 1. Patch Gaxios.prototype.request to inject native fetch (avoids ERR_STREAM_PREMATURE_CLOSE).
// 2. Wrap native fetch with duplex:'half' injection (Undici requires it for POST bodies).
{
  const _gx = require("gaxios");
  if (typeof globalThis.fetch === "function" && _gx && _gx.Gaxios) {
    const _nf = globalThis.fetch.bind(globalThis);
    const _df = (url, init) => {
      if (init && init.body != null && !init.duplex) init = { ...init, duplex: "half" };
      return _nf(url, init);
    };
    const _orig = _gx.Gaxios.prototype.request;
    _gx.Gaxios.prototype.request = function (opts, ...rest) {
      if (opts && !opts.fetchImplementation) opts = { ...opts, fetchImplementation: _df };
      return _orig.call(this, opts, ...rest);
    };
  }
}

const express = require("express");
const { google } = require("googleapis");
const XLSX = require("xlsx");
const PDFDocument = require("pdfkit");
const path = require("path");
const { Readable } = require("stream");
const { Firestore } = require("@google-cloud/firestore");
const crypto = require("crypto");

const NETBANK_LOGO_PATH = path.join(__dirname, "public", "brand", "favicon-192.png");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "";
const CBS_MAIN_FOLDER_ID = process.env.CBS_MAIN_FOLDER_ID || "1Dl38eXZ7b9YjdBKcKnJFjdT3gDBGbJ_W";
// Values-only templates (formulas removed from the report; invoice keeps its safe
// Total/Amount-Due sum-formulas). Both are .xlsx uploads → converted to native Sheets on copy.
const BILLING_TEMPLATE_ID = process.env.BILLING_TEMPLATE_ID || "15BdYOpn4tUIEk3AB4xWU_WgLGYhbsEH3";
const INVOICE_TEMPLATE_ID = process.env.INVOICE_TEMPLATE_ID || "1wcZqlCUUBR6rhdf_iRSSj7uGjVjfvOzG";
const BILLING_PARENT_FOLDER_ID = process.env.BILLING_PARENT_FOLDER_ID || "12ZCC-rS-wplcT3anilQhCNzhz5NBqgzq";

const db = new Firestore({ projectId: "onyx-drive-bridge" });
const PARTNERS_COLLECTION = "billing_partners";

// ---------------------------------------------------------------------------
// Admin key auth — protects /admin/* routes with a shared secret.
// Set ADMIN_KEY env var on Cloud Run. Leave blank to disable (open access).
// ---------------------------------------------------------------------------
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const ADMIN_COOKIE = "admin_sid";
const ADMIN_TOKEN = ADMIN_KEY
  ? crypto.createHash("sha256").update(ADMIN_KEY).digest("hex")
  : "";

function getAdminCookie(req) {
  const raw = req.headers.cookie || "";
  for (const pair of raw.split(";")) {
    const [k, ...vParts] = pair.trim().split("=");
    if (k.trim() === ADMIN_COOKIE) return vParts.join("=").trim();
  }
  return "";
}

function isAdminAuthed(req) {
  if (!ADMIN_KEY) return true;
  const cookie = getAdminCookie(req);
  if (!cookie || cookie.length !== ADMIN_TOKEN.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(cookie, "hex"), Buffer.from(ADMIN_TOKEN, "hex"));
  } catch { return false; }
}

function requireAdmin(req, res, next) {
  if (isAdminAuthed(req)) return next();
  const back = encodeURIComponent(req.originalUrl);
  res.redirect(`/admin/login?back=${back}`);
}

// ---------------------------------------------------------------------------
// Partner registry — 10 partners as of 2026-07-27. Add more as they are signed.
// Each partner has:
//   - id: stable URL-safe slug used in API requests
//   - name: canonical display name (also the folder name in Drive)
//   - productId: canonical Product ID from the partner table
//   - invoicePrefix: prefix used in invoice filenames (e.g. "Magicpayment-NNNN")
//   - customerId: invoice Customer ID; blank until partner-specific IDs are confirmed
//   - billedTo: default invoice "BILLED TO" block (6 lines). Pre-fills the wizard
//       fields; the officer can edit per run. Blank object = no default (shown blank).
//       Lines map to invoice rows below the "BILLED TO" label, top→bottom:
//       contact, company, address1, address2, country, email.
// ---------------------------------------------------------------------------
const EMPTY_BILLED_TO = { contact: "", company: "", address1: "", address2: "", country: "", email: "" };

const PARTNERS = [
  {
    id: "magic-payment",
    name: "Magic Payment",
    productId: "86da22dc-f8ff-4cae-b917-e2f0df4aa22a",
    invoicePrefix: "Magicpayment",
    customerId: "Magic-Payment-Inc",
    excludeOutgoingPesonet: true,
    billedTo: {
      contact: "Gil Benosa",
      company: "Magic Payment Inc.",
      address1: "98 Unit 2322 Cityland Herrera Tower, Rufino Cor Valero St.",
      address2: "Salcedo Village, Makati City",
      country: "Philippines",
      email: "giltanber01@gmail.com",
    },
  },
  {
    id: "hopay",
    name: "Hopay Philippines, Inc",
    productId: "69ad208e-dae7-436c-bc80-022d4c436474",
    invoicePrefix: "Hopay",
    customerId: "",
    excludeOutgoingPesonet: true,
    outgoingExcludeReasons: ["FF02", "FF10", "PAYMENT HUB GATEWAY ERROR", "DS24"],
    billedTo: { ...EMPTY_BILLED_TO },
  },
  {
    id: "payeasy",
    name: "Payeasy Technology, Inc",
    productId: "c87c6d0c-bc30-4d69-81a3-5806a769a86e",
    invoicePrefix: "Payeasy",
    customerId: "",
    excludeOutgoingPesonet: true,
    billedTo: { ...EMPTY_BILLED_TO },
  },
  {
    id: "v5-philippines",
    name: "V5 Philippines Corp.",
    productId: "b8994d97-dc38-4dea-9eea-2bad9f6eaf21",
    invoicePrefix: "V5Philippines",
    customerId: "",
    billedTo: { ...EMPTY_BILLED_TO },
    hasVca: true,
  },
  {
    id: "topjuantech",
    name: "Topjuantech Corp Inc",
    productId: "c43ec6d0-a4b9-4135-b1f0-72e9b89e66c1",
    invoicePrefix: "Topjuantech",
    customerId: "",
    billedTo: { ...EMPTY_BILLED_TO },
    hasVca: true,
  },
  {
    id: "seveninfo",
    name: "SevenInfo Company",
    productId: "7ef39139-8c22-4a47-8d60-df65191dc317",
    invoicePrefix: "SevenInfo",
    customerId: "",
    billedTo: { ...EMPTY_BILLED_TO },
    hasVca: true,
    settledOnlyOutgoing: true,
  },
  {
    id: "maxjoy",
    name: "Maxjoy Technologies Corporation",
    productId: "259aeeb8-8de9-48b2-ba82-e5fae56486dd",
    invoicePrefix: "Maxjoy",
    customerId: "",
    billedTo: { ...EMPTY_BILLED_TO },
    hasVca: true,
    settledOnlyOutgoing: false,
  },
  {
    id: "aio",
    name: "AIO Solutions Inc.",
    productId: "05aa5b25-9291-41ee-bd24-e8d50fdd1419",
    productIds: [
      "05aa5b25-9291-41ee-bd24-e8d50fdd1419",
      "b97d6271-bdcf-4f03-b2e8-6959997e167c",
      "cb0180aa-ec29-4196-b47d-2f5c86aef7e5",
      "c04d319b-c45a-4f5f-9125-9b14f56ff87f",
    ],
    invoicePrefix: "AIO",
    customerId: "",
    billedTo: { ...EMPTY_BILLED_TO },
    hasVca: true,
    settledOnlyOutgoing: false,
  },
  {
    id: "vlpay",
    name: "VLPay",
    productId: "07fd8d34-4d40-4e36-831f-f345c2df1adc",
    invoicePrefix: "VLPay",
    customerId: "",
    billedTo: { ...EMPTY_BILLED_TO },
    hasVca: true,
    settledOnlyOutgoing: false,
  },
  {
    id: "justpayto",
    name: "JustPayto Philippines Corporation",
    productId: "18d10c21-e36a-4b73-82b5-7b727ed408f6",
    invoicePrefix: "JustPayto",
    customerId: "",
    billedTo: { ...EMPTY_BILLED_TO },
    hasVca: true,
    settledOnlyOutgoing: true,
  },
];

// ---------------------------------------------------------------------------
// Per-partner fee rules — source of truth: Billing Team's "Daily Billing Fee
// Mechanism_updated" (Drive 1CTboCyY-xV4KpMTrfmbXHED9iQwZk6Cb), confirmed 2026-06-10.
//   qrph(amount)        → PHP fee for ONE incoming QRPH (QR_P2M, SETTLED) txn.
//   vca(amount)         → PHP fee for ONE incoming VCA (P2P / QR_P2P) txn — flat per txn;
//                         0 means N/A (partner is not billed for P2P). Incoming rows are
//                         split by Transfer mode: QR_P2M → qrph(), P2P/QR_P2P → vca().
//   disburse.interbank  → PHP per outgoing txn whose recipient code ≠ CUOBPHM2XXX.
//   disburse.intrabank  → PHP per outgoing txn whose recipient code = CUOBPHM2XXX
//                         (Netbank-to-Netbank). ONLY Magic Payment differs from interbank;
//                         for every other partner interbank === intrabank (flat per txn).
// Topjuantech QRPH is flat-tier: amount ≥ 1000 → ₱7/txn; else ₱2/txn.
// ---------------------------------------------------------------------------
const FEE_RULES = {
  "magic-payment": {
    qrph: (amt) => Math.max(amt * 0.007, 1),
    vca: () => 0, // VCA N/A
    disburse: { interbank: 3.5, intrabank: 2 },
    qrphNote: "QR_P2M: 0.7% or 1 whichever is higher per transaction",
    vcaNote: "P2P (VCA): N/A",
    disburseNote: "Php 3.5 interbank / Php 2 intrabank (col K = CUOBPHM2XXX)",
  },
  "hopay": {
    qrph: (amt) => Math.min(Math.max(amt * 0.007, 1), 7),
    vca: () => 0, // VCA N/A
    disburse: { interbank: 3.5, intrabank: 3.5 },
    qrphNote: "QR_P2M: 0.7% or 1 whichever is higher, capped at 7 per transaction",
    vcaNote: "P2P (VCA): N/A",
    disburseNote: "Php 3.5 per transaction",
  },
  "payeasy": {
    qrph: (amt) => Math.min(Math.max(amt * 0.007, 1), 7),
    vca: () => 0, // VCA N/A
    disburse: { interbank: 3.5, intrabank: 3.5 },
    qrphNote: "QR_P2M: 0.7% or 1 whichever is higher, capped at 7 per transaction",
    vcaNote: "P2P (VCA): N/A",
    disburseNote: "Php 3.5 per transaction",
  },
  "v5-philippines": {
    qrph: (amt) => Math.min(Math.max(amt * 0.009, 2), 6),
    vca: () => 8, // VCA Php 8/txn
    disburse: { interbank: 3.5, intrabank: 3.5 },
    qrphNote: "QR_P2M: 0.9% or PHP 2 whichever is higher, capped at PHP 6",
    vcaNote: "P2P (VCA): Php 8 per transaction",
    disburseNote: "Php 3.50 per transaction (Instapay/PESONet)",
  },
  "topjuantech": {
    qrph: (amt) => Math.max(amt * 0.007, 1.50),
    vca: () => 7, // VCA Php 7/txn
    disburse: { interbank: 5, intrabank: 5 },
    qrphNote: "QR_P2M: 0.7% or PHP 1.50 whichever is higher (updated Aug 15, 2026)",
    vcaNote: "P2P (VCA): Php 7 per transaction",
    disburseNote: "Php 5 per transaction",
  },
  "seveninfo": {
    qrph: (amt) => Math.min(Math.max(amt * 0.007, 0.90), 7.00),
    vca: () => 8,
    disburse: { interbank: 3.6, intrabank: 3.6 },
    qrphNote: "QR_P2M: 0.7%, floor PHP 0.90, cap PHP 7.00",
    vcaNote: "P2P (VCA): PHP 8 per transaction",
    disburseNote: "PHP 3.60 per transaction",
  },
  "maxjoy": {
    qrph: () => 10,
    vca: () => 10,
    disburse: { interbank: 10, intrabank: 10 },
    qrphNote: "QR_P2M: flat PHP 10 per transaction",
    vcaNote: "P2P (VCA): flat PHP 10 per transaction",
    disburseNote: "PHP 10 per transaction",
  },
  "aio": {
    // QRPH/VCA: amount-tier + run-count-tier. Second arg = total matched row count for the run.
    // txn amount <=600 → PHP 6; >600 and run <30k txns → PHP 10; >600 and run >=30k → PHP 8.
    qrph: (amt, count) => amt <= 600 ? 6 : (count != null && count >= 30000 ? 8 : 10),
    vca:  (amt, count) => amt <= 600 ? 6 : (count != null && count >= 30000 ? 8 : 10),
    disburse: { interbank: 0, intrabank: 0 }, // overridden by disburseByAmount below
    disburseByAmount: (amt) => amt > 500 ? 6 : 4,
    qrphNote: "QR_P2M: PHP 6 if txn <=PHP 600; PHP 10 if >PHP 600 and run <30k txns; PHP 8 if >PHP 600 and run >=30k txns",
    vcaNote: "P2P (VCA): same tier as QRPH",
    disburseNote: "PHP 4 per txn <=PHP 500; PHP 6 per txn >PHP 500",
  },
  "vlpay": {
    qrph: (amt) => Math.max(amt * 0.007, 1.40),
    vca: () => 15,
    disburse: { interbank: 3.5, intrabank: 3.5 },
    qrphNote: "QR_P2M: 0.7%, floor PHP 1.40, no cap",
    vcaNote: "P2P (VCA): PHP 15 per transaction",
    disburseNote: "PHP 3.50 per transaction",
  },
  "justpayto": {
    qrph: (amt) => Math.max(amt * 0.007, 1.50),
    vca: () => 0,
    disburse: { interbank: 3.5, intrabank: 3.5 },
    qrphNote: "QR_P2M: 0.7%, floor PHP 1.50, no cap",
    vcaNote: "No VCA charge",
    disburseNote: "PHP 3.50 per transaction",
  },
};
// ---------------------------------------------------------------------------
// Structured fee specs — source of truth for Admin UI and Firestore seed.
// Each partner entry embeds its fee rules as JSON-serializable specs so they
// can be stored in Firestore and edited via the admin page.
// ---------------------------------------------------------------------------
const PARTNER_SEED = [
  { id: "magic-payment", name: "Magic Payment", productId: "86da22dc-f8ff-4cae-b917-e2f0df4aa22a", productIds: [], invoicePrefix: "Magicpayment", customerId: "Magic-Payment-Inc", hasVca: false, settledOnlyOutgoing: false, excludeOutgoingPesonet: true, outgoingExcludeReasons: [], billedTo: { contact: "Gil Benosa", company: "Magic Payment Inc.", address1: "98 Unit 2322 Cityland Herrera Tower, Rufino Cor Valero St.", address2: "Salcedo Village, Makati City", country: "Philippines", email: "giltanber01@gmail.com" }, fees: { qrph: { type: "pct_floor", pct: 0.007, floor: 1 }, vca: { type: "zero" }, disburse: { type: "flat_rates", interbank: 3.5, intrabank: 2 }, notes: { qrph: "0.7% or PHP 1 whichever is higher", vca: "N/A", disburse: "PHP 3.5 interbank / PHP 2 intrabank" } }, order: 0 },
  { id: "hopay", name: "Hopay Philippines, Inc", productId: "69ad208e-dae7-436c-bc80-022d4c436474", productIds: [], invoicePrefix: "Hopay", customerId: "", hasVca: false, settledOnlyOutgoing: false, excludeOutgoingPesonet: true, outgoingExcludeReasons: ["FF02", "FF10", "PAYMENT HUB GATEWAY ERROR", "DS24"], billedTo: { contact: "", company: "", address1: "", address2: "", country: "", email: "" }, fees: { qrph: { type: "pct_floor_cap", pct: 0.007, floor: 1, cap: 7 }, vca: { type: "zero" }, disburse: { type: "flat_rates", interbank: 3.5, intrabank: 3.5 }, notes: { qrph: "0.7% or PHP 1 whichever is higher, capped at PHP 7", vca: "N/A", disburse: "PHP 3.5 per transaction" } }, order: 1 },
  { id: "payeasy", name: "Payeasy Technology, Inc", productId: "c87c6d0c-bc30-4d69-81a3-5806a769a86e", productIds: [], invoicePrefix: "Payeasy", customerId: "", hasVca: false, settledOnlyOutgoing: false, excludeOutgoingPesonet: true, outgoingExcludeReasons: [], billedTo: { contact: "", company: "", address1: "", address2: "", country: "", email: "" }, fees: { qrph: { type: "pct_floor_cap", pct: 0.007, floor: 1, cap: 7 }, vca: { type: "zero" }, disburse: { type: "flat_rates", interbank: 3.5, intrabank: 3.5 }, notes: { qrph: "0.7% or PHP 1 whichever is higher, capped at PHP 7", vca: "N/A", disburse: "PHP 3.5 per transaction" } }, order: 2 },
  { id: "v5-philippines", name: "V5 Philippines Corp.", productId: "b8994d97-dc38-4dea-9eea-2bad9f6eaf21", productIds: [], invoicePrefix: "V5Philippines", customerId: "", hasVca: true, settledOnlyOutgoing: false, excludeOutgoingPesonet: false, outgoingExcludeReasons: [], billedTo: { contact: "", company: "", address1: "", address2: "", country: "", email: "" }, fees: { qrph: { type: "pct_floor_cap", pct: 0.009, floor: 2, cap: 6 }, vca: { type: "flat", value: 8 }, disburse: { type: "flat_rates", interbank: 3.5, intrabank: 3.5 }, notes: { qrph: "0.9% or PHP 2 whichever is higher, capped at PHP 6", vca: "PHP 8 per transaction", disburse: "PHP 3.50 per transaction (Instapay/PESONet)" } }, order: 3 },
  { id: "topjuantech", name: "Topjuantech Corp Inc", productId: "c43ec6d0-a4b9-4135-b1f0-72e9b89e66c1", productIds: [], invoicePrefix: "Topjuantech", customerId: "", hasVca: true, settledOnlyOutgoing: false, excludeOutgoingPesonet: false, outgoingExcludeReasons: [], billedTo: { contact: "", company: "", address1: "", address2: "", country: "", email: "" }, fees: { qrph: { type: "pct_floor", pct: 0.007, floor: 1.50 }, vca: { type: "flat", value: 7 }, disburse: { type: "flat_rates", interbank: 5, intrabank: 5 }, notes: { qrph: "0.7% or PHP 1.50 whichever is higher (updated Aug 15, 2026)", vca: "PHP 7 per transaction", disburse: "PHP 5 per transaction" } }, order: 4 },
  { id: "seveninfo", name: "SevenInfo Company", productId: "7ef39139-8c22-4a47-8d60-df65191dc317", productIds: [], invoicePrefix: "SevenInfo", customerId: "", hasVca: true, settledOnlyOutgoing: true, excludeOutgoingPesonet: false, outgoingExcludeReasons: [], billedTo: { contact: "", company: "", address1: "", address2: "", country: "", email: "" }, fees: { qrph: { type: "pct_floor_cap", pct: 0.007, floor: 0.90, cap: 7 }, vca: { type: "flat", value: 8 }, disburse: { type: "flat_rates", interbank: 3.6, intrabank: 3.6 }, notes: { qrph: "0.7%, floor PHP 0.90, cap PHP 7.00", vca: "PHP 8 per transaction", disburse: "PHP 3.60 per transaction" } }, order: 5 },
  { id: "maxjoy", name: "Maxjoy Technologies Corporation", productId: "259aeeb8-8de9-48b2-ba82-e5fae56486dd", productIds: [], invoicePrefix: "Maxjoy", customerId: "", hasVca: true, settledOnlyOutgoing: false, excludeOutgoingPesonet: false, outgoingExcludeReasons: [], billedTo: { contact: "", company: "", address1: "", address2: "", country: "", email: "" }, fees: { qrph: { type: "flat", value: 10 }, vca: { type: "flat", value: 10 }, disburse: { type: "flat_rates", interbank: 10, intrabank: 10 }, notes: { qrph: "PHP 10 per transaction", vca: "PHP 10 per transaction", disburse: "PHP 10 per transaction" } }, order: 6 },
  { id: "aio", name: "AIO Solutions Inc.", productId: "05aa5b25-9291-41ee-bd24-e8d50fdd1419", productIds: ["05aa5b25-9291-41ee-bd24-e8d50fdd1419", "b97d6271-bdcf-4f03-b2e8-6959997e167c", "cb0180aa-ec29-4196-b47d-2f5c86aef7e5", "c04d319b-c45a-4f5f-9125-9b14f56ff87f"], invoicePrefix: "AIO", customerId: "", hasVca: true, settledOnlyOutgoing: false, excludeOutgoingPesonet: false, outgoingExcludeReasons: [], billedTo: { contact: "", company: "", address1: "", address2: "", country: "", email: "" }, fees: { qrph: { type: "tiered_amount_count", amtThreshold: 600, lowFee: 10, highFeeDefault: 10, countThreshold: 30000, highFeeAtCount: 8 }, vca: { type: "tiered_amount_count", amtThreshold: 600, lowFee: 6, highFeeDefault: 10, countThreshold: 30000, highFeeAtCount: 8 }, disburse: { type: "by_amount", amtThreshold: 500, lowFee: 4, highFee: 6 }, notes: { qrph: "PHP 10 if run <30k txns; PHP 8 if run >=30k txns", vca: "PHP 6 if amt <=600; PHP 10 if >600 and run <30k txns; PHP 8 if >600 and run >=30k txns", disburse: "PHP 4 per txn <=500; PHP 6 per txn >500" } }, order: 7 },
  { id: "vlpay", name: "VLPay", productId: "07fd8d34-4d40-4e36-831f-f345c2df1adc", productIds: [], invoicePrefix: "VLPay", customerId: "", hasVca: true, settledOnlyOutgoing: false, excludeOutgoingPesonet: false, outgoingExcludeReasons: [], billedTo: { contact: "", company: "", address1: "", address2: "", country: "", email: "" }, fees: { qrph: { type: "pct_floor", pct: 0.007, floor: 1.40 }, vca: { type: "flat", value: 15 }, disburse: { type: "flat_rates", interbank: 3.5, intrabank: 3.5 }, notes: { qrph: "0.7%, floor PHP 1.40", vca: "PHP 15 per transaction", disburse: "PHP 3.50 per transaction" } }, order: 8 },
  { id: "justpayto", name: "JustPayto Philippines Corporation", productId: "18d10c21-e36a-4b73-82b5-7b727ed408f6", productIds: [], invoicePrefix: "JustPayto", customerId: "", hasVca: false, settledOnlyOutgoing: true, excludeOutgoingPesonet: false, outgoingExcludeReasons: [], billedTo: { contact: "", company: "", address1: "", address2: "", country: "", email: "" }, fees: { qrph: { type: "pct_floor", pct: 0.007, floor: 1.50 }, vca: { type: "zero" }, disburse: { type: "flat_rates", interbank: 3.5, intrabank: 3.5 }, notes: { qrph: "0.7%, floor PHP 1.50", vca: "No VCA charge", disburse: "PHP 3.50 per transaction" } }, order: 9 },
];

// Build a runtime fee function from a stored fee spec.
function buildFeeFunc(spec) {
  if (!spec) return () => 0;
  switch (spec.type) {
    case "zero": return () => 0;
    case "flat": return () => Number(spec.value) || 0;
    case "pct_floor": return (amt) => Math.max(amt * spec.pct, spec.floor);
    case "pct_floor_cap": return (amt) => Math.min(Math.max(amt * spec.pct, spec.floor), spec.cap);
    case "tiered_amount": {
      const tiers = spec.tiers || [];
      return (amt) => {
        for (const t of tiers) {
          if (t.maxAmt === undefined || amt <= t.maxAmt) return t.fee;
        }
        return (tiers[tiers.length - 1] || {}).fee || 0;
      };
    }
    case "tiered_amount_count":
      return (amt, count) =>
        amt <= spec.amtThreshold ? spec.lowFee
        : (count != null && count >= spec.countThreshold ? spec.highFeeAtCount : spec.highFeeDefault);
    default: return () => 0;
  }
}

// Rebuild runtime fee rules object from a partner's stored fees spec.
function buildFeeRulesForPartner(partner) {
  const fees = (partner && partner.fees) || {};
  const qrph = buildFeeFunc(fees.qrph);
  const vca = fees.vca ? buildFeeFunc(fees.vca) : qrph;
  const ds = fees.disburse || {};
  const disburseByAmount = ds.type === "by_amount"
    ? (amt) => amt > ds.amtThreshold ? ds.highFee : ds.lowFee
    : null;
  return {
    qrph,
    vca,
    disburse: ds.type === "flat_rates"
      ? { interbank: ds.interbank || 0, intrabank: ds.intrabank || 0 }
      : { interbank: 0, intrabank: 0 },
    disburseByAmount,
    qrphNote: (fees.notes && fees.notes.qrph) || "",
    vcaNote: (fees.notes && fees.notes.vca) || "",
    disburseNote: (fees.notes && fees.notes.disburse) || "",
  };
}

// In-memory partner cache — loaded at startup, refreshed after admin writes.
let _partners = null;
let _feeRulesMap = {};

async function seedFirestoreIfEmpty() {
  const snap = await db.collection(PARTNERS_COLLECTION).limit(1).get();
  if (!snap.empty) return;
  console.log("[init] Seeding Firestore billing_partners from PARTNER_SEED...");
  const batch = db.batch();
  for (const p of PARTNER_SEED) {
    batch.set(db.collection(PARTNERS_COLLECTION).doc(p.id), p);
  }
  await batch.commit();
  console.log(`[init] Seeded ${PARTNER_SEED.length} partners.`);
}

// Default vcaConfig for partners seeded before the vcaConfig field was added.
// Applied once on startup to any Firestore partner that has hasVca=true but no vcaConfig.
// After patching, admin portal can override these via Detection Rules tab.
const VCA_CONFIG_DEFAULTS = {
  "v5-philippines": { channels: ["INSTAPAY", "PESONET"], transferModes: ["P2P", "QR_P2P", ""], requireRefCode: true },
  "topjuantech":    { channels: ["INSTAPAY"], transferModes: ["P2P", "QR_P2P"], requireRefCode: true },
  "seveninfo":      { channels: ["INSTAPAY"], transferModes: ["P2P", "QR_P2P"], requireRefCode: true },
  "maxjoy":         { channels: ["INSTAPAY"], transferModes: ["P2P", "QR_P2P"], requireRefCode: true },
  "aio":            { channels: ["INSTAPAY"], transferModes: ["P2P", "QR_P2P", ""], requireRefCode: false },
  "vlpay":          { channels: ["INSTAPAY"], transferModes: ["P2P", "QR_P2P"], requireRefCode: true },
  "justpayto":      { channels: ["INSTAPAY"], transferModes: ["P2P", "QR_P2P"], requireRefCode: true },
};

async function patchMissingVcaConfig() {
  const snap = await db.collection(PARTNERS_COLLECTION).get();
  const batch = db.batch();
  let patchCount = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.hasVca && !data.vcaConfig) {
      const defaultVc = VCA_CONFIG_DEFAULTS[doc.id] || {
        channels: ["INSTAPAY"], transferModes: ["P2P", "QR_P2P"], requireRefCode: true,
      };
      batch.update(doc.ref, { vcaConfig: defaultVc });
      patchCount++;
    }
  }
  if (patchCount > 0) {
    await batch.commit();
    console.log(`[init] Patched vcaConfig for ${patchCount} partner(s).`);
  }
}

async function loadFromFirestore() {
  const snap = await db.collection(PARTNERS_COLLECTION).orderBy("order").get();
  return snap.docs.map(d => ({ ...d.data() }));
}

async function initPartners() {
  await seedFirestoreIfEmpty();
  await patchMissingVcaConfig();
  const partners = await loadFromFirestore();
  _partners = partners;
  _feeRulesMap = {};
  for (const p of _partners) _feeRulesMap[p.id] = buildFeeRulesForPartner(p);
  console.log(`[init] Loaded ${_partners.length} partners from Firestore.`);
}

async function refreshPartners() {
  const partners = await loadFromFirestore();
  _partners = partners;
  _feeRulesMap = {};
  for (const p of _partners) _feeRulesMap[p.id] = buildFeeRulesForPartner(p);
}

function validatePartnerInput(body) {
  const id = String(body.id || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  if (!id) throw new Error("Partner ID is required");
  const name = String(body.name || "").trim();
  if (!name) throw new Error("Partner name is required");
  const productId = String(body.productId || "").trim();
  if (!productId) throw new Error("Product ID is required");
  const productIds = Array.isArray(body.productIds)
    ? body.productIds.map(s => String(s).trim()).filter(Boolean)
    : (body.productIds ? String(body.productIds).split(",").map(s => s.trim()).filter(Boolean) : []);
  const billedTo = normalizeBilledTo(body.billedTo || {});
  const fees = (body.fees && typeof body.fees === "object") ? body.fees : {};
  // VCA detection config
  const vc = (body.vcaConfig && typeof body.vcaConfig === "object") ? body.vcaConfig : {};
  const vcaConfig = {
    channels: Array.isArray(vc.channels) ? vc.channels.map(String) : ["INSTAPAY"],
    transferModes: Array.isArray(vc.transferModes) ? vc.transferModes.map(String) : ["P2P", "QR_P2P"],
    requireRefCode: vc.requireRefCode !== false,
  };
  // Mechanics notes (per direction, for documentation)
  const mn = (body.mechanicsNotes && typeof body.mechanicsNotes === "object") ? body.mechanicsNotes : {};
  const mechanicsNotes = {
    qrph: String(mn.qrph || "").trim(),
    vca: String(mn.vca || "").trim(),
    outgoing: String(mn.outgoing || "").trim(),
    intl: String(mn.intl || "").trim(),
  };
  return {
    id,
    name,
    productId,
    productIds,
    invoicePrefix: String(body.invoicePrefix || name.replace(/\s+/g, "")).trim(),
    customerId: String(body.customerId || "").trim(),
    hasVca: !!body.hasVca,
    vcaConfig,
    settledOnlyOutgoing: !!body.settledOnlyOutgoing,
    excludeOutgoingPesonet: !!body.excludeOutgoingPesonet,
    outgoingExcludeReasons: Array.isArray(body.outgoingExcludeReasons)
      ? body.outgoingExcludeReasons.map(s => String(s).trim()).filter(Boolean)
      : (body.outgoingExcludeReasons ? String(body.outgoingExcludeReasons).split(",").map(s => s.trim()).filter(Boolean) : []),
    billedTo,
    fees,
    mechanicsNotes,
    order: typeof body.order === "number" ? body.order : Date.now(),
  };
}

// Fall back to Magic Payment's rules for any unmapped partner (keeps old behavior safe).
function feeRules(partner) {
  if (_feeRulesMap && _feeRulesMap[partner.id]) return _feeRulesMap[partner.id];
  return FEE_RULES[partner.id] || FEE_RULES["magic-payment"];
}

// Normalize an arbitrary billed-to object to the 6 known string fields (missing → "").
function normalizeBilledTo(src) {
  const s = (src && typeof src === "object") ? src : {};
  return {
    contact: String(s.contact || ""),
    company: String(s.company || ""),
    address1: String(s.address1 || ""),
    address2: String(s.address2 || ""),
    country: String(s.country || ""),
    email: String(s.email || ""),
  };
}

function productCode(partner) {
  return `(Prod)${partner.productId}`;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Round a peso amount to centavos (2 decimals). Source QRPH fees can carry
// fractional centavos (e.g. 926.637); every billed/reported figure must be
// rounded to 2 decimals so the invoice, report, and console all agree.
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function getPartner(idOrCode) {
  const list = _partners || PARTNERS;
  return list.find(p =>
    p.id === idOrCode ||
    p.productId === idOrCode ||
    productCode(p) === idOrCode ||
    (Array.isArray(p.productIds) && p.productIds.some(pid => pid === idOrCode || `(Prod)${pid}` === idOrCode))
  );
}

// Back-compat: keep MAGIC_CODE alive for any legacy callers
const MAGIC_CODE = productCode(PARTNERS[0]);

const auth = new google.auth.GoogleAuth({
  scopes: [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
  ],
});

let driveClient, sheetsClient;
async function getClients() {
  if (!driveClient || !sheetsClient) {
    const authClient = await auth.getClient();
    driveClient = google.drive({ version: "v3", auth: authClient });
    sheetsClient = google.sheets({ version: "v4", auth: authClient });
  }
  return { drive: driveClient, sheets: sheetsClient };
}

function authMiddleware(req, res, next) {
  if (!API_KEY) return next();
  const provided = req.headers["x-api-key"];
  if (provided !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized — invalid or missing x-api-key" });
  }
  next();
}

// ---------------------------------------------------------------------------
// Column helpers
// ---------------------------------------------------------------------------
function colLetterToIndex(letter) {
  let n = 0;
  for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function colIndexToLetter(idx) {
  let result = "";
  let n = idx;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

function resolveColumn(spec, headerRow) {
  if (typeof spec === "number") return spec;
  // Header-name match wins over column-letter parsing — otherwise multi-letter
  // header names like "Status" get misread as column references ("Status" → col 6,397,393).
  const idx = headerRow.findIndex(
    (h) => String(h ?? "").trim().toLowerCase() === String(spec).trim().toLowerCase()
  );
  if (idx !== -1) return idx;
  if (/^[A-Za-z]+$/.test(spec)) return colLetterToIndex(spec);
  throw new Error(`Column "${spec}" not found in header row and not a valid column letter`);
}

// ---------------------------------------------------------------------------
// Read source rows (Google Sheet OR .xlsx in Drive)
// ---------------------------------------------------------------------------
async function readSourceRows(drive, sheets, fileId, sheetName) {
  const meta = await drive.files.get({
    fileId,
    fields: "id,name,mimeType",
    supportsAllDrives: true,
  });
  const mimeType = meta.data.mimeType;

  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    const result = await readNativeSheet(sheets, fileId, sheetName);
    return { ...result, sourceName: meta.data.name };
  }

  const resp = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  const result = parseExcelBuffer(Buffer.from(resp.data), sheetName);
  return { ...result, sourceName: meta.data.name };
}

async function readNativeSheet(sheets, fileId, sheetName) {
  const meta = await withRetry(
    () => sheets.spreadsheets.get({ spreadsheetId: fileId }),
    { label: "reading source sheet metadata" }
  );
  const tabs = meta.data.sheets.map((s) => s.properties);
  const target = sheetName ? tabs.find((p) => p.title === sheetName) : tabs[0];
  if (!target) return { rows: [], sheetTitle: sheetName || "" }; // tab absent — caller decides whether to error

  const title = target.title;
  const rowCount = target.gridProperties.rowCount;
  const colCount = target.gridProperties.columnCount;
  const lastCol = colIndexToLetter(colCount - 1);

  // Larger page = fewer Sheets read calls per source = less per-minute quota pressure.
  // Each read is retried (429/quota/5xx) so a transient spike never fails the whole scan.
  const BATCH = 50000;
  const rows = [];
  for (let start = 1; start <= rowCount; start += BATCH) {
    const end = Math.min(start + BATCH - 1, rowCount);
    const range = `'${title.replace(/'/g, "''")}'!A${start}:${lastCol}${end}`;
    const resp = await withRetry(() => sheets.spreadsheets.values.get({
      spreadsheetId: fileId,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
      majorDimension: "ROWS",
    }), { label: `reading source rows ${start}-${end}` });
    const values = resp.data.values || [];
    rows.push(...values);
    if (values.length === 0) break;
  }
  return { rows, sheetTitle: title };
}

function parseExcelBuffer(buffer, sheetName) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const targetName = sheetName || wb.SheetNames[0];
  const sheet = wb.Sheets[targetName];
  if (!sheet) throw new Error(`Sheet "${targetName}" not found in workbook`);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  return { rows, sheetTitle: targetName };
}

// ---------------------------------------------------------------------------
// Write filtered rows to a new Google Sheet
// ---------------------------------------------------------------------------
async function writeOutputSheet(sheets, drive, name, header, dataRows, destFolderId) {
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: name },
      sheets: [{ properties: { title: "Filtered" } }],
    },
  });
  const newId = created.data.spreadsheetId;

  if (destFolderId) {
    await drive.files.update({
      fileId: newId,
      addParents: destFolderId,
      removeParents: "root",
      supportsAllDrives: true,
    });
  }

  const allRows = [header, ...dataRows];
  const BATCH = 10000;
  for (let i = 0; i < allRows.length; i += BATCH) {
    const slice = allRows.slice(i, i + BATCH);
    await sheets.spreadsheets.values.update({
      spreadsheetId: newId,
      range: `Filtered!A${i + 1}`,
      valueInputOption: "RAW",
      requestBody: { values: slice },
    });
  }

  return { fileId: newId, url: `https://docs.google.com/spreadsheets/d/${newId}/edit` };
}

// ---------------------------------------------------------------------------
// Shared matcher — used by /filter and /build-billing
// ---------------------------------------------------------------------------
async function getMatchedRows({ sourceFileId, sheetName, headerRow, filters }) {
  const { drive, sheets } = await getClients();
  const { rows, sheetTitle, sourceName } = await readSourceRows(drive, sheets, sourceFileId, sheetName);

  // If the tab was absent (readNativeSheet/parseExcelBuffer returned []), treat as empty.
  if (rows.length === 0) {
    return { header: [], matches: [], sheetTitle, sourceName: sourceName || "", totalScanned: 0 };
  }

  // Auto-detect header row. V5/TopJuan CBS files have headers at row 1 (snake_case
  // column names); Magic CBS files have headers at row 13. If the specified headerRow
  // doesn't contain any recognised header keywords, scan from row 1 to find the real one.
  const HEADER_KEYWORDS = /^(status|amount|cbs_amount_inward|receiving branch name|sending branch name|branch_id|reference number|channel)$/i;
  let effectiveHeaderRow = headerRow;
  const specifiedRowVals = (rows[headerRow - 1] || []).map((h) => String(h ?? "").trim());
  if (!specifiedRowVals.some((h) => HEADER_KEYWORDS.test(h))) {
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const candidate = (rows[i] || []).map((h) => String(h ?? "").trim());
      if (candidate.some((h) => HEADER_KEYWORDS.test(h))) {
        effectiveHeaderRow = i + 1;
        console.log(`getMatchedRows: header not found at row ${headerRow}, auto-detected at row ${effectiveHeaderRow}`);
        break;
      }
    }
  }
  if (rows.length < effectiveHeaderRow) {
    throw new Error(`Source has fewer rows than headerRow (${effectiveHeaderRow})`);
  }
  const header = (rows[effectiveHeaderRow - 1] || []).map((h) => String(h ?? "").trim());
  const dataRows = rows.slice(effectiveHeaderRow);

  // Resolve filters. Each filter may specify:
  //   column      – primary column name/letter
  //   altColumns  – fallback column names tried in order when primary not found
  //   caseSensitive (default true) – whether equals comparison is case-sensitive
  const resolved = (filters || []).map((f) => {
    let idx = -1;
    try { idx = resolveColumn(f.column, header); } catch (_) { idx = -1; }
    if (idx === -1 && Array.isArray(f.altColumns)) {
      for (const alt of f.altColumns) {
        try { idx = resolveColumn(alt, header); break; } catch (_) { /* try next */ }
      }
    }
    return { ...f, index: idx };
  });
  const matches = dataRows.filter((row) =>
    resolved.every((f) => {
      if (f.index < 0) return true; // column not found in header → skip this filter
      const val = String(row[f.index] ?? "").trim();
      // includeValues: row passes only when val matches one of the listed values
      if (Array.isArray(f.includeValues) && f.includeValues.length > 0) {
        const valCmp = f.caseSensitive === false ? val.toLowerCase() : val;
        return f.includeValues.some((inc) => {
          const incCmp = f.caseSensitive === false ? String(inc).toLowerCase() : String(inc);
          return valCmp === incCmp;
        });
      }
      // excludeValues: row is excluded when val matches any entry in the list
      if (Array.isArray(f.excludeValues) && f.excludeValues.length > 0) {
        const valCmp = f.caseSensitive === false ? val.toLowerCase() : val;
        return !f.excludeValues.some((ex) => {
          const exCmp = f.caseSensitive === false ? String(ex).toLowerCase() : String(ex);
          return valCmp === exCmp;
        });
      }
      // notEquals: row passes when value does NOT equal the specified string
      if (f.notEquals !== undefined) {
        const ne = String(f.notEquals ?? "").trim();
        return f.caseSensitive === false
          ? val.toLowerCase() !== ne.toLowerCase()
          : val !== ne;
      }
      const eq = String(f.equals ?? "").trim();
      return f.caseSensitive === false
        ? val.toLowerCase() === eq.toLowerCase()
        : val === eq;
    })
  );
  return { header, matches, sheetTitle, sourceName, totalScanned: dataRows.length };
}

// ---------------------------------------------------------------------------
// Date / period helpers
// ---------------------------------------------------------------------------
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_LOOKUP = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

function parsePeriod(period) {
  const s = String(period || "").trim();
  // ISO: 2026-05-26 / 2026/05/26 / 2026.05.26
  let m = s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return { year: +m[1], month: +m[2], day: +m[3] };
  // "2026 May 27" — year-first with month name
  m = s.match(/\b(\d{4})\s+([A-Za-z]+)\s+(\d{1,2})\b/);
  if (m) {
    const month = MONTH_LOOKUP[m[2].toLowerCase()];
    if (month) return { year: +m[1], month, day: +m[3] };
  }
  // "May 26, 2026" / "May 26 2026" / "May 26-27, 2026" — take first day
  m = s.match(/([A-Za-z]+)\s+(\d{1,2})(?:\s*[-–]\s*\d{1,2})?(?:,)?\s*(\d{4})/);
  if (m) {
    const month = MONTH_LOOKUP[m[1].toLowerCase()];
    if (month) return { year: +m[3], month, day: +m[2] };
  }
  // 8-digit pure number: MMDDYYYY (e.g. "05272026") or YYYYMMDD (e.g. "20260527")
  m = s.match(/\b(\d{8})\b/);
  if (m) {
    const d8 = m[1];
    if (/^20\d{2}/.test(d8)) {
      // YYYYMMDD
      const year = +d8.slice(0, 4), month = +d8.slice(4, 6), day = +d8.slice(6, 8);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { year, month, day };
    }
    // MMDDYYYY
    const month = +d8.slice(0, 2), day = +d8.slice(2, 4), year = +d8.slice(4, 8);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2000 && year < 2100) {
      return { year, month, day };
    }
  }
  // "5/26/2026" — slashes, month-first
  m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return { year: +m[3], month: +m[1], day: +m[2] };
  // "5-26-2026" — dashes, month-first
  m = s.match(/\b(\d{1,2})-(\d{1,2})-(\d{4})\b/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return { year: +m[3], month: +m[1], day: +m[2] };
  // Fallback: month name without year — assume current year
  m = s.match(/([A-Za-z]+)\s+(\d{1,2})\b/);
  if (m) {
    const month = MONTH_LOOKUP[m[1].toLowerCase()];
    if (month) return { year: new Date().getUTCFullYear(), month, day: +m[2] };
  }
  throw new Error(
    `Cannot parse period "${period}" — expected formats: "May 26, 2026" / "2026-05-26" / ` +
    `"5/26/2026" / "05262026" (MMDDYYYY) / "20260526" (YYYYMMDD)`
  );
}

function pad2(n) { return String(n).padStart(2, "0"); }
function mmddyyyy(y, m, d) { return `${pad2(m)}${pad2(d)}${y}`; }
function monthFolderName(m) { return `${pad2(m)} ${MONTH_NAMES[m - 1]}`; }

// Human-readable invoice date label: "May 26, 2026"
function formatInvoiceDate(y, m, d) {
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

// ---------------------------------------------------------------------------
// Consolidated multi-date naming.
// range = { year, startMonth, startDay, endMonth, endDay }. Cross-month ranges
// spell out both months so the label is unambiguous.
// ---------------------------------------------------------------------------
function normalizePeriodRange(pr) {
  if (!pr || typeof pr !== "object") return null;
  const n = (v) => Number(v);
  const r = {
    year: n(pr.year),
    startMonth: n(pr.startMonth), startDay: n(pr.startDay),
    endMonth: n(pr.endMonth), endDay: n(pr.endDay),
    label: typeof pr.label === "string" ? pr.label.trim().slice(0, 64) : "",
  };
  const ok = [r.year, r.startMonth, r.startDay, r.endMonth, r.endDay].every(Number.isFinite)
    && r.startMonth >= 1 && r.startMonth <= 12 && r.endMonth >= 1 && r.endMonth <= 12
    && r.startDay >= 1 && r.startDay <= 31 && r.endDay >= 1 && r.endDay <= 31
    && r.year >= 2000 && r.year < 2100;
  return ok ? r : null;
}
// Invoice/report filename period part: 6-11-14-2026 / 6-28-7-2-2026
function rangeFileLabel(r) {
  return r.startMonth === r.endMonth
    ? `${r.startMonth}-${r.startDay}-${r.endDay}-${r.year}`
    : `${r.startMonth}-${r.startDay}-${r.endMonth}-${r.endDay}-${r.year}`;
}
// Default leaf folder name: 6-11-14 / 6-28-7-2 (used if the user supplies no label)
function rangeFolderLabel(r) {
  return r.startMonth === r.endMonth
    ? `${r.startMonth}-${r.startDay}-${r.endDay}`
    : `${r.startMonth}-${r.startDay}-${r.endMonth}-${r.endDay}`;
}
// Invoice line subscription date text: 6/11-14/2026 / 6/28-7/2/2026
function rangeSubscriptionText(r) {
  return r.startMonth === r.endMonth
    ? `${r.startMonth}/${r.startDay}-${r.endDay}/${r.year}`
    : `${r.startMonth}/${r.startDay}-${r.endMonth}/${r.endDay}/${r.year}`;
}
// Report filename period: "June 11-14-2026" / "June 28-July 2-2026"
function rangeReportPeriod(r) {
  return r.startMonth === r.endMonth
    ? `${MONTH_NAMES[r.startMonth - 1]} ${r.startDay}-${r.endDay}-${r.year}`
    : `${MONTH_NAMES[r.startMonth - 1]} ${r.startDay}-${MONTH_NAMES[r.endMonth - 1]} ${r.endDay}-${r.year}`;
}
// Human-readable period (SUMMARY + console): "June 11-14, 2026" / "June 28-July 2, 2026"
function rangeHumanPeriod(r) {
  return r.startMonth === r.endMonth
    ? `${MONTH_NAMES[r.startMonth - 1]} ${r.startDay}-${r.endDay}, ${r.year}`
    : `${MONTH_NAMES[r.startMonth - 1]} ${r.startDay} - ${MONTH_NAMES[r.endMonth - 1]} ${r.endDay}, ${r.year}`;
}
// Sanitize a user-supplied folder label to Drive-safe characters.
function sanitizeFolderLabel(s) {
  return String(s || "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 64);
}

// ---------------------------------------------------------------------------
// Drive helpers — folder resolution + naming
// ---------------------------------------------------------------------------
async function findOrCreateFolder(drive, parentId, namePattern, exactName) {
  const r = await withRetry(() => drive.files.list({
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  }), { label: `listing folders under ${parentId}` });
  const match = (r.data.files || []).find((f) => namePattern.test(f.name));
  if (match) return { id: match.id, name: match.name, created: false };
  const created = await withRetry(() => drive.files.create({
    requestBody: {
      name: exactName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id,name",
    supportsAllDrives: true,
  }), { label: `creating folder "${exactName}"` });
  return { id: created.data.id, name: created.data.name, created: true };
}

async function resolveOutputDateFolder(drive, parentId, year, month, day) {
  const monthName = MONTH_NAMES[month - 1];
  const monthRe = new RegExp(`^\\s*${pad2(month)}\\s+${monthName}\\b|^\\s*${monthName}\\b`, "i");
  const mFolder = await findOrCreateFolder(drive, parentId, monthRe, monthFolderName(month));
  const dateName = mmddyyyy(year, month, day);
  const dateRe = new RegExp(`^${dateName}$`);
  const dFolder = await findOrCreateFolder(drive, mFolder.id, dateRe, dateName);
  return { monthFolder: mFolder, dateFolder: dFolder, dateFolderName: dateName };
}

// Billing/<YYYY>/<Partner Name>/<MM Month>/<MMDDYYYY>/
// leafFolderName (optional) overrides the MMDDYYYY leaf — used for consolidated
// multi-date runs whose folder is a date range (e.g. "6-11-14").
async function resolveBillingPath(drive, billingParentId, year, partnerName, month, day, leafFolderName) {
  // Step 1: Year folder
  const yearRe = new RegExp(`^${year}$`);
  const yearFolder = await findOrCreateFolder(drive, billingParentId, yearRe, String(year));
  // Step 2: Partner folder — match by normalized name (case/space/punctuation tolerant)
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const partnerNorm = norm(partnerName);
  const partnerListing = await withRetry(() => drive.files.list({
    q: `'${yearFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  }), { label: "listing partner folders" });
  let partnerFolder = (partnerListing.data.files || []).find(f => norm(f.name) === partnerNorm);
  if (!partnerFolder) {
    const created = await withRetry(() => drive.files.create({
      requestBody: {
        name: partnerName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [yearFolder.id],
      },
      fields: "id,name",
      supportsAllDrives: true,
    }), { label: `creating partner folder "${partnerName}"` });
    partnerFolder = { id: created.data.id, name: created.data.name, created: true };
  } else {
    partnerFolder = { id: partnerFolder.id, name: partnerFolder.name, created: false };
  }
  // Step 3: Month folder (MM Month) inside partner
  const monthName = MONTH_NAMES[month - 1];
  const monthRe = new RegExp(`^\\s*${pad2(month)}\\s+${monthName}\\b|^\\s*${monthName}\\b`, "i");
  const mFolder = await findOrCreateFolder(drive, partnerFolder.id, monthRe, monthFolderName(month));
  // Step 4: Date folder (MMDDYYYY) — or a custom range leaf for consolidated runs.
  const dateName = leafFolderName || mmddyyyy(year, month, day);
  const dateRe = new RegExp(`^${escapeRegex(dateName)}$`);
  const dFolder = await findOrCreateFolder(drive, mFolder.id, dateRe, dateName);
  return {
    yearFolder, partnerFolder, monthFolder: mFolder, dateFolder: dFolder,
    dateFolderName: dateName,
  };
}

// Append -v2, -v3, etc. if a file with `basename` already exists in `folderId`.
async function nextFreeName(drive, folderId, basename, extension) {
  const r = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and name contains '${basename.replace(/'/g, "\\'")}'`,
    fields: "files(name)",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const existing = new Set((r.data.files || []).map((f) => f.name));
  const candidate = `${basename}${extension}`;
  if (!existing.has(candidate)) return candidate;
  for (let v = 2; v <= 99; v++) {
    const n = `${basename}-v${v}${extension}`;
    if (!existing.has(n)) return n;
  }
  return `${basename}-v${Date.now()}${extension}`;
}

function userError(stage, e) {
  const msg = e?.errors?.[0]?.message || e?.message || String(e);
  const reason = e?.errors?.[0]?.reason || "";
  const code = e?.code || e?.response?.status;
  if (reason === "storageQuotaExceeded" || /storage quota/i.test(msg))
    return `Google Drive storage quota exceeded while ${stage}. The org's pooled Drive storage is full — permanently empty the Shared Drive trash at drive.google.com (Shared Drive → Trash → Empty trash), then retry.`;
  if (code === 403) return `Permission denied while ${stage}. Share the file/folder with cbs-filter@onyx-drive-bridge.iam.gserviceaccount.com.`;
  if (code === 404) return `Not found while ${stage}: ${msg}`;
  if (/quota/i.test(msg)) return `Google API quota exceeded while ${stage}. Wait a minute and retry.`;
  return `Failed while ${stage}: ${msg}`;
}

// Retry wrapper for transient Google API failures.
//   - Quota / rate-limit (429, or 403 with a rate reason): Google's per-user write
//     quota resets every minute, so we back off LONG (8s, 16s, 24s … up to ~45s) to ride
//     out the window. This is what a multi-date batch trips when many writes stack up.
//   - Generic transient (500 "Internal error", 503 backend): short exponential backoff.
async function withRetry(fn, { tries = 7, label = "google api call" } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = err?.code || err?.response?.status;
      const msg = err?.message || String(err);
      const isQuota =
        code === 429 ||
        (code === 403 && /rate|quota|userratelimit/i.test(msg)) ||
        /quota|rate limit|ratelimit/i.test(msg);
      const isTransient =
        code === 500 || code === 503 ||
        // Node.js stream errors from gaxios — connection reset before response finished
        code === "ERR_STREAM_PREMATURE_CLOSE" || code === "ECONNRESET" || code === "ECONNREFUSED" ||
        /internal error|backend error|try again|temporar|premature close|stream/i.test(msg);
      if ((!isQuota && !isTransient) || attempt >= tries) throw err;
      const delay = isQuota
        ? Math.min(8000 * attempt, 45000)
        : Math.min(500 * 2 ** (attempt - 1), 8000);
      console.warn(`Retry ${attempt}/${tries - 1} for ${label} after ${delay}ms (${msg}).`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// Client-safe error message. Maps known Google API codes to friendly hints and
// shows our own validation errors (which carry no numeric `code`), but never
// leaks raw Google/internal error text for unexpected failures. Full detail is
// always written to the server log by the caller.
function clientError(err, fallback) {
  const code = err?.code || err?.response?.status;
  const reason = err?.errors?.[0]?.reason || "";
  const msg = String(err?.message || "");
  if (reason === "storageQuotaExceeded" || /storage quota/i.test(msg))
    return "Google Drive storage quota exceeded. Permanently empty the Shared Drive trash (drive.google.com → Shared Drive → Trash → Empty trash), then retry.";
  if (code === 403) return "Permission denied. Share the file/folder with cbs-filter@onyx-drive-bridge.iam.gserviceaccount.com (Viewer/Editor).";
  if (code === 404) return "Not found, or not shared with the service account.";
  if (/quota/i.test(msg)) return "Google API quota exceeded. Wait a minute and retry.";
  if (!code) return String(err?.message || fallback); // our own thrown Errors are safe to surface
  return fallback; // unexpected Google/internal error — keep details server-side only
}

// ---------------------------------------------------------------------------
// Template cell detection — label scans in SUMMARY column A
// ---------------------------------------------------------------------------
async function findSummaryCells(sheets, billingFileId) {
  // Pull SUMMARY A1:E40 to map labels → row indices (col E used by V5/TopJuan TOTAL row).
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: billingFileId,
    range: "SUMMARY!A1:E40",
    valueRenderOption: "FORMATTED_VALUE",
  });
  const rows = r.data.values || [];
  const find = (re, startRow = 0) => {
    for (let i = startRow; i < rows.length; i++) {
      const a = String((rows[i] || [])[0] || "").trim();
      if (re.test(a)) return i + 1; // 1-based
    }
    return null;
  };
  const findAll = (re) => {
    const found = [];
    for (let i = 0; i < rows.length; i++) {
      const a = String((rows[i] || [])[0] || "").trim();
      if (re.test(a)) found.push(i + 1);
    }
    return found;
  };
  const periodTopRow = find(/billing period/i);
  const reconRow = find(/^reconciliation\b/i);
  const periodReconRow = reconRow ? find(/billing period/i, reconRow) : null;
  const lessRow = find(/less previously charged/i);
  const amountDueRow = find(/^amount due\b/i);
  // Top section: first short single-word label per category (top summary area).
  // Multiple "QRPH"/"DISBURSE"/"VCA" labels exist (top section + detail section header);
  // the top-section one always appears first in the sheet, so find() returning the first
  // occurrence is correct here.
  const qrphTopRow    = find(/^QRPH$/i);
  const disburseTopRow = find(/^DISBURSE$/i);
  const vcaTopRow     = find(/^VCA$/i);
  const totalTopRow   = find(/^TOTAL$/i);
  // Detail sections: for each "TOTAL AMOUNT TO BILL" row, look back up to 10 rows to find
  // which section it belongs to (VCA/QRPH/DISBURSE section header). This anchors each fee
  // row to its section regardless of template row order or the number of TOTAL AMOUNT TO
  // BILL rows in the sheet — robust against both 2-section (Magic) and 3-section (V5/TopJuan) templates.
  const feeDetailRows = findAll(/^TOTAL AMOUNT TO BILL/i);
  const findFeeRowForSection = (sectionRe) => {
    // Scan back from each "TOTAL AMOUNT TO BILL" row to find its section header.
    // Two-tier: within 2 rows accept any label (section header always immediately precedes
    // the fee row in all known templates); within 5 rows require col C = "Applicable Fee"
    // to distinguish detail headers from the short top-section summary labels (e.g. "DISBURSE"
    // in the top summary block is ≥3 rows above its own TOTAL AMOUNT TO BILL and has no col C).
    for (const feeRow of feeDetailRows) {
      const feeIdx = feeRow - 1; // 0-based
      for (let j = feeIdx - 1; j >= Math.max(0, feeIdx - 5); j--) {
        if (!sectionRe.test(String((rows[j] || [])[0] || "").trim())) continue;
        const dist = feeIdx - j;
        const colC = String((rows[j] || [])[2] || "").trim();
        if (dist <= 2 || /applicable fee/i.test(colC)) return feeRow;
      }
    }
    return null;
  };
  const vcaFeeRow      = findFeeRowForSection(/^VCA$/i);
  const qrphFeeRow     = findFeeRowForSection(/^QRPH$/i);
  const disburseFeeRow = findFeeRowForSection(/^DISBURSE$/i);
  const hasVca = vcaFeeRow !== null;
  const interbankCountRow = find(/^INTERBANK COUNT$/i);
  const intrabankCountRow = find(/^INTRABANK COUNT$/i);
  return {
    periodTopRow,
    periodReconRow,
    lessRow,
    subPeriodRows: lessRow ? [lessRow + 1, lessRow + 2, lessRow + 3] : [],
    amountDueRow,
    vcaTopRow,
    qrphTopRow,
    disburseTopRow,
    totalTopRow,
    vcaFeeRow,
    qrphFeeRow,
    disburseFeeRow,
    hasVca,
    interbankCountRow,
    intrabankCountRow,
  };
}

function colLetterFromIndex(idx) { return colIndexToLetter(idx); }

// ---------------------------------------------------------------------------
// initBlankSummary — writes SUMMARY structure labels into a freshly-created
// blank Google Sheet so findSummaryCells() can locate every cell by label.
// ---------------------------------------------------------------------------
async function initBlankSummary(sheets, fileId) {
  const rows = [
    // Top summary (rows 1-4) — fee totals written here after each direction
    ["VCA",      0],
    ["QRPH",     0],
    ["DISBURSE", 0],
    ["TOTAL",    0],
    [""],
    ["BILLING PERIOD"],
    [""],  // period text written here during the run
    [""],
    // VCA detail section (rows 9-12)
    ["VCA"],
    ["TOTAL AMOUNT TO BILL", 0, "Applicable Fee"],
    ["TOTAL COUNTS",         0],
    ["TOTAL VOLUME",         0],
    [""],
    // QRPH detail section (rows 14-17)
    ["QRPH"],
    ["TOTAL AMOUNT TO BILL", 0, "Applicable Fee"],
    ["TOTAL COUNTS",         0],
    ["TOTAL VOLUME",         0],
    [""],
    // DISBURSE detail section (rows 19-22)
    ["DISBURSE"],
    ["TOTAL AMOUNT TO BILL", 0, "Applicable Fee"],
    ["TOTAL COUNTS",         0],
    ["TOTAL VOLUME",         0],
    [""],
    // Interbank / intrabank counts (rows 24-25) — written during outgoing run
    ["INTERBANK COUNT", 0],
    ["INTRABANK COUNT", 0],
  ];
  await withRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId: fileId,
    range: "SUMMARY!A1:C25",
    valueInputOption: "RAW",
    requestBody: { values: rows },
  }), { label: "initializing blank SUMMARY structure" });
}

// ---------------------------------------------------------------------------
// Cell map for INVOICE_TEMPLATE_ID (sheet tab: "INVOICE"):
//   F4=Invoice#  F5=InvoiceDate  F6=Amount  F7=CustomerID
//   B10–B15 = BILLED TO lines (contact/company/addr1/addr2/country/email)
//   Slot 0: sub-header B18, data row 19 (B19:C19 pre-merged) → D19/E19/F19
//   Slot 1: sub-header B20, data row 21 (B21:C21 pre-merged) → D21/E21/F21
//   Slot 2: sub-header B22, data row 23 (B23:C23 pre-merged) → D23/E23/F23
//   E25=Total label  F25=grandTotal  E26=AmountDue label  F26=amountDue
// ---------------------------------------------------------------------------

// generateInvoiceFromTemplate — copies the XLSX template as a native Google
// Sheet, fills dynamic cells, exports as PDF, deletes the temp sheet.
// Returns a Buffer of PDF bytes (same interface as the old PDFKit function).
async function generateInvoiceFromTemplate({
  billingFolderId,
  invoiceNumber, invoiceDateText, customerId,
  billedTo, invoicePrefix, partnerHasVca,
  vcaTotalFee, vcaRate,
  qrphTotalFee,
  disburseTotalFee, disburseCount,
  interbankCount, intrabankCount, interbankRate, intrabankRate,
  grandTotal, amountDue,
  subscriptionDateText,
}) {
  const { drive, sheets } = await getClients();

  // 1. Copy XLSX template → native Google Sheets (MIME conversion preserves logo/branding).
  // Place in billingFolderId (Shared Drive) so the SA (Content Manager) can create it.
  // SA must have Manager role on the Shared Drive to permanently delete in the finally block.
  const copy = await withRetry(() => drive.files.copy({
    fileId: INVOICE_TEMPLATE_ID,
    requestBody: {
      name: `_inv_tmp_${invoiceNumber}`,
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [billingFolderId],
    },
    supportsAllDrives: true,
    fields: "id",
  }), { label: "copying invoice template" });
  const tempId = copy.data.id;

  try {
    // 2. Build cell value updates
    const vcaCount = vcaRate > 0 ? Math.round(vcaTotalFee / vcaRate) : 0;
    const updates = [
      { range: "INVOICE!F4", values: [[invoiceNumber]] },
      { range: "INVOICE!F5", values: [[invoiceDateText]] },
      { range: "INVOICE!F6", values: [[grandTotal]] },
      { range: "INVOICE!F7", values: [[customerId || ""]] },
      { range: "INVOICE!B10", values: [[billedTo.contact  || ""]] },
      { range: "INVOICE!B11", values: [[billedTo.company  || ""]] },
      { range: "INVOICE!B12", values: [[billedTo.address1 || ""]] },
      { range: "INVOICE!B13", values: [[billedTo.address2 || ""]] },
      { range: "INVOICE!B14", values: [[billedTo.country  || ""]] },
      { range: "INVOICE!B15", values: [[billedTo.email    || ""]] },
    ];

    // Line items — 3 pre-defined slot pairs (sub-header + data row)
    const SLOTS = [{ sub: 18, data: 19 }, { sub: 20, data: 21 }, { sub: 22, data: 23 }];
    let slot = 0;
    const addItem = (label, subLabel, units, unitPrice, amount) => {
      if (slot >= SLOTS.length) return;
      const { sub, data } = SLOTS[slot++];
      updates.push(
        { range: `INVOICE!B${sub}`,  values: [[subLabel]] },
        { range: `INVOICE!B${data}`, values: [[label]] },
        { range: `INVOICE!D${data}`, values: [[units]] },
        { range: `INVOICE!E${data}`, values: [[unitPrice]] },
        { range: `INVOICE!F${data}`, values: [[amount]] },
      );
    };

    if (partnerHasVca && vcaTotalFee > 0) {
      addItem(
        `${invoicePrefix}-Virtual-Collect-Account`,
        `Subscription ID ${invoicePrefix}-Virtual-Collect-Account- ${subscriptionDateText}`,
        vcaCount, vcaRate, vcaTotalFee,
      );
    }
    addItem(
      `${invoicePrefix}-QRPH`,
      `Subscription ID ${invoicePrefix}-QRPH- ${subscriptionDateText}`,
      1, qrphTotalFee, qrphTotalFee,
    );
    // Topjuantech: merge interbank + intrabank into one line — same rate (₱5), and the
    // invoice template only has 3 slots (VCA + QRPH already consume 2), so a separate
    // intrabank line would overflow and be silently dropped.
    console.log(`[DEBUG] invoice merge check: invoicePrefix=${invoicePrefix} interbankCount=${interbankCount} intrabankCount=${intrabankCount}`);
    if (invoicePrefix === 'Topjuantech' && (interbankCount + intrabankCount) > 0) {
      addItem(
        `${invoicePrefix}-Disburse`,
        `Subscription ID ${invoicePrefix}-Disburse ${subscriptionDateText}`,
        interbankCount + intrabankCount, interbankRate, disburseTotalFee,
      );
    } else {
      if (interbankCount > 0) {
        addItem(
          `${invoicePrefix}-Disburse-To-Account-Interbank`,
          `Subscription ID ${invoicePrefix}-Disburse ${subscriptionDateText}`,
          interbankCount, interbankRate, round2(interbankCount * interbankRate),
        );
      }
      if (intrabankCount > 0 && interbankCount !== intrabankCount) {
        addItem(
          `${invoicePrefix}-Disburse-To-Account-Intrabank`,
          `Subscription ID ${invoicePrefix}-Disburse ${subscriptionDateText}`,
          intrabankCount, intrabankRate, round2(intrabankCount * intrabankRate),
        );
      }
      if (interbankCount === 0 && intrabankCount === 0 && disburseTotalFee > 0) {
        addItem(
          `${invoicePrefix}-Disburse-To-Account`,
          `Subscription ID ${invoicePrefix}-Disburse ${subscriptionDateText}`,
          disburseCount, interbankRate, disburseTotalFee,
        );
      }
    }

    // Total and Amount Due
    updates.push(
      { range: "INVOICE!E25", values: [["Total"]] },
      { range: "INVOICE!F25", values: [[grandTotal]] },
      { range: "INVOICE!E26", values: [["Amount Due (PHP)"]] },
      { range: "INVOICE!F26", values: [[amountDue]] },
    );

    await withRetry(() => sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: tempId,
      requestBody: { valueInputOption: "USER_ENTERED", data: updates },
    }), { label: "filling invoice template cells" });

    // 3. Export native Sheets → PDF (logo and branding rendered server-side by Google)
    const pdfRes = await withRetry(() => drive.files.export(
      { fileId: tempId, mimeType: "application/pdf" },
      { responseType: "arraybuffer" },
    ), { label: "exporting invoice as PDF" });

    return Buffer.from(pdfRes.data);

  } finally {
    // 4. Permanently delete the temp sheet from the Shared Drive.
    // Requires SA to have Manager role on the Shared Drive (upgrade from Content Manager).
    // If delete fails (e.g., role not yet upgraded), fall back to trash to limit storage impact.
    try {
      await drive.files.delete({ fileId: tempId, supportsAllDrives: true });
    } catch (e) {
      try {
        await drive.files.update({
          fileId: tempId,
          requestBody: { trashed: true },
          supportsAllDrives: true,
        });
        console.warn("Temp invoice sheet trashed (permanent delete failed — SA may need Manager role):", e.message);
      } catch (e2) {
        console.warn("Could not delete or trash temp invoice sheet:", e2.message);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// generateInvoicePdfBuffer — LEGACY: builds the invoice PDF using pdfkit.
// Kept as fallback. generateInvoiceFromTemplate() is the primary path.
// ---------------------------------------------------------------------------
function generateInvoicePdfBuffer({
  invoiceNumber, invoiceDateText, customerId,
  billedTo, partnerName, invoicePrefix, partnerHasVca,
  vcaTotalFee, vcaRate,
  qrphTotalFee,
  disburseTotalFee, disburseCount,
  interbankCount, intrabankCount, interbankRate, intrabankRate,
  grandTotal, amountDue,
  subscriptionDateText,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width;   // 595
    const L = 50;                // left margin
    const R = W - 50;            // right edge

    // ---- Header: logo + INVOICE block ----
    try { doc.image(NETBANK_LOGO_PATH, L, 45, { height: 32 }); } catch (_) {}
    doc.fillColor("#1a52a8").fontSize(16).font("Helvetica-Bold")
       .text("Netbank", L + 38, 52);

    const metaX = 360;
    doc.fillColor("#000").fontSize(11).font("Helvetica-Bold")
       .text("INVOICE", metaX, 45, { width: R - metaX, align: "center" });

    // Invoice metadata rows
    const metaRows = [
      ["Invoice #",    invoiceNumber],
      ["Invoice Date", invoiceDateText],
      ["Amount",       `PHP ${numFmt(grandTotal)}`],
      ["Customer ID",  customerId || ""],
    ];
    let my = 62;
    const labelW = 80;
    const valX = metaX + labelW + 4;
    metaRows.forEach(([lbl, val]) => {
      doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#000")
         .text(lbl, metaX, my, { width: labelW });
      doc.fontSize(8.5).font("Helvetica").fillColor("#000")
         .text(String(val), valX, my, { width: R - valX });
      my += 13;
    });

    // ---- Netbank address ----
    let ay = 112;
    ["Netbank (A Rural Bank), Inc.",
     "Bagong Lipunan St., Brgy. 1 Poblacion",
     "Romblon, Romblon 5500",
     "Philippines"].forEach(line => {
      doc.fontSize(8.5).font("Helvetica").fillColor("#000").text(line, L, ay);
      ay += 12;
    });

    // ---- BILLED TO ----
    let by = ay + 6;
    doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#000").text("BILLED TO", L, by);
    by += 13;
    const btLines = [
      billedTo.contact, billedTo.company,
      billedTo.address1, billedTo.address2,
      billedTo.country, billedTo.email,
    ].filter(Boolean);
    btLines.forEach(line => {
      doc.fontSize(8.5).font("Helvetica").fillColor("#000").text(line, L, by);
      by += 11;
    });

    // ---- Items table ----
    const tableTop = Math.max(by + 12, 252);
    const cols = { desc: L, units: L + 270, price: L + 330, amt: L + 410 };
    const tableW = R - L;
    const colW   = { desc: 270, units: 60, price: 80, amt: R - cols.amt };

    // Table header row
    doc.rect(L, tableTop, tableW, 18).fill("#dde5f0").stroke("#aaaaaa");
    doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#000")
       .text("DESCRIPTION",  cols.desc  + 4, tableTop + 5, { width: colW.desc  - 8 })
       .text("UNITS",        cols.units + 4, tableTop + 5, { width: colW.units - 8, align: "center" })
       .text("UNIT PRICE",   cols.price + 4, tableTop + 5, { width: colW.price - 8, align: "right" })
       .text("AMOUNT (PHP)", cols.amt   + 4, tableTop + 5, { width: colW.amt   - 8, align: "right" });

    let ty = tableTop + 18;

    // Helper: subscription sub-header row (light gray)
    function subHeader(text) {
      doc.rect(L, ty, tableW, 15).fill("#f4f4f4").stroke("#dddddd");
      doc.fontSize(7.5).font("Helvetica-Oblique").fillColor("#444")
         .text(text, cols.desc + 4, ty + 4, { width: tableW - 8 });
      ty += 15;
    }

    // Helper: data item row
    function itemRow(desc, units, unitPrice, amount) {
      const rowH = 17;
      doc.rect(L, ty, tableW, rowH).fill("#ffffff").stroke("#dddddd");
      doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#000")
         .text(desc, cols.desc + 4, ty + 4, { width: colW.desc - 8 });
      doc.font("Helvetica")
         .text(String(units), cols.units + 4, ty + 4, { width: colW.units - 8, align: "center" })
         .text(numFmt(unitPrice), cols.price + 4, ty + 4, { width: colW.price - 8, align: "right" })
         .text(numFmt(amount),    cols.amt   + 4, ty + 4, { width: colW.amt   - 8, align: "right" });
      ty += rowH;
    }

    // VCA rows (V5/Topjuantech only)
    if (partnerHasVca && vcaRate > 0) {
      const vcaCount = vcaRate > 0 ? Math.round(vcaTotalFee / vcaRate) : 0;
      subHeader(`Subscription ID ${invoicePrefix}-Virtual-Collect-Account- ${subscriptionDateText}`);
      itemRow(`${invoicePrefix}-Virtual-Collect-Account`, vcaCount, vcaRate, vcaTotalFee);
    }

    // QRPH rows
    subHeader(`Subscription ID ${invoicePrefix}-QRPH- ${subscriptionDateText}`);
    itemRow(`${invoicePrefix}-QRPH`, 1, qrphTotalFee, qrphTotalFee);

    // DISBURSE rows — interbank (and intrabank separately if different rate)
    if (interbankCount > 0) {
      subHeader(`Subscription ID ${invoicePrefix}-Disburse ${subscriptionDateText}`);
      itemRow(
        `${invoicePrefix}-Disburse-To-Account-Interbank`,
        interbankCount, interbankRate,
        round2(interbankCount * interbankRate)
      );
    }
    if (intrabankCount > 0) {
      if (interbankCount === 0) {
        subHeader(`Subscription ID ${invoicePrefix}-Disburse ${subscriptionDateText}`);
      }
      itemRow(
        `${invoicePrefix}-Disburse-To-Account-Intrabank`,
        intrabankCount, intrabankRate,
        round2(intrabankCount * intrabankRate)
      );
    }
    if (interbankCount === 0 && intrabankCount === 0 && disburseTotalFee > 0) {
      // fallback: combined line using disburseCount
      subHeader(`Subscription ID ${invoicePrefix}-Disburse ${subscriptionDateText}`);
      itemRow(`${invoicePrefix}-Disburse-To-Account`, disburseCount, interbankRate, disburseTotalFee);
    }

    // ---- Totals ----
    ty += 4;
    doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#000")
       .text("Total", cols.price + 4, ty, { width: colW.price - 8, align: "right" });
    doc.font("Helvetica")
       .text(numFmt(grandTotal), cols.amt + 4, ty, { width: colW.amt - 8, align: "right" });
    ty += 14;
    doc.font("Helvetica-Bold")
       .text("Amount Due (PHP)", cols.units + 4, ty, { width: colW.units + colW.price - 8, align: "right" });
    doc.font("Helvetica-Bold")
       .text(numFmt(amountDue), cols.amt + 4, ty, { width: colW.amt - 8, align: "right" });

    doc.end();
  });
}

function numFmt(n) {
  return Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function findHeaderRowInTab(sheets, fileId, tab, anchors) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: fileId,
    range: `'${tab}'!A1:Z30`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const rows = r.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    const row = (rows[i] || []).map((v) => String(v || "").trim().toLowerCase());
    if (anchors.some((a) => row.includes(a.toLowerCase()))) {
      return { headerRowIdx: i + 1, header: rows[i] || [] };
    }
  }
  return { headerRowIdx: null, header: [] };
}

// Write the per-partner Branch ID + Branch name into a report tab's header block
// (rows 1-12: label in col A, value in col B). Rows located by label scan so we never
// hardcode B2/B4. A missing label is skipped (not fatal) and reported back.
async function writeReportHeaderBranch(sheets, fileId, tab, branchId, branchName) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: fileId,
    range: `'${tab}'!A1:A13`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const rows = r.data.values || [];
  let branchRow = null, branchNameRow = null;
  for (let i = 0; i < rows.length; i++) {
    const a = String((rows[i] || [])[0] || "").trim();
    if (branchRow === null && /^branch$/i.test(a)) branchRow = i + 1;          // exact "Branch"
    if (branchNameRow === null && /^branch\s*name$/i.test(a)) branchNameRow = i + 1;
  }
  const updates = [];
  if (branchRow) updates.push({ range: `'${tab}'!B${branchRow}`, values: [[branchId]] });
  if (branchNameRow) updates.push({ range: `'${tab}'!B${branchNameRow}`, values: [[branchName]] });
  if (updates.length) {
    await withRetry(() => sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: fileId,
      requestBody: { valueInputOption: "USER_ENTERED", data: updates },
    }), { label: "batch-updating sheet values" });
  }
  return { branchRow, branchNameRow };
}

// Locate the invoice "BILLED TO" block. Returns the 6 value-cell ranges (top→bottom,
// same column as the label) so the caller can write contact/company/addr1/addr2/
// country/email. Returns null if the label is not found (skip, with a warning).
async function detectBilledToRanges(sheets, fileId) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: fileId,
    range: "INVOICE!A1:H30",
    valueRenderOption: "FORMATTED_VALUE",
  });
  const rows = r.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    for (let c = 0; c < row.length; c++) {
      if (/^billed\s*to$/i.test(String(row[c] || "").trim())) {
        const col = colIndexToLetter(c);
        const start = i + 2; // first value row is one below the label (1-based)
        const ranges = [];
        for (let k = 0; k < 6; k++) ranges.push(`INVOICE!${col}${start + k}`);
        return ranges;
      }
    }
  }
  return null;
}

async function scanFormulaErrors(sheets, fileId) {
  const r = await withRetry(() => sheets.spreadsheets.values.batchGet({
    spreadsheetId: fileId,
    ranges: ["SUMMARY!A1:Z40", "QRPH!A14:W30", "DISBURSE!A14:S30"],
    valueRenderOption: "FORMATTED_VALUE",
  }), { label: "reading template cells" });
  const errs = [];
  for (const range of r.data.valueRanges || []) {
    for (const row of range.values || []) {
      for (const cell of row || []) {
        if (/^#(REF|VALUE|NAME|DIV\/0|N\/A|NUM|NULL)!?$/i.test(String(cell || ""))) {
          errs.push(String(cell));
        }
      }
    }
  }
  return errs;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    endpoints: {
      "/filter": "POST",
      "/config": "GET",
      "/list-files": "POST",
      "/next-invoice-number": "GET",
      "/build-billing": "POST",
    },
    apiKeyRequired: !!API_KEY,
  });
});

// ---------------------------------------------------------------------------
// Web app endpoints (no auth — browser wizard. IAP will gate in Phase D.)
// ---------------------------------------------------------------------------
app.get("/config", async (req, res) => {
  // IAP sets X-Goog-Authenticated-User-Email like "accounts.google.com:user@netbank.ph"
  const rawEmail = String(req.headers["x-goog-authenticated-user-email"] || "");
  const email = rawEmail.replace(/^accounts\.google\.com:/, "") || null;
  await refreshPartners().catch(() => {});
  const partnerList = _partners || PARTNERS;
  res.json({
    mainFolderId: CBS_MAIN_FOLDER_ID,
    billingParentFolderId: BILLING_PARENT_FOLDER_ID || null,
    partners: partnerList.map(p => ({
      id: p.id,
      name: p.name,
      productId: p.productId,
      productCode: productCode(p),
      invoicePrefix: p.invoicePrefix,
      customerId: p.customerId,
      billedTo: normalizeBilledTo(p.billedTo),
      hasVca: !!p.hasVca,
    })),
    user: { email },
  });
});

// ---------------------------------------------------------------------------
// Partner Admin UI + CRUD API (key-gated)
// ---------------------------------------------------------------------------
app.get("/admin/login", (req, res) => {
  if (isAdminAuthed(req)) return res.redirect("/admin");
  const err = req.query.error;
  if (!err) return res.sendFile(path.join(__dirname, "public", "admin-login.html"));
  // Inline error — serve login page with error note
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Admin Login</title><link rel="icon" href="/brand/favicon-32.png"/><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Segoe UI',Arial,sans-serif;background:#f4f6fb;min-height:100vh;display:flex;flex-direction:column;}header{background:#003f88;color:#fff;padding:14px 28px;display:flex;align-items:center;gap:14px;box-shadow:0 2px 6px rgba(0,0,0,.18);}header img{height:34px;}header h1{font-size:1.1rem;font-weight:700;}.wrap{flex:1;display:flex;align-items:center;justify-content:center;padding:32px 16px;}.card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,63,136,.12);padding:36px 40px;width:100%;max-width:380px;}.card h2{font-size:1.05rem;font-weight:700;color:#003f88;margin-bottom:6px;}.card p{font-size:.83rem;color:#666;margin-bottom:24px;}label{display:block;font-size:.80rem;font-weight:600;color:#444;margin-bottom:5px;}input[type=password]{width:100%;padding:9px 12px;border:1px solid #dde3ed;border-radius:7px;font-size:.90rem;background:#fafbfc;margin-bottom:18px;}input[type=password]:focus{outline:2px solid rgba(0,63,136,.30);border-color:#003f88;}button{width:100%;padding:10px;background:#003f88;color:#fff;border:none;border-radius:7px;font-size:.92rem;font-weight:700;cursor:pointer;}button:hover{background:#00306b;}.err{background:#fde8e8;color:#c0392b;border:1px solid #f5c6c6;border-radius:6px;padding:9px 12px;font-size:.83rem;margin-bottom:14px;}</style></head><body><header><img src="/brand/favicon-192.png" alt="Netbank"/><h1>Billing Console</h1></header><div class="wrap"><div class="card"><h2>Admin Access</h2><p>Enter the admin key to manage partners and fee rules.</p><div class="err">Incorrect admin key. Please try again.</div><form method="POST" action="/admin/login"><label for="key">Admin Key</label><input type="password" id="key" name="key" autofocus autocomplete="current-password" placeholder="Enter admin key"/><button type="submit">Sign In</button></form></div></div></body></html>`);
});

app.post("/admin/login", express.urlencoded({ extended: false }), (req, res) => {
  const key = String(req.body.key || "").trim();
  if (!ADMIN_KEY || key === ADMIN_KEY) {
    const token = ADMIN_KEY
      ? crypto.createHash("sha256").update(ADMIN_KEY).digest("hex")
      : "nokey";
    res.setHeader("Set-Cookie", `${ADMIN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Secure; Path=/admin; Max-Age=28800`);
    const back = req.query.back ? decodeURIComponent(req.query.back) : "/admin";
    return res.redirect(back.startsWith("/admin") ? back : "/admin");
  }
  res.redirect("/admin/login?error=1");
});

app.get("/admin/logout", (req, res) => {
  res.setHeader("Set-Cookie", `${ADMIN_COOKIE}=; HttpOnly; SameSite=Strict; Secure; Path=/admin; Max-Age=0`);
  res.redirect("/admin/login");
});

app.get("/admin", requireAdmin, (_req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

app.get("/admin/partners", requireAdmin, async (_req, res) => {
  try {
    const snap = await db.collection(PARTNERS_COLLECTION).orderBy("order").get();
    res.json({ ok: true, partners: snap.docs.map(d => d.data()) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/admin/partners", requireAdmin, async (req, res) => {
  try {
    const data = validatePartnerInput(req.body);
    const existing = await db.collection(PARTNERS_COLLECTION).doc(data.id).get();
    if (existing.exists) return res.status(409).json({ ok: false, error: `Partner "${data.id}" already exists. Use PUT to update.` });
    data.order = Date.now();
    await db.collection(PARTNERS_COLLECTION).doc(data.id).set(data);
    await refreshPartners();
    res.json({ ok: true, id: data.id });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.put("/admin/partners/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[a-z0-9-]+$/.test(id)) return res.status(400).json({ ok: false, error: "Invalid partner ID" });
    const existing = await db.collection(PARTNERS_COLLECTION).doc(id).get();
    const currentOrder = existing.exists ? (existing.data().order || 0) : Date.now();
    const data = validatePartnerInput({ ...req.body, id, order: currentOrder });
    await db.collection(PARTNERS_COLLECTION).doc(id).set(data);
    await refreshPartners();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.delete("/admin/partners/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[a-z0-9-]+$/.test(id)) return res.status(400).json({ ok: false, error: "Invalid partner ID" });
    await db.collection(PARTNERS_COLLECTION).doc(id).delete();
    await refreshPartners();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/list-files", async (req, res) => {
  try {
    const { folderId } = req.body || {};
    if (!folderId) return res.status(400).json({ error: "Missing folderId" });
    // Guard against Drive query injection: a Drive file/folder ID is a long
    // base64url-ish token. Reject anything else BEFORE it reaches the `q` string.
    if (typeof folderId !== "string" || !/^[A-Za-z0-9_-]{20,}$/.test(folderId)) {
      return res.status(400).json({ error: "Invalid folderId" });
    }

    const { drive } = await getClients();
    const items = [];
    let pageToken;
    do {
      const resp = await withRetry(() => drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: "nextPageToken, files(id,name,mimeType)",
        pageSize: 200,
        orderBy: "name",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageToken,
      }), { label: "list-files" });
      for (const f of resp.data.files || []) {
        items.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          isFolder: f.mimeType === "application/vnd.google-apps.folder",
        });
      }
      pageToken = resp.data.nextPageToken;
    } while (pageToken);

    res.json({ items });
  } catch (err) {
    console.error("list-files error:", err);
    const code = err?.code || err?.response?.status;
    const numCode = Number(code);
    if (numCode === 404) {
      return res.status(404).json({
        error: "Folder not found",
        message: "Folder ID not found or not shared with cbs-filter@onyx-drive-bridge.iam.gserviceaccount.com",
      });
    }
    if (numCode === 403) {
      return res.status(403).json({
        error: "Permission denied",
        message: "Folder not shared with cbs-filter@onyx-drive-bridge.iam.gserviceaccount.com",
      });
    }
    res.status(500).json({ error: "List failed", message: clientError(err, "Could not list the folder. Please try again.") });
  }
});

// Suggest the next sequential invoice number for a partner.
// Query: ?partnerId=<slug> OR ?prefix=<rawPrefix>. Defaults to first partner.
// Scans Drive for `<prefix>-NNNN` filenames and returns highest+1.
app.get("/next-invoice-number", async (req, res) => {
  try {
    let prefix = String(req.query.prefix || "").trim();
    if (!prefix && req.query.partnerId) {
      const p = getPartner(String(req.query.partnerId));
      if (p) prefix = p.invoicePrefix;
    }
    if (!prefix) prefix = (_partners || PARTNERS)[0].invoicePrefix;
    const safePrefix = prefix.replace(/'/g, "\\'");
    const escapedForRegex = escapeRegex(prefix);
    const pattern = new RegExp(`${escapedForRegex}-(\\d{3,5})`, "i");
    const { drive } = await getClients();
    let highest = 0;
    let lastSeenName = null;
    let pageToken;
    do {
      const r = await drive.files.list({
        q: `name contains '${safePrefix}-' and trashed = false`,
        fields: "nextPageToken, files(id,name,modifiedTime)",
        pageSize: 200,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageToken,
      });
      for (const f of r.data.files || []) {
        const m = f.name.match(pattern);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > highest) { highest = n; lastSeenName = f.name; }
        }
      }
      pageToken = r.data.nextPageToken;
    } while (pageToken);

    const next = `${prefix}-${String(highest + 1).padStart(4, "0")}`;
    res.json({
      next,
      highest,
      lastSeen: lastSeenName,
      prefix,
      source: "drive_filename_scan",
    });
  } catch (err) {
    console.error("next-invoice-number error:", err);
    res.status(500).json({ error: "Lookup failed", message: clientError(err, "Could not look up invoice numbers. Please try again.") });
  }
});

// ---------------------------------------------------------------------------
// POST /build-billing
// Generates the Billing Report Sheet + Invoice PDF for one direction/date.
// ---------------------------------------------------------------------------
app.post("/build-billing", async (req, res) => {
  let stage = "validating input";
  try {
    // Always reload partners from Firestore before billing — ensures admin changes
    // take effect immediately regardless of which Cloud Run instance handles the request.
    await refreshPartners().catch(() => {});
    const {
      sourceFileId,
      sourceFileIds,        // new: array of source files to merge into ONE consolidated report
      periodRange: bodyPeriodRange,   // new: { year, startMonth, startDay, endMonth, endDay, label } for multi-date consolidation
      headerRow = 13,
      partnerId,            // new: prefer this
      code: bodyCode,       // back-compat (raw product code)
      direction,
      period,
      year: bodyYear,       // new: optional explicit year override
      invoiceNumber,
      previouslyCharged = [],
      billedTo: bodyBilledTo,   // new: wizard-edited BILLED TO block (overrides partner default)
      customerId: bodyCustomerId,   // new: wizard-edited Customer ID (overrides partner default)
    } = req.body || {};

    // ---- Resolve partner from partnerId (preferred) or raw code (back-compat) ----
    const partner = partnerId
      ? getPartner(String(partnerId))
      : (bodyCode ? getPartner(String(bodyCode)) || (_partners || PARTNERS)[0] : (_partners || PARTNERS)[0]);
    if (!partner) {
      return res.status(400).json({
        error: "validation",
        message: `Unknown partner. Send a valid partnerId (one of: ${(_partners || PARTNERS).map(p => p.id).join(", ")}).`,
      });
    }
    const code = productCode(partner);
    const invoicePrefix = partner.invoicePrefix;
    // V5/TopJuan CBS files carry all incoming transactions in a single tab.
    // The transfer_mode column distinguishes them: QR_P2M = QRPH fee, P2P = VCA fee.
    // For these partners the billing wizard sends the SAME file IDs for both directions;
    // we add a transfer_mode filter to split them at read time.
    const partnerHasVca = !!partner.hasVca;
    // BILLED TO: prefer the wizard-supplied block (officer may have edited it);
    // fall back to the partner's registered default. Always normalized to 6 strings.
    const billedTo = normalizeBilledTo(
      (bodyBilledTo && typeof bodyBilledTo === "object") ? bodyBilledTo : partner.billedTo
    );
    // Customer ID: prefer the wizard-supplied value (officer may have typed/edited it);
    // fall back to the partner's registered default. Trimmed to a plain string.
    const resolvedCustomerId =
      (bodyCustomerId !== undefined && bodyCustomerId !== null)
        ? String(bodyCustomerId).trim()
        : (partner.customerId || "");
    const invoiceNumberPattern = new RegExp(
      `^${escapeRegex(invoicePrefix)}-\\d{4}$`
    );

    // ---- Validation ----
    // Accept either a single sourceFileId or an array (consolidated multi-date run).
    const fileIds = (Array.isArray(sourceFileIds) && sourceFileIds.length > 0)
      ? sourceFileIds
      : (sourceFileId ? [sourceFileId] : []);
    if (fileIds.length === 0 || !fileIds.every((id) => typeof id === "string" && /^[A-Za-z0-9_-]{20,}$/.test(id))) {
      return res.status(400).json({ error: "validation", message: "Invalid sourceFileId(s)" });
    }
    if (fileIds.length > 62) {
      return res.status(400).json({ error: "validation", message: "Too many source files in one consolidated run (max 62)." });
    }
    if (!["incoming", "outgoing", "vca"].includes(direction)) {
      return res.status(400).json({ error: "validation", message: "direction must be 'incoming', 'outgoing', or 'vca'" });
    }
    if (!period || period.length > 64) {
      return res.status(400).json({ error: "validation", message: "Missing or oversized period" });
    }
    if (!invoiceNumber || !invoiceNumberPattern.test(invoiceNumber)) {
      return res.status(400).json({
        error: "validation",
        message: `invoiceNumber must match ${invoicePrefix}-NNNN`,
      });
    }
    if (!Array.isArray(previouslyCharged)) {
      return res.status(400).json({ error: "validation", message: "previouslyCharged must be an array" });
    }
    const cleanPrev = previouslyCharged
      .map((p) => ({
        label: String(p?.label || "").trim().slice(0, 80),
        amount: Math.max(0, Number(p?.amount) || 0),
      }))
      .filter((p) => p.label || p.amount > 0)
      .slice(0, 3);
    if (!BILLING_PARENT_FOLDER_ID) {
      return res.status(500).json({ error: "config", message: "BILLING_PARENT_FOLDER_ID not configured on the service" });
    }

    // ---- Parse period for folder structure + filename ----
    // Consolidated mode: periodRange spans multiple dates → one range folder + one
    // report + one invoice. Single mode: parse the single period as before.
    stage = "parsing period";
    const range = normalizePeriodRange(bodyPeriodRange);
    let year, month, day;
    if (range) {
      year = Number(bodyYear) > 0 ? Number(bodyYear) : range.year;
      month = range.startMonth;   // folder/header anchored to the range's start month
      day = range.startDay;
    } else {
      const parsed = parsePeriod(period);
      year = Number(bodyYear) > 0 ? Number(bodyYear) : parsed.year;
      month = parsed.month;
      day = parsed.day;
    }
    const dateLabel = range ? rangeFileLabel(range) : mmddyyyy(year, month, day);
    // Invoice date = today (processing date), not the billing period date.
    const now = new Date();
    const invoiceDateText = formatInvoiceDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
    // Subscription lines still reference the billing period date.
    const billingDateText = formatInvoiceDate(year, month, day);
    const subscriptionDateText = range ? rangeSubscriptionText(range) : billingDateText;
    // Human period written into the SUMMARY tab + returned to the console.
    // Always use the full "Month DD-DD, YYYY" form so Google Sheets never auto-parses
    // it as a date (e.g. "6-11-14" → June 11, 2014). range.label is for folder/file naming only.
    const periodText = range
      ? rangeHumanPeriod(range)
      : (() => {
          const p = parsePeriod(period);
          return (p && p.year && p.month && p.day)
            ? `${MONTH_NAMES[p.month - 1]} ${p.day}, ${p.year}`
            : String(period || "");
        })();

    // ---- Match source rows (one or many source files merged) ----
    stage = "matching source rows";
    // Build filters for this direction.
    // QRPH and VCA count only SETTLED inward transactions.
    // DISBURSE (outgoing): by default bills every attempt; v5-philippines requires SETTLED only per billing spec.
    // For partners with multiple product IDs (e.g. AIO), column A must match ANY of them.
    const allProductCodes = (Array.isArray(partner.productIds) && partner.productIds.length > 1)
      ? partner.productIds.map(pid => `(Prod)${pid}`)
      : [code];
    const directionFilters = [
      allProductCodes.length > 1
        ? { column: "A", altColumns: ["branch_id"], includeValues: allProductCodes }
        : { column: "A", altColumns: ["branch_id"], equals: code },
    ];
    if (direction !== "outgoing") {
      directionFilters.push({ column: "Status", altColumns: ["status"], equals: "SETTLED", caseSensitive: false });
    }
    if (direction === "outgoing" && (partner.id === "v5-philippines" || partner.settledOnlyOutgoing)) {
      directionFilters.push({ column: "Status", altColumns: ["status"], equals: "SETTLED", caseSensitive: false });
    }
    // PESONET outgoing = Not Applicable for Magic Payment, Hopay, Payeasy (billing spec).
    // If the CBS file has no channel column, filter is skipped (safe — no rows excluded).
    if (direction === "outgoing" && partner.excludeOutgoingPesonet) {
      directionFilters.push({ column: "channel", altColumns: ["Channel"], notEquals: "PESONET", caseSensitive: false });
    }
    // Hopay outgoing: exclude specific error/reject reason codes (FF02, FF10, etc.) per spec.
    // If the CBS file has no Reason column, filter is skipped (safe — no rows excluded).
    if (direction === "outgoing" && Array.isArray(partner.outgoingExcludeReasons) && partner.outgoingExcludeReasons.length > 0) {
      directionFilters.push({ column: "Provider Status", altColumns: ["provider_status", "Provider status"], excludeValues: partner.outgoingExcludeReasons, caseSensitive: false });
    }
    // For V5/TopJuan: the CBS file mixes INSTAPAY and PESONET incoming rows in one tab.
    // Incoming (QRPH): INSTAPAY only, TM = QR_P2M. PESONET incoming is not billed.
    // VCA: channel and TM rules differ by partner — see blocks below.
    const TRANSFER_MODE_ALTS = ["Transfer mode", "transfer mode", "Transfer Mode"];
    if (partnerHasVca && direction === "incoming") {
      directionFilters.push({ column: "channel", altColumns: ["Channel"], equals: "INSTAPAY", caseSensitive: false });
      directionFilters.push({ column: "transfer_mode", altColumns: TRANSFER_MODE_ALTS, equals: "QR_P2M", caseSensitive: false });
    }
    if (partnerHasVca && direction === "vca") {
      // Fully data-driven: all VCA detection rules come from vcaConfig stored in Firestore.
      // Set via Admin Portal → Detection Rules → VCA tab. No per-partner hardcoding.
      // patchMissingVcaConfig() ensures every hasVca partner always has a vcaConfig on startup.
      const vc = (partner.vcaConfig && typeof partner.vcaConfig === "object") ? partner.vcaConfig : {};
      const vcChannels = Array.isArray(vc.channels) && vc.channels.length > 0 ? vc.channels : ["INSTAPAY"];
      const vcTm = Array.isArray(vc.transferModes) ? vc.transferModes : ["P2P", "QR_P2P"];
      const requireRef = vc.requireRefCode !== false;

      if (vcChannels.length === 1) {
        directionFilters.push({ column: "channel", altColumns: ["Channel"], equals: vcChannels[0], caseSensitive: false });
      } else {
        directionFilters.push({ column: "channel", altColumns: ["Channel"], includeValues: vcChannels, caseSensitive: false });
      }
      if (vcTm.length > 0) {
        directionFilters.push({ column: "transfer_mode", altColumns: TRANSFER_MODE_ALTS, includeValues: vcTm, caseSensitive: false });
      }
      if (requireRef) {
        directionFilters.push({
          column: "Transfer reference code (if alias used)",
          altColumns: ["transfer_reference_code", "Transfer reference code", "transfer_ref_code", "Reference number", "reference_number"],
          notEquals: "", caseSensitive: false,
        });
      }
    }
    let sourceHeader = null;
    let matches = [];
    for (const fid of fileIds) {
      const m = await getMatchedRows({ sourceFileId: fid, headerRow, filters: directionFilters });
      if (!sourceHeader) {
        sourceHeader = m.header;
        console.log(`[DEBUG] partner=${partner.id} direction=${direction} totalScanned=${m.totalScanned} matched=${m.matches.length}`);
        console.log(`[DEBUG] sourceHeader=${JSON.stringify(m.header)}`);
        // For v5/topjuantech VCA: show unique transfer_mode + ref code values to verify filters
        if (["v5-philippines","topjuantech"].includes(partner.id) && direction === "vca") {
          const tmIdx = m.header.findIndex(h => /transfer[\s_]*mode/i.test(String(h||'')));
          const refIdx = m.header.findIndex(h => /transfer[\s_]*ref/i.test(String(h||'')));
          const uniqueTm = tmIdx >= 0 ? [...new Set(m.matches.map(r => String(r[tmIdx]||'').trim()))].sort() : ["(col not found)"];
          const refBlanks = refIdx >= 0 ? m.matches.filter(r => String(r[refIdx]||'').trim() === '').length : "(col not found)";
          console.log(`[DEBUG] VCA transfer_mode unique: ${JSON.stringify(uniqueTm)}`);
          console.log(`[DEBUG] VCA ref-code blank rows: ${refBlanks} of ${m.matches.length}`);
        }
        // For topjuantech/v5 incoming: show unique channel + transfer_mode values to verify filters
        if (["v5-philippines","topjuantech"].includes(partner.id) && direction === "incoming") {
          const chIdx = m.header.findIndex(h => /^channel$/i.test(String(h||'').trim()));
          const tmIdx = m.header.findIndex(h => /transfer[\s_]*mode/i.test(String(h||'')));
          const uniqueCh = chIdx >= 0 ? [...new Set(m.matches.map(r => String(r[chIdx]||'').trim()))].sort() : ["(column not found)"];
          const uniqueTm = tmIdx >= 0 ? [...new Set(m.matches.map(r => String(r[tmIdx]||'').trim()))].sort() : ["(column not found)"];
          console.log(`[DEBUG] channel col=${chIdx} unique values in matched: ${JSON.stringify(uniqueCh)}`);
          console.log(`[DEBUG] transfer_mode col=${tmIdx} unique values in matched: ${JSON.stringify(uniqueTm)}`);
          console.log(`[DEBUG] directionFilters applied: ${JSON.stringify(directionFilters.map(f=>({col:f.column,alts:f.altColumns,eq:f.equals,ne:f.notEquals,inc:f.includeValues})))}`);
        }
        // Log unique Reason values from the filtered result to verify exclusion filter
        const reasonIdx = m.header.findIndex(h => /^reason$/i.test(String(h || '').trim()));
        if (reasonIdx >= 0 && direction === "outgoing") {
          const uniqueReasons = [...new Set(m.matches.map(r => String(r[reasonIdx] || '').trim()))].sort();
          console.log(`[DEBUG] unique Reason values in FILTERED outgoing (${m.matches.length} rows): ${JSON.stringify(uniqueReasons)}`);
        }
        // For v5-philippines outgoing: log unique Status values to confirm SETTLED filter is working
        if (partner.id === "v5-philippines" && direction === "outgoing") {
          const stIdx = m.header.findIndex(h => /^status$/i.test(String(h || '').trim()));
          const uniqueStatuses = stIdx >= 0
            ? [...new Set(m.matches.map(r => String(r[stIdx] || '').trim()))].sort()
            : ["(Status col not found)"];
          console.log(`[DEBUG] v5 outgoing filtered ${m.matches.length} rows, unique Status: ${JSON.stringify(uniqueStatuses)}`);
        }
      }
      matches = matches.concat(m.matches);
    }

    // Track VCA-skipped state — do NOT early-return for VCA with 0 rows.
    // Returning early leaves stale VCA data in the SUMMARY from a previous run.
    // Instead, let VCA continue through to the SUMMARY write stage so it writes 0s.
    const vcaSkipped = (direction === "vca" && matches.length === 0);
    if (matches.length === 0 && !vcaSkipped) {
      return res.status(400).json({
        error: "no_matches",
        code: "mapping_review_needed",
        partner: { id: partner.id, name: partner.name, productId: partner.productId, productCode: code },
        message:
          `No SETTLED rows found in source for ${partner.name} (code ${code}). ` +
          `Either the source file does not contain ${partner.name} transactions, ` +
          `or the partner's product ID has changed. ` +
          `Mapping review needed before generating an invoice for this period.`,
        expectedMagicCode: code,
        sourceFileId: fileIds[0],
        sourceFileIds: fileIds,
        suggestedActions: [
          `Open the source file and verify it contains ${partner.name} SETTLED transactions`,
          `Confirm the column-A merchant code matches ${partner.name}'s Product ID (${partner.productId}; CBS code ${code})`,
          "If the Product ID has changed, update the PARTNERS registry on the service and redeploy",
        ],
      });
    }

    // ---- For outgoing: split Interbank vs Intrabank using col K (Recipient institution code) ----
    // CUOBPHM2XXX = Intrabank (PHP 2/txn). Anything else = Interbank (PHP 3.5/txn).
    stage = "classifying interbank/intrabank";
    let interbankCount = 0;
    let intrabankCount = 0;
    if (direction === "outgoing") {
      const kIdx = sourceHeader.findIndex((h) =>
        /recipient\s+institution\s+code/i.test(String(h || ""))
      );
      if (kIdx < 0) {
        return res.status(500).json({
          error: "header_missing",
          message: 'Source header missing "Recipient institution code" column (expected at column K).',
        });
      }
      for (const row of matches) {
        const codeVal = String(row[kIdx] || "").trim();
        if (codeVal === "CUOBPHM2XXX") intrabankCount++;
        else interbankCount++;
      }
    }

    const { drive, sheets } = await getClients();

    // ---- Resolve output folder: Billing/YYYY/<Partner>/MM Month/<MMDDYYYY | range leaf> ----
    stage = "resolving output folder";
    // Consolidated runs land in a single range-named leaf folder (e.g. "6-11-14"),
    // editable by the officer via periodRange.label; falls back to the canonical label.
    const leafFolderName = range
      ? (sanitizeFolderLabel(range.label) || rangeFolderLabel(range))
      : undefined;
    const { yearFolder, partnerFolder, monthFolder, dateFolder, dateFolderName } = await resolveBillingPath(
      drive, BILLING_PARENT_FOLDER_ID, year, partner.name, month, day, leafFolderName
    );

    // ---- Look for existing files in the date folder (UPDATE-if-exists semantics) ----
    stage = "scanning existing outputs";
    const dateFolderListing = await withRetry(() => drive.files.list({
      q: `'${dateFolder.id}' in parents and trashed = false`,
      fields: "files(id,name,mimeType,createdTime)",
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      orderBy: "createdTime",
    }), { label: "scanning existing outputs" });
    const existingFiles = dateFolderListing.data.files || [];
    // Report base name uses partner name so each partner's report is identifiable;
    // accept any earlier "MagicPAy- ..." naming for back-compat reuse.
    const reportPrefix = `${partner.name.replace(/\W+/g, "")}-Billing`;
    const existingReportSheet = existingFiles.find(
      (f) => f.mimeType === "application/vnd.google-apps.spreadsheet" &&
             (f.name.startsWith(reportPrefix) || /^MagicPAy[- ]/i.test(f.name))
    );
    // Invoice Sheet: match by current partner's prefix OR legacy "invoice_Magicpayment-"
    const escapedInvoicePrefix = escapeRegex(invoicePrefix);
    const invoiceSheetPattern = new RegExp(`^invoice_${escapedInvoicePrefix}-`, "i");
    const existingInvoiceSheet = existingFiles.find(
      (f) => f.mimeType === "application/vnd.google-apps.spreadsheet" &&
             (invoiceSheetPattern.test(f.name) || /^invoice_Magicpayment-/i.test(f.name))
    );
    // Note: invoice PDFs are re-scanned later (right before deletion) to avoid
    // missing files created moments ago in a batch run (Drive list eventual-consistency).

    // If an invoice Sheet already exists for this date, reuse ITS invoice number
    // (one date = one invoice; the user's typed number is ignored if it differs).
    let effectiveInvoiceNumber = invoiceNumber;
    let invoiceNumberReused = false;
    if (existingInvoiceSheet) {
      const re = new RegExp(`(${escapedInvoicePrefix})-(\\d{4})|(Magicpayment)-(\\d{4})`, "i");
      const m = existingInvoiceSheet.name.match(re);
      if (m) {
        const prefixSeen = m[1] || m[3];
        const numSeen = m[2] || m[4];
        effectiveInvoiceNumber = `${prefixSeen}-${numSeen}`;
        invoiceNumberReused = effectiveInvoiceNumber !== invoiceNumber;
      }
    }

    const reportBase = range
      ? `${reportPrefix}- ${rangeReportPeriod(range)}`
      : `${reportPrefix}- ${monthFolder.name.replace(/^\d+\s+/, "")} ${day}-${year}`;
    const invoiceBase = range
      ? `invoice_${effectiveInvoiceNumber}_${rangeFileLabel(range)}`
      : `invoice_${effectiveInvoiceNumber}_${month}-${day}-${year}`;

    // ---- Reuse or create Billing Report (blank Google Sheet, no template) ----
    let reportFileId;
    let reportReused = false;
    if (existingReportSheet) {
      stage = "reusing existing billing report";
      reportFileId = existingReportSheet.id;
      reportReused = true;
      // Re-initialize SUMMARY on incoming so legacy reports (created before VCA was added)
      // gain VCA rows in the structure. Safe to call here: incoming always runs first,
      // no direction data has been written yet, and sub-period rows are beyond row 25.
      if (direction === 'incoming') {
        await initBlankSummary(sheets, reportFileId);
      }
    } else {
      stage = "creating blank billing report";
      // Create the spreadsheet directly in the billing folder (parents = dateFolder.id).
      // This avoids the SA's "My Drive" quota — the file lands in the shared folder immediately.
      const driveCreated = await withRetry(() => drive.files.create({
        requestBody: {
          name: reportBase,
          mimeType: "application/vnd.google-apps.spreadsheet",
          parents: [dateFolder.id],
        },
        supportsAllDrives: true,
        fields: "id",
      }), { label: "creating blank billing report sheet" });
      reportFileId = driveCreated.data.id;
      // Rename default "Sheet1" → SUMMARY and add the other tabs
      const newSheetMeta = await withRetry(() => sheets.spreadsheets.get({
        spreadsheetId: reportFileId, fields: "sheets(properties(sheetId,title))",
      }), { label: "reading new sheet metadata" });
      const sheet1 = (newSheetMeta.data.sheets || []).find(s => s.properties.title === "Sheet1");
      const sheet1Id = sheet1?.properties?.sheetId ?? 0;
      const extraTabs = [
        { addSheet: { properties: { title: "QRPH" } } },
        ...(partnerHasVca ? [{ addSheet: { properties: { title: "VCA" } } }] : []),
        { addSheet: { properties: { title: "DISBURSE" } } },
      ];
      await withRetry(() => sheets.spreadsheets.batchUpdate({
        spreadsheetId: reportFileId,
        requestBody: { requests: [
          { updateSheetProperties: { properties: { sheetId: sheet1Id, title: "SUMMARY" }, fields: "title" } },
          ...extraTabs,
        ]},
      }), { label: "renaming Sheet1 and adding tabs" });
      // Write SUMMARY structure so findSummaryCells() can locate every cell
      await initBlankSummary(sheets, reportFileId);
    }

    // ---- Ensure VCA tab exists (blank report includes it; reused reports may predate VCA) ----
    if (partnerHasVca && (direction === "vca")) {
      stage = "ensuring VCA tab";
      const vcaSheetsMeta = await withRetry(() => sheets.spreadsheets.get({
        spreadsheetId: reportFileId,
        fields: "sheets(properties(sheetId,title))",
      }), { label: "reading sheet list for VCA check" });
      const existingTitles = (vcaSheetsMeta.data.sheets || []).map((s) => s.properties.title);
      if (!existingTitles.includes("VCA")) {
        await withRetry(() => sheets.spreadsheets.batchUpdate({
          spreadsheetId: reportFileId,
          requestBody: {
            requests: [{
              addSheet: { properties: { title: "VCA" } },
            }],
          },
        }), { label: "adding VCA tab to report" });
      }
    }

    // ---- Pick target tab ----
    const targetTab = direction === "outgoing" ? "DISBURSE" : direction === "vca" ? "VCA" : "QRPH";

    // ---- Write CBS header as row 1 of target tab (blank reports need this; reused reports are safe to re-write) ----
    stage = "writing tab header row";
    {
      const headerWithFee = [...sourceHeader, "Applicable Fee"];
      const lastHdrCol = colIndexToLetter(headerWithFee.length - 1);
      await withRetry(() => sheets.spreadsheets.values.update({
        spreadsheetId: reportFileId,
        range: `'${targetTab}'!A1:${lastHdrCol}1`,
        valueInputOption: "RAW",
        requestBody: { values: [headerWithFee] },
      }), { label: "writing tab header row" });
    }

    // ---- Detect header row in target tab ----
    stage = "detecting template header row";
    const anchors = direction === "outgoing"
      ? ["Sending branch name", "Amount", "Status"]
      : ["Receiving branch name", "Amount", "Status", "branch_id", "cbs_amount_inward", "status"];
    const { headerRowIdx: tplHeaderRow, header: tplHeader } = await findHeaderRowInTab(
      sheets, reportFileId, targetTab, anchors
    );
    if (!tplHeaderRow) {
      return res.status(500).json({
        error: "template_layout",
        message: `Could not find header row in ${targetTab} (looked for anchors ${JSON.stringify(anchors)})`,
      });
    }

    // ---- Build data rows aligned to template header order ----
    // Source header is row {headerRow} of CBS export; template header on row {tplHeaderRow} of the copy.
    // We just write the matched source rows verbatim (they share column order per the brief).
    stage = "preparing data rows";
    const dataStartRow = tplHeaderRow + 1;
    const numCols = tplHeader.length;
    // Slice each row to expected width and pad short rows.
    const aligned = matches.map((row) => {
      const out = [];
      for (let i = 0; i < numCols; i++) out.push(row[i] ?? "");
      return out;
    });
    const lastCol = colIndexToLetter(numCols - 1);

    // ---- Ensure the target tab's grid is big enough for the data ----
    // A fresh template copy defaults to ~1000 rows; writing past the grid throws
    // 400 "exceeds grid limits". Expand the row count explicitly BEFORE writing so
    // the chunked writes all land on rows that already exist. (Sheets only auto-grows
    // for a single contiguous write — not for chunks that start at a high row.)
    stage = "expanding sheet grid";
    const neededRows = dataStartRow + aligned.length + 50;
    const gridMeta = await withRetry(() => sheets.spreadsheets.get({
      spreadsheetId: reportFileId,
      fields: "sheets(properties(sheetId,title,gridProperties(rowCount)))",
    }), { label: "reading sheet grid size" });
    const targetSheetProps = (gridMeta.data.sheets || [])
      .map((s) => s.properties)
      .find((p) => p && p.title === targetTab);
    if (targetSheetProps && (targetSheetProps.gridProperties?.rowCount || 0) < neededRows) {
      await withRetry(() => sheets.spreadsheets.batchUpdate({
        spreadsheetId: reportFileId,
        requestBody: {
          requests: [{
            updateSheetProperties: {
              properties: {
                sheetId: targetSheetProps.sheetId,
                gridProperties: { rowCount: neededRows },
              },
              fields: "gridProperties.rowCount",
            },
          }],
        },
      }), { label: "expanding sheet grid" });
    }

    // Clear old rows before writing current data. This prevents reused reports
    // from keeping stale DISBURSE/QRPH rows that inflate SUMMARY counts.
    // Open-ended range (A{start}:{lastCol}) clears every row to the bottom of the
    // grid — NOT a hardcoded 10000 cap, which used to leave rows 10001+ behind from
    // larger prior runs and corrupt COUNT(E:E)-based SUMMARY counts/fees.
    stage = "clearing stale data rows";
    await withRetry(() => sheets.spreadsheets.values.clear({
      spreadsheetId: reportFileId,
      range: `'${targetTab}'!A${dataStartRow}:${lastCol}`,
    }), { label: "clearing stale data rows" });

    // Write data in chunks, SEQUENTIALLY, each chunk retried on transient/quota errors.
    // - Chunking avoids the single-monolithic-update "Internal error encountered" (500).
    // - Sequential (not parallel) keeps us under Google's ~60 writes/min per-user quota;
    //   parallel chunks here + a multi-date batch were tripping 429 quota errors.
    stage = "writing data rows";
    const WRITE_CHUNK = 5000;
    for (let off = 0; off < aligned.length; off += WRITE_CHUNK) {
      const chunk = aligned.slice(off, off + WRITE_CHUNK);
      const startRow = dataStartRow + off;
      await withRetry(() => sheets.spreadsheets.values.update({
        spreadsheetId: reportFileId,
        range: `'${targetTab}'!A${startRow}:${lastCol}${startRow + chunk.length - 1}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: chunk },
      }), { label: `writing data rows (rows ${startRow}-${startRow + chunk.length - 1})` });
    }

    // ---- Compute per-partner fees as VALUES (the report template carries no formulas) ----
    const rules = feeRules(partner);
    // Detect amount column dynamically from source file header (not hardcoded index).
    // Magic CBS uses title-case "Amount" at col D (idx 3); V5/TopJuan CBS uses "cbs_amount_inward" at idx 6.
    const amtIdx = (() => {
      const i = sourceHeader.findIndex((h) => /^cbs_amount_inward$/i.test(String(h || "")));
      if (i >= 0) return i;
      const j = sourceHeader.findIndex((h) => /^amount$/i.test(String(h || "")));
      if (j >= 0) return j;
      return direction === "outgoing" ? 4 : 3; // safe fallback
    })();
    let qrphFee = 0, qrphVolume = 0, disburseFee = 0, disburseVolume = 0, vcaFee = 0, vcaVolume = 0;
    if (direction === "vca") {
      // VCA: V5/TopJuan pre-split VCA rows into a separate tab — all rows in this direction are VCA.
      stage = "writing VCA fee values";
      const vcaRunCount = aligned.length;
      const feeVals = aligned.map((row) => {
        const amt = Number(row[amtIdx]);
        if (row[amtIdx] === "" || !Number.isFinite(amt)) return [""];
        const fee = rules.vca(amt, vcaRunCount);
        vcaFee += fee;
        vcaVolume += amt;
        return [fee];
      });
      for (let off = 0; off < feeVals.length; off += WRITE_CHUNK) {
        const chunk = feeVals.slice(off, off + WRITE_CHUNK);
        const startRow = dataStartRow + off;
        await withRetry(() => sheets.spreadsheets.values.update({
          spreadsheetId: reportFileId,
          range: `'VCA'!W${startRow}:W${startRow + chunk.length - 1}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: chunk },
        }), { label: `writing VCA fee values (rows ${startRow}-${startRow + chunk.length - 1})` });
      }
    } else if (direction === "incoming") {
      // QRPH/VCA: per-row Applicable Fee in column W (values, not formulas), summed into qrphFee.
      // Incoming rows mix QR_P2M (QRPH) and P2P/QR_P2P (VCA) — split by Transfer mode so each
      // bills at its own per-partner rate (QR_P2M → qrph(), P2P → vca()). vca()===0 → not billed.
      // modeIdx must come from sourceHeader (not tplHeader) — source has "Transfer mode", template may not.
      stage = "writing QRPH/VCA fee values";
      const modeIdx = sourceHeader.findIndex((h) => /transfer[\s_]*mode/i.test(String(h || "")));
      let vcaCount = 0;
      const incomingRunCount = aligned.length;
      const feeVals = aligned.map((row) => {
        const amt = Number(row[amtIdx]);
        if (row[amtIdx] === "" || !Number.isFinite(amt)) return [""];
        const mode = modeIdx >= 0 ? String(row[modeIdx] || "").toUpperCase() : "";
        const isVca = mode.includes("P2P"); // matches "P2P" and "QR_P2P"; "QR_P2M" excluded
        const fee = isVca ? rules.vca(amt, incomingRunCount) : rules.qrph(amt, incomingRunCount);
        if (isVca) vcaCount++;
        qrphFee += fee;
        qrphVolume += amt;
        return [fee];
      });
      if (modeIdx < 0) console.warn("Transfer mode column not found in source header — all incoming rows billed as QR_P2M (QRPH).");
      else console.log(`Incoming fee split: ${aligned.length - vcaCount} QR_P2M (QRPH) + ${vcaCount} P2P (VCA) rows.`);
      for (let off = 0; off < feeVals.length; off += WRITE_CHUNK) {
        const chunk = feeVals.slice(off, off + WRITE_CHUNK);
        const startRow = dataStartRow + off;
        await withRetry(() => sheets.spreadsheets.values.update({
          spreadsheetId: reportFileId,
          range: `'QRPH'!W${startRow}:W${startRow + chunk.length - 1}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: chunk },
        }), { label: `writing QRPH fee values (rows ${startRow}-${startRow + chunk.length - 1})` });
      }
    } else {
      // DISBURSE: flat per-txn fee by recipient class. interbankCount/intrabankCount were
      // counted above from col K. interbank===intrabank for every partner except Magic Payment.
      for (const row of aligned) {
        const amt = Number(row[amtIdx]);
        if (Number.isFinite(amt)) disburseVolume += amt;
      }
      if (rules.disburseByAmount) {
        // Amount-tiered disburse (e.g. AIO): compute fee per row based on transaction amount.
        disburseFee = aligned.reduce((sum, row) => {
          const amt = Number(row[amtIdx]);
          return sum + (Number.isFinite(amt) ? rules.disburseByAmount(amt) : 0);
        }, 0);
      } else {
        disburseFee = interbankCount * rules.disburse.interbank + intrabankCount * rules.disburse.intrabank;
      }
    }

    // ---- Write per-partner Branch ID + Branch name into the report header ----
    // Both use the selected partner's product code (Branch name = Production ID for now).
    // Located by label scan in column A, so each partner's report carries its own code
    // instead of the template's hardcoded Magic Payment code.
    stage = "writing report header (branch)";
    const branchCells = await writeReportHeaderBranch(sheets, reportFileId, targetTab, code, code);

    // ---- Fill SUMMARY with computed VALUES (the report template has NO formulas) ----
    // Reused reports accumulate incoming + outgoing across separate runs, so we write
    // ONLY this direction's detail block, then read both blocks back to compute the grand
    // total + reconciliation. Order-of-runs stays irrelevant.
    stage = "populating SUMMARY";
    const sumCells = await findSummaryCells(sheets, reportFileId);
    const sumUpdates = [];
    // Title row (always A1): replace template's generic title with this partner's name.
    sumUpdates.push({ range: "SUMMARY!A1", values: [[`${partner.name.toUpperCase()} BILLING REPORT`]] });
    // Period rows: written as RAW via a separate call (below) to prevent Google Sheets from
    // auto-parsing date-like strings. Collect ranges here, write after sumUpdates flush.
    const periodRanges = [];
    if (sumCells.periodTopRow) periodRanges.push(`SUMMARY!A${sumCells.periodTopRow}`);
    if (sumCells.periodReconRow) periodRanges.push(`SUMMARY!A${sumCells.periodReconRow}`);
    // Previously charged (sub-period rows below "Less Previously Charged"):
    //   entries → write label+amount; none + new report → clear; none + reused → leave alone.
    if (cleanPrev.length > 0) {
      for (let i = 0; i < sumCells.subPeriodRows.length; i++) {
        const r = sumCells.subPeriodRows[i];
        const pc = cleanPrev[i];
        if (pc) {
          sumUpdates.push({ range: `SUMMARY!A${r}`, values: [[pc.label]] });
          sumUpdates.push({ range: `SUMMARY!B${r}`, values: [[pc.amount]] });
        } else {
          sumUpdates.push({ range: `SUMMARY!A${r}`, values: [[""]] });
          sumUpdates.push({ range: `SUMMARY!B${r}`, values: [[""]] });
        }
      }
    } else if (!reportReused) {
      for (let i = 0; i < sumCells.subPeriodRows.length; i++) {
        const r = sumCells.subPeriodRows[i];
        sumUpdates.push({ range: `SUMMARY!A${r}`, values: [[""]] });
        sumUpdates.push({ range: `SUMMARY!B${r}`, values: [[""]] });
      }
    }
    // This direction's detail block — fee / count / volume (raw, NOT rounded) + rate in col C.
    // Subtotals stay as raw floats matching the human process; only grand totals use round2().
    if (direction === "vca") {
      if (sumCells.vcaFeeRow) {
        sumUpdates.push({ range: `SUMMARY!B${sumCells.vcaFeeRow}`, values: [[vcaFee]] });
        sumUpdates.push({ range: `SUMMARY!B${sumCells.vcaFeeRow + 1}`, values: [[matches.length]] });
        sumUpdates.push({ range: `SUMMARY!B${sumCells.vcaFeeRow + 2}`, values: [[vcaVolume]] });
        sumUpdates.push({ range: `SUMMARY!C${sumCells.vcaFeeRow}`, values: [[rules.vca(1)]] });
      }
    } else if (direction === "incoming") {
      if (sumCells.qrphFeeRow) {
        sumUpdates.push({ range: `SUMMARY!B${sumCells.qrphFeeRow}`, values: [[qrphFee]] });
        sumUpdates.push({ range: `SUMMARY!B${sumCells.qrphFeeRow + 1}`, values: [[matches.length]] });
        sumUpdates.push({ range: `SUMMARY!B${sumCells.qrphFeeRow + 2}`, values: [[qrphVolume]] });
        sumUpdates.push({ range: `SUMMARY!C${sumCells.qrphFeeRow}`, values: [[`${rules.qrphNote}; ${rules.vcaNote}`]] });
      }
    } else {
      if (sumCells.disburseFeeRow) {
        sumUpdates.push({ range: `SUMMARY!B${sumCells.disburseFeeRow}`, values: [[disburseFee]] });
        sumUpdates.push({ range: `SUMMARY!B${sumCells.disburseFeeRow + 1}`, values: [[matches.length]] });
        sumUpdates.push({ range: `SUMMARY!B${sumCells.disburseFeeRow + 2}`, values: [[disburseVolume]] });
        sumUpdates.push({ range: `SUMMARY!C${sumCells.disburseFeeRow}`, values: [[rules.disburse.interbank]] });
      }
      // Store interbank/intrabank counts so pdfkit invoice can split the disburse line
      if (sumCells.interbankCountRow) sumUpdates.push({ range: `SUMMARY!B${sumCells.interbankCountRow}`, values: [[interbankCount]] });
      if (sumCells.intrabankCountRow) sumUpdates.push({ range: `SUMMARY!B${sumCells.intrabankCountRow}`, values: [[intrabankCount]] });
    }
    if (sumUpdates.length > 0) {
      await withRetry(() => sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: reportFileId,
        requestBody: { valueInputOption: "USER_ENTERED", data: sumUpdates },
      }), { label: "populating SUMMARY" });
    }
    // Write period cells separately with RAW option so Google Sheets never auto-parses
    // date-like strings (e.g. "6-11-14" → Excel date 2014-06-11 under USER_ENTERED).
    if (periodRanges.length > 0) {
      await withRetry(() => sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: reportFileId,
        requestBody: {
          valueInputOption: "RAW",
          data: periodRanges.map((r) => ({ range: r, values: [[periodText]] })),
        },
      }), { label: "writing billing period" });
    }

    // ---- Read full report state, then write computed totals + reconciliation (VALUES) ----
    stage = "reading report state";
    const subRows = sumCells.subPeriodRows;
    // Build readRanges with stable indices; use fallback refs for missing positions.
    const readRanges = [
      sumCells.qrphFeeRow ? `SUMMARY!B${sumCells.qrphFeeRow}` : "SUMMARY!B2",           // 0: QRPH fee
      sumCells.qrphFeeRow ? `SUMMARY!B${sumCells.qrphFeeRow + 1}` : "SUMMARY!B3",       // 1: QRPH count
      sumCells.disburseFeeRow ? `SUMMARY!B${sumCells.disburseFeeRow}` : "SUMMARY!B7",   // 2: Disburse fee
      sumCells.disburseFeeRow ? `SUMMARY!B${sumCells.disburseFeeRow + 1}` : "SUMMARY!B8", // 3: Disburse count
      "DISBURSE!E:E",  // 4: amounts (fallback column — may not match blank-sheet layout)
      "DISBURSE!K:K",  // 5: recipient codes (fallback)
      sumCells.vcaFeeRow ? `SUMMARY!B${sumCells.vcaFeeRow}` : "SUMMARY!B1",             // 6: VCA fee
      sumCells.interbankCountRow ? `SUMMARY!B${sumCells.interbankCountRow}` : "SUMMARY!B24", // 7: interbank count
      sumCells.intrabankCountRow ? `SUMMARY!B${sumCells.intrabankCountRow}` : "SUMMARY!B25", // 8: intrabank count
    ];
    const subRowsIdx = 9; // sub-period range always at index 9 (after the new interbank entries)
    if (subRows.length === 3) readRanges.push(`SUMMARY!B${subRows[0]}:B${subRows[2]}`);
    const sumRead = await withRetry(() => sheets.spreadsheets.values.batchGet({
      spreadsheetId: reportFileId,
      ranges: readRanges,
      valueRenderOption: "UNFORMATTED_VALUE",
    }), { label: "reading report state" });
    const sv = (i) => Number((sumRead.data.valueRanges[i]?.values?.[0]?.[0]) || 0);
    // Round the source fee totals to centavos up front so every figure derived
    // from them (grand total, amount due, invoice lines) stays at 2 decimals.
    const qrphTotalFee = round2(sv(0));
    const qrphCount = sv(1);
    const disburseTotalFee = round2(sv(2));
    const disburseCount = sv(3);
    const eValues = (sumRead.data.valueRanges[4]?.values || []).flat();
    const kValues = (sumRead.data.valueRanges[5]?.values || []).flat();
    // VCA total: only non-zero when vcaFeeRow was found and a prior VCA run wrote a value.
    const vcaTotalFee = sumCells.vcaFeeRow ? round2(sv(6)) : 0;
    // Interbank/intrabank: prefer SUMMARY stored counts (written by blank-sheet runs);
    // fall back to scanning DISBURSE!E:E + K:K for old template-based reports.
    const summaryInterbankCount = sv(7);
    const summaryIntrabankCount = sv(8);
    let reportInterbankCount, reportIntrabankCount, reportDisburseCount;
    if (summaryInterbankCount > 0 || summaryIntrabankCount > 0) {
      reportInterbankCount = summaryInterbankCount;
      reportIntrabankCount = summaryIntrabankCount;
      reportDisburseCount  = summaryInterbankCount + summaryIntrabankCount;
    } else {
      const intrabankFromCol = kValues.filter((v) => String(v || "").trim() === "CUOBPHM2XXX").length;
      const totalFromCol     = eValues.filter((v) => typeof v === "number" && !Number.isNaN(v)).length;
      reportIntrabankCount = intrabankFromCol;
      reportDisburseCount  = totalFromCol;
      reportInterbankCount = Math.max(0, totalFromCol - intrabankFromCol);
    }
    const prevChargedTotal = subRows.length === 3
      ? (sumRead.data.valueRanges[subRowsIdx]?.values || []).flat().reduce((s, v) => s + (Number(v) || 0), 0)
      : 0;
    const lessAmount = round2(-prevChargedTotal);
    const grandTotal = round2(qrphTotalFee + disburseTotalFee + vcaTotalFee);
    const amountDue = round2(grandTotal + lessAmount);

    // Top summary rows (per-category and grand total) + reconciliation col C — all computed VALUES.
    const totalUpdates = [];
    if (sumCells.qrphTopRow)    totalUpdates.push({ range: `SUMMARY!B${sumCells.qrphTopRow}`,    values: [[qrphTotalFee]] });
    if (sumCells.disburseTopRow) totalUpdates.push({ range: `SUMMARY!B${sumCells.disburseTopRow}`, values: [[disburseTotalFee]] });
    if (sumCells.vcaTopRow)     totalUpdates.push({ range: `SUMMARY!B${sumCells.vcaTopRow}`,     values: [[vcaTotalFee]] });
    if (sumCells.totalTopRow)   totalUpdates.push({ range: `SUMMARY!B${sumCells.totalTopRow}`,   values: [[grandTotal]] });
    if (sumCells.lessRow) {
      const qrphReconRow = sumCells.lessRow - 4;
      const disburseReconRow = sumCells.lessRow - 3;
      const totalReconRow = sumCells.lessRow - 2;
      totalUpdates.push({ range: `SUMMARY!C${qrphReconRow}`, values: [[qrphTotalFee]] });
      totalUpdates.push({ range: `SUMMARY!C${disburseReconRow}`, values: [[disburseTotalFee]] });
      totalUpdates.push({ range: `SUMMARY!C${totalReconRow}`, values: [[grandTotal]] });
      totalUpdates.push({ range: `SUMMARY!C${sumCells.lessRow}`, values: [[lessAmount]] });
    }
    if (sumCells.amountDueRow) {
      totalUpdates.push({ range: `SUMMARY!C${sumCells.amountDueRow}`, values: [[amountDue]] });
    }
    await withRetry(() => sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: reportFileId,
      requestBody: { valueInputOption: "USER_ENTERED", data: totalUpdates },
    }), { label: "writing SUMMARY totals" });

    // No consistency/branch warnings:
    //  - disburse_count_mismatch is gone — SUMMARY!B17 is now an authoritative VALUE we write
    //    (= this run's matched rows), not a COUNT(E:E) formula that used to pick up numbers in
    //    the template's header region (the old 13-row "mismatch").
    //  - branch_header_not_found is gone — the values-only template has no "Branch" label block;
    //    Branch ID is optional metadata, so its absence is not an error.
    const warnings = [];

    // ---- Scan for formula errors ----
    stage = "verifying report formulas";
    const errs = await scanFormulaErrors(sheets, reportFileId);
    if (errs.length > 0) {
      return res.status(500).json({
        error: "formula_errors",
        message: `Report has ${errs.length} formula error(s): ${[...new Set(errs)].join(", ")}`,
        reportFileId,
      });
    }

    // ---- Generate invoice PDF from Google Sheets template ----
    stage = "generating invoice PDF";
    const customerId = resolvedCustomerId;
    // For amount-tiered disburse (AIO), use a blended effective rate so the invoice total is correct.
    const invoiceDisburseCount = reportInterbankCount + reportIntrabankCount;
    const interbankRate = rules.disburseByAmount
      ? round2(disburseTotalFee / Math.max(invoiceDisburseCount, 1))
      : rules.disburse.interbank;
    const intrabankRate = rules.disburseByAmount ? interbankRate : rules.disburse.intrabank;
    const vcaRate = rules.vca(1, null);
    const pdfBuffer = await generateInvoiceFromTemplate({
      billingFolderId: dateFolder.id,
      invoiceNumber: effectiveInvoiceNumber,
      invoiceDateText,
      customerId,
      billedTo,
      invoicePrefix,
      partnerHasVca,
      vcaTotalFee,
      vcaRate,
      qrphTotalFee,
      disburseTotalFee,
      disburseCount,
      interbankCount: reportInterbankCount,
      intrabankCount: reportIntrabankCount,
      interbankRate,
      intrabankRate,
      grandTotal,
      amountDue,
      subscriptionDateText,
    });
    const billedToRanges = null; // not used in template flow

    // ---- Trash ALL existing invoice PDFs in the date folder, then upload fresh ----
    // IMPORTANT: files in Shared Drives can only be permanently DELETED by Manager role.
    // Service accounts typically have Content Manager (can trash, can't permanent-delete).
    // So we TRASH the old PDFs via files.update — they disappear from listings, are
    // recoverable for ~30 days, and work with the SA's Content Manager role.
    //
    // Two-pronged trashing:
    //   (1) Explicit IDs passed in `previousPdfFileIds` — for batch runs where the wizard
    //       knows the file IDs of PDFs created in earlier calls (avoids Drive index latency).
    //   (2) Fresh files.list query — catches any orphan PDFs from older sessions.
    // One date folder = one visible invoice PDF.
    stage = "trashing old invoice PDFs";
    const previousPdfFileIds = Array.isArray(req.body.previousPdfFileIds)
      ? req.body.previousPdfFileIds.filter(Boolean)
      : [];
    const trashFile = async (id, name) => {
      try {
        await withRetry(() => drive.files.update({
          fileId: id,
          requestBody: { trashed: true },
          supportsAllDrives: true,
        }), { label: `trashing PDF ${id}` });
        return true;
      } catch (err) {
        console.warn(`Failed to trash invoice PDF ${name || ""} (${id}):`, err.message);
        return false;
      }
    };
    let trashedCount = 0;
    const handledIds = new Set();
    // Step 1: explicit trashing by ID (in parallel)
    previousPdfFileIds.forEach((id) => handledIds.add(id));
    const step1 = await Promise.all(previousPdfFileIds.map((id) => trashFile(id, "(by id)")));
    trashedCount += step1.filter(Boolean).length;
    // Step 2: fresh scan + trash remaining (any invoice PDF in the date folder), in parallel.
    // One date folder = one invoice PDF, so we trash every prior invoice_*.pdf
    // regardless of partner prefix.
    const freshPdfScan = await withRetry(() => drive.files.list({
      q: `'${dateFolder.id}' in parents and mimeType = 'application/pdf' ` +
         `and name contains 'invoice_' and trashed = false`,
      fields: "files(id,name)",
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    }), { label: "scanning old invoice PDFs" });
    const toTrash = (freshPdfScan.data.files || []).filter((f) => !handledIds.has(f.id));
    const step2 = await Promise.all(toTrash.map((f) => trashFile(f.id, f.name)));
    trashedCount += step2.filter(Boolean).length;
    if (trashedCount > 0) {
      console.log(`Trashed ${trashedCount} old invoice PDF(s) in ${dateFolderName} before re-upload.`);
    }
    stage = "saving invoice PDF";
    const invoicePdfName = `${invoiceBase}.pdf`;
    const pdfCreate = await withRetry(() => drive.files.create({
      requestBody: {
        name: invoicePdfName,
        mimeType: "application/pdf",
        parents: [dateFolder.id],
      },
      media: {
        mimeType: "application/pdf",
        body: Readable.from(pdfBuffer),
      },
      fields: "id,webViewLink",
      supportsAllDrives: true,
    }), { label: "saving invoice PDF" });
    const invoicePdfFileId = pdfCreate.data.id;

    // ---- Respond ----
    res.json({
      ok: true,
      direction,
      period: periodText,
      amountDue,
      grandTotal,
      invoiceNumber: effectiveInvoiceNumber,
      invoiceNumberReused,
      reportReused,
      invoiceSheetReused: false,
      warnings,
      counts: {
        qrph: qrphCount,
        disburse: reportDisburseCount,
        interbank: reportInterbankCount,
        intrabank: reportIntrabankCount,
        thisRunMatched: matches.length,
        thisRunInterbank: interbankCount,
        thisRunIntrabank: intrabankCount,
      },
      totals: {
        qrphFee: qrphTotalFee,
        vcaFee: vcaTotalFee,
        disburseFee: disburseTotalFee,
        interbankFee: reportInterbankCount * interbankRate,
        intrabankFee: reportIntrabankCount * intrabankRate,
      },
      reportFileId,
      reportUrl: `https://docs.google.com/spreadsheets/d/${reportFileId}/edit`,
      invoicePdfFileId,
      invoicePdfUrl: `https://drive.google.com/file/d/${invoicePdfFileId}/view`,
      partner: { id: partner.id, name: partner.name },
      header: {
        branchId: code,
        branchName: code,
        branchRow: branchCells.branchRow,
        branchNameRow: branchCells.branchNameRow,
        branchWritten: !!(branchCells.branchRow || branchCells.branchNameRow),
      },
      vca_skipped: vcaSkipped || false,
      billedTo,
      billedToWritten: true,
      customerId,
      customerIdWritten: true,
      outputFolder: {
        billingParentId: BILLING_PARENT_FOLDER_ID,
        yearFolderId: yearFolder.id,
        yearFolderName: yearFolder.name,
        partnerFolderId: partnerFolder.id,
        partnerFolderName: partnerFolder.name,
        partnerCreated: partnerFolder.created,
        monthFolderId: monthFolder.id,
        monthFolderName: monthFolder.name,
        monthCreated: monthFolder.created,
        dateFolderId: dateFolder.id,
        dateFolderName,
        dateCreated: dateFolder.created,
      },
    });
  } catch (err) {
    console.error(`build-billing error (stage: ${stage}):`, err);
    res.status(500).json({
      error: "build_failed",
      stage,
      message: userError(stage, err),
    });
  }
});

/*
POST /filter
Body:
{
  "sourceFileId": "Drive ID of Google Sheet or .xlsx",
  "sheetName": "Sheet1",            // optional, defaults to first tab
  "headerRow": 1,                   // 1-based, defaults to 1
  "filters": [
    { "column": "A",      "equals": "(Prod)86da22dc-..." },
    { "column": "Status", "equals": "SETTLED" }
  ],
  "output": {                       // optional
    "name": "filtered-2026-05-30",  // default: "<source name> (filtered)"
    "folderId": "Drive folder ID",  // default: My Drive of service account
    "countOnly": false              // if true, skip creating the new sheet
  }
}
*/
app.post("/filter", authMiddleware, async (req, res) => {
  try {
    const { sourceFileId, sheetName, headerRow = 1, filters = [], output = {} } = req.body;

    if (!sourceFileId) return res.status(400).json({ error: "Missing sourceFileId" });
    if (!Array.isArray(filters) || filters.length === 0) {
      return res.status(400).json({ error: "filters[] is required" });
    }

    const { header, matches, sheetTitle, sourceName, totalScanned } = await getMatchedRows({
      sourceFileId, sheetName, headerRow, filters,
    });

    const response = {
      ok: true,
      count: matches.length,
      sheetTitle,
      sourceName,
      totalScanned,
    };

    if (output.countOnly) return res.json(response);

    const { drive, sheets } = await getClients();

    const outputName = output.name || `${sourceName} (filtered)`;
    const result = await writeOutputSheet(
      sheets,
      drive,
      outputName,
      header,
      matches,
      output.folderId
    );

    res.json({
      ...response,
      outputFileId: result.fileId,
      outputFileUrl: result.url,
    });
  } catch (err) {
    console.error("filter error:", err);
    res.status(500).json({ error: "Filter failed", message: clientError(err, "Filter failed. Please try again.") });
  }
});

(async () => {
  try {
    await initPartners();
  } catch (err) {
    console.error("[WARN] Firestore partner init failed, falling back to hardcoded:", err.message);
    _partners = PARTNERS;
    _feeRulesMap = {};
    for (const p of PARTNERS) {
      const seed = PARTNER_SEED.find(s => s.id === p.id);
      _feeRulesMap[p.id] = seed ? buildFeeRulesForPartner(seed) : (FEE_RULES[p.id] || FEE_RULES["magic-payment"]);
    }
  }
  app.listen(PORT, () => {
    console.log(`cbs-filter-service listening on port ${PORT}`);
    console.log(`  /             — GET  (static wizard)`);
    console.log(`  /health        — GET  (always open)`);
    console.log(`  /admin         — GET  (partner admin UI)`);
    console.log(`  /admin/partners — CRUD (partner management API)`);
    console.log(`  /config        — GET  (frontend config)`);
    console.log(`  /list-files    — POST (Drive folder listing)`);
    console.log(`  /filter        — POST (filter CBS sheet)`);
    console.log(`  /build-billing — POST (generate billing report + invoice)`);
    console.log(`  API key required: ${API_KEY ? "yes" : "no"}`);
  });
})();
