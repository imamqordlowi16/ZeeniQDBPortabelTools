"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppVersionService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
class AppVersionService {
    static getAppFolder() {
        if (electron_1.app && electron_1.app.isPackaged) {
            return path_1.default.dirname(process.execPath);
        }
        return process.cwd();
    }
    static getVersionFilePath() {
        return path_1.default.join(this.getAppFolder(), 'version.txt');
    }
    static getCurrentVersion() {
        const candidates = [
            this.getVersionFilePath(),
            path_1.default.join(this.getAppFolder(), 'resources', 'app', 'version.txt'),
            path_1.default.join(this.getAppFolder(), 'resources', 'version.txt'),
        ];
        if (electron_1.app) {
            try {
                if (typeof electron_1.app.getAppPath === 'function') {
                    candidates.push(path_1.default.join(electron_1.app.getAppPath(), 'version.txt'));
                }
            }
            catch { }
        }
        for (const file of candidates) {
            try {
                if (file && fs_1.default.existsSync(file)) {
                    const val = fs_1.default.readFileSync(file, 'utf8').trim();
                    const clean = val.startsWith('v') || val.startsWith('V') ? val.substring(1).trim() : val;
                    if (clean && /^\d+(\.\d+)*/.test(clean))
                        return clean;
                }
            }
            catch (e) { }
        }
        // Fallback to package.json candidates
        const pkgCandidates = [
            path_1.default.join(this.getAppFolder(), 'package.json'),
            path_1.default.join(this.getAppFolder(), 'resources', 'app', 'package.json'),
            path_1.default.join(process.cwd(), 'package.json'),
        ];
        if (electron_1.app) {
            try {
                if (typeof electron_1.app.getAppPath === 'function') {
                    pkgCandidates.unshift(path_1.default.join(electron_1.app.getAppPath(), 'package.json'));
                }
            }
            catch { }
        }
        for (const pkgPath of pkgCandidates) {
            try {
                if (pkgPath && fs_1.default.existsSync(pkgPath)) {
                    const pkg = JSON.parse(fs_1.default.readFileSync(pkgPath, 'utf8'));
                    if (pkg.version && /^\d+(\.\d+)*/.test(pkg.version))
                        return pkg.version;
                }
            }
            catch (e) { }
        }
        // Fallback to Electron's native package version if available
        try {
            if (electron_1.app && typeof electron_1.app.getVersion === 'function') {
                const nativeVer = electron_1.app.getVersion();
                if (nativeVer && nativeVer !== '1.0.0' && /^\d+(\.\d+)*/.test(nativeVer)) {
                    return nativeVer;
                }
            }
        }
        catch (e) { }
        return '1.0.0';
    }
    static setVersion(version) {
        let clean = version.trim();
        if (clean.startsWith('v') || clean.startsWith('V')) {
            clean = clean.substring(1).trim();
        }
        if (!clean)
            clean = '1.0.0';
        const versionFiles = [
            this.getVersionFilePath(),
            path_1.default.join(this.getAppFolder(), 'resources', 'app', 'version.txt'),
            path_1.default.join(process.cwd(), 'version.txt'),
        ];
        for (const vf of versionFiles) {
            try {
                const dir = path_1.default.dirname(vf);
                if (fs_1.default.existsSync(dir)) {
                    fs_1.default.writeFileSync(vf, clean, 'utf8');
                }
            }
            catch (e) { }
        }
        // Also sync to package.json if in development
        try {
            const devPkgPath = path_1.default.join(process.cwd(), 'package.json');
            if (fs_1.default.existsSync(devPkgPath) && !electron_1.app.isPackaged) {
                const pkg = JSON.parse(fs_1.default.readFileSync(devPkgPath, 'utf8'));
                pkg.version = clean;
                fs_1.default.writeFileSync(devPkgPath, JSON.stringify(pkg, null, 2), 'utf8');
            }
        }
        catch (e) { }
        return clean;
    }
}
exports.AppVersionService = AppVersionService;
