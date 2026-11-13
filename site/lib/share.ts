import { BUY_LINE } from "../../src/output/copy.js";

/** Message to share: text, then our page (first, so chat apps unfold its card), then the affiliate buy link. */
export const shareMessage = (text: string, pageUrl: string, buyUrl: string): string =>
  `${text}\n${pageUrl}\n\n${BUY_LINE} ${buyUrl}`;

/** WhatsApp "click to chat" link carrying a whole message. */
export const whatsappUrl = (message: string): string => `https://wa.me/?text=${encodeURIComponent(message)}`;
