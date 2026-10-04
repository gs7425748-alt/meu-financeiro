/* =====================================================
   MEU FINANCEIRO — AUTENTICAÇÃO (LOGIN / CADASTRO)
   -----------------------------------------------------
   - Contas ficam salvas neste navegador (localStorage).
   - Senhas NUNCA são salvas em texto: usamos PBKDF2-SHA256
     com salt aleatório (120.000 iterações).
   - "Esqueci minha senha" funciona com um código de
     recuperação gerado no cadastro.
   - O app (app.js) só inicia depois de MFAuth.ready().
   ===================================================== */
(function (global) {
    'use strict';

    const USERS_KEY = 'mf_auth_users';
    const SESSION_KEY = 'mf_auth_session';
    const REMEMBER_DAYS = 30;
    const PBKDF2_ITER = 120000;

    // ---------- Utilidades de criptografia ----------
    const enc = new TextEncoder();
    const toHex = (buf) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    const randHex = (bytes) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));

    async function hashSecret(secret, saltHex) {
        if (!global.crypto || !crypto.subtle) {
            throw new Error('Seu navegador bloqueou a criptografia. Acesse pelo link https:// do site.');
        }
        const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
        const salt = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
        const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' }, key, 256);
        return toHex(bits);
    }

    function genRecoveryCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const rnd = crypto.getRandomValues(new Uint8Array(12));
        let s = '';
        rnd.forEach((b, i) => { s += chars[b % chars.length]; if (i === 3 || i === 7) s += '-'; });
        return s; // ex: ABCD-EFGH-JKLM
    }

    // ---------- Armazenamento ----------
    const normEmail = (e) => String(e || '').trim().toLowerCase();

    function getUsers() {
        try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; } catch (e) { return []; }
    }
    function saveUsers(list) { localStorage.setItem(USERS_KEY, JSON.stringify(list)); }
    function findUser(email) { return getUsers().find(u => u.email === normEmail(email)); }

    function readSession() {
        const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        try {
            const s = JSON.parse(raw);
            if (s.exp && Date.now() > s.exp) { clearSession(); return null; }
            if (!findUser(s.email)) { clearSession(); return null; }
            return s;
        } catch (e) { clearSession(); return null; }
    }
    function writeSession(user, remember) {
        const s = { email: user.email, name: user.name, at: Date.now() };
        clearSession();
        if (remember) {
            s.exp = Date.now() + REMEMBER_DAYS * 864e5;
            localStorage.setItem(SESSION_KEY, JSON.stringify(s));
        } else {
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
        }
        return s;
    }
    function clearSession() {
        localStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_KEY);
    }

    // ---------- Estado ----------
    let session = readSession();
    let resolveReady;
    const readyPromise = new Promise(r => { resolveReady = r; });

    if (session) {
        resolveReady(session);
    } else {
        document.documentElement.classList.add('mf-auth-pending');
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', renderAuth);
        } else {
            renderAuth();
        }
    }

    // ---------- Interface ----------
    const eyeBtn = (id) => `<button type="button" class="mfa-eye" data-eye="${id}" tabindex="-1" aria-label="Mostrar senha"><i class="fas fa-eye"></i></button>`;

    function template() {
        return `
        <aside class="mfa-brand">
            <div class="mfa-logo">
                <div class="mfa-logo-mark"><i class="fas fa-chart-pie"></i></div>
                MeuFinanceiro
            </div>
            <div class="mfa-hero">
                <h1>Seu dinheiro,<br><span>sob controle total.</span></h1>
                <p>Organize receitas, despesas, poupança e investimentos em um só lugar — com relatórios claros e diagnóstico inteligente.</p>
                <ul class="mfa-features">
                    <li><i class="fas fa-gem"></i> Patrimônio e investimentos com rendimento automático</li>
                    <li><i class="fas fa-stethoscope"></i> Raio-X de gastos com gráficos detalhados</li>
                    <li><i class="fas fa-shield-halved"></i> Senha protegida com criptografia</li>
                </ul>
            </div>
            <div class="mfa-brand-footer">© ${new Date().getFullYear()} MeuFinanceiro · Gestão Financeira Inteligente</div>
        </aside>

        <section class="mfa-panel">
            <div class="mfa-card">

                <!-- LOGIN -->
                <div class="mfa-view active" data-view="login">
                    <h2>Bem-vindo de volta 👋</h2>
                    <p class="mfa-sub">Entre na sua conta para continuar.</p>
                    <div class="mfa-msg" data-msg="login"></div>
                    <form data-form="login" novalidate>
                        <div class="mfa-field">
                            <label for="mfaLoginEmail">E-mail</label>
                            <div class="mfa-input-wrap"><i class="fas fa-envelope"></i>
                                <input id="mfaLoginEmail" type="email" placeholder="voce@email.com" autocomplete="username" required>
                            </div>
                        </div>
                        <div class="mfa-field">
                            <label for="mfaLoginPass">Senha</label>
                            <div class="mfa-input-wrap"><i class="fas fa-lock"></i>
                                <input id="mfaLoginPass" type="password" placeholder="Sua senha" autocomplete="current-password" required>
                                ${eyeBtn('mfaLoginPass')}
                            </div>
                        </div>
                        <div class="mfa-row">
                            <label class="mfa-check"><input type="checkbox" id="mfaRemember" checked> Manter conectado</label>
                            <button type="button" class="mfa-link" data-go="forgot">Esqueci minha senha</button>
                        </div>
                        <button type="submit" class="mfa-btn"><i class="fas fa-right-to-bracket"></i> Entrar</button>
                    </form>
                    <div class="mfa-switch">Ainda não tem conta? <button type="button" class="mfa-link" data-go="signup">Criar conta grátis</button></div>
                </div>

                <!-- CADASTRO -->
                <div class="mfa-view" data-view="signup">
                    <h2>Crie sua conta ✨</h2>
                    <p class="mfa-sub">Leva menos de 1 minuto.</p>
                    <div class="mfa-msg" data-msg="signup"></div>
                    <form data-form="signup" novalidate>
                        <div class="mfa-field">
                            <label for="mfaSignName">Nome</label>
                            <div class="mfa-input-wrap"><i class="fas fa-user"></i>
                                <input id="mfaSignName" type="text" placeholder="Como quer ser chamado" autocomplete="name" required maxlength="40">
                            </div>
                        </div>
                        <div class="mfa-field">
                            <label for="mfaSignEmail">E-mail</label>
                            <div class="mfa-input-wrap"><i class="fas fa-envelope"></i>
                                <input id="mfaSignEmail" type="email" placeholder="voce@email.com" autocomplete="username" required>
                            </div>
                        </div>
                        <div class="mfa-field">
                            <label for="mfaSignPass">Senha</label>
                            <div class="mfa-input-wrap"><i class="fas fa-lock"></i>
                                <input id="mfaSignPass" type="password" placeholder="Mínimo 6 caracteres" autocomplete="new-password" required>
                                ${eyeBtn('mfaSignPass')}
                            </div>
                            <div class="mfa-strength"><span></span><span></span><span></span><span></span></div>
                            <div class="mfa-strength-label"></div>
                        </div>
                        <div class="mfa-field">
                            <label for="mfaSignPass2">Confirmar senha</label>
                            <div class="mfa-input-wrap"><i class="fas fa-lock"></i>
                                <input id="mfaSignPass2" type="password" placeholder="Repita a senha" autocomplete="new-password" required>
                                ${eyeBtn('mfaSignPass2')}
                            </div>
                        </div>
                        <button type="submit" class="mfa-btn mfa-btn-success"><i class="fas fa-user-plus"></i> Criar conta</button>
                    </form>
                    <div class="mfa-switch">Já tem conta? <button type="button" class="mfa-link" data-go="login">Entrar</button></div>
                </div>

                <!-- CÓDIGO DE RECUPERAÇÃO (após cadastro) -->
                <div class="mfa-view" data-view="code">
                    <h2>Guarde este código 🔑</h2>
                    <p class="mfa-sub">Ele é a única forma de redefinir sua senha se você esquecê-la. Anote ou tire um print.</p>
                    <div class="mfa-code-box">
                        <div class="mfa-code" data-code></div>
                        <div class="mfa-code-actions"><button type="button" class="mfa-link" data-copy><i class="fas fa-copy"></i> Copiar código</button></div>
                    </div>
                    <button type="button" class="mfa-btn" data-enter><i class="fas fa-arrow-right"></i> Já guardei, entrar no sistema</button>
                </div>

                <!-- ESQUECI A SENHA -->
                <div class="mfa-view" data-view="forgot">
                    <h2>Redefinir senha 🔁</h2>
                    <p class="mfa-sub">Use o código de recuperação que você recebeu no cadastro.</p>
                    <div class="mfa-msg" data-msg="forgot"></div>
                    <form data-form="forgot" novalidate>
                        <div class="mfa-field">
                            <label for="mfaFgEmail">E-mail</label>
                            <div class="mfa-input-wrap"><i class="fas fa-envelope"></i>
                                <input id="mfaFgEmail" type="email" placeholder="voce@email.com" required>
                            </div>
                        </div>
                        <div class="mfa-field">
                            <label for="mfaFgCode">Código de recuperação</label>
                            <div class="mfa-input-wrap"><i class="fas fa-key"></i>
                                <input id="mfaFgCode" type="text" placeholder="XXXX-XXXX-XXXX" required style="text-transform:uppercase">
                            </div>
                        </div>
                        <div class="mfa-field">
                            <label for="mfaFgPass">Nova senha</label>
                            <div class="mfa-input-wrap"><i class="fas fa-lock"></i>
                                <input id="mfaFgPass" type="password" placeholder="Mínimo 6 caracteres" autocomplete="new-password" required>
                                ${eyeBtn('mfaFgPass')}
                            </div>
                        </div>
                        <button type="submit" class="mfa-btn"><i class="fas fa-rotate"></i> Redefinir senha</button>
                    </form>
                    <div class="mfa-switch"><button type="button" class="mfa-link" data-go="login"><i class="fas fa-arrow-left"></i> Voltar ao login</button></div>
                </div>

                <p class="mfa-note"><i class="fas fa-shield-halved"></i> Sua senha é criptografada e fica salva apenas neste aparelho.</p>
            </div>
        </section>`;
    }

    let root, pendingUser = null, pendingRemember = true;

    function renderAuth() {
        if (document.getElementById('mfAuth')) return;
        root = document.createElement('div');
        root.id = 'mfAuth';
        root.innerHTML = template();
        document.body.appendChild(root);

        root.addEventListener('click', onClick);
        root.querySelector('[data-form="login"]').addEventListener('submit', onLogin);
        root.querySelector('[data-form="signup"]').addEventListener('submit', onSignup);
        root.querySelector('[data-form="forgot"]').addEventListener('submit', onForgot);
        root.querySelector('#mfaSignPass').addEventListener('input', (e) => updateStrength(e.target.value));

        // Primeiro acesso: abre direto no cadastro
        go(getUsers().length ? 'login' : 'signup');
    }

    function $(sel) { return root.querySelector(sel); }

    function go(view) {
        root.querySelectorAll('.mfa-view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
        root.querySelectorAll('.mfa-msg').forEach(m => m.classList.remove('show'));
        const first = root.querySelector(`.mfa-view[data-view="${view}"] input`);
        if (first) setTimeout(() => first.focus(), 50);
    }

    function msg(name, text, type = 'error') {
        const el = $(`[data-msg="${name}"]`);
        el.className = `mfa-msg show ${type}`;
        el.textContent = text;
    }

    function busy(form, on) {
        const btn = form.querySelector('button[type="submit"]');
        if (on) {
            btn.dataset.html = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aguarde...';
            btn.disabled = true;
        } else {
            btn.innerHTML = btn.dataset.html || btn.innerHTML;
            btn.disabled = false;
        }
    }

    function onClick(e) {
        const t = e.target.closest('button');
        if (!t) return;
        if (t.dataset.go) go(t.dataset.go);
        if (t.dataset.eye) {
            const inp = document.getElementById(t.dataset.eye);
            const show = inp.type === 'password';
            inp.type = show ? 'text' : 'password';
            t.innerHTML = `<i class="fas fa-eye${show ? '-slash' : ''}"></i>`;
        }
        if (t.hasAttribute('data-copy')) {
            const code = $('[data-code]').textContent;
            (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject())
                .then(() => { t.innerHTML = '<i class="fas fa-check"></i> Copiado!'; })
                .catch(() => { t.textContent = 'Selecione e copie manualmente'; });
        }
        if (t.hasAttribute('data-enter') && pendingUser) finishLogin(pendingUser, pendingRemember);
    }

    const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

    function scorePassword(p) {
        let s = 0;
        if (p.length >= 6) s++;
        if (p.length >= 10) s++;
        if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
        if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
        return Math.min(s, 4);
    }

    function updateStrength(p) {
        const s = p ? Math.max(1, scorePassword(p)) : 0;
        const colors = ['#26262d', '#ef4444', '#f59e0b', '#3b82f6', '#10b981'];
        const labels = ['', 'Fraca', 'Razoável', 'Boa', 'Forte'];
        root.querySelectorAll('.mfa-strength span').forEach((b, i) => { b.style.background = i < s ? colors[s] : colors[0]; });
        $('.mfa-strength-label').textContent = labels[s];
        $('.mfa-strength-label').style.color = colors[s];
    }

    // ---------- Ações ----------
    async function onLogin(e) {
        e.preventDefault();
        const form = e.target;
        const email = normEmail($('#mfaLoginEmail').value);
        const pass = $('#mfaLoginPass').value;
        if (!validEmail(email) || !pass) return msg('login', 'Preencha e-mail e senha corretamente.');

        busy(form, true);
        try {
            const user = findUser(email);
            const ok = user && (await hashSecret(pass, user.salt)) === user.hash;
            if (!ok) {
                msg('login', 'E-mail ou senha incorretos.');
                $('#mfaLoginPass').value = '';
                return;
            }
            finishLogin(user, $('#mfaRemember').checked);
        } catch (err) {
            msg('login', err.message);
        } finally {
            busy(form, false);
        }
    }

    async function onSignup(e) {
        e.preventDefault();
        const form = e.target;
        const name = $('#mfaSignName').value.trim();
        const email = normEmail($('#mfaSignEmail').value);
        const p1 = $('#mfaSignPass').value;
        const p2 = $('#mfaSignPass2').value;

        if (name.length < 2) return msg('signup', 'Digite seu nome.');
        if (!validEmail(email)) return msg('signup', 'Digite um e-mail válido.');
        if (p1.length < 6) return msg('signup', 'A senha precisa ter pelo menos 6 caracteres.');
        if (p1 !== p2) return msg('signup', 'As senhas não conferem.');
        if (findUser(email)) return msg('signup', 'Já existe uma conta com este e-mail neste aparelho.');

        busy(form, true);
        try {
            const salt = randHex(16);
            const recSalt = randHex(16);
            const code = genRecoveryCode();
            const user = {
                id: randHex(8),
                name,
                email,
                salt,
                hash: await hashSecret(p1, salt),
                recSalt,
                recHash: await hashSecret(code, recSalt),
                createdAt: new Date().toISOString()
            };
            const users = getUsers();
            users.push(user);
            saveUsers(users);

            pendingUser = user;
            pendingRemember = true;
            $('[data-code]').textContent = code;
            go('code');
        } catch (err) {
            msg('signup', err.message);
        } finally {
            busy(form, false);
        }
    }

    async function onForgot(e) {
        e.preventDefault();
        const form = e.target;
        const email = normEmail($('#mfaFgEmail').value);
        const code = $('#mfaFgCode').value.trim().toUpperCase();
        const np = $('#mfaFgPass').value;

        if (!validEmail(email) || !code) return msg('forgot', 'Preencha e-mail e código.');
        if (np.length < 6) return msg('forgot', 'A nova senha precisa ter pelo menos 6 caracteres.');

        busy(form, true);
        try {
            const users = getUsers();
            const user = users.find(u => u.email === email);
            const ok = user && (await hashSecret(code, user.recSalt)) === user.recHash;
            if (!ok) return msg('forgot', 'E-mail ou código de recuperação inválidos.');

            user.salt = randHex(16);
            user.hash = await hashSecret(np, user.salt);
            saveUsers(users);
            go('login');
            $('#mfaLoginEmail').value = email;
            msg('login', 'Senha redefinida! Entre com a nova senha.', 'ok');
        } catch (err) {
            msg('forgot', err.message);
        } finally {
            busy(form, false);
        }
    }

    function finishLogin(user, remember) {
        session = writeSession(user, remember);
        pendingUser = null;
        if (root) {
            root.style.transition = 'opacity .35s';
            root.style.opacity = '0';
            setTimeout(() => { root.remove(); root = null; }, 350);
        }
        document.documentElement.classList.remove('mf-auth-pending');
        resolveReady(session);
    }

    // ---------- API pública ----------
    global.MFAuth = {
        ready: () => readyPromise,
        currentUser: () => session,
        logout() {
            if (!confirm('Deseja sair da sua conta?')) return;
            clearSession();
            location.reload();
        }
    };
})(window);
