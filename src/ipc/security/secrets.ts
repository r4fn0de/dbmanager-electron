import { safeStorage } from "electron";

const ENCRYPTED_PREFIX = "enc:v1:";

function toBase64(value: Buffer): string {
  return value.toString("base64");
}

function fromBase64(value: string): Buffer {
  return Buffer.from(value, "base64");
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptSecret(value: string): string {
  if (!value) return value;
  if (isEncryptedSecret(value)) return value;
  if (!safeStorage.isEncryptionAvailable()) return value;

  const encrypted = safeStorage.encryptString(value);
  return `${ENCRYPTED_PREFIX}${toBase64(encrypted)}`;
}

export function decryptSecret(value: string): string {
  if (!value) return value;
  if (!isEncryptedSecret(value)) return value;

  const encoded = value.slice(ENCRYPTED_PREFIX.length);
  if (!encoded) return "";

  try {
    const decrypted = safeStorage.decryptString(fromBase64(encoded));
    return decrypted;
  } catch {
    // Keep backward compatibility and avoid crashing if the local keychain changed.
    return "";
  }
}
