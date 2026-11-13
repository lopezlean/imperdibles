/** WhatsApp "click to chat" link that carries the share text and the page URL. */
export const whatsappUrl = (text: string, url: string): string =>
  `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
