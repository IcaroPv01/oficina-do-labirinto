import pygame
import random
import math
from src.settings import ENEMY_SPEED
from src.enemy_projectile import EnemyProjectile
from src.utils import load_image
from src.pickups import Pickup
from src.audio import AudioEngine
from src.registry import Registry
import tcod
from src.settings import TILE_SIZE, ENEMY_SPEED

class Enemy(pygame.sprite.Sprite):
    def __init__(self, x, y, is_boss=False, enemy_type=None):
        super().__init__()
        self.is_boss = is_boss
        self.float_timer = random.uniform(0, math.pi * 2)
        
        reg = Registry.get_instance()
        
        if enemy_type is None:
            if self.is_boss:
                candidates = [k for k, v in reg.enemies.items() if v.get('is_boss', False)]
                if not candidates:
                    candidates = ['demon', 'necromancer', 'slime_king']
            else:
                candidates = [k for k, v in reg.enemies.items() if not v.get('is_boss', False)]
                if not candidates:
                    candidates = ['fly', 'archer', 'knight']
            self.enemy_type = random.choice(candidates)
        else:
            self.enemy_type = enemy_type
            
        enemy_data = reg.get_enemy(self.enemy_type) or {}
        
        self.size = enemy_data.get('size', 48)
        self.health = enemy_data.get('health', 3)
        self.max_health = self.health
        self.damage = enemy_data.get('damage', 1)
        self.speed = enemy_data.get('speed', ENEMY_SPEED)
        if 'is_boss' in enemy_data:
            self.is_boss = enemy_data['is_boss']
            
        if self.is_boss:
            self.action_timer = 2.0
            self.charge_state = 'patrol'
            self.charge_timer = 0.0
            self.charge_dir = pygame.math.Vector2(0, 0)
        else:
            self.shoot_timer = random.uniform(1.0, 2.0)
            self.charge_state = 'patrol'
            self.charge_timer = 0.0
            self.charge_dir = pygame.math.Vector2(0, 0)
            
        # Status Effects
        self.poison_timer = 0.0
        self.poison_tick_timer = 0.0
            
        self.image = pygame.Surface((self.size, self.size), pygame.SRCALPHA)
        self.rect = self.image.get_rect(topleft=(x, y))
        self.pos = pygame.math.Vector2(self.rect.topleft)
        self.render_sprite()

    def render_sprite(self):
        self.image.fill((0, 0, 0, 0))
        cx = self.size // 2
        cy = self.size // 2
        
        # Carrega a sprite real ao invés de usar renderização procedural
        if self.is_boss:
            if self.enemy_type == 'slime_king':
                img = pygame.Surface((self.size, self.size), pygame.SRCALPHA)
                pygame.draw.circle(img, (50, 200, 50, 200), (self.size//2, self.size//2), self.size//2)
                pygame.draw.circle(img, (0, 0, 0), (self.size//3, self.size//3), 10)
                pygame.draw.circle(img, (0, 0, 0), (self.size - self.size//3, self.size//3), 10)
            else:
                img = load_image("boss.png", (self.size, self.size), (200, 0, 0), subfolder="enemies")
        else:
            if getattr(self, 'enemy_type', '') == 'slime_small':
                img = pygame.Surface((self.size, self.size), pygame.SRCALPHA)
                pygame.draw.circle(img, (50, 200, 50, 200), (self.size//2, self.size//2), self.size//2)
                pygame.draw.circle(img, (0, 0, 0), (self.size//3, self.size//3), 4)
                pygame.draw.circle(img, (0, 0, 0), (self.size - self.size//3, self.size//3), 4)
            else:
                img = load_image("enemy.png", (self.size, self.size), (150, 0, 0), subfolder="enemies")
            
        if self.poison_timer > 0:
            # Pinta o inimigo de verde se envenenado
            img = img.copy()
            tint = pygame.Surface((self.size, self.size))
            tint.fill((100, 255, 100))
            img.blit(tint, (0, 0), special_flags=pygame.BLEND_RGB_MULT)
            
        self.image.blit(img, (0, 0))
        self.draw_health_bar(cx, cy)

    def draw_health_bar(self, cx, cy):
        if self.health < self.max_health:
            bar_w = self.size
            bar_h = 4
            bar_x = cx - bar_w // 2
            bar_y = cy - self.size // 2 - 8
            pygame.draw.rect(self.image, (60, 0, 0), (bar_x, bar_y, bar_w, bar_h))
            health_w = int(bar_w * (self.health / self.max_health))
            pygame.draw.rect(self.image, (0, 255, 0), (bar_x, bar_y, health_w, bar_h))

    def update(self, dt, player, room, particles=None):
        self.float_timer += dt * 4
        
        # Inimigos voadores ignoram pedras/baús e colidem apenas com paredes
        if self.enemy_type in ['fly', 'demon', 'necromancer']:
            walls = room.walls
        else:
            walls = room.solids
        
        # Efeito de veneno (Damage over time)
        if self.poison_timer > 0:
            self.poison_timer -= dt
            self.poison_tick_timer -= dt
            if self.poison_tick_timer <= 0:
                self.take_damage(0.5)
                self.poison_tick_timer = 0.5
                if particles:
                    particles.add_explosion(self.rect.centerx, self.rect.top, (50, 200, 50), 3)
        
        if not player or player.health <= 0:
            return

        target_vec = pygame.math.Vector2(player.rect.center)
        my_vec = pygame.math.Vector2(self.rect.center)
        direction = target_vec - my_vec
        dist = direction.length()
        
        # --- PATHFINDING A* DA LIBTCOD ---
        if hasattr(room, 'tcod_map') and room.tcod_map:
            mx, my = self.rect.centerx // TILE_SIZE, self.rect.centery // TILE_SIZE
            px, py = player.rect.centerx // TILE_SIZE, player.rect.centery // TILE_SIZE
            
            # Voadores ignoram baús e pedras (podem atravessar poços)
            cost_map = room.tcod_map.walkable if self.enemy_type not in ['fly', 'demon', 'necromancer'] else room.tcod_map.transparent
            
            # Se for diferente para voadores, teríamos que recriar o mapa, 
            # mas para simplificar usaremos a mesma malha walkable.
            pathfinder = tcod.path.AStar(room.tcod_map)
            path = pathfinder.get_path(mx, my, px, py)
            
            if path and len(path) > 0:
                next_x, next_y = path[0]
                # Segue até o centro do próximo tile do caminho
                t_px = next_x * TILE_SIZE + TILE_SIZE // 2
                t_py = next_y * TILE_SIZE + TILE_SIZE // 2
                direction = pygame.math.Vector2(t_px, t_py) - my_vec

        if direction.length() > 0:
            direction = direction.normalize()

        # Lógica de Inteligência Artificial conforme o tipo
        if self.enemy_type == 'fly':
            # Segue diretamente
            self.move_towards(direction, self.speed, dt, walls)
            
        elif self.enemy_type == 'archer':
            # Mantém distância (Kiting)
            self.shoot_timer -= dt
            if dist > 260:
                self.move_towards(direction, self.speed, dt, walls)
            elif dist < 180:
                # Foge do player
                self.move_towards(-direction, self.speed * 1.2, dt, walls)
            
            # Atira
            if self.shoot_timer <= 0 and dist < 450:
                self.shoot_projectile(direction, room)
                self.shoot_timer = 1.8
                
        elif self.enemy_type == 'knight':
            # Lógica de Investida
            if self.charge_state == 'patrol':
                # Anda devagar perseguindo o player
                self.move_towards(direction, self.speed, dt, walls)
                # Se alinhado ou próximo, engaja a investida
                dx = abs(player.rect.centerx - self.rect.centerx)
                dy = abs(player.rect.centery - self.rect.centery)
                if (dx < 32 or dy < 32) and dist < 280:
                    self.charge_state = 'charge'
                    self.charge_timer = 0.8 # dura 0.8s
                    self.charge_dir = direction
            elif self.charge_state == 'charge':
                # Investida rápida sem alterar direção
                self.move_towards(self.charge_dir, self.speed * 3.5, dt, walls)
                self.charge_timer -= dt
                if self.charge_timer <= 0:
                    self.charge_state = 'cooldown'
                    self.charge_timer = 1.2 # descansa por 1.2s
            elif self.charge_state == 'cooldown':
                self.charge_timer -= dt
                if self.charge_timer <= 0:
                    self.charge_state = 'patrol'
                    
        elif self.enemy_type == 'demon':
            # Boss demônio normal
            self.move_towards(direction, self.speed, dt, walls)
            self.action_timer -= dt
            if self.action_timer <= 0:
                # Dispara circular curto
                self.shoot_circular(room, count=6)
                self.action_timer = 2.5
                
        elif self.enemy_type == 'necromancer':
            # Boss Necromante
            self.move_towards(direction, self.speed, dt, walls)
            self.action_timer -= dt
            if self.action_timer <= 0:
                action = random.choice(['summon', 'shoot'])
                if action == 'summon':
                    self.summon_minions(room)
                else:
                    self.shoot_circular(room, count=10)
                self.action_timer = 3.2
                
        elif self.enemy_type == 'slime_king':
            self.action_timer -= dt
            if self.action_timer <= 0:
                self.charge_state = 'jump'
                self.charge_timer = 0.5
                self.charge_dir = direction
                self.action_timer = 2.5
            
            if getattr(self, 'charge_state', 'patrol') == 'jump':
                self.move_towards(self.charge_dir, self.speed * 4, dt, walls)
                self.charge_timer -= dt
                if self.charge_timer <= 0:
                    self.charge_state = 'patrol'
                    self.shoot_circular(room, count=8)
            else:
                self.move_towards(direction, self.speed * 0.5, dt, walls)
                
        elif getattr(self, 'enemy_type', '') == 'slime_small':
            self.move_towards(direction, self.speed, dt, walls)

        self.render_sprite()

    def move_towards(self, vec_dir, speed, dt, walls):
        if vec_dir.length_squared() > 0:
            vec_dir = vec_dir.normalize()
            
        # Movimento X
        self.pos.x += vec_dir.x * speed * dt
        self.rect.x = round(self.pos.x)
        self.collide_with_walls(walls, 'x')
        
        # Movimento Y (com flutuação senoidal)
        float_offset = math.sin(self.float_timer) * 1.5 if self.enemy_type == 'fly' else 0
        self.pos.y += vec_dir.y * speed * dt
        self.rect.y = round(self.pos.y + float_offset)
        self.collide_with_walls(walls, 'y')

    def shoot_projectile(self, direction, room):
        # Cria projétil inimigo
        proj = EnemyProjectile(self.rect.centerx, self.rect.centery, direction.x, direction.y)
        room.enemy_projectiles.add(proj)

    def shoot_circular(self, room, count=8):
        # Dispara rajada circular de tiros
        for i in range(count):
            angle = (i * 2 * math.pi) / count
            dx = math.cos(angle)
            dy = math.sin(angle)
            proj = EnemyProjectile(self.rect.centerx, self.rect.centery, dx, dy, speed=280)
            room.enemy_projectiles.add(proj)

    def summon_minions(self, room):
        # Necromante invoca moscas perto dele
        for i in range(2):
            ox = random.choice([-50, 50])
            oy = random.choice([-50, 50])
            minion = Enemy(self.rect.centerx + ox, self.rect.centery + oy, is_boss=False, enemy_type='fly')
            room.enemies.add(minion)

    def collide_with_walls(self, walls, direction_axis):
        for wall in walls:
            if self.rect.colliderect(wall.rect):
                if direction_axis == 'x':
                    if self.pos.x < wall.rect.left and self.rect.right > wall.rect.left:
                        self.rect.right = wall.rect.left
                    elif self.pos.x > wall.rect.right and self.rect.left < wall.rect.right:
                        self.rect.left = wall.rect.right
                    self.pos.x = self.rect.x
                elif direction_axis == 'y':
                    if self.pos.y < wall.rect.top and self.rect.bottom > wall.rect.top:
                        self.rect.bottom = wall.rect.top
                    elif self.pos.y > wall.rect.bottom and self.rect.top < wall.rect.bottom:
                        self.rect.top = wall.rect.bottom
                    self.pos.y = self.rect.y
                    
    def take_damage(self, amount, room=None):
        self.health = max(0, self.health - amount)
        AudioEngine.get_instance().play('hit')
        if self.health <= 0:
            if self.enemy_type == 'slime_king' and room is not None:
                for i in range(3):
                    ox = random.choice([-50, 0, 50])
                    oy = random.choice([-50, 0, 50])
                    slime = Enemy(self.rect.centerx + ox, self.rect.centery + oy, is_boss=False, enemy_type='slime_small')
                    room.enemies.add(slime)
            self.kill()

    def roll_drops(self):
        if self.is_boss:
            # Dropa o item ativo ou coração ao ser derrotado!
            drop_type = random.choice(['book_of_healing', 'hourglass', 'heart'])
            return Pickup(self.rect.centerx, self.rect.centery, drop_type)
        elif random.random() < 0.35:
            # Chance de dropar moedas ou chaves
            drop_type = 'key' if random.random() < 0.3 else 'coin'
            return Pickup(self.rect.centerx, self.rect.centery, drop_type)
        return None
