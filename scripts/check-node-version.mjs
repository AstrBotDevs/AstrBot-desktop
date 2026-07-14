import {
  assertSupportedNodeVersion,
  MINIMUM_NODE_VERSION,
} from './node-version.mjs';

try {
  assertSupportedNodeVersion();
  console.log(`Node.js version check passed (>=${MINIMUM_NODE_VERSION}).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
