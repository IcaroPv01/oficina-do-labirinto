import pygame
from src.utils import load_image
from src.sprites import SpriteRenderer
from src.audio import AudioEngine
from src.registry import Registry

class Pickup(pygame.sprite.Sprite):
    def __init__(self, x, y, pickup_type, is_shop_item=False):
        super().__init__()
        self.type = pickup_type
        self.is_shop_item = is_shop_item
        self.price = 0
        self.name = "Item Desconhecido"
        
        # Lê definições do JSON via Registry (Data-Driven Architecture)
        item_data = Registry.get_instance().get_item(pickup_type)
        if item_data:
            self.name = item_data.get("name", "Item")
            sprite_file = item_data.get("sprite", "coin.png")
            color = tuple(item_data.get("color", [255, 255, 255]))
            size = item_data.get("size", 24)
            # Define o preço apenas se for um item de loja, senão é grátis (0)
            self.price = item_data.get("price", 0) if is_shop_item else 0
            
            self.image = load_image(sprite_file, (size, size), color, subfolder="items")
        else:
            # Fallback caso o item não exista no JSON
            self.image = pygame.Surface((24, 24))
            self.image.fill((255, 0, 255)) # Rosa choque (Missing texture)
            
        self.rect = self.image.get_rect(center=(x, y))

    def collect(self, player):
        """
        Retorna True se coletado com sucesso, False se falhou (ex: sem dinheiro).
        """
        if self.price > 0:
            if player.coins >= self.price:
                player.coins -= self.price
                AudioEngine.get_instance().play('coin')
            else:
                return False # Não tem dinheiro
                
        # Aplica efeito
        if self.type == 'coin':
            player.coins += 1
            AudioEngine.get_instance().play('coin')
        elif self.type == 'heart':
            # Cura 2 HP (1 coração cheio)
            player.health = min(player.health + 2, player.max_health)
            AudioEngine.get_instance().play('door')
        elif self.type == 'key':
            player.keys += 1
            AudioEngine.get_instance().play('coin')
        elif self.type == 'item_speed':
            player.speed += 80
            player.equip_costume('boots') # Ativa costume visual (Módulo 1)
            AudioEngine.get_instance().play('door')
        elif self.type == 'item_damage':
            player.damage += 1.5
            player.equip_costume('sword') # Ativa costume visual (Módulo 1)
            AudioEngine.get_instance().play('door')
        elif self.type == 'book_of_healing':
            player.active_item = 'book_of_healing'
            player.active_max_charge = 3
            player.active_charge = 0
            AudioEngine.get_instance().play('door')
        elif self.type == 'hourglass':
            player.active_item = 'hourglass'
            player.active_max_charge = 4
            player.active_charge = 0
            AudioEngine.get_instance().play('door')
        elif self.type == 'item_poison':
            player.is_poisonous = True
            AudioEngine.get_instance().play('door')
        elif self.type == 'item_piercing':
            player.is_piercing = True
            AudioEngine.get_instance().play('door')

        self.kill()
        return True
