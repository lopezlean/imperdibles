// Declarations only; Task 5 completes this file (createTelegramClient, isInvalidFileId).
export type PhotoInput = { fileId: string } | { png: Uint8Array };

export interface TelegramClient {
  sendPhoto(p: {
    chat_id: string;
    photo: PhotoInput;
    caption: string;
    reply_to_message_id?: number;
  }): Promise<{ message_id: number; file_id: string }>;
  sendMessage(p: { chat_id: string; text: string; reply_to_message_id?: number }): Promise<{ message_id: number }>;
}

export class TelegramError extends Error {
  constructor(
    public status: number,
    public description: string,
  ) {
    super(`Telegram error ${status}: ${description}`);
  }
}

export function isInvalidFileId(e: unknown): boolean {
  return e instanceof TelegramError && /file identifier/i.test(e.description);
}

type ApiResponse = {
  ok?: boolean;
  error_code?: number;
  description?: string;
  result?: { message_id: number; photo?: { file_id: string }[] };
};

export function createTelegramClient(cfg: { token: string; fetch: typeof fetch }): TelegramClient {
  // Never put the token or URL in an error: only method, status and description.
  async function call(method: string, body: FormData | Record<string, unknown>): Promise<NonNullable<ApiResponse["result"]>> {
    const init: RequestInit =
      body instanceof FormData
        ? { method: "POST", body }
        : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    let res: Response;
    try {
      res = await cfg.fetch(`https://api.telegram.org/bot${cfg.token}/${method}`, init);
    } catch {
      throw new TelegramError(0, `${method}: network failure`);
    }
    let data: ApiResponse | undefined;
    try {
      data = (await res.json()) as ApiResponse;
    } catch {
      data = undefined;
    }
    if (!data || data.ok !== true || !data.result) {
      const status = data?.error_code ?? res.status;
      throw new TelegramError(status, `${method}: ${data?.description ?? "non-JSON or unexpected response"}`);
    }
    return data.result;
  }

  return {
    async sendPhoto(p) {
      let body: FormData | Record<string, unknown>;
      if ("png" in p.photo) {
        const form = new FormData();
        form.append("chat_id", p.chat_id);
        form.append("caption", p.caption);
        if (p.reply_to_message_id !== undefined) form.append("reply_to_message_id", String(p.reply_to_message_id));
        form.append("photo", new Blob([p.photo.png], { type: "image/png" }), "tarjeta.png");
        body = form;
      } else {
        body = { chat_id: p.chat_id, photo: p.photo.fileId, caption: p.caption };
        if (p.reply_to_message_id !== undefined) body.reply_to_message_id = p.reply_to_message_id;
      }
      const r = await call("sendPhoto", body);
      const sizes = r.photo ?? [];
      const largest = sizes[sizes.length - 1];
      if (!largest) throw new TelegramError(200, "sendPhoto: response without photo sizes");
      return { message_id: r.message_id, file_id: largest.file_id };
    },
    async sendMessage(p) {
      const body: Record<string, unknown> = { chat_id: p.chat_id, text: p.text };
      if (p.reply_to_message_id !== undefined) body.reply_to_message_id = p.reply_to_message_id;
      const r = await call("sendMessage", body);
      return { message_id: r.message_id };
    },
  };
}
