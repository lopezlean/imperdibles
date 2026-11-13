import { TelegramClient } from "telegram";
import { PromisedWebSockets } from "telegram/extensions/index.js";
import { ConnectionTCPObfuscated } from "telegram/network/index.js";
import { StringSession } from "telegram/sessions/index.js";

// Some networks block raw MTProto TCP to Telegram's data-center IPs (ports 80
// and 443). The web.telegram.org WebSocket endpoints still get through, so the
// user client always talks to Telegram the way Telegram Web does.
const DEFAULT_WEB_DC = { id: 2, host: "venus.web.telegram.org", port: 443 } as const;

export function createTelegramWebClient(sessionString: string, apiId: number, apiHash: string): TelegramClient {
  const session = new StringSession(sessionString);
  if (sessionString === "") session.setDC(DEFAULT_WEB_DC.id, DEFAULT_WEB_DC.host, DEFAULT_WEB_DC.port);
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 3,
    useWSS: true,
    networkSocket: PromisedWebSockets,
    connection: ConnectionTCPObfuscated,
  });
  // On Node, GramJS resolves data centers to raw IPs; a DC migration (common at
  // login) must stay on the web hosts too.
  const getDC = client.getDC.bind(client);
  client.getDC = (dcId: number, downloadDC = false) => getDC(dcId, downloadDC, true);
  return client;
}
