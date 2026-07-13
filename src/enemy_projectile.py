import pygame

class EnemyProjectile(pygame.sprite.Sprite):
    def __init__(self, x, y, dir_x, dir_y, speed=350, damage=1, color=(255, 50, 50)):
        super().__init__()
        self.size = 8
        self.image = pygame.Surface((self.size * 2 + 4, self.size * 2 + 4), pygame.SRCALPHA)
        # Desenha círculo vermelho/laranja de projétil inimigo
        pygame.draw.circle(self.image, color, (self.size + 2, self.size + 2), self.size)
        pygame.draw.circle(self.image, (255, 255, 255), (self.size + 2, self.size + 2), self.size, 1)
        
        self.rect = self.image.get_rect(center=(x, y))
        self.dir_x = dir_x
        self.dir_y = dir_y
        self.speed = speed
        self.damage = damage

    def update(self, dt):
        self.rect.x += self.dir_x * self.speed * dt
        self.rect.y += self.dir_y * self.speed * dt
