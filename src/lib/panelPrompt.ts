export function buildPanelPrompt(scriptText: string, cameraMove: string) {
  return [
    "Create a simple black-and-white storyboard line drawing.",
    "Loose rough marker sketch style like a fast film storyboard reference.",
    "Rough human figures, minimal facial detail, simple scene indication.",
    "Clean white background, cinematic framing, clear composition.",
    "No shading, no color, no realistic rendering.",
    `Scene: ${scriptText}`,
    `Camera movement: ${cameraMove || "none"}`,
    "Characters: use generic figures labeled A and B if needed.",
  ].join("\n");
}
