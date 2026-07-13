import pygame
from typing import List

class PauseMenu:
    def __init__(self, screen_width: int, screen_height: int):
        self.screen_width = screen_width
        self.screen_height = screen_height
        self.visible = False
        self.font = pygame.font.Font(None, 48)
        self.small_font = pygame.font.Font(None, 36)
        
        self.setup_buttons()
    
    def setup_buttons(self):
        center_x = self.screen_width // 2
        button_width = 300
        button_height = 60
        spacing = 80
        
        self.buttons = [
            MenuButton(center_x - button_width//2, 300, button_width, button_height, 
                      "▶️ CONTINUAR", (20, 120, 20), (30, 180, 30), 36),
            MenuButton(center_x - button_width//2, 300 + spacing, button_width, button_height, 
                      "🔄 REINICIAR", (120, 80, 20), (180, 120, 30), 36),
            MenuButton(center_x - button_width//2, 300 + spacing*2, button_width, button_height, 
                      "🏠 MENU PRINCIPAL", (20, 80, 120), (30, 120, 180), 36),
            MenuButton(center_x - button_width//2, 300 + spacing*3, button_width, button_height, 
                      "❌ SAIR", (120, 20, 20), (180, 30, 30), 36)
        ]
    
    def show(self):
        self.visible = True
    
    def hide(self):
        self.visible = False
    
    def toggle(self):
        self.visible = not self.visible
    
    def handle_event(self, event: pygame.event.Event) -> str:
        if not self.visible:
            return "none"
        
        if event.type == pygame.KEYDOWN:
            if event.key == pygame.K_ESCAPE:
                self.hide()
                return "resume"
        
        for i, button in enumerate(self.buttons):
            if button.handle_event(event):
                if i == 0:
                    self.hide()
                    return "resume"
                elif i == 1:
                    self.hide()
                    return "restart"
                elif i == 2:
                    self.hide()
                    return "main_menu"
                elif i == 3:
                    return "quit"
        
        return "none"
    
    def draw(self, screen: pygame.Surface):
        if not self.visible:
            return
        
        overlay = pygame.Surface((self.screen_width, self.screen_height))
        overlay.set_alpha(128)
        overlay.fill((0, 0, 0))
        screen.blit(overlay, (0, 0))
        
        menu_width = 400
        menu_height = 500
        menu_x = (self.screen_width - menu_width) // 2
        menu_y = (self.screen_height - menu_height) // 2
        
        menu_rect = pygame.Rect(menu_x, menu_y, menu_width, menu_height)
        
        shadow_rect = pygame.Rect(menu_x + 5, menu_y + 5, menu_width, menu_height)
        pygame.draw.rect(screen, (0, 0, 0, 100), shadow_rect, border_radius=15)
        
        pygame.draw.rect(screen, (30, 30, 40), menu_rect, border_radius=15)
        pygame.draw.rect(screen, (80, 80, 90), menu_rect, 3, border_radius=15)
        
        title_font = pygame.font.Font(None, 56)
        title = title_font.render("PAUSA", True, (255, 255, 255))
        title_rect = title.get_rect(center=(self.screen_width//2, menu_y + 80))
        
        shadow_title = title_font.render("PAUSA", True, (0, 0, 0))
        shadow_rect = title_rect.copy()
        shadow_rect.x += 3
        shadow_rect.y += 3
        screen.blit(shadow_title, shadow_rect)
        screen.blit(title, title_rect)
        
        instruction = self.small_font.render("Pressione ESC para continuar", True, (200, 200, 200))
        instruction_rect = instruction.get_rect(center=(self.screen_width//2, menu_y + 120))
        
        shadow_instruction = self.small_font.render("Pressione ESC para continuar", True, (0, 0, 0))
        shadow_inst_rect = instruction_rect.copy()
        shadow_inst_rect.x += 2
        shadow_inst_rect.y += 2
        screen.blit(shadow_instruction, shadow_inst_rect)
        screen.blit(instruction, instruction_rect)
        
        for button in self.buttons:
            button.draw(screen)

class MenuButton:
    def __init__(self, x: int, y: int, width: int, height: int, text: str, color: tuple, hover_color: tuple, font_size: int = 36):
        self.rect = pygame.Rect(x, y, width, height)
        self.text = text
        self.color = color
        self.hover_color = hover_color
        self.hovered = False
        self.font = pygame.font.Font(None, font_size)
        self.shadow_offset = 3
        self.border_radius = 8
    
    def draw(self, screen: pygame.Surface):
        shadow_rect = pygame.Rect(
            self.rect.x + self.shadow_offset,
            self.rect.y + self.shadow_offset,
            self.rect.width,
            self.rect.height
        )
        pygame.draw.rect(screen, (0, 0, 0, 100), shadow_rect, border_radius=self.border_radius)
        
        color = self.hover_color if self.hovered else self.color
        pygame.draw.rect(screen, color, self.rect, border_radius=self.border_radius)
        
        border_color = (255, 255, 255) if self.hovered else (200, 200, 200)
        pygame.draw.rect(screen, border_color, self.rect, 3, border_radius=self.border_radius)
        
        text_surface = self.font.render(self.text, True, (255, 255, 255))
        text_rect = text_surface.get_rect(center=self.rect.center)
        
        shadow_text = self.font.render(self.text, True, (0, 0, 0))
        shadow_rect = text_rect.copy()
        shadow_rect.x += 2
        shadow_rect.y += 2
        screen.blit(shadow_text, shadow_rect)
        
        screen.blit(text_surface, text_rect)
    
    def handle_event(self, event: pygame.event.Event) -> bool:
        if event.type == pygame.MOUSEMOTION:
            self.hovered = self.rect.collidepoint(event.pos)
        elif event.type == pygame.MOUSEBUTTONDOWN:
            if self.rect.collidepoint(event.pos):
                return True
        return False