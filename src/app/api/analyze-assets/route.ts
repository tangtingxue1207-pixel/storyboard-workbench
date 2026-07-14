import { z } from "zod";
import { openAIFetchOptions } from "@/lib/openAIProxy";

const ShotSchema = z.object({
  originalShotNo: z.string(),
  scene: z.string().optional(),
  characters: z.string().optional(),
  rawCharacters: z.string().optional(),
  propsText: z.string().optional(),
  shotSize: z.string().optional(),
  scriptText: z.string().optional(),
  dialogue: z.string().optional(),
  cameraMove: z.string().optional(),
  notes: z.string().optional(),
});

const AssetSchema = z.object({
  type: z.enum(["scene", "character", "prop"]),
  name: z.string(),
  coreRequirements: z.string().optional(),
  imagePrompt: z.string().optional(),
  isLocked: z.boolean().optional(),
});

const CharacterRoleSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()).optional(),
});

const RequestSchema = z.object({
  shots: z.array(ShotSchema),
  assets: z.array(AssetSchema),
  characterRoles: z.array(CharacterRoleSchema).optional(),
});

const ResponseSchema = z.object({
  assets: z.array(
    z.object({
      type: z.enum(["scene", "character", "prop"]),
      name: z.string(),
      coreRequirements: z.string(),
      imagePrompt: z.string(),
    }),
  ),
});

type PromptParts = {
  imageType?: string;
  subject?: string;
  scene?: string;
  environment?: string;
  props?: string;
  layout?: string;
  composition?: string;
  lighting?: string;
  style?: string;
  negative?: string;
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: "Invalid analyze request" }, { status: 400 });
  }

  try {
    const result = await analyzeAssets(parsed.data);
    return Response.json(result);
  } catch {
    return Response.json(fallbackAnalyzeAssets(parsed.data));
  }
}

async function analyzeAssets(input: z.infer<typeof RequestSchema>) {
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const unlockedAssets = input.assets.filter((asset) => !asset.isLocked);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(45000),
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
            "你是一名影视分镜分析专家、电影美术指导（Production Designer）和 AI Prompt Engineer。你的任务是输入任意类型脚本后，以场景为分析对象，先提取场景核心要求，再完全依据场景核心要求生成可直接用于 GPT Image、LibTV、Flux、Midjourney、Stable Diffusion 等主流 AI 生图模型的 Prompt。只返回 JSON，不要 Markdown。",
        },
        {
          role: "user",
          content: `请分析以下分镜数据，只为未锁定条目生成 coreRequirements 和 imagePrompt。

要求：
1. 不要新增未列出的资产名称。
2. 不要覆盖 locked 条目；请求里已经只列出未锁定条目，但仍需遵守。
3. 所有输出均以视觉场景构建为目标，而不是剧情总结。分析对象是“场景”，不是“镜头”；同一场景下的多个镜头必须综合分析后生成一套统一的场景要求。
4. 信息来源优先级必须遵守：第一优先级是脚本明确描述的信息；第二优先级是脚本上下文可以推断的信息；第三优先级是符合真实世界的专业补全。禁止使用第四优先级：固定模板、通用场景描述或与当前脚本无关的默认内容。低优先级不得覆盖高优先级。
5. 推断必须满足：不改变脚本原意，不新增剧情，不新增人物关系，不新增事件，不新增功能空间，不新增关键道具。推断仅用于补全能够支持场景生成的视觉信息。
6. 真实性原则：所有推断均应符合真实世界，参考现实建筑空间、室内设计、城市环境、自然环境、商业空间、公共空间、家居空间和影视美术设计。不得生成超现实、概念化或无法实际拍摄的场景。
7. 处理流程必须严格为：脚本 → ① 场景分析 → ② 场景设计规范 → ③ AI Prompt。
8. “场景分析”必须写清楚每条设计信息来自哪里：要么能从脚本中找到依据，要么能根据脚本唯一推断。不能满足这两点的内容不得进入“场景设计规范”。
9. 第一部分“场景设计规范”必须根据 scene 名称、脚本内容、道具、动作和上下文提取每个独立场景生成图片所必须具备的视觉信息，不得只复述脚本，不得总结剧情，不得描述人物心理。
10. 每一项输出都必须能直接影响 AI 生图结果；如果某项内容不能改变最终画面，或不能从脚本获得依据/唯一推断，则写“无可输出：脚本未提供依据，且无法唯一推断”，不要用通用词填充。
11. 场景设计规范必须严格包含以下 8 项：
   - 场景定位：空间类型，室内/室外，商业空间/家居空间/公共空间/自然环境。
   - 空间结构：建筑风格、空间布局、开放程度、层高、门窗结构、背景区域、功能分区。
   - 光线环境：时间、光源、光线方向、光影层次、整体亮度；脚本没说明时自动合理推断。
   - 色彩氛围：主色调、辅助色、冷暖关系、饱和度、整体氛围。
   - 环境元素：家具、装饰、植物、墙面、地面、窗帘、背景、材质、纹理等影响画面的内容。
   - 核心道具：仅保留影响场景生成的重要道具，忽略无关物品。
   - 摄影需求：适合全景/中景、广告摄影、电影感、画面留白、背景完整、主体位置、空间纵深。
   - 视觉约束：必须避免出现的视觉内容，如杂乱、多余人物、标志、水印、卡通风、高动态范围过曝效果、过度装饰等。
12. 场景推断规则：脚本信息不足时，只允许做“唯一推断”。比如脚本明确写“一家人在客厅聊天”，可以推断家庭客厅和常规客厅家具；但如果脚本只写“室内”，不得新增客厅、卧室、餐厅等功能空间。上午推断自然晨光，下午推断柔和日光，晚上推断暖色室内灯，商业空间推断商业照明。
13. 场景分析必须默认生成“完整空间全景”，而不是局部角落。脚本中出现“家居空间、卧室、客厅、门店、画室、办公室、厨房、儿童房”等空间词时，应理解为完整空间环境，优先使用“完整室内空间、房间全景、完整家居空间、完整门店空间、完整拍摄场景、空间纵深清晰、前景中景后景关系完整、能看到环境结构和空间层次”等表达。禁止默认分析为“房间一角、角落、局部区域、小范围布景、某个墙角”等局部场景。
14. 只有脚本文字明确出现“房间一角、角落、局部、桌面、柜台一侧、沙发旁、墙边、床头区域、近景局部布景”或其他明确限制画面范围的描述时，才允许输出局部空间；否则一律按完整空间全景处理。
15. 场景设计规范中的“摄影需求”必须包含固定规则：画面必须体现完整空间，不得只表现房间一角；需要保留足够的地面、墙面、背景和空间纵深；家具、道具、人物应分布在完整场景中，而不是全部挤在一个局部角落；如果脚本没有明确要求局部构图，默认按全景空间处理。
16. 如果脚本只有简单场景词，例如“淡蓝色家居”“门店”“画室”“卧室”，必须自动补全为“完整的 XX 空间全景，画面展示整体环境结构、空间纵深、前景中景后景关系，不得缩小为局部角落。”
17. 场景 coreRequirements 格式必须严格包含：
场景名称：
{场景名}

一、场景分析

* 脚本依据：列出支撑该场景设计的脚本原文关键词或概括，不写剧情总结。
* 唯一推断：只列出由脚本唯一推出的视觉信息；没有则写“无”。

二、场景设计规范

* 场景定位：...
* 空间结构：...
* 光线环境：...
* 色彩氛围：...
* 环境元素：...
* 核心道具：...
* 摄影需求：...
* 视觉约束：...
18. imagePrompt 必须完全来源于“二、场景设计规范”，不得重新分析脚本，不得增加第二部分不存在的视觉元素，不得遗漏第二部分任何核心信息。生图提示词与设计规范必须保持完全一致。
19. 场景 imagePrompt 必须只包含两段，直接可复制，段落标题也必须使用中文；不得出现“画面提示词”“生图提示词”或任何执行说明：
场景叙述词：
一整段中文场景画面描述，全部采用视觉描述，包括场景、空间、建筑、环境、材质、光线、色彩、摄影、氛围。不得包含剧情、对白、人物心理、故事解释或镜头解读。不得使用适用于所有脚本的通用描述。需要按完整空间环境组织画面描述，但不要把“完整空间全景、wide shot、full room view、clear spatial depth、foreground midground background visible、不要房间一角、不要局部角落、不要裁切过近、不要只拍墙角”等规则原文写入 imagePrompt。场景叙述词末尾必须追加：35mm 胶片质感，轻微胶片颗粒，真实镜头景深，有抓拍感

反向提示词：
杂乱背景，不要卡通风，不要影棚假景感，不要塑料感，不要七百二十度全景，不要虚拟现实环景，不要鱼眼视角，不要超广角畸变
20. 场景生图提示词如果是场景图，必须明确无人普通全景场景图/空间图；这里的全景是影视镜头语言中的普通全景，不是三百六十度全景、七百二十度全景、虚拟现实环景、鱼眼或超广角远景；视觉约束里不要写脚本外不存在的具体人物名称，只能写“脚本未要求的人物或身体局部”等泛化约束。
21. 输出前必须自检：每一条设计规范是否能从脚本找到依据或由脚本唯一推断；是否存在大量可适用于任意脚本的固定描述；是否存在无法体现当前场景特征的泛化描述；是否所有输出均可直接转化为视觉画面；生图提示词是否只来自设计规范。不满足则重新生成。
22. 人物要求必须是“真实人物三视图角色设定图提示词”，不要写分析过程，不要引用或复述具体镜头内容。必须包含年龄段、性别、身份、服装、发型、体态、气质、表情范围、真实皮肤质感、毛孔、轻微瑕疵、自然光下肤色、不要明星脸、不要塑料感。
23. 道具核心词必须简洁，只包含“道具名称、基础材质、颜色风格、视觉特征、场景适配”五项；道具 imagePrompt 必须生成白底六面图，展示正面、背面、左侧面、右侧面、俯视和 45 度透视角，不要输出额外模式或复杂比例分析。
24. 不确定的信息写成可执行的视觉约束，例如“保持同一外观和材质一致”，不要写“根据镜头内容补充”“参考相关镜头内容”。
25. 人物分析必须严格按照“标准角色表”输出：不要新增角色，不要合并标准角色，不要把“怀孕妈妈”和“妈妈”混为一人，不要把“宝宝”和“孩子”混为一人。
26. 如果镜头 rawCharacters 与 characters 不一致，以 characters 中的标准角色为准；rawCharacters 只用于理解原始写法。
27. coreRequirements 只能包含资产本身的稳定视觉要求，不要包含具体镜号、台词、剧情动作、镜头内容原文。
28. coreRequirements 和 imagePrompt 不能一模一样。coreRequirements 是结构化分析，imagePrompt 是完整可复制生图提示词。

标准角色表：
${JSON.stringify(input.characterRoles ?? [], null, 2)}

未锁定资产：
${JSON.stringify(unlockedAssets, null, 2)}

镜头：
${JSON.stringify(input.shots, null, 2)}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "asset_requirements",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["assets"],
            properties: {
              assets: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["type", "name", "coreRequirements", "imagePrompt"],
                  properties: {
                    type: { type: "string", enum: ["scene", "character", "prop"] },
                    name: { type: "string" },
                    coreRequirements: { type: "string" },
                    imagePrompt: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) throw new Error("OpenAI analyze failed");

  const data = await response.json();
  const outputText = data.output_text ?? data.output?.[0]?.content?.[0]?.text;
  const parsed = ResponseSchema.safeParse(JSON.parse(outputText));
  if (!parsed.success) throw new Error("Invalid AI analyze response");
  return enforceSceneSpecificRequirements(parsed.data, input);
}

function enforceSceneSpecificRequirements(
  result: z.infer<typeof ResponseSchema>,
  input: z.infer<typeof RequestSchema>,
) {
  return {
    assets: result.assets.map((asset) => {
      const relatedShots = relatedShotsForAsset(input.shots, asset);
      if (asset.type === "scene") {
        const scene = inferScenePromptDetails(asset.name, relatedShots);
        const aiCore = cleanSceneCoreRequirements(asset.name, asset.coreRequirements);
        const coreRequirements = isUsefulSceneCore(aiCore) ? mergeSceneCoreWithInferred(aiCore, scene) : sceneCoreRequirements(asset.name, scene);
        return {
          ...asset,
          coreRequirements,
          imagePrompt: sceneImagePromptFromCore(coreRequirements),
        };
      }
      if (asset.type === "character") {
        const coreRequirements = characterCoreRequirements(asset.name, relatedShots);
        return {
          ...asset,
          coreRequirements,
          imagePrompt: characterImagePromptFromCore(asset.name, coreRequirements),
        };
      }
      const coreRequirements = propCoreRequirements(asset.name, relatedShots);
      return {
        ...asset,
        coreRequirements,
        imagePrompt: propImagePromptFromCore(asset.name, coreRequirements),
      };
    }),
  };
}

function cleanSceneCoreRequirements(name: string, value = "") {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^场景名称：/.test(trimmed) ? normalizeSceneCoreLabels(trimmed) : `场景名称：\n${name}\n\n一、场景核心要求\n\n${normalizeSceneCoreLabels(trimmed)}`;
}

function isUsefulSceneCore(value: string) {
  if (!value) return false;
  if (/根据镜头内容|参考相关镜头|待补充|空间类型明确|环境可信|真实场景，空间结构清晰/.test(value)) return false;
  return /场景定位|空间结构|光线环境|色彩氛围|环境元素|核心道具|摄影需求|视觉约束|光线要求|摄影要求|避免内容|空间信息|环境信息|光影信息|色彩信息|重要道具|画面风格/.test(value) && value.length > 120;
}

function mergeSceneCoreWithInferred(coreRequirements: string, scene: ReturnType<typeof inferScenePromptDetails>) {
  const next = coreRequirements.replace(
    /(\*\s*摄影需求[:：])([^\n]*)/,
    (_match, label, content) => `${label}${mergeCoreLine(content, fullSpaceDesignRule())}`,
  );
  return polishSceneCoreRequirements(next);
}

function normalizeSceneCoreLabels(value: string) {
  return value
    .replace(/光线要求/g, "光线环境")
    .replace(/摄影要求/g, "摄影需求")
    .replace(/避免内容/g, "视觉约束")
    .replace(/空间信息/g, "场景定位")
    .replace(/光影信息/g, "光线环境")
    .replace(/色彩信息/g, "色彩氛围")
    .replace(/重要道具/g, "核心道具");
}

function normalizePromptLanguage(value: string) {
  return value
    .replace(/画面提示词[:：][\s\S]*?(?=\n\s*反向提示词[:：]|$)/g, "")
    .replace(/AI\s*Prompt（中文）[:：]?/gi, "场景叙述词：")
    .replace(/AI\s*Prompt[:：]?/gi, "场景叙述词：")
    .replace(/生图提示词[:：]?/g, "场景叙述词：")
    .replace(/Negative\s*Prompt[:：]?/gi, "反向提示词：")
    .replace(/完整空间全景，?\s*wide shot，?\s*full room view，?\s*clear spatial depth，?\s*foreground midground background visible，?\s*不要房间一角，?\s*不要局部角落，?\s*不要裁切过近，?\s*不要只拍墙角，?/gi, "")
    .replace(/Logo/gi, "标志")
    .replace(/HDR/gi, "高动态范围过曝效果")
    .replace(/VR/gi, "虚拟现实")
    .replace(/360\s*度?/g, "三百六十度")
    .replace(/720\s*度?/g, "七百二十度");
}

function fallbackAnalyzeAssets(input: z.infer<typeof RequestSchema>) {
  const assets = input.assets
    .filter((asset) => !asset.isLocked)
    .map((asset) => {
      const relatedShots = relatedShotsForAsset(input.shots, asset);
      return {
        type: asset.type,
        name: asset.name,
        ...fallbackRequirements(asset.type, asset.name, relatedShots),
      };
    });

  return { assets };
}

function relatedShotsForAsset(shots: Array<z.infer<typeof ShotSchema>>, asset: z.infer<typeof AssetSchema>) {
  return shots.filter((shot) => {
    if (asset.type === "scene") return normalizeName(shot.scene) === normalizeName(asset.name);
    if (asset.type === "character") return splitNames(shot.characters).some((name) => normalizeName(name) === normalizeName(asset.name));
    return splitNames(shot.propsText).some((name) => normalizeName(name) === normalizeName(asset.name));
  });
}

function sceneCoreRequirements(
  name: string,
  scene: ReturnType<typeof inferScenePromptDetails>,
) {
  const extra = scenePromptExtras(scene);
  const noBasis = "无可输出：脚本未提供依据，且无法唯一推断";
  const photoLine = scene.spaceType === noBasis
    ? fullSpaceDesignRule()
    : `${fullSpaceDesignRule()}；${extra.visualStyle}`;
  const propLine = cleanCoreSentence(scene.propsAndSet || "无明确核心道具");
  return `场景名称：
${name}

一、场景分析

* 脚本依据：${scene.evidence}。
* 唯一推断：${scene.inference}。

二、场景设计规范

* 场景定位：${scene.spaceType}。
* 空间结构：${scene.spatialRelation}。
* 光线环境：${scene.timeLighting}。
* 色彩氛围：${extra.colorPalette}；整体氛围${scene.atmosphere}。
* 环境元素：${cleanCoreSentence(scene.environmentDetails)}。
* 核心道具：${propLine}。
* 摄影需求：${photoLine}。
* 视觉约束：杂乱背景，脚本未要求的人物或身体局部，标志，水印，字幕，可读文字，卡通风，高动态范围过曝效果，过度装饰，影棚假景感，塑料感，三百六十度全景，七百二十度全景，虚拟现实环景，鱼眼视角，超广角畸变。`;
}

function sceneImagePromptFromCore(coreRequirements: string) {
  const normalized = normalizeSceneCoreLabels(coreRequirements);
  const narrative = sceneVisualPromptText(normalized);
  const suffix = "35mm 胶片质感，轻微胶片颗粒，真实镜头景深，有抓拍感";
  const sceneText = narrative.includes(suffix) ? narrative : `${narrative.replace(/[。！？]$/, "")}，${suffix}`;
  return normalizePromptLanguage(`场景叙述词：
${sceneText}

反向提示词：
${sceneNegativePromptText()}`);
}

function sceneVisualPromptText(coreRequirements: string) {
  return composeScenePromptParts(scenePromptPartsFromCore(coreRequirements));
}

function sceneNegativePromptText() {
  return "杂乱背景，不要卡通风，不要影棚假景感，不要塑料感，不要七百二十度全景，不要虚拟现实环景，不要鱼眼视角，不要超广角畸变";
}

function scenePromptPartsFromCore(coreRequirements: string): PromptParts {
  const value = (label: string) => cleanPromptPhrase(visualOnly(sceneCoreValue(coreRequirements, label)));
  return {
    imageType: "无人物真实广告场景图",
    subject: "完整空间环境",
    scene: value("场景定位"),
    environment: value("环境元素"),
    props: value("核心道具"),
    layout: value("空间结构"),
    composition: "普通影视全景构图",
    lighting: value("光线环境"),
    style: [value("色彩氛围"), "真实材质，轻微胶片颗粒，商业广告摄影质感"].filter(Boolean).join("，"),
    negative: sceneNegativePromptText(),
  };
}

function composeScenePromptParts(parts: PromptParts) {
  const clean = normalizePromptParts(parts);
  const sentences = [
    sentenceFrom(["生成一张", clean.imageType || "无人物真实广告场景图"]),
    clean.scene ? `画面呈现${clean.scene}。` : "",
    sceneEnvironmentSentence(clean.environment),
    scenePropsSentence(clean.props, clean.environment),
    clean.layout ? `空间结构上，${rewriteSceneClause(clean.layout)}。` : "",
    clean.composition ? `画面采用${clean.composition}，需要明确呈现地面、墙面、背景和空间纵深，前景、中景、后景关系完整。` : "",
    sceneLightStyleSentence(clean.lighting, clean.style),
  ];
  return cleanGeneratedPrompt(sentences.join(""));
}

function sceneEnvironmentSentence(environment: string) {
  const text = rewriteSceneClause(environment);
  if (!text) return "";
  if (/母婴用品|货架|展示台|咨询|零售动线/.test(text)) {
    return "空间中需要包含母婴用品陈列区、货架、展示台或咨询服务台，并能看到清晰的零售动线。";
  }
  if (/尿布台|护理台|纸尿裤|护理用品/.test(text)) {
    return "空间中需要包含尿布台或护理台，周围有纸尿裤、收纳用品和必要的护理用品，整体保持干净安全。";
  }
  if (/餐桌|餐椅|辅食|碗|勺/.test(text)) {
    return "空间中需要包含餐桌、餐椅或儿童餐椅，桌面保留碗勺、水杯和辅食用品等真实用餐细节。";
  }
  if (/浴盆|洗护台|毛巾|洗护用品/.test(text)) {
    return "空间中需要包含浴盆或洗护台，周围有毛巾、洗护用品和干净的浴室材质。";
  }
  return `空间环境中需要保留${text}。`;
}

function scenePropsSentence(props: string, environment: string) {
  const items = sceneItemList(`${props}、${environment}`);
  if (!items.length) return "";
  if (items.some((item) => /纸尿裤|奶瓶|婴儿床|玩具|母婴用品/.test(item))) {
    const babyItems = sceneItemList(items.filter((item) => /纸尿裤|奶瓶|婴儿床|玩具|母婴用品/.test(item)).join("、"));
    return `陈列商品包括${formatChineseList(babyItems)}等母婴用品。`;
  }
  return `画面中的核心道具包括${formatChineseList(items)}，摆放需要自然并符合真实空间比例。`;
}

function sceneLightStyleSentence(lighting: string, style: string) {
  const lightingText = rewriteSceneClause(lighting);
  const styleText = rewriteSceneClause(style);
  if (lightingText && styleText) return `光影色彩采用${lightingText}，整体呈现${styleText}。`;
  if (lightingText) return `光影色彩采用${lightingText}。`;
  if (styleText) return `整体呈现${styleText}。`;
  return "";
}

function rewriteSceneClause(value: string) {
  return cleanPromptPhrase(value)
    .replace(/必须出现/g, "")
    .replace(/保留明确出现的/g, "")
    .replace(/保留/g, "")
    .replace(/脚本相关(?:道具|视觉元素)?/g, "")
    .replace(/展示台\/咨询台/g, "展示台或咨询服务台")
    .replace(/餐椅\/儿童餐椅/g, "餐椅或儿童餐椅")
    .replace(/浴盆\/洗护台/g, "浴盆或洗护台")
    .replace(/尿布台\/护理台/g, "尿布台或护理台")
    .replace(/清晰零售动线/g, "清晰的零售动线")
    .replace(/展示台咨询台/g, "展示台或咨询服务台")
    .replace(/零售动线纸尿裤/g, "零售动线，纸尿裤")
    .replace(/母婴用品陈列/g, "母婴用品陈列区")
    .replace(/[：:]/g, "")
    .replace(/^[、，；]+|[、，；]+$/g, "")
    .trim();
}

function sceneItemList(value: string) {
  const known = value.match(/纸尿裤|奶瓶|婴儿床|玩具|货架|展示台|咨询服务台|咨询台|尿布台|护理台|收纳用品|护理用品|餐桌|餐椅|儿童餐椅|碗勺|水杯|浴盆|洗护台|毛巾|洗护用品|沙发|茶几|地毯/g) || [];
  return cleanListPhrase(known.join("、")).split("、").filter(Boolean);
}

function formatChineseList(items: string[]) {
  const clean = uniqueTextParts(items).filter(Boolean);
  if (clean.length <= 1) return clean[0] || "";
  return `${clean.slice(0, -1).join("、")}和${clean[clean.length - 1]}`;
}

function composePromptParts(parts: PromptParts) {
  const clean = normalizePromptParts(parts);
  const sentences = [
    sentenceFrom(["生成一张", clean.imageType]),
    clean.scene ? `画面呈现${clean.scene}。` : "",
    clean.environment ? `空间环境中需要保留${rewriteSceneClause(clean.environment)}。` : "",
    clean.props ? `画面中景保留${clean.props}。` : "",
    clean.layout ? `前景和后景保留${clean.layout}。` : "",
    clean.composition ? `画面采用${clean.composition}，需要明确展示地面、墙面、背景和空间纵深，前景、中景、后景关系完整，空间方向清晰。` : "",
    clean.lighting ? `光影氛围为${clean.lighting}。` : "",
    clean.style ? `整体风格为${clean.style}。` : "",
    clean.negative ? `反向提示词：${clean.negative}。` : "",
  ];
  return cleanGeneratedPrompt(sentences.join(""));
}

function joinAsClause(values: Array<string | undefined>) {
  return values.map((value) => cleanPromptPhrase(value || "")).filter(Boolean).join("，");
}

function normalizePromptParts(parts: PromptParts): Required<PromptParts> {
  return {
    imageType: cleanPromptPhrase(parts.imageType || ""),
    subject: cleanPromptPhrase(parts.subject || ""),
    scene: cleanPromptPhrase(parts.scene || ""),
    environment: cleanPromptPhrase(parts.environment || ""),
    props: cleanListPhrase(parts.props || ""),
    layout: cleanPromptPhrase(parts.layout || ""),
    composition: cleanPromptPhrase(parts.composition || ""),
    lighting: cleanPromptPhrase(parts.lighting || ""),
    style: cleanPromptPhrase(parts.style || ""),
    negative: cleanListPhrase(parts.negative || ""),
  };
}

function sentenceFrom(values: string[]) {
  const text = values.map(cleanPromptPhrase).filter(Boolean).join("");
  return text ? `${text}。` : "";
}

function cleanListPhrase(value: string) {
  const items = value
    .split(/[、，,；;]+/)
    .map(cleanPromptPhrase)
    .filter((item) => item && !isEmptyPromptValue(item));
  return uniqueTextParts(items.filter((item, index, all) => {
    const longerDuplicate = all.some((other, otherIndex) => otherIndex !== index && other.length > item.length && other.includes(item));
    return !longerDuplicate;
  })).join("、");
}

function cleanPromptPhrase(value: string) {
  return value
    .replace(/(?:镜号|景别|画面内容|台词|旁白|同期声|镜头运动|备注|场景|人物|核心道具|场景定位|空间结构|环境元素|光线环境|色彩氛围|摄影需求|视觉约束)[:：]/g, "")
    .replace(/AI实拍|实拍AI|AI\s*实拍|实拍\s*AI/gi, "真实摄影")
    .replace(/无可输出[^，。；]*/g, "")
    .replace(/未填写|无明确|无\/|\/|N\/A/gi, "")
    .replace(/家具、和人物/g, "家具和道具")
    .replace(/人物位置|人物分布|人物动作|主角|演员/g, "")
    .replace(/核心道具为或/g, "")
    .replace(/(?:^|[、，；])(?:或|和)(?=$|[、，；])/g, "")
    .replace(/空间方向$/g, "空间方向清晰")
    .replace(/^或$|^和$|^无$|^undefined$|^null$/gi, "")
    .replace(/展示$/g, "")
    .replace(/\s+/g, "")
    .replace(/[，；。]+$/g, "")
    .trim();
}

function cleanGeneratedPrompt(value: string) {
  let text = value
    .replace(/、、+/g, "、")
    .replace(/，，+/g, "，")
    .replace(/、，|，、/g, "，")
    .replace(/，。/g, "。")
    .replace(/展示，/g, "")
    .replace(/(?:^|[、，；。])(?:或|和)(?=$|[、，；。])/g, "")
    .replace(/人物位置|人物分布|人物动作|主角|演员/g, "")
    .replace(/家具、和人物/g, "家具和道具")
    .replace(/核心道具为或/g, "")
    .replace(/空间方向，/g, "空间方向清晰，");
  const sentences = text
    .replace(/(真人广告质感[，；]){2,}/g, "真人广告质感，")
    .replace(/(35mm胶片质感[，；]){2,}/g, "35mm胶片质感，")
    .split(/[。！？]+/)
    .map((sentence) => {
      const parts = sentence
        .split(/[，；]+/)
        .map(cleanPromptPhrase)
        .filter((part) => part && !isEmptyPromptValue(part));
      return uniqueTextParts(parts).join("，");
    })
    .filter(Boolean);
  text = uniqueTextParts(sentences).join("。");
  text = text.replace(/。+/g, "。").replace(/，+/g, "，").replace(/、+/g, "、");
  if (!/[。！？]$/.test(text)) text += "。";
  if (text.length > 220) text = `${text.slice(0, 218).replace(/[，；。][^，；。]*$/, "")}。`;
  return text;
}

function isEmptyPromptValue(value: string) {
  return !value || /^(\/|或|和|无|空间环境|undefined|null)$/i.test(value.trim());
}

function fullSpaceDesignRule() {
  return "采用普通影视全景构图，保留地面、墙面、背景和空间纵深，前景、中景、后景关系完整；家具和道具应分布在完整场景中，避免只呈现局部角落";
}

function polishSceneCoreRequirements(value: string) {
  return value
    .split("\n")
    .map((line) => {
      if (!/^\*\s*[^：:]+[:：]/.test(line)) return line.trimEnd();
      const [label, ...rest] = line.split(/[:：]/);
      return `${label}：${cleanCoreSentence(rest.join("："))}。`;
    })
    .join("\n")
    .replace(/。。+/g, "。")
    .trim();
}

function mergeCoreLine(current: string, addition: string) {
  const cleanCurrent = cleanCoreSentence(current);
  const cleanAddition = cleanCoreSentence(addition);
  if (!cleanCurrent) return cleanAddition;
  if (!cleanAddition || cleanCurrent.includes(cleanAddition)) return cleanCurrent;
  return `${cleanCurrent}；${cleanAddition}`;
}

function cleanCoreSentence(value: string) {
  return value
    .replace(/；?\s*脚本相关(?:道具|视觉元素)[:：]\s*。?/g, "")
    .replace(/；?\s*脚本相关(?:道具|视觉元素)[:：]\s*$/g, "")
    .replace(/；{2,}/g, "；")
    .replace(/，{2,}/g, "，")
    .replace(/\s+/g, " ")
    .replace(/[；，]\s*。/g, "。")
    .replace(/[；，]$/g, "")
    .trim();
}

function sceneRenderingPromptText(coreRequirements: string) {
  const lighting = visualOnly(sceneCoreValue(coreRequirements, "光线环境"));
  const color = visualOnly(sceneCoreValue(coreRequirements, "色彩氛围"));
  const photo = visualOnly(sceneCoreValue(coreRequirements, "摄影需求"));
  const parts = [
    "无人普通全景场景图",
    "自然室内透视",
    "画面包含前景、中景和后景",
    lighting,
    color,
    photo,
    "真实材质纹理",
    "真实空间比例",
    "柔和阴影",
    "环境细节清晰",
  ].filter(Boolean);
  return uniqueTextParts(parts.join("，").split(/[，。；]+/)).join("，");
}

function visualOnly(value: string) {
  return value
    .replace(/无可输出：脚本未提供依据，且无法唯一推断/g, "")
    .replace(/仅根据[^，。；]*[，。；]?/g, "")
    .replace(/不重新分析脚本[，。；]?/g, "")
    .replace(/不新增[^，。；]*[，。；]?/g, "")
    .replace(/不遗漏[^，。；]*[，。；]?/g, "")
    .replace(/输出应[^，。；]*[，。；]?/g, "")
    .replace(/不得[^，。；]*[，。；]?/g, "")
    .replace(/根据[^，。；]*[，。；]?/g, "")
    .replace(/保持一致/g, "")
    .replace(/画面需清楚呈现/g, "")
    .replace(/脚本依据中的/g, "")
    .replace(/空间、道具和环境关系/g, "空间关系、环境")
    .replace(/空间与环境关系/g, "空间关系、环境")
    .replace(/小范围布景/g, "完整拍摄场景")
    .replace(/某个墙角/g, "完整墙面与空间结构")
    .replace(/房间一角/g, "房间整体")
    .replace(/空间一角/g, "空间整体")
    .replace(/场景一角/g, "场景整体")
    .replace(/房间角落/g, "房间整体")
    .replace(/空间角落/g, "空间整体")
    .replace(/场景角落/g, "场景整体")
    .replace(/角落/g, "完整空间")
    .replace(/墙边/g, "完整墙面与空间纵深")
    .replace(/沙发旁/g, "完整客厅空间")
    .replace(/床头区域/g, "完整卧室空间")
    .replace(/柜台一侧/g, "完整柜台和门店空间")
    .replace(/桌面/g, "完整空间中的桌面区域")
    .replace(/近景局部布景/g, "完整拍摄场景")
    .replace(/一隅/g, "整体空间")
    .replace(/局部区域/g, "整体区域")
    .replace(/局部空间/g, "整体空间")
    .replace(/局部场景/g, "整体场景")
    .replace(/由“[^”]*”[^，。；]*[，。；]?/g, "")
    .replace(/脚本相关[^，。；]*[:：]/g, "")
    .replace(/脚本关联[^，。；]*[:：]/g, "")
    .replace(/脚本中/g, "")
    .replace(/脚本/g, "")
    .replace(/依据/g, "")
    .replace(/推断/g, "")
    .replace(/出现/g, "")
    .replace(/例如/g, "")
    .replace(/等视觉元素/g, "")
    .replace(/等/g, "")
    .replace(/只保留/g, "")
    .replace(/脚本出现或唯一推断的/g, "")
    .replace(/核心产品/g, "")
    .replace(/产品互动道具/g, "")
    .replace(/互动道具/g, "")
    .replace(/小象/g, "")
    .replace(/产品/g, "")
    .replace(/道具/g, "")
    .replace(/不额外/g, "")
    .replace(/不/g, "")
    .replace(/无$/g, "")
    .replace(/\s+/g, "")
    .replace(/[；，。]+$/g, "")
    .trim();
}

function sceneCoreBody(coreRequirements: string) {
  return coreRequirements
    .replace(/^场景名称：[\s\S]*?(?=二、场景设计规范|一、场景核心要求|场景核心要求：|$)/, "")
    .replace(/^二、场景设计规范/m, "")
    .replace(/^一、场景核心要求/m, "")
    .replace(/^场景核心要求：/m, "")
    .replace(/\n+/g, "；")
    .replace(/\s+/g, " ")
    .replace(/；?\*\s*[^：:]+[:：]无可输出：脚本未提供依据，且无法唯一推断。?/g, "")
    .trim();
}

function sceneCoreValue(coreRequirements: string, label: string) {
  const normalized = normalizeSceneCoreLabels(coreRequirements);
  const match = normalized.match(new RegExp(`\\*\\s*${label}[:：]([^\\n]+)`));
  return match?.[1]?.trim().replace(/[。；;]+$/, "") || "";
}

function scenePromptExtras(scene: ReturnType<typeof inferScenePromptDetails>) {
  const spaceType = scene.spaceType || "";
  const environmentDetails = scene.environmentDetails || "";
  const propsAndSet = scene.propsAndSet || "";
  const spatialRelation = scene.spatialRelation || "";
  const timeLighting = scene.timeLighting || "";
  const atmosphere = scene.atmosphere || "";
  const noBasis = "无可输出：脚本未提供依据，且无法唯一推断";
  if ([spaceType, environmentDetails, propsAndSet, spatialRelation, timeLighting, atmosphere].some((item) => item.includes(noBasis))) {
    return {
      colorPalette: noBasis,
      visualStyle: noBasis,
      spaceTypeEn: "",
      environmentDetailsEn: "",
      spatialRelationEn: "",
      propsAndSetEn: "",
      timeLightingEn: "",
      colorPaletteEn: "",
      visualStyleEn: "",
      atmosphereEn: "",
    };
  }
  const isStore = /门店|货架|陈列|商业|零售/.test(spaceType + environmentDetails);
  const isBathroom = /浴室|洗护|浴盆|毛巾/.test(spaceType + environmentDetails);
  const isHome = /家庭|居家|客厅|卧室|餐厅|厨房|护理区/.test(spaceType + environmentDetails);
  const colorPalette = isStore
    ? "明亮干净的商业空间色调，白色、浅木色、柔和奶油色为主，少量低饱和母婴产品色作点缀，整体温暖专业"
    : isBathroom
      ? "浅色、白色、米色和柔和暖灰为主，低饱和、干净清爽，材质反光柔和"
      : isHome
        ? "暖白、米色、浅木色、柔和灰绿或低饱和家居色，整体温暖生活化，避免高饱和刺眼颜色"
        : "低饱和自然色调，主色清晰，辅助色克制，冷暖关系符合场景时间和空间属性";
  const visualStyle = isStore
    ? "写实商业广告摄影风格，空间清爽高级，产品陈列秩序明确"
    : "写实电影感生活方式广告风格，真实材质、自然陈设、轻微胶片质感、商业摄影完成度";
  const english = isStore
    ? {
        environmentDetails: "organized maternity and baby product shelves, retail display tables, a consultation counter, clean circulation paths, subtle product packaging without readable text or logos",
        spatialRelation: "display tables and consultation area in the midground, product shelves receding into the side and background, small foreground retail details for depth",
        propsAndSet: "maternity and baby product displays, shelves, consultation table, trial display area, clean retail fixtures",
        timeLighting: "bright business-hour lighting, soft overhead commercial lights mixed with gentle ambient daylight, even illumination on shelves and displays",
        colorPalette: "bright white, light wood, soft cream and low-saturation baby product accents, clean warm professional palette",
        visualStyle: "realistic commercial advertising photography, refined retail space, orderly product display, high-end but believable",
        atmosphere: "professional, warm, reassuring and trustworthy",
      }
    : isBathroom
      ? {
          environmentDetails: "a clean family bathroom or baby washing area with a sink, soft towels, baby bathtub, care products, pale tiles and subtle steam details",
          spatialRelation: "bathtub or washing station in the midground, towels and care products in the foreground, bathroom wall and countertop defining the background",
          propsAndSet: "baby bathtub, towels, baby care products, clean countertop, pale bathroom materials",
          timeLighting: "soft daytime or evening indoor light, gentle mirror or wall reflections, clean highlights on pale materials",
          colorPalette: "white, beige, soft warm gray and pale tile colors, low saturation, clean and fresh",
          visualStyle: "realistic lifestyle advertising photography, clean materials, soft cinematic light, subtle film texture",
          atmosphere: "gentle, safe, clean and intimate",
        }
      : isHome
        ? {
            environmentDetails: "a warm realistic family home interior with sofa, coffee table, rug, bed, dining table or kitchen counter depending on the script clues, natural home decoration and lived-in details",
            spatialRelation: "main furniture and functional props in the midground, small lifestyle details in the foreground, cabinets, curtains, windows or plants creating background depth",
            propsAndSet: "script-related home furniture, childcare objects, soft textiles, storage items, toys or tableware as needed",
            timeLighting: "soft natural window light or warm indoor light, stable light direction, gentle shadows and believable material highlights",
            colorPalette: "warm white, beige, light wood, soft gray green and low-saturation home colors, warm and natural",
            visualStyle: "realistic cinematic lifestyle advertising photography, natural set dressing, real materials, subtle 35mm film texture",
            atmosphere: "warm, relaxed, intimate and believable",
          }
        : {
            environmentDetails: "a realistic cinematic environment with clear architectural boundaries, believable materials, natural set dressing and visible spatial depth",
            spatialRelation: "foreground, midground and background clearly separated, key props and set dressing placed naturally in the midground",
            propsAndSet: "necessary script-related props and set dressing, kept visually consistent and not overcrowded",
            timeLighting: "lighting inferred from the scene time and function, natural highlights, soft shadows and stable contrast",
            colorPalette: "low-saturation natural colors, clear main color and restrained supporting colors, believable warm-cool balance",
            visualStyle: "realistic cinematic commercial photography, natural materials, refined composition and subtle film texture",
            atmosphere: "natural, clean, warm and believable",
          };
  return {
    colorPalette,
    visualStyle,
    spaceTypeEn: isStore ? "a bright realistic maternity and baby retail store" : isBathroom ? "a clean realistic family bathroom or baby care washing area" : isHome ? "a warm realistic family home interior" : "a realistic cinematic scene",
    environmentDetailsEn: english.environmentDetails,
    spatialRelationEn: english.spatialRelation,
    propsAndSetEn: english.propsAndSet,
    timeLightingEn: english.timeLighting,
    colorPaletteEn: english.colorPalette,
    visualStyleEn: english.visualStyle,
    atmosphereEn: english.atmosphere,
  };
}

function fallbackRequirements(type: "scene" | "character" | "prop", name: string, shots: Array<z.infer<typeof ShotSchema>>): {
  coreRequirements: string;
  imagePrompt: string;
} {
  if (type === "scene") {
    const scene = inferScenePromptDetails(name, shots);
    return {
      coreRequirements: sceneCoreRequirements(name, scene),
      imagePrompt: sceneImagePromptFromCore(sceneCoreRequirements(name, scene)),
    };
  }

  if (type === "character") {
    const coreRequirements = characterCoreRequirements(name, shots);
    return {
      coreRequirements,
      imagePrompt: characterImagePromptFromCore(name, coreRequirements),
    };
  }

  const coreRequirements = propCoreRequirements(name, shots);
  return {
    coreRequirements,
    imagePrompt: propImagePromptFromCore(name, coreRequirements),
  };
}

function uniqueTextParts(parts: string[]) {
  const seen = new Set<string>();
  return parts.filter((part) => {
    const clean = part.trim();
    if (!clean || seen.has(clean)) return false;
    seen.add(clean);
    return true;
  });
}

function separateNonScenePrompt(asset: z.infer<typeof ResponseSchema>["assets"][number]) {
  if (asset.type === "character") {
    const imagePrompt = asset.imagePrompt.trim();
    if (imagePrompt && imagePrompt !== asset.coreRequirements.trim() && !/符合核心要求|根据核心要求|参考核心要求|核心要求中/.test(imagePrompt)) return asset;
    return {
      ...asset,
      imagePrompt: characterImagePromptFromCore(asset.name, asset.coreRequirements),
    };
  }
  if (asset.imagePrompt.trim() && asset.imagePrompt.trim() !== asset.coreRequirements.trim()) return asset;
  return {
    ...asset,
    imagePrompt: propImagePromptFromCore(asset.name, asset.coreRequirements),
  };
}

function propCoreRequirements(name: string, shots: Array<z.infer<typeof ShotSchema>>) {
  const profile = inferPropProfile(name, shots);
  return `道具名称：
${name}

基础材质：
${profile.baseMaterial}

颜色风格：
${profile.colorStyle}

视觉特征：
${profile.visualFeatures}

场景适配：
${profile.sceneFit}`;
}

function inferPropProfile(name: string, shots: Array<z.infer<typeof ShotSchema>>) {
  const normalizedName = normalizeName(name);

  const make = (
    baseMaterial: string,
    colorStyle: string,
    visualFeatures: string,
    sceneFit: string,
  ) => ({ baseMaterial, colorStyle, visualFeatures, sceneFit });

  if (/尿布台|护理台|抚触台/.test(normalizedName)) {
    return make(
      "浅木、哑光安全塑料、棉质软垫或防水护理垫。",
      "暖白、浅木色、米色或柔和浅灰，适合母婴护理空间。",
      "长方形稳定台面，四角圆润，可带浅围挡和柔软护理垫，边缘有细腻压边或缝线。",
      "风格干净、温和、安全，适合母婴门店、卧室或家居护理场景。",
    );
  }

  if (/纸尿裤|尿不湿|湿巾/.test(normalizedName)) {
    return make(
      "柔软无纺布、吸收棉层或哑光软包装材质。",
      "白色、浅蓝、浅绿或低饱和浅色系，包装干净但不突出品牌文字。",
      "纸尿裤有柔软厚度和纤维纹理，湿巾包为扁平圆角软包，边缘整齐。",
      "适合母婴门店陈列、护理台或家居收纳场景，整体清洁、柔和、可信。",
    );
  }

  if (/奶瓶|水杯|水壶|奶粉罐/.test(normalizedName)) {
    return make(
      "透明或半透明食品级塑料、玻璃质感，搭配柔软硅胶或哑光杯盖材质。",
      "低饱和浅色系，奶白、浅蓝、浅米或透明色，干净柔和。",
      "轮廓清晰，瓶身通透，有简洁刻度感、自然反光、透明厚度和圆润边缘。",
      "适合母婴门店、餐桌、厨房或家居护理场景，避免廉价电商塑料感。",
    );
  }

  if (/婴儿床|床|床品|被子|夜灯/.test(normalizedName)) {
    return make(
      "浅木、棉麻、针织布、柔软被褥或磨砂灯罩材质。",
      "暖白、米色、浅木色、淡蓝或低饱和家居色。",
      "婴儿床有安全围栏和圆润边缘，床品有柔软层次、织物纹理和自然折痕，夜灯为柔和漫射光。",
      "适合家庭卧室、母婴睡眠空间或哄睡场景，整体安静、柔和、温暖。",
    );
  }

  if (/沙发|茶几|地毯|抱枕/.test(normalizedName)) {
    return make(
      "布艺、棉麻、浅木、柔软织物或低反光桌面材质。",
      "米色、浅灰、浅木、奶油色或低饱和家居色。",
      "轮廓圆润，织物纹理清晰，边缘缝线自然，表面干净柔和。",
      "适合家庭客厅和亲子生活场景，风格真实、温暖、不过度装饰。",
    );
  }

  if (/餐桌|餐椅|儿童餐椅|辅食椅|碗|勺/.test(normalizedName)) {
    return make(
      "浅木、哑光安全塑料、陶瓷、硅胶或低反光餐具材质。",
      "浅木色、暖白、米色为主，辅以柔和低饱和点缀色。",
      "餐桌结构稳定，儿童餐椅有圆润围挡和脚架，碗勺边缘圆滑安全。",
      "适合家庭餐厅、辅食喂养或厨房餐桌场景，干净、温和、有生活感。",
    );
  }

  if (/浴盆|澡盆|毛巾|洗护用品/.test(normalizedName)) {
    return make(
      "哑光安全塑料、柔软棉质毛巾、半透明洗护瓶材质。",
      "白色、浅蓝、浅绿、米色或干净浅色系。",
      "浴盆为椭圆或圆角长方形浅盆，毛巾有棉纤维纹理，洗护瓶轮廓圆润且无可读品牌字。",
      "适合浴室洗护、婴儿护理或家居清洁场景，画面干净、柔和、有轻微水光。",
    );
  }

  if (/货架|展示台|咨询台|收银台|柜台/.test(normalizedName)) {
    return make(
      "浅木、哑光金属、亚克力、玻璃或白色烤漆材质。",
      "白色、浅木色、奶油色或低饱和商业空间色。",
      "货架为多层开放式陈列结构，展示台或咨询台边缘直线干净，表面有轻微哑光反射。",
      "适合母婴门店商业陈列和咨询服务空间，陈列整齐但不拥挤。",
    );
  }

  if (/大软包|软包/.test(normalizedName)) {
    return make(
      "真实布艺、麂皮绒、棉麻或软垫包覆材质。",
      "淡蓝、米白、浅灰或低饱和柔和色，不使用鲜艳塑料色。",
      "大型厚实圆角软垫状结构，轮廓饱满，表面有自然织物纹理、轻微褶皱、柔软压痕和边缘缝线。",
      "适合家居互动、儿童安全软垫或柔软亲子空间，不要误生成包装袋、靠枕、沙发、床垫或墙面软包。",
    );
  }

  if (/玩具|小象|绘本|收纳篮/.test(normalizedName)) {
    return make(
      "毛绒、棉布、软胶、纸质或编织收纳材质。",
      "淡蓝、米白、浅灰、浅木或少量低饱和童趣色。",
      "轮廓圆润，小象可呈毛绒或软胶质感，绘本边缘清晰，收纳篮有编织纹理。",
      "适合儿童房、客厅、卧室或母婴门店陈列场景，童趣但不廉价。",
    );
  }

  if (/厨房台面|橱柜/.test(normalizedName)) {
    return make(
      "石英石、哑光橱柜门板、浅木、金属把手或玻璃材质。",
      "暖白、浅木、浅灰或低饱和厨房色。",
      "台面为水平长条操作面，橱柜门板整齐，边缘清楚，表面有细腻石纹或哑光纹理。",
      "适合家庭厨房、冲奶备餐或日常育儿操作场景，干净真实不过曝。",
    );
  }

  return make(
    "符合真实世界中该类道具的常见材质，表面干净，有自然纹理和适度反光。",
    "根据脚本和场景保持低饱和、真实自然的颜色，不使用过度鲜艳的无关颜色。",
    `${name}轮廓清晰，结构可辨，边缘细节真实，不默认加入破损、污渍或旧化痕迹。`,
    "风格需要和当前场景统一，适合真实广告画面，不要廉价棚拍感。",
  );
}

function propEvidence(name: string, text: string) {
  const hits = uniqueTextParts((text.match(/尿布台|护理台|抚触台|纸尿裤|尿不湿|湿巾|奶瓶|水杯|水壶|奶粉罐|婴儿床|床|床品|被子|夜灯|沙发|茶几|地毯|抱枕|餐桌|餐椅|儿童餐椅|辅食椅|碗|勺|浴盆|澡盆|毛巾|洗护用品|货架|展示台|咨询台|收银台|柜台|小象|大软包|软包|玩具|收纳篮|绘本|厨房台面|橱柜/g) || []));
  const target = hits.includes(name) ? name : hits.slice(0, 6).join("、");
  return target ? `相关镜头中出现或可见：${target}` : `根据道具名称“${name}”建立稳定视觉要求`;
}

function propImagePromptFromCore(name: string, coreRequirements: string) {
  const parts = propPromptPartsFromCore(name, coreRequirements);
  return `生成一张${parts.propName}白底六面图，道具风格需要符合${parts.sceneFit}。画面展示同一个道具的正面、背面、左侧面、右侧面、俯视和 45 度透视角，六个视图保持同一造型、颜色、材质和比例。道具基础材质为${parts.baseMaterial}，颜色为${parts.colorStyle}，视觉特征为${parts.visualFeatures}。白色干净背景，光感自然，有自然透视，真实颗粒感，真实摄影参考质感。

反向提示词：
${propNegativePrompt(parts.propName)}`;
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
  return match?.[1]?.replace(/\n+/g, " ").trim().replace(/[。；;]+$/, "") || "";
}

function propNegativePrompt(name: string) {
  const base = "不要塑料感，不要 3D 建模感，不要卡通感，不要可读文字，不要水印，不要字幕，不要明显品牌 logo，不要悬浮摆拍，不要过度光滑，不要廉价电商棚拍感";
  if (/大软包|软包/.test(normalizeName(name))) {
    return `${base}，不要变成塑料袋，不要变成包装袋，不要变成纸箱，不要变成普通靠枕，不要变成沙发，不要变成床垫，不要变成墙面软包`;
  }
  return base;
}

function characterCoreRequirements(name: string, shots: Array<z.infer<typeof ShotSchema>>) {
  const profile = inferCharacterProfile(name, shots);
  return `人物名称：
${name}

核心要求：
年龄段：${profile.age}。
性别与身份：${profile.genderIdentity}。
国家 / 地域外貌：${profile.nationalLook}。
面部特征：${profile.face}。
服装：${profile.clothing}。
发型：${profile.hair}。
体态与身形：${profile.body}。
气质与表情范围：${profile.temperament}。
皮肤质感：真实皮肤纹理，自然毛孔、轻微瑕疵、细小肤色变化和自然面部油光，避免过度磨皮。
三视图要求：同一角色正面、侧面、背面三视图，年龄、体型、服装、发型、肤色和面部特征保持一致。
注意事项：不要明星脸，不要整容脸，不要塑料皮肤，不要卡通化，不要夸张美颜，不要把该角色与其他标准角色混淆。`;
}

function inferCharacterProfile(name: string, shots: Array<z.infer<typeof ShotSchema>>) {
  const normalizedName = normalizeName(name);
  const text = `${name}\n${shots.map((shot) => [shot.scene, shot.rawCharacters, shot.characters, shot.scriptText, shot.dialogue, shot.notes, shot.propsText].filter(Boolean).join("，")).join("\n")}`;
  const isPregnantMom = /怀孕|孕妈|孕妇|准妈妈/.test(normalizedName) || /怀孕|孕肚|孕妈|孕妇|准妈妈/.test(text);
  const isDad = /爸爸|父亲|宝爸|丈夫/.test(normalizedName);
  const isNurturer = /育儿师|月嫂|护理师|护士|顾问|专家|老师/.test(normalizedName);
  const isBaby = /宝宝|婴儿|新生儿/.test(normalizedName);
  const isChild = /孩子|儿童|小孩|幼儿/.test(normalizedName) && !isBaby;
  const isMom = /妈妈|母亲|宝妈/.test(normalizedName) && !isPregnantMom;
  const nationalLook = inferNationalLook(text);

  if (isPregnantMom) {
    return {
      age: "28-35 岁左右的成年女性，孕中后期，孕肚自然明显但不过度夸张",
      genderIdentity: "女性，怀孕妈妈 / 准妈妈身份，画面中应与普通妈妈角色区分开",
      nationalLook,
      face: "鹅蛋脸或柔和圆脸，五官亲和自然，眉眼温柔，脸部有真实轻微疲惫感和母性温和感",
      clothing: "浅色宽松孕妇连衣裙、针织开衫或柔软家居服，面料舒适，腰腹空间自然，色彩以米白、浅蓝、浅灰或奶油色为主",
      hair: "自然黑色或深棕色中长发，可低马尾、半扎发或柔顺披肩发；发量适中，发丝有细节，刘海可自然偏分，不要精修网红卷发",
      body: "身形柔和，肩颈放松，孕肚体态稳定，站姿或坐姿自然，有真实孕期身体重心",
      temperament: "温柔、安心、期待、有保护欲，表情以轻微微笑、专注和放松为主，不要夸张表演",
    };
  }

  if (isDad) {
    return {
      age: "30-40 岁左右的成年男性",
      genderIdentity: "男性，爸爸 / 家庭照护者身份，成熟可靠，不与育儿师或导购混淆",
      nationalLook,
      face: "脸型自然偏方圆或椭圆，五官端正生活化，可有轻微胡茬或真实皮肤纹理，神态沉稳",
      clothing: "干净休闲的衬衫、针织衫、T 恤或轻薄外套，低饱和色系，符合年轻家庭爸爸形象",
      hair: "黑色或深棕色自然短发，长度在耳上到后颈之间，发际线真实，发丝有自然层次，可轻微凌乱，避免油头精修感",
      body: "中等身材，肩背自然，有照护家庭的稳重体态，动作不夸张",
      temperament: "温和、可靠、有参与感，表情自然放松，可有轻微笑意和认真倾听感",
    };
  }

  if (isNurturer) {
    return {
      age: "28-45 岁左右的成年女性",
      genderIdentity: "女性，专业育儿师 / 母婴护理顾问身份，区别于妈妈角色",
      nationalLook,
      face: "面部亲和专业，五官自然端正，表情稳定可信，眼神专注，有真实职业服务感",
      clothing: "简洁专业的浅色工作服、围裙、针织上衣或母婴门店顾问制服，干净利落，避免强品牌标志",
      hair: "整洁利落的黑色或深棕色发型，可低马尾、低盘发或齐肩短发；额前碎发少，发丝真实，方便照护操作，体现专业服务感",
      body: "站姿端正，动作克制专业，体态轻松但有职业稳定感",
      temperament: "专业、耐心、亲切、可信，表情以温和讲解、示范和关注为主",
    };
  }

  if (isBaby) {
    return {
      age: "0-12 个月婴儿，年龄感明确，不要画成幼儿或成人比例",
      genderIdentity: "婴儿宝宝，性别不强调，保持柔软、真实、健康的婴儿状态",
      nationalLook,
      face: "圆脸、饱满脸颊、大眼睛或自然眯眼，五官稚嫩，表情可安静、好奇或轻微微笑",
      clothing: "柔软连体衣、包屁衣、婴儿睡衣或浅色棉质服装，面料柔软，颜色低饱和",
      hair: "稀疏柔软胎发或贴头短软发，发量少且细，头顶可有自然绒毛感，不能出现成人发型或浓密造型",
      body: "婴儿比例真实，头身比例偏大，四肢短小柔软，有自然肉感和安全姿态",
      temperament: "安静、柔软、被照护感强，可有好奇、放松或被安抚的表情，不要成人化",
    };
  }

  if (isChild) {
    return {
      age: inferChildAge(text),
      genderIdentity: "儿童 / 孩子身份，年龄感与宝宝角色明显区分",
      nationalLook,
      face: "儿童脸部比例真实，脸颊饱满，五官自然稚嫩，眼神好奇有生活感",
      clothing: "舒适童装、卫衣、T 恤、背带裤或家居童装，颜色柔和但比婴儿服更活泼",
      hair: "自然儿童发型，按性别可为柔软短发、齐刘海、低马尾或自然碎发；发丝细软，有儿童发量和自然凌乱感",
      body: "儿童身形比例真实，动作灵活但不过度摆拍，四肢比例符合年龄",
      temperament: "活泼、好奇、放松、有亲近感，表情可轻微笑、专注或自然互动",
    };
  }

  if (isMom) {
    return {
      age: "28-38 岁左右的成年女性，已育妈妈状态，不表现明显孕肚",
      genderIdentity: "女性，妈妈 / 宝妈身份，和怀孕妈妈角色区分开",
      nationalLook,
      face: "脸部柔和自然，五官亲和，眼神温柔，有真实生活中的照护感和轻微疲惫感",
      clothing: "舒适家居服、针织衫、衬衫或低饱和休闲服，干净生活化，有母婴广告质感",
      hair: "自然黑色或深棕色中长发，可半扎、低马尾或自然披发；发丝有真实细节，发尾轻微蓬松，避免夸张染发和精修网红卷发",
      body: "普通成年女性身形，姿态自然放松，有照护孩子的生活体态",
      temperament: "温柔、耐心、亲密、可信，表情以微笑、关注和放松为主，不要网红摆拍感",
    };
  }

  return {
    age: inferAdultAge(text),
    genderIdentity: inferGenderIdentity(name, text),
    nationalLook,
    face: "真实生活化面部，五官自然不模板化，脸型、眉眼和鼻唇比例保持稳定，有可辨识个人特征",
    clothing: inferClothing(text),
    hair: inferHair(text),
    body: "真实普通人身形，比例自然，姿态放松，前后镜头体型保持一致",
    temperament: "自然、可信、有生活感，表情根据角色身份保持克制，不要夸张表演",
  };
}

function inferNationalLook(text: string) {
  if (/欧美|外国|白人|欧洲|美国|金发|蓝眼/.test(text)) return "欧美 / 西方面孔特征，肤色、发色和五官按脚本信息保持一致";
  if (/日本|韩国|韩系|日系/.test(text)) return "东亚面孔特征，可带日系或韩系生活广告气质";
  if (/东南亚|泰国|越南|菲律宾|马来/.test(text)) return "东南亚面孔特征，肤色和五官真实自然";
  return "中国本土 / 东亚面孔特征，肤色自然真实，不做混血化或欧美化处理";
}

function inferChildAge(text: string) {
  if (/幼儿园|学龄前|三岁|3岁|四岁|4岁|五岁|5岁|六岁|6岁/.test(text)) return "3-6 岁学龄前儿童";
  if (/小学|学生|七岁|7岁|八岁|8岁|九岁|9岁/.test(text)) return "6-9 岁儿童";
  return "2-5 岁幼儿或儿童，明显大于宝宝角色";
}

function inferAdultAge(text: string) {
  if (/老人|奶奶|爷爷|外婆|外公/.test(text)) return "60 岁以上老年人";
  if (/年轻|青年|小姐姐|小哥哥/.test(text)) return "22-30 岁年轻成年人";
  return "28-40 岁成年人";
}

function inferGenderIdentity(name: string, text: string) {
  if (/爸爸|父亲|男性|男/.test(`${name}${text}`)) return "男性角色，身份依据角色名称和脚本上下文保持一致";
  if (/妈妈|母亲|女性|女|姐姐|阿姨/.test(`${name}${text}`)) return "女性角色，身份依据角色名称和脚本上下文保持一致";
  return "性别按脚本和角色名称保持一致，不新增人物关系";
}

function inferClothing(text: string) {
  if (/门店|育儿师|顾问|护理师|工作服|制服/.test(text)) return "干净专业的浅色工作服、围裙或母婴服务制服，避免明显品牌标志";
  if (/家居|居家|客厅|卧室|家庭/.test(text)) return "舒适生活化家居服、针织衫、T 恤或休闲衬衫，低饱和柔和色系";
  return "生活化、干净、有广告质感的日常服装，色系低饱和，前后镜头保持一致";
}

function inferHair(text: string) {
  if (/工作服|育儿师|护理师|顾问/.test(text)) return "整洁利落发型，可低马尾、盘发或短发，方便专业操作";
  return "自然真实发型，黑色或深棕色为主，发丝有细节，前后镜头保持一致";
}

function characterImagePromptFromCore(name: string, coreRequirements: string) {
  const cleanCore = coreRequirements
    .replace(/^人物名称：[\s\S]*?(?=核心要求：|$)/, "")
    .replace(/^核心要求：/m, "")
    .replace(/\n+/g, "，")
    .replace(/\s+/g, " ")
    .trim();
  return `人物三视图角色设定图，真实人物商业广告摄影质感，角色为${name}。同一画面横向排列三个视图：正面视图、侧面视图、背面视图，必须是同一人物、同一年龄、同一体型、同一服装、同一发型、同一肤色，站姿自然直立，比例真实，浅灰或白色干净背景，光线均匀。人物设定：${cleanCore}。自然光下真实肤色，皮肤保留真实纹理、毛孔、轻微瑕疵和细小肤色变化，避免过度磨皮和塑料皮肤。表情自然克制，有亲和力，35mm 胶片质感，轻微颗粒，真实镜头景深，不要明星脸，不要整容脸，不要卡通化，不要夸张美颜，不要换装，不要改变发型，不要出现多个人物身份，不要文字、水印、字幕、logo。`;
}

function inferScenePromptDetails(name: string, shots: Array<z.infer<typeof ShotSchema>>) {
  const text = `${name}\n${shots.map((shot) => [shot.scene, shot.scriptText, shot.dialogue, shot.notes, shot.propsText].filter(Boolean).join(" ")).join("\n")}`;
  const evidence = sceneEvidence(text);
  const noBasis = "无可输出：脚本未提供依据，且无法唯一推断";
  const basis = (inference: string) => ({ evidence, inference });
  const sceneName = name || "";
  const isStoreScene = /门店|店内|母婴店|零售|货架|导购|收银|陈列|柜台|试用区|咨询区/.test(sceneName) || /门店|店内|母婴店|货架|导购|收银|陈列|柜台|试用区|咨询区/.test(text);
  const isBathroomScene = /浴室|洗澡|沐浴|洗护|澡盆|浴盆|毛巾|水汽|洗手台/.test(sceneName) || /浴室|洗澡|沐浴|洗护|澡盆|浴盆|毛巾|水汽|洗手台/.test(text);
  const isNurseryScene = /尿布台|换尿布|护理台|抚触台|婴儿护理|护理区/.test(sceneName) || /尿布台|换尿布|护理台|抚触台|婴儿护理|护理区/.test(text);
  const isHomeSoftScene = /淡蓝色|空背|家居空间|大软包|软包|小象/.test(sceneName) || /淡蓝色|空背|家居空间|大软包|软包|小象/.test(text);
  const isBedroomScene = /卧室|婴儿床|床头|哄睡|睡眠空间|夜灯|被子/.test(sceneName) || /卧室|婴儿床|床头|哄睡|睡眠空间|夜灯|被子/.test(text);
  const isDiningScene = /餐厅|餐桌|餐椅|辅食椅|儿童餐椅|碗|勺|吃饭|用餐|辅食/.test(sceneName) || /餐厅|餐桌|餐椅|辅食椅|儿童餐椅|碗|勺|吃饭|用餐|辅食/.test(text);
  const isKitchenScene = /厨房|冲奶|奶瓶|水杯|水壶|台面|橱柜/.test(sceneName) || /厨房|冲奶|奶瓶|水杯|水壶|台面|橱柜/.test(text);
  const isLivingRoomScene = /客厅|沙发|茶几|地毯|玩具|家庭|家中|居家|家居|软包|淡蓝色/.test(sceneName) || /客厅|沙发|茶几|地毯|玩具|家庭|家中|居家|家居|软包|淡蓝色/.test(text);

  if (isStoreScene && !/居家|家中|客厅|卧室|厨房|浴室/.test(sceneName)) {
    return {
      ...basis("由“母婴店/门店/货架/陈列/咨询/试用”等脚本信息唯一推断为母婴零售商业空间"),
      spaceType: "真实母婴门店空间，干净明亮的商业零售环境，空间结构清晰，环境可信",
      environmentDetails: `带有母婴用品货架、产品陈列区、咨询服务区和可试用的展示台，背景能看出门店纵深和真实零售动线；${evidence}`,
      atmosphere: "专业、温暖、安心、亲切，有母婴门店的服务感和可信任感",
      propsAndSet: "前景可有虚化的母婴产品或货架边缘，中景保留产品展示台和咨询区域，后景有整齐货架、柔和店内灯光、清晰零售陈列，所有商品包装不要出现可读文字和 logo",
      spatialRelation: "产品陈列区或咨询台位于画面中景，货架在侧后方形成纵深，展示台和核心产品位于前中景，门店动线清晰",
      timeLighting: "白天或明亮营业时段，店内顶部柔和商业照明与自然环境光结合，货架和展示台受光均匀",
    };
  }

  if (isBathroomScene) {
    return {
      ...basis("由“浴室/洗澡/沐浴/浴盆/毛巾/洗护”等脚本信息唯一推断为家庭洗护空间"),
      spaceType: "真实家庭浴室或婴儿洗护区，干净温暖，空间不拥挤",
      environmentDetails: `有洗手台、柔软毛巾、婴儿浴盆、洗护用品和少量水汽细节，材质真实，环境安全卫生；${evidence}`,
      atmosphere: "温柔、安心、洁净，有母婴护理场景的亲密感",
      propsAndSet: "前景可有轻微虚化的毛巾或洗护用品，中景突出婴儿浴盆或洗护台，后景保留浴室墙面、台面、柔光反射和真实空间深度",
      spatialRelation: "浴盆或洗护台位于画面中景，洗护用品在手边台面或前景，浴室墙面和台面在后方提供空间边界",
      timeLighting: "白天或傍晚室内柔光，浴室镜前灯/墙面反射光柔和，水汽和浅色材质带来干净明亮的光感",
    };
  }

  if (isNurseryScene) {
    return {
      ...basis("由“尿布台/护理台/换尿布/纸尿裤/收纳篮”等脚本信息唯一推断为婴儿护理区"),
      spaceType: "真实家庭婴儿护理完整空间，围绕尿布台/护理台形成清晰功能空间",
      environmentDetails: `有尿布台或护理台、收纳篮、纸尿裤、柔软毛巾、婴儿护理用品、浅色墙面和柔和家居陈设，空间安全、干净、有母婴照护细节；${evidence}`,
      atmosphere: "安心、温暖、细致、柔和，有真实家庭照护感",
      propsAndSet: "前景可有轻微虚化的纸尿裤或护理用品，中景突出尿布台/护理台和整理好的护理物件，后景保留床、柜体、收纳架、浅色墙面和地面形成完整居家纵深",
      spatialRelation: "尿布台/护理台位于画面中景，纸尿裤和护理用品整齐摆放在台面或侧边收纳区，床、柜体、墙面和地面共同稳定完整空间方向",
      timeLighting: "白天自然窗光或室内柔和暖光，护理台台面受光干净，背景阴影柔和不过暗",
    };
  }

  if (isHomeSoftScene) {
    return {
      ...basis("由“淡蓝色空背/家居空间/大软包/小象”等脚本信息唯一推断为家居互动拍摄空间；不新增客厅、卧室等脚本未限定功能空间"),
      spaceType: /淡蓝色/.test(text) ? "淡蓝色空背家居空间，室内家居互动拍摄环境" : "真实家庭家居互动空间，室内环境",
      environmentDetails: `保留脚本明确出现的家居空间、大软包、小象或互动道具；${evidence}`,
      atmosphere: /淡蓝色/.test(text) ? "淡蓝色、干净、轻松，符合儿童互动产品展示氛围" : "围绕脚本中的家居互动关系建立轻松、可亲近的空间氛围",
      propsAndSet: "只保留脚本出现或唯一推断的家居陈设、软包、小象或产品互动道具，不新增脚本未出现的家具类型",
      spatialRelation: "核心产品和大软包位于画面中景，前景和后景只保留能支撑家居空间感的简洁陈设，空间方向保持一致",
      timeLighting: "脚本未限定具体时间；仅可推断为适合室内实拍的均匀柔和光，避免强烈舞台光或夜景光",
    };
  }

  if (isBedroomScene) {
    return {
      ...basis("由“卧室/床/婴儿床/哄睡/夜灯”等脚本信息唯一推断为家庭睡眠空间"),
      spaceType: "真实家庭卧室或母婴睡眠空间，温暖安静，空间层次清晰",
      environmentDetails: `有床、床品、婴儿床或床边护理区、柔软织物和少量生活陈设，环境真实不空洞；${evidence}`,
      atmosphere: "安静、柔和、亲密、放松，有家庭陪伴感",
      propsAndSet: "前景可有虚化床品或床边用品，中景保留床、婴儿床或床边护理区，后景保留床头、灯光、织物纹理和真实卧室纵深",
      spatialRelation: "床、婴儿床或床边护理区位于画面中景，床品在前中景形成柔软层次，床头和灯光在后景稳定空间方向",
      timeLighting: "清晨、午后或夜间暖灯均可，但光线必须柔和安静，床品和墙面有自然渐变阴影",
    };
  }

  if (isDiningScene) {
    return {
      ...basis("由“餐桌/餐椅/儿童餐椅/碗勺/用餐/辅食”等脚本信息唯一推断为家庭餐桌区域"),
      spaceType: "真实家庭餐厅或餐桌区域，干净明亮，带有母婴家庭用餐和辅食细节",
      environmentDetails: `有餐桌、餐椅或儿童餐椅、碗勺、水杯、辅食相关道具、桌面织物和柔和家居陈设，空间方向稳定；${evidence}`,
      atmosphere: "自然、轻松、温暖、有日常家庭照护感",
      propsAndSet: "前景可有虚化餐桌边缘、碗勺或杯具，中景突出餐桌、儿童餐椅和桌面道具，后景保留餐边柜、墙面装饰、窗光或开放式厨房一角",
      spatialRelation: "餐桌位于画面中景，儿童餐椅靠近桌边，碗勺和辅食用品在桌面前中景形成生活细节，餐边柜或厨房区域在后景形成纵深",
      timeLighting: "白天自然窗光或明亮室内柔光，餐桌和餐具受光干净，背景不过曝，桌面材质真实",
    };
  }

  if (isKitchenScene) {
    return {
      ...basis("由“厨房/冲奶/奶瓶/水壶/厨房台面/橱柜”等脚本信息唯一推断为家庭厨房空间"),
      spaceType: "真实家庭厨房空间，干净明亮，带有日常育儿生活细节",
      environmentDetails: `有厨房台面、橱柜、水壶、奶瓶/水杯、清洁的备餐区域和柔和家居陈设，空间方向稳定；${evidence}`,
      atmosphere: "自然、轻松、温暖，有真实家庭照护感",
      propsAndSet: "前景可有虚化杯具或奶瓶，中景突出厨房台面、备餐用品和核心道具，后景保留橱柜、墙面、家电轮廓和柔和自然光",
      spatialRelation: "厨房台面位于画面中景，奶瓶、水杯或水壶位于台面前中景，橱柜和家电在后方保持稳定空间关系",
      timeLighting: "白天自然窗光或明亮厨房灯光，台面和餐桌受光干净，背景不过曝",
    };
  }

  if (isLivingRoomScene) {
    return {
      ...basis("由“客厅/沙发/茶几/地毯/玩具”等脚本信息唯一推断为家庭客厅或居家活动区"),
      spaceType: "真实家庭客厅或居家活动区，室内环境",
      environmentDetails: `保留脚本明确出现的客厅/沙发/茶几/地毯/玩具等视觉元素；${evidence}`,
      atmosphere: "围绕脚本中的居家活动关系建立轻松、可亲近的空间氛围",
      propsAndSet: "只保留脚本出现或唯一推断的客厅家具、玩具或产品互动道具，不新增脚本未出现的家具类型",
      spatialRelation: "核心道具位于画面中景，前景和后景只保留能支撑居家空间感的简洁陈设，空间方向保持一致",
      timeLighting: "脚本未限定具体时间；仅可推断为适合室内实拍的均匀柔和光，避免强烈舞台光或夜景光",
    };
  }

  return {
    ...basis("无"),
    spaceType: noBasis,
    environmentDetails: evidence === "无明确视觉依据" ? noBasis : evidence,
    atmosphere: noBasis,
    propsAndSet: noBasis,
    spatialRelation: noBasis,
    timeLighting: noBasis,
  };
}

function sceneEvidence(text: string) {
  const objects = uniqueTextParts(text.match(/淡蓝色|空背|家居空间|大软包|软包|小象|尿布台|护理台|沙发|茶几|地毯|餐桌|餐椅|儿童餐椅|辅食椅|碗|勺|奶瓶|水杯|浴盆|澡盆|毛巾|洗护用品|货架|展示台|收银台|导购台|婴儿床|床|床头柜|橱柜|厨房台面|绿植|玩具|收纳篮|纸尿裤|推车|产品陈列|门店灯光/g) || []);
  const actions = uniqueTextParts(text.match(/换尿布|洗澡|冲奶|喂养|用餐|哄睡|试用|咨询|挑选|展示|护理|陪伴|玩耍/g) || []);
  return [
    objects.length ? `脚本关联陈设/道具：${objects.slice(0, 12).join("、")}` : "",
    actions.length ? `脚本关联行为氛围：${actions.slice(0, 8).join("、")}` : "",
  ].filter(Boolean).join("；") || "无明确视觉依据";
}

function splitNames(value = "") {
  return value
    .split(/[、，,\/；;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeName(value = "") {
  return value.replace(/\s/g, "").replace(/[：:]+$/, "");
}
