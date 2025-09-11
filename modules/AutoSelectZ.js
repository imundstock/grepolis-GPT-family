(function () {
  'use strict';
  const uw = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;

  const GODS = [
    { id: 'zeus',      name: 'Zeus' },
    { id: 'poseidon',  name: 'Poseidon' },
    { id: 'hera',      name: 'Hera' },
    { id: 'athena',    name: 'Atena' },
    { id: 'hades',     name: 'Hades' },
    { id: 'artemis',   name: 'Ártemis' },
    { id: 'aphrodite', name: 'Afrodite' },
    { id: 'ares',      name: 'Ares' },
  ];

  const notify = (msg) => {
    try { if (uw.HumanMessage) { new uw.HumanMessage(msg); return; } } catch(e){}
    console.log('[Selecionar Deus]', msg);
  };
  const getTown = () => (uw.ITowns && uw.ITowns.getCurrentTown) ? uw.ITowns.getCurrentTown() : null;
  const getTemple = (t) => {
    try { const b = t && t.buildings && t.buildings(); return (b && b.attributes && b.attributes.temple) || 0; }
    catch { return 0; }
  };
  const getGod = (t) => { try { return t && t.god ? t.god() || null : null; } catch { return null; } };

  function changeGod(god_id) {
    const town = getTown();
    if (!town) return notify('Cidade não encontrada.');
    if (!getTemple(town)) return notify('Esta cidade não tem Templo.');
    const data = { god_id, town_id: town.id };
    try {
      uw.gpAjax.ajaxPost('building_temple', 'change_god', data, {
        success: () => { notify(`Solicitada troca para ${god_id}.`); setTimeout(update, 800); },
        error:   () => notify('Falha ao solicitar troca de deus.')
      });
    } catch {
      uw.gpAjax.ajaxPost('building_temple', 'change_god', data);
      notify(`Solicitada troca para ${god_id}.`);
      setTimeout(update, 1000);
    }
  }

  // ---------- UI ----------
  let panel, grid;
  function build() {
    if (panel) return;

    const style = document.createElement('style');
    style.textContent = `
      :root {
        --panel-bg:            #000000;   /* fundo preto */
        --panel-card:          #1a1a1a;   /* cinza escuro */
        --panel-ink:           #e6e6ea;   /* texto claro */
        --panel-border:        #2c2c2c;   /* borda discreta interior */
        --panel-active:        #3a0a55;   /* roxo escuro para selecionado */
        --panel-brand-strong:  #4c1d95;   /* roxo escuro (borda principal de 3px) */
      }
      #gd-panel {
        position: fixed; top: 270px; right: 450px; z-index: 99999; width: 420px;
        background: var(--panel-bg); color: var(--panel-ink);
        border: 3px solid var(--panel-brand-strong); border-radius: 12px;   /* <<< borda roxa 3px */
        box-shadow: 0 6px 20px rgba(0,0,0,.35); overflow: hidden;
        font-family: system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,sans-serif;
      }
      .gd-head { padding: 10px 12px; border-bottom: 1px solid var(--panel-border);
                 background: #111; font-weight: 800; font-size: 14px; }
      .gd-body { padding: 10px 12px; }
      .gd-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .gd-btn {
        height: 56px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
        background: var(--panel-card); color: var(--panel-ink); cursor: pointer; user-select: none;
        border: 1px solid var(--panel-border); font-weight: 800; font-size: 14px;
        transition: transform .08s ease, background .2s ease, box-shadow .08s ease, border-color .2s ease;
        text-shadow: 0 1px 1px rgba(0,0,0,.4);
      }
      .gd-btn:hover   { transform: translateY(-1px); border-color: #666; box-shadow: 0 0 0 3px rgba(255,255,255,.08); }
      .gd-btn.disabled{ opacity: .4; cursor: not-allowed; box-shadow: none; }
      .gd-btn.active  { background: var(--panel-active); border-color: #5a1a7a; box-shadow: 0 0 0 2px rgba(90,26,122,.8) inset; }
    `;
    document.head.appendChild(style);

    panel = document.createElement('div');
    panel.id = 'gd-panel';
    panel.innerHTML = `
      <div class="gd-head">Selecionar Deus (cidade atual)</div>
      <div class="gd-body">
        <div class="gd-grid" id="gd-grid"></div>
      </div>
    `;
    document.body.appendChild(panel);

    grid = panel.querySelector('#gd-grid');

    GODS.forEach(g => {
      const btn = document.createElement('div');
      btn.className = 'gd-btn';
      btn.dataset.god = g.id;
      btn.textContent = g.name;
      btn.title = g.name;
      btn.addEventListener('click', () => {
        if (btn.classList.contains('disabled')) return notify('A cidade precisa de um Templo.');
        changeGod(g.id);
      });
      grid.appendChild(btn);
    });

    update();
    positionBelowACP();
    window.addEventListener('resize', positionBelowACP);
    const mo = new MutationObserver(positionBelowACP);
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  function update() {
    const town = getTown();
    const temple = getTemple(town);
    const currentGod = getGod(town);
    try {
      panel.querySelector('.gd-head').textContent = `Selecionar Deus (${town ? town.getName() : 'sem cidade'})`;
    } catch {}

    grid.querySelectorAll('.gd-btn').forEach(btn => {
      btn.classList.remove('active','disabled');
      if (!temple) btn.classList.add('disabled');
      if (btn.dataset.god === currentGod) btn.classList.add('active');
    });
  }

  function positionBelowACP() {
    const acp = document.getElementById('acp-panel');
    if (!acp || !panel) return;
    const r = acp.getBoundingClientRect();

    const cs = getComputedStyle(acp);
    const acpWidth = r.width || parseFloat(cs.width) || 420;
    panel.style.width = acpWidth + 'px';

    const right = Math.max(0, window.innerWidth - r.right);
    panel.style.right = right + 'px';

    const top = Math.max(0, window.scrollY + r.bottom + 25);
    panel.style.top = top + 'px';
  }

  function ready() {
    return (uw && uw.ITowns && uw.ITowns.getCurrentTown && uw.gpAjax?.ajaxPost);
  }
  const boot = setInterval(() => {
    if (ready()) {
      clearInterval(boot);
      build();
      setInterval(update, 3000);
    }
  }, 600);
})();
