import { GeneratePanelImageResponseSchema } from "@/lib/generatePanelImageSchema";
import type { StoryboardShot } from "@/types/storyboard";

export async function generatePanelImage(shot: StoryboardShot, imageAspectRatio = "16:9") {
  const response = await fetch("/api/generate-panel-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scriptText:
        [
          shot.scene && `场景：${shot.scene}`,
          shot.characters && `人物：${shot.characters}`,
          shot.scriptText,
          shot.copy,
          shot.reference,
          shot.notes,
          shot.product && `商品：${shot.product}`,
          shot.referenceImages.length
            ? `参考图要求：使用已上传的 ${shot.referenceImages.length} 张参考图作为构图、场景、人物关系、道具/产品外观参考。`
            : "",
        ]
          .filter(Boolean)
          .join("\n") || shot.imagePrompt || "Storyboard panel",
      imagePrompt: [
        shot.imagePrompt,
        shot.referenceImages.length
          ? "Use the provided reference image(s) to guide composition, setting, props/product appearance, and character blocking. Keep final output as simple black-and-white storyboard line art."
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      cameraMove: shot.cameraMove,
      imageAspectRatio,
      referenceImages: shot.referenceImages,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.error || "Panel image generation failed");
  }

  const json = await response.json();
  const parsed = GeneratePanelImageResponseSchema.safeParse(json);

  if (!parsed.success) {
    throw new Error("Panel image response shape is invalid");
  }

  return parsed.data.imageUrl;
}
