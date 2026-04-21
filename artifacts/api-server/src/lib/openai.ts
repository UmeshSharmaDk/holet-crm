import OpenAI from "openai";

const baseURL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
const apiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];

if (!baseURL || !apiKey) {
  console.warn("[openai] Missing AI integration env vars");
}

export const openai = new OpenAI({
  baseURL: baseURL || undefined,
  apiKey: apiKey || "missing",
});
