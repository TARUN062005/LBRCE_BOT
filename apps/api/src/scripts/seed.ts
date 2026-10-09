import { connectDb, disconnectDb } from '../config/db.js';
import { ensureSeed } from './ensure-seed.js';

await connectDb();
await ensureSeed();
await disconnectDb();
console.log('Seeded college source configuration and admin user when ADMIN_PASSWORD is set.');
