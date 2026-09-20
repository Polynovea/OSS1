import { existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const root = process.cwd();

function resolveCandidate(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, resolvePath(base, 'index.ts'), resolvePath(base, 'index.tsx'), resolvePath(base, 'index.js'), resolvePath(base, 'index.mjs')]) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const resolved = resolveCandidate(resolvePath(root, specifier.slice(2)));
    if (resolved) return { url: resolved, shortCircuit: true };
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const resolved = resolveCandidate(resolvePath(parentDir, specifier));
    if (resolved) return { url: resolved, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
