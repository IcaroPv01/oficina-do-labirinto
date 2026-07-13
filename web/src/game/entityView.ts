import Phaser from "phaser";

import type { PreviewEntityModel, PreviewRenderModel, PreviewProjectileModel } from "./renderModel";
import { shortHash } from "./projectPresentation";
import { TEXTURE_KEYS } from "./textures";

interface EnemyView {
  readonly sprite: Phaser.GameObjects.Image;
  readonly healthBackground: Phaser.GameObjects.Rectangle;
  readonly healthFill: Phaser.GameObjects.Rectangle;
  baseTint: number;
}

function removeMissing<T>(
  map: Map<string, T>,
  liveIds: ReadonlySet<string>,
  destroy: (value: T) => void,
): void {
  for (const [id, value] of map) {
    if (!liveIds.has(id)) {
      destroy(value);
      map.delete(id);
    }
  }
}

export class EntityView {
  private readonly player: Phaser.GameObjects.Image;
  private readonly playerShadow: Phaser.GameObjects.Ellipse;
  private readonly enemies = new Map<string, EnemyView>();
  private readonly projectiles = new Map<string, Phaser.GameObjects.Image>();
  private readonly pickups = new Map<string, Phaser.GameObjects.Image>();
  private skinGeneration = 0;
  private destroyed = false;
  private playerTint = 0xffffff;
  private enemyTint = 0xffffff;
  private accentTint = 0xffffff;
  private customPlayerSkin = false;

  public constructor(private readonly scene: Phaser.Scene) {
    this.playerShadow = scene.add.ellipse(0, 0, 32, 12, 0x02070c, 0.4).setDepth(8);
    this.player = scene.add.image(0, 0, TEXTURE_KEYS.player).setDisplaySize(42, 42).setDepth(10);
  }

  public sync(model: PreviewRenderModel): void {
    this.player.setPosition(model.player.x, model.player.y);
    this.playerShadow.setPosition(model.player.x, model.player.y + 17);

    const enemyIds = new Set(model.enemies.map((enemy) => enemy.id));
    removeMissing(this.enemies, enemyIds, (view) => {
      view.sprite.destroy();
      view.healthBackground.destroy();
      view.healthFill.destroy();
    });

    for (const enemy of model.enemies) {
      const view = this.enemies.get(enemy.id) ?? this.createEnemy(enemy);
      view.sprite.setPosition(enemy.x, enemy.y);
      view.healthBackground.setPosition(enemy.x, enemy.y - 27);
      const healthRatio = Math.max(0, Math.min(1, enemy.health / Math.max(1, enemy.maxHealth)));
      view.healthFill.setDisplaySize(30 * healthRatio, 3);
      view.healthFill.setPosition(enemy.x - 15 + (30 * healthRatio) / 2, enemy.y - 27);
    }

    const projectileIds = new Set(model.projectiles.map((projectile) => projectile.id));
    removeMissing(this.projectiles, projectileIds, (sprite) => sprite.destroy());

    for (const projectile of model.projectiles) {
      const sprite = this.projectiles.get(projectile.id) ?? this.createProjectile(projectile);
      sprite.setPosition(projectile.x, projectile.y);
      if (projectile.velocityX !== 0 || projectile.velocityY !== 0) {
        sprite.setRotation(Math.atan2(projectile.velocityY, projectile.velocityX));
      }
    }

    const pickupIds = new Set(model.pickups.map((pickup) => pickup.id));
    removeMissing(this.pickups, pickupIds, (sprite) => sprite.destroy());
    for (const pickup of model.pickups) {
      const sprite = this.pickups.get(pickup.id) ?? this.createPickup(pickup.id, pickup.x, pickup.y);
      sprite.setPosition(pickup.x, pickup.y);
      sprite.setScale(1 + Math.sin(model.elapsedTimeMs / 180) * 0.08);
    }
  }

  public setPlayerSkin(dataUrl: string | null): void {
    this.skinGeneration += 1;
    const generation = this.skinGeneration;

    if (!dataUrl) {
      this.customPlayerSkin = false;
      this.player.setTexture(TEXTURE_KEYS.player).setDisplaySize(42, 42).setTint(this.playerTint);
      return;
    }

    this.customPlayerSkin = true;

    const key = `preview-player-skin-${shortHash(dataUrl)}`;
    if (this.scene.textures.exists(key)) {
      this.applyPlayerTexture(key);
      return;
    }

    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => {
      if (this.destroyed || generation !== this.skinGeneration) {
        return;
      }
      if (!this.scene.textures.exists(key)) {
        this.scene.textures.addImage(key, image);
      }
      this.applyPlayerTexture(key);
    });
    image.addEventListener("error", () => {
      if (!this.destroyed && generation === this.skinGeneration) {
        this.customPlayerSkin = false;
        this.player.setTexture(TEXTURE_KEYS.player).setDisplaySize(42, 42).setTint(this.playerTint);
      }
    });
    image.src = dataUrl;
  }

  public setPalette(playerColor: string, accentColor: string, enemyColor: string): void {
    this.playerTint = EntityView.parseColor(playerColor);
    this.accentTint = EntityView.parseColor(accentColor);
    this.enemyTint = EntityView.parseColor(enemyColor);

    if (!this.customPlayerSkin) {
      this.player.setTint(this.playerTint);
    }
    for (const view of this.enemies.values()) {
      view.baseTint = this.enemyTint;
      view.sprite.setTint(this.enemyTint);
    }
    for (const projectile of this.projectiles.values()) {
      projectile.setTint(
        projectile.texture.key === TEXTURE_KEYS.playerBullet ? this.accentTint : this.enemyTint,
      );
    }
  }

  public flashPlayer(): void {
    this.player.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(75, () => {
      if (!this.destroyed) {
        if (this.customPlayerSkin) {
          this.player.clearTint();
        } else {
          this.player.setTint(this.playerTint);
        }
        this.player.setTintMode(Phaser.TintModes.MULTIPLY);
      }
    });
  }

  public flashEnemy(id: string): void {
    const view = this.enemies.get(id);
    if (!view) {
      return;
    }
    const { sprite } = view;
    sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(65, () => {
      if (!this.destroyed && sprite.active) {
        sprite.setTint(view.baseTint).setTintMode(Phaser.TintModes.MULTIPLY);
      }
    });
  }

  public destroy(): void {
    this.destroyed = true;
    this.skinGeneration += 1;
    this.player.destroy();
    this.playerShadow.destroy();
    removeMissing(this.enemies, new Set(), (view) => {
      view.sprite.destroy();
      view.healthBackground.destroy();
      view.healthFill.destroy();
    });
    removeMissing(this.projectiles, new Set(), (sprite) => sprite.destroy());
    removeMissing(this.pickups, new Set(), (sprite) => sprite.destroy());
  }

  private createEnemy(enemy: PreviewEntityModel): EnemyView {
    const sprite = this.scene.add.image(enemy.x, enemy.y, TEXTURE_KEYS.enemy).setDisplaySize(40, 40).setDepth(9);
    const baseTint = this.enemyTint;
    sprite.setTint(baseTint);
    const healthBackground = this.scene.add.rectangle(enemy.x, enemy.y - 27, 32, 5, 0x07101b, 0.95).setDepth(11);
    const healthFill = this.scene.add.rectangle(enemy.x, enemy.y - 27, 30, 3, 0xe05a76, 1).setDepth(12);
    const view = { sprite, healthBackground, healthFill, baseTint };
    this.enemies.set(enemy.id, view);
    return view;
  }

  private createProjectile(projectile: PreviewProjectileModel): Phaser.GameObjects.Image {
    const key = projectile.owner === "player" ? TEXTURE_KEYS.playerBullet : TEXTURE_KEYS.enemyBullet;
    const tint = projectile.owner === "player" ? this.accentTint : this.enemyTint;
    const sprite = this.scene.add.image(projectile.x, projectile.y, key).setDisplaySize(14, 14).setTint(tint).setDepth(15);
    this.projectiles.set(projectile.id, sprite);
    return sprite;
  }

  private createPickup(id: string, x: number, y: number): Phaser.GameObjects.Image {
    const sprite = this.scene.add.image(x, y, TEXTURE_KEYS.heartPickup).setDisplaySize(26, 26).setDepth(7);
    this.pickups.set(id, sprite);
    return sprite;
  }

  private applyPlayerTexture(key: string): void {
    const frame = this.scene.textures.getFrame(key);
    const longestSide = Math.max(1, frame.width, frame.height);
    const scale = 42 / longestSide;
    this.player.clearTint().setTexture(key).setDisplaySize(frame.width * scale, frame.height * scale);
  }

  private static parseColor(color: string): number {
    return /^#[0-9a-f]{6}$/i.test(color) ? Number.parseInt(color.slice(1), 16) : 0xffffff;
  }
}
