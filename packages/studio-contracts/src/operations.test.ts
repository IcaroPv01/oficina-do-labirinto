import { describe, expect, it } from "vitest";
import {
  AssetProvenanceSchema,
  ChangeOperationSchema,
  ChangeOperationsSchema,
  ImageAssetDescriptorSchema,
} from "./operations.js";
import {
  BEHAVIOR_OPERATION,
  NOW,
  OWNER,
  PROVIDER,
} from "./test-fixtures.js";

const USER_UPLOAD_PROVENANCE = {
  origin: "user-upload",
  createdAt: NOW,
  createdBy: OWNER,
  sourceAssetIds: [],
  provider: null,
  promptDigest: null,
  transform: null,
} as const;

const IMAGE_ASSET = {
  assetId: "asset-new",
  kind: "enemy-sprite",
  filename: "sentinela.png",
  mediaType: "image/png",
  bytes: 4_096,
  width: 64,
  height: 64,
  sha256: "d".repeat(64),
  storageObjectId: "object-new",
  license: "original",
  provenance: USER_UPLOAD_PROVENANCE,
} as const;

const ASSET_ADD = {
  operationId: "operation-asset-add",
  kind: "asset.add",
  explanation: "Adiciona a nova sprite do sentinela.",
  slot: "enemy.skin",
  asset: IMAGE_ASSET,
} as const;

describe("domain change operations", () => {
  it("accepts finite commands for tuning, behavior and assets", () => {
    const commands = [
      {
        operationId: "operation-name",
        kind: "project.set-name",
        explanation: "Torna o nome mais claro.",
        name: "A Oficina do Labirinto",
      },
      {
        operationId: "operation-player",
        kind: "player.set-tuning",
        explanation: "Ajusta a velocidade testada no sandbox.",
        tuning: { speed: 240, color: "#abcdef" },
      },
      BEHAVIOR_OPERATION,
      ASSET_ADD,
    ];

    commands.forEach((command) => {
      expect(ChangeOperationSchema.safeParse(command).success).toBe(true);
    });
  });

  it("rejects JSON Patch and arbitrary script-shaped operations", () => {
    expect(
      ChangeOperationSchema.safeParse({
        operationId: "operation-patch",
        kind: "replace",
        path: "/enemy/speed",
        value: 999,
        explanation: "Patch arbitrário.",
      }).success,
    ).toBe(false);
    expect(
      ChangeOperationSchema.safeParse({
        operationId: "operation-code",
        kind: "code.execute",
        source: "rm -rf /",
        explanation: "Código arbitrário.",
      }).success,
    ).toBe(false);
  });

  it("requires partial tuning commands to actually change a field", () => {
    expect(
      ChangeOperationSchema.safeParse({
        operationId: "operation-empty",
        kind: "enemy.set-tuning",
        explanation: "Não altera nada.",
        tuning: {},
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields even on an otherwise valid operation", () => {
    expect(
      ChangeOperationSchema.safeParse({
        ...BEHAVIOR_OPERATION,
        sourceCode: "while(true) {}",
      }).success,
    ).toBe(false);
  });

  it("prevents conflicting operation IDs and singleton commands", () => {
    const first = {
      operationId: "operation-tuning",
      kind: "enemy.set-tuning",
      explanation: "Primeiro ajuste.",
      tuning: { speed: 100 },
    } as const;
    expect(ChangeOperationsSchema.safeParse([first, first]).success).toBe(false);
    expect(
      ChangeOperationsSchema.safeParse([
        first,
        {
          ...first,
          operationId: "operation-tuning-2",
          tuning: { speed: 110 },
        },
      ]).success,
    ).toBe(false);
  });

  it("allows different asset slots but prevents two writes to one slot", () => {
    expect(
      ChangeOperationsSchema.safeParse([
        ASSET_ADD,
        {
          ...ASSET_ADD,
          operationId: "operation-ui-add",
          slot: "ui.image",
          asset: {
            ...IMAGE_ASSET,
            assetId: "asset-ui",
            storageObjectId: "object-ui",
          },
        },
      ]).success,
    ).toBe(true);

    expect(
      ChangeOperationsSchema.safeParse([
        ASSET_ADD,
        {
          ...ASSET_ADD,
          operationId: "operation-replace",
          kind: "asset.remove",
          assetId: "asset-old",
        },
      ]).success,
    ).toBe(false);
  });
});

describe("image asset provenance", () => {
  it("accepts a bounded PNG descriptor with no embedded bytes or URL", () => {
    expect(ImageAssetDescriptorSchema.parse(IMAGE_ASSET)).toEqual(IMAGE_ASSET);
    expect(
      ImageAssetDescriptorSchema.safeParse({
        ...IMAGE_ASSET,
        dataUrl: "data:image/png;base64,secret",
      }).success,
    ).toBe(false);
    expect(
      ImageAssetDescriptorSchema.safeParse({
        ...IMAGE_ASSET,
        filename: "../sentinela.png",
      }).success,
    ).toBe(false);
  });

  it("requires provider and prompt provenance for AI-created assets", () => {
    const aiGenerated = {
      ...USER_UPLOAD_PROVENANCE,
      origin: "ai-generated",
      provider: PROVIDER,
      promptDigest: "e".repeat(64),
    } as const;
    expect(AssetProvenanceSchema.safeParse(aiGenerated).success).toBe(true);
    expect(
      AssetProvenanceSchema.safeParse({ ...aiGenerated, provider: null }).success,
    ).toBe(false);
    expect(
      AssetProvenanceSchema.safeParse({ ...aiGenerated, promptDigest: null })
        .success,
    ).toBe(false);
  });

  it("requires source assets for edits and deterministic cleanup", () => {
    expect(
      AssetProvenanceSchema.safeParse({
        ...USER_UPLOAD_PROVENANCE,
        origin: "deterministic-transform",
        sourceAssetIds: ["asset-source"],
        transform: "trim-transparent",
      }).success,
    ).toBe(true);
    expect(
      AssetProvenanceSchema.safeParse({
        ...USER_UPLOAD_PROVENANCE,
        origin: "deterministic-transform",
        transform: "trim-transparent",
      }).success,
    ).toBe(false);
  });

  it("prevents provider fields on non-AI assets and self-sourced assets", () => {
    expect(
      AssetProvenanceSchema.safeParse({
        ...USER_UPLOAD_PROVENANCE,
        provider: PROVIDER,
      }).success,
    ).toBe(false);
    expect(
      ImageAssetDescriptorSchema.safeParse({
        ...IMAGE_ASSET,
        provenance: {
          ...USER_UPLOAD_PROVENANCE,
          origin: "deterministic-transform",
          sourceAssetIds: [IMAGE_ASSET.assetId],
          transform: "resize",
        },
      }).success,
    ).toBe(false);
  });

  it("requires replacement asset identity to change", () => {
    expect(
      ChangeOperationSchema.safeParse({
        operationId: "operation-replace",
        kind: "asset.replace",
        explanation: "Troca a sprite antiga.",
        slot: "enemy.skin",
        replacedAssetId: IMAGE_ASSET.assetId,
        asset: IMAGE_ASSET,
      }).success,
    ).toBe(false);
  });
});
