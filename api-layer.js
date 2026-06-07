// api-layer.js
// ═══════════════════════════════════════════════════════════════
//  Camada de integração com o backend.
//  Substitui as funções load() e save() que usavam localStorage.
//
//  Como funciona:
//  1. Ao carregar, mostra tela de login/cadastro
//  2. Após login, carrega TODOS os dados da API de uma vez
//  3. Mantém os dados em memória (window._dados)
//  4. save() envia só o campo alterado para a API (não-bloqueante)
//  5. O tema (dark/light) ainda fica no localStorage (preferência local, OK)
// ═══════════════════════════════════════════════════════════════

// ── Configuração ───────────────────────────────────────────────
// Troque pela URL do seu backend em produção:
const API_BASE = window.FP_API_BASE || 'http://localhost:3001';

// Mapeamento: chave do localStorage → campo na API
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
  fp_notas:              'notas',
};

// ── Estado global ──────────────────────────────────────────────
window._dados   = {};          // cache em memória dos dados da API
window._token   = null;        // JWT atual
window._usuario = null;        // { nome, email }

// ── Helpers de autenticação ────────────────────────────────────
function _getToken()  { return window._token || localStorage.getItem('fp_token'); }
function _setToken(t) { window._token = t; localStorage.setItem('fp_token', t); }
function _clearToken(){ window._token = null; localStorage.removeItem('fp_token'); }

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

// ── Carrega dados do servidor ──────────────────────────────────
async function _carregarDados() {
  const dados = await _api('GET', '/data');
  window._dados = dados;
}

// ── Substitui load() ──────────────────────────────────────────
//  Retorna do cache em memória (já populado antes do app iniciar)
window.load = function(key, def) {
  // Tema ainda vai no localStorage (preferência local)
  if (key === 'fp_theme') {
    try { return JSON.parse(localStorage.getItem('fp_theme')) || def; }
    catch { return def; }
  }

  const campo = KEY_MAP[key];
  if (!campo) return def;

  const val = window._dados[campo];
  if (val === undefined || val === null) return def;
  return val;
};

// ── Substitui save() ──────────────────────────────────────────
//  Persiste localmente (imediato) e manda para API (async)
window.save = function(key, val) {
  // Tema ainda vai no localStorage
  if (key === 'fp_theme') {
    localStorage.setItem('fp_theme', JSON.stringify(val));
    return;
  }

  const campo = KEY_MAP[key];
  if (!campo) return;

  // Atualiza cache local imediatamente (UI não trava)
  window._dados[campo] = val;

  // Persiste na API em background com retry automático
  _saveComRetry(campo, val);
};

let _saveQueue = {};  // evita múltiplos saves simultâneos do mesmo campo
async function _saveComRetry(campo, val) {
  _saveQueue[campo] = val;
  _mostrarToastStatus('⏳ Salvando...');

  const tentativas = 3;
  for (let i = 0; i < tentativas; i++) {
    try {
      // Se o valor mudou enquanto esperávamos, usa o mais recente
      const valorAtual = _saveQueue[campo];
      await _api('PUT', '/data', { [campo]: valorAtual });
      // Confirma visualmente só se ainda somos a última tentativa deste campo
      if (_saveQueue[campo] === valorAtual) {
        _mostrarToastStatus('✓ Salvo', '#0d9488', 2000);
      }
      return;
    } catch (err) {
      console.warn(`[api-layer] Tentativa ${i+1} falhou para "${campo}":`, err);
      if (i < tentativas - 1) {
        await new Promise(r => setTimeout(r, 1500 * (i + 1))); // espera 1.5s, 3s
      } else {
        _mostrarToastStatus('⚠️ Não foi possível salvar na nuvem. Tente novamente.', '#e11d48', 6000);
      }
    }
  }
}

function _mostrarToastStatus(msg, cor, duracao) {
  cor = cor || '#374151';
  duracao = duracao || 0;
  const el = document.getElementById('_apiToast');
  if (!el) return;
  el.textContent = msg;
  el.style.background = cor;
  el.style.display = 'block';
  clearTimeout(el._timer);
  if (duracao > 0) {
    el._timer = setTimeout(() => { el.style.display = 'none'; }, duracao);
  }
}

function _mostrarToastErro(msg) {
  _mostrarToastStatus(msg, '#e11d48', 4000);
}

// ══════════════════════════════════════════════════════════════
//  TELA DE LOGIN / CADASTRO
// ══════════════════════════════════════════════════════════════

const _AUTH_HTML = `
<div id="_authOverlay" style="
  position:fixed; inset:0; z-index:9999;
  background:var(--bg, #f7fafa);
  display:flex; align-items:center; justify-content:center;
  font-family:'Plus Jakarta Sans', sans-serif;
">
  <!-- Toast de erro global -->
  <div id="_apiToast" style="
    display:none; position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
    background:#e11d48; color:#fff; padding:10px 20px; border-radius:8px;
    font-size:14px; z-index:10000;
  "></div>

  <div style="
    background:var(--surface,#fff); border:1px solid var(--border,#e2eeec);
    border-radius:16px; padding:36px 32px; width:100%; max-width:380px;
    box-shadow:0 8px 32px rgba(13,148,136,.10);
  ">
    <!-- Logo / título -->
    <div style="text-align:center; margin-bottom:28px;">
      <div style="font-size:32px; margin-bottom:8px;">💰</div>
      <h1 style="margin:0; font-size:22px; font-weight:700; color:var(--text,#0f2724);">Finance<span style="color:#0d9488">Up</span></h1>
      <p style="margin:4px 0 0; font-size:13px; color:var(--muted,#6b7280);">Seus dados seguros na nuvem</p>
    </div>

    <!-- Abas Login / Cadastro -->
    <div style="display:flex; border-bottom:2px solid var(--border,#e2eeec); margin-bottom:24px;">
      <button id="_tabLogin" onclick="_authTab('login')" style="
        flex:1; background:none; border:none; padding:10px; font-size:14px; font-weight:600;
        cursor:pointer; border-bottom:2px solid var(--teal,#0d9488); margin-bottom:-2px;
        color:var(--teal,#0d9488);
      ">Entrar</button>
      <button id="_tabCadastro" onclick="_authTab('cadastro')" style="
        flex:1; background:none; border:none; padding:10px; font-size:14px; font-weight:600;
        cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-2px;
        color:var(--muted,#6b7280);
      ">Criar conta</button>
    </div>

    <!-- Formulário Login -->
    <div id="_formLogin">
      <div style="margin-bottom:14px;">
        <label style="font-size:12px; font-weight:600; color:var(--muted,#6b7280); display:block; margin-bottom:4px;">E-mail</label>
        <input id="_loginEmail" type="email" placeholder="seu@email.com" style="
          width:100%; padding:10px 12px; border:1px solid var(--border,#e2eeec);
          border-radius:8px; font-size:14px; box-sizing:border-box; outline:none;
          font-family:inherit;
        "/>
      </div>
      <div style="margin-bottom:8px;">
        <label style="font-size:12px; font-weight:600; color:var(--muted,#6b7280); display:block; margin-bottom:4px;">Senha</label>
        <input id="_loginSenha" type="password" placeholder="••••••••" style="
          width:100%; padding:10px 12px; border:1px solid var(--border,#e2eeec);
          border-radius:8px; font-size:14px; box-sizing:border-box; outline:none;
          font-family:inherit;
        "/>
      </div>
      <div style="text-align:right; margin-bottom:16px;">
        <button onclick="_authTab('forgot')" style="background:none;border:none;color:var(--teal,#0d9488);font-size:12px;cursor:pointer;padding:0;font-family:inherit;">Esqueci minha senha</button>
      </div>
      <button onclick="_doLogin()" style="
        width:100%; padding:12px; background:var(--teal,#0d9488); color:#fff;
        border:none; border-radius:8px; font-size:15px; font-weight:700;
        cursor:pointer; font-family:inherit;
      ">Entrar</button>
      <p id="_loginErro" style="color:#e11d48; font-size:13px; text-align:center; margin:10px 0 0; display:none;"></p>
    </div>

    <!-- Formulário Esqueci Minha Senha -->
    <div id="_formForgot" style="display:none;">
      <p style="font-size:13px; color:var(--muted,#6b7280); margin:0 0 16px;">Digite seu e-mail e enviaremos um link para redefinir sua senha.</p>
      <div style="margin-bottom:16px;">
        <label style="font-size:12px; font-weight:600; color:var(--muted,#6b7280); display:block; margin-bottom:4px;">E-mail</label>
        <input id="_forgotEmail" type="email" placeholder="seu@email.com" style="
          width:100%; padding:10px 12px; border:1px solid var(--border,#e2eeec);
          border-radius:8px; font-size:14px; box-sizing:border-box; font-family:inherit;
        "/>
      </div>
      <button onclick="_doForgot()" style="
        width:100%; padding:12px; background:var(--teal,#0d9488); color:#fff;
        border:none; border-radius:8px; font-size:15px; font-weight:700;
        cursor:pointer; font-family:inherit;
      ">Enviar link</button>
      <p id="_forgotErro" style="color:#e11d48; font-size:13px; text-align:center; margin:10px 0 0; display:none;"></p>
      <p id="_forgotOk" style="color:#0d9488; font-size:13px; text-align:center; margin:10px 0 0; display:none;">✓ Link enviado! Verifique seu e-mail.</p>
      <div style="text-align:center; margin-top:12px;">
        <button onclick="_authTab('login')" style="background:none;border:none;color:var(--muted,#6b7280);font-size:12px;cursor:pointer;font-family:inherit;">← Voltar ao login</button>
      </div>
    </div>

    <!-- Formulário Cadastro -->
    <div id="_formCadastro" style="display:none;">
      <div style="margin-bottom:14px;">
        <label style="font-size:12px; font-weight:600; color:var(--muted,#6b7280); display:block; margin-bottom:4px;">Seu nome</label>
        <input id="_cadNome" type="text" placeholder="João Silva" style="
          width:100%; padding:10px 12px; border:1px solid var(--border,#e2eeec);
          border-radius:8px; font-size:14px; box-sizing:border-box; font-family:inherit;
        "/>
      </div>
      <div style="margin-bottom:14px;">
        <label style="font-size:12px; font-weight:600; color:var(--muted,#6b7280); display:block; margin-bottom:4px;">E-mail</label>
        <input id="_cadEmail" type="email" placeholder="seu@email.com" style="
          width:100%; padding:10px 12px; border:1px solid var(--border,#e2eeec);
          border-radius:8px; font-size:14px; box-sizing:border-box; font-family:inherit;
        "/>
      </div>
      <div style="margin-bottom:20px;">
        <label style="font-size:12px; font-weight:600; color:var(--muted,#6b7280); display:block; margin-bottom:4px;">Senha</label>
        <input id="_cadSenha" type="password" placeholder="mínimo 6 caracteres" style="
          width:100%; padding:10px 12px; border:1px solid var(--border,#e2eeec);
          border-radius:8px; font-size:14px; box-sizing:border-box; font-family:inherit;
        "/>
      </div>
      <button onclick="_doCadastro()" style="
        width:100%; padding:12px; background:var(--teal,#0d9488); color:#fff;
        border:none; border-radius:8px; font-size:15px; font-weight:700;
        cursor:pointer; font-family:inherit;
      ">Criar conta</button>
      <p id="_cadErro" style="color:#e11d48; font-size:13px; text-align:center; margin:10px 0 0; display:none;"></p>
    </div>
  </div>
</div>
`;

function _authTab(aba) {
  const isLogin    = aba === 'login';
  const isCadastro = aba === 'cadastro';
  const isForgot   = aba === 'forgot';
  document.getElementById('_formLogin').style.display    = isLogin  ? '' : 'none';
  document.getElementById('_formCadastro').style.display = isCadastro ? '' : 'none';
  document.getElementById('_formForgot').style.display   = isForgot ? '' : 'none';
  document.getElementById('_tabLogin').style.borderBottomColor    = isLogin    ? 'var(--teal,#0d9488)' : 'transparent';
  document.getElementById('_tabCadastro').style.borderBottomColor = isCadastro ? 'var(--teal,#0d9488)' : 'transparent';
  document.getElementById('_tabLogin').style.color    = isLogin    ? 'var(--teal,#0d9488)' : 'var(--muted,#6b7280)';
  document.getElementById('_tabCadastro').style.color = isCadastro ? 'var(--teal,#0d9488)' : 'var(--muted,#6b7280)';
}

async function _doForgot() {
  const email  = document.getElementById('_forgotEmail').value.trim();
  const erroEl = document.getElementById('_forgotErro');
  const okEl   = document.getElementById('_forgotOk');
  erroEl.style.display = 'none';
  okEl.style.display   = 'none';
  if (!email) { erroEl.textContent = 'Digite seu e-mail'; erroEl.style.display = 'block'; return; }
  try {
    await fetch(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    okEl.style.display = 'block';
  } catch {
    erroEl.textContent = 'Erro ao enviar. Tente novamente.';
    erroEl.style.display = 'block';
  }
}

async function _doLogin() {
  const email = document.getElementById('_loginEmail').value.trim();
  const senha = document.getElementById('_loginSenha').value;
  const erroEl = document.getElementById('_loginErro');
  erroEl.style.display = 'none';

  try {
    const { token, nome } = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha })
    }).then(async r => {
      const d = await r.json();
      if (!r.ok) throw d;
      return d;
    });

    _setToken(token);
    window._usuario = { nome, email };
    await _carregarDados();
    _esconderAuth();
    _iniciarApp();

  } catch (err) {
    erroEl.textContent = err.erro || 'Erro ao conectar com o servidor';
    erroEl.style.display = 'block';
  }
}

async function _doCadastro() {
  const nome  = document.getElementById('_cadNome').value.trim();
  const email = document.getElementById('_cadEmail').value.trim();
  const senha = document.getElementById('_cadSenha').value;
  const erroEl = document.getElementById('_cadErro');
  erroEl.style.display = 'none';

  if (!nome || !email || !senha) {
    erroEl.textContent = 'Preencha todos os campos'; erroEl.style.display = 'block'; return;
  }
  if (senha.length < 6) {
    erroEl.textContent = 'Senha deve ter pelo menos 6 caracteres'; erroEl.style.display = 'block'; return;
  }

  try {
    const { token } = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, email, senha })
    }).then(async r => {
      const d = await r.json();
      if (!r.ok) throw d;
      return d;
    });

    _setToken(token);
    window._usuario = { nome, email };
    await _carregarDados();
    _esconderAuth();
    _iniciarApp();

  } catch (err) {
    erroEl.textContent = err.erro || 'Erro ao criar conta';
    erroEl.style.display = 'block';
  }
}

function _esconderAuth() {
  const el = document.getElementById('_authOverlay');
  if (el) el.remove();
}

// Adiciona botão de logout no app (chamado após login)
function _injetarBotaoLogout() {
  const area = document.querySelector('.nav-actions') || document.querySelector('nav') || document.body;

  // Botão de zerar dados
  const btnZerar = document.createElement('button');
  btnZerar.id = '_btnZerar';
  btnZerar.title = 'Zerar todos os dados';
  btnZerar.textContent = '🗑️';
  btnZerar.style.cssText = `
    background:none; border:1px solid var(--border,#e2eeec); border-radius:8px;
    padding:6px 10px; cursor:pointer; font-size:16px;
    color:var(--muted,#6b7280); margin-left:8px;
  `;
  btnZerar.onclick = _zerarDados;

  // Botão de logout
  const btn = document.createElement('button');
  btn.id = '_btnLogout';
  btn.title = 'Sair da conta';
  btn.textContent = '🔓';
  btn.style.cssText = `
    background:none; border:1px solid var(--border,#e2eeec); border-radius:8px;
    padding:6px 10px; cursor:pointer; font-size:16px;
    color:var(--muted,#6b7280); margin-left:8px;
  `;
  btn.onclick = _logout;

  // Tenta colocar perto do botão de tema
  const btnDark = document.getElementById('btnDark');
  if (btnDark && btnDark.parentNode) {
    btnDark.parentNode.insertBefore(btnZerar, btnDark.nextSibling);
    btnDark.parentNode.insertBefore(btn, btnZerar.nextSibling);
  } else {
    area.appendChild(btnZerar);
    area.appendChild(btn);
  }
}

function _logout() {
  if (!confirm('Sair da conta?')) return;
  _clearToken();
  window._dados = {};
  location.reload();
}

function _zerarDados() {
  // — overlay
  var ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px;font-family:sans-serif;';

  // — caixa
  var box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:16px;padding:28px 24px;width:100%;max-width:340px;box-shadow:0 8px 32px rgba(0,0,0,.25);text-align:center;';

  var ico = document.createElement('div');
  ico.style.cssText = 'font-size:2rem;margin-bottom:10px';
  ico.textContent = '⚠️';

  var ttl = document.createElement('p');
  ttl.style.cssText = 'margin:0 0 8px;font-size:1rem;font-weight:700;color:#0f2724;';
  ttl.textContent = 'Zerar todos os dados?';

  var sub = document.createElement('p');
  sub.style.cssText = 'margin:0 0 20px;font-size:0.82rem;color:#6b7280;line-height:1.5;';
  sub.textContent = 'Cartões, gastos, parcelas e tudo mais serão apagados permanentemente.';

  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;';

  var btnNao = document.createElement('button');
  btnNao.style.cssText = 'flex:1;padding:12px;background:#f0f7f6;border:1px solid #e2eeec;border-radius:8px;font-size:0.9rem;font-weight:600;cursor:pointer;';
  btnNao.textContent = 'Cancelar';
  btnNao.addEventListener('click', function() { document.body.removeChild(ov); });

  var btnSim = document.createElement('button');
  btnSim.style.cssText = 'flex:1;padding:12px;background:#e11d48;border:none;border-radius:8px;font-size:0.9rem;font-weight:700;cursor:pointer;color:#fff;';
  btnSim.textContent = 'Apagar tudo';
  btnSim.addEventListener('click', function() {
    btnSim.disabled = true;
    btnSim.textContent = 'Zerando…';

    // Usa save() — mesma função do import de backup, comprovada
    var chaves = ['fp_cartoes','fp_parcelas','fp_gastos','fp_invest',
                  'fp_adicional_parcelas','fp_adicional_gastos',
                  'fp_contas_fixas','fp_receitas','fp_cofrinhos','fp_metas'];
    chaves.forEach(function(k) { save(k, []); });

    // Limpa cache local
    window._dados = {};

    // Feedback visual sem alert
    box.innerHTML = '';
    var ok = document.createElement('div');
    ok.style.cssText = 'padding:16px;';
    ok.innerHTML = '<div style="font-size:2rem">✅</div><p style="font-weight:700;color:#0d9488;margin:10px 0 4px">Dados zerados!</p><p style="font-size:0.8rem;color:#6b7280;margin:0">Recarregando em 3 segundos…</p>';
    box.appendChild(ok);

    setTimeout(function() { location.reload(); }, 3000);
  });

  row.appendChild(btnNao);
  row.appendChild(btnSim);
  box.appendChild(ico);
  box.appendChild(ttl);
  box.appendChild(sub);
  box.appendChild(row);
  ov.appendChild(box);
  document.body.appendChild(ov);
}

// ══════════════════════════════════════════════════════════════
//  BOOTSTRAP — roda antes do app
// ══════════════════════════════════════════════════════════════

// Injeta o HTML de auth no body assim que o DOM existir
document.addEventListener('DOMContentLoaded', async () => {

  // Injeta toast de erro de rede (fica fora do overlay também)
  if (!document.getElementById('_apiToast')) {
    const toast = document.createElement('div');
    toast.id = '_apiToast';
    toast.style.cssText = `
      display:none; position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
      background:#e11d48; color:#fff; padding:10px 20px; border-radius:8px;
      font-size:14px; z-index:10000;
    `;
    document.body.appendChild(toast);
  }

  // Chegou via link de redefinição de senha?
  const params = new URLSearchParams(window.location.search);
  const resetToken = params.get('token');
  if (resetToken) {
    _mostrarTelaReset(resetToken);
    return;
  }

  const token = _getToken();

  // Já tem token salvo → tenta reautenticar silenciosamente
  if (token) {
    try {
      window._token = token;
      await _carregarDados();
      _iniciarApp();
      return;
    } catch (err) {
      // Token expirado ou inválido → vai para login
      _clearToken();
    }
  }

  // Sem token → mostra tela de login
  document.body.insertAdjacentHTML('afterbegin', _AUTH_HTML);
});

function _mostrarTelaReset(token) {
  const html = `
  <div id="_authOverlay" style="position:fixed;inset:0;z-index:9999;background:var(--bg,#f7fafa);display:flex;align-items:center;justify-content:center;font-family:'Plus Jakarta Sans',sans-serif;">
    <div style="background:var(--surface,#fff);border:1px solid var(--border,#e2eeec);border-radius:16px;padding:36px 32px;width:100%;max-width:380px;box-shadow:0 8px 32px rgba(13,148,136,.10);">
      <div style="text-align:center;margin-bottom:28px;">
        <div style="font-size:32px;margin-bottom:8px;">🔑</div>
        <h1 style="margin:0;font-size:22px;font-weight:700;color:var(--text,#0f2724);">Nova senha</h1>
        <p style="margin:4px 0 0;font-size:13px;color:var(--muted,#6b7280);">Digite sua nova senha abaixo</p>
      </div>
      <div style="margin-bottom:14px;">
        <label style="font-size:12px;font-weight:600;color:var(--muted,#6b7280);display:block;margin-bottom:4px;">Nova senha</label>
        <input id="_resetSenha" type="password" placeholder="mínimo 6 caracteres" style="width:100%;padding:10px 12px;border:1px solid var(--border,#e2eeec);border-radius:8px;font-size:14px;box-sizing:border-box;font-family:inherit;"/>
      </div>
      <div style="margin-bottom:20px;">
        <label style="font-size:12px;font-weight:600;color:var(--muted,#6b7280);display:block;margin-bottom:4px;">Confirmar senha</label>
        <input id="_resetConfirm" type="password" placeholder="repita a senha" style="width:100%;padding:10px 12px;border:1px solid var(--border,#e2eeec);border-radius:8px;font-size:14px;box-sizing:border-box;font-family:inherit;"/>
      </div>
      <button onclick="_doReset('${token}')" style="width:100%;padding:12px;background:var(--teal,#0d9488);color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;">Salvar nova senha</button>
      <p id="_resetErro" style="color:#e11d48;font-size:13px;text-align:center;margin:10px 0 0;display:none;"></p>
      <p id="_resetOk"  style="color:#0d9488;font-size:13px;text-align:center;margin:10px 0 0;display:none;"></p>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('afterbegin', html);
}

async function _doReset(token) {
  const senha   = document.getElementById('_resetSenha').value;
  const confirm = document.getElementById('_resetConfirm').value;
  const erroEl  = document.getElementById('_resetErro');
  const okEl    = document.getElementById('_resetOk');
  erroEl.style.display = 'none';
  okEl.style.display   = 'none';

  if (senha.length < 6) { erroEl.textContent = 'Senha deve ter pelo menos 6 caracteres'; erroEl.style.display = 'block'; return; }
  if (senha !== confirm) { erroEl.textContent = 'As senhas não conferem'; erroEl.style.display = 'block'; return; }

  try {
    const res = await fetch(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, senha })
    });
    const data = await res.json();
    if (!res.ok) throw data;
    okEl.textContent = '✓ Senha redefinida! Redirecionando...';
    okEl.style.display = 'block';
    setTimeout(() => { window.location.href = '/'; }, 2000);
  } catch (err) {
    erroEl.textContent = err.erro || 'Erro ao redefinir senha';
    erroEl.style.display = 'block';
  }
}

// _iniciarApp() é chamada DEPOIS que os dados da API foram carregados.
// Ela dispara a inicialização normal do app (que vai chamar load() e save()).
function _iniciarApp() {
  _injetarBotaoLogout();

  // Dispara o evento que o app escuta para inicializar
  // (ou chama as funções de render diretamente se não houver evento)
  if (typeof iniciarApp === 'function') {
    iniciarApp();
  } else {
    // Fallback: o app original usa DOMContentLoaded.
    // Como já passamos dele, precisamos disparar manualmente.
    // As variáveis globais (cartoes, parcelas, etc.) precisam ser
    // reatribuídas com os dados da API.
    _reatribuirVariaveis();
  }
}

// Reatribui as variáveis globais do app com os dados da API
// (necessário porque o app original as inicializa via load() antes do bootstrap)
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
  if (typeof notas !== 'undefined')             notas             = load('fp_notas', notas);

  // Re-renderiza tudo
  if (typeof renderCartoes === 'function')      renderCartoes();
  if (typeof renderParcelas === 'function')     renderParcelas();
  if (typeof renderGastos === 'function')       renderGastos();
  if (typeof renderInvest === 'function')       renderInvest();
  if (typeof renderAdicionais === 'function')   renderAdicionais();
  if (typeof renderContasFixas === 'function')  renderContasFixas();
  if (typeof renderReceitas === 'function')     renderReceitas();
  if (typeof renderCofrinhos === 'function')    renderCofrinhos();
  if (typeof renderMetas === 'function')        renderMetas();
  if (typeof renderNotas === 'function')        renderNotas();
  if (typeof renderAlerts === 'function')       renderAlerts();
  if (typeof atualizarTotalMes === 'function')  atualizarTotalMes();
}
