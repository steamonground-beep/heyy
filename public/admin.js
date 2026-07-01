// Key System Admin Dashboard Script
document.addEventListener('DOMContentLoaded', () => {

    const API_BASE = '/api';
    const ADMIN_KEY = localStorage.getItem('adminKey') || '';
    const HARDCODED_ADMIN_KEY = '2549';

    let allKeys = [];
    let isConnected = false;

    // DOM Elements
    const loginModal = document.getElementById('loginModal');
    const loginForm = document.getElementById('loginForm');
    const adminKeyInput = document.getElementById('adminKeyInput');
    const loginError = document.getElementById('loginError');
    const dashboardContainer = document.getElementById('dashboardContainer');
    const serverStatus = document.getElementById('serverStatus');
    const statTotalKeys = document.getElementById('statTotalKeys');
    const statActiveKeys = document.getElementById('statActiveKeys');
    const statLockedKeys = document.getElementById('statLockedKeys');
    const generatorForm = document.getElementById('generatorForm');
    const keyLabelInput = document.getElementById('keyLabel');
    const expiryDaysInput = document.getElementById('expiryDays');
    const btnGenerate = document.getElementById('btnGenerate');
    const generatedResult = document.getElementById('generatedResult');
    const newKeyString = document.getElementById('newKeyString');
    const btnCopyResult = document.getElementById('btnCopyResult');
    const newKeyDetails = document.getElementById('newKeyDetails');
    const searchKeysInput = document.getElementById('searchKeys');
    const keysTableBody = document.getElementById('keysTableBody');

    // Login check
    if (ADMIN_KEY) {
        showDashboard();
    } else {
        loginModal.style.display = 'flex';
    }

    loginForm.addEventListener('submit', handleLogin);

    function handleLogin(e) {
        e.preventDefault();
        const key = adminKeyInput.value.trim();

        if (!key) {
            loginError.textContent = 'Please enter an admin key';
            return;
        }

        if (key === HARDCODED_ADMIN_KEY) {
            localStorage.setItem('adminKey', key);
            loginModal.style.display = 'none';
            showDashboard();
        } else {
            loginError.textContent = 'Invalid admin key';
        }
    }

    function showDashboard() {
        dashboardContainer.style.display = 'block';
        checkConnection();
        loadKeys();
    }

    // Events
    generatorForm.addEventListener('submit', handleGenerateKey);
    searchKeysInput.addEventListener('input', filterAndRenderKeys);
    btnCopyResult.addEventListener('click', () => {
        copyToClipboard(newKeyString.textContent, 'Key copied to clipboard!');
    });

    // Connection check
    async function checkConnection() {
        try {
            updateStatusIndicator('pinging', 'Checking connection...');

            const response = await fetch(`${API_BASE}/keys`, {
                headers: {
                    'Authorization': `Bearer ${ADMIN_KEY}`
                }
            });

            if (response.ok) {
                isConnected = true;
                updateStatusIndicator('online', 'Connected to Server');
            } else {
                updateStatusIndicator('offline', 'Unauthorized');
            }
        } catch (error) {
            isConnected = false;
            updateStatusIndicator('offline', 'Disconnected');
        }
    }

    function updateStatusIndicator(status, message) {
        const indicator = serverStatus.querySelector('.status-indicator');
        const label = serverStatus.querySelector('.status-label');
        indicator.className = 'status-indicator ' + status;
        label.textContent = message;
    }

    // Load keys
    async function loadKeys() {
        try {
            const response = await fetch(`${API_BASE}/keys`, {
                headers: {
                    'Authorization': `Bearer ${ADMIN_KEY}`
                }
            });

            if (!response.ok) throw new Error('Failed to load keys');

            allKeys = await response.json();

            allKeys.sort((a, b) =>
                new Date(b.createdAt) - new Date(a.createdAt)
            );

            updateStats();
            filterAndRenderKeys();

        } catch (error) {
            keysTableBody.innerHTML = `
                <tr>
                    <td colspan="6">Error loading keys</td>
                </tr>
            `;
        }
    }

    // Stats (IP still counted internally)
    function updateStats() {
        statTotalKeys.textContent = allKeys.length;

        const activeCount = allKeys.filter(k => {
            if (k.expiresAt && new Date(k.expiresAt) < new Date()) return false;
            return true;
        }).length;

        statActiveKeys.textContent = activeCount;

        const lockedCount = allKeys.filter(k => k.usedIp !== null).length;
        statLockedKeys.textContent = lockedCount;
    }

    // Render table (IP HIDDEN COMPLETELY)
    function filterAndRenderKeys() {

        const query = searchKeysInput.value.toLowerCase().trim();

        const filtered = allKeys.filter(k => {
            const keyMatch = k.key.toLowerCase().includes(query);
            const labelMatch = (k.label || '').toLowerCase().includes(query);

            // 🚫 IP SEARCH DISABLED (hidden completely)
            const ipMatch = false;

            return keyMatch || labelMatch || ipMatch;
        });

        if (filtered.length === 0) {
            keysTableBody.innerHTML = `
                <tr>
                    <td colspan="6">No keys found</td>
                </tr>
            `;
            return;
        }

        keysTableBody.innerHTML = '';

        filtered.forEach(keyData => {

            const tr = document.createElement('tr');

            let expiryStr = 'Lifetime';
            let isExpired = false;

            if (keyData.expiresAt) {
                const expDate = new Date(keyData.expiresAt);
                expiryStr = expDate.toLocaleDateString();
                if (expDate < new Date()) isExpired = true;
            }

            let statusBadge = '<span class="status-badge active">Active</span>';

            if (isExpired) {
                statusBadge = '<span class="status-badge expired">Expired</span>';
            } else if (keyData.usedIp) {
                statusBadge = `<span class="status-badge locked">IP Locked</span>`;
            }

            tr.innerHTML = `
                <td>
                    <span class="key-cell" data-key="${keyData.key}">${keyData.key}</span>
                </td>

                <td>
                    <span>${keyData.label || '<i>None</i>'}</span>
                </td>

                <td>${statusBadge}</td>

                <!-- 🚫 IP FULLY HIDDEN -->
                <td>Hidden</td>

                <td>${expiryStr}</td>

                <td>
                    ${keyData.usedIp ? `
                        <button class="btn btn-warning btn-reset" data-key="${keyData.key}">
                            Reset IP
                        </button>
                    ` : ''}

                    <button class="btn btn-danger btn-delete" data-key="${keyData.key}">
                        Delete
                    </button>
                </td>
            `;

            tr.querySelector('.key-cell').addEventListener('click', () => {
                copyToClipboard(keyData.key, 'Copied!');
            });

            const resetBtn = tr.querySelector('.btn-reset');
            if (resetBtn) {
                resetBtn.addEventListener('click', () =>
                    handleResetIp(keyData.key)
                );
            }

            tr.querySelector('.btn-delete')
                .addEventListener('click', () =>
                    handleDeleteKey(keyData.key)
                );

            keysTableBody.appendChild(tr);
        });
    }

    // Generate key
    async function handleGenerateKey(e) {
        e.preventDefault();

        const label = keyLabelInput.value.trim();
        const expiryDays = parseInt(expiryDaysInput.value) || null;

        btnGenerate.disabled = true;

        try {
            const response = await fetch(`${API_BASE}/keys`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${ADMIN_KEY}`
                },
                body: JSON.stringify({ label, expiryDays })
            });

            const result = await response.json();

            if (result.success) {
                newKeyString.textContent = result.key.key;
                generatedResult.style.display = 'block';

                keyLabelInput.value = '';
                expiryDaysInput.value = '';

                loadKeys();
            }

        } finally {
            btnGenerate.disabled = false;
        }
    }

    // Reset IP
    async function handleResetIp(key) {
        await fetch(`${API_BASE}/keys/${key}/reset`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ADMIN_KEY}`
            }
        });

        loadKeys();
    }

    // Delete key
    async function handleDeleteKey(key) {
        await fetch(`${API_BASE}/keys/${key}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${ADMIN_KEY}`
            }
        });

        loadKeys();
    }

    // Helpers
    function copyToClipboard(text, msg) {
        navigator.clipboard.writeText(text);
    }
});
