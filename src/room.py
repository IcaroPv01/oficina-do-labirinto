import pygame
import random
from src.settings import TILE_SIZE, COLS, ROWS, WIDTH, HEIGHT, GRAY, BROWN
from src.utils import load_image
from src.enemy import Enemy
from src.pickups import Pickup
from src.sprites import SpriteRenderer, FloorCache
from src.obstacle import Spike, Destructible, Chest, Trapdoor, TintedRock
from src.registry import Registry
import tcod
import numpy as np

class Wall(pygame.sprite.Sprite):
    def __init__(self, x, y):
        super().__init__()
        self.image = load_image("wall.png", (TILE_SIZE, TILE_SIZE), GRAY, subfolder="world")
        self.rect = self.image.get_rect(topleft=(x, y))

class Door(pygame.sprite.Sprite):
    def __init__(self, x, y, direction, is_shop=False, is_treasure=False):
        super().__init__()
        self.direction = direction
        self.is_shop = is_shop
        self.is_treasure = is_treasure
        self.locked = is_treasure
        self.update_image()
        self.rect = self.image.get_rect(topleft=(x, y))

    def update_image(self):
        if self.is_treasure:
            self.image = load_image("door_treasure.png", (TILE_SIZE, TILE_SIZE), (218, 165, 32), subfolder="world")
        elif self.is_shop:
            self.image = load_image("door_shop.png", (TILE_SIZE, TILE_SIZE), (180, 150, 0), subfolder="world")
        else:
            self.image = load_image("door.png", (TILE_SIZE, TILE_SIZE), (100, 60, 20), subfolder="world")
        
        # O método copy() é necessário para não desenhar cadeado na imagem original em cache
        self.image = self.image.copy()

        if self.locked:
            pygame.draw.rect(self.image, (150, 150, 150), (TILE_SIZE//2 - 8, TILE_SIZE//2 - 6, 16, 12), border_radius=2)
            pygame.draw.circle(self.image, (150, 150, 150), (TILE_SIZE//2, TILE_SIZE//2 - 6), 6, 3)
            pygame.draw.rect(self.image, (0, 0, 0), (TILE_SIZE//2 - 2, TILE_SIZE//2 - 2, 4, 6))

class Room:
    def __init__(self, grid_x, grid_y, room_type='normal'):
        self.grid_x = grid_x
        self.grid_y = grid_y
        self.room_type = room_type # 'start', 'normal', 'boss', 'shop'
        self.walls = pygame.sprite.Group()
        self.doors = pygame.sprite.Group()
        self.enemies = pygame.sprite.Group()
        self.pickups = pygame.sprite.Group()
        self.obstacles = pygame.sprite.Group()
        self.enemy_projectiles = pygame.sprite.Group() # Grupo de projéteis inimigos (Módulo 3)
        
        self.cleared = (room_type == 'start' or room_type == 'shop')
        self.connections = {}
        self.layout_generated = False
        self.decorations = []
        self.tcod_map = None
        
    @property
    def solids(self):
        """Retorna todas as colisões físicas sólidas da sala (paredes + rochas + baús)"""
        group = pygame.sprite.Group()
        group.add(self.walls.sprites())
        solids_obs = [o for o in self.obstacles if isinstance(o, (Destructible, Chest))]
        group.add(solids_obs)
        return group

    def generate_layout(self):
        if self.layout_generated:
            return
            
        for x in range(COLS):
            for y in range(ROWS):
                if x == 0 or x == COLS - 1 or y == 0 or y == ROWS - 1:
                    is_door = False
                    if y == 0 and x == COLS // 2 and 'top' in self.connections:
                        is_door = True
                        d = Door(x * TILE_SIZE, y * TILE_SIZE, 'top', 
                                 is_shop=(self.connections['top'].room_type == 'shop'),
                                 is_treasure=(self.connections['top'].room_type == 'treasure'))
                        self.doors.add(d)
                    elif y == ROWS - 1 and x == COLS // 2 and 'bottom' in self.connections:
                        is_door = True
                        d = Door(x * TILE_SIZE, y * TILE_SIZE, 'bottom', 
                                 is_shop=(self.connections['bottom'].room_type == 'shop'),
                                 is_treasure=(self.connections['bottom'].room_type == 'treasure'))
                        self.doors.add(d)
                    elif x == 0 and y == ROWS // 2 and 'left' in self.connections:
                        is_door = True
                        d = Door(x * TILE_SIZE, y * TILE_SIZE, 'left', 
                                 is_shop=(self.connections['left'].room_type == 'shop'),
                                 is_treasure=(self.connections['left'].room_type == 'treasure'))
                        self.doors.add(d)
                    elif x == COLS - 1 and y == ROWS // 2 and 'right' in self.connections:
                        is_door = True
                        d = Door(x * TILE_SIZE, y * TILE_SIZE, 'right', 
                                 is_shop=(self.connections['right'].room_type == 'shop'),
                                 is_treasure=(self.connections['right'].room_type == 'treasure'))
                        self.doors.add(d)
                        
                    if not is_door:
                        wall = Wall(x * TILE_SIZE, y * TILE_SIZE)
                        self.walls.add(wall)
                        
        if self.room_type == 'shop':
            items_pool = ['heart', 'item_speed', 'item_damage', 'book_of_healing', 'hourglass', 'key']
            chosen = random.sample(items_pool, 3)
            spacing = 150
            start_x = (WIDTH // 2) - spacing
            for i, it in enumerate(chosen):
                p = Pickup(start_x + (spacing * i), HEIGHT // 2, it, is_shop_item=True)
                self.pickups.add(p)
                
        elif self.room_type == 'treasure':
            items_pool = ['item_speed', 'item_damage', 'book_of_healing', 'hourglass', 'item_poison', 'item_piercing']
            chosen = random.choice(items_pool)
            p = Pickup(WIDTH // 2, HEIGHT // 2, chosen)
            self.pickups.add(p)
                
        elif not self.cleared:
            pool = Registry.get_instance().get_room_pool(self.room_type)
            if pool:
                num_enemies_range = pool.get('enemies', [0, 0])
                num_rocks_range = pool.get('rocks', [0, 0])
                num_spikes_range = pool.get('spikes', [0, 0])
            else:
                num_enemies_range = [2, 4] if self.room_type == 'normal' else ([1, 1] if self.room_type == 'boss' else [0, 0])
                num_rocks_range = [2, 5] if self.room_type == 'normal' else [0, 0]
                num_spikes_range = [1, 2] if self.room_type == 'normal' else [0, 0]

            num_enemies = random.randint(num_enemies_range[0], num_enemies_range[1])
            for _ in range(num_enemies):
                ex = random.randint(TILE_SIZE * 2, WIDTH - TILE_SIZE * 3)
                ey = random.randint(TILE_SIZE * 2, HEIGHT - TILE_SIZE * 3)
                enemy = Enemy(ex, ey, is_boss=(self.room_type == 'boss'))
                self.enemies.add(enemy)
                
            safe_spots = []
            for tx in range(2, COLS - 2):
                if tx == COLS // 2: continue
                for ty in range(2, ROWS - 2):
                    if ty == ROWS // 2: continue
                    if abs(tx - COLS//2) <= 1 and abs(ty - ROWS//2) <= 1: continue
                    safe_spots.append((tx, ty))
            
            num_rocks = random.randint(num_rocks_range[0], num_rocks_range[1])
            chosen_spots = random.sample(safe_spots, min(len(safe_spots), num_rocks + 3))
            
            for _ in range(num_rocks):
                if not chosen_spots: break
                tx, ty = chosen_spots.pop()
                # 15% de chance de ser uma Rocha Especial (Tinted Rock)
                if random.random() < 0.15:
                    self.obstacles.add(TintedRock(tx * TILE_SIZE, ty * TILE_SIZE))
                else:
                    self.obstacles.add(Destructible(tx * TILE_SIZE, ty * TILE_SIZE))
            
            num_spikes = random.randint(num_spikes_range[0], num_spikes_range[1])
            for _ in range(num_spikes):
                if not chosen_spots: break
                tx, ty = chosen_spots.pop()
                self.obstacles.add(Spike(tx * TILE_SIZE, ty * TILE_SIZE))
            
            if self.room_type == 'normal':
                if random.random() < 0.25 and chosen_spots:
                    tx, ty = chosen_spots.pop()
                    self.obstacles.add(Chest(tx * TILE_SIZE, ty * TILE_SIZE))
                    
            num_decos = random.randint(5, 12)
            for _ in range(num_decos):
                dx = random.randint(TILE_SIZE, WIDTH - TILE_SIZE - 30)
                dy = random.randint(TILE_SIZE, HEIGHT - TILE_SIZE - 15)
                dtype = random.choice(['moss', 'crack'])
                self.decorations.append({'x': dx, 'y': dy, 'type': dtype})
                
        # --- GERAÇÃO DA MATRIZ TCOD (Fog of War & A*) ---
        self.tcod_map = tcod.map.Map(COLS, ROWS)
        # Por padrão tudo é caminhável e transparente
        self.tcod_map.walkable[:] = True
        self.tcod_map.transparent[:] = True
        
        # Bloqueia paredes
        for w in self.walls:
            tx = w.rect.x // TILE_SIZE
            ty = w.rect.y // TILE_SIZE
            if 0 <= tx < COLS and 0 <= ty < ROWS:
                self.tcod_map.walkable[ty, tx] = False
                self.tcod_map.transparent[ty, tx] = False
                
        # Bloqueia obstáculos sólidos
        for obs in self.solids:
            tx = obs.rect.x // TILE_SIZE
            ty = obs.rect.y // TILE_SIZE
            if 0 <= tx < COLS and 0 <= ty < ROWS:
                self.tcod_map.walkable[ty, tx] = False
                # Baús e Pedras também bloqueiam a visão para dar suspense
                self.tcod_map.transparent[ty, tx] = False
                
        self.layout_generated = True

    def update(self, dt, player, particles=None, freeze_active=False):
        # 1. Verifica se a sala foi limpa (apenas se não houver inimigos ativos)
        had_enemies = len(self.enemies) > 0
        if not self.cleared and not had_enemies:
            self.cleared = True
            if self.room_type == 'boss':
                self.obstacles.add(Trapdoor(WIDTH//2 - TILE_SIZE//2, HEIGHT//2 - TILE_SIZE//2))
            
        # 2. Atualiza inimigos se não estiver congelado (Módulo 4)
        if not freeze_active:
            self.enemies.update(dt, player, self, particles)
        
        # 3. Se a sala acabou de ser limpa, dá carga no item ativo do jogador (Módulo 4)
        if had_enemies and len(self.enemies) == 0:
            if player.active_item and player.active_charge < player.active_max_charge:
                player.active_charge += 1
        
        # 4. Atualiza projéteis inimigos (Módulo 3)
        self.enemy_projectiles.update(dt)
        
        # 5. Atualiza espinhos (Módulo 2)
        for spike in [o for o in self.obstacles if isinstance(o, Spike)]:
            spike.update(dt, player, particles)
            
        # 6. Verifica interação do baú (Módulo 2)
        for chest in [o for o in self.obstacles if isinstance(o, Chest)]:
            chest.check_interaction(player, self.pickups, particles)

    def draw(self, surface, current_floor=1):
        room_key = (self.grid_x, self.grid_y, self.room_type)
        floor = FloorCache.get_floor(WIDTH, HEIGHT, TILE_SIZE, room_key, current_floor)
        surface.blit(floor, (0, 0))
        
        if self.room_type == 'shop':
            carpet_rect = pygame.Rect(WIDTH//2 - 200, HEIGHT//2 - 80, 400, 160)
            pygame.draw.rect(surface, (80, 20, 20), carpet_rect)
            pygame.draw.rect(surface, (120, 40, 40), carpet_rect, 3)
            inner = carpet_rect.inflate(-8, -8)
            pygame.draw.rect(surface, (180, 150, 0), inner, 2)
            
        for deco in self.decorations:
            SpriteRenderer.draw_decoration(surface, deco['x'], deco['y'], deco['type'])
        
        self.doors.draw(surface)
        self.walls.draw(surface)
        self.obstacles.draw(surface)
        
        for enemy in self.enemies:
            SpriteRenderer.draw_shadow(surface, enemy.rect)
            
        self.enemies.draw(surface)
        self.pickups.draw(surface)
        self.enemy_projectiles.draw(surface) # Desenha projéteis inimigos (Módulo 3)
        
        if self.room_type == 'shop':
            font = pygame.font.SysFont(None, 24)
            for p in self.pickups:
                text = font.render(f"${p.price}", True, (255, 215, 0))
                surface.blit(text, (p.rect.centerx - text.get_width()//2, p.rect.bottom + 5))
