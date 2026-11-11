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
