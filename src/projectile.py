import pygame
from src.sprites import SpriteRenderer

class Projectile(pygame.sprite.Sprite):
    def __init__(self, x, y, dir_x, dir_y, speed=600, range_limit=450, is_poisonous=False, is_piercing=False):
        super().__init__()
        self.is_poisonous = is_poisonous
        self.is_piercing = is_piercing
        self.pierced_enemies = set()
        
        # Projétil estilo lágrima de Isaac (desenhado proceduralmente)
        self.size = 10
        self.image = pygame.Surface((self.size * 2 + 4, self.size * 2 + 4), pygame.SRCALPHA)
        color = (50, 200, 50) if is_poisonous else (100, 150, 255)
        pygame.draw.circle(self.image, color, (self.size + 2, self.size + 2), self.size)
        pygame.draw.circle(self.image, (150, 200, 255), (self.size + 2, self.size + 2), self.size, 2)
        pygame.draw.circle(self.image, (200, 220, 255), (self.size + 2 - self.size//3, self.size + 2 - self.size//3), self.size // 3)
        
        self.rect = self.image.get_rect(center=(x, y))
        self.start_pos = pygame.math.Vector2(self.rect.center)
        self.pos = pygame.math.Vector2(self.rect.center)
        
        self.dir_x = dir_x
        self.dir_y = dir_y
        self.speed = speed
        self.range_limit = range_limit
        self.damage = 1

    def update(self, dt):
        # Movimento suave
        self.pos.x += self.dir_x * self.speed * dt
        self.pos.y += self.dir_y * self.speed * dt
        self.rect.center = (round(self.pos.x), round(self.pos.y))
        
        # Destrói ao ultrapassar o limite de alcance (Módulo 4)
        dist_traveled = pygame.math.Vector2(self.rect.center).distance_to(self.start_pos)
        if dist_traveled >= self.range_limit:
            self.kill()
