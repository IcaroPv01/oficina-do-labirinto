document.addEventListener('DOMContentLoaded', () => {
    // Tab Switching
    const navBtns = document.querySelectorAll('.nav-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
        });
    });

    // Toast Notification
    function showToast(message, isError = false) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.style.backgroundColor = isError ? '#ef4444' : '#10b981';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // Load Skins
    async function loadSkins() {
        try {
            const currentRes = await fetch('/api/get_current_skin/player');
            const currentData = await currentRes.json();
            const currentSkin = currentData.filename;

            const res = await fetch('/api/skins/player');
            const skins = await res.json();
            
            const grid = document.getElementById('skins-grid');
            grid.innerHTML = '';
            
            skins.forEach(skin => {
                const isSelected = skin === currentSkin;
                const card = document.createElement('div');
                card.className = 'skin-card';
                card.innerHTML = `
                    <div class="skin-img-container">
                        <img src="/assets/player/${skin}?t=${new Date().getTime()}" alt="${skin}">
                    </div>
                    <div class="skin-info">
                        <div class="skin-name">${skin}</div>
                        <button class="action-btn secondary btn-select" data-file="${skin}">
                            ${isSelected ? '✅ Selecionada' : 'Selecionar'}
                        </button>
                        <button class="action-btn magic btn-snap" data-file="${skin}">
                            ✨ Pixel Snap
                        </button>
                    </div>
                `;
                grid.appendChild(card);
            });

            // Bind events
            document.querySelectorAll('.btn-select').forEach(btn => {
                btn.addEventListener('click', (e) => selectSkin(e.target.dataset.file));
            });
            document.querySelectorAll('.btn-snap').forEach(btn => {
                btn.addEventListener('click', (e) => snapSkin(e.target.dataset.file));
            });

        } catch (e) {
            console.error("Erro ao carregar skins", e);
        }
    }

    async function selectSkin(filename) {
        try {
            const res = await fetch('/api/set_skin', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({category: 'player', filename})
            });
            const data = await res.json();
            showToast(data.message, !data.success);
            loadSkins();
        } catch(e) {}
    }

    async function snapSkin(filename) {
        showToast("Processando imagem no Rust...");
        try {
            const res = await fetch('/api/pixel_snap', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({category: 'player', filename})
            });
            const data = await res.json();
            showToast(data.message, !data.success);
            loadSkins(); // Recarrega imagem corrigida
        } catch(e) {}
    }

    // Load Events
    async function loadEvents() {
        const res = await fetch('/api/events');
        const data = await res.json();
        document.getElementById('events-editor').value = data.content;
    }

    document.getElementById('btn-save-events').addEventListener('click', async () => {
        const content = document.getElementById('events-editor').value;
        try {
            const res = await fetch('/api/events', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({content})
            });
            const data = await res.json();
            showToast(data.message, !data.success);
        } catch(e) {}
    });

    // Play Game
    document.getElementById('btn-play').addEventListener('click', async () => {
        showToast("Iniciando Pygame Engine...");
        fetch('/api/play', {method: 'POST'});
    });

    // Init
    loadSkins();
    loadEvents();
});
