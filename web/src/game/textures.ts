import type Phaser from "phaser";

export const TEXTURE_KEYS = {
  player: "preview-player-procedural",
  enemy: "preview-enemy-procedural",
  playerBullet: "preview-player-bullet",
  enemyBullet: "preview-enemy-bullet",
  heartPickup: "preview-heart-pickup",
} as const;

const TEXTURE_SIZE = 32;

function paintPixelTexture(
  scene: Phaser.Scene,
  key: string,
  painter: (context: CanvasRenderingContext2D) => void,
): void {
  if (scene.textures.exists(key)) {
    return;
  }

  const texture = scene.textures.createCanvas(key, TEXTURE_SIZE, TEXTURE_SIZE);
  if (!texture) {
    return;
  }

  const context = texture.context;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  painter(context);
  texture.refresh();
}

export function ensurePreviewTextures(scene: Phaser.Scene): void {
  paintPixelTexture(scene, TEXTURE_KEYS.player, (context) => {
    context.fillStyle = "#162538";
    context.fillRect(8, 5, 16, 5);
    context.fillRect(5, 10, 22, 14);
    context.fillRect(8, 24, 6, 5);
    context.fillRect(18, 24, 6, 5);

    context.fillStyle = "#5ce1c6";
    context.fillRect(8, 8, 16, 15);
    context.fillRect(11, 5, 10, 4);

    context.fillStyle = "#e8fff8";
    context.fillRect(10, 12, 4, 4);
    context.fillRect(18, 12, 4, 4);

    context.fillStyle = "#102235";
    context.fillRect(11, 13, 2, 3);
    context.fillRect(19, 13, 2, 3);
    context.fillRect(13, 19, 6, 2);

    context.fillStyle = "#f5bd4f";
    context.fillRect(14, 2, 4, 4);
  });

  paintPixelTexture(scene, TEXTURE_KEYS.enemy, (context) => {
    context.fillStyle = "#32152d";
    context.fillRect(6, 8, 20, 18);
    context.fillRect(9, 5, 4, 5);
    context.fillRect(19, 5, 4, 5);
    context.fillRect(4, 14, 4, 8);
    context.fillRect(24, 14, 4, 8);

    context.fillStyle = "#e05a76";
    context.fillRect(8, 9, 16, 15);
    context.fillRect(10, 6, 3, 4);
    context.fillRect(19, 6, 3, 4);

    context.fillStyle = "#fff0cf";
    context.fillRect(10, 13, 4, 4);
    context.fillRect(18, 13, 4, 4);

    context.fillStyle = "#40162d";
    context.fillRect(11, 14, 2, 3);
    context.fillRect(19, 14, 2, 3);
    context.fillRect(13, 20, 6, 2);
  });

  paintPixelTexture(scene, TEXTURE_KEYS.playerBullet, (context) => {
    context.fillStyle = "#f8e16c";
    context.fillRect(10, 10, 12, 12);
    context.fillStyle = "#fffbd1";
    context.fillRect(13, 13, 6, 6);
  });

  paintPixelTexture(scene, TEXTURE_KEYS.enemyBullet, (context) => {
    context.fillStyle = "#ff4f64";
    context.fillRect(9, 9, 14, 14);
    context.fillStyle = "#ffd1d6";
    context.fillRect(13, 13, 6, 6);
  });

  paintPixelTexture(scene, TEXTURE_KEYS.heartPickup, (context) => {
    context.fillStyle = "#7a263f";
    context.fillRect(6, 8, 8, 8);
    context.fillRect(18, 8, 8, 8);
    context.fillRect(8, 14, 16, 8);
    context.fillRect(11, 22, 10, 5);
    context.fillStyle = "#ff6b86";
    context.fillRect(8, 9, 6, 6);
    context.fillRect(18, 9, 6, 6);
    context.fillRect(10, 14, 12, 7);
    context.fillRect(13, 21, 6, 4);
    context.fillStyle = "#ffd2db";
    context.fillRect(10, 10, 3, 3);
  });
}
