import pygame
import math
import random

class ParticleSystem:
    """Sistema de partículas inspirado no binding-of-pysaac (sprites.py)"""
    def __init__(self):
        self.particles = []
    
    def add_explosion(self, x, y, color, count=10):
        for _ in range(count):
            angle = random.uniform(0, 2 * math.pi)
            speed = random.uniform(50, 150)
            lifetime = random.uniform(0.3, 1.0)
            self.particles.append({
                'x': x, 'y': y,
                'vx': math.cos(angle) * speed,
                'vy': math.sin(angle) * speed,
                'color': color,
                'lifetime': lifetime,
                'max_lifetime': lifetime,
                'size': random.randint(2, 5)
            })

    def add_blood(self, x, y, count=6):
        self.add_explosion(x, y, (180, 20, 20), count)

    def add_coin_sparkle(self, x, y):
        self.add_explosion(x, y, (255, 215, 0), 4)

    def add_heal(self, x, y):
        for _ in range(8):
            angle = random.uniform(0, 2 * math.pi)
            speed = random.uniform(20, 60)
            self.particles.append({
                'x': x, 'y': y,
                'vx': math.cos(angle) * speed,
                'vy': -abs(math.sin(angle) * speed) - 30, # sobe
                'color': (50, 255, 50),
                'lifetime': 0.8,
                'max_lifetime': 0.8,
                'size': random.randint(2, 4)
            })

    def update(self, dt):
        alive_particles = []
        for p in self.particles:
            p['x'] += p['vx'] * dt
            p['y'] += p['vy'] * dt
            # Smooth friction for particles
            p['vx'] *= max(0.0, 1.0 - 4.0 * dt)
            p['vy'] *= max(0.0, 1.0 - 4.0 * dt)
            p['lifetime'] -= dt
            if p['lifetime'] > 0:
                alive_particles.append(p)
        self.particles = alive_particles
    
    def draw(self, screen):
        for p in self.particles:
            ratio = max(0, p['lifetime'] / p['max_lifetime'])
            size = max(1, int(p['size'] * ratio))
            alpha_color = tuple(int(c * ratio) for c in p['color'])
            pygame.draw.circle(screen, alpha_color, (int(p['x']), int(p['y'])), size)


class DamageNumber:
    """Números de dano flutuantes (inspirado no pysaac sprites.py)"""
    def __init__(self, x, y, amount, color=(255, 0, 0)):
        self.x = x
        self.y = y
        self.amount = amount
        self.color = color
        self.lifetime = 0.8
        self.max_lifetime = 0.8
        self.vy = -60 # sobe
    
    def update(self, dt):
        self.y += self.vy * dt
        self.lifetime -= dt
        return self.lifetime > 0
    
    def draw(self, screen, font):
        if self.lifetime > 0:
            ratio = self.lifetime / self.max_lifetime
            text = font.render(f"-{self.amount:.0f}", True, self.color)
            text.set_alpha(int(255 * ratio))
            screen.blit(text, (self.x, self.y))


class SpriteRenderer:
    """
    Renderizador procedural de sprites - inspirado diretamente em 
    binding-of-pysaac/sprites.py (SpriteRenderer class).
    Gera visuais estilo Isaac sem necessidade de PNGs externos.
    """
    
    @staticmethod
    def draw_isaac_body(surface, x, y, size, color=(220, 185, 140)):
        """Desenha um corpo estilo Isaac (elipse bege com contorno)"""
        body_rect = pygame.Rect(x - size//2, y - size//2, size, size)
        pygame.draw.ellipse(surface, color, body_rect)
        darker = tuple(max(0, c - 40) for c in color)
        pygame.draw.ellipse(surface, darker, body_rect, 2)
    
    @staticmethod
    def draw_isaac_head(surface, x, y, size, direction='down', color=(220, 185, 140)):
        """Desenha uma cabeça estilo Isaac (círculo com olhos)"""
        # Cabeça
        pygame.draw.circle(surface, color, (x, y), size)
        darker = tuple(max(0, c - 40) for c in color)
        pygame.draw.circle(surface, darker, (x, y), size, 2)
        
        # Olhos
        eye_size = max(2, size // 4)
        eye_offset = size // 3
        
        # Posição dos olhos muda com a direção
        if direction == 'down':
            lex, ley = x - eye_offset, y
            rex, rey = x + eye_offset, y
        elif direction == 'up':
            lex, ley = x - eye_offset, y - eye_offset//2
            rex, rey = x + eye_offset, y - eye_offset//2
        elif direction == 'left':
            lex, ley = x - eye_offset, y
            rex, rey = x, y
        elif direction == 'right':
            lex, ley = x, y
            rex, rey = x + eye_offset, y
        else:
            lex, ley = x - eye_offset, y
            rex, rey = x + eye_offset, y
        
        # Branco dos olhos
        pygame.draw.circle(surface, (255, 255, 255), (lex, ley), eye_size)
        pygame.draw.circle(surface, (255, 255, 255), (rex, rey), eye_size)
        # Pupilas
        pupil_size = max(1, eye_size // 2)
        pygame.draw.circle(surface, (0, 0, 0), (lex, ley), pupil_size)
        pygame.draw.circle(surface, (0, 0, 0), (rex, rey), pupil_size)
    
    @staticmethod
    def draw_enemy_fly(surface, x, y, size, health, max_health):
        """Desenha uma mosca inimiga (estilo Isaac)"""
        # Corpo
        body_rect = pygame.Rect(x - size//2, y - size//2, size, size)
        pygame.draw.ellipse(surface, (80, 60, 60), body_rect)
        pygame.draw.ellipse(surface, (40, 30, 30), body_rect, 2)
        
        # Asas
        wing_size = size // 3
        pygame.draw.ellipse(surface, (150, 150, 150, 100), 
                          (x - size//2 - wing_size, y - size//4, wing_size * 2, size // 2))
        pygame.draw.ellipse(surface, (150, 150, 150, 100), 
                          (x + size//4, y - size//4, wing_size * 2, size // 2))
        
        # Olhos vermelhos
        eye_size = max(2, size // 6)
        pygame.draw.circle(surface, (255, 0, 0), (x - size//4, y - size//6), eye_size)
        pygame.draw.circle(surface, (255, 0, 0), (x + size//4, y - size//6), eye_size)
        
        # Barra de vida se tomou dano
        if health < max_health:
            bar_w = size
            bar_h = 4
            bar_x = x - bar_w // 2
            bar_y = y - size // 2 - 8
            pygame.draw.rect(surface, (60, 0, 0), (bar_x, bar_y, bar_w, bar_h))
            health_w = int(bar_w * (health / max_health))
            pygame.draw.rect(surface, (255, 0, 0), (bar_x, bar_y, health_w, bar_h))
    
    @staticmethod
    def draw_boss(surface, x, y, size, health, max_health):
        """Desenha um boss estilo Isaac (grande, com chifres)"""
        # Corpo grande
        body_rect = pygame.Rect(x - size//2, y - size//2, size, size)
        pygame.draw.ellipse(surface, (120, 40, 40), body_rect)
        pygame.draw.ellipse(surface, (80, 20, 20), body_rect, 3)
        
        # Chifres
        horn_h = size // 3
        pygame.draw.polygon(surface, (80, 60, 40), [
            (x - size//3, y - size//2),
            (x - size//4, y - size//2 - horn_h),
            (x - size//6, y - size//2),
        ])
        pygame.draw.polygon(surface, (80, 60, 40), [
            (x + size//6, y - size//2),
            (x + size//4, y - size//2 - horn_h),
            (x + size//3, y - size//2),
        ])
        
        # Olhos amarelos grandes
        eye_size = max(3, size // 6)
        eye_y = y - size // 8
        pygame.draw.circle(surface, (255, 200, 0), (x - size//4, eye_y), eye_size)
        pygame.draw.circle(surface, (0, 0, 0), (x - size//4, eye_y), eye_size // 2)
        pygame.draw.circle(surface, (255, 200, 0), (x + size//4, eye_y), eye_size)
        pygame.draw.circle(surface, (0, 0, 0), (x + size//4, eye_y), eye_size // 2)
        
        # Boca
        pygame.draw.arc(surface, (40, 0, 0), 
                       (x - size//4, y + size//8, size//2, size//4),
                       math.pi, 2 * math.pi, 2)
        
        # Barra de vida
        bar_w = size
        bar_h = 6
        bar_x = x - bar_w // 2
        bar_y = y - size // 2 - 12
        pygame.draw.rect(surface, (60, 0, 0), (bar_x, bar_y, bar_w, bar_h))
        health_w = int(bar_w * (health / max_health))
        pygame.draw.rect(surface, (255, 50, 50), (bar_x, bar_y, health_w, bar_h))
    
    @staticmethod
    def draw_tear(surface, x, y, size=8):
        """Desenha uma lágrima/projétil estilo Isaac"""
        pygame.draw.circle(surface, (100, 150, 255), (x, y), size)
        pygame.draw.circle(surface, (150, 200, 255), (x, y), size, 2)
        # Brilho
        pygame.draw.circle(surface, (200, 220, 255), (x - size//3, y - size//3), size // 3)
    
    @staticmethod
    def draw_heart(surface, x, y, size=12):
        """Desenha um coração de vida"""
        # Duas elipses superiores
        pygame.draw.circle(surface, (220, 20, 20), (x - size//3, y - size//4), size // 2)
        pygame.draw.circle(surface, (220, 20, 20), (x + size//3, y - size//4), size // 2)
        # Triângulo inferior
        pygame.draw.polygon(surface, (220, 20, 20), [
            (x - size//2 - size//4, y - size//6),
            (x + size//2 + size//4, y - size//6),
            (x, y + size//2 + size//4)
        ])
        # Brilho
        pygame.draw.circle(surface, (255, 100, 100), (x - size//4, y - size//3), size // 4)

    @staticmethod
    def draw_coin(surface, x, y, size=10):
        """Desenha uma moeda dourada"""
        pygame.draw.circle(surface, (255, 215, 0), (x, y), size)
        pygame.draw.circle(surface, (200, 170, 0), (x, y), size, 2)
        # Símbolo $
        font = pygame.font.SysFont(None, int(size * 1.5))
        text = font.render("$", True, (180, 140, 0))
        surface.blit(text, (x - text.get_width()//2, y - text.get_height()//2))
    
    @staticmethod
    def draw_floor_tile(surface, x, y, tile_size, seed=0):
        """Desenha um tile de chão com variação procedural"""
        random.seed(seed)
        # Base
        base_r = 50 + random.randint(-5, 5)
        base_g = 42 + random.randint(-5, 5)
        base_b = 35 + random.randint(-3, 3)
        rect = pygame.Rect(x, y, tile_size, tile_size)
        pygame.draw.rect(surface, (base_r, base_g, base_b), rect)
        
        # Linhas de pedra sutis
        line_color = (base_r - 8, base_g - 8, base_b - 5)
        pygame.draw.rect(surface, line_color, rect, 1)
        
        # Rachaduras aleatórias
        if random.random() < 0.15:
            crack_x = x + random.randint(5, tile_size - 5)
            crack_y = y + random.randint(5, tile_size - 5)
            pygame.draw.line(surface, (35, 30, 25), 
                           (crack_x, crack_y), 
                           (crack_x + random.randint(-8, 8), crack_y + random.randint(-8, 8)), 1)
        
        # Manchas
        if random.random() < 0.08:
            spot_x = x + random.randint(8, tile_size - 8)
            spot_y = y + random.randint(8, tile_size - 8)
            pygame.draw.circle(surface, (40, 35, 28), (spot_x, spot_y), random.randint(2, 4))

    @staticmethod
    def draw_wall_tile(surface, x, y, tile_size):
        """Desenha um tile de parede com textura de tijolos"""
        rect = pygame.Rect(x, y, tile_size, tile_size)
        pygame.draw.rect(surface, (65, 55, 50), rect)
        
        # Padrão de tijolos
        brick_h = tile_size // 4
        for row in range(4):
            by = y + row * brick_h
            offset = (tile_size // 2) if row % 2 else 0
            for bx in range(x - tile_size // 2, x + tile_size + tile_size // 2, tile_size // 2):
                brick_rect = pygame.Rect(bx + offset, by, tile_size // 2 - 1, brick_h - 1)
                pygame.draw.rect(surface, (55, 45, 40), brick_rect, 1)
        
        # Borda escura
        pygame.draw.rect(surface, (35, 30, 25), rect, 2)

    @staticmethod
    def draw_shadow(surface, rect):
        """Desenha uma sombra semi-transparente debaixo da entidade"""
        shadow_w = int(rect.width + 12)
        shadow_h = max(10, int(rect.height / 2.5))
        shadow_surf = pygame.Surface((shadow_w, shadow_h), pygame.SRCALPHA)
        
        # Sombra mais suave (duas camadas)
        pygame.draw.ellipse(shadow_surf, (0, 0, 0, 50), shadow_surf.get_rect())
        inner_rect = shadow_surf.get_rect().inflate(-int(shadow_w // 3), -int(shadow_h // 3))
        pygame.draw.ellipse(shadow_surf, (0, 0, 0, 80), inner_rect)
        
        surface.blit(shadow_surf, (rect.centerx - shadow_w // 2, rect.bottom - shadow_h // 2))

    @staticmethod
    def draw_decoration(surface, x, y, deco_type):
        """Desenha uma decoracao no chao proceduralmente"""
        if deco_type == 'moss':
            moss = pygame.Surface((30, 15), pygame.SRCALPHA)
            pygame.draw.ellipse(moss, (40, 80, 40, 120), moss.get_rect())
            surface.blit(moss, (x, y))
        elif deco_type == 'crack':
            pygame.draw.line(surface, (30, 25, 20), (x, y), (x + 12, y + 10), 2)
            pygame.draw.line(surface, (30, 25, 20), (x + 6, y + 5), (x + 10, y + 14), 2)



class FloorCache:
    """Cache do chão para evitar re-renderizar cada frame"""
    _cache = {}
    
    @classmethod
    def get_floor(cls, width, height, tile_size, room_key, current_floor=1):
        if room_key not in cls._cache:
            from src.utils import load_image
            surf = pygame.Surface((width, height))
            
            # Tenta carregar tile customizado de chão do mod
            floor_tile = load_image("floor.png", fallback_size=None, subfolder="world")
            
            for tx in range(tile_size, width - tile_size, tile_size):
                for ty in range(tile_size, height - tile_size, tile_size):
                    if floor_tile:
                        # Redimensiona caso seja menor ou maior
                        if floor_tile.get_size() != (tile_size, tile_size):
                            floor_tile = pygame.transform.scale(floor_tile, (tile_size, tile_size))
                        surf.blit(floor_tile, (tx, ty))
                    else:
                        seed = hash((room_key, tx, ty)) % 100000
                        SpriteRenderer.draw_floor_tile(surf, tx, ty, tile_size, seed)
            
            # Aplica o Tema Visual do Andar (Tint)
            if current_floor > 1:
                tint = pygame.Surface((width, height))
                if current_floor == 2:
                    tint.fill((200, 150, 100)) # Caverna (Marrom)
                else:
                    tint.fill((200, 100, 100)) # Profundezas (Vermelho)
                surf.blit(tint, (0, 0), special_flags=pygame.BLEND_RGB_MULT)
                
            cls._cache[room_key] = surf
        return cls._cache[room_key]
