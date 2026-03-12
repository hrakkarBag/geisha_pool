/* ══════════════════════════════════════════════
   CONFIGURACIÓN
══════════════════════════════════════════════ */
const SUPABASE_URL  = 'https://pvoafqlwevbmfmdbdjsx.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2b2FmcWx3ZXZibWZtZGJkanN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDIyOTgsImV4cCI6MjA4ODYxODI5OH0.xdv1XQiafCrVWs1ccz1K_P472pNtB-rvlQ5fdQUd51U';
const SERVER_PIN = '0213';
const NTFY_TEMA  = 'geisha-billar-k9x3';
const OPEN  = 13 * 60;   // 1:00 PM
const CLOSE = 24 * 60;   // 12:00 AM
const PX_MIN = 1;

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

/* ── Utilidades ── */
const $      = id => document.getElementById(id);
const pad    = n  => String(n).padStart(2,'0');
const today  = () => { const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const fmt    = m  => { const h=Math.floor(m/60)%24,mn=m%60,ap=h>=12?'PM':'AM',h12=h%12||12; return `${h12}:${pad(mn)} ${ap}`; };
const t2m    = t  => { const [h,m]=t.split(':').map(Number); return h*60+m; };
const nowMin = () => { const d=new Date(); return d.getHours()*60+d.getMinutes(); };
const uid    = () => Date.now()+'-'+Math.random().toString(36).slice(2,8);
const loader = v  => $('loader').classList.toggle('show', v);

function overlap(start, dur, list, skipId=null){
  const end = start + dur;
  return list.some(r => {
    if(r.id === skipId || r.estado === 'rechazado') return false;
    return start < r.inicio + r.duracion && end > r.inicio;
  });
}

/* ── BD ── */
async function fetchReservas(fecha){
  const {data, error} = await db.from('reservas').select('*').eq('fecha', fecha).order('inicio');
  if(error){ console.error('fetchReservas', error); return []; }
  return data || [];
}
async function insertReserva(r){
  const {error} = await db.from('reservas').insert(r);
  if(error) throw error;
}
async function rpc(fn, params){
  const {error} = await db.rpc(fn, params);
  if(error) throw error;
}
async function notifNtfy(r){
  try {
    await fetch('https://ntfy.sh/' + NTFY_TEMA, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Title': 'Nueva solicitud - Geisha Bar',
        'Tags': 'billiards',
        'Priority': 'default',
        'Content-Type': 'text/plain'
      },
      body: r.cliente + ' solicito ' + fmt(r.inicio) + ' - ' + fmt(r.inicio + r.duracion) + ' el ' + r.fecha + ' | Tel: ' + r.ci
    });
  } catch(e){ console.warn('ntfy:', e); }
}

/* ── Estado ── */
const ss = localStorage;
let modo    = ss.getItem('modo') || 'login';
let srvPin  = ss.getItem('srvPin') || '';
let cliente = (() => { try { return JSON.parse(ss.getItem('cliente') || 'null') || {nombre:'',ci:''}; } catch(e){ return {nombre:'',ci:''}; } })();
let fecha   = today();
let msg     = {text:'', type:''};

/* ── Realtime ── */
let rtChan   = null;
let rtStatus = 'off';

/* ── Guards de concurrencia ── */
let solicitando   = false;
let renderingApp  = false;
let pendingRender = false;

function suscribir(){
  if(rtChan) db.removeChannel(rtChan);
  rtStatus = 'connecting';
  rtChan = db.channel('reservas-changes')
    .on('postgres_changes', {event:'*', schema:'public', table:'reservas'}, payload => {
      renderApp();
      if(payload.eventType === 'INSERT') pushNotif(payload.new);
    })
    .subscribe(status => {
      if(status === 'SUBSCRIBED')                               { rtStatus = 'ok';    updateRtBadge(); }
      else if(status === 'CLOSED' || status === 'CHANNEL_ERROR'){ rtStatus = 'error'; updateRtBadge(); }
    });
}
function desuscribir(){
  if(rtChan){ db.removeChannel(rtChan); rtChan = null; }
  rtStatus = 'off';
}
function updateRtBadge(){
  const el = $('rtBadge'); if(!el) return;
  const map = { connecting:{label:'Conectando…',dot:'#d97706'}, ok:{label:'En vivo',dot:'#2ea84e'}, error:{label:'Sin Realtime',dot:'#e53e3e'} };
  const s = map[rtStatus] || map.ok;
  el.innerHTML = `${s.label}<span class="rt-dot" style="background:${s.dot}"></span>`;
}

async function pedirPermiso(){
  if('Notification' in window && Notification.permission === 'default')
    await Notification.requestPermission();
}
function pushNotif(r){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification('Nueva solicitud - Geisha Bar', {
    body: `${r.cliente} (Tel: ${r.ci}) · ${fmt(r.inicio)} - ${fmt(r.inicio+r.duracion)}`,
    icon: './icon-192.png', tag: 'res-'+r.id, renotify: true
  });
}

/* ══════════════════════════════════════════════
   LOGIN
══════════════════════════════════════════════ */
function renderLogin(){
  desuscribir();
  $('root').innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-logo"><img src="./icon-192.png" style="width:72px;height:72px;object-fit:contain;border-radius:16px" alt="Geisha Bar"></div>
        <div class="login-sub">Reserva tu mesa en segundos</div>
        <div class="login-field"><label>Nombre</label><input id="ln" placeholder="Tus nombres y apellidos" autocomplete="given-name"></div>
        <div class="login-field"><label>Telefono</label><input id="lci" placeholder="Numero de telefono" autocomplete="off" inputmode="tel"></div>
        <div class="login-btns">
          <button class="btn-login-main" id="btnIng">Ingresar</button>
          <button class="btn-login-srv" id="btnSrv">Servidor</button>
        </div>
        <div class="login-msg" id="lmsg"></div>
      </div>
      <div class="vr-card">
        <div class="vr-header">
          <span class="vr-title">📅 Disponibilidad hoy</span>
          <span class="vr-date">${today()}</span>
        </div>
        <div class="vr-legend">
          <span><i style="background:var(--pend-b)"></i> Pendiente</span>
          <span><i style="background:var(--res-b)"></i> Reservado</span>
        </div>
        <div id="vrWrap"><div class="vr-empty">Cargando…</div></div>
      </div>
    </div>`;

  fetchReservas(today()).then(r => renderVistaRapida(r)).catch(() => {
    const w = $('vrWrap'); if(w) w.innerHTML = '<div class="vr-empty">Sin conexion</div>';
  });

  $('btnIng').onclick = () => {
    const n = $('ln').value.trim(), c = $('lci').value.trim();
    if(!n || !c){ $('lmsg').textContent = 'Complete nombre y telefono.'; return; }
    cliente = {nombre:n, ci:c.toLowerCase()};
    ss.setItem('cliente', JSON.stringify(cliente));
    ss.setItem('modo', 'cliente');
    modo = 'cliente';
    renderApp();
  };
  $('btnSrv').onclick = () => {
    const pin = prompt('PIN servidor:');
    if(pin === SERVER_PIN){
      modo = 'servidor'; srvPin = pin; cliente = {nombre:'', ci:''};
      ss.setItem('srvPin', pin); ss.setItem('modo', 'servidor'); ss.removeItem('cliente');
      pedirPermiso(); suscribir(); renderApp();
    } else if(pin !== null) {
      alert('PIN incorrecto.');
    }
  };
}

/* ── Vista Rapida ── */
function renderVistaRapida(reservas){
  const wrap = $('vrWrap'); if(!wrap) return;
  const activas = reservas.filter(r => r.estado !== 'rechazado');
  if(!activas.length){
    wrap.innerHTML = '<div class="vr-empty">🟢 Mesa disponible todo el dia</div>'; return;
  }
  const VR = 0.8;
  const altura = (CLOSE - OPEN) * VR;
  let hoursHTML = '', linesHTML = '', blocksHTML = '';
  for(let h = Math.floor(OPEN/60); h < Math.floor(CLOSE/60); h++){
    const h12 = h%12||12, ap = h>=12?'PM':'AM';
    hoursHTML += `<div class="vr-hlabel" style="height:${60*VR}px">${h12}:00 ${ap}</div>`;
    linesHTML += `<div class="vr-line" style="top:${(h*60-OPEN)*VR}px"></div>`;
  }
  reservas.forEach(r => {
    const top = (r.inicio - OPEN) * VR;
    const h   = Math.max(r.duracion * VR, 18);
    const bg  = r.estado==='pendiente' ? 'var(--pend-bg)' : r.estado==='reservado' ? 'var(--res-bg)' : 'var(--rech-bg)';
    const bc  = r.estado==='pendiente' ? 'var(--pend-b)'  : r.estado==='reservado' ? 'var(--res-b)'  : 'var(--rech-b)';
    blocksHTML += `<div class="vr-block" style="top:${top}px;height:${h}px;background:${bg};border-left:3px solid ${bc}">${fmt(r.inicio)} - ${fmt(r.inicio+r.duracion)}</div>`;
  });
  wrap.innerHTML = `
    <div class="vr-mini-day">
      <div class="vr-hours">${hoursHTML}</div>
      <div class="vr-timeline" style="height:${altura}px">${linesHTML}${blocksHTML}</div>
    </div>`;
}

/* ══════════════════════════════════════════════
   APP
══════════════════════════════════════════════ */
async function renderApp(){
  if(renderingApp){ pendingRender = true; return; }
  renderingApp = true; pendingRender = false;
  try { await _renderApp(); } finally {
    renderingApp = false;
    if(pendingRender) renderApp();
  }
}

async function _renderApp(){
  const esSrv   = modo === 'servidor';
  const notifOk = 'Notification' in window && Notification.permission === 'granted';

  $('root').innerHTML = `
    <div class="app">
      <header class="app-header">
        <div class="logo"><img src="./icon-192.png" style="width:28px;height:28px;object-fit:contain;border-radius:6px;vertical-align:middle;margin-right:8px" alt="">Geisha Bar<span>/ Reservas</span></div>
        <div class="header-right">
          <input type="date" class="date-pick" id="fechaPick" value="${fecha}">
          <span class="badge-role">${esSrv ? '🔧 Servidor' : '👤 '+cliente.nombre}</span>
          ${esSrv ? `
            <span class="badge-role" id="rtBadge" style="font-size:.72rem;display:inline-flex;align-items:center;gap:4px">
              Conectando…<span class="rt-dot" style="background:#d97706"></span>
            </span>
            <button class="btn btn-gold" id="btnCheck">Verificar llegada</button>
            ${!notifOk
              ? `<button class="btn btn-gold" id="btnNotif">🔔 Activar avisos</button>`
              : `<span class="badge-role" style="font-size:.72rem">🔔 Avisos activos</span>`}
          ` : ''}
          <button class="btn btn-ghost" id="btnSalir">${esSrv ? 'Salir' : 'Cerrar sesion'}</button>
        </div>
      </header>

      ${!esSrv ? `
        <div class="form-card">
          <div class="field"><label>Hora inicio</label><input type="time" id="fHora" value="16:00" step="300"></div>
          <div class="field"><label>Duracion</label>
            <div class="dur-stepper">
              <button type="button" class="step-btn" id="durMinus">-30</button>
              <input type="number" class="step-val" id="fDur" value="60" min="15" max="660">
              <button type="button" class="step-btn" id="durPlus">+30</button>
            </div>
          </div>
          <button class="btn-submit" id="btnSolicitar">Solicitar</button>
          <div class="form-msg" id="fMsg"></div>
        </div>
      ` : `
        <div class="srv-bar">
          <button class="btn btn-primary" id="btnRefresh">↻ Actualizar</button>
          <button class="btn btn-ghost" id="btnToCliente">Vista cliente</button>
        </div>
      `}

      <div class="msg-bar ${msg.text ? 'show '+(msg.type||'') : ''}" id="msgBar">${msg.text||''}</div>

      ${!esSrv ? '<div class="list-card" id="misReservas" style="display:none"><h3><span class="dot dot-pend"></span> Mis solicitudes</h3><div id="misList"></div></div>' : ''}

      <div class="day-view">
        <div class="day-scroll">
          <div class="hours-col" id="hCol"></div>
          <div class="timeline" id="tLine"></div>
        </div>
      </div>

      ${esSrv ? `
        <div class="lists-grid">
          <div class="list-card">
            <h3><span class="dot dot-pend"></span> Pendientes</h3>
            <div id="lPend"><div class="empty">Cargando…</div></div>
          </div>
          <div class="list-card">
            <h3><span class="dot dot-res"></span> Reservados</h3>
            <div id="lRes"><div class="empty">Cargando…</div></div>
          </div>
        </div>
        <div class="list-card">
          <h3><span class="dot dot-rech"></span> Rechazadas</h3>
          <div id="lRech"><div class="empty">Cargando…</div></div>
        </div>
      ` : ''}
    </div>`;

  /* Event listeners */
  $('fechaPick').onchange = e => { fecha = e.target.value; msg = {text:'',type:''}; renderApp(); };
  $('btnSalir').onclick = () => {
    msg = {text:'', type:''};
    desuscribir();
    modo = 'login'; srvPin = ''; cliente = {nombre:'', ci:''};
    ss.removeItem('modo'); ss.removeItem('srvPin'); ss.removeItem('cliente');
    renderLogin();
  };

  if(!esSrv){
    $('btnSolicitar').onclick = solicitar;
    /* Stepper duracion */
    const calcMaxDur = () => Math.max(15, CLOSE - t2m($('fHora').value || '16:00'));
    const clampDur = () => {
      const el = $('fDur'), max = calcMaxDur();
      el.max = max;
      const v = parseInt(el.value) || 60;
      if(v > max) el.value = max;
      if(v < 15)  el.value = 15;
    };
    $('fHora').addEventListener('change', clampDur);
    $('durMinus').onclick = () => { const el=$('fDur'); el.value = Math.max(15, (parseInt(el.value)||60) - 30); };
    $('durPlus').onclick  = () => { const el=$('fDur'); el.value = Math.min(calcMaxDur(), (parseInt(el.value)||60) + 30); };
    clampDur();
  } else {
    $('btnRefresh').onclick   = () => renderApp();
    $('btnToCliente').onclick = () => { modo = 'cliente'; cliente = {nombre:'',ci:''}; ss.setItem('modo','cliente'); ss.removeItem('cliente'); renderApp(); };
    $('btnCheck').onclick     = verificarLlegada;
    if($('btnNotif')) $('btnNotif').onclick = async () => { await pedirPermiso(); renderApp(); };
    setTimeout(updateRtBadge, 100);
  }

  /* Cargar datos */
  loader(true);
  try {
    const reservas = await fetchReservas(fecha);
    renderDay(reservas);
    if(esSrv) renderListas(reservas);
    else renderMisSolicitudes(reservas);
  } catch(e){
    showMsg('Error al conectar con la base de datos.', 'err');
  } finally {
    loader(false);
  }
}

/* ── Day view ── */
function renderDay(reservas){
  const tLine = $('tLine'), hCol = $('hCol');
  if(!tLine || !hCol) return;
  tLine.style.height = ((CLOSE - OPEN) * PX_MIN) + 'px';
  tLine.innerHTML = ''; hCol.innerHTML = '';

  /* Etiquetas de horas (formato 12h) */
  for(let h = Math.floor(OPEN/60); h < Math.floor(CLOSE/60); h++){
    const lbl = document.createElement('div');
    lbl.className = 'hour-label';
    lbl.style.height = (60 * PX_MIN) + 'px';
    const h12 = h%12||12, ap = h>=12?'PM':'AM';
    lbl.textContent = `${h12}:00 ${ap}`;
    hCol.appendChild(lbl);
    const line = document.createElement('div');
    line.className = 'line-hour' + (h % 2 === 0 ? ' prominent' : '');
    line.style.top = ((h*60 - OPEN) * PX_MIN) + 'px';
    tLine.appendChild(line);
  }

  const esSrv     = modo === 'servidor';
  const ciCliente = cliente.ci ? cliente.ci.trim().toLowerCase() : '';

  /* ── Asignar columnas a pendientes solapados ── */
  const pending = reservas.filter(r => r.estado === 'pendiente');
  pending.sort((a, b) => a.inicio - b.inicio);
  const colEnds = [];
  pending.forEach(b => {
    let placed = false;
    for(let i = 0; i < colEnds.length; i++){
      if(b.inicio >= colEnds[i]){ b._col = i; colEnds[i] = b.inicio + b.duracion; placed = true; break; }
    }
    if(!placed){ b._col = colEnds.length; colEnds.push(b.inicio + b.duracion); }
  });
  pending.forEach(b => {
    const overlapping = pending.filter(x => x.inicio < b.inicio+b.duracion && x.inicio+x.duracion > b.inicio);
    b._numCols = Math.max(...overlapping.map(x => x._col)) + 1;
  });

  reservas.forEach(r => {
    const esProp = !esSrv && ciCliente !== '' && ciCliente === r.ci.trim().toLowerCase();
    /* Clientes: rechazados ajenos invisibles */
    if(!esSrv && !esProp && r.estado === 'rechazado') return;

    const top    = (r.inicio - OPEN) * PX_MIN;
    const minH   = (esSrv || esProp) ? 80 : 30;
    const height = Math.max(r.duracion * PX_MIN, minH);
    const cls    = r.estado==='pendiente' ? 'res-pend' : r.estado==='reservado' ? 'res-res' : 'res-rech';
    const bc     = r.estado==='pendiente' ? 'badge-p'  : r.estado==='reservado' ? 'badge-r' : 'badge-x';
    const bt     = r.estado==='pendiente' ? 'Pendiente': r.estado==='reservado' ? 'Reservado' : 'Rechazado';

    const div = document.createElement('div');
    div.className = `res-block ${cls}`;
    div.style.top    = top + 'px';
    div.style.height = height + 'px';

    /* Posicion horizontal: pendientes lado a lado */
    if(r.estado === 'pendiente' && r._col !== undefined){
      const nc = r._numCols, cl = r._col;
      div.style.left  = `calc(${(cl/nc)*100}% + 3px)`;
      div.style.width = `calc(${(1/nc)*100}% - 6px)`;
      div.style.right = 'auto';
    }

    if(esSrv){
      div.innerHTML = `
        <div class="r-name">${r.cliente}</div>
        <div class="r-meta">${fmt(r.inicio)} - ${fmt(r.inicio+r.duracion)} · Tel: ${r.ci||'—'}</div>
        <span class="r-badge ${bc}">${bt}</span>
        <div class="r-actions" id="ra-${r.id}"></div>`;
      const ac = div.querySelector(`#ra-${r.id}`);
      if(r.estado === 'pendiente'){
        ac.append(mkBtn('ra-btn ra-approve', '✓ Aprobar',  () => aprobar(r.id)));
        ac.append(mkBtn('ra-btn ra-reject',  '✗ Rechazar', () => rechazar(r.id)));
      }
      ac.append(mkBtn('ra-btn ra-edit',   'Editar', () => editar(r)));
      ac.append(mkBtn('ra-btn ra-delete', '🗑',      () => eliminar(r)));

    } else if(esProp){
      div.innerHTML = `
        <div class="r-name">${r.cliente}</div>
        <div class="r-meta">${fmt(r.inicio)} - ${fmt(r.inicio+r.duracion)}</div>
        <span class="r-badge ${bc}">${bt}</span>
        <div class="r-actions" id="ra-${r.id}"></div>`;
      if(r.estado === 'pendiente'){
        const ac = div.querySelector(`#ra-${r.id}`);
        ac.append(mkBtn('ra-btn ra-edit',   'Editar',     () => editar(r)));
        ac.append(mkBtn('ra-btn ra-delete', '🗑 Cancelar', () => cancelarProp(r)));
      }

    } else {
      div.innerHTML = `
        <div class="r-name">Ocupado</div>
        <div class="r-meta">${fmt(r.inicio)} - ${fmt(r.inicio+r.duracion)}</div>`;
    }

    tLine.appendChild(div);
  });
}

/* ── Listas (servidor) ── */
function renderListas(reservas){
  const pend = reservas.filter(r => r.estado === 'pendiente');
  const res  = reservas.filter(r => r.estado === 'reservado');
  const rech = reservas.filter(r => r.estado === 'rechazado');

  fill('lPend', pend, r => {
    const d = mkItem(r);
    d.querySelector('.ri-actions').append(
      mkBtn('btn btn-success ra-btn', '✓ Aprobar',  () => aprobar(r.id)),
      mkBtn('btn btn-warn ra-btn',    '✗ Rechazar', () => rechazar(r.id)),
      mkBtn('btn btn-primary ra-btn', 'Editar',     () => editar(r)),
      mkBtn('btn btn-danger ra-btn',  'Eliminar',   () => eliminar(r))
    ); return d;
  });
  fill('lRes', res, r => {
    const d = mkItem(r);
    d.querySelector('.ri-actions').append(
      mkBtn('btn btn-primary ra-btn', 'Editar',   () => editar(r)),
      mkBtn('btn btn-danger ra-btn',  'Eliminar', () => eliminar(r))
    ); return d;
  });
  fill('lRech', rech, r => {
    const d = mkItem(r);
    d.querySelector('.ri-actions').append(mkBtn('btn btn-danger ra-btn','Eliminar',() => eliminar(r)));
    return d;
  });
}

function fill(id, items, builder){
  const el = $(id); if(!el) return;
  el.innerHTML = '';
  if(!items.length){ el.innerHTML = '<div class="empty">Sin registros</div>'; return; }
  items.forEach(r => el.appendChild(builder(r)));
}
function mkItem(r){
  const bc = r.estado==='pendiente' ? 'badge-p' : r.estado==='reservado' ? 'badge-r' : 'badge-x';
  const bt = r.estado==='pendiente' ? 'Pendiente' : r.estado==='reservado' ? 'Reservado' : 'Rechazado';
  const div = document.createElement('div'); div.className = 'res-item';
  div.innerHTML = `
    <div>
      <div class="ri-name">${r.cliente}</div>
      <div class="ri-sub">Tel: ${r.ci} · ${fmt(r.inicio)} - ${fmt(r.inicio+r.duracion)}</div>
      <span class="r-badge ${bc}" style="margin-top:4px">${bt}</span>
    </div>
    <div class="ri-actions"></div>`;
  return div;
}
function mkBtn(cls, txt, cb){
  const b = document.createElement('button');
  b.className = cls; b.textContent = txt;
  b.onclick = e => { e.stopPropagation(); cb(); };
  return b;
}

/* ══════════════════════════════════════════════
   ACCIONES
══════════════════════════════════════════════ */
function renderMisSolicitudes(reservas){
  if(!cliente.ci) return;
  const ciCli  = cliente.ci.trim().toLowerCase();
  const propias = reservas.filter(r => r.ci.trim().toLowerCase() === ciCli && r.estado !== 'rechazado');
  const wrap = $('misReservas'), list = $('misList');
  if(!wrap || !list) return;
  if(!propias.length){ wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  list.innerHTML = '';
  propias.forEach(r => {
    const d = mkItem(r);
    if(r.estado === 'pendiente'){
      d.querySelector('.ri-actions').append(
        mkBtn('btn btn-primary ra-btn', 'Editar',   () => editar(r)),
        mkBtn('btn btn-danger ra-btn',  'Cancelar', () => cancelarProp(r))
      );
    }
    list.appendChild(d);
  });
}

async function solicitar(){
  if(solicitando) return;
  const hora  = $('fHora').value;
  const dur   = parseInt($('fDur').value, 10);
  const msgEl = $('fMsg');
  msgEl.textContent = ''; msgEl.style.color = '#f87171';
  if(!hora){ msgEl.textContent = 'Seleccione hora.'; return; }
  if(isNaN(dur) || dur < 15){ msgEl.textContent = 'Duracion minima 15 min.'; return; }
  const inicio = t2m(hora);
  if(inicio < OPEN || inicio + dur > CLOSE){ msgEl.textContent = 'Fuera de horario (1:00 PM - 12:00 AM).'; return; }
  if(fecha === today() && inicio < nowMin()){ msgEl.textContent = 'No puede reservar en el pasado.'; return; }

  solicitando = true;
  const btn = $('btnSolicitar'); if(btn) btn.disabled = true; loader(true);
  let exito = false;
  try {
    const existentes = await fetchReservas(fecha);
    const soloAprobadas = existentes.filter(r => r.estado === 'reservado');
    if(overlap(inicio, dur, soloAprobadas)){
      const m = $('fMsg');
      if(m){ m.style.color='#f87171'; m.textContent = 'Ese horario ya esta reservado.'; }
      return;
    }
    await insertReserva({
      id: uid(), fecha, inicio, duracion: dur,
      cliente: cliente.nombre, ci: cliente.ci.trim().toLowerCase(),
      estado: 'pendiente', creado: Date.now()
    });
    notifNtfy({inicio, duracion: dur, cliente: cliente.nombre, ci: cliente.ci.trim().toLowerCase(), fecha});
    exito = true;
    msg = {text:'Solicitud enviada — pendiente de aprobacion.', type:'ok'};
    const m2 = $('fMsg');
    if(m2){ m2.style.color = '#86efac'; m2.textContent = '✓ ' + msg.text; }
    setTimeout(() => { solicitando = false; msg = {text:'',type:''}; renderApp(); }, 2000);
  } catch(e){
    console.error('solicitar', e);
    const m = $('fMsg');
    if(m){ m.style.color='#f87171'; m.textContent = 'Error al enviar: ' + (e.message || 'verifica tu conexion.'); }
  } finally {
    loader(false);
    if(!exito){
      solicitando = false;
      const b2 = $('btnSolicitar'); if(b2) b2.disabled = false;
    }
  }
}

async function aprobar(id){
  loader(true);
  try {
    const reservas = await fetchReservas(fecha);
    const r = reservas.find(x => x.id === id);
    if(!r){ loader(false); return; }

    /* Encontrar pendientes en conflicto (solapan con la que se aprueba) */
    const conflictos = reservas.filter(x =>
      x.id !== id &&
      x.estado === 'pendiente' &&
      x.inicio < r.inicio + r.duracion &&
      x.inicio + x.duracion > r.inicio
    );

    await rpc('srv_aprobar', {p_pin: srvPin, p_id: id});

    /* Eliminar automaticamente los conflictos */
    for(const c of conflictos){
      await rpc('srv_eliminar', {p_pin: srvPin, p_id: c.id});
    }

    const txt = conflictos.length
      ? `Reserva aprobada. ${conflictos.length} solicitud(es) en conflicto eliminada(s).`
      : 'Reserva aprobada.';
    showMsg(txt, 'ok');
  } catch(e){ showMsg(e.message || 'Error al aprobar.', 'err'); }
  finally { loader(false); renderApp(); }
}

async function rechazar(id){
  if(!confirm('¿Rechazar esta reserva?')) return;
  loader(true);
  try {
    await rpc('srv_rechazar', {p_pin: srvPin, p_id: id});
    showMsg('Reserva rechazada.', 'err');
  } catch(e){ showMsg(e.message || 'Error al rechazar.', 'err'); }
  finally { loader(false); renderApp(); }
}

async function editar(r){
  const esSrv     = modo === 'servidor';
  const ciCliente = cliente.ci ? cliente.ci.trim().toLowerCase() : '';
  const esPropPend = !esSrv && ciCliente !== '' && ciCliente === r.ci.trim().toLowerCase() && r.estado === 'pendiente';
  if(!esSrv && !esPropPend){ alert('Solo puedes editar tus propias solicitudes pendientes.'); return; }

  const nh = prompt('Nueva hora inicio (HH:MM, ej. 14:30):', (() => { const h=Math.floor(r.inicio/60),m=r.inicio%60; return `${pad(h)}:${pad(m)}`; })());
  if(!nh) return;
  const nd = prompt('Nueva duracion (min):', String(r.duracion));
  if(!nd) return;
  const inicio = t2m(nh), dur = parseInt(nd, 10);
  if(isNaN(dur) || dur < 15){ alert('Duracion minima 15 min.'); return; }
  if(inicio < OPEN || inicio + dur > CLOSE){ alert('Fuera de horario (1:00 PM - 12:00 AM).'); return; }

  loader(true);
  try {
    const reservas = await fetchReservas(fecha);
    if(esSrv){
      if(overlap(inicio, dur, reservas, r.id))
        if(!confirm('Solapamiento. ¿Aplicar igualmente?')){ loader(false); return; }
      await rpc('srv_editar', {p_pin: srvPin, p_id: r.id, p_inicio: inicio, p_duracion: dur, p_ci: null});
    } else {
      const aprobadas = reservas.filter(x => x.estado === 'reservado');
      if(overlap(inicio, dur, aprobadas, r.id)){
        showMsg('Ese horario ya esta reservado. Elige otro.', 'err');
        loader(false); renderApp(); return;
      }
      await rpc('cli_editar', {p_ci: ciCliente, p_id: r.id, p_inicio: inicio, p_duracion: dur});
    }
    showMsg('Reserva actualizada.', 'ok');
  } catch(e){ showMsg(e.message || 'Error al editar.', 'err'); }
  finally { loader(false); renderApp(); }
}

async function cancelarProp(r){
  if(!confirm('¿Cancelar tu solicitud de ' + fmt(r.inicio) + ' - ' + fmt(r.inicio+r.duracion) + '?')) return;
  loader(true);
  try {
    await rpc('cli_eliminar', {p_ci: cliente.ci.trim().toLowerCase(), p_id: r.id});
    showMsg('Solicitud cancelada.', 'err');
  } catch(e){ showMsg(e.message || 'Error al cancelar.', 'err'); }
  finally { loader(false); renderApp(); }
}

async function eliminar(r){
  if(!confirm('¿Eliminar la reserva de ' + r.cliente + ' (' + fmt(r.inicio) + ' - ' + fmt(r.inicio+r.duracion) + ')?')) return;
  loader(true);
  try {
    await rpc('srv_eliminar', {p_pin: srvPin, p_id: r.id});
    showMsg('Reserva eliminada.', 'ok');
  } catch(e){ showMsg(e.message || 'Error al eliminar.', 'err'); }
  finally { loader(false); renderApp(); }
}

async function verificarLlegada(){
  if(fecha !== today()){ showMsg('Seleccione la fecha de hoy.', 'err'); renderApp(); return; }
  loader(true);
  const reservas = await fetchReservas(fecha);
  loader(false);
  const ahora = nowMin();
  const act = reservas.find(r => r.estado === 'reservado' && ahora >= r.inicio && ahora < r.inicio + r.duracion);
  if(act) showMsg('✓ Mesa ocupada: ' + act.cliente + ' (Tel: ' + act.ci + ') · ' + fmt(act.inicio) + ' - ' + fmt(act.inicio+act.duracion), 'ok');
  else    showMsg('Sin reserva activa en este momento.', '');
  renderApp();
}

function showMsg(text, type){ msg = {text, type}; }

/* ── Offline ── */
const syncOffline = () => $('offlineBadge').classList.toggle('show', !navigator.onLine);
window.addEventListener('online',  syncOffline);
window.addEventListener('offline', syncOffline);
syncOffline();

/* ── Service Worker ── */
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      /* Actualizar automaticamente: skipWaiting -> reload sin banner */
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
      /* Verificar update al enfocar la ventana */
      document.addEventListener('visibilitychange', () => {
        if(document.visibilityState === 'visible') reg.update().catch(() => {});
      });
      reg.update().catch(() => {});
    }).catch(() => {});
  });
}

/* ── Boot ── */
if(modo === 'servidor' && srvPin){
  suscribir(); pedirPermiso(); renderApp();
} else if(modo === 'cliente' && cliente.nombre){
  renderApp();
} else {
  ss.clear();
  modo = 'login'; srvPin = ''; cliente = {nombre:'', ci:''};
  renderLogin();
}
