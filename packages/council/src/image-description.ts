import { timeoutSignal, type ImageInput, type ProviderAdapter, type TokenUsage } from "@consyrion/ai";
import { DomainError } from "@consyrion/core";

/**
 * "Describe first" for images (docs/documents.md): one image-capable model turns an uploaded image into text once; the
 * user reviews and confirms that text, and every model of a council then reads the same description. The image itself
 * never goes to a council, so models without image input can take part and all of them see identical input.
 */
export const IMAGE_DESCRIPTION_PROMPT = [
  "Describe this image so that experts who cannot see it can work with it in a technical or business decision.",
  "- First say in one sentence what kind of image it is (diagram, sketch, screenshot, photo of a whiteboard, chart, …).",
  "- Then describe everything relevant: elements, boxes, arrows and their direction, labels, groupings, numbers, tables.",
  "- Copy every readable text exactly, in its original language. Mark unreadable or uncertain parts as [unclear].",
  "- Describe only what is visible. Do not judge, do not add assumptions, recommendations or missing parts.",
  "Answer in the language of the text in the image; if there is none, in English. Plain text, no Markdown tables.",
].join("\n");

export const IMAGE_DESCRIPTION_MAX_OUTPUT = 4_000;

export async function describeImage(adapter: ProviderAdapter, modelId: string, image: ImageInput): Promise<{ text: string; usage: TokenUsage }> {
  const result = await adapter.generate({
    model: modelId,
    messages: [{ role: "user", content: IMAGE_DESCRIPTION_PROMPT, images: [image] }],
    maxOutputTokens: IMAGE_DESCRIPTION_MAX_OUTPUT,
    signal: timeoutSignal(120_000),
  });
  const text = result.text.trim();
  if (result.stopReason === "refusal") throw new DomainError("CONFLICT", "The model refused to describe this image. Try another model or describe it yourself.");
  if (!text) throw new DomainError("CONFLICT", "The model returned no description. Try another model or describe it yourself.");
  // A cut-off description is kept as a draft but marked, so the user completes it before confirming.
  return { text: result.stopReason === "max_tokens" ? `${text}\n[The description was cut off – please complete it.]` : text, usage: result.usage };
}
