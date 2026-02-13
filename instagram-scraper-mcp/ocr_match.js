import Tesseract from 'tesseract.js';
import pool from '../lib/db.js';

async function runAutoMap() {
    console.log("=== Auto Map (PostgreSQL Edition) ===\n");

    try {
        console.log("Loading data from database...");

        // 1. Get Articles
        const articlesRes = await pool.query('SELECT * FROM blog_articles');
        const articles = articlesRes.rows;
        console.log(`Loaded ${articles.length} articles.`);

        // 2. Get Unmapped Posts
        const postsRes = await pool.query('SELECT * FROM instagram_posts WHERE blog_url IS NULL');
        const posts = postsRes.rows;
        console.log(`Analyzing ${posts.length} unmapped posts for matches...\n`);

        if (posts.length === 0) {
            console.log("No unmapped posts found.");
            return;
        }

        const stopWords = new Set(['the', 'and', 'with', 'for', 'from', 'best', 'top', 'how']);

        for (const post of posts) {
            console.log(`\nProcessing Post ID: ${post.id}`);
            let bestMatch = null;
            let matchType = '';

            // --- Strategy 1: Title/Caption Matching (Fast) ---
            const postText = (post.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, '');

            for (const article of articles) {
                const articleTitle = article.title.toLowerCase().replace(/[^a-z0-9 ]/g, '');
                // Basic contains check (Title must be reasonably unique, e.g. > 10 chars)
                if (articleTitle.length > 10 && postText.includes(articleTitle)) {
                    bestMatch = article;
                    matchType = 'Title Match';
                    break;
                }
            }

            // --- Strategy 2: OCR Matching (Fallback) ---
            if (!bestMatch && post.image && post.image.startsWith('http')) {
                try {
                    process.stdout.write('  Running OCR... ');
                    const { data: { text } } = await Tesseract.recognize(post.image, 'eng');
                    console.log(`Done.`);

                    // Tokenize OCR text
                    const ocrTokens = text.toLowerCase()
                        .replace(/[^a-z0-9\s]/g, '')
                        .split(/\s+/)
                        .filter(w => w.length > 3 && !stopWords.has(w));

                    console.log(`  OCR Words: [${ocrTokens.slice(0, 5).join(', ')}...]`);

                    let maxScore = 0;

                    for (const article of articles) {
                        const articleTokens = article.title.toLowerCase()
                            .replace(/[^a-z0-9\s]/g, '')
                            .split(/\s+/)
                            .filter(w => w.length > 3 && !stopWords.has(w));

                        if (articleTokens.length === 0) continue;

                        // Count matching words
                        const matches = ocrTokens.filter(w => articleTokens.includes(w));
                        const score = matches.length;

                        // Threshold: At least 2 significant words match OR >50% of article title words match
                        if (score > maxScore && (score >= 2 || score / articleTokens.length > 0.5)) {
                            maxScore = score;
                            bestMatch = article;
                            matchType = `OCR Fuzzy Match (${score} words)`;
                        }
                    }
                } catch (e) {
                    console.log('  OCR Failed:', e.message);
                }
            }

            // --- Save Match ---
            if (bestMatch) {
                console.log(`  ✅ ${matchType}: Linked to "${bestMatch.title}"`);
                await pool.query(
                    'UPDATE instagram_posts SET blog_url = $1 WHERE id = $2',
                    [bestMatch.url, post.id]
                );
            } else {
                console.log('  - No match found.');
            }
        }

        console.log("\n=== Auto Map Complete ===");

    } catch (e) {
        console.error("Auto Map Critical Error:", e);
        console.error(e.stack);
    } finally {
        pool.end();
    }
}

runAutoMap();
