# PDF 黑白勾线分镜生成器

Next.js + React + TypeScript + Tailwind MVP，用于把上传的剧本 PDF 转换为可编辑的黑白勾线分镜工作台。

## 功能

- 上传 PDF，并通过 `pdfjs-dist` 提取文本。
- 上传后先请求 `/api/parse-script` 做 AI 分镜解析，失败时自动回退为段落切分。
- 使用 Zod 校验接口返回数组，避免错误格式导致页面崩溃。
- 每条分镜包含分镜号、脚本文字、贴图参考、镜头移动、备注、分镜图。
- 左侧编辑文字字段，右侧预览黑白线稿分镜图。
- 支持单条编辑、删除、上移、下移。
- “生成线稿”当前使用 mock API，占位图为黑白 SVG。
- 已新增图片生成接口：`src/app/api/generate-panel-image/route.ts`。
- 支持复制单条 GPT 提示词并打开 ChatGPT，在 ChatGPT 手动生成图片后替换回分镜。
- 支持添加文字标签、矩形框、镜头运动箭头。
- 支持替换单张图片。
- 支持单张重新生成、下载当前分镜图、添加参考图。
- 支持导出 PDF。

## 运行

```bash
pnpm install
pnpm dev
```

然后打开：

```text
http://localhost:3000
```

本机开发默认只能自己访问。局域网内多人使用：

```bash
pnpm dev:lan
```

然后让同一 Wi-Fi 的其他人访问你的局域网地址，例如：

```text
http://192.168.31.95:3001/
```

## 不同 Wi-Fi / 外网多人使用

不同 Wi-Fi 的人不能打开 `127.0.0.1` 或局域网地址，需要一个公网入口。

可选方案：

1. 临时演示：使用公网隧道，把本机 `3001` 暴露成 `https://...` 地址。对方用这个公网地址进入小程序。
2. 稳定使用：部署到有公网 IP/域名的服务器，运行生产服务。

生产启动示例：

```bash
pnpm build
STORYBOARD_STORE_DIR=/data/storyboard-projects pnpm start:public
```

多人协作方式：

- 普通打开公网首页：每个人进入各自的新项目。
- 在项目里点击“分享”：生成同一个项目链接，别人打开该链接会进入同一个项目。
- 同一个分享链接里的编辑会保存到服务端 `STORYBOARD_STORE_DIR` 目录。

注意：当前是“同项目共享/接力编辑”，不是 Google Docs 那种实时多人光标同步；多人同时改同一项目时，最后保存的人会覆盖最新项目状态。

## 当前环境说明

本项目代码已完成。当前机器网络在安装 `next`、`pdfjs-dist`、`typescript` 时出现 registry DNS/timeout 问题，导致本机依赖安装未完全结束。网络恢复后重新运行：

```bash
pnpm install
pnpm build
pnpm dev
```

即可启动。

## AI 解析与 OpenAI Images API 接入点

`src/app/api/parse-script/route.ts` 会接收提取出的剧本文字，并返回：

```text
shotNumber, scriptText, cameraMove, notes, imagePrompt
```

如果配置了 `OPENAI_API_KEY`，接口会尝试调用 OpenAI；如果调用失败或返回格式不正确，会回退到本地段落切分。

浏览器端不要直接放 API Key。图片生成请求统一走 Next.js server route：

```text
src/app/api/generate-panel-image/route.ts
```

接口输入为 `scriptText`、`imagePrompt`、`cameraMove`、`referenceImages`，返回 `{ imageUrl }`。默认在存在 `OPENAI_API_KEY` 时调用 OpenAI Images API，并通过 `OPENAI_PROXY_URL` 代理访问；未配置时默认使用本机 Clash 端口 `http://127.0.0.1:7890`。需要强制使用本地占位图时，可设置 `OPENAI_IMAGE_PROVIDER=mock`。如果希望 OpenAI 失败后自动回退到本地占位图，可设置 `OPENAI_IMAGE_FALLBACK=mock`。

默认分镜图提示词：

```text
Create a simple black-and-white storyboard line drawing.
Rough human figures, minimal facial detail, simple scene indication.
Clean white background, cinematic framing, clear composition.
No shading, no color, no realistic rendering.
Scene: {{scriptText}}
Camera movement: {{cameraMove}}
Characters: use generic figures labeled A and B if needed.
```
