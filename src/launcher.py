import tkinter as tk
from tkinter import filedialog, messagebox
import shutil
from PIL import Image, ImageTk
import os
import sys
import subprocess
import webbrowser
from src.settings import MODS_DIR, ACTIVE_MOD
from src.main import main as run_game

class ModEngine(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Mod Engine & Launcher")
        self.geometry("1400x650")
        self.configure(bg="#1e1e24")
        self.resizable(False, False)
        
        # Cores Estilo Antigravity
        self.c_sidebar_bg = "#141416"
        self.c_main_bg = "#1e1e24"
        self.c_tab_selected = "#2a2b36"
        self.c_tab_hover = "#202129"
        self.c_text_active = "#ffffff"
        self.c_text_inactive = "#8e9297"
        self.c_accent_green = "#248046"
        self.c_accent_green_hover = "#2b8a4f"
        self.c_indicator = "#2f80ed" # Azul de destaque do Antigravity
        
        # Variável para rastrear a aba ativa
        self.active_tab = None
        self.tab_buttons = {}
        self.indicator_labels = {}
        
        self.setup_ui()
        self.switch_tab("Skins do Jogador")

    def setup_ui(self):
        # 1. Barra Lateral (Sidebar)
        self.sidebar = tk.Frame(self, bg=self.c_sidebar_bg, width=240, bd=0)
        self.sidebar.pack(side=tk.LEFT, fill=tk.Y)
        self.sidebar.pack_propagate(False)
        
        # Título da Barra Lateral
        lbl_brand = tk.Label(self.sidebar, text="🛠️ Mod Engine", font=("Segoe UI", 16, "bold"), 
                             bg=self.c_sidebar_bg, fg=self.c_text_active)
        lbl_brand.pack(pady=(20, 10), anchor="w", padx=20)
        
        lbl_subtitle = tk.Label(self.sidebar, text="Desenvolvimento Procedural", font=("Segoe UI", 9), 
                                bg=self.c_sidebar_bg, fg=self.c_text_inactive)
        lbl_subtitle.pack(anchor="w", padx=20, pady=(0, 20))
        
        # Separador sutil
        sep = tk.Frame(self.sidebar, bg="#202024", height=1)
        sep.pack(fill=tk.X, padx=15, pady=(0, 15))
        
        # Lista de Abas
        tabs = [
            ("Skins do Jogador", "👤"),
            ("Skins de Inimigos", "👾"),
            ("Texturas do Cenário", "🧱"),
            ("Eventos (No-Code)", "⚡"),
            ("Configurações", "⚙️")
        ]
        
        for tab_name, icon in tabs:
            self.create_tab_button(tab_name, icon)
            
        # Botão Fechar no final da barra lateral
        btn_play = tk.Button(self.sidebar, text="❌  FECHAR ENGINE", font=("Segoe UI", 12, "bold"), 
                             bg="#900c3f", fg=self.c_text_active, bd=0, 
                             activebackground="#a01c4f", activeforeground=self.c_text_active,
                             cursor="hand2", command=self.destroy)
        btn_play.pack(side=tk.BOTTOM, fill=tk.X, padx=20, pady=30, ipady=8)
        
        # 3. Painel de Preview do Pygame (Direita)
        self.preview_frame = tk.Frame(self, bg="black", width=800, height=600, bd=0)
        self.preview_frame.pack(side=tk.RIGHT, padx=20, pady=20)
        self.preview_frame.pack_propagate(False)
        
        # 2. Painel de Conteúdo Principal (Meio)
        self.main_content = tk.Frame(self, bg=self.c_main_bg, bd=0)
        self.main_content.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        # 4. Iniciar Engine Embutida via Subprocesso
        self.update()
        hwnd = self.preview_frame.winfo_id()
        
        # Inicia o jogo como um processo filho para não violar as regras de Thread do SDL2
        self.engine_process = subprocess.Popen([sys.executable, "-m", "src.preview_engine", str(hwnd)])

    def restart_engine(self):
        if hasattr(self, 'engine_process') and self.engine_process.poll() is None:
            self.engine_process.terminate()
            self.engine_process.wait()
        hwnd = self.preview_frame.winfo_id()
        self.engine_process = subprocess.Popen([sys.executable, "-m", "src.preview_engine", str(hwnd)])

    def destroy(self):
        # Garante que o jogo feche junto com o launcher
        if hasattr(self, 'engine_process') and self.engine_process.poll() is None:
            self.engine_process.terminate()
        super().destroy()

    def create_tab_button(self, name, icon):
        # Frame do botão para poder colocar o indicador azul no lado esquerdo
        btn_frame = tk.Frame(self.sidebar, bg=self.c_sidebar_bg, height=42)
        btn_frame.pack(fill=tk.X, padx=10, pady=2)
        btn_frame.pack_propagate(False)
        
        # Indicador
        indicator = tk.Frame(btn_frame, bg=self.c_sidebar_bg, width=3)
        indicator.pack(side=tk.LEFT, fill=tk.Y)
        self.indicator_labels[name] = indicator
        
        # Botão
        btn = tk.Button(btn_frame, text=f" {icon}  {name}", font=("Segoe UI", 10), 
                        bg=self.c_sidebar_bg, fg=self.c_text_inactive, bd=0, anchor="w",
                        activebackground=self.c_tab_selected, activeforeground=self.c_text_active,
                        cursor="hand2", command=lambda: self.switch_tab(name))
        btn.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(8, 0))
        
        # Efeitos de Hover
        btn.bind("<Enter>", lambda e, b=btn, n=name: self.on_tab_hover(b, n, True))
        btn.bind("<Leave>", lambda e, b=btn, n=name: self.on_tab_hover(b, n, False))
        
        self.tab_buttons[name] = btn

    def on_tab_hover(self, btn, name, is_hover):
        if self.active_tab == name:
            return
        if is_hover:
            btn.configure(bg=self.c_tab_hover)
        else:
            btn.configure(bg=self.c_sidebar_bg)

    def switch_tab(self, name):
        if self.active_tab == name:
            return
        
        # Resetar abas anteriores
        if self.active_tab:
            prev_btn = self.tab_buttons[self.active_tab]
            prev_btn.configure(bg=self.c_sidebar_bg, fg=self.c_text_inactive)
            self.indicator_labels[self.active_tab].configure(bg=self.c_sidebar_bg)
            
        self.active_tab = name
        
        # Ativar nova aba
        active_btn = self.tab_buttons[name]
        active_btn.configure(bg=self.c_tab_selected, fg=self.c_text_active)
        self.indicator_labels[name].configure(bg=self.c_indicator)
        
        # Limpar área principal
        for widget in self.main_content.winfo_children():
            widget.destroy()
            
        # Carregar conteúdo correspondente
        if name == "Skins do Jogador":
            self.load_player_skins()
        elif name == "Skins de Inimigos":
            self.load_enemy_skins()
        elif name == "Texturas do Cenário":
            self.load_scenario_skins()
        elif name == "Eventos (No-Code)":
            self.load_events_tab()
        elif name == "Configurações":
            self.load_config_tab()

    def get_status_label(self, parent, subfolder, filename):
        base_dir = os.path.join(MODS_DIR, ACTIVE_MOD)
        path = os.path.join(base_dir, subfolder, filename)
        if os.path.exists(path):
            return tk.Label(parent, text="Customizado", font=("Segoe UI", 9, "bold"), 
                            bg="#2e4053", fg="#5dade2", padx=6, pady=2)
        else:
            return tk.Label(parent, text="Padrão", font=("Segoe UI", 9, "bold"), 
                            bg="#2c3e50", fg="#95a5a6", padx=6, pady=2)

    def create_card_row(self, parent, title, subfolder, filename, description):
        card = tk.Frame(parent, bg="#24242b", bd=0)
        card.pack(fill=tk.X, pady=5, padx=20)
        
        # Thumbnail
        base_dir = os.path.join(MODS_DIR, ACTIVE_MOD)
        path = os.path.join(base_dir, subfolder, filename)
        
        if os.path.exists(path):
            thumb_frame = tk.Frame(card, bg="#24242b")
            thumb_frame.pack(side=tk.LEFT, padx=(15, 0), pady=10)
            try:
                img = Image.open(path)
                resample_method = getattr(Image, 'Resampling', Image).LANCZOS if hasattr(Image, 'Resampling') else Image.ANTIALIAS
                img = img.resize((32, 32), resample_method)
                photo = ImageTk.PhotoImage(img)
                lbl_thumb = tk.Label(thumb_frame, image=photo, bg="#24242b", highlightthickness=1, highlightbackground="#000000", cursor="hand2")
                lbl_thumb.pack()
                lbl_thumb.bind("<Button-1>", lambda e, s=subfolder, f=filename: self.select_skin(s, f))
                card.img = photo  # Evita garbage collection
            except Exception:
                pass
        
        # Coluna Ações (packed before info_frame to prevent clipping)
        action_frame = tk.Frame(card, bg="#24242b")
        action_frame.pack(side=tk.RIGHT, padx=15, fill=tk.Y, pady=12)
        
        # Status
        status = self.get_status_label(action_frame, subfolder, filename)
        status.pack(side=tk.LEFT, padx=10)
        
        if os.path.exists(path):
            btn_snap = tk.Button(action_frame, text="✨ Pixel Snap", font=("Segoe UI", 9, "bold"), 
                                 bg="#248046", fg=self.c_text_active, bd=0, cursor="hand2",
                                 activebackground="#2b8a4f", activeforeground=self.c_text_active,
                                 command=lambda: self.snap_texture(subfolder, filename))
            btn_snap.pack(side=tk.LEFT, padx=5, ipady=8, ipadx=12)
        
        # Botão Importar
        btn_imp = tk.Button(action_frame, text="Injetar PNG", font=("Segoe UI", 9, "bold"), 
                             bg="#3a3d52", fg=self.c_text_active, bd=0, cursor="hand2",
                             activebackground="#4a4d62", activeforeground=self.c_text_active,
                             command=lambda: self.select_skin(subfolder, filename))
        btn_imp.pack(side=tk.LEFT, padx=5, ipady=8, ipadx=12)

        # Coluna Info
        info_frame = tk.Frame(card, bg="#24242b")
        info_frame.pack(side=tk.LEFT, padx=15, fill=tk.BOTH, expand=True, pady=10)
        
        lbl_title = tk.Label(info_frame, text=title, font=("Segoe UI", 10, "bold"), bg="#24242b", fg=self.c_text_active)
        lbl_title.pack(anchor="w")
        
        lbl_desc = tk.Label(info_frame, text=description, font=("Segoe UI", 8), bg="#24242b", fg=self.c_text_inactive)
        lbl_desc.pack(anchor="w")

    # --- ABAS DE CONTEÚDO ---
    
    def load_player_skins(self):
        # Título do Painel
        lbl_title = tk.Label(self.main_content, text="Skins do Jogador", font=("Segoe UI", 14, "bold"), 
                             bg=self.c_main_bg, fg=self.c_text_active)
        lbl_title.pack(anchor="w", padx=20, pady=(25, 5))
        
        lbl_desc = tk.Label(self.main_content, text="Injete a spritesheet do Isaac (512x512) ou peças separadas.", 
                                font=("Segoe UI", 9), bg=self.c_main_bg, fg=self.c_text_inactive)
        lbl_desc.pack(anchor="w", padx=20, pady=(0, 20))
        
        self.create_card_row(self.main_content, "Spritesheet Completo", "player", "player_spritesheet.png", 
                             "Unified grid (512x512) com pernas e cabeças de animação.")
        self.create_card_row(self.main_content, "Cabeça Estática", "player", "player_head.png", 
                             "Imagem individual 32x32 para a cabeça do herói.")
        self.create_card_row(self.main_content, "Corpo Estático", "player", "player_body.png", 
                             "Imagem individual 32x32 para o corpo do herói.")
                             
        # Botão de Reset
        btn_reset = tk.Button(self.main_content, text="Restaurar Jogador Padrão", font=("Segoe UI", 9, "bold"), 
                              bg="#78281f", fg=self.c_text_active, bd=0, cursor="hand2",
                              activebackground="#943126", activeforeground=self.c_text_active,
                              command=self.reset_player)
        btn_reset.pack(anchor="w", padx=20, pady=25, ipady=4, ipadx=12)

    def load_enemy_skins(self):
        lbl_title = tk.Label(self.main_content, text="Skins de Inimigos", font=("Segoe UI", 14, "bold"), 
                             bg=self.c_main_bg, fg=self.c_text_active)
        lbl_title.pack(anchor="w", padx=20, pady=(25, 5))
        
        lbl_desc = tk.Label(self.main_content, text="Injete imagens customizadas para os monstros do labirinto.", 
                                font=("Segoe UI", 9), bg=self.c_main_bg, fg=self.c_text_inactive)
        lbl_desc.pack(anchor="w", padx=20, pady=(0, 20))
        
        self.create_card_row(self.main_content, "Mosca (Fly)", "enemies", "enemy.png", "Sprite do inimigo comum flutuante.")
        self.create_card_row(self.main_content, "Chefe (Boss)", "enemies", "boss.png", "Sprite do monstro gigante final.")
        
        btn_reset = tk.Button(self.main_content, text="Restaurar Inimigos Padrão", font=("Segoe UI", 9, "bold"), 
                              bg="#78281f", fg=self.c_text_active, bd=0, cursor="hand2",
                              activebackground="#943126", activeforeground=self.c_text_active,
                              command=self.reset_enemies)
        btn_reset.pack(anchor="w", padx=20, pady=25, ipady=4, ipadx=12)

    def load_scenario_skins(self):
        lbl_title = tk.Label(self.main_content, text="Texturas do Cenário & Pickups", font=("Segoe UI", 14, "bold"), 
                             bg=self.c_main_bg, fg=self.c_text_active)
        lbl_title.pack(anchor="w", padx=20, pady=(25, 5))
        
        lbl_desc = tk.Label(self.main_content, text="Modifique os tijolos, portas e itens coletáveis do jogo.", 
                                font=("Segoe UI", 9), bg=self.c_main_bg, fg=self.c_text_inactive)
        lbl_desc.pack(anchor="w", padx=20, pady=(0, 20))
        
        self.create_card_row(self.main_content, "Tijolos de Parede", "world", "wall.png", "Ladrilho das paredes limitadoras.")
        self.create_card_row(self.main_content, "Porta Comum", "world", "door.png", "Textura das portas de madeira simples.")
        self.create_card_row(self.main_content, "Porta da Loja", "world", "door_shop.png", "Textura das portas douradas.")
        self.create_card_row(self.main_content, "Moeda Ouro", "items", "coin.png", "Visual das moedas dropadas por monstros.")
        self.create_card_row(self.main_content, "Coração Vermelho", "items", "heart.png", "Visual do pickup de cura.")

        btn_reset = tk.Button(self.main_content, text="Restaurar Cenário Padrão", font=("Segoe UI", 9, "bold"), 
                              bg="#78281f", fg=self.c_text_active, bd=0, cursor="hand2",
                              activebackground="#943126", activeforeground=self.c_text_active,
                              command=self.reset_scenario)
        btn_reset.pack(anchor="w", padx=20, pady=15, ipady=8, ipadx=12)

    def load_events_tab(self):
        lbl_title = tk.Label(self.main_content, text="Lógica Visual (Eventos)", font=("Segoe UI", 14, "bold"), 
                             bg=self.c_main_bg, fg=self.c_text_active)
        lbl_title.pack(anchor="w", padx=20, pady=(25, 5))
        
        lbl_desc = tk.Label(self.main_content, text="Defina as regras do jogo usando a abstração arquitetural do GDevelop.", 
                                font=("Segoe UI", 9), bg=self.c_main_bg, fg=self.c_text_inactive)
        lbl_desc.pack(anchor="w", padx=20, pady=(0, 20))
        
        frame_text = tk.Frame(self.main_content, bg="#24242b", bd=0)
        frame_text.pack(fill=tk.BOTH, expand=True, padx=20, pady=(0, 10))
        
        text_editor = tk.Text(frame_text, bg="#1e1e24", fg="#a9c4eb", font=("Consolas", 10), bd=0, insertbackground="white")
        text_editor.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        events_file = os.path.join(MODS_DIR, ACTIVE_MOD, "events.json")
        if os.path.exists(events_file):
            with open(events_file, "r", encoding="utf-8") as f:
                text_editor.insert(tk.END, f.read())
        else:
            default_json = '{\n  "events": [\n    {\n      "conditions": [\n        {\n          "type": "PropertyCompare",\n          "parameters": {"entity_id": "Player", "property": "health", "operator": "<=", "value": 0}\n        }\n      ],\n      "actions": [\n        {\n          "type": "SetProperty",\n          "parameters": {"entity_id": "Game", "property": "state", "value": "GAME_OVER"}\n        }\n      ]\n    }\n  ]\n}'
            text_editor.insert(tk.END, default_json)
            
        def save_events():
            os.makedirs(os.path.dirname(events_file), exist_ok=True)
            with open(events_file, "w", encoding="utf-8") as f:
                f.write(text_editor.get("1.0", tk.END))
            messagebox.showinfo("Sucesso", "Eventos injetados no Pygame!")
            self.restart_engine()

        btn_save = tk.Button(self.main_content, text="Injetar Lógica no Pygame", font=("Segoe UI", 9, "bold"), 
                              bg="#248046", fg=self.c_text_active, bd=0, cursor="hand2",
                              command=save_events)
        btn_save.pack(anchor="e", padx=20, pady=(0, 20), ipady=8, ipadx=12)

    def load_config_tab(self):
        lbl_title = tk.Label(self.main_content, text="Configurações & Utilitários", font=("Segoe UI", 14, "bold"), 
                             bg=self.c_main_bg, fg=self.c_text_active)
        lbl_title.pack(anchor="w", padx=20, pady=(25, 5))
        
        lbl_desc = tk.Label(self.main_content, text="Gerenciamento de diretórios de modding e arquivos do jogo.", 
                                font=("Segoe UI", 9), bg=self.c_main_bg, fg=self.c_text_inactive)
        lbl_desc.pack(anchor="w", padx=20, pady=(0, 20))
        
        # Info Box
        base_dir = os.path.join(MODS_DIR, ACTIVE_MOD)
        info_box = tk.Label(self.main_content, text=f"Pasta de Injeção Ativa:\n{base_dir}", 
                            font=("Consolas", 9), bg="#24242b", fg="#a9c4eb", bd=0,
                            justify=tk.LEFT, anchor="w", padx=20, pady=15)
        info_box.pack(fill=tk.X, padx=20, pady=5)
        
        # Botões
        btn_open = tk.Button(self.main_content, text="📂 Abrir pasta no Windows Explorer", font=("Segoe UI", 9, "bold"), 
                              bg="#3a3d52", fg=self.c_text_active, bd=0, cursor="hand2",
                              activebackground="#4a4d62", activeforeground=self.c_text_active,
                              command=self.open_explorer)
        btn_open.pack(anchor="w", padx=20, pady=15, ipady=8, ipadx=15)
        
        btn_clear_all = tk.Button(self.main_content, text="🔥 Resetar TODOS os Mods (Limpeza Completa)", font=("Segoe UI", 9, "bold"), 
                              bg="#900c3f", fg=self.c_text_active, bd=0, cursor="hand2",
                              activebackground="#a01c4f", activeforeground=self.c_text_active,
                              command=self.clear_all_mods)
        btn_clear_all.pack(anchor="w", padx=20, pady=5, ipady=8, ipadx=15)
        
        # Internet Tools
        lbl_tools = tk.Label(self.main_content, text="Ferramentas da Comunidade (Web)", font=("Segoe UI", 11, "bold"), 
                             bg=self.c_main_bg, fg=self.c_text_active)
        lbl_tools.pack(anchor="w", padx=20, pady=(20, 10))
        
        tools_frame = tk.Frame(self.main_content, bg=self.c_main_bg)
        tools_frame.pack(anchor="w", padx=20, fill=tk.X)
        
        btn_drawstic = tk.Button(tools_frame, text="🎨 Drawstic (Sprite Editor)", font=("Segoe UI", 9, "bold"), 
                              bg="#2b5c8f", fg=self.c_text_active, bd=0, cursor="hand2",
                              activebackground="#3a6ea5", activeforeground=self.c_text_active,
                              command=lambda: webbrowser.open("https://wofsauge.github.io/Drawstic/"))
        btn_drawstic.pack(side=tk.LEFT, padx=(0, 10), ipady=4, ipadx=10)
        
        btn_isaactools = tk.Button(tools_frame, text="⚙️ IsaacTools", font=("Segoe UI", 9, "bold"), 
                              bg="#2b5c8f", fg=self.c_text_active, bd=0, cursor="hand2",
                              activebackground="#3a6ea5", activeforeground=self.c_text_active,
                              command=lambda: webbrowser.open("https://wofsauge.github.io/IsaacTools/"))
        btn_isaactools.pack(side=tk.LEFT, padx=10, ipady=4, ipadx=10)

    # --- LÓGICA DE MODS ---
    
    def snap_texture(self, subfolder, filename):
        base_dir = os.path.join(MODS_DIR, ACTIVE_MOD)
        path = os.path.join(base_dir, subfolder, filename)
        if not os.path.exists(path): return
        
        # Caminho absoluto para o executável gerado pelo Cargo
        snapper_exe = r"C:\Users\i.venzon\.gemini\antigravity\brain\06d206fd-14c8-4958-904d-09d0e7085a6f\scratch\snapper\target\release\spritefusion-pixel-snapper.exe"
        
        try:
            # Chama o executável do Rust passando o input e output como o mesmo arquivo
            subprocess.run([snapper_exe, path, path], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
            self.switch_tab(self.active_tab) # Recarrega as imagens da UI
            self.restart_engine() # Hot Reload
        except Exception as e:
            messagebox.showerror("Snap Error", f"Falha ao rodar o Pixel Snapper:\n{e}")

    def select_skin(self, subfolder, target_filename):
        gallery = tk.Toplevel(self)
        gallery.title(f"Galeria de Artes: {target_filename}")
        gallery.geometry("450x350")
        gallery.configure(bg="#1e1e24")
        
        lbl = tk.Label(gallery, text="Selecione um Asset da Galeria", font=("Segoe UI", 12, "bold"), bg="#1e1e24", fg="white")
        lbl.pack(pady=15)
        
        assets_dir = os.path.join("mods", "assets", subfolder)
        frame_grid = tk.Frame(gallery, bg="#1e1e24")
        frame_grid.pack(fill=tk.BOTH, expand=True, padx=20)
        
        gallery.img_refs = []
        if not os.path.exists(assets_dir):
            tk.Label(frame_grid, text="A Galeria está vazia ou carregando...", bg="#1e1e24", fg="#8e9297").pack()
            return
            
        row, col = 0, 0
        from PIL import Image, ImageTk
        for filename in os.listdir(assets_dir):
            if filename.endswith(".png"):
                filepath = os.path.join(assets_dir, filename)
                try:
                    img = Image.open(filepath)
                    img = img.resize((48, 48), Image.Resampling.NEAREST)
                    photo = ImageTk.PhotoImage(img)
                    gallery.img_refs.append(photo)
                    
                    btn = tk.Button(frame_grid, image=photo, bg="#2a2b36", cursor="hand2", bd=0,
                                    highlightthickness=1, highlightbackground="#000000",
                                    command=lambda f=filepath: self.inject_from_gallery(f, subfolder, target_filename, gallery))
                    btn.grid(row=row, column=col, padx=8, pady=8, ipadx=4, ipady=4)
                    
                    col += 1
                    if col > 5:
                        col = 0
                        row += 1
                except:
                    pass

    def inject_from_gallery(self, filepath, subfolder, target_filename, window):
        base_dir = os.path.join(MODS_DIR, ACTIVE_MOD)
        target_dir = os.path.join(base_dir, subfolder)
        os.makedirs(target_dir, exist_ok=True)
        target_path = os.path.join(target_dir, target_filename)
        
        try:
            shutil.copy(filepath, target_path)
            
            if target_filename == "player_spritesheet.png":
                for name in ["player_head.png", "player_body.png"]:
                    p = os.path.join(target_dir, name)
                    if os.path.exists(p): os.remove(p)
            elif target_filename in ["player_head.png", "player_body.png"]:
                p = os.path.join(target_dir, "player_spritesheet.png")
                if os.path.exists(p): os.remove(p)
                
            self.switch_tab(self.active_tab)
            window.destroy()
            self.restart_engine() # Hot Reload!
        except Exception as e:
            messagebox.showerror("Erro", f"Falha ao injetar textura:\n{e}")

    def reset_player(self):
        target_dir = os.path.join(MODS_DIR, ACTIVE_MOD, "player")
        for name in ["player_spritesheet.png", "player_head.png", "player_body.png"]:
            p = os.path.join(target_dir, name)
            if os.path.exists(p): os.remove(p)
        self.switch_tab("Skins do Jogador")
        self.restart_engine()
        messagebox.showinfo("Resetado", "Skins do jogador removidas do mod ativo.")

    def reset_enemies(self):
        target_dir = os.path.join(MODS_DIR, ACTIVE_MOD, "enemies")
        for name in ["enemy.png", "boss.png"]:
            p = os.path.join(target_dir, name)
            if os.path.exists(p): os.remove(p)
        self.switch_tab("Skins de Inimigos")
        self.restart_engine()
        messagebox.showinfo("Resetado", "Skins dos inimigos removidas do mod ativo.")

    def reset_scenario(self):
        world_dir = os.path.join(MODS_DIR, ACTIVE_MOD, "world")
        items_dir = os.path.join(MODS_DIR, ACTIVE_MOD, "items")
        for name in ["wall.png", "door.png", "door_shop.png"]:
            p = os.path.join(world_dir, name)
            if os.path.exists(p): os.remove(p)
        for name in ["coin.png", "heart.png"]:
            p = os.path.join(items_dir, name)
            if os.path.exists(p): os.remove(p)
            
        self.switch_tab("Texturas do Cenário")
        self.restart_engine()
        messagebox.showinfo("Resetado", "Cenário removido do mod ativo.")

    def clear_all_mods(self):
        if messagebox.askyesno("Confirmação", "Aviso! Isto apagará todas as texturas injetadas na pasta do mod. Deseja continuar?"):
            base_dir = os.path.join(MODS_DIR, ACTIVE_MOD)
            for sub in ["player", "enemies", "items", "world"]:
                sub_dir = os.path.join(base_dir, sub)
                if os.path.exists(sub_dir):
                    for filename in os.listdir(sub_dir):
                        if filename.endswith(".png"):
                            try:
                                os.remove(os.path.join(sub_dir, filename))
                            except:
                                pass
            self.switch_tab("Configurações")
            self.restart_engine()
            messagebox.showinfo("Limpeza", "Todos os mods foram desinstalados com sucesso.")

    def open_explorer(self):
        try:
            base_dir = os.path.join(MODS_DIR, ACTIVE_MOD)
            if os.path.exists(base_dir):
                os.startfile(base_dir)
        except Exception as e:
            messagebox.showerror("Erro", f"Não foi possível abrir o Explorer:\n{e}")

    def play_game(self):
        self.destroy()
        run_game()

def run_launcher():
    app = ModEngine()
    app.mainloop()

if __name__ == "__main__":
    run_launcher()
