#!/usr/bin/env python3
"""Generate fee-types-user-guide.docx for the CBS Billing Console."""
import os
from docx import Document
from docx.shared import Pt, RGBColor, Inches, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "public", "docs", "fee-guide.docx")

NB_BLUE  = RGBColor(0x00, 0x33, 0x99)
NB_GOLD  = RGBColor(0xFF, 0xCC, 0x00)
NB_DARK  = RGBColor(0x1e, 0x29, 0x3b)
NB_GRAY  = RGBColor(0x64, 0x74, 0x8b)
NB_WHITE = RGBColor(0xFF, 0xFF, 0xFF)
NB_LIGHT = RGBColor(0xf4, 0xf6, 0xfb)
CODE_BG  = RGBColor(0x1e, 0x29, 0x3b)
CODE_FG  = RGBColor(0xe2, 0xe8, 0xf0)


def set_cell_bg(cell, color):
    # color can be RGBColor or a hex string like "003399"
    if isinstance(color, str):
        hex_color = color
    else:
        hex_color = f"{color[0]:02X}{color[1]:02X}{color[2]:02X}"
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tcPr.append(shd)


def heading1(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(20)
    p.paragraph_format.space_after  = Pt(6)
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(16)
    run.font.color.rgb = NB_BLUE
    # bottom border (gold line)
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "12")
    bottom.set(qn("w:space"), "4")
    bottom.set(qn("w:color"), "FFCC00")
    pBdr.append(bottom)
    pPr.append(pBdr)
    return p


def heading2(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after  = Pt(4)
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(11)
    run.font.color.rgb = NB_DARK
    run.font.all_caps = True
    run.font.color.rgb = NB_GRAY
    return p


def body(doc, text, italic=False, color=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(6)
    run = p.add_run(text)
    run.font.size = Pt(10.5)
    if italic:
        run.italic = True
    if color:
        run.font.color.rgb = color
    return p


def formula(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after  = Pt(8)
    p.paragraph_format.left_indent  = Cm(0.5)
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), "1E293B")
    pPr = p._p.get_or_add_pPr()
    pPr.append(shd)
    run = p.add_run(text)
    run.font.name = "Courier New"
    run.font.size = Pt(10)
    run.font.color.rgb = CODE_FG
    run.font.bold = True
    return p


def example(doc, label, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after  = Pt(8)
    p.paragraph_format.left_indent  = Cm(0.5)
    r1 = p.add_run(f"{label}: ")
    r1.bold = True
    r1.font.size = Pt(10.5)
    r1.font.color.rgb = NB_BLUE
    r2 = p.add_run(text)
    r2.font.size = Pt(10.5)
    return p


def billing(doc, lines):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after  = Pt(10)
    p.paragraph_format.left_indent  = Cm(0.5)
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), "F8FAFC")
    pPr = p._p.get_or_add_pPr()
    pPr.append(shd)
    run = p.add_run(lines)
    run.font.name = "Courier New"
    run.font.size = Pt(9.5)
    run.font.color.rgb = NB_DARK
    return p


def tip(doc, text, warn=False):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after  = Pt(8)
    p.paragraph_format.left_indent  = Cm(0.5)
    fill = "FFF7ED" if warn else "EFF6FF"
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    pPr = p._p.get_or_add_pPr()
    pPr.append(shd)
    icon = "⚠️  " if warn else "💡  "
    run = p.add_run(icon + text)
    run.font.size = Pt(10)
    run.font.color.rgb = RGBColor(0xc2, 0x41, 0x0c) if warn else RGBColor(0x1d, 0x4e, 0xd8)
    return p


def add_table(doc, headers, rows, col_widths=None):
    tbl = doc.add_table(rows=1 + len(rows), cols=len(headers))
    tbl.style = "Table Grid"
    # header row
    hdr = tbl.rows[0]
    for i, h in enumerate(headers):
        cell = hdr.cells[i]
        set_cell_bg(cell, NB_BLUE)
        p = cell.paragraphs[0]
        run = p.add_run(h)
        run.bold = True
        run.font.size = Pt(10)
        run.font.color.rgb = NB_WHITE
    # data rows
    for ri, row in enumerate(rows):
        tr = tbl.rows[ri + 1]
        bg = RGBColor(0xf8, 0xfa, 0xfc) if ri % 2 == 1 else NB_WHITE
        for ci, val in enumerate(row):
            cell = tr.cells[ci]
            set_cell_bg(cell, bg)
            p = cell.paragraphs[0]
            if isinstance(val, tuple):
                text, bold = val
            else:
                text, bold = val, False
            run = p.add_run(str(text))
            run.font.size = Pt(10)
            if bold:
                run.bold = True
    if col_widths:
        for i, w in enumerate(col_widths):
            for row in tbl.rows:
                row.cells[i].width = Cm(w)
    doc.add_paragraph()
    return tbl


def bullet(doc, items):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.space_after = Pt(3)
        run = p.add_run(item)
        run.font.size = Pt(10.5)


def numbered(doc, items):
    for item in items:
        p = doc.add_paragraph(style="List Number")
        p.paragraph_format.space_after = Pt(4)
        run = p.add_run(item)
        run.font.size = Pt(10.5)


# ──────────────────────────────────────────────
doc = Document()

# Page margins
section = doc.sections[0]
section.page_width  = Inches(8.5)
section.page_height = Inches(11)
section.left_margin   = Inches(1)
section.right_margin  = Inches(1)
section.top_margin    = Inches(0.9)
section.bottom_margin = Inches(0.9)

# Default font
style = doc.styles["Normal"]
style.font.name = "Calibri"
style.font.size = Pt(10.5)

# ── TITLE ──────────────────────────────────────
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("Billing Console — Fee Types User Guide")
r.bold = True
r.font.size = Pt(22)
r.font.color.rgb = NB_BLUE

p2 = doc.add_paragraph()
p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
r2 = p2.add_run("Admin Portal Reference · CBS Filter Service · September 2026")
r2.font.size = Pt(10)
r2.font.color.rgb = NB_GRAY
r2.italic = True

doc.add_paragraph()

# ── BEFORE YOU START ──────────────────────────
heading1(doc, "Before You Start")
body(doc, "Every partner in the billing console has three fee directions. Each direction is configured independently.")

add_table(doc,
    ["Direction", "What it covers"],
    [
        ("QRPh Fee",    "Incoming QR P2M transactions (customer pays via QR code)"),
        ("VCA Fee",     "Incoming P2P / QR_P2P transactions (VCA transfers)"),
        ("Disburse Fee","Outgoing transactions (partner pays out to customers)"),
    ],
    col_widths=[4, 10]
)

# ── OVERVIEW ──────────────────────────────────
heading1(doc, "Overview — All Fee Types at a Glance")

add_table(doc,
    ["#", "Fee Type", "Best for", "Available on"],
    [
        ("1", "Zero",                        "No charge for this direction",                        "QRPh, VCA, Disburse"),
        ("2", "Flat",                        "Same fixed amount every transaction",                 "QRPh, VCA, Disburse"),
        ("3", "% + Floor",                   "Percentage, never less than a minimum",               "QRPh, VCA"),
        ("4", "% + Floor + Cap",             "Percentage with both minimum and maximum",            "QRPh, VCA"),
        ("5", "Tiered by Amount",            "Different flat fee per transaction size",             "QRPh, VCA, Disburse"),
        ("6", "Tiered by Amount + Run Count","Amount AND monthly volume both affect the rate",      "QRPh, VCA"),
        ("7", "Tiered Percentage",           "Different percentage per amount range",               "QRPh, VCA only"),
        ("8", "Tiered by Count",             "All txns same rate based on total monthly volume",    "Disburse only"),
        ("9", "Fee Rules",                   "Mix of different conditions and fee types",           "QRPh, VCA, Disburse"),
    ],
    col_widths=[0.8, 4.2, 5.5, 3.5]
)

# ── TYPE 1 ────────────────────────────────────
doc.add_page_break()
heading1(doc, "Fee Type 1: Zero")
body(doc, "Charges no fee for this direction. Use this when a partner is not billed for a specific transaction type.")
heading2(doc, "When to use")
bullet(doc, [
    "Partner has no VCA transactions",
    "Fee was waived for a direction during negotiation",
    "Direction is not applicable to this partner",
])
heading2(doc, "How to configure")
numbered(doc, [
    "Select Zero — No fee from the Fee Type dropdown",
    "No additional fields needed — click Save",
])
example(doc, "Example", "VLPay has no VCA billing.  →  Set VCA Fee → Zero")

# ── TYPE 2 ────────────────────────────────────
heading1(doc, "Fee Type 2: Flat")
body(doc, "Charges the same fixed PHP amount for every transaction, regardless of transaction size.")
heading2(doc, "When to use")
bullet(doc, [
    "Partner has a simple per-transaction fee",
    "Transaction amount does not affect the fee",
])
heading2(doc, "How to configure")
numbered(doc, [
    "Select Flat — Fixed ₱X per transaction",
    "Enter the Fee Amount (₱) — e.g. 8 for PHP 8 per transaction",
])
example(doc, "Example", "MaxJoy charges PHP 10 per QRPh transaction.\nQRPh Fee → Flat → Fee Amount: 10")
heading2(doc, "What it looks like in billing")
billing(doc, "100 transactions × PHP 10.00 = PHP 1,000.00 total fee")

# ── TYPE 3 ────────────────────────────────────
heading1(doc, "Fee Type 3: % + Floor")
body(doc, "Charges a percentage of the transaction amount, but never less than a minimum floor.")
formula(doc, "fee = max(amount × rate%, floor)")
heading2(doc, "When to use")
bullet(doc, [
    "Fee is percentage-based",
    "Small transactions need a minimum charge (so the fee isn't too small to be worth billing)",
])
heading2(doc, "How to configure")
numbered(doc, [
    "Select % + Floor — max(amt × rate, floor)",
    "Enter Rate (%) — e.g. 0.7 for 0.7%",
    "Enter Floor (₱) — the minimum fee per transaction, e.g. 1",
])
tip(doc, "Enter the rate as a percentage number. For 0.7%, type 0.7 — not 0.007. The portal converts it automatically.")
example(doc, "Example", "Magic Payment charges 0.7% for QRPh, minimum PHP 1.\nQRPh Fee → % + Floor → Rate: 0.7 → Floor: 1")
heading2(doc, "What it looks like in billing")
billing(doc,
    "PHP 50 transaction:    max(50 × 0.7%, 1.00) = max(0.35, 1.00) = PHP 1.00  ← floor applied\n"
    "PHP 500 transaction:   max(500 × 0.7%, 1.00) = max(3.50, 1.00) = PHP 3.50\n"
    "PHP 2,000 transaction: max(2000 × 0.7%, 1.00) = max(14.00, 1.00) = PHP 14.00"
)

# ── TYPE 4 ────────────────────────────────────
heading1(doc, "Fee Type 4: % + Floor + Cap")
body(doc, "Same as % + Floor, but also adds a maximum cap — the fee can never exceed a certain amount.")
formula(doc, "fee = min( max(amount × rate%, floor), cap )")
heading2(doc, "When to use")
bullet(doc, [
    "Partner fee has a ceiling for large transactions",
    "Protects partners from very high fees on large transfers",
])
heading2(doc, "How to configure")
numbered(doc, [
    "Select % + Floor + Cap",
    "Enter Rate (%), Floor (₱), and Cap (₱)",
])
example(doc, "Example", "HoPay charges 0.5% for QRPh, minimum PHP 1, maximum PHP 5.\nQRPh Fee → % + Floor + Cap → Rate: 0.5 → Floor: 1 → Cap: 5")
heading2(doc, "What it looks like in billing")
billing(doc,
    "PHP 100:    min(max(0.50, 1), 5) = PHP 1.00  ← floor applied\n"
    "PHP 500:    min(max(2.50, 1), 5) = PHP 2.50\n"
    "PHP 2,000:  min(max(10.00, 1), 5) = PHP 5.00  ← cap applied"
)

# ── TYPE 5 ────────────────────────────────────
doc.add_page_break()
heading1(doc, "Fee Type 5: Tiered by Amount")
body(doc, "Charges a flat fee that depends on the transaction amount. Larger transactions get a different fee than smaller ones.")
heading2(doc, "When to use")
bullet(doc, [
    "Partner fee schedule has a table of amount ranges, each with a different flat fee",
    'Example: "PHP 5 for amounts up to PHP 500; PHP 8 for amounts above PHP 500"',
])
heading2(doc, "How to configure")
numbered(doc, [
    "Select Tiered by Amount — flat fee per amount range",
    "Click + Add Tier for each row in the partner's fee schedule",
    "For each tier: enter Up to amount ₱ (leave blank for the last/default tier) and Fee (₱)",
])
tip(doc, "Always leave the last tier's amount blank — it becomes the default for everything above the highest threshold.")
example(doc, "Example", "A partner charges PHP 5 for transactions up to PHP 300, PHP 10 for anything above.\n\nTier 1: Amount ≤ 300 → Fee: 5\nTier 2: Amount ≤ (blank — default) → Fee: 10")
heading2(doc, "What it looks like in billing")
billing(doc,
    "PHP 150 transaction → Tier 1 (≤300) → PHP 5.00 fee\n"
    "PHP 500 transaction → Tier 2 (default) → PHP 10.00 fee"
)

# ── TYPE 6 ────────────────────────────────────
heading1(doc, "Fee Type 6: Tiered by Amount + Run Count (AIO-style)")
body(doc, "The fee depends on both the transaction amount AND the total number of transactions in the billing run. Volume discount kicks in when the monthly count crosses a threshold.")
body(doc, "Currently used by: AIO Solutions", italic=True, color=NB_GRAY)
heading2(doc, "How to configure")
numbered(doc, ["Select Tiered by Amount + Run Count (AIO-style)", "Fill in the following fields:"])
add_table(doc,
    ["Field", "Meaning", "Example"],
    [
        ("Amount Threshold (₱)",    "Transactions AT OR BELOW this use the Low Fee",                                  "600"),
        ("Low Fee (₱)",             "Fee for transactions ≤ Amount Threshold",                                        "6"),
        ("Count Threshold (txns)",  "Monthly count where volume discount kicks in",                                    "30000"),
        ("High Fee at Count (₱)",   "Fee for txns > Amount Threshold AND monthly count ≥ Count Threshold",            "8"),
        ("High Fee — Default (₱)",  "Fee for txns > Amount Threshold when count has NOT yet reached threshold",       "10"),
    ],
    col_widths=[4, 8, 2]
)
heading2(doc, "What it looks like in billing")
billing(doc,
    "PHP 400 (any count):        → PHP 6.00   ← below amount threshold\n"
    "PHP 1,500, count = 15,000:  → PHP 10.00  ← above amt, below count threshold\n"
    "PHP 1,500, count = 35,000:  → PHP 8.00   ← above amt, volume discount!"
)

# ── TYPE 7 ────────────────────────────────────
doc.add_page_break()
heading1(doc, "Fee Type 7: Tiered Percentage (Incoming only)")
body(doc, "The percentage rate changes depending on the transaction amount — smaller transactions have a higher rate, larger ones a lower rate. Optional minimum floor per tier.")
tip(doc, "This fee type is available on QRPh and VCA only — NOT on Disburse.", warn=True)
heading2(doc, "When to use")
bullet(doc, [
    "Partner fee schedule has different percentage rates for different amount ranges",
    "Replaces the need for multiple separate % + Floor rules",
])
heading2(doc, "How to configure")
numbered(doc, [
    "Select Tiered Percentage — different % per amount range",
    "Click + Add Tier for each rate in the schedule",
    "For each tier: Up to amount ₱ (blank for last), Rate (%), and optional Min Floor ₱",
])
example(doc, "Example", "≤ PHP 120: 0.90% or PHP 1 whichever is higher\nPHP 121–250: 0.75%\nPHP 251–500: 0.60%\nAbove PHP 500: 0.50%")
add_table(doc,
    ["Tier", "Amount ≤", "Rate %", "Floor"],
    [
        ("1", "120",              "0.9",  "1"),
        ("2", "250",              "0.75", "—"),
        ("3", "500",              "0.60", "—"),
        ("4", "(blank — default)","0.50", "—"),
    ],
    col_widths=[1.5, 4, 3, 3]
)
heading2(doc, "What it looks like in billing")
billing(doc,
    "PHP 100:   max(100 × 0.9%, 1.00) = PHP 1.00\n"
    "PHP 200:   200 × 0.75%           = PHP 1.50\n"
    "PHP 400:   400 × 0.60%           = PHP 2.40\n"
    "PHP 800:   800 × 0.50%           = PHP 4.00"
)

# ── TYPE 8 ────────────────────────────────────
heading1(doc, "Fee Type 8: Tiered by Count (Disburse only)")
body(doc, "All transactions in a billing run are charged at the same flat rate, determined by the total number of transactions in the run. Higher volume = lower rate for ALL transactions.")
tip(doc, "This fee type is available on Disburse only — NOT on QRPh or VCA.", warn=True)
heading2(doc, "When to use")
bullet(doc, [
    "Partner disburse fee is a volume discount: process more, pay less per transaction",
    "The rate applies equally to ALL transactions in the run",
])
heading2(doc, "How to configure")
numbered(doc, [
    "Select Tiered by Count — all txns same rate based on run volume",
    "Click + Add Tier for each count threshold",
    "For each tier: Up to count (blank for last) and Fee per txn (₱)",
])
example(doc, "Example",
    "< 30,000 txns:       PHP 9.50 per txn\n"
    "30,000–99,999:       PHP 9.00 per txn\n"
    "100,000–299,999:     PHP 8.00 per txn\n"
    "300,000–499,999:     PHP 7.00 per txn\n"
    "500,000 and above:   PHP 5.00 per txn"
)
add_table(doc,
    ["Tier", "Count ≤", "Fee/txn (₱)"],
    [
        ("1", "29,999",           "9.50"),
        ("2", "99,999",           "9.00"),
        ("3", "299,999",          "8.00"),
        ("4", "499,999",          "7.00"),
        ("5", "(blank — default)","5.00"),
    ],
    col_widths=[1.5, 5, 3]
)
heading2(doc, "What it looks like in billing")
billing(doc,
    "Monthly run = 487 transactions:\n"
    "  → Rate = PHP 9.50 (count < 30,000)\n"
    "  → Total = 487 × PHP 9.50 = PHP 4,626.50\n\n"
    "Monthly run = 55,000 transactions:\n"
    "  → Rate = PHP 9.00 (count 30,000–99,999)\n"
    "  → Total = 55,000 × PHP 9.00 = PHP 495,000.00"
)

# ── TYPE 9 ────────────────────────────────────
doc.add_page_break()
heading1(doc, "Fee Type 9: Fee Rules")
body(doc, "Lets you define multiple conditions with different fee types per condition. The billing engine checks each rule from top to bottom and uses the first rule that matches.")
heading2(doc, "When to use")
bullet(doc, [
    "Partner has conditions that require different fee types (e.g. one rule is flat, another is percentage)",
    "Partner has many if-else conditions in their contract",
    "None of the simpler fee types fully covers the schedule",
])
heading2(doc, "How to configure")
numbered(doc, [
    "Select Fee Rules — multiple conditions with + button",
    "Click + Add Rule for each condition",
    "For each rule: Amount > ₱ (optional lower bound) and Amount ≤ ₱ (optional upper bound)",
    "Choose the fee type per rule: Zero / Flat / % + Floor / % + Floor + Cap",
    "Always add a default rule last — leave both amount fields blank",
])
tip(doc, "Rules are evaluated top to bottom. The first rule that matches wins. Put specific conditions first and the default (catch-all) last.", warn=True)

heading2(doc, "Example 1 — Small transactions free, large ones billed")
add_table(doc,
    ["Rule", "Condition", "Fee"],
    [
        ("Rule 1", "Amount ≤ PHP 100",  "Zero — no fee"),
        ("Rule 2", "(default)",          "Flat — PHP 5.00"),
    ],
    col_widths=[2, 6, 6]
)
heading2(doc, "Example 2 — Mixed flat and percentage")
add_table(doc,
    ["Rule", "Condition", "Fee"],
    [
        ("Rule 1", "Amount ≤ PHP 500",        "Flat — PHP 3.00"),
        ("Rule 2", "(default — above PHP 500)","% + Floor — 0.8%, floor PHP 3"),
    ],
    col_widths=[2, 6, 6]
)
tip(doc, "To delete a rule, click the ✕ button on the right of the rule block. Rules renumber automatically.")

# ── QUICK DECISION ─────────────────────────────
doc.add_page_break()
heading1(doc, "Quick Decision Guide")
body(doc, "Use this when you're not sure which fee type to pick:")

add_table(doc,
    ["Question", "Fee Type"],
    [
        ("Is the fee always PHP 0?",                                          "Zero"),
        ("Same fixed amount every transaction?",                              "Flat"),
        ("Percentage with a minimum?",                                        "% + Floor"),
        ("Percentage with both a minimum AND maximum?",                       "% + Floor + Cap"),
        ("Different fixed amount per transaction size?",                      "Tiered by Amount"),
        ("Depends on BOTH transaction size AND monthly volume?",              "Tiered by Amount + Run Count"),
        ("Different percentage per amount range? (QRPh/VCA only)",           "Tiered Percentage"),
        ("All transactions same rate set by total monthly count? (Disburse only)", "Tiered by Count"),
        ("None of the above, or mixed fee types per condition?",              "Fee Rules"),
    ],
    col_widths=[10, 4]
)

# ── COMMON MISTAKES ────────────────────────────
heading1(doc, "Common Mistakes to Avoid")
add_table(doc,
    ["❌ Mistake", "✅ What to do instead"],
    [
        ("Entering 0.007 for 0.7%",                      "Enter 0.7 — the portal converts it automatically"),
        ("Forgetting the default tier/rule",              "Always add a final tier/rule with no upper limit (leave amount blank)"),
        ("Putting the default rule first",                "Default must be LAST — rules are checked top to bottom"),
        ("Setting VCA to Zero when partner has no VCA",  "Correct — Zero is the right setting for this"),
        ("Using Tiered Percentage on Disburse",          "Tiered Percentage is Incoming only; use Fee Rules for Disburse"),
        ("Using Tiered by Count on QRPh or VCA",         "Tiered by Count is Disburse only"),
    ],
    col_widths=[7, 7]
)

# ── FEE NOTE ──────────────────────────────────
heading1(doc, "Fee Note Field")
body(doc, "Every fee direction has a Fee Note text box below the configuration. This is a plain-language description that appears in the SUMMARY tab of the billing report — it is NOT used in any calculation.")
add_table(doc,
    ["Fee Type", "Example Fee Note"],
    [
        ("Flat",                        "PHP 10 per transaction"),
        ("% + Floor",                   "0.7% or PHP 1.00 whichever is higher"),
        ("Tiered by Amount + Run Count","PHP 6 (≤₱600); PHP 10 or PHP 8 volume discount (>30k txns)"),
        ("Tiered by Count",             "PHP 9.50 (<30k) / PHP 9.00 (30k-99k) / PHP 8.00 (100k-299k)"),
        ("Fee Rules / Tiered %",        "0.90%/floor₱1 (≤₱120) / 0.75% (₱121-250) / 0.50% (>₱500)"),
    ],
    col_widths=[5, 9]
)

# ── SAVE ──────────────────────────────────────
os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
doc.save(OUT_PATH)
print(f"Saved: {OUT_PATH}")
