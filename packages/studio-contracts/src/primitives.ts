import { z } from "zod";

/** IDs are opaque wire values. They deliberately cannot contain paths or whitespace. */
export const StudioIdSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*[A-Za-z0-9]$/);

export const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const DisplayNameSchema = z.string().trim().min(1).max(80);

export const ExplanationSchema = z.string().trim().min(1).max(4_000);

export const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const WorkspaceRoleSchema = z.enum([
  "owner",
  "editor",
  "reviewer",
  "viewer",
]);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

export const UserActorSchema = z
  .object({
    kind: z.literal("user"),
    userId: StudioIdSchema,
    displayName: DisplayNameSchema,
    role: WorkspaceRoleSchema,
  })
  .strict();
export type UserActor = z.infer<typeof UserActorSchema>;

export const SystemActorSchema = z
  .object({
    kind: z.literal("system"),
    service: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9.-]*$/),
  })
  .strict();
export type SystemActor = z.infer<typeof SystemActorSchema>;

export const ActorSchema = z.discriminatedUnion("kind", [
  UserActorSchema,
  SystemActorSchema,
]);
export type Actor = z.infer<typeof ActorSchema>;

const ProviderMetadataValueSchema = z.union([
  z.string().max(512),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const CREDENTIAL_LIKE_VALUE_RULES = [
  {
    name: "authorization-header",
    pattern:
      /(?:^|[\s,;])(?:authorization\s*:\s*)?(?:bearer|basic)\s+[A-Za-z0-9+/_.=-]{12,}(?:$|[\s,;])/i,
  },
  {
    name: "known-token-prefix",
    pattern:
      /(?:^|[^A-Za-z0-9])(?:vbk_|sk-(?:proj-|svcacct-)?|gh[pousr]_|github_pat_|glpat-)[A-Za-z0-9_-]{12,}(?:$|[^A-Za-z0-9_-])/i,
  },
  {
    name: "cloud-access-key",
    pattern: /(?:^|[^A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?:$|[^A-Z0-9])/,
  },
  {
    name: "private-key-header",
    pattern: /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/i,
  },
  {
    name: "cookie-header",
    pattern:
      /(?:^|[\s;])(?:set-cookie|cookie)\s*:\s*[^=\s;]{1,64}=[^;\s]{8,}/i,
  },
  {
    name: "url-credentials",
    pattern: /\bhttps?:\/\/[^/\s:@]{1,128}:[^/\s@]{4,128}@/i,
  },
] as const;

function credentialLikeValueRule(value: string): string | null {
  return CREDENTIAL_LIKE_VALUE_RULES.find(({ pattern }) => pattern.test(value))
    ?.name ?? null;
}

const ProviderMetadataEntriesSchema = z
  .record(
    z.string().min(1).max(48).regex(/^[A-Za-z][A-Za-z0-9_.-]*$/),
    ProviderMetadataValueSchema,
  )
  .superRefine((metadata, context) => {
    if (Object.keys(metadata).length > 16) {
      context.addIssue({
        code: "custom",
        message: "Provider metadata is limited to 16 entries.",
      });
    }

    for (const [key, value] of Object.entries(metadata)) {
      if (/(?:api[-_.]?)?key|token|secret|password|authorization|cookie/i.test(key)) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Secrets are forbidden in provider metadata.",
        });
      }

      if (typeof value === "string") {
        const matchedRule = credentialLikeValueRule(value);
        if (matchedRule !== null) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: `Credential-like provider metadata is forbidden (${matchedRule}).`,
          });
        }
      }
    }
  });

/**
 * Non-secret provenance that can be retained in audit logs. API credentials and
 * authorization headers are intentionally not representable here.
 */
export const ProviderMetadataSchema = z
  .object({
    provider: z.string().trim().min(1).max(80),
    model: z.string().trim().min(1).max(160).nullable(),
    requestId: z.string().min(1).max(200).nullable(),
    metadata: ProviderMetadataEntriesSchema,
  })
  .strict();
export type ProviderMetadata = z.infer<typeof ProviderMetadataSchema>;

export const AiModeSchema = z.enum([
  "chat",
  "explain",
  "propose-change",
  "propose-behavior",
  "generate-sprite",
  "edit-sprite",
  "clean-png",
]);
export type AiMode = z.infer<typeof AiModeSchema>;

export const RevisionDigestMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    revisionId: StudioIdSchema,
    projectId: StudioIdSchema,
    parentRevisionId: StudioIdSchema.nullable(),
    sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    digestAlgorithm: z.literal("sha256"),
    canonicalization: z.literal("jcs-rfc8785"),
    digest: Sha256Schema,
    contentBytes: z.number().int().min(2).max(100 * 1024 * 1024),
    createdAt: IsoDateTimeSchema,
    createdBy: ActorSchema,
  })
  .strict()
  .superRefine((revision, context) => {
    if (revision.sequence === 0 && revision.parentRevisionId !== null) {
      context.addIssue({
        code: "custom",
        path: ["parentRevisionId"],
        message: "A genesis revision cannot have a parent.",
      });
    }
    if (revision.sequence > 0 && revision.parentRevisionId === null) {
      context.addIssue({
        code: "custom",
        path: ["parentRevisionId"],
        message: "A non-genesis revision must have a parent.",
      });
    }
    if (revision.parentRevisionId === revision.revisionId) {
      context.addIssue({
        code: "custom",
        path: ["parentRevisionId"],
        message: "A revision cannot be its own parent.",
      });
    }
  });
export type RevisionDigestMetadata = z.infer<
  typeof RevisionDigestMetadataSchema
>;

export function parseRevisionDigestMetadata(
  value: unknown,
): RevisionDigestMetadata {
  return RevisionDigestMetadataSchema.parse(value);
}
