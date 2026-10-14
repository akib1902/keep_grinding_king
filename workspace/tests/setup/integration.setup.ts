/**
 * Integration suite setup: point the process at the test database and Redis
 * namespace before any application module reads configuration.
 */
import { prepareTestEnv, testConfig } from '../helpers/env.js';

prepareTestEnv();
const config = testConfig();

if (process.env.TEST_VERBOSE === 'true') {
  console.info(
    `[integration] database=${config.database.url} redis=${config.redis.url} queuePrefix=${config.redis.queuePrefix}`,
  );
}
