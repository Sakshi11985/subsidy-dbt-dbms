// npm run seed : drop + rebuild both databases with the demo data
import { connectMongo, closeAll, mongoStatus } from '../src/db.js';
import { resetDatabase } from '../src/seed.js';

await connectMongo();
if (!mongoStatus.connected) console.warn('WARNING: MongoDB not connected; document metadata will be skipped.', mongoStatus.error);
await resetDatabase();
await closeAll();
