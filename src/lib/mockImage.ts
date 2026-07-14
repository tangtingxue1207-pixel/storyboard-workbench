export async function generateMockLineArt(prompt: string, shotNumber: number) {
  await new Promise((resolve) => setTimeout(resolve, 450));

  const safePrompt = prompt.slice(0, 80).replace(/[<>&]/g, "");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
      <rect width="960" height="540" fill="#fbfaf7"/>
      <rect x="54" y="42" width="852" height="456" fill="none" stroke="#171717" stroke-width="5"/>
      <path d="M110 390 C220 250, 330 260, 420 392 S650 460, 820 320" fill="none" stroke="#171717" stroke-width="5" stroke-linecap="round"/>
      <circle cx="322" cy="206" r="58" fill="none" stroke="#171717" stroke-width="5"/>
      <path d="M286 196 C306 180, 342 180, 362 198" fill="none" stroke="#171717" stroke-width="4"/>
      <path d="M276 270 C306 330, 362 334, 398 276" fill="none" stroke="#171717" stroke-width="5"/>
      <circle cx="628" cy="238" r="46" fill="none" stroke="#171717" stroke-width="5"/>
      <path d="M594 292 L560 404 M658 292 L704 404 M584 354 L682 352" fill="none" stroke="#171717" stroke-width="5" stroke-linecap="round"/>
      <path d="M150 126 H420 M150 156 H356" stroke="#171717" stroke-width="4" stroke-linecap="round"/>
      <text x="70" y="82" font-size="34" font-family="Arial, sans-serif" fill="#171717">Shot ${shotNumber}</text>
      <text x="70" y="474" font-size="22" font-family="Arial, sans-serif" fill="#171717">${safePrompt}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// Reserved integration point for OpenAI Images API.
// Replace generateMockLineArt calls with a POST to your own server route
// so API keys never ship to the browser.
export async function generateWithOpenAIImagesApi(_prompt: string) {
  throw new Error("OpenAI Images API hook is reserved for server-side implementation.");
}
