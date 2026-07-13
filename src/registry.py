import os
import json
from src.settings import MODS_DIR, ACTIVE_MOD

class Registry:
    _instance = None
    
    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = Registry()
        return cls._instance

    def __init__(self):
        self.items = {}
        self.enemies = {}
        self.rooms = {}
        self.load_data()

    def load_data(self):
        data_dir = os.path.join(MODS_DIR, ACTIVE_MOD, "data")
        
        def load_json(filename):
            path = os.path.join(data_dir, filename)
            if not os.path.exists(path):
                print(f"Registry: Aviso - {path} não encontrado!")
                return {}
            if os.path.getsize(path) == 0:
                print(f"Registry: Aviso - {path} está vazio!")
                return {}
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"Registry: Erro ao carregar {filename}: {e}")
                return {}

        self.items = load_json("items.json")
        self.enemies = load_json("enemies.json")
        self.rooms = load_json("rooms.json")

    def get_item(self, item_id):
        return self.items.get(item_id, None)
        
    def get_enemy(self, enemy_id):
        return self.enemies.get(enemy_id, None)
        
    def get_room_pool(self, pool_id):
        return self.rooms.get(pool_id, None)
