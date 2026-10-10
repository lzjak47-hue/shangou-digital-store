# 项目 Code Wiki · 闪购卡券（数字商品商城）

> 版本：v1.0.0 ｜ 生成日期：2026-10-10 ｜ 用途：项目交接与理解文档
>
> 本仓库是一个「数字商品发卡商城」，含顾客前台（免注册购买）、商家后台、Node.js 服务端与 PostgreSQL 数据库。本文档对整体架构、模块职责、关键类/函数、依赖关系及运行方式做了结构化梳理，并在末尾记录了遗留清理情况与剩余待办事项。

---

## 1. 项目概览

- **项目名**：`shangou-digital-store`（闪购卡券 · 数字商品商城）
- **形态**：pnpm workspace 单仓（monorepo），含 `apps/web`（前端）与 `apps/server`（后端）两个应用。
- **业务定位**：卖数字权益/卡密类商品（视频会员、游戏点券、软件服务等）。顾客无需注册、不验证邮箱/手机号即可下单；支付成功后按规格自动从卡密池扣库存发卡，也支持「人工发货」类商品。
- **核心能力**：
  - 商品多规格（variant）管理，每个规格独立价格、独立卡密池与库存；
  - 结算（免登录、免验证码，仅填写邮箱/手机号作为通知与订单归集标识）；
  - 支付渠道：支付宝当面付（precreate 二维码）、微信 Native 扫码（API v3）、本地演示支付；渠道参数存数据库、后台可改；
  - 账户体系：邮箱/手机号作为账号 + 密码 + 数字验证码注册/登录（不发短信/邮件验证码），登录可选；
  - 商家后台（订单、商品、库存、客户、营销、报表、日志、审计、各类设置）；管理员账户存数据库、可改密；
  - 邮件（SMTP / nodemailer）与短信（HTTP JSON API）订单通知。

---

## 2. 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19、TypeScript 7、Vite 8、React Router 7、Lucide React、qrcode |
| 后端 | Node.js ≥ 24、Fastify 5、@fastify/cors、nodemailer |
| 数据库 | PostgreSQL（`pg` 驱动），连接池 `Pool` |
| 包管理 | pnpm workspace（根声明 `packages: apps/*`） |
| 运行环境 | `type: module`（ESM），Windows / Linux 均可 |

> 注：外层 `package.json` 的脚本用的是 `npm`（`npm run build --prefix apps/web`、`node apps/server/server.mjs`），而仓库同时存在 `pnpm-workspace.yaml` 与锁文件 `pnpm-lock.yaml`，属于两套包管理混用的现场，详见第 11 节。

---

## 3. 整体架构

```
                          ┌────────────────────────────────────────────┐
       浏览器 (顾客)        │             apps/web（React + Vite）        │
  http://host:8001/  ──────▶│  index.html → src/main.tsx (顾客前台)       │
                            │  admin.html → src/admin-main.tsx (商家后台) │
                            └────────────────────────────────────────────┘
                                            │ 构建产物 dist/{index,admin}.html + assets
                                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    apps/server（Node.js + Fastify）                     │
│                                                                        │
│  frontendServer (8001)  —— 静态托管顾客前台 dist/index.html            │
│  backendServer  (8002)  —— /admin/* 静态托管后台 dist/admin.html        │
│                             /api/*  提供全部 HTTP 接口                  │
│                                                                        │
│   server.mjs (入口/路由)  database.mjs (DB)  payments.mjs (支付)  env.mjs │
└────────────────────────────────────────────────────────────────────────┘
                     │  pg Pool
                     ▼
             PostgreSQL 数据库 (shangou_store)
  表：products / product_variants / customers / orders / order_items /
      cards / settings / campaigns / system_logs / audit_logs
```

**关键架构决策：**

1. **双 Fastify 实例**：`server.mjs` 里同时创建 `frontendServer`（8001，只托管静态前台）与 `backendServer`（8002，托管后台静态页 + API）。这样可以独立设置端口与 CORS，后台与前台互不干扰。
2. **前端两个入口打包**：`vite.config.ts` 用 `rollupOptions.input` 把 `index.html`（顾客）和 `admin.html`（后台）都打进 `dist`。后台路由通过 `BrowserRouter basename="/admin"` 挂载。
3. **开发模式**：`--dev-web` 参数时后端不再托管 8001，交由独立 Vite 进程（`npm run dev:web`）提供 HMR；Vite 通过 `admin-entry-rewrite` 中间件把 `/admin/*` 重写到 `/admin.html`。
4. **API 全部集中在一个函数**：`api(req, res, url)` 里用 `pathname + method` 手动路由分发，而非 Fastify 的声明式路由，便于统一做鉴权、参数校验与错误返回。

---

## 4. 目录结构

```
outputs/                             项目根（也是 pnpm workspace 根）
├─ package.json                      根脚本（build / start / dev / dev:web），engines>=24
├─ pnpm-workspace.yaml               workspace 声明
├─ pnpm-lock.yaml                    锁文件
├─ README.md                         项目说明（PostgreSQL、运行、支付/通知配置）
├─ .env / .env.example               数据库/管理员/支付/通知 环境变量（.env 已忽略）
├─ .gitignore
├─ apps/
│  ├─ web/                           前端应用 @shangou/web
│  │  ├─ index.html                  顾客前台入口 → /src/main.tsx
│  │  ├─ admin.html                  商家后台入口 → /src/admin-main.tsx
│  │  ├─ vite.config.ts              Vite 配置（双入口、8001、/admin 重写）
│  │  ├─ tsconfig.json
│  │  ├─ package.json
│  │  ├─ dist/                       构建产物（由服务端托管）
│  │  └─ src/
│  │     ├─ main.tsx                 顾客前台：路由装配 + 各页面组件 + App 入口
│  │     ├─ shared.tsx               购物车上下文、StoreLayout、商品卡片等公共组件
│  │     ├─ checkout-modal.tsx       结算弹窗（下单核心交互）
│  │     ├─ purchase.tsx             AccountPage：登录/注册 + 订单列表
│  │     ├─ payment-qr.tsx           用 qrcode 生成支付二维码
│  │     ├─ admin-main.tsx           商家后台：全部页面 + AdminApp 入口
│  │     ├─ admin-login.tsx          管理员用户名/密码登录页
│  │     ├─ admin-payment.tsx        支付设置页（真实渠道配置状态）
│  │     ├─ api.ts                   类型定义 + fetch 封装（API_BASE 指向 8002）
│  │     ├─ styles.css / clarity.css 全局样式
│  │     └─ vite-env.d.ts
│  └─ server/                        后端应用 @shangou/server
│     ├─ server.mjs                  ★ 服务端主入口（路由/鉴权/业务/静态托管）
│     ├─ database.mjs                ★ 连接池 + 建表/迁移/种子 + 查询辅助
│     ├─ payments.mjs                ★ 支付宝/微信 签名、下单、回调验签（settings 驱动）
│     ├─ secret.mjs                  密码哈希（scrypt）+ 密钥加密（AES-256-GCM）+ SECRET_KEY 管理
│     ├─ env.mjs                     自研 .env 加载器
│     └─ package.json
└─ node_modules/                     workspace 依赖
```

> 标注 ★ 的是核心文件，接手时优先阅读。

---

## 5. 服务端模块（apps/server）

### 5.1 `server.mjs` —— 入口、鉴权、路由、业务、静态托管

服务端唯一入口，共约 426 行，承担了绝大部分逻辑。启动时先 `loadEnvironment()`，再初始化两个 Fastify 实例、注册 CORS、定义 JSON 解析器（保留 `rawBody` 供微信回调验签用）、注册全局 `onResponse` 日志钩子、注册路由、启动监听。

**通用工具函数**

| 函数 | 职责 |
| --- | --- |
| `send(reply, status, data, headers)` | 统一 JSON 响应（`no-store` + JSON 头） |
| `fail(reply, status, message)` | 统一错误响应 `{ error }` |
| `cookieMap(req)` | 解析 Cookie 为对象 |
| `setSession(reply, token, name)` | 写 HttpOnly + SameSite=Lax Cookie（生产加 Secure） |
| `session(req, kind)` | 从 Cookie + 内存 `sessions` Map 恢复会话（12h 过期），`kind ∈ 'admin'\|'customer'` |
| `adminOnly(req,res)` | 后台鉴权守卫；未登录返回 401 |
| `customerRequired(req,res)` | 顾客会话守卫 |
| `constantTimeEqual(a,b)` | 常量时间比较（防时序攻击） |
| `cents(v)` | 元 → 分（`Math.round(n*100)`，校验非负） |
| `safeText(v)` | 剥离 `<>`，截断到 500 字，防 XSS |
| `nowIso()` | 当前 ISO 时间串 |
| `writeSystemLog(...)` | 写 `system_logs` |
| `writeAudit(...)` | 写 `audit_logs` |

**业务函数**

| 函数 | 职责 |
| --- | --- |
| `normalizeVariants(input, productId, fallback)` | 规范化商品规格输入，校验名称/价格/编号唯一/至少一个启用 |
| `persistVariants(client, productId, variants)` | UPSERT 规格，并把未交回的规格置为停用 |
| `sendOrderNotice(order, contact, contactType)` | 订单完成后发邮件（SMTP）或短信（HTTP JSON）通知 |
| `orderDetail(id, client)` | 组装订单详情（含 items、卡密、格式化的金额/状态） |
| `fulfill(id, client)` | 履约：把 reserved 卡密置为 sold，处理人工发货（`paid_pending_delivery`） |
| `reserveStock(orderId, items, client)` | 真实支付下单时锁定卡密为 `reserved` |
| `expireGatewayOrders()` | 定时清理超时未支付的网关卡密订单 |
| `completeGatewayPayment(id, totalCents, transactionId)` | 回调验签后完成支付：校验金额/渠道 → `fulfill` |
| `orderLookupAllowed(req, order, token)` | 订单可见性判断（管理员/登录顾客/订单凭证 token） |
| `ownsOrder(customer, order)` | 判断订单是否归属某顾客（按邮箱/手机号） |
| `consumeCaptcha(b)` | 校验并消费注册/登录的数字验证码 |
| `getPaymentSettings()` / `setPaymentSettings(s)` | 读取/保存支付设置（读取时解密、保存时加密敏感字段） |
| `syncPaymentSettingsFromEnv()` | 启动时把 `.env` 里的历史支付参数一次性迁入数据库 |
| `api(req, res, url)` | ★ 核心路由函数，见下方接口清单 |
| `allowedOrigins()` | 组装 CORS 白名单（本地 + `FRONTEND_ORIGIN`） |
| `staticFile(req, reply, url, site)` | 静态托管（顾客/后台），含路径穿越防护 |
| `shutdown()` | 优雅停机（关 HTTP、清定时器、`pool.end()`） |

**会话与鉴权要点**

- 会话存**内存** `Map`（`sessions`），重启即失效；管理员会话 cookie 名 `sg_admin`，顾客为 `sg_customer`。
- 管理员凭证存 `admins` 表：密码用 `scrypt` 加盐哈希（`secret.mjs`），`POST /api/auth/admin` 查表 + `verifyPassword`；`POST /api/admin/account` 校验当前密码后可改用户名/密码。
- 顾客注册/登录：账号为邮箱或手机号，密码 + 4 位数字验证码（`/api/captcha` 签发，内存 Map，3 分钟过期）；`/api/auth/register`、`/api/auth/login`。注册时若该邮箱/手机号已有无密码的游客记录则绑定密码，否则新建 customers。
- 数字验证码 `captcha` 存内存 Map；下单不再需要验证码。

### 5.2 `database.mjs` —— 连接池、建表迁移、种子、查询辅助

- `pool`：`pg.Pool`，从 `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD` 等环境变量读取（默认 `127.0.0.1:5432/shangou_store`）。
- `query/one/many`：单查询 / 单行 / 多行便捷封装。
- `transaction(work)`：BEGIN/COMMIT/ROLLBACK 事务封装。
- 模块加载时即执行 **DDL 建表 + 迁移 + 种子数据**（幂等，`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`）。
- `productJson(row, includeInactive)`：把商品及其规格、库存聚合成前端所需结构（价格元/分、起售最低价、库存汇总、`<>` 转义）。
- `readSetting(key)` / `writeSetting(key, value)`：`settings` 表的通用 JSON 读写。
- 种子内容：8 个演示商品、每个 25 条 `DEMO-*` 卡密、默认 `settings`（store/payment/mail/sms/shipping/notifications/security）、1 条首单立减活动、首个管理员（`admins` 表为空时用 env 的 `ADMIN_USERNAME/ADMIN_PASSWORD` 或默认 `admin/admin123456` 初始化，密码 scrypt 哈希）。

### 5.3 `payments.mjs` —— 支付宝 & 微信支付

参数**全部来自数据库 `settings.payment`**（服务端解密后传入函数），不再依赖环境变量；`.env` 里的历史支付参数仅在数据库为空时启动迁移一次。敏感字段（支付宝商户私钥、微信商户私钥、API v3 密钥）在数据库中 AES-256-GCM 加密存储（密钥来自 `.env` 的 `SECRET_KEY`，首次启动自动生成）。

**支付宝（当面付 precreate + RSA2 回调验签）**

| 函数 | 职责 |
| --- | --- |
| `pathReady(name)` | 校验环境变量指向的证书/密钥文件是否存在 |
| `callbackUrl(provider, settings)` | 组装 HTTPS 回调 URL（要求 https，否则返回空） |
| `paymentReadiness(settings)` | 检查两家渠道参数是否齐备，返回 `{alipay,wechat}` 的 `ready/missing` |
| `signAlipay(fields, key)` | 按 key 排序拼接 + RSA-SHA256 签名 |
| `verifyAlipayNotify(fields)` | 回调验签（校验 app_id、sign_type=RSA2、公钥验签） |
| `callAlipay(method, bizContent, notifyUrl)` | 调网关（`openapi.alipay.com`），校验 `code==='10000'` |
| `createAlipayPayment({orderId,totalCents,subject,settings})` | 创建 `alipay.trade.precreate` 二维码 |
| `queryAlipayPayment(orderId)` | `alipay.trade.query` 查单 |

**微信支付（Native API v3 + 报文验签 + AES-GCM 解密回调）**

| 函数 | 职责 |
| --- | --- |
| `wechatPlatformKey(serial)` | 读取平台证书/公钥并校验序列号 |
| `verifyWechatSignature(headers, rawBody)` | 应答/回调验签（`timestamp\n nonce\n body\n`，RSA-SHA256） |
| `callWechat(method, path, body)` | 请求 `api.mch.weixin.qq.com`，构造 `WECHATPAY2-SHA256-RSA2048` 鉴权头 |
| `createWechatPayment(...)` | `POST /v3/pay/transactions/native` 生成 Native 码 |
| `queryWechatPayment(orderId)` | 按商户单号查单 |
| `decodeWechatNotify(headers, rawBody)` | 验签 + `AEAD_AES_256_GCM` 解出通知明文 |

### 5.4 `env.mjs` —— `.env` 加载器

自研轻量加载器：`loadEnvironment()` 只执行一次，读取项目根 `.env`（`KEY=VALUE` 格式，支持引号），**不覆盖已存在的 `process.env`**。

---

## 6. 前端模块（apps/web/src）

前端为 React 单页应用，构建后由服务端静态托管。`api.ts` 中 `API_BASE = ${host}:8002`，所有请求带 `credentials:'include'`。

### 6.1 顾客前台（入口 `main.tsx`）

| 文件 / 模块 | 职责 |
| --- | --- |
| `api.ts` | `Product` / `ProductVariant` / `Order` 类型 + `api()` 封装 + `money()`/`escapeHtml()` 工具；常量 `API_BASE` |
| `shared.tsx` | `CartProvider`（localStorage 持久化购物车，`shangouCartLines`）、`useCart`、`StoreLayout`、`PageIntro`、`ProductCard`、`ProductGrid`、`Benefits`、`Toast`、`useProducts` |
| `main.tsx` | 页面组件与路由：`HomePage`、`CatalogPage`、`ProductPage`、`CartPage`、`OrderDetailPage`、`HelpPage`、`CheckoutRedirect`、`NotFound`；`App` 入口（`BrowserRouter` + `CartProvider`） |
| `checkout-modal.tsx` | 结算弹窗 `CheckoutModal`：加载支付方式 → 选规格/数量/支付方式 → POST `/api/orders/checkout` → 展示结果/二维码/卡密；每 4s 轮询支付状态（无验证码） |
| `purchase.tsx` | `LoginPage`（账号密码+验证码登录）、`RegisterPage`（注册）、`AccountPage`（登录态/游客订单列表） |
| `payment-qr.tsx` | `PaymentQr`：用 `qrcode` 把支付 URL 渲染成 `<img>` |

**顾客页面路由**（`BrowserRouter` 无 basename）：

| 路径 | 页面 |
| --- | --- |
| `/` | 首页 |
| `/products` | 商品目录（筛选/搜索） |
| `/product/:id` | 商品详情 |
| `/cart` | 购物车 |
| `/checkout` | 触发结算弹窗后回首页 |
| `/account` | 账户与订单（未登录显示注册/登录入口） |
| `/orders` | 订单列表（账户+游客） |
| `/login` | 登录页（账号密码+验证码） |
| `/register` | 注册页（账号密码+验证码，不发短信/邮件） |
| `/orders/:id` | 订单详情（卡密查看） |
| `/help` | 帮助中心 |

### 6.2 商家后台（入口 `admin-main.tsx`）

| 文件 / 模块 | 职责 |
| --- | --- |
| `admin-main.tsx` | `AdminApp` 入口（`BrowserRouter basename="/admin"`）、`AdminGuard` 鉴权守卫、`AdminFrame` 布局（侧边栏/顶栏）、以及全部业务页面组件 |
| `admin-login.tsx` | `UsernameAdminLogin` 管理员登录页 |
| `admin-payment.tsx` | `PaymentSettingsPage` 支付设置页 |

后台主要页面组件（均在 `admin-main.tsx` 内定义，通过 `AdminGuard` 内的 `<Routes>` 挂载）：

`DashboardPage`（总览）、`OrdersPage` / `OrderPage`（订单管理/详情，含发货、退款）、`ProductsPage` / `ProductEditor`（商品列表/新增编辑，多规格）、`InventoryPage`（库存 + 批量导入卡密）、`CustomersPage`、`MarketingPage`（营销活动）、`ReportsPage`（报表）、`SystemLogsPage`（统一日志）、`SystemInfoPage`（系统信息）、`SettingsPage`（store/shipping/notifications/security）、`PaymentSettingsPage`、`NotificationSettingsPage`（mail/sms）。

**后台路由**（`basename="/admin"`）：

| 路径 | 页面 |
| --- | --- |
| `/admin/login` | 管理员登录 |
| `/admin/` | 经营总览 |
| `/admin/orders`、`/admin/orders/:id` | 订单 |
| `/admin/products`、`/admin/products/new`、`/admin/products/:id/edit` | 商品 |
| `/admin/inventory` | 库存卡密 |
| `/admin/customers` | 客户 |
| `/admin/marketing` | 营销 |
| `/admin/reports` | 报表 |
| `/admin/logs`、`/admin/audit` | 日志/审计 |
| `/admin/system` | 系统信息 |
| `/admin/settings`、`/settings/payment`、`/settings/shipping`、`/settings/notifications`、`/settings/mail`、`/settings/sms`、`/settings/security` | 各类设置 |

---

## 7. 数据库模型（PostgreSQL）

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `products` | id,name,category,description,price_cents,original_cents,icon,active,delivery_type,时间戳 | 商品（`delivery_type`：`card`/`manual`） |
| `product_variants` | id,product_id,name,price_cents,original_cents,active | 商品规格（一商品多规格） |
| `customers` | id(BIGSERIAL),email(UNIQUE),phone(UNIQUE),password_hash(scrypt 哈希,可空),nickname,last_seen | 客户（账号=邮箱或手机号；游客下单产生的记录无密码） |
| `admins` | id,username(UNIQUE),password_hash(scrypt 哈希),时间戳 | 管理员账户（存数据库，后台可改密） |
| `orders` | id,customer_id,email,phone,contact,contact_type,status,payment_status,total_cents,discount_cents,payment_method,lookup_token_hash,payment_qr,payment_expires_at,payment_transaction_id,ip_address,时间戳 | 订单 |
| `order_items` | id,order_id,product_id,variant_id,product_name,variant_name,quantity,unit_price_cents | 订单明细（冗余名称快照） |
| `cards` | id,product_id,variant_id,code,status('ready/reserved/sold/disabled'),order_id | 卡密库存（`UNIQUE(product_id,code)`） |
| `settings` | key,value(JSON 字符串) | 店铺/支付/发货/通知等设置 |
| `campaigns` | id,name,description,discount_cents,minimum_cents,starts_at,ends_at,active | 营销活动 |
| `system_logs` | id,level,category,message,details(JSONB),actor,ip,created_at | 系统/顾客事件日志 |
| `audit_logs` | id,actor,action,target_type,target_id,details(JSONB),ip,created_at | 管理员操作审计 |

**订单状态机**（`status` + `payment_status`）：

- `pending_payment`（待支付）→ 支付回调验签 → `fulfill` 后：
  - 全自动发货 → `completed`；
  - 含人工发货商品 → `paid_pending_delivery`（后台 `deliver` 补卡密后 → `completed`）。
- 超时未支付（网关卡）→ `cancelled` / `payment_status=expired`；下单失败 → `cancelled/failed`。
- 退款 → `refunded` / `payment_status=refunded`。

**卡密状态机**：`ready`（可用）→ `reserved`（真实支付下单锁定）→ `sold`（已售）；另有 `disabled`。

---

## 8. HTTP API 清单

### 8.1 公共 / 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| POST | `/api/auth/admin` | 管理员登录（查 `admins` 表，scrypt 校验） |
| POST | `/api/auth/logout` | 登出（admin/customer） |
| GET | `/api/auth/me` | 当前会话（admin + customer） |
| POST | `/api/auth/register` | 注册（账号=邮箱/手机号 + 密码 + 数字验证码，不发短信/邮件） |
| POST | `/api/auth/login` | 登录（账号密码 + 数字验证码） |
| GET | `/api/captcha` | 获取 4 位数字验证码（注册/登录用，下单不再需要） |

### 8.2 顾客侧（商品 / 下单 / 订单）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/products` | 商品列表（`q` 搜索、`category` 筛选） |
| GET | `/api/products/:id` | 商品详情 |
| GET | `/api/payment-methods` | 可用支付方式 + 渠道配置状态 |
| POST | `/api/orders/checkout` | 结算下单（核心接口） |
| POST | `/api/orders` | 已废弃（返回 410，提示走弹窗结算） |
| GET | `/api/orders` | 登录顾客订单列表 |
| GET | `/api/orders/:id` | 订单详情（需登录或凭证 token） |
| GET | `/api/orders/:id/payment-status` | 轮询支付状态 |
| POST | `/api/orders/:id/pay-demo` | 演示支付 |
| POST | `/api/orders/:id/cancel` | 取消订单 |

### 8.3 支付回调（公网）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/payments/alipay/notify` | 支付宝异步通知（验签） |
| POST | `/api/payments/wechat/notify` | 微信异步通知（验签+解密） |

### 8.4 商家后台（需 admin 会话）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/dashboard` | 经营总览统计 |
| GET/POST | `/api/admin/products` | 商品列表 / 新建 |
| PATCH/DELETE | `/api/admin/products/:id` | 编辑（含规格）/ 下架 |
| GET | `/api/admin/orders` | 订单列表（status/q 筛选） |
| GET | `/api/admin/orders/:id` | 订单详情 |
| POST | `/api/admin/orders/:id/deliver` | 人工发货（补卡密） |
| POST | `/api/admin/orders/:id/refund` | 标记退款 |
| GET | `/api/admin/inventory` | 库存（按规格统计） |
| POST | `/api/admin/inventory/import` | 批量导入卡密 |
| GET | `/api/admin/customers` | 客户列表（含消费统计） |
| GET/POST | `/api/admin/campaigns` | 营销活动列表 / 新建 |
| PATCH | `/api/admin/campaigns/:id` | 活动启停/改名 |
| GET | `/api/admin/reports` | 经营报表（近 30 天 + 分类） |
| GET | `/api/admin/logs` | 统一日志（系统+审计合并） |
| GET | `/api/admin/audit-logs` | 审计日志 |
| GET | `/api/admin/system-info` | 系统信息（运行时/DB/连接池） |
| GET | `/api/admin/notification-status` | 邮件/短信配置就绪状态 |
| GET | `/api/admin/payment-status` | 支付渠道配置状态 |
| POST | `/api/admin/account` | 修改管理员账户（当前密码 + 新用户名/新密码） |
| GET/PUT | `/api/admin/settings/:key` | 读取/保存设置；`payment` 走加解密专用的读写路径 |

---

## 9. 依赖关系

**应用依赖（`apps/*/package.json`）**

```
@shangou/server  → fastify@5, @fastify/cors@11, nodemailer@10, pg@8
@shangou/web     → react@19, react-dom@19, react-router-dom@7, lucide-react@1.55, qrcode@1.5
                   (dev) vite@8, @vitejs/plugin-react@6, typescript@7, @types/*
```

**内部 import 关系（关键）**

```
server.mjs   ──▶ database.mjs (pool/query/one/many/transaction/productJson/readSetting/writeSetting)
             ──▶ payments.mjs (paymentReadiness/create*/verify*/decode*)
             ──▶ env.mjs (loadEnvironment)
             ──▶ secret.mjs (ensureSecretKey/hashPassword/verifyPassword/encryptSecret/decryptSecret)
payments.mjs ──▶ node:crypto （支付参数由 server 解密后传入，无项目内依赖）
database.mjs ──▶ env.mjs, secret.mjs (hashPassword)

前端：
main.tsx  ──▶ shared.tsx, purchase.tsx, checkout-modal.tsx, payment-qr.tsx, api.ts, styles
admin-main.tsx ──▶ api.ts, admin-login.tsx, admin-payment.tsx, styles
checkout-modal.tsx ──▶ api.ts, shared.tsx(useCart), payment-qr.tsx
purchase.tsx    ──▶ api.ts, shared.tsx(PageIntro)
```

**运行期数据流**：前端（8002 API）→ Fastify `api()` → `database.mjs`(`pg`) → PostgreSQL；外部依赖支付宝/微信网关、SMTP、短信 HTTP API。

---

## 10. 项目运行方式

### 10.1 前置条件

- Node.js ≥ 24（根 `package.json` 声明 `engines.node >= 24.0.0`）
- PostgreSQL（默认 `127.0.0.1:5432`，库名 `shangou_store`）
- 项目根 `.env`（参考 `.env.example`，含数据库/管理员/支付/通知参数）

### 10.2 生产 / 常规启动

```powershell
npm install --prefix apps/server
npm install --prefix apps/web
npm start
```

`npm start` = 先构建前端（`npm run build --prefix apps/web`）→ `node apps/server/server.mjs`。

启动后：

- 顾客前台：<http://127.0.0.1:8001/>
- 商家后台：<http://127.0.0.1:8002/admin>
- 健康检查：<http://127.0.0.1:8002/api/health>
- 默认管理员：`admin` / `admin123456`（生产必须通过 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 覆盖）

### 10.3 开发模式

两个终端分别运行：

```powershell
npm run dev        # node --watch apps/server/server.mjs --dev-web（后端 8002，不托管 8001）
npm run dev:web    # vite（前端 8001 HMR）
```

### 10.4 关键环境变量

| 变量 | 说明 |
| --- | --- |
| `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD` | 数据库连接 |
| `ADMIN_USERNAME/ADMIN_PASSWORD` | 管理员凭据（仅用于首次初始化 `admins` 表，之后在后台修改） |
| `HOST/FRONTEND_PORT/BACKEND_PORT` | 监听地址与端口（默认 127.0.0.1 / 8001 / 8002） |
| `FRONTEND_ORIGIN` | 额外 CORS 白名单（逗号分隔） |
| `NODE_ENV` | 设为 `production` 时强化安全（关闭演示支付、Secure Cookie） |
| `PAYMENT_PUBLIC_BASE_URL` | 公网 HTTPS 域名（供支付回调） |
| 支付宝：`ALIPAY_APP_ID/ALIPAY_PRIVATE_KEY_PATH/ALIPAY_PUBLIC_KEY_PATH/ALIPAY_GATEWAY/ALIPAY_NOTIFY_URL` | 当面付参数 |
| 微信：`WECHAT_APP_ID/WECHAT_MCH_ID/WECHAT_MCH_SERIAL_NO/WECHAT_MCH_PRIVATE_KEY_PATH/WECHAT_API_V3_KEY/WECHAT_PLATFORM_CERT_PATH(或 PUBLIC_KEY_PATH+SERIAL_NO)/WECHAT_API_BASE/WECHAT_NOTIFY_URL` | Native 支付参数 |
| `SECRET_KEY` | 数据库敏感字段（支付私钥/API v3 密钥）的 AES-GCM 加密密钥；首次启动自动生成并追加进 `.env` |
| `SMTP_*` / `SMTP_PASSWORD`、`SMS_API_URL/SMS_API_TOKEN` | 邮件 / 短信通知 |

> 支付渠道参数（支付宝/微信 AppID、商户号、密钥、证书、回调地址等）已改为**数据库 `settings.payment` 驱动**，在后台「支付设置」页直接填写并实时生效；`.env` 中旧有的 `ALIPAY_*` / `WECHAT_*` 变量仅在数据库对应字段为空时迁移一次，之后以数据库为准。
>
> 管理员账户存 `admins` 表（`ADMIN_USERNAME/ADMIN_PASSWORD` 仅用于首次初始化），可在后台「安全设置」修改用户名/密码；所有密码均以 scrypt 加盐哈希存储。

证书/私钥 PEM 文件放项目根 `secrets/`（已加入 `.gitignore`）。

---

## 11. 遗留清理记录与剩余事项

**2026-10-10 已完成的遗留清理**

1. 删除早期「手机号原型」SQLite 残留：`apps/server/data/shangou.sqlite{,-shm,-wal}` 及空目录，`.gitignore` 中对应的 `apps/server/data/*.sqlite` 规则同步移除。当前唯一数据存储为 PostgreSQL。
2. 删除旧静态商家后台原型：`apps/server/` 下的全部 HTML 页面及 `admin.js`、`login.js`、`admin.css`（其中引用 `:1001`、`/apps/server/login.html` 等旧路径，已被 `8002:/admin` 的 React 版后台取代）。
3. 删除旧静态顾客前台多页实现：`apps/web/` 下的 account/cart/checkout/help/orders/order-detail/products/product-detail 等 HTML 及 `app.js`（指向 `:1002`）、`style.css`。
4. 删除 `apps/pages.css`、`apps/pages.js`（更早期的多页静态渲染引擎）。
5. 删除 `work/` 本地运行日志目录。

以上文件均不在当前构建链路（Vite 双入口 `index.html` + `admin.html` 与 `server.mjs` 静态托管）中。

**剩余建议事项**

- **包管理混用**：仓库同时存在 `pnpm-workspace.yaml`/`pnpm-lock.yaml` 与根脚本里的 `npm run … --prefix`，README 也是 `npm install --prefix …`。建议统一为 pnpm 或 npm 之一，避免依赖解析差异。

**2026-10-10 功能调整记录（按产品要求）**

1. 下单不再需要数字验证码（结算弹窗与 `POST /api/orders/checkout` 均已移除）。
2. 前台注册/登录拆为两个页面 `/register`、`/login`：账号（邮箱或手机号）+ 密码 + 4 位数字验证码；注册不发短信/邮件。未登录仍可下单。
3. 支付渠道参数（支付宝/微信全部参数）迁入数据库 `settings.payment`，后台「支付设置」页可直接填写修改；商户私钥与 API v3 密钥在库中 AES-256-GCM 加密。
4. 管理员账户入 `admins` 表，后台「安全设置」可改用户名/密码（需当前密码）。
5. 所有密码（管理员、顾客）均 scrypt 加盐哈希存储；新增 `apps/server/secret.mjs` 与 `SECRET_KEY`（自动生成进 `.env`）。

---

## 12. 快速上手路线（建议阅读顺序）

1. 先读 [README.md](file:///c:/Users/RR/Documents/Codex/2026-10-10/new-chat/outputs/README.md) 了解业务与配置。
2. 读 [database.mjs](file:///c:/Users/RR/Documents/Codex/2026-10-10/new-chat/outputs/apps/server/database.mjs) 掌握数据模型与初始化。
3. 读 [server.mjs](file:///c:/Users/RR/Documents/Codex/2026-10-10/new-chat/outputs/apps/server/server.mjs) 理清路由、鉴权与业务流程。
4. 读 [payments.mjs](file:///c:/Users/RR/Documents/Codex/2026-10-10/new-chat/outputs/apps/server/payments.mjs) 搞懂支付对接。
5. 读前端 [main.tsx](file:///c:/Users/RR/Documents/Codex/2026-10-10/new-chat/outputs/apps/web/src/main.tsx) 与 [admin-main.tsx](file:///c:/Users/RR/Documents/Codex/2026-10-10/new-chat/outputs/apps/web/src/admin-main.tsx) 了解两个前端入口。