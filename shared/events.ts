// Validates the event and request contracts on both sides of the connection.
import { z } from 'zod';

export const workspaceSchema = z.enum(['live', 'lab']);
export const routeSchema = z.enum(['chat_plain', 'research', 'undecided', 'recall_synth']);
export type Route = z.infer<typeof routeSchema>;
export const errorCode = z.enum([
  'CANCELLED', 'DEADLINE', 'PROVIDER_UNAVAILABLE', 'SEARCH_UNAVAILABLE', 'CONFIG_ERROR',
  'NOT_CONFIGURED', 'UNRESOLVED_TOOL_CALL', 'INTERNAL', 'INTERRUPTED',
  'TURN_IN_PROGRESS', 'DUPLICATE_TURN', 'LAB_BUSY', 'INVALID_TZ', 'INVALID_SELECTION',
  'INVALID_REQUEST', 'BODY_TOO_LARGE', 'NOT_FOUND',
]);
export type ErrorCode = z.infer<typeof errorCode>;

const id = z.uuid();
const timing = z.number().nonnegative();
export const originSchema = z.enum(['real', 'sample', 'fake']);
const memoryEpisode = z.object({ messageId: id, conversationId: id, title: z.string(), logicalAt: z.iso.datetime(),
  preview: z.string(), origin: originSchema, eligible: z.boolean(), refs: z.array(z.string()) });
export const memorySchema = z.object({
  state: z.enum(['NOT_REQUESTED', 'EMPTY_RANGE', 'NO_CONFIDENT_MATCH', 'AMBIGUOUS', 'FOUND_NO_BASELINE', 'FOUND_WITH_BASELINE', 'ERROR']),
  intervals: z.array(z.object({ label: z.string(), startUtc: z.iso.datetime(), endUtc: z.iso.datetime() })),
  usedAlternate: z.boolean(), episodes: z.array(memoryEpisode), truncated: z.boolean(), tz: z.string(),
});
export type MemoryView = z.infer<typeof memorySchema>;
export const selectionSchema = z.object({ clarificationId: id, optionIndex: z.number().int().min(0).max(3) }).strict();
export type Selection = z.infer<typeof selectionSchema>;
export const clarificationSchema = z.object({
  clarificationId: id, question: z.string(),
  options: z.array(z.object({ index: z.number().int().min(0).max(3), label: z.string(), logicalAt: z.iso.datetime(), preview: z.string() })),
});
export type Clarification = z.infer<typeof clarificationSchema>;
export const evidenceSchema = z.object({
  ref: z.string().regex(/^E[1-9]\d*$/), url: z.httpUrl(), title: z.string(), domain: z.string(),
  domainMatch: z.enum(['exact', 'none']), entity: z.string(), retrievedAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().nullable(), sentences: z.array(z.string()),
});
export type EvidenceSource = z.infer<typeof evidenceSchema>;
export const coverageSchema = z.object({
  entity: z.string(), queried: z.boolean(), evidenceFound: z.boolean(), supported: z.boolean(),
});
export type Coverage = z.infer<typeof coverageSchema>;
export const statsSchema = z.object({
  generations: z.number().int().nonnegative(), attempts: z.number().int().nonnegative(),
  modelUsed: z.string().nullable(), route: routeSchema, tFirstProgressMs: timing.nullable(),
  tFirstAnswerTextMs: timing.nullable(), tTotalMs: timing,
  modelHistory: z.array(z.string()).optional(),
  searches: z.number().int().nonnegative().optional(),
  searchCredits: z.number().int().nonnegative().optional(),
  rounds: z.number().int().nonnegative().optional(),
  withheld: z.number().int().nonnegative().optional(),
  coverage: z.array(coverageSchema).optional(),
  memory: memorySchema.optional(),
});
export type Stats = z.infer<typeof statsSchema>;

export const turnRequest = z.object({
  text: z.string().trim().min(1).max(8000),
  tz: z.string().min(1).max(100), clientTurnId: z.string().min(1).max(128),
  selection: z.unknown().optional(),
}).strict();

const envelope = { turnId: id, seq: z.number().int().positive() };
export const eventSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('turn.started'), userMessageId: id, assistantMessageId: id,
    workspace: workspaceSchema, logicalNow: z.iso.datetime(), realNow: z.iso.datetime(), tz: z.string(), route: routeSchema }),
  z.object({ ...envelope, type: z.literal('memory'), ...memorySchema.shape }),
  z.object({ ...envelope, type: z.literal('clarify'), ...clarificationSchema.shape }),
  z.object({ ...envelope, type: z.literal('answer.direct'), text: z.string().min(1) }),
  z.object({ ...envelope, type: z.literal('answer.delta'), text: z.string().min(1) }),
  z.object({ ...envelope, type: z.literal('search.started'), queryId: id, query: z.string(), entity: z.string(), round: z.number().int().positive() }),
  z.object({ ...envelope, type: z.literal('search.finished'), queryId: id, resultCount: z.number().int().nonnegative(), ms: timing,
    error: z.literal('SEARCH_UNAVAILABLE').optional() }),
  z.object({ ...envelope, type: z.literal('sources'), sources: z.array(evidenceSchema) }),
  z.object({ ...envelope, type: z.literal('answer.sentence'), text: z.string().min(1), refs: z.array(z.string()),
    support: z.enum(['sourced', 'no_source']) }),
  z.object({ ...envelope, type: z.literal('answer.withheld'), count: z.number().int().positive() }),
  z.object({ ...envelope, type: z.literal('turn.completed'), assistantMessageId: id, stats: statsSchema,
    coverage: z.array(coverageSchema).optional() }),
  z.object({ ...envelope, type: z.literal('turn.error'), code: errorCode, message: z.string(), partialSaved: z.boolean() }),
]);
export type TurnEvent = z.infer<typeof eventSchema>;
type EventBody<T> = T extends TurnEvent ? Omit<T, 'turnId' | 'seq'> : never;
export type TurnEventBody = EventBody<TurnEvent>;

export const healthSchema = z.object({
  ok: z.boolean(), node: z.string(), db: z.string(),
  providers: z.object({
    model: z.enum(['ready', 'missing_key', 'fake']),
    search: z.enum(['ready', 'missing_key', 'fake']),
  }),
  lab: z.object({ enabled: z.boolean() }), fakeMode: z.boolean(),
});
export const conversationSchema = z.object({ id, title: z.string(), origin: originSchema, updatedLogicalAt: z.iso.datetime() });
export const messageSchema = z.object({
  id, role: z.enum(['user', 'assistant']), content: z.string(),
  status: z.enum(['complete', 'streaming', 'partial', 'cancelled', 'error']),
  terminalCode: z.union([errorCode, z.literal('COMPLETED')]).nullable(),
  logicalAt: z.iso.datetime(), recordedAt: z.iso.datetime(), tz: z.string(), origin: originSchema,
  stats: statsSchema.nullable().optional(),
  evidence: z.array(evidenceSchema).optional(),
  clarification: clarificationSchema.optional(),
});
export const detailSchema = z.object({ conversation: conversationSchema.extend({ workspace: workspaceSchema }), messages: z.array(messageSchema) });
export const apiErrorSchema = z.object({ code: errorCode, message: z.string() });
export type ChatMessage = z.infer<typeof messageSchema>;
