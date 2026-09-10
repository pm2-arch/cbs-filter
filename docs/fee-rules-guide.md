# Fee Rules — Admin Portal Guide

**Billing Console | Netbank AI Project**
*Last updated: September 2026*

---

## What is Fee Rules?

**Fee Rules** is a flexible fee configuration mode in the Partner Admin portal. Instead of a single fixed fee formula (e.g., "always 0.7% with PHP 1 floor"), it lets you define **multiple conditions** — each with its own fee — stacked in a list. The billing engine evaluates each rule from top to bottom and uses the **first rule whose condition matches** the transaction.

Use it when a partner has different fees depending on transaction characteristics (e.g., amount range, thresholds).

---

## When to Use Fee Rules vs. Other Fee Types

| Situation | Recommended Fee Type |
|---|---|
| One flat amount for all transactions | **Flat** |
| One percentage with a minimum | **% + Floor** |
| Multiple amount tiers, all same fee type (e.g., all percentages) | **Tiered Percentage** |
| Multiple amount tiers with a uniform flat fee per tier | **Tiered by Amount** |
| Volume discount — all transactions get same rate based on run count | **Tiered by Count** |
| **Different fee types per condition** (e.g., Rule 1 = flat, Rule 2 = %, Rule 3 = zero) | **→ Fee Rules** |
| **Many if-else conditions** for a single partner | **→ Fee Rules** |

---

## Step-by-Step: Configuring Fee Rules

### 1. Open the Partner

Go to the **Partner Admin** portal → find the partner → click **Edit**.

### 2. Go to the Fee Rules Tab

Click the **Fee Rules** tab in the modal.

### 3. Select "Fee Rules" from the Dropdown

Under **QRPh Fee**, **VCA Fee**, or **Disburse Fee**, open the **Fee Type** dropdown and select:

> **Fee Rules — multiple conditions with + button**

A blue **+ Add Rule** button will appear.

### 4. Add Your First Rule

Click **+ Add Rule**. A rule block appears with two sections:

**Condition** — defines which transactions this rule applies to:
- **Amount > ₱** — optional lower bound (exclusive). Leave blank if no lower limit.
- **Amount ≤ ₱** — optional upper bound (inclusive). Leave blank to make this the default/catch-all.

**Fee for this condition** — how much to charge when the condition matches:
- **Zero** — no fee
- **Flat** — fixed PHP amount per transaction
- **% + Floor** — percentage of transaction amount, with a minimum floor
- **% + Floor + Cap** — percentage with both a minimum and maximum

### 5. Add More Rules

Click **+ Add Rule** again to add the next condition. Repeat for each condition.

### 6. Add a Default Rule (Required)

Always add a **final rule with no condition** (leave both Amount fields blank). This is the catch-all — it applies to any transaction that didn't match the rules above it.

### 7. Save

Click **Save Partner**. The rules are stored in Firestore and take effect immediately on the next billing run.

---

## How Rules Are Evaluated

The billing engine checks each rule **from top to bottom**:

```
Transaction amount = PHP 180

Rule 1: Amount ≤ 120  →  SKIP (180 > 120)
Rule 2: Amount > 120, Amount ≤ 250  →  MATCH ✓  →  Apply this fee, stop.
Rule 3: (default)  →  not reached
```

**Only the first matching rule is applied.** Rules below it are ignored.

> ⚠️ **Rule order matters.** Put the most specific conditions first and the catch-all last.

---

## Example 1 — Magic Payment Style (Tiered Percentage by Amount)

This is the classic scenario: different percentage rates depending on the transaction amount.

| Rule | Condition | Fee |
|---|---|---|
| Rule 1 | Amount ≤ PHP 120 | % + Floor: 0.90%, floor PHP 1.00 |
| Rule 2 | Amount > 120, ≤ PHP 250 | % + Floor: 0.75%, floor PHP 0 |
| Rule 3 | Amount > 250, ≤ PHP 500 | % + Floor: 0.60%, floor PHP 0 |
| Rule 4 | *(no condition — default)* | % + Floor: 0.50%, floor PHP 0 |

**In the admin portal:**

```
[+ Add Rule]

Rule 1
  Condition: Amount > ₱ [        ]   Amount ≤ ₱ [ 120    ]
  Fee: [% + Floor ▾]  Rate: [0.9]%   Floor: [1]

Rule 2
  Condition: Amount > ₱ [ 120    ]   Amount ≤ ₱ [ 250    ]
  Fee: [% + Floor ▾]  Rate: [0.75]%  Floor: [0]

Rule 3
  Condition: Amount > ₱ [ 250    ]   Amount ≤ ₱ [ 500    ]
  Fee: [% + Floor ▾]  Rate: [0.6]%   Floor: [0]

Rule 4  ← default catch-all
  Condition: Amount > ₱ [        ]   Amount ≤ ₱ [        ]
  Fee: [% + Floor ▾]  Rate: [0.5]%   Floor: [0]
```

---

## Example 2 — Mixed Fee Types (Small = Flat, Large = Percentage)

Some partners charge a flat fee for small transactions and a percentage for larger ones.

| Rule | Condition | Fee |
|---|---|---|
| Rule 1 | Amount ≤ PHP 200 | Flat: PHP 5.00 |
| Rule 2 | *(default)* | % + Floor: 0.80%, floor PHP 5.00 |

```
Rule 1
  Condition: Amount > ₱ [        ]   Amount ≤ ₱ [ 200    ]
  Fee: [Flat ▾]  PHP [ 5.00 ]

Rule 2  ← default
  Condition: Amount > ₱ [        ]   Amount ≤ ₱ [        ]
  Fee: [% + Floor ▾]  Rate: [0.8]%   Floor: [5]
```

---

## Example 3 — Partial Exemption (Zero Fee Below a Threshold)

Some partners have a fee waiver for low-value transactions.

| Rule | Condition | Fee |
|---|---|---|
| Rule 1 | Amount ≤ PHP 50 | Zero — no fee |
| Rule 2 | *(default)* | Flat: PHP 8.00 |

---

## Tips and Notes

### Percentages are entered as-is
Enter `0.9` for 0.9% — not `0.009`. The portal converts it automatically before saving.

### Deleting a rule
Click the **✕** button on the right side of the rule block. The remaining rules renumber automatically.

### Fee Note field
After selecting Fee Rules, fill in the **Fee Note** field (below the rules list) with a plain-language description. This appears in the SUMMARY sheet of the billing report.

Example: *"0.90% or PHP 1 floor (≤PHP 120) / 0.75% (PHP 121–250) / 0.60% (PHP 251–500) / 0.50% (>PHP 500)"*

### Conditions not currently supported
The following conditions **cannot** be configured in the billing console because the data is not present in CBS files:
- Merchant category (PAGCOR, gaming, declared vs. non-declared)
- Bancnet registration status
- Channel or transfer mode (use Detection Rules tab to filter those upstream instead)

### Applies to all directions
Fee Rules can be set independently for **QRPh**, **VCA**, and **Disburse** — each direction can use a different fee type.

---

## Summary Card

| Field | Notes |
|---|---|
| Fee type name | `rules` (stored in Firestore) |
| Available on | QRPh, VCA, Disburse |
| Max rules per direction | No limit |
| Condition types | Amount > ₱ (optional), Amount ≤ ₱ (optional) |
| Fee types per rule | Zero, Flat, % + Floor, % + Floor + Cap |
| Evaluation order | Top to bottom; first match wins |
| Default rule | Add a rule with no condition (blank both fields) — always last |
| Fee Note field | Plain-language summary for SUMMARY sheet |
