import { z } from "zod";
import {
  DisplayNameSchema,
  IsoDateTimeSchema,
  ProviderMetadataSchema,
  StudioIdSchema,
  UserActorSchema,
} from "./primitives.js";

export const ChatChannelSchema = z.enum(["team", "ai"]);
export type ChatChannel = z.infer<typeof ChatChannelSchema>;

const AssistantChatAuthorSchema = z
  .object({
    kind: z.literal("assistant"),
    assistantId: StudioIdSchema,
    displayName: DisplayNameSchema,
    provider: ProviderMetadataSchema,
  })
  .strict();

export const ChatAuthorSchema = z.discriminatedUnion("kind", [
  UserActorSchema,
  AssistantChatAuthorSchema,
]);
export type ChatAuthor = z.infer<typeof ChatAuthorSchema>;

export const ChatMessageSchema = z
  .object({
    schemaVersion: z.literal(1),
    messageId: StudioIdSchema,
    workspaceId: StudioIdSchema,
    threadId: StudioIdSchema,
    channel: ChatChannelSchema,
    author: ChatAuthorSchema,
    body: z.string().trim().min(1).max(8_000),
    createdAt: IsoDateTimeSchema,
    replyToMessageId: StudioIdSchema.nullable(),
    changeSetId: StudioIdSchema.nullable(),
    assetIds: z.array(StudioIdSchema).max(8),
  })
  .strict()
  .superRefine((message, context) => {
    if (message.channel === "team" && message.author.kind === "assistant") {
      context.addIssue({
        code: "custom",
        path: ["author"],
        message: "Assistants may post only in AI chat threads.",
      });
    }
    if (message.replyToMessageId === message.messageId) {
      context.addIssue({
        code: "custom",
        path: ["replyToMessageId"],
        message: "A chat message cannot reply to itself.",
      });
    }
    if (new Set(message.assetIds).size !== message.assetIds.length) {
      context.addIssue({
        code: "custom",
        path: ["assetIds"],
        message: "Chat asset IDs must be unique.",
      });
    }
  });
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export function parseChatMessage(value: unknown): ChatMessage {
  return ChatMessageSchema.parse(value);
}
