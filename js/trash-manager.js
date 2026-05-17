// =============================================
// TRASH / RECYCLE BIN MANAGEMENT SYSTEM
// =============================================
class TrashManager {
    constructor() {
        this.backendUrl = typeof getBackendUrl === 'function' ? getBackendUrl() : 'http://localhost:5000/api';
        this.trash = {
            hydrants: [],
            incidents: [],
            contacts: []
        };
        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.loadTrash();
    }

    setupEventListeners() {
        // Tab switching
        document.querySelectorAll('.trash-tab').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabName = e.currentTarget.getAttribute('data-tab');
                this.switchTab(tabName);
            });
        });

        // Empty trash button
        document.getElementById('emptyTrashBtn')?.addEventListener('click', () => {
            this.emptyTrash();
        });
    }

    switchTab(tabName) {
        // Update button states
        document.querySelectorAll('.trash-tab').forEach(btn => {
            if (btn.getAttribute('data-tab') === tabName) {
                btn.classList.remove('border-transparent', 'text-gray-600', 'hover:text-gray-800');
                btn.classList.add('border-blue-500', 'text-blue-600', 'font-semibold');
            } else {
                btn.classList.remove('border-blue-500', 'text-blue-600', 'font-semibold');
                btn.classList.add('border-transparent', 'text-gray-600', 'hover:text-gray-800');
            }
        });

        // Update content visibility
        document.querySelectorAll('.trash-tab-content').forEach(content => {
            content.classList.add('hidden');
        });
        document.getElementById(`trash-${tabName}`)?.classList.remove('hidden');
    }

    async loadTrash() {
        try {
            const response = await fetch(`${this.backendUrl}/trash`);
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.trash = result.trash;
                    console.log('✅ Trash loaded:', this.trash);
                    this.displayTrash();
                }
            }
        } catch (error) {
            console.error('Error loading trash:', error);
            this.showNotification('Error loading trash', true);
        }
    }

    displayTrash() {
        this.updateCounts();
        this.renderHydrantsTrash();
        this.renderIncidentsTrash();
        this.renderContactsTrash();
    }

    updateCounts() {
        document.getElementById('deletedHydrantsCount').textContent = this.trash.hydrants.length;
        document.getElementById('deletedIncidentsCount').textContent = this.trash.incidents.length;
        document.getElementById('deletedContactsCount').textContent = this.trash.contacts.length;
    }

    renderHydrantsTrash() {
        const container = document.getElementById('hydrants-trash-list');
        if (!container) return;

        if (this.trash.hydrants.length === 0) {
            container.innerHTML = '<p class="text-center py-8 text-gray-500">No deleted hydrants</p>';
            return;
        }

        container.innerHTML = `
            <table class="min-w-full bg-white border">
                <thead class="bg-gray-100">
                    <tr>
                        <th class="px-4 py-2 text-left text-sm font-semibold text-gray-700">Number</th>
                        <th class="px-4 py-2 text-left text-sm font-semibold text-gray-700">Address</th>
                        <th class="px-4 py-2 text-left text-sm font-semibold text-gray-700">Status</th>
                        <th class="px-4 py-2 text-left text-sm font-semibold text-gray-700">Deleted On</th>
                        <th class="px-4 py-2 text-center text-sm font-semibold text-gray-700">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.trash.hydrants.map(h => `
                        <tr class="border-b hover:bg-gray-50">
                            <td class="px-4 py-3 font-semibold">${h.number}</td>
                            <td class="px-4 py-3 text-sm">${h.address}</td>
                            <td class="px-4 py-3"><span class="status-badge status-${h.status}">${h.status.toUpperCase()}</span></td>
                            <td class="px-4 py-3 text-sm">${this.formatDate(h.deleted_at)}</td>
                            <td class="px-4 py-3 text-center space-x-2">
                                <button onclick="trashManager.restoreItem('hydrant', ${h.id})" class="text-blue-600 hover:text-blue-800 font-medium">
                                    <i data-feather="rotate-ccw" class="w-4 h-4 inline"></i> Restore
                                </button>
                                <button onclick="trashManager.deleteItemPermanently('hydrant', ${h.id})" class="text-red-600 hover:text-red-800 font-medium">
                                    <i data-feather="trash" class="w-4 h-4 inline"></i> Delete
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        if (typeof feather !== 'undefined') feather.replace();
    }

    renderIncidentsTrash() {
        const container = document.getElementById('incidents-trash-list');
        if (!container) return;

        if (this.trash.incidents.length === 0) {
            container.innerHTML = '<p class="text-center py-8 text-gray-500">No deleted incidents</p>';
            return;
        }

        container.innerHTML = `
            <table class="min-w-full bg-white border">
                <thead class="bg-gray-100">
                    <tr>
                        <th class="px-4 py-2 text-left text-sm font-semibold text-gray-700">Location</th>
                        <th class="px-4 py-2 text-left text-sm font-semibold text-gray-700">Type</th>
                        <th class="px-4 py-2 text-left text-sm font-semibold text-gray-700">Date</th>
                        <th class="px-4 py-2 text-left text-sm font-semibold text-gray-700">Distance</th>
                        <th class="px-4 py-2 text-left text-sm font-semibold text-gray-700">Response Time</th>
                        <th class="px-4 py-2 text-left text-sm font-semibold text-gray-700">Deleted On</th>
                        <th class="px-4 py-2 text-center text-sm font-semibold text-gray-700">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.trash.incidents.map(i => `
                        <tr class="border-b hover:bg-gray-50">
                            <td class="px-4 py-3 font-semibold text-sm">${i.location || 'N/A'}</td>
                            <td class="px-4 py-3 text-sm">${i.type || 'N/A'}</td>
                            <td class="px-4 py-3 text-sm">${this.formatDate(i.date)}</td>
                            <td class="px-4 py-3 text-sm">${i.distance ? i.distance.toFixed(2) + ' km' : 'N/A'}</td>
                            <td class="px-4 py-3 text-sm">${i.response_time ? i.response_time.toFixed(2) + ' min' : 'N/A'}</td>
                            <td class="px-4 py-3 text-sm">${this.formatDate(i.deleted_at)}</td>
                            <td class="px-4 py-3 text-center space-x-2">
                                <button onclick="trashManager.restoreItem('incident', ${i.id})" class="text-blue-600 hover:text-blue-800 font-medium">
                                    <i data-feather="rotate-ccw" class="w-4 h-4 inline"></i> Restore
                                </button>
                                <button onclick="trashManager.deleteItemPermanently('incident', ${i.id})" class="text-red-600 hover:text-red-800 font-medium">
                                    <i data-feather="trash" class="w-4 h-4 inline"></i> Delete
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        if (typeof feather !== 'undefined') feather.replace();
    }

    renderContactsTrash() {
        const container = document.getElementById('contacts-trash-list');
        if (!container) return;

        if (this.trash.contacts.length === 0) {
            container.innerHTML = '<p class="text-center py-8 text-gray-500">No deleted contacts</p>';
            return;
        }

        container.innerHTML = `
            <table class="min-w-full bg-white border">
                <thead class="bg-gray-100">
                    <tr>
                        <th class="px-4 py-2 text-left text-sm font-semibold text-gray-700">Name</th>
                        <th class="px-4 py-2 text-left text-sm font-semibold text-gray-700">Number</th>
                        <th class="px-4 py-2 text-left text-sm font-semibold text-gray-700">Type</th>
                        <th class="px-4 py-2 text-left text-sm font-semibold text-gray-700">Deleted On</th>
                        <th class="px-4 py-2 text-center text-sm font-semibold text-gray-700">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.trash.contacts.map(c => `
                        <tr class="border-b hover:bg-gray-50">
                            <td class="px-4 py-3 font-semibold">${c.name}</td>
                            <td class="px-4 py-3 text-sm">${c.number}</td>
                            <td class="px-4 py-3"><span class="text-xs font-bold uppercase px-2 py-1 rounded bg-gray-200">${c.type || 'N/A'}</span></td>
                            <td class="px-4 py-3 text-sm">${this.formatDate(c.deleted_at)}</td>
                            <td class="px-4 py-3 text-center space-x-2">
                                <button onclick="trashManager.restoreItem('contact', ${c.id})" class="text-blue-600 hover:text-blue-800 font-medium">
                                    <i data-feather="rotate-ccw" class="w-4 h-4 inline"></i> Restore
                                </button>
                                <button onclick="trashManager.deleteItemPermanently('contact', ${c.id})" class="text-red-600 hover:text-red-800 font-medium">
                                    <i data-feather="trash" class="w-4 h-4 inline"></i> Delete
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        if (typeof feather !== 'undefined') feather.replace();
    }

    async restoreItem(itemType, itemId) {
        try {
            const response = await fetch(`${this.backendUrl}/trash/restore/${itemType}/${itemId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    await this.loadTrash();
                    this.showNotification(`${itemType.replace('_', ' ')} restored successfully!`);
                }
            } else {
                throw new Error('Failed to restore item');
            }
        } catch (error) {
            console.error('Error restoring item:', error);
            this.showNotification('Error restoring item. Please try again.', true);
        }
    }

    async deleteItemPermanently(itemType, itemId) {
        if (!confirm(`Are you sure you want to permanently delete this ${itemType.replace('_', ' ')}? This action cannot be undone.`)) {
            return;
        }

        try {
            const response = await fetch(`${this.backendUrl}/trash/delete/${itemType}/${itemId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    await this.loadTrash();
                    this.showNotification('Item permanently deleted');
                }
            } else {
                throw new Error('Failed to delete item');
            }
        } catch (error) {
            console.error('Error deleting item:', error);
            this.showNotification('Error deleting item. Please try again.', true);
        }
    }

    async emptyTrash() {
        if (!confirm('Are you sure you want to permanently delete all items in the trash? This action cannot be undone.')) {
            return;
        }

        try {
            const response = await fetch(`${this.backendUrl}/trash/empty`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    await this.loadTrash();
                    this.showNotification('Trash has been emptied');
                }
            } else {
                throw new Error('Failed to empty trash');
            }
        } catch (error) {
            console.error('Error emptying trash:', error);
            this.showNotification('Error emptying trash. Please try again.', true);
        }
    }

    formatDate(isoString) {
        if (!isoString) return 'N/A';
        const date = new Date(isoString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    getSeverityClass(severity) {
        switch(severity?.toLowerCase()) {
            case 'high': return 'bg-red-200 text-red-800';
            case 'medium': return 'bg-yellow-200 text-yellow-800';
            case 'low': return 'bg-green-200 text-green-800';
            default: return 'bg-gray-200 text-gray-800';
        }
    }

    showNotification(message, isError = false) {
        const notification = document.createElement('div');
        notification.className = `fixed right-4 px-6 py-3 rounded-lg shadow-lg ${isError ? 'bg-red-500' : 'bg-green-500'} text-white z-50 transform transition-all duration-300 min-w-max max-w-sm`;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        // Add to notification stack (if available from script.js)
        if (typeof notificationStack !== 'undefined') {
            notificationStack.add(notification);
        }
        
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (typeof notificationStack !== 'undefined') {
                    notificationStack.remove(notification);
                }
                notification.remove();
            }, 300);
        }, 3000);
    }
}

// Initialize trash manager when script loads
const trashManager = new TrashManager();
