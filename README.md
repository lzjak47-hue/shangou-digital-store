# 闪购卡券 · 数字商品发卡商城

24 小时自动发货的虚拟卡密商城。**Node 后端 + PostgreSQL + React 前台商城 + React 管理后台**，一套代码跑通「浏览 → 下单 → 支付 → 自动发卡 → 查单 → 后台管理」的完整闭环。顾客**无需注册、无需短信/邮箱验证码**即可下单；订单、规格和库存全部由服务端管理。

| 服务 | 端口 | 说明 |
| --- | --- | --- |
| 🛒 **顾客前台** | **8001** | 商品浏览、购物车、下单、支付、查单、登录/注册 |
| ⚙️ **商家后台** | **8002** | 商品 / 订单 / 库存 / 客户 / 营销 / 报表 / 日志 / 设置 |
| 🗄️ **数据库** | 5432 | PostgreSQL，库名 `shangou_store`（可配置） |

> **前端**：React 19 + TypeScript + Vite 8，React Router 7、Lucide 图标，双入口构建（前台 + 后台）。
> **后端**：Node.js ≥ 24 + Fastify 5 + `@fastify/cors` + `pg` + `nodemailer`。
> 会话、数字验证码、口令散列（scrypt）、支付密钥加密（AES-256-GCM）均基于 `node:crypto` 实现。
> 支付宝当面付 RSA2 签名/验签、微信支付 APIv3 报文签名与回调解密均为自研实现。

---

## 功能总览

### 顾客前台（8001）

- **首页**：Hero 检索、分类磁贴、热门精选、新客首单立减推广
- **商品**：目录筛选 / 关键词搜索 / 分类胶囊；商品详情支持**多规格**（每规格独立价格、划线价、库存）
- **购物车**：本地持久化（localStorage），跨规格数量管理
- **结算**：当前页弹窗完成——选规格/数量/支付方式，填邮箱或手机号即可下单（**免登录、免验证码**）
- **支付**：支付宝当面付扫码 / 微信 Native 扫码 / 本地演示支付；支付结果每 4 秒自动轮询
- **订单**：游客凭浏览器内保存的「订单凭证」查单；登录后可跨设备查同一账号的全部订单；卡密一键复制
- **账户**：`/register` 注册、`/login` 登录（邮箱或手机号作为账号 + 密码 + 页面数字验证码，不发短信/邮件）
- **帮助中心**：FAQ + 联系客服卡片

### 商家后台（8002/admin）

- **经营总览**：今日成交额/订单/待处理/在售商品/客户数 + 最近订单 + 快捷操作
- **订单管理**：搜索（订单号/邮箱/手机号/昵称）、状态筛选、订单详情；**人工发货**（逐行补发卡密）、标记退款
- **商品管理**：商品多规格编辑（增/删/停用）、分类/图标/划线价、上架下架
- **库存卡密**：按规格统计可用/锁定/已售；**批量导入**（每行一条，自动去重，单次 1 万条）
- **客户管理**：客户列表、累计消费、订单数、最近 IP、最近活跃
- **营销活动**：新客首单立减等满减活动创建/启用/暂停
- **经营报表**：近 30 天成交趋势柱状图 + 分类成交贡献
- **日志与操作**：系统事件、顾客操作、管理员审计合并时间线，可按级别/类型/关键词过滤，核对来源 IP
- **系统信息**：Node 运行时、CPU/内存、连接池、数据库状态（10 秒自动刷新）
- **店铺设置**：店铺信息/营业状态、发货策略、通知偏好、安全策略
- **支付设置**：支付宝/微信**全部渠道参数直接在后台填写、保存在数据库**（密钥字段加密存储），配置状态实时检测
- **管理员账户**：用户名/密码存数据库，后台「安全设置」页可修改（需当前密码）
- **邮箱 / 短信设置**：SMTP 邮件通知、短信 HTTP 接口通知（密码类凭据只存服务端环境变量）

### 数据与安全

- **卡密状态机**：`ready`（可用）→ `reserved`（支付下单锁定）→ `sold`（已售）；超时未支付自动回滚释放
- **订单状态机**：`pending_payment → paid_pending_delivery（人工）/ completed（自动）`，支持 `cancelled / refunded`
- **口令安全**：管理员与顾客密码一律 **scrypt 加盐哈希**落库，登录校验常量时间比较
- **支付密钥**：支付宝商户私钥、微信商户私钥、API v3 密钥在数据库中 **AES-256-GCM 加密**存储（密钥为 `.env` 的 `SECRET_KEY`，首次启动自动生成）
- **会话**：HttpOnly + SameSite=Lax Cookie；仅 HTTPS 访问时附加 `Secure`（http 环境自动兼容，不会登录后回弹）
- **来源校验**：API 同源请求自动放行，跨源走白名单（`FRONTEND_ORIGIN`），防跨站盗用

---

## 快速开始

### 1. 环境要求

- **Node.js ≥ 24**
- **PostgreSQL ≥ 12**（开发基于 PostgreSQL 14/18 实测）

### 2. 创建数据库

```sql
CREATE DATABASE shangou_store WITH ENCODING 'UTF8' TEMPLATE template0;
```

首次启动会自动**建表、迁移旧表结构、写入演示数据**（8 个演示商品、每规格 25 条演示卡密、默认设置、首单活动），无需手动执行任何 SQL。

### 3. 安装依赖

```powershell
npm install --prefix apps/server
npm install --prefix apps/web
```

### 4. 配置 `.env`（可选，本地开发可不配）

复制 `.env.example` 为 `.env`，按需填写（完整变量表见下文）。不填时全部走默认值。

### 5. 启动

```powershell
npm start        # 构建前端 + 启动服务（覆盖前后台两个端口）
```

访问：

| 入口 | 地址 | 账号 |
| --- | --- | --- |
| 🛒 顾客前台 | http://127.0.0.1:8001/ | — |
| ⚙️ 商家后台 | http://127.0.0.1:8002/admin | `admin` / `admin123456` |
| ❤️ 健康检查 | http://127.0.0.1:8002/api/health | — |

> 管理员账号存数据库（`admins` 表）。首次启动时若表为空，会使用环境变量 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 初始化；两者都未设置时使用默认 `admin` / `admin123456`。上线后请在后台「安全设置」里修改。

### 6. 开发命令

```powershell
npm run dev        # 后端 node --watch + --dev-web（8002 承载后台与 API，不占用 8001）
npm run dev:web    # 前端 Vite 开发服务器（8001，HMR，接口直连 8002）
npm run build      # 只构建前端（tsc 类型检查 + vite build）
npm start          # 构建前端 + 启动正式服务
```

> ⚠️ **前端必须先构建**：正式服务只提供 `apps/web/dist` 里的产物，未构建时访问会看到「前端构建文件不存在」的提示页。开发期间请用 `npm run dev` + `npm run dev:web` 两个终端并行。

---

## 端口与架构

同一进程内启动两个 Fastify 实例，**前台/后台静态目录不同，API 路由相同**：

```
                           ┌────────────────────────────────┐
   :8001  顾客前台          │  apps/web/dist/index.html      │
   ──────────────────────► │  (React SPA + /api/* 同源处理)  │
        (也可经 Nginx/     └────────────────────────────────┘
         Cloudflare Tunnel
         转发 80/443)                 │
                           ┌──────────▼─────────────────────┐
   :8002  商家后台 + API    │  apps/web/dist/admin.html      │
   ──────────────────────► │  /admin/* 后台 SPA              │
                           │  /api/*  全部 HTTP 接口          │
                           └───────────┬────────────────────┘
                                       │
                           ┌───────────▼────────────────────┐
                           │   PostgreSQL · shangou_store    │
                           └────────────────────────────────┘
```

- **生产模式同源 API**：前台构建产物中 `API_BASE` 为同源（`8001` 端口同样处理 `/api/*`），因此只需把 8001 暴露给公网（域名/反代/隧道）前台即可完整工作；后台 8002 可仅内网访问。
- **开发模式跨端口**：Vite 下 `API_BASE` 直连 `:8002`，由后台实例的 CORS 白名单放行本地来源。
- **来源校验**：同源请求自动放行；跨源请求校验 `FRONTEND_ORIGIN` 白名单，未通过返回 403「前台来源未获允许」（更多见常见问题）。

---

## 目录结构

```
shangou-digital-store/
├── package.json                  # 根脚本（build / start / dev / dev:web），engines >= 24
├── pnpm-workspace.yaml           # workspace 声明
├── README.md
├── .env.example                  # 环境变量模板（数据库/管理员/支付/通知）
├── apps/
│   ├── server/                   # 后端（Node 24 + Fastify 5 + ESM）
│   │   ├── server.mjs            #   入口：鉴权、路由、下单/履约、静态托管、优雅停机
│   │   │                         #   核心函数：fulfill(履约) reserveStock(锁卡)
│   │   │                         #             completeGatewayPayment(回调完成支付)
│   │   │                         #             orderDetail(订单聚合) sendOrderNotice(通知)
│   │   ├── database.mjs          #   pg 连接池、建表/迁移/种子、事务封装、设置读写
│   │   ├── payments.mjs          #   支付宝 RSA2 签验/预下单、微信 APIv3 签名/下单/回调解密
│   │   ├── secret.mjs            #   scrypt 口令散列 + AES-256-GCM 加密 + SECRET_KEY 管理
│   │   ├── env.mjs               #   轻量 .env 加载器（不覆盖已存在的环境变量）
│   │   └── package.json
│   └── web/                      # 前端（React 19 + TS + Vite 8）
│       ├── index.html            #   前台 SPA 入口（→ src/main.tsx）
│       ├── admin.html            #   后台 SPA 入口（→ src/admin-main.tsx，basename=/admin）
│       ├── vite.config.ts        #   一次构建产出两个应用 + Vite 开发期 /admin 重写
│       ├── tsconfig.json
│       └── src/
│           ├── api.ts            #     类型定义 + API 封装（生产同源 / 开发直连 8002）
│           ├── shared.tsx        #     购物车 Context、登录态 AuthProvider、StoreLayout 布局、商品卡
│           ├── main.tsx          #     前台全部页面与路由（首页/目录/详情/购物车/订单/帮助/登录/注册）
│           ├── checkout-modal.tsx#     结算弹窗（免验证码下单 + 支付轮询）
│           ├── purchase.tsx      #     登录页 / 注册页 / 账户与订单页
│           ├── payment-qr.tsx    #     二维码渲染（qrcode）
│           ├── admin-main.tsx    #     后台全部页面（总览/订单/商品/库存/客户/营销/报表/日志/系统/设置）
│           ├── admin-login.tsx   #     管理员登录页
│           ├── admin-payment.tsx #     支付设置页（渠道参数表单 + 配置完整性检测）
│           └── styles.css / clarity.css
└── skills/                       # 项目技能（natapp 内网穿透文档，非运行必需）
```

---

## 数据库

启动时自动创建/迁移以下 11 张表（幂等，可重复启动）：

| 表 | 用途 |
| --- | --- |
| `products` / `product_variants` | 商品与多规格（每规格独立价格、划线价、上下架） |
| `customers` | 顾客（账号=邮箱或手机号；`password_hash` 仅注册后存在，游客下单记录无密码） |
| `admins` | 管理员账户（scrypt 口令哈希，后台可改） |
| `orders` / `order_items` | 订单与明细（商品名快照、金额、支付渠道、凭证哈希、IP） |
| `cards` | 卡密库存（`ready/reserved/sold/disabled` 状态机） |
| `settings` | 各类设置 JSON（店铺/支付/发货/通知/安全/邮件/短信） |
| `campaigns` | 营销活动（满减/首单优惠） |
| `system_logs` / `audit_logs` | 系统/顾客事件日志与管理员操作审计 |

---

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址；对外服务改为 `0.0.0.0` |
| `FRONTEND_PORT` / `BACKEND_PORT` | `8001` / `8002` | 前台 / 后台+API 端口 |
| `PGHOST` / `PGPORT` | `127.0.0.1` / `5432` | 数据库地址 |
| `PGDATABASE` | `shangou_store` | 数据库名 |
| `PGUSER` / `PGPASSWORD` | `postgres` / — | 数据库账号（建议专用低权限账号） |
| `PGPOOL_MAX` | `10` | 连接池上限 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `admin123456` | **仅用于首次初始化** `admins` 表，之后在后台修改 |
| `NODE_ENV` | — | 设为 `production` 时关闭演示支付、静态资源加缓存等 |
| `FRONTEND_ORIGIN` | — | 额外跨源白名单（逗号分隔）；同源请求无需配置 |
| `SECRET_KEY` | 自动生成 | 支付密钥等敏感字段的 AES-256-GCM 加密密钥，首次启动自动写入 `.env` |
| `SMTP_*` / `SMTP_PASSWORD` | — | 邮件通知（主机/端口/账号/发件人；SMTP 密码仅存环境变量） |
| `SMS_API_URL` / `SMS_API_TOKEN` | — | 短信通知 HTTP 接口与 Bearer 令牌 |

> **支付渠道参数现已数据库驱动**：支付宝/微信的 AppID、商户号、密钥、证书、回调地址等全部在后台「支付设置」页面填写（存 `settings.payment`，密钥字段加密）。`.env` 中历史遗留的 `ALIPAY_*` / `WECHAT_*` / `PAYMENT_PUBLIC_BASE_URL` 变量仅在数据库对应字段为空时**自动迁移一次**，之后以数据库为准。

---

## 接入真实支付

### 前提（缺一不可）

1. **支付宝当面付签约**：获得 AppID、商户私钥、支付宝公钥
2. **微信 Native（APIv3）**：AppID、商户号、商户证书序列号、商户私钥、API v3 密钥、平台证书/公钥
3. **公网 HTTPS 回调地址**：支付平台必须能访问 `/api/payments/alipay/notify` 与 `/api/payments/wechat/notify`（http 地址会被拒绝）

### 步骤

1. 启动服务后登录后台 → 「支付设置」
2. 填写「公网 HTTPS 商城地址」（如 `https://shop.example.com`，回调地址自动拼接；也可直接填完整回调地址）
3. 按表单逐项粘贴支付宝 / 微信参数（PEM 文本直接粘入文本框，保存即生效，无需重启）
4. 页面顶部状态卡显示「配置完整」后，打开对应渠道开关
5. 顾客结算页即可选择真实渠道；服务端在收到平台回调并**验签 + 核对商户订单号、渠道、金额**后才会自动发卡

> 说明：本机 `127.0.0.1` 和免费隧道域名都无法完成真实收款——真实收款要求**大陆备案域名**+https。未配置时请使用「本地演示支付」验证完整流程（生产环境服务端会拒绝演示支付）。

---

## 部署示例（Ubuntu 22.04）

```bash
# 1. 环境：Node.js ≥ 24（NodeSource 或二进制）、PostgreSQL
sudo apt-get update && sudo apt-get install -y postgresql postgresql-contrib
curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && sudo apt-get install -y nodejs

# 2. 建库建用户（务必替换密码为强密码）
sudo -u postgres psql -c "CREATE USER shangou WITH PASSWORD '<db-password>';"
sudo -u postgres psql -c "CREATE DATABASE shangou_store OWNER shangou;"

# 3. 部署代码（排除 node_modules/.env/secrets）后安装后端依赖
npm install --prefix apps/server --omit=dev

# 4. 生产配置 /root/shangou/.env
#    NODE_ENV=production  HOST=0.0.0.0  数据库与管理员配置（首次初始化用）

# 5. 进程守护
npm install -g pm2
pm2 start apps/server/server.mjs --name shangou
pm2 save && pm2 startup systemd -u root --hp /root

# 6. 前端产物随代码一起部署（本地先 npm run build，或服务器上装全依赖后构建）
```

- 对外只需暴露 8001（前台 + 同源 API）；8002 后台建议只放内网 / 白名单 / VPN。
- 需要 HTTPS 时可任选：Nginx 反代 + Certbot 证书，或 Cloudflare Tunnel（免证书自动 https）。若经反代/隧道转发为 https，登录 Cookie 会自动附加 `Secure`。

---

## 常见问题

**Q：后台登录后闪一下又回到登录页？**

A：旧版本在 http 环境下也往 Cookie 上加 `Secure` 导致浏览器拒存。现版本已按请求协议自动判断（仅 https 附加 `Secure`）。如仍复现，请清空该站点 Cookie 后重试。

**Q：接口返回 403「前台来源未获允许」？**

A：页面所在地址与接口地址跨源了（跨端口/跨域名）。同源访问不会出现此错误。确需跨源时，在 `.env` 设置 `FRONTEND_ORIGIN=http://页面地址`（逗号分隔多个）后重启；若经反代，请确保代理透传 `Host` 与 `X-Forwarded-Proto` 头。

**Q：支付渠道一直显示「配置不完整」？**

A：后台「支付设置」状态卡会逐项列出缺失参数；最常见的缺失是「公网 HTTPS 回调地址」——回调地址必须是 `https://` 开头，且支付平台能公网访问到。

**Q：顾客下单要不要登录/验证码？**

A：都不用。结算只填邮箱或手机号（仅用于订单归集与发货通知）。登录/注册才需要账号密码+页面数字验证码，且不发短信/邮件验证码。

---

## 安全清单

- `.env`、`secrets/`（PEM 证书）、`node_modules/`、`apps/web/dist/`、日志**均已加入 `.gitignore`**，绝不入库
- 管理员/顾客密码：scrypt 加盐哈希（`secret.mjs`），支持常量时间比较
- 支付密钥落库前 AES-256-GCM 加密；密钥 `SECRET_KEY` 自动生成于 `.env`（请勿泄露、勿入库）
- 会话 Cookie：HttpOnly + SameSite=Lax（+ 按协议 Secure）；会话 12 小时过期
- API 响应 `Cache-Control: no-store`；静态资源 `nosniff`；路径穿越防护；文本输出剥离 `<>`
- 支付回调全部验签；完成支付前核对商户订单号、渠道与金额（分）

---

## 更新历史（里程碑）

- **v1.0.0**：完整商城闭环（商品/多规格/卡密库存/下单/支付/发卡/后台管理）
- 账户体系改为「账号密码 + 数字验证码」注册/登录（免短信/邮件）
- 支付渠道参数迁移至数据库、后台可改；敏感字段加密落库
- 管理员账户数据库化、后台可改密；全量口令 scrypt 哈希
- 下单元验证码化；来源校验同源自动放行；http/https Cookie 兼容
- 全局视觉与交互优化（卡片层次、hover 反馈、状态标签对比度、动效）