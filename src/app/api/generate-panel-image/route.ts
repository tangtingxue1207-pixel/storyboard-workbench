import { GeneratePanelImageRequestSchema } from "@/lib/generatePanelImageSchema";
import { normalizeImageAspectRatio } from "@/lib/aspectRatio";
import { openAIFetchOptions } from "@/lib/openAIProxy";
import { buildPanelPrompt } from "@/lib/panelPrompt";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = GeneratePanelImageRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: "Invalid image generation request" }, { status: 400 });
  }

  try {
    const imageUrl = await generateImage(parsed.data);
    return Response.json({ imageUrl });
  } catch (error) {
    return Response.json({ error: readableOpenAIError(error) }, { status: 502 });
  }
}

async function generateImage(data: {
  scriptText: string;
  imagePrompt: string;
  cameraMove: string;
  imageAspectRatio: string;
  referenceImages: string[];
}) {
  if (shouldUseOpenAIImageProvider()) {
    try {
      return await generateWithOpenAI(data);
    } catch (error) {
      console.warn("OpenAI image generation failed, falling back to local storyboard SVG.", error);
      if (process.env.OPENAI_IMAGE_FALLBACK !== "mock") {
        throw error;
      }
    }
  }

  return generateMockStoryboardPanel(data);
}

function shouldUseOpenAIImageProvider() {
  return process.env.OPENAI_IMAGE_PROVIDER !== "mock" && Boolean(process.env.OPENAI_API_KEY);
}

function readableOpenAIError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  try {
    const parsed = JSON.parse(message);
    return parsed.error?.message || message;
  } catch {
    return message;
  }
}

async function generateWithOpenAI({
  scriptText,
  imagePrompt,
  cameraMove,
  imageAspectRatio,
  referenceImages,
}: {
  scriptText: string;
  imagePrompt: string;
  cameraMove: string;
  imageAspectRatio: string;
  referenceImages: string[];
}) {
  const ratio = normalizeImageAspectRatio(imageAspectRatio);
  const prompt = [
    imagePrompt || buildPanelPrompt(scriptText || "Storyboard panel", cameraMove),
    `Aspect ratio: ${ratio}.`,
    "Style reference: very loose black marker storyboard sketch, like quick rough production thumbnails.",
    "Do not render polished illustration. Do not use color. Do not use shading.",
    "Use only sparse black sketch lines on a white background.",
    "Make the drawing clearly match the scene action and camera framing.",
  ].join("\n");

  if (referenceImages.length) {
    return generateOpenAIImageEdit(prompt, referenceImages);
  }

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    signal: AbortSignal.timeout(120000),
    ...openAIFetchOptions,
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
      prompt,
      size: process.env.OPENAI_IMAGE_SIZE || "1536x1024",
      quality: process.env.OPENAI_IMAGE_QUALITY || "low",
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const result = await response.json();
  const base64 = result.data?.[0]?.b64_json;
  if (!base64) throw new Error("OpenAI image response did not include b64_json");

  return `data:image/png;base64,${base64}`;
}

async function generateOpenAIImageEdit(prompt: string, referenceImages: string[]) {
  const form = new FormData();
  form.set("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-2");
  form.set("prompt", prompt);
  form.set("size", process.env.OPENAI_IMAGE_SIZE || "1536x1024");
  form.set("quality", process.env.OPENAI_IMAGE_QUALITY || "low");

  referenceImages.slice(0, 4).forEach((imageUrl, index) => {
    const image = dataUrlToBlob(imageUrl);
    if (image) form.append("image[]", image, `reference-${index + 1}.png`);
  });

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    signal: AbortSignal.timeout(120000),
    ...openAIFetchOptions,
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: form,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const result = await response.json();
  const base64 = result.data?.[0]?.b64_json;
  if (!base64) throw new Error("OpenAI edit response did not include b64_json");

  return `data:image/png;base64,${base64}`;
}

function dataUrlToBlob(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  return new Blob([bytes], { type: match[1] });
}

async function generateMockStoryboardPanel({
  scriptText,
  imagePrompt,
  cameraMove,
  imageAspectRatio,
  referenceImages,
}: {
  scriptText: string;
  imagePrompt: string;
  cameraMove: string;
  imageAspectRatio: string;
  referenceImages: string[];
}) {
  const sceneText = scriptText || "Storyboard panel";
  const ratio = normalizeImageAspectRatio(imageAspectRatio);
  const prompt = [imagePrompt || buildPanelPrompt(sceneText, cameraMove), `Aspect ratio: ${ratio}.`].join("\n");
  const seed = hashText(prompt);
  const scene = analyzeScene(`${sceneText}\n${cameraMove}\n${prompt}`);

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#ffffff"/>
  <g fill="none" stroke="#111111" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="46" y="38" width="1188" height="644"/>
    ${drawEnvironment(scene, seed)}
    ${drawPrimaryAction(scene, seed)}
    ${drawCameraMarks(scene, cameraMove)}
  </g>
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

type SceneProfile = {
  baby: boolean;
  duck: boolean;
  stage: boolean;
  room: boolean;
  singing: boolean;
  mouth: boolean;
  music: boolean;
  closeup: boolean;
  hand: boolean;
  hug: boolean;
  play: boolean;
  fabric: boolean;
  packageSong: boolean;
};

function analyzeScene(text: string): SceneProfile {
  return {
    baby: has(text, ["宝宝", "儿童", "孩子", "模特"]),
    duck: has(text, ["鸭", "小丑鸭", "鸭鸭"]),
    stage: has(text, ["舞台", "景片"]),
    room: has(text, ["儿童房", "房", "客厅", "室内"]),
    singing: has(text, ["唱歌", "歌", "音符"]),
    mouth: has(text, ["嘴巴", "啊吧", "一张一合"]),
    music: has(text, ["三首歌", "切歌", "老虎机", "选中", "音符"]),
    closeup: has(text, ["推近", "特写", "近", "近景", "过肩", "中近"]),
    hand: has(text, ["手", "手持", "举出", "摸", "戳"]),
    hug: has(text, ["抱", "抱着"]),
    play: has(text, ["玩", "互动", "整理", "戳戳", "开心"]),
    fabric: has(text, ["面料", "毛绒", "软糯", "贴贴", "质感"]),
    packageSong: has(text, ["三首歌", "包装", "切歌", "老虎机"]),
  };
}

function drawEnvironment(scene: SceneProfile, seed: number) {
  const floorY = 538 + (seed % 24);
  const base = [
    `<path d="M92 ${floorY} C260 ${floorY - 26}, 412 ${floorY - 4}, 596 ${floorY - 18} S918 ${floorY + 18}, 1184 ${floorY - 8}"/>`,
    `<path d="M86 182 C220 150, 330 158, 448 180"/>`,
  ];

  if (scene.stage) {
    base.push(
      `<path d="M104 116 C184 92, 242 98, 304 124"/>`,
      `<path d="M106 118 L106 474 M306 124 L306 484"/>`,
      `<path d="M910 104 C1000 88, 1100 94, 1174 124"/>`,
      `<path d="M912 106 L912 488 M1172 124 L1172 492"/>`,
      `<path d="M210 572 H1068"/>`,
    );
  } else if (scene.room) {
    base.push(
      `<path d="M120 142 H392 V306 H120 Z"/>`,
      `<path d="M144 202 H366 M256 144 V306"/>`,
      `<path d="M872 194 C980 170, 1074 174, 1160 210"/>`,
      `<path d="M884 236 H1140"/>`,
    );
  }

  return base.join("\n");
}

function drawPrimaryAction(scene: SceneProfile, seed: number) {
  if (scene.closeup && scene.mouth && scene.duck) return drawDuckCloseup(scene, seed);
  if (scene.hand && scene.fabric && scene.duck) return drawTouchFabric(scene, seed);
  if (scene.hug && scene.duck) return drawHugDuck(scene, seed);
  if (scene.music || scene.packageSong) return drawMusicChoice(scene, seed);
  if (scene.duck && scene.baby) return drawBabyWithDuck(scene, seed);
  if (scene.duck) return drawDuckPerformer(scene, seed);
  return drawGenericPeople(seed);
}

function drawBabyWithDuck(scene: SceneProfile, seed: number) {
  const bx = 382 + (seed % 30);
  const dx = 700 + (seed % 38);
  return [
    drawPerson(bx, 250, 0.9, "A"),
    `<path d="M${bx + 54} 390 C${bx + 124} 350, ${dx - 56} 360, ${dx - 20} 390"/>`,
    drawDuck(dx, 306, scene.singing || scene.mouth, 1),
    scene.play ? `<path d="M${bx + 20} 466 C${bx + 112} 514, ${dx + 60} 510, ${dx + 128} 462"/>` : "",
    scene.singing ? drawMusicNotes(dx + 132, 200) : "",
  ].join("\n");
}

function drawDuckCloseup(scene: SceneProfile, seed: number) {
  const x = 642 + (seed % 20);
  return [
    `<ellipse cx="${x}" cy="350" rx="252" ry="174"/>`,
    `<path d="M${x - 80} 292 C${x - 26} 254, ${x + 42} 258, ${x + 96} 294"/>`,
    `<path d="M${x + 70} 330 C${x + 168} 304, ${x + 238} 326, ${x + 272} 372 C${x + 198} 414, ${x + 124} 406, ${x + 64} 374"/>`,
    `<path d="M${x - 176} 236 C${x - 116} 160, ${x - 22} 146, ${x + 52} 188"/>`,
    `<path d="M${x - 108} 420 C${x - 10} 468, ${x + 94} 460, ${x + 170} 408"/>`,
    scene.singing ? drawMusicNotes(948, 138) : "",
  ].join("\n");
}

function drawTouchFabric(scene: SceneProfile, seed: number) {
  const x = 684 + (seed % 28);
  return [
    drawDuck(x, 314, false, 1.08),
    `<path d="M250 236 C330 266, 392 302, 470 350"/>`,
    `<path d="M468 350 C520 382, 560 384, 620 362"/>`,
    `<path d="M502 334 L586 358 M492 370 L574 392 M528 310 L610 336"/>`,
    `<path d="M${x - 78} 498 C${x - 10} 528, ${x + 72} 526, ${x + 148} 490"/>`,
    `<path d="M${x - 112} 436 C${x - 52} 410, ${x + 74} 416, ${x + 136} 440"/>`,
  ].join("\n");
}

function drawHugDuck(scene: SceneProfile, seed: number) {
  const bx = 508 + (seed % 25);
  const dx = bx + 130;
  return [
    drawPerson(bx, 226, 1, "A"),
    drawDuck(dx, 318, scene.singing, 0.82),
    `<path d="M${bx - 46} 360 C${bx + 18} 430, ${dx + 54} 438, ${dx + 124} 366"/>`,
    `<path d="M${bx + 48} 382 C${bx + 106} 430, ${dx + 96} 426, ${dx + 150} 382"/>`,
  ].join("\n");
}

function drawMusicChoice(scene: SceneProfile, seed: number) {
  const x = 568 + (seed % 32);
  return [
    drawDuck(348, 315, true, 0.84),
    `<rect x="${x}" y="196" width="360" height="214" rx="18"/>`,
    `<path d="M${x + 42} 250 H${x + 318}"/>`,
    `<rect x="${x + 48}" y="286" width="72" height="58" rx="12"/>`,
    `<rect x="${x + 144}" y="286" width="72" height="58" rx="12"/>`,
    `<rect x="${x + 240}" y="286" width="72" height="58" rx="12"/>`,
    `<path d="M${x + 72} 318 C${x + 84} 298, ${x + 100} 304, ${x + 104} 318"/>`,
    `<path d="M${x + 168} 318 C${x + 180} 298, ${x + 196} 304, ${x + 200} 318"/>`,
    `<path d="M${x + 264} 318 C${x + 276} 298, ${x + 292} 304, ${x + 296} 318"/>`,
    `<path d="M${x + 180} 424 C${x + 210} 456, ${x + 270} 452, ${x + 306} 418"/>`,
    drawMusicNotes(248, 178),
  ].join("\n");
}

function drawDuckPerformer(scene: SceneProfile, seed: number) {
  const x = 612 + (seed % 36);
  return [
    drawDuck(x, 298, scene.singing, 1.15),
    `<path d="M382 558 H908"/>`,
    scene.singing ? drawMusicNotes(x + 178, 166) : "",
  ].join("\n");
}

function drawGenericPeople(seed: number) {
  const x = 364 + (seed % 44);
  return [
    drawPerson(x, 244, 1, "A"),
    drawPerson(x + 290, 250, 0.98, "B"),
    `<path d="M${x + 78} 390 C${x + 162} 340, ${x + 260} 342, ${x + 338} 388"/>`,
  ].join("\n");
}

function drawPerson(x: number, y: number, scale: number, label: string) {
  const s = scale;
  return `
    <path d="M${x - 48 * s} ${y - 52 * s} C${x - 20 * s} ${y - 92 * s}, ${x + 34 * s} ${y - 86 * s}, ${x + 52 * s} ${y - 46 * s}"/>
    <path d="M${x - 52 * s} ${y - 28 * s} C${x - 18 * s} ${y + 28 * s}, ${x + 42 * s} ${y + 24 * s}, ${x + 66 * s} ${y - 22 * s}"/>
    <path d="M${x - 32 * s} ${y + 38 * s} C${x - 72 * s} ${y + 120 * s}, ${x + 92 * s} ${y + 128 * s}, ${x + 74 * s} ${y + 42 * s}"/>
    <path d="M${x - 18 * s} ${y - 32 * s} L${x + 18 * s} ${y - 24 * s}"/>
    <text x="${x - 12 * s}" y="${y - 8 * s}" font-size="${30 * s}" font-family="Arial, sans-serif" fill="#111111" stroke="none">${label}</text>
  `;
}

function drawDuck(x: number, y: number, singing: boolean, scale: number) {
  const s = scale;
  return `
    <ellipse cx="${x}" cy="${y + 72 * s}" rx="${112 * s}" ry="${92 * s}"/>
    <circle cx="${x - 32 * s}" cy="${y - 2 * s}" r="${58 * s}"/>
    <path d="M${x + 22 * s} ${y - 12 * s} C${x + 92 * s} ${y - 30 * s}, ${x + 140 * s} ${y - 6 * s}, ${x + 154 * s} ${y + 34 * s} C${x + 98 * s} ${y + 62 * s}, ${x + 52 * s} ${y + 50 * s}, ${x + 18 * s} ${y + 22 * s}"/>
    <path d="M${x - 84 * s} ${y - 58 * s} C${x - 52 * s} ${y - 108 * s}, ${x + 26 * s} ${y - 102 * s}, ${x + 58 * s} ${y - 54 * s}"/>
    <path d="M${x - 28 * s} ${y + 162 * s} V${y + 206 * s} M${x + 40 * s} ${y + 160 * s} V${y + 206 * s}"/>
    <path d="M${x - 54 * s} ${y + 210 * s} H${x - 2 * s} M${x + 16 * s} ${y + 210 * s} H${x + 70 * s}"/>
    ${singing ? `<path d="M${x + 62 * s} ${y + 2 * s} C${x + 118 * s} ${y - 16 * s}, ${x + 162 * s} ${y - 4 * s}, ${x + 196 * s} ${y + 22 * s}"/>` : ""}
  `;
}

function drawMusicNotes(x: number, y: number) {
  return `
    <path d="M${x} ${y} V${y + 84} M${x} ${y} C${x + 34} ${y + 4}, ${x + 54} ${y - 6}, ${x + 78} ${y - 24}"/>
    <ellipse cx="${x - 16}" cy="${y + 86}" rx="24" ry="16" transform="rotate(-20 ${x - 16} ${y + 86})"/>
    <path d="M${x + 98} ${y + 46} V${y + 122}"/>
    <ellipse cx="${x + 80}" cy="${y + 126}" rx="22" ry="15" transform="rotate(-20 ${x + 80} ${y + 126})"/>
  `;
}

function drawCameraMarks(scene: SceneProfile, cameraMove: string) {
  if (!has(cameraMove, ["推", "拉", "摇", "移", "上移", "下移"])) return "";
  if (has(cameraMove, ["推", "推近"])) {
    return `<path d="M168 112 L314 212 M1112 112 L966 212 M168 608 L314 508 M1112 608 L966 508"/>`;
  }
  if (has(cameraMove, ["拉"])) {
    return `<path d="M314 212 L168 112 M966 212 L1112 112 M314 508 L168 608 M966 508 L1112 608"/>`;
  }
  if (has(cameraMove, ["摇左"])) return `<path d="M1010 112 C820 84, 560 86, 348 124 M348 124 L394 94 M348 124 L402 154"/>`;
  if (has(cameraMove, ["摇右", "摇"])) return `<path d="M270 112 C462 82, 720 84, 934 124 M934 124 L884 94 M934 124 L880 154"/>`;
  if (has(cameraMove, ["上移"])) return `<path d="M1120 584 V166 M1120 166 L1090 222 M1120 166 L1150 222"/>`;
  if (has(cameraMove, ["下移", "移"])) return `<path d="M1120 150 V584 M1120 584 L1090 528 M1120 584 L1150 528"/>`;
  return "";
}

function has(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function hashText(text: string) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}
