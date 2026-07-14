import { EnemyBehaviorV1Schema } from "@collaborative-roguelike/studio-contracts";
import { z } from "zod";
import defaultProjectJson from "../../../game-data/default-project.json";

const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, {
  message: "Use uma cor hexadecimal no formato #RRGGBB.",
});

const SkinDataUrlSchema = z
  .string()
  .max(3_000_000)
  .regex(
    /^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
    {
    message: "A skin deve ser uma imagem PNG incorporada.",
    },
  )
  .nullable();

const SkinMetadataSchema = z
  .object({
    filename: z.string().trim().min(1).max(255),
    width: z.number().int().min(8).max(512),
    height: z.number().int().min(8).max(512),
    bytes: z.number().int().min(1).max(2 * 1024 * 1024),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    origin: z.literal("user-upload"),
    license: z.enum(["unverified", "original", "cc0", "cc-by", "cc-by-sa"]),
  })
  .strict()
  .nullable()
  .default(null);

const DEFAULT_RUN_SETTINGS = {
  endless: false,
  floorLimit: 3,
  roomsPerFloor: 9,
  startingCoins: 0,
  startingKeys: 1,
  shopHeartCost: 3,
} as const;

export const GameProjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,47}$/),
    name: z.string().trim().min(1).max(80),
    seed: z.string().trim().min(1).max(80),
    player: z
      .object({
        color: ColorSchema,
        accentColor: ColorSchema,
        skinDataUrl: SkinDataUrlSchema,
        skinMetadata: SkinMetadataSchema,
        maxHealth: z.number().int().min(1).max(20),
        speed: z.number().min(60).max(500),
        radius: z.number().int().min(8).max(32),
        fireCooldownSeconds: z.number().min(0.08).max(2),
        projectileSpeed: z.number().min(120).max(900),
      })
      .strict(),
    enemy: z
      .object({
        name: z.string().trim().min(1).max(40),
        color: ColorSchema,
        maxHealth: z.number().int().min(1).max(50),
        speed: z.number().min(10).max(300),
        radius: z.number().int().min(8).max(40),
        spawnCount: z.number().int().min(1).max(20),
        contactDamage: z.number().int().min(1).max(10),
        dropChance: z.number().min(0).max(1),
        behavior: EnemyBehaviorV1Schema.optional(),
      })
      .strict(),
    run: z
      .object({
        endless: z.boolean(),
        floorLimit: z.number().int().min(1).max(99),
        roomsPerFloor: z.number().int().min(5).max(24),
        startingCoins: z.number().int().min(0).max(99),
        startingKeys: z.number().int().min(1).max(9),
        shopHeartCost: z.number().int().min(1).max(99),
      })
      .strict()
      .default(DEFAULT_RUN_SETTINGS),
    world: z
      .object({
        width: z.number().int().min(640).max(1920),
        height: z.number().int().min(360).max(1080),
        wallThickness: z.number().int().min(16).max(96),
        backgroundColor: ColorSchema,
        floorColor: ColorSchema,
        wallColor: ColorSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((project, context) => {
    if (project.player.skinDataUrl === null && project.player.skinMetadata !== null) {
      context.addIssue({
        code: "custom",
        path: ["player", "skinMetadata"],
        message: "Metadados de skin exigem uma imagem incorporada.",
      });
    }
  });

export type GameProject = z.infer<typeof GameProjectSchema>;

/** The versioned JSON file is the single source that content changes publish. */
export const DEFAULT_GAME_PROJECT: GameProject =
  GameProjectSchema.parse(defaultProjectJson);

export function parseGameProject(value: unknown): GameProject {
  return GameProjectSchema.parse(value);
}

export function safeParseGameProject(value: unknown) {
  return GameProjectSchema.safeParse(value);
}

export function cloneGameProject(project: GameProject): GameProject {
  return {
    ...project,
    player: {
      ...project.player,
      skinMetadata: project.player.skinMetadata
        ? { ...project.player.skinMetadata }
        : null,
    },
    enemy: {
      ...project.enemy,
      ...(project.enemy.behavior === undefined
        ? {}
        : { behavior: EnemyBehaviorV1Schema.parse(project.enemy.behavior) }),
    },
    run: { ...project.run },
    world: { ...project.world },
  };
}
