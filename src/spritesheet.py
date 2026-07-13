import pygame

class SpriteSheet:
    def __init__(self, surface):
        self.sheet = surface

    def get_image_at(self, x, y, width, height, scale=1, colorkey=(0, 0, 0)):
        """
        Extrai uma sprite específica da spritesheet.
        """
        image = pygame.Surface((width, height), pygame.SRCALPHA).convert_alpha()
        image.blit(self.sheet, (0, 0), (x, y, width, height))
        if scale != 1:
            image = pygame.transform.scale(image, (width * scale, height * scale))
        if colorkey is not None:
            image.set_colorkey(colorkey)
        return image
