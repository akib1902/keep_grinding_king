/**
 * End-to-end suite setup. The e2e suite drives the real HTTP server, queue and
 * worker, so it shares the test database with the integration suite and runs
 * after any file that truncates it.
 */
import { prepareTestEnv, testConfig } from '../helpers/env.js';

prepareTestEnv();
const config = testConfig();
process.env.QUEUE_PREFIX = process.env.QUEUE_PREFIX ?? 'rfa-test';

if (process.env.TEST_VERBOSE === 'true') {
  console.info(`[e2e] database=${config.database.url} redis=${config.redis.url} queuePrefix=${config.redis.queuePrefix}`);
}
