import "dotenv/config";
import { realpathSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../src/shared/env.js";

const WIDTH = 1200;
const HEIGHT = 675;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 4 + body.length);
  return out;
}

/** Solid-colour RGB PNG built with node:zlib only. */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const row = Buffer.alloc(1 + width * 3); // filter byte 0 + pixels
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

type SendPhotoResponse = {
  ok: boolean;
  description?: string;
  result?: { photo?: { file_id: string; width: number; height: number }[] };
};

async function sendPhoto(token: string, chatId: string, photo: Buffer | string): Promise<SendPhotoResponse> {
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("caption", "verify file_id reuse");
  if (typeof photo === "string") form.set("photo", photo);
  else form.set("photo", new Blob([new Uint8Array(photo)], { type: "image/png" }), "tarjeta.png");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
  return (await res.json()) as SendPhotoResponse;
}

async function main(): Promise<void> {
  const env = loadLocalEnv(process.env, ["telegramBotToken", "telegramOwnerChatId", "telegramChannelId"]);
  const first = await sendPhoto(env.telegramBotToken, env.telegramOwnerChatId, solidPng(WIDTH, HEIGHT, [30, 90, 200]));
  if (!first.ok) {
    console.log(`sendPhoto to owner failed: ${first.description ?? "unknown error"}`);
    process.exitCode = 1;
    return;
  }
  const sizes = first.result?.photo ?? [];
  const largest = [...sizes].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!largest) {
    console.log("sendPhoto to owner returned no photo sizes");
    process.exitCode = 1;
    return;
  }
  const second = await sendPhoto(env.telegramBotToken, env.telegramChannelId, largest.file_id);
  if (second.ok) console.log("file_id reuse: ok");
  else {
    console.log(second.description ?? "unknown error");
    process.exitCode = 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
