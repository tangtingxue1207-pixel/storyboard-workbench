import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createFeishuProjectState, type FeishuStoryboardField } from "@/lib/feishuStoryboard";

const RequestSchema = z.object({
  documentToken: z.string().min(1),
  tableBlockId: z.string().min(1),
  projectName: z.string().optional(),
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  fieldMapping: z.object({
    shotNumber: z.number().int().nonnegative().optional(),
    scene: z.number().int().nonnegative().optional(),
    characters: z.number().int().nonnegative().optional(),
    product: z.number().int().nonnegative().optional(),
    shotSize: z.number().int().nonnegative().optional(),
    scriptText: z.number().int().nonnegative().optional(),
    dialogue: z.number().int().nonnegative().optional(),
    cameraMove: z.number().int().nonnegative().optional(),
    notes: z.number().int().nonnegative().optional(),
  }),
});

const storeDir = process.env.STORYBOARD_STORE_DIR || path.join(process.cwd(), ".storyboard-shared");

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "创建项目参数不完整" }, { status: 400 });
  }

  const projectId = `project_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const projectState = createFeishuProjectState({
    id: projectId,
    name: parsed.data.projectName || "飞书脚本分镜项目",
    documentToken: parsed.data.documentToken,
    tableBlockId: parsed.data.tableBlockId,
    headers: parsed.data.headers,
    rows: parsed.data.rows,
    fieldMapping: parsed.data.fieldMapping as Partial<Record<FeishuStoryboardField, number>>,
  });

  await mkdir(storeDir, { recursive: true });
  await writeFile(path.join(storeDir, `${projectId}.json`), JSON.stringify(projectState), "utf8");

  const origin = request.nextUrl.origin;
  return NextResponse.json({
    projectId,
    projectUrl: `${origin}/?projectId=${encodeURIComponent(projectId)}`,
    project: projectState,
  });
}
