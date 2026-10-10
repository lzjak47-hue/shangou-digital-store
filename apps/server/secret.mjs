import { randomBytes, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// 数据加密密钥（用于加密存入数据库的支付密钥等敏感字段）。
// 首次运行会自动生成 64 位十六进制密钥并追加写入项目根 .env，请妥善保管、勿泄露。
export async function ensureSecretKey() {
  let key = String(process.env.SECRET_KEY || '').trim();
  if (key) return key;
  key = randomBytes(32).toString('hex');
  process.env.SECRET_KEY = key;
  try {
    await appendFile(resolve(projectRoot, '.env'), `\n# 数据加密密钥（自动生成，用于加密数据库中的支付密钥等敏感字段；请勿泄露）\nSECRET_KEY=${key}\n`);
  } catch {}
  return key;
}

function secretKey() {
  const key = String(process.env.SECRET_KEY || '');
  if (!key) throw new Error('SECRET_KEY 尚未初始化，请重启服务');
  return Buffer.from(key.slice(0, 64).padEnd(64, '0'), 'hex');
}

export function encryptSecret(text) {
  const value = String(text ?? '');
  if (!value) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data.toString('hex')}`;
}

export function decryptSecret(stored) {
  const value = String(stored ?? '');
  if (!value) return '';
  const parts = value.split(':');
  if (parts[0] !== 'enc' || parts.length !== 5) return value; // 兼容未加密的旧数据
  const [, , ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, 32).toString('hex');
  return `scrypt$${salt.toString('hex')}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(String(password), salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}