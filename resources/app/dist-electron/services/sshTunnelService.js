"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sshTunnelService = exports.SshTunnelService = void 0;
const ssh2_1 = require("ssh2");
const net_1 = __importDefault(require("net"));
const fs_1 = __importDefault(require("fs"));
class SshTunnelService {
    activeTunnels = new Map();
    /**
     * Menguji koneksi SSH ke Bastion / Jump Server tanpa membuka database
     */
    async testSshConnection(config) {
        return new Promise((resolve) => {
            if (!config.sshHost || !config.sshUser) {
                return resolve({ success: false, message: 'Host SSH dan Username SSH wajib diisi.' });
            }
            const client = new ssh2_1.Client();
            let isResolved = false;
            const finish = (success, message) => {
                if (!isResolved) {
                    isResolved = true;
                    try {
                        client.end();
                    }
                    catch (_) { }
                    resolve({ success, message });
                }
            };
            const timer = setTimeout(() => {
                finish(false, `Timeout: Tidak dapat terhubung ke SSH Host ${config.sshHost}:${config.sshPort || 22} dalam 12 detik.`);
            }, 12000);
            client.on('ready', () => {
                clearTimeout(timer);
                finish(true, `Koneksi SSH berhasil! Terhubung ke ${config.sshUser}@${config.sshHost}:${config.sshPort || 22}`);
            });
            client.on('error', (err) => {
                clearTimeout(timer);
                finish(false, `Gagal terhubung ke SSH: ${err.message || err}`);
            });
            try {
                const connectOpts = {
                    host: config.sshHost,
                    port: config.sshPort || 22,
                    username: config.sshUser,
                    readyTimeout: 10000,
                    keepaliveInterval: 5000,
                };
                if (config.authType === 'password') {
                    connectOpts.password = config.sshPassword || '';
                }
                else if (config.authType === 'privateKey' && config.privateKeyPath) {
                    if (!fs_1.default.existsSync(config.privateKeyPath)) {
                        clearTimeout(timer);
                        return finish(false, `File Private Key tidak ditemukan di path: ${config.privateKeyPath}`);
                    }
                    connectOpts.privateKey = fs_1.default.readFileSync(config.privateKeyPath);
                    if (config.passphrase) {
                        connectOpts.passphrase = config.passphrase;
                    }
                }
                else {
                    clearTimeout(timer);
                    return finish(false, 'Mode otentikasi SSH atau kredensial belum lengkap.');
                }
                client.connect(connectOpts);
            }
            catch (err) {
                clearTimeout(timer);
                finish(false, `Error inisialisasi SSH: ${err.message || err}`);
            }
        });
    }
    /**
     * Membuka SSH Tunnel forwarder lokal (127.0.0.1:localPort -> remoteDbHost:remoteDbPort)
     */
    async createTunnel(config) {
        const ssh = config.sshTunnel;
        if (!ssh || !ssh.enabled) {
            throw new Error('SSH Tunnel tidak diaktifkan pada konfigurasi ini.');
        }
        const remoteDbHost = config.host;
        const remoteDbPort = config.port;
        return new Promise((resolve, reject) => {
            const sshClient = new ssh2_1.Client();
            let hasFinished = false;
            const timeoutTimer = setTimeout(() => {
                if (!hasFinished) {
                    hasFinished = true;
                    try {
                        sshClient.end();
                    }
                    catch (_) { }
                    reject(new Error(`Timeout koneksi SSH Bastion ke ${ssh.sshHost}:${ssh.sshPort || 22}`));
                }
            }, 15000);
            sshClient.on('error', (err) => {
                if (!hasFinished) {
                    hasFinished = true;
                    clearTimeout(timeoutTimer);
                    reject(new Error(`SSH Tunnel Error (${ssh.sshHost}): ${err.message || err}`));
                }
            });
            sshClient.on('ready', () => {
                // Buat TCP server lokal di port dinamis (port 0 = OS memilihkan port kosong)
                const server = net_1.default.createServer((localSocket) => {
                    sshClient.forwardOut('127.0.0.1', localSocket.remotePort || 0, remoteDbHost, remoteDbPort, (err, stream) => {
                        if (err) {
                            localSocket.destroy();
                            return;
                        }
                        localSocket.pipe(stream).pipe(localSocket);
                        stream.on('close', () => localSocket.destroy());
                        localSocket.on('close', () => stream.destroy());
                    });
                });
                server.on('error', (err) => {
                    if (!hasFinished) {
                        hasFinished = true;
                        clearTimeout(timeoutTimer);
                        try {
                            sshClient.end();
                        }
                        catch (_) { }
                        reject(new Error(`Gagal membuka local socket server: ${err.message}`));
                    }
                });
                server.listen(0, '127.0.0.1', () => {
                    if (!hasFinished) {
                        hasFinished = true;
                        clearTimeout(timeoutTimer);
                        const address = server.address();
                        const localPort = address.port;
                        const tunnelId = `${config.id}_${Date.now()}`;
                        const close = async () => {
                            return new Promise((res) => {
                                try {
                                    server.close(() => {
                                        try {
                                            sshClient.end();
                                        }
                                        catch (_) { }
                                        res();
                                    });
                                }
                                catch (_) {
                                    try {
                                        sshClient.end();
                                    }
                                    catch (_) { }
                                    res();
                                }
                            });
                        };
                        const activeTunnel = {
                            id: tunnelId,
                            localPort,
                            sshClient,
                            server,
                            close,
                        };
                        this.activeTunnels.set(tunnelId, activeTunnel);
                        resolve({ localPort, close });
                    }
                });
            });
            try {
                const connectOpts = {
                    host: ssh.sshHost,
                    port: ssh.sshPort || 22,
                    username: ssh.sshUser,
                    readyTimeout: 12000,
                    keepaliveInterval: 10000,
                };
                if (ssh.authType === 'password') {
                    connectOpts.password = ssh.sshPassword || '';
                }
                else if (ssh.authType === 'privateKey' && ssh.privateKeyPath) {
                    if (!fs_1.default.existsSync(ssh.privateKeyPath)) {
                        clearTimeout(timeoutTimer);
                        return reject(new Error(`File Private Key tidak ditemukan: ${ssh.privateKeyPath}`));
                    }
                    connectOpts.privateKey = fs_1.default.readFileSync(ssh.privateKeyPath);
                    if (ssh.passphrase) {
                        connectOpts.passphrase = ssh.passphrase;
                    }
                }
                sshClient.connect(connectOpts);
            }
            catch (err) {
                clearTimeout(timeoutTimer);
                reject(err);
            }
        });
    }
    /**
     * Menutup seluruh tunnel aktif saat aplikasi keluar
     */
    async closeAllTunnels() {
        for (const [id, tunnel] of this.activeTunnels.entries()) {
            try {
                await tunnel.close();
            }
            catch (_) { }
        }
        this.activeTunnels.clear();
    }
}
exports.SshTunnelService = SshTunnelService;
exports.sshTunnelService = new SshTunnelService();
