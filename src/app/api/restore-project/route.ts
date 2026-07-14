import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const storeDir = process.env.STORYBOARD_STORE_DIR || path.join(process.cwd(), ".storyboard-shared");

function storePath(id: string) {
  return path.join(storeDir, `${id.replace(/[^a-z0-9-]/gi, "")}.json`);
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  const payload = await request.json();
  const requestedId = request.nextUrl.searchParams.get("id");
  const id = requestedId?.replace(/[^a-z0-9-]/gi, "") || randomUUID();
  await mkdir(storeDir, { recursive: true });
  await writeFile(storePath(id), JSON.stringify(payload), "utf8");

  return NextResponse.json({ id }, { headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing restore id" }, { status: 400, headers: corsHeaders });
  }

  try {
    const payload = JSON.parse(await readFile(storePath(id), "utf8"));
    return NextResponse.json(payload, { headers: corsHeaders });
  } catch {
    return NextResponse.json({ error: "Restore data expired" }, { status: 404, headers: corsHeaders });
  }
}
