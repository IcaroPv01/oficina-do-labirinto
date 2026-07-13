import os
import sys

def main():
    if len(sys.argv) > 1:
        hwnd = sys.argv[1]
        os.environ['SDL_WINDOWID'] = hwnd
        print(f"Engine iniciada no HWND: {hwnd}")
        
        from src.main import main as run_game
        run_game()
    else:
        print("Erro: Nenhum HWND fornecido para a preview.")

if __name__ == '__main__':
    main()
