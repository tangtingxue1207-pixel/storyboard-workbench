# 公网 HTTPS 部署说明

目标：把分镜 Web 小程序部署成飞书网页应用可访问的公网 HTTPS 地址。

## 必须注意

- 飞书网页应用不能使用 `http://127.0.0.1:3003`。
- 飞书网页应用主页必须填写公网 `https://...` 地址。
- `.env.local` 里的密钥不要上传到仓库。
- `OPENAI_API_KEY` 和 `FEISHU_APP_SECRET` 只能配置在服务器 / 平台环境变量里。

## 环境变量

参考 `.env.example`，线上至少配置：

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
OPENAI_IMAGE_PROVIDER=mock
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_SIZE=1536x1024
OPENAI_IMAGE_QUALITY=low

FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_BASE_URL=https://open.feishu.cn
```

如果希望保存飞书创建的共享项目，还需要持久目录：

```bash
STORYBOARD_STORE_DIR=/app/.storyboard-shared
```

## 方案 A：Vercel

适合快速拿 HTTPS 地址。

1. 新建 GitHub 仓库。
2. 上传 `storyboard-pdf-app` 项目代码。
3. 在 Vercel 新建项目，选择这个仓库。
4. Framework 选择 `Next.js`。
5. Build Command 使用：

```bash
npm run build
```

6. Output Directory 保持默认。
7. 在 Vercel 的 Environment Variables 中填入上面的环境变量。
8. 点击 Deploy。
9. 部署完成后会得到：

```text
https://xxx.vercel.app
```

10. 把这个地址填到飞书开放平台：

- 网页应用 → 桌面端主页
- 网页应用 → 移动端主页

注意：Vercel 的本地文件系统不是持久存储，`.storyboard-shared` 只适合临时测试。正式多人使用建议改接数据库或对象存储。

## 方案 B：服务器 Docker

适合正式内部使用。

在服务器上执行：

```bash
docker build -t storyboard-workbench .
docker run -d \
  --name storyboard-workbench \
  -p 3003:3003 \
  -e OPENAI_API_KEY="你的 OpenAI Key" \
  -e OPENAI_MODEL="gpt-4.1-mini" \
  -e OPENAI_IMAGE_PROVIDER="mock" \
  -e FEISHU_APP_ID="你的飞书 App ID" \
  -e FEISHU_APP_SECRET="你的飞书 App Secret" \
  -e STORYBOARD_STORE_DIR="/app/.storyboard-shared" \
  -v storyboard-data:/app/.storyboard-shared \
  storyboard-workbench
```

然后用 Nginx / Caddy 配 HTTPS 域名，例如：

```text
https://storyboard.your-company.com
```

把这个 HTTPS 地址填到飞书开放平台网页应用主页。

## 飞书网页应用填写

网页应用页面填写：

```text
桌面端主页：https://你的域名
移动端主页：https://你的域名
```

打开方式建议先选：

```text
在飞书内新标签页打开
```

## 部署后测试

1. 浏览器打开公网地址。
2. 导入脚本表格。
3. 保存项目。
4. 刷新页面确认项目能恢复。
5. 在飞书开放平台保存网页应用主页。
6. 创建版本并发布。
7. 在飞书客户端打开应用测试。
