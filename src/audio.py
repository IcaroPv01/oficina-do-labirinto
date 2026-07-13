import pygame
import os

class AudioEngine:
    _instance = None
    
    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = AudioEngine()
        return cls._instance

    def __init__(self):
        # Evita erro se o mixer já foi iniciado no main
        if not pygame.mixer.get_init():
            pygame.mixer.init()
            
        self.sounds = {}
        self.base_path = os.path.join("assets", "sounds")
        self.load_sounds()

    def load_sounds(self):
        try:
            self.sounds['shoot'] = pygame.mixer.Sound(os.path.join(self.base_path, "shoot.wav"))
            self.sounds['shoot'].set_volume(0.2)
            
            self.sounds['hit'] = pygame.mixer.Sound(os.path.join(self.base_path, "hit.wav"))
            self.sounds['hit'].set_volume(0.3)
            
            self.sounds['hurt'] = pygame.mixer.Sound(os.path.join(self.base_path, "hurt.wav"))
            self.sounds['hurt'].set_volume(0.4)
            
            self.sounds['coin'] = pygame.mixer.Sound(os.path.join(self.base_path, "coin.wav"))
            self.sounds['coin'].set_volume(0.4)
            
            self.sounds['door'] = pygame.mixer.Sound(os.path.join(self.base_path, "door.wav"))
            self.sounds['door'].set_volume(0.5)
            
        except Exception as e:
            print("AudioEngine: Falha ao carregar sons.", e)

    def play(self, sound_name):
        if sound_name in self.sounds:
            self.sounds[sound_name].play()
