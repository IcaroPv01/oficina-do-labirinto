import pygame
import yaml
import os
from typing import List, Dict, Any

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

class Slider:
    def __init__(self, x: int, y: int, width: int, height: int, min_val: float, max_val: float, initial_val: float, label: str):
        self.rect = pygame.Rect(x, y, width, height)
        self.min_val = min_val
        self.max_val = max_val
        self.value = initial_val
        self.label = label
        self.dragging = False
        self.font = pygame.font.Font(None, 24)
        self.label_font = pygame.font.Font(None, 28)
        self.border_radius = 6
    
    def draw(self, screen: pygame.Surface):
        pygame.draw.rect(screen, (60, 60, 60), self.rect, border_radius=self.border_radius)
        pygame.draw.rect(screen, (120, 120, 120), self.rect, 2, border_radius=self.border_radius)

        progress_width = int((self.value - self.min_val) / (self.max_val - self.min_val) * self.rect.width)
        progress_rect = pygame.Rect(self.rect.x, self.rect.y, progress_width, self.rect.height)
        pygame.draw.rect(screen, (100, 200, 100), progress_rect, border_radius=self.border_radius)

        slider_width = 24
        slider_height = self.rect.height + 8
        slider_x = self.rect.x + progress_width - slider_width // 2
        slider_y = self.rect.y - 4
        slider_rect = pygame.Rect(slider_x, slider_y, slider_width, slider_height)

        shadow_rect = pygame.Rect(slider_x + 2, slider_y + 2, slider_width, slider_height)
        pygame.draw.rect(screen, (0, 0, 0, 100), shadow_rect, border_radius=4)

        pygame.draw.rect(screen, (255, 255, 255), slider_rect, border_radius=4)
        pygame.draw.rect(screen, (200, 200, 200), slider_rect, 2, border_radius=4)
        
        label_text = f"{self.label}: {self.value:.0f}"
        text_surface = self.label_font.render(label_text, True, (255, 255, 255))
        
        shadow_text = self.label_font.render(label_text, True, (0, 0, 0))
        screen.blit(shadow_text, (self.rect.x + 2, self.rect.y - 35))
        screen.blit(text_surface, (self.rect.x, self.rect.y - 33))
    
    def handle_event(self, event: pygame.event.Event) -> bool:
        if event.type == pygame.MOUSEBUTTONDOWN:
            if self.rect.collidepoint(event.pos):
                self.dragging = True
                return True
        elif event.type == pygame.MOUSEBUTTONUP:
            self.dragging = False
        elif event.type == pygame.MOUSEMOTION and self.dragging:
            rel_x = event.pos[0] - self.rect.x
            self.value = self.min_val + (rel_x / self.rect.width) * (self.max_val - self.min_val)
            self.value = max(self.min_val, min(self.max_val, self.value))
            return True
        return False

class MainMenu:
    def __init__(self, screen_width: int, screen_height: int):
        self.screen_width = screen_width
        self.screen_height = screen_height
        self.current_screen = "main"
        self.font = pygame.font.Font(None, 48)
        self.small_font = pygame.font.Font(None, 24)
        
        self.setup_main_menu()
        self.setup_config_menu()
        self.setup_scenarios_menu()
    
    def setup_main_menu(self):
        center_x = self.screen_width // 2
        button_width = 350
        button_height = 70
        spacing = 90
        
        self.main_buttons = [
            MenuButton(center_x - button_width//2, 250, button_width, button_height, 
                      "🎮 COMEÇAR JOGO", (120, 60, 20), (180, 90, 30), 42),
            MenuButton(center_x - button_width//2, 250 + spacing, button_width, button_height, 
                      "⚙️ CONFIGURAR BALANCEAMENTO", (20, 80, 120), (30, 120, 180), 38),
            MenuButton(center_x - button_width//2, 250 + spacing*2, button_width, button_height, 
                      "📊 CENÁRIOS DE TESTE", (120, 80, 20), (180, 120, 30), 38),
            MenuButton(center_x - button_width//2, 250 + spacing*3, button_width, button_height, 
                      "❌ SAIR", (120, 20, 20), (180, 30, 30), 42)
        ]
    
    def setup_config_menu(self):
        self.config_sliders = []
        y_start = 180
        spacing = 85
        
        self.config_sliders.append(Slider(60, y_start, 450, 35, 1, 100, 5, "Inimigos por área"))
        self.config_sliders.append(Slider(60, y_start + spacing, 450, 35, 50, 300, 100, "Velocidade dos inimigos"))
        self.config_sliders.append(Slider(60, y_start + spacing*2, 450, 35, 5, 50, 10, "Dano dos inimigos"))
        self.config_sliders.append(Slider(60, y_start + spacing*3, 450, 35, 20, 100, 50, "Saúde dos inimigos"))
        
        self.config_sliders.append(Slider(550, y_start, 450, 35, 200, 800, 400, "Tamanho das áreas"))
        self.config_sliders.append(Slider(550, y_start + spacing, 450, 35, 30, 200, 50, "Distância de ativação"))
        self.config_sliders.append(Slider(550, y_start + spacing*2, 450, 35, 2, 9, 4, "Máximo de áreas ativas"))
        self.config_sliders.append(Slider(550, y_start + spacing*3, 450, 35, 30, 300, 60, "Tempo de sobrevivência"))
        
        self.config_sliders.append(Slider(60, y_start + spacing*4, 450, 35, 100, 400, 200, "Velocidade do jogador"))
        self.config_sliders.append(Slider(60, y_start + spacing*5, 450, 35, 50, 200, 100, "Saúde máxima do jogador"))
        
        self.config_buttons = [
            MenuButton(60, 650, 180, 60, "💾 SALVAR", (20, 120, 20), (30, 180, 30), 32),
            MenuButton(260, 650, 180, 60, "🔄 RESETAR", (120, 80, 20), (180, 120, 30), 32),
            MenuButton(460, 650, 180, 60, "⬅️ VOLTAR", (80, 80, 80), (120, 120, 120), 32)
        ]
    
    def setup_scenarios_menu(self):
        self.scenario_buttons = []
        y_start = 180
        spacing = 70
        
        scenarios = [
            ("📚 TUTORIAL", "tutorial", "Poucos inimigos, muitas curas"),
            ("🏃 SOBREVIVÊNCIA", "survival", "Modo equilibrado padrão"),
            ("😱 PESADELO", "nightmare", "Centenas de inimigos rápidos"),
            ("⚔️ ARENA", "arena", "Combate intenso em área pequena"),
            ("🎲 ALEATÓRIO", "random", "Configuração gerada aleatoriamente"),
            ("🧪 PERFORMANCE", "performance", "Teste com milhares de inimigos")
        ]
        
        for i, (name, key, description) in enumerate(scenarios):
            button = MenuButton(80, y_start + i * spacing, 520, 60, name, (60, 40, 80), (100, 70, 120), 36)
            button.scenario_key = key
            button.description = description
            self.scenario_buttons.append(button)
        
        self.scenario_buttons.append(
            MenuButton(80, 600, 200, 60, "⬅️ VOLTAR", (80, 80, 80), (120, 120, 120), 36)
        )
    
    def handle_event(self, event: pygame.event.Event) -> str:
        if self.current_screen == "main":
            return self.handle_main_menu(event)
        elif self.current_screen == "config":
            return self.handle_config_menu(event)
        elif self.current_screen == "scenarios":
            return self.handle_scenarios_menu(event)
        return "none"
    
    def handle_main_menu(self, event: pygame.event.Event) -> str:
        for i, button in enumerate(self.main_buttons):
            if button.handle_event(event):
                if i == 0:
                    return "start_game"
                elif i == 1:
                    self.current_screen = "config"
                elif i == 2:
                    self.current_screen = "scenarios"
                elif i == 3:
                    return "quit"
        return "none"
    
    def handle_config_menu(self, event: pygame.event.Event) -> str:
        for slider in self.config_sliders:
            slider.handle_event(event)
        
        for button in self.config_buttons:
            if button.handle_event(event):
                if button.text == "💾 SALVAR":
                    return "save_config"
                elif button.text == "🔄 RESETAR":
                    self.reset_config_sliders()
                elif button.text == "⬅️ VOLTAR":
                    self.current_screen = "main"
        return "none"
    
    def handle_scenarios_menu(self, event: pygame.event.Event) -> str:
        for button in self.scenario_buttons:
            if button.handle_event(event):
                if button.text == "⬅️ VOLTAR":
                    self.current_screen = "main"
                elif hasattr(button, 'scenario_key'):
                    return f"load_scenario_{button.scenario_key}"
        return "none"
    
    def reset_config_sliders(self):
        self.config_sliders[0].value = 5
        self.config_sliders[1].value = 100
        self.config_sliders[2].value = 10
        self.config_sliders[3].value = 50
        self.config_sliders[4].value = 400
        self.config_sliders[5].value = 50
        self.config_sliders[6].value = 4
        self.config_sliders[7].value = 60
        self.config_sliders[8].value = 200
        self.config_sliders[9].value = 100
    
    def get_config_values(self) -> Dict[str, Any]:
        return {
            'enemies_per_area': int(self.config_sliders[0].value),
            'enemy_speed': int(self.config_sliders[1].value),
            'enemy_damage': int(self.config_sliders[2].value),
            'enemy_health': int(self.config_sliders[3].value),
            'area_size': int(self.config_sliders[4].value),
            'activation_distance': int(self.config_sliders[5].value),
            'max_active_areas': int(self.config_sliders[6].value),
            'survival_time': int(self.config_sliders[7].value),
            'player_speed': int(self.config_sliders[8].value),
            'player_max_health': int(self.config_sliders[9].value)
        }
    
    def draw(self, screen: pygame.Surface):
        screen.fill((15, 15, 25))
        
        for y in range(0, self.screen_height, 40):
            for x in range(0, self.screen_width, 40):
                if (x + y) % 80 == 0:
                    pygame.draw.rect(screen, (25, 25, 35), (x, y, 20, 20))
        
        if self.current_screen == "main":
            self.draw_main_menu(screen)
        elif self.current_screen == "config":
            self.draw_config_menu(screen)
        elif self.current_screen == "scenarios":
            self.draw_scenarios_menu(screen)
    
    def draw_main_menu(self, screen: pygame.Surface):
        title_font = pygame.font.Font(None, 72)
        title = title_font.render("BINDING OF PYSAAC", True, (255, 255, 255))
        title_rect = title.get_rect(center=(self.screen_width//2, 120))
        
        shadow_title = title_font.render("BINDING OF PYSAAC", True, (0, 0, 0))
        shadow_rect = title_rect.copy()
        shadow_rect.x += 4
        shadow_rect.y += 4
        screen.blit(shadow_title, shadow_rect)
        screen.blit(title, title_rect)
        
        subtitle = self.small_font.render("Sistema de Áreas Ativas 3x3", True, (200, 200, 200))
        subtitle_rect = subtitle.get_rect(center=(self.screen_width//2, 170))
        
        shadow_subtitle = self.small_font.render("Sistema de Áreas Ativas 3x3", True, (0, 0, 0))
        shadow_sub_rect = subtitle_rect.copy()
        shadow_sub_rect.x += 2
        shadow_sub_rect.y += 2
        screen.blit(shadow_subtitle, shadow_sub_rect)
        screen.blit(subtitle, subtitle_rect)
        
        for button in self.main_buttons:
            button.draw(screen)
    
    def draw_config_menu(self, screen: pygame.Surface):
        title_font = pygame.font.Font(None, 56)
        title = title_font.render("⚙️ CONFIGURAÇÃO DE BALANCEAMENTO", True, (255, 255, 255))
        title_rect = title.get_rect(center=(self.screen_width//2, 80))
        
        shadow_title = title_font.render("⚙️ CONFIGURAÇÃO DE BALANCEAMENTO", True, (0, 0, 0))
        shadow_rect = title_rect.copy()
        shadow_rect.x += 3
        shadow_rect.y += 3
        screen.blit(shadow_title, shadow_rect)
        screen.blit(title, title_rect)
        
        section_font = pygame.font.Font(None, 32)
        
        enemies_title = section_font.render("👾 INIMIGOS", True, (255, 100, 100))
        enemies_rect = enemies_title.get_rect(x=60, y=140)
        shadow_enemies = section_font.render("👾 INIMIGOS", True, (0, 0, 0))
        screen.blit(shadow_enemies, (enemies_rect.x + 2, enemies_rect.y + 2))
        screen.blit(enemies_title, enemies_rect)
        
        world_title = section_font.render("🗺️ MUNDO", True, (100, 255, 100))
        world_rect = world_title.get_rect(x=550, y=140)
        shadow_world = section_font.render("🗺️ MUNDO", True, (0, 0, 0))
        screen.blit(shadow_world, (world_rect.x + 2, world_rect.y + 2))
        screen.blit(world_title, world_rect)
        
        player_title = section_font.render("👤 JOGADOR", True, (100, 100, 255))
        player_rect = player_title.get_rect(x=60, y=470)
        shadow_player = section_font.render("👤 JOGADOR", True, (0, 0, 0))
        screen.blit(shadow_player, (player_rect.x + 2, player_rect.y + 2))
        screen.blit(player_title, player_rect)
        
        for slider in self.config_sliders:
            slider.draw(screen)
        
        for button in self.config_buttons:
            button.draw(screen)
    
    def draw_scenarios_menu(self, screen: pygame.Surface):
        title_font = pygame.font.Font(None, 56)
        title = title_font.render("📊 CENÁRIOS DE TESTE", True, (255, 255, 255))
        title_rect = title.get_rect(center=(self.screen_width//2, 80))
        
        shadow_title = title_font.render("📊 CENÁRIOS DE TESTE", True, (0, 0, 0))
        shadow_rect = title_rect.copy()
        shadow_rect.x += 3
        shadow_rect.y += 3
        screen.blit(shadow_title, shadow_rect)
        screen.blit(title, title_rect)
        
        subtitle = self.small_font.render("Escolha um cenário para testar diferentes configurações", True, (200, 200, 200))
        subtitle_rect = subtitle.get_rect(center=(self.screen_width//2, 120))
        
        shadow_subtitle = self.small_font.render("Escolha um cenário para testar diferentes configurações", True, (0, 0, 0))
        shadow_sub_rect = subtitle_rect.copy()
        shadow_sub_rect.x += 2
        shadow_sub_rect.y += 2
        screen.blit(shadow_subtitle, shadow_sub_rect)
        screen.blit(subtitle, subtitle_rect)
        
        for button in self.scenario_buttons:
            button.draw(screen)
            if hasattr(button, 'description') and button.hovered:
                desc_bg = pygame.Rect(620, button.rect.y - 5, 300, 50)
                pygame.draw.rect(screen, (20, 20, 30), desc_bg, border_radius=8)
                pygame.draw.rect(screen, (100, 100, 120), desc_bg, 2, border_radius=8)
                
                desc_text = self.small_font.render(button.description, True, (255, 255, 200))
                desc_rect = desc_text.get_rect(center=desc_bg.center)
                
                shadow_desc = self.small_font.render(button.description, True, (0, 0, 0))
                shadow_rect = desc_rect.copy()
                shadow_rect.x += 2
                shadow_rect.y += 2
                screen.blit(shadow_desc, shadow_rect)
                screen.blit(desc_text, desc_rect)