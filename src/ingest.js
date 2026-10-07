// Run every search in searches.txt and store one price snapshot per listing.
//   npm run ingest                                       run the Actor on searches.txt
//   npm run ingest -- --query "iphone 15" <datasetId>...  import earlier runs of one search
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ApifyClient } from 'apify-client';
import { db } from './db.js';

const ACTOR_ID = 'piotrv1001/mercado-libre-listings-scraper';
const { SITE_ID = 'MLA', MAX_ITEMS = '50', CONDITION = 'any' } = process.env;

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

// The Actor doesn't say which search an item came from, so each search gets its own run.
async function scrape(query) {
    console.log(`Searching "${query}" on ${SITE_ID}...`);
    const run = await client.actor(ACTOR_ID).call({
        siteId: SITE_ID,
        searchQueries: [query],
        condition: CONDITION,
        maxItems: Number(MAX_ITEMS),
    }, { log: null });
    console.log(`Run ${run.status}: https://console.apify.com/actors/runs/${run.id}`);
    return run.defaultDatasetId;
}

async function save(query, datasetId) {
    const { items } = await client.dataset(datasetId).listItems();
    let saved = 0;
    for (const [position, item] of items.entries()) {
        if (!item.itemId || !item.price) continue;
        await db.query(
            `INSERT INTO listings (item_id, site_id, query, title, permalink, seller, thumbnail, listed_condition)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (item_id) DO UPDATE
             SET title = EXCLUDED.title, seller = EXCLUDED.seller,
                 listed_condition = coalesce(EXCLUDED.listed_condition, listings.listed_condition)`,
            [item.itemId, item.siteId, query, item.title, item.permalink, item.seller?.nickname, item.thumbnailUrl, item.condition],
        );
        await db.query(
            `INSERT INTO snapshots (item_id, scraped_at, currency, price, original_price, free_shipping, position)
             VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
            [item.itemId, item.scrapedAt, item.currency, item.price, item.originalPrice, item.freeShipping, position + 1],
        );
        saved++;
    }
    console.log(`Saved ${saved} of ${items.length} listings for "${query}" from dataset ${datasetId}`);
}

const { values, positionals } = parseArgs({ options: { query: { type: 'string' } }, allowPositionals: true });

if (positionals.length) {
    if (!values.query) throw new Error('Importing datasets needs --query "<the search they came from>"');
    for (const datasetId of positionals) await save(values.query, datasetId);
} else {
    const queries = (await readFile('searches.txt', 'utf8'))
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
    for (const query of queries) await save(query, await scrape(query));
}

await db.end();
