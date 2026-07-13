import os
import pygame
from src.settings import MODS_DIR, ACTIVE_MOD, WHITE

_image_cache = {}

def load_image(filename, fallback_size, fallback_color=WHITE, subfolder=""):
    """
    Tenta carregar uma imagem da pasta do MOD ativo, depois do default.
    Permite passar uma subpasta (ex: 'player', 'enemies', 'items').
    """
    cache_key = f"{subfolder}_{filename}"
    if cache_key in _image_cache:
        return _image_cache[cache_key]
    
    mod_path = os.path.join(MODS_DIR, ACTIVE_MOD, subfolder, filename)
    
    if not os.path.exists(mod_path) and ACTIVE_MOD != "default":
        mod_path = os.path.join(MODS_DIR, "default", subfolder, filename)
        
    if os.path.exists(mod_path):
        try:
            img = pygame.image.load(mod_path).convert_alpha()
            if fallback_size:
                img = pygame.transform.scale(img, fallback_size)
            _image_cache[cache_key] = img
            return img
        except Exception as e:
            print(f"Erro ao carregar imagem {filename}: {e}")
            pass
            
    if fallback_size is None:
        return None
        
    surf = pygame.Surface(fallback_size)
    surf.fill(fallback_color)
    _image_cache[cache_key] = surf
    return surf
