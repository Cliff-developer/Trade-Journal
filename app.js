/* ---------- Config ---------- */
const CFG_KEY = 'ptj_config_v1';
function loadConfig(){
  try{ return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; }catch(e){ return {}; }
}
function saveConfig(cfg){ localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }
let config = loadConfig();
let isEditMode = !!(config.owner && config.repo && config.token);

/* ---------- Instrument defaults (contract size / leverage hints) ---------- */
const INSTRUMENT_DEFAULTS = {
  'XAUUSD': { contract: 100, leverage: 100 },
  'XAGUSD': { contract: 5000, leverage: 50 },
  'EURUSD': { contract: 100000, leverage: 100 },
  'GBPUSD': { contract: 100000, leverage: 100 },
  'USDJPY': { contract: 100000, leverage: 100 },
  'US30':   { contract: 1, leverage: 100 },
  'NAS100': { contract: 1, leverage: 100 },
  'BTCUSD': { contract: 1, leverage: 20 },
};

/* ---------- State ---------- */
let trades = [];
let tradesSha = null; // sha of trades.json, needed to update via GitHub API
let calYear, calMonth; // 0-indexed month
let selectedDate = null;
let editingId = null;
let pendingImages = []; // {dataUrl, blob} awaiting save

/* ---------- Utilities ---------- */
function money(n){
  if(n===null||n===undefined||isNaN(n)) return '—';
  const sign = n<0 ? '-' : '';
  return sign + '$' + Math.abs(n).toFixed(2);
}
function pctStr(n){
  if(n===null||n===undefined||isNaN(n)) return '—';
  return n.toFixed(1) + '%';
}
function todayStr(){
  const d = new Date();
  return d.toISOString().slice(0,10);
}
function rawUrl(path){
  return `https://raw.githubusercontent.com/${config.owner}/${config.repo}/main/${path}`;
}
function showStatus(msg, type='info', timeout=4000){
  const area = document.getElementById('statusArea');
  const el = document.createElement('div');
  el.className = 'status-msg ' + type;
  el.textContent = msg;
  area.innerHTML = '';
  area.appendChild(el);
  if(timeout) setTimeout(()=>{ if(area.contains(el)) area.removeChild(el); }, timeout);
}

/* ---------- PnL math (mirrors Sovereignty's PnL & Margin Terminal) ----------
   Position Value = Contract Size × Volume × Open Price
   Margin          = Position Value ÷ Leverage
   PnL (Long)      = (Close − Open) × Contract Size × Volume
   PnL (Short)     = (Open − Close) × Contract Size × Volume
   Return on Margin (RoM) = PnL ÷ Margin × 100
------------------------------------------------------------------------------ */
function calcTrade({direction, open, close, volume, contract, leverage}){
  const posVal = contract * volume * open;
  const margin = leverage ? posVal / leverage : null;
  const pnl = direction === 'short'
    ? (open - close) * contract * volume
    : (close - open) * contract * volume;
  const rom = margin ? (pnl / margin) * 100 : null;
  return { posVal, margin, pnl, rom };
}

/* ---------- GitHub API ---------- */
const API = 'https://api.github.com';

async function ghGetFile(path){
  const res = await fetch(`${API}/repos/${config.owner}/${config.repo}/contents/${path}`, {
    headers: { Authorization: `token ${config.token}` }
  });
  if(res.status === 404) return null;
  if(!res.ok) throw new Error(`GitHub read failed (${res.status})`);
  return res.json(); // { content (base64), sha, ... }
}

async function ghPutFile(path, base64Content, message, sha){
  const body = { message, content: base64Content };
  if(sha) body.sha = sha;
  const res = await fetch(`${API}/repos/${config.owner}/${config.repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${config.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if(!res.ok){
    const err = await res.json().catch(()=>({}));
    throw new Error(err.message || `GitHub write failed (${res.status})`);
  }
  return res.json();
}

function b64EncodeUnicode(str){
  return btoa(unescape(encodeURIComponent(str)));
}

/* ---------- Load trades ---------- */
async function loadTrades(){
  try{
    if(isEditMode){
      const file = await ghGetFile('trades.json');
      if(file){
        tradesSha = file.sha;
        trades = JSON.parse(decodeURIComponent(escape(atob(file.content.replace(/\n/g,'')))));
      } else {
        trades = []; tradesSha = null;
      }
    } else {
      const res = await fetch(rawUrl('trades.json') + `?t=${Date.now()}`);
      trades = res.ok ? await res.json() : [];
    }
  }catch(e){
    console.error(e);
    trades = [];
    showStatus('Could not load trades.json — check Settings.', 'error');
  }
  renderAll();
}

async function persistTrades(commitMessage){
  const json = JSON.stringify(trades, null, 2);
  const b64 = b64EncodeUnicode(json);
  const result = await ghPutFile('trades.json', b64, commitMessage, tradesSha);
  tradesSha = result.content.sha;
}

/* ---------- Image handling ---------- */
function compressImage(file, maxWidth=1600, quality=0.82){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleFiles(fileList){
  const files = Array.from(fileList).slice(0, 6 - pendingImages.length);
  for(const f of files){
    if(!f.type.startsWith('image/')) continue;
    const dataUrl = await compressImage(f);
    pendingImages.push({ dataUrl });
  }
  renderUploadPreviews();
}

function renderUploadPreviews(){
  const box = document.getElementById('uploadPreviews');
  box.innerHTML = '';
  pendingImages.forEach((img, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'thumb-wrap';
    wrap.innerHTML = `<img src="${img.dataUrl}"><button class="remove" data-i="${i}">×</button>`;
    box.appendChild(wrap);
  });
  box.querySelectorAll('.remove').forEach(btn=>{
    btn.onclick = () => { pendingImages.splice(+btn.dataset.i, 1); renderUploadPreviews(); };
  });
}

/* ---------- Rendering: Calendar ---------- */
function tradesByDate(){
  const map = {};
  trades.forEach(t => { (map[t.date] = map[t.date] || []).push(t); });
  return map;
}

function renderCalendar(){
  const label = new Date(calYear, calMonth, 1).toLocaleString('default', { month:'long', year:'numeric' });
  document.getElementById('calMonthLabel').textContent = label;

  const byDate = tradesByDate();
  const firstDow = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();

  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  ['S','M','T','W','T','F','S'].forEach(d=>{
    const el = document.createElement('div');
    el.className = 'cal-dow'; el.textContent = d;
    grid.appendChild(el);
  });
  for(let i=0;i<firstDow;i++){
    const el = document.createElement('div');
    el.className = 'cal-cell empty';
    grid.appendChild(el);
  }

  let monthPnl = 0, monthWins = 0, monthTrades = 0;

  for(let day=1; day<=daysInMonth; day++){
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dayTrades = byDate[dateStr] || [];
    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    cell.dataset.date = dateStr;

    if(dayTrades.length){
      cell.classList.add('has-trades');
      const netPnl = dayTrades.reduce((s,t)=>s+(t.pnl||0),0);
      cell.classList.add(netPnl >= 0 ? 'pnl-pos' : 'pnl-neg');
      monthPnl += netPnl;
      monthTrades += dayTrades.length;
      monthWins += dayTrades.filter(t=>t.pnl>0).length;
      const firstImg = dayTrades.find(t => t.images && t.images.length);
      if(firstImg){
        const thumb = document.createElement('div');
        thumb.className = 'thumb';
        thumb.style.backgroundImage = `url("${rawUrl(firstImg.images[0])}")`;
        cell.appendChild(thumb);
      }
      const dot = document.createElement('div');
      dot.className = 'dot';
      cell.appendChild(dot);
    }
    const num = document.createElement('div');
    num.className = 'daynum';
    num.textContent = day;
    cell.appendChild(num);

    if(dateStr === selectedDate) cell.classList.add('selected');
    cell.onclick = () => { selectedDate = dateStr; renderCalendar(); renderDayTrades(); };
    grid.appendChild(cell);
  }

  const winRate = monthTrades ? (monthWins/monthTrades*100).toFixed(0)+'%' : '—';
  const summary = document.getElementById('calSummary');
  summary.innerHTML = `
    <span>Trades <span class="num">${monthTrades}</span></span>
    <span>Win rate <span class="num">${winRate}</span></span>
    <span>Net PnL <span class="num ${monthPnl>=0?'pos':'neg'}">${money(monthPnl)}</span></span>
  `;
}

function renderDayTrades(){
  const label = document.getElementById('dayTradesLabel');
  const list = document.getElementById('dayTradesList');
  if(!selectedDate){ label.textContent = 'Select a day'; list.innerHTML=''; return; }
  const byDate = tradesByDate();
  const dayTrades = byDate[selectedDate] || [];
  label.textContent = selectedDate;
  if(!dayTrades.length){
    list.innerHTML = `<div class="empty-note">No trades logged this day.</div>`;
    return;
  }
  list.innerHTML = '';
  dayTrades.forEach(t => list.appendChild(renderTradeCard(t)));
}

/* ---------- Rendering: Trade card ---------- */
function renderTradeCard(t){
  const card = document.createElement('div');
  card.className = 'trade-card';
  card.innerHTML = `
    <div class="trade-card-top">
      <div class="trade-id">
        <span class="instrument">${t.instrument}</span>
        <span class="direction ${t.direction}">${t.direction}</span>
        <span style="color:var(--text-dim);font-family:var(--font-mono);font-size:0.78rem;">${t.date}</span>
      </div>
      <div class="trade-pnl ${t.pnl>=0?'pos':'neg'}">${money(t.pnl)}</div>
    </div>
    <div class="trade-detail" id="detail-${t.id}">
      <div class="metrics-row">
        <div class="metric"><div class="label">Open</div><div class="value">${t.open}</div></div>
        <div class="metric"><div class="label">Close</div><div class="value">${t.close}</div></div>
        <div class="metric"><div class="label">Volume</div><div class="value">${t.volume}</div></div>
        <div class="metric"><div class="label">Margin</div><div class="value">${money(t.margin)}</div></div>
        <div class="metric"><div class="label">RoM</div><div class="value">${pctStr(t.rom)}</div></div>
      </div>
      ${t.notes ? `<div class="notes">${escapeHtml(t.notes)}</div>` : ''}
      ${t.tags && t.tags.length ? `<div class="tags">${t.tags.map(tag=>`<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      <div class="image-strip">
        ${(t.images||[]).map(p => `<img src="${rawUrl(p)}" data-full="${rawUrl(p)}">`).join('')}
      </div>
      ${isEditMode ? `
        <div class="trade-actions">
          <button data-action="edit" data-id="${t.id}">Edit</button>
          <button data-action="delete" data-id="${t.id}" class="danger">Delete</button>
        </div>` : ''}
    </div>
  `;
  card.querySelector('.trade-card-top').onclick = () => {
    card.querySelector('.trade-detail').classList.toggle('open');
  };
  card.querySelectorAll('.image-strip img').forEach(img=>{
    img.onclick = (e) => { e.stopPropagation(); openLightbox(img.dataset.full); };
  });
  const editBtn = card.querySelector('[data-action="edit"]');
  if(editBtn) editBtn.onclick = (e) => { e.stopPropagation(); startEdit(t.id); };
  const delBtn = card.querySelector('[data-action="delete"]');
  if(delBtn) delBtn.onclick = (e) => { e.stopPropagation(); deleteTrade(t.id); };
  return card;
}

function escapeHtml(s){
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function renderAllTradesList(){
  const list = document.getElementById('allTradesList');
  list.innerHTML = '';
  if(!trades.length){
    list.innerHTML = `<div class="empty-note">No trades logged yet.</div>`;
    return;
  }
  const sorted = [...trades].sort((a,b)=> b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  sorted.forEach(t => list.appendChild(renderTradeCard(t)));
}

function renderAll(){
  renderCalendar();
  renderDayTrades();
  renderAllTradesList();
  populateInstrumentList();
}

function populateInstrumentList(){
  const dl = document.getElementById('instrumentList');
  dl.innerHTML = Object.keys(INSTRUMENT_DEFAULTS).map(i=>`<option value="${i}">`).join('');
}

/* ---------- Lightbox ---------- */
function openLightbox(src){
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox(){
  document.getElementById('lightbox').classList.remove('open');
}

/* ---------- Form: computed live preview ---------- */
function readForm(){
  return {
    date: document.getElementById('f-date').value || todayStr(),
    instrument: document.getElementById('f-instrument').value.trim().toUpperCase(),
    direction: document.getElementById('f-direction').value,
    volume: parseFloat(document.getElementById('f-volume').value) || 0,
    open: parseFloat(document.getElementById('f-open').value) || 0,
    close: parseFloat(document.getElementById('f-close').value) || 0,
    contract: parseFloat(document.getElementById('f-contract').value) || 0,
    leverage: parseFloat(document.getElementById('f-leverage').value) || 0,
    tags: document.getElementById('f-tags').value.split(',').map(s=>s.trim()).filter(Boolean),
    notes: document.getElementById('f-notes').value.trim(),
  };
}

function updateComputed(){
  const f = readForm();
  const {posVal, margin, pnl, rom} = calcTrade(f);
  document.getElementById('c-posval').textContent = money(posVal);
  document.getElementById('c-margin').textContent = money(margin);
  const pnlEl = document.getElementById('c-pnl');
  pnlEl.textContent = money(pnl);
  pnlEl.parentElement.querySelector('.label');
  const romEl = document.getElementById('c-rom');
  romEl.textContent = pctStr(rom);
}

function applyInstrumentDefaults(){
  const name = document.getElementById('f-instrument').value.trim().toUpperCase();
  const d = INSTRUMENT_DEFAULTS[name];
  if(d){
    if(!document.getElementById('f-contract').value) document.getElementById('f-contract').value = d.contract;
    if(!document.getElementById('f-leverage').value) document.getElementById('f-leverage').value = d.leverage;
    updateComputed();
  }
}

/* ---------- Save / Edit / Delete ---------- */
function resetForm(){
  ['f-instrument','f-volume','f-open','f-close','f-contract','f-leverage','f-tags','f-notes'].forEach(id=>{
    document.getElementById(id).value = '';
  });
  document.getElementById('f-date').value = todayStr();
  document.getElementById('f-direction').value = 'long';
  pendingImages = [];
  renderUploadPreviews();
  editingId = null;
  document.getElementById('submitTrade').textContent = 'Save trade to journal';
  updateComputed();
}

function startEdit(id){
  const t = trades.find(x=>x.id===id);
  if(!t) return;
  editingId = id;
  document.getElementById('f-date').value = t.date;
  document.getElementById('f-instrument').value = t.instrument;
  document.getElementById('f-direction').value = t.direction;
  document.getElementById('f-volume').value = t.volume;
  document.getElementById('f-open').value = t.open;
  document.getElementById('f-close').value = t.close;
  document.getElementById('f-contract').value = t.contract;
  document.getElementById('f-leverage').value = t.leverage;
  document.getElementById('f-tags').value = (t.tags||[]).join(', ');
  document.getElementById('f-notes').value = t.notes || '';
  pendingImages = []; // existing images stay attached to the trade unless new ones are added
  renderUploadPreviews();
  document.getElementById('submitTrade').textContent = 'Update trade';
  updateComputed();
  switchView('add');
}

async function deleteTrade(id){
  if(!confirm('Delete this trade entry? Image files will remain in the repo.')) return;
  trades = trades.filter(t=>t.id!==id);
  try{
    await persistTrades(`Delete trade ${id}`);
    showStatus('Trade deleted.', 'success');
    renderAll();
  }catch(e){
    showStatus('Delete failed: ' + e.message, 'error');
  }
}

async function submitTrade(){
  const f = readForm();
  if(!f.instrument || !f.open || !f.close || !f.volume || !f.contract || !f.leverage){
    showStatus('Fill in instrument, open/close price, volume, contract size and leverage.', 'error');
    return;
  }
  const btn = document.getElementById('submitTrade');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try{
    const {posVal, margin, pnl, rom} = calcTrade(f);
    const id = editingId || `t${Date.now()}`;
    const existing = editingId ? trades.find(t=>t.id===editingId) : null;
    const existingImages = existing ? (existing.images || []) : [];

    // upload any newly attached images
    const newImagePaths = [];
    for(let i=0;i<pendingImages.length;i++){
      const filename = `images/${id}-${existingImages.length + i + 1}.jpg`;
      const base64 = pendingImages[i].dataUrl.split(',')[1];
      await ghPutFile(filename, base64, `Add image for trade ${id}`);
      newImagePaths.push(filename);
    }
    const images = existingImages.concat(newImagePaths);

    const tradeObj = {
      id, date: f.date, instrument: f.instrument, direction: f.direction,
      volume: f.volume, open: f.open, close: f.close,
      contract: f.contract, leverage: f.leverage,
      posVal, margin, pnl, rom,
      tags: f.tags, notes: f.notes, images
    };

    if(editingId){
      trades = trades.map(t => t.id===editingId ? tradeObj : t);
    } else {
      trades.push(tradeObj);
    }
    await persistTrades(`${editingId?'Update':'Log'} trade ${f.instrument} ${f.date}`);
    showStatus('Saved to journal.', 'success');
    resetForm();
    selectedDate = f.date;
    calYear = parseInt(f.date.slice(0,4));
    calMonth = parseInt(f.date.slice(5,7)) - 1;
    renderAll();
    switchView('calendar');
  }catch(e){
    showStatus('Save failed: ' + e.message, 'error');
  }finally{
    btn.disabled = false;
    btn.textContent = editingId ? 'Update trade' : 'Save trade to journal';
  }
}

/* ---------- View switching ---------- */
function switchView(name){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.view===name));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active', v.id === 'view-'+name));
}

/* ---------- Settings ---------- */
function loadSettingsForm(){
  document.getElementById('cfg-owner').value = config.owner || '';
  document.getElementById('cfg-repo').value = config.repo || '';
  document.getElementById('cfg-token').value = config.token || '';
}

function saveSettings(){
  config = {
    owner: document.getElementById('cfg-owner').value.trim(),
    repo: document.getElementById('cfg-repo').value.trim(),
    token: document.getElementById('cfg-token').value.trim(),
  };
  saveConfig(config);
  isEditMode = !!(config.owner && config.repo && config.token);
  applyMode();
  showStatus('Settings saved.', 'success');
  loadTrades();
}

function applyMode(){
  const pill = document.getElementById('modePill');
  pill.textContent = isEditMode ? 'edit mode' : 'view-only';
  pill.classList.toggle('edit', isEditMode);
  document.getElementById('addTab').disabled = !isEditMode;
}

/* ---------- Init ---------- */
function init(){
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
  selectedDate = todayStr();

  document.querySelectorAll('.tab').forEach(tab=>{
    tab.onclick = () => { if(!tab.disabled) switchView(tab.dataset.view); };
  });

  document.getElementById('calPrev').onclick = () => {
    calMonth--; if(calMonth<0){ calMonth=11; calYear--; } renderCalendar();
  };
  document.getElementById('calNext').onclick = () => {
    calMonth++; if(calMonth>11){ calMonth=0; calYear++; } renderCalendar();
  };

  ['f-volume','f-open','f-close','f-contract','f-leverage','f-direction'].forEach(id=>{
    document.getElementById(id).addEventListener('input', updateComputed);
  });
  document.getElementById('f-instrument').addEventListener('change', applyInstrumentDefaults);

  document.getElementById('uploadZone').onclick = () => document.getElementById('f-images').click();
  document.getElementById('f-images').addEventListener('change', e => handleFiles(e.target.files));
  document.getElementById('uploadZone').addEventListener('dragover', e => e.preventDefault());
  document.getElementById('uploadZone').addEventListener('drop', e => {
    e.preventDefault(); handleFiles(e.dataTransfer.files);
  });

  document.getElementById('submitTrade').onclick = submitTrade;
  document.getElementById('saveSettings').onclick = saveSettings;
  document.getElementById('lightboxClose').onclick = closeLightbox;
  document.getElementById('lightbox').onclick = (e)=>{ if(e.target.id==='lightbox') closeLightbox(); };

  document.getElementById('f-date').value = todayStr();
  loadSettingsForm();
  applyMode();
  updateComputed();

  if(config.owner && config.repo){
    loadTrades();
  } else {
    switchView('settings');
    showStatus('Set your GitHub username and repo to get started.', 'info');
  }

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('service-worker.js').catch(()=>{});
  }
}

document.addEventListener('DOMContentLoaded', init);
