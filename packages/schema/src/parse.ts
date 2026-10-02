import * as v from 'valibot';
import {
  type ClientResult,
  ClientResultSchema,
  type DecisionRecord,
  DecisionRecordSchema,
  type InitResponse,
  InitResponseSchema,
  type Payload,
  PayloadSchema,
} from './schemas.js';

export type ParseResult<T> =
  | { readonly success: true; readonly output: T }
  | { readonly success: false; readonly issues: readonly string[] };

function parseWith<T>(schema: v.GenericSchema<unknown, T>, input: unknown): ParseResult<T> {
  const result = v.safeParse(schema, input);
  if (result.success) return { success: true, output: result.output };
  return {
    success: false,
    issues: result.issues.map((issue) => {
      const path = v.getDotPath(issue);
      return path ? `${path}: ${issue.message}` : issue.message;
    }),
  };
}

/** Validate an untrusted `POST /score` body. Never throws. Unknown fields are dropped. */
export function parsePayload(input: unknown): ParseResult<Payload> {
  return parseWith(PayloadSchema, input);
}

/** Validate a `GET /init` response. Never throws. */
export function parseInitResponse(input: unknown): ParseResult<InitResponse> {
  return parseWith(InitResponseSchema, input);
}

/** Validate a `POST /score` response body. Never throws. */
export function parseClientResult(input: unknown): ParseResult<ClientResult> {
  return parseWith(ClientResultSchema, input);
}

/** Validate a decision record, for example in an ingestion pipeline. Never throws. */
export function parseDecisionRecord(input: unknown): ParseResult<DecisionRecord> {
  return parseWith(DecisionRecordSchema, input);
}
