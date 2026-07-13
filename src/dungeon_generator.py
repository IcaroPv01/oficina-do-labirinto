import random
from src.room import Room

def generate_dungeon(num_rooms=12):
    """
    Gera uma masmorra usando a lógica Branching do Shattered PD adaptada para salas Zelda-like.
    Retorna (grid_dict, start_room)
    """
    grid = {}
    
    # 1. Sala inicial no centro da grade
    start_x, start_y = 0, 0
    start_room = Room(start_x, start_y, 'start')
    grid[(start_x, start_y)] = start_room
    
    rooms_placed = 1
    
    # 2. Posicionamento por Ramificação (Branching/Random Walk adaptado do SPD)
    while rooms_placed < num_rooms:
        # Escolhe uma sala existente aleatória
        existing_coords = list(grid.keys())
        cx, cy = random.choice(existing_coords)
        
        # Escolhe uma direção
        direction = random.choice(['top', 'bottom', 'left', 'right'])
        nx, ny = cx, cy
        
        if direction == 'top': ny -= 1
        elif direction == 'bottom': ny += 1
        elif direction == 'left': nx -= 1
        elif direction == 'right': nx += 1
        
        # Verifica se o espaço está vazio
        if (nx, ny) not in grid:
            new_room = Room(nx, ny, 'normal')
            grid[(nx, ny)] = new_room
            
            # Conecta as salas logicamente
            grid[(cx, cy)].connections[direction] = new_room
            
            opposite = {'top': 'bottom', 'bottom': 'top', 'left': 'right', 'right': 'left'}
            new_room.connections[opposite[direction]] = grid[(cx, cy)]
            
            rooms_placed += 1

    # 3. Designa salas especiais (Chefe, Loja, Tesouro) nas pontas mais distantes (Folhas da árvore)
    # Encontra folhas (salas com apenas 1 conexão) excluindo a start_room
    leaves = [pos for pos, r in grid.items() if len(r.connections) == 1 and r != start_room]
    
    # Se não houver folhas suficientes, pegamos qualquer sala distante
    coords = list(grid.keys())
    coords.remove((start_x, start_y))
    coords.sort(key=lambda p: abs(p[0]) + abs(p[1]), reverse=True)
    
    boss_pos = leaves[0] if len(leaves) > 0 else coords[0]
    grid[boss_pos].room_type = 'boss'
    
    shop_pos = leaves[1] if len(leaves) > 1 else coords[1]
    grid[shop_pos].room_type = 'shop'
    
    treasure_pos = leaves[2] if len(leaves) > 2 else coords[2]
    grid[treasure_pos].room_type = 'treasure'

    # 4. Finalmente, manda cada sala gerar seu layout físico de blocos e entidades
    for r in grid.values():
        r.generate_layout()
        
    return grid, start_room
