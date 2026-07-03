// ===== State =====
let participants = [];
let savedExpenses = [];
let groupId = window.location.pathname.split('/g/').pop();
const exchangeRateCache = new Map();

let activeTab = 'add';
let editingExpenseId = null;
let settled = false;
const paidTransfers = new Set();
let addingPerson = false;
let copyTimer = null;
let countUpRaf = null;
let totalsRunId = 0;

// The design lists all amounts in USD; the backend still requires a
// displayCurrency on every expense, so it is fixed here.
const DISPLAY_CURRENCY = 'USD';

const CURRENCIES = [
    { code: 'USD', name: 'US Dollar' },
    { code: 'EUR', name: 'Euro' },
    { code: 'JPY', name: 'Japanese Yen' },
    { code: 'GBP', name: 'British Pound' },
    { code: 'CNY', name: 'Chinese Yuan' },
    { code: 'AUD', name: 'Australian Dollar' },
    { code: 'CAD', name: 'Canadian Dollar' },
    { code: 'CHF', name: 'Swiss Franc' },
    { code: 'HKD', name: 'Hong Kong Dollar' },
    { code: 'SGD', name: 'Singapore Dollar' },
    { code: 'SEK', name: 'Swedish Krona' },
    { code: 'KRW', name: 'South Korean Won' },
    { code: 'INR', name: 'Indian Rupee' },
    { code: 'BRL', name: 'Brazilian Real' },
    { code: 'RUB', name: 'Russian Ruble' },
    { code: 'ZAR', name: 'South African Rand' },
    { code: 'MXN', name: 'Mexican Peso' },
    { code: 'IDR', name: 'Indonesian Rupiah' },
    { code: 'TRY', name: 'Turkish Lira' },
    { code: 'SAR', name: 'Saudi Riyal' }
];

// Settlement data kept for rendering and PDF export
window.settlementData = {
    settlements: {},
    transfers: [],
    balances: [],
    baseCurrency: DISPLAY_CURRENCY,
    exchangeRateInfo: null
};

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initEvents();
    populateBaseCurrencySelect();

    fetch(`/api/g/${groupId}`)
        .then(response => response.json())
        .then(data => {
            if (data.participants) participants = data.participants;
            if (data.expenses) savedExpenses = data.expenses;
        })
        .catch(error => console.error('Error loading group:', error))
        .finally(() => {
            renderPeople();
            resetExpenseForm();
            updateExpenseTable();
            updateEmptyStates();
            renderTabState();
        });
});

function debounce(func, wait) {
    let timeout;
    return function () {
        const context = this;
        const args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func.apply(context, args);
        }, wait);
    };
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatNumber(amount) {
    return amount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatMoney(amount, currency) {
    return currency === 'USD' ? `$${formatNumber(amount)}` : `${currency} ${formatNumber(amount)}`;
}

// ===== Event wiring =====
function initEvents() {
    document.body.addEventListener('click', event => {
        const target = event.target.closest('[data-action]');
        if (!target) return;
        switch (target.dataset.action) {
            case 'toggle-theme': toggleTheme(); break;
            case 'copy-link': copyGroupLink(); break;
            case 'switch-tab': switchTab(target.dataset.tab); break;
            case 'start-add-person': startPersonAdd(); break;
            case 'remove-person': removeParticipant(target.dataset.name); break;
            case 'add-payer': addPayerRow(); break;
            case 'add-split': addSplitRow(); break;
            case 'split-evenly': splitEvenly(); break;
            case 'remove-row': removeEntryRow(target); break;
            case 'save-expense': saveExpense(); break;
            case 'cancel-edit': resetExpenseForm(); break;
            case 'edit-expense': editExpense(Number(target.dataset.id)); break;
            case 'delete-expense': deleteExpense(Number(target.dataset.id)); break;
            case 'toggle-transfer': toggleTransferPaid(Number(target.dataset.index)); break;
            case 'calculate': calculateSettlement(); break;
            case 'export-pdf': exportToPDF(); break;
        }
    });

    document.body.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target.classList.contains('transfer-row')) {
            event.preventDefault();
            toggleTransferPaid(Number(event.target.dataset.index));
        }
    });

    const personInput = document.getElementById('personInput');
    personInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') commitPersonAdd();
        if (event.key === 'Escape') cancelPersonAdd();
    });
    personInput.addEventListener('blur', commitPersonAdd);

    const form = document.getElementById('expenseForm');
    const debouncedTotals = debounce(recomputeTotalsIndicator, 300);
    form.addEventListener('input', event => {
        if (event.target.classList.contains('amount-input')) {
            clearEntryValidation(event.target.closest('.entry-row'));
            debouncedTotals();
        }
    });
    form.addEventListener('change', event => {
        if (event.target.classList.contains('person-select')) {
            refreshFormSelects();
            return;
        }
        if (event.target.classList.contains('amount-input') ||
            event.target.classList.contains('currency-select')) {
            recomputeTotalsIndicator();
        }
    });
}

// ===== Theme =====
function currentTheme() {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function updateThemeIcon() {
    document.getElementById('themeToggleIcon').className =
        currentTheme() === 'dark' ? 'bi bi-sun' : 'bi bi-moon';
}

function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
        localStorage.setItem('bw-theme', next);
    } catch (e) { /* storage unavailable */ }
    updateThemeIcon();
}

function initTheme() {
    updateThemeIcon();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeIcon);
}

// ===== Copy link =====
async function copyGroupLink() {
    const url = window.location.href;
    let copied = false;

    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(url);
            copied = true;
        } catch (e) { /* fall through */ }
    }
    if (!copied) {
        const textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            copied = document.execCommand('copy');
        } catch (e) { /* unsupported */ }
        textarea.remove();
    }

    if (copied) {
        const btn = document.getElementById('copyLinkBtn');
        btn.textContent = 'Copied ✓';
        clearTimeout(copyTimer);
        copyTimer = setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
    } else {
        showErrorToast('Could not copy the link.');
    }
}

// ===== Tabs =====
function switchTab(tab) {
    activeTab = tab;

    document.querySelectorAll('#desktopTabs [data-tab]').forEach(btn => {
        const isActive = btn.dataset.tab === tab;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', String(isActive));
    });
    document.querySelectorAll('#mobileTabbar [data-tab]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.getElementById('tabAddIconMobile').className =
        tab === 'add' ? 'bi bi-plus-circle-fill' : 'bi bi-plus-circle';

    ['add', 'view', 'settle'].forEach(name => {
        const pane = document.getElementById(`pane-${name}`);
        if (name === tab) {
            pane.hidden = false;
            pane.classList.remove('anim-fade-up');
            void pane.offsetWidth; // restart the fadeUp animation
            pane.classList.add('anim-fade-up');
        } else {
            pane.hidden = true;
        }
    });
}

function renderTabState() {
    const label = editingExpenseId !== null ? 'Edit' : 'Add';
    document.getElementById('tabAddLabel').textContent = label;
    document.getElementById('tabAddLabelMobile').textContent = label;
    const badge = document.getElementById('expenseCountBadge');
    badge.textContent = savedExpenses.length;
    badge.hidden = false;
}

// ===== People =====
function renderPeople() {
    const row = document.getElementById('peopleRow');
    const input = document.getElementById('personInput');
    const ghost = document.getElementById('addPersonChip');

    row.querySelectorAll('.chip').forEach(chip => chip.remove());
    participants.forEach(name => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.innerHTML = `${escapeHtml(name)}<button type="button" class="chip__x" data-action="remove-person" data-name="${escapeHtml(name)}" aria-label="Remove ${escapeHtml(name)}"><i class="bi bi-x"></i></button>`;
        row.insertBefore(chip, input);
    });

    input.hidden = !addingPerson;
    ghost.hidden = addingPerson;
}

function startPersonAdd() {
    addingPerson = true;
    const input = document.getElementById('personInput');
    input.value = '';
    renderPeople();
    input.focus();
}

function commitPersonAdd() {
    if (!addingPerson) return;
    addingPerson = false;

    const input = document.getElementById('personInput');
    const name = input.value.trim();
    input.value = '';

    if (name && !participants.includes(name)) {
        participants.push(name);
        saveParticipantsToBackend().catch(error => {
            console.error('Error saving participants:', error);
            showErrorToast('Error saving people. Please try again.');
        });
        onParticipantsChanged();
    } else {
        renderPeople();
    }
}

function cancelPersonAdd() {
    addingPerson = false;
    document.getElementById('personInput').value = '';
    renderPeople();
}

function personHasExpenses(name) {
    return savedExpenses.some(e =>
        e.payers.some(p => p.person === name) ||
        e.splits.some(s => s.person === name));
}

function removeParticipant(name) {
    if (personHasExpenses(name)) {
        showErrorToast(`${name} is part of an expense — delete that expense first.`);
        return;
    }
    participants = participants.filter(p => p !== name);
    saveParticipantsToBackend().catch(error => {
        console.error('Error saving participants:', error);
        showErrorToast('Error saving people. Please try again.');
    });
    onParticipantsChanged();
}

function onParticipantsChanged() {
    renderPeople();
    refreshFormSelects();
    if (isFormPristine()) {
        resetExpenseForm();
    }
    invalidateSettlement();
    updateEmptyStates();
}

// True while the expense form is untouched, so people changes can re-seed it.
function isFormPristine() {
    if (editingExpenseId !== null) return false;
    if (document.getElementById('expenseDescription').value.trim() !== '') return false;
    return Array.from(document.querySelectorAll('#expenseForm .amount-input'))
        .every(input => input.value.trim() === '');
}

async function saveParticipantsToBackend() {
    const response = await fetch(`/api/g/${groupId}/participants`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            participants
        })
    });

    if (!response.ok) {
        throw new Error('Failed to save participants');
    }
}

// ===== Empty states =====
function updateEmptyStates() {
    const hasPeople = participants.length > 0;
    const hasExpenses = savedExpenses.length > 0;

    document.getElementById('addEmptyState').hidden = hasPeople;
    document.getElementById('expenseForm').hidden = !hasPeople;
    document.getElementById('addHelperText').hidden = !hasPeople;

    document.getElementById('viewEmptyState').hidden = hasExpenses;
    document.getElementById('expenseTableWrap').hidden = !hasExpenses;
    document.getElementById('expenseCardsWrap').hidden = !hasExpenses;

    document.getElementById('settleEmptyState').hidden = hasExpenses;
    document.getElementById('settleControls').hidden = !hasExpenses;
    document.getElementById('settleHint').hidden = !hasExpenses || settled;
    document.getElementById('settlementResults').hidden = !settled;
}

// ===== Toasts =====
function showErrorToast(message) {
    let container = document.querySelector('.toast-container-ledger');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container-ledger';
        container.setAttribute('aria-live', 'polite');
        (document.querySelector('main.page-main') || document.body).appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast-ledger';
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `<i class="bi bi-exclamation-circle"></i>${escapeHtml(message)}`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.remove();
        if (container.children.length === 0) container.remove();
    }, 3500);
}

// ===== Backend calls =====
async function getExchangeRate(fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) {
        return 1.0;
    }

    const cacheKey = `${fromCurrency}:${toCurrency}`;
    if (exchangeRateCache.has(cacheKey)) {
        return exchangeRateCache.get(cacheKey);
    }

    const queryParams = new URLSearchParams({ from: fromCurrency, to: toCurrency });
    const rateRequest = fetch(`/api/exchange-rate?${queryParams.toString()}`)
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to fetch exchange rate');
            }
            return response.json();
        })
        .then(data => data.rate)
        .catch(error => {
            exchangeRateCache.delete(cacheKey);
            console.error('Error fetching exchange rate:', error);
            return 1.0;
        });

    exchangeRateCache.set(cacheKey, rateRequest);
    return rateRequest;
}

async function saveExpenseToBackend(expense, expenseId = null) {
    const url = expenseId
        ? `/api/g/${groupId}/expenses/${expenseId}`
        : `/api/g/${groupId}/expenses`;
    const response = await fetch(url, {
        method: expenseId ? 'PUT' : 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(expense)
    });

    if (!response.ok) {
        throw new Error('Failed to save expense');
    }

    const data = await response.json();
    return data.expense;
}

async function deleteExpenseFromBackend(id) {
    const response = await fetch(`/api/g/${groupId}/expenses/${id}`, {
        method: 'DELETE'
    });

    if (!response.ok) {
        throw new Error('Failed to delete expense');
    }
}

// ===== Amount helpers =====
function parseAmountInput(input) {
    const amount = parseFloat(input.value);
    return Number.isFinite(amount) ? amount : null;
}

function amountToCents(amount) {
    return Math.round(amount * 100);
}

async function getConvertedCents(entry, displayCurrency) {
    const amountInput = entry.querySelector('.amount-input');
    const amount = parseAmountInput(amountInput) || 0;
    const currency = entry.querySelector('.currency-select').value;
    const rate = await getExchangeRate(currency, displayCurrency);
    return amountToCents(amount * rate);
}

function formatCents(cents) {
    return formatNumber(cents / 100);
}

function amountsMatchInCents(totalPaidCents, totalSplitCents) {
    return Math.abs(totalPaidCents - totalSplitCents) <= 1;
}

function clearEntryValidation(entry) {
    if (!entry) return;
    entry.classList.remove('is-invalid');
}

function markEntryInvalid(entry) {
    entry.classList.add('is-invalid');
    return entry.querySelector('.amount-input');
}

function focusInvalidInput(input) {
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input.focus();
}

// ===== Expense form =====
function createEntryRow(prefill = {}) {
    const template = document.getElementById('entryRowTemplate');
    const row = template.content.cloneNode(true).firstElementChild;

    const personSelect = row.querySelector('.person-select');
    personSelect.innerHTML = participants
        .map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
        .join('');
    if (prefill.person) personSelect.value = prefill.person;

    const currencySelect = row.querySelector('.currency-select');
    currencySelect.innerHTML = CURRENCIES
        .map(c => `<option value="${c.code}">${c.code}</option>`)
        .join('');
    currencySelect.value = prefill.currency || DISPLAY_CURRENCY;

    if (prefill.amount !== undefined && prefill.amount !== null && prefill.amount !== '') {
        row.querySelector('.amount-input').value = prefill.amount;
    }
    return row;
}

function addEntryRow(listId, prefill) {
    const list = document.getElementById(listId);
    if (!prefill) {
        const chosen = Array.from(list.querySelectorAll('.person-select')).map(s => s.value);
        const available = participants.filter(p => !chosen.includes(p));
        if (available.length === 0) {
            showErrorToast(participants.length === 0
                ? 'Add people to the group first.'
                : (listId === 'payersList' ? 'Everyone is already a payer.' : 'Everyone is already in the split.'));
            return null;
        }
        prefill = { person: available[0] };
    }
    const row = createEntryRow(prefill);
    list.appendChild(row);
    return row;
}

function addPayerRow() {
    const row = addEntryRow('payersList');
    if (row) {
        refreshFormSelects();
        row.querySelector('.amount-input').focus();
        recomputeTotalsIndicator();
    }
}

function addSplitRow() {
    const row = addEntryRow('splitsList');
    if (row) {
        refreshFormSelects();
        recomputeTotalsIndicator();
    }
}

function removeEntryRow(btn) {
    const row = btn.closest('.entry-row');
    const list = row.parentElement;
    row.remove();
    if (list.children.length === 0) {
        if (list.id === 'payersList') addPayerRow();
        else addSplitRow();
    }
    refreshFormSelects();
    recomputeTotalsIndicator();
}

function refreshFormSelects() {
    ['payersList', 'splitsList'].forEach(listId => {
        const selects = document.getElementById(listId).querySelectorAll('.person-select');
        const chosen = Array.from(selects).map(s => s.value);
        selects.forEach(select => {
            const current = select.value;
            select.innerHTML = participants
                .filter(p => p === current || !chosen.includes(p))
                .map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
                .join('');
            select.value = current;
        });
    });
}

function resetExpenseForm() {
    editingExpenseId = null;
    document.getElementById('expenseDescription').value = '';

    const payersList = document.getElementById('payersList');
    const splitsList = document.getElementById('splitsList');
    payersList.innerHTML = '';
    splitsList.innerHTML = '';
    if (participants.length > 0) {
        payersList.appendChild(createEntryRow({ person: participants[0] }));
        participants.forEach(p => splitsList.appendChild(createEntryRow({ person: p })));
        refreshFormSelects();
    }

    setEditingUI(false);
    recomputeTotalsIndicator();
}

function setEditingUI(isEditing) {
    document.getElementById('saveExpenseBtn').textContent = isEditing ? 'Update expense' : 'Save expense';
    document.getElementById('cancelEditBtn').hidden = !isEditing;
    renderTabState();
}

async function recomputeTotalsIndicator() {
    const runId = ++totalsRunId;
    let totalPaidCents = 0;
    let totalSplitCents = 0;
    let hasAmounts = false;

    for (const row of document.querySelectorAll('#payersList .entry-row')) {
        if (row.querySelector('.amount-input').value.trim() !== '') hasAmounts = true;
        totalPaidCents += await getConvertedCents(row, DISPLAY_CURRENCY);
    }
    for (const row of document.querySelectorAll('#splitsList .entry-row')) {
        if (row.querySelector('.amount-input').value.trim() !== '') hasAmounts = true;
        totalSplitCents += await getConvertedCents(row, DISPLAY_CURRENCY);
    }

    if (runId !== totalsRunId) return; // a newer recompute superseded this one

    const indicator = document.getElementById('totalsIndicator');
    const icon = document.getElementById('totalsIcon');
    const text = document.getElementById('totalsText');
    const saveBtn = document.getElementById('saveExpenseBtn');
    const matched = totalPaidCents > 0 && amountsMatchInCents(totalPaidCents, totalSplitCents);

    if (!hasAmounts) {
        indicator.classList.remove('is-matched');
        icon.className = 'bi bi-circle';
        text.textContent = 'Enter amounts';
        saveBtn.classList.add('is-disabled');
    } else if (matched) {
        indicator.classList.add('is-matched');
        icon.className = 'bi bi-check-circle-fill';
        text.textContent = `Totals match · $${formatCents(totalPaidCents)}`;
        saveBtn.classList.remove('is-disabled');
    } else {
        indicator.classList.remove('is-matched');
        icon.className = 'bi bi-circle';
        text.textContent = `Paid $${formatCents(totalPaidCents)} · split $${formatCents(totalSplitCents)}`;
        saveBtn.classList.add('is-disabled');
    }
}

async function saveExpense() {
    const form = document.getElementById('expenseForm');
    const saveBtn = document.getElementById('saveExpenseBtn');
    const descriptionInput = document.getElementById('expenseDescription');
    const description = descriptionInput.value;

    form.querySelectorAll('.is-invalid').forEach(clearEntryValidation);

    if (!description.trim()) {
        showErrorToast('Please enter a description for the expense.');
        descriptionInput.focus();
        return;
    }

    // Rows with an empty amount are treated as untouched and skipped;
    // rows with a non-empty but invalid amount block the save.
    let totalPaidCents = 0;
    let firstInvalidInput = null;
    const payers = [];
    for (const row of document.querySelectorAll('#payersList .entry-row')) {
        const amountInput = row.querySelector('.amount-input');
        if (amountInput.value.trim() === '') continue;
        const amount = parseAmountInput(amountInput);
        if (amount === null || amount <= 0) {
            const invalidInput = markEntryInvalid(row);
            firstInvalidInput = firstInvalidInput || invalidInput;
            continue;
        }
        totalPaidCents += await getConvertedCents(row, DISPLAY_CURRENCY);
        payers.push({
            person: row.querySelector('.person-select').value,
            amount: amount,
            currency: row.querySelector('.currency-select').value
        });
    }
    if (firstInvalidInput) {
        focusInvalidInput(firstInvalidInput);
        showErrorToast('Please enter valid positive amounts for all payers.');
        return;
    }

    let totalSplitCents = 0;
    const splits = [];
    for (const row of document.querySelectorAll('#splitsList .entry-row')) {
        const amountInput = row.querySelector('.amount-input');
        if (amountInput.value.trim() === '') continue;
        const amount = parseAmountInput(amountInput);
        if (amount === null || amount <= 0) {
            const invalidInput = markEntryInvalid(row);
            firstInvalidInput = firstInvalidInput || invalidInput;
            continue;
        }
        totalSplitCents += await getConvertedCents(row, DISPLAY_CURRENCY);
        splits.push({
            person: row.querySelector('.person-select').value,
            amount: amount,
            currency: row.querySelector('.currency-select').value
        });
    }
    if (firstInvalidInput) {
        focusInvalidInput(firstInvalidInput);
        showErrorToast('Please enter valid positive amounts for all splits.');
        return;
    }

    if (payers.length === 0 || splits.length === 0) {
        showErrorToast('Enter amounts for who paid and how it splits.');
        return;
    }

    if (!amountsMatchInCents(totalPaidCents, totalSplitCents)) {
        showErrorToast('The total paid must equal the total split.');
        return;
    }

    const expense = {
        description,
        displayCurrency: DISPLAY_CURRENCY,
        payers,
        splits
    };

    const expenseId = editingExpenseId;
    saveBtn.disabled = true;
    try {
        const savedExpense = await saveExpenseToBackend(expense, expenseId);
        if (expenseId) {
            const existingIndex = savedExpenses.findIndex(e => e.id === savedExpense.id);
            if (existingIndex !== -1) {
                savedExpenses[existingIndex] = savedExpense;
            }
        } else {
            savedExpenses.push(savedExpense);
        }

        invalidateSettlement();
        await updateExpenseTable();
        resetExpenseForm();
        switchTab('view');
    } catch (error) {
        console.error('Error saving expense:', error);
        showErrorToast('Error saving expense. Please try again.');
    } finally {
        saveBtn.disabled = false;
    }
}

function editExpense(id) {
    const expense = savedExpenses.find(e => e.id === id);
    if (!expense) return;

    editingExpenseId = id;
    document.getElementById('expenseDescription').value = expense.description;

    const payersList = document.getElementById('payersList');
    const splitsList = document.getElementById('splitsList');
    payersList.innerHTML = '';
    splitsList.innerHTML = '';
    expense.payers.forEach(p => {
        payersList.appendChild(createEntryRow({ person: p.person, amount: p.amount, currency: p.currency }));
    });
    expense.splits.forEach(s => {
        splitsList.appendChild(createEntryRow({ person: s.person, amount: s.amount, currency: s.currency }));
    });
    refreshFormSelects();

    setEditingUI(true);
    switchTab('add');
    recomputeTotalsIndicator();
}

async function deleteExpense(id) {
    if (confirm('Are you sure you want to delete this expense?')) {
        try {
            await deleteExpenseFromBackend(id);
            savedExpenses = savedExpenses.filter(e => e.id !== id);
            invalidateSettlement();
            await updateExpenseTable();
        } catch (error) {
            console.error('Error deleting expense:', error);
            showErrorToast('Error deleting expense. Please try again.');
        }
    }
}

async function splitEvenly() {
    let totalPaidCents = 0;
    for (const row of document.querySelectorAll('#payersList .entry-row')) {
        totalPaidCents += await getConvertedCents(row, DISPLAY_CURRENCY);
    }

    const splitRows = document.querySelectorAll('#splitsList .entry-row');
    if (splitRows.length === 0) {
        showErrorToast('Add people to split between first.');
        return;
    }

    const baseSplitCents = Math.floor(totalPaidCents / splitRows.length);
    const remainderCents = totalPaidCents % splitRows.length;

    splitRows.forEach((row, index) => {
        const splitCents = baseSplitCents + (index < remainderCents ? 1 : 0);
        row.querySelector('.amount-input').value = (splitCents / 100).toFixed(2);
        row.querySelector('.currency-select').value = DISPLAY_CURRENCY;
        clearEntryValidation(row);
    });

    recomputeTotalsIndicator();
}

// ===== Expenses list =====
async function updateExpenseTable() {
    const processed = await Promise.all(savedExpenses.map(async expense => {
        const payers = await Promise.all(expense.payers.map(async p => {
            const rate = await getExchangeRate(p.currency, DISPLAY_CURRENCY);
            return {
                person: p.person,
                converted: p.amount * rate,
                original: `${p.currency} ${formatNumber(p.amount)}`
            };
        }));
        const splits = expense.splits.map(s => ({
            person: s.person,
            original: `${s.currency} ${formatNumber(s.amount)}`
        }));
        const total = payers.reduce((sum, p) => sum + p.converted, 0);
        return { id: expense.id, description: expense.description, payers, splits, total };
    }));

    const grandTotal = processed.reduce((sum, e) => sum + e.total, 0);

    document.getElementById('expenseTableBody').innerHTML = processed.map(e => `
        <tr>
            <td class="cell-title">${escapeHtml(e.description)}</td>
            <td>${e.payers.map(p => `<div class="person-line">${escapeHtml(p.person)} <span class="orig">${p.original}</span></div>`).join('')}</td>
            <td>${e.splits.map(s => `<div class="person-line">${escapeHtml(s.person)} <span class="orig">${s.original}</span></div>`).join('')}</td>
            <td class="cell-amount">$${formatNumber(e.total)}</td>
            <td class="cell-actions">
                <button type="button" class="row-action row-action--edit" data-action="edit-expense" data-id="${e.id}" aria-label="Edit expense"><i class="bi bi-pencil"></i></button>
                <button type="button" class="row-action row-action--delete" data-action="delete-expense" data-id="${e.id}" aria-label="Delete expense"><i class="bi bi-trash"></i></button>
            </td>
        </tr>
    `).join('');

    document.getElementById('expenseCards').innerHTML = processed.map(e => `
        <div class="expense-card-m">
            <div class="ecm-head">
                <span class="ecm-title">${escapeHtml(e.description)}</span>
                <span class="ecm-total">$${formatNumber(e.total)}</span>
            </div>
            <div class="ecm-grid">
                <div class="ecm-col">
                    <div class="ecm-label">Paid by</div>
                    ${e.payers.map(p => `<div class="ecm-line"><span class="name">${escapeHtml(p.person)}</span><span class="orig">${p.original}</span></div>`).join('')}
                </div>
                <div class="ecm-col">
                    <div class="ecm-label">Split between</div>
                    ${e.splits.map(s => `<div class="ecm-line"><span class="name">${escapeHtml(s.person)}</span><span class="orig">${s.original}</span></div>`).join('')}
                </div>
            </div>
            <div class="ecm-actions">
                <button type="button" class="ecm-edit" data-action="edit-expense" data-id="${e.id}"><i class="bi bi-pencil"></i>Edit</button>
                <button type="button" class="ecm-delete" data-action="delete-expense" data-id="${e.id}"><i class="bi bi-trash"></i>Delete</button>
            </div>
        </div>
    `).join('');

    const countText = `${processed.length} expense${processed.length === 1 ? '' : 's'}`;
    document.getElementById('expenseCountFooter').textContent = countText;
    document.getElementById('expenseCountFooterMobile').textContent = countText;
    document.getElementById('grandTotal').textContent = `$${formatNumber(grandTotal)}`;
    document.getElementById('grandTotalMobile').textContent = `$${formatNumber(grandTotal)}`;

    renderTabState();
    updateEmptyStates();
}

// ===== Settle up =====
function invalidateSettlement() {
    settled = false;
    paidTransfers.clear();
    if (countUpRaf) {
        cancelAnimationFrame(countUpRaf);
        countUpRaf = null;
    }
    window.settlementData = {
        settlements: {},
        transfers: [],
        balances: [],
        baseCurrency: DISPLAY_CURRENCY,
        exchangeRateInfo: null
    };
    document.getElementById('balancesGrid').innerHTML = '';
    document.getElementById('transfersList').innerHTML = '';
    document.getElementById('allPaidBanner').hidden = true;
    document.getElementById('exchangeRateInfo').textContent = '';
    updateEmptyStates();
}

// Greedy multi-creditor matching: largest debtor pays largest creditor first.
function computeTransfers(settlements) {
    const creditors = Object.entries(settlements)
        .filter(([, amount]) => amount > 0.005)
        .sort((a, b) => b[1] - a[1])
        .map(([person, amount]) => ({ person, amt: amount }));
    const debtors = Object.entries(settlements)
        .filter(([, amount]) => amount < -0.005)
        .sort((a, b) => a[1] - b[1])
        .map(([person, amount]) => ({ person, amt: -amount }));

    const transfers = [];
    let ci = 0;
    debtors.forEach(d => {
        let remaining = d.amt;
        while (remaining > 0.005 && ci < creditors.length) {
            const c = creditors[ci];
            const pay = Math.min(remaining, c.amt);
            transfers.push({ from: d.person, to: c.person, amount: pay });
            remaining -= pay;
            c.amt -= pay;
            if (c.amt < 0.005) ci++;
        }
    });
    return transfers;
}

async function computeBalances(settlements, baseCurrency) {
    return Promise.all(participants.map(async person => {
        let paid = 0;
        for (const expense of savedExpenses) {
            for (const p of expense.payers) {
                if (p.person !== person) continue;
                const rate = await getExchangeRate(p.currency, baseCurrency);
                paid += p.amount * rate;
            }
        }
        const net = settlements[person] || 0;
        return { person, paid, share: paid - net, net };
    }));
}

async function calculateSettlement() {
    const baseCurrency = document.getElementById('baseCurrency').value;

    try {
        const response = await fetch('/calculate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                participants,
                expenses: savedExpenses,
                baseCurrency
            })
        });
        if (!response.ok) {
            throw new Error('Failed to calculate settlement');
        }
        const data = await response.json();

        const transfers = computeTransfers(data.settlements);
        const balances = await computeBalances(data.settlements, baseCurrency);

        settled = true;
        paidTransfers.clear();
        window.settlementData = {
            settlements: { ...data.settlements },
            transfers: transfers.map(t => ({ ...t, currency: baseCurrency })),
            balances,
            baseCurrency,
            exchangeRateInfo: data.exchangeRateInfo
        };
        renderSettlement();
    } catch (error) {
        console.error('Error calculating settlement:', error);
        showErrorToast('Error calculating settlement. Please try again.');
    }
}

function renderSettlement() {
    const { balances, transfers, baseCurrency, exchangeRateInfo } = window.settlementData;

    document.getElementById('balancesGrid').innerHTML = balances.map((b, i) => `
        <div class="balance-card" style="animation-delay: ${i * 70}ms">
            <div class="balance-name">${escapeHtml(b.person)}</div>
            <div class="balance-net ${b.net >= 0 ? 'amount--pos' : 'amount--neg'}" data-target="${b.net}">${b.net >= 0 ? '+' : '−'}${formatMoney(0, baseCurrency)}</div>
            <div class="balance-detail">paid ${formatMoney(b.paid, baseCurrency)} · share ${formatMoney(b.share, baseCurrency)}</div>
        </div>
    `).join('');

    document.getElementById('transfersList').innerHTML = transfers.length === 0
        ? '<div class="tap-hint">No transfers needed — everyone is already square.</div>'
        : transfers.map((t, i) => `
            <div class="transfer-row" data-action="toggle-transfer" data-index="${i}" role="button" tabindex="0" aria-label="Mark transfer from ${escapeHtml(t.from)} to ${escapeHtml(t.to)} as paid">
                <i class="bi bi-circle t-icon"></i>
                <span class="t-name">${escapeHtml(t.from)}</span>
                <i class="bi bi-arrow-right t-arrow"></i>
                <span class="t-name">${escapeHtml(t.to)}</span>
                <span class="leader"></span>
                <span class="t-amount">${formatMoney(t.amount, baseCurrency)}</span>
            </div>
        `).join('');

    document.getElementById('allPaidBanner').hidden = true;

    if (exchangeRateInfo) {
        const timestamp = new Date(exchangeRateInfo.timestamp * 1000).toLocaleString();
        document.getElementById('exchangeRateInfo').innerHTML =
            `<i class="bi bi-info-circle"></i>Rates from ${escapeHtml(exchangeRateInfo.source)}, updated hourly · last ${escapeHtml(timestamp)}`;
    }

    updateEmptyStates();
    animateCountUp();
}

// Count the net balances up from 0 over 900ms with a cubic ease-out.
function animateCountUp() {
    const nets = Array.from(document.querySelectorAll('.balance-net'));
    const { baseCurrency } = window.settlementData;
    if (countUpRaf) cancelAnimationFrame(countUpRaf);

    const start = performance.now();
    const duration = 900;
    const step = now => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        nets.forEach(el => {
            const target = parseFloat(el.dataset.target) || 0;
            el.textContent = `${target >= 0 ? '+' : '−'}${formatMoney(Math.abs(target) * eased, baseCurrency)}`;
        });
        countUpRaf = t < 1 ? requestAnimationFrame(step) : null;
    };
    countUpRaf = requestAnimationFrame(step);
}

function toggleTransferPaid(index) {
    const row = document.querySelector(`.transfer-row[data-index="${index}"]`);
    if (!row) return;

    if (paidTransfers.has(index)) {
        paidTransfers.delete(index);
    } else {
        paidTransfers.add(index);
    }
    const isPaid = paidTransfers.has(index);
    row.classList.toggle('is-paid', isPaid);
    row.querySelector('.t-icon').className = isPaid ? 'bi bi-check-circle-fill t-icon' : 'bi bi-circle t-icon';

    const total = window.settlementData.transfers.length;
    document.getElementById('allPaidBanner').hidden = !(total > 0 && paidTransfers.size === total);
}

function populateBaseCurrencySelect() {
    document.getElementById('baseCurrency').innerHTML = CURRENCIES
        .map(c => `<option value="${c.code}">${c.code} — ${c.name}</option>`)
        .join('');
}

// ===== PDF export =====
function addCommasToNumber(numStr) {
    const parts = numStr.toString().split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
}

async function exportToPDF() {
    if (!settled || window.settlementData.balances.length === 0) {
        showErrorToast('Calculate the settlement first.');
        return;
    }

    const { balances, baseCurrency } = window.settlementData;
    const expenseTotals = await Promise.all(savedExpenses.map(async expense => {
        let total = 0;
        for (const p of expense.payers) {
            total += p.amount * await getExchangeRate(p.currency, DISPLAY_CURRENCY);
        }
        return total;
    }));

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let yPos = 20;

    // Title and basic info
    doc.setFontSize(24);
    doc.setTextColor(26, 26, 23);
    doc.text('BrokeWise', 20, yPos);
    yPos += 10;

    doc.setFontSize(16);
    doc.text('Expense Report', 20, yPos);
    yPos += 10;

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 20, yPos);
    yPos += 15;

    // Participants section
    doc.setFontSize(14);
    doc.setTextColor(26, 26, 23);
    doc.text('Participants', 20, yPos);
    yPos += 10;

    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    participants.forEach(participant => {
        doc.text(`• ${participant}`, 25, yPos);
        yPos += 6;
    });
    yPos += 10;

    // Expenses section
    doc.setFontSize(14);
    doc.setTextColor(26, 26, 23);
    doc.text('Expenses', 20, yPos);
    yPos += 10;

    const headers = ['Description', 'Paid By', 'Amount', 'Split Between'];
    const colWidths = [50, 45, 30, 45];
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);

    doc.setFillColor(240, 240, 240);
    doc.rect(20, yPos - 5, 170, 8, 'F');
    headers.forEach((header, i) => {
        let xPos = 20;
        for (let j = 0; j < i; j++) xPos += colWidths[j];
        doc.text(header, xPos + 2, yPos);
    });
    yPos += 8;

    doc.setFontSize(8);
    savedExpenses.forEach((expense, index) => {
        if (yPos > 270) {
            doc.addPage();
            yPos = 20;
        }

        const payers = expense.payers.map(p =>
            `${p.person} (${p.currency} ${addCommasToNumber(p.amount.toFixed(2))})`
        ).join('\n');

        const splits = expense.splits.map(s =>
            `${s.person} (${s.currency} ${addCommasToNumber(s.amount.toFixed(2))})`
        ).join('\n');

        const displayAmount = `${DISPLAY_CURRENCY} ${addCommasToNumber(expenseTotals[index].toFixed(2))}`;

        let xPos = 20;
        doc.text(expense.description, xPos + 2, yPos, { maxWidth: colWidths[0] - 4 });
        xPos += colWidths[0];

        doc.text(payers, xPos + 2, yPos, { maxWidth: colWidths[1] - 4 });
        xPos += colWidths[1];

        doc.text(displayAmount, xPos + 2, yPos);
        xPos += colWidths[2];

        doc.text(splits, xPos + 2, yPos, { maxWidth: colWidths[3] - 4 });

        const lineHeight = Math.max(
            doc.splitTextToSize(expense.description, colWidths[0] - 4).length,
            doc.splitTextToSize(payers, colWidths[1] - 4).length,
            doc.splitTextToSize(splits, colWidths[3] - 4).length
        ) * 4;

        yPos += lineHeight + 4;
    });

    // Settlement Summary on a new page
    doc.addPage();
    yPos = 20;

    doc.setFontSize(14);
    doc.setTextColor(26, 26, 23);
    doc.text('Settlement Summary', 20, yPos);
    yPos += 6;

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Settled in ${baseCurrency}`, 20, yPos);
    yPos += 10;

    const summaryHeaders = ['Person', 'Total Paid', 'Share', 'Net Balance'];
    const summaryColWidths = [50, 40, 40, 40];
    doc.setFontSize(10);
    doc.setFillColor(240, 240, 240);
    doc.rect(20, yPos - 5, 170, 8, 'F');
    doc.setTextColor(0, 0, 0);
    summaryHeaders.forEach((header, i) => {
        let xPos = 20;
        for (let j = 0; j < i; j++) xPos += summaryColWidths[j];
        doc.text(header, xPos + 2, yPos);
    });
    yPos += 10;

    doc.setFontSize(9);
    balances.forEach(b => {
        const cells = [
            b.person,
            `${baseCurrency} ${addCommasToNumber(b.paid.toFixed(2))}`,
            `${baseCurrency} ${addCommasToNumber(b.share.toFixed(2))}`,
            `${b.net >= 0 ? '+' : '-'}${baseCurrency} ${addCommasToNumber(Math.abs(b.net).toFixed(2))}`
        ];
        let xPos = 20;
        cells.forEach((cell, i) => {
            doc.text(cell, xPos + 2, yPos);
            xPos += summaryColWidths[i];
        });
        yPos += 7;
    });

    doc.save('brokewise-report.pdf');
}
