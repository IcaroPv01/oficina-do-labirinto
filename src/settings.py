import os
import sys

# Screen dimensions
TILE_SIZE = 64
COLS = 15
ROWS = 9
WIDTH = TILE_SIZE * COLS # 960
HEIGHT = TILE_SIZE * ROWS # 576
FPS = 60

# Colors (Fallback)
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
RED = (255, 0, 0)
BLUE = (0, 0, 255)
GREEN = (0, 255, 0)
GRAY = (128, 128, 128)
BROWN = (139, 69, 19)
YELLOW = (255, 255, 0)

# Directories
if getattr(sys, 'frozen', False):
    # Se compilado como .exe, procura a pasta mods no diretório real do executável
    BASE_DIR = os.path.dirname(sys.executable)
else:
    # Se rodando do código-fonte (vscode)
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
MODS_DIR = os.path.join(BASE_DIR, "mods")
ACTIVE_MOD = "default" # Nome da pasta do mod ativo

# Tenta criar a pasta padrão se não existir
os.makedirs(os.path.join(MODS_DIR, "default"), exist_ok=True)

# Gameplay config
PLAYER_SPEED = 300
PROJECTILE_SPEED = 600
PROJECTILE_COOLDOWN = 0.4
ENEMY_SPEED = 120
