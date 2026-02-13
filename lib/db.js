import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { Pool } = pg;

// Create connection pool
const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: process.env.DATABASE_PORT || 5432,
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: {
        rejectUnauthorized: false // Required for AWS RDS
    },
    max: 10, // Maximum connections in pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

// Test connection on startup
pool.on('connect', () => {
    console.log('✓ Connected to AWS RDS PostgreSQL');
});

pool.on('error', (err) => {
    console.error('✗ PostgreSQL Pool Error:', err.message);
});

// Helper function for queries
export async function query(text, params) {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        console.log(`[DB] Query executed in ${duration}ms, rows: ${result.rowCount}`);
        return result;
    } catch (error) {
        console.error('[DB Error]', error.message);
        throw error;
    }
}

// Get a client for transactions
export async function getClient() {
    const client = await pool.connect();
    return client;
}

// Close pool (for graceful shutdown)
export async function closePool() {
    await pool.end();
    console.log('PostgreSQL pool closed');
}

export default pool;
