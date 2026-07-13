import pygame
import sys
from src.settings import WIDTH, HEIGHT, FPS, BLACK
from src.player import Player
from src.dungeon_generator import generate_dungeon
from src.sprites import ParticleSystem, DamageNumber, SpriteRenderer
from src.obstacle import Destructible, Chest, Trapdoor
from src.pause_menu import PauseMenu
from src.main_menu import MainMenu
from src.audio import AudioEngine
from src.event_system import EventEngine, GameContext
import os
import tcod
from src.settings import MODS_DIR, ACTIVE_MOD, TILE_SIZE, COLS, ROWS

def main():
    pygame.init()
    screen = pygame.display.set_mode((WIDTH, HEIGHT))
    pygame.display.set_caption("Isaac Clone - Medieval RPG Edition")
    clock = pygame.time.Clock()
    
    grid, current_room = generate_dungeon(12)
    player = Player(WIDTH // 2, HEIGHT // 2)
    
    # Sistemas visuais
    particles = ParticleSystem()
    damage_numbers = []
    dmg_font = pygame.font.SysFont(None, 28)
    
    pause_menu = PauseMenu(WIDTH, HEIGHT)
    main_menu = MainMenu(WIDTH, HEIGHT)
    
    # Sistema de Eventos (GDevelop)
    event_engine = EventEngine()
    events_file = os.path.join(MODS_DIR, ACTIVE_MOD, "events.json")
    if os.path.exists(events_file):
        with open(events_file, "r", encoding="utf-8") as f:
            event_engine.load_from_json(f.read())
            
    game_ctx = GameContext()
    
    # Efeito de congelamento (Módulo 4)
    freeze_timer = 0.0
    
    # Ícones dos itens ativos desenhados proceduralmente para o HUD (Módulo 4)
    active_icons = {}
    
    # Ícone do Livro de Cura
    book_surf = pygame.Surface((32, 32), pygame.SRCALPHA)
    pygame.draw.rect(book_surf, (150, 20, 20), (6, 4, 20, 24), border_radius=3)
    pygame.draw.rect(book_surf, (50, 200, 50), (14, 8, 4, 16))
    pygame.draw.rect(book_surf, (50, 200, 50), (8, 14, 16, 4))
    active_icons['book_of_healing'] = book_surf

    # Ícone da Ampulheta
    hourglass_surf = pygame.Surface((32, 32), pygame.SRCALPHA)
    pygame.draw.polygon(hourglass_surf, (200, 180, 100), [(8, 4), (24, 4), (16, 16)])
    pygame.draw.polygon(hourglass_surf, (200, 180, 100), [(16, 16), (24, 28), (8, 28)])
    pygame.draw.rect(hourglass_surf, (150, 150, 250), (12, 22, 8, 5))
    active_icons['hourglass'] = hourglass_surf

    running = True
    state = "PLAYING"
    current_floor = 1
    MAX_FLOOR = 3
    
    while running:
        dt = clock.tick(FPS) / 1000.0
        
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
                
            if state == "MAIN_MENU":
                action = main_menu.handle_event(event)
                if action == "PLAYING":
                    state = "PLAYING"
                elif action == "QUIT":
                    running = False
                    
            if event.type == pygame.KEYDOWN:
                if event.key == pygame.K_r and state in ("GAME_OVER", "VICTORY"):
                    current_floor = 1
                    grid, current_room = generate_dungeon(12 + current_floor * 3)
                    player = Player(WIDTH // 2, HEIGHT // 2)
                    particles = ParticleSystem()
                    damage_numbers = []
                    freeze_timer = 0.0
                    state = "PLAYING"
                
                # Disparo de item ativo ao pressionar ESPAÇO (Módulo 4)
                if event.key == pygame.K_SPACE and state == "PLAYING":
                    if player.active_item == 'book_of_healing' and player.active_charge >= player.active_max_charge:
                        player.health = min(player.health + 2, player.max_health)
                        player.active_charge = 0
                        particles.add_heal(player.rect.centerx, player.rect.centery)
                    elif player.active_item == 'hourglass' and player.active_charge >= player.active_max_charge:
                        freeze_timer = 4.0 # Congela inimigos por 4 segundos
                        player.active_charge = 0
                        particles.add_explosion(player.rect.centerx, player.rect.centery, (100, 150, 255), 15)
                
                # Pausa
                if event.key == pygame.K_ESCAPE and state == "PLAYING":
                    state = "PAUSED"
                    pause_menu.show()
            
            if state == "PAUSED":
                action = pause_menu.handle_event(event)
                if action == "resume":
                    state = "PLAYING"
                elif action == "restart":
                    current_floor = 1
                    grid, current_room = generate_dungeon(12 + current_floor * 3)
                    player = Player(WIDTH // 2, HEIGHT // 2)
                    particles = ParticleSystem()
                    damage_numbers = []
                    freeze_timer = 0.0
                    state = "PLAYING"
                    pause_menu.hide()
                elif action == "main_menu":
                    current_floor = 1
                    grid, current_room = generate_dungeon(12 + current_floor * 3)
                    player = Player(WIDTH // 2, HEIGHT // 2)
                    particles = ParticleSystem()
                    damage_numbers = []
                    freeze_timer = 0.0
                    state = "MAIN_MENU"
                    pause_menu.hide()
                elif action == "quit":
                    running = False
                    
        if state == "PLAYING":
            # Atualiza freeze timer (Módulo 4)
            freeze_timer = max(0.0, freeze_timer - dt)
            
            # Passa Solids no lugar de Walls para colidir com obstáculos sólidos (Módulo 2)
            player.update(dt, current_room.solids)
            player.projectiles.update(dt)
            
            # Passa freeze_active para room.update ignorar movimento de inimigos (Módulo 4)
            current_room.update(dt, player, particles, freeze_active=(freeze_timer > 0.0))
            particles.update(dt)
            damage_numbers = [d for d in damage_numbers if d.update(dt)]
            
            # Player projectile collisions (optimized single pass)
            for proj in list(player.projectiles):
                if pygame.sprite.spritecollideany(proj, current_room.walls):
                    particles.add_explosion(proj.rect.centerx, proj.rect.centery, (100, 150, 255), 4)
                    proj.kill()
                    continue
                
                hit_obstacles = pygame.sprite.spritecollide(proj, current_room.obstacles, False)
                if hit_obstacles:
                    obs = hit_obstacles[0]
                    if isinstance(obs, Destructible):
                        obs.take_damage(proj.damage, current_room.pickups, particles)
                    proj.kill()
                    continue
                
                hit_enemies = pygame.sprite.spritecollide(proj, current_room.enemies, False)
                for enemy in hit_enemies:
                    if proj.is_piercing and enemy in proj.pierced_enemies:
                        continue
                    
                    enemy.take_damage(proj.damage, current_room)
                    if proj.is_poisonous:
                        enemy.poison_timer = 3.0
                    
                    particles.add_blood(enemy.rect.centerx, enemy.rect.centery)
                    damage_numbers.append(DamageNumber(enemy.rect.centerx, enemy.rect.top - 10, proj.damage))
                    
                    if proj.is_piercing:
                        proj.pierced_enemies.add(enemy)
                    else:
                        proj.kill()
                        break
                    
            # Enemy projectiles collisions (optimized single pass)
            for proj in list(current_room.enemy_projectiles):
                if proj.rect.colliderect(player.rect):
                    player.take_damage(proj.damage)
                    particles.add_blood(player.rect.centerx, player.rect.centery, 3)
                    proj.kill()
                    continue
                
                if pygame.sprite.spritecollideany(proj, current_room.walls):
                    proj.kill()
                    continue
                
                hit_obs = pygame.sprite.spritecollide(proj, current_room.obstacles, False)
                if any(isinstance(obs, (Destructible, Chest)) for obs in hit_obs):
                    proj.kill()
                    
            # Player colisão com inimigo
            for enemy in current_room.enemies:
                if player.rect.colliderect(enemy.rect):
                    player.take_damage(enemy.damage)
                    particles.add_blood(player.rect.centerx, player.rect.centery, 3)
                    direction = pygame.math.Vector2(player.rect.center) - pygame.math.Vector2(enemy.rect.center)
                    if direction.length() > 0:
                        direction = direction.normalize()
                        player.pos += direction * 30
                        player.rect.center = player.pos
                        
            # Player coleta itens (Pickups)
            hit_pickups = pygame.sprite.spritecollide(player, current_room.pickups, False)
            for p in hit_pickups:
                old_coins = player.coins
                old_health = player.health
                if p.collect(player):
                    if player.coins > old_coins:
                        particles.add_coin_sparkle(p.rect.centerx, p.rect.centery)
                    if player.health > old_health:
                        particles.add_heal(player.rect.centerx, player.rect.centery)
            
            # --- INTEGRAÇÃO DA ENGINE DE EVENTOS (GDevelop) ---
            # 1. Alimentar o contexto
            game_ctx.entities["Player"] = {"health": player.health, "state": "alive"}
            game_ctx.global_vars["state"] = state
            
            # 2. Avaliar Eventos JSON
            event_engine.update(game_ctx)
            
            # 3. Aplicar mutações de volta ao Pygame
            if game_ctx.global_vars.get("state") == "GAME_OVER" or game_ctx.entities["Player"].get("state") == "dead":
                state = "GAME_OVER"
                
            # Fallback hardcoded se o JSON não definir regra de morte
            if player.health <= 0 and state != "GAME_OVER":
                state = "GAME_OVER"
                
            # Interação com Trapdoor (Descida de andar ou Vitória)
            for obs in current_room.obstacles:
                if isinstance(obs, Trapdoor) and player.rect.colliderect(obs.rect):
                    AudioEngine.get_instance().play('door')
                    if current_floor >= MAX_FLOOR:
                        state = "VICTORY"
                    else:
                        current_floor += 1
                        grid, current_room = generate_dungeon(12 + current_floor * 3)
                        player.pos.x = WIDTH // 2
                        player.pos.y = HEIGHT // 2
                        player.rect.center = player.pos
                        particles = ParticleSystem()
                        damage_numbers = []
                    break
                
            # Enemy Drops
            for enemy in current_room.enemies:
                if enemy.health <= 0:
                    drop = enemy.roll_drops()
                    if drop:
                        current_room.pickups.add(drop)
                    particles.add_explosion(enemy.rect.centerx, enemy.rect.centery, (200, 50, 50), 12)
            
            # Transição de sala
            if current_room.cleared:
                for door in current_room.doors:
                    if player.rect.colliderect(door.rect):
                        if door.locked:
                            if player.keys > 0:
                                player.keys -= 1
                                door.locked = False
                                door.update_image()
                                particles.add_coin_sparkle(door.rect.centerx, door.rect.centery)
                                AudioEngine.get_instance().play('door')
                            else:
                                continue # Bloqueia passagem se não tiver chave
                                
                        next_room = None
                        if door.direction == 'top' and 'top' in current_room.connections:
                            next_room = current_room.connections['top']
                            player.pos.y = HEIGHT - 100
                        elif door.direction == 'bottom' and 'bottom' in current_room.connections:
                            next_room = current_room.connections['bottom']
                            player.pos.y = 100
                        elif door.direction == 'left' and 'left' in current_room.connections:
                            next_room = current_room.connections['left']
                            player.pos.x = WIDTH - 100
                        elif door.direction == 'right' and 'right' in current_room.connections:
                            next_room = current_room.connections['right']
                            player.pos.x = 100
                        
                        if next_room:
                            current_room = next_room
                            player.rect.center = player.pos
                            particles = ParticleSystem()
                            damage_numbers = []
                            AudioEngine.get_instance().play('door')
                            break

        # === RENDERIZAÇÃO ===
        screen.fill((15, 12, 10)) # Fundo escuro
        
        if state == "MAIN_MENU":
            main_menu.draw(screen)
            
        elif state == "PLAYING":
            current_room.draw(screen, current_floor)
            player.projectiles.draw(screen)
            
            # Desenha o Fog of War usando tcod
            if current_room.tcod_map:
                px = min(max(player.rect.centerx // TILE_SIZE, 0), COLS - 1)
                py = min(max(player.rect.centery // TILE_SIZE, 0), ROWS - 1)
                tcod.map.compute_fov(current_room.tcod_map, (px, py), radius=7, algorithm=tcod.FOV_BASIC)
                
                fog_surf = pygame.Surface((WIDTH, HEIGHT), pygame.SRCALPHA)
                fog_surf.fill((0, 0, 0, 230)) # Sombra densa
                
                for tx in range(COLS):
                    for ty in range(ROWS):
                        if current_room.tcod_map.fov[ty, tx]:
                            # Recorta o alpha para 0 (totalmente visível)
                            pygame.draw.rect(fog_surf, (0, 0, 0, 0), (tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE))
                
                # Efeito suave de luz ao redor do jogador
                pygame.draw.circle(fog_surf, (0, 0, 0, 0), player.rect.center, 80)
                screen.blit(fog_surf, (0, 0))
            
            SpriteRenderer.draw_shadow(screen, player.rect)
            # Desenha o player com offset centralizado
            screen.blit(player.image, (player.rect.centerx - 22, player.rect.centery - 30))
            
            # Partículas e Números de dano
            particles.draw(screen)
            for dn in damage_numbers:
                dn.draw(screen, dmg_font)
            
            # Efeito visual de congelamento de tempo (Módulo 4)
            if freeze_timer > 0.0:
                # Desenha borda azul pulsante
                pygame.draw.rect(screen, (100, 150, 255), (0, 0, WIDTH, HEIGHT), 6)
                
            # HUD
            draw_hud(screen, player, grid, current_room, active_icons, current_floor)
            
        elif state == "GAME_OVER":
            current_room.draw(screen, current_floor)
            draw_overlay(screen, "GAME OVER", (200, 30, 30), "Pressione R para reiniciar")
            
        elif state == "VICTORY":
            current_room.draw(screen, current_floor)
            draw_overlay(screen, "VITÓRIA!", (30, 200, 30), "Pressione R para jogar novamente")
            
        elif state == "PAUSED":
            current_room.draw(screen, current_floor)
            
            # Mesmo Fog of War no Pause
            if current_room.tcod_map:
                fog_surf = pygame.Surface((WIDTH, HEIGHT), pygame.SRCALPHA)
                fog_surf.fill((0, 0, 0, 230))
                for tx in range(COLS):
                    for ty in range(ROWS):
                        if current_room.tcod_map.fov[ty, tx]:
                            pygame.draw.rect(fog_surf, (0, 0, 0, 0), (tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE))
                pygame.draw.circle(fog_surf, (0, 0, 0, 0), player.rect.center, 80)
                screen.blit(fog_surf, (0, 0))
                
            player.projectiles.draw(screen)
            SpriteRenderer.draw_shadow(screen, player.rect)
            screen.blit(player.image, (player.rect.centerx - 22, player.rect.centery - 30))
            particles.draw(screen)
            for dn in damage_numbers:
                dn.draw(screen, dmg_font)
            draw_hud(screen, player, grid, current_room, active_icons, current_floor)
            
            pause_menu.draw(screen)

        pygame.display.flip()

    pygame.quit()
    return

def draw_hud(screen, player, grid, current_room, active_icons, current_floor):
    """HUD estilo Isaac com corações, moedas, chaves, slot de ativo e minimap"""
    # 1. Corações de vida (cada coração = 2 HP)
    heart_x, heart_y = 16, 12
    full_hearts = player.health // 2
    half_heart = player.health % 2
    max_hearts = player.max_health // 2
    
    for i in range(max_hearts):
        x = heart_x + i * 28
        if i < full_hearts:
            SpriteRenderer.draw_heart(screen, x, heart_y, 10)
        elif i == full_hearts and half_heart:
            SpriteRenderer.draw_heart(screen, x, heart_y, 10)
            # Metade escura
            dark = pygame.Surface((14, 28), pygame.SRCALPHA)
            dark.fill((0, 0, 0, 150))
            screen.blit(dark, (x, heart_y - 14))
        else:
            pygame.draw.circle(screen, (60, 20, 20), (x, heart_y), 8, 2)
            
    # 2. Moedas
    font = pygame.font.SysFont(None, 30)
    SpriteRenderer.draw_coin(screen, 16, 42, 8)
    coins_text = font.render(f" x{player.coins}", True, (255, 215, 0))
    screen.blit(coins_text, (28, 32))
    
    # 3. Chaves
    pygame.draw.rect(screen, (218, 165, 32), (14, 72, 4, 10))
    pygame.draw.circle(screen, (218, 165, 32), (16, 70), 5, 2)
    pygame.draw.rect(screen, (218, 165, 32), (10, 78, 4, 2))
    pygame.draw.rect(screen, (218, 165, 32), (10, 74, 4, 2))
    keys_text = font.render(f" x{player.keys}", True, (218, 165, 32))
    screen.blit(keys_text, (28, 62))
    
    # 4. Item Ativo
    box_x, box_y = 130, 8
    pygame.draw.rect(screen, (40, 40, 40), (box_x, box_y, 44, 44), border_radius=4)
    pygame.draw.rect(screen, (100, 100, 100), (box_x, box_y, 44, 44), 2, border_radius=4)
    
    if player.active_item:
        icon = active_icons.get(player.active_item)
        if icon:
            screen.blit(icon, (box_x + 6, box_y + 6))
            
        # Barra de carga do ativo
        bar_x, bar_y = box_x, box_y + 48
        bar_w, bar_h = 44, 6
        pygame.draw.rect(screen, (25, 25, 25), (bar_x, bar_y, bar_w, bar_h), border_radius=2)
        
        charge_ratio = player.active_charge / player.active_max_charge
        charge_color = (50, 255, 50) if player.active_charge == player.active_max_charge else (218, 165, 32)
        pygame.draw.rect(screen, charge_color, (bar_x, bar_y, int(bar_w * charge_ratio), bar_h), border_radius=2)
        
        # Divisórias
        for i in range(1, player.active_max_charge):
            dx = bar_x + int(bar_w * (i / player.active_max_charge))
            pygame.draw.line(screen, (0, 0, 0), (dx, bar_y), (dx, bar_y + bar_h - 1))
            
    # 5. Status Avançados e Andar
    small_font = pygame.font.SysFont(None, 22)
    stats_text = small_font.render(
        f"DMG: {player.damage:.1f}  SPD: {player.speed}  RNG: {player.range_limit}  S-SPD: {player.shot_speed}", 
        True, (180, 180, 180)
    )
    screen.blit(stats_text, (12, 94))
    
    floor_text = font.render(f"FLOOR {current_floor}", True, (200, 200, 200))
    screen.blit(floor_text, (WIDTH // 2 - floor_text.get_width() // 2, 12))
    
    # 6. Minimap
    draw_minimap(screen, grid, current_room)

def draw_minimap(screen, grid, current_room):
    map_size = 8
    padding = 10
    
    min_x = min(x for x, y in grid.keys())
    max_x = max(x for x, y in grid.keys())
    min_y = min(y for x, y in grid.keys())
    max_y = max(y for x, y in grid.keys())
    
    map_w = (max_x - min_x + 1) * (map_size + 2)
    map_h = (max_y - min_y + 1) * (map_size + 2)
    
    start_x = WIDTH - map_w - padding
    start_y = padding
    
    bg = pygame.Surface((map_w + 8, map_h + 8), pygame.SRCALPHA)
    bg.fill((0, 0, 0, 120))
    screen.blit(bg, (start_x - 4, start_y - 4))
    
    for (gx, gy), room in grid.items():
        rx = start_x + (gx - min_x) * (map_size + 2)
        ry = start_y + (gy - min_y) * (map_size + 2)
        
        if room == current_room:
            color = (255, 255, 255)
        elif room.room_type == 'boss':
            color = (200, 50, 50)
        elif room.room_type == 'shop':
            color = (50, 200, 50) # Loja agora é verde
        elif room.room_type == 'treasure':
            color = (255, 215, 0) # Tesouro é Dourado
        elif room.room_type == 'start':
            color = (100, 100, 255)
        elif room.cleared:
            color = (80, 80, 80)
        else:
            color = (50, 50, 50)
        
        pygame.draw.rect(screen, color, (rx, ry, map_size, map_size))
        
        if room == current_room:
            pygame.draw.rect(screen, (255, 255, 0), (rx - 1, ry - 1, map_size + 2, map_size + 2), 1)

def draw_overlay(screen, title, color, subtitle):
    overlay = pygame.Surface((WIDTH, HEIGHT), pygame.SRCALPHA)
    overlay.fill((0, 0, 0, 150))
    screen.blit(overlay, (0, 0))
    
    title_font = pygame.font.SysFont(None, 80)
    title_text = title_font.render(title, True, color)
    shadow = title_font.render(title, True, (0, 0, 0))
    screen.blit(shadow, (WIDTH//2 - shadow.get_width()//2 + 3, HEIGHT//2 - 40 + 3))
    screen.blit(title_text, (WIDTH//2 - title_text.get_width()//2, HEIGHT//2 - 40))
    
    sub_font = pygame.font.SysFont(None, 32)
    sub_text = sub_font.render(subtitle, True, (200, 200, 200))
    screen.blit(sub_text, (WIDTH//2 - sub_text.get_width()//2, HEIGHT//2 + 30))

if __name__ == "__main__":
    main()
