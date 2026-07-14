import {
  AiShotArraySchema,
  ParseScriptRequestSchema,
  type AiShot,
} from "@/lib/parseScriptSchema";
import { openAIFetchOptions } from "@/lib/openAIProxy";
import { buildPanelPrompt } from "@/lib/panelPrompt";
import { normalizeExtractedScriptText } from "@/lib/textClean";

const motionPattern = /(推|推近|拉|后拉|摇左|摇右|上移|下移|俯拍|俯|跟拍|跟|摇|移|特写|近景|中景|中近景|全景|大全|小全|过肩|固定|升格)/g;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const requestResult = ParseScriptRequestSchema.safeParse(body);

  if (!requestResult.success) {
    return Response.json({ error: "Missing script text" }, { status: 400 });
  }

  const text = normalizeExtractedScriptText(requestResult.data.text, { joinSoftBreaks: true });
  const rawShots = await parseWithAiOrFallback(text);
  const result = AiShotArraySchema.safeParse(rawShots);

  if (!result.success) {
    return Response.json({ error: "Invalid parse result" }, { status: 500 });
  }

  return Response.json(result.data);
}

async function parseWithAiOrFallback(text: string): Promise<AiShot[]> {
  if (process.env.OPENAI_API_KEY) {
    try {
      const aiShots = await parseWithOpenAi(text);
      const result = AiShotArraySchema.safeParse(aiShots);
      if (result.success) return result.data;
    } catch {
      // The UI has its own fallback too; this keeps the API useful when AI is unavailable.
    }
  }

  return splitByParagraphs(text);
}

async function parseWithOpenAi(text: string): Promise<unknown> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    ...openAIFetchOptions,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "你是资深广告分镜脚本解析助手，擅长从 PDF 复制文本中还原视频脚本表格。只返回 JSON 数组，不要 Markdown。每项必须包含 shotNumber、scriptText、cameraMove、notes、imagePrompt。",
        },
        {
          role: "user",
          content: `请把以下 PDF 剧本文字还原为分镜数组。规则：
1. 优先识别表格列：镜号、景别、画面描述、画面示意、文案/VO、备注。
2. 每个镜号/Shot/镜头编号必须成为一个数组项，不要合并相邻镜头。
3. scriptText 放画面描述和必要画面示意，保留动作、人物、产品、场景、情绪。
4. cameraMove 放景别和镜头运动，例如全景、中景、近景、特写、推、拉、摇、跟、俯拍；没有则用空字符串。
5. notes 放文案/VO、备注、产品露出、声音、转场等无法归入画面的信息。
6. 不要编造没有出现在文本里的剧情；如果 PDF 换行混乱，请根据镜号顺序和语义恢复。
7. imagePrompt 用英文，适合生成“simple black-and-white storyboard line drawing”，包含当前镜头的场景动作和 cameraMove。

剧本文字：
${text}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "storyboard_shots",
          strict: true,
          schema: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["shotNumber", "scriptText", "cameraMove", "notes", "imagePrompt"],
              properties: {
                shotNumber: { type: "number" },
                scriptText: { type: "string" },
                cameraMove: { type: "string" },
                notes: { type: "string" },
                imagePrompt: { type: "string" },
              },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error("OpenAI parse failed");
  }

  const data = await response.json();
  const outputText = data.output_text ?? data.output?.[0]?.content?.[0]?.text;
  return JSON.parse(outputText);
}

function splitByParagraphs(text: string): AiShot[] {
  const cleanText = normalizeExtractedScriptText(text, { joinSoftBreaks: true });
  const chunks = cleanText
    .split(/(?<=[。！？!?])\s+|\n{2,}/)
    .map((chunk) => normalizeExtractedScriptText(chunk, { joinSoftBreaks: true }))
    .filter(Boolean);

  const grouped: string[] = [];
  for (let i = 0; i < chunks.length; i += 2) {
    grouped.push([chunks[i], chunks[i + 1]].filter(Boolean).join(" "));
  }

  return (grouped.length ? grouped : [cleanText]).map((scriptText, index) => {
    const cameraMove = [...new Set(scriptText.match(motionPattern) ?? [])].slice(0, 3).join(" / ");
    return {
      shotNumber: index + 1,
      scriptText,
      cameraMove,
      notes: "",
      imagePrompt: buildPanelPrompt(scriptText, cameraMove),
    };
  });
}
