import { z } from "zod";

export const ParseScriptRequestSchema = z.object({
  text: z.string().min(1),
});

export const AiShotSchema = z.object({
  shotNumber: z.coerce.number().int().positive(),
  scriptText: z.string().min(1),
  cameraMove: z.string().catch(""),
  notes: z.string().catch(""),
  imagePrompt: z.string().catch(""),
});

export const AiShotArraySchema = z.array(AiShotSchema).min(1);

export type AiShot = z.infer<typeof AiShotSchema>;
