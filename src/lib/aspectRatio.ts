export const imageAspectRatioOptions = ["16:9", "4:3", "1:1", "9:16", "3:4", "21:9"] as const;

export type ImageAspectRatio = (typeof imageAspectRatioOptions)[number];

export const defaultImageAspectRatio: ImageAspectRatio = "16:9";

export function normalizeImageAspectRatio(value?: string | null): ImageAspectRatio {
  return imageAspectRatioOptions.includes(value as ImageAspectRatio)
    ? (value as ImageAspectRatio)
    : defaultImageAspectRatio;
}

export function aspectRatioValue(value?: string | null) {
  const ratio = normalizeImageAspectRatio(value);
  const [w, h] = ratio.split(":").map(Number);
  return w / h || 16 / 9;
}
