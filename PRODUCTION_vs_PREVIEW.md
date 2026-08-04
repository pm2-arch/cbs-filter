# Production vs Preview — full difference

Compared the actual deployed code, not notes:
- PRODUCTION = live revision `cbs-filter-00021-7rk` (built 2026-06-04), serving 100% of traffic at the base URL.
- PREVIEW    = revision `cbs-filter-00029-miz` (built 2026-06-08), 0% traffic, tag `preview`.

Preview is THREE batches of enhancements ahead of Production.

---

## PRODUCTION (what is live today)

- Single partner only: Magic Payment, hardcoded (`MAGIC_CODE`). No way to bill any other company.
- App name: "MagicPay Billing Console".
- Wizard = 4 steps: Month -> Incoming Consolidated -> Outgoing Consolidated -> Generate.
- Invoice number: locked to the `Magicpayment-NNNN` format only.
- Output folder: flat `MagicPayment / MM Month / MMDDYYYY` (env `OUTPUT_PARENT_FOLDER_ID`).
- Report/invoice file names hardcoded around "Magicpayment" / "MagicPAy".
- Invoice "Customer ID": NOT writable from the app (no field).
- Invoice "BILLED TO" block: NOT editable; whatever the template already contains stays.
- Report header "Branch / Branch name": template's hardcoded Magic Payment value, not per-partner.

---

## PREVIEW (what we want to ship)

### Batch 1 — Multi-partner support
- 5 partners, each with its own Product ID and invoice prefix:
  Magic Payment, Hopay Philippines, Payeasy Technology, V5 Philippines, Topjuantech.
- New wizard step "Select partner". Wizard is now 5 steps:
  Year -> Partner -> Month -> Pick Incoming & Outgoing (single combined count check) -> Generate.
- Added a Year selection step; Incoming + Outgoing merged into one step that counts both in parallel.
- Per-partner invoice numbering: `<PartnerPrefix>-NNNN` (e.g. Hopay-0001), auto-suggested per partner.
- Output folder restructured to: `Billing / YYYY / <Partner Name> / MM Month / MMDDYYYY`
  (env `BILLING_PARENT_FOLDER_ID`). The partner subfolder is auto-created.
- Report/invoice file names are per-partner (still recognizes legacy Magic names for reuse).
- App renamed to "Billing Console".
- Bug fix: clears stale data rows before writing the report, so reused reports no longer
  keep old DISBURSE/QRPH rows that inflate the SUMMARY counts.

### Batch 2 — Partner-aware header + editable BILLED TO
- Writes each partner's Branch ID / Branch name into the report header (found by label scan,
  not a hardcoded cell), so every partner's report carries its own code.
- New editable "BILLED TO" block in the wizard (6 fields: contact, company, address1,
  address2, country, email), pre-filled from the partner, written into the invoice by
  detecting the "BILLED TO" label. Blank fields are written too, so switching partners
  clears the template's default Magic Payment details.
- Response now returns diagnostics + soft warnings when a label is not found.

### Batch 3 — Editable Customer ID (the one we did today)
- New editable "Customer ID" field in Step 5, next to the Invoice number.
- Pre-filled from the selected partner; the officer can edit per run.
- Written into the invoice's Customer ID cell (`INVOICE!F7`).
- The /build-billing API now accepts `customerId`; falls back to the partner default if omitted.

### Batch 4 — 2-decimal money + multi-date consolidation (rev 00040 / 00041)
Iann's request (Jun 15): money must be 2 decimals; multi-date must consolidate like the manual.
- 2 decimals everywhere: new `round2()` rounds every billed figure (qrphTotalFee, disburseTotalFee,
  grandTotal, lessAmount, amountDue, invoice line values, SUMMARY B10/B16) to centavos. e.g. 926.637 → 926.64.
  Frontend multi-date card also gets `maximumFractionDigits:2`.
- Multi-date CONSOLIDATION (replaces the old per-date folders/invoices): when >1 date is selected, all
  files merge into ONE folder + ONE report + ONE invoice spanning the whole range, matching Iann's manual:
  folder `6-11-14`, invoice `invoice_<Prefix>-NNNN_6-11-14-2026`, subscription `…-QRPH- 6/11-14/2026`.
  - Server: `/build-billing` accepts `sourceFileIds[]` (merge many files) + `periodRange`
    {year,startMonth,startDay,endMonth,endDay,label}. New helpers: `normalizePeriodRange`,
    `rangeFileLabel`, `rangeFolderLabel`, `rangeSubscriptionText`, `rangeReportPeriod`, `rangeHumanPeriod`,
    `sanitizeFolderLabel`. `resolveBillingPath` takes an optional `leafFolderName`.
  - Cross-month label spells both months: `6-28-7-2` / subscription `6/28-7/2/2026`.
  - Range auto-derived from min–max of selected dates; editable in the wizard ("Billing period" field).
  - Frontend: multi-date now shows ONE invoice number + one editable range label; `runConsolidated()`
    makes ≤2 calls (incoming→QRPH, outgoing→DISBURSE) to the same target.
  - Single-date flow is unchanged (full backward compat).

---

## Bottom line
- Production = Magic-Payment-only, 4-step wizard, no Customer ID / BILLED TO / partner controls (rev 00029).
- Preview    = 5 partners + partner-aware header + editable BILLED TO + editable Customer ID
              + 2-decimal money + multi-date consolidation (rev 00041).
- Promoting Preview to 100% ships ALL FOUR batches at once, so test the whole flow first.
