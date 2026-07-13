import { z } from "zod";

const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, {
  message: "Use uma cor hexadecimal no formato #RRGGBB.",
});

const SkinDataUrlSchema = z
  .string()
  .max(3_000_000)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/, {
    message: "A skin deve ser uma imagem PNG incorporada.",
  })
  .nullable();

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
      })
      .strict(),
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
  .strict();

export type GameProject = z.infer<typeof GameProjectSchema>;

export const DEFAULT_GAME_PROJECT: GameProject = {
  schemaVersion: 1,
  id: "oficina-labirinto",
  name: "Oficina do Labirinto",
  seed: "primeira-expedicao",
  player: {
    color: "#8aa2ff",
    accentColor: "#ffd166",
    skinDataUrl: null,
    maxHealth: 6,
    speed: 220,
    radius: 18,
    fireCooldownSeconds: 0.24,
    projectileSpeed: 500,
  },
  enemy: {
    name: "Sentinela",
    color: "#ff6b7a",
    maxHealth: 3,
    speed: 72,
    radius: 18,
    spawnCount: 4,
    contactDamage: 1,
    dropChance: 0.35,
  },
  world: {
    width: 960,
    height: 576,
    wallThickness: 32,
    backgroundColor: "#10131c",
    floorColor: "#182136",
    wallColor: "#40517d",
  },
};

export function parseGameProject(value: unknown): GameProject {
  return GameProjectSchema.parse(value);
}

export function safeParseGameProject(value: unknown) {
  return GameProjectSchema.safeParse(value);
}

export function cloneGameProject(project: GameProject): GameProject {
  return structuredClone(project);
}
