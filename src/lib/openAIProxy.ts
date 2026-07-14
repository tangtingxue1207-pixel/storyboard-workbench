import { ProxyAgent } from "undici";

const proxyUrl = process.env.OPENAI_PROXY_URL || "http://127.0.0.1:7890";
const dispatcher = new ProxyAgent(proxyUrl);

export const openAIFetchOptions = {
  dispatcher,
} as const;
