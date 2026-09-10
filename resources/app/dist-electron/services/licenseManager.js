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
const child_process_1 = require("child_process");
const electron_1 = require("electron");
// Master Key SHA-256 Hashes for Developer & Core Team (VIP Edition)
// Keys are never stored in plaintext to prevent string extraction or reverse engineering
const TEAM_VIP_MASTER_HASHES = [
    '4BE15121D4C2F34A3D13F5F51EB59926846A39836EC48E9F19C85EC9D976B100',
    'DDCABEF03C05C54DD5B22D73593404A3ACC44DDA77F51CC4E7B446CCA9941629',
    '7FB9D0ABE085BC29000341ADCC55EA00A32255E3599A2012D6C76F6259363BA5',
    '137A08616E86BF5F723E5532BFC79F9E8C2A78FDDC46049A5572D5B60BD43CD6', // ZEENIQ-VIP-CORETEAM-2026
    '6F5F51242A9EAFF05B8CB9DC05D53330320BCD03489108EC0F91E716956AD548', // ZEENIQ-VIP-IMAM-DEVTEAM
];
// Salt used for deterministic machine ID & signature validation
const ZEENIQ_SALT = 'ZeenIQ_DbTools_Secured_Engine_2026_Salt_v1';
class LicenseManager {
    licenseFilePath;
    trialFilePath;
    cachedMachineId = null;
    constructor() {
        try {
            const userDataDir = electron_1.app?.isReady() ? electron_1.app.getPath('userData') : process.cwd();
            this.licenseFilePath = path_1.default.join(userDataDir, '.zeeniq_license.enc');
            this.trialFilePath = path_1.default.join(userDataDir, '.zeeniq_trial.enc');
        }
        catch {
            this.licenseFilePath = path_1.default.join(process.cwd(), '.zeeniq_license.enc');
            this.trialFilePath = path_1.default.join(process.cwd(), '.zeeniq_trial.enc');
        }
    }
    /**
     * Checks if this binary is specifically built as the Commercial (Retail/Public) distribution.
     */
    isCommercialEdition() {
        try {
            if (process.env.ZEENIQ_EDITION === 'commercial')
                return true;
            const pkgCandidates = [
                path_1.default.join(__dirname, '..', 'package.json'),
                path_1.default.join(process.cwd(), 'resources', 'app.asar', 'package.json'),
                path_1.default.join(process.cwd(), 'resources', 'app', 'package.json'),
                path_1.default.join(process.cwd(), 'package.json'),
            ];
            for (const p of pkgCandidates) {
                if (fs_1.default.existsSync(p)) {
                    const content = JSON.parse(fs_1.default.readFileSync(p, 'utf8'));
                    if (content.edition === 'commercial')
                        return true;
                }
            }
        }
        catch { }
        return false;
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
        // 1. Check Team VIP Master Keys by SHA-256 hash (never compare plaintext)
        const keyHash = crypto_1.default.createHash('sha256').update(trimmed).digest('hex').toUpperCase();
        if (TEAM_VIP_MASTER_HASHES.includes(keyHash)) {
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
        // 2. Check VIP Cryptographic Signature Pattern (e.g. ZEENIQ-VIP-[SEED]-[HMAC])
        if (trimmed.startsWith('ZEENIQ-VIP-')) {
            const hashPart = trimmed.replace('ZEENIQ-VIP-', '');
            if (hashPart.length >= 14) {
                const seed = hashPart.substring(0, 6);
                const expectedHash = crypto_1.default
                    .createHash('sha256')
                    .update(`ZEENIQ_VIP_SALT_${seed}_${ZEENIQ_SALT}`)
                    .digest('hex')
                    .substring(0, 8)
                    .toUpperCase();
                if (hashPart.substring(6) === expectedHash) {
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
        }
        // Helper to verify machine signature or cryptographic seed
        const verifyMachineOrSeed = (rawKey, tierPrefix) => {
            const sigWithName = crypto_1.default
                .createHmac('sha256', `${ZEENIQ_SALT}_${tierPrefix}`)
                .update(`${machineId}:${name}`)
                .digest('hex')
                .substring(0, 8)
                .toUpperCase();
            const genericSig = crypto_1.default
                .createHmac('sha256', `${ZEENIQ_SALT}_${tierPrefix}`)
                .update(machineId)
                .digest('hex')
                .substring(0, 8)
                .toUpperCase();
            const legacySig = crypto_1.default
                .createHmac('sha256', ZEENIQ_SALT)
                .update(machineId)
                .digest('hex')
                .substring(0, 8)
                .toUpperCase();
            if (rawKey.includes(sigWithName) || rawKey.includes(genericSig) || rawKey.includes(legacySig)) {
                return true;
            }
            // Check Seed-based HMAC for offline distribution e.g. [PREFIX]-[SEED6]-[HMAC8]
            const parts = rawKey.split('-');
            if (parts.length >= 3) {
                const seed = parts[1];
                if (seed && seed.length >= 6) {
                    const expectedHmac = crypto_1.default
                        .createHmac('sha256', ZEENIQ_SALT)
                        .update(`${tierPrefix}_${seed}`)
                        .digest('hex')
                        .substring(0, 8)
                        .toUpperCase();
                    if (rawKey.includes(expectedHmac))
                        return true;
                }
            }
            return false;
        };
        // 3. Check Commercial Starter Key
        // Format: ZSTART-[MACHINE_OR_SEED]-[SIG] or ZEENIQ-START-[...]
        if (trimmed.startsWith('ZSTART-') || trimmed.startsWith('ZEENIQ-START-')) {
            const isSubscription = trimmed.includes('-SUB-') || trimmed.includes('-SUB') || trimmed.includes('SUBSCRIPTION');
            const isPermanent = !isSubscription;
            const typeLabel = isPermanent ? 'Permanen (Lifetime)' : 'Langganan (Subscription)';
            if (verifyMachineOrSeed(trimmed, 'STARTER')) {
                return {
                    valid: true,
                    tier: 'starter',
                    message: `Aktivasi Berhasil! Lisensi ZeenIQ Starter ${typeLabel} aktif untuk perangkat ini.`,
                    licenseInfo: {
                        tier: 'starter',
                        licensedTo: name || 'Licensed Starter Customer',
                        licenseKey: trimmed,
                        machineId: machineId,
                        activatedAt: new Date().toISOString(),
                        isPermanent: isPermanent,
                    },
                };
            }
            else {
                return {
                    valid: false,
                    tier: 'community',
                    message: `Lisensi Starter ini tidak cocok dengan Machine ID perangkat ini (${machineId}).`,
                };
            }
        }
        // 4. Check Commercial Pro Key (bound to this Machine ID)
        // Commercial format: ZPRO-[CHUNK1]-[CHUNK2]-[SIG]
        if (trimmed.startsWith('ZPRO-') || trimmed.startsWith('ZEENIQ-PRO-')) {
            const isSubscription = trimmed.includes('-SUB-') ||
                trimmed.includes('-SUB') ||
                trimmed.includes('-MONTH-') ||
                trimmed.includes('SUBSCRIPTION');
            const isPermanent = !isSubscription;
            const typeLabel = isPermanent ? 'Permanen (Lifetime)' : 'Langganan (Subscription)';
            if (verifyMachineOrSeed(trimmed, 'PRO')) {
                return {
                    valid: true,
                    tier: 'pro',
                    message: `Aktivasi Berhasil! Lisensi ZeenIQ Pro ${typeLabel} aktif untuk perangkat ini.`,
                    licenseInfo: {
                        tier: 'pro',
                        licensedTo: name || 'Licensed Customer',
                        licenseKey: trimmed,
                        machineId: machineId,
                        activatedAt: new Date().toISOString(),
                        isPermanent: isPermanent,
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
        // 5. Check Commercial Advance / Enterprise Key
        // Format: ZADV-[...] or ZEENIQ-ADV-[...] or ZEENIQ-ENTERPRISE-[...]
        if (trimmed.startsWith('ZADV-') || trimmed.startsWith('ZEENIQ-ADV-') || trimmed.startsWith('ZEENIQ-ENTERPRISE-')) {
            const isSubscription = trimmed.includes('-SUB-') || trimmed.includes('-SUB') || trimmed.includes('SUBSCRIPTION');
            const isPermanent = !isSubscription;
            const typeLabel = isPermanent ? 'Permanen (Lifetime)' : 'Langganan (Subscription)';
            if (verifyMachineOrSeed(trimmed, 'ADVANCE')) {
                return {
                    valid: true,
                    tier: 'advanced',
                    message: `Aktivasi Berhasil! Lisensi ZeenIQ Advance Edition (Enterprise ${typeLabel}) aktif untuk perangkat ini.`,
                    licenseInfo: {
                        tier: 'advanced',
                        licensedTo: name || 'Enterprise Customer',
                        licenseKey: trimmed,
                        machineId: machineId,
                        activatedAt: new Date().toISOString(),
                        isPermanent: isPermanent,
                    },
                };
            }
            else {
                return {
                    valid: false,
                    tier: 'community',
                    message: `Lisensi Advance ini tidak cocok dengan Machine ID perangkat ini (${machineId}).`,
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
        // STRICT: Commercial edition NEVER allows .zeeniq_vip_build override!
        if (!this.isCommercialEdition()) {
            try {
                const candidates = [
                    path_1.default.join(__dirname, '..', '.zeeniq_vip_build'),
                    path_1.default.join(process.cwd(), '.zeeniq_vip_build'),
                    path_1.default.join(process.cwd(), 'resources', 'app', '.zeeniq_vip_build'),
                    path_1.default.join(__dirname, '.zeeniq_vip_build'),
                ];
                const expectedSig = crypto_1.default
                    .createHmac('sha256', ZEENIQ_SALT)
                    .update('ZEENIQ_TEAM_VIP_INTERNAL_KEY')
                    .digest('hex');
                for (const c of candidates) {
                    if (fs_1.default.existsSync(c)) {
                        try {
                            const raw = fs_1.default.readFileSync(c, 'utf8');
                            const parsed = JSON.parse(raw);
                            if (parsed.edition === 'team-vip' && parsed.signature === expectedSig) {
                                return {
                                    tier: 'vip',
                                    licensedTo: parsed.licensedTo || 'ZeenIQ Core Team & Internal VIP',
                                    licenseKey: 'ZEENIQ-VIP-ACTIVE',
                                    machineId: 'GLOBAL-UNRESTRICTED',
                                    isPermanent: true,
                                    activatedAt: parsed.createdAt || '2026-01-01T00:00:00.000Z',
                                };
                            }
                        }
                        catch { }
                    }
                }
            }
            catch { }
        }
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
    /**
     * Checks if the active license permits applying updates to newer versions.
     * Subscription and Community editions CANNOT update.
     * ONLY Permanent (Lifetime) or Team VIP can update!
     */
    canApplyUpdates() {
        const active = this.getActiveLicense();
        if (active.tier === 'vip' || active.tier === 'advanced') {
            return { allowed: true };
        }
        if ((active.tier === 'pro' || active.tier === 'starter') && active.isPermanent) {
            return { allowed: true };
        }
        if (active.tier === 'pro' || active.tier === 'starter') {
            return {
                allowed: false,
                reason: 'Lisensi Anda adalah tipe Langganan (Subscription). Pembaruan ke versi baru hanya diizinkan untuk pemegang Lisensi Permanen (Lifetime) atau Enterprise. Silakan upgrade ke Lisensi Permanen untuk mengunduh update.',
            };
        }
        return {
            allowed: false,
            reason: 'Pembaruan aplikasi ke versi baru hanya tersedia untuk Lisensi Permanen (Lifetime), Advance Edition, atau Team VIP. Silakan beli Lisensi Resmi untuk mendapatkan update berkelanjutan.',
        };
    }
    /**
     * Tracks and evaluates 7-Day Demo/Community Trial period with multi-layer hardware anchoring.
     * Prevents repeated trial abuse by storing encrypted trial fingerprints across AppData,
     * LocalAppData, UserProfile, and Windows Registry.
     */
    getTrialStatus() {
        const activeLicense = this.getActiveLicense();
        if (activeLicense.tier !== 'community') {
            return {
                isTrial: false,
                isExpired: false,
                daysRemaining: Infinity,
                startedAt: activeLicense.activatedAt || new Date().toISOString(),
                expiresAt: activeLicense.expiresAt || '',
            };
        }
        const TRIAL_DAYS = 7;
        const now = Date.now();
        const machineId = this.getMachineId();
        // 1. Gather trial records from all redundant storage layers
        const discoveredRecords = [];
        // Layer A: Primary AppData
        const recA = this.readTrialFile(this.trialFilePath);
        if (recA)
            discoveredRecords.push(recA);
        // Layer B: LocalAppData
        try {
            const localApp = process.env.LOCALAPPDATA || os_1.default.homedir();
            const recB = this.readTrialFile(path_1.default.join(localApp, '.zeeniq_cache_id.enc'));
            if (recB)
                discoveredRecords.push(recB);
        }
        catch { }
        // Layer C: UserProfile Home Directory
        try {
            const recC = this.readTrialFile(path_1.default.join(os_1.default.homedir(), '.zeeniq_device_state'));
            if (recC)
                discoveredRecords.push(recC);
        }
        catch { }
        // Layer D: Windows Registry Hive (HKCU\Software\ZeenIQ\Core\TrialToken)
        const recD = this.readRegistryTrial();
        if (recD)
            discoveredRecords.push(recD);
        let firstLaunchAt;
        let lastSeenAt;
        let hadExpiredFlag = false;
        if (discoveredRecords.length > 0) {
            // Find the absolute EARLIEST firstLaunchAt to prevent reset by deleting folders
            let earliestTime = Infinity;
            let earliestStr = discoveredRecords[0].firstLaunchAt;
            let latestSeen = 0;
            let latestSeenStr = discoveredRecords[0].lastSeenAt || earliestStr;
            for (const rec of discoveredRecords) {
                if (rec.isExpired)
                    hadExpiredFlag = true;
                const tStart = new Date(rec.firstLaunchAt).getTime();
                if (!isNaN(tStart) && tStart < earliestTime) {
                    earliestTime = tStart;
                    earliestStr = rec.firstLaunchAt;
                }
                const tSeen = new Date(rec.lastSeenAt || rec.firstLaunchAt).getTime();
                if (!isNaN(tSeen) && tSeen > latestSeen) {
                    latestSeen = tSeen;
                    latestSeenStr = rec.lastSeenAt || rec.firstLaunchAt;
                }
            }
            firstLaunchAt = earliestStr;
            lastSeenAt = latestSeenStr;
        }
        else {
            // Genuine first launch on this computer!
            const initialIso = new Date(now).toISOString();
            firstLaunchAt = initialIso;
            lastSeenAt = initialIso;
        }
        const startTime = new Date(firstLaunchAt).getTime();
        const lastSeen = new Date(lastSeenAt).getTime();
        // Anti-clock tampering: if clock was turned back by > 1 hour, advance effective time
        let effectiveNow = now;
        if (now < lastSeen - 3600000) {
            effectiveNow = lastSeen + (lastSeen - now);
        }
        const durationMs = effectiveNow - startTime;
        const elapsedDays = durationMs / (1000 * 60 * 60 * 24);
        const isExpired = hadExpiredFlag || elapsedDays >= TRIAL_DAYS;
        const expiresAt = new Date(startTime + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const daysRemaining = isExpired ? 0 : Math.max(1, Math.ceil(TRIAL_DAYS - elapsedDays));
        // Save consolidated record back to ALL storage layers to self-heal any wiped locations
        const consolidatedData = {
            machineId,
            firstLaunchAt,
            lastSeenAt: new Date(effectiveNow).toISOString(),
            isExpired,
        };
        this.saveConsolidatedTrial(consolidatedData);
        return {
            isTrial: true,
            isExpired,
            daysRemaining,
            startedAt: firstLaunchAt,
            expiresAt,
        };
    }
    encryptTrialPayload(data) {
        const raw = JSON.stringify(data);
        const cipher = crypto_1.default.createCipheriv('aes-256-cbc', crypto_1.default.createHash('sha256').update(ZEENIQ_SALT).digest(), Buffer.alloc(16, 0));
        let encrypted = cipher.update(raw, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return encrypted;
    }
    decryptTrialPayload(encrypted) {
        try {
            const decipher = crypto_1.default.createDecipheriv('aes-256-cbc', crypto_1.default.createHash('sha256').update(ZEENIQ_SALT).digest(), Buffer.alloc(16, 0));
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            const parsed = JSON.parse(decrypted);
            if (parsed && parsed.firstLaunchAt) {
                return parsed;
            }
            return null;
        }
        catch {
            return null;
        }
    }
    readTrialFile(filePath) {
        try {
            if (fs_1.default.existsSync(filePath)) {
                const encrypted = fs_1.default.readFileSync(filePath, 'utf8').trim();
                return this.decryptTrialPayload(encrypted);
            }
        }
        catch { }
        return null;
    }
    writeTrialFile(filePath, ciphertext) {
        try {
            const dir = path_1.default.dirname(filePath);
            if (!fs_1.default.existsSync(dir)) {
                fs_1.default.mkdirSync(dir, { recursive: true });
            }
            fs_1.default.writeFileSync(filePath, ciphertext, 'utf8');
        }
        catch { }
    }
    readRegistryTrial() {
        if (process.platform !== 'win32')
            return null;
        try {
            const out = (0, child_process_1.execSync)('reg query "HKCU\\Software\\ZeenIQ\\Core" /v "TrialToken"', {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
            });
            const match = out.match(/TrialToken\s+REG_SZ\s+(\S+)/);
            if (match && match[1]) {
                return this.decryptTrialPayload(match[1]);
            }
        }
        catch { }
        return null;
    }
    writeRegistryTrial(ciphertext) {
        if (process.platform !== 'win32')
            return;
        try {
            (0, child_process_1.execSync)(`reg add "HKCU\\Software\\ZeenIQ\\Core" /v "TrialToken" /t REG_SZ /d "${ciphertext}" /f`, {
                stdio: 'ignore',
            });
        }
        catch { }
    }
    saveConsolidatedTrial(data) {
        try {
            const ciphertext = this.encryptTrialPayload(data);
            // Layer A: AppData
            this.writeTrialFile(this.trialFilePath, ciphertext);
            // Layer B: LocalAppData
            try {
                const localApp = process.env.LOCALAPPDATA || os_1.default.homedir();
                this.writeTrialFile(path_1.default.join(localApp, '.zeeniq_cache_id.enc'), ciphertext);
            }
            catch { }
            // Layer C: UserProfile
            try {
                this.writeTrialFile(path_1.default.join(os_1.default.homedir(), '.zeeniq_device_state'), ciphertext);
            }
            catch { }
            // Layer D: Windows Registry
            this.writeRegistryTrial(ciphertext);
        }
        catch { }
    }
}
exports.LicenseManager = LicenseManager;
