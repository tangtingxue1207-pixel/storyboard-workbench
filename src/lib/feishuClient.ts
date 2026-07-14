import { extractFeishuTableCandidates } from "@/lib/feishuStoryboard";

const feishuBaseUrl = process.env.FEISHU_BASE_URL || "https://open.feishu.cn";

export async function getFeishuTenantAccessToken() {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET");
  }

  const response = await fetch(`${feishuBaseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret,
    }),
  });
  const data = await response.json();
  const token = data.tenant_access_token;
  if (!response.ok || !token) {
    throw new Error(data.msg || data.error?.message || "Failed to get Feishu tenant access token");
  }
  return token as string;
}

export async function fetchFeishuDocumentTables(documentToken: string) {
  const token = await getFeishuTenantAccessToken();
  const blocks = await fetchAllFeishuBlocks(documentToken, token);
  return extractFeishuTableCandidates(blocks);
}

export async function appendFeishuStoryboardResult(input: {
  documentToken: string;
  projectUrl: string;
  pptxUrl?: string;
  xlsxUrl?: string;
  status: string;
  updatedAt?: string;
}) {
  const token = await getFeishuTenantAccessToken();
  const children = [
    textBlock("分镜项目结果", "heading2"),
    textBlock(`项目链接：${input.projectUrl || "未生成"}`),
    textBlock(`PPTX 导出文件：${input.pptxUrl || "未导出"}`),
    textBlock(`XLSX 导出文件：${input.xlsxUrl || "未导出"}`),
    textBlock(`处理状态：${input.status || "已创建"}`),
    textBlock(`更新时间：${input.updatedAt || new Date().toISOString()}`),
  ];

  const response = await fetch(`${feishuBaseUrl}/open-apis/docx/v1/documents/${encodeURIComponent(input.documentToken)}/blocks/${encodeURIComponent(input.documentToken)}/children`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ children }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code) {
    throw new Error(data.msg || data.error?.message || "Failed to append Feishu document result block");
  }
  return data;
}

async function fetchAllFeishuBlocks(documentToken: string, tenantAccessToken: string) {
  const blocks: unknown[] = [];
  let pageToken = "";

  for (let guard = 0; guard < 50; guard += 1) {
    const url = new URL(`${feishuBaseUrl}/open-apis/docx/v1/documents/${encodeURIComponent(documentToken)}/blocks`);
    url.searchParams.set("page_size", "500");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tenantAccessToken}`,
      },
    });
    const data = await response.json();
    if (!response.ok || data.code) {
      throw new Error(data.msg || data.error?.message || "Failed to fetch Feishu document blocks");
    }
    const items = data.data?.items || data.data?.blocks || [];
    blocks.push(...items);
    if (!data.data?.has_more || !data.data?.page_token) break;
    pageToken = data.data.page_token;
  }

  return blocks;
}

function textBlock(text: string, style = "paragraph") {
  return {
    block_type: style,
    text: {
      elements: [
        {
          text_run: {
            content: text,
          },
        },
      ],
    },
  };
}
