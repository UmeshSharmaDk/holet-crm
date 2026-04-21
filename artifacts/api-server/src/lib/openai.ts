import OpenAI from "openai";

const apiKey = process.env["OPENAI_API_KEY"];

if (!apiKey) {
  console.warn("[openai] Missing OPENAI_API_KEY env var");
}

export const openai = new OpenAI({
  apiKey: apiKey || "missing",
});
