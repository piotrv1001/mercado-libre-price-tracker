// Write reports/index.html: per search, every comparable product group with its median price trend
// and the cheapest listing today.
import { mkdir, writeFile } from 'node:fs/promises';
import { db } from './db.js';

// A new or open-box unit this far under its group median is more often mislabeled or bait than a deal.
// Refurbished and used units are left out: their condition grades (excellent, good, fair) spread prices widely.
const CHECK_BELOW_PCT = -35;
const CHECKED_CONDITIONS = ['new', 'open_box'];
// Groups with fewer listings today are counted but not shown: their median is a single price.
const MIN_LISTINGS = 2;

const { rows: groups } = await db.query(
    `WITH d AS (SELECT * FROM group_daily),
     last AS (SELECT query, max(day) AS day FROM d GROUP BY query)
     SELECT d.query, d.model, d.variant, d.condition, d.currency, d.median_price, d.listings,
            (SELECT median_price FROM d f WHERE f.query = d.query AND f.model = d.model
               AND f.variant IS NOT DISTINCT FROM d.variant AND f.condition = d.condition
             ORDER BY f.day LIMIT 1) AS first_median,
            (SELECT array_agg(median_price::float ORDER BY day) FROM d h WHERE h.query = d.query AND h.model = d.model
               AND h.variant IS NOT DISTINCT FROM d.variant AND h.condition = d.condition) AS history,
            d.day
     FROM d JOIN last USING (query, day)
     ORDER BY d.query, d.listings DESC, d.model, d.variant`,
);
const { rows: cheapest } = await db.query(
    `SELECT DISTINCT ON (query, model, variant, condition) *
     FROM listing_latest
     WHERE NOT is_accessory AND median_price IS NOT NULL
       AND date_trunc('day', scraped_at) = (SELECT max(date_trunc('day', scraped_at)) FROM snapshots)
     ORDER BY query, model, variant, condition, price`,
);
await db.end();

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (n, currency) => new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
const CONDITIONS = { new: 'New', open_box: 'Open box', reconditioned: 'Refurbished', used: 'Used' };

function sparkline(values, w = 120, h = 32) {
    if (!values || values.length < 2) return '<span class="muted">collecting history</span>';
    const min = Math.min(...values);
    const range = Math.max(...values) - min || 1;
    const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 3 - ((v - min) / range) * (h - 6)}`).join(' ');
    return `<svg width="${w}" height="${h}"><polyline points="${pts}" fill="none" stroke="#6366f1" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}

function change(now, first) {
    if (!first || Number(first) === Number(now)) return '<span class="badge">no change</span>';
    const pct = ((now - first) / first) * 100;
    return `<span class="badge ${pct < 0 ? 'down' : 'up'}">${pct < 0 ? '▼' : '▲'} ${Math.abs(pct).toFixed(1)}%</span>`;
}

const sections = [...new Set(groups.map((g) => g.query))].map((query) => {
    const all = groups.filter((g) => g.query === query);
    const shown = all.filter((g) => g.listings >= MIN_LISTINGS);
    const rows = shown.map((g) => {
        const c = cheapest.find((x) => x.query === query && x.model === g.model && x.variant === g.variant && x.condition === g.condition);
        const pct = c ? Number(c.vs_median_pct) : null;
        const check = pct <= CHECK_BELOW_PCT && CHECKED_CONDITIONS.includes(g.condition);
        return `<tr>
            <td><strong>${esc(g.model)}</strong> ${esc(g.variant ?? '')}<div class="muted">${CONDITIONS[g.condition]} · ${g.listings} listings today</div></td>
            <td class="num"><strong>${money(g.median_price, g.currency)}</strong><br>${change(g.median_price, g.first_median)}</td>
            <td>${sparkline(g.history)}</td>
            <td>${c ? `<a href="${esc(c.permalink)}">${money(c.price, c.currency)}</a>
                <span class="badge ${check ? 'check' : pct < 0 ? 'down' : ''}">${pct > 0 ? '+' : ''}${pct}% vs median</span>
                ${check ? '<div class="warn">Far below similar listings: check the listing before trusting it</div>' : ''}
                ${c.seller ? `<div class="muted">${esc(c.seller)}</div>` : ''}` : '–'}</td>
        </tr>`;
    }).join('\n');
    const hidden = all.length - shown.length;
    return `<h2>“${esc(query)}” <span class="muted">prices in ${esc(all[0].currency)}</span></h2>
    <table><thead><tr><th>Product group</th><th>Median price</th><th>Daily median</th><th>Cheapest today</th></tr></thead>
    <tbody>${rows}</tbody></table>
    ${hidden ? `<p class="muted">${hidden} more groups had a single listing today.</p>` : ''}`;
}).join('\n');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mercado Libre price tracker</title>
<style>
    body { font: 14px/1.45 system-ui, -apple-system, sans-serif; color: #111827; background: #f8fafc; margin: 0; padding: 32px; }
    main { max-width: 1100px; margin: auto; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    h2 { font-size: 16px; margin: 28px 0 10px; }
    a { color: inherit; font-weight: 600; }
    .muted { color: #6b7280; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px #0000001a; }
    th { text-align: left; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; padding: 12px 14px; background: #f9fafb; }
    td { padding: 12px 14px; border-top: 1px solid #f1f5f9; vertical-align: top; }
    .num { white-space: nowrap; }
    .badge { display: inline-block; margin-top: 4px; font-size: 12px; padding: 1px 8px; border-radius: 999px; background: #f1f5f9; color: #475569; }
    .badge.down { background: #dcfce7; color: #15803d; }
    .badge.up { background: #fee2e2; color: #b91c1c; }
    .badge.check { background: #fef3c7; color: #92400e; }
    .warn { font-size: 12px; color: #92400e; margin-top: 4px; }
</style></head>
<body><main>
    <h1>Mercado Libre price tracker</h1>
    <div class="muted">Listings grouped by Claude into model, storage and condition · median change since the first day tracked · updated ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</div>
    ${sections}
</main></body></html>`;

await mkdir('reports', { recursive: true });
await writeFile('reports/index.html', html);
console.log(`Wrote reports/index.html (${groups.length} product groups)`);
