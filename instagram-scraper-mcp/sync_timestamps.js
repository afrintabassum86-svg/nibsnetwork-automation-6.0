import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.resolve(__dirname, './browser_session');

async function syncTimestamps() {
    console.log("=== Instagram Timestamp Sync (AWS PostgreSQL Edition) ===");

    // Check how many are already good
    const stats = await query("SELECT COUNT(*) as count FROM instagram_posts WHERE timestamp IS NOT NULL");
    const validCount = stats.rows[0].count;

    // Fetch posts where timestamp is missing or recent (likely new scrapes)
    const result = await query(
        `SELECT * FROM instagram_posts 
         WHERE timestamp IS NULL 
         OR timestamp >= NOW() - INTERVAL '7 days'`
    );
    const posts = result.rows;

    if (!posts || posts.length === 0) {
        console.log(`✅ All ${validCount} posts utilize valid timestamps.`);
        console.log("No missing or unstable timestamps found that require browser verification.");
        return;
    }

    console.log(`Found ${posts.length} posts to sync.`);
    console.log("Launching browser...");

    const context = await chromium.launchPersistentContext(SESSION_DIR, {
        headless: true,
        viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();
    let updatedCount = 0;

    for (const post of posts) {
        try {
            console.log(`\nSyncing: ${post.id}`);
            await page.goto(post.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(2000);

            const timestamp = await page.evaluate(() => {
                const timeEl = document.querySelector('time');
                return timeEl ? timeEl.getAttribute('datetime') : null;
            });

            if (timestamp) {
                await query(
                    'UPDATE instagram_posts SET timestamp = $1 WHERE id = $2',
                    [timestamp, post.id]
                );
                updatedCount++;
                console.log(`   ✓ Saved: ${timestamp}`);
            } else {
                console.log(`   ✗ Timestamp not found on page.`);
            }
        } catch (e) {
            console.error(`   ✗ Error:`, e.message);
        }
    }

    console.log(`\n=== DONE! Updated ${updatedCount} timestamps in PostgreSQL. ===`);
    await context.close();
}

syncTimestamps();
