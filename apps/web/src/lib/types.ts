import type { SessionView } from "@consyrium/council";

/** Shape of server data after JSON serialization (Dates become strings). */
export type Jsonify<T> = T extends Date
  ? string
  : T extends Array<infer U>
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;

export type SessionViewJson = Jsonify<SessionView>;
