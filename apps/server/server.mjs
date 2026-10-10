import Fastify from 'fastify';
import cors from '@fastify/cors';
import nodemailer from 'nodemailer';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep, dirname } from 'node:path';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';
import { loadEnvironment } from './env.mjs';
import { ensureSecretKey, hashPassword, verifyPassword, encryptSecret, decryptSecret } from './secret.mjs';
import { pool, query, one, many, transaction, productJson, readSetting, writeSetting } from './database.mjs';
import { paymentReadiness, createAlipayPayment, createWechatPayment, verifyAlipayNotify, decodeWechatNotify } from './payments.mjs';

await loadEnvironment();
await ensureSecretKey();
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const webDist = resolve(root, 'apps/web/dist');
const host = process.env.HOST || '127.0.0.1';
const frontendPort = Number(process.env.FRONTEND_PORT || 8001);
const backendPort = Number(process.env.BACKEND_PORT || 8002);
const viteDevServer = process.argv.includes('--dev-web');
const isProd = process.env.NODE_ENV === 'production';
const sessions = new Map(), captchas = new Map();
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon', '.woff2':'font/woff2', '.json':'application/json; charset=utf-8' };
const send = (reply, status, data, headers = {}) => { reply.code(status).header('content-type','application/json; charset=utf-8').header('cache-control','no-store'); for(const [name,value] of Object.entries(headers))reply.header(name,value); return reply.send(data); };
const fail = (reply, status, message) => send(reply, status, { error:message });
function cookieMap(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim()).filter(Boolean).map(v => { const i = v.indexOf('='); return [v.slice(0,i), decodeURIComponent(v.slice(i+1))]; })); }
function isSecureRequest(req) { return String(req.headers['x-forwarded-proto']||'')==='https' || Boolean(req.raw?.socket?.encrypted); }
function setSession(req, reply, token, name) { reply.header('Set-Cookie', `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${isSecureRequest(req)?'; Secure':''}`); }
function session(req, kind) { const token = cookieMap(req)[kind === 'admin' ? 'sg_admin' : 'sg_customer']; const value = token && sessions.get(token); if (value && Date.now() - value.created > 12*60*60*1000) { sessions.delete(token); return null; } return value?.kind === kind ? value : null; }
function normalizePhone(value) { return String(value||'').replace(/[\s()-]/g,''); }
function ownsOrder(customer,order) { return Boolean(customer&&((customer.email&&customer.email===order.email)||(customer.phone&&normalizePhone(customer.phone)===normalizePhone(order.phone)))); }
async function body(req) { return req.body ?? {}; }
function adminOnly(req,res) { if (!session(req,'admin')) { fail(res,401,'请先登录商家后台'); return false; } return true; }
function customerRequired(req,res) { const s=session(req,'customer'); if (s) return s; fail(res,401,'请先验证邮箱并登录账户'); return null; }
function constantTimeEqual(value,expected) { const a=Buffer.from(String(value)),b=Buffer.from(String(expected)); return a.length===b.length&&timingSafeEqual(a,b); }
function consumeCaptcha(b) { const captchaId=String(b.captchaId||''),challenge=captchas.get(captchaId); captchas.delete(captchaId); return Boolean(challenge&&challenge.expires>=Date.now()&&constantTimeEqual(String(b.captchaCode||''),challenge.code)); }
const cents = v => { const n=Number(v); if (!Number.isFinite(n)||n<0) throw new Error('金额格式不正确'); return Math.round(n*100); };
const safeText = v => String(v??'').replace(/[<>]/g,'').slice(0,500);
const nowIso = () => new Date().toISOString();
async function writeSystemLog(level,category,message,details={},actor='system',ip='') {
  await query('INSERT INTO system_logs(level,category,message,details,actor,ip) VALUES($1,$2,$3,$4::jsonb,$5,$6)',[level,category,safeText(message),JSON.stringify(details),safeText(actor),safeText(ip)]);
}
async function writeAudit(actor,action,targetType,targetId,details={},ip='') {
  await query('INSERT INTO audit_logs(actor,action,target_type,target_id,details,ip) VALUES($1,$2,$3,$4,$5::jsonb,$6)',[safeText(actor),safeText(action),safeText(targetType),safeText(targetId),JSON.stringify(details),safeText(ip)]);
}
const sensitivePaymentKeys=['alipayPrivateKey','wechatMchPrivateKey','wechatApiV3Key'];
async function getPaymentSettings() {
  const settings=await readSetting('payment');
  for(const key of sensitivePaymentKeys) if(settings[key]) settings[key]=decryptSecret(settings[key]);
  return settings;
}
async function setPaymentSettings(settings) {
  const stored={...settings};
  for(const key of sensitivePaymentKeys) stored[key]=stored[key]?encryptSecret(stored[key]):'';
  await writeSetting('payment',stored);
}
function normalizeVariants(input,productId,fallback) {
  const source=Array.isArray(input)?input:[{name:'默认规格',price:fallback.price,originalPrice:fallback.originalPrice,active:true}];
  if(!source.length)throw new Error('至少保留一个商品规格');
  const variants=source.map(item=>({
    id:String(item.id||`${productId}-v-${randomBytes(4).toString('hex')}`),
    name:safeText(item.name||'').trim().slice(0,80),
    priceCents:item.priceCents===undefined?cents(item.price):Number(item.priceCents),
    originalCents:item.originalCents===undefined?cents(item.originalPrice||0):Number(item.originalCents),
    active:item.active===false?0:1,
  }));
  if(variants.some(v=>!v.name||!Number.isInteger(v.priceCents)||v.priceCents<0||!Number.isInteger(v.originalCents)||v.originalCents<0))throw new Error('请填写规格名称和有效价格');
  if(!variants.some(v=>v.active))throw new Error('至少需要一个启用中的规格');
  if(new Set(variants.map(v=>v.id)).size!==variants.length)throw new Error('规格编号重复');
  return variants;
}
async function persistVariants(client,productId,variants) {
  const ids=[];
  for(const v of variants){
    const owner=await one('SELECT product_id FROM product_variants WHERE id=$1',[v.id],client);
    if(owner&&owner.product_id!==productId)throw new Error('规格编号冲突，请重新添加规格');
    await query(`INSERT INTO product_variants(id,product_id,name,price_cents,original_cents,active)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,price_cents=EXCLUDED.price_cents,
      original_cents=EXCLUDED.original_cents,active=EXCLUDED.active,updated_at=CURRENT_TIMESTAMP`,
      [v.id,productId,v.name,v.priceCents,v.originalCents,v.active],client);
    ids.push(v.id);
  }
  await query('UPDATE product_variants SET active=0,updated_at=CURRENT_TIMESTAMP WHERE product_id=$1 AND NOT(id=ANY($2::text[]))',[productId,ids],client);
}
async function sendOrderNotice(order,contact,contactType) {
  try {
    if(contactType==='email'){
      const cfg=await readSetting('mail');if(!cfg.enabled)return;
      const {SMTP_PASSWORD,SMTP_FROM}=process.env,host=process.env.SMTP_HOST||cfg.host,user=process.env.SMTP_USER||cfg.username;
      if(!host||!user||!SMTP_PASSWORD){await writeSystemLog('warn','notification','邮件通知未发送：请补充 SMTP 服务配置与 SMTP_PASSWORD',{orderId:order.id});return;}
      const transport=nodemailer.createTransport({host,port:Number(process.env.SMTP_PORT||cfg.port||587),secure:String(process.env.SMTP_SECURE||cfg.secure)==='true',auth:{user,pass:SMTP_PASSWORD},connectionTimeout:8000,greetingTimeout:8000,socketTimeout:12000});
      const lines=order.items.map(item=>`${item.product_name} / ${item.variant_name} × ${item.quantity}`).join('\n');
      const codes=order.cards?.length?`\n\n卡密：\n${order.cards.join('\n')}`:'';
      await transport.sendMail({from:{name:cfg.fromName||'闪购卡券',address:cfg.fromAddress||SMTP_FROM||user},to:contact,subject:cfg.subject||`订单已完成 ${order.id}`,text:`您好，您的订单已完成。\n订单号：${order.id}\n商品：\n${lines}\n实付金额：¥${order.total}${codes}\n请妥善保管卡密。`});
      await writeSystemLog('info','notification','订单邮件通知已发送',{orderId:order.id,contact});return;
    }
    if(contactType==='phone'){
      const cfg=await readSetting('sms');if(!cfg.enabled)return;
      const endpoint=cfg.endpoint||process.env.SMS_API_URL,token=process.env.SMS_API_TOKEN;
      if(!endpoint||!token){await writeSystemLog('warn','notification','短信通知未发送：请配置 SMS_API_URL 与 SMS_API_TOKEN',{orderId:order.id});return;}
      const message=`您的闪购订单 ${order.id} 已完成，实付 ¥${order.total}。请返回下单页面查看卡密。`;
      const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${token}`},body:JSON.stringify({to:contact,phone:contact,signName:cfg.signName||'闪购卡券',templateId:cfg.templateId||'order_notice',message,orderId:order.id,amount:order.total}),signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error(`短信服务返回 HTTP ${response.status}`);
      await writeSystemLog('info','notification','订单短信通知已发送',{orderId:order.id,contact});
    }
  }catch(error){try{await writeSystemLog('error','notification',`订单通知发送失败：${error.message}`,{orderId:order.id,contactType});}catch{}}
}

async function orderDetail(id, client=pool) {
  const o = await one('SELECT o.*,c.nickname FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=$1',[id],client);
  if (!o) return null;
  const items = (await many('SELECT i.*,p.delivery_type FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=$1',[id],client)).map(i=>({...i,product_name:safeText(i.product_name),variant_name:safeText(i.variant_name),unitPrice:(i.unit_price_cents/100).toFixed(2)}));
  const cards = (await many("SELECT code FROM cards WHERE order_id=$1 AND status='sold' ORDER BY id",[id],client)).map(x=>x.code);
  return { id:o.id, email:o.email||o.phone||o.contact, contact:o.contact||o.email||o.phone, contactType:o.contact_type||(o.phone?'phone':'email'), phone:o.phone, ipAddress:o.ip_address||'', nickname:o.nickname, status:o.status, paymentStatus:o.payment_status, totalCents:o.total_cents, total:(o.total_cents/100).toFixed(2), discountCents:o.discount_cents||0, paymentMethod:o.payment_method, paymentQr:o.payment_qr||null, paymentExpiresAt:o.payment_expires_at, createdAt:o.created_at, paidAt:o.paid_at, shippedAt:o.shipped_at, note:o.note, items, cards };
}
async function fulfill(id, client) {
  const items = await many('SELECT i.product_id,i.variant_id,i.quantity,p.delivery_type FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=$1',[id],client);
  const reservedRows=await many("SELECT id,code,variant_id FROM cards WHERE order_id=$1 AND status='reserved' ORDER BY id FOR UPDATE",[id],client),reservedByVariant=new Map();
  for(const card of reservedRows){const list=reservedByVariant.get(card.variant_id)||[];list.push(card);reservedByVariant.set(card.variant_id,list);}
  const selected=[]; let needsManual=false;
  for (const item of items) {
    if (item.delivery_type==='manual') { needsManual=true; continue; }
    const reserved=reservedByVariant.get(item.variant_id)||[],fromReserved=reserved.splice(0,Number(item.quantity));selected.push(...fromReserved);
    const missing=Number(item.quantity)-fromReserved.length;
    if(missing){const rows=await many("SELECT id,code FROM cards WHERE product_id=$1 AND variant_id=$2 AND status='ready' ORDER BY id LIMIT $3 FOR UPDATE",[item.product_id,item.variant_id,missing],client);if(rows.length<missing)throw new Error(`商品 ${item.product_id} 库存不足，暂不能完成发货`);selected.push(...rows);}
  }
  for (const card of selected) await query("UPDATE cards SET status='sold',order_id=$1 WHERE id=$2",[id,card.id],client);
  await query("UPDATE orders SET status=$1,payment_status='paid',paid_at=COALESCE(paid_at,$2),shipped_at=$3 WHERE id=$4",[needsManual?'paid_pending_delivery':'completed',nowIso(),needsManual?null:nowIso(),id],client);
}

async function reserveStock(orderId,items,client) {
  for(const item of items){
    if(item.variant.delivery_type==='manual')continue;
    const cards=await many("SELECT id FROM cards WHERE variant_id=$1 AND status='ready' ORDER BY id LIMIT $2 FOR UPDATE",[item.variant.id,item.quantity],client);
    if(cards.length<item.quantity)throw new Error(`${item.variant.product_name}（${item.variant.name}）库存不足`);
    for(const card of cards)await query("UPDATE cards SET status='reserved',order_id=$1 WHERE id=$2",[orderId,card.id],client);
  }
}

async function expireGatewayOrders() {
  const ids=await many("SELECT id FROM orders WHERE payment_method IN ('alipay','wechat') AND payment_status='pending' AND status='pending_payment' AND payment_expires_at<=CURRENT_TIMESTAMP ORDER BY payment_expires_at LIMIT 100");
  for(const {id} of ids)await transaction(async client=>{
    const order=await one("SELECT id FROM orders WHERE id=$1 AND payment_method IN ('alipay','wechat') AND payment_status='pending' AND status='pending_payment' AND payment_expires_at<=CURRENT_TIMESTAMP FOR UPDATE",[id],client);
    if(!order)return;
    await query("UPDATE cards SET status='ready',order_id=NULL WHERE order_id=$1 AND status='reserved'",[id],client);
    await query("UPDATE orders SET status='cancelled',payment_status='expired',payment_qr=NULL WHERE id=$1",[id],client);
  });
}

async function completeGatewayPayment(id,totalCents,transactionId) {
  const result=await transaction(async client=>{
    const order=await one('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[id],client);
    if(!order)throw new Error('支付回调对应订单不存在');
    if(!['alipay','wechat'].includes(order.payment_method))throw new Error('支付回调与订单支付方式不匹配');
    if(!Number.isInteger(Number(totalCents))||Number(order.total_cents)!==Number(totalCents))throw new Error('支付金额与订单金额不一致');
    if(order.payment_status==='paid')return {alreadyPaid:true,status:order.status};
    if(order.status!=='pending_payment')throw new Error('订单状态不允许完成支付');
    await query('UPDATE orders SET payment_transaction_id=$1 WHERE id=$2',[String(transactionId||'').slice(0,128),id],client);
    await fulfill(id,client);
    const updated=await one('SELECT status,payment_status FROM orders WHERE id=$1',[id],client);
    return {alreadyPaid:false,status:updated.status};
  });
  if(!result.alreadyPaid)try{await writeSystemLog('info','payment','真实支付成功并完成履约',{orderId:id,transactionId:String(transactionId||'').slice(0,64)});}catch{}
  return result;
}

async function orderLookupAllowed(req,order,token) {
  if(session(req,'admin')||ownsOrder(session(req,'customer'),order))return true;
  if(!token)return false;
  const row=await one('SELECT lookup_token_hash FROM orders WHERE id=$1',[order.id]);
  return Boolean(row?.lookup_token_hash&&constantTimeEqual(createHash('sha256').update(token).digest('hex'),row.lookup_token_hash));
}

async function api(req,res,url) {
  const p=url.pathname, method=req.method;
  if (p==='/api/health'&&method==='GET') return send(res,200,{ok:true,node:process.version,storage:'postgresql',database:process.env.PGDATABASE||'shangou_store'});
  if (p==='/api/auth/admin'&&method==='POST') {
    const b=await body(req); if(typeof b.username!=='string'||typeof b.password!=='string'||b.username.length>256||b.password.length>256)return fail(res,400,'请输入管理员用户名和密码');
    const row=await one('SELECT username,password_hash FROM admins WHERE username=$1',[b.username.trim()]);
    if(!row||!verifyPassword(b.password,row.password_hash))return fail(res,401,'管理员用户名或密码错误');
    const token=randomBytes(32).toString('hex'); sessions.set(token,{kind:'admin',username:row.username,created:Date.now()}); setSession(req,res,token,'sg_admin'); return send(res,200,{ok:true,username:row.username});
  }
  if (p==='/api/auth/logout'&&method==='POST') { const c=cookieMap(req),b=await body(req),kind=b.kind;const names=kind==='admin'?['sg_admin']:kind==='customer'?['sg_customer']:['sg_admin','sg_customer'];for(const name of names)sessions.delete(c[name]);res.header('Set-Cookie',names.map(name=>`${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`));return send(res,200,{ok:true}); }
  if (p==='/api/auth/me'&&method==='GET') { const customer=session(req,'customer');return send(res,200,{admin:Boolean(session(req,'admin')),customer:customer?.email||customer?.phone||null,customerType:customer?.email?'email':customer?.phone?'phone':null}); }
  if (p==='/api/auth/register'&&method==='POST') {
    const b=await body(req),account=String(b.account??'').trim(),password=String(b.password??''),emailLike=account.includes('@'),identifier=emailLike?account.toLowerCase():normalizePhone(account);
    if(emailLike?(identifier.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)):!/^\+?[\d\s-]{7,20}$/.test(account))return fail(res,400,'请输入有效的邮箱地址或手机号作为账号');
    if(password.length<6||password.length>128)return fail(res,400,'密码长度需为 6 到 128 位');
    if(!consumeCaptcha(b))return fail(res,400,'验证码不正确或已过期，请刷新后重试');
    const existing=await one(emailLike?'SELECT id,password_hash FROM customers WHERE email=$1':'SELECT id,password_hash FROM customers WHERE phone=$1',[identifier]);
    if(existing){
      if(existing.password_hash)return fail(res,409,'该账号已注册，请直接登录');
      await query('UPDATE customers SET password_hash=$1,last_seen=CURRENT_TIMESTAMP WHERE id=$2',[hashPassword(password),existing.id]);
    }else{
      await query(emailLike?'INSERT INTO customers(email,password_hash) VALUES($1,$2)':'INSERT INTO customers(phone,password_hash) VALUES($1,$2)',[identifier,hashPassword(password)]);
    }
    const token=randomBytes(32).toString('hex'); sessions.set(token,{kind:'customer',[emailLike?'email':'phone']:identifier,created:Date.now()}); setSession(req,res,token,'sg_customer');
    return send(res,200,{ok:true,contact:identifier,type:emailLike?'email':'phone'});
  }
  if (p==='/api/auth/login'&&method==='POST') {
    const b=await body(req),account=String(b.account??'').trim(),password=String(b.password??''),emailLike=account.includes('@'),identifier=emailLike?account.toLowerCase():normalizePhone(account);
    if(!emailLike&&!/^\+?[\d\s-]{7,20}$/.test(account))return fail(res,400,'请输入有效的邮箱地址或手机号作为账号');
    if(!password)return fail(res,400,'请输入密码');
    if(!consumeCaptcha(b))return fail(res,400,'验证码不正确或已过期，请刷新后重试');
    const row=await one(emailLike?'SELECT password_hash FROM customers WHERE email=$1':'SELECT password_hash FROM customers WHERE phone=$1',[identifier]);
    if(!row||!row.password_hash||!verifyPassword(password,row.password_hash))return fail(res,401,'账号或密码错误');
    const token=randomBytes(32).toString('hex'); sessions.set(token,{kind:'customer',[emailLike?'email':'phone']:identifier,created:Date.now()}); setSession(req,res,token,'sg_customer');
    return send(res,200,{ok:true,contact:identifier,type:emailLike?'email':'phone'});
  }
  if (p==='/api/products'&&method==='GET') {
    const q=url.searchParams.get('q')||'',category=url.searchParams.get('category')||'';
    const rows=await many('SELECT * FROM products WHERE active=1 AND ($1 = \'\' OR category=$2) AND ($3 = \'\' OR name ILIKE $4 OR description ILIKE $5) ORDER BY created_at DESC',[category,category,q,`%${q}%`,`%${q}%`]);
    return send(res,200,{products:await Promise.all(rows.map(row=>productJson(row)))});
  }
  if (p==='/api/payment-methods'&&method==='GET') { const settings=await getPaymentSettings(),readiness=await paymentReadiness(settings); return send(res,200,{methods:{alipay:settings.alipay!==false&&readiness.alipay.ready,wechat:settings.wechat!==false&&readiness.wechat.ready,demo:!isProd&&settings.demo!==false},configured:readiness,simulated:false}); }
  if (p==='/api/payments/alipay/notify'&&method==='POST') {
    const fields=req.body||{};
    try{
      if(!await verifyAlipayNotify(fields,await getPaymentSettings()))throw new Error('支付宝回调验签失败');
      if(!['TRADE_SUCCESS','TRADE_FINISHED'].includes(String(fields.trade_status||'')))return res.code(200).type('text/plain; charset=utf-8').send('success');
      const order=await one('SELECT id,total_cents,payment_method FROM orders WHERE id=$1',[String(fields.out_trade_no||'')]);
      if(!order||order.payment_method!=='alipay'||Math.round(Number(fields.total_amount)*100)!==Number(order.total_cents))throw new Error('支付宝回调订单或金额不匹配');
      await completeGatewayPayment(order.id,Math.round(Number(fields.total_amount)*100),fields.trade_no);
      return res.code(200).type('text/plain; charset=utf-8').send('success');
    }catch(error){req.log.warn({err:error},'支付宝支付通知校验失败');return res.code(400).type('text/plain; charset=utf-8').send('failure');}
  }
  if (p==='/api/payments/wechat/notify'&&method==='POST') {
    try{
      const paymentSettings=await getPaymentSettings();
      const payment=await decodeWechatNotify(req.headers,req.rawBody||'',paymentSettings);
      const order=await one('SELECT id,total_cents,payment_method FROM orders WHERE id=$1',[String(payment.out_trade_no||'')]);
      if(!order||order.payment_method!=='wechat'||payment.appid!==paymentSettings.wechatAppId||payment.mchid!==paymentSettings.wechatMchId||payment.trade_state!=='SUCCESS'||Number(payment.amount?.total)!==Number(order.total_cents))throw new Error('微信支付回调订单或金额不匹配');
      await completeGatewayPayment(order.id,Number(payment.amount.total),payment.transaction_id);
      return res.code(200).send({code:'SUCCESS',message:'成功'});
    }catch(error){req.log.warn({err:error},'微信支付通知校验失败');return res.code(400).send({code:'FAIL',message:'失败'});}
  }
  if (p==='/api/captcha'&&method==='GET') {
    const id=randomBytes(18).toString('hex'),code=String(randomInt(1000,10000));captchas.set(id,{code,expires:Date.now()+3*60_000});
    for(const [key,value] of captchas)if(value.expires<Date.now())captchas.delete(key);
    return send(res,200,{id,code,expiresIn:180});
  }
  if (p==='/api/orders'&&method==='GET') { const s=session(req,'customer'); if(!s)return fail(res,401,'请先登录账户查看订单'); const rows=await many(`SELECT o.id,o.status,o.payment_status,o.total_cents,o.created_at,COALESCE(STRING_AGG(DISTINCT CONCAT(i.product_name,' · ',i.variant_name),'、'),'') items FROM orders o LEFT JOIN order_items i ON i.order_id=o.id WHERE ($1<>'' AND o.email=$1) OR ($2<>'' AND regexp_replace(COALESCE(o.phone,''),'[[:space:]-]','','g')=$2) GROUP BY o.id ORDER BY o.created_at DESC`,[s.email||'',s.phone||'']); return send(res,200,{orders:rows.map(o=>({...o,total:(o.total_cents/100).toFixed(2)}))}); }
  const productMatch=p.match(/^\/api\/products\/([\w-]+)$/); if(productMatch&&method==='GET'){const r=await one('SELECT * FROM products WHERE id=$1 AND active=1',[productMatch[1]]);return r?send(res,200,{product:await productJson(r)}):fail(res,404,'商品不存在');}
  if (p==='/api/orders/checkout'&&method==='POST') {
    const b=await body(req),contact=String(b.contact??b.email??'').trim().slice(0,254),paymentMethod=String(b.paymentMethod||'demo'),items=Array.isArray(b.items)?b.items:[];
    if(!contact)return fail(res,400,'请填写邮箱或手机号');
    // The contact is intentionally not validated. Use the presence of @ only to
    // choose the notification channel; any non-empty value can still place an order.
    const emailLike=contact.includes('@'),email=emailLike?contact.toLowerCase():null,phone=emailLike?null:normalizePhone(contact),contactType=emailLike?'email':'phone';
    if(!['alipay','wechat','demo'].includes(paymentMethod))return fail(res,400,'请选择有效支付方式');
    const paymentSettings={alipay:true,wechat:true,demo:true,...await getPaymentSettings()};
    if(!paymentSettings[paymentMethod])return fail(res,400,'该支付方式暂未开放，请选择其他方式');
    if(paymentMethod==='demo'&&isProd)return fail(res,503,'生产环境已关闭本地演示支付');
    const readiness=await paymentReadiness(paymentSettings);
    if(paymentMethod!=='demo'&&!readiness[paymentMethod].ready)return fail(res,503,`${paymentMethod==='alipay'?'支付宝':'微信支付'}尚未配置完整，请管理员先补齐服务端密钥和 HTTPS 回调地址`);
    if(!items.length||items.length>30)return fail(res,400,'请选择要购买的商品');
    const lookupToken=randomBytes(32).toString('hex'),id=`SG${new Date().toISOString().replace(/\D/g,'').slice(0,14)}${randomInt(100,999)}`;
    let result;
    try {
      result=await transaction(async client=>{
        const normalized=[];let total=0;
        for(const it of items){
          const productId=String(it.productId||''),variantId=String(it.variantId||''),quantity=Number(it.quantity);
          if(!Number.isInteger(quantity)||quantity<1||quantity>25)throw new Error('购买数量需为 1 到 25');
          const variant=await one(`SELECT v.*,p.name AS product_name,p.delivery_type FROM product_variants v
            JOIN products p ON p.id=v.product_id WHERE v.id=$1 AND p.id=$2 AND p.active=1 AND v.active=1 FOR UPDATE OF v`,[variantId,productId],client);
          if(!variant)throw new Error('商品规格已下架，请重新选择');
          const stock=Number((await one("SELECT COUNT(*) n FROM cards WHERE variant_id=$1 AND status='ready'",[variantId],client)).n);
          if(variant.delivery_type!=='manual'&&stock<quantity)throw new Error(`${variant.product_name}（${variant.name}）库存不足`);
          normalized.push({variant,quantity});total+=Number(variant.price_cents)*quantity;
        }
        const minimum=Number(paymentSettings.minimumCents||0);if(total<minimum)throw new Error(`订单金额需达到 ¥${(minimum/100).toFixed(2)}`);
        const previousOrders=Number((await one('SELECT COUNT(*) n FROM orders WHERE contact=$1 OR email=$2 OR phone=$3',[contact,email,phone],client)).n);let discount=0;
        if(!previousOrders){const promo=await one("SELECT discount_cents FROM campaigns WHERE active=1 AND minimum_cents<=$1 AND (ends_at IS NULL OR ends_at>=CURRENT_DATE) ORDER BY discount_cents DESC LIMIT 1",[total],client);if(promo)discount=Math.min(total,Number(promo.discount_cents));}
        total-=discount;
        let customer;
        if(email)customer=await one(`INSERT INTO customers(email,nickname) VALUES($1,'') ON CONFLICT(email) DO UPDATE SET last_seen=CURRENT_TIMESTAMP RETURNING id`,[email],client);
        else if(phone)customer=await one(`INSERT INTO customers(phone,nickname) VALUES($1,'') ON CONFLICT(phone) DO UPDATE SET last_seen=CURRENT_TIMESTAMP RETURNING id`,[phone],client);
        else customer=await one(`INSERT INTO customers(nickname) VALUES('') RETURNING id`,[],client);
        const paymentExpiresAt=paymentMethod==='demo'?null:new Date(Date.now()+Number(paymentSettings.timeoutMinutes||15)*60_000).toISOString();
        await query(`INSERT INTO orders(id,customer_id,email,phone,contact,contact_type,ip_address,total_cents,discount_cents,payment_method,lookup_token_hash,payment_expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,customer.id,email,phone,contact,contactType,req.ip,total,discount,paymentMethod,createHash('sha256').update(lookupToken).digest('hex'),paymentExpiresAt],client);
        for(const x of normalized)await query(`INSERT INTO order_items(order_id,product_id,variant_id,product_name,variant_name,quantity,unit_price_cents)
          VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,x.variant.product_id,x.variant.id,x.variant.product_name,x.variant.name,x.quantity,x.variant.price_cents],client);
        if(paymentMethod==='demo')await fulfill(id,client);else await reserveStock(id,normalized,client);
        return await orderDetail(id,client);
      });
    } catch(error) { return fail(res,409,error.message||'订单提交失败'); }
    let finalOrder=result,payment=null;
    if(paymentMethod==='demo'){
      await writeSystemLog('info','checkout','顾客完成本地演示支付',{orderId:id,paymentMethod,items:result.items.length},'顾客',req.ip);
    }else{
      try{
        const title=result.items.map(item=>item.product_name).join('、')||'数字商品订单';
        payment=paymentMethod==='alipay'?await createAlipayPayment({orderId:id,totalCents:result.totalCents,subject:title,settings:paymentSettings}):await createWechatPayment({orderId:id,totalCents:result.totalCents,subject:title,settings:paymentSettings});
        await query('UPDATE orders SET payment_qr=$1,payment_expires_at=$2 WHERE id=$3',[payment.qrUrl,payment.expiresAt,id]);
        finalOrder=await orderDetail(id);
        await writeSystemLog('info','payment','已创建真实支付二维码',{orderId:id,paymentMethod},'顾客',req.ip);
      }catch(error){
        await transaction(async client=>{await query("UPDATE cards SET status='ready',order_id=NULL WHERE order_id=$1 AND status='reserved'",[id],client);await query("UPDATE orders SET status='cancelled',payment_status='failed' WHERE id=$1 AND payment_status='pending'",[id],client);});
        try{await writeSystemLog('error','payment','创建真实支付二维码失败',{orderId:id,paymentMethod,error:error.message},'system',req.ip);}catch{}
        return fail(res,502,`支付渠道暂不可用：${error.message}`);
      }
    }
    if(finalOrder.status==='completed')await sendOrderNotice(finalOrder,contact,contactType);
    return send(res,201,{order:finalOrder,lookupToken,simulated:paymentMethod==='demo',payment});
  }
  if (p==='/api/orders'&&method==='POST') return fail(res,410,'请使用前台单页结算完成订单。');
  const paymentStatusMatch=p.match(/^\/api\/orders\/([\w-]+)\/payment-status$/);if(paymentStatusMatch&&method==='GET'){
    const order=await orderDetail(paymentStatusMatch[1]);if(!order)return fail(res,404,'订单不存在');
    if(!await orderLookupAllowed(req,order,url.searchParams.get('token')||''))return fail(res,403,'请使用下单凭证或登录账户查看支付状态');
    return send(res,200,{order});
  }
  const orderMatch=p.match(/^\/api\/orders\/([\w-]+)(?:\/(pay-demo|cancel))?$/); if(orderMatch){const [,id,action]=orderMatch;
    if(method==='GET'){const o=await orderDetail(id);if(!o)return fail(res,404,'订单不存在');if(!await orderLookupAllowed(req,o,url.searchParams.get('token')||''))return fail(res,403,'请使用下单后保存的订单凭证查看此订单');return send(res,200,{order:o});}
    if(action==='pay-demo'&&method==='POST'){if(isProd)return fail(res,503,'尚未接入真实支付渠道，演示支付在生产环境已关闭');const o=await orderDetail(id);if(!o)return fail(res,404,'订单不存在');const s=session(req,'customer');if(!session(req,'admin')&&!ownsOrder(s,o))return fail(res,403,'请登录下单账户支付此订单');if(o.paymentStatus==='paid')return send(res,200,{order:o});if(o.status!=='pending_payment')return fail(res,409,'当前订单无法支付');try{await transaction(client=>fulfill(id,client));}catch(e){return fail(res,409,e.message);}return send(res,200,{order:await orderDetail(id),demo:true});}
    if(action==='cancel'&&method==='POST'){const o=await orderDetail(id);if(!o)return fail(res,404,'订单不存在');const s=session(req,'customer');if(!session(req,'admin')&&!ownsOrder(s,o))return fail(res,403,'请登录下单账户取消此订单');if(o.paymentStatus==='paid')return fail(res,409,'已支付订单请联系售后');await query("UPDATE orders SET status='cancelled' WHERE id=$1",[id]);return send(res,200,{ok:true});}
  }
  if(p==='/api/admin/dashboard'&&method==='GET'){if(!adminOnly(req,res))return;const today=new Date().toISOString().slice(0,10);const revenue=Number((await one("SELECT COALESCE(SUM(total_cents),0) n FROM orders WHERE payment_status='paid' AND created_at::date=$1::date",[today])).n);const orderCount=Number((await one('SELECT COUNT(*) n FROM orders WHERE created_at::date=$1::date',[today])).n);const pending=Number((await one("SELECT COUNT(*) n FROM orders WHERE status IN ('pending_payment','paid_pending_delivery')")).n);return send(res,200,{revenueCents:revenue,orders:orderCount,pending,views:0,products:Number((await one('SELECT COUNT(*) n FROM products WHERE active=1')).n),customers:Number((await one('SELECT COUNT(*) n FROM customers')).n)});}
  if(p==='/api/admin/products'&&method==='GET'){if(!adminOnly(req,res))return;return send(res,200,{products:await Promise.all((await many('SELECT * FROM products ORDER BY created_at DESC')).map(row=>productJson(row,true)))});}
  if(p==='/api/admin/products'&&method==='POST'){
    if(!adminOnly(req,res))return;const b=await body(req),name=safeText(b.name).trim(),category=safeText(b.category).trim();if(!name||!category)return fail(res,400,'商品名称和分类必填');const id=String(b.id||name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||`product-${randomBytes(3).toString('hex')}`);
    try{const variants=normalizeVariants(b.variants,id,{price:b.price,originalPrice:b.originalPrice||0}),lowest=variants.filter(v=>v.active).reduce((a,v)=>!a||v.priceCents<a.priceCents?v:a,null);await transaction(async client=>{await query('INSERT INTO products(id,name,category,description,price_cents,original_cents,icon,active,delivery_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,name,category,safeText(b.description||''),lowest.priceCents,lowest.originalCents,safeText(b.icon||'✦'),b.active===false?0:1,['card','manual'].includes(b.deliveryType)?b.deliveryType:'card'],client);await persistVariants(client,id,variants);});return send(res,201,{product:await productJson(await one('SELECT * FROM products WHERE id=$1',[id]),true)});}catch(e){return fail(res,409,e.message);}
  }
  const adminProduct=p.match(/^\/api\/admin\/products\/([\w-]+)$/);if(adminProduct){if(!adminOnly(req,res))return;const id=adminProduct[1];if(method==='PATCH'){const b=await body(req),old=await one('SELECT * FROM products WHERE id=$1',[id]);if(!old)return fail(res,404,'商品不存在');try{const variants=Array.isArray(b.variants)?normalizeVariants(b.variants,id,{price:old.price_cents/100,originalPrice:old.original_cents/100}):null,lowest=variants?.filter(v=>v.active).reduce((a,v)=>!a||v.priceCents<a.priceCents?v:a,null);await transaction(async client=>{await query('UPDATE products SET name=$1,category=$2,description=$3,price_cents=$4,original_cents=$5,icon=$6,active=$7,delivery_type=$8,updated_at=CURRENT_TIMESTAMP WHERE id=$9',[safeText(b.name??old.name),safeText(b.category??old.category),safeText(b.description??old.description),lowest?.priceCents??(b.price===undefined?old.price_cents:cents(b.price)),lowest?.originalCents??(b.originalPrice===undefined?old.original_cents:cents(b.originalPrice)),safeText(b.icon??old.icon),b.active===undefined?old.active:(b.active?1:0),['card','manual'].includes(b.deliveryType)?b.deliveryType:old.delivery_type,id],client);if(variants)await persistVariants(client,id,variants);});return send(res,200,{product:await productJson(await one('SELECT * FROM products WHERE id=$1',[id]),true)});}catch(e){return fail(res,400,e.message);}}if(method==='DELETE'){await query('UPDATE products SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=$1',[id]);return send(res,200,{ok:true});}}
  const adminOrderMatch=p.match(/^\/api\/admin\/orders\/([\w-]+)$/);if(adminOrderMatch&&method==='GET'){if(!adminOnly(req,res))return;const order=await orderDetail(adminOrderMatch[1]);return order?send(res,200,{order}):fail(res,404,'订单不存在');}
  if(p==='/api/admin/orders'&&method==='GET'){if(!adminOnly(req,res))return;const status=url.searchParams.get('status')||'',q=url.searchParams.get('q')||'';const rows=await many(`SELECT o.*,COALESCE(c.email,c.phone,o.contact) AS customer_contact,c.nickname,(SELECT STRING_AGG(product_name,'、') FROM order_items i WHERE i.order_id=o.id) items FROM orders o JOIN customers c ON c.id=o.customer_id WHERE ($1='' OR o.status=$2) AND ($3='' OR o.id ILIKE $4 OR COALESCE(o.email,'') ILIKE $5 OR COALESCE(o.phone,'') ILIKE $5 OR COALESCE(o.contact,'') ILIKE $5 OR c.nickname ILIKE $6) ORDER BY o.created_at DESC LIMIT 200`,[status,status,q,`%${q}%`,`%${q}%`,`%${q}%`]);return send(res,200,{orders:rows.map(o=>({...o,email:o.email||o.phone||o.contact,total:(o.total_cents/100).toFixed(2)}))});}
  const deliverMatch=p.match(/^\/api\/admin\/orders\/([\w-]+)\/(deliver|refund)$/);if(deliverMatch){if(!adminOnly(req,res))return;const [,id,action]=deliverMatch,order=await orderDetail(id);if(!order)return fail(res,404,'订单不存在');if(action==='deliver'&&method==='POST'){if(order.status!=='paid_pending_delivery')return fail(res,409,'当前订单不在待发货状态');const manualItems=order.items.filter(item=>item.delivery_type==='manual'),b=await body(req),codesIn=Array.isArray(b.codes)?b.codes.map(x=>String(x).trim()).filter(Boolean):[],need=manualItems.reduce((n,x)=>n+x.quantity,0);if(codesIn.length!==need)return fail(res,400,`请提供 ${need} 条卡密`);try{await transaction(async client=>{let offset=0;for(const item of manualItems)for(let i=0;i<item.quantity;i++)await query("INSERT INTO cards(product_id,variant_id,code,status,order_id) VALUES($1,$2,$3,'sold',$4)",[item.product_id,item.variant_id,codesIn[offset++],id],client);await query("UPDATE orders SET status='completed',payment_status='paid',paid_at=COALESCE(paid_at,$1),shipped_at=$2 WHERE id=$3",[nowIso(),nowIso(),id],client);});}catch(e){return fail(res,409,e.message);}const delivered=await orderDetail(id);await sendOrderNotice(delivered,delivered.contact,delivered.contactType);return send(res,200,{order:delivered});}if(action==='refund'&&method==='POST'){await query("UPDATE orders SET status='refunded',payment_status='refunded' WHERE id=$1",[id]);return send(res,200,{order:await orderDetail(id)});}}
  if(p==='/api/admin/inventory'&&method==='GET'){if(!adminOnly(req,res))return;const rows=await many("SELECT p.id,p.name,v.id variant_id,v.name variant_name,COUNT(c.id) FILTER (WHERE c.status='ready') available,COUNT(c.id) FILTER (WHERE c.status='reserved') reserved,COUNT(c.id) FILTER (WHERE c.status='sold') sold FROM products p JOIN product_variants v ON v.product_id=p.id LEFT JOIN cards c ON c.variant_id=v.id GROUP BY p.id,p.name,v.id,v.name,v.created_at ORDER BY p.name,v.created_at,v.id");return send(res,200,{inventory:rows});}
  if(p==='/api/admin/inventory/import'&&method==='POST'){if(!adminOnly(req,res))return;const b=await body(req),productId=String(b.productId||''),variantId=String(b.variantId||''),codesIn=String(b.codes||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(!await one('SELECT id FROM product_variants WHERE id=$1 AND product_id=$2',[variantId,productId]))return fail(res,404,'商品规格不存在');if(!codesIn.length||codesIn.length>10000)return fail(res,400,'请输入 1 到 10000 条卡密');let added=0;await transaction(async client=>{for(const code of codesIn){const r=await query('INSERT INTO cards(product_id,variant_id,code) VALUES($1,$2,$3) ON CONFLICT(product_id,code) DO NOTHING',[productId,variantId,code],client);added+=r.rowCount;}});return send(res,201,{added,duplicates:codesIn.length-added});}
  if(p==='/api/admin/customers'&&method==='GET'){if(!adminOnly(req,res))return;const q=url.searchParams.get('q')||'';const customers=await many(`SELECT c.id,c.email,c.phone,COALESCE(c.email,c.phone,(SELECT o.contact FROM orders o WHERE o.customer_id=c.id ORDER BY o.created_at DESC LIMIT 1),'') contact,(SELECT o.ip_address FROM orders o WHERE o.customer_id=c.id AND o.ip_address<>'' ORDER BY o.created_at DESC LIMIT 1) last_ip,c.nickname,c.created_at,c.last_seen,COUNT(o.id) orders,COALESCE(SUM(CASE WHEN o.payment_status='paid' THEN o.total_cents ELSE 0 END),0) spent_cents FROM customers c LEFT JOIN orders o ON o.customer_id=c.id WHERE ($1='' OR COALESCE(c.email,'') ILIKE $2 OR COALESCE(c.phone,'') ILIKE $2 OR c.nickname ILIKE $3) GROUP BY c.id ORDER BY c.last_seen DESC LIMIT 200`,[q,`%${q}%`,`%${q}%`]);return send(res,200,{customers});}
  if(p==='/api/admin/campaigns'&&method==='GET'){if(!adminOnly(req,res))return;return send(res,200,{campaigns:await many('SELECT * FROM campaigns ORDER BY created_at DESC')});}
  if(p==='/api/admin/campaigns'&&method==='POST'){if(!adminOnly(req,res))return;const b=await body(req),name=safeText(b.name).trim();if(!name)return fail(res,400,'活动名称必填');const created=await one('INSERT INTO campaigns(name,description,discount_cents,minimum_cents,ends_at,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[name,safeText(b.description||''),cents(b.discount||0),cents(b.minimum||0),b.endsAt||null,b.active===false?0:1]);return send(res,201,{campaign:await one('SELECT * FROM campaigns WHERE id=$1',[created.id])});}
  const camp=p.match(/^\/api\/admin\/campaigns\/(\d+)$/);if(camp&&method==='PATCH'){if(!adminOnly(req,res))return;const b=await body(req);await query('UPDATE campaigns SET name=COALESCE($1,name),description=COALESCE($2,description),active=COALESCE($3,active) WHERE id=$4',[b.name===undefined?null:safeText(b.name),b.description===undefined?null:safeText(b.description),b.active===undefined?null:(b.active?1:0),Number(camp[1])]);return send(res,200,{campaign:await one('SELECT * FROM campaigns WHERE id=$1',[Number(camp[1])])});}
  if(p==='/api/admin/reports'&&method==='GET'){if(!adminOnly(req,res))return;const daily=await many(`SELECT created_at::date AS "day",COUNT(*) orders,COALESCE(SUM(CASE WHEN payment_status='paid' THEN total_cents ELSE 0 END),0) revenue_cents FROM orders WHERE created_at>=CURRENT_DATE-INTERVAL '30 days' GROUP BY created_at::date ORDER BY "day"`);const categories=await many(`SELECT p.category,COUNT(DISTINCT o.id) orders,COALESCE(SUM(oi.quantity*oi.unit_price_cents),0) revenue_cents FROM order_items oi JOIN products p ON p.id=oi.product_id JOIN orders o ON o.id=oi.order_id WHERE o.payment_status='paid' GROUP BY p.category`);return send(res,200,{daily,categories});}
  if(p==='/api/admin/logs'&&method==='GET'){
    if(!adminOnly(req,res))return;
    const level=url.searchParams.get('level')||'',q=(url.searchParams.get('q')||'').toLowerCase(),kind=url.searchParams.get('kind')||'';
    const [systemRows,auditRows]=await Promise.all([
      many('SELECT id,level,category,message,details,actor,ip,created_at FROM system_logs ORDER BY created_at DESC LIMIT 500'),
      many('SELECT id,actor,action,target_type,target_id,details,ip,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 500'),
    ]);
    const logs=[
      ...systemRows.map(row=>({id:`system-${row.id}`,source:row.category==='checkout'?'顾客操作':'系统事件',actor:row.actor||'system',action:row.message,target_type:row.category,target_id:row.details?.orderId||'',details:row.details||{},ip:row.ip||'',level:row.level,created_at:row.created_at})),
      ...auditRows.map(row=>({id:`audit-${row.id}`,source:'管理员操作',actor:row.actor,action:row.action,target_type:row.target_type,target_id:row.target_id,details:row.details||{},ip:row.ip||'',level:'info',created_at:row.created_at})),
    ].filter(row=>(!level||row.level===level)&&(!kind||row.source===kind)&&(!q||`${row.source} ${row.actor} ${row.action} ${row.target_type} ${row.target_id} ${row.ip} ${JSON.stringify(row.details)}`.toLowerCase().includes(q))).sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime()).slice(0,500);
    return send(res,200,{logs});
  }
  if(p==='/api/admin/audit-logs'&&method==='GET'){if(!adminOnly(req,res))return;const q=url.searchParams.get('q')||'';const logs=await many(`SELECT id,actor,action,target_type,target_id,details,ip,created_at FROM audit_logs WHERE ($1='' OR actor ILIKE $2 OR action ILIKE $3 OR target_type ILIKE $4 OR target_id ILIKE $5) ORDER BY created_at DESC LIMIT 300`,[q,`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`]);return send(res,200,{logs});}
  if(p==='/api/admin/system-info'&&method==='GET'){
    if(!adminOnly(req,res))return;
    const memory=os.totalmem(),free=os.freemem(),processMemory=process.memoryUsage();
    let database={connected:false,name:'',version:'',size:'',error:'数据库暂不可用'};
    try{const row=await one('SELECT current_database() name,version() version,pg_size_pretty(pg_database_size(current_database())) size');database={connected:true,name:row.name,version:row.version,size:row.size};}catch{}
    return send(res,200,{capturedAt:nowIso(),runtime:{node:process.version,platform:`${process.platform} ${process.arch}`,hostname:os.hostname(),uptimeSeconds:Math.floor(process.uptime()),startedAt:new Date(Date.now()-process.uptime()*1000).toISOString()},system:{cpuCount:os.cpus().length,loadAverage:os.loadavg(),totalMemoryBytes:memory,freeMemoryBytes:free,usedMemoryBytes:memory-free},process:{rssBytes:processMemory.rss,heapUsedBytes:processMemory.heapUsed,heapTotalBytes:processMemory.heapTotal,externalBytes:processMemory.external},database,pool:{total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount}});
  }
  if(p==='/api/admin/notification-status'&&method==='GET'){if(!adminOnly(req,res))return;const mail=await readSetting('mail'),sms=await readSetting('sms');return send(res,200,{mailReady:Boolean((process.env.SMTP_HOST||mail.host)&&(process.env.SMTP_USER||mail.username)&&process.env.SMTP_PASSWORD),smsReady:Boolean((process.env.SMS_API_URL||sms.endpoint)&&process.env.SMS_API_TOKEN)});}
  if(p==='/api/admin/payment-status'&&method==='GET'){if(!adminOnly(req,res))return;return send(res,200,{configured:await paymentReadiness(await getPaymentSettings())});}
  if(p==='/api/admin/account'&&method==='POST'){
    if(!adminOnly(req,res))return;
    const adminSession=session(req,'admin'),b=await body(req);
    if(typeof b.currentPassword!=='string'||!b.currentPassword)return fail(res,400,'请输入当前密码');
    const row=await one('SELECT id,username,password_hash FROM admins WHERE username=$1',[adminSession.username]);
    if(!row||!verifyPassword(b.currentPassword,row.password_hash))return fail(res,401,'当前密码不正确');
    const username=(typeof b.username==='string'?b.username.trim():'')||row.username;
    const password=typeof b.password==='string'?b.password:'';
    if(username.length<2||username.length>64)return fail(res,400,'管理员用户名长度需为 2 到 64 位');
    if(password&&(password.length<6||password.length>128))return fail(res,400,'新密码长度需为 6 到 128 位');
    if(await one('SELECT id FROM admins WHERE username=$1 AND id<>$2',[username,row.id]))return fail(res,409,'该用户名已被使用');
    await query('UPDATE admins SET username=$1,password_hash=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3',[username,password?hashPassword(password):row.password_hash,row.id]);
    adminSession.username=username;
    await writeAudit(row.username,'修改管理员账户','admin',String(row.id),{username},req.ip);
    return send(res,200,{ok:true,username});
  }
  const settingsMatch=p.match(/^\/api\/admin\/settings(?:\/(store|payment|shipping|notifications|security|mail|sms))?$/);if(settingsMatch&&(method==='GET'||method==='PUT')){if(!adminOnly(req,res))return;const key=settingsMatch[1]||'store';if(key==='payment'){if(method==='GET')return send(res,200,{settings:await getPaymentSettings()});const next=await body(req);if(!next||typeof next!=='object'||Array.isArray(next))return fail(res,400,'设置格式不正确');await setPaymentSettings(next);return send(res,200,{settings:await getPaymentSettings()});}if(method==='GET')return send(res,200,{settings:await readSetting(key)});const next=await body(req);if(!next||typeof next!=='object'||Array.isArray(next))return fail(res,400,'设置格式不正确');await writeSetting(key,next);return send(res,200,{settings:await readSetting(key)});}
  return fail(res,404,'API 路由不存在');
}

function allowedOrigins() {
  const configured=process.env.FRONTEND_ORIGIN;
  const localOrigins=[
    `http://127.0.0.1:${frontendPort}`,
    `http://localhost:${frontendPort}`,
    `http://127.0.0.1:${backendPort}`,
    `http://localhost:${backendPort}`,
  ];
  return new Set([...localOrigins,...(configured?configured.split(',').map(x=>x.trim()).filter(Boolean):[])]);
}
const origins=allowedOrigins();
function originAllowed(request) {
  const origin=request.headers.origin;
  if(!origin)return true;
  if(origins.has(origin))return true;
  try{return new URL(origin).host===String(request.headers.host||'');}catch{return false;}
}
async function staticFile(req,reply,url,site) {
  let pathname;
  try { pathname=decodeURIComponent(url.pathname); } catch { return reply.code(400).send({error:'页面地址无效'}); }
  if(site==='admin'&&(pathname==='/'||pathname==='/admin'))return reply.code(302).header('location','/admin/').send();
  let file;
  if(site==='web') {
    if(pathname.startsWith('/assets/')) file=resolve(webDist,`.${pathname}`);
    else if(pathname==='/favicon.ico') file=resolve(webDist,`.${pathname}`);
    else file=resolve(webDist,'index.html');
  } else {
    if(pathname.startsWith('/assets/')) file=resolve(webDist,`.${pathname}`);
    else if(pathname==='/admin'||pathname.startsWith('/admin/')) file=resolve(webDist,'admin.html');
    else return reply.code(404).send({error:'页面不存在'});
  }
  if(file!==webDist&&!file.startsWith(webDist+sep))return reply.code(403).send({error:'路径无效'});
  const ext=extname(file).toLowerCase();if(!mime[ext])return reply.code(404).send({error:'页面不存在'});
  try{const info=await stat(file);if(!info.isFile())return reply.code(404).send({error:'页面不存在'});const data=await readFile(file);return reply.code(200).type(mime[ext]).header('cache-control',ext==='.html'?'no-store':'public, max-age=300').header('x-content-type-options','nosniff').header('referrer-policy','same-origin').send(data);}catch{return reply.code(503).send({error:'前端构建文件不存在，请先运行 npm run build'});}
}
const frontendServer=Fastify({logger:process.env.NODE_ENV!=='test'});
const backendServer=Fastify({logger:process.env.NODE_ENV!=='test'});
backendServer.removeContentTypeParser('application/json');
backendServer.addContentTypeParser('application/json',{parseAs:'string'},(request,payload,done)=>{request.rawBody=payload;try{done(null,payload?JSON.parse(payload):{})}catch(error){done(error)}});
backendServer.addContentTypeParser('application/x-www-form-urlencoded',{parseAs:'string'},(request,payload,done)=>{request.rawBody=payload;done(null,Object.fromEntries(new URLSearchParams(payload)))});
await backendServer.register(cors,{origin:(origin,callback)=>callback(null,!origin||origins.has(origin)),credentials:true,methods:['GET','POST','PUT','PATCH','DELETE','OPTIONS'],allowedHeaders:['content-type']});
backendServer.addHook('onResponse',async(request,reply)=>{
  const pathname=new URL(request.url,'http://localhost').pathname;
  if(!pathname.startsWith('/api/'))return;
  try{
    if(reply.statusCode>=400){const admin=session(request,'admin');const actor=admin?.username||(pathname.startsWith('/api/admin/')?'后台访客':pathname.startsWith('/api/orders')?'顾客':'访客');await writeSystemLog(reply.statusCode>=500?'error':'warn','api',`${request.method} ${pathname} 返回 ${reply.statusCode}`,{status:reply.statusCode},actor,request.ip);return;}
    if(pathname.startsWith('/api/admin/')&&['POST','PUT','PATCH','DELETE'].includes(request.method)){
      const parts=pathname.split('/').filter(Boolean);await writeAudit(session(request,'admin')?.username||'admin',`${request.method} ${pathname}`,parts[2]||'admin',parts[3]||'',{status:reply.statusCode},request.ip);
    }
    const customerAction=request.method!=='GET'&&(pathname==='/api/auth/register'||pathname==='/api/auth/login'||pathname==='/api/orders'||pathname==='/api/orders/checkout'||/^\/api\/orders\/[\w-]+\/(pay-demo|cancel)$/.test(pathname));
    if(customerAction&&pathname!=='/api/orders/checkout')await writeSystemLog('info','customer-action',`${request.method} ${pathname} 顾客操作成功`,{status:reply.statusCode},'顾客',request.ip);
  }catch(error){request.log.warn({err:error},'日志记录失败');}
});
async function handleApiRequest(request,reply,allowCrossOrigin) {
  if(allowCrossOrigin&&!originAllowed(request))return reply.code(403).send({error:'前台来源未获允许'});
  try{return await api(request,reply,new URL(request.url,'http://localhost'));}
  catch(error){request.log.error(error);return fail(reply,500,'服务器内部错误');}
}
frontendServer.all('/api/*',async(request,reply)=>handleApiRequest(request,reply,false));
frontendServer.get('/',async(request,reply)=>staticFile(request,reply,new URL(request.url,'http://localhost'),'web'));
frontendServer.get('/*',async(request,reply)=>staticFile(request,reply,new URL(request.url,'http://localhost'),'web'));
backendServer.get('/',async(request,reply)=>staticFile(request,reply,new URL(request.url,'http://localhost'),'admin'));
backendServer.get('/*',async(request,reply)=>staticFile(request,reply,new URL(request.url,'http://localhost'),'admin'));
backendServer.all('/api/*',async(request,reply)=>handleApiRequest(request,reply,true));

let shuttingDown=false,paymentExpiryTimer;
async function syncPaymentSettingsFromEnv() {
  // 把 .env 里的历史支付参数一次性迁移到数据库（只在数据库对应字段为空时执行），之后以后台数据库配置为准。
  try {
    const settings=await getPaymentSettings();
    const env=name=>String(process.env[name]||'').trim();
    const fileContent=async name=>{const value=env(name);if(!value)return'';try{return (await readFile(resolve(root,value),'utf8')).trim();}catch{return '';}};
    const moved=[];
    const set=(key,value)=>{if(!String(settings[key]||'').trim()&&value){settings[key]=value;moved.push(key);}};
    set('alipayAppId',env('ALIPAY_APP_ID'));set('alipayGateway',env('ALIPAY_GATEWAY'));set('alipayNotifyUrl',env('ALIPAY_NOTIFY_URL'));
    set('alipayPrivateKey',await fileContent('ALIPAY_PRIVATE_KEY_PATH'));set('alipayPublicKey',await fileContent('ALIPAY_PUBLIC_KEY_PATH'));
    set('wechatAppId',env('WECHAT_APP_ID'));set('wechatMchId',env('WECHAT_MCH_ID'));set('wechatMchSerialNo',env('WECHAT_MCH_SERIAL_NO'));
    set('wechatMchPrivateKey',await fileContent('WECHAT_MCH_PRIVATE_KEY_PATH'));set('wechatApiV3Key',env('WECHAT_API_V3_KEY'));
    set('wechatPlatformCert',await fileContent('WECHAT_PLATFORM_CERT_PATH'));set('wechatPlatformPublicKey',await fileContent('WECHAT_PLATFORM_PUBLIC_KEY_PATH'));
    set('wechatPlatformSerialNo',env('WECHAT_PLATFORM_SERIAL_NO'));set('wechatApiBase',env('WECHAT_API_BASE'));set('wechatNotifyUrl',env('WECHAT_NOTIFY_URL'));
    if(moved.length){await setPaymentSettings(settings);console.log('[payment] 支付参数已从环境变量迁移到数据库：'+moved.join('、'));}
  } catch(error) { console.error('[payment] 支付参数迁移失败：',error.message); }
}
async function shutdown(){if(shuttingDown)return;shuttingDown=true;if(paymentExpiryTimer)clearInterval(paymentExpiryTimer);const closing=[backendServer.close()];if(frontendServer.server.listening)closing.push(frontendServer.close());await Promise.all(closing);await pool.end();}
process.on('SIGINT',()=>shutdown().finally(()=>process.exit()));
process.on('SIGTERM',()=>shutdown().finally(()=>process.exit()));
try{
  await syncPaymentSettingsFromEnv();
  await expireGatewayOrders();
  paymentExpiryTimer=setInterval(()=>expireGatewayOrders().catch(error=>console.error('清理超时支付订单失败：',error.message)),30_000);paymentExpiryTimer.unref();
  const listeners=[backendServer.listen({port:backendPort,host})];
  if(!viteDevServer)listeners.push(frontendServer.listen({port:frontendPort,host}));
  await Promise.all(listeners);
  if(!viteDevServer)console.log(`顾客前台：http://${host}:${frontendPort}`);
  else console.log(`Vite 开发前台：http://${host}:${frontendPort}（由单独的 Vite 进程提供）`);
  console.log(`商家后台与 API：http://${host}:${backendPort}/admin`);
  console.log(`PostgreSQL 已连接：${process.env.PGDATABASE||'shangou_store'}@${process.env.PGHOST||'127.0.0.1'}:${process.env.PGPORT||5432}`);
}catch(error){console.error('服务启动失败：',error.message);await shutdown();process.exit(1);}
