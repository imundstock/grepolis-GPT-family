(function () {
  'use strict';
  const uw = window;

  // =======================
  // Estado / Constantes ACP
  // =======================
  const state = {
    running: false,
    mode: 'burst',         // 'burst' | 'continuous'
    intervalMs: 5000,
    burstCount: 10,
    targetId: 0,
    selectedGod: 'zeus',
    selectedPower: 'divine_sign',
    timer: null,
    roundRobinIdx: 0,
    powerMap: null
  };

  const KNOWN_COSTS = { divine_sign: 50, patroness: 60, kingly_gift: 25 };
  const NEGATIVE_SET = new Set(['bolt', 'earthquake', 'pest', 'illusion']);
  let MAX_FAVOR_PER_GOD = 500;
  let MIN_GAP_NEGATIVE_MS = 1500;

  // ==========
  // Helpers
  // ==========
  const el = (id) => document.getElementById(id);
  const toNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const nowHMS = () => new Date().toLocaleTimeString();
  function log(msg) {
    const logEl = el('acp-log');
    const line = `[${nowHMS()}] ${msg}`;
    if (logEl) logEl.textContent = `${line}\n${logEl.textContent}`.slice(0, 8000);
    console.log('[ACP]', msg);
  }

  // Aceita "172" ou "[town]172[/town]"
  function parseTargetInput(raw) {
    if (!raw) return 0;
    const s = String(raw).trim();
    const tagMatch = s.match(/\[town\]\s*(\d+)\s*\[\/town\]/i);
    if (tagMatch) return Number(tagMatch[1]);
    const numMatch = s.match(/\d+/);
    if (numMatch) return Number(numMatch[0]);
    return 0;
  }

  // ================
  // Integração jogo
  // ================
  function listTowns() {
    const out = [];
    try {
      const tCol = uw.ITowns?.towns?._objects || uw.ITowns?.getTowns?.();
      const arr = Array.isArray(tCol) ? tCol : tCol ? Object.values(tCol) : [];
      for (const t of arr) {
        const id = t?.id ?? t?.getId?.();
        const name = t?.name ?? t?.getName?.();
        const god = typeof t?.god === 'function' ? t.god() : t?.god;
        if (id) out.push({ id, name, god });
      }
    } catch {}
    return out;
  }

  function getTownById(id) {
    try {
      if (typeof uw.ITowns?.getTown === 'function') return uw.ITowns.getTown(id);
      const tCol = uw.ITowns?.towns?._objects || uw.ITowns?.getTowns?.();
      if (tCol) return Array.isArray(tCol) ? tCol.find(t => (t.id ?? t.getId?.()) === id) : tCol[id];
    } catch {}
    return null;
  }

  function getPowerCostFromGame(powerId) {
    try {
      const gp = uw.GameData?.powers; const meta = gp && gp[powerId];
      if (meta && typeof meta.favor === 'number') return meta.favor;
    } catch {}
    return null;
  }

  function getPowerCostResolved(powerId) {
    for (const god of Object.keys(state.powerMap || {})) {
      const found = (state.powerMap[god] || []).find(p => p.id === powerId);
      if (found && found.cost != null) return Number(found.cost);
    }
    const fromGame = getPowerCostFromGame(powerId);
    if (fromGame != null) return fromGame;
    if (powerId in KNOWN_COSTS) return KNOWN_COSTS[powerId];
    return null;
  }

  function getTownFavorForGod(townObj, god) {
    try {
      if (!townObj) return null;
      if (typeof townObj.gods_favor === 'function') {
        const f = townObj.gods_favor();
        if (f && god in f) return Number(f[god]);
      }
      if (townObj.resources?.favor && god) {
        const byGod = townObj.resources.favor_by_god || townObj.resources.favorByGod;
        if (byGod && god in byGod) return Number(byGod[god]);
      }
    } catch {}
    return null;
  }

  function findSourceTownForPower(god, requireFavor = false, powerId = null) {
    const towns = listTowns().filter(t => t.god === god);
    if (!towns.length) return null;

    state.roundRobinIdx = (state.roundRobinIdx + 1) % towns.length;
    const ordered = [...towns.slice(state.roundRobinIdx), ...towns.slice(0, state.roundRobinIdx)];

    if (!requireFavor) return ordered[0];

    const cost = powerId ? getPowerCostResolved(powerId) : null;
    for (const t of ordered) {
      const tobj = getTownById(t.id);
      const favor = getTownFavorForGod(tobj, god);
      if (favor == null || cost == null) return t;
      if (favor >= cost) return t;
    }
    return ordered[0];
  }

  // =================
  // Disparo do poder
  // =================
  function ajaxCast(powerId, target_id, source_town_id, tag = '') {
    const payload = {
      model_url: 'CastedPowers',
      action_name: 'cast',
      captcha: null,
      arguments: { power_id: powerId, target_id: target_id },
      town_id: source_town_id,
      nl_init: true
    };
    try {
      uw.gpAjax.ajaxPost('frontend_bridge', 'execute', payload, function (resp) {
        const ok = !!(resp && (resp.success === true || resp.status === true));
        const msg = (resp && (resp.error || resp.message || resp.msg)) || (ok ? 'OK' : 'Falha');
        log(`#${tag || '-'} cast ${powerId}: src=${source_town_id} -> alvo=${target_id} | ${ok ? 'OK' : 'NOK'}: ${msg}`);
      });
    } catch (e) {
      log(`Exceção no ajaxPost: ${e && e.message ? e.message : e}`);
    }
  }

  function castOnce() {
    const { selectedGod, selectedPower, targetId } = state;
    const src = findSourceTownForPower(selectedGod, /*requireFavor*/ false, selectedPower);
    if (!src) { log(`Nenhuma cidade venerando ${selectedGod.toUpperCase()} encontrada.`); return; }
    ajaxCast(selectedPower, targetId, src.id, 'once');
  }

  // ===================
  // Power map / labels
  // ===================
  function buildPowerMap() {
    const map = {
      zeus: [
        { id: 'divine_sign', label: 'Sinal Divino' },
        { id: 'bolt', label: 'Raio' }
      ],
      poseidon: [
        { id: 'kingly_gift', label: 'Oferta Real' },
        { id: 'call_of_the_ocean', label: 'Chamado do Oceano' },
        { id: 'earthquake', label: 'Terremoto' }
      ],
      hades: [
        { id: 'pest', label: 'Peste' },
        { id: 'underworld_treasures', label: 'Tesouro do Mundo dos Mortos' }
      ],
      hera: [
        { id: 'wedding', label: 'Casamento' },
        { id: 'happiness', label: 'Felicidade' },
        { id: 'fertility_improvement', label: 'Crescimento da População' }
      ],
      athena: [
        { id: 'patroness', label: 'Deusa Patrona' },
        { id: 'town_protection', label: 'Proteção da Cidade' }
      ],
      artemis: [
        { id: 'natures_gift', label: 'Oferenda da Natureza' },
        { id: 'illusion', label: 'Ilusão' }
      ]
    };

    for (const god of Object.keys(map)) {
      map[god] = map[god].map(p => ({ ...p, cost: KNOWN_COSTS[p.id] ?? p.cost ?? null }));
    }
    try {
      const gp = uw.GameData?.powers || null;
      if (gp) {
        for (const god of Object.keys(map)) {
          map[god] = map[god].map(p => {
            const meta = gp[p.id];
            const favorFromGame = meta && typeof meta.favor === 'number' ? meta.favor : null;
            return favorFromGame != null ? { ...p, cost: favorFromGame } : p;
          });
        }
      }
    } catch {}
    state.powerMap = map;
  }

  // ====================================
  // Aceitar Recompensa — sem DOM (direto)
  // ====================================
  function claimDailyDirect(optionId) {
    try {
      const town = uw.ITowns?.getCurrentTown?.();
      const playerId = uw.Game?.player_id;
      if (!town || !playerId) {
        log('⚠️ Jogo não carregado (town/player).');
        return;
      }
      const payload = {
        model_url: `DailyLoginBonus/${playerId}`,
        action_name: 'accept',
        captcha: null,
        arguments: { option: optionId },
        town_id: town.id,
        nl_init: true
      };
      log(`Enviando accept direto (option=${optionId})…`);
      uw.gpAjax.ajaxPost('frontend_bridge', 'execute', payload, function (resp) {
        const ok = !!(resp && (resp.success === true || resp.status === true));
        const msg = (resp && (resp.error || resp.message || resp.msg)) || (ok ? 'OK' : 'Falha');
        log(`${ok ? '✅' : '❌'} accept option=${optionId}: ${msg}`);
      });
    } catch (e) {
      log('Exceção em claimDailyDirect: ' + (e && e.message ? e.message : e));
    }
  }

  // =========
  // UI Panel
  // =========
  function ensurePanel() {
    if (el('acp-panel')) return;
    buildPowerMap();

    const panel = document.createElement('div');
    panel.id = 'acp-panel';
    panel.innerHTML = `
      <div class="acp-card">
        <div class="acp-header">
          <div class="acp-title">AutoCast — Painel</div>
          <div class="acp-sub">Multi-deuses • Burst/Contínuo</div>
          <div class="acp-claim-row">
            <button id="acp-claim-favor" class="btn mini">🎁 Favor</button>
            <button id="acp-claim-res"   class="btn mini">📦 Recursos</button>
          </div>
        </div>
        <div class="acp-body">
          <div class="acp-row">
            <label>Alvo (ID da cidade)</label>
            <input id="acp-target" type="text" placeholder="Ex.: 172 ou [town]172[/town]" />
          </div>

          <div class="acp-grid2">
            <div>
              <label>Deus</label>
              <select id="acp-god"></select>
            </div>
            <div>
              <label>Poder</label>
              <select id="acp-power"></select>
            </div>
          </div>

          <div class="acp-grid2" id="acp-mode-row">
            <div>
              <label>Modo</label>
              <select id="acp-mode">
                <option value="burst">Burst (N requisições)</option>
                <option value="continuous">Contínuo (intervalo)</option>
              </select>
            </div>

            <div id="acp-mode-right">
              <div id="acp-burst-wrap">
                <label>Quantidade (Burst)</label>
                <input id="acp-burst" type="number" min="1" step="1" value="10" />
                <small id="acp-burst-hint"></small>
              </div>
              <div id="acp-interval-wrap" style="display:none;">
                <label>Intervalo (ms)</label>
                <input id="acp-interval" type="number" min="250" step="250" value="5000" />
              </div>
            </div>
          </div>

          <div class="acp-grid2">
            <button id="acp-start" class="btn">▶ Iniciar</button>
            <button id="acp-stop" class="btn" disabled>■ Parar</button>
          </div>

          <div class="acp-row">
            <button id="acp-once" class="btn">Lançar 1x agora</button>
          </div>
        </div>
        <div class="acp-log" id="acp-log">Pronto.</div>
      </div>
    `;

    // ======= PALETA PRETO/CINZA/ROXO + borda roxa 3px e botões roxos =======
    const style = document.createElement('style');
    style.textContent = `
      :root{
        --acp-bg:#000000;           /* fundo global */
        --acp-card:#1a1a1a;         /* cartas/botões base */
        --acp-ink:#e6e6ea;          /* texto */
        --acp-muted:#a7a9be;        /* texto secundário */
        --acp-brand:#6d28d9;        /* roxo principal (hover/realce) */
        --acp-brand-weak:rgba(109,40,217,.16);
        --acp-brand-strong:#4c1d95; /* roxo escuro (base dos botões/borda) */
        --acp-border:#2c2c2c;       /* borda neutra */
      }

      #acp-panel{
        position:fixed; top:70px; right:450px; z-index:99999; width:600px;
        font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,sans-serif; color:var(--acp-ink);
      }
      .acp-card{
        background:var(--acp-card);
        border:3px solid var(--acp-brand-strong); /* linha roxa 3px ao redor do painel */
        border-radius:12px;
        box-shadow:0 6px 20px rgba(0,0,0,.35);
        overflow:hidden;
      }
      .acp-header{
        padding:12px 14px; border-bottom:1px solid var(--acp-border);
        background:linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0));
      }
      .acp-title{ font-weight:800; font-size:16px; letter-spacing:.3px; }
      .acp-sub{ color:var(--acp-muted); font-size:12px; margin-top:2px; }
      .acp-claim-row{ margin-top:8px; display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .acp-claim-row .btn{ width:100%; text-align:center; }

      .acp-body{ padding:12px 14px; display:grid; gap:10px; }
      .acp-row{ display:grid; gap:6px; }
      .acp-grid2{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      #acp-mode-row{ align-items:start; }
      #acp-mode-right>div{ display:grid; gap:4px; }
      #acp-mode-row select, #acp-mode-row input{ width:100%; box-sizing:border-box; }
      #acp-burst-hint{ font-size:11px; color:var(--acp-muted); display:block; }

      label{ font-size:12px; color:var(--acp-muted); }

      input, select{
        padding:8px 10px; border-radius:8px; border:1px solid var(--acp-border);
        background:#0f1117; color:var(--acp-ink); outline:none;
        transition:border-color .2s ease, box-shadow .2s ease;
      }
      input:focus, select:focus{
        border-color:var(--acp-brand-strong);
        box-shadow:0 0 0 3px var(--acp-brand-weak);
      }

      /* Botão base neutro (cinza escuro) */
      .btn{
        padding:10px; border-radius:8px; font-weight:800; cursor:pointer;
        border:1px solid var(--acp-border); background:#12121a; color:var(--acp-ink);
        transition:transform .08s ease, box-shadow .15s ease, border-color .15s ease, background .15s ease, opacity .15s ease;
        text-shadow:0 1px 1px rgba(0,0,0,.3);
      }
      .btn:hover{ transform:translateY(-1px); border-color:var(--acp-brand-strong); box-shadow:0 0 0 3px var(--acp-brand-weak); }
      .btn:disabled{ opacity:.55; cursor:not-allowed; transform:none; box-shadow:none; }

      /* Botões principais (Iniciar, Parar, Lançar 1x) em roxo escuro */
      #acp-start, #acp-stop, #acp-once{
        background:var(--acp-brand-strong);
        color:#f5f3ff;
        border-color:transparent;
      }
      #acp-start:hover, #acp-stop:hover, #acp-once:hover{
        background:var(--acp-brand);
        box-shadow:0 0 0 3px var(--acp-brand-weak);
      }

      /* Botões mini (recompensa) neutros */
      .btn.mini{ font-size:12px; padding:6px; background:#12121a; color:var(--acp-ink); }

      .acp-log{
        padding:10px 12px; font-size:12px; border-top:1px solid var(--acp-border);
        max-height:160px; overflow:auto; background:#0b0b11; color:var(--acp-ink); white-space:pre-wrap;
      }
    `;

    document.body.appendChild(panel);
    document.head.appendChild(style);

    // Popular selects
    const godSel = el('acp-god');
    const powerSel = el('acp-power');
    for (const god of Object.keys(state.powerMap)) {
      const opt = document.createElement('option');
      opt.value = god; opt.textContent = god.toUpperCase();
      godSel.appendChild(opt);
    }

    function refreshPowers() {
      const god = godSel.value;
      powerSel.innerHTML = '';
      const powers = state.powerMap[god] || [];
      for (const p of powers) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.label || p.id;
        powerSel.appendChild(opt);
      }
      if (powers[0]) state.selectedPower = powers[0].id;
    }

    godSel.value = state.selectedGod;
    refreshPowers();

    // Handlers de seleção
    godSel.addEventListener('change', () => {
      state.selectedGod = godSel.value;
      refreshPowers();
      updateBurstHint();
    });

    powerSel.addEventListener('change', () => {
      state.selectedPower = powerSel.value;
      updateBurstHint();
    });

    const modeSel = el('acp-mode');
    const burstWrap = el('acp-burst-wrap');
    const intWrap = el('acp-interval-wrap');
    modeSel.addEventListener('change', () => {
      state.mode = modeSel.value;
      if (state.mode === 'burst') {
        burstWrap.style.display = '';
        intWrap.style.display = 'none';
      } else {
        burstWrap.style.display = 'none';
        intWrap.style.display = '';
      }
      updateBurstHint();
    });

    // Botões principais
    el('acp-start').addEventListener('click', start);
    el('acp-stop').addEventListener('click', stop);
    el('acp-once').addEventListener('click', () => { readInputs(); if (!preChecks()) return; castOnce(); });

    // Botões de recompensa (sem DOM)
    el('acp-claim-favor').addEventListener('click', () => claimDailyDirect(1));
    el('acp-claim-res').addEventListener('click', () => claimDailyDirect(0));

    // Dica/sugestão de burst
    function updateBurstHint() {
      const hint = el('acp-burst-hint');
      if (state.mode !== 'burst') { if (hint) hint.textContent = ''; return; }
      const cost = getPowerCostResolved(state.selectedPower);
      if (cost && cost > 0) {
        const maxCasts = Math.max(1, Math.floor(MAX_FAVOR_PER_GOD / cost));
        el('acp-burst').value = String(maxCasts);
        if (hint) hint.textContent = `Custo ${cost} favor → sugestão: ${maxCasts}x (base ${MAX_FAVOR_PER_GOD})`;
      } else if (hint) {
        hint.textContent = '';
      }
    }
    updateBurstHint();
    log('Painel pronto.');
  }

  // ===========
  // Ações
  // ===========
  function readInputs() {
    state.targetId = parseTargetInput(el('acp-target').value);
    state.mode = el('acp-mode').value;
    state.burstCount = Math.max(1, toNum(el('acp-burst').value, 10));
    state.intervalMs = Math.max(250, toNum(el('acp-interval').value, 5000));
    state.selectedGod = el('acp-god').value;
    state.selectedPower = el('acp-power').value;
  }

  function preChecks() {
    if (!uw.ITowns || !uw.ITowns.getCurrentTown || !uw.gpAjax?.ajaxPost) { log('Jogo não carregado.'); return false; }
    if (!state.targetId) { log('Informe o ID do alvo (ex.: 172 ou [town]172[/town]).'); return false; }
    return true;
  }

  function start() {
    if (state.running) { log('Já está rodando.'); return; }
    readInputs();
    if (!preChecks()) return;

    state.running = true;
    el('acp-start').disabled = true;
    el('acp-stop').disabled = false;

    if (state.mode === 'burst') {
      const isNegative = NEGATIVE_SET.has(state.selectedPower);
      const gap = isNegative ? MIN_GAP_NEGATIVE_MS : 5;
      log(`Burst: ${state.burstCount}x ${state.selectedPower} (${state.selectedGod})${isNegative ? ' • negativo, com espaçamento' : ''}…`);
      for (let i = 1; i <= state.burstCount; i++) {
        setTimeout(() => {
          const src = findSourceTownForPower(state.selectedGod, false, state.selectedPower);
          if (!src) { log(`Sem cidade-fonte para ${state.selectedGod}.`); return; }
          ajaxCast(state.selectedPower, state.targetId, src.id, i);
        }, i * gap);
      }
      const totalGap = state.burstCount * (isNegative ? MIN_GAP_NEGATIVE_MS : 5) + 200;
      setTimeout(() => { log('Burst concluído.'); stop(); }, totalGap);
    } else {
      log(`Contínuo: tentando lançar ${state.selectedPower} (${state.selectedGod}) no alvo ${state.targetId} a cada ${state.intervalMs} ms…`);
      state.timer = setInterval(() => {
        const src = findSourceTownForPower(state.selectedGod, false, state.selectedPower);
        if (!src) { log(`Sem cidade-fonte para ${state.selectedGod}.`); return; }
        ajaxCast(state.selectedPower, state.targetId, src.id, 'tick');
      }, state.intervalMs);
    }
  }

  function stop() {
    if (!state.running) return;
    state.running = false;
    el('acp-start').disabled = false;
    el('acp-stop').disabled = true;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    log('Parado.');
  }

  // ===========
  // Boot
  // ===========
  const boot = setInterval(() => {
    if (typeof uw.ITowns !== 'undefined' && uw.ITowns.getCurrentTown && uw.gpAjax?.ajaxPost) {
      clearInterval(boot);
      ensurePanel();
    }
  }, 600);

})();
