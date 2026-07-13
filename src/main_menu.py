import pygame

class MainMenu:
    def __init__(self, screen_width: int, screen_height: int):
        self.screen_width = screen_width
        self.screen_height = screen_height
        self.title_font = pygame.font.Font(None, 80)
        self.font = pygame.font.Font(None, 48)
        self.small_font = pygame.font.Font(None, 36)

    def handle_event(self, event: pygame.event.Event) -> str:
        if event.type == pygame.KEYDOWN:
            if event.key == pygame.K_RETURN:
                return "PLAYING"
            elif event.key == pygame.K_ESCAPE:
                return "QUIT"
        return "MAIN_MENU"

    def draw(self, screen: pygame.Surface):
        screen.fill((15, 12, 10))
        
        title = self.title_font.render("Isaac Engine", True, (255, 255, 255))
        title_rect = title.get_rect(center=(self.screen_width // 2, self.screen_height // 2 - 50))
        
        shadow_title = self.title_font.render("Isaac Engine", True, (0, 0, 0))
        shadow_rect = title_rect.copy()
        shadow_rect.x += 4
        shadow_rect.y += 4
        screen.blit(shadow_title, shadow_rect)
        screen.blit(title, title_rect)
        
        instruction1 = self.font.render("Press ENTER to Play", True, (200, 200, 200))
        inst1_rect = instruction1.get_rect(center=(self.screen_width // 2, self.screen_height // 2 + 50))
        screen.blit(instruction1, inst1_rect)
        
        instruction2 = self.small_font.render("Press ESC to Quit", True, (150, 150, 150))
        inst2_rect = instruction2.get_rect(center=(self.screen_width // 2, self.screen_height // 2 + 100))
        screen.blit(instruction2, inst2_rect)
