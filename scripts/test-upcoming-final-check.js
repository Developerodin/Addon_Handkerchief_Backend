import mongoose from 'mongoose';
import config from '../src/config/config.js';
import { upcomingFinalChecking } from '../src/services/production/finalChecking.service.js';
import { upcomingBundleBreak } from '../src/services/production/bundleBreak.service.js';

await mongoose.connect(config.mongoose.url, config.mongoose.options);
const br = await upcomingBundleBreak();
const fc = await upcomingFinalChecking();
console.log('Route split upcoming:', br.results?.map((r) => r.barcode));
console.log('Final checking upcoming:', fc.results?.map((r) => r.barcode));
await mongoose.disconnect();