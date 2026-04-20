/**
 * Worker entry point.
 * Vite requires the ?worker import to point to a file in the UI package.
 * This file simply re-exports (side-effectfully imports) the simulator worker.
 *
 * Vite bundles this as a separate worker chunk with its own module graph,
 * resolving @cgmsim/shared and @cgmsim/simulator via the aliases in vite.config.ts.
 */

// Side-effect import: runs the worker message handler
import '../../simulator/src/worker.js';
