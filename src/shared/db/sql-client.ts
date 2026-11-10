export type SqlValue = string | number | null;

export interface SqlClient {
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
}

/** Network failure or a 5xx answer: the database could not be reached. */
export class D1Unavailable extends Error {}

/** D1 answered with `success: false`: the statement itself is wrong. */
export class D1QueryError extends Error {}
