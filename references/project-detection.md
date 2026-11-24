# Reading the project (Step 1)

Read as little as you need, and never secrets (`.env`, keys, tokens). Never read `<skill>/library/`.
Look at, in this order: the README, the dependency file (`package.json`, `pubspec.yaml`, `requirements.txt`,
`Gemfile`, ...), the main page or layout file, existing CSS or theme files.

## Type (one of five)
| Signs in the project | `type` |
|---|---|
| One marketing page: hero, features, pricing, call to action; no login | `landing` |
| Several content pages: about, blog, docs, services | `website` |
| Charts, tables, KPIs, admin or analytics screens are the main content | `dashboard` |
| Any other interactive app: login, forms, user data, editing | `web-app` |
| A single standalone `.html` file with no build tool | `html-page` |

Mainly charts or tables wins over `web-app`. If two types fit, choose the one the README describes.
Native mobile or desktop apps (Swift, Kotlin, Flutter without a web build): tell the user that only web is
supported for now and use the closest web type. Electron and Tauri apps are web pages: treat them as `web-app`.
See `platforms.md`.

## Language
- `ar`: Arabic content only, or `lang="ar"` / `dir="rtl"` with no English text for users.
- `en`: English content only.
- `ar+en`: both, or an i18n folder with both (`ar.json` and `en.json`, `locales/ar`, ...).
- Unsure: ask the user one short question.

## Brand colors
Up to 3 colors that already mark the brand: a `--primary`/`--brand` variable, a Tailwind `theme.colors`
entry named primary or brand, a logo color in the theme file. Write each as lowercase `#rrggbb` (convert
`rgb()`, `hsl()`, 3-digit hex). Leave out grays, black, white and plain framework defaults. None found: leave
the list out; never invent one.

## Sectors (1 or 2)
What the project is about, from the README, the page text and the product name. The main one first. The
picker ranks the ready identities by it, so pick what a user of the project would say it is.
| Signs | `sectors` |
|---|---|
| Banking, payments, invoices, accounting, investment | `finance` |
| Clinics, hospitals, pharmacies, fitness, wellbeing | `health` |
| Ministries, municipalities, e-government, public services | `government` |
| Schools, courses, e-learning, universities | `education` |
| Software, SaaS, developer tools, AI, IT | `technology` |
| Online stores, products, carts, retail | `commerce` |
| Restaurants, cafes, recipes, delivery | `food` |
| Museums, heritage, Quran, poetry, Islamic or Arabic culture | `culture` |
| News, magazines, blogs, publishing, podcasts | `media` |
| Agencies, portfolios, design studios, events | `creative` |
| Children, families, games, toys | `kids` |
| Agriculture, environment, organic or natural products | `nature` |
| Travel, hotels, tourism, booking stays | `hospitality` |
| Fashion, perfume, beauty, jewelry | `fashion` |
| Real estate, property, construction | `realestate` |
| Charities, volunteering, community groups | `nonprofit` |
| Law firms, consulting, accounting offices, B2B services | `professional` |

None fits: leave `sectors` out (the picker then keeps its own order).

## Tags (1 to 3)
The wanted feel, only from this list: minimal, corporate, editorial, playful, luxury, glass, brutalist,
neumorphic, retro, material, cupertino, fluent, technical, data-dense, vivid, soft.
Use what the user or the README says first. Otherwise start from the type:

| `type` | Starting tags |
|---|---|
| `landing` | vivid, soft |
| `website` | editorial, minimal |
| `dashboard` | data-dense, technical |
| `web-app` | minimal, corporate |
| `html-page` | minimal |

These are only starting points: the user changes everything in the page.
