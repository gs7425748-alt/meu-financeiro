/* ============================================
   MeuFinanceiro - Application Logic
   ============================================ */

// ============================================
// DATA STORE (integrado ao AxisDB)
// ============================================
const STORAGE_KEY = 'meufinanceiro_data';

const defaultData = {
    userName: 'Usuário',
    savingsPercent: 20,
    minSavingsPercent: 5, // % de segurança mesmo que a meta não seja batida
    savingsRuleMode: 'income', // 'income' (sobre receita total) ou 'balance' (sobre saldo livre)
    darkMode: false,
    privacyMode: false,
    salary: null, // { desc, value, payDay, autoRegister }
    incomes: [],
    expenses: [],
    fixedExpenses: [],
    detailedExpenses: [],
    savingsTransactions: [],
    savingsGoals: [],
    savingsBalance: 0,
    budgetLimits: {}, // { 'Alimentação': 800, ... } limite mensal por categoria
    investments: [],
    quarantineItems: [],
    totalAvoidedImpulses: 0,
    extraIncomeCategories: ['Fotos', 'Freelance', 'Bicos', 'Outros'],
    minWageBase: 1412.00,
    minWageDivisorAllocation: { essencial: 50, pessoal: 30, poupanca: 20 }
};

function loadData() {
    // Se AxisDB está disponível e inicializado, usar ele
    if (typeof AxisDB !== 'undefined') {
        const data = AxisDB.load();
        if (data) return data;
    }
    // Fallback direto ao localStorage (caso db.js não carregue)
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return { ...defaultData, ...parsed };
        }
    } catch (e) {
        console.error('[MeuFinanceiro] Erro no loadData fallback:', e);
    }
    return { ...defaultData };
}

function saveData(data) {
    // Se AxisDB está disponível, usar (inclui validação + backup automático)
    if (typeof AxisDB !== 'undefined') {
        AxisDB.save(data);
        return;
    }
    // Fallback direto ao localStorage
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.error('[MeuFinanceiro] Erro no saveData fallback:', e);
    }
}

let appData = loadData();

// Expor globalmente no window (inclusive alias em minúsculo) para evitar erro ao inspecionar no Console
if (typeof window !== 'undefined') {
    window.appData = appData;
    Object.defineProperty(window, 'appdata', {
        get() { return appData; },
        set(v) { appData = v; window.appData = v; },
        configurable: true
    });
}

// ============================================
// UTILITIES
// ============================================
// Converte um valor digitado no padrão brasileiro (ex: "1.500,50" ou "1500,50" ou "1500.50")
// para um Number válido em JS. Necessário porque os campos de valor aceitam vírgula decimal.
function parseMoneyBR(str) {
    if (typeof str === 'number') return str;
    if (!str) return 0;
    let clean = String(str).trim();
    if (clean.includes(',')) {
        // Remove pontos de milhar e troca a vírgula decimal por ponto
        clean = clean.replace(/\./g, '').replace(',', '.');
    }
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
}

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getMonthYear(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthYearLabel(monthYearStr) {
    const [year, month] = monthYearStr.split('-');
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${months[parseInt(month) - 1]} ${year}`;
}

function getCurrentMonthYear() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getSorter(sort) {
    const byCreated = (a, b) => (a.createdAt || '').localeCompare(b.createdAt || '');
    const sorters = {
        'date-desc': (a, b) => b.date.localeCompare(a.date) || byCreated(b, a),
        'date-asc': (a, b) => a.date.localeCompare(b.date) || byCreated(a, b),
        'value-desc': (a, b) => b.value - a.value,
        'value-asc': (a, b) => a.value - b.value,
        'name-asc': (a, b) => a.desc.localeCompare(b.desc, 'pt-BR')
    };
    return sorters[sort] || sorters['date-desc'];
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function getTodayStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function showToast(message) {
    const toast = document.getElementById('toast');
    document.getElementById('toastMessage').textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

const categoryColors = {
    'Alimentação': '#ef4444',
    'Moradia': '#f59e0b',
    'Transporte': '#2563eb',
    'Saúde': '#10b981',
    'Educação': '#3b82f6',
    'Lazer': '#06b6d4',
    'Roupas': '#8b5cf6',
    'Contas': '#64748b',
    'Assinaturas': '#0284c7',
    'Outros': '#475569',
    'Salário': '#2563eb',
    'Freelance': '#06b6d4',
    'Investimentos': '#72af56',
    'Vendas': '#10b981',
    'Presente': '#ec4899'
};

const categoryIcons = {
    'Alimentação': 'fa-utensils', 'Moradia': 'fa-house', 'Transporte': 'fa-car',
    'Saúde': 'fa-heart-pulse', 'Educação': 'fa-graduation-cap', 'Lazer': 'fa-gamepad',
    'Roupas': 'fa-shirt', 'Contas': 'fa-file-invoice', 'Assinaturas': 'fa-tv',
    'Outros': 'fa-box', 'Salário': 'fa-briefcase', 'Freelance': 'fa-laptop-code',
    'Investimentos': 'fa-chart-line', 'Vendas': 'fa-store', 'Presente': 'fa-gift'
};

// ============================================
// DARK MODE (PADRÃO AXISEDUC)
// ============================================
function initDarkMode() {
    const isDark = !!appData.darkMode;
    document.body.classList.toggle('dark', isDark);
    document.documentElement.setAttribute('data-bs-theme', isDark ? 'dark' : 'light');
    const icon = document.getElementById('themeIcon');
    if (icon) {
        if (isDark) {
            icon.classList.replace('fa-moon', 'fa-sun');
        } else {
            icon.classList.replace('fa-sun', 'fa-moon');
        }
    }
}

document.getElementById('themeToggle').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    const isDark = document.body.classList.contains('dark');
    appData.darkMode = isDark;
    saveData(appData);
    localStorage.setItem('axiseduc-theme', isDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-bs-theme', isDark ? 'dark' : 'light');

    const icon = document.getElementById('themeIcon');
    if (icon) {
        if (isDark) {
            icon.classList.replace('fa-moon', 'fa-sun');
        } else {
            icon.classList.replace('fa-sun', 'fa-moon');
        }
    }

    // Re-renderizar gráficos com cores e gradientes atualizados
    refreshDashboard();
    if (document.getElementById('page-relatorios').classList.contains('active')) {
        refreshReports();
    }
    if (typeof renderInvestmentAllocationChart === 'function') {
        renderInvestmentAllocationChart();
    }
});

// ============================================
// PRIVACY MODE (OCULTAR VALORES)
// ============================================
function initPrivacyMode() {
    const isPrivacy = !!appData.privacyMode;
    document.body.classList.toggle('privacy-active', isPrivacy);
    const icon = document.getElementById('privacyIcon');
    if (icon) {
        icon.className = isPrivacy ? 'fas fa-eye-slash' : 'fas fa-eye';
    }
}

function togglePrivacyMode() {
    appData.privacyMode = !appData.privacyMode;
    saveData(appData);
    initPrivacyMode();
    showToast(appData.privacyMode ? 'Modo Privacidade ativado: valores ocultos!' : 'Modo Privacidade desativado: valores visíveis!');
}

// ============================================
// NAVIGATION
// ============================================
const navLinks = document.querySelectorAll('.nav-link');
const pages = document.querySelectorAll('.page');
const pageTitle = document.getElementById('pageTitle');

const pageTitles = {
    dashboard: 'Dashboard',
    transacoes: 'Transações & Movimentações',
    gestao: 'Gestão de Renda & Divisor',
    patrimonio: 'Patrimônio & Investir',
    raiox: 'Raio-X de Gastos & Consciência Financeira',
    relatorios: 'Relatórios & Dicas',
    // Mapeamento retrocompatível:
    receitas: 'Transações - Receitas',
    despesas: 'Transações - Despesas',
    porcentagens: 'Patrimônio - Divisor de Aporte',
    poupanca: 'Patrimônio - Poupança & Reserva',
    investimentos: 'Patrimônio - Investimentos',
    dicas: 'Relatórios & Dicas'
};

navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(link.dataset.page);
    });
});

function navigateTo(page, subtab) {
    let resolvedPage = page;
    let targetSubtab = subtab;

    // Resolução inteligente para as 6 abas mestras unificadas
    if (page === 'receitas') {
        resolvedPage = 'transacoes';
        targetSubtab = targetSubtab || 'receitas';
    } else if (page === 'despesas') {
        resolvedPage = 'transacoes';
        targetSubtab = targetSubtab || 'despesas';
    } else if (page === 'poupanca') {
        resolvedPage = 'patrimonio';
        targetSubtab = targetSubtab || 'poupanca';
    } else if (page === 'investimentos') {
        resolvedPage = 'patrimonio';
        targetSubtab = targetSubtab || 'investimentos';
    } else if (page === 'porcentagens') {
        resolvedPage = 'patrimonio';
        targetSubtab = targetSubtab || 'aporte';
    } else if (page === 'dicas') {
        resolvedPage = 'relatorios';
        targetSubtab = targetSubtab || 'dicas';
    }

    navLinks.forEach(l => l.classList.remove('active'));
    const targetLink = document.querySelector(`[data-page="${resolvedPage}"]`);
    if (targetLink) targetLink.classList.add('active');

    pages.forEach(p => p.classList.remove('active'));
    const targetPage = document.getElementById(`page-${resolvedPage}`);
    if (targetPage) targetPage.classList.add('active');

    pageTitle.textContent = pageTitles[page] || pageTitles[resolvedPage] || 'MeuFinanceiro';
    document.getElementById('sidebar').classList.remove('mobile-open');

    if (resolvedPage === 'dashboard') refreshDashboard();
    if (resolvedPage === 'transacoes') {
        renderIncomeList();
        renderExpenseList();
        renderAllTransactionsList();
        if (targetSubtab) switchTransacoesTab(targetSubtab);
    }
    if (resolvedPage === 'gestao') refreshGestaoPage();
    if (resolvedPage === 'patrimonio') {
        switchPatrimonioTab(targetSubtab || 'poupanca');
    }
    if (resolvedPage === 'raiox') refreshRaioXPage();
    if (resolvedPage === 'relatorios') {
        refreshReports();
        renderTips();
        if (targetSubtab) switchRelatoriosTab(targetSubtab);
    }
}

// Alternadores de Sub-Abas dos Hubs
function switchTransacoesTab(tabName) {
    ['todas', 'receitas', 'despesas'].forEach(t => {
        const btn = document.getElementById(`tabBtn-tx-${t}`);
        const pane = document.getElementById(`tabPane-tx-${t}`);
        if (btn) btn.classList.toggle('active', t === tabName);
        if (pane) pane.classList.toggle('active', t === tabName);
    });
    if (tabName === 'todas') renderAllTransactionsList();
    if (tabName === 'receitas') renderIncomeList();
    if (tabName === 'despesas') renderExpenseList();
}

function switchPatrimonioTab(tabName) {
    ['poupanca', 'investimentos', 'aporte'].forEach(t => {
        const btn = document.getElementById(`tabBtn-pat-${t}`);
        const pane = document.getElementById(`tabPane-pat-${t}`);
        if (btn) btn.classList.toggle('active', t === tabName);
        if (pane) pane.classList.toggle('active', t === tabName);
    });
    // Garantir que o DOM aplicou display:block e calculou as dimensões antes de renderizar os gráficos
    setTimeout(() => {
        if (tabName === 'poupanca') {
            refreshSavingsPage();
            renderPoupancaTabChart();
        }
        if (tabName === 'investimentos') {
            refreshInvestmentsPage();
        }
        if (tabName === 'aporte') {
            renderPorcentagensPage();
        }
    }, 50);
}

function switchRelatoriosTab(tabName) {
    ['graficos', 'dicas'].forEach(t => {
        const btn = document.getElementById(`tabBtn-rel-${t}`);
        const pane = document.getElementById(`tabPane-rel-${t}`);
        if (btn) btn.classList.toggle('active', t === tabName);
        if (pane) pane.classList.toggle('active', t === tabName);
    });
    if (tabName === 'graficos') refreshReports();
    if (tabName === 'dicas') renderTips();
}

document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
});
document.getElementById('mobileToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('mobile-open');
});

// ============================================
// USER NAME
// ============================================
function editUserName() {
    const name = prompt('Qual é o seu nome?', appData.userName);
    if (name && name.trim()) {
        appData.userName = name.trim();
        saveData(appData);
        document.getElementById('userName').textContent = appData.userName;
    }
}

// ============================================
// MODALS
// ============================================
function openModal(type) {
    const modal = document.getElementById(`modal-${type}`);
    if (!modal) return;
    modal.classList.add('show');
    const today = getTodayStr();
    if (type === 'income') {
        document.getElementById('incomeDate').value = today;
        document.getElementById('autoSavePercLabel').textContent = appData.savingsPercent;
    }
    if (type === 'expense') document.getElementById('expenseDate').value = today;
    if (type === 'detailed-expense') {
        const idInput = document.getElementById('detExpId');
        if (!idInput || !idInput.value) {
            document.getElementById('detExpDate').value = today;
        }
    }
    if (type === 'salary' && appData.salary) {
        document.getElementById('salaryDesc').value = appData.salary.desc || 'Salário';
        document.getElementById('salaryValue').value = appData.salary.value;
        document.getElementById('salaryPayDay').value = appData.salary.payDay;
        document.getElementById('salaryAutoRegister').checked = appData.salary.autoRegister !== false;
    }
    if (type === 'extra-income') {
        const idInput = document.getElementById('extraIncomeId');
        if (!idInput || !idInput.value) {
            const d = document.getElementById('extraIncomeDate');
            if (d) d.value = today;
        }
    }
    if (type === 'investment') {
        const idInput = document.getElementById('investId');
        if (!idInput || !idInput.value) {
            const dInput = document.getElementById('investDate');
            if (dInput) dInput.value = today;
            const nInput = document.getElementById('investName');
            if (nInput) nInput.value = '';
            const instInput = document.getElementById('investInstitution');
            if (instInput) instInput.value = '';
            const amtInput = document.getElementById('investAmount');
            if (amtInput) amtInput.value = '';
            const curAmtInput = document.getElementById('investCurrentAmount');
            if (curAmtInput) curAmtInput.value = '';
            const yrInput = document.getElementById('investYieldRate');
            if (yrInput) yrInput.value = '';
            const matInput = document.getElementById('investMaturity');
            if (matInput) matInput.value = '';
            const dedInput = document.getElementById('investDeductExpense');
            if (dedInput) dedInput.checked = false;
        }
    }
}

function closeModal(type) {
    const modal = document.getElementById(`modal-${type}`);
    if (modal) modal.classList.remove('show');

    // Reset editing states to ensure reopening is in fresh/create mode
    if (type === 'fixed-expense') {
        const idInput = document.getElementById('fixedExpId');
        if (idInput) idInput.value = '';
        const modalTitle = document.querySelector('#modal-fixed-expense h3');
        if (modalTitle) modalTitle.innerHTML = '<i class="fas fa-thumbtack"></i> Despesa Fixa';
        const submitBtn = document.getElementById('btnSubmitFixedExp');
        if (submitBtn) submitBtn.innerHTML = 'Adicionar Fixa';
    }
    if (type === 'detailed-expense') {
        const idInput = document.getElementById('detExpId');
        if (idInput) idInput.value = '';
        const modalTitle = document.getElementById('detExpModalTitle');
        if (modalTitle) modalTitle.textContent = 'Gasto Detalhado';
        const submitBtn = document.getElementById('btnSubmitDetExp');
        if (submitBtn) submitBtn.innerHTML = 'Registrar Gasto';
    }
    if (type === 'extra-income') {
        const idInput = document.getElementById('extraIncomeId');
        if (idInput) idInput.value = '';
        const modalTitle = document.getElementById('extraIncomeModalTitle');
        if (modalTitle) modalTitle.textContent = 'Lançar Renda Extra (Fotos / Freelance)';
        const submitBtn = document.getElementById('btnSubmitExtraIncome');
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-check"></i> Adicionar Renda Extra';
        const autoWrap = document.getElementById('extraIncomeAutoReserveWrap');
        if (autoWrap) autoWrap.style.display = 'flex';
    }
    if (type === 'savings-goal') {
        const idInput = document.getElementById('goalId');
        if (idInput) idInput.value = '';
        const modalTitle = document.getElementById('goalModalTitle');
        if (modalTitle) modalTitle.textContent = 'Nova Meta de Poupança';
        const submitBtn = document.getElementById('btnSubmitGoal');
        if (submitBtn) submitBtn.innerHTML = 'Criar Meta';
    }
    if (type === 'investment') {
        const idInput = document.getElementById('investId');
        if (idInput) idInput.value = '';
        const modalTitle = document.getElementById('investModalTitle');
        if (modalTitle) modalTitle.textContent = 'Novo Investimento / Aporte';
        const submitBtn = document.getElementById('btnSubmitInvest');
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-check"></i> Adicionar Investimento';
    }
    if (type === 'aporte-existing') {
        const idInput = document.getElementById('aporteAssetId');
        if (idInput) idInput.value = '';
        const amtInput = document.getElementById('aporteNewAmount');
        if (amtInput) amtInput.value = '';
    }
    if (type === 'rx-edit-expense') {
        const idInput = document.getElementById('rxEditExpenseId');
        if (idInput) idInput.value = '';
    }
}

document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            const type = overlay.id.replace('modal-', '');
            closeModal(type);
        }
    });
});

// ============================================
// INCOME
// ============================================
function addIncome(e) {
    e.preventDefault();
    const desc = document.getElementById('incomeDesc').value;
    const value = parseFloat(document.getElementById('incomeValue').value);
    const category = document.getElementById('incomeCategory').value;
    const date = document.getElementById('incomeDate').value;
    const autoSave = document.getElementById('incomeAutoSave').checked;

    createIncome({ desc, value, category, date, autoSave });

    saveData(appData);
    closeModal('income');
    e.target.reset();
    refreshAll();
    showToast(`Receita de ${formatCurrency(value)} adicionada!`);
}

// Acha o depósito automático da poupança que veio de uma receita.
// Receitas novas guardam o vínculo (savingsTxId). Para as antigas, tenta reconhecer o depósito
// pelo texto, data e valor (só aceita se bater exatamente e não pertencer a outra receita).
function findIncomeSavingsTx(income) {
    if (income.savingsTxId) {
        const linked = appData.savingsTransactions.find(t => t.id === income.savingsTxId);
        if (linked) return linked;
    }
    const claimed = new Set(appData.incomes.map(i => i.savingsTxId).filter(Boolean));
    const candidates = appData.savingsTransactions.filter(t => {
        if (!t.auto || t.type !== 'deposit' || t.date !== income.date || claimed.has(t.id)) return false;
        const m = /^([\d.,]+)% de "(.*)"$/.exec(t.desc || '');
        if (!m || m[2] !== income.desc) return false;
        const pct = parseFloat(m[1].replace(',', '.'));
        return Math.abs(t.value - income.value * pct / 100) < 0.01;
    });
    if (candidates.length === 1) {
        income.savingsTxId = candidates[0].id;
        return candidates[0];
    }
    return null;
}

// Cria a receita e (opcionalmente) o depósito automático na poupança, ligados entre si
function createIncome({ desc, value, category, date, autoSave }) {
    const income = { id: generateId(), desc, value, category, date, createdAt: new Date().toISOString() };

    if (autoSave) {
        const percent = appData.savingsPercent;
        const savingsAmount = value * (percent / 100);
        const tx = {
            id: generateId(), type: 'deposit', desc: `${percent}% de "${desc}"`,
            value: savingsAmount, date, auto: true, percent, createdAt: new Date().toISOString()
        };
        appData.savingsTransactions.push(tx);
        appData.savingsBalance += savingsAmount;
        income.savingsTxId = tx.id;
    }

    appData.incomes.push(income);
    return income;
}

// ---- Registro rápido (aba Receitas) ----
function saveInlineIncome(e) {
    e.preventDefault();
    const id = document.getElementById('inlineIncomeId').value;
    const date = document.getElementById('inlineIncomeDate').value;
    const desc = document.getElementById('inlineIncomeName').value.trim();
    const value = parseFloat(document.getElementById('inlineIncomeValue').value);
    const category = document.getElementById('inlineIncomeCategory').value;
    if (!desc || !date || !(value > 0)) return;

    if (id) {
        const item = appData.incomes.find(x => x.id === id);
        let savingsNote = '';
        if (item) {
            const oldValue = item.value;
            const tx = findIncomeSavingsTx(item); // antes de alterar a receita
            Object.assign(item, { desc, value, category, date });

            // Se essa receita gerou um depósito automático na poupança, ajusta o depósito junto
            if (tx) {
                const pct = tx.percent ?? (oldValue ? (tx.value / oldValue) * 100 : appData.savingsPercent);
                const newAmount = value * (pct / 100);
                appData.savingsBalance += newAmount - tx.value;
                tx.value = newAmount;
                tx.date = date;
                tx.percent = pct;
                tx.desc = `${Math.round(pct * 10) / 10}% de "${desc}"`;
                savingsNote = ' Poupança ajustada.';
            }
        }
        saveData(appData);
        cancelIncomeEdit();
        refreshAll();
        showToast('Receita atualizada!' + savingsNote);
    } else {
        const autoSave = document.getElementById('inlineIncomeAutoSave').checked;
        createIncome({ desc, value, category, date, autoSave });
        saveData(appData);
        document.getElementById('inlineIncomeName').value = '';
        document.getElementById('inlineIncomeValue').value = '';
        refreshAll();
        document.getElementById('inlineIncomeName').focus();
        showToast(`${desc}: ${formatCurrency(value)} registrado!`);
    }
}

function editIncome(id) {
    switchTransacoesTab('receitas');
    const item = appData.incomes.find(x => x.id === id);
    if (!item) return;
    document.getElementById('inlineIncomeId').value = item.id;
    document.getElementById('inlineIncomeDate').value = item.date;
    document.getElementById('inlineIncomeName').value = item.desc;
    document.getElementById('inlineIncomeValue').value = item.value;
    document.getElementById('inlineIncomeCategory').value = item.category;
    document.getElementById('incomeFormTitle').textContent = 'Editar Receita';
    document.getElementById('inlineIncomeSubmit').innerHTML = '<i class="fas fa-check"></i> Salvar Alterações';
    document.getElementById('inlineIncomeCancel').style.display = '';
    document.getElementById('inlineIncomeAutoSaveWrap').style.display = 'none'; // só vale ao criar
    document.getElementById('incomeFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('inlineIncomeName').focus();
}

function cancelIncomeEdit() {
    document.getElementById('inlineIncomeId').value = '';
    document.getElementById('inlineIncomeName').value = '';
    document.getElementById('inlineIncomeValue').value = '';
    document.getElementById('inlineIncomeDate').value = getTodayStr();
    document.getElementById('incomeFormTitle').textContent = 'Registrar Receita';
    document.getElementById('inlineIncomeSubmit').innerHTML = '<i class="fas fa-plus"></i> Adicionar';
    document.getElementById('inlineIncomeCancel').style.display = 'none';
    document.getElementById('inlineIncomeAutoSaveWrap').style.display = '';
}

function deleteIncome(id) {
    const item = appData.incomes.find(i => i.id === id);
    if (!item) return;
    const tx = findIncomeSavingsTx(item);

    let msg = 'Deseja excluir esta receita?';
    if (tx) msg += `\n\nO depósito automático de ${formatCurrency(tx.value)} na poupança também será removido.`;
    if (!confirm(msg)) return;

    appData.incomes = appData.incomes.filter(i => i.id !== id);
    if (tx) {
        appData.savingsTransactions = appData.savingsTransactions.filter(t => t.id !== tx.id);
        appData.savingsBalance = Math.max(0, appData.savingsBalance - tx.value);
    }
    saveData(appData);
    refreshAll();
    showToast(tx ? 'Receita e depósito na poupança excluídos!' : 'Receita excluída!');
}

function renderIncomeList() {
    document.getElementById('inlineIncomeSavePerc').textContent = appData.savingsPercent;

    const filter = document.getElementById('incomeMonthFilter').value;
    const search = document.getElementById('incomeSearch').value.trim().toLowerCase();
    const sort = document.getElementById('incomeSort').value;

    let items = [...appData.incomes];
    if (filter !== 'all') items = items.filter(i => getMonthYear(i.date) === filter);
    if (search) items = items.filter(i => i.desc.toLowerCase().includes(search) || i.category.toLowerCase().includes(search));
    items.sort(getSorter(sort));

    const total = items.reduce((s, i) => s + i.value, 0);
    const biggest = items.reduce((m, i) => (!m || i.value > m.value ? i : m), null);
    document.getElementById('incStatTotal').textContent = formatCurrency(total);
    document.getElementById('incStatCount').textContent = items.length;
    document.getElementById('incStatMax').textContent = formatCurrency(biggest ? biggest.value : 0);
    document.getElementById('incStatMaxName').textContent = biggest ? biggest.desc : '';

    const container = document.getElementById('incomeList');
    if (items.length === 0) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-money-bill-wave"></i><p>Nenhuma receita encontrada</p></div>`;
        return;
    }
    container.innerHTML = items.map(item => `
        <div class="transaction-item">
            <div class="transaction-left">
                <div class="transaction-icon income"><i class="fas ${categoryIcons[item.category] || 'fa-arrow-up'}"></i></div>
                <div class="transaction-details"><h4>${escapeHtml(item.desc)}</h4><small>${formatDate(item.date)} · ${escapeHtml(item.category)}</small></div>
            </div>
            <div class="transaction-right">
                <span class="transaction-amount positive">+${formatCurrency(item.value)}</span>
                <button class="transaction-edit" title="Editar" onclick="editIncome('${item.id}')"><i class="fas fa-pen"></i></button>
                <button class="transaction-delete" title="Excluir" onclick="deleteIncome('${item.id}')"><i class="fas fa-trash"></i></button>
            </div>
        </div>`).join('');
}

// ============================================
// EXPENSES
// ============================================
function addExpense(e) {
    e.preventDefault();
    const desc = document.getElementById('expenseDesc').value;
    const value = parseFloat(document.getElementById('expenseValue').value);
    const category = document.getElementById('expenseCategory').value;
    const date = document.getElementById('expenseDate').value;

    appData.expenses.push({
        id: generateId(), desc, value, category, date, createdAt: new Date().toISOString()
    });
    saveData(appData);
    closeModal('expense');
    e.target.reset();
    refreshAll();
    showToast(`Despesa de ${formatCurrency(value)} registrada!` + budgetAlertText(category, date) + getMetaFeedback());
}

function deleteExpense(id) {
    if (!confirm('Deseja excluir esta despesa?')) return;
    appData.expenses = appData.expenses.filter(i => i.id !== id);
    saveData(appData);
    refreshAll();
    showToast('Despesa excluída!');
}

// ---- Registro rápido (aba Despesas) ----
function saveInlineExpense(e) {
    e.preventDefault();
    const id = document.getElementById('inlineExpenseId').value;
    const date = document.getElementById('inlineExpenseDate').value;
    const desc = document.getElementById('inlineExpenseName').value.trim();
    const value = parseFloat(document.getElementById('inlineExpenseValue').value);
    const category = document.getElementById('inlineExpenseCategory').value;
    if (!desc || !date || !(value > 0)) return;

    if (id) {
        const item = appData.expenses.find(x => x.id === id);
        if (item) {
            Object.assign(item, { desc, value, category, date });
            // Se veio de um "Gasto Detalhado", mantém os dois sincronizados
            if (id.endsWith('_exp')) {
                const det = appData.detailedExpenses.find(d => d.id === id.slice(0, -4));
                if (det) Object.assign(det, { desc, value, category, date });
            }
        }
        saveData(appData);
        cancelExpenseEdit();
        refreshAll();
        showToast('Despesa atualizada!' + budgetAlertText(category, date) + getMetaFeedback());
    } else {
        appData.expenses.push({ id: generateId(), desc, value, category, date, createdAt: new Date().toISOString() });
        saveData(appData);
        // Mantém data e categoria para facilitar vários lançamentos seguidos
        document.getElementById('inlineExpenseName').value = '';
        document.getElementById('inlineExpenseValue').value = '';
        refreshAll();
        document.getElementById('inlineExpenseName').focus();
        showToast(`${desc}: ${formatCurrency(value)} registrado!` + budgetAlertText(category, date) + getMetaFeedback());
    }
}

function editExpense(id) {
    switchTransacoesTab('despesas');
    const item = appData.expenses.find(x => x.id === id);
    if (!item) return;
    document.getElementById('inlineExpenseId').value = item.id;
    document.getElementById('inlineExpenseDate').value = item.date;
    document.getElementById('inlineExpenseName').value = item.desc;
    document.getElementById('inlineExpenseValue').value = item.value;
    document.getElementById('inlineExpenseCategory').value = item.category;
    document.getElementById('expenseFormTitle').textContent = 'Editar Despesa';
    document.getElementById('inlineExpenseSubmit').innerHTML = '<i class="fas fa-check"></i> Salvar Alterações';
    document.getElementById('inlineExpenseCancel').style.display = '';
    document.getElementById('expenseFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('inlineExpenseName').focus();
}

function cancelExpenseEdit() {
    document.getElementById('inlineExpenseId').value = '';
    document.getElementById('inlineExpenseName').value = '';
    document.getElementById('inlineExpenseValue').value = '';
    document.getElementById('inlineExpenseDate').value = getTodayStr();
    document.getElementById('inlineIncomeDate').value = getTodayStr();
    document.getElementById('expenseFormTitle').textContent = 'Registrar Despesa';
    document.getElementById('inlineExpenseSubmit').innerHTML = '<i class="fas fa-plus"></i> Adicionar';
    document.getElementById('inlineExpenseCancel').style.display = 'none';
}

function renderExpenseList() {
    renderBudgetLimits();
    const filter = document.getElementById('expenseMonthFilter').value;
    const search = document.getElementById('expenseSearch').value.trim().toLowerCase();
    const sort = document.getElementById('expenseSort').value;

    let items = [...appData.expenses];
    if (filter !== 'all') items = items.filter(i => getMonthYear(i.date) === filter);
    if (search) items = items.filter(i => i.desc.toLowerCase().includes(search) || i.category.toLowerCase().includes(search));

    items.sort(getSorter(sort));

    // Resumo do período filtrado
    const total = items.reduce((s, i) => s + i.value, 0);
    const biggest = items.reduce((m, i) => (!m || i.value > m.value ? i : m), null);
    document.getElementById('expStatTotal').textContent = formatCurrency(total);
    document.getElementById('expStatCount').textContent = items.length;
    document.getElementById('expStatMax').textContent = formatCurrency(biggest ? biggest.value : 0);
    document.getElementById('expStatMaxName').textContent = biggest ? biggest.desc : '';

    const container = document.getElementById('expenseList');
    if (items.length === 0) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-shopping-cart"></i><p>Nenhuma despesa encontrada</p></div>`;
        return;
    }
    container.innerHTML = items.map(item => `
        <div class="transaction-item">
            <div class="transaction-left">
                <div class="transaction-icon expense"><i class="fas ${categoryIcons[item.category] || 'fa-arrow-down'}"></i></div>
                <div class="transaction-details"><h4>${escapeHtml(item.desc)}</h4><small>${formatDate(item.date)} · ${escapeHtml(item.category)}</small></div>
            </div>
            <div class="transaction-right">
                <span class="transaction-amount negative">-${formatCurrency(item.value)}</span>
                <button class="transaction-edit" title="Editar" onclick="editExpense('${item.id}')"><i class="fas fa-pen"></i></button>
                <button class="transaction-delete" title="Excluir" onclick="deleteExpense('${item.id}')"><i class="fas fa-trash"></i></button>
            </div>
        </div>`).join('');
}

// ============================================
// TRANSAÇÕES CONSOLIDADAS (TODAS)
// ============================================
function renderAllTransactionsList() {
    const filterSelect = document.getElementById('allTxMonthFilter');
    const searchInput = document.getElementById('allTxSearch');
    const typeSelect = document.getElementById('allTxTypeFilter');
    const sortSelect = document.getElementById('allTxSort');

    if (!filterSelect) return;

    const filter = filterSelect.value;
    const search = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const type = typeSelect ? typeSelect.value : 'all';
    const sort = sortSelect ? sortSelect.value : 'date-desc';

    // Lista unificada
    let items = [];
    appData.incomes.forEach(i => items.push({ ...i, txType: 'receita' }));
    appData.expenses.forEach(e => items.push({ ...e, txType: 'despesa' }));

    // Filtro de mês
    if (filter !== 'all') {
        items = items.filter(item => getMonthYear(item.date) === filter);
    }
    // Filtro de tipo
    if (type !== 'all') {
        items = items.filter(item => item.txType === type);
    }
    // Filtro de busca
    if (search) {
        items = items.filter(item =>
            (item.desc && item.desc.toLowerCase().includes(search)) ||
            (item.category && item.category.toLowerCase().includes(search))
        );
    }

    // Ordenação
    items.sort(getSorter(sort));

    // Cálculos de KPIs consolidados para o período
    let periodIncomes = appData.incomes;
    let periodExpenses = appData.expenses;
    if (filter !== 'all') {
        periodIncomes = periodIncomes.filter(i => getMonthYear(i.date) === filter);
        periodExpenses = periodExpenses.filter(e => getMonthYear(e.date) === filter);
    }
    const totInc = periodIncomes.reduce((s, i) => s + i.value, 0);
    const totExp = periodExpenses.reduce((s, e) => s + e.value, 0);
    const net = totInc - totExp;
    const saveRate = totInc > 0 ? Math.max(0, Math.round((net / totInc) * 100)) : 0;

    const elInc = document.getElementById('txStatIncome');
    const elExp = document.getElementById('txStatExpense');
    const elNet = document.getElementById('txStatNet');
    const elRate = document.getElementById('txStatRate');

    if (elInc) elInc.textContent = formatCurrency(totInc);
    if (elExp) elExp.textContent = formatCurrency(totExp);
    if (elNet) {
        elNet.textContent = formatCurrency(net);
        elNet.className = 'card-value ' + (net >= 0 ? 'positive-text' : 'negative-text');
    }
    if (elRate) elRate.textContent = `${saveRate}%`;

    const container = document.getElementById('allTxList');
    if (!container) return;

    if (items.length === 0) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-receipt"></i><p>Nenhuma transação encontrada</p></div>`;
        return;
    }

    container.innerHTML = items.map(item => {
        const isInc = item.txType === 'receita';
        const icon = categoryIcons[item.category] || (isInc ? 'fa-arrow-up' : 'fa-arrow-down');
        const iconType = isInc ? 'income' : 'expense';
        const valClass = isInc ? 'positive' : 'negative';
        const prefix = isInc ? '+' : '-';
        const editFn = isInc ? `editIncome('${item.id}')` : `editExpense('${item.id}')`;
        const deleteFn = isInc ? `deleteIncome('${item.id}')` : `deleteExpense('${item.id}')`;

        return `
            <div class="transaction-item">
                <div class="transaction-left">
                    <div class="transaction-icon ${iconType}"><i class="fas ${icon}"></i></div>
                    <div class="transaction-details">
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                            <h4 style="margin:0;">${escapeHtml(item.desc)}</h4>
                            <span class="tx-type-badge ${item.txType}">${isInc ? 'Receita' : 'Despesa'}</span>
                        </div>
                        <small>${formatDate(item.date)} · ${escapeHtml(item.category)}</small>
                    </div>
                </div>
                <div class="transaction-right">
                    <span class="transaction-amount ${valClass}">${prefix}${formatCurrency(item.value)}</span>
                    <button class="transaction-edit" title="Editar" onclick="${editFn}"><i class="fas fa-pen"></i></button>
                    <button class="transaction-delete" title="Excluir" onclick="${deleteFn}"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `;
    }).join('');
}

// ============================================
// LIMITES POR CATEGORIA
// ============================================
function getBudgetMonth() {
    const filter = document.getElementById('expenseMonthFilter').value;
    return filter !== 'all' ? filter : getCurrentMonthYear();
}

function getCategorySpent(category, month) {
    return appData.expenses
        .filter(x => x.category === category && getMonthYear(x.date) === month)
        .reduce((s, x) => s + x.value, 0);
}

function openBudgetModal(category) {
    if (category) document.getElementById('budgetCategory').value = category;
    fillBudgetValue();
    openModal('budget');
}

function fillBudgetValue() {
    const cat = document.getElementById('budgetCategory').value;
    const current = (appData.budgetLimits || {})[cat];
    document.getElementById('budgetValue').value = current || '';
}

function saveBudgetLimit(e) {
    e.preventDefault();
    const category = document.getElementById('budgetCategory').value;
    const value = parseFloat(document.getElementById('budgetValue').value);
    if (!(value > 0)) return;
    appData.budgetLimits = appData.budgetLimits || {};
    appData.budgetLimits[category] = value;
    saveData(appData);
    closeModal('budget');
    renderBudgetLimits();
    showToast(`Limite de ${category}: ${formatCurrency(value)}/mês`);
}

function deleteBudgetLimit(category) {
    if (!confirm(`Remover o limite de ${category}?`)) return;
    delete appData.budgetLimits[category];
    saveData(appData);
    renderBudgetLimits();
    showToast('Limite removido!');
}

// Texto de aviso (vazio se não houver limite ou se ainda estiver folgado)
function budgetAlertText(category, date) {
    const limit = (appData.budgetLimits || {})[category];
    if (!limit) return '';
    const spent = getCategorySpent(category, getMonthYear(date));
    if (spent > limit) return ` ⚠️ ${category} estourou o limite (${formatCurrency(spent)} de ${formatCurrency(limit)})`;
    if (spent >= limit * 0.8) return ` ⚠️ ${category}: ${Math.round((spent / limit) * 100)}% do limite`;
    return '';
}

// Feedback imediato sobre o impacto na meta e contas
function getMetaFeedback() {
    const meta = calculateMeta();
    if (meta.totalExpenses === 0) return '';
    if (meta.remainingToEarn > 0) {
        return ` · 🎯 Contas do mês: ${formatCurrency(meta.totalExpenses)} (Faltam ${formatCurrency(meta.remainingToEarn)} para a meta)`;
    } else {
        return ` · 🎉 Contas do mês: ${formatCurrency(meta.totalExpenses)} (Meta de renda 100% batida!)`;
    }
}

function renderBudgetLimits() {
    const month = getBudgetMonth();
    document.getElementById('budgetTitle').textContent = `Limites por Categoria · ${getMonthYearLabel(month)}`;

    const limits = Object.entries(appData.budgetLimits || {});
    const container = document.getElementById('budgetList');
    if (limits.length === 0) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-gauge-high"></i><p>Nenhum limite definido</p><small>Defina quanto quer gastar por mês em cada categoria e acompanhe aqui</small></div>`;
        return;
    }

    container.innerHTML = limits.map(([cat, limit]) => {
        const spent = getCategorySpent(cat, month);
        const pct = (spent / limit) * 100;
        let state = 'ok', msg = `Restam ${formatCurrency(limit - spent)}`;
        if (spent > limit) { state = 'over'; msg = `Estourou em ${formatCurrency(spent - limit)}`; }
        else if (pct >= 80) { state = 'warn'; }
        return `
        <div class="budget-item">
            <div class="budget-top">
                <span class="budget-name"><i class="fas ${categoryIcons[cat] || 'fa-box'}"></i> ${escapeHtml(cat)}</span>
                <span class="budget-values">${formatCurrency(spent)} <small>de ${formatCurrency(limit)}</small></span>
            </div>
            <div class="progress-bar budget-bar"><div class="progress-fill budget-fill ${state}" style="width:${Math.min(pct, 100)}%"></div></div>
            <div class="budget-bottom">
                <small class="budget-msg ${state}">${Math.round(pct)}% · ${msg}</small>
                <span class="budget-actions">
                    <button class="transaction-edit" title="Editar limite" onclick="openBudgetModal('${cat}')"><i class="fas fa-pen"></i></button>
                    <button class="transaction-delete" title="Remover limite" onclick="deleteBudgetLimit('${cat}')"><i class="fas fa-trash"></i></button>
                </span>
            </div>
        </div>`;
    }).join('');
}

// ============================================
// FIXED EXPENSES (Gestão Fina)
// ============================================
function addFixedExpense(e) {
    e.preventDefault();
    const id = document.getElementById('fixedExpId')?.value;
    const name = document.getElementById('fixedExpName').value;
    const value = parseFloat(document.getElementById('fixedExpValue').value);
    const category = document.getElementById('fixedExpCategory').value;
    const dueDay = parseInt(document.getElementById('fixedExpDueDay').value);
    const notes = document.getElementById('fixedExpNotes').value;

    if (id) {
        const item = (appData.fixedExpenses || []).find(f => f.id === id);
        if (item) {
            Object.assign(item, { name, value, category, dueDay, notes });
        }
        saveData(appData);
        closeModal('fixed-expense');
        const idInput = document.getElementById('fixedExpId');
        if (idInput) idInput.value = '';
        e.target.reset();
        refreshAll();
        showToast(`Despesa fixa "${name}" atualizada!`);
        return;
    }

    appData.fixedExpenses.push({
        id: generateId(), name, value, category, dueDay, notes, active: true, createdAt: new Date().toISOString()
    });
    saveData(appData);
    closeModal('fixed-expense');
    e.target.reset();
    refreshAll();
    showToast(`Despesa fixa "${name}" de ${formatCurrency(value)} adicionada!` + getMetaFeedback());
}

function editFixedExpense(id) {
    const item = (appData.fixedExpenses || []).find(f => f.id === id);
    if (!item) return;
    document.getElementById('fixedExpId').value = item.id;
    document.getElementById('fixedExpName').value = item.name;
    document.getElementById('fixedExpValue').value = item.value;
    document.getElementById('fixedExpCategory').value = item.category || 'Moradia';
    document.getElementById('fixedExpDueDay').value = item.dueDay || 10;
    document.getElementById('fixedExpNotes').value = item.notes || '';
    const modalTitle = document.querySelector('#modal-fixed-expense h3');
    if (modalTitle) modalTitle.innerHTML = '<i class="fas fa-pen-to-square text-primary"></i> Editar Despesa Fixa';
    const submitBtn = document.getElementById('btnSubmitFixedExp');
    if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-check"></i> Salvar Alterações';
    openModal('fixed-expense');
}

function deleteFixedExpense(id) {
    if (!confirm('Deseja excluir esta despesa fixa?')) return;
    appData.fixedExpenses = appData.fixedExpenses.filter(f => f.id !== id);
    saveData(appData);
    refreshAll();
    showToast('Despesa fixa excluída!');
}

function renderFixedExpenses() {
    const container = document.getElementById('fixedExpensesList');
    const items = appData.fixedExpenses.filter(f => f.active !== false);

    if (items.length === 0) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-thumbtack"></i><p>Nenhuma despesa fixa cadastrada</p><small>Adicione seus gastos mensais fixos para calcular sua meta</small></div>`;
        document.getElementById('fixedTotalBar').style.display = 'none';
        return;
    }

    const total = items.reduce((s, i) => s + i.value, 0);

    container.innerHTML = items.map(item => `
        <div class="transaction-item">
            <div class="transaction-left">
                <div class="transaction-icon expense"><i class="fas ${categoryIcons[item.category] || 'fa-thumbtack'}"></i></div>
                <div class="transaction-details">
                    <h4>${item.name}</h4>
                    <small>${item.category} · Vence dia ${item.dueDay}${item.notes ? ' · ' + item.notes : ''}</small>
                </div>
            </div>
            <div class="transaction-right">
                <span class="transaction-amount negative">${formatCurrency(item.value)}/mês</span>
                <button class="transaction-edit" onclick="editFixedExpense('${item.id}')" title="Editar"><i class="fas fa-pen"></i></button>
                <button class="transaction-delete" onclick="deleteFixedExpense('${item.id}')" title="Excluir"><i class="fas fa-trash"></i></button>
            </div>
        </div>`).join('');

    document.getElementById('fixedTotalBar').style.display = 'flex';
    document.getElementById('fixedTotalValue').textContent = formatCurrency(total);
}

// ============================================
// DETAILED EXPENSES (Gestão Fina)
// ============================================
function addDetailedExpense(e) {
    e.preventDefault();
    const editId = document.getElementById('detExpId')?.value;
    const desc = document.getElementById('detExpDesc').value.trim();
    const value = parseFloat(document.getElementById('detExpValue').value);
    const category = document.getElementById('detExpCategory').value;
    const date = document.getElementById('detExpDate').value;
    const payment = document.getElementById('detExpPayment').value;
    const installments = parseInt(document.getElementById('detExpInstallments').value) || 1;
    const priority = document.getElementById('detExpPriority').value;
    const status = document.getElementById('detExpStatus').value;
    const notes = document.getElementById('detExpNotes').value;

    if (!Array.isArray(appData.detailedExpenses)) appData.detailedExpenses = [];
    if (!Array.isArray(appData.expenses)) appData.expenses = [];

    if (editId) {
        const item = appData.detailedExpenses.find(d => d.id === editId);
        if (item) {
            item.desc = desc;
            item.value = value;
            item.category = category;
            item.date = date;
            item.payment = payment;
            item.installments = installments;
            item.priority = priority;
            item.status = status;
            item.notes = notes;
            item.updatedAt = new Date().toISOString();
        }

        // Sincronizar com despesa correspondente no dashboard
        const expItem = appData.expenses.find(x => x.id === editId + '_exp');
        if (expItem) {
            expItem.desc = desc;
            expItem.value = value;
            expItem.category = category;
            expItem.date = date;
        }

        saveData(appData);
        closeModal('detailed-expense');
        refreshAll();
        showToast(`Gasto detalhado atualizado: ${formatCurrency(value)}!` + budgetAlertText(category, date));
        return;
    }

    const item = {
        id: generateId(),
        desc,
        value,
        category,
        date,
        payment,
        installments,
        priority,
        status,
        notes,
        createdAt: new Date().toISOString()
    };

    appData.detailedExpenses.push(item);

    // Also add to regular expenses for dashboard tracking
    appData.expenses.push({
        id: item.id + '_exp',
        desc: item.desc,
        value: item.value,
        category: item.category,
        date: item.date,
        createdAt: item.createdAt
    });

    saveData(appData);
    closeModal('detailed-expense');
    refreshAll();
    showToast(`Gasto detalhado de ${formatCurrency(item.value)} registrado!` + budgetAlertText(item.category, item.date) + getMetaFeedback());
}

function editDetailedExpense(id) {
    const item = (appData.detailedExpenses || []).find(d => d.id === id);
    if (!item) return;

    document.getElementById('detExpId').value = item.id;
    document.getElementById('detExpDesc').value = item.desc || '';
    document.getElementById('detExpValue').value = item.value || '';
    document.getElementById('detExpCategory').value = item.category || 'Alimentação';
    document.getElementById('detExpDate').value = item.date || getTodayStr();
    document.getElementById('detExpPayment').value = item.payment || 'Dinheiro';
    document.getElementById('detExpInstallments').value = item.installments || 1;
    document.getElementById('detExpPriority').value = item.priority || 'essencial';
    document.getElementById('detExpStatus').value = item.status || 'pago';
    document.getElementById('detExpNotes').value = item.notes || '';

    const modalTitle = document.getElementById('detExpModalTitle');
    if (modalTitle) modalTitle.innerHTML = '<i class="fas fa-pen-to-square text-primary"></i> Editar Gasto Detalhado';
    const submitBtn = document.getElementById('btnSubmitDetExp');
    if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-check"></i> Salvar Alterações';

    openModal('detailed-expense');
}

function deleteDetailedExpense(id) {
    if (!confirm('Deseja excluir este gasto detalhado?')) return;
    appData.detailedExpenses = appData.detailedExpenses.filter(d => d.id !== id);
    // Also remove from regular expenses
    appData.expenses = appData.expenses.filter(e => e.id !== id + '_exp');
    saveData(appData);
    refreshAll();
    showToast('Gasto excluído!');
}

function toggleDetailedStatus(id) {
    const item = appData.detailedExpenses.find(d => d.id === id);
    if (item) {
        if (item.status === 'pendente') item.status = 'pago';
        else if (item.status === 'pago') item.status = 'pendente';
        else if (item.status === 'atrasado') item.status = 'pago';
        saveData(appData);
        refreshAll();
    }
}

function renderDetailedExpenses() {
    const catFilter = document.getElementById('detailedCatFilter').value;
    const statusFilter = document.getElementById('detailedStatusFilter').value;
    const priorityFilter = document.getElementById('detailedPriorityFilter').value;

    let items = [...appData.detailedExpenses].sort((a, b) => b.date.localeCompare(a.date));

    if (catFilter !== 'all') items = items.filter(i => i.category === catFilter);
    if (statusFilter !== 'all') items = items.filter(i => i.status === statusFilter);
    if (priorityFilter !== 'all') items = items.filter(i => i.priority === priorityFilter);

    const container = document.getElementById('detailedExpensesList');

    if (items.length === 0) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-magnifying-glass-dollar"></i><p>Nenhum gasto encontrado</p></div>`;
        return;
    }

    const priorityLabels = { essencial: '🔴 Essencial', importante: '🟡 Importante', opcional: '🟢 Opcional' };
    const statusLabels = { pago: '✅ Pago', pendente: '⏳ Pendente', atrasado: '🔴 Atrasado' };

    container.innerHTML = items.map(item => `
        <div class="transaction-item">
            <div class="transaction-left">
                <div class="transaction-icon expense"><i class="fas ${categoryIcons[item.category] || 'fa-receipt'}"></i></div>
                <div class="transaction-details">
                    <h4>${item.desc}</h4>
                    <small>${item.category} · ${formatDate(item.date)} · ${item.payment}${item.installments > 1 ? ` · ${item.installments}x` : ''}</small>
                    <div class="detail-tags">
                        <span class="tag tag-${item.priority}">${priorityLabels[item.priority]}</span>
                        <span class="tag tag-${item.status}" onclick="toggleDetailedStatus('${item.id}')" style="cursor:pointer;" title="Clique para alterar">${statusLabels[item.status]}</span>
                        <span class="tag tag-payment">${item.payment}</span>
                    </div>
                    ${item.notes ? `<small style="display:block;margin-top:6px;color:var(--text-light);font-style:italic;">📝 ${item.notes}</small>` : ''}
                </div>
            </div>
            <div class="transaction-right">
                <span class="transaction-amount negative">-${formatCurrency(item.value)}</span>
                <button class="transaction-edit" onclick="editDetailedExpense('${item.id}')" title="Editar"><i class="fas fa-pen"></i></button>
                <button class="transaction-delete" onclick="deleteDetailedExpense('${item.id}')" title="Excluir"><i class="fas fa-trash"></i></button>
            </div>
        </div>`).join('');
}

// ============================================
// META CALCULATOR & DIAGNÓSTICO EM TEMPO REAL
// ============================================
function calculateMeta() {
    const currentMonth = getCurrentMonthYear();

    // 1. Todas as despesas fixas ativas
    const fixedItems = (appData.fixedExpenses || []).filter(f => f.active !== false);
    const fixedTotal = fixedItems.reduce((s, f) => s + f.value, 0);

    // 2. Todas as despesas lançadas no mês atual (excluindo aportes em investimentos)
    const monthExpenses = (appData.expenses || []).filter(e => 
        getMonthYear(e.date) === currentMonth && 
        e.category !== 'Investimentos' &&
        !(e.desc && e.desc.toLowerCase().startsWith('aporte:')) &&
        !(e.desc && e.desc.toLowerCase().startsWith('investimento:'))
    );
    const monthExpensesTotal = monthExpenses.reduce((s, e) => s + e.value, 0);

    // 3. Montar a lista de todas as contas que compõem o mês
    // Evita duplicar caso uma despesa do mês tenha o mesmo nome de uma despesa fixa
    const allBillsList = [];
    let pendingFixedTotal = 0;

    monthExpenses.forEach(e => {
        allBillsList.push({
            name: e.desc,
            category: e.category,
            value: e.value,
            date: formatDate(e.date),
            type: 'var',
            typeLabel: 'Lançamento'
        });
    });

    fixedItems.forEach(f => {
        const alreadyLogged = monthExpenses.some(e => e.desc.trim().toLowerCase() === f.name.trim().toLowerCase());
        if (!alreadyLogged) {
            pendingFixedTotal += f.value;
            allBillsList.push({
                name: f.name,
                category: f.category,
                value: f.value,
                date: `Vence dia ${f.dueDay}`,
                type: 'fixed',
                typeLabel: 'Fixa Mensal'
            });
        }
    });

    // Total de contas / gastos reais que precisam ser pagos neste mês
    const totalExpenses = monthExpensesTotal + pendingFixedTotal;

    // 4. Meta Mínima de Renda (Total de Gastos / (1 - taxa_poupança))
    const savingsPercent = appData.savingsPercent || 20;
    const savingsRate = savingsPercent / 100;
    const metaMinIncome = savingsRate < 1 ? totalExpenses / (1 - savingsRate) : totalExpenses;
    const savingsTarget = metaMinIncome * savingsRate;

    // 5. Renda já obtida no mês
    const currentIncome = (appData.incomes || [])
        .filter(i => getMonthYear(i.date) === currentMonth)
        .reduce((s, i) => s + i.value, 0);

    // 6. Quanto está faltando
    const remainingToEarn = Math.max(0, metaMinIncome - currentIncome);
    const surplus = Math.max(0, currentIncome - metaMinIncome);
    const percentAchieved = metaMinIncome > 0 ? Math.min(100, (currentIncome / metaMinIncome) * 100) : (currentIncome > 0 ? 100 : 0);

    return {
        fixedTotal,
        monthExpensesTotal,
        pendingFixedTotal,
        totalExpenses,
        savingsPercent,
        metaMinIncome,
        savingsTarget,
        currentIncome,
        remainingToEarn,
        surplus,
        percentAchieved,
        allBillsList
    };
}

function refreshMetaCard() {
    const meta = calculateMeta();

    // 1. Atualizações no Dashboard (Painel Diagnóstico de Metas & Contas)
    const metaPercEl = document.getElementById('metaPercDisplay');
    if (metaPercEl) metaPercEl.textContent = meta.savingsPercent + '%';

    const diagTotalExpensesEl = document.getElementById('diagTotalExpenses');
    if (diagTotalExpensesEl) diagTotalExpensesEl.textContent = formatCurrency(meta.totalExpenses);

    const diagFixedPartEl = document.getElementById('diagFixedPart');
    if (diagFixedPartEl) diagFixedPartEl.textContent = formatCurrency(meta.fixedTotal);

    const diagVarPartEl = document.getElementById('diagVarPart');
    if (diagVarPartEl) diagVarPartEl.textContent = formatCurrency(meta.monthExpensesTotal);

    const metaPercLabel2El = document.getElementById('metaPercLabel2');
    if (metaPercLabel2El) metaPercLabel2El.textContent = meta.savingsPercent;

    const diagSavingsTargetEl = document.getElementById('diagSavingsTarget');
    if (diagSavingsTargetEl) diagSavingsTargetEl.textContent = formatCurrency(meta.savingsTarget);

    const diagMetaMinIncomeEl = document.getElementById('diagMetaMinIncome');
    if (diagMetaMinIncomeEl) diagMetaMinIncomeEl.textContent = formatCurrency(meta.metaMinIncome);

    // 2. Destaque: Quanto Está Faltando
    const diagRemainingBox = document.getElementById('diagRemainingBox');
    const diagRemainingLabel = document.getElementById('diagRemainingLabel');
    const diagRemainingVal = document.getElementById('diagRemainingValue');
    const diagRemainingHint = document.getElementById('diagRemainingHint');
    const diagRemainingIcon = document.getElementById('diagRemainingIcon');

    if (diagRemainingBox) {
        if (meta.metaMinIncome === 0) {
            diagRemainingBox.className = 'diagnostic-box box-remaining highlight';
            if (diagRemainingLabel) diagRemainingLabel.textContent = 'Quanto Falta Ganhar';
            if (diagRemainingVal) {
                diagRemainingVal.textContent = 'R$ 0,00';
                diagRemainingVal.className = 'd-box-value';
            }
            if (diagRemainingHint) diagRemainingHint.textContent = 'Adicione suas contas para calcular';
            if (diagRemainingIcon) diagRemainingIcon.innerHTML = '<i class="fas fa-calculator"></i>';
        } else if (meta.remainingToEarn > 0) {
            diagRemainingBox.className = 'diagnostic-box box-remaining highlight status-behind';
            if (diagRemainingLabel) diagRemainingLabel.textContent = '🎯 Quanto Falta Ganhar';
            if (diagRemainingVal) {
                diagRemainingVal.textContent = formatCurrency(meta.remainingToEarn);
                diagRemainingVal.className = 'd-box-value text-danger';
            }
            if (diagRemainingHint) diagRemainingHint.textContent = `Faltam ${(100 - meta.percentAchieved).toFixed(0)}% para bater a meta`;
            if (diagRemainingIcon) diagRemainingIcon.innerHTML = '<i class="fas fa-hourglass-half"></i>';
        } else {
            diagRemainingBox.className = 'diagnostic-box box-remaining highlight status-ontrack';
            if (diagRemainingLabel) diagRemainingLabel.textContent = '🎉 Meta 100% Batida!';
            if (diagRemainingVal) {
                diagRemainingVal.textContent = `+ ${formatCurrency(meta.surplus)}`;
                diagRemainingVal.className = 'd-box-value text-success';
            }
            if (diagRemainingHint) diagRemainingHint.textContent = `Sobra livre além da poupança de ${meta.savingsPercent}%`;
            if (diagRemainingIcon) diagRemainingIcon.innerHTML = '<i class="fas fa-circle-check"></i>';
        }
    }

    // 3. Barra de Progresso da Meta
    const metaProgressBar = document.getElementById('metaProgressBar');
    if (metaProgressBar) {
        metaProgressBar.style.width = `${meta.percentAchieved.toFixed(1)}%`;
        if (meta.percentAchieved >= 100) {
            metaProgressBar.style.background = 'linear-gradient(90deg, #10b981, #06b6d4)';
        } else {
            metaProgressBar.style.background = 'linear-gradient(90deg, var(--cor-secundaria), var(--cor-accent))';
        }
    }

    const metaProgressPercentText = document.getElementById('metaProgressPercentText');
    if (metaProgressPercentText) {
        metaProgressPercentText.innerHTML = `Progresso da Meta: <strong>${meta.percentAchieved.toFixed(1)}%</strong>`;
    }

    const metaProgressSummaryText = document.getElementById('metaProgressSummaryText');
    if (metaProgressSummaryText) {
        metaProgressSummaryText.textContent = `${formatCurrency(meta.currentIncome)} faturados de ${formatCurrency(meta.metaMinIncome)} necessários`;
    }

    // 4. Raio-X das Contas
    const totalBillsCount = document.getElementById('totalBillsCount');
    if (totalBillsCount) totalBillsCount.textContent = meta.allBillsList.length;

    const billsBreakdownList = document.getElementById('billsBreakdownList');
    if (billsBreakdownList) {
        if (meta.allBillsList.length === 0) {
            billsBreakdownList.innerHTML = `<div class="empty-state" style="padding:16px"><p>Nenhuma conta registrada neste mês</p></div>`;
        } else {
            billsBreakdownList.innerHTML = meta.allBillsList.map(b => `
                <div class="bill-breakdown-row">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span class="bill-type-tag ${b.type}">${b.typeLabel}</span>
                        <strong>${escapeHtml(b.name)}</strong>
                        <small style="color:var(--text-secondary)">(${escapeHtml(b.category)} · ${b.date})</small>
                    </div>
                    <strong style="color:var(--cor-danger)">-${formatCurrency(b.value)}</strong>
                </div>
            `).join('');
        }
    }

    // 5. Status text
    const statusEl = document.getElementById('metaStatus');
    if (statusEl) {
        if (meta.totalExpenses === 0) {
            statusEl.className = 'meta-status no-data';
            statusEl.innerHTML = '<i class="fas fa-info-circle"></i> Adicione suas contas do mês e despesas fixas para calcular automaticamente sua meta de faturamento!';
        } else if (meta.remainingToEarn === 0) {
            statusEl.className = 'meta-status on-track';
            statusEl.innerHTML = `<i class="fas fa-check-circle"></i> <strong>Parabéns!</strong> Você já faturou o suficiente para cobrir todos os seus gastos de ${formatCurrency(meta.totalExpenses)} e ainda guardar seus ${meta.savingsPercent}% de poupança (${formatCurrency(meta.savingsTarget)}), com sobra livre de ${formatCurrency(meta.surplus)}!`;
        } else {
            statusEl.className = 'meta-status behind';
            const safety = getSafetySavingsAmount();
            const safetyHtml = safety.amount > 0 ? `
                <div class="safety-savings-callout">
                    <div class="safety-callout-text">
                        <i class="fas fa-shield-halved text-success"></i>
                        <span><strong>Poupança de Segurança:</strong> Mesmo sem bater a meta plena, você já pode guardar <strong>${formatCurrency(safety.amount)}</strong> (${safety.safetyPerc}%) da sua receita atual!</span>
                    </div>
                    <button class="btn btn-xs btn-success" onclick="depositSafetySavings()">
                        <i class="fas fa-piggy-bank"></i> Guardar ${formatCurrency(safety.amount)}
                    </button>
                </div>
            ` : '';
            statusEl.innerHTML = `<div><i class="fas fa-exclamation-triangle"></i> Para pagar todas as suas contas (${formatCurrency(meta.totalExpenses)}) e guardar ${meta.savingsPercent}% (${formatCurrency(meta.savingsTarget)}), <strong>ainda faltam faturar ${formatCurrency(meta.remainingToEarn)}</strong> neste mês.</div>${safetyHtml}`;
        }
    }

    // 6. Atualizações na página Gestão Fina
    const gestaoFixed = document.getElementById('gestaoFixed');
    if (gestaoFixed) gestaoFixed.textContent = formatCurrency(meta.totalExpenses);

    const gestaoPercLabel = document.getElementById('gestaoPercLabel');
    if (gestaoPercLabel) gestaoPercLabel.textContent = meta.savingsPercent;

    const gestaoSavTarget = document.getElementById('gestaoSavTarget');
    if (gestaoSavTarget) gestaoSavTarget.textContent = formatCurrency(meta.savingsTarget);

    const gestaoMetaTotal = document.getElementById('gestaoMetaTotal');
    if (gestaoMetaTotal) gestaoMetaTotal.textContent = formatCurrency(meta.metaMinIncome);

    const gestaoRemainingVal = document.getElementById('gestaoRemainingVal');
    const gestaoRemainingBox = document.getElementById('gestaoRemainingBox');
    if (gestaoRemainingVal) {
        if (meta.remainingToEarn > 0) {
            gestaoRemainingVal.textContent = formatCurrency(meta.remainingToEarn);
            gestaoRemainingVal.style.color = '#ef4444';
            if (gestaoRemainingBox) gestaoRemainingBox.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        } else {
            gestaoRemainingVal.textContent = `Meta Batida! (+${formatCurrency(meta.surplus)})`;
            gestaoRemainingVal.style.color = '#10b981';
            if (gestaoRemainingBox) gestaoRemainingBox.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        }
    }
}

function toggleBillsBreakdown() {
    const drawer = document.getElementById('billsBreakdownDrawer');
    if (!drawer) return;
    const isHidden = drawer.style.display === 'none' || !drawer.style.display;
    drawer.style.display = isHidden ? 'block' : 'none';
    const btn = document.getElementById('btnToggleBillsList');
    if (btn) {
        btn.classList.toggle('active', isHidden);
    }
}

// ============================================
// SALARY PLANNER
// ============================================
function saveSalary(e) {
    e.preventDefault();
    const desc = document.getElementById('salaryDesc').value || 'Salário';
    const value = parseFloat(document.getElementById('salaryValue').value);
    const payDay = parseInt(document.getElementById('salaryPayDay').value) || 5;
    const autoRegister = document.getElementById('salaryAutoRegister').checked;

    appData.salary = { desc, value, payDay, autoRegister };
    saveData(appData);
    closeModal('salary');
    refreshAll();
    showToast(`Salário de ${formatCurrency(value)} configurado!`);
}

function setQuickSalaryMin() {
    appData.salary = {
        desc: 'Salário Mínimo',
        value: 1412,
        payDay: (appData.salary && appData.salary.payDay) || 5,
        autoRegister: true
    };
    saveData(appData);
    refreshAll();
    showToast('🇧🇷 Salário Mínimo configurado em R$ 1.412,00 como base!');
}

function selectExtraIncomeCategory(btn, category) {
    const hidden = document.getElementById('extraIncomeCategory');
    if (hidden) hidden.value = category;
    document.querySelectorAll('.extra-type-pills .btn-quick-val').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
}

function addExtraIncome(e) {
    e.preventDefault();
    const editId = document.getElementById('extraIncomeId')?.value;
    const desc = document.getElementById('extraIncomeDesc').value.trim();
    const value = parseFloat(document.getElementById('extraIncomeValue').value) || 0;
    const category = document.getElementById('extraIncomeCategory')?.value || 'Fotos';
    const date = document.getElementById('extraIncomeDate').value || getTodayStr();
    const autoReserve = document.getElementById('extraIncomeAutoReserve')?.checked;

    if (!desc || value <= 0) {
        showToast('Informe a descrição e o valor da renda extra.');
        return;
    }

    if (!Array.isArray(appData.incomes)) appData.incomes = [];

    if (editId) {
        const item = appData.incomes.find(i => i.id === editId);
        if (item) {
            item.desc = desc;
            item.value = value;
            item.category = category;
            item.date = date;
            item.updatedAt = new Date().toISOString();
        }
        saveData(appData);
        closeModal('extra-income');
        refreshAll();
        showToast(`Renda extra atualizada para ${formatCurrency(value)}!`);
        return;
    }

    const newIncome = {
        id: generateId(),
        desc,
        value,
        category,
        date,
        createdAt: new Date().toISOString()
    };

    appData.incomes.push(newIncome);

    // Se marcou para guardar 40% automaticamente para Reserva
    let reserveSaved = 0;
    if (autoReserve) {
        reserveSaved = Math.round((value * 0.40) * 100) / 100;
        if (reserveSaved > 0) {
            const depositTx = {
                id: generateId(),
                desc: `Reserva 40% de: ${desc}`,
                value: reserveSaved,
                type: 'deposit',
                date: getTodayStr(),
                auto: true,
                createdAt: new Date().toISOString()
            };
            if (!Array.isArray(appData.savingsTransactions)) appData.savingsTransactions = [];
            appData.savingsTransactions.push(depositTx);
            appData.savingsBalance = (appData.savingsBalance || 0) + reserveSaved;
        }
    }

    saveData(appData);
    closeModal('extra-income');
    refreshAll();

    const toastMsg = reserveSaved > 0
        ? `📸 Renda extra de ${formatCurrency(value)} lançada! E ${formatCurrency(reserveSaved)} já guardados na Reserva!`
        : `📸 Renda extra de ${formatCurrency(value)} registrada com sucesso!`;
    showToast(toastMsg);
}

function editExtraIncome(id) {
    const item = (appData.incomes || []).find(i => i.id === id);
    if (!item) return;

    document.getElementById('extraIncomeId').value = item.id;
    document.getElementById('extraIncomeDesc').value = item.desc || '';
    document.getElementById('extraIncomeValue').value = item.value || '';
    document.getElementById('extraIncomeDate').value = item.date || getTodayStr();

    const cat = item.category || 'Fotos';
    document.getElementById('extraIncomeCategory').value = cat;
    document.querySelectorAll('.extra-type-pills .btn-quick-val').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-type') === cat);
    });

    const autoWrap = document.getElementById('extraIncomeAutoReserveWrap');
    if (autoWrap) autoWrap.style.display = 'none';

    const titleEl = document.getElementById('extraIncomeModalTitle');
    if (titleEl) titleEl.innerHTML = '<i class="fas fa-pen-to-square text-primary"></i> Editar Renda Extra';
    const submitBtn = document.getElementById('btnSubmitExtraIncome');
    if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-check"></i> Salvar Alterações';

    openModal('extra-income');
}

function deleteExtraIncome(id) {
    if (!confirm('Deseja excluir este lançamento de renda extra?')) return;
    appData.incomes = (appData.incomes || []).filter(i => i.id !== id);
    saveData(appData);
    refreshAll();
    showToast('Lançamento de renda extra excluído.');
}

function renderExtraIncomeCard() {
    const totalEl = document.getElementById('extraIncomeMonthTotal');
    const countEl = document.getElementById('extraIncomeMonthCount');
    const listEl = document.getElementById('extraIncomeRecentList');
    if (!totalEl) return;

    const currentMonth = getCurrentMonthYear();
    const allIncomes = appData.incomes || [];
    
    // Filtrar apenas o que for renda extra (não é o salário primário)
    const extraIncomes = allIncomes.filter(i => {
        const isCurrentMonth = getMonthYear(i.date) === currentMonth;
        const isSalary = i.category === 'Salário' || i.desc.toLowerCase() === 'salário' || i.desc.toLowerCase() === 'salario';
        return isCurrentMonth && !isSalary;
    });

    const totalVal = extraIncomes.reduce((s, i) => s + (i.value || 0), 0);

    totalEl.textContent = formatCurrency(totalVal);
    if (countEl) {
        countEl.textContent = `${extraIncomes.length} ${extraIncomes.length === 1 ? 'trabalho no mês' : 'trabalhos no mês'}`;
    }

    if (listEl) {
        if (extraIncomes.length === 0) {
            listEl.innerHTML = `
                <div style="text-align:center;padding:16px 8px;color:var(--text-secondary);font-size:0.78rem;">
                    Nenhuma renda extra registrada neste mês ainda.<br>
                    <small>Clique em <strong>+ Lançar Extra</strong> para adicionar fotos ou freelas.</small>
                </div>
            `;
        } else {
            // Ordenar por data mais recente
            const sorted = [...extraIncomes].sort((a, b) => new Date(b.date) - new Date(a.date));
            listEl.innerHTML = sorted.map(item => {
                let tag = '📸 Fotos';
                if (item.category === 'Freelance') tag = '💻 Freela';
                else if (item.category === 'Serviços' || item.category === 'Vendas') tag = '🛠️ Bico';

                return `
                    <div class="extra-income-item">
                        <div class="extra-item-left">
                            <span class="extra-item-tag">${tag}</span>
                            <span class="extra-item-desc" title="${escapeHtml(item.desc)}">${escapeHtml(item.desc)}</span>
                        </div>
                        <div class="extra-item-right">
                            <strong class="text-success">+${formatCurrency(item.value)}</strong>
                            <button type="button" class="btn-icon" style="color:var(--primary);background:none;border:none;cursor:pointer;padding:2px 4px;margin-right:2px;" onclick="editExtraIncome('${item.id}')" title="Editar">
                                <i class="fas fa-pen" style="font-size:0.75rem;"></i>
                            </button>
                            <button type="button" class="btn-icon" style="color:var(--text-secondary);background:none;border:none;cursor:pointer;padding:2px 4px;" onclick="deleteExtraIncome('${item.id}')" title="Excluir">
                                <i class="fas fa-trash-can" style="font-size:0.75rem;"></i>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }
}

function renderMinWageBudgetDivisor() {
    const salaryVal = (appData.salary && appData.salary.value) ? appData.salary.value : 1412;
    const fixedItems = (appData.fixedExpenses || []).filter(f => f.active !== false);
    const fixedTotal = fixedItems.reduce((s, f) => s + (f.value || 0), 0);

    const safetyVal = Math.round(salaryVal * 0.05); // 5% de poupança segura na base
    const baseRemaining = salaryVal - fixedTotal - safetyVal;

    const fixedPct = salaryVal > 0 ? ((fixedTotal / salaryVal) * 100).toFixed(1) : 0;
    const safetyPct = 5;
    const freePct = salaryVal > 0 ? Math.max(0, ((baseRemaining / salaryVal) * 100)).toFixed(1) : 0;

    // DOM Updates - Base Salário Mínimo
    const mwdSalEl = document.getElementById('mwdSalaryVal');
    const mwdFixEl = document.getElementById('mwdFixedVal');
    const mwdFixPctEl = document.getElementById('mwdFixedPct');
    const mwdSafEl = document.getElementById('mwdSafetyVal');
    const mwdRemEl = document.getElementById('mwdRemainingVal');
    const mwdRemStatEl = document.getElementById('mwdRemainingStatus');

    if (mwdSalEl) mwdSalEl.textContent = formatCurrency(salaryVal);
    if (mwdFixEl) mwdFixEl.textContent = formatCurrency(fixedTotal);
    if (mwdFixPctEl) mwdFixPctEl.textContent = `${fixedPct}% do salário mínimo`;
    if (mwdSafEl) mwdSafEl.textContent = formatCurrency(safetyVal);
    if (mwdRemEl) {
        mwdRemEl.textContent = formatCurrency(baseRemaining);
        mwdRemEl.className = `card-value ${baseRemaining >= 0 ? 'text-success' : 'text-danger'}`;
    }
    if (mwdRemStatEl) {
        mwdRemStatEl.textContent = baseRemaining >= 0 ? 'Margem limpa garantida' : `Déficit de ${formatCurrency(Math.abs(baseRemaining))}`;
    }

    // Barras
    const barFix = document.getElementById('mwdBarFixed');
    const barSaf = document.getElementById('mwdBarSafety');
    const barFree = document.getElementById('mwdBarFree');
    if (barFix && salaryVal > 0) barFix.style.width = `${Math.min(100, (fixedTotal / salaryVal) * 100)}%`;
    if (barSaf && salaryVal > 0) barSaf.style.width = `${5}%`;
    if (barFree && salaryVal > 0) barFree.style.width = `${Math.max(0, (baseRemaining / salaryVal) * 100)}%`;

    const legFix = document.getElementById('mwdLegFixed');
    const legSaf = document.getElementById('mwdLegSafety');
    const legFree = document.getElementById('mwdLegFree');
    if (legFix) legFix.textContent = `${fixedPct}%`;
    if (legSaf) legSaf.textContent = `${safetyPct}%`;
    if (legFree) legFree.textContent = `${freePct}%`;

    // Veredito da Base
    const verdictBanner = document.getElementById('mwdVerdictBanner');
    const verdictIcon = document.getElementById('mwdVerdictIcon');
    const verdictTitle = document.getElementById('mwdVerdictTitle');
    const verdictDesc = document.getElementById('mwdVerdictDesc');
    const verdictBadge = document.getElementById('minWageVerdictBadge');

    if (verdictBanner) {
        if (baseRemaining >= 0) {
            verdictBanner.className = 'rx-verdict-banner safe';
            if (verdictIcon) verdictIcon.innerHTML = '<i class="fas fa-circle-check"></i>';
            if (verdictTitle) verdictTitle.textContent = '✅ BASE BLINDADA COM O SALÁRIO MÍNIMO!';
            if (verdictDesc) {
                verdictDesc.innerHTML = `Seu salário de <strong>${formatCurrency(salaryVal)}</strong> paga 100% de todas as suas contas fixas (${formatCurrency(fixedTotal)}) e ainda garante a reserva de segurança de ${formatCurrency(safetyVal)}. Você tem <strong>${formatCurrency(baseRemaining)} livres</strong> sem precisar depender de freela para pagar as contas básicas!`;
            }
            if (verdictBadge) {
                verdictBadge.textContent = '🟢 Base Blindada';
                verdictBadge.className = 'badge-status ok';
            }
        } else {
            verdictBanner.className = 'rx-verdict-banner danger';
            if (verdictIcon) verdictIcon.innerHTML = '<i class="fas fa-triangle-exclamation"></i>';
            if (verdictTitle) verdictTitle.textContent = '⚠️ CONTAS FIXAS SUPERAM O SALÁRIO MÍNIMO!';
            const deficit = Math.abs(baseRemaining);
            if (verdictDesc) {
                verdictDesc.innerHTML = `Suas contas fixas somam <strong>${formatCurrency(fixedTotal)}</strong> (${fixedPct}% do salário). O salário mínimo não cobre tudo sozinho, deixando um déficit de <strong>${formatCurrency(deficit)}</strong> que precisará ser equilibrado pelas receitas de fotos/freelas.`;
            }
            if (verdictBadge) {
                verdictBadge.textContent = '🔴 Déficit na Base';
                verdictBadge.className = 'badge-status danger';
            }
        }
    }

    // Cálculos da Renda Extra (Fotos & Freelance)
    const currentMonth = getCurrentMonthYear();
    const extraIncomes = (appData.incomes || []).filter(i => {
        const isCurrentMonth = getMonthYear(i.date) === currentMonth;
        const isSalary = i.category === 'Salário' || i.desc.toLowerCase() === 'salário' || i.desc.toLowerCase() === 'salario';
        return isCurrentMonth && !isSalary;
    });

    const extraTotal = extraIncomes.reduce((s, i) => s + (i.value || 0), 0);
    const extraReserve = Math.round(extraTotal * 0.40 * 100) / 100;
    const extraInvest = Math.round(extraTotal * 0.40 * 100) / 100;
    const extraLeisure = Math.round((extraTotal - extraReserve - extraInvest) * 100) / 100;

    const totHdr = document.getElementById('extraSplitTotalHeader');
    const resVal = document.getElementById('extraSplitReserveVal');
    const invVal = document.getElementById('extraSplitInvestVal');
    const leiVal = document.getElementById('extraSplitLeisureVal');

    if (totHdr) totHdr.textContent = formatCurrency(extraTotal);
    if (resVal) resVal.textContent = formatCurrency(extraReserve);
    if (invVal) invVal.textContent = formatCurrency(extraInvest);
    if (leiVal) leiVal.textContent = formatCurrency(extraLeisure);
}

function executeExtraIncomeAllocation() {
    const currentMonth = getCurrentMonthYear();
    const extraIncomes = (appData.incomes || []).filter(i => {
        const isCurrentMonth = getMonthYear(i.date) === currentMonth;
        const isSalary = i.category === 'Salário' || i.desc.toLowerCase() === 'salário' || i.desc.toLowerCase() === 'salario';
        return isCurrentMonth && !isSalary;
    });

    const extraTotal = extraIncomes.reduce((s, i) => s + (i.value || 0), 0);
    if (extraTotal <= 0) {
        showToast('Nenhuma renda extra de fotos ou freela registrada neste mês para alocar.');
        return;
    }

    const extraReserve = Math.round(extraTotal * 0.40 * 100) / 100;
    if (extraReserve > 0) {
        const resTx = {
            id: generateId(),
            desc: `Alocação de Renda Extra (Fotos/Freelas) - Reserva 40%`,
            value: extraReserve,
            type: 'deposit',
            date: getTodayStr(),
            auto: false,
            createdAt: new Date().toISOString()
        };
        if (!Array.isArray(appData.savingsTransactions)) appData.savingsTransactions = [];
        appData.savingsTransactions.push(resTx);
        appData.savingsBalance = (appData.savingsBalance || 0) + extraReserve;
        saveData(appData);
        refreshAll();
        showToast(`🎉 ${formatCurrency(extraReserve)} guardados na sua Reserva a partir das fotos/freelas!`);
    }
}

function refreshSalaryPlanner() {
    const emptyEl = document.getElementById('salaryEmpty');
    const contentEl = document.getElementById('salaryContent');
    const displayEl = document.getElementById('salaryAmountDisplay');
    const dayEl = document.getElementById('salaryDayDisplay');

    if (!appData.salary || !appData.salary.value) {
        if (emptyEl) emptyEl.style.display = 'block';
        if (contentEl) contentEl.style.display = 'none';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    if (contentEl) contentEl.style.display = 'block';

    if (displayEl) displayEl.textContent = formatCurrency(appData.salary.value);
    if (dayEl) dayEl.textContent = appData.salary.payDay || 5;
}

// ============================================
// GESTÃO PAGE
// ============================================
function refreshGestaoPage() {
    refreshSalaryPlanner();
    renderExtraIncomeCard();
    renderMinWageBudgetDivisor();
    renderFixedExpenses();
    renderDetailedExpenses();
    renderInstallmentsProjection();
}

// ============================================
// PROJEÇÃO DE PARCELAS FUTURAS (CARTÃO)
// ============================================
function renderInstallmentsProjection() {
    const container = document.getElementById('installmentsTimeline');
    const badgeEl = document.getElementById('totalActiveInstallmentsBadge');
    if (!container) return;

    const now = new Date();
    const months = [];
    for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        months.push({
            year: d.getFullYear(),
            month: d.getMonth(),
            key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
            label: getMonthYearLabel(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`),
            isCurrent: i === 0,
            total: 0,
            items: []
        });
    }

    const installmentItems = (appData.detailedExpenses || []).filter(item => (parseInt(item.installments) || 1) > 1);

    if (badgeEl) {
        badgeEl.textContent = `${installmentItems.length} parcelamento${installmentItems.length === 1 ? '' : 's'} ativo${installmentItems.length === 1 ? '' : 's'}`;
    }

    if (installmentItems.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1; padding: 24px;">
                <i class="fas fa-credit-card" style="font-size:2.2rem;margin-bottom:10px;color:var(--cor-secundaria);"></i>
                <p style="font-weight:600;margin-bottom:4px;">Nenhuma compra parcelada registrada</p>
                <small>Ao cadastrar gastos parcelados no botão "+ Gasto Detalhado", a projeção dos próximos 6 meses aparecerá aqui automaticamente.</small>
            </div>
        `;
        return;
    }

    installmentItems.forEach(item => {
        const numInst = parseInt(item.installments) || 1;
        const monthlyVal = item.value / numInst;
        const purchaseDate = new Date(item.date + 'T00:00:00');
        const pYear = purchaseDate.getFullYear();
        const pMonth = purchaseDate.getMonth();

        months.forEach(m => {
            const diffMonths = (m.year - pYear) * 12 + (m.month - pMonth);
            if (diffMonths >= 0 && diffMonths < numInst) {
                m.total += monthlyVal;
                m.items.push({
                    name: item.desc,
                    installment: diffMonths + 1,
                    totalInstallments: numInst,
                    value: monthlyVal
                });
            }
        });
    });

    container.innerHTML = months.map(m => `
        <div class="installment-month-card">
            <div class="inst-month-title">
                <span>${escapeHtml(m.label)}</span>
                ${m.isCurrent ? '<small style="color:var(--cor-secundaria);font-weight:700;">Mês Atual</small>' : ''}
            </div>
            <div class="inst-month-total card-value">${formatCurrency(m.total)}</div>
            <div class="inst-items-preview">
                ${m.items.length === 0 ? '<span style="color:var(--text-secondary);font-style:italic;">Sem parcelas previstas</span>' :
                    m.items.slice(0, 3).map(it => `<div>• ${escapeHtml(it.name)} (${it.installment}/${it.totalInstallments}): <span class="card-value">${formatCurrency(it.value)}</span></div>`).join('') +
                    (m.items.length > 3 ? `<div style="margin-top:2px;font-weight:600;">+ ${m.items.length - 3} outra(s)...</div>` : '')
                }
            </div>
        </div>
    `).join('');
}

// ============================================
// PORCENTAGENS & POUPANÇA FLEXÍVEL (ANTI-CRISE)
// ============================================
function getSafetySavingsAmount() {
    const currentMonth = getCurrentMonthYear();
    const currentIncome = (appData.incomes || [])
        .filter(i => getMonthYear(i.date) === currentMonth)
        .reduce((s, i) => s + i.value, 0);

    const monthExpenses = (appData.expenses || [])
        .filter(e => getMonthYear(e.date) === currentMonth)
        .reduce((s, e) => s + e.value, 0);

    const safetyPerc = appData.minSavingsPercent || 5;
    const mode = appData.savingsRuleMode || 'income';

    let baseValue = currentIncome;
    if (mode === 'balance') {
        baseValue = Math.max(0, currentIncome - monthExpenses);
    }

    const amount = (baseValue * (safetyPerc / 100));
    return {
        currentIncome,
        monthExpenses,
        safetyPerc,
        mode,
        amount: Math.round(amount * 100) / 100
    };
}

function depositSafetySavings(amountToDeposit) {
    const safety = getSafetySavingsAmount();
    const amount = typeof amountToDeposit === 'number' && amountToDeposit > 0 ? amountToDeposit : safety.amount;

    if (amount <= 0) {
        showToast('Nenhum valor disponível para a poupança de segurança neste momento.');
        return;
    }

    const transaction = {
        id: generateId(),
        desc: `Poupança de Segurança (${safety.safetyPerc}% mesmo abaixo da meta)`,
        value: amount,
        type: 'deposit',
        date: getTodayStr(),
        auto: false,
        isSafetyRule: true,
        createdAt: new Date().toISOString()
    };

    appData.savingsTransactions.push(transaction);
    appData.savingsBalance = (appData.savingsBalance || 0) + amount;
    saveData(appData);
    refreshAll();
    showToast(`Excelente! ${formatCurrency(amount)} guardados com sucesso! Seu hábito financeiro foi mantido.`);
}

function depositCustomSimulation() {
    const sliderEl = document.getElementById('pctSlider');
    const sliderVal = parseFloat(sliderEl ? sliderEl.value : 5) || 5;
    const safety = getSafetySavingsAmount();
    const incomeBase = safety.currentIncome > 0 ? safety.currentIncome : ((appData.salary && appData.salary.value) || 0);
    const customAmt = Math.round((incomeBase * (sliderVal / 100)) * 100) / 100;

    if (customAmt <= 0) {
        showToast('Nenhuma receita registrada neste mês para calcular o percentual simulado.');
        return;
    }

    const transaction = {
        id: generateId(),
        desc: `Poupança Flexível (${sliderVal}% da renda atual)`,
        value: customAmt,
        type: 'deposit',
        date: getTodayStr(),
        auto: false,
        isSafetyRule: true,
        createdAt: new Date().toISOString()
    };

    appData.savingsTransactions.push(transaction);
    appData.savingsBalance = (appData.savingsBalance || 0) + customAmt;
    saveData(appData);
    refreshAll();
    showToast(`Muito bom! ${formatCurrency(customAmt)} (${sliderVal}%) depositados na poupança!`);
}

function updatePctSimulator(val) {
    const perc = parseFloat(val) || 5;
    const displayEl = document.getElementById('pctSliderValueDisplay');
    const badgeEl = document.getElementById('pctSimulatorBadge');
    if (displayEl) displayEl.textContent = `${perc}%`;
    if (badgeEl) badgeEl.textContent = `${perc}%`;

    const safety = getSafetySavingsAmount();
    const incomeBase = safety.currentIncome > 0 ? safety.currentIncome : ((appData.salary && appData.salary.value) || 2000);
    const monthVal = incomeBase * (perc / 100);
    const yearVal = monthVal * 12;
    // 5 anos a 10% ao ano composto: PMT * (((1 + r)^n - 1) / r)
    const r = 0.10 / 12;
    const n = 60;
    const fiveYearsVal = monthVal * ((Math.pow(1 + r, n) - 1) / r);

    const mEl = document.getElementById('pctSimMonthVal');
    const yEl = document.getElementById('pctSimYearVal');
    const fyEl = document.getElementById('pctSimFiveYearsVal');
    const actLabel = document.getElementById('pctSimActionLabel');

    if (mEl) mEl.textContent = formatCurrency(monthVal);
    if (yEl) yEl.textContent = formatCurrency(yearVal);
    if (fyEl) fyEl.textContent = formatCurrency(fiveYearsVal);
    if (actLabel) actLabel.textContent = `Guardar ${formatCurrency(monthVal)} (${perc}%) Agora`;
}

function renderPorcentagensPage() {
    const meta = calculateMeta();
    const safety = getSafetySavingsAmount();

    // 1. Config form inputs
    const idealInput = document.getElementById('pctIdealInput');
    if (idealInput) idealInput.value = appData.savingsPercent || 20;

    const safetyInput = document.getElementById('pctSafetyInput');
    if (safetyInput) safetyInput.value = appData.minSavingsPercent || 5;

    const ruleSelect = document.getElementById('pctRuleModeSelect');
    if (ruleSelect) ruleSelect.value = appData.savingsRuleMode || 'income';

    // 2. Top KPIs
    const metaStatusEl = document.getElementById('pctKpiMetaStatus');
    const metaSubEl = document.getElementById('pctKpiMetaSub');
    if (metaStatusEl) {
        if (meta.remainingToEarn > 0) {
            metaStatusEl.innerHTML = `<span class="text-warning">Abaixo da Meta</span>`;
            if (metaSubEl) metaSubEl.textContent = `Faltam ${formatCurrency(meta.remainingToEarn)}`;
        } else {
            metaStatusEl.innerHTML = `<span class="text-success">Meta Atingida!</span>`;
            if (metaSubEl) metaSubEl.textContent = `Custos e poupança 100% cobertos`;
        }
    }

    const incomeValEl = document.getElementById('pctKpiIncomeVal');
    if (incomeValEl) incomeValEl.textContent = formatCurrency(safety.currentIncome);

    const safetyPercEl = document.getElementById('pctKpiSafetyPerc');
    if (safetyPercEl) safetyPercEl.textContent = `${appData.minSavingsPercent || 5}%`;

    const safetyModeEl = document.getElementById('pctKpiSafetyModeLabel');
    if (safetyModeEl) safetyModeEl.textContent = appData.savingsRuleMode === 'balance' ? 'Sobre saldo livre' : 'Sobre toda receita';

    const safetyAmtEl = document.getElementById('pctKpiSafetyAmount');
    if (safetyAmtEl) safetyAmtEl.textContent = formatCurrency(safety.amount);

    // 3. Action Callout Box
    const actionTitle = document.getElementById('pctActionTitle');
    const actionDesc = document.getElementById('pctActionDesc');
    const actionBtnLabel = document.getElementById('pctActionBtnLabel');

    if (actionTitle && actionDesc && actionBtnLabel) {
        if (meta.remainingToEarn > 0) {
            actionTitle.textContent = `Guardar Parcela de Segurança: ${formatCurrency(safety.amount)} (${appData.minSavingsPercent || 5}%)`;
            actionDesc.innerHTML = `Mesmo que faltem <strong>${formatCurrency(meta.remainingToEarn)}</strong> para bater a meta plena do mês, reservar essa pequena fatia garante a construção do seu patrimônio sem apertar suas contas essenciais!`;
            actionBtnLabel.textContent = `Guardar ${formatCurrency(safety.amount)} na Poupança`;
        } else {
            actionTitle.textContent = `Meta Batida! Você pode guardar ${formatCurrency(meta.savingsTarget)} (${appData.savingsPercent}%)`;
            actionDesc.innerHTML = `Parabéns! Sua receita já cobre todas as contas e a meta cheia. Se desejar, guarde a meta plena ou a parcela de segurança de ${formatCurrency(safety.amount)}.`;
            actionBtnLabel.textContent = `Guardar ${formatCurrency(safety.amount || meta.savingsTarget)} na Poupança`;
        }
    }

    // 4. Scenarios
    const scenSafetyTitle = document.getElementById('scenSafetyTitle');
    if (scenSafetyTitle) scenSafetyTitle.textContent = `Guardar ${appData.minSavingsPercent || 5}% Mesmo Abaixo da Meta`;

    const scenIdealTitle = document.getElementById('scenIdealTitle');
    if (scenIdealTitle) scenIdealTitle.textContent = `Guardar ${appData.savingsPercent || 20}% nos Meses Fortes`;

    const safetyAnnual = (safety.amount > 0 ? safety.amount : ((appData.salary?.value || 2000) * ((appData.minSavingsPercent || 5) / 100))) * 12;
    const idealAnnual = (meta.savingsTarget > 0 ? meta.savingsTarget : ((appData.salary?.value || 2000) * ((appData.savingsPercent || 20) / 100))) * 12;

    const scenSafetyAnnualVal = document.getElementById('scenSafetyAnnualVal');
    if (scenSafetyAnnualVal) scenSafetyAnnualVal.textContent = `${formatCurrency(safetyAnnual)} poupados`;

    const scenIdealAnnualVal = document.getElementById('scenIdealAnnualVal');
    if (scenIdealAnnualVal) scenIdealAnnualVal.textContent = `${formatCurrency(idealAnnual)} poupados`;

    // 5. Update slider simulator
    const slider = document.getElementById('pctSlider');
    updatePctSimulator(slider ? slider.value : (appData.minSavingsPercent || 5));

    // 6. Notice in Poupança page
    const poupancaNotice = document.getElementById('poupancaSafetyNotice');
    if (poupancaNotice) {
        poupancaNotice.textContent = `Você pode guardar ${appData.minSavingsPercent || 5}% (${formatCurrency(safety.amount)}) mesmo em meses com faturamento abaixo da meta.`;
    }

    // 7. Divisor Inteligente de Aporte (Valor X)
    calculateAporteSplit();
}

// ============================================
// DIVISOR INTELIGENTE DE APORTE & RENDA (VALOR X)
// ============================================
let currentAporteValue = 1000;
let currentAporteStrategy = 'balanced';
let aporteCustomPcts = { reserve: 40, invest: 45, goals: 15 };

function calculateEmergencyReserveGoal() {
    const fixedExpensesTotal = (appData.fixedExpenses || [])
        .filter(f => f.active !== false)
        .reduce((sum, f) => sum + (f.value || 0), 0);
    
    // Gastos variáveis médios baseados no mês atual ou padrão
    const currentMonth = getCurrentMonthYear();
    const monthExpenses = (appData.expenses || []).filter(e => getMonthYear(e.date) === currentMonth);
    const variableTotal = monthExpenses.reduce((sum, e) => sum + (e.value || 0), 0);
    
    // Custo mensal essencial estimado
    let monthlyEssentialCost = fixedExpensesTotal + (variableTotal > 0 ? variableTotal * 0.7 : 800);
    if (monthlyEssentialCost < 1000) {
        if (appData.salary && appData.salary.value) {
            monthlyEssentialCost = appData.salary.value * 0.65;
        } else {
            monthlyEssentialCost = 1500;
        }
    }

    const target = Math.round(monthlyEssentialCost * 6); // 6 meses de segurança
    const current = Math.max(0, appData.savingsBalance || 0);
    const progressPct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
    const remaining = Math.max(0, target - current);

    return {
        target,
        current,
        progressPct,
        remaining,
        monthlyEssentialCost
    };
}

function getAporteStrategyPcts(strat) {
    if (strat === 'reserve-first') {
        return { reserve: 60, invest: 30, goals: 10 };
    } else if (strat === 'invest-max') {
        return { reserve: 10, invest: 75, goals: 15 };
    } else if (strat === 'custom') {
        return { ...aporteCustomPcts };
    }
    // Default 'balanced'
    return { reserve: 40, invest: 45, goals: 15 };
}

function calculateAporteSplit(value) {
    let amount = currentAporteValue;
    if (typeof value !== 'undefined') {
        amount = Math.max(0, parseFloat(value) || 0);
        currentAporteValue = amount;
    } else {
        const input = document.getElementById('aporteInputAmount');
        if (input && input.value !== '') {
            amount = Math.max(0, parseFloat(input.value) || 0);
            currentAporteValue = amount;
        }
    }

    const pcts = getAporteStrategyPcts(currentAporteStrategy);
    const reserveVal = (amount * pcts.reserve) / 100;
    const investVal = (amount * pcts.invest) / 100;
    const goalsVal = (amount * pcts.goals) / 100;

    // Sub-alocação dos Investimentos
    // Renda Fixa: 40% | FIIs: 35% | Ações: 25%
    const subFixed = investVal * 0.40;
    const subFii = investVal * 0.35;
    const subAcoes = investVal * 0.25;

    // Rendimentos estimados
    // Reserva: 100% CDI (~11% a.a.)
    const reserveYieldYear = reserveVal * 0.11;
    // Investimentos: FIIs (~0.85%/mês) + Média carteira
    const investMonthlyPassive = (subFii * 0.0085) + (investVal * 0.003);

    // Diagnóstico da Reserva de Emergência
    const reserveInfo = calculateEmergencyReserveGoal();

    // DOM Updates
    // 1. Pilares
    const resPctEl = document.getElementById('pillarReservePct');
    const resValEl = document.getElementById('pillarReserveVal');
    const resYieldEl = document.getElementById('pillarReserveYield');
    if (resPctEl) resPctEl.textContent = `${pcts.reserve}%`;
    if (resValEl) resValEl.textContent = formatCurrency(reserveVal);
    if (resYieldEl) resYieldEl.textContent = formatCurrency(reserveYieldYear);

    const invPctEl = document.getElementById('pillarInvestPct');
    const invValEl = document.getElementById('pillarInvestVal');
    const subFixedEl = document.getElementById('subAllocFixed');
    const subFiiEl = document.getElementById('subAllocFii');
    const subAcoesEl = document.getElementById('subAllocAcoes');
    const invPassiveEl = document.getElementById('pillarInvestPassive');

    if (invPctEl) invPctEl.textContent = `${pcts.invest}%`;
    if (invValEl) invValEl.textContent = formatCurrency(investVal);
    if (subFixedEl) subFixedEl.textContent = formatCurrency(subFixed);
    if (subFiiEl) subFiiEl.textContent = formatCurrency(subFii);
    if (subAcoesEl) subAcoesEl.textContent = formatCurrency(subAcoes);
    if (invPassiveEl) invPassiveEl.textContent = formatCurrency(investMonthlyPassive);

    const goalsPctEl = document.getElementById('pillarGoalsPct');
    const goalsValEl = document.getElementById('pillarGoalsVal');
    const goalsTargetEl = document.getElementById('pillarGoalsTargetName');
    if (goalsPctEl) goalsPctEl.textContent = `${pcts.goals}%`;
    if (goalsValEl) goalsValEl.textContent = formatCurrency(goalsVal);
    if (goalsTargetEl) {
        const firstGoal = (appData.savingsGoals || [])[0];
        goalsTargetEl.textContent = firstGoal ? `Meta: ${firstGoal.name}` : 'Metas cadastradas ou Reserva de Desejos';
    }

    // 2. Barra Consolidada
    const barRes = document.getElementById('aporteBarReserve');
    const barInv = document.getElementById('aporteBarInvest');
    const barGoals = document.getElementById('aporteBarGoals');
    if (barRes) barRes.style.width = `${pcts.reserve}%`;
    if (barInv) barInv.style.width = `${pcts.invest}%`;
    if (barGoals) barGoals.style.width = `${pcts.goals}%`;

    const lblResVal = document.getElementById('aporteLabelResVal');
    const lblResPct = document.getElementById('aporteLabelResPct');
    const lblInvVal = document.getElementById('aporteLabelInvVal');
    const lblInvPct = document.getElementById('aporteLabelInvPct');
    const lblGoalVal = document.getElementById('aporteLabelGoalVal');
    const lblGoalPct = document.getElementById('aporteLabelGoalPct');

    if (lblResVal) lblResVal.textContent = formatCurrency(reserveVal);
    if (lblResPct) lblResPct.textContent = `${pcts.reserve}%`;
    if (lblInvVal) lblInvVal.textContent = formatCurrency(investVal);
    if (lblInvPct) lblInvPct.textContent = `${pcts.invest}%`;
    if (lblGoalVal) lblGoalVal.textContent = formatCurrency(goalsVal);
    if (lblGoalPct) lblGoalPct.textContent = `${pcts.goals}%`;

    // 3. Diagnóstico da Reserva
    const diagTextEl = document.getElementById('aporteReserveDiagnosisText');
    const resTargetEl = document.getElementById('aporteReserveTarget');
    const resCurrEl = document.getElementById('aporteReserveCurrent');
    const resPctStatusEl = document.getElementById('aporteReservePct');
    const resBadgeEl = document.getElementById('aporteReserveBadge');

    if (resTargetEl) resTargetEl.textContent = formatCurrency(reserveInfo.target);
    if (resCurrEl) resCurrEl.textContent = formatCurrency(reserveInfo.current);
    if (resPctStatusEl) resPctStatusEl.textContent = `${reserveInfo.progressPct}%`;

    if (diagTextEl) {
        if (reserveInfo.progressPct >= 100) {
            diagTextEl.innerHTML = `Sua <strong>Reserva de Emergência de 6 meses está 100% concluída (${formatCurrency(reserveInfo.current)})!</strong> Você já tem segurança máxima e pode migrar para a estratégia <strong>Multiplicação</strong> para acelerar seus investimentos.`;
            if (resBadgeEl) {
                resBadgeEl.textContent = '🏆 Reserva 100% Concluída';
                resBadgeEl.className = 'badge-status ok';
            }
        } else if (reserveInfo.progressPct >= 50) {
            diagTextEl.innerHTML = `Você já construiu <strong>${reserveInfo.progressPct}% da sua reserva</strong> (faltam ${formatCurrency(reserveInfo.remaining)}). Esse aporte de <strong>${formatCurrency(reserveVal)}</strong> aproxima ainda mais sua tranquilidade!`;
            if (resBadgeEl) {
                resBadgeEl.textContent = '🛡️ Mais de 50% Blindado';
                resBadgeEl.className = 'badge-status ok';
            }
        } else {
            diagTextEl.innerHTML = `Sua reserva ideal é de <strong>${formatCurrency(reserveInfo.target)}</strong> (6 meses do seu custo de vida essencial). Recomendamos focar na fatia de <strong>Reserva de Emergência</strong> para evitar dívidas em imprevistos.`;
            if (resBadgeEl) {
                resBadgeEl.textContent = '⚠️ Construindo Reserva';
                resBadgeEl.className = 'badge-status warning';
            }
        }
    }

    // 4. Quick free balance & salary preview labels
    const quickFree = document.getElementById('aporteQuickFreeBal');
    const quickSal = document.getElementById('aporteQuickSalary');
    const currentMonthData = getCurrentMonthYear();
    const incomes = (appData.incomes || []).filter(i => getMonthYear(i.date) === currentMonthData);
    const expenses = (appData.expenses || []).filter(e => getMonthYear(e.date) === currentMonthData);
    const totInc = incomes.reduce((s, i) => s + i.value, 0);
    const totExp = expenses.reduce((s, e) => s + e.value, 0);
    const freeBal = Math.max(0, totInc - totExp);

    if (quickFree) quickFree.textContent = formatCurrency(freeBal);
    if (quickSal) quickSal.textContent = formatCurrency((appData.salary && appData.salary.value) || 0);

    return {
        amount,
        reserveVal,
        investVal,
        goalsVal,
        subFixed,
        subFii,
        subAcoes
    };
}

function setAporteQuickVal(val) {
    const input = document.getElementById('aporteInputAmount');
    if (input) {
        input.value = val;
    }
    // Update active class on buttons
    document.querySelectorAll('.btn-quick-val').forEach(btn => btn.classList.remove('active'));
    if (window.event && window.event.target) {
        window.event.target.classList.add('active');
    }
    calculateAporteSplit(val);
}

function setAporteFromFreeBalance() {
    const currentMonth = getCurrentMonthYear();
    const incomes = (appData.incomes || []).filter(i => getMonthYear(i.date) === currentMonth);
    const expenses = (appData.expenses || []).filter(e => getMonthYear(e.date) === currentMonth);
    const freeBal = Math.max(10, incomes.reduce((s, i) => s + i.value, 0) - expenses.reduce((s, e) => s + e.value, 0));
    setAporteQuickVal(freeBal);
}

function setAporteFromSalary() {
    const sal = (appData.salary && appData.salary.value) || 2000;
    setAporteQuickVal(sal);
}

function setAporteStrategy(strat) {
    currentAporteStrategy = strat;
    document.querySelectorAll('.aporte-strat-card').forEach(card => {
        card.classList.toggle('active', card.getAttribute('data-strat') === strat);
    });

    const slidersBox = document.getElementById('aporteCustomSliders');
    if (slidersBox) {
        slidersBox.style.display = strat === 'custom' ? 'flex' : 'none';
    }

    calculateAporteSplit();
}

function onAporteSliderChange(type, val) {
    const num = Math.min(100, Math.max(0, parseInt(val, 10) || 0));
    aporteCustomPcts[type] = num;

    // Normalizar para somar 100%
    if (type === 'reserve') {
        const remaining = 100 - num;
        aporteCustomPcts.invest = Math.round(remaining * 0.75);
        aporteCustomPcts.goals = remaining - aporteCustomPcts.invest;
    } else if (type === 'invest') {
        const remaining = 100 - num;
        aporteCustomPcts.reserve = Math.round(remaining * 0.70);
        aporteCustomPcts.goals = remaining - aporteCustomPcts.reserve;
    } else if (type === 'goals') {
        const remaining = 100 - num;
        aporteCustomPcts.invest = Math.round(remaining * 0.60);
        aporteCustomPcts.reserve = remaining - aporteCustomPcts.invest;
    }

    // Update labels and sliders
    const lblRes = document.getElementById('aporteSliderReserveLabel');
    const lblInv = document.getElementById('aporteSliderInvestLabel');
    const lblGoals = document.getElementById('aporteSliderGoalsLabel');
    if (lblRes) lblRes.textContent = `${aporteCustomPcts.reserve}%`;
    if (lblInv) lblInv.textContent = `${aporteCustomPcts.invest}%`;
    if (lblGoals) lblGoals.textContent = `${aporteCustomPcts.goals}%`;

    const sRes = document.getElementById('aporteSliderReserve');
    const sInv = document.getElementById('aporteSliderInvest');
    const sGoals = document.getElementById('aporteSliderGoals');
    if (sRes) sRes.value = aporteCustomPcts.reserve;
    if (sInv) sInv.value = aporteCustomPcts.invest;
    if (sGoals) sGoals.value = aporteCustomPcts.goals;

    calculateAporteSplit();
}

function executeAporteReserveDeposit() {
    const split = calculateAporteSplit();
    if (split.reserveVal <= 0) {
        showToast('Nenhum valor calculado para a reserva.');
        return;
    }

    const transaction = {
        id: generateId(),
        desc: `Aporte Divisor - Reserva de Emergência (${formatCurrency(split.amount)})`,
        value: split.reserveVal,
        type: 'deposit',
        date: getTodayStr(),
        auto: false,
        createdAt: new Date().toISOString()
    };

    if (!Array.isArray(appData.savingsTransactions)) appData.savingsTransactions = [];
    appData.savingsTransactions.push(transaction);
    appData.savingsBalance = (appData.savingsBalance || 0) + split.reserveVal;

    saveData(appData);
    refreshAll();
    showToast(`🛡️ ${formatCurrency(split.reserveVal)} guardados com sucesso na sua Reserva de Emergência!`);
}

function executeAutoSplitAll() {
    const split = calculateAporteSplit();
    if (split.amount <= 0) {
        showToast('Digite um valor maior que zero para distribuir.');
        return;
    }

    // 1. Guardar a Reserva na Poupança
    if (split.reserveVal > 0) {
        const resTx = {
            id: generateId(),
            desc: `Aporte Automático - Reserva de Emergência (${formatCurrency(split.amount)})`,
            value: split.reserveVal,
            type: 'deposit',
            date: getTodayStr(),
            auto: false,
            createdAt: new Date().toISOString()
        };
        if (!Array.isArray(appData.savingsTransactions)) appData.savingsTransactions = [];
        appData.savingsTransactions.push(resTx);
        appData.savingsBalance = (appData.savingsBalance || 0) + split.reserveVal;
    }

    // 2. Se houver investimentos, cadastrar os ativos sugeridos
    if (split.investVal > 0) {
        if (!Array.isArray(appData.investments)) appData.investments = [];
        
        // Ativo 1: Renda Fixa / Tesouro
        if (split.subFixed > 0) {
            appData.investments.push({
                id: generateId(),
                name: 'Tesouro IPCA+ / CDB 110% CDI',
                category: 'Renda Fixa',
                institution: 'Corretora Principal',
                investedAmount: split.subFixed,
                currentAmount: split.subFixed,
                date: getTodayStr(),
                expectedYield: '12% a.a.',
                createdAt: new Date().toISOString()
            });
        }

        // Ativo 2: FIIs
        if (split.subFii > 0) {
            appData.investments.push({
                id: generateId(),
                name: 'Carteira de FIIs (Dividendos)',
                category: 'Fundos Imobiliários (FIIs)',
                institution: 'Bolsa B3',
                investedAmount: split.subFii,
                currentAmount: split.subFii,
                date: getTodayStr(),
                expectedYield: '0.85% ao mês',
                createdAt: new Date().toISOString()
            });
        }

        // Ativo 3: Ações / ETFs
        if (split.subAcoes > 0) {
            appData.investments.push({
                id: generateId(),
                name: 'Carteira de Ações / BOVA11',
                category: 'Ações',
                institution: 'Bolsa B3',
                investedAmount: split.subAcoes,
                currentAmount: split.subAcoes,
                date: getTodayStr(),
                expectedYield: '14% a.a.',
                createdAt: new Date().toISOString()
            });
        }
    }

    saveData(appData);
    refreshAll();

    showToast(`🎉 Distribuição de ${formatCurrency(split.amount)} executada! ${formatCurrency(split.reserveVal)} na reserva e ${formatCurrency(split.investVal)} em investimentos!`);

    // Levar o usuário até a aba Investimentos para ele já ver o gráfico atualizado
    if (split.investVal > 0) {
        navigateTo('investimentos');
    }
}

function openAporteModal(optionalAmount) {
    navigateTo('porcentagens');
    setTimeout(() => {
        const card = document.getElementById('aporteSplitterCard');
        const input = document.getElementById('aporteInputAmount');
        if (optionalAmount && input) {
            input.value = optionalAmount;
        }
        calculateAporteSplit(optionalAmount);
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        if (input) {
            input.focus();
            input.select();
        }
    }, 150);
}

function savePorcentagensConfig(e) {
    if (e) e.preventDefault();
    const ideal = parseInt(document.getElementById('pctIdealInput').value) || 20;
    const safety = parseInt(document.getElementById('pctSafetyInput').value) || 5;
    const mode = document.getElementById('pctRuleModeSelect').value || 'income';

    appData.savingsPercent = Math.min(80, Math.max(1, ideal));
    appData.minSavingsPercent = Math.min(40, Math.max(1, safety));
    appData.savingsRuleMode = mode;

    saveData(appData);
    refreshAll();
    showToast(`Regras atualizadas: ${appData.savingsPercent}% ideal / ${appData.minSavingsPercent}% segurança!`);
}

// ============================================
// SAVINGS
// ============================================
function updateSavingsPercent() {
    const val = parseInt(document.getElementById('savingsPercent').value);
    if (val >= 1 && val <= 100) {
        appData.savingsPercent = val;
        saveData(appData);
        refreshAll();
        showToast(`Porcentagem atualizada para ${val}%`);
    }
}

function addSavingsTransaction(e, type) {
    e.preventDefault();
    const descId = type === 'deposit' ? 'savingsDepositDesc' : 'savingsWithdrawDesc';
    const valueId = type === 'deposit' ? 'savingsDepositValue' : 'savingsWithdrawValue';
    const desc = document.getElementById(descId).value || (type === 'deposit' ? 'Depósito' : 'Retirada');
    const value = parseFloat(document.getElementById(valueId).value);

    if (type === 'withdraw' && value > appData.savingsBalance) {
        alert('Saldo insuficiente na poupança!');
        return;
    }

    appData.savingsTransactions.push({
        id: generateId(), type, desc, value, date: getTodayStr(), auto: false, createdAt: new Date().toISOString()
    });
    appData.savingsBalance += (type === 'deposit' ? value : -value);
    saveData(appData);
    closeModal(`savings-${type}`);
    e.target.reset();
    refreshAll();
    showToast(type === 'deposit' ? `${formatCurrency(value)} depositado!` : `${formatCurrency(value)} retirado!`);
}

function addSavingsGoal(e) {
    e.preventDefault();
    if (!Array.isArray(appData.savingsGoals)) appData.savingsGoals = [];

    const editId = document.getElementById('goalId')?.value;
    const name = document.getElementById('goalName').value.trim();
    const target = parseFloat(document.getElementById('goalTarget').value) || 0;
    const icon = document.getElementById('goalIcon').value;

    if (!name || target <= 0) {
        showToast('Informe o nome da meta e o valor alvo.');
        return;
    }

    if (editId) {
        const goal = appData.savingsGoals.find(g => g.id === editId);
        if (goal) {
            goal.name = name;
            goal.target = target;
            goal.icon = icon;
            goal.updatedAt = new Date().toISOString();
        }
        saveData(appData);
        closeModal('savings-goal');
        refreshAll();
        showToast(`Meta "${name}" atualizada!`);
        return;
    }

    appData.savingsGoals.push({
        id: generateId(),
        name,
        target,
        icon,
        createdAt: new Date().toISOString()
    });
    saveData(appData);
    closeModal('savings-goal');
    refreshAll();
    showToast('Meta criada!');
}

function editSavingsGoal(id) {
    const goal = (appData.savingsGoals || []).find(g => g.id === id);
    if (!goal) return;

    document.getElementById('goalId').value = goal.id;
    document.getElementById('goalName').value = goal.name || '';
    document.getElementById('goalTarget').value = goal.target || '';
    document.getElementById('goalIcon').value = goal.icon || '🎯';

    const titleEl = document.getElementById('goalModalTitle');
    if (titleEl) titleEl.innerHTML = '<i class="fas fa-pen-to-square text-primary"></i> Editar Meta de Poupança';
    const submitBtn = document.getElementById('btnSubmitGoal');
    if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-check"></i> Salvar Alterações';

    openModal('savings-goal');
}

function deleteSavingsGoal(id) {
    if (!confirm('Deseja excluir esta meta?')) return;
    appData.savingsGoals = appData.savingsGoals.filter(g => g.id !== id);
    saveData(appData);
    refreshAll();
    showToast('Meta excluída!');
}

function refreshSavingsPage() {
    document.getElementById('savingsTotalDisplay').textContent = formatCurrency(appData.savingsBalance);
    document.getElementById('currentPercentDisplay').textContent = `${appData.savingsPercent}%`;

    const goalsContainer = document.getElementById('savingsGoalsList');
    if (appData.savingsGoals.length === 0) {
        goalsContainer.innerHTML = `<div class="empty-state"><i class="fas fa-flag"></i><p>Nenhuma meta criada ainda</p><small>Crie metas para se motivar!</small></div>`;
    } else {
        goalsContainer.innerHTML = appData.savingsGoals.map(goal => {
            const progress = Math.min((appData.savingsBalance / goal.target) * 100, 100);
            const remaining = Math.max(goal.target - appData.savingsBalance, 0);
            return `
                <div class="goal-item">
                    <div class="goal-header">
                        <div class="goal-info"><span class="goal-icon">${goal.icon}</span><div><h4>${goal.name}</h4><small>Meta: ${formatCurrency(goal.target)}</small></div></div>
                        <div class="goal-actions" style="display:flex;gap:6px;align-items:center;">
                            <button class="goal-edit btn-icon" onclick="editSavingsGoal('${goal.id}')" title="Editar Meta" style="background:none;border:none;color:var(--primary);cursor:pointer;padding:4px;"><i class="fas fa-pen"></i></button>
                            <button class="goal-delete" onclick="deleteSavingsGoal('${goal.id}')" title="Excluir Meta"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="goal-progress">
                        <div class="progress-bar"><div class="progress-fill" style="width: ${progress}%"></div></div>
                        <div class="goal-progress-info"><span><strong>${progress.toFixed(1)}%</strong> alcançado</span><span>Faltam ${formatCurrency(remaining)}</span></div>
                    </div>
                </div>`;
        }).join('');
    }

    const historyContainer = document.getElementById('savingsHistory');
    const history = [...appData.savingsTransactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (history.length === 0) {
        historyContainer.innerHTML = `<div class="empty-state"><i class="fas fa-piggy-bank"></i><p>Nenhuma movimentação</p></div>`;
    } else {
        historyContainer.innerHTML = history.map(tx => `
            <div class="transaction-item">
                <div class="transaction-left">
                    <div class="transaction-icon ${tx.type}"><i class="fas ${tx.type === 'deposit' ? 'fa-arrow-down' : 'fa-arrow-up'}"></i></div>
                    <div class="transaction-details"><h4>${tx.desc}${tx.auto ? ' <small style="color:var(--primary);">(Auto)</small>' : ''}</h4><small>${formatDate(tx.date)}</small></div>
                </div>
                <div class="transaction-right"><span class="transaction-amount ${tx.type === 'deposit' ? 'positive' : 'negative'}">${tx.type === 'deposit' ? '+' : '-'}${formatCurrency(tx.value)}</span></div>
            </div>`).join('');
    }

    renderEmergencyFund();
    updateSavingsProgressCard();
    updatePatrimonioConsolidatedBanner();
    renderPoupancaTabChart();
}

// ============================================
// SIMULADOR DE RESERVA DE EMERGÊNCIA
// ============================================
function renderEmergencyFund() {
    const selectEl = document.getElementById('reserveMonthsSelect');
    const months = parseInt(selectEl ? selectEl.value : 6) || 6;

    const fixedTotal = (appData.fixedExpenses || [])
        .filter(f => f.active !== false)
        .reduce((s, f) => s + f.value, 0);

    const currentMonth = getCurrentMonthYear();
    const monthExpenses = (appData.expenses || [])
        .filter(e => getMonthYear(e.date) === currentMonth)
        .reduce((s, e) => s + e.value, 0);

    let monthlyCost = 0;
    if (fixedTotal > 0) {
        monthlyCost = fixedTotal + (monthExpenses > fixedTotal ? (monthExpenses - fixedTotal) : 0);
    } else if (monthExpenses > 0) {
        monthlyCost = monthExpenses;
    } else if (appData.salary && appData.salary.value) {
        monthlyCost = appData.salary.value * 0.7;
    } else {
        monthlyCost = 1500;
    }

    const totalTarget = monthlyCost * months;
    const currentSaved = Math.max(0, appData.savingsBalance || 0);
    const remaining = Math.max(0, totalTarget - currentSaved);
    const progress = totalTarget > 0 ? Math.min(100, (currentSaved / totalTarget) * 100) : 0;

    let monthlySavingsRate = 0;
    if (appData.salary && appData.salary.value) {
        monthlySavingsRate = appData.salary.value * ((appData.savingsPercent || 20) / 100);
    } else {
        const deposits = (appData.savingsTransactions || []).filter(t => t.type === 'deposit');
        if (deposits.length > 0) {
            monthlySavingsRate = deposits.reduce((s, d) => s + d.value, 0) / Math.max(1, deposits.length);
        } else {
            monthlySavingsRate = monthlyCost * 0.2;
        }
    }

    let estimatedText = '';
    if (remaining === 0) {
        estimatedText = '🎉 Parabéns! Sua reserva de emergência está 100% constituída!';
    } else if (monthlySavingsRate > 0) {
        const monthsNeeded = Math.ceil(remaining / monthlySavingsRate);
        estimatedText = `~${monthsNeeded} mês(es) para concluir (guardando ${formatCurrency(monthlySavingsRate)}/mês)`;
    } else {
        estimatedText = 'Defina depósitos mensais para ver a estimativa de tempo';
    }

    const costEl = document.getElementById('reserveMonthlyCost');
    if (costEl) costEl.textContent = formatCurrency(monthlyCost);

    const targetEl = document.getElementById('reserveTotalTarget');
    if (targetEl) targetEl.textContent = formatCurrency(totalTarget);

    const savedEl = document.getElementById('reserveCurrentSaved');
    if (savedEl) savedEl.textContent = formatCurrency(currentSaved);

    const remEl = document.getElementById('reserveRemaining');
    if (remEl) remEl.textContent = formatCurrency(remaining);

    const pctEl = document.getElementById('reserveProgressPercent');
    if (pctEl) pctEl.textContent = `${progress.toFixed(1)}% da reserva completa`;

    const estEl = document.getElementById('reserveEstimatedTime');
    if (estEl) estEl.textContent = estimatedText;

    const barEl = document.getElementById('reserveProgressBar');
    if (barEl) barEl.style.width = `${progress}%`;
}

// ============================================
// INVESTIMENTOS & PATRIMÔNIO
// ============================================
const investmentCategoryColors = {
    'Renda Fixa': '#3b82f6',
    'Tesouro Direto': '#0ea5e9',
    'Fundos Imobiliários (FIIs)': '#10b981',
    'Ações': '#8b5cf6',
    'Criptomoedas': '#f59e0b',
    'Fundos de Investimento': '#06b6d4',
    'Outros': '#64748b'
};

const investmentCategoryIcons = {
    'Renda Fixa': 'fa-shield-halved',
    'Tesouro Direto': 'fa-landmark',
    'Fundos Imobiliários (FIIs)': 'fa-building',
    'Ações': 'fa-chart-line',
    'Criptomoedas': 'fa-coins',
    'Fundos de Investimento': 'fa-chart-pie',
    'Outros': 'fa-wallet'
};

let currentInvestFilter = 'all';
let investSimYears = 5;
let investDoughnutChartInstance = null;
let investBarChartInstance = null;

function syncInvestCurrentValue(val) {
    const curInput = document.getElementById('investCurrentAmount');
    if (curInput && (!curInput.value || curInput.dataset.synced !== 'false')) {
        curInput.value = val;
        curInput.dataset.synced = 'true';
    }
}

function addInvestment(e) {
    e.preventDefault();
    if (!Array.isArray(appData.investments)) appData.investments = [];

    const editId = document.getElementById('investId')?.value;
    const name = document.getElementById('investName').value.trim();
    const category = document.getElementById('investCategory').value;
    const institution = document.getElementById('investInstitution').value.trim();
    const investedAmount = parseMoneyBR(document.getElementById('investAmount').value) || 0;
    const currentAmount = parseMoneyBR(document.getElementById('investCurrentAmount').value) || investedAmount;
    const date = document.getElementById('investDate').value || getTodayStr();
    const expectedYield = document.getElementById('investYieldRate').value.trim();
    const maturityDate = document.getElementById('investMaturity').value.trim();

    if (!name || investedAmount <= 0) {
        showToast('Preencha o nome do ativo e o valor aplicado corretamente.');
        return;
    }

    if (editId) {
        const asset = appData.investments.find(i => i.id === editId);
        if (asset) {
            asset.name = name;
            asset.category = category;
            asset.institution = institution || 'Instituição não informada';
            asset.investedAmount = investedAmount;
            asset.currentAmount = currentAmount;
            asset.date = date;
            asset.expectedYield = expectedYield;
            asset.maturityDate = maturityDate;
            asset.updatedAt = new Date().toISOString();
        }
        saveData(appData);
        closeModal('investment');
        navigateTo('investimentos');
        refreshDashboard();
        showToast(`Investimento "${name}" atualizado com sucesso!`);
        return;
    }

    // Detecção inteligente: verificar se o usuário já possui um ativo com o mesmo nome
    const existing = appData.investments.find(i => 
        i.name.trim().toLowerCase() === name.toLowerCase()
    );

    if (existing) {
        const confirmMerge = confirm(
            `Você já possui o ativo "${existing.name}" cadastrado na sua carteira com ${formatCurrency(existing.investedAmount)} aplicados.\n\n` +
            `Deseja SOMAR este novo valor de ${formatCurrency(investedAmount)} a ele como um Novo Aporte (evitando criar um ativo duplicado)?\n\n` +
            `• Clique em "OK" para SOMAR ao investimento existente.\n` +
            `• Clique em "Cancelar" para cadastrar como um ativo separado.`
        );

        if (confirmMerge) {
            existing.investedAmount = (existing.investedAmount || 0) + investedAmount;
            existing.currentAmount = (existing.currentAmount || 0) + currentAmount;
            existing.date = date;
            if (expectedYield) existing.expectedYield = expectedYield;
            if (maturityDate) existing.maturityDate = maturityDate;
            existing.updatedAt = new Date().toISOString();

            saveData(appData);
            closeModal('investment');
            navigateTo('investimentos');
            refreshDashboard();
            showToast(`🎉 Aporte de ${formatCurrency(investedAmount)} somado com sucesso a "${existing.name}"!`);
            return;
        }
    }

    const newAsset = {
        id: generateId(),
        name,
        category,
        institution: institution || 'Instituição não informada',
        investedAmount,
        currentAmount,
        date,
        expectedYield,
        maturityDate,
        createdAt: new Date().toISOString()
    };

    appData.investments.push(newAsset);

    saveData(appData);
    closeModal('investment');
    // Garantir que a aba investimentos esteja visível antes de renderizar gráficos
    navigateTo('investimentos');
    refreshDashboard();
    showToast(`Investimento "${name}" cadastrado com sucesso!`);
}

function editInvestment(id) {
    const asset = (appData.investments || []).find(i => i.id === id);
    if (!asset) return;

    document.getElementById('investId').value = asset.id;
    document.getElementById('investName').value = asset.name || '';
    document.getElementById('investCategory').value = asset.category || 'Renda Fixa';
    document.getElementById('investInstitution').value = asset.institution || '';
    document.getElementById('investAmount').value = asset.investedAmount || '';
    document.getElementById('investCurrentAmount').value = asset.currentAmount || asset.investedAmount || '';
    document.getElementById('investDate').value = asset.date || getTodayStr();
    document.getElementById('investYieldRate').value = asset.expectedYield || '';
    document.getElementById('investMaturity').value = asset.maturityDate || '';

    const deductExpenseCheck = document.getElementById('investDeductExpense');
    if (deductExpenseCheck) deductExpenseCheck.checked = false;

    const titleEl = document.getElementById('investModalTitle');
    if (titleEl) titleEl.innerHTML = '<i class="fas fa-pen-to-square text-primary"></i> Editar Investimento / Aporte';
    const submitBtn = document.getElementById('btnSubmitInvest');
    if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-check"></i> Salvar Alterações';

    openModal('investment');
}

function deleteInvestment(id) {
    const asset = (appData.investments || []).find(i => i.id === id);
    if (!asset) return;

    if (!confirm(`Deseja realmente remover o ativo "${asset.name}" da sua carteira?`)) {
        return;
    }

    appData.investments = appData.investments.filter(i => i.id !== id);
    saveData(appData);
    navigateTo('investimentos');
    refreshDashboard();
    showToast('Ativo removido da carteira.');
}

function openUpdateInvestmentModal(id) {
    const asset = (appData.investments || []).find(i => i.id === id);
    if (!asset) return;

    const idInput = document.getElementById('updateInvestId');
    const nameInput = document.getElementById('updateInvestName');
    const origInput = document.getElementById('updateInvestOriginal');
    const curInput = document.getElementById('updateInvestCurrent');

    if (idInput) idInput.value = asset.id;
    if (nameInput) nameInput.value = `${asset.name} (${asset.institution || 'Geral'})`;
    if (origInput) origInput.value = formatCurrency(asset.investedAmount || 0);
    if (curInput) curInput.value = asset.currentAmount || asset.investedAmount || 0;

    openModal('update-investment');
}

function saveUpdatedInvestmentValue(e) {
    e.preventDefault();
    const id = document.getElementById('updateInvestId').value;
    const curVal = parseMoneyBR(document.getElementById('updateInvestCurrent').value);

    if (isNaN(curVal) || curVal < 0) {
        showToast('Informe um valor de saldo válido.');
        return;
    }

    const asset = (appData.investments || []).find(i => i.id === id);
    if (!asset) return;

    asset.currentAmount = curVal;
    asset.updatedAt = new Date().toISOString();

    saveData(appData);
    closeModal('update-investment');
    navigateTo('investimentos');
    refreshDashboard();
    showToast(`Saldo de "${asset.name}" atualizado para ${formatCurrency(curVal)}!`);
}

function openAporteExistingAssetModal(id) {
    const asset = (appData.investments || []).find(i => i.id === id);
    if (!asset) return;

    const idInput = document.getElementById('aporteAssetId');
    const nameInput = document.getElementById('aporteAssetName');
    const curInvestedInput = document.getElementById('aporteAssetCurInvested');
    const curMarketInput = document.getElementById('aporteAssetCurMarket');
    const newAmtInput = document.getElementById('aporteNewAmount');
    const newDateInput = document.getElementById('aporteNewDate');

    if (idInput) idInput.value = asset.id;
    if (nameInput) nameInput.value = `${asset.name} (${asset.institution || 'Geral'})`;
    if (curInvestedInput) curInvestedInput.value = formatCurrency(asset.investedAmount || 0);
    if (curMarketInput) curMarketInput.value = formatCurrency(asset.currentAmount || asset.investedAmount || 0);
    if (newAmtInput) {
        newAmtInput.value = '';
        setTimeout(() => newAmtInput.focus(), 150);
    }
    if (newDateInput) newDateInput.value = getTodayStr();

    openModal('aporte-existing');
}

function saveAporteToExistingAsset(e) {
    e.preventDefault();
    const id = document.getElementById('aporteAssetId')?.value;
    const newAmt = parseMoneyBR(document.getElementById('aporteNewAmount')?.value);
    const newDate = document.getElementById('aporteNewDate')?.value || getTodayStr();

    if (isNaN(newAmt) || newAmt <= 0) {
        showToast('Informe um valor de aporte válido maior que zero.');
        return;
    }

    const asset = (appData.investments || []).find(i => i.id === id);
    if (!asset) {
        showToast('Ativo não encontrado.');
        return;
    }

    // Soma diretamente ao valor aplicado original e ao saldo atual
    asset.investedAmount = (asset.investedAmount || 0) + newAmt;
    asset.currentAmount = (asset.currentAmount || 0) + newAmt;
    asset.date = newDate;
    asset.updatedAt = new Date().toISOString();

    saveData(appData);
    closeModal('aporte-existing');
    navigateTo('investimentos');
    refreshDashboard();
    showToast(`🎉 Novo aporte de ${formatCurrency(newAmt)} somado com sucesso a "${asset.name}"!`);
}

function resetInvestments() {
    const total = (appData.investments || []).length;
    if (total === 0) {
        showToast('Sua carteira de investimentos já está zerada!');
        return;
    }

    const confirmed = confirm(
        `Atenção: Deseja realmente ZERAR todos os ${total} ativos da sua carteira de investimentos?\n\n` +
        `Isso removerá os dados de teste para que você possa cadastrar apenas os seus investimentos reais do zero.\n\n` +
        `Esta ação não pode ser desfeita!`
    );

    if (!confirmed) return;

    appData.investments = [];
    saveData(appData);
    navigateTo('investimentos');
    refreshDashboard();
    showToast('Carteira de investimentos zerada com sucesso! Agora você pode cadastrar seus valores reais.');
}

function filterInvestCategory(cat) {
    currentInvestFilter = cat;
    const buttons = document.querySelectorAll('#investCategoryFilters .invest-chip');
    buttons.forEach(btn => {
        const onclickAttr = btn.getAttribute('onclick') || '';
        if (cat === 'all') {
            btn.classList.toggle('active', onclickAttr.includes("'all'"));
        } else {
            btn.classList.toggle('active', onclickAttr.includes(`'${cat}'`));
        }
    });
    renderInvestmentsList();
}

function setInvestSimYears(years) {
    investSimYears = years;
    document.querySelectorAll('.invest-time-pills .invest-pill').forEach(btn => {
        const y = parseInt(btn.getAttribute('data-years'), 10);
        btn.classList.toggle('active', y === years);
    });
    calculateInvestSimulation();
}

function calculateInvestSimulation() {
    const monthlyInput = document.getElementById('investSimMonthly');
    const rateInput = document.getElementById('investSimRate');
    if (!monthlyInput || !rateInput) return;

    const monthlyContribution = Math.max(0, parseFloat(monthlyInput.value) || 0);
    const annualRate = Math.max(0, parseFloat(rateInput.value) || 0) / 100;
    const months = investSimYears * 12;

    const monthlyRate = annualRate > 0 ? Math.pow(1 + annualRate, 1 / 12) - 1 : 0;
    const initialCapital = (appData.investments || []).reduce((acc, a) => acc + (a.currentAmount || 0), 0);

    const fvInitial = initialCapital * Math.pow(1 + monthlyRate, months);
    let fvContributions = 0;
    if (monthlyRate > 0) {
        fvContributions = monthlyContribution * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
    } else {
        fvContributions = monthlyContribution * months;
    }

    const totalAccumulated = fvInitial + fvContributions;
    const totalInvestedOutOfPocket = initialCapital + (monthlyContribution * months);
    const totalInterest = Math.max(0, totalAccumulated - totalInvestedOutOfPocket);

    const invEl = document.getElementById('investSimTotalInvested');
    const intEl = document.getElementById('investSimTotalInterest');
    const balEl = document.getElementById('investSimFinalBalance');

    if (invEl) invEl.textContent = formatCurrency(totalInvestedOutOfPocket);
    if (intEl) intEl.textContent = `+${formatCurrency(totalInterest)}`;
    if (balEl) balEl.textContent = formatCurrency(totalAccumulated);
}

// ====================================================
// MOTOR DE RENDIMENTOS & GESTÃO DA CARTEIRA
// ====================================================
let currentYieldSimDays = 30;

function getAssetAnnualYieldRate(asset) {
    const yieldStr = (asset.expectedYield || '').toLowerCase().trim();
    if (!yieldStr) {
        if (asset.category === 'Renda Fixa' || asset.category === 'Tesouro Direto') return 0.105;
        if (asset.category === 'Fundos Imobiliários (FIIs)') return 0.10; // ~0.8% a.m. dividendos
        if (asset.category === 'Ações') return 0.08;
        if (asset.category === 'Fundos de Investimento') return 0.09;
        return 0.10;
    }

    const amMatch = yieldStr.match(/([\d.,]+)\s*%\s*(a\.?m\.?|ao m[eê]s)/i);
    if (amMatch) {
        const monthlyRate = parseFloat(amMatch[1].replace(',', '.')) / 100;
        return Math.pow(1 + monthlyRate, 12) - 1;
    }

    if (yieldStr.includes('cdi')) {
        const cdiMatch = yieldStr.match(/([\d.,]+)\s*%/);
        const cdiFactor = cdiMatch ? parseFloat(cdiMatch[1].replace(',', '.')) / 100 : 1.0;
        return 0.105 * cdiFactor;
    }

    const aaMatch = yieldStr.match(/([\d.,]+)\s*%\s*(a\.?a\.?|ao ano)/i);
    if (aaMatch) {
        return parseFloat(aaMatch[1].replace(',', '.')) / 100;
    }

    const plainMatch = yieldStr.match(/([\d.,]+)\s*%/);
    if (plainMatch) {
        const val = parseFloat(plainMatch[1].replace(',', '.')) / 100;
        return val < 0.05 ? Math.pow(1 + val, 12) - 1 : val;
    }

    if (asset.category === 'Renda Fixa' || asset.category === 'Tesouro Direto') return 0.105;
    if (asset.category === 'Fundos Imobiliários (FIIs)') return 0.10;
    if (asset.category === 'Ações') return 0.08;
    return 0.10;
}

function calculateAccruedYield(asset) {
    const invested = Number(asset.investedAmount) || 0;
    const current = Number(asset.currentAmount) || invested;
    if (invested <= 0) return current;

    // Base date: data da última atualização de rendimentos se houver, senão data de aporte
    const baseDateStr = asset.lastYieldUpdate || asset.date;
    if (!baseDateStr) return current;

    const startDate = new Date(baseDateStr + 'T00:00:00');
    const today = new Date();
    const diffTime = today.getTime() - startDate.getTime();
    const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
    if (diffDays <= 0) return current;

    const annualRate = getAssetAnnualYieldRate(asset);
    if (annualRate <= 0) return current;

    // Juros compostos diários sobre o saldo atual
    const accrued = current * Math.pow(1 + annualRate, diffDays / 365);
    const calculatedAmount = Math.round(accrued * 100) / 100;

    return Math.max(current, calculatedAmount);
}

function autoUpdateInvestmentsYield(notify = false) {
    if (!Array.isArray(appData.investments) || appData.investments.length === 0) {
        if (notify) showToast('Nenhum investimento para atualizar.');
        return;
    }

    let updatedCount = 0;
    let totalInterestAccrued = 0;

    appData.investments.forEach(asset => {
        const current = Number(asset.currentAmount) || Number(asset.investedAmount) || 0;
        const newCalculated = calculateAccruedYield(asset);

        if (newCalculated > current) {
            const diff = newCalculated - current;
            totalInterestAccrued += diff;
            asset.currentAmount = newCalculated;
            asset.lastYieldUpdate = getTodayStr();
            updatedCount++;
        }
    });

    if (updatedCount > 0) {
        saveData(appData);
    }

    if (notify) {
        if (updatedCount > 0) {
            showToast(`⚡ ${updatedCount} ativo(s) sincronizado(s)! Rendimento acumulado: +${formatCurrency(totalInterestAccrued)}.`);
        } else {
            showToast('⚡ Os rendimentos por calendário já estão 100% atualizados até a data de hoje!');
        }
    }
}

function openYieldsModal() {
    openModal('update-yields');
    renderYieldsModalContent();
}

function triggerManualYieldUpdate() {
    openYieldsModal();
}

function selectYieldCustomDays(days) {
    currentYieldSimDays = days;
    const modalEl = document.getElementById('modal-update-yields');
    if (modalEl) {
        modalEl.querySelectorAll('[data-yield-days]').forEach(btn => {
            const d = parseInt(btn.getAttribute('data-yield-days'), 10);
            btn.classList.toggle('active', d === days);
        });
    }
    updateYieldSimulationFeedback();
}

function updateYieldSimulationFeedback() {
    const assets = Array.isArray(appData.investments) ? appData.investments : [];
    let totalPeriodYield = 0;

    assets.forEach(a => {
        const current = Number(a.currentAmount) || Number(a.investedAmount) || 0;
        if (current > 0) {
            const annualRate = getAssetAnnualYieldRate(a);
            const periodInterest = current * (Math.pow(1 + annualRate, currentYieldSimDays / 365) - 1);
            totalPeriodYield += Math.max(0, periodInterest);
        }
    });

    const feedbackEl = document.getElementById('yieldSimSelectedFeedback');
    if (feedbackEl) {
        feedbackEl.innerHTML = `Rendimento projetado (${currentYieldSimDays} dias): <strong class="text-green">+${formatCurrency(totalPeriodYield)}</strong>`;
    }
}

function renderYieldsModalContent() {
    const assets = Array.isArray(appData.investments) ? appData.investments : [];

    let totalInvested = 0;
    let totalCurrent = 0;
    let totalMonthlyPassive = 0;

    assets.forEach(a => {
        const inv = Number(a.investedAmount) || 0;
        const cur = Number(a.currentAmount) || inv;
        totalInvested += inv;
        totalCurrent += cur;
        totalMonthlyPassive += estimateAssetMonthlyPassive(a);
    });

    const totalProfit = totalCurrent - totalInvested;
    const totalProfitPct = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

    const investedEl = document.getElementById('yieldModalTotalInvested');
    const currentEl = document.getElementById('yieldModalTotalCurrent');
    const profitEl = document.getElementById('yieldModalTotalProfit');
    const passiveEl = document.getElementById('yieldModalTotalPassive');
    const quickMonthTotalEl = document.getElementById('yieldQuickMonthTotal');
    const countBadgeEl = document.getElementById('yieldModalAssetCountBadge');

    if (investedEl) investedEl.textContent = formatCurrency(totalInvested);
    if (currentEl) currentEl.textContent = formatCurrency(totalCurrent);
    if (profitEl) {
        const sign = totalProfit >= 0 ? '+' : '';
        profitEl.textContent = `${sign}${formatCurrency(totalProfit)} (${sign}${totalProfitPct.toFixed(1)}%)`;
        profitEl.className = totalProfit >= 0 ? 'text-green' : 'text-danger';
    }
    if (passiveEl) passiveEl.textContent = `+${formatCurrency(totalMonthlyPassive)}/mês`;
    if (quickMonthTotalEl) quickMonthTotalEl.textContent = formatCurrency(totalMonthlyPassive);
    if (countBadgeEl) countBadgeEl.textContent = `${assets.length} ${assets.length === 1 ? 'ativo' : 'ativos'}`;

    updateYieldSimulationFeedback();

    const listEl = document.getElementById('yieldModalAssetsList');
    if (!listEl) return;

    if (assets.length === 0) {
        listEl.innerHTML = `
            <div style="text-align:center;padding:26px 16px;color:var(--text-secondary);">
                <i class="fas fa-coins" style="font-size:2.2rem;margin-bottom:10px;opacity:0.4;display:block;"></i>
                <h4 style="margin-bottom:6px;color:var(--text-primary);">Nenhum investimento cadastrado</h4>
                <p style="font-size:0.85rem;max-width:380px;margin:0 auto 16px;">Cadastre seus ativos para começar a calcular e creditar rendimentos.</p>
                <button type="button" class="btn btn-sm btn-primary" onclick="closeModal('update-yields'); openModal('investment');">
                    <i class="fas fa-plus"></i> Novo Ativo
                </button>
            </div>
        `;
        return;
    }

    listEl.innerHTML = assets.map(asset => {
        const invested = Number(asset.investedAmount) || 0;
        const current = Number(asset.currentAmount) || invested;
        const profit = current - invested;
        const profitPct = invested > 0 ? (profit / invested) * 100 : 0;
        const estMonthly = estimateAssetMonthlyPassive(asset);
        const catColor = investmentCategoryColors[asset.category] || '#64748b';
        const catIcon = investmentCategoryIcons[asset.category] || 'fa-wallet';

        return `
            <div class="card" style="padding:14px;background:var(--bg);border:1px solid var(--border);border-radius:10px;margin-bottom:0;">
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        <span style="font-weight:700;font-size:0.95rem;color:var(--text-primary);">${escapeHtml(asset.name)}</span>
                        <span class="badge-installments" style="font-size:0.75rem;">
                            <i class="fas fa-building-columns"></i> ${escapeHtml(asset.institution || 'Geral')}
                        </span>
                        <span class="badge-status" style="font-size:0.75rem;background:${catColor}18;color:${catColor};border:1px solid ${catColor}30;">
                            <i class="fas ${catIcon}"></i> ${escapeHtml(asset.category || 'Ativo')}
                        </span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        <button type="button" class="btn btn-xs btn-success" onclick="applyMonthlyYieldToSingleAsset('${asset.id}')" title="Creditar 1 mês de rendimento neste ativo">
                            <i class="fas fa-bolt"></i> + 1 Mês (+${formatCurrency(estMonthly)})
                        </button>
                        <button type="button" class="btn btn-xs btn-outline" onclick="promptCreditCustomYield('${asset.id}')" title="Creditar valor avulso em reais (ex: proventos, dividendos)">
                            <i class="fas fa-hand-holding-dollar"></i> Dividendo Avulso
                        </button>
                        <button type="button" class="btn btn-xs btn-outline" onclick="closeModal('update-yields'); openUpdateInvestmentModal('${asset.id}');" title="Editar o saldo total de mercado">
                            <i class="fas fa-pen"></i> Saldo
                        </button>
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(110px, 1fr));gap:8px;background:var(--bg-card);padding:10px 12px;border-radius:8px;border:1px solid var(--border);">
                    <div>
                        <span style="font-size:0.72rem;color:var(--text-secondary);display:block;">Valor Aplicado</span>
                        <strong style="font-size:0.85rem;color:var(--text-primary);">${formatCurrency(invested)}</strong>
                    </div>
                    <div>
                        <span style="font-size:0.72rem;color:var(--text-secondary);display:block;">Saldo Atual</span>
                        <strong style="font-size:0.9rem;color:var(--cor-accent);">${formatCurrency(current)}</strong>
                    </div>
                    <div>
                        <span style="font-size:0.72rem;color:var(--text-secondary);display:block;">Rentabilidade</span>
                        <strong style="font-size:0.85rem;color:var(--text-primary);">${escapeHtml(asset.expectedYield || 'Padrão')}</strong>
                    </div>
                    <div>
                        <span style="font-size:0.72rem;color:var(--text-secondary);display:block;">Rendimento Mensal</span>
                        <strong style="font-size:0.85rem;color:#10b981;">+${formatCurrency(estMonthly)}</strong>
                    </div>
                    <div>
                        <span style="font-size:0.72rem;color:var(--text-secondary);display:block;">Lucro Acumulado</span>
                        <strong style="font-size:0.85rem;color:${profit >= 0 ? '#10b981' : '#ef4444'};">
                            ${profit >= 0 ? '+' : ''}${formatCurrency(profit)} (${profit >= 0 ? '+' : ''}${profitPct.toFixed(1)}%)
                        </strong>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function applyMonthlyYieldToAll() {
    const assets = Array.isArray(appData.investments) ? appData.investments : [];
    if (assets.length === 0) {
        showToast('Nenhum investimento cadastrado.');
        return;
    }

    let totalCredited = 0;
    let count = 0;

    assets.forEach(asset => {
        const estMonthly = estimateAssetMonthlyPassive(asset);
        if (estMonthly > 0) {
            const cur = Number(asset.currentAmount) || Number(asset.investedAmount) || 0;
            asset.currentAmount = Math.round((cur + estMonthly) * 100) / 100;
            asset.lastYieldUpdate = getTodayStr();
            totalCredited += estMonthly;
            count++;
        }
    });

    if (count === 0) {
        showToast('Nenhum ativo possui rentabilidade configurada.');
        return;
    }

    saveData(appData);
    refreshInvestmentsPage();
    refreshDashboard();
    renderYieldsModalContent();
    showToast(`⚡ Rendimento mensal creditado com sucesso! +${formatCurrency(totalCredited)} em ${count} ativo(s).`);
}

function applyMonthlyYieldToSingleAsset(assetId) {
    const assets = Array.isArray(appData.investments) ? appData.investments : [];
    const asset = assets.find(a => a.id === assetId);
    if (!asset) return;

    const estMonthly = estimateAssetMonthlyPassive(asset);
    if (estMonthly <= 0) {
        showToast(`Defina uma taxa de rentabilidade (ex: 100% CDI ou 1% a.m.) para "${asset.name}".`);
        return;
    }

    const cur = Number(asset.currentAmount) || Number(asset.investedAmount) || 0;
    asset.currentAmount = Math.round((cur + estMonthly) * 100) / 100;
    asset.lastYieldUpdate = getTodayStr();

    saveData(appData);
    refreshInvestmentsPage();
    refreshDashboard();
    renderYieldsModalContent();
    showToast(`⚡ Rendimento mensal de +${formatCurrency(estMonthly)} creditado em "${asset.name}"!`);
}

function applyCustomPeriodYieldToAll() {
    const assets = Array.isArray(appData.investments) ? appData.investments : [];
    if (assets.length === 0) {
        showToast('Nenhum investimento cadastrado.');
        return;
    }

    let totalCredited = 0;
    let count = 0;

    assets.forEach(asset => {
        const cur = Number(asset.currentAmount) || Number(asset.investedAmount) || 0;
        if (cur > 0) {
            const annualRate = getAssetAnnualYieldRate(asset);
            const periodInterest = cur * (Math.pow(1 + annualRate, currentYieldSimDays / 365) - 1);
            if (periodInterest > 0) {
                asset.currentAmount = Math.round((cur + periodInterest) * 100) / 100;
                asset.lastYieldUpdate = getTodayStr();
                totalCredited += periodInterest;
                count++;
            }
        }
    });

    if (count === 0) {
        showToast('Nenhum ativo para creditar rendimento.');
        return;
    }

    saveData(appData);
    refreshInvestmentsPage();
    refreshDashboard();
    renderYieldsModalContent();
    showToast(`⚡ Rendimento de ${currentYieldSimDays} dias creditado! +${formatCurrency(totalCredited)} em ${count} ativo(s).`);
}

function applyAccruedCalendarDaysYield() {
    const assets = Array.isArray(appData.investments) ? appData.investments : [];
    if (assets.length === 0) {
        showToast('Nenhum investimento cadastrado.');
        return;
    }

    let updatedCount = 0;
    let totalInterestAccrued = 0;

    assets.forEach(asset => {
        const current = Number(asset.currentAmount) || Number(asset.investedAmount) || 0;
        const newCalculated = calculateAccruedYield(asset);

        if (newCalculated > current) {
            const diff = newCalculated - current;
            totalInterestAccrued += diff;
            asset.currentAmount = newCalculated;
            asset.lastYieldUpdate = getTodayStr();
            updatedCount++;
        }
    });

    if (updatedCount > 0) {
        saveData(appData);
        refreshInvestmentsPage();
        refreshDashboard();
        renderYieldsModalContent();
        showToast(`⚡ ${updatedCount} ativo(s) sincronizado(s)! Rendimento acumulado: +${formatCurrency(totalInterestAccrued)}.`);
    } else {
        showToast('ℹ️ Os ativos cadastrados hoje ainda não têm dias corridos de calendário. Utilize o botão "Creditar 1 Mês" para antecipar o rendimento mensal!');
    }
}

function promptCreditCustomYield(assetId) {
    const assets = Array.isArray(appData.investments) ? appData.investments : [];
    const asset = assets.find(a => a.id === assetId);
    if (!asset) return;

    const input = prompt(`Informe o valor em reais (R$) de rendimento ou dividendo recebido para "${asset.name}":`, '10,00');
    if (!input) return;

    const val = parseMoneyBR(input);
    if (isNaN(val) || val <= 0) {
        showToast('Informe um valor de rendimento válido.');
        return;
    }

    const cur = Number(asset.currentAmount) || Number(asset.investedAmount) || 0;
    asset.currentAmount = Math.round((cur + val) * 100) / 100;
    asset.lastYieldUpdate = getTodayStr();

    saveData(appData);
    refreshInvestmentsPage();
    refreshDashboard();
    renderYieldsModalContent();
    showToast(`💰 Rendimento de ${formatCurrency(val)} creditado com sucesso em "${asset.name}"!`);
}

function estimateAssetMonthlyPassive(asset) {
    const amt = asset.currentAmount || asset.investedAmount || 0;
    if (amt <= 0) return 0;
    const yieldStr = (asset.expectedYield || '').toLowerCase().trim();

    const amMatch = yieldStr.match(/([\d.,]+)\s*%\s*(a\.?m\.?|ao m[eê]s)/i);
    if (amMatch) {
        const rate = parseFloat(amMatch[1].replace(',', '.')) / 100;
        return amt * rate;
    }

    if (yieldStr.includes('cdi')) {
        const cdiMatch = yieldStr.match(/([\d.,]+)\s*%/);
        const cdiFactor = cdiMatch ? parseFloat(cdiMatch[1].replace(',', '.')) / 100 : 1.0;
        const annualRate = 0.105 * cdiFactor;
        return amt * (annualRate / 12);
    }

    const aaMatch = yieldStr.match(/([\d.,]+)\s*%\s*(a\.?a\.?|ao ano)/i);
    if (aaMatch) {
        const rate = parseFloat(aaMatch[1].replace(',', '.')) / 100;
        return amt * (rate / 12);
    }

    const plainMatch = yieldStr.match(/([\d.,]+)\s*%/);
    if (plainMatch) {
        const rate = parseFloat(plainMatch[1].replace(',', '.')) / 100;
        return amt * (rate / 12);
    }

    if (asset.category === 'Fundos Imobiliários (FIIs)') return amt * 0.008;
    if (asset.category === 'Renda Fixa' || asset.category === 'Tesouro Direto') return amt * (0.105 / 12);
    if (asset.category === 'Ações') return amt * (0.06 / 12);
    if (asset.category === 'Fundos de Investimento') return amt * (0.09 / 12);

    return 0;
}

function renderInvestmentsList() {
    const grid = document.getElementById('investAssetsGrid');
    if (!grid) return;

    const assets = appData.investments || [];
    const filtered = currentInvestFilter === 'all' 
        ? assets 
        : assets.filter(a => a.category === currentInvestFilter);

    const countBadge = document.getElementById('investTotalAssetsBadge');
    if (countBadge) {
        countBadge.textContent = `${filtered.length} ${filtered.length === 1 ? 'ativo' : 'ativos'}`;
    }

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="invest-empty-state">
                <div class="empty-icon"><i class="fas fa-coins"></i></div>
                <h4>${assets.length === 0 ? 'Nenhum investimento cadastrado ainda' : 'Nenhum ativo nesta categoria'}</h4>
                <p>${assets.length === 0 ? 'Comece registrando seus CDBs, Tesouro Direto, Ações, FIIs ou Criptomoedas para acompanhar a evolução do seu patrimônio.' : 'Cadastre novos ativos ou selecione a aba "Todos" para visualizar sua carteira.'}</p>
                <button class="btn btn-primary" onclick="openModal('investment')">
                    <i class="fas fa-plus"></i> Adicionar Investimento
                </button>
            </div>
        `;
        return;
    }

    grid.innerHTML = filtered.map(asset => {
        const invested = asset.investedAmount || 0;
        const current = asset.currentAmount || invested;
        const profit = current - invested;
        const profitPct = invested > 0 ? (profit / invested) * 100 : 0;
        const isProfitable = profit >= 0;
        const categoryColor = investmentCategoryColors[asset.category] || '#64748b';
        const categoryIcon = investmentCategoryIcons[asset.category] || 'fa-wallet';
        const estMonthly = estimateAssetMonthlyPassive(asset);

        return `
            <div class="invest-asset-card">
                <div class="asset-card-header">
                    <div class="asset-cat-tag" style="background:${categoryColor}18; color:${categoryColor}; border:1px solid ${categoryColor}35;">
                        <i class="fas ${categoryIcon}"></i> ${escapeHtml(asset.category || 'Ativo')}
                    </div>
                    <span class="asset-institution-badge">
                        <i class="fas fa-building-columns"></i> ${escapeHtml(asset.institution || 'Geral')}
                    </span>
                </div>

                <div class="asset-card-main">
                    <h4 class="asset-name" title="${escapeHtml(asset.name)}">${escapeHtml(asset.name)}</h4>
                    
                    <div class="asset-values-grid">
                        <div class="asset-val-block">
                            <span class="val-label">Saldo Atual</span>
                            <strong class="val-number card-value text-primary">${formatCurrency(current)}</strong>
                        </div>
                        <div class="asset-val-block">
                            <span class="val-label">Valor Aplicado</span>
                            <span class="val-number card-value">${formatCurrency(invested)}</span>
                        </div>
                    </div>

                    <div class="asset-profit-row">
                        <span class="asset-profit-pill ${isProfitable ? 'positive' : 'negative'}">
                            <i class="fas ${isProfitable ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}"></i>
                            ${isProfitable ? '+' : ''}${formatCurrency(profit)} (${isProfitable ? '+' : ''}${profitPct.toFixed(1)}%)
                        </span>
                        ${estMonthly > 0 ? `
                            <span class="asset-passive-pill" title="Projeção de proventos/rendimentos mensais">
                                <i class="fas fa-seedling"></i> ~${formatCurrency(estMonthly)}/mês
                            </span>
                        ` : ''}
                    </div>

                    <div class="asset-meta-tags">
                        ${asset.expectedYield ? `
                            <span class="asset-meta-item" title="Rentabilidade">
                                <i class="fas fa-percent"></i> ${escapeHtml(asset.expectedYield)}
                            </span>
                        ` : ''}
                        ${asset.maturityDate ? `
                            <span class="asset-meta-item" title="Vencimento / Liquidez">
                                <i class="fas fa-calendar-day"></i> ${escapeHtml(asset.maturityDate)}
                            </span>
                        ` : ''}
                        ${asset.date ? `
                            <span class="asset-meta-item" title="Data do Aporte">
                                <i class="fas fa-clock-rotate-left"></i> ${formatDate(asset.date)}
                            </span>
                        ` : ''}
                    </div>
                </div>

                <div class="asset-card-actions">
                    <button class="btn btn-sm btn-outline text-success" style="border-color:rgba(16,185,129,0.35);" onclick="applyMonthlyYieldToSingleAsset('${asset.id}')" title="Creditar 1 mês de rendimento neste ativo (+${formatCurrency(estMonthly)})">
                        <i class="fas fa-bolt"></i> + Rendimento
                    </button>
                    <button class="btn btn-sm btn-primary" onclick="openAporteExistingAssetModal('${asset.id}')" title="Fazer novo aporte neste mesmo ativo sem criar duplicatas">
                        <i class="fas fa-plus"></i> Aportar
                    </button>
                    <button class="btn btn-sm btn-outline" onclick="openUpdateInvestmentModal('${asset.id}')" title="Atualizar saldo atual de mercado deste ativo">
                        <i class="fas fa-arrows-rotate"></i> Saldo
                    </button>
                    <button class="btn btn-sm btn-outline" onclick="editInvestment('${asset.id}')" title="Editar todos os dados do ativo">
                        <i class="fas fa-pen"></i> Editar
                    </button>
                    <button class="btn btn-sm btn-danger-soft" onclick="deleteInvestment('${asset.id}')" title="Excluir ativo">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function renderInvestmentAllocationChart() {
    const canvas = document.getElementById('investDoughnutChart');
    if (!canvas) return;

    const pane = document.getElementById('tabPane-pat-investimentos');
    if (pane && !pane.classList.contains('active')) return;

    const assets = appData.investments || [];
    const legendEl = document.getElementById('investAllocationLegend');
    const profileBadge = document.getElementById('investProfileBadge');

    const catMap = {};
    let totalPortfolio = 0;
    assets.forEach(a => {
        const cat = a.category || 'Outros';
        const val = a.currentAmount || a.investedAmount || 0;
        catMap[cat] = (catMap[cat] || 0) + val;
        totalPortfolio += val;
    });

    const labels = Object.keys(catMap);
    const dataValues = labels.map(c => catMap[c]);
    const bgColors = labels.map(c => investmentCategoryColors[c] || '#64748b');

    // Determine Risk Profile
    if (profileBadge) {
        if (totalPortfolio <= 0) {
            profileBadge.textContent = 'Perfil: Não definido';
            profileBadge.className = 'badge-installments';
            profileBadge.removeAttribute('style');
        } else {
            const fixedIncome = (catMap['Renda Fixa'] || 0) + (catMap['Tesouro Direto'] || 0);
            const variableIncome = (catMap['Ações'] || 0) + (catMap['Criptomoedas'] || 0) + (catMap['Fundos Imobiliários (FIIs)'] || 0);
            const fixedPct = (fixedIncome / totalPortfolio) * 100;
            const variablePct = (variableIncome / totalPortfolio) * 100;

            if (fixedPct >= 70) {
                profileBadge.textContent = 'Perfil: Conservador 🛡️';
                profileBadge.className = 'badge-installments badge-status ok';
                profileBadge.removeAttribute('style');
            } else if (variablePct >= 50 || ((catMap['Criptomoedas'] || 0) / totalPortfolio) >= 0.20) {
                profileBadge.textContent = 'Perfil: Arrojado 🚀';
                profileBadge.className = 'badge-installments';
                profileBadge.style.background = 'rgba(239, 68, 68, 0.15)';
                profileBadge.style.color = '#ef4444';
            } else {
                profileBadge.textContent = 'Perfil: Moderado / Equilibrado ⚖️';
                profileBadge.className = 'badge-installments';
                profileBadge.style.background = 'rgba(59, 130, 246, 0.15)';
                profileBadge.style.color = '#3b82f6';
            }
        }
    }

    // Legend HTML
    if (legendEl) {
        if (labels.length === 0 || totalPortfolio <= 0) {
            legendEl.innerHTML = '<div style="color:var(--text-secondary);font-size:0.85rem;text-align:center;padding:16px;">Sem dados de investimentos para exibir no gráfico.</div>';
        } else {
            legendEl.innerHTML = labels.map((cat, idx) => {
                const val = dataValues[idx];
                const pct = totalPortfolio > 0 ? ((val / totalPortfolio) * 100).toFixed(1) : 0;
                const col = bgColors[idx];
                return `
                    <div class="invest-legend-item">
                        <div class="legend-color-dot" style="background:${col};"></div>
                        <span class="legend-label">${escapeHtml(cat)}</span>
                        <strong class="legend-val card-value">${formatCurrency(val)}</strong>
                        <span class="legend-pct">${pct}%</span>
                    </div>
                `;
            }).join('');
        }
    }

    // Chart.js instance management
    if (investDoughnutChartInstance) {
        investDoughnutChartInstance.destroy();
        investDoughnutChartInstance = null;
    }

    const isDark = document.body.classList.contains('dark');

    if (labels.length === 0 || totalPortfolio <= 0) {
        const ctx = canvas.getContext('2d');
        investDoughnutChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Nenhum ativo cadastrado'],
                datasets: [{
                    data: [1],
                    backgroundColor: [isDark ? '#1f1f24' : '#e2e8f0'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '72%',
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });
        return;
    }

    const ctx = canvas.getContext('2d');
    investDoughnutChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: dataValues,
                backgroundColor: bgColors,
                borderWidth: 2,
                borderColor: isDark ? '#000000' : '#ffffff',
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '76%',
            plugins: {
                legend: { display: false },
                tooltip: getExecutiveTooltipConfig({
                    label: function(context) {
                        const val = context.raw || 0;
                        const pct = totalPortfolio > 0 ? ((val / totalPortfolio) * 100).toFixed(1) : 0;
                        return ` ${context.label}: ${formatCurrency(val)} (${pct}%)`;
                    }
                })
            }
        }
    });
}

function updatePatrimonioConsolidatedBanner() {
    const assets = Array.isArray(appData.investments) ? appData.investments : [];
    const savings = appData.savingsBalance || 0;

    let totalInvested = 0;
    let totalCurrent = 0;
    assets.forEach(a => {
        const inv = a.investedAmount || 0;
        const cur = a.currentAmount || inv;
        totalInvested += inv;
        totalCurrent += cur;
    });

    const netWorth = savings + totalCurrent;
    const profit = totalCurrent - totalInvested;
    const profitPct = totalInvested > 0 ? (profit / totalInvested) * 100 : 0;

    // Banner Superior Consolidado de Patrimônio (Sempre Visível)
    const totalBigEl = document.getElementById('patrimonioTotalBig');
    if (totalBigEl) totalBigEl.textContent = formatCurrency(netWorth);

    const invValEl = document.getElementById('patrimonioInvestedVal');
    if (invValEl) invValEl.textContent = formatCurrency(totalInvested);

    const invSubEl = document.getElementById('patrimonioInvestedSub');
    if (invSubEl) {
        invSubEl.textContent = `${assets.length} ${assets.length === 1 ? 'ativo' : 'ativos'} na carteira (Saldo: ${formatCurrency(totalCurrent)})`;
    }

    const savValEl = document.getElementById('patrimonioSavingsVal');
    if (savValEl) savValEl.textContent = formatCurrency(savings);

    const profitValEl = document.getElementById('patrimonioProfitVal');
    if (profitValEl) {
        const sign = profit >= 0 ? '+' : '';
        profitValEl.textContent = `${sign}${formatCurrency(profit)} (${sign}${profitPct.toFixed(1)}%)`;
        profitValEl.className = `card-value ${profit >= 0 ? 'text-green' : 'text-danger'}`;
    }

    // Sidebar
    const sideNet = document.getElementById('sidebarNetWorth');
    if (sideNet) sideNet.textContent = formatCurrency(netWorth);
    const sideSav = document.getElementById('sidebarSavings');
    if (sideSav) sideSav.textContent = formatCurrency(savings);

    // Dashboard Total Investido Card
    const dashInvestEl = document.getElementById('totalInvested');
    if (dashInvestEl) dashInvestEl.textContent = formatCurrency(totalInvested);
}

function renderInvestBarChart() {
    const canvas = document.getElementById('investBarChart');
    if (!canvas) return;

    // Se a aba de investimentos NÃO está ativa, não instanciar agora para não quebrar dimensões 0x0
    const pane = document.getElementById('tabPane-pat-investimentos');
    if (pane && !pane.classList.contains('active')) {
        return;
    }

    const emptyMsg = document.getElementById('investBarChartEmpty');
    const totalBadge = document.getElementById('investChartTotalBadge');
    const assets = Array.isArray(appData.investments) ? appData.investments : [];

    if (investBarChartInstance) {
        investBarChartInstance.destroy();
        investBarChartInstance = null;
    }

    // Sem investimentos: mostrar empty state e esconder canvas
    if (assets.length === 0) {
        canvas.style.display = 'none';
        if (emptyMsg) emptyMsg.style.display = 'flex';
        if (totalBadge) {
            totalBadge.innerHTML = '<i class="fas fa-coins"></i> Sem ativos';
            totalBadge.className = 'badge-status';
        }
        return;
    }

    // Com investimentos: mostrar canvas e esconder empty state
    canvas.style.display = 'block';
    if (emptyMsg) emptyMsg.style.display = 'none';

    const ctx = canvas.getContext('2d');
    const labels = assets.map(a => a.name);
    const investedData = assets.map(a => Number(a.investedAmount) || 0);
    const currentData = assets.map(a => Number(a.currentAmount) || Number(a.investedAmount) || 0);

    // Totais para o badge de desempenho
    const totalInvested = investedData.reduce((s, v) => s + v, 0);
    const totalCurrent = currentData.reduce((s, v) => s + v, 0);
    const totalProfit = totalCurrent - totalInvested;
    const profitPct = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
    const sign = totalProfit >= 0 ? '+' : '';

    if (totalBadge) {
        totalBadge.innerHTML = `<i class="fas fa-${totalProfit >= 0 ? 'arrow-trend-up' : 'arrow-trend-down'}"></i> Lucro: ${sign}${formatCurrency(totalProfit)} (${sign}${profitPct.toFixed(1)}%)`;
        totalBadge.className = `badge-status ${totalProfit >= 0 ? 'ok' : 'danger'}`;
    }

    // Gradientes verticais executivos
    const gradInvested = ctx.createLinearGradient(0, 0, 0, 320);
    gradInvested.addColorStop(0, '#3b82f6');
    gradInvested.addColorStop(1, '#93c5fd');

    const gradProfit = ctx.createLinearGradient(0, 0, 0, 320);
    gradProfit.addColorStop(0, '#10b981');
    gradProfit.addColorStop(1, '#6ee7b7');

    const gradLoss = ctx.createLinearGradient(0, 0, 0, 320);
    gradLoss.addColorStop(0, '#ef4444');
    gradLoss.addColorStop(1, '#fca5a5');

    investBarChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Valor Aplicado (Custo Original)',
                    data: investedData,
                    backgroundColor: gradInvested,
                    hoverBackgroundColor: '#1d4ed8',
                    borderRadius: 8,
                    barPercentage: 0.6,
                    categoryPercentage: 0.75
                },
                {
                    label: 'Saldo Atual (Mercado)',
                    data: currentData,
                    backgroundColor: currentData.map((cur, i) => cur >= investedData[i] ? gradProfit : gradLoss),
                    hoverBackgroundColor: currentData.map((cur, i) => cur >= investedData[i] ? '#059669' : '#dc2626'),
                    borderRadius: 8,
                    barPercentage: 0.6,
                    categoryPercentage: 0.75
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 16,
                        font: { family: 'Inter', size: 12, weight: '600' },
                        color: getChartTextColor()
                    }
                },
                tooltip: getExecutiveTooltipConfig({
                    label: function(context) {
                        return ` ${context.dataset.label}: ${formatCurrency(context.raw || 0)}`;
                    },
                    afterBody: function(tooltipItems) {
                        if (tooltipItems.length >= 2) {
                            const inv = tooltipItems[0].raw || 0;
                            const cur = tooltipItems[1].raw || 0;
                            const diff = cur - inv;
                            const pct = inv > 0 ? (diff / inv) * 100 : 0;
                            const s = diff >= 0 ? '+' : '';
                            return `\nRentabilidade: ${s}${formatCurrency(diff)} (${s}${pct.toFixed(1)}%)`;
                        }
                        return '';
                    }
                })
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: v => formatCurrency(v),
                        font: { family: 'Inter', size: 11 },
                        color: getChartTextColor()
                    },
                    grid: {
                        color: getChartGridColor(),
                        borderDash: [4, 4]
                    },
                    border: { display: false }
                },
                x: {
                    ticks: {
                        font: { family: 'Inter', size: 11, weight: '500' },
                        color: getChartTextColor(),
                        maxRotation: 30
                    },
                    grid: { display: false },
                    border: { display: false }
                }
            }
        }
    });
}

function refreshInvestmentsPage() {
    if (!Array.isArray(appData.investments)) appData.investments = [];

    // Recalcular automaticamente rendimento acumulado de juros pelo tempo decorrido
    autoUpdateInvestmentsYield(false);

    const assets = appData.investments;
    let totalInvested = 0;
    let totalCurrent = 0;
    let totalMonthlyPassive = 0;

    assets.forEach(a => {
        const inv = a.investedAmount || 0;
        const cur = a.currentAmount || inv;
        totalInvested += inv;
        totalCurrent += cur;
        totalMonthlyPassive += estimateAssetMonthlyPassive(a);
    });

    const totalProfit = totalCurrent - totalInvested;
    const totalProfitPct = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

    // Top KPIs
    const curEl = document.getElementById('investKpiCurrent');
    if (curEl) curEl.textContent = formatCurrency(totalCurrent);

    const countEl = document.getElementById('investKpiCount');
    if (countEl) countEl.textContent = `${assets.length} ${assets.length === 1 ? 'ativo' : 'ativos'} na carteira`;

    const origEl = document.getElementById('investKpiOriginal');
    if (origEl) origEl.textContent = formatCurrency(totalInvested);

    const yieldEl = document.getElementById('investKpiYield');
    const yieldBadgeEl = document.getElementById('investKpiYieldBadge');
    if (yieldEl) {
        const sign = totalProfit >= 0 ? '+' : '';
        yieldEl.textContent = `${sign}${formatCurrency(totalProfit)} (${sign}${totalProfitPct.toFixed(1)}%)`;
        yieldEl.className = `card-value ${totalProfit >= 0 ? 'text-success' : 'text-danger'}`;
    }
    if (yieldBadgeEl) {
        if (totalProfit > 0) {
            yieldBadgeEl.textContent = '🟢 Lucro acumulado';
            yieldBadgeEl.style.color = '#10b981';
        } else if (totalProfit < 0) {
            yieldBadgeEl.textContent = '🔴 Desvalorização';
            yieldBadgeEl.style.color = '#ef4444';
        } else {
            yieldBadgeEl.textContent = 'Rendimento acumulado';
            yieldBadgeEl.style.color = 'var(--text-secondary)';
        }
    }

    const passEl = document.getElementById('investKpiPassive');
    if (passEl) passEl.textContent = `${formatCurrency(totalMonthlyPassive)} /mês`;

    // Sidebar Net Worth
    const netWorth = (appData.savingsBalance || 0) + totalCurrent;
    const netWorthEl = document.getElementById('sidebarNetWorth');
    if (netWorthEl) netWorthEl.textContent = formatCurrency(netWorth);

    // Sub-components
    renderInvestBarChart();
    renderInvestmentAllocationChart();
    calculateInvestSimulation();
    renderInvestmentsList();
    updatePatrimonioConsolidatedBanner();
}

// ============================================
// RAIO-X DE GASTOS & CONSCIÊNCIA FINANCEIRA
// ============================================
let compSelectedDays = 5;

function getDaysRemainingInCycle() {
    const now = new Date();
    const todayDay = now.getDate();
    const payDay = (appData.salary && appData.salary.payDay) ? parseInt(appData.salary.payDay, 10) : 0;
    const lastDayThisMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    if (payDay > 0) {
        if (todayDay < payDay) {
            return Math.max(1, payDay - todayDay);
        } else if (todayDay === payDay) {
            return 30; // Recebeu hoje, ciclo completo
        } else {
            return Math.max(1, (lastDayThisMonth - todayDay) + payDay);
        }
    }

    return Math.max(1, lastDayThisMonth - todayDay + 1);
}

let rxDoughnutChartInstance = null;
let rxBarChartInstance = null;

function getCycleFinancialData() {
    const currentMonth = getCurrentMonthYear();
    const monthIncomes = (appData.incomes || []).filter(i => getMonthYear(i.date) === currentMonth);
    const monthExpenses = (appData.expenses || []).filter(e => getMonthYear(e.date) === currentMonth);

    const custom = appData.rxCustomSettings || {};
    const isCustom = custom.active === true;

    let totalIncome = isCustom && custom.income !== undefined
        ? custom.income
        : monthIncomes.reduce((s, i) => s + i.value, 0);

    if (totalIncome === 0 && appData.salary && appData.salary.value) {
        totalIncome = appData.salary.value;
    }
    if (totalIncome <= 0) totalIncome = 2500; // Referência padrão

    const fixedTotal = isCustom && custom.fixed !== undefined
        ? custom.fixed
        : (appData.fixedExpenses || []).filter(f => f.active !== false).reduce((s, f) => s + f.value, 0);

    const savingsPct = isCustom && custom.savingsPct !== undefined
        ? custom.savingsPct
        : (appData.savingsPercent || 20);

    const savingsTarget = totalIncome * (savingsPct / 100);
    const variableSpent = monthExpenses.reduce((s, e) => s + e.value, 0);

    const totalFreeMargin = Math.max(0, totalIncome - fixedTotal - savingsTarget);
    const remainingFreeMargin = totalIncome - fixedTotal - savingsTarget - variableSpent;

    const daysRemaining = isCustom && custom.days !== undefined
        ? custom.days
        : getDaysRemainingInCycle();

    const safeDailyBudget = remainingFreeMargin > 0 ? (remainingFreeMargin / daysRemaining) : 0;
    
    const monthlyHours = isCustom && custom.hours !== undefined ? custom.hours : 176;
    const hourlyWage = Math.max(1, totalIncome / monthlyHours);

    return {
        totalIncome,
        fixedTotal,
        savingsTarget,
        savingsPct,
        variableSpent,
        totalFreeMargin,
        remainingFreeMargin,
        daysRemaining,
        safeDailyBudget,
        hourlyWage,
        monthlyHours,
        isCustom
    };
}

function focusRxInput() {
    navigateTo('raiox');
    setTimeout(() => {
        const input = document.getElementById('rxInputAmount');
        if (input) {
            input.focus();
            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 150);
}

function toggleRxInstallments() {
    const payMethod = document.getElementById('rxInputPayment')?.value;
    const group = document.getElementById('rxInstallmentsGroup');
    if (group) {
        group.style.display = payMethod === 'card_installments' ? 'block' : 'none';
    }
    runExpenseRx();
}

function runExpenseRx() {
    const amountInput = document.getElementById('rxInputAmount');
    if (!amountInput) return;

    const amount = Math.max(0, parseFloat(amountInput.value) || 0);
    const name = (document.getElementById('rxInputName')?.value || '').trim();
    const priority = document.getElementById('rxInputPriority')?.value || 'comfort';
    const payment = document.getElementById('rxInputPayment')?.value || 'cash';
    const installments = Math.max(1, parseInt(document.getElementById('rxInputInstallments')?.value, 10) || 1);

    const monthImpact = payment === 'card_installments' ? (amount / installments) : amount;
    const fin = getCycleFinancialData();

    const remainingAfter = fin.remainingFreeMargin - monthImpact;
    const newDailySafe = remainingAfter > 0 ? (remainingAfter / fin.daysRemaining) : 0;
    const dailyDiff = Math.max(0, fin.safeDailyBudget - newDailySafe);
    const daysConsumed = fin.safeDailyBudget > 0 ? (monthImpact / fin.safeDailyBudget) : 0;
    const workHours = amount / fin.hourlyWage;
    const hoursOnly = Math.floor(workHours);
    const minutesOnly = Math.round((workHours - hoursOnly) * 60);
    const investment3y = amount * Math.pow(1 + 0.105, 3); // 10.5% a.a. em 3 anos

    // Diagnóstico e Veredito
    let verdictStatus = 'safe';
    let verdictTitle = '';
    let verdictDesc = '';
    let badgeText = '';

    if (amount <= 0) {
        verdictStatus = 'safe';
        verdictTitle = 'Aguardando valor para o diagnóstico';
        verdictDesc = 'Digite o valor acima para o Raio-X calcular seu impacto na renda, diária restante e horas de trabalho.';
        badgeText = 'Aguardando valor';
    } else if (remainingAfter < 0) {
        verdictStatus = 'danger';
        verdictTitle = '🚨 FREIO DE EMERGÊNCIA! Risco de Rombo';
        const deficit = Math.abs(remainingAfter);
        verdictDesc = `Esse gasto estoura sua margem do mês e invade ${formatCurrency(deficit)} das suas contas fixas ou poupança! Se não for questão de sobrevivência, aborte ou parcele conscientemente.`;
        badgeText = '🔴 Risco Crítico';
    } else if (newDailySafe < 18 || (priority === 'superfluous' && daysConsumed >= 2.5)) {
        verdictStatus = 'warning';
        verdictTitle = '⚠️ ATENÇÃO RECOMENDADA! Aperto no Orçamento';
        verdictDesc = `Cuidado! Esse item consome ${daysConsumed.toFixed(1)} dias inteiros da sua margem livre. Sua diária cairá para ${formatCurrency(newDailySafe)}/dia pelos próximos ${fin.daysRemaining} dias.`;
        badgeText = '🟡 Atenção Necessária';
    } else {
        verdictStatus = 'safe';
        verdictTitle = '✅ LIBERADO! Gasto Saudável';
        verdictDesc = `Tudo certo! Após essa compra ainda restarão ${formatCurrency(remainingAfter)} livres (${formatCurrency(newDailySafe)}/dia). Sua meta de poupança está 100% protegida.`;
        badgeText = '🟢 Compra Segura';
    }

    // UI Updates
    const bannerEl = document.getElementById('rxVerdictBanner');
    const iconEl = document.getElementById('rxVerdictIcon');
    const titleEl = document.getElementById('rxVerdictTitle');
    const descEl = document.getElementById('rxVerdictDesc');
    const badgeEl = document.getElementById('rxLaudoStatusBadge');

    if (bannerEl) bannerEl.className = `rx-verdict-banner ${verdictStatus}`;
    if (iconEl) {
        if (verdictStatus === 'safe') iconEl.innerHTML = '<i class="fas fa-circle-check"></i>';
        else if (verdictStatus === 'warning') iconEl.innerHTML = '<i class="fas fa-triangle-exclamation"></i>';
        else iconEl.innerHTML = '<i class="fas fa-hand-holding-dollar"></i>';
    }
    if (titleEl) titleEl.textContent = verdictTitle;
    if (descEl) descEl.textContent = verdictDesc;
    if (badgeEl) badgeEl.textContent = badgeText;

    // Medidores
    const hoursEl = document.getElementById('rxMeterHours');
    const hoursSubEl = document.getElementById('rxMeterHoursSub');
    if (hoursEl) {
        if (amount > 0) {
            hoursEl.textContent = hoursOnly > 0 ? `${hoursOnly}h ${minutesOnly}m` : `${minutesOnly} min`;
            if (hoursSubEl) hoursSubEl.textContent = workHours >= 8 ? `(${Math.floor(workHours / 8)} dia(s) de expediente!)` : 'de trabalho para pagar';
        } else {
            hoursEl.textContent = '0h 00m';
            if (hoursSubEl) hoursSubEl.textContent = 'do seu esforço de vida';
        }
    }

    const dailyImpactEl = document.getElementById('rxMeterDailyImpact');
    const dailyDiffEl = document.getElementById('rxMeterDailyImpactDiff');
    if (dailyImpactEl) dailyImpactEl.textContent = `${formatCurrency(newDailySafe)}/dia`;
    if (dailyDiffEl) dailyDiffEl.textContent = amount > 0 ? `-${formatCurrency(dailyDiff)}/dia de redução` : 'Variação da diária';

    const daysConsEl = document.getElementById('rxMeterDaysConsumed');
    if (daysConsEl) daysConsEl.textContent = amount > 0 ? `${daysConsumed.toFixed(1)} dias` : '0 dias';

    const invEl = document.getElementById('rxMeterInvestment');
    if (invEl) invEl.textContent = formatCurrency(investment3y);

    // Dica dinâmica
    const recTextEl = document.getElementById('rxStrategyRecommendationText');
    if (recTextEl) {
        if (priority === 'superfluous' && amount > 100) {
            recTextEl.textContent = `Desejo detectado: você precisa de ${hoursOnly}h de trabalho para pagar. Que tal usar a "Quarentena de 24h" antes de passar o cartão?`;
        } else if (verdictStatus === 'danger') {
            recTextEl.textContent = `Estratégia recomendada: Adie esta compra para o próximo ciclo de salário ou busque cortar gastos supérfluos pendentes.`;
        } else if (verdictStatus === 'warning') {
            recTextEl.textContent = `Estratégia recomendada: Use o Plano de Compensação para equilibrar essa despesa nos próximos dias.`;
        } else {
            recTextEl.textContent = `Estratégia recomendada: Gasto aprovado sem estresse. Lembre-se de manter o limite diário nos próximos dias!`;
        }
    }
}

function confirmRxExpense() {
    const amountInput = document.getElementById('rxInputAmount');
    const nameInput = document.getElementById('rxInputName');
    const amount = parseFloat(amountInput?.value) || 0;
    const name = (nameInput?.value || '').trim();
    const priority = document.getElementById('rxInputPriority')?.value || 'comfort';
    const category = document.getElementById('rxInputCategory')?.value || 'Outros';
    const payment = document.getElementById('rxInputPayment')?.value || 'cash';
    const installments = Math.max(1, parseInt(document.getElementById('rxInputInstallments')?.value, 10) || 1);

    if (amount <= 0 || !name) {
        showToast('Informe o valor e o nome da despesa para registrar.');
        return;
    }

    const isInstallments = payment === 'card_installments' && installments > 1;
    const finalDesc = isInstallments ? `${name} (1/${installments})` : name;
    const finalValue = isInstallments ? Math.round((amount / installments) * 100) / 100 : amount;

    if (!Array.isArray(appData.expenses)) appData.expenses = [];
    appData.expenses.push({
        id: generateId(),
        desc: finalDesc,
        value: finalValue,
        category: category,
        date: getTodayStr(),
        rxPassed: true,
        priority: priority
    });

    saveData(appData);
    refreshAll();
    showToast(`Despesa "${name}" registrada com sucesso!`);

    amountInput.value = '';
    nameInput.value = '';
    runExpenseRx();
}

function addCurrentToQuarantine() {
    const amountInput = document.getElementById('rxInputAmount');
    const nameInput = document.getElementById('rxInputName');
    const amount = parseFloat(amountInput?.value) || 0;
    const name = (nameInput?.value || '').trim() || 'Desejo em observação';
    const priority = document.getElementById('rxInputPriority')?.value || 'superfluous';
    const category = document.getElementById('rxInputCategory')?.value || 'Compras';

    if (amount <= 0) {
        showToast('Informe o valor para colocar na quarentena.');
        return;
    }

    if (!Array.isArray(appData.quarantineItems)) appData.quarantineItems = [];

    const item = {
        id: generateId(),
        name,
        amount,
        category,
        priority,
        dateAdded: new Date().toISOString()
    };

    appData.quarantineItems.push(item);
    saveData(appData);
    refreshRaioXPage();
    showToast(`"${name}" colocado na Quarentena das 24 Horas!`);

    amountInput.value = '';
    nameInput.value = '';
    runExpenseRx();
    scrollToQuarantine();
}

function scrollToQuarantine() {
    const sec = document.getElementById('rxQuarantineSection');
    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buyQuarantinedItem(id) {
    if (!Array.isArray(appData.quarantineItems)) return;
    const item = appData.quarantineItems.find(x => x.id === id);
    if (!item) return;

    if (!Array.isArray(appData.expenses)) appData.expenses = [];
    appData.expenses.push({
        id: generateId(),
        desc: `${item.name} (Pós-Quarentena 24h)`,
        value: item.amount,
        category: item.category || 'Compras',
        date: getTodayStr(),
        rxPassed: true
    });

    appData.quarantineItems = appData.quarantineItems.filter(x => x.id !== id);
    saveData(appData);
    refreshAll();
    showToast(`Compra de "${item.name}" confirmada após quarentena!`);
}

function avoidQuarantinedItem(id) {
    if (!Array.isArray(appData.quarantineItems)) return;
    const item = appData.quarantineItems.find(x => x.id === id);
    if (!item) return;

    appData.totalAvoidedImpulses = (appData.totalAvoidedImpulses || 0) + item.amount;
    appData.quarantineItems = appData.quarantineItems.filter(x => x.id !== id);
    saveData(appData);
    refreshRaioXPage();
    showToast(`🎉 Parabéns! Você evitou um impulso e economizou ${formatCurrency(item.amount)}!`);
}

function editQuarantinedItem(id) {
    const item = (appData.quarantineItems || []).find(x => x.id === id);
    if (!item) return;
    const newName = prompt('Editar nome/descrição do item na quarentena:', item.name);
    if (newName === null) return;
    const newAmtStr = prompt('Editar valor do item (R$):', item.amount);
    if (newAmtStr === null) return;
    const newAmt = parseFloat(newAmtStr.replace(',', '.'));
    if (isNaN(newAmt) || newAmt <= 0) {
        showToast('Valor informado inválido.');
        return;
    }
    item.name = newName.trim() || item.name;
    item.amount = newAmt;
    saveData(appData);
    refreshRaioXPage();
    showToast('Item da quarentena atualizado!');
}

function deleteQuarantinedItem(id) {
    if (!confirm('Deseja remover este item da quarentena?')) return;
    appData.quarantineItems = (appData.quarantineItems || []).filter(x => x.id !== id);
    saveData(appData);
    refreshRaioXPage();
    showToast('Item removido da quarentena.');
}

function renderQuarantineList() {
    const listEl = document.getElementById('rxQuarantineList');
    if (!listEl) return;

    const items = appData.quarantineItems || [];
    const countLabel = document.getElementById('rxQuarantineCountLabel');
    const totalSavedEl = document.getElementById('rxTotalSavedByQuarantine');

    if (countLabel) countLabel.textContent = `${items.length} ${items.length === 1 ? 'item' : 'itens'} em quarentena`;
    if (totalSavedEl) totalSavedEl.textContent = `Economizado ao evitar impulsos: ${formatCurrency(appData.totalAvoidedImpulses || 0)}`;

    if (items.length === 0) {
        listEl.innerHTML = `
            <div style="text-align:center;padding:24px;color:var(--text-secondary);font-size:0.88rem;background:var(--bg);border-radius:10px;border:1px dashed var(--border);">
                <i class="fas fa-mug-hot" style="font-size:1.8rem;margin-bottom:8px;display:block;color:var(--cor-accent);"></i>
                Nenhum desejo na quarentena no momento. Quando sentir vontade de comprar por impulso, coloque aqui e espere 24h!
            </div>
        `;
        return;
    }

    const now = new Date();
    listEl.innerHTML = items.map(item => {
        const added = new Date(item.dateAdded);
        const elapsedHours = Math.max(0, Math.floor((now - added) / (1000 * 60 * 60)));
        const hoursLeft = Math.max(0, 24 - elapsedHours);

        return `
            <div class="quarantine-item">
                <div class="quarantine-left">
                    <span class="quarantine-badge">
                        <i class="fas fa-clock"></i> ${hoursLeft > 0 ? `${hoursLeft}h restantes` : 'Liberado para decidir'}
                    </span>
                    <div>
                        <strong style="font-size:0.95rem;color:var(--text);">${escapeHtml(item.name)}</strong>
                        <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:2px;">
                            ${escapeHtml(item.category)} • Adicionado em ${formatDate(item.dateAdded ? item.dateAdded.substring(0, 10) : getTodayStr())}
                        </div>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                    <strong class="card-value text-primary" style="font-size:1.15rem;">${formatCurrency(item.amount)}</strong>
                    <div class="quarantine-actions" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                        <button class="btn btn-sm btn-success" onclick="avoidQuarantinedItem('${item.id}')" title="Desisti da compra! Guardar este dinheiro">
                            <i class="fas fa-piggy-bank"></i> Desisti (Economizei!)
                        </button>
                        <button class="btn btn-sm btn-outline" onclick="buyQuarantinedItem('${item.id}')" title="Ainda quero comprar este item">
                            <i class="fas fa-check"></i> Comprar
                        </button>
                        <button class="btn btn-sm btn-outline" onclick="editQuarantinedItem('${item.id}')" title="Editar valor ou nome">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button class="btn btn-sm btn-danger-soft" onclick="deleteQuarantinedItem('${item.id}')" title="Remover da quarentena">
                            <i class="fas fa-trash-can"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function openCompensationModal() {
    openModal('compensation');
    calculateCompensationPlan();
}

function setCompDays(days) {
    compSelectedDays = days;
    document.querySelectorAll('.invest-pill[data-comp-days]').forEach(btn => {
        const d = parseInt(btn.getAttribute('data-comp-days'), 10);
        btn.classList.toggle('active', d === days);
    });
    calculateCompensationPlan();
}

function calculateCompensationPlan() {
    const input = document.getElementById('compExcessAmount');
    const cutEl = document.getElementById('compDailyCut');
    const tipEl = document.getElementById('compPracticalTip');
    if (!input || !cutEl) return;

    const excess = Math.max(0, parseFloat(input.value) || 0);
    const dailyCut = excess / Math.max(1, compSelectedDays);

    cutEl.textContent = `-${formatCurrency(dailyCut)} /dia por ${compSelectedDays} dias`;

    if (tipEl) {
        if (dailyCut <= 15) {
            tipEl.textContent = 'Corte 1 cafezinho de rua ou lanche supérfluo ao dia';
        } else if (dailyCut <= 35) {
            tipEl.textContent = 'Troque delivery por refeição caseira e evite corridas de app';
        } else if (dailyCut <= 70) {
            tipEl.textContent = 'Pausa total em compras de vestuário e lazer pago esta semana';
        } else {
            tipEl.textContent = 'Modo econômico ativado: somente compras 100% essenciais de supermercado';
        }
    }
}

function renderRxAuditTable() {
    const tbody = document.getElementById('rxAuditTableBody');
    const badge = document.getElementById('rxAuditCountBadge');
    if (!tbody) return;

    const currentMonth = getCurrentMonthYear();
    const expenses = (appData.expenses || []).filter(e => getMonthYear(e.date) === currentMonth);
    const fin = getCycleFinancialData();

    if (badge) badge.textContent = `${expenses.length} ${expenses.length === 1 ? 'despesa avaliada' : 'despesas avaliadas'}`;

    // Totalizadores da Auditoria
    const totalSpentEl = document.getElementById('rxAuditTotalSpent');
    const totalHoursEl = document.getElementById('rxAuditTotalHours');
    const maxExpenseEl = document.getElementById('rxAuditMaxExpense');
    const topCategoryEl = document.getElementById('rxAuditTopCategory');

    const totalSpent = expenses.reduce((s, e) => s + (e.value || 0), 0);
    const totalHours = fin.hourlyWage > 0 ? (totalSpent / fin.hourlyWage) : 0;
    const totalHoursInt = Math.floor(totalHours);
    const totalMinsInt = Math.round((totalHours - totalHoursInt) * 60);

    if (totalSpentEl) totalSpentEl.textContent = formatCurrency(totalSpent);
    if (totalHoursEl) {
        totalHoursEl.textContent = totalHoursInt > 0 ? `${totalHoursInt}h ${totalMinsInt}m` : `${totalMinsInt}m`;
    }

    if (expenses.length === 0) {
        if (maxExpenseEl) maxExpenseEl.textContent = '—';
        if (topCategoryEl) topCategoryEl.textContent = '—';
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align:center;padding:28px;color:var(--text-secondary);">
                    <i class="fas fa-check-circle" style="font-size:1.5rem;color:var(--success);margin-bottom:8px;display:block;"></i>
                    Nenhuma despesa registrada neste mês ainda. Seu orçamento está 100% preservado!
                </td>
            </tr>
        `;
        return;
    }

    // Ordena do maior valor para o menor
    const sorted = [...expenses].sort((a, b) => b.value - a.value);

    // Maior gasto único
    if (maxExpenseEl) {
        const topExp = sorted[0];
        maxExpenseEl.textContent = `${topExp.desc} (${formatCurrency(topExp.value)})`;
    }

    // Categoria mais cara
    const catTotals = {};
    expenses.forEach(e => {
        catTotals[e.category] = (catTotals[e.category] || 0) + (e.value || 0);
    });
    const topCat = Object.keys(catTotals).reduce((a, b) => catTotals[a] > catTotals[b] ? a : b, '');
    if (topCategoryEl) {
        topCategoryEl.textContent = topCat ? `${topCat} (${formatCurrency(catTotals[topCat])})` : '—';
    }

    tbody.innerHTML = sorted.map(exp => {
        const val = exp.value || 0;
        const pctIncome = fin.totalIncome > 0 ? ((val / fin.totalIncome) * 100).toFixed(1) : 0;
        const workHours = val / fin.hourlyWage;
        const h = Math.floor(workHours);
        const m = Math.round((workHours - h) * 60);
        const hoursStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
        const daysCons = fin.safeDailyBudget > 0 ? (val / fin.safeDailyBudget).toFixed(1) : '0.0';

        let severity = 'low';
        let severityText = '🟢 Leve';
        if (val > fin.safeDailyBudget * 2 || val > 200) {
            severity = 'high';
            severityText = '🔴 Alto Impacto';
        } else if (val > fin.safeDailyBudget || val > 60) {
            severity = 'med';
            severityText = '🟡 Moderado';
        }

        return `
            <tr>
                <td><strong>${escapeHtml(exp.desc)}</strong></td>
                <td><span class="badge-cat">${escapeHtml(exp.category || 'Geral')}</span></td>
                <td><strong class="card-value text-danger">-${formatCurrency(val)}</strong></td>
                <td><span class="card-value" style="font-size:0.85rem;color:var(--text-secondary);">${pctIncome}%</span></td>
                <td><span style="font-weight:600;color:var(--text);"><i class="fas fa-clock" style="font-size:0.8rem;color:var(--text-secondary);"></i> ${hoursStr}</span></td>
                <td><span style="font-weight:600;color:var(--text-secondary);">${daysCons} dia(s)</span></td>
                <td><span class="rx-severity-pill ${severity}">${severityText}</span></td>
                <td style="color:var(--text-secondary);font-size:0.8rem;">${formatDate(exp.date)}</td>
                <td style="text-align:center;">
                    <button class="btn btn-sm btn-outline" onclick="openRxEditExpenseModal('${exp.id}')" title="Editar este gasto no Raio-X" style="padding:4px 9px;font-size:0.82rem;">
                        <i class="fas fa-pen"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function refreshRaioXPage() {
    const fin = getCycleFinancialData();
    const currentMonth = getCurrentMonthYear();

    // Top 4 KPIs
    const dailySafeEl = document.getElementById('rxKpiDailySafe');
    const daysLeftEl = document.getElementById('rxKpiDaysLeft');
    if (dailySafeEl) dailySafeEl.textContent = `${formatCurrency(fin.safeDailyBudget)} /dia`;
    if (daysLeftEl) daysLeftEl.textContent = `${fin.daysRemaining} dias restantes até o próximo ciclo`;

    const freeMarginEl = document.getElementById('rxKpiFreeMargin');
    const freeMarginSubEl = document.getElementById('rxKpiFreeMarginSub');
    if (freeMarginEl) {
        freeMarginEl.textContent = formatCurrency(fin.remainingFreeMargin);
        freeMarginEl.className = `card-value ${fin.remainingFreeMargin >= 0 ? 'text-success' : 'text-danger'}`;
    }
    if (freeMarginSubEl) {
        freeMarginSubEl.textContent = fin.remainingFreeMargin >= 0 
            ? 'Livre após contas e poupança' 
            : `Déficit de ${formatCurrency(Math.abs(fin.remainingFreeMargin))}`;
    }

    const hourlyEl = document.getElementById('rxKpiHourlyWage');
    const hourlySubEl = document.getElementById('rxKpiHourlyWageSub');
    if (hourlyEl) hourlyEl.textContent = `${formatCurrency(fin.hourlyWage)} /h`;
    if (hourlySubEl) hourlySubEl.textContent = `Baseado na renda de ${formatCurrency(fin.totalIncome)}`;

    // Termômetro de Consciência
    const conscienceEl = document.getElementById('rxKpiConscienceScore');
    const conscienceBadgeEl = document.getElementById('rxKpiConscienceBadge');
    if (conscienceEl && conscienceBadgeEl) {
        let score = 100;
        if (fin.remainingFreeMargin < 0) score = Math.max(10, 50 - Math.round(Math.abs(fin.remainingFreeMargin) / 50));
        else if (fin.safeDailyBudget < 20) score = 65;
        else if (fin.safeDailyBudget < 35) score = 80;

        conscienceEl.textContent = `${score} / 100`;
        if (score >= 80) {
            conscienceBadgeEl.textContent = '🟢 Zona Segura';
            conscienceBadgeEl.className = 'badge-status ok';
        } else if (score >= 60) {
            conscienceBadgeEl.textContent = '🟡 Zona de Atenção';
            conscienceBadgeEl.className = 'badge-status warning';
        } else {
            conscienceBadgeEl.textContent = '🔴 Alerta Vermelho';
            conscienceBadgeEl.className = 'badge-status danger';
        }
    }

    // Painel Detalhado de Composição Mensal
    const monthLabelEl = document.getElementById('rxMonthLabel');
    if (monthLabelEl) monthLabelEl.textContent = getMonthYearLabel(currentMonth);

    const compIncomeEl = document.getElementById('rxCompIncome');
    if (compIncomeEl) compIncomeEl.textContent = formatCurrency(fin.totalIncome);

    const compFixedEl = document.getElementById('rxCompFixed');
    const compFixedPctEl = document.getElementById('rxCompFixedPct');
    if (compFixedEl) compFixedEl.textContent = formatCurrency(fin.fixedTotal);
    if (compFixedPctEl) compFixedPctEl.textContent = `${((fin.fixedTotal / fin.totalIncome) * 100).toFixed(1)}% da renda`;

    const compSavingsEl = document.getElementById('rxCompSavings');
    const compSavingsPctEl = document.getElementById('rxCompSavingsPct');
    if (compSavingsEl) compSavingsEl.textContent = formatCurrency(fin.savingsTarget);
    if (compSavingsPctEl) compSavingsPctEl.textContent = `${((fin.savingsTarget / fin.totalIncome) * 100).toFixed(1)}% da renda`;

    const compSpentEl = document.getElementById('rxCompSpent');
    const compSpentPctEl = document.getElementById('rxCompSpentPct');
    if (compSpentEl) compSpentEl.textContent = formatCurrency(fin.variableSpent);
    if (compSpentPctEl) compSpentPctEl.textContent = `${((fin.variableSpent / fin.totalIncome) * 100).toFixed(1)}% da renda`;

    const compFreeEl = document.getElementById('rxCompFree');
    const compFreeDaysEl = document.getElementById('rxCompFreeDays');
    if (compFreeEl) {
        compFreeEl.textContent = formatCurrency(fin.remainingFreeMargin);
        compFreeEl.className = `card-value ${fin.remainingFreeMargin >= 0 ? 'text-success' : 'text-danger'}`;
    }
    if (compFreeDaysEl) {
        compFreeDaysEl.textContent = fin.remainingFreeMargin >= 0 
            ? `${formatCurrency(fin.safeDailyBudget)}/dia (${fin.daysRemaining} dias)`
            : 'Meta estourada';
    }

    const totalCommitted = fin.fixedTotal + fin.savingsTarget + fin.variableSpent;
    const commitPct = fin.totalIncome > 0 ? Math.min(100, Math.round((totalCommitted / fin.totalIncome) * 100)) : 0;
    const compCommitEl = document.getElementById('rxCompCommitment');
    const compCommitLabelEl = document.getElementById('rxCompCommitmentLabel');
    if (compCommitEl) {
        compCommitEl.textContent = `${commitPct}%`;
        compCommitEl.style.color = commitPct > 90 ? 'var(--danger)' : (commitPct > 75 ? 'var(--warning)' : 'var(--success)');
    }
    if (compCommitLabelEl) {
        compCommitLabelEl.textContent = commitPct > 90 ? '⚠️ Quase no limite' : (commitPct > 75 ? 'Moderado' : '🟢 Confortável');
    }

    // Barra de Progresso Visual de Comprometimento
    const barFixed = document.getElementById('rxBarFixed');
    const barSavings = document.getElementById('rxBarSavings');
    const barSpent = document.getElementById('rxBarSpent');
    const barFree = document.getElementById('rxBarFree');

    if (barFixed && fin.totalIncome > 0) {
        barFixed.style.width = `${Math.min(100, (fin.fixedTotal / fin.totalIncome) * 100)}%`;
        barSavings.style.width = `${Math.min(100, (fin.savingsTarget / fin.totalIncome) * 100)}%`;
        barSpent.style.width = `${Math.min(100, (fin.variableSpent / fin.totalIncome) * 100)}%`;
        const freePct = Math.max(0, 100 - ((fin.fixedTotal + fin.savingsTarget + fin.variableSpent) / fin.totalIncome) * 100);
        barFree.style.width = `${freePct}%`;
    }

    // Strategy cards values
    const stratDailyEl = document.getElementById('rxStratDailyVal');
    if (stratDailyEl) stratDailyEl.textContent = formatCurrency(fin.safeDailyBudget);

    const stratEnvEl = document.getElementById('rxStratEnvelopeVal');
    if (stratEnvEl) {
        const envelopeVal = Math.max(0, fin.totalIncome * 0.3 - fin.variableSpent);
        stratEnvEl.textContent = formatCurrency(envelopeVal);
    }

    // Sub-components
    runExpenseRx();
    renderQuarantineList();
    renderRxAuditTable();
    renderRxDoughnutChart();
    renderRxBarChart();
    renderRxDetailedReport();
}

function openRxSettingsModal() {
    const fin = getCycleFinancialData();

    const incomeInput = document.getElementById('rxSetIncome');
    const fixedInput = document.getElementById('rxSetFixed');
    const savingsInput = document.getElementById('rxSetSavingsPct');
    const daysInput = document.getElementById('rxSetDays');
    const hoursInput = document.getElementById('rxSetHours');

    if (incomeInput) incomeInput.value = formatCurrency(fin.totalIncome).replace('R$', '').trim();
    if (fixedInput) fixedInput.value = formatCurrency(fin.fixedTotal).replace('R$', '').trim();
    if (savingsInput) savingsInput.value = fin.savingsPct;
    if (daysInput) daysInput.value = fin.daysRemaining;
    if (hoursInput) hoursInput.value = fin.monthlyHours || 176;

    openModal('rx-settings');
}

function saveRxSettings(e) {
    e.preventDefault();
    const income = parseMoneyBR(document.getElementById('rxSetIncome')?.value);
    const fixed = parseMoneyBR(document.getElementById('rxSetFixed')?.value);
    const savingsPct = parseFloat(document.getElementById('rxSetSavingsPct')?.value) || 20;
    const days = parseInt(document.getElementById('rxSetDays')?.value, 10) || 15;
    const hours = parseInt(document.getElementById('rxSetHours')?.value, 10) || 176;

    if (income <= 0) {
        showToast('Informe uma renda válida maior que zero.');
        return;
    }

    appData.rxCustomSettings = {
        active: true,
        income,
        fixed,
        savingsPct,
        days,
        hours
    };

    saveData(appData);
    closeModal('rx-settings');
    refreshRaioXPage();
    showToast('⚙️ Informações do Raio-X atualizadas com sucesso! Gráficos e diagnóstico recalculados.');
}

function resetRxSettingsToAutomatic() {
    if (appData.rxCustomSettings) {
        delete appData.rxCustomSettings;
        saveData(appData);
    }
    closeModal('rx-settings');
    refreshRaioXPage();
    showToast('🔄 Valores do Raio-X restaurados para o modo automático com base nas suas transações.');
}

function openRxEditExpenseModal(id) {
    const exp = (appData.expenses || []).find(e => e.id === id);
    if (!exp) return;

    const idInput = document.getElementById('rxEditExpenseId');
    const nameInput = document.getElementById('rxEditExpenseName');
    const valInput = document.getElementById('rxEditExpenseValue');
    const catInput = document.getElementById('rxEditExpenseCategory');
    const dateInput = document.getElementById('rxEditExpenseDate');

    if (idInput) idInput.value = exp.id;
    if (nameInput) nameInput.value = exp.desc || '';
    if (valInput) valInput.value = formatCurrency(exp.value || 0).replace('R$', '').trim();
    if (catInput) catInput.value = exp.category || 'Outros';
    if (dateInput) dateInput.value = exp.date || getTodayStr();

    openModal('rx-edit-expense');
}

function saveRxEditExpense(e) {
    e.preventDefault();
    const id = document.getElementById('rxEditExpenseId')?.value;
    const name = document.getElementById('rxEditExpenseName')?.value.trim();
    const val = parseMoneyBR(document.getElementById('rxEditExpenseValue')?.value);
    const category = document.getElementById('rxEditExpenseCategory')?.value;
    const date = document.getElementById('rxEditExpenseDate')?.value || getTodayStr();

    if (!name || isNaN(val) || val <= 0) {
        showToast('Preencha a descrição e o valor da despesa corretamente.');
        return;
    }

    const exp = (appData.expenses || []).find(e => e.id === id);
    if (!exp) {
        showToast('Despesa não encontrada.');
        return;
    }

    exp.desc = name;
    exp.value = val;
    exp.category = category;
    exp.date = date;
    exp.updatedAt = new Date().toISOString();

    saveData(appData);
    closeModal('rx-edit-expense');
    refreshAll();
    showToast(`Despesa "${name}" atualizada com sucesso no Raio-X!`);
}

function renderRxDoughnutChart() {
    const canvas = document.getElementById('rxDoughnutChart');
    if (!canvas) return;

    const page = document.getElementById('page-raiox');
    if (page && !page.classList.contains('active')) return;

    const fin = getCycleFinancialData();
    const statusBadge = document.getElementById('rxChartStatusBadge');

    if (rxDoughnutChartInstance) {
        rxDoughnutChartInstance.destroy();
        rxDoughnutChartInstance = null;
    }

    const ctx = canvas.getContext('2d');
    const freeMarginSafe = Math.max(0, fin.remainingFreeMargin);
    const deficit = fin.remainingFreeMargin < 0 ? Math.abs(fin.remainingFreeMargin) : 0;

    if (statusBadge) {
        if (fin.remainingFreeMargin >= fin.totalIncome * 0.2) {
            statusBadge.innerHTML = '<i class="fas fa-shield-halved"></i> 🟢 Saúde Excelente';
            statusBadge.className = 'badge-status ok';
        } else if (fin.remainingFreeMargin >= 0) {
            statusBadge.innerHTML = '<i class="fas fa-circle-exclamation"></i> 🟡 Zona Controlada';
            statusBadge.className = 'badge-status warning';
        } else {
            statusBadge.innerHTML = '<i class="fas fa-triangle-exclamation"></i> 🔴 Orçamento Estourado';
            statusBadge.className = 'badge-status danger';
        }
    }

    const labels = [
        'Contas Fixas',
        'Meta de Poupança',
        'Gastos Variáveis Realizados',
        deficit > 0 ? 'Déficit (Estouro)' : 'Saldo Livre Restante'
    ];

    const dataValues = [
        fin.fixedTotal,
        fin.savingsTarget,
        fin.variableSpent,
        deficit > 0 ? deficit : freeMarginSafe
    ];

    const bgColors = [
        '#f59e0b',
        '#06b6d4',
        '#ef4444',
        deficit > 0 ? '#b91c1c' : '#10b981'
    ];

    rxDoughnutChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: dataValues,
                backgroundColor: bgColors,
                borderWidth: 2,
                borderColor: document.body.classList.contains('dark') ? '#1e293b' : '#ffffff',
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 12,
                        font: { family: 'Inter', size: 11, weight: '500' },
                        color: getChartTextColor()
                    }
                },
                tooltip: getExecutiveTooltipConfig({
                    label: function(context) {
                        const val = context.raw || 0;
                        const pct = fin.totalIncome > 0 ? ((val / fin.totalIncome) * 100).toFixed(1) : 0;
                        return ` ${context.label}: ${formatCurrency(val)} (${pct}%)`;
                    }
                })
            }
        }
    });
}

function renderRxBarChart() {
    const canvas = document.getElementById('rxBarChart');
    if (!canvas) return;

    const page = document.getElementById('page-raiox');
    if (page && !page.classList.contains('active')) return;

    const fin = getCycleFinancialData();
    const marginBadge = document.getElementById('rxChartMarginBadge');

    if (marginBadge) {
        const sign = fin.remainingFreeMargin >= 0 ? '+' : '';
        marginBadge.textContent = `Margem: ${sign}${formatCurrency(fin.remainingFreeMargin)}`;
        marginBadge.className = `badge-installments ${fin.remainingFreeMargin >= 0 ? '' : 'text-danger'}`;
    }

    if (rxBarChartInstance) {
        rxBarChartInstance.destroy();
        rxBarChartInstance = null;
    }

    const ctx = canvas.getContext('2d');

    const labels = ['Contas Fixas', 'Poupança / Reserva', 'Gastos do Mês'];
    const orcadoLimits = [
        fin.fixedTotal,
        fin.savingsTarget,
        Math.max(0, fin.totalIncome * 0.3)
    ];
    const realizadoValues = [
        fin.fixedTotal,
        appData.savingsBalance || fin.savingsTarget,
        fin.variableSpent
    ];

    rxBarChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Teto Recomendado / Orçado',
                    data: orcadoLimits,
                    backgroundColor: '#3b82f6',
                    borderRadius: 6,
                    barPercentage: 0.6,
                    categoryPercentage: 0.7
                },
                {
                    label: 'Real / Consumido',
                    data: realizadoValues,
                    backgroundColor: realizadoValues.map((v, i) => {
                        if (i === 1) return '#10b981';
                        return v > orcadoLimits[i] ? '#ef4444' : '#10b981';
                    }),
                    borderRadius: 6,
                    barPercentage: 0.6,
                    categoryPercentage: 0.7
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 12,
                        font: { family: 'Inter', size: 11, weight: '500' },
                        color: getChartTextColor()
                    }
                },
                tooltip: getExecutiveTooltipConfig({
                    label: function(ctx) {
                        return ` ${ctx.dataset.label}: ${formatCurrency(ctx.raw || 0)}`;
                    }
                })
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: v => formatCurrency(v),
                        font: { family: 'Inter', size: 10 },
                        color: getChartTextColor()
                    },
                    grid: { color: getChartGridColor(), borderDash: [4, 4] },
                    border: { display: false }
                },
                x: {
                    ticks: { font: { family: 'Inter', size: 11, weight: '500' }, color: getChartTextColor() },
                    grid: { display: false },
                    border: { display: false }
                }
            }
        }
    });
}

function renderRxDetailedReport() {
    const container = document.getElementById('rxDetailedReportContent');
    if (!container) return;

    const fin = getCycleFinancialData();
    const isPositive = fin.remainingFreeMargin >= 0;
    const fixedPct = fin.totalIncome > 0 ? ((fin.fixedTotal / fin.totalIncome) * 100).toFixed(1) : 0;
    const savingsPct = fin.savingsPct;
    const spentPct = fin.totalIncome > 0 ? ((fin.variableSpent / fin.totalIncome) * 100).toFixed(1) : 0;
    const freePct = fin.totalIncome > 0 ? Math.max(0, ((fin.remainingFreeMargin / fin.totalIncome) * 100)).toFixed(1) : 0;

    const hoursForFixed = fin.hourlyWage > 0 ? (fin.fixedTotal / fin.hourlyWage).toFixed(1) : '0';
    const hoursForSpent = fin.hourlyWage > 0 ? (fin.variableSpent / fin.hourlyWage).toFixed(1) : '0';
    const totalHoursWorked = fin.monthlyHours || 176;

    let verdictTitle = '';
    let verdictIcon = '';
    let verdictAction = '';

    if (fin.remainingFreeMargin > fin.totalIncome * 0.25) {
        verdictTitle = 'Saúde Financeira Blindada (Excelente)';
        verdictIcon = 'fa-circle-check text-success';
        verdictAction = 'Você está operando com alta margem de segurança. Aproveite para acelerar sua Reserva de Emergência ou fazer aportes na Carteira de Investimentos.';
    } else if (fin.remainingFreeMargin >= 0) {
        verdictTitle = 'Saúde Financeira em Equilíbrio Moderado';
        verdictIcon = 'fa-circle-info text-warning';
        verdictAction = `Sua margem diária segura é de <strong>${formatCurrency(fin.safeDailyBudget)}/dia</strong> pelos próximos ${fin.daysRemaining} dias. Mantenha os gastos dentro desse limite para não encostar na poupança.`;
    } else {
        verdictTitle = 'Alerta de Déficit no Ciclo (Orçamento Ultrapassado)';
        verdictIcon = 'fa-triangle-exclamation text-danger';
        verdictAction = `Você ultrapassou o orçamento livre em <strong>${formatCurrency(Math.abs(fin.remainingFreeMargin))}</strong>. Recomendamos ativar o <em>Plano de Compensação</em> cortando ${formatCurrency(Math.abs(fin.remainingFreeMargin) / Math.min(7, fin.daysRemaining))}/dia para reequilibrar o mês.`;
    }

    container.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:16px;">
            <!-- Bloco 1: Laudo Clínico -->
            <div style="padding:16px;background:var(--bg);border-radius:12px;border:1px solid var(--border);">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                    <i class="fas ${verdictIcon}" style="font-size:1.4rem;"></i>
                    <h4 style="margin:0;font-size:1rem;color:var(--text);">${verdictTitle}</h4>
                </div>
                <p style="font-size:0.88rem;color:var(--text-secondary);line-height:1.5;margin-bottom:12px;">
                    ${verdictAction}
                </p>
                <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:0.8rem;">
                    <span class="badge-status ${isPositive ? 'ok' : 'danger'}">
                        Margem Livre: ${formatCurrency(fin.remainingFreeMargin)}
                    </span>
                    <span class="badge-status ok">
                        Diária Segura: ${formatCurrency(fin.safeDailyBudget)}/dia
                    </span>
                </div>
            </div>

            <!-- Bloco 2: Regra 50/30/20 & Distribuição -->
            <div style="padding:16px;background:var(--bg);border-radius:12px;border:1px solid var(--border);">
                <h4 style="margin:0 0 10px;font-size:0.95rem;color:var(--text);">
                    <i class="fas fa-scale-balanced text-primary"></i> Distribuição Real da Renda
                </h4>
                <div style="display:flex;flex-direction:column;gap:8px;font-size:0.84rem;">
                    <div style="display:flex;justify-content:space-between;">
                        <span style="color:var(--text-secondary);">Contas Fixas (Meta máx 50%):</span>
                        <strong style="color:${fixedPct > 55 ? 'var(--danger)' : 'var(--text)'};">${formatCurrency(fin.fixedTotal)} (${fixedPct}%)</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;">
                        <span style="color:var(--text-secondary);">Poupança & Futuro (Meta mín 20%):</span>
                        <strong class="text-primary">${formatCurrency(fin.savingsTarget)} (${savingsPct}%)</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;">
                        <span style="color:var(--text-secondary);">Gastos Variáveis / Estilo de Vida:</span>
                        <strong style="color:${spentPct > 35 ? 'var(--danger)' : 'var(--text)'};">${formatCurrency(fin.variableSpent)} (${spentPct}%)</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;margin-top:2px;">
                        <span>Sobra Livre Restante:</span>
                        <strong class="${isPositive ? 'text-success' : 'text-danger'}">${formatCurrency(fin.remainingFreeMargin)} (${freePct}%)</strong>
                    </div>
                </div>
            </div>

            <!-- Bloco 3: Horas de Vida & Esforço -->
            <div style="padding:16px;background:var(--bg);border-radius:12px;border:1px solid var(--border);">
                <h4 style="margin:0 0 10px;font-size:0.95rem;color:var(--text);">
                    <i class="fas fa-user-clock text-cyan"></i> O Peso em Horas de Trabalho
                </h4>
                <div style="display:flex;flex-direction:column;gap:8px;font-size:0.84rem;">
                    <div style="display:flex;justify-content:space-between;">
                        <span style="color:var(--text-secondary);">Valor de 1 hora de vida:</span>
                        <strong class="text-cyan">${formatCurrency(fin.hourlyWage)}/h</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;">
                        <span style="color:var(--text-secondary);">Horas pagando contas fixas:</span>
                        <strong>${hoursForFixed} horas</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;">
                        <span style="color:var(--text-secondary);">Horas pagando gastos do mês:</span>
                        <strong>${hoursForSpent} horas</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:6px;margin-top:2px;">
                        <span>Jornada do mês:</span>
                        <small style="color:var(--text-secondary);">${totalHoursWorked}h totais consideradas</small>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function printRxReport() {
    window.print();
}

// ============================================
// TIPS
// ============================================
const allTips = [
    { icon: '☕', title: 'Desafio do Café', text: 'Troque o café de fora por café feito em casa. Um café por dia a R$8 = R$240/mês!', savings: 'Economia: até R$240/mês' },
    { icon: '🍱', title: 'Marmita é Ouro', text: 'Leve marmita ao invés de comer fora. Mais saudável e muito mais barato.', savings: 'Economia: até R$600/mês' },
    { icon: '📱', title: 'Revise Assinaturas', text: 'Cancele Netflix, Spotify ou apps que não usa há meses. Cada real conta!', savings: 'Economia: até R$150/mês' },
    { icon: '🚿', title: 'Banho Consciente', text: 'Reduza o tempo de banho. Sua conta de água e energia vão agradecer.', savings: 'Economia: até R$80/mês' },
    { icon: '🛒', title: 'Lista de Compras', text: 'Sempre vá ao supermercado com lista. Não vá com fome!', savings: 'Economia: até R$300/mês' },
    { icon: '🚌', title: 'Transporte Alternativo', text: 'Use transporte público, bicicleta ou carona quando possível.', savings: 'Economia: até R$500/mês' },
    { icon: '💡', title: 'Energia Inteligente', text: 'Desligue aparelhos da tomada. Use LED e aproveite a luz natural.', savings: 'Economia: até R$100/mês' },
    { icon: '🏷️', title: 'Marcas Próprias', text: 'Produtos de marca própria costumam ter a mesma qualidade e custar até 40% menos.', savings: 'Economia: até R$200/mês' },
    { icon: '📦', title: 'Compre no Atacado', text: 'Produtos não perecíveis ficam mais baratos em compras maiores.', savings: 'Economia: até R$150/mês' },
    { icon: '🎮', title: 'Lazer Gratuito', text: 'Parques, trilhas, bibliotecas, eventos gratuitos. Diversão não precisa custar caro!', savings: 'Economia: até R$300/mês' },
    { icon: '👕', title: 'Guarda-Roupa Cápsula', text: 'Menos peças, mais versáteis. Compre qualidade que dure.', savings: 'Economia: até R$200/mês' },
    { icon: '🔧', title: 'DIY: Faça Você Mesmo', text: 'Pequenos consertos em casa: aprenda no YouTube e economize.', savings: 'Economia: até R$300/mês' },
    { icon: '💳', title: 'Evite Parcelamentos', text: 'Parcelas comprometem renda futura. Se não pode à vista, talvez não precise.', savings: 'Economia: variável' },
    { icon: '🗓️', title: 'Dia Sem Gastar', text: 'Escolha 1 dia por semana para não gastar nada. Desafie-se!', savings: 'Economia: até R$200/mês' },
    { icon: '📊', title: 'Acompanhe Gastos', text: 'Anotar tudo (como neste app!) faz você pensar duas vezes antes de comprar.', savings: 'Economia: consciência!' },
    { icon: '🏦', title: 'Pague-se Primeiro', text: 'Assim que receber, separe a poupança ANTES de pagar contas.', savings: 'Economia: disciplina!' },
    { icon: '🧊', title: 'Congele Alimentos', text: 'Cozinhe em quantidade e congele. Evita desperdício e delivery.', savings: 'Economia: até R$400/mês' },
    { icon: '📞', title: 'Negocie Contas', text: 'Ligue para operadoras e peça desconto. Funciona mais do que imagina!', savings: 'Economia: até R$100/mês' },
    { icon: '🎁', title: 'Presentes Criativos', text: 'Faça presentes caseiros ou dê experiências ao invés de coisas caras.', savings: 'Economia: até R$200/mês' },
    { icon: '💧', title: 'Água na Garrafa', text: 'Leve garrafa reutilizável. Garrafinha todo dia soma no fim do mês.', savings: 'Economia: até R$100/mês' }
];

let currentTips = [];

function shuffleTips() {
    currentTips = [...allTips].sort(() => Math.random() - 0.5).slice(0, 6);
    renderTips();
}

function renderTips() {
    if (currentTips.length === 0) shuffleTips();
    document.getElementById('tipsGrid').innerHTML = currentTips.map(tip => `
        <div class="tip-card">
            <div class="tip-icon">${tip.icon}</div>
            <h4>${tip.title}</h4>
            <p>${tip.text}</p>
            <div class="tip-savings">💰 ${tip.savings}</div>
        </div>`).join('');
}

// ============================================
// DASHBOARD
// ============================================
let barChartInstance = null;
let doughnutChartInstance = null;
let funcInvestChartInstance = null;
let funcPoupancaChartInstance = null;

function getChartTextColor() {
    return document.body.classList.contains('dark') ? '#94a3b8' : '#6b7280';
}
function getChartGridColor() {
    return document.body.classList.contains('dark') ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
}

function getExecutiveTooltipConfig(customCallbacks = {}) {
    const isDark = document.body.classList.contains('dark');
    return {
        backgroundColor: isDark ? 'rgba(9, 9, 11, 0.94)' : 'rgba(15, 23, 42, 0.95)',
        titleColor: '#ffffff',
        bodyColor: '#f1f5f9',
        borderColor: isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.1)',
        borderWidth: 1,
        padding: { top: 10, bottom: 10, left: 14, right: 14 },
        cornerRadius: 10,
        boxPadding: 6,
        usePointStyle: true,
        titleFont: { family: 'Inter, -apple-system, sans-serif', weight: '600', size: 12 },
        bodyFont: { family: 'Inter, -apple-system, sans-serif', size: 12 },
        footerFont: { family: 'Inter, -apple-system, sans-serif', size: 11 },
        callbacks: customCallbacks
    };
}


// ============================================
// SCORE DE SAÚDE FINANCEIRA (0 A 100)
// ============================================
function calculateHealthScore() {
    const currentMonth = getCurrentMonthYear();
    const today = new Date();
    const todayDay = today.getDate();
    const todayStr = getTodayStr();

    const monthIncomes = (appData.incomes || []).filter(i => getMonthYear(i.date) === currentMonth);
    const monthExpenses = (appData.expenses || []).filter(e => getMonthYear(e.date) === currentMonth);
    const monthSavings = (appData.savingsTransactions || []).filter(s => getMonthYear(s.date) === currentMonth);

    const totalIncome = monthIncomes.reduce((s, i) => s + i.value, 0);
    const totalExpense = monthExpenses.reduce((s, e) => s + e.value, 0);
    const totalBalance = totalIncome - totalExpense;
    const totalSaved = monthSavings.reduce((s, t) => s + (t.type === 'deposit' ? t.value : -t.value), 0);
    const savingsGoal = totalIncome * ((appData.savingsPercent || 20) / 100);

    // 1. Poupança do Mês (0 a 25)
    let ptsSavings = 0;
    let statusSavings = 'fail';
    if (totalIncome === 0) {
        ptsSavings = 15;
        statusSavings = 'warn';
    } else if (savingsGoal > 0) {
        const ratio = totalSaved / savingsGoal;
        if (ratio >= 1) {
            ptsSavings = 25;
            statusSavings = 'ok';
        } else if (ratio >= 0.5) {
            ptsSavings = Math.round(ratio * 25);
            statusSavings = 'warn';
        } else if (ratio > 0) {
            ptsSavings = Math.round(ratio * 25);
            statusSavings = 'warn';
        } else {
            ptsSavings = 0;
            statusSavings = 'fail';
        }
    }

    // 2. Contas em Dia (0 a 25)
    let overdueCount = 0;
    (appData.detailedExpenses || []).forEach(item => {
        if (item.status === 'atrasado') {
            overdueCount++;
        } else if (item.status === 'pendente' && item.date < todayStr) {
            overdueCount++;
        }
    });
    (appData.fixedExpenses || []).forEach(item => {
        if (item.active !== false && item.dueDay < todayDay) {
            const isPaid = (appData.expenses || []).some(e =>
                getMonthYear(e.date) === currentMonth && e.desc.toLowerCase() === item.name.toLowerCase()
            );
            if (!isPaid) overdueCount++;
        }
    });

    let ptsBills = 0;
    let statusBills = 'ok';
    if (overdueCount === 0) {
        ptsBills = 25;
        statusBills = 'ok';
    } else if (overdueCount === 1) {
        ptsBills = 12;
        statusBills = 'warn';
    } else {
        ptsBills = 0;
        statusBills = 'fail';
    }

    // 3. Meta de Renda (0 a 25)
    const meta = calculateMeta();
    let ptsMeta = 0;
    let statusMeta = 'fail';
    if (meta.totalExpenses === 0) {
        ptsMeta = 25;
        statusMeta = 'ok';
    } else if (meta.remainingToEarn === 0) {
        ptsMeta = 25;
        statusMeta = 'ok';
    } else {
        const ratio = meta.percentAchieved / 100;
        ptsMeta = Math.min(25, Math.max(0, Math.round(ratio * 25)));
        statusMeta = ratio >= 0.7 ? 'warn' : 'fail';
    }

    // 4. Limites de Gastos (0 a 25)
    let breachedBudgets = 0;
    const limits = Object.entries(appData.budgetLimits || {});
    limits.forEach(([cat, limit]) => {
        const spent = monthExpenses.filter(e => e.category === cat).reduce((s, e) => s + e.value, 0);
        if (spent > limit) breachedBudgets++;
    });

    let ptsBudgets = 0;
    let statusBudgets = 'ok';
    if (breachedBudgets === 0 && totalBalance >= 0) {
        ptsBudgets = 25;
        statusBudgets = 'ok';
    } else if (breachedBudgets === 0 && totalBalance < 0) {
        ptsBudgets = 15;
        statusBudgets = 'warn';
    } else if (breachedBudgets === 1) {
        ptsBudgets = 10;
        statusBudgets = 'warn';
    } else {
        ptsBudgets = 0;
        statusBudgets = 'fail';
    }

    const totalScore = Math.max(0, Math.min(100, ptsSavings + ptsBills + ptsMeta + ptsBudgets));

    let scoreClass = 'critica';
    let badgeText = 'Crítico';
    if (totalScore >= 80) {
        scoreClass = 'excelente';
        badgeText = 'Excelente';
    } else if (totalScore >= 60) {
        scoreClass = 'boa';
        badgeText = 'Bom';
    } else if (totalScore >= 40) {
        scoreClass = 'atencao';
        badgeText = 'Atenção';
    }

    let tip = 'Mantenha seus lançamentos atualizados para um diagnóstico de alta precisão.';
    if (overdueCount > 0) {
        tip = `Você possui ${overdueCount} conta(s) pendente(s) ou vencida(s). Priorize quitá-la(s) para evitar cobrança de juros e multas!`;
    } else if (breachedBudgets > 0) {
        tip = `Você ultrapassou o teto em ${breachedBudgets} categoria(s). Revise os gastos variáveis para reequilibrar o orçamento.`;
    } else if (meta.remainingToEarn > 0) {
        tip = `Faltam ${formatCurrency(meta.remainingToEarn)} de receita para garantir o pagamento de todas as contas e a poupança do mês.`;
    } else if (totalIncome > 0 && totalSaved < savingsGoal) {
        tip = `Você ainda não guardou a meta de poupança estipulada (${appData.savingsPercent}%). Que tal fazer um depósito hoje?`;
    } else if (totalScore >= 80) {
        tip = 'Excelente trabalho! Suas finanças estão com nota máxima: contas em dia, meta batida e poupança protegida.';
    }

    return {
        score: totalScore,
        scoreClass,
        badgeText,
        statusSavings,
        statusBills,
        statusMeta,
        statusBudgets,
        tip
    };
}

function renderHealthScore() {
    const data = calculateHealthScore();
    const scoreNumEl = document.getElementById('healthScoreNumber');
    if (scoreNumEl) scoreNumEl.textContent = data.score;

    const gaugeCircle = document.getElementById('healthGaugeCircle');
    if (gaugeCircle) {
        gaugeCircle.className = `health-gauge-circle ${data.scoreClass}`;
    }

    const badgeEl = document.getElementById('healthScoreBadge');
    if (badgeEl) {
        badgeEl.className = `health-badge ${data.scoreClass}`;
        badgeEl.textContent = data.badgeText;
    }

    function setCrit(id, label, status) {
        const el = document.getElementById(id);
        if (!el) return;
        const icon = status === 'ok' ? '<i class="fas fa-circle-check text-success"></i>' :
                     status === 'warn' ? '<i class="fas fa-triangle-exclamation text-warning"></i>' :
                     '<i class="fas fa-circle-xmark text-danger"></i>';
        el.innerHTML = `${icon} <span>${label}</span>`;
    }

    setCrit('critSavings', 'Poupança do Mês', data.statusSavings);
    setCrit('critBills', 'Contas em Dia', data.statusBills);
    setCrit('critMeta', 'Meta de Renda', data.statusMeta);
    setCrit('critBudgets', 'Limites de Gastos', data.statusBudgets);

    const tipEl = document.getElementById('healthTipText');
    if (tipEl) tipEl.textContent = data.tip;
}

// ============================================
// PRÓXIMOS VENCIMENTOS E CONTAS A PAGAR
// ============================================
function getUpcomingBills() {
    const currentMonth = getCurrentMonthYear();
    const today = new Date();
    const todayDay = today.getDate();
    const todayStr = getTodayStr();

    const bills = [];

    // 1. Despesas Fixas ativas
    (appData.fixedExpenses || []).filter(f => f.active !== false).forEach(item => {
        const isPaid = (appData.expenses || []).some(e =>
            getMonthYear(e.date) === currentMonth && e.desc.toLowerCase() === item.name.toLowerCase()
        );

        if (!isPaid) {
            let status = 'future';
            let tagClass = 'soon';
            let tagLabel = `Dia ${item.dueDay}`;

            if (item.dueDay === todayDay) {
                status = 'today';
                tagClass = 'today';
                tagLabel = 'Hoje!';
            } else if (item.dueDay < todayDay) {
                status = 'overdue';
                tagClass = 'overdue';
                tagLabel = 'Vencida';
            } else if (item.dueDay - todayDay <= 7) {
                status = 'soon';
                tagClass = 'soon';
                tagLabel = `Em ${item.dueDay - todayDay}d`;
            }

            bills.push({
                id: item.id,
                name: item.name,
                value: item.value,
                category: item.category || 'Contas',
                dueDay: item.dueDay,
                type: 'fixed',
                status,
                tagClass,
                tagLabel,
                subLabel: `Fixa · Vence dia ${item.dueDay}`,
                order: status === 'overdue' ? 0 : (status === 'today' ? 1 : (status === 'soon' ? 2 : 3)),
                daysDiff: item.dueDay - todayDay
            });
        }
    });

    // 2. Gastos Detalhados pendentes ou atrasados
    (appData.detailedExpenses || []).forEach(item => {
        if (item.status === 'pago') return;

        let status = 'future';
        let tagClass = 'soon';
        let tagLabel = formatDate(item.date);

        if (item.status === 'atrasado' || item.date < todayStr) {
            status = 'overdue';
            tagClass = 'overdue';
            tagLabel = 'Atrasada';
        } else if (item.date === todayStr) {
            status = 'today';
            tagClass = 'today';
            tagLabel = 'Hoje!';
        } else {
            const d = new Date(item.date + 'T00:00:00');
            const diffDays = Math.round((d - new Date(todayStr + 'T00:00:00')) / (1000 * 60 * 60 * 24));
            if (diffDays <= 7 && diffDays > 0) {
                status = 'soon';
                tagClass = 'soon';
                tagLabel = `Em ${diffDays}d`;
            }
        }

        bills.push({
            id: item.id,
            name: item.desc,
            value: item.value,
            category: item.category || 'Outros',
            date: item.date,
            type: 'detailed',
            status,
            tagClass,
            tagLabel,
            subLabel: `${item.category} · ${formatDate(item.date)}`,
            order: status === 'overdue' ? 0 : (status === 'today' ? 1 : (status === 'soon' ? 2 : 3)),
            daysDiff: 0
        });
    });

    bills.sort((a, b) => a.order - b.order || a.daysDiff - b.daysDiff);
    return bills;
}

function renderUpcomingBills() {
    const listEl = document.getElementById('upcomingBillsList');
    const badgeEl = document.getElementById('billsDueBadge');
    if (!listEl) return;

    const bills = getUpcomingBills();

    if (badgeEl) {
        badgeEl.textContent = `${bills.length} pendente${bills.length === 1 ? '' : 's'}`;
        badgeEl.style.background = bills.length === 0 ? 'rgba(16, 185, 129, 0.12)' : '';
        badgeEl.style.color = bills.length === 0 ? '#059669' : '';
        badgeEl.style.borderColor = bills.length === 0 ? 'rgba(16, 185, 129, 0.25)' : '';
    }

    if (bills.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state" style="padding:16px 0;">
                <i class="fas fa-circle-check" style="color:var(--cor-green);font-size:2rem;margin-bottom:8px;"></i>
                <p style="font-weight:600;margin-bottom:2px;">Tudo em dia!</p>
                <small>Nenhuma conta pendente ou vencendo no momento</small>
            </div>
        `;
        return;
    }

    listEl.innerHTML = bills.slice(0, 6).map(bill => `
        <div class="upcoming-bill-row ${bill.status === 'today' ? 'due-today' : ''}">
            <div class="bill-left">
                <span class="bill-due-tag ${bill.tagClass}">${bill.tagLabel}</span>
                <div class="bill-name-wrap">
                    <strong>${escapeHtml(bill.name)}</strong>
                    <small>${escapeHtml(bill.subLabel)}</small>
                </div>
            </div>
            <div class="bill-right">
                <span class="card-value" style="font-size:0.92rem;font-weight:700;">${formatCurrency(bill.value)}</span>
                <button class="bill-pay-btn" onclick="payBillQuick('${bill.id}', '${bill.type}')" title="Marcar como Pago">
                    <i class="fas fa-check"></i> Pagar
                </button>
            </div>
        </div>
    `).join('');
}

function payBillQuick(billId, type) {
    if (type === 'fixed') {
        const item = (appData.fixedExpenses || []).find(f => f.id === billId);
        if (!item) return;

        appData.expenses.push({
            id: generateId(),
            desc: item.name,
            value: item.value,
            category: item.category || 'Contas',
            date: getTodayStr(),
            createdAt: new Date().toISOString()
        });
        saveData(appData);
        refreshAll();
        showToast(`Conta "${item.name}" paga com sucesso!` + getMetaFeedback());
    } else if (type === 'detailed') {
        const item = (appData.detailedExpenses || []).find(d => d.id === billId);
        if (!item) return;
        item.status = 'pago';

        const exists = (appData.expenses || []).some(e => e.id === item.id + '_exp' || (e.desc === item.desc && e.date === item.date));
        if (!exists) {
            appData.expenses.push({
                id: item.id + '_exp',
                desc: item.desc,
                value: item.value,
                category: item.category,
                date: item.date,
                createdAt: new Date().toISOString()
            });
        }
        saveData(appData);
        refreshAll();
        showToast(`Gasto "${item.desc}" marcado como pago!` + getMetaFeedback());
    }
}

// Auto-cura e migração de investimentos que possam ter sido registrados em despesas
function migrateInvestmentExpenses() {
    if (!Array.isArray(appData.investments)) appData.investments = [];
    if (!Array.isArray(appData.expenses)) appData.expenses = [];

    const isInvestmentExpense = (item) => {
        if (!item) return false;
        const cat = (item.category || '').toLowerCase();
        const desc = (item.desc || '').toLowerCase();
        return cat === 'investimentos' || 
               desc.startsWith('aporte:') || 
               desc.startsWith('investimento:') ||
               desc === 'investimento' ||
               desc.startsWith('aporte ') ||
               desc.startsWith('investimento ');
    };

    const investmentExpenses = appData.expenses.filter(isInvestmentExpense);

    if (investmentExpenses.length > 0) {
        investmentExpenses.forEach(exp => {
            const exists = appData.investments.some(inv => 
                Math.abs((inv.investedAmount || 0) - exp.value) < 0.01 && 
                (inv.name.toLowerCase() === exp.desc.toLowerCase() || exp.desc.toLowerCase().includes(inv.name.toLowerCase()))
            );

            if (!exists) {
                let cleanName = exp.desc
                    .replace(/^Aporte:\s*/i, '')
                    .replace(/^Investimento:\s*/i, '')
                    .replace(/^Aporte\s*/i, '')
                    .replace(/^Investimento\s*/i, '')
                    .trim();
                if (!cleanName) cleanName = 'Ativo Aplicado';

                appData.investments.push({
                    id: exp.id || generateId(),
                    name: cleanName,
                    category: 'Renda Fixa',
                    institution: 'Carteira Principal',
                    investedAmount: exp.value,
                    currentAmount: exp.value,
                    date: exp.date || getTodayStr(),
                    expectedYield: '100% CDI',
                    createdAt: exp.createdAt || new Date().toISOString()
                });
            }
        });

        // Remove das despesas para NUNCA mais contar como gasto no dashboard
        appData.expenses = appData.expenses.filter(e => !isInvestmentExpense(e));
        saveData(appData);
        console.log(`[MeuFinanceiro] Migrados ${investmentExpenses.length} lançamentos de investimentos de despesas para a carteira de patrimônio.`);
    }
}

function updateSavingsProgressCard() {
    const currentMonth = getCurrentMonthYear();
    const monthIncomes = (appData.incomes || []).filter(i => getMonthYear(i.date) === currentMonth);
    const totalIncome = monthIncomes.reduce((s, i) => s + i.value, 0);
    const monthSavings = (appData.savingsTransactions || []).filter(s => getMonthYear(s.date) === currentMonth);
    const totalSaved = monthSavings.reduce((s, t) => s + (t.type === 'deposit' ? t.value : -t.value), 0);

    const savingsPercentEl = document.getElementById('savingsPercent');
    if (savingsPercentEl) savingsPercentEl.value = appData.savingsPercent || 20;

    const savingsGoal = totalIncome * ((appData.savingsPercent || 20) / 100);
    const savingsPercent = savingsGoal > 0 ? Math.min((totalSaved / savingsGoal) * 100, 100) : 0;
    const savingsProgressEl = document.getElementById('savingsProgress');
    if (savingsProgressEl) savingsProgressEl.style.width = `${savingsPercent}%`;
    const savingsProgressTextEl = document.getElementById('savingsProgressText');
    if (savingsProgressTextEl) savingsProgressTextEl.textContent = `${savingsPercent.toFixed(1)}% da meta`;
    const savingsGoalTextEl = document.getElementById('savingsGoalText');
    if (savingsGoalTextEl) savingsGoalTextEl.textContent = `Meta: ${formatCurrency(savingsGoal)}`;
}

function refreshDashboard() {
    migrateInvestmentExpenses();

    const currentMonth = getCurrentMonthYear();
    const monthIncomes = appData.incomes.filter(i => getMonthYear(i.date) === currentMonth);
    const monthExpenses = appData.expenses.filter(e => 
        getMonthYear(e.date) === currentMonth && 
        e.category !== 'Investimentos' &&
        !(e.desc && e.desc.toLowerCase().startsWith('aporte:')) &&
        !(e.desc && e.desc.toLowerCase().startsWith('investimento:'))
    );
    const monthSavings = appData.savingsTransactions.filter(s => getMonthYear(s.date) === currentMonth);

    const totalIncome = monthIncomes.reduce((s, i) => s + i.value, 0);
    const totalExpense = monthExpenses.reduce((s, e) => s + e.value, 0);
    const totalBalance = totalIncome - totalExpense;
    const totalSaved = monthSavings.reduce((s, t) => s + (t.type === 'deposit' ? t.value : -t.value), 0);

    const totalInvestedAll = (appData.investments || []).reduce((sum, inv) => sum + (inv.investedAmount || 0), 0);
    const totalCurrentInvestments = (appData.investments || []).reduce((sum, inv) => sum + (inv.currentAmount || inv.investedAmount || 0), 0);

    document.getElementById('totalIncome').textContent = formatCurrency(totalIncome);
    document.getElementById('totalExpenses').textContent = formatCurrency(totalExpense);
    document.getElementById('totalBalance').textContent = formatCurrency(totalBalance);
    const totalSavedEl = document.getElementById('totalSaved');
    if (totalSavedEl) totalSavedEl.textContent = formatCurrency(totalSaved);

    const totalInvestedEl = document.getElementById('totalInvested');
    if (totalInvestedEl) totalInvestedEl.textContent = formatCurrency(totalInvestedAll);

    document.getElementById('totalBalance').style.color = totalBalance >= 0 ? '' : 'var(--danger)';

    updateSavingsProgressCard();

    // Micro-tendências executivas para os cards
    const incomeTrendEl = document.getElementById('incomeTrendBadge');
    if (incomeTrendEl) {
        incomeTrendEl.textContent = `${monthIncomes.length} ${monthIncomes.length === 1 ? 'entrada' : 'entradas'}`;
    }

    const expenseTrendEl = document.getElementById('expenseTrendBadge');
    if (expenseTrendEl) {
        if (totalIncome > 0) {
            const expenseRatio = ((totalExpense / totalIncome) * 100).toFixed(0);
            expenseTrendEl.textContent = `${expenseRatio}% da receita`;
            expenseTrendEl.className = `stat-trend ${expenseRatio > 80 ? 'negative' : (expenseRatio > 50 ? 'neutral' : 'positive')}`;
        } else {
            expenseTrendEl.textContent = `${monthExpenses.length} ${monthExpenses.length === 1 ? 'despesa' : 'despesas'}`;
            expenseTrendEl.className = 'stat-trend neutral';
        }
    }

    const balanceTrendEl = document.getElementById('balanceTrendBadge');
    if (balanceTrendEl) {
        if (totalBalance >= 0) {
            const savingsPotential = totalIncome > 0 ? ((totalBalance / totalIncome) * 100).toFixed(0) : 0;
            balanceTrendEl.textContent = `Margem ${savingsPotential}%`;
            balanceTrendEl.className = 'stat-trend positive';
        } else {
            balanceTrendEl.textContent = 'Déficit no mês';
            balanceTrendEl.className = 'stat-trend negative';
        }
    }

    const savingsTrendEl = document.getElementById('savingsTrendBadge');
    if (savingsTrendEl) {
        const savingsGoal = totalIncome * ((appData.savingsPercent || 20) / 100);
        const savingsPercent = savingsGoal > 0 ? Math.min((totalSaved / savingsGoal) * 100, 100) : 0;
        savingsTrendEl.textContent = `${savingsPercent.toFixed(0)}% atingido`;
        savingsTrendEl.className = `stat-trend ${savingsPercent >= 100 ? 'positive' : 'info'}`;
    }

    document.getElementById('sidebarSavings').textContent = formatCurrency(appData.savingsBalance || 0);

    const netWorthEl = document.getElementById('sidebarNetWorth');
    if (netWorthEl) netWorthEl.textContent = formatCurrency((appData.savingsBalance || 0) + totalCurrentInvestments);

    refreshMetaCard();
    renderHealthScore();
    renderUpcomingBills();
    renderRecentTransactions();
    renderBarChart();
    renderDoughnutChart(monthExpenses);
    updateMonthFilters();
    updatePatrimonioConsolidatedBanner();
}

function renderRecentTransactions() {
    const allTx = [
        ...appData.incomes.map(i => ({ ...i, type: 'income' })),
        ...appData.expenses.map(e => ({ ...e, type: 'expense' }))
    ].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 8);

    const container = document.getElementById('recentTransactions');
    if (allTx.length === 0) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-receipt"></i><p>Nenhuma transação ainda</p><small>Comece adicionando receitas e despesas</small></div>`;
        return;
    }
    container.innerHTML = allTx.map(tx => `
        <div class="transaction-item">
            <div class="transaction-left">
                <div class="transaction-icon ${tx.type}"><i class="fas ${categoryIcons[tx.category] || (tx.type === 'income' ? 'fa-arrow-up' : 'fa-arrow-down')}"></i></div>
                <div class="transaction-details"><h4>${tx.desc}</h4><small>${tx.category} · ${formatDate(tx.date)}</small></div>
            </div>
            <div class="transaction-right"><span class="transaction-amount ${tx.type === 'income' ? 'positive' : 'negative'}">${tx.type === 'income' ? '+' : '-'}${formatCurrency(tx.value)}</span></div>
        </div>`).join('');
}

// ============================================
// GRÁFICO DINÂMICO POR FUNÇÃO (DASHBOARD)
// ============================================
let currentDynamicFunction = 'receitas';
let dynamicChartInstance = null;
let poupancaTabChartInstance = null;

function switchDynamicChart(funcao) {
    currentDynamicFunction = funcao;

    const tabs = document.querySelectorAll('#functionChartsTabs .func-chart-tab');
    tabs.forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-target') === funcao);
    });

    const singleBox = document.getElementById('dynamicChartSingleBox');
    const gridBox = document.getElementById('dynamicChartGridBox');

    if (funcao === 'todas' || funcao === 'all') {
        if (singleBox) singleBox.style.display = 'none';
        if (gridBox) gridBox.style.display = 'grid';
        renderBarChart();
        const currentMonth = getCurrentMonthYear();
        const monthExpenses = (appData.expenses || []).filter(e => 
            getMonthYear(e.date) === currentMonth && 
            e.category !== 'Investimentos' &&
            !(e.desc && e.desc.toLowerCase().startsWith('aporte:')) &&
            !(e.desc && e.desc.toLowerCase().startsWith('investimento:'))
        );
        renderDoughnutChart(monthExpenses);
        renderFuncaoInvestChart();
        renderFuncaoPoupancaChart();
        return;
    }

    if (gridBox) gridBox.style.display = 'none';
    if (singleBox) {
        singleBox.style.display = 'block';
        singleBox.className = `card dynamic-chart-box theme-${funcao}`;
    }

    renderDynamicFunctionChart(funcao);
}

function filterFunctionCharts(target) {
    switchDynamicChart(target);
}

function renderDynamicFunctionChart(funcao) {
    const canvas = document.getElementById('dynamicFunctionCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const emptyMsg = document.getElementById('dynamicEmptyMsg');

    if (dynamicChartInstance) {
        dynamicChartInstance.destroy();
        dynamicChartInstance = null;
    }

    const badgeEl = document.getElementById('dynamicFunctionBadge');
    const titleEl = document.getElementById('dynamicFunctionTitle');
    const descEl = document.getElementById('dynamicFunctionDesc');
    const statL1 = document.getElementById('dynamicStatLabel1');
    const statV1 = document.getElementById('dynamicStatVal1');
    const statL2 = document.getElementById('dynamicStatLabel2');
    const statV2 = document.getElementById('dynamicStatVal2');
    const statL3 = document.getElementById('dynamicStatLabel3');
    const statV3 = document.getElementById('dynamicStatVal3');

    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const currentMonth = getCurrentMonthYear();

    if (emptyMsg) emptyMsg.style.display = 'none';
    canvas.style.display = 'block';

    if (funcao === 'receitas') {
        if (badgeEl) { badgeEl.className = 'func-pill-badge pill-receitas'; badgeEl.innerHTML = '<i class="fas fa-arrow-down"></i> Função 1: Receitas & Entradas'; }
        if (titleEl) titleEl.innerHTML = '<i class="fas fa-money-bill-wave text-success"></i> Origem de Renda (Salário vs Fotos/Freela)';
        if (descEl) descEl.textContent = 'Evolução semestral detalhada separando salário fixo de trabalhos autônomos.';

        const gradSalario = ctx.createLinearGradient(0, 0, 0, 300);
        gradSalario.addColorStop(0, '#2563eb');
        gradSalario.addColorStop(1, '#3b82f6');

        const gradExtras = ctx.createLinearGradient(0, 0, 0, 300);
        gradExtras.addColorStop(0, '#06b6d4');
        gradExtras.addColorStop(1, '#22d3ee');

        const salarioData = months.map(m => {
            return (appData.incomes || [])
                .filter(i => getMonthYear(i.date) === m && (i.category === 'Salário' || (i.desc && i.desc.toLowerCase().includes('salário')) || (i.desc && i.desc.toLowerCase().includes('salario'))))
                .reduce((s, i) => s + i.value, 0);
        });

        const extrasData = months.map(m => {
            return (appData.incomes || [])
                .filter(i => getMonthYear(i.date) === m && !(i.category === 'Salário' || (i.desc && i.desc.toLowerCase().includes('salário')) || (i.desc && i.desc.toLowerCase().includes('salario'))))
                .reduce((s, i) => s + i.value, 0);
        });

        dynamicChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: months.map(m => getMonthYearLabel(m)),
                datasets: [
                    {
                        label: 'Salário Fixo / Base',
                        data: salarioData,
                        backgroundColor: gradSalario,
                        hoverBackgroundColor: '#1d4ed8',
                        borderRadius: 6,
                        barPercentage: 0.6,
                        categoryPercentage: 0.65
                    },
                    {
                        label: 'Fotos, Freelance & Extras',
                        data: extrasData,
                        backgroundColor: gradExtras,
                        hoverBackgroundColor: '#0891b2',
                        borderRadius: 6,
                        barPercentage: 0.6,
                        categoryPercentage: 0.65
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { family: 'Inter', size: 12, weight: '500' }, color: getChartTextColor() }
                    },
                    tooltip: getExecutiveTooltipConfig({
                        callbacks: {
                            footer: items => `\nTotal do Mês: ${formatCurrency(items.reduce((s, i) => s + i.parsed.y, 0))}`
                        }
                    })
                },
                scales: {
                    x: { stacked: true, ticks: { font: { family: 'Inter', size: 11 }, color: getChartTextColor() }, grid: { display: false }, border: { display: false } },
                    y: {
                        stacked: true, beginAtZero: true,
                        ticks: { callback: v => 'R$ ' + v.toLocaleString('pt-BR'), font: { family: 'Inter', size: 11 }, color: getChartTextColor() },
                        grid: { color: getChartGridColor(), borderDash: [4, 4] }, border: { display: false }
                    }
                }
            }
        });

        const curSal = (appData.incomes || []).filter(i => getMonthYear(i.date) === currentMonth && (i.category === 'Salário' || (i.desc && i.desc.toLowerCase().includes('salário')))).reduce((s, i) => s + i.value, 0);
        const curExt = (appData.incomes || []).filter(i => getMonthYear(i.date) === currentMonth && !(i.category === 'Salário' || (i.desc && i.desc.toLowerCase().includes('salário')))).reduce((s, i) => s + i.value, 0);
        const curTot = curSal + curExt;
        const total6m = salarioData.reduce((a, b) => a + b, 0) + extrasData.reduce((a, b) => a + b, 0);
        const avg6m = total6m / (months.length || 1);
        const freelaPct = curTot > 0 ? ((curExt / curTot) * 100).toFixed(0) : '0';

        if (statL1) statL1.textContent = 'Receita deste Mês';
        if (statV1) statV1.textContent = formatCurrency(curTot);
        if (statL2) statL2.textContent = 'Média Semestral';
        if (statV2) statV2.textContent = formatCurrency(avg6m);
        if (statL3) statL3.textContent = 'Fotos / Extras';
        if (statV3) statV3.textContent = `${freelaPct}% do faturamento`;
    }

    else if (funcao === 'despesas') {
        if (badgeEl) { badgeEl.className = 'func-pill-badge pill-despesas'; badgeEl.innerHTML = '<i class="fas fa-arrow-up"></i> Função 2: Despesas Reais'; }
        if (titleEl) titleEl.innerHTML = '<i class="fas fa-chart-pie text-danger"></i> Despesas Reais por Categoria (Sem Investimentos)';
        if (descEl) descEl.textContent = 'Distribuição de todos os seus gastos de consumo no mês atual.';

        const monthExpenses = (appData.expenses || []).filter(e => 
            getMonthYear(e.date) === currentMonth && 
            e.category !== 'Investimentos' &&
            !(e.desc && e.desc.toLowerCase().startsWith('aporte:')) &&
            !(e.desc && e.desc.toLowerCase().startsWith('investimento:'))
        );

        const categories = {};
        monthExpenses.forEach(e => { categories[e.category] = (categories[e.category] || 0) + e.value; });

        const labels = Object.keys(categories);
        const data = Object.values(categories);
        const colors = labels.map(l => categoryColors[l] || '#64748b');
        const totalExp = data.reduce((a, b) => a + b, 0);

        if (labels.length === 0 || totalExp === 0) {
            canvas.style.display = 'none';
            if (emptyMsg) {
                emptyMsg.style.display = 'block';
                emptyMsg.innerHTML = '<i class="fas fa-receipt"></i><p>Nenhuma despesa registrada neste mês</p>';
            }
            if (statL1) statL1.textContent = 'Gasto Real do Mês';
            if (statV1) statV1.textContent = formatCurrency(0);
            if (statL2) statL2.textContent = 'Maior Categoria';
            if (statV2) statV2.textContent = 'Sem gastos';
            if (statL3) statL3.textContent = '% da Renda';
            if (statV3) statV3.textContent = '0%';
            return;
        }

        const isDark = document.body.classList.contains('dark') || document.documentElement.getAttribute('data-bs-theme') === 'dark';

        dynamicChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: colors,
                    borderWidth: 2,
                    borderColor: isDark ? '#18181b' : '#ffffff',
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { family: 'Inter', size: 12, weight: '500' }, color: getChartTextColor() }
                    },
                    tooltip: getExecutiveTooltipConfig({
                        label: ctx => {
                            const pct = ((ctx.parsed / totalExp) * 100).toFixed(1);
                            return ` ${ctx.label}: ${formatCurrency(ctx.parsed)} (${pct}%)`;
                        }
                    })
                }
            }
        });

        let topCat = '-';
        let topVal = 0;
        Object.entries(categories).forEach(([c, v]) => { if (v > topVal) { topVal = v; topCat = c; } });
        const curInc = (appData.incomes || []).filter(i => getMonthYear(i.date) === currentMonth).reduce((s, i) => s + i.value, 0);
        const ratio = curInc > 0 ? ((totalExp / curInc) * 100).toFixed(0) : 0;

        if (statL1) statL1.textContent = 'Gasto Real do Mês';
        if (statV1) statV1.textContent = formatCurrency(totalExp);
        if (statL2) statL2.textContent = 'Maior Categoria';
        if (statV2) statV2.textContent = `${topCat} (${formatCurrency(topVal)})`;
        if (statL3) statL3.textContent = '% da Renda Comprometida';
        if (statV3) statV3.textContent = `${ratio}%`;
    }

    else if (funcao === 'investimentos') {
        if (badgeEl) { badgeEl.className = 'func-pill-badge pill-invest'; badgeEl.innerHTML = '<i class="fas fa-chart-line"></i> Função 3: Investimentos & Aportes'; }
        if (titleEl) titleEl.innerHTML = '<i class="fas fa-coins text-emerald"></i> Aportes Mensais & Evolução Investida';
        if (descEl) descEl.textContent = 'Histórico de novos aportes aplicados e crescimento acumulado da carteira.';

        const assets = Array.isArray(appData.investments) ? appData.investments : [];
        let totalInvested = 0;
        let totalCurrent = 0;
        assets.forEach(a => {
            totalInvested += (a.investedAmount || 0);
            totalCurrent += (a.currentAmount || a.investedAmount || 0);
        });
        const profit = totalCurrent - totalInvested;
        const profitPct = totalInvested > 0 ? (profit / totalInvested) * 100 : 0;

        if (assets.length === 0 || totalInvested === 0) {
            canvas.style.display = 'none';
            if (emptyMsg) {
                emptyMsg.style.display = 'block';
                emptyMsg.innerHTML = '<i class="fas fa-coins"></i><p>Nenhum investimento registrado</p><small>Cadastre seus ativos na aba Patrimônio & Investir!</small>';
            }
            if (statL1) statL1.textContent = 'Total Investido (Custo)';
            if (statV1) statV1.textContent = formatCurrency(0);
            if (statL2) statL2.textContent = 'Saldo de Mercado';
            if (statV2) statV2.textContent = formatCurrency(0);
            if (statL3) statL3.textContent = 'Rendimento Acumulado';
            if (statV3) statV3.textContent = '+0,0%';
            return;
        }

        const aportesData = months.map(m => assets.filter(a => getMonthYear(a.date) === m).reduce((s, a) => s + (a.investedAmount || 0), 0));
        let running = 0;
        const oldest = months[0];
        assets.filter(a => (a.date || '') < oldest).forEach(a => { running += (a.investedAmount || 0); });
        const acumuladoData = months.map(m => {
            running += assets.filter(a => getMonthYear(a.date) === m).reduce((s, a) => s + (a.investedAmount || 0), 0);
            return running;
        });

        const gradBar = ctx.createLinearGradient(0, 0, 0, 300);
        gradBar.addColorStop(0, '#10b981');
        gradBar.addColorStop(1, '#059669');

        dynamicChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: months.map(m => getMonthYearLabel(m)),
                datasets: [
                    {
                        type: 'bar',
                        label: 'Novo Aporte do Mês',
                        data: aportesData,
                        backgroundColor: gradBar,
                        hoverBackgroundColor: '#047857',
                        borderRadius: 6,
                        barPercentage: 0.55,
                        order: 2
                    },
                    {
                        type: 'line',
                        label: 'Total Investido (Acumulado)',
                        data: acumuladoData,
                        borderColor: '#059669',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        fill: true,
                        tension: 0.35,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        pointBackgroundColor: '#059669',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        order: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { family: 'Inter', size: 12, weight: '500' }, color: getChartTextColor() }
                    },
                    tooltip: getExecutiveTooltipConfig({
                        label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`
                    })
                },
                scales: {
                    x: { ticks: { font: { family: 'Inter', size: 11 }, color: getChartTextColor() }, grid: { display: false }, border: { display: false } },
                    y: {
                        beginAtZero: true,
                        ticks: { callback: v => 'R$ ' + v.toLocaleString('pt-BR'), font: { family: 'Inter', size: 11 }, color: getChartTextColor() },
                        grid: { color: getChartGridColor(), borderDash: [4, 4] }, border: { display: false }
                    }
                }
            }
        });

        const sign = profit >= 0 ? '+' : '';
        if (statL1) statL1.textContent = 'Total Investido (Custo)';
        if (statV1) statV1.textContent = formatCurrency(totalInvested);
        if (statL2) statL2.textContent = 'Saldo de Mercado';
        if (statV2) statV2.textContent = formatCurrency(totalCurrent);
        if (statL3) statL3.textContent = 'Rendimento Acumulado';
        if (statV3) statV3.textContent = `${sign}${formatCurrency(profit)} (${sign}${profitPct.toFixed(1)}%)`;
    }

    else if (funcao === 'poupanca') {
        if (badgeEl) { badgeEl.className = 'func-pill-badge pill-poupanca'; badgeEl.innerHTML = '<i class="fas fa-shield-halved"></i> Função 4: Poupança & Reserva'; }
        if (titleEl) titleEl.innerHTML = '<i class="fas fa-piggy-bank text-cyan"></i> Dinheiro Guardado vs Meta de Reserva';
        if (descEl) descEl.textContent = 'Evolução dos depósitos mensais rumo aos 6 meses de tranquilidade garantidos.';

        const savingsBalance = appData.savingsBalance || 0;
        const txs = Array.isArray(appData.savingsTransactions) ? appData.savingsTransactions : [];

        const fixedExpensesTotal = (appData.fixedExpenses || []).filter(f => f.active !== false).reduce((s, f) => s + f.value, 0);
        const basicMonthlyCost = fixedExpensesTotal > 0 ? fixedExpensesTotal : 706;
        const reserveTarget = basicMonthlyCost * 6;
        const monthsCovered = basicMonthlyCost > 0 ? (savingsBalance / basicMonthlyCost).toFixed(1) : 0;

        const depositsData = months.map(m => txs.filter(t => getMonthYear(t.date) === m && t.type === 'deposit').reduce((s, t) => s + t.value, 0));
        let runningBalance = 0;
        const oldest = months[0];
        txs.filter(t => (t.date || '') < oldest).forEach(t => { runningBalance += (t.type === 'deposit' ? t.value : -t.value); });
        const saldoData = months.map(m => {
            txs.filter(t => getMonthYear(t.date) === m).forEach(t => { runningBalance += (t.type === 'deposit' ? t.value : -t.value); });
            return Math.max(0, runningBalance);
        });

        const metaLineData = months.map(() => reserveTarget);

        const gradBar = ctx.createLinearGradient(0, 0, 0, 300);
        gradBar.addColorStop(0, '#0ea5e9');
        gradBar.addColorStop(1, '#0284c7');

        dynamicChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: months.map(m => getMonthYearLabel(m)),
                datasets: [
                    {
                        type: 'bar',
                        label: 'Guardado no Mês',
                        data: depositsData,
                        backgroundColor: gradBar,
                        hoverBackgroundColor: '#0369a1',
                        borderRadius: 6,
                        barPercentage: 0.55,
                        order: 2
                    },
                    {
                        type: 'line',
                        label: 'Saldo da Reserva',
                        data: saldoData,
                        borderColor: '#0284c7',
                        backgroundColor: 'rgba(14, 165, 233, 0.1)',
                        fill: true,
                        tension: 0.35,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        pointBackgroundColor: '#0284c7',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        order: 1
                    },
                    {
                        type: 'line',
                        label: 'Meta Segura (6 Meses)',
                        data: metaLineData,
                        borderColor: '#f59e0b',
                        borderDash: [6, 4],
                        borderWidth: 2,
                        pointRadius: 0,
                        fill: false,
                        order: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { family: 'Inter', size: 12, weight: '500' }, color: getChartTextColor() }
                    },
                    tooltip: getExecutiveTooltipConfig({
                        label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`
                    })
                },
                scales: {
                    x: { ticks: { font: { family: 'Inter', size: 11 }, color: getChartTextColor() }, grid: { display: false }, border: { display: false } },
                    y: {
                        beginAtZero: true,
                        ticks: { callback: v => 'R$ ' + v.toLocaleString('pt-BR'), font: { family: 'Inter', size: 11 }, color: getChartTextColor() },
                        grid: { color: getChartGridColor(), borderDash: [4, 4] }, border: { display: false }
                    }
                }
            }
        });

        if (statL1) statL1.textContent = 'Saldo Atual Guardado';
        if (statV1) statV1.textContent = formatCurrency(savingsBalance);
        if (statL2) statL2.textContent = 'Meta de 6 Meses';
        if (statV2) statV2.textContent = formatCurrency(reserveTarget);
        if (statL3) statL3.textContent = 'Meses Garantidos';
        if (statV3) statV3.textContent = `${monthsCovered} meses`;
    }
}

// ----------------------------------------------------
// GRÁFICOS DA VISÃO EM GRADE (VER TODAS)
// ----------------------------------------------------
function renderBarChart() {
    const canvas = document.getElementById('barChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    if (barChartInstance) {
        barChartInstance.destroy();
        barChartInstance = null;
    }

    const gradRec = ctx.createLinearGradient(0, 0, 0, 260);
    gradRec.addColorStop(0, '#2563eb');
    gradRec.addColorStop(1, '#60a5fa');

    const gradDesp = ctx.createLinearGradient(0, 0, 0, 260);
    gradDesp.addColorStop(0, '#ef4444');
    gradDesp.addColorStop(1, '#f87171');

    const recData = months.map(m => {
        return (appData.incomes || [])
            .filter(i => getMonthYear(i.date) === m)
            .reduce((s, i) => s + i.value, 0);
    });

    const despData = months.map(m => {
        return (appData.expenses || [])
            .filter(e => 
                getMonthYear(e.date) === m && 
                e.category !== 'Investimentos' &&
                !(e.desc && e.desc.toLowerCase().startsWith('aporte:')) &&
                !(e.desc && e.desc.toLowerCase().startsWith('investimento:'))
            )
            .reduce((s, e) => s + e.value, 0);
    });

    barChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: months.map(m => getMonthYearLabel(m)),
            datasets: [
                {
                    label: 'Receitas (Entradas)',
                    data: recData,
                    backgroundColor: gradRec,
                    hoverBackgroundColor: '#1d4ed8',
                    borderRadius: 6,
                    barPercentage: 0.65,
                    categoryPercentage: 0.7
                },
                {
                    label: 'Despesas Reais (Saídas)',
                    data: despData,
                    backgroundColor: gradDesp,
                    hoverBackgroundColor: '#b91c1c',
                    borderRadius: 6,
                    barPercentage: 0.65,
                    categoryPercentage: 0.7
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 12,
                        font: { family: 'Inter', size: 12, weight: '500' },
                        color: getChartTextColor()
                    }
                },
                tooltip: getExecutiveTooltipConfig({
                    label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`,
                    afterBody: items => {
                        if (items.length >= 2) {
                            const rec = items[0].parsed.y || 0;
                            const desp = items[1].parsed.y || 0;
                            const saldo = rec - desp;
                            const sign = saldo >= 0 ? '+' : '';
                            return `\nSaldo Líquido: ${sign}${formatCurrency(saldo)}`;
                        }
                        return '';
                    }
                })
            },
            scales: {
                x: {
                    ticks: { font: { family: 'Inter', size: 11, weight: '500' }, color: getChartTextColor() },
                    grid: { display: false },
                    border: { display: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: { callback: v => 'R$ ' + v.toLocaleString('pt-BR'), font: { family: 'Inter', size: 11 }, color: getChartTextColor() },
                    grid: { color: getChartGridColor(), borderDash: [4, 4] },
                    border: { display: false }
                }
            }
        }
    });
}

function renderDoughnutChart(monthExpenses) {
    const canvas = document.getElementById('doughnutChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const noMsg = document.getElementById('noExpensesMsg');
    const categories = {};
    (monthExpenses || []).forEach(e => { 
        if (!e) return;
        if (e.category === 'Investimentos') return;
        if (e.desc && (e.desc.toLowerCase().startsWith('aporte:') || e.desc.toLowerCase().startsWith('investimento:'))) return;
        categories[e.category] = (categories[e.category] || 0) + e.value; 
    });

    const labels = Object.keys(categories);
    const data = Object.values(categories);
    const colors = labels.map(l => categoryColors[l] || '#64748b');

    if (doughnutChartInstance) doughnutChartInstance.destroy();

    const totalExpenses = data.reduce((a, b) => a + b, 0);

    if (labels.length === 0 || totalExpenses === 0) {
        if (noMsg) noMsg.style.display = 'block';
        canvas.style.display = 'none';
        return;
    }
    if (noMsg) noMsg.style.display = 'none';
    canvas.style.display = 'block';

    const isDark = document.body.classList.contains('dark') || document.documentElement.getAttribute('data-bs-theme') === 'dark';

    doughnutChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: isDark ? '#18181b' : '#ffffff', hoverOffset: 6 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, padding: 10, color: getChartTextColor() } },
                tooltip: getExecutiveTooltipConfig({
                    label: ctx => ` ${ctx.label}: ${formatCurrency(ctx.parsed)}`
                })
            }
        }
    });
}

function renderFuncaoInvestChart() {
    const canvas = document.getElementById('chartFuncaoInvest');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const noMsg = document.getElementById('noInvestMsg');
    const assets = Array.isArray(appData.investments) ? appData.investments : [];

    if (funcInvestChartInstance) funcInvestChartInstance.destroy();

    if (assets.length === 0) {
        if (noMsg) noMsg.style.display = 'block';
        canvas.style.display = 'none';
        return;
    }
    if (noMsg) noMsg.style.display = 'none';
    canvas.style.display = 'block';

    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const aportesData = months.map(m => assets.filter(a => getMonthYear(a.date) === m).reduce((s, a) => s + (a.investedAmount || 0), 0));
    let running = 0;
    const oldest = months[0];
    assets.filter(a => (a.date || '') < oldest).forEach(a => { running += (a.investedAmount || 0); });
    const acumuladoData = months.map(m => {
        running += assets.filter(a => getMonthYear(a.date) === m).reduce((s, a) => s + (a.investedAmount || 0), 0);
        return running;
    });

    funcInvestChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: months.map(m => getMonthYearLabel(m)),
            datasets: [
                { type: 'bar', label: 'Aporte do Mês', data: aportesData, backgroundColor: '#10b981', borderRadius: 5, barPercentage: 0.55 },
                { type: 'line', label: 'Total Investido', data: acumuladoData, borderColor: '#059669', tension: 0.35, pointRadius: 3 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 10, color: getChartTextColor() } } },
            scales: {
                x: { ticks: { font: { family: 'Inter', size: 10 }, color: getChartTextColor() }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { callback: v => 'R$ ' + v.toLocaleString('pt-BR'), font: { family: 'Inter', size: 10 }, color: getChartTextColor() }, grid: { color: getChartGridColor() } }
            }
        }
    });
}

function renderFuncaoPoupancaChart() {
    const canvas = document.getElementById('chartFuncaoPoupanca');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const txs = Array.isArray(appData.savingsTransactions) ? appData.savingsTransactions : [];

    if (funcPoupancaChartInstance) funcPoupancaChartInstance.destroy();

    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const depositsData = months.map(m => txs.filter(t => getMonthYear(t.date) === m && t.type === 'deposit').reduce((s, t) => s + t.value, 0));
    let runningBalance = 0;
    const oldest = months[0];
    txs.filter(t => (t.date || '') < oldest).forEach(t => { runningBalance += (t.type === 'deposit' ? t.value : -t.value); });
    const saldoData = months.map(m => {
        txs.filter(t => getMonthYear(t.date) === m).forEach(t => { runningBalance += (t.type === 'deposit' ? t.value : -t.value); });
        return Math.max(0, runningBalance);
    });

    funcPoupancaChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: months.map(m => getMonthYearLabel(m)),
            datasets: [
                { type: 'bar', label: 'Guardado', data: depositsData, backgroundColor: '#0ea5e9', borderRadius: 5, barPercentage: 0.55 },
                { type: 'line', label: 'Saldo Poupança', data: saldoData, borderColor: '#0284c7', tension: 0.35, pointRadius: 3 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 10, color: getChartTextColor() } } },
            scales: {
                x: { ticks: { font: { family: 'Inter', size: 10 }, color: getChartTextColor() }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { callback: v => 'R$ ' + v.toLocaleString('pt-BR'), font: { family: 'Inter', size: 10 }, color: getChartTextColor() }, grid: { color: getChartGridColor() } }
            }
        }
    });
}

// ----------------------------------------------------
// GRÁFICO DEDICADO DA ABA POUPANÇA & RESERVA (PATRIMÔNIO)
// ----------------------------------------------------
function renderPoupancaTabChart() {
    const canvas = document.getElementById('poupancaTabChart');
    if (!canvas) return;

    // Se a aba de poupança NÃO está ativa, não instanciar agora para evitar quebras em canvas 0x0
    const pane = document.getElementById('tabPane-pat-poupanca');
    if (pane && !pane.classList.contains('active')) {
        return;
    }

    const emptyMsg = document.getElementById('poupancaTabChartEmpty');
    const badgeEl = document.getElementById('poupancaChartBadge');
    const savingsBalance = Number(appData.savingsBalance) || 0;
    const txs = Array.isArray(appData.savingsTransactions) ? appData.savingsTransactions : [];

    const fixedExpensesTotal = (appData.fixedExpenses || []).filter(f => f.active !== false).reduce((s, f) => s + f.value, 0);
    const basicMonthlyCost = fixedExpensesTotal > 0 ? fixedExpensesTotal : 706;
    const reserveTarget = basicMonthlyCost * 6;

    if (poupancaTabChartInstance) {
        poupancaTabChartInstance.destroy();
        poupancaTabChartInstance = null;
    }

    // Sem movimentações e sem saldo: exibir empty state
    if (txs.length === 0 && savingsBalance <= 0) {
        canvas.style.display = 'none';
        if (emptyMsg) emptyMsg.style.display = 'flex';
        if (badgeEl) {
            badgeEl.innerHTML = '<i class="fas fa-piggy-bank"></i> Sem depósitos';
            badgeEl.className = 'badge-status';
        }
        return;
    }

    // Com dados: exibir canvas e esconder empty state
    canvas.style.display = 'block';
    if (emptyMsg) emptyMsg.style.display = 'none';

    // Atualizar badge da reserva
    if (badgeEl) {
        const pct = reserveTarget > 0 ? Math.min(100, (savingsBalance / reserveTarget) * 100).toFixed(0) : 0;
        badgeEl.innerHTML = `<i class="fas fa-shield-halved"></i> ${pct}% da Reserva (${formatCurrency(savingsBalance)})`;
        badgeEl.className = `badge-status ${pct >= 100 ? 'ok' : 'warning'}`;
    }

    const ctx = canvas.getContext('2d');
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const depositsData = months.map(m => txs.filter(t => getMonthYear(t.date) === m && t.type === 'deposit').reduce((s, t) => s + t.value, 0));
    let runningBalance = 0;
    const oldest = months[0];
    txs.filter(t => (t.date || '') < oldest).forEach(t => { runningBalance += (t.type === 'deposit' ? t.value : -t.value); });
    const saldoData = months.map(m => {
        txs.filter(t => getMonthYear(t.date) === m).forEach(t => { runningBalance += (t.type === 'deposit' ? t.value : -t.value); });
        return Math.max(0, runningBalance);
    });

    const metaLineData = months.map(() => reserveTarget);

    const gradBar = ctx.createLinearGradient(0, 0, 0, 300);
    gradBar.addColorStop(0, '#0ea5e9');
    gradBar.addColorStop(1, '#0284c7');

    poupancaTabChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: months.map(m => getMonthYearLabel(m)),
            datasets: [
                {
                    type: 'bar',
                    label: 'Depósito Guardado no Mês',
                    data: depositsData,
                    backgroundColor: gradBar,
                    hoverBackgroundColor: '#0369a1',
                    borderRadius: 6,
                    barPercentage: 0.55,
                    order: 2
                },
                {
                    type: 'line',
                    label: 'Saldo Acumulado da Reserva',
                    data: saldoData,
                    borderColor: '#0284c7',
                    backgroundColor: 'rgba(14, 165, 233, 0.12)',
                    fill: true,
                    tension: 0.35,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#0284c7',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2,
                    order: 1
                },
                {
                    type: 'line',
                    label: 'Meta de Segurança (6 Meses)',
                    data: metaLineData,
                    borderColor: '#f59e0b',
                    borderDash: [6, 4],
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false,
                    order: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { family: 'Inter', size: 12, weight: '500' }, color: getChartTextColor() }
                },
                tooltip: getExecutiveTooltipConfig({
                    label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`
                })
            },
            scales: {
                x: { ticks: { font: { family: 'Inter', size: 11 }, color: getChartTextColor() }, grid: { display: false }, border: { display: false } },
                y: {
                    beginAtZero: true,
                    ticks: { callback: v => 'R$ ' + v.toLocaleString('pt-BR'), font: { family: 'Inter', size: 11 }, color: getChartTextColor() },
                    grid: { color: getChartGridColor(), borderDash: [4, 4] }, border: { display: false }
                }
            }
        }
    });
}


// ============================================
// REPORTS
// ============================================
let lineChartInstance = null;

function refreshReports() {
    const allMonths = new Set();
    appData.incomes.forEach(i => allMonths.add(getMonthYear(i.date)));
    appData.expenses.forEach(e => allMonths.add(getMonthYear(e.date)));
    appData.savingsTransactions.forEach(s => allMonths.add(getMonthYear(s.date)));
    const months = [...allMonths].sort();

    renderLineChart(months);

    const tbody = document.getElementById('monthlyReportBody');
    if (months.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-light);">Nenhum dado</td></tr>';
    } else {
        tbody.innerHTML = [...months].reverse().map(m => {
            const inc = appData.incomes.filter(i => getMonthYear(i.date) === m).reduce((s, i) => s + i.value, 0);
            const exp = appData.expenses.filter(e => getMonthYear(e.date) === m).reduce((s, e) => s + e.value, 0);
            const sav = appData.savingsTransactions.filter(s => getMonthYear(s.date) === m).reduce((s, t) => s + (t.type === 'deposit' ? t.value : -t.value), 0);
            const bal = inc - exp;
            return `<tr><td>${getMonthYearLabel(m)}</td><td class="positive">${formatCurrency(inc)}</td><td class="negative">${formatCurrency(exp)}</td><td style="color:var(--cor-accent);font-weight:600;">${formatCurrency(sav)}</td><td class="${bal >= 0 ? 'positive' : 'negative'}">${formatCurrency(bal)}</td></tr>`;
        }).join('');
    }

    const categoryReport = document.getElementById('categoryReport');
    const catTotals = {};
    appData.expenses.forEach(e => { catTotals[e.category] = (catTotals[e.category] || 0) + e.value; });
    const sorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
    const maxCat = sorted.length > 0 ? sorted[0][1] : 0;

    if (sorted.length === 0) {
        categoryReport.innerHTML = '<div class="empty-state" style="padding:24px;"><i class="fas fa-tags"></i><p>Nenhum gasto</p></div>';
    } else {
        categoryReport.innerHTML = sorted.map(([cat, val]) => `
            <div class="category-item">
                <span class="category-name">${cat}</span>
                <div class="category-bar-container"><div class="category-bar"><div class="category-bar-fill" style="width:${(val / maxCat) * 100}%;background:${categoryColors[cat] || '#64748b'};"></div></div></div>
                <span class="category-value">${formatCurrency(val)}</span>
            </div>`).join('');
    }
}

function renderLineChart(months) {
    const canvas = document.getElementById('lineChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const display = months.slice(-12);
    if (lineChartInstance) lineChartInstance.destroy();

    // Gradientes elegantes sob a curva
    const gradLineRec = ctx.createLinearGradient(0, 0, 0, 360);
    gradLineRec.addColorStop(0, 'rgba(37, 99, 235, 0.28)');
    gradLineRec.addColorStop(1, 'rgba(37, 99, 235, 0.0)');

    const gradLineDesp = ctx.createLinearGradient(0, 0, 0, 360);
    gradLineDesp.addColorStop(0, 'rgba(239, 68, 68, 0.28)');
    gradLineDesp.addColorStop(1, 'rgba(239, 68, 68, 0.0)');

    const gradLinePoup = ctx.createLinearGradient(0, 0, 0, 360);
    gradLinePoup.addColorStop(0, 'rgba(6, 182, 212, 0.28)');
    gradLinePoup.addColorStop(1, 'rgba(6, 182, 212, 0.0)');

    lineChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: display.map(m => getMonthYearLabel(m)),
            datasets: [
                {
                    label: 'Receitas',
                    data: display.map(m => appData.incomes.filter(i => getMonthYear(i.date) === m).reduce((s, i) => s + i.value, 0)),
                    borderColor: '#2563eb',
                    backgroundColor: gradLineRec,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointHoverRadius: 7,
                    pointBackgroundColor: '#2563eb',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2
                },
                {
                    label: 'Despesas',
                    data: display.map(m => appData.expenses.filter(e => getMonthYear(e.date) === m).reduce((s, e) => s + e.value, 0)),
                    borderColor: '#ef4444',
                    backgroundColor: gradLineDesp,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointHoverRadius: 7,
                    pointBackgroundColor: '#ef4444',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2
                },
                {
                    label: 'Poupança',
                    data: display.map(m => appData.savingsTransactions.filter(s => getMonthYear(s.date) === m).reduce((s, t) => s + (t.type === 'deposit' ? t.value : -t.value), 0)),
                    borderColor: '#06b6d4',
                    backgroundColor: gradLinePoup,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointHoverRadius: 7,
                    pointBackgroundColor: '#06b6d4',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 18,
                        font: { family: 'Inter', size: 12, weight: '500' },
                        color: getChartTextColor()
                    }
                },
                tooltip: getExecutiveTooltipConfig({
                    label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`
                })
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: v => 'R$ ' + v.toLocaleString('pt-BR'),
                        font: { family: 'Inter', size: 11 },
                        color: getChartTextColor()
                    },
                    grid: {
                        color: getChartGridColor(),
                        borderDash: [4, 4]
                    },
                    border: { display: false }
                },
                x: {
                    ticks: { font: { family: 'Inter', size: 11 }, color: getChartTextColor() },
                    grid: { display: false },
                    border: { display: false }
                }
            }
        }
    });
}

// ============================================
// MONTH FILTERS
// ============================================
function updateMonthFilters() {
    const allMonths = new Set();
    appData.incomes.forEach(i => allMonths.add(getMonthYear(i.date)));
    appData.expenses.forEach(e => allMonths.add(getMonthYear(e.date)));
    const months = [...allMonths].sort().reverse();

    ['incomeMonthFilter', 'expenseMonthFilter', 'allTxMonthFilter'].forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        const cur = select.value;
        select.innerHTML = '<option value="all">Todos os meses</option>' +
            months.map(m => `<option value="${m}" ${m === cur ? 'selected' : ''}>${getMonthYearLabel(m)}</option>`).join('');
    });
}

// ============================================
// BACKUP, RESTAURAÇÃO E EXPORTAÇÃO
// ============================================
function exportBackupJSON() {
    const backupObj = {
        app: 'MeuFinanceiro',
        version: '2.0',
        exportedAt: new Date().toISOString(),
        data: appData
    };
    const jsonString = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(backupObj, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', jsonString);
    dlAnchor.setAttribute('download', `meufinanceiro_backup_${getTodayStr()}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
    showToast('Backup completo baixado com sucesso!');
}

function importBackupJSON(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const parsed = JSON.parse(e.target.result);
            const importedData = parsed.data || parsed;

            if (!importedData || typeof importedData !== 'object') {
                throw new Error('Arquivo de backup inválido.');
            }

            appData = { ...defaultData, ...importedData };
            saveData(appData);
            closeModal('backup');
            initDarkMode();
            initPrivacyMode();
            refreshAll();
            showToast('Dados restaurados com sucesso!');
        } catch (err) {
            alert('Erro ao carregar o backup: ' + err.message);
        }
        event.target.value = '';
    };
    reader.readAsText(file);
}

function exportCSV() {
    const rows = [
        ['Data', 'Tipo', 'Descrição', 'Categoria', 'Valor (R$)', 'Detalhes / Pagamento', 'Status']
    ];

    // Receitas
    (appData.incomes || []).forEach(i => {
        rows.push([
            i.date,
            'Receita',
            `"${(i.desc || '').replace(/"/g, '""')}"`,
            `"${(i.category || '').replace(/"/g, '""')}"`,
            i.value.toFixed(2).replace('.', ','),
            '-',
            'Recebido'
        ]);
    });

    // Despesas do dia a dia
    (appData.expenses || []).forEach(e => {
        rows.push([
            e.date,
            'Despesa',
            `"${(e.desc || '').replace(/"/g, '""')}"`,
            `"${(e.category || '').replace(/"/g, '""')}"`,
            e.value.toFixed(2).replace('.', ','),
            '-',
            'Pago'
        ]);
    });

    // Despesas Fixas
    (appData.fixedExpenses || []).forEach(f => {
        rows.push([
            `Dia ${f.dueDay}`,
            'Despesa Fixa',
            `"${(f.name || '').replace(/"/g, '""')}"`,
            `"${(f.category || '').replace(/"/g, '""')}"`,
            f.value.toFixed(2).replace('.', ','),
            `"${(f.notes || '').replace(/"/g, '""')}"`,
            f.active !== false ? 'Ativa' : 'Inativa'
        ]);
    });

    // Gastos Detalhados
    (appData.detailedExpenses || []).forEach(d => {
        rows.push([
            d.date,
            'Gasto Detalhado',
            `"${(d.desc || '').replace(/"/g, '""')}"`,
            `"${(d.category || '').replace(/"/g, '""')}"`,
            d.value.toFixed(2).replace('.', ','),
            `"${d.payment || ''}${d.installments > 1 ? ` (${d.installments}x)` : ''}"`,
            d.status || 'pendente'
        ]);
    });

    // Investimentos & Carteira
    (appData.investments || []).forEach(inv => {
        const profit = (inv.currentAmount || 0) - (inv.investedAmount || 0);
        rows.push([
            inv.date || '-',
            'Investimento',
            `"${(inv.name || '').replace(/"/g, '""')}"`,
            `"${(inv.category || '').replace(/"/g, '""')}"`,
            (inv.currentAmount || 0).toFixed(2).replace('.', ','),
            `"${(inv.institution || '')} | Custo: ${formatCurrency(inv.investedAmount || 0)} | Lucro: ${formatCurrency(profit)}"`,
            'Ativo'
        ]);
    });

    const csvContent = '\uFEFF' + rows.map(r => r.join(';')).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meufinanceiro_movimentacoes_${getTodayStr()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Planilha CSV baixada com sucesso!');
}

function printReport() {
    closeModal('backup');
    setTimeout(() => {
        window.print();
    }, 350);
}

// ============================================
// REFRESH ALL
// ============================================
function refreshAll() {
    refreshDashboard();
    renderIncomeList();
    renderExpenseList();
    renderAllTransactionsList();
    refreshSavingsPage();
    refreshGestaoPage();
    renderPorcentagensPage();
    refreshInvestmentsPage();
    refreshRaioXPage();
    updateMonthFilters();
}

// ============================================
// INIT (integrado ao AxisDB)
// ============================================
async function init() {
    // Aguardar login (auth.js) antes de carregar qualquer dado
    let authUser = null;
    if (typeof MFAuth !== 'undefined') {
        authUser = await MFAuth.ready();
    }

    // Inicializar o banco de dados AxisDB
    if (typeof AxisDB !== 'undefined') {
        await AxisDB.init();

        // Se há PIN configurado, mostrar tela de bloqueio
        if (AxisDB.isLocked()) {
            document.getElementById('lockScreen').style.display = 'flex';
            document.getElementById('unlockPin').focus();
            console.log('🔒 MeuFinanceiro aguardando desbloqueio por PIN...');
            return; // Não inicializa o app até desbloquear
        }

        // Recarregar dados do AxisDB (pode ter sido recuperado)
        appData = loadData();
    }

    // Usar o nome da conta como saudação, se ainda não houver um nome definido
    if (authUser && authUser.name && (!appData.userName || appData.userName === 'Usuário')) {
        appData.userName = authUser.name;
    }

    startApp();
}

function startApp() {
    initDarkMode();
    initPrivacyMode();

    const now = new Date();
    document.getElementById('headerDate').textContent = now.toLocaleDateString('pt-BR', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const userNameEl = document.getElementById('userName');
    if (userNameEl) userNameEl.textContent = appData.userName || 'Usuário';
    const inlineDateEl = document.getElementById('inlineExpenseDate');
    if (inlineDateEl) inlineDateEl.value = getTodayStr();

    migrateInvestmentExpenses();
    refreshAll();
    renderTips();
    console.log('🚀 MeuFinanceiro iniciado!');

    // Criar primeiro backup automático após carregar
    if (typeof AxisDB !== 'undefined') {
        setTimeout(() => {
            AxisDB.save(appData); // Garante sync inicial com IndexedDB
        }, 3000);
    }
}

// ============================================
// BANCO DE DADOS — FUNÇÕES DE UI
// ============================================

// Desbloquear com PIN
async function handleUnlock(e) {
    e.preventDefault();
    const pin = document.getElementById('unlockPin').value;
    const errorEl = document.getElementById('unlockError');
    const btn = document.getElementById('unlockBtn');

    if (!pin || pin.length < 4) {
        errorEl.textContent = 'PIN deve ter no mínimo 4 dígitos.';
        errorEl.style.display = 'block';
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';

    try {
        const success = await AxisDB.unlock(pin);
        if (success) {
            errorEl.style.display = 'none';
            document.getElementById('lockScreen').style.display = 'none';
            appData = loadData();
            startApp();
            showToast('🔓 Banco de dados desbloqueado com sucesso!');
        } else {
            errorEl.textContent = 'PIN incorreto. Tente novamente.';
            errorEl.style.display = 'block';
            document.getElementById('unlockPin').value = '';
            document.getElementById('unlockPin').focus();
        }
    } catch (err) {
        errorEl.textContent = 'Erro ao desbloquear: ' + err.message;
        errorEl.style.display = 'block';
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-lock-open"></i> Desbloquear';
}

// Modal de configuração de PIN
let pinSetupMode = 'set'; // 'set' ou 'change'

function openPinSetupModal(mode) {
    pinSetupMode = mode;
    const titleEl = document.getElementById('pinModalTitle');
    const currentGroup = document.getElementById('pinCurrentGroup');
    const errorEl = document.getElementById('pinSetupError');

    errorEl.style.display = 'none';
    document.getElementById('pinNew').value = '';
    document.getElementById('pinConfirm').value = '';
    document.getElementById('pinCurrent').value = '';

    if (mode === 'change') {
        titleEl.textContent = 'Alterar PIN de Segurança';
        currentGroup.style.display = 'block';
    } else {
        titleEl.textContent = 'Configurar PIN de Segurança';
        currentGroup.style.display = 'none';
    }

    openModal('pin-setup');
}

async function handlePinSetup(e) {
    e.preventDefault();
    const errorEl = document.getElementById('pinSetupError');
    const pinNew = document.getElementById('pinNew').value;
    const pinConfirm = document.getElementById('pinConfirm').value;
    const pinCurrent = document.getElementById('pinCurrent').value;

    // Validações
    if (!/^\d{4,8}$/.test(pinNew)) {
        errorEl.textContent = 'O PIN deve conter apenas números, entre 4 e 8 dígitos.';
        errorEl.style.display = 'block';
        return;
    }

    if (pinNew !== pinConfirm) {
        errorEl.textContent = 'Os PINs não coincidem. Digite novamente.';
        errorEl.style.display = 'block';
        return;
    }

    errorEl.style.display = 'none';

    try {
        let success;
        if (pinSetupMode === 'change') {
            success = await AxisDB.changePin(pinCurrent, pinNew);
            if (!success) {
                errorEl.textContent = 'PIN atual incorreto.';
                errorEl.style.display = 'block';
                return;
            }
        } else {
            success = await AxisDB.setPin(pinNew);
        }

        if (success) {
            closeModal('pin-setup');
            showToast('🔐 PIN de segurança configurado com sucesso!');
            // Atualizar o painel de status se estiver aberto
            if (document.getElementById('modal-db-status').classList.contains('active')) {
                refreshDbStatusPanel();
            }
        } else {
            errorEl.textContent = 'Erro ao configurar PIN. Tente novamente.';
            errorEl.style.display = 'block';
        }
    } catch (err) {
        errorEl.textContent = 'Erro: ' + err.message;
        errorEl.style.display = 'block';
    }
}

async function handleRemovePin() {
    if (!confirm('Tem certeza que deseja remover a proteção por PIN?\n\nSeus dados ficarão sem criptografia.')) return;

    const pin = prompt('Digite seu PIN atual para confirmar a remoção:');
    if (!pin) return;

    try {
        const success = await AxisDB.removePin(pin);
        if (success) {
            showToast('🔓 PIN removido. Dados agora sem criptografia.');
            refreshDbStatusPanel();
        } else {
            alert('PIN incorreto. A remoção foi cancelada.');
        }
    } catch (err) {
        alert('Erro ao remover PIN: ' + err.message);
    }
}

// Painel de status do banco de dados
async function openDbStatusModal() {
    openModal('db-status');
    await refreshDbStatusPanel();
}

async function refreshDbStatusPanel() {
    if (typeof AxisDB === 'undefined') return;

    try {
        // Status e Stats
        const stats = await AxisDB.getStats();
        const verification = await AxisDB.verify();

        // Integridade
        const statusBadge = document.getElementById('dbStatusBadge');
        if (verification.status === 'ok') {
            statusBadge.innerHTML = '<span class="db-badge ok"><i class="fas fa-check-circle"></i> Íntegro</span>';
        } else if (verification.status === 'warning') {
            statusBadge.innerHTML = '<span class="db-badge warning"><i class="fas fa-exclamation-triangle"></i> Atenção</span>';
        } else {
            statusBadge.innerHTML = '<span class="db-badge error"><i class="fas fa-times-circle"></i> Erro</span>';
        }

        // Último salvamento
        const lastSaveEl = document.getElementById('dbLastSave');
        lastSaveEl.textContent = stats && stats.lastSave
            ? new Date(stats.lastSave).toLocaleString('pt-BR')
            : 'Nunca';

        // Checksum
        const checksumEl = document.getElementById('dbChecksum');
        const rawLS = localStorage.getItem(STORAGE_KEY);
        if (rawLS && crypto.subtle) {
            const msgBuffer = new TextEncoder().encode(rawLS);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashHex = Array.from(new Uint8Array(hashBuffer)).map(x => x.toString(16).padStart(2, '0')).join('');
            checksumEl.textContent = hashHex.substring(0, 16) + '...' + hashHex.substring(hashHex.length - 8);
        } else {
            checksumEl.textContent = '—';
        }

        // Tamanho
        const sizeEl = document.getElementById('dbDataSize');
        if (stats && stats.dbSize) {
            const kb = (stats.dbSize / 1024).toFixed(1);
            sizeEl.textContent = kb > 1024 ? (kb / 1024).toFixed(2) + ' MB' : kb + ' KB';
        } else {
            const lsSize = rawLS ? (rawLS.length / 1024).toFixed(1) : '0';
            sizeEl.textContent = lsSize + ' KB';
        }

        // Criptografia
        const encStatusEl = document.getElementById('dbEncryptionStatus');
        const btnSet = document.getElementById('btnSetPin');
        const btnChange = document.getElementById('btnChangePin');
        const btnRemove = document.getElementById('btnRemovePin');

        if (AxisDB.isEncrypted()) {
            encStatusEl.innerHTML = '<span class="db-badge locked"><i class="fas fa-lock"></i> Ativa (AES-256-GCM)</span>';
            btnSet.style.display = 'none';
            btnChange.style.display = '';
            btnRemove.style.display = '';
        } else {
            encStatusEl.innerHTML = '<span class="db-badge off"><i class="fas fa-lock-open"></i> Desativada</span>';
            btnSet.style.display = '';
            btnChange.style.display = 'none';
            btnRemove.style.display = 'none';
        }

        // Backups
        const backups = await AxisDB.getBackups();
        document.getElementById('dbBackupCount').textContent = backups.length;
        document.getElementById('dbLastBackup').textContent = backups.length > 0
            ? new Date(backups[0].timestamp).toLocaleString('pt-BR')
            : 'Nenhum';

        const backupsListEl = document.getElementById('dbBackupsList');
        if (backups.length === 0) {
            backupsListEl.innerHTML = '<div style="color:var(--text-secondary);font-size:0.78rem;padding:8px;">Nenhum backup automático ainda. Eles são criados a cada 5 minutos de uso.</div>';
        } else {
            backupsListEl.innerHTML = backups.slice(0, 15).map(b => {
                const date = new Date(b.timestamp).toLocaleString('pt-BR');
                const size = (b.size / 1024).toFixed(1) + ' KB';
                return `<div class="db-backup-item">
                    <span class="backup-date"><i class="fas fa-clock"></i> ${date}</span>
                    <span class="backup-size">${size}</span>
                    <button class="btn btn-sm btn-outline" onclick="restoreDbBackup(${b.id})"><i class="fas fa-undo"></i> Restaurar</button>
                </div>`;
            }).join('');
        }

        // Audit Log
        const auditLog = await AxisDB.getAuditLog(20);
        const auditEl = document.getElementById('dbAuditLog');
        if (auditLog.length === 0) {
            auditEl.innerHTML = '<div style="color:var(--text-secondary);font-size:0.78rem;padding:8px;">Nenhum registro de auditoria.</div>';
        } else {
            auditEl.innerHTML = auditLog.map(entry => {
                const time = new Date(entry.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                const icon = entry.success ? '✅' : '❌';
                return `<div class="db-audit-entry">
                    <span class="audit-time">${time}</span>
                    <span class="audit-action">${entry.action}</span>
                    <span class="audit-detail">${entry.details || ''}</span>
                    <span class="audit-status">${icon}</span>
                </div>`;
            }).join('');
        }
    } catch (err) {
        console.error('[DB Status] Erro:', err);
    }
}

async function runDbVerify() {
    if (typeof AxisDB === 'undefined') return;
    try {
        const result = await AxisDB.verify();
        if (result.status === 'ok') {
            showToast('✅ Banco de dados íntegro! Nenhum problema encontrado.');
        } else if (result.status === 'warning') {
            showToast('⚠️ Atenção: ' + result.details.join(', '));
        } else {
            showToast('❌ Erro de integridade: ' + result.details.join(', '));
        }
        refreshDbStatusPanel();
    } catch (err) {
        showToast('Erro na verificação: ' + err.message);
    }
}

async function forceDbBackup() {
    if (typeof AxisDB === 'undefined') return;
    try {
        // Forçar salvamento para criar backup
        AxisDB.save(appData);
        showToast('💾 Backup criado com sucesso!');
        setTimeout(() => refreshDbStatusPanel(), 3000); // Aguardar debounce
    } catch (err) {
        showToast('Erro ao criar backup: ' + err.message);
    }
}

async function restoreDbBackup(id) {
    if (!confirm('Restaurar este backup? Os dados atuais serão substituídos.')) return;
    try {
        const data = await AxisDB.restoreBackup(id);
        if (data) {
            appData = data;
            refreshAll();
            showToast('🔄 Backup restaurado com sucesso!');
            refreshDbStatusPanel();
        } else {
            showToast('Erro ao restaurar o backup.');
        }
    } catch (err) {
        showToast('Erro: ' + err.message);
    }
}

async function confirmClearAllData() {
    if (!confirm('⚠️ ATENÇÃO!\n\nIsso apagará TODOS os seus dados financeiros permanentemente:\n• Receitas e Despesas\n• Poupança e Investimentos\n• Metas e Configurações\n• Backups automáticos\n\nEssa ação NÃO pode ser desfeita.\n\nTem certeza?')) return;

    const confirmText = prompt('Para confirmar, digite "APAGAR TUDO":');
    if (confirmText !== 'APAGAR TUDO') {
        showToast('Operação cancelada.');
        return;
    }

    try {
        if (typeof AxisDB !== 'undefined') {
            await AxisDB.clearAllData();
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
        appData = { ...defaultData };
        refreshAll();
        showToast('🗑️ Todos os dados foram apagados.');
        closeModal('db-status');
    } catch (err) {
        showToast('Erro ao limpar dados: ' + err.message);
    }
}

// Escutar eventos do AxisDB
document.addEventListener('axisdb:recovery', () => {
    appData = loadData();
    refreshAll();
    showToast('🔄 Dados recuperados automaticamente do backup!');
});

document.addEventListener('axisdb:error', (e) => {
    console.error('[AxisDB Event] Erro:', e.detail);
});

init();
