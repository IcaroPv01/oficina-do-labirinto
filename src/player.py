import pygame
import os
from src.settings import BLUE, RED, MODS_DIR, ACTIVE_MOD
from src.projectile import Projectile
from src.utils import load_image
from src.audio import AudioEngine

class Player(pygame.sprite.Sprite):
    def __init__(self, x, y):
        super().__init__()
        
        # Atributos Avançados (Stats no estilo Isaac)
        self.max_health = 6 # 6 = 3 corações completos
        self.health = self.max_health
        self.speed = 250
        self.damage = 2.0
        self.tear_delay = 0.4
        self.coins = 0
        self.keys = 0
        
        # Novos Status Avançados (Módulo 4)
        self.range_limit = 450 # Alcance máximo do tiro em pixels
        self.shot_speed = 600  # Velocidade do projétil
        
        self.is_poisonous = False
        self.is_piercing = False
        self.invincible = 0
        
        # Slots do Item Ativo (Módulo 4)
        self.active_item = None
        self.active_charge = 0
        self.active_max_charge = 3
        
        # Posição e Físicas
        self.image = pygame.Surface((44, 60), pygame.SRCALPHA)
        self.rect = pygame.Rect(0, 0, 24, 24)
        self.rect.center = (x, y)
        self.pos = pygame.math.Vector2(self.rect.topleft)
        self.velocity = pygame.math.Vector2(0, 0)
        
        self.shoot_timer = 0
        self.projectiles = pygame.sprite.Group()
        
        # Lógica de Direção e Animação
        self.facing_body = 'down' # down, side, up
        self.facing_head = 'down' # down, left, up, right
        self.flip_body = False
        
        self.walk_frame = 0
        self.walk_timer = 0.0
        self.is_moving = False
        
        # Dicionário de Costumes Equipados (Módulo 1)
        self.costumes = {}
        
        # Carregamento Inteligente de Sprites
        self.load_spritesheet_frames()
            
        # Imagem combinada
        self.render_combined_sprite()

    def equip_costume(self, name):
        """Equipa um costume visual no jogador (Módulo 1)"""
        base_path = os.path.join(MODS_DIR, ACTIVE_MOD, "player")
        if not os.path.exists(base_path) and ACTIVE_MOD != "default":
            base_path = os.path.join(MODS_DIR, "default", "player")
            
        path = os.path.join(base_path, f"costume_{name}.png")
        if os.path.exists(path):
            try:
                img = pygame.image.load(path).convert_alpha()
                self.costumes[name] = img
            except Exception as e:
                print(f"Erro ao carregar costume {name}: {e}")
                self.costumes[name] = "procedural"
        else:
            self.costumes[name] = "procedural"

    def load_spritesheet_frames(self):
        base_path = os.path.join(MODS_DIR, ACTIVE_MOD, "player")
        if not os.path.exists(base_path) and ACTIVE_MOD != "default":
            base_path = os.path.join(MODS_DIR, "default", "player")
            
        sheet_path = os.path.join(base_path, "player_spritesheet.png")
        head_path = os.path.join(base_path, "player_head.png")
        body_path = os.path.join(base_path, "player_body.png")
        
        # 1. Tenta carregar o Spritesheet Unificado (512x512)
        if os.path.exists(sheet_path):
            try:
                sheet = pygame.image.load(sheet_path).convert_alpha()
                
                def get_head(x, y):
                    surf = pygame.Surface((32, 32), pygame.SRCALPHA)
                    surf.blit(sheet, (0, 0), (x, y, 32, 32))
                    return pygame.transform.scale(surf, (44, 44))
                    
                self.heads = {
                    'down': get_head(0, 0),
                    'right': get_head(0, 32),
                    'up': get_head(0, 64),
                    'left': get_head(0, 96)
                }
                
                def get_body_frames(row_y):
                    frames = []
                    for i in range(8):
                        surf = pygame.Surface((32, 32), pygame.SRCALPHA)
                        surf.blit(sheet, (0, 0), (i * 32, row_y, 32, 32))
                        frames.append(pygame.transform.scale(surf, (36, 36)))
                    return frames
                    
                self.bodies = {
                    'down': get_body_frames(128),
                    'side': get_body_frames(160),
                    'up': get_body_frames(128)
                }
                self.use_spritesheet = True
                return
            except Exception as e:
                print(f"Erro ao carregar spritesheet unificado: {e}")

        # 2. Tenta carregar Cabeça/Corpo separados (podendo ser folhas compactas ou estáticos)
        if os.path.exists(head_path) and os.path.exists(body_path):
            try:
                head_img = pygame.image.load(head_path).convert_alpha()
                body_img = pygame.image.load(body_path).convert_alpha()
                
                h_w, h_h = head_img.get_size()
                b_w, b_h = body_img.get_size()
                
                # Cabeça compacta (ex: 192x32 contendo 6 frames) ou estática (32x32)
                if h_w >= 128:
                    def get_head_sep(x):
                        surf = pygame.Surface((32, 32), pygame.SRCALPHA)
                        surf.blit(head_img, (0, 0), (x, 0, 32, 32))
                        return pygame.transform.scale(surf, (44, 44))
                    self.heads = {
                        'down': get_head_sep(0),
                        'right': get_head_sep(32),
                        'up': get_head_sep(64),
                        'left': get_head_sep(96)
                    }
                else:
                    scaled_head = pygame.transform.scale(head_img, (44, 44))
                    self.heads = {
                        'down': scaled_head,
                        'right': scaled_head,
                        'up': scaled_head,
                        'left': scaled_head
                    }
                    
                # Corpo compacto (ex: 256x128 contendo as animações) ou estático
                if b_w >= 128:
                    def get_body_sep(row_y):
                        frames = []
                        for i in range(8):
                            surf = pygame.Surface((32, 32), pygame.SRCALPHA)
                            # Se a imagem tiver menos frames, trata isso
                            if i * 32 < b_w:
                                surf.blit(body_img, (0, 0), (i * 32, row_y, 32, 32))
                            frames.append(pygame.transform.scale(surf, (36, 36)))
                        return frames
                    self.bodies = {
                        'down': get_body_sep(0) if b_h >= 32 else [scaled_body]*8,
                        'side': get_body_sep(32) if b_h >= 64 else [scaled_body]*8, # Linha 1 = Andar para a direita
                        'up': get_body_sep(0) if b_h >= 32 else [scaled_body]*8     # Mesma de down
                    }
                else:
                    scaled_body = pygame.transform.scale(body_img, (36, 36))
                    self.bodies = {
                        'down': [scaled_body] * 8,
                        'side': [scaled_body] * 8,
                        'up': [scaled_body] * 8
                    }
                self.use_spritesheet = True
                return
            except Exception as e:
                print(f"Erro ao carregar cabeças/corpos separados: {e}")
                
        # 3. Fallback completo para retângulos coloridos básicos
        self.use_spritesheet = False
        self.image_body = load_image("player_body.png", (36, 36), (0, 0, 150), subfolder="player")
        self.image_head = load_image("player_head.png", (44, 44), (50, 100, 255), subfolder="player")

    def update(self, dt, walls):
        self.shoot_timer -= dt
        if self.invincible > 0: self.invincible -= dt
        keys = pygame.key.get_pressed()
        
        # Movimento WASD (Controla a animação do Corpo)
        self.velocity = pygame.math.Vector2(0, 0)
        self.is_moving = False
        
        if keys[pygame.K_w]:
            self.velocity.y = -1
            self.facing_body = 'up'
            self.is_moving = True
            self.flip_body = False
        if keys[pygame.K_s]:
            self.velocity.y = 1
            self.facing_body = 'down'
            self.is_moving = True
            self.flip_body = False
        if keys[pygame.K_a]:
            self.velocity.x = -1
            self.facing_body = 'side'
            self.is_moving = True
            self.flip_body = True # Espelha a animação lateral para andar à esquerda
        if keys[pygame.K_d]:
            self.velocity.x = 1
            self.facing_body = 'side'
            self.is_moving = True
            self.flip_body = False
            
        if self.velocity.length() > 0:
            self.velocity = self.velocity.normalize()
            
        # Atualiza a animação de caminhada se estiver se movendo
        if self.is_moving:
            self.walk_timer += dt
            if self.walk_timer >= 0.08: # Velocidade do passo
                self.walk_frame = (self.walk_frame + 1) % 8
                self.walk_timer = 0
        else:
            self.walk_frame = 0 # Sprite parado (geralmente frame 0)
            
        # Físicas e Colisões
        self.pos.x += self.velocity.x * self.speed * dt
        self.rect.x = round(self.pos.x)
        self.collide_with_walls(walls, self.velocity, 'x')
        
        self.pos.y += self.velocity.y * self.speed * dt
        self.rect.y = round(self.pos.y)
        self.collide_with_walls(walls, self.velocity, 'y')
        
        # Tiros Setas (Controla a animação da Cabeça independentemente)
        shoot_dir = pygame.math.Vector2(0, 0)
        is_shooting = False
        
        if keys[pygame.K_UP]:
            shoot_dir.y = -1
            self.facing_head = 'up'
            is_shooting = True
        elif keys[pygame.K_DOWN]:
            shoot_dir.y = 1
            self.facing_head = 'down'
            is_shooting = True
        elif keys[pygame.K_LEFT]:
            shoot_dir.x = -1
            self.facing_head = 'left'
            is_shooting = True
        elif keys[pygame.K_RIGHT]:
            shoot_dir.x = 1
            self.facing_head = 'right'
            is_shooting = True
            
        # Se não estiver atirando, a cabeça olha pra onde o corpo está andando
        if not is_shooting and self.is_moving:
            if self.facing_body == 'side':
                self.facing_head = 'left' if self.flip_body else 'right'
            else:
                self.facing_head = self.facing_body
            
        if shoot_dir.length() > 0 and self.shoot_timer <= 0:
            self.shoot(shoot_dir)
            
        self.render_combined_sprite()

    def render_combined_sprite(self):
        self.image.fill((0, 0, 0, 0)) # Limpa a textura com Alpha(0)
        
        # Obter frames atuais
        if self.use_spritesheet:
            # Seleciona o frame correto do corpo
            body_frame = self.bodies[self.facing_body][self.walk_frame].copy()
            
            # Aplica costume visual de botas no corpo se equipado (Módulo 1)
            if 'boots' in self.costumes:
                if self.costumes['boots'] == "procedural":
                    # Desenha solas douradas na parte inferior do corpo
                    pygame.draw.rect(body_frame, (255, 215, 0), (6, 30, 8, 3))
                    pygame.draw.rect(body_frame, (255, 215, 0), (22, 30, 8, 3))
                else:
                    scaled_boots = pygame.transform.scale(self.costumes['boots'], (36, 36))
                    body_frame.blit(scaled_boots, (0, 0))
                    
            if self.flip_body:
                body_frame = pygame.transform.flip(body_frame, True, False)
                
            head_frame = self.heads[self.facing_head]
        else:
            body_frame = self.image_body.copy()
            if 'boots' in self.costumes and self.costumes['boots'] == "procedural":
                pygame.draw.rect(body_frame, (255, 215, 0), (6, 30, 8, 3))
                pygame.draw.rect(body_frame, (255, 215, 0), (22, 30, 8, 3))
            head_frame = self.image_head
            
        # Offset visual da cabeça
        hx = -2 if self.facing_head == 'left' else 2 if self.facing_head == 'right' else 0
        hy = -1 if self.facing_head == 'up' else 0
        
        bounce = -2 if (self.is_moving and self.walk_frame in [1, 2, 5, 6]) else 0
            
        self.image.blit(body_frame, (4, 18)) 
        self.image.blit(head_frame, (hx, hy + bounce)) 
        
        # Aplica costume visual de espada se equipado (Módulo 1)
        if 'sword' in self.costumes:
            if self.costumes['sword'] == "procedural":
                pygame.draw.rect(self.image, (139, 69, 19), (34, 28, 2, 8))
                pygame.draw.rect(self.image, (192, 192, 192), (32, 28, 6, 2))
                pygame.draw.rect(self.image, (220, 220, 230), (34, 12, 2, 16))
            else:
                scaled_sword = pygame.transform.scale(self.costumes['sword'], (44, 44))
                self.image.blit(scaled_sword, (0, 0))

    def shoot(self, direction):
        proj = Projectile(self.rect.centerx, self.rect.centery, direction.x, direction.y, self.shot_speed, self.range_limit, self.is_poisonous, self.is_piercing)
        proj.damage = self.damage
        proj.speed = self.shot_speed
        proj.range_limit = self.range_limit
        self.projectiles.add(proj)
        AudioEngine.get_instance().play('shoot')
        self.shoot_timer = self.tear_delay

    def collide_with_walls(self, walls, velocity, direction_axis):
        for wall in walls:
            if self.rect.colliderect(wall.rect):
                if direction_axis == 'x':
                    if velocity.x > 0:
                        self.rect.right = wall.rect.left
                    elif velocity.x < 0:
                        self.rect.left = wall.rect.right
                    self.pos.x = self.rect.x
                elif direction_axis == 'y':
                    if velocity.y > 0:
                        self.rect.bottom = wall.rect.top
                    elif velocity.y < 0:
                        self.rect.top = wall.rect.bottom
                    self.pos.y = self.rect.y

    def take_damage(self, amount):
        if self.invincible <= 0:
            self.health -= amount
            self.invincible = 1.0 # 1 segundo de i-frames
            AudioEngine.get_instance().play('hurt')
        self.health = max(0, min(self.health, self.max_health))

    def heal(self, amount):
        self.health += amount
        self.health = max(0, min(self.health, self.max_health))
