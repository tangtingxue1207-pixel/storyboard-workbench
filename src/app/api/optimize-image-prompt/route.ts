import { z } from "zod";
import { openAIFetchOptions } from "@/lib/openAIProxy";

const RequestSchema = z.object({
  type: z.enum(["scene", "character", "prop"]),
  name: z.string(),
  coreRequirements: z.string(),
  currentPrompt: z.string().optional(),
  rulePrompt: z.string().optional(),
});

const ResponseSchema = z.object({
  imagePrompt: z.string(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: "Invalid optimize request" }, { status: 400 });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return Response.json({ imagePrompt: localOptimizedPrompt(parsed.data), source: "local" });
    }
    const result = await optimizeImagePrompt(parsed.data);
    return Response.json({ ...result, source: "ai" });
  } catch {
    return Response.json({ imagePrompt: localOptimizedPrompt(parsed.data), source: "local" });
  }
}

async function optimizeImagePrompt(input: z.infer<typeof RequestSchema>) {
  const instruction = input.type === "scene" ? scenePromptSkillInstruction(input) : assetPromptInstruction(input);
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
          content: instruction.system,
        },
        {
          role: "user",
          content: instruction.user,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "optimized_image_prompt",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["imagePrompt"],
            properties: {
              imagePrompt: { type: "string" },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) throw new Error("OpenAI optimize failed");

  const data = await response.json();
  const outputText = data.output_text ?? data.output?.[0]?.content?.[0]?.text;
  const parsed = ResponseSchema.safeParse(JSON.parse(outputText));
  if (!parsed.success) throw new Error("Invalid AI optimize response");
  const cleaned = cleanOptimizedPrompt(parsed.data.imagePrompt);
  return {
    imagePrompt: ensurePromptChanged(input, cleaned),
  };
}

function scenePromptSkillInstruction(input: z.infer<typeof RequestSchema>) {
  return {
    system:
      "你正在执行“场景生图提示词 skill”。你的身份是影视美术指导、广告场景设计师和 AI Prompt Engineer。你只根据用户提供的场景核心词生成生图提示词，不重新分析脚本，不读取镜头内容，不照抄模板。输出必须是 JSON。",
    user: `任务：根据“场景核心词”生成可直接复制到 LibTV、GPT Image、Flux、Midjourney、Stable Diffusion 的中文场景生图提示词。

场景名称：
${input.name}

场景核心词：
${input.coreRequirements}

当前模板提示词（仅用于避免照抄，不可作为正向内容来源）：
${input.rulePrompt || input.currentPrompt || ""}

生成规则：
1. 只使用“场景核心词”中的信息生成提示词。
2. 不重新分析脚本，不新增核心词之外的关键空间、关键道具、人物关系或剧情。
3. 输出结构固定为：
   场景叙述词：
   反向提示词：
4. “场景叙述词”必须是一段完整、自然、可视化的中文画面描述，不要字段名，不要项目符号，不要关键词堆叠。
5. 内容顺序按：场景定位 → 空间结构 → 环境陈设 → 材质细节 → 光线色彩 → 构图摄影 → 真实质感。
6. 默认生成无人物场景图；不要写人物动作、人物位置、人物关系、剧情或对白。
7. 场景必须表现完整空间环境，语义上避免“房间一角、局部角落、只拍墙角、裁切过近”。
8. 不要出现中英文交错，不要输出英文 Prompt。
9. 不要出现“根据核心词”“必须包含”“脚本中出现”“等词语”“输出应”等工作说明。
10. 在场景叙述词结尾自然加入：35mm 胶片质感，轻微胶片颗粒，真实镜头景深，有抓拍感。
11. 反向提示词固定为：杂乱背景，不要卡通风，不要影棚假景感，不要塑料感，不要七百二十度全景，不要虚拟现实环景，不要鱼眼视角，不要超广角畸变。
12. 最终只返回 imagePrompt 字符串，且必须明显不同于当前模板提示词。`,
  };
}

function assetPromptInstruction(input: z.infer<typeof RequestSchema>) {
  return {
    system:
      "你是 AI 生图提示词生成器。你的任务不是润色原句，而是只根据用户提供的核心要求，重新生成一段描写真实对象的中文生图提示词。不得重新分析脚本，不得新增核心要求之外的关键人物关系、剧情或道具。规则生成词只可用于继承反向提示词，不可照抄正向内容。只返回 JSON。",
    user: `请根据当前 ${assetTypeLabel(input.type)} 的核心要求，重新生成可直接用于生图的提示词。

名称：
${input.name}

核心要求：
${input.coreRequirements}

当前生图词：
${input.currentPrompt || ""}

规则生成词：
${input.rulePrompt || ""}

要求：
1. 只根据“核心要求”生成，不重新分析脚本，不读取镜头内容，不新增核心要求之外的关键元素。
2. “当前生图词”和“规则生成词”只能作为反例和反向提示词来源；正向内容必须重新生成，不可照抄当前生图词或规则生成词。
3. 输出必须是可直接复制到 LibTV / GPT Image / Flux / Midjourney / Stable Diffusion 的中文生图提示词。
4. 不要输出分析过程、字段名、工作说明、自检说明。
5. 句子必须自然通顺，像完整画面描述，不要关键词堆叠。
6. 删除重复词、空字段残留、语义冲突和不完整残句。
7. 如果是人物，保留人物三视图要求，强调真实皮肤质感、毛孔和轻微瑕疵。
8. 如果是道具，必须生成白底六面图提示词，展示同一个道具的正面、背面、左侧面、右侧面、俯视和 45 度透视角；只控制基础材质、颜色风格、视觉特征和场景适配，不输出额外模式。
9. 必须明显不同于“当前生图词”和“规则生成词”，不能只改标点，不能原样返回。
10. 最终只返回 imagePrompt 字符串。`,
  };
}

function assetTypeLabel(type: z.infer<typeof RequestSchema>["type"]) {
  if (type === "scene") return "场景";
  if (type === "character") return "人物";
  return "道具";
}

function cleanOptimizedPrompt(value: string) {
  return value
    .replace(/```(?:json)?|```/g, "")
    .replace(/画面提示词[:：][\s\S]*?(?=\n\s*反向提示词[:：]|$)/g, "")
    .replace(/AI\s*Prompt（中文）[:：]?/gi, "场景叙述词：")
    .replace(/AI\s*Prompt[:：]?/gi, "场景叙述词：")
    .replace(/生图提示词[:：]?/g, "场景叙述词：")
    .replace(/Negative\s*Prompt[:：]?/gi, "反向提示词：")
    .replace(/Logo/gi, "标志")
    .replace(/HDR/gi, "高动态范围过曝效果")
    .replace(/VR/gi, "虚拟现实")
    .replace(/、、+/g, "、")
    .replace(/，，+/g, "，")
    .replace(/，。/g, "。")
    .trim();
}

function ensurePromptChanged(input: z.infer<typeof RequestSchema>, optimized: string) {
  const rulePrompt = cleanOptimizedPrompt(input.rulePrompt || "");
  const currentPrompt = cleanOptimizedPrompt(input.currentPrompt || "");
  if (optimized && !isTooSimilarPrompt(optimized, rulePrompt) && !isTooSimilarPrompt(optimized, currentPrompt)) return optimized;
  return localOptimizedPrompt(input);
}

function isTooSimilarPrompt(a: string, b: string) {
  if (!a || !b) return false;
  const left = normalizeComparable(a);
  const right = normalizeComparable(b);
  if (left === right) return true;
  const shorter = Math.min(left.length, right.length);
  const longer = Math.max(left.length, right.length);
  if (!longer) return true;
  const sharedRatio = commonPrefixLength(left, right) / longer;
  const overlapRatio = characterOverlapRatio(left, right);
  return (sharedRatio > 0.82 && shorter / longer > 0.88) || overlapRatio > 0.9;
}

function normalizeComparable(value: string) {
  return value.replace(/\s+/g, "").replace(/[，。；、:：,.!?！？\-—]/g, "");
}

function commonPrefixLength(a: string, b: string) {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
}

function characterOverlapRatio(a: string, b: string) {
  const aChars = new Set(a.split(""));
  const bChars = new Set(b.split(""));
  const intersection = Array.from(aChars).filter((char) => bChars.has(char)).length;
  const smaller = Math.min(aChars.size, bChars.size);
  return smaller ? intersection / smaller : 0;
}

function localOptimizedPrompt(input: z.infer<typeof RequestSchema>) {
  if (input.type === "scene") return localScenePrompt(input);
  if (input.type === "character") return localCharacterPrompt(input);
  return localPropPrompt(input);
}

function localScenePrompt(input: z.infer<typeof RequestSchema>) {
  const core = input.coreRequirements;
  const location = cleanClause(coreValue(core, "场景定位") || input.name);
  const layout = cleanClause(coreValue(core, "空间结构"));
  const environment = cleanClause(coreValue(core, "环境元素"));
  const props = cleanClause(coreValue(core, "核心道具"));
  const lighting = cleanClause(coreValue(core, "光线环境"));
  const color = cleanClause(coreValue(core, "色彩氛围"));
  const negative = negativeFromRule(input.rulePrompt || "") || "杂乱背景，不要卡通风，不要影棚假景感，不要塑料感，不要七百二十度全景，不要虚拟现实环景，不要鱼眼视角，不要超广角畸变";
  const setting = normalizeSceneSetting(location || input.name);
  const spaceSentence = naturalSceneSpaceSentence(setting, layout, environment);
  const propsSentence = naturalPropsSentence(props, environment);
  const lightSentence = naturalLightSentence(lighting, color);
  const sentences = [
    `这是一张无人物的真实广告场景参考图，画面以${setting}作为主要环境。`,
    spaceSentence,
    propsSentence,
    "构图采用普通影视镜头语言，从正常视线高度观察空间，画面能看到地面、墙面、背景和空间纵深，前景、中景、后景关系清楚。",
    lightSentence,
    "整体质感为真实材质、自然景深、35mm 胶片质感、轻微胶片颗粒和带有抓拍感的商业摄影画面。",
  ].filter(Boolean).join("");
  return cleanOptimizedPrompt(`场景叙述词：\n${sentences}\n\n反向提示词：\n${negative}`);
}

function normalizeSceneSetting(value: string) {
  const text = cleanClause(value);
  if (!text) return "真实室内空间";
  return text
    .replace(/真实场景，?/g, "")
    .replace(/空间结构清晰，?/g, "")
    .replace(/环境可信，?/g, "")
    .replace(/不要影棚假景感。?/g, "")
    .replace(/。$/g, "")
    .trim() || "真实室内空间";
}

function naturalSceneSpaceSentence(setting: string, layout: string, environment: string) {
  const parts = cleanList([layout, environment]);
  if (!parts.length) return `空间需要呈现${setting}的整体结构，陈设分布自然，背景不过度空洞。`;
  const text = uniqueVisualPhrases(parts.join("、"));
  if (/母婴用品|货架|展示台|咨询|零售/.test(text)) {
    return "空间内设置母婴用品陈列区、侧后方货架、展示台或咨询服务台，并通过通道关系表现清楚的零售动线。";
  }
  if (/尿布台|护理台|纸尿裤|护理用品|收纳/.test(text)) {
    return "空间内以尿布台或护理台作为中景功能区，旁边配置纸尿裤、毛巾、收纳用品和护理用品，周围墙面、柜体和地面形成完整的家庭护理环境。";
  }
  if (/沙发|茶几|地毯|客厅/.test(text)) {
    return "空间内包含沙发、茶几、地毯和后景家居陈设，家具之间保留真实活动距离，呈现完整客厅环境。";
  }
  if (/餐桌|餐椅|辅食|碗|勺/.test(text)) {
    return "空间内以餐桌区域为中心，餐椅或儿童餐椅位于桌边，桌面和后景共同呈现真实家庭用餐环境。";
  }
  return `空间内需要呈现${text}，各处陈设按照真实比例分布，背景、地面和墙面共同形成完整环境。`;
}

function naturalPropsSentence(props: string, environment: string) {
  const items = cleanList(uniqueVisualPhrases(`${props}、${environment}`).split("、")).filter((item) => !/空间|环境|结构|氛围|光|色|风格/.test(item));
  if (!items.length) return "";
  const limited = items.slice(0, 8);
  if (limited.some((item) => /纸尿裤|奶瓶|婴儿床|玩具|母婴用品/.test(item))) {
    return `陈列商品包含${joinChineseList(unique(limited.filter((item) => /纸尿裤|奶瓶|婴儿床|玩具|母婴用品|货架|展示台|咨询台/.test(item))))}，但不要重复堆满画面。`;
  }
  return `画面中保留${joinChineseList(unique(limited))}，这些物件自然融入场景，不做孤立摆拍。`;
}

function naturalLightSentence(lighting: string, color: string) {
  const text = cleanList([lighting, color]).join("，");
  if (!text) return "光线保持柔和自然，色彩低饱和，画面干净但不失真实生活细节。";
  return `光线和色彩依据${uniqueVisualPhrases(text)}组织，整体亮度自然，明暗层次柔和，避免过曝和生硬布光。`;
}

function localCharacterPrompt(input: z.infer<typeof RequestSchema>) {
  const core = cleanClause(input.coreRequirements.replace(/\n+/g, "，"));
  return cleanOptimizedPrompt(`人物三视图角色设定图，角色为${input.name}。画面横向呈现同一人物的正面、侧面和背面视图，年龄、体型、服装、发型和肤色必须完全一致，站姿自然直立，比例真实。人物设定依据为${core}。皮肤需要保留真实纹理、自然毛孔、轻微瑕疵和细小肤色变化，避免过度磨皮、塑料皮肤、明星脸、整容脸、卡通化、夸张美颜、文字、水印、字幕和标志。`);
}

function localPropPrompt(input: z.infer<typeof RequestSchema>) {
  const parts = propPromptPartsFromCore(input.name, input.coreRequirements);
  return cleanOptimizedPrompt(`生成一张${parts.propName}白底六面图，道具风格需要符合${parts.sceneFit}。画面展示同一个道具的正面、背面、左侧面、右侧面、俯视和 45 度透视角，六个视图保持同一造型、颜色、材质和比例。道具基础材质为${parts.baseMaterial}，颜色为${parts.colorStyle}，视觉特征为${parts.visualFeatures}。白色干净背景，光感自然，有自然透视，真实颗粒感，真实摄影参考质感。

反向提示词：
${propNegativePrompt(parts.propName)}`);
}

function propPromptPartsFromCore(name: string, coreRequirements: string) {
  const value = (label: string) => propCoreValue(coreRequirements, label);
  return {
    propName: value("道具名称") || name,
    baseMaterial: value("基础材质") || "符合真实世界中该类道具的常见材质，表面干净，有自然纹理。",
    colorStyle: value("颜色风格") || "低饱和自然色，干净柔和，适合真实广告场景。",
    visualFeatures: value("视觉特征") || `${name}轮廓清晰，结构可辨，边缘细节真实。`,
    sceneFit: value("场景适配") || "当前场景的真实广告美术风格，干净、自然、不廉价。",
  };
}

function propCoreValue(coreRequirements: string, label: string) {
  const match = coreRequirements.match(new RegExp(`${label}[:：]\\s*([^\\n]+(?:\\n(?!\\S+[:：])[^\\n]+)*)`));
  return match?.[1]?.trim().replace(/[。；;]+$/, "") || "";
}

function propNegativePrompt(name: string) {
  const base = "不要塑料感，不要 3D 建模感，不要卡通感，不要可读文字，不要水印，不要字幕，不要明显品牌 logo，不要悬浮摆拍，不要过度光滑，不要廉价电商棚拍感";
  if (/大软包|软包/.test(name.replace(/\s/g, ""))) {
    return `${base}，不要变成塑料袋，不要变成包装袋，不要变成纸箱，不要变成普通靠枕，不要变成沙发，不要变成床垫，不要变成墙面软包`;
  }
  return base;
}

function coreValue(coreRequirements: string, label: string) {
  const normalized = coreRequirements
    .replace(/光线要求/g, "光线环境")
    .replace(/摄影要求/g, "摄影需求")
    .replace(/避免内容/g, "视觉约束");
  const match = normalized.match(new RegExp(`\\*?\\s*${label}[:：]([^\\n]+)`));
  return match?.[1]?.trim().replace(/[。；;]+$/, "") || "";
}

function cleanClause(value: string) {
  return value
    .replace(/无可输出[^，。；]*/g, "")
    .replace(/未填写|无明确|undefined|null|N\/A/gi, "")
    .replace(/必须出现/g, "")
    .replace(/脚本相关(?:道具|视觉元素)?[:：]?/g, "")
    .replace(/[:：]/g, "")
    .replace(/、、+/g, "、")
    .replace(/，，+/g, "，")
    .replace(/^[、，；\s]+|[、，；\s]+$/g, "")
    .trim();
}

function cleanList(values: string[]) {
  return values.map(cleanClause).filter((item) => item && !/^(无|或|和|空间环境|undefined|null|\/)$/.test(item));
}

function uniqueVisualPhrases(value: string) {
  return unique(
    value
      .replace(/[；;，,]/g, "、")
      .split("、")
      .map(cleanClause)
      .filter(Boolean),
  ).join("、");
}

function joinChineseList(items: string[]) {
  const clean = unique(items.map(cleanClause).filter(Boolean));
  if (clean.length <= 1) return clean[0] || "";
  return `${clean.slice(0, -1).join("、")}和${clean[clean.length - 1]}`;
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function negativeFromRule(rulePrompt: string) {
  const match = rulePrompt.match(/反向提示词[:：]\s*([\s\S]+)$/);
  return match?.[1]?.trim() || "";
}
