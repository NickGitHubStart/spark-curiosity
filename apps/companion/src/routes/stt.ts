import type { IncomingMessage, ServerResponse } from "node:http";
import { CLOUD_PROXY_URL, currentGrokApiKey, currentGrokBaseUrl, currentOpenAiApiKey, isDirectApiKey } from "../config.js";
import { readMemoryFile } from "../memory.js";
import { json, parseBody } from "./helpers.js";

/** Wrap raw PCM (16-bit mono) in a minimal WAV header for Whisper. */
function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);   // PCM
  header.writeUInt16LE(1, 22);   // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  const wav = new Uint8Array(44 + pcm.length);
  wav.set(new Uint8Array(header.buffer, header.byteOffset, 44), 0);
  wav.set(pcm, 44);
  return wav;
}

/**
 * STT via OpenAI Whisper (whisper-1).
 * Accepts WebM/Opus from browser or raw PCM from native overlay (wrapped in WAV first).
 */
async function runStt(audioBase64: string, mimeType: string, sampleRate?: number): Promise<string> {
  const proxyKey = currentGrokApiKey();
  const directKey = currentOpenAiApiKey();
  const useProxy = CLOUD_PROXY_URL && proxyKey && !isDirectApiKey();
  const apiKey = useProxy ? proxyKey : directKey;
  if (!apiKey) throw new Error("stt_no_api_key: Set SPARK_OPENAI_API_KEY or configure cloud proxy");

  let buf: Uint8Array = Buffer.from(audioBase64, "base64");
  const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
  if (buf.length > MAX_AUDIO_BYTES) throw new Error("audio_too_large: max 25MB");
  let ext = "webm";
  let type = mimeType;

  if (mimeType.includes("pcm")) {
    buf = pcmToWav(buf, sampleRate || 16000);
    ext = "wav";
    type = "audio/wav";
  } else if (mimeType.includes("wav")) {
    ext = "wav";
  }

  const { body: memBody } = readMemoryFile();
  const langMatch = memBody.match(/(?:^|\n)##?\s*Language\s*[:=]\s*(\w+)/im);
  const lang = langMatch?.[1]?.toLowerCase().slice(0, 2) || "de";

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type }), `audio.${ext}`);
  form.append("model", "whisper-1");
  form.append("language", lang);
  form.append("response_format", "json");

  console.log("[spark:stt] Whisper request, bytes:", buf.length, "type:", type, "lang:", lang);

  const sttBaseUrl = useProxy ? currentGrokBaseUrl() : "https://api.openai.com/v1";
  const sttRes = await fetch(`${sttBaseUrl.replace(/\/+$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form as unknown as BodyInit
  });

  if (!sttRes.ok) {
    const errText = await sttRes.text();
    throw new Error(`whisper_stt_error: ${sttRes.status} ${errText.slice(0, 200)}`);
  }

  const data = (await sttRes.json()) as { text?: string };
  const text = typeof data?.text === "string" ? data.text.trim() : "";
  console.log("[spark:stt] Whisper OK, text:", text.slice(0, 80));
  return text;
}

export async function handleSttRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "POST" && url.pathname === "/stt") {
    try {
      const body = await parseBody<{ audioBase64?: string; mimeType?: string; sampleRate?: number }>(req);
      const audioBase64 = (body.audioBase64 || "").trim();
      if (!audioBase64) { json(res, 400, { error: "audio_required" }); return true; }
      const text = await runStt(audioBase64, body.mimeType || "audio/webm", body.sampleRate);
      json(res, 200, { text: text || "" });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[spark:stt] failed:", msg);
      const status = msg.includes("stt_no_api_key") || msg.includes("audio_required") ? 400 : 502;
      json(res, status, { error: msg });
    }
    return true;
  }

  return false;
}
