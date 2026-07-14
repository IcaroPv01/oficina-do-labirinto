import { z } from "zod";
import { EnemyBehaviorV1Schema } from "./enemy-behavior.js";
import {
  ActorSchema,
  ColorSchema,
  ExplanationSchema,
  IsoDateTimeSchema,
  ProviderMetadataSchema,
  Sha256Schema,
  StudioIdSchema,
} from "./primitives.js";

export const AssetKindSchema = z.enum([
  "player-sprite",
  "enemy-sprite",
  "tile",
  "background",
  "ui-image",
  "other-image",
]);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const AssetSlotSchema = z.enum([
  "player.skin",
  "enemy.skin",
  "world.background",
  "world.tile",
  "ui.image",
  "library.unassigned",
]);
export type AssetSlot = z.infer<typeof AssetSlotSchema>;

export const AssetLicenseSchema = z.enum([
  "unverified",
  "original",
  "cc0",
  "cc-by",
  "cc-by-sa",
]);
export type AssetLicense = z.infer<typeof AssetLicenseSchema>;

export const AssetOriginSchema = z.enum([
  "user-upload",
  "ai-generated",
  "ai-edited",
  "deterministic-transform",
]);
export type AssetOrigin = z.infer<typeof AssetOriginSchema>;

export const AssetProvenanceSchema = z
  .object({
    origin: AssetOriginSchema,
    createdAt: IsoDateTimeSchema,
    createdBy: ActorSchema,
    sourceAssetIds: z.array(StudioIdSchema).max(16),
    provider: ProviderMetadataSchema.nullable(),
    promptDigest: Sha256Schema.nullable(),
    transform: z
      .enum(["trim-transparent", "resize", "quantize", "remove-background"])
      .nullable(),
  })
  .strict()
  .superRefine((provenance, context) => {
    if (new Set(provenance.sourceAssetIds).size !== provenance.sourceAssetIds.length) {
      context.addIssue({
        code: "custom",
        path: ["sourceAssetIds"],
        message: "Source asset IDs must be unique.",
      });
    }

    const isAi =
      provenance.origin === "ai-generated" || provenance.origin === "ai-edited";
    if (isAi && provenance.provider === null) {
      context.addIssue({
        code: "custom",
        path: ["provider"],
        message: "AI-created assets require non-secret provider provenance.",
      });
    }
    if (isAi && provenance.promptDigest === null) {
      context.addIssue({
        code: "custom",
        path: ["promptDigest"],
        message: "AI-created assets require a prompt digest.",
      });
    }
    if (!isAi && provenance.provider !== null) {
      context.addIssue({
        code: "custom",
        path: ["provider"],
        message: "Provider provenance is only valid for AI-created assets.",
      });
    }
    if (!isAi && provenance.promptDigest !== null) {
      context.addIssue({
        code: "custom",
        path: ["promptDigest"],
        message: "Prompt digests are only valid for AI-created assets.",
      });
    }

    const needsSource =
      provenance.origin === "ai-edited" ||
      provenance.origin === "deterministic-transform";
    if (needsSource && provenance.sourceAssetIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["sourceAssetIds"],
        message: "Edited or transformed assets require a source asset.",
      });
    }
    if (!needsSource && provenance.sourceAssetIds.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["sourceAssetIds"],
        message: "Generated and uploaded assets cannot declare source assets.",
      });
    }

    if (
      provenance.origin === "deterministic-transform" &&
      provenance.transform === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["transform"],
        message: "A deterministic transform must identify its operation.",
      });
    }
    if (
      provenance.origin !== "deterministic-transform" &&
      provenance.transform !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["transform"],
        message: "Transform metadata is only valid for deterministic transforms.",
      });
    }
  });
export type AssetProvenance = z.infer<typeof AssetProvenanceSchema>;

export const ImageAssetDescriptorSchema = z
  .object({
    assetId: StudioIdSchema,
    kind: AssetKindSchema,
    filename: z
      .string()
      .min(5)
      .max(255)
      .regex(/^[^\\/:*?"<>|\u0000-\u001f]+\.png$/i),
    mediaType: z.literal("image/png"),
    bytes: z.number().int().min(1).max(10 * 1024 * 1024),
    width: z.number().int().min(1).max(4_096),
    height: z.number().int().min(1).max(4_096),
    sha256: Sha256Schema,
    storageObjectId: StudioIdSchema,
    license: AssetLicenseSchema,
    provenance: AssetProvenanceSchema,
  })
  .strict()
  .superRefine((asset, context) => {
    if (asset.provenance.sourceAssetIds.includes(asset.assetId)) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "sourceAssetIds"],
        message: "An asset cannot list itself as its source.",
      });
    }
  });
export type ImageAssetDescriptor = z.infer<
  typeof ImageAssetDescriptorSchema
>;

const OperationShape = {
  operationId: StudioIdSchema,
  explanation: ExplanationSchema,
} as const;

const ProjectSetNameOperationSchema = z
  .object({
    ...OperationShape,
    kind: z.literal("project.set-name"),
    name: z.string().trim().min(1).max(80),
  })
  .strict();

const ProjectSetSeedOperationSchema = z
  .object({
    ...OperationShape,
    kind: z.literal("project.set-seed"),
    seed: z.string().trim().min(1).max(80),
  })
  .strict();

const PlayerTuningSchema = z
  .object({
    color: ColorSchema.optional(),
    accentColor: ColorSchema.optional(),
    maxHealth: z.number().int().min(1).max(20).optional(),
    speed: z.number().min(60).max(500).optional(),
    radius: z.number().int().min(8).max(32).optional(),
    fireCooldownSeconds: z.number().min(0.08).max(2).optional(),
    projectileSpeed: z.number().min(120).max(900).optional(),
  })
  .strict()
  .superRefine((tuning, context) => {
    if (Object.keys(tuning).length === 0) {
      context.addIssue({
        code: "custom",
        message: "Player tuning must change at least one field.",
      });
    }
  });

const PlayerSetTuningOperationSchema = z
  .object({
    ...OperationShape,
    kind: z.literal("player.set-tuning"),
    tuning: PlayerTuningSchema,
  })
  .strict();

const EnemyTuningSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    color: ColorSchema.optional(),
    maxHealth: z.number().int().min(1).max(50).optional(),
    speed: z.number().min(10).max(300).optional(),
    radius: z.number().int().min(8).max(40).optional(),
    spawnCount: z.number().int().min(1).max(20).optional(),
    contactDamage: z.number().int().min(1).max(10).optional(),
    dropChance: z.number().min(0).max(1).optional(),
  })
  .strict()
  .superRefine((tuning, context) => {
    if (Object.keys(tuning).length === 0) {
      context.addIssue({
        code: "custom",
        message: "Enemy tuning must change at least one field.",
      });
    }
  });

const EnemySetTuningOperationSchema = z
  .object({
    ...OperationShape,
    kind: z.literal("enemy.set-tuning"),
    tuning: EnemyTuningSchema,
  })
  .strict();

const EnemySetBehaviorOperationSchema = z
  .object({
    ...OperationShape,
    kind: z.literal("enemy.set-behavior"),
    behavior: EnemyBehaviorV1Schema,
  })
  .strict();

const WorldStyleSchema = z
  .object({
    width: z.number().int().min(640).max(1_920).optional(),
    height: z.number().int().min(360).max(1_080).optional(),
    wallThickness: z.number().int().min(16).max(96).optional(),
    backgroundColor: ColorSchema.optional(),
    floorColor: ColorSchema.optional(),
    wallColor: ColorSchema.optional(),
  })
  .strict()
  .superRefine((style, context) => {
    if (Object.keys(style).length === 0) {
      context.addIssue({
        code: "custom",
        message: "World styling must change at least one field.",
      });
    }
  });

const WorldSetStyleOperationSchema = z
  .object({
    ...OperationShape,
    kind: z.literal("world.set-style"),
    style: WorldStyleSchema,
  })
  .strict();

const RunSettingsSchema = z
  .object({
    endless: z.boolean().optional(),
    floorLimit: z.number().int().min(1).max(99).optional(),
    roomsPerFloor: z.number().int().min(5).max(24).optional(),
    startingCoins: z.number().int().min(0).max(99).optional(),
    startingKeys: z.number().int().min(1).max(9).optional(),
    shopHeartCost: z.number().int().min(1).max(99).optional(),
  })
  .strict()
  .superRefine((settings, context) => {
    if (Object.keys(settings).length === 0) {
      context.addIssue({
        code: "custom",
        message: "Run settings must change at least one field.",
      });
    }
  });

const RunSetSettingsOperationSchema = z
  .object({
    ...OperationShape,
    kind: z.literal("run.set-settings"),
    settings: RunSettingsSchema,
  })
  .strict();

const AssetAddOperationSchema = z
  .object({
    ...OperationShape,
    kind: z.literal("asset.add"),
    slot: AssetSlotSchema,
    asset: ImageAssetDescriptorSchema,
  })
  .strict();

const AssetReplaceOperationSchema = z
  .object({
    ...OperationShape,
    kind: z.literal("asset.replace"),
    slot: AssetSlotSchema,
    replacedAssetId: StudioIdSchema,
    asset: ImageAssetDescriptorSchema,
  })
  .strict()
  .superRefine((operation, context) => {
    if (operation.replacedAssetId === operation.asset.assetId) {
      context.addIssue({
        code: "custom",
        path: ["asset", "assetId"],
        message: "A replacement must use a new asset ID.",
      });
    }
  });

const AssetRemoveOperationSchema = z
  .object({
    ...OperationShape,
    kind: z.literal("asset.remove"),
    slot: AssetSlotSchema,
    assetId: StudioIdSchema,
  })
  .strict();

/** Domain commands are intentionally finite; arbitrary paths and script text are absent. */
export const ChangeOperationSchema = z.discriminatedUnion("kind", [
  ProjectSetNameOperationSchema,
  ProjectSetSeedOperationSchema,
  PlayerSetTuningOperationSchema,
  EnemySetTuningOperationSchema,
  EnemySetBehaviorOperationSchema,
  WorldSetStyleOperationSchema,
  RunSetSettingsOperationSchema,
  AssetAddOperationSchema,
  AssetReplaceOperationSchema,
  AssetRemoveOperationSchema,
]);
export type ChangeOperation = z.infer<typeof ChangeOperationSchema>;

export const ChangeOperationsSchema = z
  .array(ChangeOperationSchema)
  .max(64)
  .superRefine((operations, context) => {
    const operationIds = new Set<string>();
    const singletonKinds = new Set<string>();
    const assetSlots = new Set<string>();
    const assetIds = new Set<string>();

    operations.forEach((operation, index) => {
      if (operationIds.has(operation.operationId)) {
        context.addIssue({
          code: "custom",
          path: [index, "operationId"],
          message: "Operation IDs must be unique within a change set.",
        });
      }
      operationIds.add(operation.operationId);

      if (
        operation.kind !== "asset.add" &&
        operation.kind !== "asset.replace" &&
        operation.kind !== "asset.remove"
      ) {
        if (singletonKinds.has(operation.kind)) {
          context.addIssue({
            code: "custom",
            path: [index, "kind"],
            message: "Singleton project commands may appear only once.",
          });
        }
        singletonKinds.add(operation.kind);
        return;
      }

      if (assetSlots.has(operation.slot)) {
        context.addIssue({
          code: "custom",
          path: [index, "slot"],
          message: "An asset slot may be changed only once per change set.",
        });
      }
      assetSlots.add(operation.slot);

      const touchedIds =
        operation.kind === "asset.add"
          ? [operation.asset.assetId]
          : operation.kind === "asset.replace"
            ? [operation.replacedAssetId, operation.asset.assetId]
            : [operation.assetId];
      touchedIds.forEach((assetId) => {
        if (assetIds.has(assetId)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: "An asset may be touched only once per change set.",
          });
        }
        assetIds.add(assetId);
      });
    });
  });

export function parseChangeOperation(value: unknown): ChangeOperation {
  return ChangeOperationSchema.parse(value);
}
