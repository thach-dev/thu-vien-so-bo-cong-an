const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";

function getKey() {
    const key = process.env.TOKEN_ENCRYPTION_KEY;

    if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) {
        throw new Error(
            "TOKEN_ENCRYPTION_KEY phải là chuỗi hex 64 ký tự"
        );
    }

    return Buffer.from(key, "hex");
}

function encrypt(text) {
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(
        ALGORITHM,
        getKey(),
        iv
    );

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    return [
        iv.toString("hex"),
        authTag.toString("hex"),
        encrypted,
    ].join(":");
}

function decrypt(encryptedText) {
    const [ivHex, authTagHex, encrypted] =
        encryptedText.split(":");

    if (!ivHex || !authTagHex || !encrypted) {
        throw new Error("Dữ liệu token không hợp lệ");
    }

    const decipher = crypto.createDecipheriv(
        ALGORITHM,
        getKey(),
        Buffer.from(ivHex, "hex")
    );

    decipher.setAuthTag(
        Buffer.from(authTagHex, "hex")
    );

    let decrypted = decipher.update(
        encrypted,
        "hex",
        "utf8"
    );

    decrypted += decipher.final("utf8");

    return decrypted;
}

module.exports = {
    encrypt,
    decrypt,
};