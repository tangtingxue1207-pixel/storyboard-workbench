import { NextResponse } from "next/server";
import { z } from "zod";
import { appendFeishuStoryboardResult } from "@/lib/feishuClient";

const RequestSchema = z.object({
  documentToken: z.string().min(1),
  projectUrl: z.string().min(1),
  pptxUrl: z.string().optional(),
  xlsxUrl: z.string().optional(),
  status: z.string().optional(),
  updatedAt: z.string().optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "写回参数不完整" }, { status: 400 });
  }

  try {
    const result = await appendFeishuStoryboardResult({
      documentToken: parsed.data.documentToken,
      projectUrl: parsed.data.projectUrl,
      pptxUrl: parsed.data.pptxUrl,
      xlsxUrl: parsed.data.xlsxUrl,
      status: parsed.data.status || "已创建",
      updatedAt: parsed.data.updatedAt,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "写回飞书文档失败",
      },
      { status: 500 },
    );
  }
}
