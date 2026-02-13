import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, S3_BUCKET } from './aws-config.js';

/**
 * Uploads a buffer to AWS S3
 * @param {string} key - The file path/name in the bucket
 * @param {Buffer|string} body - The file content
 * @param {string} contentType - Mime type
 * @returns {Promise<string|null>} - The public URL of the uploaded object
 */
export async function uploadToS3(key, body, contentType) {
    try {
        const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'base64');

        const command = new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            Body: buffer,
            ContentType: contentType,
        });

        await s3Client.send(command);

        // Construct the public URL (assuming the bucket is public or has a policy)
        const region = await s3Client.config.region();
        return `https://${S3_BUCKET}.s3.${region}.amazonaws.com/${key}`;
    } catch (error) {
        console.error(`[S3 Error] Failed to upload ${key}:`, error.message);
        return null;
    }
}
