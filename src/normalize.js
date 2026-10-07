// Group listings into comparable products: Claude reads each new title and returns model, variant and condition.
// A search like "iphone 15" mixes the 15, Plus, Pro and Pro Max, several storage sizes, refurbished units and
// cases; a median over all of them means nothing.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { db } from './db.js';

const BATCH = 25;

if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY is not set, skipping normalization.');
    process.exit(0);
}

const Normalized = z.object({
    listings: z.array(z.object({
        itemId: z.string(),
        model: z.string().describe('Product model without storage, color or condition, e.g. "iPhone 15 Pro"'),
        variant: z.string().nullable().describe('The spec that changes the price most, e.g. "256 GB"; null if none'),
        condition: z.enum(['new', 'open_box', 'reconditioned', 'used']),
        isAccessory: z.boolean().describe('A case, cable, charger or other add-on rather than the product searched for'),
    })),
});

const client = new Anthropic();
const system = `You normalize Mercado Libre listing titles (Spanish or Portuguese) so that listings of the same product
can be compared. Use the same spelling for the same model every time. Use the listed condition when it is given;
otherwise infer it from the title ("Reacondicionado" = reconditioned, "caja abierta" = open_box, "Usado" = used).
Return one entry per listing, with its itemId unchanged.`;

const { rows } = await db.query('SELECT item_id, query, title, listed_condition FROM listings WHERE model IS NULL ORDER BY item_id');
console.log(`Normalizing ${rows.length} listings...`);

for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const response = await client.messages.parse({
        model: process.env.CLAUDE_MODEL ?? 'claude-opus-5-5',
        max_tokens: 16000,
        output_config: { effort: 'low', format: zodOutputFormat(Normalized) },
        system,
        messages: [{
            role: 'user',
            content: JSON.stringify(batch.map((r) => ({
                itemId: r.item_id, search: r.query, title: r.title, listedCondition: r.listed_condition,
            }))),
        }],
    });
    if (!response.parsed_output) {
        console.error(`Batch ${i / BATCH + 1}: no result (stop reason "${response.stop_reason}")`);
        continue;
    }
    const ids = new Set(batch.map((r) => r.item_id));
    for (const l of response.parsed_output.listings) {
        if (!ids.has(l.itemId)) continue;
        await db.query(
            'UPDATE listings SET model = $2, variant = $3, condition = $4, is_accessory = $5 WHERE item_id = $1',
            [l.itemId, l.model, l.variant, l.condition, l.isAccessory],
        );
    }
    console.log(`  ${Math.min(i + BATCH, rows.length)} / ${rows.length}`);
}

await db.end();
