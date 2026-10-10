# 闪购卡券 · 数字商品商城

这是一个数字商品发卡商城，包含响应式顾客前台、商家后台和 PostgreSQL 服务端。顾客可免注册购买；订单、规格和库存由服务端管理。

## 技术栈

- 前端：React 19、TypeScript、Vite、React Router、Lucide React
- 服务端：Node.js 24+、Fastify 5、`@fastify/cors`
- 数据库：PostgreSQL 18、`pg` 驱动
- 页面：响应式布局，支持桌面与手机浏览

## 本机运行

请先启动 PostgreSQL，并确认项目根目录的 `.env` 连接参数可用。`.env` 已加入忽略列表，不要提交到版本库。

```powershell
npm install --prefix apps/server
npm install --prefix apps/web
npm start
```

`npm start` 会先构建 React 页面，然后启动 Fastify 服务：

- 顾客前台：<http://127.0.0.1:8001/>
- 商家后台：<http://127.0.0.1:8002/admin>
- 后台 API 健康检查：<http://127.0.0.1:8002/api/health>

本地默认管理员用户名为 `admin`，密码为 `admin123456`。部署时设置 `ADMIN_USERNAME`、强密码 `ADMIN_PASSWORD`、HTTPS 和 `FRONTEND_ORIGIN`。

## 前端开发模式

在两个终端分别运行 API/后台服务和 Vite 前台：

```powershell
npm run dev
npm run dev:web
```

开发时 Vite 使用 8001 端口、Fastify API 和后台使用 8002 端口，不会争用端口。Vite 会将 `/admin/...` 路由交给后台 React 入口。页面请求同一主机的 8002 端口 API。修改前端后通过 `npm run build` 重新生成正式服务使用的静态页面。

## 页面功能

顾客前台包含首页、商品目录/筛选、商品详情、购物车、订单查询、卡密查看与帮助中心。结算在当前页面的弹窗中完成，支持选择商品规格、数量和支付方式；只要求输入一个数字校验码，不要求登录、不校验邮箱或手机号，也不发送验证码。包含 `@` 的联系方式作为邮箱通知目标，其他内容作为短信通知目标。订单凭证保存在当前浏览器中。

商家后台包含登录、经营总览、订单管理、商品及规格编辑、按规格导入卡密、客户管理、营销活动、经营报表、系统日志、操作审计，以及店铺/支付/发货/通知/邮箱/短信/安全设置。后台 API 使用会话 Cookie 保护。

## 数据与支付

首次启动会创建或升级数据库表，并写入演示商品、演示卡密、默认设置和首单活动。商品规格各自维护售价及卡密库存。结算提供支付宝当面付二维码、微信 Native 扫码支付和本地演示支付；演示方式仅限非生产环境，生产环境服务端会拒绝演示付款。

真实支付参数尚未填写时，真实渠道不会出现在顾客结算页；配置完整、在后台打开渠道后才会开放。支付订单先保持待支付，只有经过支付宝/微信平台回调验签，并核对商户订单号、渠道和金额后才发卡。二维码保存在该订单中，游客凭订单凭证或已登录账户可继续查看。

### 配置支付宝当面付和微信 Native

1. 把项目根目录 `.env.example` 中的支付变量追加到现有 `.env`，保留其中的 PostgreSQL 和管理员配置。
2. 设置 `PAYMENT_PUBLIC_BASE_URL` 为顾客可访问的公网 HTTPS 域名。支付平台回调需要能访问该域名的 `/api/payments/alipay/notify` 和 `/api/payments/wechat/notify`。
3. 按 `.env.example` 填入支付宝应用 ID、商户私钥文件和支付宝公钥文件；微信 AppID、商户号、商户证书序列号、商户私钥、API v3 密钥及微信支付平台证书/公钥。
4. 将 PEM 证书和私钥文件放入项目根目录 `secrets/`。此目录下的 PEM 文件已加入 `.gitignore`。
5. 重启服务，在后台「支付设置」确认两家渠道均显示「配置完整」，再分别打开支付宝/微信支付开关。

支付配置/密钥变量包括：`ALIPAY_APP_ID`、`ALIPAY_PRIVATE_KEY_PATH`、`ALIPAY_PUBLIC_KEY_PATH`、`WECHAT_APP_ID`、`WECHAT_MCH_ID`、`WECHAT_MCH_SERIAL_NO`、`WECHAT_MCH_PRIVATE_KEY_PATH`、`WECHAT_API_V3_KEY`、`WECHAT_PLATFORM_CERT_PATH`（或公钥路径与 ID）和 `PAYMENT_PUBLIC_BASE_URL`。密钥只从服务端环境变量和文件读取，不保存到数据库或浏览器。

本机 `127.0.0.1` 不能接收支付平台的公网回调；真实收款前需要部署到 HTTPS 域名，并在反向代理/防火墙中允许支付通知到达后端 API。未配置时可继续使用本地演示支付。

### 邮件与短信订单通知

后台邮箱、短信设置页可配置通知开关和服务参数。邮箱通知通过 SMTP 发送订单号、商品和卡密；短信通知通过设置的 HTTP API 发送订单号与金额。顾客购买不验证邮箱/手机号；可选账户登录验证码在生产环境会分别走邮件或短信服务。由于不同短信供应商 API 不同，当前服务按页面说明发送 JSON，并以 Bearer Token 授权。服务端需配置对应环境变量后才能实际发送：

```dotenv
SMTP_PASSWORD=你的SMTP密码或授权码
SMS_API_TOKEN=短信服务商令牌
SMS_API_URL=https://你的短信服务商接口地址
```

SMTP 主机、用户名、端口、发件人、短信签名和模板编号可在后台填写；SMTP 密码和短信令牌只保存在服务端环境变量中。邮箱/短信开关默认关闭，配置服务商并启用开关后才会发送订单通知。
