-- One row per Mercado Libre listing seen in a tracked search.
CREATE TABLE listings (
    item_id      text PRIMARY KEY,           -- MLA3868215358
    site_id      text NOT NULL,              -- MLA = Argentina, MLB = Brazil, MLM = Mexico, ...
    query        text NOT NULL,              -- the search that found it
    title        text NOT NULL,
    permalink    text NOT NULL,
    seller       text,
    thumbnail    text,
    first_seen   timestamptz NOT NULL DEFAULT now(),
    -- Filled by Claude from the title, so like is compared with like.
    model        text,                       -- "iPhone 15 Pro"
    variant      text,                       -- "256 GB"
    condition    text,                       -- new, reconditioned, open_box, used
    is_accessory boolean
);

-- One row per listing per scrape: the price history.
CREATE TABLE snapshots (
    item_id         text NOT NULL REFERENCES listings,
    scraped_at      timestamptz NOT NULL,
    currency        text NOT NULL,
    price           numeric NOT NULL,
    original_price  numeric,
    free_shipping   boolean,
    position        int,                     -- rank in the search results
    PRIMARY KEY (item_id, scraped_at)
);

-- Daily price statistics per comparable product group.
CREATE VIEW group_daily AS
SELECT l.query, l.model, l.variant, l.condition, s.currency,
       date_trunc('day', s.scraped_at) AS day,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY s.price)::numeric AS median_price,
       min(s.price) AS min_price,
       count(DISTINCT s.item_id) AS listings
FROM snapshots s JOIN listings l USING (item_id)
WHERE l.model IS NOT NULL AND NOT l.is_accessory
GROUP BY 1, 2, 3, 4, 5, 6;

-- Each listing's latest price against its group's median on that day.
CREATE VIEW listing_latest AS
WITH latest AS (
    SELECT DISTINCT ON (item_id) * FROM snapshots ORDER BY item_id, scraped_at DESC
)
SELECT l.*, s.scraped_at, s.currency, s.price, s.original_price, s.free_shipping,
       g.median_price,
       round(100 * (s.price - g.median_price) / g.median_price, 1) AS vs_median_pct
FROM latest s
JOIN listings l USING (item_id)
LEFT JOIN group_daily g
  ON g.query = l.query AND g.model = l.model AND g.variant IS NOT DISTINCT FROM l.variant
 AND g.condition = l.condition AND g.currency = s.currency AND g.day = date_trunc('day', s.scraped_at);
