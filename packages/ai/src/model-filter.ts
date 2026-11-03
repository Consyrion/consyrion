/**
 * Models that cannot take part in a council (no structured text answers): speech, audio, image, video, music,
 * embeddings, rerankers, moderation and realtime/live voice models – including Qwen (Wan, Paraformer, CosyVoice,
 * Sambert) and GLM (CogView, CogVideo), Grok Imagine and Google Nano Banana media models, and agent models that are
 * not plain text experts (Google Antigravity, #144). Applied to every provider's live model list.
 */
const NON_TEXT_MODEL =
  /(embedding|whisper|tts|transcribe|dall-e|image|imagen|audio|realtime|live|moderation|search|computer-use|babbage|davinci|sora|veo|lyria|music|robotics|rerank|wanx|wan2|cosyvoice|paraformer|sensevoice|sambert|-asr|cogview|cogvideo|flux|stable-diffusion|imagine|nano-banana|antigravity)/i;

export function isCouncilCapableModel(modelId: string, displayName = "") {
  return !NON_TEXT_MODEL.test(modelId) && !NON_TEXT_MODEL.test(displayName);
}
