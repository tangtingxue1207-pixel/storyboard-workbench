import { z } from "zod";

export const GeneratePanelImageRequestSchema = z.object({
  scriptText: z.string().optional().default("Storyboard panel"),
  imagePrompt: z.string().optional().default(""),
  cameraMove: z.string().optional().default(""),
  imageAspectRatio: z.string().optional().default("16:9"),
  referenceImages: z.array(z.string()).optional().default([]),
});

export const GeneratePanelImageResponseSchema = z.object({
  imageUrl: z.string().min(1),
});

export type GeneratePanelImageRequest = z.infer<typeof GeneratePanelImageRequestSchema>;
