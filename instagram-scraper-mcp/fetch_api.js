import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import https from 'https';
import { uploadToS3 } from '../lib/s3-helper.js';
import pool, { query } from '../lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN ? process.env.INSTAGRAM_ACCESS_TOKEN.trim() : null;
const GRAPH_URL = 'https://graph.facebook.com/v21.0';

async function fetchJson(url) {
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.error) {
            throw new Error(`API Error: ${data.error.message}`);
        }
        return data;
    } catch (e) {
        throw new Error(`Request failed: ${e.message}`);
    }
}

async function getImageBuffer(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode === 200) {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => resolve(Buffer.concat(chunks)));
                res.on('error', reject);
            } else {
                res.resume();
                reject(new Error(`Request Failed With a Status Code: ${res.statusCode}`));
            }
        });
    });
}

async function run() {
    console.log("Starting Graph API Fetch...");

    if (!ACCESS_TOKEN) {
        console.error("Error: INSTAGRAM_ACCESS_TOKEN not found in .env");
        return;
    }

    try {
        let instagramId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ? process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID.trim() : null;

        if (!instagramId) {
            console.log("Fetching connected Instagram ID from Pages...");
            const pagesUrl = `${GRAPH_URL}/me/accounts?fields=name,instagram_business_account{id,username}&access_token=${ACCESS_TOKEN}`;
            const pagesData = await fetchJson(pagesUrl);

            for (const page of pagesData.data || []) {
                if (page.instagram_business_account) {
                    instagramId = page.instagram_business_account.id;
                    const foundUsername = page.instagram_business_account.username;
                    console.log(`Found Instagram ID: ${instagramId} (Username: @${foundUsername})`);
                    if (foundUsername.toLowerCase() === 'nibsnetwork') break;
                }
            }
        }

        if (!instagramId) {
            console.error("Error: INSTAGRAM_BUSINESS_ACCOUNT_ID not found in .env and couldn't find linked account via API.");
            return;
        }

        console.log(`Using Instagram Business ID: ${instagramId}`);

        console.log("Fetching Media...");
        const mediaUrl = `${GRAPH_URL}/${instagramId}/media?fields=id,caption,media_type,media_url,permalink,thumbnail_url,timestamp&limit=50&access_token=${ACCESS_TOKEN}`;
        const mediaData = await fetchJson(mediaUrl);
        const remotePosts = mediaData.data || [];

        console.log(`Found ${remotePosts.length} posts. Uploading to S3...`);
        const processedPosts = [];

        for (const post of remotePosts) {
            let imageUrl = post.media_url;
            if (post.media_type === 'VIDEO') {
                imageUrl = post.thumbnail_url || post.media_url;
            }

            if (!imageUrl) continue;

            try {
                const imageBuffer = await getImageBuffer(imageUrl);
                const filename = `posts/ig-${post.id}.jpg`;
                const publicUrl = await uploadToS3(filename, imageBuffer, 'image/jpeg');

                if (publicUrl) {
                    const caption = post.caption || "Instagram Post";
                    const title = caption.length > 60 ? caption.substring(0, 60) + "..." : caption;

                    processedPosts.push({
                        id: `ig-${post.id}`,
                        title: title.replace(/['"]/g, ""),
                        url: post.permalink || `https://www.instagram.com/p/${post.id}/`,
                        image: publicUrl,
                        type: post.media_type.toLowerCase(),
                        timestamp: post.timestamp
                    });
                    console.log(`✓ Uploaded ig-${post.id} to S3`);
                }
            } catch (err) {
                console.error(`✗ Failed to process ${post.id}:`, err.message);
            }
        }

        if (processedPosts.length > 0) {
            console.log(`Saving ${processedPosts.length} posts to PostgreSQL...`);
            for (const post of processedPosts) {
                await query(
                    `INSERT INTO instagram_posts (id, title, url, image, type, timestamp)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (id) DO UPDATE SET
                        title = EXCLUDED.title,
                        url = EXCLUDED.url,
                        image = EXCLUDED.image,
                        type = EXCLUDED.type,
                        timestamp = EXCLUDED.timestamp`,
                    [post.id, post.title, post.url, post.image, post.type, post.timestamp]
                );
            }

            const fileContent = `export const INSTAGRAM_POSTS = ${JSON.stringify(processedPosts, null, 2)};\n`;
            const outputPath = path.resolve(__dirname, '../src/constants.js');
            fs.writeFileSync(outputPath, fileContent);
            console.log(`SUCCESS: Updated PostgreSQL, constants.js, and S3 storage with ${processedPosts.length} posts.`);
        }
    } catch (error) {
        console.error("API Error:", error.message);
    } finally {
        if (typeof pool !== 'undefined') await pool.end();
    }
}

run();
