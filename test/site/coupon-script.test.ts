import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COUPON_PAGE_SCRIPT } from "../../site/lib/coupon-script.js";

type FakeEl = { dataset: Record<string, string>; hidden: boolean; textContent?: string };

const NOW = Date.parse("2026-11-12T15:00:00.000Z");
const iso = (offsetMin: number) => new Date(NOW + offsetMin * 60_000).toISOString();

function fakeDate(getNow: () => number): DateConstructor {
  return class extends Date {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(getNow());
      else super(...(args as [string]));
    }
    static override now() {
      return getNow();
    }
  } as DateConstructor;
}

function setup(cards: { from: number; until: number }[], navigatorImpl: unknown) {
  let now = NOW;
  const els: FakeEl[] = cards.map((c) => ({ dataset: { from: iso(c.from), until: iso(c.until) }, hidden: false }));
  const empty: FakeEl = { dataset: {}, hidden: true };
  const listeners: Record<string, (e: unknown) => void> = {};
  const document = {
    querySelectorAll: (sel: string) => (sel === "[data-coupon]" ? els : []),
    getElementById: (id: string) => (id === "cupones-empty" ? empty : null),
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners[type] = fn;
    },
  };
  new Function("document", "navigator", "Date", COUPON_PAGE_SCRIPT)(document, navigatorImpl, fakeDate(() => now));
  return {
    els,
    empty,
    advance: (ms: number) => {
      now += ms;
      vi.advanceTimersByTime(ms);
    },
    click: (button: FakeEl) => {
      const event = { target: { closest: (s: string) => (s === "[data-copy]" ? button : null) }, preventDefault: vi.fn() };
      listeners.click!(event);
      return event;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("coupon page script", () => {
  it("hides cards before valid_from and from valid_until on", () => {
    const { els, advance } = setup(
      [
        { from: -60, until: 60 },
        { from: 2, until: 120 },
        { from: -60, until: 1 },
      ],
      {},
    );
    expect(els.map((e) => e.hidden)).toEqual([false, true, false]);
    advance(60_000);
    expect(els.map((e) => e.hidden)).toEqual([false, true, true]);
    advance(60_000);
    expect(els.map((e) => e.hidden)).toEqual([false, false, true]);
  });

  it("shows the empty state when every card is hidden and hides it when one is visible", () => {
    const hiddenOnly = setup([{ from: 60, until: 120 }], {});
    expect(hiddenOnly.empty.hidden).toBe(false);
    const mixed = setup(
      [
        { from: 60, until: 120 },
        { from: -1, until: 120 },
      ],
      {},
    );
    expect(mixed.empty.hidden).toBe(true);
    hiddenOnly.advance(60 * 60_000);
    expect(hiddenOnly.empty.hidden).toBe(true);
  });

  it("clicking a [data-copy] element calls navigator.clipboard.writeText(code) and does not preventDefault", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { click } = setup([{ from: -1, until: 60 }], { clipboard: { writeText } });
    const event = click({ dataset: { copy: "VIGENTE1" }, hidden: false, textContent: "Usar" });
    expect(writeText).toHaveBeenCalledWith("VIGENTE1");
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("confirms the copy on the button and restores its label", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { click } = setup([{ from: -1, until: 60 }], { clipboard: { writeText } });
    const button: FakeEl = { dataset: { copy: "X1" }, hidden: false, textContent: "Usar" };
    click(button);
    await vi.advanceTimersByTimeAsync(0);
    expect(button.textContent).toBe("Código copiado");
    await vi.advanceTimersByTimeAsync(2500);
    expect(button.textContent).toBe("Usar");
  });

  it("a missing or rejecting clipboard does not throw and the link still opens", async () => {
    const failing = {
      clipboard: {
        writeText: () => {
          throw new Error("sync");
        },
      },
    };
    for (const nav of [{}, { clipboard: { writeText: () => Promise.reject(new Error("denied")) } }, failing]) {
      const { click } = setup([{ from: -1, until: 60 }], nav);
      const button: FakeEl = { dataset: { copy: "X1" }, hidden: false, textContent: "Usar" };
      const event = click(button);
      await vi.advanceTimersByTimeAsync(0);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(button.textContent).toBe("Usar");
    }
  });
});
