(function () {
  "use strict";
  const uw = (typeof unsafeWindow === "undefined") ? window : unsafeWindow;

  // ================== CONFIG: custos de unidades (edite aqui quando quiser) ==================
  // valores por 1 unidade
  const UNIT_COSTS = {
    fundibulario: { wood: 50, stone: 90, iron: 36 },  // exemplo
    // hoplita:      { wood: X, stone: Y, iron: Z },
    // arqueiro:     { wood: X, stone: Y, iron: Z },
    // ...
  };

  // ================== Utils ==================
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

  function getCurrentTown() {
    try { return uw.ITowns?.towns?.[uw.Game?.townId] || null; } catch { return null; }
  }
  function getTownId(town){ return +(town?.getId?.() || town?.id || 0); }
  function getTownName(town){ return town?.getName?.() || town?.name || `Town#${getTownId(town)}`; }

  // Recursos atuais na cidade (robusto)
  function getTownResources(town) {
    try {
      const r = (typeof town.resources === 'function') ? town.resources()
              : (typeof town.getResources === 'function') ? town.getResources()
              : (town.resources || {});
      const wood = Number(r.wood || r.wood_value || 0);
      const stone = Number(r.stone || r.stone_value || 0);
      const iron = Number(r.iron || r.silver || r.iron_value || r.silver_value || 0);
      return { wood, stone, iron };
    } catch { return { wood:0, stone:0, iron:0 }; }
  }

  // Capacidade de carga disponível no mercado (robusto)
  function getAvailableTradeCapacity(town) {
    try {
      const byMethod = town?.getAvailableTradeCapacity?.();
      if (Number.isFinite(byMethod)) return byMethod;
    } catch {}
    try {
      const m = uw.MM?.getModelByNameAndId?.('Town', getTownId(town));
      const byAttr = m?.attributes?.available_trade_capacity;
      if (Number.isFinite(byAttr)) return byAttr;
    } catch {}
    return 0;
  }

  // Envio via gpAjax
  async function sendTrade({fromTownId, toTownId, wood, stone, iron}) {
    const data = {
      wood: Math.max(0, Math.floor(wood)||0),
      stone: Math.max(0, Math.floor(stone)||0),
      iron: Math.max(0, Math.floor(iron)||0),
      id: toTownId,            // destino
      town_id: fromTownId,     // origem
      nl_init: true
    };
    return new Promise((resolve) => {
      try {
        if (uw.gpAjax?.ajaxPost) {
          uw.gpAjax.ajaxPost("town_info", "trade", data, true, {
            success: (res)=> resolve({ok:true, res}),
            error:   (e)=> resolve({ok:false, error:e}),
            500:     ()=> resolve({ok:false, error:'500'}),
            404:     ()=> resolve({ok:false, error:'404'}),
            403:     ()=> resolve({ok:false, error:'403'}),
            0:       ()=> resolve({ok:false, error:'net'})
          });
        } else {
          console.error("[AutoEnvio] gpAjax não disponível.");
          resolve({ok:false, error:'gpAjax-missing'});
        }
      } catch (e) {
        resolve({ok:false, error:e});
      }
    });
  }

  // Calcula o pacote de envio pela capacidade e custo da unidade
  function computePayloadByUnit({cap, unitCost, stock}) {
    const costW = Number(unitCost.wood||0), costS = Number(unitCost.stone||0), costI = Number(unitCost.iron||0);
    const totalCost = costW + costS + costI;
    if (totalCost <= 0 || cap <= 0) return {mult:0, wood:0, stone:0, iron:0, totalCost};

    // limite por capacidade de mercado
    let multByCap = Math.floor(cap / totalCost);

    // limite também pelo estoque disponível (para não pedir mais do que se tem)
    const mw = costW ? Math.floor((stock.wood||0) / costW) : Infinity;
    const ms = costS ? Math.floor((stock.stone||0) / costS) : Infinity;
    const mi = costI ? Math.floor((stock.iron||0) / costI) : Infinity;
    const mult = Math.max(0, Math.min(multByCap, mw, ms, mi));

    return {
      mult,
      wood:  mult * costW,
      stone: mult * costS,
      iron:  mult * costI,
      totalCost
    };
  }

  // ================== UI ==================
  function buildPanel(){
    const css = `
      .aeu-panel{position:fixed;z-index:99999;right:14px;top:70px;background:#0f1117;color:#fff;border:2px solid #4c1d95;border-radius:12px;padding:12px;min-width:320px;font:600 12px/1.35 system-ui,Segoe UI,Roboto,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35)}
      .aeu-panel h4{margin:0 0 8px;font-size:14px}
      .aeu-panel label{display:block;margin:6px 0 2px;font-weight:700;color:#c7c9d1}
      .aeu-input{width:100%;padding:8px;border-radius:8px;border:1px solid #283044;background:#141923;color:#fff}
      .aeu-actions{display:flex;gap:8px;margin-top:10px}
      .aeu-btn{flex:1;cursor:pointer;border:1px solid #39445a;border-radius:10px;padding:8px 10px;text-align:center;background:#2b3444}
      .aeu-btn.primary{background:#6d28d9}
      .aeu-note{margin-top:8px;font-weight:400;opacity:.85}
      .aeu-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .aeu-muted{opacity:.8}
      .aeu-hr{border-top:1px solid #2a3240;margin:8px 0}
    `;
    const root = document.createElement('div');
    root.innerHTML = `<style>${css}</style>`;
    document.head.appendChild(root.firstChild);

    const panel = document.createElement('div');
    panel.className = 'aeu-panel';
    panel.innerHTML = `
      <h4>📦 Envio p/ Treino de Unidade</h4>
      <label>Cidade destino (ID)</label>
      <input id="aeu-dest" class="aeu-input" placeholder="ex.: 2050">
      <label>Unidade</label>
      <select id="aeu-unit" class="aeu-input">
        ${Object.keys(UNIT_COSTS).map(k=>`<option value="${k}">${k}</option>`).join('')}
      </select>
      <div class="aeu-hr"></div>
      <div class="aeu-row">
        <div><label>Capacidade (auto)</label><div id="aeu-cap" class="aeu-muted">—</div></div>
        <div><label>Estoque (auto)</label><div id="aeu-stock" class="aeu-muted">—</div></div>
      </div>
      <div class="aeu-row">
        <div><label>Custo unidade</label><div id="aeu-cost" class="aeu-muted">—</div></div>
        <div><label>Prévia envio</label><div id="aeu-prev" class="aeu-muted">—</div></div>
      </div>
      <div class="aeu-actions">
        <div class="aeu-btn" id="aeu-preview">Pré-visualizar</div>
        <div class="aeu-btn primary" id="aeu-send">Calcular & Enviar</div>
      </div>
      <div class="aeu-note">Origem: cidade atual. O script limita pelo estoque e pela capacidade de mercado.</div>
    `;
    document.body.appendChild(panel);

    // Eventos
    panel.querySelector('#aeu-preview').addEventListener('click', ()=> updatePreview(false));
    panel.querySelector('#aeu-send').addEventListener('click', ()=> updatePreview(true));
  }

  function fmtRes(o){ return `W:${o.wood}|S:${o.stone}|P:${o.iron}`; }

  async function updatePreview(doSend){
    const town = getCurrentTown();
    if (!town){ alert('Cidade atual indisponível.'); return; }

    const fromId = getTownId(town);
    const toId = parseInt(document.getElementById('aeu-dest').value,10);
    if (!Number.isInteger(toId) || toId<=0){ alert('Informe um ID de cidade destino válido.'); return; }

    const unitKey = String(document.getElementById('aeu-unit').value || '').trim();
    const unitCost = UNIT_COSTS[unitKey];
    if (!unitCost){ alert('Unidade desconhecida. Edite UNIT_COSTS no topo do script.'); return; }

    // obtém dados atuais
    const cap = getAvailableTradeCapacity(town);
    const stock = getTownResources(town);

    // mostra infos
    document.getElementById('aeu-cap').textContent = String(cap);
    document.getElementById('aeu-stock').textContent = fmtRes(stock);
    document.getElementById('aeu-cost').textContent = fmtRes(unitCost);

    // calcula payload
    const payload = computePayloadByUnit({cap, unitCost, stock});
    document.getElementById('aeu-prev').textContent =
      payload.mult > 0 ? `${payload.mult}x → ${fmtRes(payload)}`
                       : `não cabe / estoque insuficiente`;

    if (!doSend) return;

    if (payload.mult <= 0){
      alert('Nada a enviar: capacidade ou estoque insuficiente.');
      return;
    }

    // envia
    const resp = await sendTrade({
      fromTownId: fromId,
      toTownId: toId,
      wood: payload.wood,
      stone: payload.stone,
      iron: payload.iron
    });

    if (resp.ok){
      alert(`✅ Enviado: ${fmtRes(payload)} (${payload.mult}x ${unitKey})`);
      // refresh leve (opcional)
      try{
        const colTown = uw.MM?.getOnlyCollectionByName?.('Town');
        if (colTown?.fetch) {
          await new Promise(res => { const x = colTown.fetch({complete:res, error:res, success:res}); x?.always?.(res); });
        }
      }catch{}
    } else {
      console.warn('[Envio] Erro:', resp.error || resp.res);
      alert('❌ Falha no envio. Veja o console.');
    }
  }

  // boot
  (async function boot(){
    // aguarda objetos do jogo
    let tries=0;
    while(!(uw.ITowns && uw.ITowns.towns && uw.Game?.townId) && tries<60){ tries++; await sleep(300); }
    buildPanel();
    // pré-preencher destino com cidade atual (pra teste)
    try{ document.getElementById('aeu-dest').value = String(uw.Game?.townId || ''); }catch{}
  })();
})();
