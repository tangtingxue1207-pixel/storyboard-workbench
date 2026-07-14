import { AiShotArraySchema } from "@/lib/parseScriptSchema";
import type { StoryboardShot } from "@/types/storyboard";

export async function parseScriptWithAi(text: string): Promise<StoryboardShot[]> {
  const response = await fetch("/api/parse-script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error("AI parse request failed");
  }

  const json = await response.json();
  const parsed = AiShotArraySchema.safeParse(json);

  if (!parsed.success) {
    throw new Error("AI parse response shape is invalid");
  }

  return parsed.data.map((shot, index) => ({
    id: crypto.randomUUID(),
    shotNumber: shot.shotNumber || index + 1,
    scriptText: shot.scriptText,
    shotSize: shot.cameraMove,
    reference: "",
    cameraMove: shot.cameraMove,
    copy: "",
    notes: shot.notes,
    imagePrompt: shot.imagePrompt,
    referenceImages: [],
    imageUrl: "",
    canvasElements: [],
  }));
}
