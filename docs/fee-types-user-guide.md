# Billing Console — Fee Types User Guide

**For:** Admin Portal Users (New and Existing)
**Purpose:** Learn how to configure partner fees correctly for each billing scenario
*Last updated: September 2026*

---

## Before You Start

Every partner in the billing console has **three fee directions**:

| Direction | What it covers |
|---|---|
| **QRPh Fee** | Incoming QR P2M transactions (customer pays via QR code) |
| **VCA Fee** | Incoming P2P / QR_P2P transactions (VCA transfers) |
| **Disburse Fee** | Outgoing transactions (partner pays out to customers) |

Each direction has its own fee setting. You can mix and match fee types — for example, QRPh can use a percentage fee while Disburse uses a flat fee.

---

## Overview: All Fee Types at a Glance

| Fee Type | Best for | Available on |
|---|---|---|
| Zero | No charge for this direction | QRPh, VCA, Disburse |
| Flat | Same fixed amount every transaction | QRPh, VCA, Disburse |
| % + Floor | Percentage, but never less than a minimum | QRPh, VCA |
| % + Floor + Cap | Percentage, with both a minimum and maximum | QRPh, VCA |
| Tiered by Amount | Different flat fee depending on transaction size | QRPh, VCA, Disburse |
| Tiered by Amount + Run Count | Amount AND monthly volume both affect the rate | QRPh, VCA |
| Tiered Percentage | Different percentage rate per amount range | QRPh, VCA |
| Tiered by Count | All transactions same rate based on total monthly volume | Disburse |
| Fee Rules | Mix of different conditions and fee types | QRPh, VCA, Disburse |

---

## Fee Type 1: Zero

### What it does
Charges **no fee** for this direction. Use this when a partner is not billed for a specific transaction type.

### When to use
- Partner has no VCA transactions
- Billing was waived for a direction during negotiation
- Direction is not applicable to this partner

### How to configure
1. Select **Zero — No fee** from the Fee Type dropdown
2. No additional fields needed
3. Click Save

### Example
> VLPay has no VCA billing. Set VCA Fee → **Zero**.

---

## Fee Type 2: Flat

### What it does
Charges the **same fixed PHP amount** for every transaction, regardless of transaction size.

### When to use
- Partner has a simple per-transaction fee
- Transaction amount does not affect the fee

### How to configure
1. Select **Flat — Fixed ₱X per transaction**
2. Enter the **Fee Amount (₱)** — e.g., `8` for PHP 8 per transaction

### Example
> MaxJoy charges PHP 10 per QRPh transaction.
>
> Set QRPh Fee → **Flat** → Fee Amount: `10`

### What it looks like in billing
```
100 transactions × PHP 10.00 = PHP 1,000.00 total fee
```

---

## Fee Type 3: % + Floor

### What it does
Charges a **percentage of the transaction amount**, but never less than a minimum (floor) amount.

**Formula:** `fee = max(amount × rate%, floor)`

### When to use
- Fee is percentage-based
- Small transactions need a minimum charge (so the fee isn't too small to be worth billing)

### How to configure
1. Select **% + Floor — max(amt × rate, floor)**
2. Enter **Rate (%)** — e.g., `0.7` for 0.7%
3. Enter **Floor (₱)** — the minimum fee per transaction, e.g., `1`

> 💡 Enter the rate as a percentage number. For 0.7%, type `0.7` — not `0.007`.

### Example
> Magic Payment charges 0.7% for QRPh, minimum PHP 1.
>
> Set QRPh Fee → **% + Floor** → Rate: `0.7` → Floor: `1`

### What it looks like in billing
```
PHP 50 transaction:    max(50 × 0.7%, 1.00) = max(0.35, 1.00) = PHP 1.00
PHP 500 transaction:   max(500 × 0.7%, 1.00) = max(3.50, 1.00) = PHP 3.50
PHP 2,000 transaction: max(2000 × 0.7%, 1.00) = max(14.00, 1.00) = PHP 14.00
```

---

## Fee Type 4: % + Floor + Cap

### What it does
Same as % + Floor, but also adds a **maximum cap** — the fee can never exceed a certain amount.

**Formula:** `fee = min(max(amount × rate%, floor), cap)`

### When to use
- Partner fee has a ceiling for large transactions
- Protects partners from very high fees on large transfers

### How to configure
1. Select **% + Floor + Cap**
2. Enter **Rate (%)**, **Floor (₱)**, and **Cap (₱)**

### Example
> HoPay charges 0.5% for QRPh, minimum PHP 1, maximum PHP 5.
>
> Set QRPh Fee → **% + Floor + Cap** → Rate: `0.5` → Floor: `1` → Cap: `5`

### What it looks like in billing
```
PHP 100 transaction:   min(max(100 × 0.5%, 1), 5) = min(max(0.50, 1), 5) = PHP 1.00  ← floor applied
PHP 500 transaction:   min(max(500 × 0.5%, 1), 5) = min(max(2.50, 1), 5) = PHP 2.50
PHP 2,000 transaction: min(max(2000 × 0.5%, 1), 5) = min(max(10, 1), 5) = PHP 5.00   ← cap applied
```

---

## Fee Type 5: Tiered by Amount

### What it does
Charges a **flat fee that depends on the transaction amount**. Larger transactions get a different fee than smaller ones.

### When to use
- Partner fee schedule has a table of amount ranges, each with a different flat fee
- Example: "PHP 5 for amounts up to PHP 500; PHP 8 for amounts above PHP 500"

### How to configure
1. Select **Tiered by Amount — flat fee per amount range**
2. Click **+ Add Tier** for each row in the partner's fee schedule
3. For each tier:
   - **If amount ≤ (₱)** — the upper limit of this tier. Leave blank for the last/default tier.
   - **Fee (₱)** — the flat fee for transactions in this tier

> Always leave the last tier's amount blank — it becomes the default for everything above the highest threshold.

### Example
> A partner charges PHP 5 for transactions up to PHP 300, and PHP 10 for anything above.
>
> **Tier 1:** Amount ≤ `300` → Fee: `5`
> **Tier 2:** Amount ≤ *(blank — default)* → Fee: `10`

### What it looks like in billing
```
PHP 150 transaction → Tier 1 (≤300) → PHP 5.00 fee
PHP 500 transaction → Tier 2 (default) → PHP 10.00 fee
```

---

## Fee Type 6: Tiered by Amount + Run Count *(AIO-style)*

### What it does
The fee depends on **both the transaction amount AND the total number of transactions** in the billing run. Used when a partner offers a volume discount — process enough transactions in a month and the rate drops.

### When to use
- Partner fee contract has two variables: transaction size AND monthly volume
- Currently used by: **AIO Solutions**

### How to configure
1. Select **Tiered by Amount + Run Count (AIO-style)**
2. Fill in the fields:

| Field | Meaning | Example |
|---|---|---|
| Amount Threshold (₱) | Transactions AT OR BELOW this amount use the Low Fee | `600` |
| Low Fee (₱) | Fee for transactions ≤ Amount Threshold | `6` |
| Count Threshold (txns) | When total monthly count reaches this number, volume discount kicks in | `30000` |
| High Fee at Count (₱) | Fee for transactions > Amount Threshold AND monthly count ≥ Count Threshold | `8` |
| High Fee — Default (₱) | Fee for transactions > Amount Threshold when count has NOT yet reached threshold | `10` |

### Example (AIO Solutions)

> **Contract:** PHP 6 per transaction for amounts ≤ PHP 600. For amounts > PHP 600: PHP 10 per transaction normally, but drops to PHP 8 when the monthly total exceeds 30,000 transactions.
>
> Settings: Amount Threshold: `600` | Low Fee: `6` | Count Threshold: `30000` | High Fee at Count: `8` | High Fee Default: `10`

### What it looks like in billing
```
Transaction PHP 400 (any count):   → PHP 6.00   ← below amount threshold
Transaction PHP 1,500, count = 15,000: → PHP 10.00  ← above amt, below count threshold
Transaction PHP 1,500, count = 35,000: → PHP 8.00   ← above amt, volume discount!
```

---

## Fee Type 7: Tiered Percentage *(Incoming only)*

### What it does
The **percentage rate changes** depending on the transaction amount — smaller transactions have a higher rate, larger ones have a lower rate. Optional minimum floor per tier.

> ⚠️ This fee type is available on **QRPh and VCA only** — not on Disburse.

### When to use
- Partner fee schedule has different percentage rates for different amount ranges
- Replaces the need for multiple separate % + Floor rules

### How to configure
1. Select **Tiered Percentage — different % per amount range**
2. Click **+ Add Tier** for each rate in the schedule
3. For each tier:
   - **If amount ≤ (₱)** — upper limit of this tier (leave blank for the last tier)
   - **Rate (%)** — the percentage for this range (enter as `0.9` for 0.9%)
   - **Min Floor ₱ (optional)** — minimum fee for this tier

### Example

> Partner charges:
> - ≤ PHP 120: 0.90% or PHP 1 whichever is higher
> - PHP 121–250: 0.75%
> - PHP 251–500: 0.60%
> - Above PHP 500: 0.50%

| Tier | Amount ≤ | Rate | Floor |
|---|---|---|---|
| 1 | 120 | 0.9 | 1 |
| 2 | 250 | 0.75 | *(blank)* |
| 3 | 500 | 0.60 | *(blank)* |
| 4 | *(blank — default)* | 0.50 | *(blank)* |

### What it looks like in billing
```
PHP 100 transaction: max(100 × 0.9%, 1.00) = max(0.90, 1.00) = PHP 1.00
PHP 200 transaction: 200 × 0.75% = PHP 1.50
PHP 400 transaction: 400 × 0.60% = PHP 2.40
PHP 800 transaction: 800 × 0.50% = PHP 4.00
```

---

## Fee Type 8: Tiered by Count *(Disburse only)*

### What it does
All transactions in a billing run are charged at the **same flat rate**, and that rate is determined by the **total number of transactions** in the run. Higher volume = lower rate for all transactions.

> ⚠️ This fee type is available on **Disburse only** — not on QRPh or VCA.

### When to use
- Partner disburse fee is a volume discount: process more, pay less per transaction
- The rate applies equally to ALL transactions in the run, not per transaction individually

### How to configure
1. Select **Tiered by Count — all txns same rate based on run volume**
2. Click **+ Add Tier** for each count threshold in the schedule
3. For each tier:
   - **If count ≤** — the maximum number of transactions for this tier (leave blank for the last tier)
   - **Fee per txn (₱)** — the flat fee per transaction at this volume

### Example

> Partner charges:
> - Fewer than 30,000 transactions: PHP 9.50 per txn
> - 30,000–99,999: PHP 9.00 per txn
> - 100,000–299,999: PHP 8.00 per txn
> - 300,000–499,999: PHP 7.00 per txn
> - 500,000 and above: PHP 5.00 per txn

| Tier | Count ≤ | Fee/txn |
|---|---|---|
| 1 | 29999 | 9.50 |
| 2 | 99999 | 9.00 |
| 3 | 299999 | 8.00 |
| 4 | 499999 | 7.00 |
| 5 | *(blank — default)* | 5.00 |

### What it looks like in billing
```
Monthly run = 487 transactions:
  → Rate = PHP 9.50 (count < 30,000)
  → Total fee = 487 × PHP 9.50 = PHP 4,626.50

Monthly run = 55,000 transactions:
  → Rate = PHP 9.00 (count 30,000–99,999)
  → Total fee = 55,000 × PHP 9.00 = PHP 495,000.00
```

---

## Fee Type 9: Fee Rules

### What it does
Lets you define **multiple conditions** with **different fee types** per condition. The billing engine checks each rule from top to bottom and uses the first one that matches.

Use this when none of the simpler fee types can capture the partner's full billing schedule.

### When to use
- Partner has conditions that require different fee **types** (e.g., one rule is flat, another is percentage)
- Partner has many if-else conditions in their contract
- You need a catch-all rule plus one or more special cases

### How to configure
1. Select **Fee Rules — multiple conditions with + button**
2. Click **+ Add Rule** for each condition
3. For each rule:
   - **Amount > ₱ (optional)** — lower bound (exclusive). Leave blank for no lower limit.
   - **Amount ≤ ₱ (optional)** — upper bound (inclusive). Leave blank to make this the default rule.
   - **Fee for this condition** — choose fee type (Zero / Flat / % + Floor / % + Floor + Cap) and fill in the fields
4. Always add a **default rule last** — leave both amount fields blank

> ⚠️ Rules are evaluated **top to bottom**. The **first rule that matches wins**. Put specific conditions first and the default last.

### Example 1 — Small transactions free, large ones billed

| Rule | Condition | Fee |
|---|---|---|
| Rule 1 | Amount ≤ PHP 100 | Zero — no fee |
| Rule 2 | *(default)* | Flat — PHP 5.00 |

### Example 2 — Mixed flat and percentage

| Rule | Condition | Fee |
|---|---|---|
| Rule 1 | Amount ≤ PHP 500 | Flat — PHP 3.00 |
| Rule 2 | *(default — above PHP 500)* | % + Floor — 0.8%, floor PHP 3 |

### Deleting a rule
Click the **✕** button on the right of the rule block. Rules renumber automatically.

---

## Quick Decision Guide

Use this when you're not sure which fee type to pick:

```
Is the fee always PHP 0?
  → Zero

Is the fee the same fixed amount regardless of transaction size?
  → Flat

Is the fee a percentage, with a minimum?
  → % + Floor

Is the fee a percentage, with both a minimum and maximum?
  → % + Floor + Cap

Is the fee a different fixed amount depending on how large the transaction is?
  → Tiered by Amount

Does the fee depend on BOTH transaction size AND total monthly volume?
  → Tiered by Amount + Run Count

Is the fee a different percentage depending on transaction size? (QRPh/VCA only)
  → Tiered Percentage

Do ALL transactions get the same rate, set by total monthly count? (Disburse only)
  → Tiered by Count

Does none of the above fit, or are there mixed fee types per condition?
  → Fee Rules
```

---

## Common Mistakes to Avoid

| Mistake | What to do instead |
|---|---|
| Entering `0.007` for 0.7% | Enter `0.7` — the portal converts it automatically |
| Forgetting the default tier/rule | Always add a final tier/rule with no upper limit (leave amount blank) |
| Putting the default rule first | Default must be LAST — rules are checked top to bottom |
| Setting VCA Fee to Zero when partner has no VCA | Correct — Zero is the right setting for this |
| Using Tiered Percentage on Disburse | Tiered Percentage is Incoming only; use Fee Rules or Tiered by Amount for Disburse |
| Using Tiered by Count on QRPh or VCA | Tiered by Count is Disburse only |

---

## Fee Note Field

Every fee direction has a **Fee Note** text box below the fee configuration. This is a plain-language description that appears in the **SUMMARY tab** of the billing report — it is NOT used in any calculation.

**Best practice:** Write a short human-readable summary of the fee.

| Fee Type | Example Fee Note |
|---|---|
| Flat | `PHP 10 per transaction` |
| % + Floor | `0.7% or PHP 1.00 whichever is higher` |
| Tiered by Amount + Run Count | `PHP 6 (≤PHP 600); PHP 10 or PHP 8 volume discount (>30k txns)` |
| Tiered by Count | `PHP 9.50 (<30k) / PHP 9.00 (30k-99k) / PHP 8.00 (100k-299k)` |
| Fee Rules | `0.90%/floor₱1 (≤₱120) / 0.75% (₱121-250) / 0.60% (₱251-500) / 0.50% (>₱500)` |
