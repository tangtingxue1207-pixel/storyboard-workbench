# 飞书云文档插件接入方案

第一阶段定位：飞书文档普通表格接入，不优先做多维表格插件。

## 使用路径

1. 用户在飞书文档中点击“脚本转分镜”。
2. 插件获取当前文档 `documentToken`。
3. 插件调用后端扫描当前文档普通表格。
4. 如果有多个表格，插件展示表格列表。
5. 用户选择脚本表格。
6. 插件展示字段映射页面，默认第一行为表头。
7. 用户确认字段映射。
8. 插件调用后端创建 Web 小程序项目。
9. 插件打开返回的 `projectUrl`。
10. Web 小程序继续完成分镜整理、提示词、图片回填、标注、保存和导出。
11. 导出后调用写回接口，在飞书文档末尾追加“分镜项目结果”。

## 接口

### 1. 扫描飞书文档普通表格

`POST /api/feishu/doc-tables`

请求：

```json
{
  "documentToken": "docx_token"
}
```

如果飞书插件已经能拿到 blocks，也可以直接传：

```json
{
  "documentToken": "docx_token",
  "blocks": []
}
```

返回：

```json
{
  "documentToken": "docx_token",
  "tables": [
    {
      "tableBlockId": "block_id",
      "title": "表格 1",
      "rowCount": 12,
      "columnCount": 9,
      "headers": ["镜号", "场景", "人物", "画面内容"],
      "previewRows": [["1", "门店", "妈妈", "进入门店"]],
      "rows": [],
      "autoMapping": {
        "shotNumber": 0,
        "scene": 1,
        "characters": 2,
        "scriptText": 3
      },
      "missingRecommendedFields": []
    }
  ]
}
```

### 2. 创建 Web 小程序项目

`POST /api/feishu/create-project`

请求：

```json
{
  "documentToken": "docx_token",
  "tableBlockId": "block_id",
  "projectName": "母亲节脚本分镜",
  "headers": ["镜号", "场景", "人物", "核心道具", "景别", "画面内容", "台词", "运镜", "备注"],
  "rows": [
    ["1", "门店", "妈妈", "纸尿裤", "中景", "妈妈进入门店", "", "跟拍", ""]
  ],
  "fieldMapping": {
    "shotNumber": 0,
    "scene": 1,
    "characters": 2,
    "product": 3,
    "shotSize": 4,
    "scriptText": 5,
    "dialogue": 6,
    "cameraMove": 7,
    "notes": 8
  }
}
```

返回：

```json
{
  "projectId": "project_...",
  "projectUrl": "https://your-domain/?projectId=project_..."
}
```

### 3. 写回飞书文档结果区块

`POST /api/feishu/write-result`

请求：

```json
{
  "documentToken": "docx_token",
  "projectUrl": "https://your-domain/?projectId=project_...",
  "pptxUrl": "https://your-domain/files/storyboard.pptx",
  "xlsxUrl": "https://your-domain/files/storyboard.xlsx",
  "status": "已导出",
  "updatedAt": "2026-07-14T10:00:00.000Z"
}
```

写回内容：

```text
分镜项目结果

项目链接：...
PPTX 导出文件：...
XLSX 导出文件：...
处理状态：...
更新时间：...
```

## 字段映射

内部字段：

- `shotNumber`：镜号
- `scene`：场景
- `characters`：人物
- `product`：核心道具
- `shotSize`：景别
- `scriptText`：画面内容
- `dialogue`：台词 / 旁白 / 同期声
- `cameraMove`：镜头运动
- `notes`：备注

同义字段：

- 镜号：镜头、镜头号、分镜号、Shot、序号
- 场景：场景、地点、环境
- 人物：人物、角色、出镜人物
- 核心道具：道具、产品、商品、核心道具
- 画面内容：画面内容、动作、镜头内容、描述
- 台词 / 旁白 / 同期声：台词、对白、旁白、口播、同期声、声音、VO
- 镜头运动：镜头运动、运镜、运动方式
- 备注：备注、参考、编号、说明、补充

## 环境变量

后端需要：

```bash
FEISHU_APP_ID=
FEISHU_APP_SECRET=
OPENAI_API_KEY=
```

密钥只允许放后端，前端和飞书插件前端不能保存。

## 第一阶段不做

- 不直接修改原脚本表格。
- 不写回每个镜头图片到原表格。
- 不依赖飞书多维表格。
- 不在前端保存飞书 app secret 或 AI key。
