// Validates the Phase 1 event and request contracts on both sides of the connection.
import { z } from 'zod';

export const workspaceSchema = z.enum(['live', 'lab']);
export const routeSchema = z.enum(['chat_plain', 'research', 'undecided']);
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
export const statsSchema = z.object({
  generations: z.number().int().nonnegative(), attempts: z.number().int().nonnegative(),
  modelUsed: z.string().nullable(), route: routeSchema, tFirstProgressMs: timing.nullable(),
  tFirstAnswerTextMs: timing.nullable(), tTotalMs: timing,
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
  z.object({ ...envelope, type: z.literal('answer.delta'), text: z.string().min(1) }),
  z.object({ ...envelope, type: z.literal('turn.completed'), assistantMessageId: id, stats: statsSchema }),
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
export const originSchema = z.enum(['real', 'sample', 'fake']);
export const conversationSchema = z.object({ id, title: z.string(), origin: originSchema, updatedLogicalAt: z.iso.datetime() });
export const messageSchema = z.object({
  id, role: z.enum(['user', 'assistant']), content: z.string(),
  status: z.enum(['complete', 'streaming', 'partial', 'cancelled', 'error']),
  terminalCode: z.union([errorCode, z.literal('COMPLETED')]).nullable(),
  logicalAt: z.iso.datetime(), recordedAt: z.iso.datetime(), tz: z.string(), origin: originSchema,
  stats: statsSchema.nullable().optional(),
});
export const detailSchema = z.object({ conversation: conversationSchema.extend({ workspace: workspaceSchema }), messages: z.array(messageSchema) });
export const apiErrorSchema = z.object({ code: errorCode, message: z.string() });
export type ChatMessage = z.infer<typeof messageSchema>;
