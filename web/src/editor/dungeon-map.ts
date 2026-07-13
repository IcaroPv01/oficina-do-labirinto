import type {
  DungeonLayout,
  DungeonRoom,
  RoomKind,
} from "../core";
import "./dungeon-map.css";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const CELL_SIZE = 72;
const ROOM_SIZE = 42;
const MAP_PADDING = 38;
const MINIMUM_VIEW_SIZE = 120;

const ROOM_LABELS = {
  start: "Início",
  combat: "Combate",
  shop: "Loja",
  treasure: "Tesouro",
  boss: "Chefe",
} as const satisfies Record<RoomKind, string>;

const ROOM_SYMBOLS = {
  start: "I",
  combat: "C",
  shop: "$",
  treasure: "T",
  boss: "B",
} as const satisfies Record<RoomKind, string>;

export interface DungeonMapRoomGeometry {
  readonly id: string;
  readonly kind: RoomKind;
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

export interface DungeonMapConnectionGeometry {
  readonly fromId: string;
  readonly toId: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface DungeonMapGeometry {
  readonly width: number;
  readonly height: number;
  readonly rooms: readonly DungeonMapRoomGeometry[];
  readonly connections: readonly DungeonMapConnectionGeometry[];
}

export interface DungeonMapOptions {
  readonly currentRoomId?: string | null;
  readonly visitedRoomIds?: Iterable<string>;
  readonly selectedRoomId?: string | null;
  readonly ariaLabel?: string;
  readonly onRoomSelect?: (room: DungeonRoom) => void;
}

export interface DungeonMapHandle {
  update(layout: DungeonLayout, options?: DungeonMapOptions): void;
  destroy(): void;
}

interface NormalizedOptions {
  currentRoomId: string | null;
  visitedRoomIds: Set<string>;
  selectedRoomId: string | null;
  ariaLabel: string;
  onRoomSelect: ((room: DungeonRoom) => void) | null;
}

/**
 * Calculates a stable, responsive SVG coordinate system without touching the
 * DOM. Connections are deduplicated even when the dungeon lists both sides.
 */
export function calculateDungeonMapGeometry(
  layout: DungeonLayout,
): DungeonMapGeometry {
  assertUniqueRooms(layout.rooms);

  if (layout.rooms.length === 0) {
    return {
      width: MINIMUM_VIEW_SIZE,
      height: MINIMUM_VIEW_SIZE,
      rooms: [],
      connections: [],
    };
  }

  const minX = Math.min(...layout.rooms.map((room) => finiteCoordinate(room.x)));
  const maxX = Math.max(...layout.rooms.map((room) => finiteCoordinate(room.x)));
  const minY = Math.min(...layout.rooms.map((room) => finiteCoordinate(room.y)));
  const maxY = Math.max(...layout.rooms.map((room) => finiteCoordinate(room.y)));
  const width = Math.max(
    MINIMUM_VIEW_SIZE,
    (maxX - minX) * CELL_SIZE + MAP_PADDING * 2,
  );
  const height = Math.max(
    MINIMUM_VIEW_SIZE,
    (maxY - minY) * CELL_SIZE + MAP_PADDING * 2,
  );

  const rooms = layout.rooms.map((room): DungeonMapRoomGeometry => ({
    id: room.id,
    kind: room.kind,
    x: MAP_PADDING + (room.x - minX) * CELL_SIZE,
    y: MAP_PADDING + (room.y - minY) * CELL_SIZE,
    size: ROOM_SIZE,
  }));
  const roomGeometryById = new Map(rooms.map((room) => [room.id, room]));
  const roomById = new Map(layout.rooms.map((room) => [room.id, room]));
  const connectionKeys = new Set<string>();
  const connections: DungeonMapConnectionGeometry[] = [];

  for (const room of layout.rooms) {
    for (const connectedId of room.connections) {
      if (!roomById.has(connectedId) || connectedId === room.id) {
        continue;
      }

      const [fromId, toId] = [room.id, connectedId].sort();
      if (!fromId || !toId) {
        continue;
      }

      const key = `${fromId}\u0000${toId}`;
      if (connectionKeys.has(key)) {
        continue;
      }

      const from = roomGeometryById.get(fromId);
      const to = roomGeometryById.get(toId);
      if (!from || !to) {
        continue;
      }

      connectionKeys.add(key);
      connections.push({
        fromId,
        toId,
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
      });
    }
  }

  return { width, height, rooms, connections };
}

export function createDungeonMap(
  container: HTMLElement,
  initialLayout: DungeonLayout,
  initialOptions: DungeonMapOptions = {},
): DungeonMapHandle {
  let layout = initialLayout;
  let options = normalizeOptions(initialOptions);
  let destroyed = false;
  let wrapper: HTMLElement | null = null;
  let roomElements = new Map<string, SVGGElement>();

  const applyRoomStates = (): void => {
    for (const room of layout.rooms) {
      const roomElement = roomElements.get(room.id);
      if (!roomElement) {
        continue;
      }

      const isCurrent = options.currentRoomId === room.id;
      const isVisited = isCurrent || options.visitedRoomIds.has(room.id);
      const isSelected = options.selectedRoomId === room.id;
      roomElement.classList.toggle("dungeon-map__room--current", isCurrent);
      roomElement.classList.toggle("dungeon-map__room--visited", isVisited);
      roomElement.classList.toggle("dungeon-map__room--selected", isSelected);
      roomElement.setAttribute("aria-pressed", String(isSelected));
      roomElement.setAttribute(
        "aria-label",
        roomAriaLabel(room, isVisited, isCurrent),
      );

      if (isCurrent) {
        roomElement.setAttribute("aria-current", "location");
      } else {
        roomElement.removeAttribute("aria-current");
      }
    }
  };

  const selectRoom = (room: DungeonRoom): void => {
    options.selectedRoomId = room.id;
    applyRoomStates();
    options.onRoomSelect?.(room);
  };

  const render = (): void => {
    if (destroyed) {
      return;
    }

    const geometry = calculateDungeonMapGeometry(layout);
    const nextWrapper = document.createElement("section");
    nextWrapper.className = "dungeon-map";
    nextWrapper.setAttribute("aria-label", options.ariaLabel);

    const heading = document.createElement("div");
    heading.className = "dungeon-map__heading";
    const title = document.createElement("h3");
    title.textContent = "Mapa da dungeon";
    const seed = document.createElement("span");
    seed.className = "dungeon-map__seed";
    seed.textContent = `Seed: ${layout.seed}`;
    heading.append(title, seed);

    const svg = createSvgElement("svg");
    svg.classList.add("dungeon-map__canvas");
    svg.setAttribute("viewBox", `0 0 ${geometry.width} ${geometry.height}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", `${layout.rooms.length} salas conectadas`);

    const connections = createSvgElement("g");
    connections.classList.add("dungeon-map__connections");
    connections.setAttribute("aria-hidden", "true");
    for (const connection of geometry.connections) {
      const line = createSvgElement("line");
      line.classList.add("dungeon-map__connection");
      line.setAttribute("x1", String(connection.x1));
      line.setAttribute("y1", String(connection.y1));
      line.setAttribute("x2", String(connection.x2));
      line.setAttribute("y2", String(connection.y2));
      connections.append(line);
    }
    svg.append(connections);

    roomElements = new Map();
    const roomById = new Map(layout.rooms.map((room) => [room.id, room]));
    for (const geometryRoom of geometry.rooms) {
      const room = roomById.get(geometryRoom.id);
      if (!room) {
        continue;
      }

      const group = createSvgElement("g");
      group.classList.add(
        "dungeon-map__room",
        `dungeon-map__room--${room.kind}`,
      );
      group.setAttribute("role", "button");
      group.setAttribute("tabindex", "0");
      group.setAttribute("focusable", "true");
      group.setAttribute("aria-label", roomAriaLabel(room));

      const roomTitle = createSvgElement("title");
      roomTitle.textContent = roomAriaLabel(room);
      const shape = createSvgElement("rect");
      shape.classList.add("dungeon-map__room-shape");
      shape.setAttribute("x", String(geometryRoom.x - geometryRoom.size / 2));
      shape.setAttribute("y", String(geometryRoom.y - geometryRoom.size / 2));
      shape.setAttribute("width", String(geometryRoom.size));
      shape.setAttribute("height", String(geometryRoom.size));
      shape.setAttribute("rx", room.kind === "boss" ? "4" : "9");
      const symbol = createSvgElement("text");
      symbol.classList.add("dungeon-map__room-symbol");
      symbol.setAttribute("x", String(geometryRoom.x));
      symbol.setAttribute("y", String(geometryRoom.y));
      symbol.setAttribute("text-anchor", "middle");
      symbol.setAttribute("dominant-baseline", "central");
      symbol.setAttribute("aria-hidden", "true");
      symbol.textContent = ROOM_SYMBOLS[room.kind];
      group.append(roomTitle, shape, symbol);
      group.addEventListener("click", () => {
        selectRoom(room);
      });
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectRoom(room);
        }
      });
      roomElements.set(room.id, group);
      svg.append(group);
    }

    const legend = createLegend();
    nextWrapper.append(heading, svg, legend);
    wrapper?.remove();
    wrapper = nextWrapper;
    container.replaceChildren(nextWrapper);
    applyRoomStates();
  };

  render();

  return {
    update(nextLayout, nextOptions) {
      if (destroyed) {
        return;
      }
      layout = nextLayout;
      options = nextOptions
        ? mergeOptions(options, nextOptions)
        : options;
      render();
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      roomElements.clear();
      wrapper?.remove();
      wrapper = null;
    },
  };
}

function createLegend(): HTMLElement {
  const legend = document.createElement("ul");
  legend.className = "dungeon-map__legend";
  legend.setAttribute("aria-label", "Legenda das salas");

  for (const kind of Object.keys(ROOM_LABELS) as RoomKind[]) {
    const item = document.createElement("li");
    const marker = document.createElement("span");
    marker.className = `dungeon-map__legend-marker dungeon-map__legend-marker--${kind}`;
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = ROOM_SYMBOLS[kind];
    item.append(marker, ROOM_LABELS[kind]);
    legend.append(item);
  }

  const visitedItem = document.createElement("li");
  const visitedMarker = document.createElement("span");
  visitedMarker.className =
    "dungeon-map__legend-marker dungeon-map__legend-marker--visited";
  visitedMarker.setAttribute("aria-hidden", "true");
  visitedMarker.textContent = "✓";
  visitedItem.append(visitedMarker, "Visitada");
  legend.append(visitedItem);

  const currentItem = document.createElement("li");
  const currentMarker = document.createElement("span");
  currentMarker.className =
    "dungeon-map__legend-marker dungeon-map__legend-marker--current";
  currentMarker.setAttribute("aria-hidden", "true");
  currentMarker.textContent = "●";
  currentItem.append(currentMarker, "Sala atual");
  legend.append(currentItem);
  return legend;
}

function roomAriaLabel(
  room: DungeonRoom,
  visited = false,
  current = false,
): string {
  const state = current ? ", sala atual" : visited ? ", visitada" : "";
  return `${ROOM_LABELS[room.kind]}, posição ${room.x}, ${room.y}${state}`;
}

function normalizeOptions(options: DungeonMapOptions): NormalizedOptions {
  return {
    currentRoomId: options.currentRoomId ?? null,
    visitedRoomIds: new Set(options.visitedRoomIds ?? []),
    selectedRoomId: options.selectedRoomId ?? null,
    ariaLabel: options.ariaLabel?.trim() || "Mapa navegável da dungeon",
    onRoomSelect: options.onRoomSelect ?? null,
  };
}

function mergeOptions(
  current: NormalizedOptions,
  next: DungeonMapOptions,
): NormalizedOptions {
  return {
    currentRoomId:
      next.currentRoomId === undefined
        ? current.currentRoomId
        : next.currentRoomId,
    visitedRoomIds:
      next.visitedRoomIds === undefined
        ? current.visitedRoomIds
        : new Set(next.visitedRoomIds),
    selectedRoomId:
      next.selectedRoomId === undefined
        ? current.selectedRoomId
        : next.selectedRoomId,
    ariaLabel:
      next.ariaLabel === undefined
        ? current.ariaLabel
        : next.ariaLabel.trim() || "Mapa navegável da dungeon",
    onRoomSelect:
      next.onRoomSelect === undefined
        ? current.onRoomSelect
        : next.onRoomSelect,
  };
}

function assertUniqueRooms(rooms: readonly DungeonRoom[]): void {
  const ids = new Set<string>();
  for (const room of rooms) {
    if (ids.has(room.id)) {
      throw new Error(`ID de sala duplicado: ${room.id}.`);
    }
    ids.add(room.id);
  }
}

function finiteCoordinate(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("A dungeon contém uma coordenada de sala inválida.");
  }
  return value;
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  tagName: K,
): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NAMESPACE, tagName);
}
