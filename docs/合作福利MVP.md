# 学习工具合作福利 MVP

本次增加学习工具福利入口、Xmind 活动页与登记、MarginNote 活动页与兑换码分配。沿用现有校园账号和 SQLite 数据库，不依赖外部表单服务。未接入飞书、腾讯文档或 Notion 自动同步，名单通过专用网页共享。

## 本地查看

要求 Node.js 22.13 或以上，沿用项目的依赖安装与开发方式：

```bash
npm ci --no-audit --no-fund
npm run dev
```

在浏览器打开：

| 路径 | 内容 |
| --- | --- |
| `http://localhost:5173/benefits` | 合作福利专区，公开可浏览 |
| `http://localhost:5173/benefits/xmind` | Xmind 功能、视频、模板和领取登记 |
| `http://localhost:5173/benefits/marginnote` | MarginNote 介绍、示例和兑换码领取 |
| `http://localhost:5173/benefits/records` | Xmind 工作人员名单页 |

首页及登录后的「今天」页均有入口。活动内容公开展示；领取需要先登录现有校园账号，无需发布个人主页或填写匹配问卷。不要为了预览在已有数据上运行 `npm run seed`。

## Xmind 登记与名单共享

1. 登录后进入 Xmind 页，向服务器取得绑定当前账号的短时浏览凭证。
2. 页面可见时累计浏览 30 秒。服务器也检查凭证所属账号、等待时间和一小时有效期。
3. 填写本人 Xmind 账号绑定手机号，并明确同意发放用途后提交。只做格式检查，不发送短信、不核验 Xmind 账号、不按手机号去重。
4. 服务器通过 SQLite `BEGIN IMMEDIATE` 事务串行检查 200 条上限并写入，防止多个 API 进程超额登记。同一浏览凭证的重试返回原登记，避免网络重试额外占名额；不同凭证可提交相同号码。
5. 提示「登记成功，AI 点数将由 Xmind 后台统一发放」。名单不含充值状态，不表示实时到账。

网站管理员登录后可以直接查看名单。为 Xmind 工作人员开放访问时，在服务器的 `.env` 中配置至少 32 位随机字符的 `XMIND_LIST_TOKEN`，重启 API 后，将口令和 `/benefits/records` 页面地址通过双方约定的私密渠道提供给指定人员。

该口令只授权读取和导出 Xmind 名单，不授予其他管理权限。口令不写在 URL、不持久化到浏览器存储。名单页在可见状态下每 5 秒读取一次，显示最近成功更新时间；可导出包含手机号、北京时间和序号的 CSV。未配置口令时仅管理员可访问，审核员和普通学生均不可访问。

API：

- `GET /api/benefits/status`：仅公开活动状态与剩余数量。
- `POST /api/benefits/xmind/visit`：已登录用户取得浏览凭证。
- `POST /api/benefits/xmind/register`：提交 `token`、`phone`、`consent: true`。
- `GET /api/benefits/xmind/registrations`：管理员会话或 `Authorization: Bearer <口令>`，返回名单。
- 同一路径加 `?format=csv` 导出名单。

正式开放前需确认活动开放与截止时间、到账安排、点数有效期及登记保存期限。当前没有预约定时开关，部署且可登录后即可登记，请在准备好收集名单后再上线。

## MarginNote 兑换码

真实兑换码只导入服务器数据库，不提交 Git，也不放进公开静态文件。素材包中的 CSV 第一列为兑换码；先在服务器受限目录解压，再运行：

```bash
npm run benefits:import -- /绝对路径/树仁第一批OfferCode（100 个）.csv
```

导入可重复执行，相同码自动跳过，命令只显示导入数量。若提示格式错误，不要将完整兑换码名单粘贴到公开 issue 或 PR。

合作方确认完整兑换、自动续订与取消说明后，把面向用户的说明填入服务端 `.env` 的 `MARGINNOTE_RENEWAL_TERMS` 并重启 API。在此之前页面可浏览，但领取接口保持关闭，不用素材中的待确认价格代替正式条款。

每个站内账号分配一个码，数据库事务和唯一约束保证不重复分配；用户再次打开可查看自己的原码。站内账号注销后，已分配的码不会重新发给别人。2027 年 2 月 12 日北京时间结束后不再发新码。站内账号限制不能保证一名学生只持有一个账号，也不能替代 Apple 的兑换资格判断。

宣传片原文件约 293 MB，MVP 使用提供的截图，不将大视频直接加入仓库。正式版如需视频，先提供适合网页播放的压缩版本或托管地址。页面中的 Xmind 视频直接链接官方哔哩哔哩视频，避免加载第三方嵌入播放器。

## 验证

```bash
npm run build
node --import tsx --test --test-isolation=none tests/benefits.test.ts
node --import tsx --test --test-isolation=none --test-name-pattern='partner source|the dev server listens' tests/dev-server.test.ts
```

新增用例覆盖：30 秒等待、凭证过期与账号绑定、手机号格式和同意用途、重复提交、200 条上限、兑换码分配与账号隔离、注销后不回收旧码、名单授权与 CSV 导出。原有开发服务器测试继续保留；当前受限执行环境不能监听网络端口，完整 HTTP 回归及浏览器检查需在可启动服务的 WSL 环境运行。

素材 ZIP 含尚未分配的真实兑换码，原始 ZIP、CSV、DOCX 已在开发服务器静态访问规则中禁用。公开页面只使用从素材中提取的指定图片。
