import { createPrivateKey, createPublicKey, createSign, createVerify, randomBytes, X509Certificate, createDecipheriv } from 'node:crypto';

// 支付参数全部来自数据库 settings.payment（由服务端解密后传入），此处不再读取环境变量。

const timestamp = () => String(Math.floor(Date.now() / 1000));
const nonce = () => randomBytes(16).toString('hex');
const normalizeSerial = value => String(value || '').replace(/[^a-f\d]/gi, '').replace(/^0+/,'').toUpperCase();
const ALIPAY_GATEWAY_DEFAULT = 'https://openapi.alipay.com/gateway.do';
const WECHAT_API_BASE_DEFAULT = 'https://api.mch.weixin.qq.com';

function callbackUrl(provider, settings = {}) {
  const direct = String(settings[provider === 'alipay' ? 'alipayNotifyUrl' : 'wechatNotifyUrl'] || '').trim();
  const base = String(settings.publicBaseUrl || '').trim();
  const value = direct || (base ? `${base.replace(/\/+$/, '')}/api/payments/${provider}/notify` : '');
  try { const parsed = new URL(value); return parsed.protocol === 'https:' ? parsed.toString() : ''; } catch { return ''; }
}

export async function paymentReadiness(settings = {}) {
  const alipayMissing = [];
  if (!String(settings.alipayAppId || '').trim()) alipayMissing.push('支付宝应用 ID');
  if (!String(settings.alipayPrivateKey || '').trim()) alipayMissing.push('支付宝商户私钥');
  if (!String(settings.alipayPublicKey || '').trim()) alipayMissing.push('支付宝公钥');
  if (!callbackUrl('alipay', settings)) alipayMissing.push('公网 HTTPS 回调地址');

  const wechatMissing = [];
  if (!String(settings.wechatAppId || '').trim()) wechatMissing.push('微信 AppID');
  if (!String(settings.wechatMchId || '').trim()) wechatMissing.push('微信商户号');
  if (!String(settings.wechatMchSerialNo || '').trim()) wechatMissing.push('微信商户证书序列号');
  if (!String(settings.wechatMchPrivateKey || '').trim()) wechatMissing.push('微信商户私钥');
  if (String(settings.wechatApiV3Key || '').length !== 32) wechatMissing.push('微信 API v3 密钥（32 个字符）');
  if (!String(settings.wechatPlatformCert || '').trim() && !String(settings.wechatPlatformPublicKey || '').trim()) wechatMissing.push('微信支付平台证书或公钥');
  if (String(settings.wechatPlatformPublicKey || '').trim() && !String(settings.wechatPlatformSerialNo || '').trim()) wechatMissing.push('微信支付公钥 ID');
  if (!callbackUrl('wechat', settings)) wechatMissing.push('公网 HTTPS 回调地址');

  return {
    alipay: { ready: alipayMissing.length === 0, missing: alipayMissing },
    wechat: { ready: wechatMissing.length === 0, missing: wechatMissing },
  };
}

function alipayContent(fields) {
  return Object.entries(fields).filter(([key, value]) => key !== 'sign' && key !== 'sign_type' && value !== undefined && value !== null && value !== '').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('&');
}
function signAlipay(fields, key) {
  const sign = createSign('RSA-SHA256'); sign.update(alipayContent(fields), 'utf8'); sign.end(); return sign.sign(key, 'base64');
}
export async function verifyAlipayNotify(fields, settings = {}) {
  if (fields.app_id !== String(settings.alipayAppId || '') || !fields.sign || (fields.sign_type && fields.sign_type !== 'RSA2')) return false;
  if (!String(settings.alipayPublicKey || '').trim()) return false;
  const verify = createVerify('RSA-SHA256'); verify.update(alipayContent(fields), 'utf8'); verify.end();
  return verify.verify(createPublicKey(settings.alipayPublicKey), Buffer.from(String(fields.sign), 'base64'));
}

async function callAlipay(method, bizContent, settings, notifyUrl = '') {
  const fields = { app_id: settings.alipayAppId, method, format: 'JSON', charset: 'utf-8', sign_type: 'RSA2', timestamp: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }), version: '1.0', biz_content: JSON.stringify(bizContent) };
  if (notifyUrl) fields.notify_url = notifyUrl;
  fields.sign = signAlipay(fields, createPrivateKey(settings.alipayPrivateKey));
  const response = await fetch(String(settings.alipayGateway || '').trim() || ALIPAY_GATEWAY_DEFAULT, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: new URLSearchParams(fields), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`支付宝接口 HTTP ${response.status}`);
  const payload = await response.json(), result = payload[`${method.replaceAll('.', '_')}_response`];
  if (!result || result.code !== '10000') throw new Error(result?.sub_msg || result?.msg || '支付宝接口调用失败');
  return result;
}
export async function createAlipayPayment({ orderId, totalCents, subject, settings }) {
  const timeout = `${Math.max(1, Number(settings.timeoutMinutes || 15))}m`;
  const result = await callAlipay('alipay.trade.precreate', { out_trade_no: orderId, total_amount: (totalCents / 100).toFixed(2), subject: String(subject).slice(0, 180), product_code: 'FACE_TO_FACE_PAYMENT', timeout_express: timeout, qr_code_timeout_express: timeout }, settings, callbackUrl('alipay', settings));
  if (!result.qr_code) throw new Error('支付宝没有返回支付二维码');
  return { qrUrl: result.qr_code, expiresAt: new Date(Date.now() + Number(settings.timeoutMinutes || 15) * 60_000).toISOString() };
}
export async function queryAlipayPayment(orderId, settings) {
  return callAlipay('alipay.trade.query', { out_trade_no: orderId }, settings);
}

function wechatPlatformKeyObject(settings, serial = '') {
  const cert = String(settings.wechatPlatformCert || '').trim();
  const publicPath = String(settings.wechatPlatformPublicKey || '').trim();
  if (cert) {
    const x509 = new X509Certificate(cert);
    if (serial && normalizeSerial(serial) !== normalizeSerial(x509.serialNumber)) throw new Error('微信支付平台证书序列号不匹配');
    return { key: x509.publicKey, serial: x509.serialNumber };
  }
  if (publicPath) {
    const sid = String(settings.wechatPlatformSerialNo || '').trim();
    if (serial && serial !== sid) throw new Error('微信支付公钥 ID 不匹配');
    return { key: createPublicKey(publicPath), serial: sid };
  }
  throw new Error('缺少微信支付平台证书或公钥');
}
async function verifyWechatSignature(headers, rawBody, settings) {
  const header = name => typeof headers.get === 'function' ? headers.get(name) : headers[name];
  const ts = String(header('wechatpay-timestamp') || ''), nonceValue = String(header('wechatpay-nonce') || ''), signature = String(header('wechatpay-signature') || ''), serial = String(header('wechatpay-serial') || '');
  if (!ts || !Number.isFinite(Number(ts)) || !nonceValue || !signature || !serial || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  try {
    const { key } = wechatPlatformKeyObject(settings, serial);
    const verify = createVerify('RSA-SHA256'); verify.update(`${ts}\n${nonceValue}\n${rawBody}\n`, 'utf8'); verify.end();
    return verify.verify(key, Buffer.from(signature, 'base64'));
  } catch { return false; }
}
async function callWechat(method, path, bodyObject, settings) {
  const body = bodyObject === undefined ? '' : JSON.stringify(bodyObject), ts = timestamp(), nonceValue = nonce();
  const key = createPrivateKey(settings.wechatMchPrivateKey);
  const sign = createSign('RSA-SHA256'); sign.update(`${method}\n${path}\n${ts}\n${nonceValue}\n${body}\n`, 'utf8'); sign.end();
  const signature = sign.sign(key, 'base64');
  const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${settings.wechatMchId}",nonce_str="${nonceValue}",timestamp="${ts}",serial_no="${settings.wechatMchSerialNo}",signature="${signature}"`;
  const response = await fetch(`${String(settings.wechatApiBase || '').trim() || WECHAT_API_BASE_DEFAULT}${path}`, { method, headers: { authorization, accept: 'application/json', 'content-type': 'application/json' }, body: body || undefined, signal: AbortSignal.timeout(15000) });
  const responseText = await response.text();
  let payload = {}; try { payload = JSON.parse(responseText); } catch {}
  if (!response.ok) throw new Error(payload.message || `微信支付接口 HTTP ${response.status}`);
  if (!await verifyWechatSignature(response.headers, responseText, settings)) throw new Error('微信支付应答验签失败');
  return payload;
}
export async function createWechatPayment({ orderId, totalCents, subject, settings }) {
  const timeout = Number(settings.timeoutMinutes || 15), expire = new Date(Date.now() + timeout * 60_000).toISOString();
  const result = await callWechat('POST', '/v3/pay/transactions/native', { appid: settings.wechatAppId, mchid: settings.wechatMchId, description: String(subject).slice(0, 120), out_trade_no: orderId, notify_url: callbackUrl('wechat', settings), time_expire: expire, amount: { total: totalCents, currency: 'CNY' } }, settings);
  if (!result.code_url) throw new Error('微信支付没有返回支付二维码');
  return { qrUrl: result.code_url, expiresAt: expire };
}
export async function queryWechatPayment(orderId, settings) {
  return callWechat('GET', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderId)}?mchid=${encodeURIComponent(settings.wechatMchId)}`, undefined, settings);
}
export async function decodeWechatNotify(headers, rawBody, settings) {
  if (!await verifyWechatSignature(headers, rawBody, settings)) throw new Error('微信支付回调验签失败');
  const payload = JSON.parse(rawBody), resource = payload.resource;
  if (payload.event_type !== 'TRANSACTION.SUCCESS' || resource?.algorithm !== 'AEAD_AES_256_GCM' || !resource.ciphertext) throw new Error('不是有效的微信支付成功通知');
  const encrypted = Buffer.from(resource.ciphertext, 'base64'), tag = encrypted.subarray(encrypted.length - 16), ciphertext = encrypted.subarray(0, encrypted.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(String(settings.wechatApiV3Key || ''), 'utf8'), Buffer.from(resource.nonce, 'utf8'));
  decipher.setAAD(Buffer.from(resource.associated_data || '', 'utf8')); decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}