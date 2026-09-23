import 'dotenv/config';

/**
 * Standalone training script — builds/updates the fraud memory from every
 * decided claim currently known. Registers seed claims' evidence (generating
 * the deterministic demo images if needed), then enrolls their embeddings.
 *
 *   npm run train
 */
process.env.SEED_DEMO = process.env.SEED_DEMO ?? '0';

const { registerSeedClaims } = await import('./seed.js');
await registerSeedClaims();

const { trainFromExistingClaims } = await import('./ai/train.js');
const { memoryStats } = await import('./ai/fraud-memory.js');

await trainFromExistingClaims();
console.log('Training complete:', memoryStats());
console.log('The fraud memory now scores every new claim via k-NN (see /api/fraud-memory).');
process.exit(0);
