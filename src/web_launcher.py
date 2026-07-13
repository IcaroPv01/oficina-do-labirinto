import os
import json
import subprocess
import shutil
import webbrowser
from flask import Flask, render_template, request, jsonify, send_from_directory

app = Flask(__name__, template_folder="web/templates", static_folder="web/static")

# Configurações de diretório
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODS_DIR = os.path.join(BASE_DIR, "mods")
ACTIVE_MOD = "default"
MOD_PATH = os.path.join(MODS_DIR, ACTIVE_MOD)

def get_settings():
    settings_file = os.path.join(MOD_PATH, "settings.json")
    if os.path.exists(settings_file):
        with open(settings_file, "r") as f:
            return json.load(f)
    return {}

def save_settings(settings):
    os.makedirs(MOD_PATH, exist_ok=True)
    with open(os.path.join(MOD_PATH, "settings.json"), "w") as f:
        json.dump(settings, f, indent=4)

@app.route("/")
def index():
    return render_template("index.html")

# --- ENDPOINTS DE IMAGENS ---
@app.route("/api/skins/<category>")
def get_skins(category):
    # category = 'player' or 'enemies'
    folder = os.path.join(MOD_PATH, "skins", category)
    if not os.path.exists(folder):
        return jsonify([])
        
    skins = []
    for f in os.listdir(folder):
        if f.lower().endswith((".png", ".jpg")):
            skins.append(f)
    return jsonify(skins)

@app.route("/assets/<category>/<filename>")
def serve_image(category, filename):
    folder = os.path.join(MOD_PATH, "skins", category)
    return send_from_directory(folder, filename)

@app.route("/api/set_skin", methods=["POST"])
def set_skin():
    data = request.json
    category = data.get("category")
    filename = data.get("filename")
    
    settings = get_settings()
    if category == "player":
        settings["player_skin"] = filename
    elif category == "enemies":
        settings["enemy_skin"] = filename
    save_settings(settings)
    
    return jsonify({"success": True, "message": "Skin selecionada com sucesso."})

@app.route("/api/get_current_skin/<category>")
def get_current_skin(category):
    settings = get_settings()
    if category == "player":
        return jsonify({"filename": settings.get("player_skin")})
    return jsonify({"filename": settings.get("enemy_skin")})

# --- PIXEL SNAP (RUST) ---
@app.route("/api/pixel_snap", methods=["POST"])
def pixel_snap():
    data = request.json
    filename = data.get("filename")
    category = data.get("category", "player")
    
    if not filename:
        return jsonify({"success": False, "message": "Nenhum arquivo especificado."})
        
    filepath = os.path.join(MOD_PATH, "skins", category, filename)
    rust_binary = r"C:\Users\i.venzon\.gemini\antigravity\brain\06d206fd-14c8-4958-904d-09d0e7085a6f\scratch\snapper\target\release\spritefusion-pixel-snapper.exe"
    
    if not os.path.exists(rust_binary):
        return jsonify({"success": False, "message": "Binário do Pixel Snapper não encontrado."})
        
    # Salva original como backup
    backup_path = filepath + ".bak"
    if not os.path.exists(backup_path):
        shutil.copy2(filepath, backup_path)
        
    temp_output = filepath + ".tmp.png"
    
    try:
        subprocess.run([rust_binary, filepath, temp_output], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        if os.path.exists(temp_output):
            shutil.move(temp_output, filepath)
            return jsonify({"success": True, "message": "Imagem tratada com Pixel Snapper!"})
        else:
            return jsonify({"success": False, "message": "Falha: Arquivo temporário não gerado."})
    except Exception as e:
        return jsonify({"success": False, "message": f"Erro no binário: {str(e)}"})

# --- EVENTOS NO-CODE ---
@app.route("/api/events", methods=["GET"])
def get_events():
    events_file = os.path.join(MOD_PATH, "events.json")
    if os.path.exists(events_file):
        with open(events_file, "r", encoding="utf-8") as f:
            return jsonify({"content": f.read()})
    
    default_json = '{\n  "events": [\n    {\n      "conditions": [\n        {\n          "type": "PropertyCompare",\n          "parameters": {"entity_id": "Player", "property": "health", "operator": "<=", "value": 0}\n        }\n      ],\n      "actions": [\n        {\n          "type": "SetProperty",\n          "parameters": {"entity_id": "Game", "property": "state", "value": "GAME_OVER"}\n        }\n      ]\n    }\n  ]\n}'
    return jsonify({"content": default_json})

@app.route("/api/events", methods=["POST"])
def save_events():
    data = request.json
    content = data.get("content")
    events_file = os.path.join(MOD_PATH, "events.json")
    
    try:
        # Validate JSON
        json.loads(content)
        with open(events_file, "w", encoding="utf-8") as f:
            f.write(content)
        return jsonify({"success": True, "message": "Lógica No-Code salva e injetada no Pygame!"})
    except Exception as e:
        return jsonify({"success": False, "message": f"JSON Inválido: {str(e)}"})

# --- PLAY ---
@app.route("/api/play", methods=["POST"])
def play_game():
    try:
        # Roda como subprocesso independente
        subprocess.Popen(["python", "-m", "src.main"], cwd=BASE_DIR)
        return jsonify({"success": True, "message": "Engine Pygame iniciada."})
    except Exception as e:
        return jsonify({"success": False, "message": f"Erro ao rodar o jogo: {str(e)}"})

if __name__ == "__main__":
    print("=== MEGA ENGINE WEB-SERVER INICIADO ===")
    print("Abra http://127.0.0.1:5000 no seu navegador!")
    webbrowser.open("http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=True, use_reloader=False)
