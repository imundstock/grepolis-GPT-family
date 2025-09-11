(function () {
  "use strict";

  // ===== Estado =====
  var uw = (typeof unsafeWindow === "undefined") ? window : unsafeWindow;
  var envioAtivo = false;
  var interfaceMinimizada = false;
  var proximoCicloIntervalId = null;

  const LS_KEYS = {
    cidadesEnvio: "autoEnvio.cidadesEnvio",
    cidadesRecebimento: "autoEnvio.cidadesRecebimento",
    quantMadeira: "autoEnvio.quantMadeira",
    quantPedra: "autoEnvio.quantPedra",
    quantPrata: "autoEnvio.quantPrata",
    intervaloLoopMin: "autoEnvio.intervaloLoopMin",
    atrasoMinSeg: "autoEnvio.atrasoMinSeg",
    atrasoMaxSeg: "autoEnvio.atrasoMaxSeg"
  };

  // ===== Utils =====
  const timer = (ms) => new Promise((res) => setTimeout(res, ms));
  const getRandomDelay = (minMs, maxMs) =>
    Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;

  function loadValue(id, key, def = "") {
    const el = document.getElementById(id);
    const saved = localStorage.getItem(key);
    el.value = (saved !== null) ? saved : def;
    return el.value;
  }
  function saveOnChange(id, key) {
    const el = document.getElementById(id);
    el.addEventListener("change", () => localStorage.setItem(key, el.value));
  }

  // ===== Cidades do jogador =====
  function getAllPlayerTownIds() {
    const ids = [];
    try {
      if (uw.ITowns && typeof uw.ITowns.getTowns === "function") {
        const towns = uw.ITowns.getTowns();
        for (const k in towns) {
          if (!Object.prototype.hasOwnProperty.call(towns, k)) continue;
          const t = towns[k];
          const id = (t && (t.id || (typeof t.getId === "function" ? t.getId() : null)));
          if (id) ids.push(String(id));
        }
      }
      if (!ids.length && uw.Game && uw.Game.towns) {
        for (const k in uw.Game.towns) {
          if (Object.prototype.hasOwnProperty.call(uw.Game.towns, k)) ids.push(String(k));
        }
      }
      if (!ids.length && uw.MM && uw.MM.getCollections && uw.MM.getCollections().Town) {
        const col = uw.MM.getCollections().Town[0] || uw.MM.getCollections().Town;
        if (col && col.models) {
          col.models.forEach(m => { if (m && typeof m.getId === "function") ids.push(String(m.getId())); });
        } else if (Array.isArray(col)) {
          col.forEach(m => { if (m && typeof m.getId === "function") ids.push(String(m.getId())); });
        }
      }
    } catch (e) {
      console.error("Falha ao coletar cidades do jogador:", e);
    }
    return Array.from(new Set(ids));
  }

  // ===== UI =====
  function createUI() {
    // estilos (preto/cinza/roxo + borda roxa 3px)
    const style = document.createElement("style");
    style.textContent = `
      :root{
        --ae-bg:#000000;
        --ae-card:#1a1a1a;
        --ae-ink:#e6e6ea;
        --ae-muted:#a7a9be;
        --ae-border:#2c2c2c;
        --ae-brand:#6d28d9;             /* roxo para hover/foco */
        --ae-brand-strong:#4c1d95;      /* roxo escuro (base) */
        --ae-brand-weak:rgba(109,40,217,.16);
      }
      #auto-envio-recursos{
        position:fixed; top:70px; right:145px; z-index:9999; width:300px;
        font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,sans-serif;
        color:var(--ae-ink);
      }
      #auto-envio-recursos .ae-card{
        background:var(--ae-card);
        border:3px solid var(--ae-brand-strong);    /* borda roxa 3px */
        border-radius:12px;
        box-shadow:0 6px 20px rgba(0,0,0,.35);
        overflow:hidden;
      }
      #auto-envio-recursos .ae-header{
        padding:10px 12px; font-weight:800; font-size:14px; text-align:center;
        background:linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0));
        border-bottom:1px solid var(--ae-border);
        cursor:pointer; user-select:none;
      }
      #auto-envio-recursos .ae-header.active{
        background:linear-gradient(180deg, rgba(109,40,217,.25), rgba(0,0,0,0));
      }
      #auto-envio-recursos .ae-body{ padding:12px; display:grid; gap:10px; }
      #auto-envio-recursos label{ font-size:12px; color:var(--ae-muted); font-weight:600; }
      #auto-envio-recursos .ae-grid2{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      #statusProximoCiclo{ font-weight:700; color:var(--ae-ink); }

      #auto-envio-recursos input{
        width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--ae-border);
        background:#0f1117; color:var(--ae-ink); outline:none;
        transition:border-color .2s ease, box-shadow .2s ease;
      }
      #auto-envio-recursos input:focus{
        border-color:var(--ae-brand-strong);
        box-shadow:0 0 0 3px var(--ae-brand-weak);
      }

      #auto-envio-recursos .btn{
        width:100%; padding:10px; border-radius:8px; font-weight:800; cursor:pointer;
        border:1px solid var(--ae-border); background:#12121a; color:var(--ae-ink);
        transition:transform .08s ease, box-shadow .15s ease, border-color .15s ease, background .15s ease, opacity .15s ease;
        text-shadow:0 1px 1px rgba(0,0,0,.3);
      }
      #auto-envio-recursos .btn:hover{
        transform:translateY(-1px); border-color:var(--ae-brand-strong);
        box-shadow:0 0 0 3px var(--ae-brand-weak);
      }
      #auto-envio-recursos .btn:disabled{ opacity:.55; cursor:not-allowed; transform:none; box-shadow:none; }

      /* Botões principais roxos */
      #startAutoSend.btn, #stopAutoSend.btn{
        background:var(--ae-brand-strong); color:#f5f3ff; border-color:transparent;
      }
      #startAutoSend.btn:hover, #stopAutoSend.btn:hover{
        background:var(--ae-brand); box-shadow:0 0 0 3px var(--ae-brand-weak);
      }

      /* status/minimizado */
      #autoEnvioConteudo.minimized{ display:none; }
    `;
    document.head.appendChild(style);

    // container
    const container = document.createElement("div");
    container.id = "auto-envio-recursos";
    container.innerHTML = `
      <div class="ae-card">
        <div id="headerAutoEnvio" class="ae-header">Auto Envio de Recursos</div>
        <div id="autoEnvioConteudo" class="ae-body">
          <div>
            <label>Cidades que irão enviar (IDs, separadas por vírgula)</label>
            <input type="text" id="cidadesEnvio" placeholder="Vazio = todas as suas cidades"/>
          </div>

          <div>
            <label>Cidades que irão receber (IDs, separadas por vírgula)</label>
            <input type="text" id="cidadesRecebimento" />
          </div>

          <div class="ae-grid2">
            <div>
              <label>Quantidade de Madeira</label>
              <input type="number" id="quantMadeira" value="0" />
            </div>
            <div>
              <label>Quantidade de Pedra</label>
              <input type="number" id="quantPedra" value="0" />
            </div>
          </div>

          <div>
            <label>Quantidade de Prata</label>
            <input type="number" id="quantPrata" value="0" />
          </div>

          <div class="ae-grid2">
            <div style="grid-column:1/-1;">
              <label>Intervalo entre ciclos (min)</label>
              <input type="number" id="intervaloLoopMin" min="1" step="1" value="10" />
            </div>
            <div>
              <label>Atraso min (s)</label>
              <input type="number" id="atrasoMinSeg" min="0" step="1" value="1" />
            </div>
            <div>
              <label>Atraso máx (s)</label>
              <input type="number" id="atrasoMaxSeg" min="1" step="1" value="15" />
            </div>
          </div>

          <div id="statusProximoCiclo">Próximo ciclo em: --:--</div>

          <button id="startAutoSend" class="btn">Iniciar Envio</button>
          <button id="stopAutoSend" class="btn">Parar Envio</button>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    // Carrega valores salvos / defaults
    loadValue("cidadesEnvio", LS_KEYS.cidadesEnvio, "");
    loadValue("cidadesRecebimento", LS_KEYS.cidadesRecebimento, "");
    loadValue("quantMadeira", LS_KEYS.quantMadeira, "0");
    loadValue("quantPedra", LS_KEYS.quantPedra, "0");
    loadValue("quantPrata", LS_KEYS.quantPrata, "0");
    loadValue("intervaloLoopMin", LS_KEYS.intervaloLoopMin, "10");
    loadValue("atrasoMinSeg", LS_KEYS.atrasoMinSeg, "1");
    loadValue("atrasoMaxSeg", LS_KEYS.atrasoMaxSeg, "15");

    // Salva mudanças
    saveOnChange("cidadesEnvio", LS_KEYS.cidadesEnvio);
    saveOnChange("cidadesRecebimento", LS_KEYS.cidadesRecebimento);
    saveOnChange("quantMadeira", LS_KEYS.quantMadeira);
    saveOnChange("quantPedra", LS_KEYS.quantPedra);
    saveOnChange("quantPrata", LS_KEYS.quantPrata);
    saveOnChange("intervaloLoopMin", LS_KEYS.intervaloLoopMin);
    saveOnChange("atrasoMinSeg", LS_KEYS.atrasoMinSeg);
    saveOnChange("atrasoMaxSeg", LS_KEYS.atrasoMaxSeg);

    // Eventos
    document.getElementById("startAutoSend").addEventListener("click", startSending);
    document.getElementById("stopAutoSend").addEventListener("click", stopSending);
    document.getElementById("headerAutoEnvio").addEventListener("click", toggleMinimizar);
  }

  function toggleMinimizar() {
    const conteudo = document.getElementById("autoEnvioConteudo");
    interfaceMinimizada = !interfaceMinimizada;
    conteudo.classList.toggle("minimized", interfaceMinimizada);
  }

  // Salva tudo ao iniciar; ajusta UI para estado ativo
  function startSending() {
    if (envioAtivo) return;

    const cidadesEnvioVal = document.getElementById("cidadesEnvio").value.trim();
    const cidadesRecebimentoVal = document.getElementById("cidadesRecebimento").value.trim();
    const quantMadeiraVal = document.getElementById("quantMadeira").value.trim();
    const quantPedraVal = document.getElementById("quantPedra").value.trim();
    const quantPrataVal = document.getElementById("quantPrata").value.trim();
    const intervaloLoopMinVal = document.getElementById("intervaloLoopMin").value.trim();
    const atrasoMinSegVal = document.getElementById("atrasoMinSeg").value.trim();
    const atrasoMaxSegVal = document.getElementById("atrasoMaxSeg").value.trim();

    if (cidadesEnvioVal !== null)        localStorage.setItem(LS_KEYS.cidadesEnvio, cidadesEnvioVal);
    if (cidadesRecebimentoVal)           localStorage.setItem(LS_KEYS.cidadesRecebimento, cidadesRecebimentoVal);
    if (quantMadeiraVal !== "")          localStorage.setItem(LS_KEYS.quantMadeira, quantMadeiraVal);
    if (quantPedraVal !== "")            localStorage.setItem(LS_KEYS.quantPedra, quantPedraVal);
    if (quantPrataVal !== "")            localStorage.setItem(LS_KEYS.quantPrata, quantPrataVal);
    if (intervaloLoopMinVal)             localStorage.setItem(LS_KEYS.intervaloLoopMin, intervaloLoopMinVal);
    if (atrasoMinSegVal !== "")          localStorage.setItem(LS_KEYS.atrasoMinSeg, atrasoMinSegVal);
    if (atrasoMaxSegVal !== "")          localStorage.setItem(LS_KEYS.atrasoMaxSeg, atrasoMaxSegVal);

    envioAtivo = true;

    // feedback visual roxo
    document.getElementById("startAutoSend").textContent = "Enviando Recursos";
    document.getElementById("headerAutoEnvio").classList.add("active");

    executarLoopEnvio();
  }

  function stopSending() {
    envioAtivo = false;
    document.getElementById("startAutoSend").textContent = "Iniciar Envio";
    document.getElementById("headerAutoEnvio").classList.remove("active");

    if (proximoCicloIntervalId) {
      clearInterval(proximoCicloIntervalId);
      proximoCicloIntervalId = null;
    }
    document.getElementById("statusProximoCiclo").textContent = "Próximo ciclo em: --:--";
  }

  function startCountdown(msTotal) {
    const statusEl = document.getElementById("statusProximoCiclo");
    let restante = msTotal;

    if (proximoCicloIntervalId) clearInterval(proximoCicloIntervalId);

    const update = () => {
      if (!envioAtivo) return;
      restante -= 1000;
      if (restante < 0) restante = 0;
      const m = Math.floor(restante / 60000);
      const s = Math.floor((restante % 60000) / 1000);
      statusEl.textContent = `Próximo ciclo em: ${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      if (restante <= 0) {
        clearInterval(proximoCicloIntervalId);
        proximoCicloIntervalId = null;
      }
    };

    const m0 = Math.floor(msTotal / 60000);
    const s0 = Math.floor((msTotal % 60000) / 1000);
    statusEl.textContent = `Próximo ciclo em: ${String(m0).padStart(2, "0")}:${String(s0).padStart(2, "0")}`;
    proximoCicloIntervalId = setInterval(update, 1000);
  }

  async function executarLoopEnvio() {
    while (envioAtivo) {
      // Lê configs
      let cidadesEnvio = document.getElementById("cidadesEnvio").value
        .split(",").map(id => id.trim()).filter(Boolean);
      const cidadesRecebimento = document.getElementById("cidadesRecebimento").value
        .split(",").map(id => id.trim()).filter(Boolean);

      // Se vazio, usa todas as cidades do jogador
      if (!cidadesEnvio.length) {
        cidadesEnvio = getAllPlayerTownIds();
        if (cidadesEnvio.length) {
          console.log("Usando todas as cidades do jogador para ENVIO:", cidadesEnvio.join(", "));
        }
      }

      if (!cidadesRecebimento.length) {
        console.warn("Defina ao menos uma cidade de recebimento.");
        stopSending();
        break;
      }

      if (!cidadesEnvio.length) {
        console.warn("Não foi possível obter a lista de cidades do jogador. A API ainda não carregou?");
        stopSending();
        break;
      }

      const quantidadeRecursos = {
        madeira: parseInt(document.getElementById("quantMadeira").value, 10) || 0,
        pedra:   parseInt(document.getElementById("quantPedra").value, 10)   || 0,
        prata:   parseInt(document.getElementById("quantPrata").value, 10)   || 0
      };

      let intervaloMinutos = parseInt(document.getElementById("intervaloLoopMin").value, 10);
      if (isNaN(intervaloMinutos) || intervaloMinutos < 1) intervaloMinutos = 10;

      let atrasoMinSeg = Math.max(0, parseInt(document.getElementById("atrasoMinSeg").value, 10) || 0);
      let atrasoMaxSeg = Math.max(atrasoMinSeg + 1, parseInt(document.getElementById("atrasoMaxSeg").value, 10) || (atrasoMinSeg + 1));

      // Envia
      for (const envio of cidadesEnvio) {
        for (const recebimento of cidadesRecebimento) {
          const data = {
            wood: quantidadeRecursos.madeira,
            stone: quantidadeRecursos.pedra,
            iron: quantidadeRecursos.prata,
            id: recebimento,     // destino
            town_id: envio,      // origem
            nl_init: true
          };
          try {
            console.log(`Enviando recursos de ${envio} para ${recebimento}`, data);
            if (uw.gpAjax && uw.gpAjax.ajaxPost) {
              uw.gpAjax.ajaxPost("town_info", "trade", data);
            } else {
              console.error("gpAjax não disponível. A API do jogo pode não ter carregado ainda.");
            }
          } catch (e) {
            console.error("Falha no envio:", e);
          }

          const delay = getRandomDelay(atrasoMinSeg * 1000, atrasoMaxSeg * 1000);
          await timer(delay);
          if (!envioAtivo) break;
        }
        if (!envioAtivo) break;
      }

      if (!envioAtivo) break;

      const intervaloMs = intervaloMinutos * 60000;
      console.log(`Ciclo concluído. Aguardando ${intervaloMinutos} minuto(s) para reiniciar...`);
      startCountdown(intervaloMs);
      await timer(intervaloMs);
    }
  }

  // ===== Inicialização =====
  function boot() {
    try { createUI(); }
    catch (e) { console.error("Erro ao criar UI:", e); }
  }

  if (uw.$ && uw.$.Observer && uw.GameEvents && uw.GameEvents.game && uw.GameEvents.game.load) {
    $.Observer(uw.GameEvents.game.load).subscribe(() => setTimeout(boot, 1000));
  } else {
    window.addEventListener("load", () => setTimeout(boot, 1000));
  }
})();
