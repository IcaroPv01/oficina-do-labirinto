import type Phaser from "phaser";

import { shortHash } from "./projectPresentation";

export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 576;

export const ROOM_BOUNDS = {
  left: 48,
  top: 76,
  right: 912,
  bottom: 524,
} as const;

export interface RoomPalette {
  readonly backgroundColor: string;
  readonly floorColor: string;
  readonly wallColor: string;
}

function colorNumber(value: string): number {
  return Number.parseInt(value.slice(1), 16);
}

function seededUnit(seed: string, index: number): number {
  const hash = Number.parseInt(shortHash(`${seed}:${index}`), 16);
  return (hash >>> 0) / 0xffffffff;
}

export class RoomBackdrop {
  private readonly background: Phaser.GameObjects.Graphics;
  private readonly details: Phaser.GameObjects.Graphics;

  public constructor(scene: Phaser.Scene) {
    this.background = scene.add.graphics().setDepth(-20);
    this.details = scene.add.graphics().setDepth(-19);
  }

  public redraw(seed: string, palette: RoomPalette): void {
    const roomWidth = ROOM_BOUNDS.right - ROOM_BOUNDS.left;
    const roomHeight = ROOM_BOUNDS.bottom - ROOM_BOUNDS.top;

    this.background.clear();
    const backgroundColor = colorNumber(palette.backgroundColor);
    const floorColor = colorNumber(palette.floorColor);
    const wallColor = colorNumber(palette.wallColor);

    this.background.fillStyle(backgroundColor, 1);
    this.background.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.background.fillStyle(wallColor, 0.72);
    this.background.fillRect(ROOM_BOUNDS.left - 16, ROOM_BOUNDS.top - 16, roomWidth + 32, roomHeight + 32);
    this.background.fillStyle(floorColor, 1);
    this.background.fillRect(ROOM_BOUNDS.left, ROOM_BOUNDS.top, roomWidth, roomHeight);

    this.background.lineStyle(2, 0x314a59, 0.55);
    for (let x = ROOM_BOUNDS.left; x <= ROOM_BOUNDS.right; x += 48) {
      this.background.lineBetween(x, ROOM_BOUNDS.top, x, ROOM_BOUNDS.bottom);
    }
    for (let y = ROOM_BOUNDS.top; y <= ROOM_BOUNDS.bottom; y += 48) {
      this.background.lineBetween(ROOM_BOUNDS.left, y, ROOM_BOUNDS.right, y);
    }

    this.background.lineStyle(4, wallColor, 0.9);
    this.background.strokeRect(ROOM_BOUNDS.left - 2, ROOM_BOUNDS.top - 2, roomWidth + 4, roomHeight + 4);

    this.details.clear();
    this.details.lineStyle(2, 0x162634, 0.75);
    for (let index = 0; index < 20; index += 1) {
      const x = ROOM_BOUNDS.left + 20 + seededUnit(seed, index * 3) * (roomWidth - 40);
      const y = ROOM_BOUNDS.top + 20 + seededUnit(seed, index * 3 + 1) * (roomHeight - 40);
      const length = 7 + seededUnit(seed, index * 3 + 2) * 12;
      this.details.beginPath();
      this.details.moveTo(x, y);
      this.details.lineTo(x + length, y + length * 0.35);
      this.details.lineTo(x + length * 0.65, y + length * 0.8);
      this.details.strokePath();
    }

    this.drawDoor(GAME_WIDTH / 2, ROOM_BOUNDS.top - 8, true);
    this.drawDoor(GAME_WIDTH / 2, ROOM_BOUNDS.bottom + 8, true);
    this.drawDoor(ROOM_BOUNDS.left - 8, GAME_HEIGHT / 2 + 12, false);
    this.drawDoor(ROOM_BOUNDS.right + 8, GAME_HEIGHT / 2 + 12, false);
  }

  private drawDoor(x: number, y: number, horizontalWall: boolean): void {
    this.details.fillStyle(0x0a111b, 1);
    if (horizontalWall) {
      this.details.fillRoundedRect(x - 38, y - 10, 76, 20, 6);
      this.details.lineStyle(3, 0xc99b4b, 0.75);
      this.details.lineBetween(x - 28, y - 5, x + 28, y - 5);
    } else {
      this.details.fillRoundedRect(x - 10, y - 38, 20, 76, 6);
      this.details.lineStyle(3, 0xc99b4b, 0.75);
      this.details.lineBetween(x - 5, y - 28, x - 5, y + 28);
    }
  }

  public destroy(): void {
    this.background.destroy();
    this.details.destroy();
  }
}
