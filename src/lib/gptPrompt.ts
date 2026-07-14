import type { StoryboardShot } from "@/types/storyboard";
import { normalizeImageAspectRatio } from "./aspectRatio";

export function buildManualGptPrompt(
  shot: StoryboardShot,
  context?: {
    previousShot?: StoryboardShot | null;
    nextShot?: StoryboardShot | null;
  },
  aspectRatio = "16:9",
) {
  const ratio = normalizeImageAspectRatio(aspectRatio);
  const scene = [shot.scriptText, shot.reference, shot.copy, shot.notes].filter(Boolean).join("\n");
  const current = shot.imagePrompt || scene || "当前分镜画面";
  const previous = context?.previousShot ? summarizeShotBrief(context.previousShot) : "开场/无";
  const next = context?.nextShot ? summarizeShotBrief(context.nextShot) : "结尾/无";
  const referenceInstruction = referenceImagesInstruction(shot);

  return [
    "请直接生成一张图片，不要回复文字。",
    `黑白电影分镜线稿，画面比例 ${ratio}，干净白底，简单场景，人物笼统自然，中国人物，不要明星脸，不要美式超级英雄漫画风。`,
    "只画当前镜头，保持与前后镜头的人物、服装、场景方向一致。",
    referenceInstruction,
    "",
    `Shot ${shot.shotNumber}`,
    `上一镜：${previous}`,
    `当前镜：${summarizeShotBrief(shot, current)}`,
    `下一镜：${next}`,
    shot.cameraMove ? `镜头：${shot.cameraMove}` : "",
  ].join("\n");
}

export function buildBatchGptPrompt(shots: StoryboardShot[], aspectRatio = "16:9") {
  const ratio = normalizeImageAspectRatio(aspectRatio);
  const selected = shots.slice(0, 8);

  return [
    `请调用 ChatGPT 的图片生成能力，为下面 ${selected.length} 个连续镜头逐张生成图片。`,
    "重要：必须分别生成独立图片文件，每个 Shot 一张图。",
    "不要把多个镜头合成一张图，不要做分镜板，不要做拼图，不要做九宫格，不要做漫画页。",
    "不要在同一张画布里画多个 panel。每次图片生成工具只能服务一个 Shot。",
    "请先只生成本组第一张图。生成完成后停止，等待我手动输入“下一张”再继续下一个 Shot。",
    "我每次输入“下一张”时，你再生成下一个 Shot 的单张图片；不要一次生成多张。",
    "除了图片生成过程，不要回复文字说明，不要给我提示词。",
    `统一风格：黑白电影分镜线稿，画面比例 ${ratio}，干净白底，简单场景，中国人物，人物笼统自然，不要明星脸，不要美式超级英雄漫画风。`,
    "连续性：保持人物、服装、场景方向、主要道具位置一致。",
    "如果某个 Shot 标注了参考图，请使用该 Shot 的参考图作为构图、人物关系、道具、场景或产品外观参考。",
    "",
    ...selected.flatMap((shot, index) => [
      `Shot ${shot.shotNumber}`,
      referenceImagesInstruction(shot),
      index > 0 ? `承接上一镜：${summarizeShotBrief(selected[index - 1])}` : "承接上一镜：开场/无",
      `当前镜：${summarizeShotBrief(shot)}`,
      index < selected.length - 1 ? `衔接下一镜：${summarizeShotBrief(selected[index + 1])}` : "衔接下一镜：结尾/无",
      shot.cameraMove ? `镜头：${shot.cameraMove}` : "",
      "",
    ]),
    "请现在只生成本组第一张图。生成完第一张后等待我输入“下一张”。",
  ].join("\n");
}

function referenceImagesInstruction(shot: StoryboardShot) {
  if (!shot.referenceImages.length) return "参考图：无。";
  return `参考图：已添加 ${shot.referenceImages.length} 张。生成时必须参考这些图片的构图、场景、人物关系、道具/产品外观；如在 ChatGPT 中生成，请先把对应参考图随本提示一起上传或粘贴。`;
}

function summarizeShotBrief(shot: StoryboardShot, fallback?: string) {
  const text = [
    shot.shotSize ? `景别${shot.shotSize}` : "",
    shot.scriptText || fallback || "",
    shot.reference,
    shot.notes,
  ]
    .filter(Boolean)
    .join("；");

  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}
