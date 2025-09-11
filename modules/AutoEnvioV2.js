(function () {
  'use strict';
  const uw = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;

  // ---------- Identificadores/LS ----------
  const IDS = {
    root: 'ae2-panel',
    head: 'ae2-head',
    body: 'ae2-body',
    sendList: 'ae2-send',
    recvList: 'ae2-recv',
    wood: 'ae2-wood',
    stone: 'ae2-stone',
    silver: 'ae2-silver',
    intervalMin: 'ae2-interval',
    dmin: 'ae2-delay-min',
    dmax: 'ae2-delay-max',
    start: 'ae2-start',
    stop: 'ae2-stop',
    status: 'ae2-status',
    apiBadge: 'ae2-api'
  };
  const LS = {
    send: 'ae2.send',
    recv: 'ae2.recv',
    wood: 'ae2.wood',
    stone: 'ae2.stone',
    silver: 'ae2.silver',
    interval: 'ae2.interval',
    dmin: 'ae2.dmin',
    dmax: 'ae2.dmax'
  };

  // ---------- Estado ----------
  let running = false;
  let countdownTimer = null;

  // ---------- Utils ----------
  const log = (...a) => console.log('[AER2]', ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const randi = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  function getAllPlayerTownIds() {
    const ids = new Set();
    try {
      if (uw.ITowns?.getTowns) {
        const towns = uw.ITowns.getTowns();
        // pode ser objeto indexado
        Object.keys(towns || {}).forEach(k => {
          const t = towns[k];
          const id = t?.id ?? (typeof t?.getId === 'function' ? t.getId() : null);
          if (id) ids.add(String(id));
        });
      }
      if (!ids.size && uw.Game?.towns) {
        Object.keys(uw.Game.towns).forEach(k => ids.add(String(k)));
      }
      if (!ids.size && uw.MM?.getCollections?.().Town) {
        const col = uw.MM.getCollections().Town[0] || uw.MM.getCollections().Town;
        const list = Array.isArray(col?.models) ? col.models : Array.isArray(col) ? col : [];
        list.forEach(m => { if (m?.getId) ids.add(String(m.getId())); });
      }
    } catch (e) { log('Falha ao ler cidades:', e); }
    return Array.from(ids);
  }

  function parseIds(str) {
    return String(str || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.replace(/\D/g, '')) // apenas dígitos
      .filter(Boolean);
  }

  function setText(id, txt) {
    const el = document.getElementById(id); if (el) el.textContent = txt;
  }

  function badgeAPI(ok) {
    const el = document.getElementById(IDS.apiBadge);
    if (!el) return;
    el.textContent = ok ? 'API: OK' : 'API: aguardando…';
    el.style.color = ok ? '#22c55e' : '#f59e0b';
  }

  // ---------- UI ----------
  function ensureUI() {
    if (document.getElementById(IDS.root)) return;

    const css = document.createElement('style');
    css.textContent = `
      /* TUDO escopado em #${IDS.root} */
      #${IDS.root}{
        --bg:#000000; --card:#1a1a1a; --ink:#e6e6ea; --muted:#a7a9be; --border:#2c2c2c;
        --brand:#6d28d9; --brand-strong:#4c1d95; --brand-weak:rgba(109,40,217,.16);
        position:fixed; top:88px; right:16px; z-index:100000; width:320px;
        font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,sans-serif; color:var(--ink);
      }
      #${IDS.root} .card{ background:var(--card); border:3px solid var(--brand-strong);
        border-radius:12px; box-shadow:0 6px 20px rgba(0,0,0,.35); overflow:hidden; }
      #${IDS.root} .head{ display:flex; align-items:center; justify-content:space-between;
        padding:10px 12px; font-weight:800; font-size:14px; border-bottom:1px solid var(--border);
        background:linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0)); cursor:pointer; user-select:none; }
      #${IDS.root} .badge{ font-weight:800; font-size:11px; opacity:.9 }
      #${IDS.root} .body{ padding:12px; display:grid; gap:10px; }
      #${IDS.root} .row2{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      #${IDS.root} label{ font-size:12px; color:var(--muted); font-weight:600; }
      #${IDS.root} input{
        width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--border);
        background:#0f1117; color:var(--ink); outline:none; transition:border-color .2s, box-shadow .2s;
      }
      #${IDS.root} input:focus{ border-color:var(--brand-strong); box-shadow:0 0 0 3px var(--brand-weak); }
      #${IDS.root} .btn{
        width:100%; padding:10px; border-radius:8px; font-weight:800; cursor:pointer;
        border:1px solid var(--border); background:#12121a; color:var(--ink);
        transition:transform .08s, box-shadow .15s, border-color .15s, background .15s, opacity .15s;
        text-shadow:0 1px 1px rgba(0,0,0,.3);
      }
      #${IDS.root} .btn:hover{ transform:translateY(-1px); border-color:var(--brand-strong); box-shadow:0 0 0 3px var(--brand-weak); }
      #${IDS.root} .btn:disabled{ opacity:.55; cursor:not-allowed; transform:none; box-shadow:none; }
      #${IDS.root} .btn.primary{ background:var(--brand-strong); color:#f5f3ff; border-color:transparent; }
      #${IDS.root} .btn.primary:hover{ background:var(--brand); box-shadow:0 0 0 3px var(--brand-weak); }
      #${IDS.root} .muted{ font-size:12px; color:var(--muted); }
      #${IDS.root} .min{ display:none; }
    `;
    document.head.appendChild(css);

    const root = document.createElement('div');
    root.id = IDS.root;
    root.innerHTML = `
      <div class="card">
        <div id="${IDS.head}" class="head">
          <span>Auto Envio de Recursos (v2)</span>
          <span id="${IDS.apiBadge}" class="badge">API: …</span>
        </div>
        <div id="${IDS.body}" class="body min">
          <div>
            <label>Cidades que irão enviar (IDs, vírgula) — vazio = todas</label>
            <input id="${IDS.sendList}" type="text" placeholder="ex.: 1234, 5678"/>
          </div>
          <div>
            <label>Cidades que irão receber (IDs, vírgula)</label>
            <input id="${IDS.recvList}" type="text" placeholder="ex.: 9999, 1111"/>
          </div>
          <div class="r
