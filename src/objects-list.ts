/**
 * Object keys, importable without pulling in the Drizzle schema.
 *
 * The smoke test runs outside the Next.js bundle and only needs the list of
 * registered object keys to walk every generated page. Importing the full registry
 * would drag in the database driver for no reason.
 */
export { objectKeys } from './server/objects';
