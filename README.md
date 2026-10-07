# Mercado Libre Price Tracker — Node.js, Postgres and Claude

![Mercado Libre price tracker](docs/banner.png)

Track prices for any Mercado Libre search, in any country it operates in, and see what each **comparable product**
really costs over time. Claude reads every listing title and groups listings into model, variant and condition, so
the median price for "iPhone 15 Pro 256 GB, refurbished" isn't mixed up with new iPhone 15s or phone cases.

Listings come from the [Mercado Libre Listings Scraper](https://apify.com/piotrv1001/mercado-libre-listings-scraper)
on Apify (no proxies, captchas or browser automation on your side), and the history lives in Postgres in Docker.

![Report with the median price trend and cheapest listing for each iPhone 15 model, storage size and condition](docs/report.png)

## Why group listings first

A search for "iphone 15" in Argentina returns the 15, Plus, Pro and Pro Max, from 128 GB to 1 TB, sold new, open box,
refurbished and used, and one median over all of them would mostly reflect which listings happened to rank that day.
Grouped, the numbers are comparable: on October 7, 2026 a new iPhone 15 128 GB had a median of ARS 1,870,000, while a
refurbished one sat at ARS 1,140,000.

## How it works

```mermaid
flowchart LR
    S[searches.txt] --> I
    subgraph pipeline [npm start]
        I[ingest<br/>Apify Actor] --> DB[(Postgres<br/>price history)]
        DB --> N[normalize<br/>Claude]
        N --> DB
        DB --> R[report]
    end
    R --> H[reports/index.html]
```

| Step | Command | What it does |
| --- | --- | --- |
| Ingest | `npm run ingest` | Runs the Actor once per search in `searches.txt` and stores one snapshot per listing: price, list price, free shipping and rank in the results. |
| Normalize | `npm run normalize` | Sends titles of listings it hasn't seen before to Claude, 25 per request, and stores model, variant, condition and whether the listing is an accessory. Skipped if `ANTHROPIC_API_KEY` isn't set. |
| Report | `npm run report` | Writes `reports/index.html`: per search, every product group with its median price, the change since tracking began, a daily median trend and the cheapest listing today with its distance from the median. |

New and open-box listings more than 35% below their group median are flagged for a manual check: they are more often
mislabeled or bait than real deals. Refurbished and used listings are not flagged, because their condition grades
spread prices widely.

## Quick start

You need [Node.js](https://nodejs.org/) 22 or newer, [Docker](https://docs.docker.com/get-docker/), an
[Apify account](https://console.apify.com/sign-up) and an [Anthropic API key](https://console.anthropic.com/).

```bash
git clone https://github.com/piotrv1001/mercado-libre-price-tracker.git
cd mercado-libre-price-tracker
docker compose up -d          # Postgres 17, schema created on first start
npm install
cp .env.example .env          # add APIFY_TOKEN and ANTHROPIC_API_KEY, pick SITE_ID
npm start                     # ingest → normalize → report
open reports/index.html
```

Put your own searches in `searches.txt`, one per line, written as you would type them on Mercado Libre.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `APIFY_TOKEN` | – | [Apify API token](https://console.apify.com/settings/integrations) |
| `DATABASE_URL` | `postgres://meli:meli@localhost:5432/meli` | Any Postgres 13+ works |
| `SITE_ID` | `MLA` | `MLA` Argentina, `MLB` Brazil, `MLM` Mexico, `MLC` Chile, `MCO` Colombia, `MLU` Uruguay, `MPE` Peru |
| `MAX_ITEMS` | `50` | Listings per search and run, in Mercado Libre's relevance order |
| `CONDITION` | `any` | `new`, `used` or `any` |
| `ANTHROPIC_API_KEY` | – | Required for grouping |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Any Claude model, e.g. `claude-haiku-4-5` for a cheaper run |

## Run it every day

```cron
0 9 * * * cd /path/to/mercado-libre-price-tracker && npm start >> tracker.log 2>&1
```

Already ran the Actor in Apify Console? Import those runs to backfill history:

```bash
npm run ingest -- --query "iphone 15" <datasetId> <datasetId> ...
```

## Query the history

```sql
-- Daily median per product group for one search
SELECT day::date, model, variant, condition, round(median_price) AS median, listings
FROM group_daily
WHERE query = 'iphone 15' AND model = 'iPhone 15 Pro' AND variant = '256 GB'
ORDER BY day;

-- Listings whose latest price was at least 15% under their group's median that day
SELECT title, price, median_price, vs_median_pct, permalink
FROM listing_latest
WHERE vs_median_pct <= -15 AND NOT is_accessory
ORDER BY vs_median_pct;

-- How Claude grouped the listings
SELECT model, variant, condition, count(*) FROM listings GROUP BY 1, 2, 3 ORDER BY 4 DESC;
```

Connect with `docker compose exec db psql -U meli`.

## Cost

Pricing as of October 7, 2026:

- **Apify:** $0.002 per listing, so one search of 50 listings costs $0.10 per run, about $3 a month run daily. See
  [current pricing](https://apify.com/piotrv1001/mercado-libre-listings-scraper/pricing). The Apify free plan includes
  $5 of monthly usage.
- **Claude:** only new listings are sent. In our test, grouping 25 listings cost about $0.04 with the default model,
  so the 194 listings in our example history cost under $0.30 once; a daily run adds a few cents.

Prices are stored in the site's currency. In a high-inflation market like Argentina, expect the medians to drift up
over months regardless of demand.

## Project structure

```
db/schema.sql      tables: listings, snapshots; views: group_daily, listing_latest
src/ingest.js      runs the Actor per search (or imports datasets) and saves snapshots
src/normalize.js   Claude groups new listings by model, variant and condition
src/report.js      HTML report
searches.txt       the searches you track
```

## Related

- [Mercado Libre Listings Scraper](https://apify.com/piotrv1001/mercado-libre-listings-scraper) — the Actor this
  pipeline runs; it can also fetch full product details, filter by price and condition, and scrape category or seller
  pages
- [AliExpress price tracker](https://github.com/piotrv1001/aliexpress-price-tracker) — the same pattern for a product
  watchlist
- [LinkedIn jobs AI matcher](https://github.com/piotrv1001/linkedin-jobs-ai-matcher) and
  [Clutch lead generation pipeline](https://github.com/piotrv1001/clutch-lead-generation-pipeline)
