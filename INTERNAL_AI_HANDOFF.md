# 分镜小程序内部搭建交接说明

这是一套 Next.js 网页小程序，用于把剧本 PDF / Excel / CSV 导入后整理成可编辑分镜，并支持复制 GPT 生图提示词、粘贴/替换分镜图、画布标注、导出 PDF/PPTX、多人共享项目链接。

## 技术栈

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS
- pdfjs-dist
- jsPDF
- Zod

## 核心功能

- 上传 PDF / XLSX / CSV / 飞书表格导出的 Excel。
- PDF 表格识别：按页渲染、识别表格行列、提取镜号/场景/人物/景别/运镜/画面内容/画面参考/花字/备注/商品。
- AI 解析接口：`/api/parse-script`，失败时回退本地解析。
- 分镜编辑：左侧字段编辑，右侧分镜图与画布标注。
- 支持删除、重排、新增分镜。
- 支持图片替换、下载、粘贴外部复制图片。
- 支持复制单个镜头 GPT 提示词。
- 支持复制本组 8 镜头提示词，GPT 先生成第一张，等待用户输入“下一张”再继续。
- 支持全局图片比例：`16:9 / 4:3 / 1:1 / 9:16 / 3:4 / 21:9`。
- 支持导出 PDF。
- 支持导出可编辑 PPTX：`storyboard_export.pptx`。
- 支持项目保存为本机恢复 HTML。
- 支持共享项目链接：多人打开同一个分享链接进入同一项目。
- 支持普通打开首页时各自新建不同项目。

## 重要文件

```text
src/app/page.tsx                         主页面和工作台逻辑
src/app/api/parse-script/route.ts        AI/本地脚本解析接口
src/app/api/generate-panel-image/route.ts 图片生成接口，默认可 mock，可接 OpenAI
src/app/api/restore-project/route.ts     共享项目保存/读取接口
src/components/ShotEditor.tsx            分镜字段编辑区
src/components/ShotList.tsx              分镜列表和重排
src/components/StoryboardCanvas.tsx      画布标注工具
src/components/UploadDropzone.tsx        文件上传入口
src/lib/pdf.ts                           PDF 表格/文本解析
src/lib/tableImport.ts                   XLSX/CSV 表格导入
src/lib/gptPrompt.ts                     GPT 生图提示词
src/lib/exportPdf.ts                     PDF 导出
src/lib/exportPptx.ts                    PPTX 导出
src/lib/aspectRatio.ts                   图片比例配置
src/types/storyboard.ts                  核心数据结构
docs/FEISHU_DEPLOY.md                    飞书公司内使用部署说明
docs/FEISHU_WIDGET_DOC_IMPORT.md         飞书小组件 / 云文档导入改造说明
打开分镜小程序.command                   Mac 本机双击启动脚本
```

## 本地运行

```bash
npm install
npm run dev
```

默认打开：

```text
http://127.0.0.1:3000
```

本项目当前常用端口是 `3001`，可运行：

```bash
npm run dev:lan
```

打开：

```text
http://127.0.0.1:3001
```

## 生产 / 公网部署

```bash
npm install
npm run build
STORYBOARD_STORE_DIR=/data/storyboard-projects npm run start:public
```

`STORYBOARD_STORE_DIR` 用于保存多人共享项目 JSON 文件。必须使用持久化目录。

建议通过 Nginx/Caddy/公司网关把服务挂到 HTTPS 域名，例如：

```text
https://storyboard.company.com
```

## 飞书内使用

参见：

```text
docs/FEISHU_DEPLOY.md
docs/FEISHU_WIDGET_DOC_IMPORT.md
```

简要步骤：

1. 先把小程序部署到公网 HTTPS 域名。
2. 飞书开放平台创建企业自建应用。
3. 添加网页应用能力。
4. 主页地址填写小程序公网域名。
5. 发布并设置可用范围为公司全员或指定部门。

## 环境变量

不要提交真实 `.env.local`。

可按需配置：

```bash
OPENAI_API_KEY=...
OPENAI_IMAGE_PROVIDER=mock
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_QUALITY=low
OPENAI_IMAGE_SIZE=1536x1024
OPENAI_IMAGE_FALLBACK=mock
OPENAI_PROXY_URL=http://127.0.0.1:7890
STORYBOARD_STORE_DIR=/data/storyboard-projects
```

说明：

- `OPENAI_IMAGE_PROVIDER=mock` 时图片接口使用本地占位图。
- 如果公司内部 AI/图片服务替换 OpenAI，可改 `src/app/api/generate-panel-image/route.ts`。
- 浏览器端不要放 API Key。

## 多人使用逻辑

- 普通打开首页：生成一个新的空白项目。
- 点击“新建”：打开新的空白项目窗口。
- 点击“分享”：当前项目保存到服务端，并复制分享链接。
- 其他人打开分享链接：进入同一个项目。
- 分享项目会自动同步保存回服务端。

当前不是实时协同编辑；多人同时编辑同一项目时，后保存的人会覆盖最新状态。

## 打包交付注意

发送给内部 AI/开发同事时，请发送源码压缩包，不要发送：

```text
node_modules/
.next/
.env.local
*.log
```

内部环境重新运行 `npm install` 即可。
