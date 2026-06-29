// Key System Admin Dashboard Script
document.addEventListener('DOMContentLoaded', () => {
    // API endpoint root (relative to support local and cloud deployments seamlessly)
    const API_BASE = '/api';
    const ADMIN_KEY = localStorage.getItem('adminKey') || '';
    const HARDCODED_ADMIN_KEY = '2549';

    // State
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

    // Check if user is already logged in
    if (ADMIN_KEY) {
        showDashboard();
    } else {
        loginModal.style.display = 'flex';
    }

    // Login form submission
    loginForm.addEventListener('submit', handleLogin);

    // --- Login Handler ---
    function handleLogin(e) {
        e.preventDefault();
        const key = adminKeyInput.value.trim();

        if (!key) {
            loginError.textContent = 'Please enter an admin key';
            return;
        }

        // Verify the admin key against hardcoded key
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

    // Event Listeners
    generatorForm.addEventListener('submit', handleGenerateKey);
    searchKeysInput.addEventListener('input', filterAndRenderKeys);
    btnCopyResult.addEventListener('click', () => {
        copyToClipboard(newKeyString.textContent, 'Key copied to clipboard!');
    });

    // --- Core Functions ---
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
            } else if (response.status === 401) {
                isConnected = false;
                updateStatusIndicator('offline', 'Unauthorized');
                showToast('Invalid admin key. Please enter a valid key.', 'error');
                promptForAdminKey();
            } else {
                throw new Error('Server responded with an error');
            }
        } catch (error) {
            isConnected = false;
            updateStatusIndicator('offline', 'Disconnected from Server');
            showToast('Unable to connect to Key validation server.', 'error');
        }
    }

    function updateStatusIndicator(status, message) {
        const indicator = serverStatus.querySelector('.status-indicator');
        const label = serverStatus.querySelector('.status-label');
        indicator.className = 'status-indicator ' + status;
        label.textContent = message;
    }

    // Fetch all keys
    async function loadKeys() {
        try {
            const response = await fetch(`${API_BASE}/keys`, {
                headers: {
                    'Authorization': `Bearer ${ADMIN_KEY}`
                }
            });
            if (!response.ok) throw new Error('Failed to load keys.');
           
            allKeys = await response.json();
           
            // Sort keys by createdAt descending (newest first)
            allKeys.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
           
            updateStats();
            filterAndRenderKeys();
        } catch (error) {
            console.error(error);
            keysTableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="table-empty">Error loading keys from server. Make sure it is running.</td>
                </tr>
            `;
        }
    }

    // Update top metrics
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

    // Filter and Render Keys table - IPs are completely hidden
    function filterAndRenderKeys() {
        const query = searchKeysInput.value.toLowerCase().trim();
       
        const filtered = allKeys.filter(k => {
            const keyMatch = k.key.toLowerCase().includes(query);
            const labelMatch = (k.label || '').toLowerCase().includes(query);
            const ipMatch = (k.usedIp || '').toLowerCase().includes(query);
            return keyMatch || labelMatch || ipMatch;
        });
        
        if (filtered.length === 0) {
            keysTableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="table-empty">${query ? 'No matching keys found.' : 'No keys in database. Create one above!'}</td>
                </tr>
            `;
            return;
        }
        
        keysTableBody.innerHTML = '';
        filtered.forEach(keyData => {
            const tr = document.createElement('tr');
           
            // Expiry
            let expiryStr = 'Lifetime';
            let isExpired = false;
            if (keyData.expiresAt) {
                const expDate = new Date(keyData.expiresAt);
                expiryStr = expDate.toLocaleDateString() + ' ' + expDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                if (expDate < new Date()) isExpired = true;
            }
            
            // Status Badge
            let statusBadge = '<span class="status-badge active">Active</span>';
            if (isExpired) {
                statusBadge = '<span class="status-badge expired">Expired</span>';
            } else if (keyData.usedIp) {
                statusBadge = `<span class="status-badge locked" title="First used on ${new Date(keyData.usedAt).toLocaleString()}">IP Locked</span>`;
            }
            
            // Build Row - IP completely hidden
            tr.innerHTML = `
                <td>
                    <span class="key-cell" data-key="${keyData.key}">${keyData.key}</span>
                </td>
                <td>
                    <span class="label-cell">${keyData.label ? escapeHtml(keyData.label) : '<span class="label-empty">None</span>'}</span>
                </td>
                <td>${statusBadge}</td>
                <td>
                    <span class="ip-cell">${keyData.usedIp ? escapeHtml(keyData.usedIp) : '<span class="ip-empty">Unused</span>'}</span>
                </td>
                <td style="${isExpired ? 'color: var(--danger-red); font-weight: 500;' : ''}">${expiryStr}</td>
                <td class="actions-column">
                    <div class="actions-cell-wrap">
                        ${keyData.usedIp ? `
                            <button class="btn btn-action btn-warning btn-reset" data-key="${keyData.key}" title="Reset IP lock to allow use on a different IP">
                                Reset IP
                            </button>
                        ` : ''}
                        <button class="btn btn-action btn-danger btn-delete" data-key="${keyData.key}" title="Delete license key permanently">
                            Delete
                        </button>
                    </div>
                </td>
            `;
            
            // Event Listeners
            tr.querySelector('.key-cell').addEventListener('click', () => {
                copyToClipboard(keyData.key, 'Key copied to clipboard!');
            });
            
            const btnReset = tr.querySelector('.btn-reset');
            if (btnReset) {
                btnReset.addEventListener('click', () => handleResetIp(keyData.key));
            }
            tr.querySelector('.btn-delete').addEventListener('click', () => handleDeleteKey(keyData.key));
            
            keysTableBody.appendChild(tr);
        });
    }

    // Generate Key
    async function handleGenerateKey(e) {
        e.preventDefault();
       
        const label = keyLabelInput.value.trim();
        const expiryDays = parseInt(expiryDaysInput.value) || null;
        btnGenerate.disabled = true;
        const origText = btnGenerate.innerHTML;
        btnGenerate.innerHTML = '<span>Generating...</span>';
        
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
               
                let details = `Created on ${new Date(result.key.createdAt).toLocaleDateString()}. `;
                if (result.key.expiresAt) {
                    details += `Expires on ${new Date(result.key.expiresAt).toLocaleString()}.`;
                } else {
                    details += 'Lifetime validity (never expires).';
                }
                newKeyDetails.textContent = details;
                generatedResult.style.display = 'block';
               
                keyLabelInput.value = '';
                expiryDaysInput.value = '';
                showToast('Key generated successfully!', 'success');
                loadKeys();
            } else {
                throw new Error(result.message || 'Key generation failed');
            }
        } catch (error) {
            console.error(error);
            showToast('Error generating license key: ' + error.message, 'error');
        } finally {
            btnGenerate.disabled = false;
            btnGenerate.innerHTML = origText;
        }
    }

    // 6. Reset Key IP
    async function handleResetIp(key) {
        if (!confirm(`Are you sure you want to reset the IP lock for key: ${key}?\nThis will let it lock to a new IP upon next activation.`)) {
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/keys/${key}/reset`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${ADMIN_KEY}`
                }
            });
            const result = await response.json();
            if (result.success) {
                showToast(`IP lock reset successfully for ${key}`, 'success');
                loadKeys();
            } else {
                throw new Error(result.message || 'Failed to reset IP lock');
            }
        } catch (error) {
            console.error(error);
            showToast(error.message, 'error');
        }
    }

    // Delete Key
    async function handleDeleteKey(key) {
        if (!confirm(`WARNING: Are you sure you want to delete the license key: ${key}?\nThis action is permanent.`)) return;
        
        try {
            const response = await fetch(`${API_BASE}/keys/${key}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${ADMIN_KEY}`
                }
            });
            const result = await response.json();
            if (result.success) {
                showToast(`Deleted key: ${key}`, 'success');
                if (newKeyString.textContent === key) {
                    generatedResult.style.display = 'none';
                }
                loadKeys();
            } else {
                throw new Error(result.message || 'Failed to delete key');
            }
        } catch (error) {
            console.error(error);
            showToast(error.message, 'error');
        }
    }

    // --- Helper Utilities ---

    // Prompt for admin key
    function promptForAdminKey() {
        const key = prompt('Enter admin key to access the dashboard:');
        if (key) {
            localStorage.setItem('adminKey', key);
            location.reload();
        }
    }

    // Copy to clipboard
    function copyToClipboard(text, successMsg) {
        navigator.clipboard.writeText(text).then(() => {
            showToast(successMsg, 'info');
        }).catch(err => {
            console.error('Could not copy text: ', err);
            showToast('Failed to copy. Please select and copy manually.', 'error');
        });
    }

    function showToast(message, type = 'info') {
        const toastContainer = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
       
        let typeIcon = 'ℹ️';
        if (type === 'success') typeIcon = '✅';
        if (type === 'error') typeIcon = '❌';
        toast.innerHTML = `
            <span>${typeIcon}</span>
            <span>${escapeHtml(message)}</span>
        `;
       
        toastContainer.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('toast-closing');
            toast.addEventListener('animationend', () => toast.remove());
        }, 4000);
    }

    function escapeHtml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
});
