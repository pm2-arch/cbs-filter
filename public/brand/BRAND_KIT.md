# Netbank Brand Kit

Internal design assets for Netbank (A Rural Bank), Inc. web apps. Drop this `brand/` folder into any
Cloud Run service and reuse it.

```
brand/
├── netbank-logo-blue.svg     ← logo for light backgrounds
├── netbank-logo-white.svg    ← logo for dark/blue backgrounds
├── netbank-tokens.css        ← design tokens (CSS variables) — link this
├── brand-preview.html        ← visual reference (open in a browser)
└── BRAND_KIT.md              ← this file
```

## Use it
```html
<link rel="stylesheet" href="/brand/netbank-tokens.css">
<!-- Google Fonts (display + body + mono) -->
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600&family=Public+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
```
Then use the tokens: `color: var(--nb-blue)`, `font-family: var(--nb-font-display)`, etc.
Serve the folder statically (e.g. Express: `app.use(express.static("public"))` with `brand/` inside `public/`).

## Colors
| Token | Hex | Use |
|---|---|---|
| `--nb-blue` | `#0440AC` | **Primary brand blue** (from the official logo). Buttons, headings, dark sections. |
| `--nb-blue-deep` | `#06317F` | Navy — depth, dark UI, strong headings. |
| `--nb-blue-pressed` | `#033793` | Button hover / pressed. |
| `--nb-blue-bright` | `#1E4FB0` | Links, interactive accents. |
| `--nb-blue-soft` | `#E7EDF9` | Light tint — active/selected states, highlights. |
| `--nb-teal` | `#15B8C9` | Secondary accent (approximate — see note). Use **sparingly**. |
| `--nb-bg` | `#F7F8FD` | Page background (cool off-white). |
| `--nb-surface` | `#FFFFFF` | Cards / panels. |
| `--nb-border` | `#E1E7F0` | Hairlines, dividers. |
| `--nb-ink` | `#1B2333` | Primary text. |
| `--nb-muted` | `#5C6678` | Secondary text, labels. |
| `--nb-success / warning / danger` | `#1E9E6A / #C9821B / #C23B2E` | App states (each has a `-soft` tint). |

The primary blue and the homepage's dark band are the same royal blue (`#0440AC`/`~#0841AD`),
confirmed from the logo SVG and the netbank.ph homepage.

## Typography
- **Display / headings:** Poppins (geometric, confident) — `var(--nb-font-display)`
- **Body:** Public Sans (clean, neutral, finance-grade) — `var(--nb-font-body)`
- **Figures / IDs / counts:** IBM Plex Mono — `var(--nb-font-mono)` (great for amounts like `₱1,471.04`)

These are a close, freely-available approximation of the site's sans. **If Netbank has an official
brand font, swap the two `--nb-font-*` values** — everything else updates automatically.

## Logo usage
- On light backgrounds → `netbank-logo-blue.svg`. On blue/dark → `netbank-logo-white.svg`.
- Keep clear space ≈ the height of the shield around the logo. Don't recolor, stretch, or add effects.
- Minimum width ~96px for legibility.

## Notes / to verify with the official brand guide
- The **teal accent** (`#15B8C9`) is approximated from the logo's colored shield variant; the supplied
  SVG is the all-blue version. Confirm the exact teal before using it prominently.
- Font names are an approximation; replace with the official typeface if one exists.
