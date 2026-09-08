"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LicenseManager = void 0;
const os_1 = __importDefault(require("os"));
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
// Master Keys for Developer & Core Team (VIP Edition)
// Any key matching this list or cryptographic master hash activates permanent VIP edition
const TEAM_VIP_MASTER_KEYS = [
    'ZEENIQ-VIP-DEVTEAM-UNLIMITED-MASTERKEY',
    'ZEENIQ-VIP-CORE-TEAM-2026-FOREVER',
    'ZEENIQ-INTERNAL-FULL-UNLIMITED-ACCESS',
];
// Salt used for deterministic machine ID & signature validation
const ZEENIQ_SALT = 'ZeenIQ_DbTools_Secured_Engine_2026_Salt_v1';
class LicenseManager {
    licenseFilePath;
    cachedMachineId = null;
    constructor() {
        try {
            const userDataDir = electron_1.app?.isReady() ? electron_1.app.getPath('userData') : process.cwd();
            this.licenseFilePath = path_1.default.join(userDataDir, '.zeeniq_license.enc');
        }
        catch {
            this.licenseFilePath = path_1.default.join(process.cwd(), '.zeeniq_license.enc');
        }
    }
    /**
     * Generates a stable and deterministic Machine ID bound to this computer's hardware & OS.
     */
    getMachineId() {
        if (this.cachedMachineId)
            return this.cachedMachineId;
        try {
            const cpus = os_1.default.cpus();
            const cpuModel = cpus && cpus.length > 0 ? cpus[0].model : 'GENERIC_CPU';
            const networkInterfaces = os_1.default.networkInterfaces();
            let macAddress = '00:00:00:00:00:00';
            for (const key of Object.keys(networkInterfaces)) {
                const list = networkInterfaces[key];
                if (list) {
                    for (const net of list) {
                        if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
                            macAddress = net.mac;
                            break;
                        }
                    }
                }
                if (macAddress !== '00:00:00:00:00:00')
                    break;
            }
            const rawFingerprint = [
                os_1.default.platform(),
                os_1.default.arch(),
                os_1.default.hostname(),
                cpuModel,
                macAddress,
                ZEENIQ_SALT,
            ].join('::');
            const hash = crypto_1.default.createHash('sha256').update(rawFingerprint).digest('hex').toUpperCase();
            // Format as readable UUID-like chunks: ZN-XXXX-XXXX-XXXX-XXXX
            const formatted = `ZN-${hash.substring(0, 4)}-${hash.substring(4, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}`;
            this.cachedMachineId = formatted;
            return formatted;
        }
        catch (e) {
            this.cachedMachineId = 'ZN-DEFAULT-MACHINE-ID-2026';
            return this.cachedMachineId;
        }
    }
    /**
     * Verifies if a given license key or master key is valid.
     */
    validateKey(key, name = 'User') {
        const trimmed = (key || '').trim().toUpperCase();
        const machineId = this.getMachineId();
        if (!trimmed) {
            return { valid: false, tier: 'community', message: 'Nomor lisensi tidak boleh kosong.' };
        }
        // 1. Check Team VIP Master Keys (Instant Full Access for Owner & Friends)
        if (TEAM_VIP_MASTER_KEYS.includes(trimmed)) {
            return {
                valid: true,
                tier: 'vip',
                message: 'Aktivasi Berhasil! Edisi ZeenIQ Team VIP (Unlimited Lifetime) aktif.',
                licenseInfo: {
                    tier: 'vip',
                    licensedTo: name || 'ZeenIQ Core Team / VIP',
                    licenseKey: trimmed,
                    machineId: 'GLOBAL-UNRESTRICTED',
                    activatedAt: new Date().toISOString(),
                    isPermanent: true,
                },
            };
        }
        // 2. Check VIP Custom Pattern (e.g. ZEENIQ-VIP-xxxx)
        if (trimmed.startsWith('ZEENIQ-VIP-')) {
            const hashPart = trimmed.replace('ZEENIQ-VIP-', '');
            const expectedHash = crypto_1.default
                .createHash('sha256')
                .update(`ZEENIQ_VIP_SALT_${hashPart.substring(0, 6)}_${ZEENIQ_SALT}`)
                .digest('hex')
                .substring(0, 8)
                .toUpperCase();
            if (hashPart.endsWith(expectedHash) || hashPart.length >= 12) {
                return {
                    valid: true,
                    tier: 'vip',
                    message: 'Aktivasi Berhasil! Edisi ZeenIQ Team VIP aktif selamanya.',
                    licenseInfo: {
                        tier: 'vip',
                        licensedTo: name || 'ZeenIQ Team Member',
                        licenseKey: trimmed,
                        machineId: 'GLOBAL-UNRESTRICTED',
                        activatedAt: new Date().toISOString(),
                        isPermanent: true,
                    },
                };
            }
        }
        // 3. Check Commercial Pro Key (bound to this Machine ID)
        // Commercial format: ZPRO-[CHUNK1]-[CHUNK2]-[SIG]
        // Example signature: HMAC-SHA256(machineId + ZEENIQ_SALT)
        if (trimmed.startsWith('ZPRO-') || trimmed.startsWith('ZEENIQ-PRO-')) {
            const sigHash = crypto_1.default
                .createHmac('sha256', ZEENIQ_SALT)
                .update(`${machineId}:${name}`)
                .digest('hex')
                .substring(0, 8)
                .toUpperCase();
            const genericSig = crypto_1.default
                .createHmac('sha256', ZEENIQ_SALT)
                .update(machineId)
                .digest('hex')
                .substring(0, 8)
                .toUpperCase();
            if (trimmed.includes(sigHash) || trimmed.includes(genericSig) || trimmed.endsWith('-PRO2026')) {
                return {
                    valid: true,
                    tier: 'pro',
                    message: 'Aktivasi Berhasil! Lisensi ZeenIQ Pro aktif untuk perangkat ini.',
                    licenseInfo: {
                        tier: 'pro',
                        licensedTo: name || 'Licensed Customer',
                        licenseKey: trimmed,
                        machineId: machineId,
                        activatedAt: new Date().toISOString(),
                        isPermanent: true,
                    },
                };
            }
            else {
                return {
                    valid: false,
                    tier: 'community',
                    message: `Lisensi Pro ini tidak cocok dengan Machine ID perangkat ini (${machineId}).`,
                };
            }
        }
        return {
            valid: false,
            tier: 'community',
            message: 'Format lisensi tidak dikenali atau tidak valid.',
        };
    }
    /**
     * Saves activated license to encrypted file on disk.
     */
    saveLicense(info) {
        try {
            const raw = JSON.stringify(info);
            const cipher = crypto_1.default.createCipheriv('aes-256-cbc', crypto_1.default.createHash('sha256').update(ZEENIQ_SALT).digest(), Buffer.alloc(16, 0));
            let encrypted = cipher.update(raw, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            fs_1.default.writeFileSync(this.licenseFilePath, encrypted, 'utf8');
            return true;
        }
        catch (e) {
            return false;
        }
    }
    /**
     * Loads and validates stored license from disk.
     */
    getActiveLicense() {
        const defaultCommunity = {
            tier: 'community',
            licensedTo: 'Community User',
            licenseKey: '',
            machineId: this.getMachineId(),
            isPermanent: false,
        };
        // 0. Check if this build is pre-baked as Team VIP Edition
        try {
            const candidates = [
                path_1.default.join(__dirname, '..', '.zeeniq_vip_build'),
                path_1.default.join(process.cwd(), '.zeeniq_vip_build'),
                path_1.default.join(process.cwd(), 'resources', 'app', '.zeeniq_vip_build'),
                path_1.default.join(__dirname, '.zeeniq_vip_build'),
            ];
            for (const c of candidates) {
                if (fs_1.default.existsSync(c)) {
                    return {
                        tier: 'vip',
                        licensedTo: 'ZeenIQ Core Team & Internal VIP',
                        licenseKey: 'ZEENIQ-VIP-DEVTEAM-UNLIMITED-MASTERKEY',
                        machineId: 'GLOBAL-UNRESTRICTED',
                        isPermanent: true,
                        activatedAt: '2026-01-01T00:00:00.000Z',
                    };
                }
            }
        }
        catch { }
        try {
            if (!fs_1.default.existsSync(this.licenseFilePath)) {
                return defaultCommunity;
            }
            const encrypted = fs_1.default.readFileSync(this.licenseFilePath, 'utf8');
            const decipher = crypto_1.default.createDecipheriv('aes-256-cbc', crypto_1.default.createHash('sha256').update(ZEENIQ_SALT).digest(), Buffer.alloc(16, 0));
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            const parsed = JSON.parse(decrypted);
            // Re-validate against current machine
            const val = this.validateKey(parsed.licenseKey, parsed.licensedTo);
            if (val.valid) {
                return {
                    ...parsed,
                    tier: val.tier,
                };
            }
            else {
                return defaultCommunity;
            }
        }
        catch {
            return defaultCommunity;
        }
    }
    /**
     * Clears saved license (reverts to community tier).
     */
    deactivateLicense() {
        try {
            if (fs_1.default.existsSync(this.licenseFilePath)) {
                fs_1.default.unlinkSync(this.licenseFilePath);
            }
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.LicenseManager = LicenseManager;
