# 部署说明

当前站点为 https://pair.moorn.online/。本说明覆盖通用运行要求；本机历史运维记录和私有配置不包含在仓库中。

## 构建与发布

需要 Node.js >= 22.13，使用 Node 内置 SQLite。当前站点已在 Node.js 24.21.0 上验证。

```sh
npm ci
npm test
npm run typecheck
npm run build
```

发布内容为 `dist/`、`server/`、`shared/`、`package.json` 和 `package-lock.json`。不要包含本机 `.env`、`data/`、`node_modules/` 或用户上传文件。

服务器在独立版本目录执行 `npm ci --omit=dev`。`tsx` 是生产依赖，启动时必须可用。应用使用独立系统用户，代码目录只读，数据目录可写。

## 生产环境

由服务管理器从仅管理员可读的配置文件注入环境变量，例如：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
APP_URL=https://pair.moorn.online
DATA_DIR=/var/lib/pair-study
SESSION_DAYS=30
DEV_SHOW_CODES=false
ADMIN_EMAILS=
RESEND_API_KEY=
MAIL_FROM=no-reply@your-verified-domain.example
CODE_PEPPER=
UPLOAD_QUOTA_MB=200
MIN_FREE_DISK_MB=1024
```

`CODE_PEPPER` 是邮箱验证码校验值的密钥，填一段足够长的随机字符串（例如 `openssl rand -hex 32` 的输出）。它只应存在于这份环境配置中，**不要和数据库备份放在一起**：数据库里保存的是带密钥的校验值，单独拿到数据库无法穷举验证码。留空时每次启动随机生成，重启后尚未使用的验证码（10 分钟有效）失效。`UPLOAD_QUOTA_MB` 是每人上传图片的合计上限；`MIN_FREE_DISK_MB` 是数据目录所在磁盘的最低可用空间，低于它时暂停接收图片与打卡照片，建议同时为该磁盘配置用量告警。

按实际域名修改 `APP_URL`；它决定邮件链接、Cookie 安全策略及写请求的 Origin 校验。不要给私有环境文件设置公共读取权限。

若使用 SMTP，留空 `RESEND_API_KEY` 并配置：

```dotenv
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=resend
SMTP_PASS=
```

发件地址必须属于自己的已验证域名。管理员名单填写实际校园邮箱。上述空值不能用于真实发信，也不提供任何默认管理员密码。

从版本目录启动：

```sh
node --import tsx server/index.ts
```

生产使用 systemd 等服务管理器注入环境并配置自动启动、故障重启。数据库和 uploads 持久化在 `DATA_DIR`，不得随版本切换被覆盖。首次使用空数据目录会自动建库，正式环境不要运行演示 seed。

## HTTPS 与反向代理

应用仅监听 loopback，反向代理将专属域名转发到 `http://127.0.0.1:8787`。Nginx 等代理应覆盖外部提供的转发头：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
```

请求体上限需允许应用的 8 MB JSON 上传。若前端还有 TCP/SNI 分流并传递 PROXY protocol，应仅信任对应的本地代理，并先正确恢复真实客户端 IP。

为新域名添加独立虚拟主机。若服务器已有网站或代理，先核对监听和分流配置，保留现有默认路由；配置检查通过后平滑 reload。配置正式 TLS 证书、HTTP 到 HTTPS 跳转、自动续期和续期后的证书重载。

## 验证与更新

```sh
curl --fail http://127.0.0.1:8787/api/auth/me
curl --fail http://127.0.0.1:8787/api/meta
```

未登录 `/api/auth/me` 返回 `{"user":null}`，`/api/meta` 应显示 `devMode: false`。资料列表未登录返回 401 是正常权限行为。本项目没有 `/api/health`。

上线后分别检查 IPv4、IPv6、证书链、首页、登录入口和静态资源，并确认原有服务仍正常。真实邮件送达、验证码激活和密码登录需要使用经授权的测试邮箱验收；SMTP 认证成功本身不代表收件箱已经收到邮件。

更新前使用 SQLite backup API 备份数据库，并保存 uploads 和受限环境配置。需要数据库与上传目录的一致恢复点时短暂停止应用写入。不要仅复制运行中的主数据库文件而忽略 WAL。先在副本验证数据迁移，再发布新版本；回滚必须考虑匹配的代码与数据库版本，不可直接让旧代码继续使用升级后的数据。
