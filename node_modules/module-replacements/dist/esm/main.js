import { readFileSync } from 'node:fs';
import { manifestsDir } from './manifests-dir.js';
const nativeReplacements = JSON.parse(readFileSync(`${manifestsDir}/native.json`, 'utf8'));
const microUtilsReplacements = JSON.parse(readFileSync(`${manifestsDir}/micro-utilities.json`, 'utf8'));
const preferredReplacements = JSON.parse(readFileSync(`${manifestsDir}/preferred.json`, 'utf8'));
export * from './types.js';
export { nativeReplacements, microUtilsReplacements, preferredReplacements };
export const all = {
    moduleReplacements: [
        ...nativeReplacements.moduleReplacements,
        ...microUtilsReplacements.moduleReplacements,
        ...preferredReplacements.moduleReplacements
    ]
};
