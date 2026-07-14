import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchFeishuDocumentTables } from "@/lib/feishuClient";
import { extractFeishuTableCandidates } from "@/lib/feishuStoryboard";

const RequestSchema = z.object({
  documentToken: z.string().min(1),
  blocks: z.array(z.unknown()).optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "缺少 documentToken 或 blocks 格式错误" }, { status: 400 });
  }

  try {
    const tables = parsed.data.blocks?.length
      ? extractFeishuTableCandidates(parsed.data.blocks)
      : await fetchFeishuDocumentTables(parsed.data.documentToken);
    return NextResponse.json({
      documentToken: parsed.data.documentToken,
      tables,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "读取飞书文档表格失败",
        tables: [],
      },
      { status: 500 },
    );
  }
}
