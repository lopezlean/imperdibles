export interface BudgetedHttp {
  get(url: string, headers?: Record<string, string>): Promise<Response>;
  used(): number;
}

export class BudgetExhaustedError extends Error {
  constructor(message = "Request budget exhausted") {
    super(message);
    this.name = "BudgetExhaustedError";
  }
}

export class UpstreamError extends Error {
  constructor(
    public status: number,
    public url: string,
  ) {
    super(`Upstream error ${status} for ${url}`);
    this.name = "UpstreamError";
  }
}

export class NetworkError extends Error {
  constructor(message = "Network error") {
    super(message);
    this.name = "NetworkError";
  }
}

const RETRY_DELAYS_MS = [1000, 2000, 4000];
const REMAINING_HEADERS = ["x-ratelimit-remaining", "ratelimit-remaining"];

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Every attempt, retries included, spends one unit of budget. */
export function createBudgetedHttp(opts: {
  fetch: typeof fetch;
  budget: number;
  sleep: (ms: number) => Promise<void>;
  reserve?: number;
}): BudgetedHttp {
  const reserve = opts.reserve ?? 5;
  let used = 0;
  let rateLimited = false;

  function observeRateLimit(res: Response): void {
    for (const name of REMAINING_HEADERS) {
      const raw = res.headers.get(name);
      if (raw === null) continue;
      const remaining = Number(raw);
      if (Number.isFinite(remaining) && remaining <= reserve) rateLimited = true;
    }
  }

  async function attempt(url: string, headers?: Record<string, string>): Promise<Response> {
    if (rateLimited) throw new BudgetExhaustedError("Upstream rate limit reserve reached");
    if (used >= opts.budget) throw new BudgetExhaustedError();
    used += 1;
    try {
      const res = await opts.fetch(url, { method: "GET", ...(headers ? { headers } : {}) });
      observeRateLimit(res);
      return res;
    } catch (cause) {
      if (cause instanceof TypeError) throw new NetworkError(cause.message);
      throw cause;
    }
  }

  return {
    used: () => used,
    async get(url, headers) {
      for (let retry = 0; ; retry += 1) {
        const res = await attempt(url, headers);
        if (!isRetryable(res.status)) return res;
        if (retry >= RETRY_DELAYS_MS.length) throw new UpstreamError(res.status, url);
        await opts.sleep(RETRY_DELAYS_MS[retry]!);
      }
    },
  };
}
