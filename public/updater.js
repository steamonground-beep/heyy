// Auto Updater Admin Page Script

document.addEventListener('DOMContentLoaded', () => {
    const API_BASE = '/api';

    const serverStatus = document.getElementById('serverStatus');
    const currentVersionLabel = document.getElementById('currentVersionLabel');
    const currentUrlLabel = document.getElementById('currentUrlLabel');
    const updateStatusIcon = document.getElementById('updateStatusIcon');
    const updaterForm = document.getElementById('updaterForm');
    const versionInput = document.getElementById('updateVersion');
    const downloadUrlInput = document.getElementById('downloadUrl');
    const releaseNotesInput = document.getElementById('releaseNotes');
    const btnPublish = document.getElementById('btnPublish');
    const btnClearUpdate = document.getElementById('btnClearUpdate');

    // Init
    loadCurrentUpdate();

    // Events
    updaterForm.addEventListener('submit', handlePublish);
    btnClearUpdate.addEventListener('click', handleClear);

    async function loadCurrentUpdate() {
        try {
            updateStatusIndicator('pinging', 'Loading...');
            const res = await fetch(`${API_BASE}/update`);
            if (!res.ok) throw new Error('Server error');
            const data = await res.json();
            updateStatusIndicator('online', 'Connected');
            renderCurrentUpdate(data);
        } catch (err) {
            updateStatusIndicator('offline', 'Disconnected');
            currentVersionLabel.textContent = 'Could not load update config.';
        }
    }

    function renderCurrentUpdate(data) {
        if (data && data.version) {
            updateStatusIcon.textContent = '✅';
            currentVersionLabel.textContent = `Published: v${data.version}`;
            currentUrlLabel.textContent = data.downloadUrl || '';
            btnClearUpdate.style.display = '';
        } else {
            updateStatusIcon.textContent = '📦';
            currentVersionLabel.textContent = 'No update currently published.';
            currentUrlLabel.textContent = 'Users will not be prompted to update.';
            btnClearUpdate.style.display = 'none';
        }
    }

    async function handlePublish(e) {
        e.preventDefault();

        const version = versionInput.value.trim();
        const downloadUrl = downloadUrlInput.value.trim();
        const releaseNotes = releaseNotesInput.value.trim();

        if (!version) { showToast('Please enter a version string.', 'error'); return; }
        if (!downloadUrl) { showToast('Please enter a download URL.', 'error'); return; }

        btnPublish.disabled = true;
        btnPublish.querySelector('span').textContent = 'Publishing...';

        try {
            const res = await fetch(`${API_BASE}/update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ version, downloadUrl, releaseNotes })
            });
            const result = await res.json();
            if (result.success) {
                showToast(`Update v${version} published successfully!`, 'success');
                renderCurrentUpdate(result.update);
                versionInput.value = '';
                downloadUrlInput.value = '';
                releaseNotesInput.value = '';
            } else {
                throw new Error(result.message || 'Failed to publish update');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        } finally {
            btnPublish.disabled = false;
            btnPublish.querySelector('span').textContent = 'Publish Update';
        }
    }

    async function handleClear() {
        if (!confirm('Clear the published update? Users will no longer be prompted to update.')) return;
        try {
            const res = await fetch(`${API_BASE}/update`, {
                method: 'DELETE'
            });
            const result = await res.json();
            if (result.success) {
                showToast('Update cleared.', 'info');
                renderCurrentUpdate(null);
            } else {
                throw new Error(result.message || 'Failed to clear update');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    }

    function updateStatusIndicator(status, message) {
        const indicator = serverStatus.querySelector('.status-indicator');
        const label = serverStatus.querySelector('.status-label');
        indicator.className = 'status-indicator ' + status;
        label.textContent = message;
    }

    function showToast(message, type = 'info') {
        const toastContainer = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        let typeIcon = 'ℹ️';
        if (type === 'success') typeIcon = '✅';
        if (type === 'error') typeIcon = '❌';
        toast.innerHTML = `<span>${typeIcon}</span><span>${escapeHtml(message)}</span>`;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('toast-closing');
            toast.addEventListener('animationend', () => toast.remove());
        }, 4000);
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
});
