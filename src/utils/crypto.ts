import crypto from 'crypto';
import { env } from '../config/env.js';

/**
 * Derives a consistent 32-byte key buffer from an arbitrary secret string via SHA-256.
 */
function getKeyBuffer(key?: string): Buffer {
  const secret = key || env.ENCRYPTION_KEY || 'default_realcrm_secure_32_bytes_key';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a plaintext string (e.g. Meta access token) using AES-256-GCM.
 * Output format: ivHex:authTagHex:encryptedHex
 */
export function encryptToken(plainText: string, key?: string): string {
  if (!plainText) return '';
  const keyBuffer = getKeyBuffer(key);
  const iv = crypto.randomBytes(12); // Standard 12-byte IV for AES-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts an AES-256-GCM ciphertext payload back into the original plaintext token.
 */
export function decryptToken(cipherText: string, key?: string): string {
  if (!cipherText) return '';
  const parts = cipherText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format. Expected iv:tag:data');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const keyBuffer = getKeyBuffer(key);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
