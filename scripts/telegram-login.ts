import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

/**
 * One-time owner step. Logs in with the owner's Telegram account and prints the session string
 * (the only place it is ever printed) plus the account's channels. Writes no files.
 */
async function main(): Promise<void> {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH ?? "";
  if (!Number.isInteger(apiId) || apiId <= 0 || apiHash === "") {
    console.log("Missing or invalid environment variables: TELEGRAM_API_ID, TELEGRAM_API_HASH");
    process.exitCode = 1;
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 3 });
  try {
    await client.start({
      phoneNumber: () => rl.question("Phone number (with country code): "),
      phoneCode: () => rl.question("Login code: "),
      password: () => rl.question("2FA password (if any): "),
      onError: (e) => {
        console.log(`Login error (${e.name})`);
      },
    });
    console.log(`TELEGRAM_SESSION=${client.session.save() as unknown as string}`);

    console.log("\nChannels (copy the id of the affiliates channel into TELEGRAM_SOURCE_CHANNEL_ID):");
    const dialogs = await client.getDialogs({ limit: 200 });
    for (const d of dialogs) {
      if (d.isChannel) console.log(`${d.id?.toString() ?? "?"}\t${d.title ?? ""}`);
    }
  } finally {
    rl.close();
    await client.disconnect().catch(() => undefined);
    await client.destroy().catch(() => undefined);
  }
}

try {
  await main();
} catch (e) {
  // Never print the message: it can carry the phone number.
  console.log(`Could not log in to Telegram (${e instanceof Error ? e.name : "unknown error"}).`);
  process.exitCode = 1;
}
