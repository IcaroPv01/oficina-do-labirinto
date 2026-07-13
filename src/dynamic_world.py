import pygame
import random
import yaml
import os
import json
from typing import List, Tuple, Dict, Optional
from entities import Player, Enemy, Item

class AreaData:
    def __init__(self, grid_x: int, grid_y: int, area_size: int):
        self.grid_x = grid_x
        self.grid_y = grid_y
        self.area_size = area_size
        self.x = grid_x * area_size
        self.y = grid_y * area_size
        self.active = False
        self.loaded = False
        self.enemies: List[Enemy] = []
        self.items: List[Item] = []
        self.last_accessed = 0.0
        self.access_count = 0

class DynamicAreaManager:
    def __init__(self, config: Dict):
        self.config = config
        self.grid_size = config['world']['grid_size']
        self.area_size = config['world']['area_size']
        self.activation_distance = config['world']['activation_distance']
        self.max_active_areas = config['world']['max_active_areas']
        self.max_loaded_areas = 6
        
        self.areas_data: Dict[Tuple[int, int], AreaData] = {}
        self.active_areas: List[AreaData] = []
        self.loaded_areas: List[AreaData] = []
        
        self.cache_dir = "area_cache"
        self.ensure_cache_dir()
        
        self.initialize_areas()
    
    def ensure_cache_dir(self):
        if not os.path.exists(self.cache_dir):
            os.makedirs(self.cache_dir)
    
    def initialize_areas(self):
        for y in range(self.grid_size):
            for x in range(self.grid_size):
                area_data = AreaData(x, y, self.area_size)
                self.areas_data[(x, y)] = area_data
    
    def get_area_key(self, x: float, y: float) -> Tuple[int, int]:
        grid_x = int(x // self.area_size)
        grid_y = int(y // self.area_size)
        return (grid_x, grid_y)
    
    def get_area_at_position(self, x: float, y: float) -> Optional[AreaData]:
        key = self.get_area_key(x, y)
        return self.areas_data.get(key)
    
    def get_cache_filename(self, grid_x: int, grid_y: int) -> str:
        return os.path.join(self.cache_dir, f"area_{grid_x}_{grid_y}.json")
    
    def generate_area_content(self, area_data: AreaData) -> Dict:
        spawn_config = self.config['spawn']
        content = {
            'enemies': [],
            'items': []
        }
        
        for _ in range(spawn_config['enemies_per_area']):
            enemy_x = random.uniform(area_data.x + 20, area_data.x + area_data.area_size - 20)
            enemy_y = random.uniform(area_data.y + 20, area_data.y + area_data.area_size - 20)
            content['enemies'].append({
                'x': enemy_x,
                'y': enemy_y,
                'health': self.config['enemy']['health'],
                'max_health': self.config['enemy']['health']
            })
        
        for _ in range(spawn_config['health_items_per_area']):
            item_x = random.uniform(area_data.x + 15, area_data.x + area_data.area_size - 15)
            item_y = random.uniform(area_data.y + 15, area_data.y + area_data.area_size - 15)
            content['items'].append({
                'x': item_x,
                'y': item_y,
                'type': 'health',
                'symbol': '➕'
            })
        
        for _ in range(spawn_config['ammo_items_per_area']):
            item_x = random.uniform(area_data.x + 15, area_data.x + area_data.area_size - 15)
            item_y = random.uniform(area_data.y + 15, area_data.y + area_data.area_size - 15)
            content['items'].append({
                'x': item_x,
                'y': item_y,
                'type': 'ammo',
                'symbol': '⚡'
            })
        
        return content
    
    def save_area_to_cache(self, area_data: AreaData):
        cache_file = self.get_cache_filename(area_data.grid_x, area_data.grid_y)
        content = {
            'enemies': [],
            'items': []
        }
        
        for enemy in area_data.enemies:
            content['enemies'].append({
                'x': enemy.x,
                'y': enemy.y,
                'health': enemy.health,
                'max_health': enemy.max_health
            })
        
        for item in area_data.items:
            content['items'].append({
                'x': item.x,
                'y': item.y,
                'type': item.item_type,
                'symbol': item.symbol
            })
        
        with open(cache_file, 'w', encoding='utf-8') as f:
            json.dump(content, f, indent=2)
    
    def load_area_from_cache(self, area_data: AreaData) -> bool:
        cache_file = self.get_cache_filename(area_data.grid_x, area_data.grid_y)
        
        if not os.path.exists(cache_file):
            return False
        
        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                content = json.load(f)
            
            area_data.enemies.clear()
            for enemy_data in content.get('enemies', []):
                enemy = Enemy(enemy_data['x'], enemy_data['y'], self.config['enemy'])
                enemy.health = enemy_data['health']
                enemy.max_health = enemy_data['max_health']
                area_data.enemies.append(enemy)
            
            area_data.items.clear()
            for item_data in content.get('items', []):
                item_config = self.config['items'][item_data['type']]
                item = Item(item_data['x'], item_data['y'], item_data['type'], item_config)
                item.symbol = item_data['symbol']
                area_data.items.append(item)
            
            return True
        except Exception as e:
            print(f"Erro ao carregar área do cache: {e}")
            return False
    
    def load_area(self, area_data: AreaData):
        if area_data.loaded:
            return
        
        current_time = pygame.time.get_ticks() / 1000.0
        
        if not self.load_area_from_cache(area_data):
            content = self.generate_area_content(area_data)
            
            for enemy_data in content['enemies']:
                enemy = Enemy(enemy_data['x'], enemy_data['y'], self.config['enemy'])
                enemy.health = enemy_data['health']
                enemy.max_health = enemy_data['max_health']
                area_data.enemies.append(enemy)
            
            for item_data in content['items']:
                item_config = self.config['items'][item_data['type']]
                item = Item(item_data['x'], item_data['y'], item_data['type'], item_config)
                item.symbol = item_data['symbol']
                area_data.items.append(item)
        
        area_data.loaded = True
        area_data.last_accessed = current_time
        area_data.access_count += 1
        self.loaded_areas.append(area_data)
        
        if len(self.loaded_areas) > self.max_loaded_areas:
            self.unload_oldest_area()
    
    def unload_area(self, area_data: AreaData):
        if not area_data.loaded:
            return
        
        self.save_area_to_cache(area_data)
        
        area_data.enemies.clear()
        area_data.items.clear()
        area_data.loaded = False
        
        if area_data in self.loaded_areas:
            self.loaded_areas.remove(area_data)
    
    def unload_oldest_area(self):
        if not self.loaded_areas:
            return
        
        oldest_area = min(self.loaded_areas, key=lambda a: a.last_accessed)
        if oldest_area not in self.active_areas:
            self.unload_area(oldest_area)
    
    def get_distance_to_area(self, player: Player, area_data: AreaData) -> float:
        player_rect = player.get_rect()
        area_rect = pygame.Rect(area_data.x, area_data.y, area_data.area_size, area_data.area_size)
        
        dx = max(0, max(player_rect.left - area_rect.right, area_rect.left - player_rect.right))
        dy = max(0, max(player_rect.top - area_rect.bottom, area_rect.top - player_rect.bottom))
        
        return (dx**2 + dy**2)**0.5
    
    def update_active_areas(self, player: Player):
        current_area = self.get_area_at_position(player.x, player.y)
        if not current_area:
            return
        
        new_active_areas = [current_area]
        
        for area_data in self.areas_data.values():
            if area_data == current_area:
                continue
            
            distance_to_player = self.get_distance_to_area(player, area_data)
            if distance_to_player <= self.activation_distance:
                new_active_areas.append(area_data)
        
        new_active_areas = new_active_areas[:self.max_active_areas]
        
        for area_data in self.active_areas:
            if area_data not in new_active_areas:
                area_data.active = False
        
        for area_data in new_active_areas:
            if area_data not in self.active_areas:
                area_data.active = True
                self.load_area(area_data)
        
        self.active_areas = new_active_areas
    
    def update(self, player: Player, dt: float):
        self.update_active_areas(player)
        
        for area_data in self.active_areas:
            if not area_data.loaded:
                self.load_area(area_data)
            
            for enemy in area_data.enemies[:]:
                if not enemy.update(player, dt):
                    area_data.enemies.remove(enemy)
            
            for item in area_data.items[:]:
                if item.collect(player):
                    area_data.items.remove(item)
    
    def draw(self, screen: pygame.Surface, camera_x: float, camera_y: float):
        for area_data in self.active_areas:
            if not area_data.loaded:
                continue
            
            for enemy in area_data.enemies:
                enemy.draw(screen, camera_x, camera_y)
            
            for item in area_data.items:
                item.draw(screen, camera_x, camera_y)
    
    def draw_grid(self, screen: pygame.Surface, camera_x: float, camera_y: float):
        for area_data in self.areas_data.values():
            rect = pygame.Rect(area_data.x, area_data.y, area_data.area_size, area_data.area_size)
            screen_rect = pygame.Rect(
                rect.x - camera_x,
                rect.y - camera_y,
                rect.width,
                rect.height
            )
            
            if area_data.active:
                color = (100, 100, 100) if area_data.loaded else (150, 100, 100)
            else:
                color = (50, 50, 50)
            
            pygame.draw.rect(screen, color, screen_rect, 2)
            
            if area_data.loaded:
                status_text = f"L"
                font = pygame.font.Font(None, 20)
                text_surface = font.render(status_text, True, (0, 255, 0))
                screen.blit(text_surface, (screen_rect.x + 5, screen_rect.y + 5))
    
    def get_memory_stats(self) -> Dict:
        total_enemies = sum(len(area.enemies) for area in self.loaded_areas)
        total_items = sum(len(area.items) for area in self.loaded_areas)
        
        return {
            'loaded_areas': len(self.loaded_areas),
            'active_areas': len(self.active_areas),
            'total_areas': len(self.areas_data),
            'total_enemies': total_enemies,
            'total_items': total_items,
            'memory_usage': f"{len(self.loaded_areas)}/{self.max_loaded_areas} áreas"
        }
    
    def cleanup_cache(self):
        for area_data in self.areas_data.values():
            if area_data.loaded:
                self.save_area_to_cache(area_data)
                self.unload_area(area_data)
    
    def clear_cache(self):
        for filename in os.listdir(self.cache_dir):
            if filename.startswith('area_') and filename.endswith('.json'):
                os.remove(os.path.join(self.cache_dir, filename))