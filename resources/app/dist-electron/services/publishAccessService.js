"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublishAccessService = void 0;
const crypto_1 = __importDefault(require("crypto"));
class PublishAccessService {
    // Hash SHA-256 bawaan ZeenIQ Tools
    static PRIMARY_PIN_HASH = '7EDEEF640436C1AD015F929531CB2F88EF189F01F9A034EAB0673296BE9F8A20';
    // Hash SHA-256 untuk 'zeeniq' sebagai dev fallback
    static DEV_PIN_HASH = '91171D9E94451FFEE34AC82746B247647A50C2085E37FA241981ACB8C259DAA1';
    static hash(pin) {
        return crypto_1.default.createHash('sha256').update(pin).digest('hex').toUpperCase();
    }
    static verifyPin(pin, customHash) {
        if (!pin)
            return false;
        const computed = this.hash(pin.trim());
        if (customHash && computed === customHash.toUpperCase()) {
            return true;
        }
        return computed === this.PRIMARY_PIN_HASH || computed === this.DEV_PIN_HASH;
    }
}
exports.PublishAccessService = PublishAccessService;
