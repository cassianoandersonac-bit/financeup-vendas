// api-layer-vendas.js
// ═══════════════════════════════════════════════════════════════
//  Camada de nuvem para o app de venda.
//  Sem tela de login — cria/acessa conta automaticamente.
//  O PIN do app é a única autenticação visível ao usuário.
//
//  Fluxo:
//  1. Gera um ID único por dispositivo (armazenado no localStorage)
//  2. Tenta login com esse ID + PIN como senha
//  3. Se não existir, registra automaticamente
//  4. Após autenticado, chama iniciarApp() → tutorial → PIN
//  5. save() e load() sincronizam com a nuvem transparentemente
// ═══════════════════════════════════════════════════════════════

const API_BASE = window.FP_API_BASE || 'https://financas-backend-eight.vercel.app';

const KEY_MAP = {
  fp_cartoes:            'cartoes',
  fp_parcelas:           'parcelas',
  fp_gastos:             'gastos',
  fp_invest:             'invest',
  fp_adicional_parcelas: 'adicionalParcelas',
  fp_adicional_gastos:   'adicionalGastos',
  fp_contas_fixas:       'contasFixas',
  fp_receitas:           'receitas',
  fp_cofrinhos:          'cofrinhos',
  fp_metas:              'metas',
};

// ── Estado global ──────────────────────────────────────────────
window._dados = {};
window._token = null;

const DEVICE_KEY = 'fp_device_id';
const TOKEN_KEY  = 'fp_token';
const CRED_KEY   = 'fp_device_cred'; // senha gerada para este dispositivo

// ── Helpers ────────────────────────────────────────────────────
function _uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function _getOrCreateDevice() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) { id = _uuid(); localStorage.setItem(DEVICE_KEY, id); }
  return id;
}

function _getOrCreateCred() {
  let cred = localStorage.getItem(CRED_KEY);
  if (!cred) { cred = _uuid(); localStorage.setItem(CRED_KEY, cred); }
  return cred;
}

function _getToken()   { return window._token || localStorage.getItem(TOKEN_KEY); }
function _setToken(t)  { window._token = t; localStorage.setItem(TOKEN_KEY, t); }
function _clearToken() { window._token = null; localStorage.removeItem(TOKEN_KEY); }

// ── Requisição autenticada ─────────────────────────────────────
async function _api(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${_getToken()}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}

// ── Auth silenciosa ────────────────────────────────────────────
async function _autenticar() {
  const deviceId = _getOrCreateDevice();
  const cred     = _getOrCreateCred();
  const email    = `fp-${deviceId}@financeup.device`;
  const nome     = 'FinanceUp User';

  // Tenta token existente primeiro
  const tokenSalvo = _getToken();
  if (tokenSalvo) {
    try {
      window._token = tokenSalvo;
      const dados = await _api('GET', '/data');
      window._dados = dados;
      return; // sucesso
    } catch {
      _clearToken(); // token expirado, vai registrar/logar novamente
    }
  }

  // Tenta login
  try {
    const { token } = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha: cred })
    }).then(async r => { const d = await r.json(); if (!r.ok) throw d; return d; });

    _setToken(token);
    window._dados = await _api('GET', '/data');
    return;
  } catch {}

  // Conta não existe — registra
  const { token } = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome, email, senha: cred })
  }).then(async r => { const d = await r.json(); if (!r.ok) throw d; return d; });

  _setToken(token);
  window._dados = await _api('GET', '/data');
}

// ── load() ────────────────────────────────────────────────────
window.load = function(key, def) {
  if (key === 'fp_theme') {
    try { return JSON.parse(localStorage.getItem('fp_theme')) || def; } catch { return def; }
  }
  const campo = KEY_MAP[key];
  if (!campo) return def;
  const val = window._dados[campo];
  return (val === undefined || val === null) ? def : val;
};

// ── save() ────────────────────────────────────────────────────
let _saveQueue = {};
window.save = function(key, val) {
  if (key === 'fp_theme') { localStorage.setItem('fp_theme', JSON.stringify(val)); return; }
  const campo = KEY_MAP[key];
  if (!campo) { localStorage.setItem(key, JSON.stringify(val)); return; }
  window._dados[campo] = val;
  _saveQueue[campo] = val;
  _saveComRetry(campo, val);
};

async function _saveComRetry(campo, val) {
  for (let i = 0; i < 3; i++) {
    try {
      const valorAtual = _saveQueue[campo];
      await _api('PUT', '/data', { [campo]: valorAtual });
      return;
    } catch (err) {
      if (i < 2) await new Promise(r => setTimeout(r, 1500 * (i + 1)));
      else console.warn('[api-vendas] Falha ao salvar na nuvem:', campo, err);
    }
  }
}

// ── Re-atribui variáveis e re-renderiza o app com dados da nuvem ────
function _reatribuirVariaveis() {
  if (typeof cartoes !== 'undefined')           cartoes           = load('fp_cartoes', cartoes);
  if (typeof parcelas !== 'undefined')          parcelas          = load('fp_parcelas', parcelas);
  if (typeof gastos !== 'undefined')            gastos            = load('fp_gastos', gastos);
  if (typeof investimentos !== 'undefined')     investimentos     = load('fp_invest', investimentos);
  if (typeof adicionalParcelas !== 'undefined') adicionalParcelas = load('fp_adicional_parcelas', adicionalParcelas);
  if (typeof adicionalGastos !== 'undefined')   adicionalGastos   = load('fp_adicional_gastos', adicionalGastos);
  if (typeof contasFixas !== 'undefined')       contasFixas       = load('fp_contas_fixas', contasFixas);
  if (typeof receitas !== 'undefined')          receitas          = load('fp_receitas', receitas);
  if (typeof cofrinhos !== 'undefined')         cofrinhos         = load('fp_cofrinhos', cofrinhos);
  if (typeof metas !== 'undefined')             metas             = load('fp_metas', metas);

  // Re-renderiza tudo com os dados da nuvem
  if (typeof renderCartoes === 'function')      renderCartoes();
  if (typeof renderParcelas === 'function')     renderParcelas();
  if (typeof renderGastos === 'function')       renderGastos();
  if (typeof renderInvest === 'function')       renderInvest();
  if (typeof renderAdicionais === 'function')   renderAdicionais();
  if (typeof renderContasFixas === 'function')  renderContasFixas();
  if (typeof renderReceitas === 'function')     renderReceitas();
  if (typeof renderCofrinhos === 'function')    renderCofrinhos();
  if (typeof renderMetas === 'function')        renderMetas();
  if (typeof renderAlerts === 'function')       renderAlerts();
  if (typeof atualizarTotalMes === 'function')  atualizarTotalMes();
  if (typeof populateCartaoSelect === 'function') populateCartaoSelect();
}

// ── Bootstrap ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await _autenticar();
    // Re-atribui variáveis com dados da nuvem (carregados após auth async)
    _reatribuirVariaveis();
  } catch (err) {
    console.warn('[api-vendas] Sem acesso à nuvem, continuando offline:', err);
    // Fallback offline: usa load/save do localStorage
    window.load = function(key, def) {
      try { return JSON.parse(localStorage.getItem(key)) || def; } catch { return def; }
    };
    window.save = function(key, val) {
      localStorage.setItem(key, JSON.stringify(val));
    };
  }

  // Chama iniciarApp() — definida no app.html — que dispara tutorial/PIN
  if (typeof iniciarApp === 'function') iniciarApp();
});
