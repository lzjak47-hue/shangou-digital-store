import pg from 'pg';
import { loadEnvironment } from './env.mjs';
import { hashPassword } from './secret.mjs';

await loadEnvironment();

const { Pool } = pg;
export const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'shangou_store',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD,
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const query = (text, values = [], client = pool) => client.query(text, values);
export const one = async (text, values = [], client = pool) => (await query(text, values, client)).rows[0] ?? null;
export const many = async (text, values = [], client = pool) => (await query(text, values, client)).rows;
export async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

await pool.query(`
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0), original_cents INTEGER NOT NULL DEFAULT 0,
  icon TEXT NOT NULL DEFAULT '✦', active SMALLINT NOT NULL DEFAULT 1, delivery_type TEXT NOT NULL DEFAULT 'card',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  original_cents INTEGER NOT NULL DEFAULT 0, active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY, email TEXT UNIQUE, phone TEXT UNIQUE, nickname TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, customer_id BIGINT NOT NULL REFERENCES customers(id), email TEXT, phone TEXT, contact TEXT, contact_type TEXT NOT NULL DEFAULT 'email', ip_address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending_payment', payment_status TEXT NOT NULL DEFAULT 'pending',
  total_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL DEFAULT 0, payment_method TEXT NOT NULL DEFAULT 'demo',
  lookup_token_hash TEXT, payment_qr TEXT, payment_expires_at TIMESTAMP, payment_transaction_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, paid_at TIMESTAMP, shipped_at TIMESTAMP, note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS cards (
  id BIGSERIAL PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), variant_id TEXT REFERENCES product_variants(id), code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','sold','disabled')),
  order_id TEXT REFERENCES orders(id), created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, code)
);
CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id), variant_id TEXT REFERENCES product_variants(id),
  product_name TEXT NOT NULL, variant_name TEXT NOT NULL DEFAULT '默认规格', quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS campaigns (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  discount_cents INTEGER NOT NULL DEFAULT 0, minimum_cents INTEGER NOT NULL DEFAULT 0,
  starts_at DATE, ends_at DATE, active SMALLINT NOT NULL DEFAULT 1, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS system_logs (
  id BIGSERIAL PRIMARY KEY, level TEXT NOT NULL DEFAULT 'info', category TEXT NOT NULL,
  message TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}'::jsonb, actor TEXT NOT NULL DEFAULT 'system', ip TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY, actor TEXT NOT NULL DEFAULT 'admin', action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '', target_id TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}'::jsonb, ip TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admins (
  id SMALLSERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_cards_product_status ON cards(product_id,status);
CREATE INDEX IF NOT EXISTS idx_variants_product_active ON product_variants(product_id,active);
CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
`);

// Migrate databases created by the phone-based prototype while preserving old orders.
await pool.query(`
ALTER TABLE customers ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE orders ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS contact TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS contact_type TEXT NOT NULL DEFAULT 'email';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS lookup_token_hash TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_qr TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_transaction_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ip_address TEXT NOT NULL DEFAULT '';
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_status_check;
ALTER TABLE cards ADD CONSTRAINT cards_status_check CHECK(status IN ('ready','reserved','sold','disabled'));
ALTER TABLE cards ADD COLUMN IF NOT EXISTS variant_id TEXT REFERENCES product_variants(id);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id TEXT REFERENCES product_variants(id);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_name TEXT NOT NULL DEFAULT '默认规格';
ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS actor TEXT NOT NULL DEFAULT 'system';
ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS ip TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_cards_variant_status ON cards(variant_id,status);
CREATE INDEX IF NOT EXISTS idx_orders_ip ON orders(ip_address);
CREATE INDEX IF NOT EXISTS idx_system_logs_ip ON system_logs(ip);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email_unique ON customers(email);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);
CREATE INDEX IF NOT EXISTS idx_orders_contact ON orders(contact);
`);

const seedProducts = [
  ['video-vip','影音平台月度会员','影音会员','高清观影 · 多端通用 · 自动发货',1580,2500,'▶'],
  ['music-vip','音乐平台豪华会员','影音会员','无损音质 · 专属歌单 · 自动发货',1290,1990,'♫'],
  ['cloud-plus','云存储高级版','软件服务','大容量空间 · 安全同步 · 即时开通',990,1590,'☁'],
  ['game-points','热门游戏点券','游戏充值','多档面额可选 · 充值快速到账',660,990,'✦'],
  ['office-pro','办公软件个人版','软件服务','正版授权 · 高效办公 · 即买即用',1990,2990,'▣'],
  ['read-month','阅读平台月卡','生活权益','畅读海量好书 · 每日更新',880,1280,'▤'],
  ['creator-pro','创作工具专业版','软件服务','创作效率加倍 · 多端权益同步',2500,3500,'✧'],
  ['game-season','热门游戏季卡','游戏充值','专属游戏权益 · 赛季畅玩',2990,3990,'♜']
];
for (const row of seedProducts) {
  await pool.query(`INSERT INTO products(id,name,category,description,price_cents,original_cents,icon)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING`, row);
  await pool.query(`INSERT INTO product_variants(id,product_id,name,price_cents,original_cents)
    VALUES($1,$2,'默认规格',$3,$4) ON CONFLICT(id) DO NOTHING`, [row[0]+'-default',row[0],row[4],row[5]]);
  for (let n = 1; n <= 25; n++) {
    await pool.query(`INSERT INTO cards(product_id,variant_id,code) VALUES($1,$2,$3) ON CONFLICT(product_id,code) DO NOTHING`, [row[0],row[0]+'-default', `DEMO-${row[0].toUpperCase()}-${String(n).padStart(4,'0')}`]);
  }
}

// Existing goods and cards receive a default specification without changing old orders.
await pool.query(`
INSERT INTO product_variants(id,product_id,name,price_cents,original_cents)
SELECT p.id || '-default',p.id,'默认规格',p.price_cents,p.original_cents FROM products p
ON CONFLICT(id) DO NOTHING;
UPDATE cards c SET variant_id=v.id FROM product_variants v
WHERE c.variant_id IS NULL AND v.product_id=c.product_id
  AND v.id=(SELECT id FROM product_variants x WHERE x.product_id=c.product_id ORDER BY x.created_at,x.id LIMIT 1);
UPDATE order_items i SET variant_id=v.id FROM product_variants v
WHERE i.variant_id IS NULL AND v.product_id=i.product_id
  AND v.id=(SELECT id FROM product_variants x WHERE x.product_id=i.product_id ORDER BY x.created_at,x.id LIMIT 1);
`);

const settings = {
  store: { name:'闪购严选旗舰店', phone:'400-800-2025', hours:'09:00 - 22:00', announcement:'欢迎来到闪购严选，数字商品自动发货。', status:'open' },
  payment: { alipay:true, wechat:true, demo:true, timeoutMinutes:15, minimumCents:100, provider:'real', publicBaseUrl:'' },
  mail: { enabled:false, host:'', port:587, secure:false, username:'', fromAddress:'', fromName:'闪购卡券', subject:'订单已完成 · 闪购卡券' },
  sms: { enabled:false, endpoint:'', signName:'闪购卡券', templateId:'order_notice' },
  shipping: { mode:'auto', failure:'queue', lowStock:20, message:'您的订单已发货，请在订单详情中查看卡密。' },
  notifications: { newOrder:'站内通知 + 短信', refund:'站内通知 + 短信', inventory:'站内通知 + 邮件', email:'store@example.com', phone:'13800005621' },
  security: { twoFactor:true, childAccountPolicy:'主账号管理设置，运营人员管理商品和订单' }
};
for (const [key, value] of Object.entries(settings)) {
  await pool.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING', [key, JSON.stringify(value)]);
}
await pool.query(`INSERT INTO campaigns(name,description,discount_cents,minimum_cents,ends_at)
  SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS(SELECT 1 FROM campaigns)`, ['新客首单立减 ¥5','新用户下单自动抵扣，提升首次购买转化。',500,0,'2026-10-31']);

// 管理员账户存数据库，密码以 scrypt 哈希保存；env 的 ADMIN_USERNAME/ADMIN_PASSWORD 仅用于首次初始化。
{
  const existing = await one('SELECT username FROM admins LIMIT 1');
  if (!existing) {
    const username = safeAdminName(process.env.ADMIN_USERNAME || 'admin');
    const password = process.env.ADMIN_PASSWORD || 'admin123456';
    await query('INSERT INTO admins(username,password_hash) VALUES($1,$2)', [username, hashPassword(password)]);
  }
}
function safeAdminName(value) { return String(value || 'admin').trim().slice(0, 64); }

export async function productJson(row, includeInactive = false) {
  if (!row) return null;
  const variants = await many(`SELECT v.id,v.name,v.price_cents,v.original_cents,v.active,v.created_at,
    COUNT(c.id) FILTER (WHERE c.status='ready') AS stock
    FROM product_variants v LEFT JOIN cards c ON c.variant_id=v.id
    WHERE v.product_id=$1 AND ($2::boolean OR v.active=1)
    GROUP BY v.id ORDER BY v.created_at,v.id`, [row.id,includeInactive]);
  const activeVariants = variants.filter(v=>Boolean(v.active));
  const pricedVariants = activeVariants.length ? activeVariants : variants;
  const lowest = pricedVariants.reduce((best,v)=>!best||Number(v.price_cents)<Number(best.price_cents)?v:best,null);
  const stock = variants.reduce((sum,v)=>sum+Number(v.stock),0);
  const safe = v => String(v ?? '').replace(/[<>]/g, '').slice(0, 1000);
  return { id:row.id, name:safe(row.name), category:safe(row.category), description:safe(row.description), priceCents:lowest?.price_cents??row.price_cents,
    price:(Number(lowest?.price_cents??row.price_cents)/100).toFixed(2), originalCents:lowest?.original_cents??row.original_cents,
    icon:String(row.icon ?? '✦').replace(/[<>&"']/g,'').slice(0,4), active:Boolean(row.active), deliveryType:row.delivery_type, stock,
    variants:variants.map(v=>({id:v.id,name:safe(v.name),priceCents:Number(v.price_cents),price:(Number(v.price_cents)/100).toFixed(2),originalCents:Number(v.original_cents),active:Boolean(v.active),stock:Number(v.stock)})) };
}
export async function readSetting(key) {
  const row = await one('SELECT value FROM settings WHERE key=$1', [key]);
  return row ? JSON.parse(row.value) : {};
}
export async function writeSetting(key,value) {
  await query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', [key,JSON.stringify(value)]);
}
