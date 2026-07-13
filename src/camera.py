import pygame
from typing import Tuple

class Camera:
    def __init__(self, window_width: int, window_height: int):
        self.window_width = window_width
        self.window_height = window_height
        self.x = 0
        self.y = 0
        self.target_x = 0
        self.target_y = 0
        self.smooth_speed = 5.0
    
    def follow(self, target_x: float, target_y: float):
        self.target_x = target_x - self.window_width // 2
        self.target_y = target_y - self.window_height // 2
    
    def update(self, dt: float):
        self.x += (self.target_x - self.x) * self.smooth_speed * dt
        self.y += (self.target_y - self.y) * self.smooth_speed * dt
    
    def get_position(self) -> Tuple[float, float]:
        return self.x, self.y
    
    def world_to_screen(self, world_x: float, world_y: float) -> Tuple[int, int]:
        screen_x = int(world_x - self.x)
        screen_y = int(world_y - self.y)
        return screen_x, screen_y
    
    def screen_to_world(self, screen_x: int, screen_y: int) -> Tuple[float, float]:
        world_x = screen_x + self.x
        world_y = screen_y + self.y
        return world_x, world_y
    
    def is_visible(self, x: float, y: float, size: int) -> bool:
        screen_x, screen_y = self.world_to_screen(x, y)
        return (screen_x + size >= 0 and screen_x - size <= self.window_width and
                screen_y + size >= 0 and screen_y - size <= self.window_height)