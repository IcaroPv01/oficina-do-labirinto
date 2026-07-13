import pygame
import random

class Obstacle(pygame.sprite.Sprite):
    def __init__(self, x, y):
        super().__init__()


class Spike(Obstacle):
    def __init__(self, x, y):
        super().__init__(x, y)
        self.image = pygame.Surface((64, 64), pygame.SRCALPHA)
        # Desenha múltiplos triângulos cinzas para espinhos
        for i in range(4):
            for j in range(4):
                sx = i * 16 + 8
                sy = j * 16 + 16
                pygame.draw.polygon(self.image, (120, 120, 120), [
                    (sx - 6, sy), (sx + 6, sy), (sx, sy - 12)
                ])
                pygame.draw.polygon(self.image, (90, 90, 90), [
                    (sx - 6, sy), (sx + 6, sy), (sx, sy - 12)
                ], 1)
        self.rect = self.image.get_rect(topleft=(x, y))
        self.damage = 1
        self.damage_timer = 0.0

    def update(self, dt, player, particles=None):
        self.damage_timer = max(0.0, self.damage_timer - dt)
        if self.rect.colliderect(player.rect) and self.damage_timer <= 0:
            player.take_damage(self.damage)
            if particles:
                particles.add_blood(player.rect.centerx, player.rect.centery, 3)
            self.damage_timer = 1.0 # Cooldown de 1 segundo de dano do espinho

class Destructible(Obstacle):
    def __init__(self, x, y):
        super().__init__(x, y)
        self.image = pygame.Surface((64, 64), pygame.SRCALPHA)
        # Desenha rocha redonda e rachada
        pygame.draw.circle(self.image, (90, 90, 90), (32, 32), 26)
        pygame.draw.circle(self.image, (60, 60, 60), (32, 32), 26, 2)
        # Detalhe de textura
        pygame.draw.line(self.image, (40, 40, 40), (16, 24), (32, 32), 2)
        pygame.draw.line(self.image, (40, 40, 40), (32, 32), (48, 40), 2)
        self.rect = self.image.get_rect(topleft=(x, y))
        self.health = 1

    def take_damage(self, amount, pickups_group, particles=None):
        self.health -= amount
        if self.health <= 0:
            if particles:
                particles.add_explosion(self.rect.centerx, self.rect.centery, (100, 100, 100), 8)
            # 25% de chance de dropar moeda ou coração
            if random.random() < 0.25:
                from src.pickups import Pickup
                drop_type = 'coin' if random.random() < 0.7 else 'heart'
                pickup = Pickup(self.rect.centerx, self.rect.centery, drop_type)
                pickups_group.add(pickup)
            self.kill()
            return True
        return False

class TintedRock(Destructible):
    def __init__(self, x, y):
        super().__init__(x, y)
        self.health = 3
        # Desenha uma marca X sutil na rocha para o jogador atento
        pygame.draw.line(self.image, (120, 120, 120), (8, 8), (56, 56), 4)
        pygame.draw.line(self.image, (120, 120, 120), (56, 8), (8, 56), 4)
        
    def take_damage(self, amount, pickups_group, particles=None):
        self.health -= amount
        if self.health <= 0:
            self.kill()
            if particles:
                particles.add_explosion(self.rect.centerx, self.rect.centery, (150, 150, 150), 10)
            
            # Rocha Especial sempre dropa loot valioso!
            from src.pickups import Pickup
            drop_pool = ['item_damage', 'heart', 'key', 'item_speed', 'item_poison', 'coin']
            drop = random.choice(drop_pool)
            pickups_group.add(Pickup(self.rect.centerx, self.rect.centery, drop))
            return True
        return False

class Chest(Obstacle):
    def __init__(self, x, y):
        super().__init__(x, y)
        self.image = pygame.Surface((64, 64), pygame.SRCALPHA)
        # Desenha baú dourado trancado
        pygame.draw.rect(self.image, (139, 69, 19), (8, 16, 48, 36), border_radius=4)
        pygame.draw.rect(self.image, (100, 50, 10), (8, 16, 48, 36), 2, border_radius=4)
        # Tampa
        pygame.draw.rect(self.image, (120, 55, 15), (8, 16, 48, 10))
        # Fechadura dourada
        pygame.draw.rect(self.image, (218, 165, 32), (28, 28, 8, 10))
        pygame.draw.circle(self.image, (0, 0, 0), (32, 31), 2)
        self.rect = self.image.get_rect(topleft=(x, y))
        self.opened = False

    def check_interaction(self, player, pickups_group, particles=None):
        if self.opened:
            return
        if self.rect.colliderect(player.rect):
            if player.keys >= 1:
                player.keys -= 1
                self.opened = True
                if particles:
                    particles.add_coin_sparkle(self.rect.centerx, self.rect.centery)
                # Drops abundantes garantidos
                from src.pickups import Pickup
                drops_pool = ['coin', 'coin', 'heart', 'key']
                num_drops = random.randint(2, 3)
                for _ in range(num_drops):
                    dt_choice = random.choice(drops_pool)
                    ox = random.randint(-15, 15)
                    oy = random.randint(-15, 15)
                    pickup = Pickup(self.rect.centerx + ox, self.rect.centery + oy, dt_choice)
                    pickups_group.add(pickup)
                self.kill()

class Trapdoor(Obstacle):
    def __init__(self, x, y):
        super().__init__(x, y)
        self.image = pygame.Surface((64, 64), pygame.SRCALPHA)
        # Fundo escuro do buraco
        pygame.draw.rect(self.image, (20, 20, 20), (12, 12, 40, 40))
        # Borda/Moldura
        pygame.draw.rect(self.image, (80, 80, 80), (12, 12, 40, 40), 4)
        # Detalhe de escada descendo
        pygame.draw.line(self.image, (50, 50, 50), (24, 20), (40, 20), 4)
        pygame.draw.line(self.image, (45, 45, 45), (24, 30), (40, 30), 4)
        pygame.draw.line(self.image, (40, 40, 40), (24, 40), (40, 40), 4)
        self.rect = self.image.get_rect(topleft=(x, y))
