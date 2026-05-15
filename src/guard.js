import { resolve, sep } from 'node:path';

/**
 * Resolves `inputPath` and asserts it falls within `allowedRoot`.
 * Throws if no root is configured or if the path escapes the root.
 * Returns the resolved absolute path on success.
 */
export function guardPath(inputPath, allowedRoot) {
  if (!allowedRoot) {
    throw new Error(
      'Project root not configured. Call context with action:"resume" and include rootPath to enable file/git access.'
    );
  }
  const resolved = resolve(inputPath);
  const root = resolve(allowedRoot);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new Error(`Access denied: "${resolved}" is outside the project root "${root}"`);
  }
  return resolved;
}
