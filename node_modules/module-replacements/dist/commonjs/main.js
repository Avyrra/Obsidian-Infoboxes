"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.all = exports.preferredReplacements = exports.microUtilsReplacements = exports.nativeReplacements = void 0;
const node_fs_1 = require("node:fs");
const manifests_dir_js_1 = require("./manifests-dir.js");
const nativeReplacements = JSON.parse((0, node_fs_1.readFileSync)(`${manifests_dir_js_1.manifestsDir}/native.json`, 'utf8'));
exports.nativeReplacements = nativeReplacements;
const microUtilsReplacements = JSON.parse((0, node_fs_1.readFileSync)(`${manifests_dir_js_1.manifestsDir}/micro-utilities.json`, 'utf8'));
exports.microUtilsReplacements = microUtilsReplacements;
const preferredReplacements = JSON.parse((0, node_fs_1.readFileSync)(`${manifests_dir_js_1.manifestsDir}/preferred.json`, 'utf8'));
exports.preferredReplacements = preferredReplacements;
__exportStar(require("./types.js"), exports);
exports.all = {
    moduleReplacements: [
        ...nativeReplacements.moduleReplacements,
        ...microUtilsReplacements.moduleReplacements,
        ...preferredReplacements.moduleReplacements
    ]
};
