// =============================================
// GLOBAL CONFIGURATION
// =============================================
function getBackendUrl() {
    // Dynamically detect the backend URL based on the current hostname
    const origin = window.location.origin;
    // If accessing via IP (like on mobile), use the same origin for API calls
    // This handles port 5000 automatically
    const url = `${origin}/api`;
    console.log(`🌐 API Backend URL: ${url}`);
    return url;
}

// Global variables for navigation and tracking
let map, currentLocationMarker, destinationMarker, routingControl;
let isTracking = false;
let watchId = null;
let previousPosition = null;
let currentPosition = null;
let destinationLatLng = null;
let currentSpeed = 0;
let currentHeading = 0;
let alternativeRoutes = [];
let currentRouteIndex = 0;
let routeLayers = [];
let lastRouteUpdatePosition = null; // To optimize route updates (distance-based)
let currentWeatherData = null;
let incidentLearner = null;

// Notification stack system for bottom-right stacking
const notificationStack = {
    notifications: [],
    add(notification) {
        this.notifications.push(notification);
        this.updatePositions();
    },
    remove(notification) {
        this.notifications = this.notifications.filter(n => n !== notification);
        this.updatePositions();
    },
    updatePositions() {
        let bottomOffset = 16; // 1rem (bottom-4 = 1rem)
        this.notifications.forEach((notif, index) => {
            notif.style.bottom = `${bottomOffset}px`;
            bottomOffset += notif.offsetHeight + 12; // 12px gap between notifications
        });
    }
};

// =============================================
// MARKER ICON HELPER FUNCTIONS
// =============================================
function createPinIcon(color = '#22c55e') {
    // Create a simple pin SVG with proper encoding
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="32" height="40">
        <path d="M12 0C7.58 0 4 3.58 4 8c0 6 8 22 8 22s8-16 8-22c0-4.42-3.58-8-8-8zm0 12c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" 
              fill="${color}" stroke="white" stroke-width="1.5"/>
    </svg>`;
    
    const encodedSvg = encodeURIComponent(svg);
    return {
        url: `data:image/svg+xml;charset=UTF-8,${encodedSvg}`,
        scaledSize: new google.maps.Size(32, 40),
        origin: new google.maps.Point(0, 0),
        anchor: new google.maps.Point(16, 40)
    };
}

function createDestinationPinIcon() {
    // Red pin for destination
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="32" height="40">
        <path d="M12 0C7.58 0 4 3.58 4 8c0 6 8 22 8 22s8-16 8-22c0-4.42-3.58-8-8-8zm0 12c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" 
              fill="#dc2626" stroke="white" stroke-width="1.5"/>
    </svg>`;
    
    const encodedSvg = encodeURIComponent(svg);
    return {
        url: `data:image/svg+xml;charset=UTF-8,${encodedSvg}`,
        scaledSize: new google.maps.Size(32, 40),
        origin: new google.maps.Point(0, 0),
        anchor: new google.maps.Point(16, 40)
    };
}

// Navigation function
function switchSection(sectionName) {
    // Role-based navigation check
    let currentUser = null;
    try {
        const userData = localStorage.getItem('bfp_admin_user');
        currentUser = userData ? JSON.parse(userData) : null;
    } catch (e) {
        currentUser = { username: localStorage.getItem('bfp_admin_user'), role: 'admin' };
    }

    if (currentUser && currentUser.role === 'user') {
        const restricted = ['analysis'];
        if (restricted.includes(sectionName)) {
            console.warn(`Access denied to section: ${sectionName} for user role`);
            showTemporaryNotification('Access Denied: You do not have permission to view this section.', true);
            return;
        }
    }

    // Hide all sections
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
        section.classList.add('hidden');
    });
    // Show selected section
    const activeSection = document.getElementById(`${sectionName}-section`);
    if (activeSection) {
        activeSection.classList.remove('hidden');
        activeSection.classList.add('active');
    }
    // Update navigation buttons
    document.querySelectorAll('.nav-btn, .nav-btn-mobile').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.section === sectionName) {
            btn.classList.add('active');
        }
    });

    // Handle Desktop Layout (Sidebar visibility)
    const sidebar = document.querySelector('.sidebar');
    const contentColumn = document.getElementById('main-content-column');
    
    if (sidebar && contentColumn && window.innerWidth >= 1024) {
        if (sectionName === 'dashboard') {
            sidebar.classList.remove('hidden');
            contentColumn.classList.replace('lg:col-span-3', 'lg:col-span-2');
        } else {
            sidebar.classList.add('hidden');
            contentColumn.classList.replace('lg:col-span-2', 'lg:col-span-3');
        }
    }

    // Close mobile sidebar when navigating
    if (window.innerWidth < 768) {
        toggleSidebar(true);
    }
    // Refresh map if switching to dashboard
    if (sectionName === 'dashboard' && map) {
        setTimeout(() => {
            map.invalidateSize();
            // Refresh hydrants and hazard roads display if manager is available
            if (typeof hydrantsManager !== 'undefined' && hydrantsManager) {
                hydrantsManager.displayHydrantsOnMap();
                hydrantsManager.displayHazardRoadsOnMap();
            }
        }, 300);
    }
    // Initialize report form when switching to incidents section
    if (sectionName === 'incidents') {
        setTimeout(initializeReportForm, 100);
    }
    // Load history when switching to history section
    if (sectionName === 'history') {
        setTimeout(loadHistory, 100);
    }
    // Load analysis when switching to analysis section
    if (sectionName === 'analysis') {
        setTimeout(loadAnalysis, 100);
    }
    // Load contacts when switching to contacts section
    if (sectionName === 'contacts') {
        setTimeout(loadEmergencyContacts, 100);
    }
    // Persist current section to localStorage
    localStorage.setItem('currentSection', sectionName);
}

// Function to load and render emergency contacts
async function loadEmergencyContacts() {
    const contactsList = document.getElementById('emergency-contacts-list');
    const contactsListMobile = document.getElementById('emergency-contacts-list-mobile');
    
    if (!contactsList && !contactsListMobile) return;

    try {
        const response = await fetch(`${getBackendUrl()}/contacts`);
        const data = await response.json();

        if (data.success && data.contacts) {
            const renderContact = (contact) => {
                let bgColor, iconColor, borderColor, iconName;
                
                switch(contact.type) {
                    case 'fire':
                        bgColor = 'bg-red-50';
                        iconColor = 'text-red-600';
                        borderColor = 'border-red-500';
                        iconName = 'phone';
                        break;
                    case 'police':
                        bgColor = 'bg-blue-50';
                        iconColor = 'text-blue-600';
                        borderColor = 'border-blue-500';
                        iconName = 'shield';
                        break;
                    case 'medical':
                        bgColor = 'bg-green-50';
                        iconColor = 'text-green-600';
                        borderColor = 'border-green-500';
                        iconName = 'heart';
                        break;
                    default:
                        bgColor = 'bg-purple-50';
                        iconColor = 'text-purple-600';
                        borderColor = 'border-purple-500';
                        iconName = 'phone';
                }

                return `
                    <div class="flex items-center space-x-4 p-4 md:p-6 ${bgColor} rounded-lg border-l-4 ${borderColor}">
                        <div class="p-3 ${bgColor.replace('50', '100')} rounded-full">
                            <i data-feather="${iconName}" class="w-6 h-6 md:w-8 md:h-8 ${iconColor}"></i>
                        </div>
                        <div class="flex-1">
                            <h3 class="font-bold text-lg md:text-xl ${iconColor.replace('600', '800')}">${contact.name}</h3>
                            <p class="${iconColor} text-lg md:text-xl font-semibold">${contact.number}</p>
                            <p class="text-sm text-gray-600 mt-1">${contact.description || ''}</p>
                        </div>
                        <a href="tel:${contact.number.replace(/[^0-9]/g, '')}" class="p-3 bg-white rounded-full shadow-sm hover:shadow-md transition-shadow">
                            <i data-feather="phone-call" class="w-5 h-5 text-gray-600"></i>
                        </a>
                    </div>
                `;
            };

            const html = data.contacts.length === 0 
                ? '<div class="text-center py-8 text-gray-500">No emergency contacts found.</div>'
                : data.contacts.map(renderContact).join('');

            if (contactsList) contactsList.innerHTML = html;
            if (contactsListMobile) contactsListMobile.innerHTML = html;
            
            // Re-initialize feather icons
            if (typeof feather !== 'undefined') {
                feather.replace();
            }
        } else {
            const errorHtml = '<div class="text-center py-8 text-red-500">Failed to load contacts.</div>';
            if (contactsList) contactsList.innerHTML = errorHtml;
            if (contactsListMobile) contactsListMobile.innerHTML = errorHtml;
        }
    } catch (error) {
        console.error('Error loading contacts:', error);
        const errorHtml = '<div class="text-center py-8 text-red-500">Error connecting to backend.</div>';
        if (contactsList) contactsList.innerHTML = errorHtml;
        if (contactsListMobile) contactsListMobile.innerHTML = errorHtml;
    }
}
// =============================================
// ENHANCED FIRE INCIDENT LEARNING SYSTEM WITH LIVE ACCURACY
// =============================================
// Enhanced RealFireIncidentLearner class with working feedback system
class RealFireIncidentLearner {
    constructor() {
        this.model = null;
        this.isTraining = false;
        this.trainingData = [];
        this.modelAccuracy = 0;
        this.backendUrl = getBackendUrl();
        // Load existing data and check model status on initialization
        this.loadIncidents();
        this.checkModelStatus();
        // Auto-refresh accuracy every 30 seconds
        setInterval(() => {
            if (this.modelAccuracy > 0) {
                this.checkModelStatus();
            }
        }, 30000);
    }
    // Check current model status from backend
    async checkModelStatus() {
        try {
            const response = await fetch(`${this.backendUrl}/model-status`);
            if (response.ok) {
                const result = await response.json();
                this.modelAccuracy = result.accuracy || result.current_accuracy || 0;
                console.log('Model status checked. Accuracy:', this.modelAccuracy);
                this.updateUI();
            }
        } catch (error) {
            console.error('Error checking model status:', error);
        }
    }
    // Load incidents from backend or local storage
    async loadIncidents() {
        try {
            console.log('🔄 Loading incidents from backend...');
            const response = await fetch(`${this.backendUrl}/incidents`);
            if (response.ok) {
                const result = await response.json();
                this.trainingData = result.incidents || [];
                // Ensure sorting: newest first
                this.trainingData.sort((a, b) => (b.id || 0) - (a.id || 0));
                console.log(`✅ Loaded ${this.trainingData.length} incidents from backend`);
                // Update local storage for redundancy
                localStorage.setItem('fireIncidents', JSON.stringify(this.trainingData));
            } else {
                console.warn('Backend load failed, falling back to local storage');
                this.trainingData = JSON.parse(localStorage.getItem('fireIncidents') || '[]');
            }
        } catch (error) {
            console.error('❌ Load incidents error:', error);
            this.trainingData = JSON.parse(localStorage.getItem('fireIncidents') || '[]');
        }
        this.updateUI();
        return this.trainingData;
    }
    // Train model with real ML
    async trainModel(incidents) {
        if (incidents.length < 5) {
            this.showNotification(`Need at least 5 incidents. Currently have ${incidents.length}`, true);
            return false;
        }
        this.isTraining = true;
        this.updateUI();
        try {
            const response = await fetch(`${this.backendUrl}/train`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ incidents: incidents })
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || 'Training failed');
            }
            
            // Fetch current model status to get actual accuracy
            await this.checkModelStatus();
            
            let message = `Model trained successfully! Accuracy: ${(this.modelAccuracy * 100).toFixed(1)}%`;
            if (result.baseline_performance && result.baseline_performance.r2) {
                const r2 = (result.baseline_performance.r2 * 100).toFixed(1);
                message += ` (R²: ${r2}%)`;
            }
            this.showNotification(message);
    
            // Get and display training feedback
            const trainingFeedback = await this.getTrainingFeedback();
            this.displayTrainingFeedback(trainingFeedback);
            
            // NEW: After training, refresh the performance analysis for the most recent incident
            if (this.trainingData.length > 0) {
                const latestIncident = [...this.trainingData].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
                const feedback = await this.getComprehensiveFeedback(latestIncident);
                if (feedback && !feedback.error) {
                    this.displayComprehensiveFeedback(feedback);
                }
            }
    
            this.updateUI();
            return true;
    
        } catch (error) {
            console.error('Training error:', error);
            this.showNotification(`Training failed: ${error.message}`, true);
            return false;
        } finally {
            this.isTraining = false;
            this.updateUI();
        }
    }
    // Enhanced performance feedback display
    displayComprehensiveFeedback(feedback) {
        console.log('Displaying comprehensive feedback:', feedback);
        
        // Store for full report modal
        window.currentReport = feedback.report_details || {};
   
        const container = document.getElementById('performanceFeedback');
        if (!container) {
            console.error('Performance feedback container not found!');
            return;
        }
        const analysis = feedback.performance_analysis;
        const suggestions = feedback.improvement_suggestions || [];
        const trainingRecs = feedback.training_recommendations || [];
        const successes = feedback.success_factors || [];
        const metrics = feedback.comparison_metrics || {};
        let html = '';
        // Performance Summary Card
        html += this.createPerformanceSummary(analysis, metrics);
        // Success Factors (what went well)
        if (successes.length > 0) {
            html += this.createSuccessFactorsSection(successes);
        }

        // Prediction Analysis
        if (feedback.predicted_vs_actual) {
            html += this.createPredictionAnalysisSection(feedback.predicted_vs_actual);
        }

        // Improvement Suggestions
        if (suggestions.length > 0) {
            html += this.createImprovementSuggestionsSection(suggestions);
        }
        // Training Recommendations
        if (trainingRecs.length > 0) {
            html += this.createTrainingRecommendationsSection(trainingRecs);
        }
        // Metrics Overview
        html += this.createMetricsOverview(metrics);

        container.innerHTML = html;
   
        // Replace feather icons
        setTimeout(() => {
            if (typeof feather !== 'undefined') {
                feather.replace();
            }
        }, 100);
    }
    createPerformanceSummary(analysis, metrics) {
        const colorConfig = {
            'excellent': { bg: 'green', icon: 'award' },
            'good': { bg: 'blue', icon: 'thumbs-up' },
            'average': { bg: 'yellow', icon: 'activity' },
            'needs_improvement': { bg: 'orange', icon: 'alert-circle' },
            'poor': { bg: 'red', icon: 'alert-triangle' }
        };
        const config = colorConfig[analysis.status] || colorConfig.average;
        return `
            <div class="bg-${config.bg}-50 border-l-4 border-${config.bg}-500 p-6 mb-6 rounded-lg">
                <div class="flex items-center justify-between mb-4">
                    <div class="flex items-center">
                        <i data-feather="${config.icon}" class="w-8 h-8 text-${config.bg}-500 mr-3"></i>
                        <div>
                            <h3 class="text-xl font-bold text-${config.bg}-800">Performance Summary</h3>
                            <p class="text-${config.bg}-700">${analysis.message}</p>
                        </div>
                    </div>
                    <button onclick="showFullReport()" class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg flex items-center shadow-md transition duration-300 text-sm font-bold">
                        <i data-feather="file-text" class="w-4 h-4 mr-2"></i>
                        Report
                    </button>
                </div>
           
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div class="text-center">
                        <div class="text-2xl font-bold text-gray-900">${metrics.current_response_time || '--'}</div>
                        <div class="text-sm text-gray-600">Your Time (min)</div>
                    </div>
                    <div class="text-center">
                        <div class="text-2xl font-bold text-gray-900">${metrics.expected_response_time || '--'}</div>
                        <div class="text-sm text-gray-600">Expected (min)</div>
                    </div>
                    <div class="text-center">
                        <div class="text-2xl font-bold ${metrics.time_difference > 0 ? 'text-red-600' : 'text-green-600'}">
                            ${metrics.time_difference > 0 ? '+' : ''}${metrics.time_difference || '--'}
                        </div>
                        <div class="text-sm text-gray-600">Difference</div>
                    </div>
                    <div class="text-center">
                        <div class="text-2xl font-bold text-gray-900">${metrics.similar_incidents_count || '--'}</div>
                        <div class="text-sm text-gray-600">Compared With</div>
                    </div>
                </div>
                ${analysis.improvement_opportunity > 0 ? `
                    <div class="mt-4 p-3 bg-${config.bg}-100 rounded">
                        <p class="text-${config.bg}-800 font-semibold">
                            💡 Improvement Opportunity: ${analysis.improvement_opportunity.toFixed(1)} minutes
                        </p>
                    </div>
                ` : ''}
            </div>
        `;
    }
    createSuccessFactorsSection(successes) {
        let html = `
            <div class="bg-green-50 border-l-4 border-green-500 p-6 mb-6 rounded-lg">
                <div class="flex items-center mb-4">
                    <i data-feather="check-circle" class="w-6 h-6 text-green-500 mr-2"></i>
                    <h3 class="text-lg font-bold text-green-800">Success Factors</h3>
                </div>
                <div class="space-y-4">
        `;
        successes.forEach(success => {
            html += `
                <div class="bg-white p-4 rounded-lg border border-green-200">
                    <h4 class="font-semibold text-green-700 mb-2">${success.message}</h4>
                    <div class="mt-3">
                        <h5 class="text-sm font-medium text-green-600 mb-2">Best Practices to Continue:</h5>
                        <ul class="text-sm text-green-700 space-y-1">
                            ${success.best_practices.map(practice => `
                                <li class="flex items-start">
                                    <i data-feather="check" class="w-4 h-4 text-green-500 mr-2 mt-0.5"></i>
                                    <span>${practice}</span>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                </div>
            `;
        });
        html += `</div></div>`;
        return html;
    }

    createPredictionAnalysisSection(prediction) {
        if (!prediction || prediction.predicted === undefined) return '';
        
        return `
            <div class="bg-yellow-50 border-l-4 border-yellow-500 p-6 mb-6 rounded-lg">
                <div class="flex items-center mb-4">
                    <i data-feather="target" class="w-6 h-6 text-yellow-600 mr-2"></i>
                    <h3 class="text-lg font-bold text-yellow-800">Prediction Analysis</h3>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="bg-white p-4 rounded-lg border border-yellow-200">
                        <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Predicted Response Time</p>
                        <p class="text-2xl font-black text-yellow-600">${prediction.predicted.toFixed(2)} min</p>
                    </div>
                    <div class="bg-white p-4 rounded-lg border border-yellow-200">
                        <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Actual Response Time</p>
                        <p class="text-2xl font-black text-yellow-600">${prediction.actual.toFixed(2)} min</p>
                    </div>
                </div>
                ${prediction.difference !== undefined ? `
                    <div class="mt-4 p-3 bg-white rounded border border-yellow-200 text-sm">
                        <span class="font-bold text-yellow-800">Variance:</span> 
                        <span class="${prediction.difference > 0 ? 'text-red-600' : 'text-green-600'} font-bold">
                            ${Math.abs(prediction.difference).toFixed(2)} minutes 
                            ${prediction.difference > 0 ? 'slower' : 'faster'} than predicted
                        </span>
                    </div>
                ` : ''}
            </div>
        `;
    }

    createImprovementSuggestionsSection(suggestions) {
        let html = `
            <div class="mb-8">
                <div class="flex items-center mb-4">
                    <i data-feather="target" class="w-6 h-6 text-blue-500 mr-2"></i>
                    <h3 class="text-lg font-bold text-gray-800">Improvement Suggestions</h3>
                </div>
                <div class="space-y-4">
        `;
        // Sort by priority
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        suggestions.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
        suggestions.forEach(suggestion => {
            const priorityConfig = {
                high: { color: 'red', badge: '🚨 HIGH PRIORITY' },
                medium: { color: 'yellow', badge: '📊 MEDIUM PRIORITY' },
                low: { color: 'blue', badge: '💡 LOW PRIORITY' }
            };
            const config = priorityConfig[suggestion.priority] || priorityConfig.medium;
            html += `
                <div class="border-l-4 border-${config.color}-500 bg-white p-5 rounded-lg shadow-sm">
                    <div class="flex justify-between items-start mb-3">
                        <h4 class="font-bold text-gray-800 text-lg">${suggestion.title}</h4>
                        <span class="px-3 py-1 text-xs font-semibold rounded-full bg-${config.color}-100 text-${config.color}-800">
                            ${config.badge}
                        </span>
                    </div>
               
                    <p class="text-gray-600 mb-4">${suggestion.description}</p>
               
                    <div class="mb-4">
                        <h5 class="font-semibold text-gray-700 mb-2">Actionable Steps:</h5>
                        <ul class="space-y-2">
                            ${suggestion.actionable_steps.map(step => `
                                <li class="flex items-start text-sm text-gray-700">
                                    <i data-feather="check-circle" class="w-4 h-4 text-${config.color}-500 mr-2 mt-0.5"></i>
                                    <span>${step}</span>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
               
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                        <div class="bg-gray-50 p-2 rounded">
                            <span class="font-medium">Expected Impact:</span> ${suggestion.expected_impact}
                        </div>
                        <div class="bg-gray-50 p-2 rounded">
                            <span class="font-medium">Difficulty:</span> ${suggestion.implementation_difficulty}
                        </div>
                        <div class="bg-gray-50 p-2 rounded">
                            <span class="font-medium">Timeline:</span> ${suggestion.time_to_implement}
                        </div>
                    </div>
                </div>
            `;
        });
        html += `</div></div>`;
        return html;
    }
    createTrainingRecommendationsSection(recommendations) {
        let html = `
            <div class="bg-purple-50 border-l-4 border-purple-500 p-6 mb-6 rounded-lg">
                <div class="flex items-center mb-4">
                    <i data-feather="book-open" class="w-6 h-6 text-purple-500 mr-2"></i>
                    <h3 class="text-lg font-bold text-purple-800">Training & Development</h3>
                </div>
                <div class="space-y-4">
        `;
        recommendations.forEach(rec => {
            const priorityColor = rec.priority === 'high' ? 'red' : 'yellow';
       
            html += `
                <div class="bg-white p-4 rounded-lg border border-purple-200">
                    <div class="flex justify-between items-start mb-2">
                        <h4 class="font-semibold text-purple-700">${rec.title}</h4>
                        <span class="px-2 py-1 text-xs rounded-full bg-${priorityColor}-100 text-${priorityColor}-800">
                            ${rec.priority.toUpperCase()} PRIORITY
                        </span>
                    </div>
                    <p class="text-purple-600 mb-3">${rec.description}</p>
                    <div class="mb-3">
                        <h5 class="text-sm font-medium text-purple-600 mb-1">Recommended Actions:</h5>
                        <ul class="text-sm text-purple-700 space-y-1">
                            ${rec.actions.map(action => `
                                <li class="flex items-start">
                                    <i data-feather="check" class="w-4 h-4 text-purple-500 mr-2 mt-0.5"></i>
                                    <span>${action}</span>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                    <div class="text-sm text-purple-600">
                        <span class="font-medium">Benefits:</span> ${rec.benefits}
                    </div>
                </div>
            `;
        });
        html += `</div></div>`;
        return html;
    }
    createMetricsOverview(metrics) {
        return `
            <div class="bg-gray-50 border border-gray-200 p-4 rounded-lg mb-6">
                <h4 class="font-semibold text-gray-700 mb-3">Analysis Details</h4>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div class="text-center">
                        <div class="text-lg font-bold text-gray-900">${metrics.similar_incidents_count || '--'}</div>
                        <div class="text-gray-600">Incidents Analyzed</div>
                    </div>
                    <div class="text-center">
                        <div class="text-lg font-bold text-gray-900">${metrics.performance_ratio ? metrics.performance_ratio.toFixed(2) : '--'}</div>
                        <div class="text-gray-600">Performance Ratio</div>
                    </div>
                    <div class="text-center">
                        <div class="text-lg font-bold ${metrics.time_difference > 0 ? 'text-red-600' : 'text-green-600'}">
                            ${metrics.time_difference > 0 ? '+' : ''}${metrics.time_difference || '--'}
                        </div>
                        <div class="text-gray-600">Time Difference (min)</div>
                    </div>
                    <div class="text-center">
                        <div class="text-lg font-bold text-gray-900">${new Date().toLocaleDateString()}</div>
                        <div class="text-gray-600">Analysis Date</div>
                    </div>
                </div>
            </div>
        `;
    }

    createReportSpecificationsSection(report) {
        return `
            <div class="bg-gray-50 border-l-4 border-gray-500 p-6 rounded-lg">
                <h3 class="text-xl font-bold text-gray-900 mb-4 flex items-center">
                    <i data-feather="file-text" class="w-6 h-6 mr-2"></i>
                    Report Specifications
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                    <div>
                        <p class="text-gray-600 mb-1">Station</p>
                        <p class="font-semibold">${report.station || '-'}</p>
                    </div>
                    <div>
                        <p class="text-gray-600 mb-1">Date</p>
                        <p class="font-semibold">${report.date || '-'}</p>
                    </div>
                    <div>
                        <p class="text-gray-600 mb-1">Fire Type</p>
                        <p class="font-semibold">${report.type || '-'}</p>
                    </div>
                    <div>
                        <p class="text-gray-600 mb-1">Alarm Status</p>
                        <p class="font-semibold">${report.alarm_status || '-'}</p>
                    </div>
                    <div>
                        <p class="text-gray-600 mb-1">Responding Unit</p>
                        <p class="font-semibold">${report.responding_unit || '-'}</p>
                    </div>
                    <div>
                        <p class="text-gray-600 mb-1">Time Received</p>
                        <p class="font-semibold">${report.time_received || '-'}</p>
                    </div>
                    <div>
                        <p class="text-gray-600 mb-1">Time Dispatched</p>
                        <p class="font-semibold">${report.time_dispatched || '-'}</p>
                    </div>
                    <div>
                        <p class="text-gray-600 mb-1">Time Arrival</p>
                        <p class="font-semibold">${report.time_arrival || '-'}</p>
                    </div>
                    <div class="bg-blue-50 p-2 rounded">
                        <p class="text-blue-700 mb-1 font-bold uppercase text-[10px]">Response Time</p>
                        <p class="font-bold text-blue-900 text-lg">${report.response_time || report.response_time_min || 0} min</p>
                    </div>
                    <div>
                        <p class="text-gray-600 mb-1">Distance</p>
                        <p class="font-semibold">${report.distance || 0} km</p>
                    </div>
                    <div>
                        <p class="text-gray-600 mb-1">Weather Condition</p>
                        <p class="font-semibold">${report.weather || '-'}</p>
                    </div>
                    <div>
                        <p class="text-gray-600 mb-1">Road Condition</p>
                        <p class="font-semibold">${report.road_condition || '-'}</p>
                    </div>
                </div>
            </div>
        `;
    }
    // Store incident in backend - FIXED FEEDBACK DISPLAY
    async storeIncident(incidentData) {
        try {
            console.log('Storing incident:', incidentData);
            const response = await fetch(`${this.backendUrl}/incidents`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(incidentData)
            });
      
            if (!response.ok) {
                const errorResult = await response.json();
                throw new Error(errorResult.error || 'Failed to store incident');
            }
      
            const result = await response.json();
            console.log('Incident stored successfully:', result);
       
            // Add to local training data with proper ID and timestamp
            const newIncident = {
                ...incidentData,
                id: result.id || this.trainingData.length + 1,
                timestamp: result.timestamp || new Date().toISOString()
            };
      
            this.trainingData.push(newIncident);
      
            // Get COMPREHENSIVE performance feedback
            let feedbackResult = null;
            try {
                console.log('Requesting comprehensive performance feedback...');
                const feedbackResponse = await fetch(`${this.backendUrl}/comprehensive-feedback`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        incident_data: {
                            ...newIncident,
                            response_time: newIncident.response_time_min, // Ensure response_time is set
                            distance: newIncident.distance,
                            type: newIncident.type_of_occupancy,
                            weather: newIncident.weather_condition
                        }
                    })
                });
           
                if (feedbackResponse.ok) {
                    feedbackResult = await feedbackResponse.json();
                    console.log('Comprehensive feedback received:', feedbackResult);
                } else {
                    console.warn('Feedback response not OK:', feedbackResponse.status);
                    feedbackResult = {
                        status: 'no_data',
                        message: 'Not enough data for comprehensive analysis yet. Continue recording incidents.'
                    };
                }
            } catch (feedbackError) {
                console.warn('Could not get comprehensive feedback:', feedbackError);
                feedbackResult = {
                    status: 'no_data',
                    message: 'Not enough data for comprehensive analysis yet. Continue recording incidents.'
                };
            }
      
            // Display the comprehensive feedback
            if (feedbackResult) {
                console.log('Displaying comprehensive feedback...');
                this.displayComprehensiveFeedback(feedbackResult);
            }
       
            // Auto-train every 5 incidents
            if (this.trainingData.length >= 5 && this.trainingData.length % 5 === 0) {
                try {
                    await this.trainModel(this.trainingData);
                    console.log(`Auto-trained after ${this.trainingData.length} incidents`);
          
                    // Get updated feedback after training
                    const updatedFeedback = await this.getComprehensiveFeedback(newIncident);
                    if (updatedFeedback) {
                        this.displayComprehensiveFeedback(updatedFeedback);
                    }
                } catch (trainError) {
                    console.warn('Auto-train failed:', trainError);
                }
            }
      
            this.updateUI();
            return result;
      
        } catch (error) {
            console.error('Storage error:', error);
            // Fallback to local storage if backend is unavailable
            const localResult = this.storeIncidentLocally(incidentData);
            this.showNotification('Incident saved locally (backend unavailable)', true);
            return localResult;
        }
    }
    // Get comprehensive feedback from backend - ENHANCED DEBUGGING
    async getComprehensiveFeedback(incidentData) {
        try {
            console.log('Getting comprehensive feedback for incident:', incidentData);
      
            const response = await fetch(`${this.backendUrl}/comprehensive-feedback`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ incident_data: incidentData })
            });
      
            console.log('Feedback response status:', response.status);
      
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Feedback API error:', errorText);
                throw new Error(`Failed to get feedback: ${response.status}`);
            }
      
            const result = await response.json();
            console.log('Comprehensive feedback result:', result);
            return result;
      
        } catch (error) {
            console.error('Error getting comprehensive feedback:', error);
            return {
                status: 'error',
                message: 'Feedback analysis temporarily unavailable'
            };
        }
    }
    // Get training feedback
    async getTrainingFeedback() {
        try {
            const response = await fetch(`${this.backendUrl}/training-feedback`);
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || 'Failed to get training feedback');
            }
            return result;
        } catch (error) {
            console.error('Error getting training feedback:', error);
            return {
                status: 'error',
                message: 'Training feedback unavailable'
            };
        }
    }
    // Display training feedback
    displayTrainingFeedback(feedback) {
        const container = document.getElementById('trainingFeedback');
        if (!container) {
            console.error('Training feedback container not found!');
            return;
        }
        const statusConfig = {
            'excellent': { color: 'green', icon: 'award' },
            'good': { color: 'blue', icon: 'thumbs-up' },
            'fair': { color: 'yellow', icon: 'trending-up' },
            'needs_improvement': { color: 'red', icon: 'alert-triangle' },
            'not_trained': { color: 'gray', icon: 'help-circle' }
        };
        const config = statusConfig[feedback.status] || statusConfig.not_trained;
        let html = `
            <div class="bg-${config.color}-50 border-l-4 border-${config.color}-500 p-4 mb-4">
                <div class="flex items-center mb-2">
                    <i data-feather="${config.icon}" class="w-5 h-5 text-${config.color}-500 mr-2"></i>
                    <h4 class="font-semibold text-${config.color}-800">Model Training Status</h4>
                </div>
                <p class="text-${config.color}-700 mb-3">${feedback.message}</p>
        `;
        if (feedback.metrics) {
            html += `
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <span class="font-medium">Accuracy:</span> ${(feedback.metrics.accuracy * 100).toFixed(1)}%
                    </div>
                    <div>
                        <span class="font-medium">Prediction Quality:</span> ${feedback.metrics.r2_score.toFixed(3)}
                    </div>
                </div>
            `;
        }
        if (feedback.recommendations && feedback.recommendations.length > 0) {
            html += `<div class="mt-3 space-y-2">`;
            feedback.recommendations.forEach(rec => {
                html += `
                    <div class="flex items-start text-sm">
                        <i data-feather="lightbulb" class="w-4 h-4 text-${config.color}-500 mt-0.5 mr-2"></i>
                        <span class="text-${config.color}-700">${rec.suggestion}</span>
                    </div>
                `;
            });
            html += `</div>`;
        }
        html += `</div>`;
        container.innerHTML = html;
        // Replace feather icons
        setTimeout(() => {
            if (typeof feather !== 'undefined') {
                feather.replace();
            }
        }, 100);
    }
    // Fallback local storage
    storeIncidentLocally(incidentData) {
        const incidents = JSON.parse(localStorage.getItem('fireIncidents') || '[]');
        incidentData.id = Date.now();
        incidentData.timestamp = new Date().toISOString();
        incidents.push(incidentData);
        localStorage.setItem('fireIncidents', JSON.stringify(incidents));
        // Update local training data
        this.trainingData = incidents;
        this.updateUI();
        return {
            message: 'Incident stored locally',
            id: incidentData.id,
            local: true
        };
    }
    // Update UI with real metrics
    updateUI() {
        // Update training count
        const trainingCountElement = document.getElementById('trainingCount');
        if (trainingCountElement) {
            trainingCountElement.textContent = `${this.trainingData.length} incidents`;
        }
        // Update progress bar (cap at 100 incidents for visualization)
        const progress = Math.min((this.trainingData.length / 100) * 100, 100);
        const trainingProgressElement = document.getElementById('trainingProgress');
        if (trainingProgressElement) {
            trainingProgressElement.style.width = `${progress}%`;
        }
        // Update model accuracy
        const modelAccuracyElement = document.getElementById('modelAccuracy');
        if (modelAccuracyElement) {
            // Convert to percentage and format
            const accuracyPercent = (this.modelAccuracy * 100).toFixed(1);
            modelAccuracyElement.textContent = `${accuracyPercent}%`;
        }
        const accuracyBarElement = document.getElementById('accuracyBar');
        if (accuracyBarElement) {
            accuracyBarElement.style.width = `${this.modelAccuracy * 100}%`;
        }
        // Update last retrained
        const lastRetrainedElement = document.getElementById('lastRetrained');
        if (lastRetrainedElement) {
            lastRetrainedElement.textContent = new Date().toLocaleString();
        }
        // Update model status
        const statusElement = document.getElementById('modelStatus');
        if (statusElement) {
            if (this.isTraining) {
                statusElement.textContent = 'Training...';
                statusElement.className = 'training-status status-training';
            } else if (this.modelAccuracy > 0) {
                statusElement.textContent = 'Ready';
                statusElement.className = 'training-status status-ready';
            } else {
                statusElement.textContent = 'Needs Training';
                statusElement.className = 'training-status status-error';
            }
        }
        // Update recent incidents
        this.updateRecentIncidents();
    }
    // Update recent incidents display
    updateRecentIncidents() {
        const container = document.getElementById('recentIncidents');
        if (!container) return;
        // Get last 5 incidents
        const recentIncidents = [...this.trainingData]
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 5);
    
        if (recentIncidents.length === 0) {
            container.innerHTML = `
                <div class="text-center py-2 text-gray-500 text-sm">
                    No incidents recorded yet
                </div>
            `;
            return;
        }
        container.innerHTML = recentIncidents.map(incident => `
            <div class="incident-item recent">
                <div class="flex justify-between items-start">
                    <span class="font-medium text-xs">${incident.type_of_occupancy || incident.type}</span>
                    <span class="text-xs text-gray-500">${this.formatTime(incident.timestamp)}</span>
                </div>
                <div class="text-xs text-gray-600">Response: ${incident.response_time_min || incident.response_time}min</div>
                <div class="text-xs text-gray-500">Distance: ${incident.distance}km</div>
            </div>
        `).join('');
    }
    // Format timestamp for display
    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        return date.toLocaleDateString();
    }
    // Show training notification
    showNotification(message, isError = false) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `fixed right-4 p-4 rounded-lg shadow-lg text-white z-50 transform transition-all duration-300 min-w-max max-w-sm ${
            isError ? 'bg-red-500' : 'bg-green-500'
        }`;
        notification.innerHTML = `
            <div class="flex items-center">
                <i data-feather="${isError ? 'alert-triangle' : 'check-circle'}" class="w-5 h-5 mr-2"></i>
                <span>${message}</span>
            </div>
        `;
        document.body.appendChild(notification);
        
        // Add to notification stack
        notificationStack.add(notification);
        
        // Replace feather icons
        setTimeout(() => {
            if (typeof feather !== 'undefined') {
                feather.replace();
            }
        }, 100);
        
        // Remove after 5 seconds
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                notificationStack.remove(notification);
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 5000);
    }
    // Test function to check backend connection
    async testBackendConnection() {
        try {
            console.log('🔍 Testing backend connection...');
            const response = await fetch(`${this.backendUrl}/test`);
            const result = await response.json();
            console.log('✅ Backend connection test:', result);
            return result;
        } catch (error) {
            console.error('❌ Backend connection failed:', error);
            return { error: error.message };
        }
    }
    // Test function for feedback system
    async testFeedbackSystem() {
        try {
            console.log('🔍 Testing feedback system...');
            const testIncident = {
                location: 'Test Location',
                type_of_occupancy: 'Residential',
                response_time_min: 5,
                distance: 0.2,
                temperature_c: 30,
                humidity_pct: 73,
                wind_speed_kmh: 12.5,
                weather_condition: 'Sunny',
                road_condition: 'Dry'
            };
        
            const response = await fetch(`${this.backendUrl}/test-feedback`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ incident_data: testIncident })
            });
        
            const result = await response.json();
            console.log('✅ Feedback system test:', result);
        
            // Display the test feedback
            this.displayComprehensiveFeedback(result);
            return result;
        } catch (error) {
            console.error('❌ Feedback system test failed:', error);
            return { error: error.message };
        }
    }
}
// =============================================
// MAP AND NAVIGATION SYSTEM (UPDATED FOR AUTO LOCATION)
// =============================================
// Map and navigation variables
// Global variable for arrival state
let hasArrivedAtDestination = false;
let currentLocationName = ''; // Track the current incident location name

// Function to check if user has arrived at destination
function checkArrival(currentPos, destination) {
    if (!hasArrivedAtDestination && currentPos && destination) {
        // Calculate distance in meters using haversine formula
        const lat1 = currentPos.lat;
        const lng1 = currentPos.lng;
        const lat2 = destination.lat;
        const lng2 = destination.lng;
        
        const R = 6371000; // Earth's radius in meter
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const dist = R * c; // Distance in meters
        
        console.log(`Current distance to destination: ${dist.toFixed(2)}m`);
        
        // Threshold for arrival: 30 meters
        if (dist < 30) {
            hasArrivedAtDestination = true;
            onArrivalAtIncident();
        }
    }
}

// Function called when destination is reached
function onArrivalAtIncident() {
    console.log('🏁 User has arrived at the incident location!');
    
    // 1. Show Arrival Notification
    showTemporaryNotification('You have arrived at the incident location! Opening incident report form...', false);
    
    // 2. Play alert sound if possible (optional)
    
    // 3. Stop tracking after a short delay to capture final position
    setTimeout(() => {
        if (isTracking) {
            toggleTracking(); // This will automatically capture arrival time
        }
        
        // 4. Switch to incident report form section
        switchSection('incidents');
        
        // 5. Pre-fill incident location in the form if we have the name
        const locationInput = document.getElementById('location');
        if (locationInput && currentLocationName) {
            locationInput.value = currentLocationName;
        }
    }, 1500);
}

// Laguna Fire Stations Coordinates for Nearest Station Detection
const LAGUNA_FIRE_STATIONS = [
    { name: 'Santa Cruz Fire Station, Laguna', lat: 14.2811, lng: 121.4150 },
    { name: 'Los Baños Fire Station, Laguna', lat: 14.1685, lng: 121.2435 },
    { name: 'Bay Fire Station, Laguna', lat: 14.1821, lng: 121.2858 },
    { name: 'Calauan Fire Station, Laguna', lat: 14.1488, lng: 121.3155 },
    { name: 'Victoria Fire Station, Laguna', lat: 14.2285, lng: 121.3320 },
    { name: 'Pila Fire Station, Laguna', lat: 14.2340, lng: 121.3665 },
    { name: 'Lumban Fire Station, Laguna', lat: 14.2980, lng: 121.4600 },
    { name: 'Magdalena Fire Station, Laguna', lat: 14.2000, lng: 121.4280 }
];

// Function to find nearest fire station
function getNearestFireStation(lat, lng) {
    let nearest = LAGUNA_FIRE_STATIONS[0];
    let minDistance = Infinity;
    
    LAGUNA_FIRE_STATIONS.forEach(station => {
        // Simple Euclidean distance for local area
        const dist = Math.sqrt(Math.pow(station.lat - lat, 2) + Math.pow(station.lng - lng, 2));
        if (dist < minDistance) {
            minDistance = dist;
            nearest = station;
        }
    });
    return nearest.name;
}

// Function to update the station field in the report form
function updateReportStation(lat, lng) {
    const stationName = getNearestFireStation(lat, lng);
    const stationInput = document.getElementById('station');
    if (stationInput) {
        stationInput.value = stationName;
        console.log('Nearest fire station detected:', stationName);
    }
}

// Hydrant variables
let nearestHydrantMarker = null;
let hydrantLine = null;
// Search variables
let searchTimeout = null;
// Define bounding box for Santa Cruz, Laguna area
const SANTA_CRUZ_BOUNDS = {
    southWest: [14.20, 121.35], // Southwest corner (lat, lng)
    northEast: [14.32, 121.45] // Northeast corner (lat, lng)
};
// Fire hydrant data from the CSV
const fireHydrants = [
    {Latitude: 14.280248, Longitude: 121.394529, "Present Condition": "Operational", Remarks: "Low Pressure"},
    {Latitude: 14.280069, Longitude: 121.394703, "Present Condition": "Operational", Remarks: "High Pressure"},
    {Latitude: 14.273128, Longitude: 121.400478, "Present Condition": "Operational", Remarks: "High Pressure"},
    {Latitude: 14.271956, Longitude: 121.399617, "Present Condition": "Operational", Remarks: "High Pressure"},
    {Latitude: 14.271853, Longitude: 121.399576, "Present Condition": "Operational", Remarks: "High Pressure"},
    {Latitude: 14.26305, Longitude: 121.40111, "Present Condition": "Operational", Remarks: "High Pressure"},
    {Latitude: 14.27774, Longitude: 121.411473, "Present Condition": "Operational", Remarks: "Low Pressure"},
    {Latitude: 14.253727, Longitude: 121.380829, "Present Condition": "Operational", Remarks: "High Pressure"},
    {Latitude: 14.248357, Longitude: 121.378854, "Present Condition": "Operational", Remarks: "High Pressure"},
    {Latitude: 14.244188, Longitude: 121.403141, "Present Condition": "Operational", Remarks: "High Pressure"},
    {Latitude: 14.272753, Longitude: 121.421359, "Present Condition": "Operational", Remarks: "High Pressure"},
    {Latitude: 14.250796, Longitude: 121.415993, "Present Condition": "Operational", Remarks: "Low Pressure"},
    {Latitude: 14.278958, Longitude: 121.415888, "Present Condition": "Operational", Remarks: "High Pressure"},
    {Latitude: 14.286795, Longitude: 121.411203, "Present Condition": "Operational", Remarks: "Low Pressure"},
    {Latitude: 14.287409, Longitude: 121.411705, "Present Condition": "Operational", Remarks: "Low Pressure"},
    {Latitude: 14.277512, Longitude: 121.419285, "Present Condition": "Unserviceable", Remarks: "Unserviceable"},
    {Latitude: 14.275834, Longitude: 121.419642, "Present Condition": "Operational", Remarks: "High Pressure"},
    {Latitude: 14.279892, Longitude: 121.415254, "Present Condition": "Operational", Remarks: "Low pressure"},
    {Latitude: 14.281046, Longitude: 121.416473, "Present Condition": "Operational", Remarks: "Low pressure"},
    {Latitude: 14.281227, Longitude: 121.416456, "Present Condition": "Operational", Remarks: "High Pressure"},
    {Latitude: 14.281045, Longitude: 121.416963, "Present Condition": "Operational", Remarks: "Low pressure"},
    {Latitude: 14.28098, Longitude: 121.416969, "Present Condition": "Operational", Remarks: "Low pressure"},
    {Latitude: 14.280987, Longitude: 121.416969, "Present Condition": "Operational", Remarks: "Low pressure"},
    {Latitude: 14.285525, Longitude: 121.414276, "Present Condition": "Operational", Remarks: "High Pressure"},
    {Latitude: 14.285548, Longitude: 121.4143, "Present Condition": "Operational", Remarks: "Low pressure"},
    {Latitude: 14.284434, Longitude: 121.414435, "Present Condition": "Unserviceable", Remarks: "Unserviceable"},
    {Latitude: 14.285302, Longitude: 121.412797, "Present Condition": "Unserviceable", Remarks: "Unserviceable"},
    {Latitude: 14.287687, Longitude: 121.411143, "Present Condition": "Unserviceable", Remarks: "Unserviceable"},
    {Latitude: 14.293597, Longitude: 121.407939, "Present Condition": "Operational", Remarks: "High Pressure"},
    {Latitude: 14.289195, Longitude: 121.413264, "Present Condition": "Unserviceable", Remarks: "Unserviceable"},
    {Latitude: 14.281298, Longitude: 121.410662, "Present Condition": "Operational", Remarks: "Low pressure"}
];
// Function to create custom hydrant icons for Google Maps
function createHydrantIcon(condition, isNearest = false) {
    let fillColor = '#3b82f6'; // Default operational color
    
    if (condition === 'Unserviceable') {
        fillColor = '#ef4444'; // Red for unserviceable
    }
    
    if (isNearest) {
        fillColor = '#10b981'; // Green for nearest
    }
    
    // Return a Google Maps compatible SVG marker icon
    return {
        path: 'M12 2C8.13 2 5 5.13 5 9C5 14.25 12 22 12 22C12 22 19 14.25 19 9C19 5.13 15.87 2 12 2Z M12 6C10.34 6 9 7.34 9 9C9 10.66 10.34 12 12 12C13.66 12 15 10.66 15 9C15 7.34 13.66 6 12 6Z',
        fillColor: fillColor,
        fillOpacity: 0.95,
        strokeColor: '#ffffff',
        strokeWeight: 2,
        scale: isNearest ? 1.5 : 1
    };
}
// Function to add fire hydrants to the map using Google Maps
function addFireHydrants() {
    fireHydrants.forEach(hydrant => {
        const markerIcon = createHydrantIcon(hydrant["Present Condition"]);
        const marker = new google.maps.Marker({
            position: { lat: hydrant.Latitude, lng: hydrant.Longitude },
            map: map,
            title: 'Fire Hydrant',
            icon: markerIcon
        });

        // Create popup content
        const popupContent = `
            <div class="p-2" style="color: black;">
                <h4 class="font-bold text-sm">Fire Hydrant</h4>
                <p class="text-xs mt-1"><strong>Condition:</strong> ${hydrant["Present Condition"]}</p>
                <p class="text-xs"><strong>Remarks:</strong> ${hydrant.Remarks}</p>
                <p class="text-xs text-gray-600 mt-1">
                    <strong>Location:</strong> ${hydrant.Latitude.toFixed(6)}, ${hydrant.Longitude.toFixed(6)}
                </p>
            </div>
        `;

        const infoWindow = new google.maps.InfoWindow({
            content: popupContent
        });

        marker.addListener('click', () => {
            infoWindow.open(map, marker);
        });
    });
}
// Function to find nearest hydrant to a given location
function findNearestHydrant(lat, lng) {
    let nearestHydrant = null;
    let minDistance = Infinity;
    fireHydrants.forEach(hydrant => {
        // Skip unserviceable hydrants
        if (hydrant["Present Condition"] === "Unserviceable") return;
        const distance = calculateDistance([lat, lng], [hydrant.Latitude, hydrant.Longitude]);
        if (distance < minDistance) {
            minDistance = distance;
            nearestHydrant = hydrant;
        }
    });
    return { hydrant: nearestHydrant, distance: minDistance };
}
// Function to highlight nearest hydrant - ONLY if within 50ft using Google Maps
function highlightNearestHydrant(lat, lng) {
    // Remove previous nearest hydrant marker and line
    if (nearestHydrantMarker) {
        nearestHydrantMarker.setMap(null);
    }
    if (hydrantLine) {
        hydrantLine.setMap(null);
    }
    // Find nearest hydrant
    const { hydrant, distance } = findNearestHydrant(lat, lng);
    if (!hydrant) {
        console.log("No operational hydrants found nearby");
        document.getElementById('nearestHydrantCard').classList.add('hidden');
        return;
    }
    // Convert distance to feet for comparison (1 km = 3280.84 feet)
    const distanceInFeet = distance * 3280.84;
    // Only highlight if hydrant is within 50 feet
    const isWithinRange = distanceInFeet <= 50;
    console.log(`Nearest hydrant is ${distanceInFeet.toFixed(0)} feet away - ${isWithinRange ? 'within range, highlighting' : 'too far, not highlighting'}`);
    if (isWithinRange) {
        // Add special marker for nearest hydrant
        const markerIcon = createHydrantIcon(hydrant["Present Condition"], true);
        nearestHydrantMarker = new google.maps.Marker({
            position: { lat: hydrant.Latitude, lng: hydrant.Longitude },
            map: map,
            title: 'Nearest Fire Hydrant',
            icon: markerIcon,
            animation: google.maps.Animation.BOUNCE
        });

        // Create popup content
        const popupContent = `
            <div class="p-2" style="color: black;">
                <h4 class="font-bold text-sm text-green-600">Nearest Fire Hydrant</h4>
                <p class="text-xs mt-1"><strong>Distance:</strong> ${distanceInFeet.toFixed(0)} feet</p>
                <p class="text-xs"><strong>Condition:</strong> ${hydrant["Present Condition"]}</p>
                <p class="text-xs"><strong>Pressure:</strong> ${hydrant.Remarks}</p>
                <p class="text-xs text-gray-600 mt-1">
                    <strong>Location:</strong> ${hydrant.Latitude.toFixed(6)}, ${hydrant.Longitude.toFixed(6)}
                </p>
                <p class="text-xs text-green-600 mt-1 font-semibold">✓ Within 50 feet - Ready for connection</p>
            </div>
        `;

        const infoWindow = new google.maps.InfoWindow({
            content: popupContent
        });

        nearestHydrantMarker.addListener('click', () => {
            infoWindow.open(map, nearestHydrantMarker);
        });
        infoWindow.open(map, nearestHydrantMarker);

        // Add connection line only if within range
        hydrantLine = new google.maps.Polyline({
            path: [
                { lat: lat, lng: lng },
                { lat: hydrant.Latitude, lng: hydrant.Longitude }
            ],
            geodesic: true,
            strokeColor: '#10b981',
            strokeOpacity: 0.8,
            strokeWeight: 4,
            icons: [
                {
                    icon: { path: 'M 0,-1 0,1', strokeColor: '#10b981', strokeWeight: 2 },
                    offset: '0px',
                    repeat: '10px'
                }
            ],
            map: map
        });
    } else {
        console.log("Hydrant is beyond 50 feet - no highlighting or connection line");
    }
    // Update nearest hydrant info card regardless of distance
    updateNearestHydrantInfo(hydrant, distanceInFeet, isWithinRange);
    // Return whether highlighting was done
    return isWithinRange;
}
// Function to update nearest hydrant information card with distance in feet
function updateNearestHydrantInfo(hydrant, distanceInFeet, isWithinRange) {
    document.getElementById('nearestHydrantCard').classList.remove('hidden');
    document.getElementById('hydrant-distance').textContent = `${distanceInFeet.toFixed(0)} feet`;
    document.getElementById('hydrant-condition').textContent = hydrant["Present Condition"];
    document.getElementById('hydrant-pressure').textContent = hydrant.Remarks;
    document.getElementById('hydrant-coords').textContent = `${hydrant.Latitude.toFixed(4)}, ${hydrant.Longitude.toFixed(4)}`;
    const card = document.getElementById('nearestHydrantCard');
    if (isWithinRange) {
        // Change styling to indicate connection is possible
        card.style.background = '#dbeafe';
        card.style.borderLeft = '4px solid #10b981';
        card.classList.remove('warning');
        // Remove any existing warning message
        const existingWarning = document.getElementById('distance-warning');
        if (existingWarning) {
            existingWarning.remove();
        }
        // Add success message if not already present
        const contentDiv = document.getElementById('nearest-hydrant-content');
        if (!document.getElementById('distance-success')) {
            const successDiv = document.createElement('div');
            successDiv.id = 'distance-success';
            successDiv.className = 'mt-2 p-2 bg-green-50 rounded text-xs text-green-700';
            successDiv.innerHTML = '<i data-feather="check-circle" class="w-3 h-3 inline mr-1"></i> Hydrant is within 50 feet - Ready for connection';
            contentDiv.appendChild(successDiv);
            feather.replace();
        }
    } else {
        // Change styling to indicate connection is NOT possible
        card.style.background = '#fef3c7';
        card.style.borderLeft = '4px solid #f59e0b';
        card.classList.add('warning');
        // Add warning message if not already present
        const contentDiv = document.getElementById('nearest-hydrant-content');
        if (!document.getElementById('distance-warning')) {
            const warningDiv = document.createElement('div');
            warningDiv.id = 'distance-warning';
            warningDiv.className = 'mt-2 p-2 bg-red-50 rounded text-xs text-red-700';
            warningDiv.innerHTML = '<i data-feather="alert-triangle" class="w-3 h-3 inline mr-1"></i> Hydrant is too far for connection (max 50 feet) - Not highlighted on map';
            contentDiv.appendChild(warningDiv);
            feather.replace();
        }
        // Remove success message if present
        const existingSuccess = document.getElementById('distance-success');
        if (existingSuccess) {
            existingSuccess.remove();
        }
    }
}
// Calculate distance between two points in km
function calculateDistance(point1, point2) {
    const [lat1, lon1] = point1;
    const [lat2, lon2] = point2;
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}
// Initialize map with default view (will be updated with user's location)
function initMap() {
    console.log('🗺️ initMap() called');
    console.log('google object:', typeof window.google);
    console.log('google.maps object:', typeof window.google?.maps);
    
    // Check if map container exists
    if (!document.getElementById('map')) {
        console.error('Map container not found');
        return;
    }
    
    // Check if google.maps is available
    if (!window.google || !window.google.maps) {
        console.error('❌ Google Maps API not loaded. google object:', window.google, 'google.maps:', window.google?.maps);
        return;
    }
    
    try {
        const mapOptions = {
            zoom: 13,
            center: { lat: 14.272416030761997, lng: 121.4014354512121 },
            mapTypeControl: true,
            zoomControl: true,
            fullscreenControl: true
        };
        
        console.log('Creating Google Maps instance...');
        map = new google.maps.Map(document.getElementById('map'), mapOptions);
        console.log('✅ Map instance created successfully');
        
        // Add click handler to place destination marker
        map.addListener('click', function(e) {
            setDestinationMarker(e.latLng);
        });
        
        // Add fire hydrants to the map
        addFireHydrants();
        
        // Try to auto-locate user
        console.log('Attempting auto-location...');
        setTimeout(() => {
            autoLocateUser();
        }, 500);
        
        console.log('✅ Map initialized successfully with Google Maps');
    } catch (error) {
        console.error('❌ Error initializing map:', error);
        console.error('Error stack:', error.stack);
        // Show error on page
        const mapContainer = document.getElementById('map');
        if (mapContainer) {
            mapContainer.innerHTML = `<div style="display:flex; align-items:center; justify-content:center; height:100%; background:#fee; color:#c33; font-family:sans-serif;"><div style="text-align:center;">Map Error: ${error.message}</div></div>`;
        }
    }
}
// Reverse geocoding function to get address from coordinates using Google Maps
async function getAddressFromCoords(lat, lng) {
    try {
        const geocoder = new google.maps.Geocoder();
        const response = await geocoder.geocode({ location: { lat: lat, lng: lng } });
        if (response.results && response.results[0]) {
            return response.results[0].formatted_address;
        }
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch (error) {
        console.error('Reverse geocoding error:', error);
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
}

// Set destination marker at specified coordinates and AUTOMATICALLY CALCULATE ROUTE
async function setDestinationMarker(latlng, name = null) {
    // Convert Google LatLng to object if needed
    let latLng;
    if (latlng.lat && latlng.lng) {
        latLng = { lat: latlng.lat(), lng: latlng.lng() };
    } else if (latlng.lat && latlng.lng) {
        latLng = latlng;
    } else {
        return;
    }

    // Remove previous destination marker if exists
    if (destinationMarker) {
        destinationMarker.setMap(null);
    }

    // If no name is provided, get it from coordinates (reverse geocoding using Google)
    let locationName = name;
    if (!locationName) {
        const geocoder = new google.maps.Geocoder();
        try {
            const response = await geocoder.geocode({ location: latLng });
            if (response.results && response.results[0]) {
                locationName = response.results[0].formatted_address;
            } else {
                locationName = `${latLng.lat.toFixed(4)}, ${latLng.lng.toFixed(4)}`;
            }
        } catch (error) {
            console.error('Geocoding error:', error);
            locationName = `${latLng.lat.toFixed(4)}, ${latLng.lng.toFixed(4)}`;
        }
    }
    
    currentLocationName = locationName;

    // Create destination marker with custom pin icon
    const markerIcon = createDestinationPinIcon();

    destinationMarker = new google.maps.Marker({
        position: latLng,
        map: map,
        title: 'Incident Location',
        icon: markerIcon,
        animation: google.maps.Animation.DROP
    });

    // Add info window
    const infoWindow = new google.maps.InfoWindow({
        content: `<div style="color: black;"><b>Incident Location</b><br>${locationName}</div>`
    });
    destinationMarker.addListener('click', () => {
        infoWindow.open(map, destinationMarker);
    });
    infoWindow.open(map, destinationMarker);

    destinationLatLng = latLng;
    hasArrivedAtDestination = false; // Reset arrival flag for new destination
    
    // UPDATE NEAREST FIRE STATION in the form based on incident location
    updateReportStation(latLng.lat, latLng.lng);

    // CAPTURE TIME RECEIVED when pinned
    const now = new Date();
    const timeReceived = now.toTimeString().slice(0, 5);
    const receivedInput = document.getElementById('time_received');
    if (receivedInput) {
        receivedInput.value = timeReceived;
        console.log('Time Received captured from Pin:', timeReceived);
    }

    // Update display in form if it's open
    const locationInput = document.getElementById('location');
    if (locationInput) {
        locationInput.value = locationName;
    }

    // Find and highlight nearest hydrant (only if within 50ft)
    const isHighlighted = highlightNearestHydrant(latLng.lat, latLng.lng);
    console.log('Destination set:', latLng, 'Name:', currentLocationName);
    console.log(`Hydrant highlighted: ${isHighlighted ? 'YES (within 50ft)' : 'NO (beyond 50ft)'}`);
    
    // AUTOMATICALLY CALCULATE ROUTE if current position is available
    if (currentPosition) {
        const currentLatLng = { lat: currentPosition.coords.latitude, lng: currentPosition.coords.longitude };
        calculateRoute(currentLatLng, latLng);
        
        // AUTO-START TRACKING if not already on
        if (!isTracking) {
            console.log('Auto-starting tracking because destination was set...');
            toggleTracking();
        }

        // Show loading state briefly
        const routeButton = document.getElementById('calculateRoute');
        const originalText = routeButton.innerHTML;
        routeButton.innerHTML = '<i data-feather="loader" class="w-4 h-4 md:w-5 md:h-5 animate-spin"></i><span>Route Calculated</span>';
        routeButton.disabled = true;
        feather.replace();
        // Restore button after delay
        setTimeout(() => {
            routeButton.innerHTML = originalText;
            routeButton.disabled = false;
            feather.replace();
        }, 2000);
    } else {
        // If no current position, show message and prompt for location
        console.log('No current position available for automatic routing');
        // Update button to indicate location is needed
        const routeButton = document.getElementById('calculateRoute');
        routeButton.innerHTML = '<i data-feather="navigation" class="w-4 h-4 md:w-5 md:h-5"></i><span>Enable Location for Route</span>';
        feather.replace();
        // Show brief notification
        showTemporaryNotification('Destination set! Enable location services to see the route.', false);
    }
}
// Show temporary notification
function showTemporaryNotification(message, isError = false) {
    const notification = document.createElement('div');
    notification.className = `fixed right-4 p-4 rounded-lg shadow-lg text-white z-50 transform transition-all duration-300 min-w-max max-w-sm ${
        isError ? 'bg-red-500' : 'bg-blue-500'
    }`;
    notification.innerHTML = `
        <div class="flex items-center">
            <i data-feather="${isError ? 'alert-triangle' : 'info'}" class="w-5 h-5 mr-2"></i>
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(notification);
    
    // Add to notification stack
    notificationStack.add(notification);
    
    feather.replace();
    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            notificationStack.remove(notification);
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}
// Calculate route from current location to destination using Google Maps Directions API
function calculateRoute(startLatLng, endLatLng) {
    console.log('Starting route calculation from', startLatLng, 'to', endLatLng);
    
    // Validate inputs
    if (!startLatLng || !endLatLng) {
        console.error('❌ Missing start or end coordinates');
        showTemporaryNotification('Invalid location data. Please try again.', true);
        return;
    }

    // Ensure coordinates are in {lat, lng} format for Google Maps API
    const normalizeCoords = (coords) => {
        if (coords.lat && coords.lng) {
            return { lat: coords.lat, lng: coords.lng };
        } else if (coords.lat && coords.lng === undefined && coords.length === 2) {
            // Handle array format [lat, lng]
            return { lat: coords[0], lng: coords[1] };
        }
        return coords;
    };
    
    const origin = normalizeCoords(startLatLng);
    const destination = normalizeCoords(endLatLng);
    
    console.log('Normalized origin:', origin);
    console.log('Normalized destination:', destination);
    
    // Remove previous route layers
    routeLayers.forEach(layer => {
        if (layer) {
            layer.setMap(null);
        }
    });
    routeLayers = [];
    alternativeRoutes = [];

    const directionsService = new google.maps.DirectionsService();
    
    const request = {
        origin: origin,
        destination: destination,
        travelMode: google.maps.TravelMode.DRIVING
        // Note: 'alternatives' property is deprecated and no longer supported by Google Maps API
    };

    directionsService.route(request, (result, status) => {
        console.log('Directions API response status:', status);
        console.log('Result:', result);
        
        if (status === google.maps.DirectionsStatus.OK && result && result.routes) {
            console.log('Routes retrieved:', result.routes.length);
            
            // Clear previous routes
            alternativeRoutes = [];
            
            // Store routes - handle both single and multiple routes
            if (result.routes && result.routes.length > 0) {
                result.routes.forEach((route, index) => {
                    const legData = route.legs && route.legs[0] ? route.legs[0] : null;
                    alternativeRoutes.push({
                        summary: {
                            totalTime: calculateTotalTime(route),
                            totalDistance: calculateTotalDistance(route)
                        },
                        instructions: route.legs && route.legs[0] && route.legs[0].steps ? route.legs[0].steps : [],
                        coordinates: getRouteCoordinates(route),
                        route: route
                    });
                    console.log(`Route ${index + 1}: ${calculateTotalDistance(route) / 1000}km, ${calculateTotalTime(route) / 60}min`);
                });
            }

            console.log('Processed', alternativeRoutes.length, 'routes');
            
            if (alternativeRoutes.length > 0) {
                // Display alternative routes
                displayAlternativeRoutes(alternativeRoutes);
                
                // Show route info box
                const routeInfoBox = document.getElementById('routeInfo');
                if (routeInfoBox) {
                    routeInfoBox.classList.remove('hidden');
                    console.log('✅ Route info box shown');
                } else {
                    console.error('❌ Route info box element not found');
                }

                // Select the first route by default
                selectRoute(0);
                console.log('✅ Route selected and drawn on map');
            } else {
                console.warn('⚠️ No routes found in result');
                showTemporaryNotification('No route found. Please try again.', true);
            }

            // Update current position metrics
            const speedElement = document.getElementById('speed');
            const headingElement = document.getElementById('heading');
            if (speedElement) speedElement.textContent = currentSpeed.toFixed(1) + ' km/h';
            if (headingElement) headingElement.textContent = Math.round(currentHeading) + '°';
            
            // Fetch and display real-time road conditions
            const midpointLat = (startLatLng.lat + endLatLng.lat) / 2;
            const midpointLng = (startLatLng.lng + endLatLng.lng) / 2;
            fetchAndDisplayRoadConditions(midpointLat, midpointLng);
        } else {
            console.error('❌ Directions request failed with status:', status);
            console.error('Result:', result);
            let errorMessage = 'Route calculation failed';
            if (status) {
                errorMessage += `: ${status}`;
            }
            showTemporaryNotification(errorMessage + '. Please try again.', true);
        }
    });
}

// Helper function to calculate total time from route
function calculateTotalTime(route) {
    let totalTime = 0;
    if (route.legs) {
        route.legs.forEach(leg => {
            totalTime += leg.duration.value; // duration in seconds
        });
    }
    return totalTime;
}

// Helper function to calculate total distance from route
function calculateTotalDistance(route) {
    let totalDistance = 0;
    if (route.legs) {
        route.legs.forEach(leg => {
            totalDistance += leg.distance.value; // distance in meters
        });
    }
    return totalDistance;
}

// Helper function to get route coordinates for drawing polyline
function getRouteCoordinates(route) {
    const coords = [];
    if (route.overview_path) {
        route.overview_path.forEach(point => {
            coords.push({ lat: point.lat(), lng: point.lng() });
        });
    }
    return coords;
}
// Display alternative routes
function displayAlternativeRoutes(routes) {
    const container = document.getElementById('alternativeRoutes');
    container.innerHTML = '';
    if (!routes || routes.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-600">No alternative routes available</p>';
        return;
    }
    // Sort routes by time (fastest first)
    routes.sort((a, b) => a.summary.totalTime - b.summary.totalTime);
    routes.forEach((route, index) => {
        const timeMin = Math.round(route.summary.totalTime / 60);
        const distanceKm = (route.summary.totalDistance / 1000).toFixed(1);
        const isFastest = index === 0;
        const routeElement = document.createElement('div');
        routeElement.className = `route-option ${isFastest ? 'fastest' : ''} ${index === currentRouteIndex ? 'active' : ''}`;
        routeElement.innerHTML = `
            <div class="route-details">
                <div>
                    <span class="font-semibold">Route ${index + 1}</span>
                    ${isFastest ? '<span class="fastest-badge">FASTEST</span>' : ''}
                </div>
                <div class="route-stats">
                    <div class="route-stat">
                        <span class="route-stat-value">${timeMin} min</span>
                        <span class="route-stat-label">Time</span>
                    </div>
                    <div class="route-stat">
                        <span class="route-stat-value">${distanceKm} km</span>
                        <span class="route-stat-label">Distance</span>
                    </div>
                </div>
            </div>
        `;
        routeElement.addEventListener('click', () => {
            selectRoute(index);
        });
        container.appendChild(routeElement);
    });
}
// Select a specific route
function selectRoute(routeIndex) {
    if (!alternativeRoutes[routeIndex]) {
        console.error('❌ Route not found at index:', routeIndex);
        return;
    }
    currentRouteIndex = routeIndex;
    
    // Update route display
    const routeOptions = document.querySelectorAll('.route-option');
    routeOptions.forEach((option, index) => {
        if (index === routeIndex) {
            option.classList.add('active');
        } else {
            option.classList.remove('active');
        }
    });
    
    // Update main route info
    const route = alternativeRoutes[routeIndex];
    const totalTime = route.summary.totalTime; // in seconds
    const totalDistance = route.summary.totalDistance; // in meters
    const responseTimeMin = Math.round(totalTime / 60);
    const distanceKm = (totalDistance / 1000).toFixed(1);
    
    console.log('📊 Route Info - Index:', routeIndex);
    console.log('   Total Time (seconds):', totalTime);
    console.log('   Total Distance (meters):', totalDistance);
    console.log('   Formatted Time:', responseTimeMin + ' minutes');
    console.log('   Formatted Distance:', distanceKm + ' km');
    
    // Update ETA and distance
    const etaElement = document.getElementById('eta');
    const distanceElement = document.getElementById('distance');
    
    console.log('DOM Elements:');
    console.log('   ETA element:', etaElement);
    console.log('   Distance element:', distanceElement);
    
    if (etaElement) {
        etaElement.textContent = responseTimeMin + ' minutes';
        console.log('✅ ETA updated:', responseTimeMin + ' minutes');
    } else {
        console.warn('⚠️ ETA element not found');
    }
    
    if (distanceElement) {
        distanceElement.textContent = distanceKm + ' km';
        console.log('✅ Distance updated in navigation:', distanceKm + ' km');
    } else {
        console.warn('⚠️ Distance element not found');
    }
    
    // Auto-sync distance to Fire Incident Report form
    const incidentDistanceField = document.getElementById('incident_distance');
    if (incidentDistanceField) {
        const formValue = parseFloat(distanceKm);
        incidentDistanceField.value = formValue;
        console.log('✅ Distance auto-synced to Fire Incident Report form:', distanceKm + ' km');
    } else {
        console.warn('⚠️ Incident distance field not found');
    }
    
    // Get first instruction from the route's first leg
    const instructionsElement = document.getElementById('instructions');
    if (instructionsElement) {
        let instructionText = 'Follow the route';
        if (route.instructions && route.instructions.length > 0) {
            const firstStep = route.instructions[0];
            // Google Maps API provides html_instructions property
            if (firstStep.html_instructions) {
                // Strip ALL HTML tags to display as plain text
                let cleanText = firstStep.html_instructions
                    .replace(/<[^>]+>/g, '') // Remove all HTML tags
                    .trim();
                instructionText = cleanText || 'Follow the route';
            } else if (firstStep.instructions) {
                instructionText = firstStep.instructions;
            }
        }
        instructionsElement.textContent = instructionText;
        console.log('✅ Instructions updated:', instructionText);
    }
    
    // Highlight the selected route on the map
    highlightSelectedRoute(routeIndex);
}
// Highlight the selected route on the map using Google Maps polylines
function highlightSelectedRoute(routeIndex) {
    // Remove all existing route layers
    routeLayers.forEach(layer => {
        if (layer) {
            layer.setMap(null);
        }
    });
    routeLayers = [];
    
    // Add the selected route with highlighted style
    const selectedRoute = alternativeRoutes[routeIndex];
    if (selectedRoute && selectedRoute.route) {
        console.log('Drawing route on map:', selectedRoute);
        
        // Draw the selected route in red
        const selectedPolyline = new google.maps.Polyline({
            path: selectedRoute.route.overview_path,
            geodesic: true,
            strokeColor: '#b91c1c',
            strokeOpacity: 0.9,
            strokeWeight: 6,
            map: map
        });
        routeLayers.push(selectedPolyline);
        console.log('Selected route drawn:', selectedPolyline);
        
        // Draw alternative routes in gray
        alternativeRoutes.forEach((route, index) => {
            if (index !== routeIndex && route.route) {
                const altPolyline = new google.maps.Polyline({
                    path: route.route.overview_path,
                    geodesic: true,
                    strokeColor: '#d1d5db',
                    strokeOpacity: 0.4,
                    strokeWeight: 4,
                    map: map
                });
                routeLayers.push(altPolyline);
            }
        });
        
        // Fit map bounds to show the route with padding
        if (selectedRoute.route.bounds) {
            map.fitBounds(selectedRoute.route.bounds);
            // Add some padding after fitting bounds
            setTimeout(() => {
                map.setZoom(Math.max(map.getZoom() - 1, 10));
            }, 100);
        }
    } else {
        console.error('Cannot highlight route: route data missing', selectedRoute);
    }
}

// Fetch and display real-time road conditions
async function fetchAndDisplayRoadConditions(lat, lng) {
    try {
        console.log('🛣️ Fetching real-time road conditions...');
        const backendUrl = getBackendUrl();
        const response = await fetch(`${backendUrl}/road-conditions?lat=${lat}&lng=${lng}&radius=3`);
        
        if (!response.ok) {
            console.warn('Road conditions API not available:', response.status);
            return null;
        }
        
        const roadData = await response.json();
        console.log('✅ Road conditions fetched:', roadData);
        
        // Display road conditions in the route info section
        displayRoadConditionsInfo(roadData);
        
        return roadData;
    } catch (error) {
        console.error('Error fetching road conditions:', error);
        return null;
    }
}

// Display road conditions information in the UI
function displayRoadConditionsInfo(roadData) {
    // Find or create road conditions container
    let roadConditionsContainer = document.getElementById('roadConditionsInfo');
    
    if (!roadConditionsContainer) {
        // Create container if it doesn't exist
        const routeInfoBox = document.getElementById('routeInfo');
        if (!routeInfoBox) return;
        
        roadConditionsContainer = document.createElement('div');
        roadConditionsContainer.id = 'roadConditionsInfo';
        roadConditionsContainer.className = 'mt-4 bg-white p-3 rounded-lg shadow-sm';
        routeInfoBox.appendChild(roadConditionsContainer);
    }
    
    // Build HTML for road conditions
    let html = `
        <h4 class="font-bold text-md mb-3 text-gray-800 flex items-center">
            <i data-feather="alert-circle" class="w-5 h-5 text-orange-500 mr-2"></i>
            Road Conditions
        </h4>
    `;
    
    // Traffic conditions
    if (roadData.traffic_conditions && roadData.traffic_conditions.length > 0) {
        html += `<div class="mb-3">
            <h5 class="font-semibold text-sm text-gray-700 mb-2">🚗 Traffic Conditions:</h5>
            <div class="space-y-2">`;
        
        roadData.traffic_conditions.forEach(traffic => {
            const statusColor = traffic.status === 'heavy' ? 'text-red-600' : 
                              traffic.status === 'moderate' ? 'text-orange-600' : 'text-green-600';
            const statusBg = traffic.status === 'heavy' ? 'bg-red-50' : 
                           traffic.status === 'moderate' ? 'bg-orange-50' : 'bg-green-50';
            
            html += `
                <div class="p-2 ${statusBg} rounded border-l-2 ${statusColor}">
                    <div class="flex justify-between items-center">
                        <span class="font-medium text-sm">${traffic.location}</span>
                        <span class="text-xs px-2 py-1 rounded-full ${statusColor.replace('text-', 'bg-')} text-white">
                            ${traffic.status.toUpperCase()}
                        </span>
                    </div>
                    <p class="text-xs text-gray-600 mt-1">${traffic.description}</p>
                    <p class="text-xs text-gray-600">Speed: ${traffic.estimated_speed} km/h</p>
                </div>
            `;
        });
        
        html += `</div></div>`;
    }
    
    // Road works
    if (roadData.road_works && roadData.road_works.length > 0) {
        html += `<div class="mb-3">
            <h5 class="font-semibold text-sm text-gray-700 mb-2">🚧 Road Works:</h5>
            <div class="space-y-2">`;
        
        roadData.road_works.forEach(work => {
            const severityColor = work.severity === 'high' ? 'text-red-600' : 
                                work.severity === 'medium' ? 'text-orange-600' : 'text-yellow-600';
            const severityBg = work.severity === 'high' ? 'bg-red-50' : 
                             work.severity === 'medium' ? 'bg-orange-50' : 'bg-yellow-50';
            
            html += `
                <div class="p-2 ${severityBg} rounded border-l-2 ${severityColor}">
                    <div class="flex justify-between items-center">
                        <span class="font-medium text-sm">${work.location}</span>
                        <span class="text-xs px-2 py-1 rounded-full bg-gray-200 text-gray-800">
                            ${work.type.replace('_', ' ').toUpperCase()}
                        </span>
                    </div>
                    <p class="text-xs text-gray-600 mt-1">${work.description}</p>
                    <p class="text-xs text-gray-600">Duration: ${work.expected_duration}</p>
                    <p class="text-xs font-semibold text-gray-700 mt-1 italic">⚠️ ${work.advisory}</p>
                </div>
            `;
        });
        
        html += `</div></div>`;
    }
    
    // Active incidents
    if (roadData.incidents && roadData.incidents.length > 0) {
        html += `<div class="mb-3">
            <h5 class="font-semibold text-sm text-gray-700 mb-2">⚠️ Incidents:</h5>
            <div class="space-y-2">`;
        
        roadData.incidents.forEach(incident => {
            const severityColor = incident.severity === 'major' ? 'text-red-600' : 'text-orange-600';
            const severityBg = incident.severity === 'major' ? 'bg-red-50' : 'bg-orange-50';
            
            html += `
                <div class="p-2 ${severityBg} rounded border-l-2 ${severityColor}">
                    <div class="flex justify-between items-center">
                        <span class="font-medium text-sm">${incident.location}</span>
                        <span class="text-xs px-2 py-1 rounded-full bg-gray-200 text-gray-800">
                            ${incident.type.toUpperCase()}
                        </span>
                    </div>
                    <p class="text-xs text-gray-600 mt-1">${incident.description}</p>
                    <p class="text-xs text-gray-600">Clearance: ${incident.estimated_clearance}</p>
                </div>
            `;
        });
        
        html += `</div></div>`;
    }
    
    // Summary
    if (roadData.summary) {
        const summaryColor = roadData.summary.overall_status === 'heavy' ? 'bg-red-50 border-red-200' : 
                           roadData.summary.overall_status === 'moderate' ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200';
        
        html += `
            <div class="p-2 ${summaryColor} rounded border">
                <p class="text-xs font-semibold text-gray-800">📋 Summary:</p>
                <p class="text-xs text-gray-700 mt-1">${roadData.summary.recommendation}</p>
            </div>
        `;
    }
    
    roadConditionsContainer.innerHTML = html;
    
    // Replace feather icons
    if (typeof feather !== 'undefined') {
        feather.replace();
    }
}

// Search for locations using GraphHopper Geocoding API with Santa Cruz bounds
async function searchLocations(query) {
    if (!query || query.length < 2) {
        hideSearchResults();
        return;
    }
    showSearchLoading();
    try {
        const apiKey = '92bf00ca-1e51-4739-9e62-4ca42c5ba889';
        // Construct the API URL with bounding box for Santa Cruz, Laguna
        const bbox = `${SANTA_CRUZ_BOUNDS.southWest[1]},${SANTA_CRUZ_BOUNDS.southWest[0]},${SANTA_CRUZ_BOUNDS.northEast[1]},${SANTA_CRUZ_BOUNDS.northEast[0]}`;
        const url = `https://graphhopper.com/api/1/geocode?q=${encodeURIComponent(query)}&locale=en&key=${apiKey}&bbox=${bbox}&limit=8`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        const data = await response.json();
        // Filter results to ensure they're within Santa Cruz bounds
        const filteredHits = data.hits ? data.hits.filter(hit => {
            if (!hit.point) return false;
 
            const lat = hit.point.lat;
            const lng = hit.point.lng;
 
            // Check if the point is within our Santa Cruz bounds
            return lat >= SANTA_CRUZ_BOUNDS.southWest[0] &&
                   lat <= SANTA_CRUZ_BOUNDS.northEast[0] &&
                   lng >= SANTA_CRUZ_BOUNDS.southWest[1] &&
                   lng <= SANTA_CRUZ_BOUNDS.northEast[1];
        }) : [];
        displaySearchResults(filteredHits);
    } catch (error) {
        console.error('Error searching locations:', error);
        displaySearchError('Failed to search locations. Please try again.');
    }
}
// Show search loading indicator
function showSearchLoading() {
    const resultsContainer = document.getElementById('mapSearchResults');
    resultsContainer.innerHTML = `
        <div class="search-loading">
            <i data-feather="loader" class="search-loading-icon w-4 h-4"></i>
            Searching Santa Cruz, Laguna...
        </div>
    `;
    resultsContainer.style.display = 'block';
    feather.replace();
}
// Display search results
function displaySearchResults(results) {
    const resultsContainer = document.getElementById('mapSearchResults');
    if (results.length === 0) {
        resultsContainer.innerHTML = '<div class="search-loading">No results found in Santa Cruz, Laguna</div>';
        return;
    }
    let html = '';
    // Group by type
    const points = results.filter(r => r.point && (r.name || r.street));
    const cities = results.filter(r => r.city && !r.point);
    if (points.length > 0) {
        points.forEach(result => {
            html += createSearchResultItem(result, 'map-pin');
        });
    }
    if (cities.length > 0) {
        cities.forEach(result => {
            html += createSearchResultItem(result, 'map');
        });
    }
    resultsContainer.innerHTML = html;
    resultsContainer.style.display = 'block';
    feather.replace();
}
// Create HTML for a search result item
function createSearchResultItem(result, iconType = 'map-pin') {
    let name = result.name || result.street || '';
    let details = [];
    if (result.housenumber) details.push(result.housenumber);
    if (result.street && result.street !== name) details.push(result.street);
    if (result.city) details.push(result.city);
    if (result.country) details.push(result.country);
    const detailText = details.length > 0 ? details.join(', ') : '';
    return `
        <div class="search-result-item" data-lat="${result.point ? result.point.lat : ''}" data-lng="${result.point ? result.point.lng : ''}">
            <div class="search-result-icon">
                <i data-feather="${iconType}" class="w-4 h-4"></i>
            </div>
            <div class="search-result-content">
                <div class="search-result-name">${name}</div>
                <div class="search-result-details">${detailText}</div>
            </div>
        </div>
    `;
}
// Display search error
function displaySearchError(message) {
    const resultsContainer = document.getElementById('mapSearchResults');
    resultsContainer.innerHTML = `<div class="search-loading">${message}</div>`;
    resultsContainer.style.display = 'block';
}
// Hide search results
function hideSearchResults() {
    const resultsContainer = document.getElementById('mapSearchResults');
    resultsContainer.style.display = 'none';
}
// Update search clear button visibility
function updateSearchClearButton() {
    const searchInput = document.getElementById('mapSearchInput');
    const clearButton = document.getElementById('mapSearchClear');
    if (searchInput.value.length > 0) {
        clearButton.style.display = 'block';
    } else {
        clearButton.style.display = 'none';
    }
}
// Clear search input and results
function clearSearch() {
    const searchInput = document.getElementById('mapSearchInput');
    searchInput.value = '';
    hideSearchResults();
    updateSearchClearButton();
    searchInput.focus();
}
// Show location modal to request user permission
function showLocationModal() {
    const modal = document.getElementById('locationModal');
    modal.classList.remove('hidden');
    // Reset modal content
    document.getElementById('locationRequestContent').classList.remove('hidden');
    document.getElementById('locationDetectingContent').classList.add('hidden');
    document.getElementById('locationErrorContent').classList.add('hidden');
}
// Hide location modal
function hideLocationModal() {
    const modal = document.getElementById('locationModal');
    modal.classList.add('hidden');
}
// Show detecting state in modal
function showDetectingState() {
    document.getElementById('locationRequestContent').classList.add('hidden');
    document.getElementById('locationDetectingContent').classList.remove('hidden');
    document.getElementById('locationErrorContent').classList.add('hidden');
}
// Show error state in modal
function showErrorState() {
    document.getElementById('locationRequestContent').classList.add('hidden');
    document.getElementById('locationDetectingContent').classList.add('hidden');
    document.getElementById('locationErrorContent').classList.remove('hidden');
}
// Automatically detect user location on FIRST VISIT only
function autoDetectLocation() {
    // Check if we've already asked for location
    const locationAsked = localStorage.getItem('locationPermissionAsked');
    if (locationAsked) {
        // We've already asked, don't show modal again
        console.log('Location permission was already requested, skipping modal');
        return;
    }
    if (!navigator.geolocation) {
        console.log('Geolocation is not supported by this browser');
        showErrorState();
        return;
    }
    showLocationModal();
    // Mark that we've asked for location permission
    localStorage.setItem('locationPermissionAsked', 'true');
}
// Function to manually trigger location request (bypasses the one-time check)
function manualLocationRequest() {
    console.log('📍 Manual location request initiated');
    
    if (!navigator.geolocation) {
        alert('❌ Geolocation is not supported by your browser. Please use a modern browser like Chrome, Firefox, or Safari.');
        console.error('Geolocation not available');
        return;
    }
    
    // Check if map is ready
    if (!map) {
        alert('⏳ The map is still loading. Please try again in a moment.');
        console.warn('Map not ready for location request');
        return;
    }
    
    console.log('📋 Showing location permission modal');
    showLocationModal();
}
// NEW FUNCTION: Auto-locate user immediately when page loads
function autoLocateUser() {
    if (!navigator.geolocation) {
        console.log('⚠️ Geolocation is not supported by this browser');
        return;
    }
    
    // Check if map is ready
    if (!map) {
        console.log('⏳ Map not ready yet, will try auto-locate when map is ready');
        return;
    }
    
    console.log('🎬 Attempting to automatically locate user...');
    // Show detecting state briefly
    showDetectingState();
    navigator.geolocation.getCurrentPosition(
        function(position) {
            console.log('✅ Auto-location obtained:', position.coords);
            
            // Ensure map is still available
            if (!map) {
                console.error('Map was destroyed during location request');
                return;
            }
            
            const latlng = { lat: position.coords.latitude, lng: position.coords.longitude };
 
            console.log('User location found:', latlng);
 
            // Update or create current location marker
            if (currentLocationMarker) {
                currentLocationMarker.setPosition(latlng);
            } else {
                const markerIcon = createPinIcon('#22c55e');
                currentLocationMarker = new google.maps.Marker({
                    position: latlng,
                    map: map,
                    title: 'Your Current Location',
                    icon: markerIcon,
                    animation: google.maps.Animation.DROP
                });
                
                const infoWindow = new google.maps.InfoWindow({
                    content: '<div style="color: black;"><b>Your Current Location</b></div>'
                });
                currentLocationMarker.addListener('click', () => {
                    infoWindow.open(map, currentLocationMarker);
                });
                infoWindow.open(map, currentLocationMarker);
            }
 
            // Center map on user location
            map.setCenter(latlng);
            map.setZoom(15);
            updateLocationStatus(true);
            currentPosition = position;

            // Store last position
            localStorage.setItem('lastLat', position.coords.latitude);
            localStorage.setItem('lastLng', position.coords.longitude);
            
            // Update station in the report form
            updateReportStation(position.coords.latitude, position.coords.longitude);

            // Update real-time weather for current location
            fetchWeather(position.coords.latitude, position.coords.longitude);
 
            // Hide modal
            hideLocationModal();
 
            // Show success notification
            showTemporaryNotification('✅ Your location has been found and pinned!', false);
 
            console.log('✅ User location pinned successfully');
        },
        function(error) {
            console.error('❌ Error getting location automatically:', error.code, error.message);
 
            // Show modal to let user manually allow location
            showLocationModal();
        },
        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 60000
        }
    );
}
// Locate user and center map - UPDATED TO AUTO-RECALCULATE ROUTE
function locateUser(isAutomatic = false) {
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser');
        return;
    }
    
    // Check if map is ready
    if (!map) {
        console.warn('Map not ready yet, waiting...');
        alert('Map is still loading. Please try again in a moment.');
        return;
    }
    
    if (isAutomatic) {
        showDetectingState();
    }
    navigator.geolocation.getCurrentPosition(
        function(position) {
            console.log('✅ Location obtained:', position.coords.latitude, position.coords.longitude);
            
            // Ensure map is still available
            if (!map) {
                console.error('Map was destroyed');
                alert('Map error occurred. Please refresh the page.');
                return;
            }
            
            const latlng = { lat: position.coords.latitude, lng: position.coords.longitude };
 
            // Update or create current location marker
            if (currentLocationMarker) {
                currentLocationMarker.setPosition(latlng);
            } else {
                const markerIcon = createPinIcon('#22c55e');
                currentLocationMarker = new google.maps.Marker({
                    position: latlng,
                    map: map,
                    title: 'Your Current Location',
                    icon: markerIcon,
                    animation: google.maps.Animation.DROP
                });
                
                const infoWindow = new google.maps.InfoWindow({
                    content: '<div style="color: black;"><b>Your Current Location</b></div>'
                });
                currentLocationMarker.addListener('click', () => {
                    infoWindow.open(map, currentLocationMarker);
                });
                infoWindow.open(map, currentLocationMarker);
            }
 
            map.setCenter(latlng);
            map.setZoom(15);
            updateLocationStatus(true);
            currentPosition = position;
            
            // Update station in the report form
            updateReportStation(position.coords.latitude, position.coords.longitude);

            // Update real-time weather for current location
            fetchWeather(position.coords.latitude, position.coords.longitude);
 
            // AUTO-RECALCULATE ROUTE if destination is set
            if (destinationLatLng) {
                calculateRoute(latlng, destinationLatLng);
     
                // Update route button text
                const routeButton = document.getElementById('calculateRoute');
                if (routeButton) {
                    routeButton.innerHTML = '<i data-feather="navigation" class="w-4 h-4 md:w-5 md:h-5"></i><span>Recalculate Route</span>';
                    feather.replace();
                }
            }
 
            // Hide modal if it was automatic detection
            if (isAutomatic) {
                hideLocationModal();
            }
            
            console.log('✅ Location update complete');
        },
        function(error) {
            console.error('❌ Error getting location:', error.code, error.message);
 
            if (isAutomatic) {
                // For automatic detection, show error state in modal
                showErrorState();
            } else {
                // For manual requests, show alert
                let errorMsg = 'Unable to get your location.';
                if (error.code === 1) {
                    errorMsg = 'Location permission denied. Please enable location access in your browser settings.';
                } else if (error.code === 2) {
                    errorMsg = 'Location information is unavailable. Please check your device location services.';
                } else if (error.code === 3) {
                    errorMsg = 'Location request timed out. Please try again.';
                }
                alert(errorMsg);
                updateLocationStatus(false);
            }
        },
        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 60000
        }
    );
}
// Toggle continuous tracking
function toggleTracking() {
    const button = document.getElementById('toggleTracking');
    const mobileTrackBtn = document.getElementById('mobileTrack');
    
    if (!isTracking) {
        // Start tracking
        if (!navigator.geolocation) {
            alert('Geolocation is not supported by your browser');
            return;
        }
        watchId = navigator.geolocation.watchPosition(
            function(position) {
                const latlng = { lat: position.coords.latitude, lng: position.coords.longitude };
     
                // Calculate speed and heading if we have previous position
                if (previousPosition) {
                    calculateMovementMetrics(previousPosition, position);
                }
     
                previousPosition = position;
                currentPosition = position;

                // Store last position
                localStorage.setItem('lastLat', position.coords.latitude);
                localStorage.setItem('lastLng', position.coords.longitude);
                
                // Update weather periodically during tracking (every 5 mins or so)
                const lastWeatherUpdate = currentWeatherData ? currentWeatherData.lastUpdate : 0;
                const now = Date.now();
                if (!lastWeatherUpdate || (now - lastWeatherUpdate > 300000)) {
                    fetchWeather(position.coords.latitude, position.coords.longitude);
                    if (currentWeatherData) currentWeatherData.lastUpdate = now;
                }
     
                // Update marker position and follow user on map
                if (currentLocationMarker) {
                    currentLocationMarker.setPosition(latlng);
                } else {
                    const markerIcon = createPinIcon('#22c55e');
                    currentLocationMarker = new google.maps.Marker({
                        position: latlng,
                        map: map,
                        title: 'Your Live Location',
                        icon: markerIcon,
                        animation: google.maps.Animation.DROP
                    });
                    
                    const infoWindow = new google.maps.InfoWindow({
                        content: '<div style="color: black;"><b>Your Live Location</b></div>'
                    });
                    currentLocationMarker.addListener('click', () => {
                        infoWindow.open(map, currentLocationMarker);
                    });
                }
     
                // Auto-pan map to follow user during navigation
                if (map) {
                    map.setCenter(latlng);
                }

                // If destination is set and we're navigating, update the route
                if (destinationLatLng) {
                    updateRoutePosition(latlng);
                    checkArrival(latlng, destinationLatLng);
                }
            },
            function(error) {
                console.error('Error watching position:', error);
                // Provide more user-friendly error messages
                let errorMsg = 'Unable to get your live location.';
                if (error.code === error.PERMISSION_DENIED) {
                    errorMsg = 'Location permission denied. Please enable location services.';
                } else if (error.code === error.TIMEOUT) {
                    errorMsg = 'Location request timed out. Trying again...';
                }
                showTemporaryNotification(errorMsg, true);
                updateLocationStatus(false);
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 5000
            }
        );
        isTracking = true;
        if (button) {
            button.innerHTML = '<i data-feather="pause" class="w-4 h-4"></i><span>Stop Tracking</span>';
            button.className = 'px-3 py-2 bg-red-500 text-white rounded-lg text-sm flex items-center space-x-1';
        }
        updateLocationStatus(true);

        // CAPTURE TIME DISPATCHED when start tracking is clicked
        const now = new Date();
        const timeDispatched = now.toTimeString().slice(0, 5);
        const dispatchedInput = document.getElementById('time_dispatched');
        if (dispatchedInput) {
            dispatchedInput.value = timeDispatched;
            console.log('Time Dispatched captured from Start Tracking:', timeDispatched);
        }

        // Update mobile button
        if (mobileTrackBtn) {
            mobileTrackBtn.innerHTML = '<i data-feather="pause" class="w-5 h-5 mb-1"></i><span class="text-xs">Stop</span>';
            mobileTrackBtn.className = 'mobile-control-btn bg-red-500 text-white';
        }
    } else {
        // Stop tracking
        navigator.geolocation.clearWatch(watchId);
        isTracking = false;
        
        // Capture arrival time when tracking stops
        const now = new Date();
        const timeString = now.toTimeString().slice(0, 5);
        const arrivalInput = document.getElementById('time_arrival');
        if (arrivalInput) {
            arrivalInput.value = timeString;
            // Also recalculate response time if possible
            if (typeof calculateResponseTime === 'function') {
                calculateResponseTime();
            }
            console.log('Arrival time captured from Stop Tracking:', timeString);
        }

        if (button) {
            button.innerHTML = '<i data-feather="map-pin" class="w-4 h-4"></i><span>Start Tracking</span>';
            button.className = 'px-3 py-2 bg-green-500 text-white rounded-lg text-sm flex items-center space-x-1';
        }
        // Update mobile button
        if (mobileTrackBtn) {
            mobileTrackBtn.innerHTML = '<i data-feather="map-pin" class="w-5 h-5 mb-1"></i><span class="text-xs">Track</span>';
            mobileTrackBtn.className = 'mobile-control-btn bg-green-500 text-white';
        }
    }
    feather.replace();
}
// Calculate movement metrics (speed and heading)
function calculateMovementMetrics(prevPos, currPos) {
    // Calculate distance in meters
    const lat1 = prevPos.coords.latitude;
    const lon1 = prevPos.coords.longitude;
    const lat2 = currPos.coords.latitude;
    const lon2 = currPos.coords.longitude;
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    // Calculate time difference in hours
    const timeDiff = (currPos.timestamp - prevPos.timestamp) / 1000 / 3600;
    // Speed in km/h
    if (timeDiff > 0) {
        currentSpeed = (distance / 1000) / timeDiff;
    }
    // Calculate heading
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
    currentHeading = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
// Update location status indicator
function updateLocationStatus(active) {
    const statusElement = document.getElementById('location-status');
    const textElement = statusElement ? statusElement.querySelector('.location-text') : null;
    if (statusElement) {
        if (active) {
            if (textElement) textElement.textContent = 'LIVE';
            statusElement.className = 'location-status location-active';
            localStorage.setItem('locationActive', 'true');
        } else {
            if (textElement) textElement.textContent = 'GPS';
            statusElement.className = 'location-status location-inactive';
            localStorage.setItem('locationActive', 'false');
        }
    }
}
// Update route position during navigation
function updateRoutePosition(currentLatLng) {
    if (routingControl && destinationLatLng) {
        // Check distance from last update to optimize (e.g., only update every 10 meters)
        if (lastRouteUpdatePosition) {
            // Calculate distance manually instead of using Leaflet
            const lat1 = currentLatLng.lat;
            const lng1 = currentLatLng.lng;
            const lat2 = lastRouteUpdatePosition.lat;
            const lng2 = lastRouteUpdatePosition.lng;
            
            const R = 6371; // Earth's radius in km
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLng = (lng2 - lng1) * Math.PI / 180;
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                      Math.sin(dLng/2) * Math.sin(dLng/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            const dist = R * c; // Distance in km
            
            if (dist < 0.01) return; // Only update if moved more than 10 meters (0.01 km)
        }
        
        console.log('🔄 Updating route position instantly...');
        lastRouteUpdatePosition = currentLatLng;
        
        // Recalculate route to update with current position
        calculateRoute(currentLatLng, destinationLatLng);
    }
}
// Fetch weather data with fallback
// Fetch weather data based on coordinates or default city
async function fetchWeather(lat = null, lng = null) {
    try {
        const apiKeys = [
            'e480bec2951804e81f84999747008cbb',
            'demo'
        ];
        
        let url;
        if (lat && lng) {
            url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&units=metric&appid=`;
        } else {
            url = `https://api.openweathermap.org/data/2.5/weather?q=Santa Cruz,Laguna,PH&units=metric&appid=`;
        }

        let weatherData = null;
        for (const apiKey of apiKeys) {
            try {
                const response = await fetch(url + apiKey);
                if (response.ok) {
                    weatherData = await response.json();
                    break;
                }
            } catch (error) {
                console.warn(`Weather API key ${apiKey} failed:`, error);
                continue;
            }
        }

        if (weatherData) {
            // Update UI with real-time data
            document.getElementById('weather-temp').textContent = `${Math.round(weatherData.main.temp)}°C`;
            document.getElementById('weather-condition').textContent = weatherData.weather[0].main;
            document.getElementById('weather-humidity').textContent = `${weatherData.main.humidity}%`;
            document.getElementById('weather-wind').textContent = `${(weatherData.wind.speed * 3.6).toFixed(1)} km/h`;
            
            // Update location name if it's from coordinates
            if (weatherData.name) {
                document.getElementById('weather-location').textContent = weatherData.name + (weatherData.sys.country ? `, ${weatherData.sys.country}` : '');
            }
 
            // Store weather data for prediction
            currentWeatherData = {
                temperature: Math.round(weatherData.main.temp),
                humidity: weatherData.main.humidity,
                windSpeed: (weatherData.wind.speed * 3.6).toFixed(1),
                condition: weatherData.weather[0].main,
                location: weatherData.name,
                lastUpdate: Date.now()
            };
            console.log('Real-time weather data loaded for:', weatherData.name);
        } else {
            throw new Error('All weather API attempts failed');
        }
    } catch (error) {
        console.error('Error fetching weather data:', error);
        // Fallback to defaults
        if (!currentWeatherData) {
            currentWeatherData = {
                temperature: 28,
                humidity: 75,
                windSpeed: 12,
                condition: 'Clear',
                location: 'Santa Cruz, Laguna'
            };
        }
    }
}
// Update current time
function updateTime() {
    const now = new Date();
    
    // Format Date: Weekday, Month Day, Year
    const dateOptions = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    };
    const dateStr = now.toLocaleDateString('en-US', dateOptions);
    
    // Format Time: HH:MM:SS AM/PM
    const timeOptions = {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    };
    const timeStr = now.toLocaleTimeString('en-US', timeOptions);
    
    const timeElement = document.getElementById('current-time');
    if (timeElement) {
        timeElement.innerHTML = `<div class="text-xs opacity-90">${dateStr}</div><div class="font-bold">${timeStr}</div>`;
    }
}
// Toggle mobile sidebar
function toggleSidebar(forceClose = false) {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('overlay');
    
    // Check if forceClose is explicitly true (not an Event object)
    const shouldClose = (forceClose === true);
    
    if (shouldClose) {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
    } else {
        sidebar.classList.toggle('active');
        overlay.classList.toggle('active');
    }
}
// Setup the incident learning system
function setupIncidentLearning() {
    // Manual Training Button
    document.getElementById('manualTrainBtn').addEventListener('click', async function() {
        const button = this;
        const originalText = button.innerHTML;
        button.innerHTML = '<i data-feather="loader" class="w-4 h-4 mr-2 animate-spin"></i>Training...';
        button.disabled = true;
        feather.replace();
        try {
            await incidentLearner.trainModel(incidentLearner.trainingData);
        } finally {
            button.innerHTML = originalText;
            button.disabled = false;
            feather.replace();
        }
    });
    // Check Status Button
    document.getElementById('checkStatusBtn').addEventListener('click', async function() {
        // Refresh incidents first to update count
        await incidentLearner.loadIncidents();
        // Then check model status
        await incidentLearner.checkModelStatus();
        incidentLearner.showNotification('Data count and model status refreshed');
    });
    /*
    // Add event listeners for accuracy refresh and training
    document.getElementById('refreshAccuracy')?.addEventListener('click', () => {
        incidentLearner.checkModelStatus();
        incidentLearner.showNotification('Accuracy refreshed');
    });
    document.getElementById('trainNow')?.addEventListener('click', async () => {
        const button = document.getElementById('trainNow');
        const originalText = button.innerHTML;
        button.innerHTML = '<i data-feather="loader" class="w-4 h-4 mr-2 animate-spin"></i>Training...';
        button.disabled = true;
        feather.replace();
        try {
            await incidentLearner.trainModel(incidentLearner.trainingData);
        } finally {
            button.innerHTML = originalText;
            button.disabled = false;
            feather.replace();
        }
    });
    */
    // Remove auto-reporting since we only have detailed reports now
    // setupAutoReporting();
}
// Function to reset location permission (useful for testing)
function resetLocationPermission() {
    localStorage.removeItem('locationPermissionAsked');
    console.log('Location permission reset - modal will show on next page load');
}
// Add this function to calculate response time automatically
function calculateResponseTime() {
    const timeReceived = document.getElementById('time_received').value;
    const timeArrival = document.getElementById('time_arrival').value;
    if (timeReceived && timeArrival) {
        // Convert time strings to minutes since midnight
        const [receivedHours, receivedMinutes] = timeReceived.split(':').map(Number);
        const [arrivalHours, arrivalMinutes] = timeArrival.split(':').map(Number);
        const receivedTotalMinutes = receivedHours * 60 + receivedMinutes;
        const arrivalTotalMinutes = arrivalHours * 60 + arrivalMinutes;
        // Calculate difference (handle overnight cases)
        let diffMinutes = arrivalTotalMinutes - receivedTotalMinutes;
        if (diffMinutes < 0) {
            diffMinutes += 24 * 60; // Add 24 hours if arrival is next day
        }
        document.getElementById('response_time_min').value = diffMinutes;
    }
}
// Add form validation for time logic
function validateTimes() {
    const timeReceived = document.getElementById('time_received').value;
    const timeArrival = document.getElementById('time_arrival').value;
    if (timeReceived && timeArrival) {
        const [receivedHours, receivedMinutes] = timeReceived.split(':').map(Number);
        const [arrivalHours, arrivalMinutes] = timeArrival.split(':').map(Number);
        const receivedTotalMinutes = receivedHours * 60 + receivedMinutes;
        const arrivalTotalMinutes = arrivalHours * 60 + arrivalMinutes;
        let diffMinutes = arrivalTotalMinutes - receivedTotalMinutes;
        if (diffMinutes < 0) {
            diffMinutes += 24 * 60;
        }
        if (diffMinutes <= 0) {
            alert('Error: Arrival time must be after received time');
            document.getElementById('time_arrival').value = '';
            document.getElementById('response_time_min').value = '';
            return false;
        }
        if (diffMinutes > 480) { // 8 hours max
            alert('Warning: Response time seems unusually long. Please verify the times.');
        }
    }
    return true;
}
// Auto-fill current data function
function populateWithCurrentData() {
    // Date is handled normally
    document.getElementById('date_of_response').valueAsDate = new Date();
    
    // Location is already synced from pin
    if (currentLocationName) {
        document.getElementById('location').value = currentLocationName;
    }
    
    // Distance from navigation
    const distanceElement = document.getElementById('distance');
    if (distanceElement && distanceElement.textContent) {
        const distanceText = distanceElement.textContent;
        if (distanceText && distanceText !== '--') {
            const distanceVal = parseFloat(distanceText.replace(' km', ''));
            const distanceInput = document.getElementById('distance');
            if (distanceInput && distanceInput.type === 'number') {
                distanceInput.value = distanceVal;
            }
        }
    }
    
    // Type of occupancy from sidebar
    const sidebarOccupancy = document.getElementById('occupancyType').value;
    if (sidebarOccupancy) {
        document.getElementById('type_of_occupancy').value = sidebarOccupancy;
    }
    
    // Weather from live data
    if (currentWeatherData) {
        document.getElementById('temperature_c').value = currentWeatherData.temperature || 28;
        document.getElementById('humidity_pct').value = currentWeatherData.humidity || 75;
        document.getElementById('wind_speed_kmh').value = currentWeatherData.windSpeed || 12;
        document.getElementById('weather_condition').value = currentWeatherData.condition || 'Clear';
        document.getElementById('road_condition').value = 'Dry';
    }
    
    // Recalculate response time based on the event-captured times
    calculateResponseTime();
    
    document.getElementById('remarks').value = 'Case Closed';
    incidentLearner.showNotification('Form synced with tracked response data');
}
// Initialize form with current date when incidents section is loaded
function initializeReportForm() {
    // Set current date as default
    const dateInput = document.getElementById('date_of_response');
    if (dateInput) {
        dateInput.valueAsDate = new Date();
    }
    // Set station based on current location if available, otherwise use default
    if (currentPosition) {
        updateReportStation(currentPosition.coords.latitude, currentPosition.coords.longitude);
    } else {
        document.getElementById('station').value = 'Santa Cruz Fire Station, Laguna';
    }
    // Set blank/default values for dropdowns
    document.getElementById('location').value = '';
    document.getElementById('responding_unit').value = '';
    document.getElementById('alarm_status').value = '';
    document.getElementById('type_of_occupancy').value = '';
    document.getElementById('road_condition').value = '';
    document.getElementById('remarks').value = 'Case Closed';
    // Set default numeric values
    document.getElementById('injured_civ').value = 0;
    document.getElementById('injured_bfp').value = 0;
    document.getElementById('death_civ').value = 0;
    document.getElementById('death_bfp').value = 0;
    
    // Ensure these are blank as requested
    document.getElementById('response_time_min').value = '';
    document.getElementById('distance').value = '';
    
    // Ensure weather fields are blank on initialization
    document.getElementById('temperature_c').value = '';
    document.getElementById('humidity_pct').value = '';
    document.getElementById('wind_speed_kmh').value = '';
    document.getElementById('weather_condition').value = '';
    
    // Add event listeners for automatic response time calculation
    document.getElementById('time_received').addEventListener('change', calculateResponseTime);
    document.getElementById('time_arrival').addEventListener('change', calculateResponseTime);
}
// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    console.log('✅ DOM Content Loaded - script.js active');
    console.log('Map status - map object:', typeof map, 'mapsReady:', typeof mapsReady !== 'undefined' ? mapsReady : 'undefined');
    console.log('initMap function:', typeof initMap);
    
    // Set up event listeners after DOM is ready
    const locateMeBtn = document.getElementById('locateMe');
    if (locateMeBtn) {
        locateMeBtn.addEventListener('click', function() {
            manualLocationRequest();
        });
    }
    
    const trackBtn = document.getElementById('toggleTracking');
    if (trackBtn) {
        trackBtn.addEventListener('click', toggleTracking);
    }
    
    // Location modal event listeners
    const allowBtn = document.getElementById('allowLocation');
    if (allowBtn) {
        allowBtn.addEventListener('click', function() {
            locateUser(true);
        });
    }
    
    const denyBtn = document.getElementById('denyLocation');
    if (denyBtn) {
        denyBtn.addEventListener('click', function() {
            hideLocationModal();
        });
    }
    
    const closeBtn = document.getElementById('closeLocationModal');
    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            hideLocationModal();
        });
    }
    
    // Mobile control buttons
    const mobileLocateBtn = document.getElementById('mobileLocate');
    if (mobileLocateBtn) {
        mobileLocateBtn.addEventListener('click', function() {
            manualLocationRequest();
        });
    }
    
    const mobileTrackBtn = document.getElementById('mobileTrack');
    if (mobileTrackBtn) {
        mobileTrackBtn.addEventListener('click', toggleTracking);
    }
    
    const mobileNavigateBtn = document.getElementById('mobileNavigate');
    if (mobileNavigateBtn) {
        mobileNavigateBtn.addEventListener('click', function() {
            if (!destinationLatLng) {
                alert('Please set a destination location first using the search bar or by clicking on the map');
                return;
            }
            if (!currentPosition) {
                alert('Please enable location services and wait for your position to be determined.');
                return;
            }
            const button = this;
            const originalText = button.innerHTML;
            button.innerHTML = '<i data-feather="loader" class="w-5 h-5 animate-spin"></i><span class="text-xs">Calc...</span>';
            button.disabled = true;
            feather.replace();
            if (!isTracking) {
                toggleTracking();
            }
            const currentLatLng = { lat: currentPosition.coords.latitude, lng: currentPosition.coords.longitude };
            calculateRoute(currentLatLng, destinationLatLng);
            setTimeout(() => {
                button.innerHTML = originalText;
                button.disabled = false;
                feather.replace();
            }, 2000);
        });
    }
    // Map search input handling
    const mapSearchInput = document.getElementById('mapSearchInput');
    if (mapSearchInput) {
        mapSearchInput.addEventListener('input', function() {
            // Update clear button visibility
            updateSearchClearButton();
            // Clear previous timeout
            if (searchTimeout) {
                clearTimeout(searchTimeout);
            }
            // Set new timeout to search after user stops typing
            searchTimeout = setTimeout(() => {
                searchLocations(this.value);
            }, 300);
        });
    }
    
    // Map search clear button
    const mapSearchClear = document.getElementById('mapSearchClear');
    if (mapSearchClear) {
        mapSearchClear.addEventListener('click', clearSearch);
    }
    
    // Handle clicks on map search results
    const mapSearchResults = document.getElementById('mapSearchResults');
    if (mapSearchResults) {
        mapSearchResults.addEventListener('click', function(e) {
            const resultItem = e.target.closest('.search-result-item');
            if (resultItem && resultItem.dataset.lat && resultItem.dataset.lng) {
                const lat = parseFloat(resultItem.dataset.lat);
                const lng = parseFloat(resultItem.dataset.lng);
                
                // Get location name for auto-fill
                const name = resultItem.querySelector('.search-result-name').textContent;
                const details = resultItem.querySelector('.search-result-details').textContent;
                const fullName = name + (details ? ', ' + details : '');
     
                // Set destination marker at selected location
                setDestinationMarker({ lat: lat, lng: lng }, fullName);
     
                // Center map on selected location
                if (map) {
                    map.setCenter({ lat: lat, lng: lng });
                    map.setZoom(15);
                }
     
                // Hide search results
                hideSearchResults();
     
                // Clear search input
                if (mapSearchInput) {
                    mapSearchInput.value = '';
                }
                updateSearchClearButton();
     
                // AUTO-CALCULATE ROUTE if we have current position
                if (currentPosition) {
                    const currentLatLng = [currentPosition.coords.latitude, currentPosition.coords.longitude];
                    calculateRoute(currentLatLng, [lat, lng]);
                }
            }
        });
    }
    // Close search results when clicking outside
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.map-search-container')) {
            hideSearchResults();
        }
    });
    // Calculate route button
    const calculateRouteBtn = document.getElementById('calculateRoute');
    if (calculateRouteBtn) {
        calculateRouteBtn.addEventListener('click', async function() {
            if (!destinationLatLng) {
                alert('Please set a destination location first using the search bar or by clicking on the map');
                return;
            }
            
            // Try to get current position if it's missing
            if (!currentPosition) {
                console.log('Current position missing, attempting to locate user...');
                showTemporaryNotification('Locating your position before starting...', false);
                
                // Wait for position
                try {
                    await new Promise((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(
                            (pos) => {
                                currentPosition = pos;
                                resolve(pos);
                            },
                            (err) => reject(err),
                            { enableHighAccuracy: true, timeout: 5000 }
                        );
                    });
                } catch (error) {
                    console.error('Failed to get position for navigation:', error);
                    alert('Please enable location services and wait for your position to be determined.');
                    return;
                }
            }

            const button = this;
            const originalText = button.innerHTML;
            // Show loading state
            button.innerHTML = '<i data-feather="loader" class="w-5 h-5 animate-spin"></i><span>Calculating...</span>';
            button.disabled = true;
            feather.replace();
            // Start tracking if not already
            if (!isTracking) {
                toggleTracking();
            }
            // Calculate route from current position to destination
            const currentLatLng = { lat: currentPosition.coords.latitude, lng: currentPosition.coords.longitude };
            calculateRoute(currentLatLng, destinationLatLng);
            // Restore button after a delay
            setTimeout(() => {
                button.innerHTML = originalText;
                button.disabled = false;
                feather.replace();
            }, 2000);
        });
    }
    // Mobile menu toggle
    const mobileMenuBtn = document.getElementById('mobileMenu');
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => toggleSidebar());
    }
    const closeSidebarBtn = document.getElementById('closeSidebar');
    if (closeSidebarBtn) {
        closeSidebarBtn.addEventListener('click', () => toggleSidebar(true));
    }
    const overlayBtn = document.getElementById('overlay');
    if (overlayBtn) {
        overlayBtn.addEventListener('click', () => toggleSidebar(true));
    }
    // Navigation event listeners
    document.querySelectorAll('.nav-btn, .nav-btn-mobile').forEach(btn => {
        btn.addEventListener('click', function() {
            switchSection(this.dataset.section);
        });
    });
    // Initialize incident learning system
    incidentLearner = new RealFireIncidentLearner();
    setupIncidentLearning();
    // Enhanced form submission with better error handling
    const incidentReportForm = document.getElementById('incidentReportForm');
    if (incidentReportForm) {
        incidentReportForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('📝 Form submission started...');
        const formData = new FormData(this);
        const data = Object.fromEntries(formData.entries());
        console.log("📊 Form data submitted:", data);
       
        // Convert numeric fields
        const numericFields = ['response_time_min', 'distance', 'injured_civ', 'injured_bfp', 'death_civ', 'death_bfp', 'temperature_c', 'humidity_pct', 'wind_speed_kmh'];
        numericFields.forEach(field => {
            if (data[field]) {
                data[field] = parseFloat(data[field]) || 0;
            }
        });
       
        // Ensure required fields are present
        if (!data.location || !data.type_of_occupancy) {
            incidentLearner.showNotification('Please fill in all required fields (Location and Type of Occupancy)', true);
            return;
        }
       
        try {
            // Show loading state
            const submitButton = this.querySelector('button[type="submit"]');
            const originalText = submitButton.innerHTML;
            submitButton.innerHTML = '<i data-feather="loader" class="w-4 h-4 mr-2 animate-spin"></i>Saving Incident...';
            submitButton.disabled = true;
        
            // Ensure feedback container is visible and show loading
            const feedbackContainer = document.getElementById('performanceFeedback');
            if (feedbackContainer) {
                feedbackContainer.classList.remove('hidden');
                feedbackContainer.innerHTML = `
                    <div class="text-center py-8">
                        <i data-feather="loader" class="w-12 h-12 animate-spin mx-auto text-blue-500 mb-4"></i>
                        <h3 class="text-lg font-semibold text-gray-700">Analyzing Response Performance</h3>
                        <p class="text-sm text-gray-600 mt-2">Comparing with historical data and generating insights...</p>
                    </div>
                `;
                if (typeof feather !== 'undefined') {
                    feather.replace();
                }
            }
           
            const targetUrl = `${incidentLearner.backendUrl}/incidents`;
            console.log(`🚀 Sending incident data to: ${targetUrl}`);
            console.log('📦 Data being sent:', JSON.stringify(data));
        
            // Store the incident with detailed error handling
            const response = await fetch(targetUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(data)
            }).catch(fetchError => {
                console.error('🌐 Network/Fetch Error:', fetchError);
                throw new Error(`Network Error: ${fetchError.message}. Check if backend is running at ${targetUrl}`);
            });

            console.log('📨 Backend response status:', response.status);
        
            if (!response.ok) {
                const errorResult = await response.json();
                throw new Error(errorResult.error || `Server error: ${response.status}`);
            }
            const result = await response.json();
            console.log('✅ Incident stored successfully:', result);
            
            if (!result.id) {
                console.warn('⚠️ Backend did not return an ID, but reported success');
            }
        
            // Force a slight delay to allow DB to commit
            await new Promise(resolve => setTimeout(resolve, 500));
        
            // Update the incidents list in the ML system immediately
            await incidentLearner.loadIncidents();
           
            // Show success notification with the actual ID
            incidentLearner.showNotification(`Incident report #${result.id} saved successfully! Generating analysis...`);
        
            // Now get comprehensive performance feedback with proper data mapping
            console.log('🔄 Requesting comprehensive feedback...');
            try {
                const mlIncidentData = {
                    ...data,
                    response_time: data.response_time_min, // Map to expected field
                    type: data.type_of_occupancy,
                    weather: data.weather_condition,
                    id: result.id,
                    timestamp: result.timestamp || new Date().toISOString()
                };
               
                const feedbackResponse = await fetch(`${incidentLearner.backendUrl}/comprehensive-feedback`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        incident_data: mlIncidentData
                    })
                });
               
                console.log('🔍 Feedback response status:', feedbackResponse.status);
               
                if (feedbackResponse.ok) {
                    const feedbackResult = await feedbackResponse.json();
                    console.log('📊 Comprehensive feedback received:', feedbackResult);
                
                    // Display the comprehensive feedback
                    if (feedbackContainer) {
                        console.log('📺 Displaying feedback in container');
                        incidentLearner.displayComprehensiveFeedback(feedbackResult);
                        
                        // Make absolutely sure it's visible
                        feedbackContainer.classList.remove('hidden');
                        feedbackContainer.style.display = 'block';
                        
                        // Scroll to feedback
                        setTimeout(() => {
                            feedbackContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }, 500);
                        
                        // NOW reset form after feedback is displayed
                        setTimeout(() => {
                            const form = document.getElementById('incidentReportForm');
                            if (form) {
                                form.reset();
                                initializeReportForm();
                            }
                        }, 1000);
                    } else {
                        console.error('❌ Feedback container not found!');
                    }
                
                    incidentLearner.showNotification('Performance analysis complete! Check the feedback above.');
                } else {
                    const errorText = await feedbackResponse.text();
                    console.error('❌ Feedback response error:', errorText);
                    throw new Error(`Failed to get performance feedback: ${feedbackResponse.status}`);
                }
            } catch (feedbackError) {
                console.warn('❌ Could not get comprehensive feedback:', feedbackError);
                console.error('Full error:', feedbackError);
            
                // Show fallback feedback
                if (feedbackContainer) {
                    feedbackContainer.classList.remove('hidden');
                    feedbackContainer.style.display = 'block';
                    feedbackContainer.innerHTML = `
                        <div class="bg-yellow-50 border-l-4 border-yellow-400 p-6">
                            <div class="flex items-center mb-3">
                                <i data-feather="alert-circle" class="w-6 h-6 text-yellow-500 mr-2"></i>
                                <h3 class="text-lg font-semibold text-yellow-800">Analysis Limited</h3>
                            </div>
                            <p class="text-yellow-700">
                                Performance analysis is temporarily unavailable. Your incident has been saved successfully.
                                Continue recording incidents to build better performance insights.
                            </p>
                            <div class="mt-4 p-3 bg-yellow-100 rounded">
                                <p class="text-sm text-yellow-800">
                                    <strong>Next Steps:</strong> Record more incidents to enable detailed performance comparisons.
                                </p>
                            </div>
                        </div>
                    `;
                    feather.replace();
                }
            }
        } catch (error) {
            console.error('❌ Error saving incident report:', error);
            incidentLearner.showNotification(`Failed to save incident report: ${error.message}`, true);
        
            // Show error in feedback container
            const feedbackContainer = document.getElementById('performanceFeedback');
            if (feedbackContainer) {
                feedbackContainer.classList.remove('hidden');
                feedbackContainer.style.display = 'block';
                feedbackContainer.innerHTML = `
                    <div class="bg-red-50 border-l-4 border-red-400 p-6">
                        <div class="flex items-center mb-3">
                            <i data-feather="alert-triangle" class="w-6 h-6 text-red-400 mr-2"></i>
                            <h3 class="text-lg font-semibold text-red-800">Save Failed</h3>
                        </div>
                        <p class="text-red-700">Unable to save incident report. Please check your connection and try again.</p>
                        <p class="text-sm text-red-600 mt-2">Error: ${error.message}</p>
                    </div>
                `;
                feather.replace();
            }
        } finally {
            if (submitButton) {
                submitButton.innerHTML = '<i data-feather="save" class="w-4 h-4 mr-2"></i>Save Incident Report';
                submitButton.disabled = false;
                if (typeof feather !== 'undefined') {
                    feather.replace();
                }
            }
        }
        
        // CRITICAL: Prevent any form reload
        return false;
    });
    }
    // Fetch weather data
    fetchWeather();
    // Initialize time
    setInterval(updateTime, 1000);
    updateTime();

    // NEW: Restore location tracking status UI on load without auto-starting
    if (localStorage.getItem('locationActive') === 'true') {
        updateLocationStatus(true);
    } else {
        updateLocationStatus(false);
    }

    // Initialize profile dropdown functionality
    const profileBtn = document.getElementById('profileDropdownBtn');
    const profileMenu = document.getElementById('profileDropdownMenu');
    
    if (profileBtn && profileMenu) {
        // Toggle dropdown on click
        profileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            profileMenu.classList.toggle('hidden');
            
            // Apply role/username to dropdown
            let user = null;
            try {
                const userData = localStorage.getItem('bfp_admin_user');
                user = userData ? JSON.parse(userData) : null;
            } catch (err) {
                user = { username: localStorage.getItem('bfp_admin_user'), role: 'admin' };
            }
            
            if (user) {
                const displayUsername = user.username.split('@')[0];
                const headerUsername = document.getElementById('headerUsername');
                if (headerUsername) headerUsername.textContent = displayUsername;
                
                const dropdownFullUsername = document.getElementById('dropdownFullUsername');
                if (dropdownFullUsername) dropdownFullUsername.textContent = user.username;
                
                const userRoleBadge = document.getElementById('userRoleBadge');
                if (userRoleBadge) {
                    userRoleBadge.textContent = user.role === 'admin' ? 'Admin' : 'Personnel';
                    userRoleBadge.className = user.role === 'admin' 
                        ? 'inline-block mt-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-black uppercase rounded-full'
                        : 'inline-block mt-1 px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-black uppercase rounded-full';
                }
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!profileMenu.contains(e.target) && !profileBtn.contains(e.target)) {
                profileMenu.classList.add('hidden');
            }
        });
    }

    // Initialize feather icons and AOS
    feather.replace();
    AOS.init();
    
    // Show last known location on map if available (without triggering browser location request)
    const lastLat = localStorage.getItem('lastLat');
    const lastLng = localStorage.getItem('lastLng');
    if (lastLat && lastLng && map) {
        const lastPos = { lat: parseFloat(lastLat), lng: parseFloat(lastLng) };
        map.setCenter(lastPos);
        map.setZoom(15);
        
        // Mock currentPosition if we have last known coordinates
        if (!currentPosition) {
            currentPosition = {
                coords: {
                    latitude: lastPos.lat,
                    longitude: lastPos.lng,
                    accuracy: 100
                },
                timestamp: Date.now()
            };
        }

        if (currentLocationMarker) {
            currentLocationMarker.setPosition(lastPos);
        } else {
            const markerIcon = createPinIcon('#22c55e');
            currentLocationMarker = new google.maps.Marker({
                position: lastPos,
                map: map,
                title: 'Your Last Known Location',
                icon: markerIcon,
                animation: google.maps.Animation.DROP
            });
            
            const infoWindow = new google.maps.InfoWindow({
                content: '<div style="color: black;"><b>Your Last Known Location</b></div>'
            });
            currentLocationMarker.addListener('click', () => {
                infoWindow.open(map, currentLocationMarker);
            });
            infoWindow.open(map, currentLocationMarker);
        }
    }
    
    // Removed automatic locate user on load to wait for user interaction
    
    // Restore saved section on page load or from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const sectionParam = urlParams.get('section');
    
    // NEW: If just logged in (referrer was login), always go to dashboard
    const isJustLoggedIn = document.referrer.includes('login.html') || !localStorage.getItem('currentSection');
    const savedSection = isJustLoggedIn ? 'dashboard' : (sectionParam || localStorage.getItem('currentSection') || 'dashboard');
    
    if (savedSection) {
        switchSection(savedSection);
        // Special case for history since it's newly integrated
        if (savedSection === 'history') {
            setTimeout(loadHistory, 500);
        }
    }
    // Add time validation
    const timeArrivalInput = document.getElementById('time_arrival');
    if (timeArrivalInput) {
        timeArrivalInput.addEventListener('change', validateTimes);
    }
    // Initialize with current section from localStorage or default to dashboard
    const initialSection = localStorage.getItem('currentSection') || 'dashboard';
    switchSection(initialSection);

    // Load analysis data to update badges silently
    loadAnalysis();
    
    console.log('Application initialized successfully');
});

// Full Report Modal Functions
window.showFullReport = function() {
    if (!window.currentReport) return;
    const modal = document.getElementById('reportModal');
    const content = document.getElementById('modalContent');
    if (!modal || !content) return;
    
    const fieldLabels = {
        'station': 'BFP Station',
        'date': 'Date of Response',
        'location': 'Incident Location',
        'responding_unit': 'Responding Unit',
        'time_received': 'Time Received',
        'time_dispatched': 'Time Dispatched',
        'time_arrival': 'Time Arrival',
        'response_time': 'Response Time (min)',
        'distance': 'Distance (km)',
        'alarm_status': 'Alarm Status',
        'type': 'Type of Occupancy',
        'weather': 'Weather Condition',
        'temperature': 'Temperature (°C)',
        'humidity': 'Humidity (%)',
        'wind_speed': 'Wind Speed (km/h)',
        'road_condition': 'Road Condition',
        'injured_civ': 'Injured (Civilian)',
        'injured_bfp': 'Injured (BFP)',
        'death_civ': 'Deaths (Civilian)',
        'death_bfp': 'Deaths (BFP)',
        'remarks': 'Remarks'
    };

    const numericFields = ['response_time', 'distance', 'temperature', 'humidity', 'wind_speed', 'injured_civ', 'injured_bfp', 'death_civ', 'death_bfp'];

    let html = '';
    for (const [key, label] of Object.entries(fieldLabels)) {
        if (window.currentReport[key] !== undefined) {
            let displayValue = window.currentReport[key];
            if (displayValue === undefined || displayValue === null || displayValue === 'N/A') {
                displayValue = numericFields.includes(key) ? '0' : '-';
            }
            
            html += `
                <div class="border-b pb-2">
                    <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">${label}</p>
                    <p class="text-gray-800 font-medium">${displayValue}</p>
                </div>
            `;
        }
    }
    
    content.innerHTML = html;
    modal.classList.remove('hidden');
    if (typeof feather !== 'undefined') feather.replace();
};

window.closeFullReport = function() {
    const modal = document.getElementById('reportModal');
    if (modal) modal.classList.add('hidden');
};

window.editReport = function() {
    if (!window.currentReport) return;
    
    const modal = document.getElementById('reportModal');
    const content = document.getElementById('modalContent');
    if (!modal || !content) return;
    
    const fieldLabels = {
        'station': 'BFP Station',
        'date': 'Date of Response',
        'location': 'Incident Location',
        'responding_unit': 'Responding Unit',
        'time_received': 'Time Received',
        'time_dispatched': 'Time Dispatched',
        'time_arrival': 'Time Arrival',
        'response_time': 'Response Time (min)',
        'distance': 'Distance (km)',
        'alarm_status': 'Alarm Status',
        'type': 'Type of Occupancy',
        'weather': 'Weather Condition',
        'temperature': 'Temperature (°C)',
        'humidity': 'Humidity (%)',
        'wind_speed': 'Wind Speed (km/h)',
        'road_condition': 'Road Condition',
        'injured_civ': 'Injured (Civilian)',
        'injured_bfp': 'Injured (BFP)',
        'death_civ': 'Deaths (Civilian)',
        'death_bfp': 'Deaths (BFP)',
        'remarks': 'Remarks'
    };

    const editableFields = ['responding_unit', 'alarm_status', 'distance', 'weather', 'temperature', 'humidity', 'wind_speed', 'road_condition', 'remarks'];
    
    let html = '';
    for (const [key, label] of Object.entries(fieldLabels)) {
        if (window.currentReport[key] !== undefined && editableFields.includes(key)) {
            let displayValue = window.currentReport[key];
            if (displayValue === undefined || displayValue === null || displayValue === '-') {
                displayValue = '';
            }
            
            html += `
                <div class="border-b pb-3 mb-3">
                    <label class="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-1 block">${label}</label>
                    <input type="text" id="edit-${key}" value="${displayValue}" 
                           class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
            `;
        }
    }
    
    // Add update and cancel buttons
    html += `
        <div class="col-span-1 md:col-span-2 flex gap-3 mt-6">
            <button onclick="saveReportEdits()" class="flex-1 px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold flex items-center justify-center">
                <i data-feather="save" class="w-4 h-4 mr-2"></i> Save Changes
            </button>
            <button onclick="cancelEditReport()" class="flex-1 px-6 py-2 bg-gray-400 hover:bg-gray-500 text-white rounded-lg font-semibold">
                Cancel
            </button>
        </div>
    `;
    
    content.innerHTML = html;
    if (typeof feather !== 'undefined') feather.replace();
};

window.saveReportEdits = function() {
    const editableFields = ['responding_unit', 'alarm_status', 'distance', 'weather', 'temperature', 'humidity', 'wind_speed', 'road_condition', 'remarks'];
    
    // Update window.currentReport with edited values
    editableFields.forEach(key => {
        const editElement = document.getElementById(`edit-${key}`);
        if (editElement) {
            window.currentReport[key] = editElement.value || '-';
        }
    });
    
    // Close the modal and show updated report
    window.closeFullReport();
    
    // Show success message
    alert('Report updated successfully! The print will reflect these changes.');
    
    if (typeof feather !== 'undefined') feather.replace();
};

window.cancelEditReport = function() {
    window.showFullReport(); // Reload the report in view mode
};

// =============================================
// HISTORY SYSTEM
// =============================================
let historyIncidents = [];
let historyCurrentPage = 1;
const historyItemsPerPage = 20;
let historySearchTerm = '';
let historyBarangay = '';

// Load history from backend
async function loadHistory() {
    try {
        console.log('🔄 Loading history from backend...');
        const response = await fetch(`${getBackendUrl()}/incidents`);
        if (!response.ok) throw new Error('Failed to load incidents');
        
        const data = await response.json();
        historyIncidents = data.incidents || [];
        // Sort newest first
        historyIncidents.sort((a, b) => (b.id || 0) - (a.id || 0));
        
        // Initialize filters if elements exist
        const searchInput = document.getElementById('searchIncident');
        const barangaySelect = document.getElementById('barangayFilter');
        
        if (searchInput && !searchInput.dataset.listenerAdded) {
            searchInput.addEventListener('input', (e) => {
                historySearchTerm = e.target.value.toLowerCase();
                historyCurrentPage = 1;
                displayHistory();
            });
            searchInput.dataset.listenerAdded = 'true';
        }
        
        if (barangaySelect && !barangaySelect.dataset.listenerAdded) {
            barangaySelect.addEventListener('change', (e) => {
                historyBarangay = e.target.value;
                historyCurrentPage = 1;
                displayHistory();
            });
            barangaySelect.dataset.listenerAdded = 'true';
        }
        
        displayHistory();
    } catch (error) {
        console.error('Error loading history:', error);
        const tbody = document.getElementById('incidentsTableBody');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="px-4 py-8 text-center text-red-500">
                        <i data-feather="alert-circle" class="w-8 h-8 inline-block"></i>
                        <p class="mt-2">Failed to load history. Make sure backend is running.</p>
                    </td>
                </tr>
            `;
            feather.replace();
        }
    }
}

function displayHistory() {
    const tbody = document.getElementById('incidentsTableBody');
    if (!tbody) return;
    
    const filtered = getFilteredHistory();
    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / historyItemsPerPage));

    if (historyCurrentPage > totalPages) historyCurrentPage = totalPages;
    if (historyCurrentPage < 1) historyCurrentPage = 1;

    const start = (historyCurrentPage - 1) * historyItemsPerPage;
    const end = start + historyItemsPerPage;
    const paginated = filtered.slice(start, end);

    if (paginated.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="px-4 py-8 text-center text-gray-500">
                    No incidents found
                </td>
            </tr>
        `;
        updateHistoryPagination(totalItems);
        return;
    }

    tbody.innerHTML = paginated.map(incident => {
        let dateStr = 'N/A';
        const dateValue = incident.date || incident.date_of_incident || incident.time_received;
        
        if (dateValue) {
            if (typeof dateValue === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateValue)) {
                dateStr = dateValue;
            } else {
                try {
                    const date = new Date(dateValue);
                    if (!isNaN(date.getTime())) {
                        dateStr = date.toLocaleDateString();
                    }
                } catch (e) {
                    dateStr = dateValue;
                }
            }
        }
        
        return `
            <tr class="border-t hover:bg-gray-50 transition-colors">
                <td class="px-4 py-3 text-sm font-medium text-gray-900">${incident.id || 'N/A'}</td>
                <td class="px-4 py-3 text-sm text-gray-600">${dateStr}</td>
                <td class="px-4 py-3 text-sm text-gray-600">${incident.location || 'N/A'}</td>
                <td class="px-4 py-3 text-sm">
                    <span class="px-2 py-1 bg-orange-100 text-orange-800 rounded-full text-xs font-semibold">
                        ${incident.type || incident.fire_type || 'N/A'}
                    </span>
                </td>
                <td class="px-4 py-3 text-sm text-gray-600">${incident.response_time || incident.response_time_min || 0} min</td>
                <td class="px-4 py-3 text-sm flex space-x-2">
                    <a href="feedback-detail.html?id=${incident.id}" 
                       class="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs flex items-center transition-colors">
                        <i data-feather="eye" class="w-3.5 h-3.5 mr-1"></i>
                        View Feedback
                    </a>
                    <button onclick="deleteHistoryIncident(${incident.id})" 
                            class="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs flex items-center transition-colors">
                        <i data-feather="trash-2" class="w-3.5 h-3.5 mr-1"></i>
                        Delete
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    feather.replace();
    updateHistoryPagination(totalItems);
}

function getFilteredHistory() {
    return historyIncidents.filter(incident => {
        const matchesBarangay = !historyBarangay || (incident.barangay || incident.location || '').toString().toLowerCase().includes(historyBarangay.toLowerCase());
        const matchesSearch = !historySearchTerm || JSON.stringify(incident).toLowerCase().includes(historySearchTerm);
        return matchesBarangay && matchesSearch;
    });
}

function updateHistoryPagination(totalItems) {
    const pagination = document.getElementById('pagination');
    if (!pagination) return;
    
    const totalPages = Math.ceil(totalItems / historyItemsPerPage);
    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }

    let html = '';
    html += `
        <button onclick="goToHistoryPage(${historyCurrentPage - 1})" 
                ${historyCurrentPage === 1 ? 'disabled' : ''}
                class="px-4 py-2 rounded-lg ${historyCurrentPage === 1 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gray-200 hover:bg-gray-300'} transition-colors">
            Previous
        </button>
    `;
    
    let startPage = Math.max(1, historyCurrentPage - 2);
    let endPage = Math.min(totalPages, historyCurrentPage + 2);
    
    if (startPage > 1) {
        html += `<button onclick="goToHistoryPage(1)" class="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 transition-colors">1</button>`;
        if (startPage > 2) html += `<span class="px-2 py-2">...</span>`;
    }
    
    for (let i = startPage; i <= endPage; i++) {
        html += `
            <button onclick="goToHistoryPage(${i})" 
                    class="px-4 py-2 rounded-lg ${i === historyCurrentPage ? 'bg-red-600 text-white font-bold' : 'bg-gray-200 hover:bg-gray-300'} transition-colors">
                ${i}
            </button>
        `;
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += `<span class="px-2 py-2">...</span>`;
        html += `<button onclick="goToHistoryPage(${totalPages})" class="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 transition-colors">${totalPages}</button>`;
    }
    
    html += `
        <button onclick="goToHistoryPage(${historyCurrentPage + 1})" 
                ${historyCurrentPage === totalPages ? 'disabled' : ''}
                class="px-4 py-2 rounded-lg ${historyCurrentPage === totalPages ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gray-200 hover:bg-gray-300'} transition-colors">
            Next
        </button>
    `;
    
    pagination.innerHTML = html;
}

function goToHistoryPage(page) {
    const totalItems = getFilteredHistory().length;
    const totalPages = Math.ceil(totalItems / historyItemsPerPage);
    if (page < 1 || page > totalPages) return;
    historyCurrentPage = page;
    displayHistory();
}

async function deleteHistoryIncident(id) {
    if (!confirm(`Are you sure you want to delete incident #${id}? It can be restored from the Trash section.`)) return;

    try {
        const response = await fetch(`${getBackendUrl()}/incidents/${id}`, { method: 'DELETE' });
        if (response.ok) {
            historyIncidents = historyIncidents.filter(inc => inc.id !== id);
            displayHistory();
            showTemporaryNotification(`Incident #${id} moved to Trash. You can restore it from the Trash section.`, false);
            // Refresh trash if trashManager is available
            if (typeof trashManager !== 'undefined') {
                trashManager.loadTrash();
            }
        } else {
            const error = await response.json();
            alert(`Failed to delete incident: ${error.error || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Error deleting incident:', error);
        alert('Failed to delete incident. Please check if the backend is running.');
    }
}

// Logout function
function logout() {
    localStorage.removeItem('bfp_admin_logged_in');
    localStorage.removeItem('bfp_admin_user');
    window.location.href = '/login';
}

// =============================================
// ANALYSIS SYSTEM
// =============================================
const SANTA_CRUZ_BARANGAYS = [
    "Alipit", "Bagumbayan", "Bubukal", "Calios", "Duhat", "Gatid", "Jasaan",
    "Labuin", "Malinao", "Oogong", "Pagsawitan", "Palasan", "Patimbao",
    "Poblacion I", "Poblacion II", "Poblacion III", "Poblacion IV", "Poblacion V",
    "San Jose", "San Juan", "San Pablo Norte", "San Pablo Sur",
    "Santo Angel Central", "Santo Angel Norte", "Santo Angel Sur", "Santisima Cruz"
];

let barangayPieChart = null;
let barangayBarChart = null;
let barangayInjuriesChart = null;
let barangayDeathsChart = null;
let occupancyAnalysisChart = null;
let allAnalysisIncidents = [];
let filteredAnalysisIncidents = [];

async function loadAnalysis() {
    try {
        console.log('📊 Loading analysis data...');
        const response = await fetch(`${getBackendUrl()}/incidents`);
        if (!response.ok) throw new Error('Failed to load incidents');
        
        const data = await response.json();
        allAnalysisIncidents = data.incidents || [];
        
        // Initialize filters
        populateAnalysisFilters();
        
        // Initial process with "all"
        processAnalysisData();
        
    } catch (error) {
        console.error('Error loading analysis:', error);
        const grid = document.getElementById('barangayCardsGrid');
        if (grid) {
            grid.innerHTML = `
                <div class="col-span-full py-12 text-center text-red-500">
                    <i data-feather="alert-circle" class="w-8 h-8 inline-block mb-2"></i>
                    <p>Failed to process analysis data. Please ensure the server is running.</p>
                </div>
            `;
            feather.replace();
        }
    }
}

function populateAnalysisFilters() {
    const fromYear = document.getElementById('analysisYearFrom');
    const toYear = document.getElementById('analysisYearTo');
    const monthFilter = document.getElementById('analysisMonthFilter');
    const toYearContainer = document.getElementById('yearToContainer');

    if (!fromYear || !toYear || !monthFilter || fromYear.dataset.listenerAdded) return;
    
    // Extract unique years
    const years = new Set();
    allAnalysisIncidents.forEach(inc => {
        const dateStr = inc.date || inc.date_of_incident || inc.time_received;
        if (dateStr) {
            const year = new Date(dateStr).getFullYear();
            if (!isNaN(year)) years.add(year);
        }
    });
    
    // Sort years descending
    const sortedYears = Array.from(years).sort((a, b) => b - a);
    
    // Populate "From" dropdown
    fromYear.innerHTML = '<option value="all">All Years</option>' + 
        sortedYears.map(y => `<option value="${y}">${y}</option>`).join('');
    
    // Function to populate "To" based on "From"
    const updateToYearOptions = () => {
        const selectedFrom = fromYear.value;
        if (selectedFrom === 'all') {
            toYearContainer.classList.add('hidden');
        } else {
            toYearContainer.classList.remove('hidden');
            const fromNum = parseInt(selectedFrom);
            const toOptions = sortedYears
                .filter(y => y >= fromNum)
                .sort((a, b) => b - a); // Still descending for "To"
            
            toYear.innerHTML = toOptions.map(y => `<option value="${y}">${y}</option>`).join('');
        }
        processAnalysisData();
    };

    fromYear.addEventListener('change', updateToYearOptions);
    toYear.addEventListener('change', processAnalysisData);
    monthFilter.addEventListener('change', processAnalysisData);
    
    fromYear.dataset.listenerAdded = 'true';
}

function processAnalysisData() {
    const fromYear = document.getElementById('analysisYearFrom').value;
    const toYear = document.getElementById('analysisYearTo').value;
    const selectedMonth = document.getElementById('analysisMonthFilter').value;

    // Process data
    const incidentCounts = {};
    const injuryCounts = {};
    const deathCounts = {};
    const occupancyCounts = {};
    
    SANTA_CRUZ_BARANGAYS.forEach(b => {
        incidentCounts[b] = 0;
        injuryCounts[b] = 0;
        deathCounts[b] = 0;
    });
    
    incidentCounts["Others"] = 0;
    injuryCounts["Others"] = 0;
    deathCounts["Others"] = 0;
    
    filteredAnalysisIncidents = allAnalysisIncidents.filter(inc => {
        const dateStr = inc.date || inc.date_of_incident || inc.time_received;
        if (!dateStr) return false;
        
        const date = new Date(dateStr);
        const year = date.getFullYear();
        const month = date.getMonth();

        // Year Filtering
        let yearMatch = true;
        if (fromYear !== 'all') {
            const from = parseInt(fromYear);
            const to = parseInt(toYear);
            yearMatch = year >= from && year <= to;
        }

        // Month Filtering
        let monthMatch = true;
        if (selectedMonth !== 'all') {
            monthMatch = month === parseInt(selectedMonth);
        }

        return yearMatch && monthMatch;
    });
    
    filteredAnalysisIncidents.forEach(inc => {
        const loc = (inc.location || inc.barangay || '').toString();
        const occ = (inc.type || inc.fire_type || 'Others').toString();
        
        // Count occupancy types
        occupancyCounts[occ] = (occupancyCounts[occ] || 0) + 1;

        let found = false;
        
        // Parse casualties
        const report = inc.report_details || {};
        const injuries = parseInt(report.injured_civ || 0) + parseInt(report.injured_bfp || 0) || parseInt(inc.injured_civ || 0) + parseInt(inc.injured_bfp || 0) || 0;
        const deaths = parseInt(report.death_civ || 0) + parseInt(report.death_bfp || 0) || parseInt(inc.death_civ || 0) + parseInt(inc.death_bfp || 0) || 0;

        for (const b of SANTA_CRUZ_BARANGAYS) {
            if (loc.toLowerCase().includes(b.toLowerCase())) {
                incidentCounts[b]++;
                injuryCounts[b] += injuries;
                deathCounts[b] += deaths;
                found = true;
                break;
            }
        }
        
        if (!found) {
            incidentCounts["Others"]++;
            injuryCounts["Others"] += injuries;
            deathCounts["Others"] += deaths;
        }
    });
    
    renderAnalysisCards(incidentCounts, injuryCounts, deathCounts, occupancyCounts);
    renderAnalysisCharts(incidentCounts, injuryCounts, deathCounts, occupancyCounts);
}

function renderAnalysisCards(incidentCounts, injuryCounts, deathCounts, occupancyCounts) {
    const incidentGrid = document.getElementById('barangayCardsGrid');
    const casualtyGrid = document.getElementById('casualtyCardsGrid');
    const occupancyGrid = document.getElementById('occupancyCardsGrid');
    if (!incidentGrid || !casualtyGrid || !occupancyGrid) return;
    
    // Sort barangays by incident count (descending)
    const sortedIncidents = Object.entries(incidentCounts).sort((a, b) => b[1] - a[1]);
    
    // 1. Render Incident Cards
    incidentGrid.innerHTML = sortedIncidents.map(([name, count]) => {
        const isOthers = name === "Others";
        return `
            <div onclick="showBarangayDetails('${name}')" 
                 class="bg-white p-4 rounded-xl border-2 ${isOthers ? 'border-gray-200' : 'border-red-50'} hover:border-red-500 hover:shadow-md transition-all cursor-pointer group text-left">
                <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 group-hover:text-red-500">${isOthers ? 'Outside SC' : 'Barangay'}</p>
                <h4 class="text-sm font-extrabold text-gray-700 mb-2 truncate" title="${name}">${name}</h4>
                <div class="flex items-end justify-between">
                    <span class="text-2xl font-black ${count > 0 ? 'text-red-600' : 'text-gray-300'}">${count}</span>
                    <i data-feather="${isOthers ? 'map' : 'home'}" class="w-4 h-4 ${count > 0 ? 'text-red-200' : 'text-gray-100'} group-hover:text-red-500"></i>
                </div>
            </div>
        `;
    }).join('');
    
    // 2. Render Occupancy Cards
    const sortedOccupancy = Object.entries(occupancyCounts).sort((a, b) => b[1] - a[1]);
    
    occupancyGrid.innerHTML = sortedOccupancy.map(([type, count]) => {
        return `
            <div onclick="showOccupancyDetails('${type}')" 
                 class="bg-white p-4 rounded-xl border-2 border-blue-50 hover:border-blue-500 hover:shadow-md transition-all cursor-pointer group text-left">
                <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 group-hover:text-blue-500">Occupancy Type</p>
                <h4 class="text-sm font-extrabold text-gray-700 mb-2 truncate" title="${type}">${type}</h4>
                <div class="flex items-end justify-between">
                    <span class="text-2xl font-black ${count > 0 ? 'text-blue-600' : 'text-gray-300'}">${count}</span>
                    <i data-feather="briefcase" class="w-4 h-4 ${count > 0 ? 'text-blue-200' : 'text-gray-100'} group-hover:text-blue-500"></i>
                </div>
            </div>
        `;
    }).join('');

    // 3. Render Casualty Cards (only if they have casualties)
    const casualtyData = Object.keys(incidentCounts).map(name => ({
        name,
        injuries: injuryCounts[name],
        deaths: deathCounts[name]
    })).filter(item => item.injuries > 0 || item.deaths > 0)
    .sort((a, b) => (b.injuries + b.deaths) - (a.injuries + a.deaths));

    if (casualtyData.length === 0) {
        casualtyGrid.innerHTML = `
            <div class="col-span-full py-8 text-center text-gray-400">
                <p>No casualties recorded for this period.</p>
            </div>
        `;
    } else {
        casualtyGrid.innerHTML = casualtyData.map(item => {
            const isOthers = item.name === "Others";
            return `
                <div onclick="showBarangayDetails('${item.name}')" 
                     class="bg-white p-4 rounded-xl border-2 border-orange-50 hover:border-orange-500 hover:shadow-md transition-all cursor-pointer group text-left">
                    <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 group-hover:text-orange-500">${isOthers ? 'Outside SC' : 'Barangay'}</p>
                    <h4 class="text-sm font-extrabold text-gray-700 mb-3 truncate" title="${item.name}">${item.name}</h4>
                    <div class="space-y-2">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-bold text-red-500 uppercase">Injured</span>
                            <span class="text-lg font-black text-red-600">${item.injuries}</span>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-bold text-gray-600 uppercase">Deaths</span>
                            <span class="text-lg font-black text-gray-800">${item.deaths}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    feather.replace();
}

function showAnalysisDetails(filterValue, filterType = 'barangay') {
    const modal = document.getElementById('barangayIncidentsModal');
    const tbody = document.getElementById('barangayIncidentsTableBody');
    const title = document.getElementById('modalBarangayName');
    const info = document.getElementById('modalFilterInfo');
    
    if (!modal || !tbody) return;

    if (filterType === 'barangay') {
        title.textContent = filterValue === 'Others' ? 'Other Locations (Outside Santa Cruz)' : `Incidents in ${filterValue}`;
    } else {
        title.textContent = `Occupancy: ${filterValue}`;
    }
    
    // Get active filter info
    const fromYear = document.getElementById('analysisYearFrom').value;
    const toYear = document.getElementById('analysisYearTo').value;
    const monthSelect = document.getElementById('analysisMonthFilter');
    const monthText = monthSelect.options[monthSelect.selectedIndex].text;
    
    let filterDesc = `Month: ${monthText} | Year: `;
    filterDesc += fromYear === 'all' ? 'All' : (fromYear === toYear ? fromYear : `${fromYear}-${toYear}`);
    info.textContent = filterDesc;

    // Filter incidents for this specific criteria
    const incidents = filteredAnalysisIncidents.filter(inc => {
        if (filterType === 'barangay') {
            const loc = (inc.location || inc.barangay || '').toString().toLowerCase();
            if (filterValue === 'Others') {
                return !SANTA_CRUZ_BARANGAYS.some(b => loc.includes(b.toLowerCase()));
            }
            return loc.includes(filterValue.toLowerCase());
        } else {
            const occ = (inc.type || inc.fire_type || 'Others').toString();
            return occ === filterValue;
        }
    });

    if (incidents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500 font-medium">No incidents found for this period.</td></tr>';
    } else {
        tbody.innerHTML = incidents.map(inc => `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="px-4 py-3 text-sm font-bold text-gray-900">#${inc.id || 'N/A'}</td>
                <td class="px-4 py-3 text-sm text-gray-600">${inc.date || inc.date_of_incident || 'N/A'}</td>
                <td class="px-4 py-3 text-sm">
                    <span class="px-2 py-1 bg-red-50 text-red-700 rounded text-[10px] font-bold uppercase tracking-tight">
                        ${inc.type || inc.fire_type || 'N/A'}
                    </span>
                </td>
                <td class="px-4 py-3 text-sm text-gray-600 truncate max-w-[200px]" title="${inc.location}">${inc.location || 'N/A'}</td>
                <td class="px-4 py-3 text-sm">
                    <a href="feedback-detail.html?id=${inc.id}" class="text-blue-600 hover:text-blue-800 font-bold flex items-center">
                        View <i data-feather="external-link" class="w-3 h-3 ml-1"></i>
                    </a>
                </td>
            </tr>
        `).join('');
    }

    modal.classList.remove('hidden');
    feather.replace();
}

function showBarangayDetails(name) { showAnalysisDetails(name, 'barangay'); }
function showOccupancyDetails(type) { showAnalysisDetails(type, 'occupancy'); }

function closeBarangayModal() {
    document.getElementById('barangayIncidentsModal').classList.add('hidden');
}

function printAnalysis() {
    const printableArea = document.getElementById('printableAnalysis');
    const cardsGrid = document.getElementById('barangayCardsGrid');
    
    if (!printableArea || !cardsGrid) return;

    // 1. Set Date and Filters
    document.getElementById('print-analysis-date').textContent = new Date().toLocaleDateString();
    
    const fromYear = document.getElementById('analysisYearFrom').value;
    const toYear = document.getElementById('analysisYearTo').value;
    const monthSelect = document.getElementById('analysisMonthFilter');
    const monthText = monthSelect.options[monthSelect.selectedIndex].text;
    
    let filterDesc = `Month: ${monthText} | Year: `;
    filterDesc += fromYear === 'all' ? 'All Data' : (fromYear === toYear ? fromYear : `${fromYear}-${toYear}`);
    document.getElementById('print-analysis-filters').textContent = filterDesc;

    // 2. Populate Barangay Statistics Table
    const printTableBody = document.getElementById('print-analysis-table-body');
    const activeCards = Array.from(cardsGrid.querySelectorAll('.bg-white.p-4.rounded-xl'));
    
    // Sort cards so most important data is first
    activeCards.sort((a, b) => {
        const countA = parseInt(a.querySelector('span').textContent);
        const countB = parseInt(b.querySelector('span').textContent);
        return countB - countA;
    });

    let tableHtml = '';
    for (let i = 0; i < activeCards.length; i += 2) {
        const card1 = activeCards[i];
        const card2 = activeCards[i + 1];

        const title1 = card1.querySelector('h4').textContent;
        const count1 = card1.querySelector('span').textContent;
        
        let rowHtml = `
            <tr class="border-b border-gray-300">
                <td class="px-3 py-1.5 text-gray-800 border-r border-gray-200">${title1}</td>
                <td class="px-3 py-1.5 text-center font-black text-black border-r-2 border-gray-200">${count1}</td>
        `;

        if (card2) {
            const title2 = card2.querySelector('h4').textContent;
            const count2 = card2.querySelector('span').textContent;
            rowHtml += `
                <td class="px-3 py-1.5 text-gray-800 border-r border-gray-200">${title2}</td>
                <td class="px-3 py-1.5 text-center font-black text-black">${count2}</td>
            `;
        } else {
            rowHtml += `<td class="px-3 py-1.5 border-r border-gray-200"></td><td class="px-3 py-1.5"></td>`;
        }

        rowHtml += `</tr>`;
        tableHtml += rowHtml;
    }
    printTableBody.innerHTML = tableHtml;

    // 3. Calculate and Populate Casualty Statistics
    let totalInjuries = 0;
    let totalDeaths = 0;
    
    filteredAnalysisIncidents.forEach(inc => {
        const report = inc.report_details || {};
        const injuries = parseInt(report.injured_civ || 0) + parseInt(report.injured_bfp || 0) || parseInt(inc.injured_civ || 0) + parseInt(inc.injured_bfp || 0) || 0;
        const deaths = parseInt(report.death_civ || 0) + parseInt(report.death_bfp || 0) || parseInt(inc.death_civ || 0) + parseInt(inc.death_bfp || 0) || 0;
        totalInjuries += injuries;
        totalDeaths += deaths;
    });

    const casualtyTableBody = document.getElementById('print-casualties-table-body');
    casualtyTableBody.innerHTML = `
        <tr class="border-b border-gray-300">
            <td class="px-3 py-1.5 text-gray-800 border-r border-gray-200">Total Injuries</td>
            <td class="px-3 py-1.5 text-center font-black text-orange-600">${totalInjuries}</td>
        </tr>
        <tr class="border-b border-gray-300">
            <td class="px-3 py-1.5 text-gray-800 border-r border-gray-200">Total Fatalities</td>
            <td class="px-3 py-1.5 text-center font-black text-red-600">${totalDeaths}</td>
        </tr>
        <tr class="bg-gray-50">
            <td class="px-3 py-1.5 text-gray-900 border-r border-gray-200 uppercase font-black">Total Casualties</td>
            <td class="px-3 py-1.5 text-center font-black text-black">${totalInjuries + totalDeaths}</td>
        </tr>
    `;

    // 4. Calculate and Populate Occupancy Distribution
    const occupancyCounts = {};
    filteredAnalysisIncidents.forEach(inc => {
        const occ = (inc.type || inc.fire_type || 'Others').toString();
        occupancyCounts[occ] = (occupancyCounts[occ] || 0) + 1;
    });

    const sortedOccupancy = Object.entries(occupancyCounts).sort((a, b) => b[1] - a[1]);
    const occupancyTableBody = document.getElementById('print-occupancy-table-body');
    occupancyTableBody.innerHTML = sortedOccupancy.map(([type, count]) => `
        <tr class="border-b border-gray-300">
            <td class="px-3 py-1.5 text-gray-800 border-r border-gray-200">${type}</td>
            <td class="px-3 py-1.5 text-center font-black text-black">${count}</td>
        </tr>
    `).join('');

    // 5. Update Official Assessment Section
    document.getElementById('print-total-incidents').textContent = filteredAnalysisIncidents.length + " Total Incidents Recorded";
    document.getElementById('print-total-casualties').textContent = (totalInjuries + totalDeaths) + " Total Casualties (Injuries + Fatalities)";
    document.getElementById('print-total-occupancy').textContent = filteredAnalysisIncidents.length + " Total Records Categorized";

    // 6. Print
    printableArea.classList.remove('hidden');
    window.print();
    printableArea.classList.add('hidden');
}

function renderAnalysisCharts(incidentCounts, injuryCounts, deathCounts, occupancyCounts) {
    const pieCtx = document.getElementById('barangayPieChart');
    const barCtx = document.getElementById('barangayBarChart');
    const injuryCtx = document.getElementById('barangayInjuriesChart');
    const deathCtx = document.getElementById('barangayDeathsChart');
    const occupancyCtx = document.getElementById('occupancyAnalysisChart');
    
    if (!pieCtx || !barCtx || !injuryCtx || !deathCtx || !occupancyCtx) return;
    
    // 1. Incident Distribution (Pie)
    const activeBarangays = Object.keys(incidentCounts).filter(k => incidentCounts[k] > 0);
    const incidentData = activeBarangays.map(k => incidentCounts[k]);
    
    const colors = [
        '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', 
        '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
        '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
        '#ec4899', '#f43f5e'
    ];

    if (barangayPieChart) barangayPieChart.destroy();
    barangayPieChart = new Chart(pieCtx, {
        type: 'doughnut',
        data: {
            labels: activeBarangays,
            datasets: [{
                data: incidentData,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { boxWidth: 12, font: { size: 10, weight: 'bold' }, padding: 10 }
                }
            },
            cutout: '60%'
        }
    });

    // 2. Incident Frequency (Bar)
    const top10Incidents = Object.entries(incidentCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
        
    if (barangayBarChart) barangayBarChart.destroy();
    barangayBarChart = new Chart(barCtx, {
        type: 'bar',
        data: {
            labels: top10Incidents.map(item => item[0]),
            datasets: [{
                label: 'Incidents',
                data: top10Incidents.map(item => item[1]),
                backgroundColor: '#ef4444',
                borderRadius: 8,
                barThickness: 20
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1, font: { weight: 'bold' } }, grid: { display: false } },
                x: { ticks: { font: { size: 10, weight: 'bold' } }, grid: { display: false } }
            }
        }
    });

    // 3. Injury Distribution (Bar)
    const top10Injuries = Object.entries(injuryCounts)
        .filter(item => item[1] > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    if (barangayInjuriesChart) barangayInjuriesChart.destroy();
    barangayInjuriesChart = new Chart(injuryCtx, {
        type: 'bar',
        data: {
            labels: top10Injuries.map(item => item[0]),
            datasets: [{
                label: 'Injuries',
                data: top10Injuries.map(item => item[1]),
                backgroundColor: '#f97316', // Orange for injuries
                borderRadius: 8,
                barThickness: 20
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1, font: { weight: 'bold' } }, grid: { display: false } },
                x: { ticks: { font: { size: 10, weight: 'bold' } }, grid: { display: false } }
            }
        }
    });

    // 4. Death Distribution (Bar)
    const top10Deaths = Object.entries(deathCounts)
        .filter(item => item[1] > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    if (barangayDeathsChart) barangayDeathsChart.destroy();
    barangayDeathsChart = new Chart(deathCtx, {
        type: 'bar',
        data: {
            labels: top10Deaths.map(item => item[0]),
            datasets: [{
                label: 'Fatalities',
                data: top10Deaths.map(item => item[1]),
                backgroundColor: '#374151', // Dark Gray for deaths
                borderRadius: 8,
                barThickness: 20
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1, font: { weight: 'bold' } }, grid: { display: false } },
                x: { ticks: { font: { size: 10, weight: 'bold' } }, grid: { display: false } }
            }
        }
    });

    // 5. Occupancy Distribution (Bar)
    const sortedOccupancy = Object.entries(occupancyCounts)
        .sort((a, b) => b[1] - a[1]);

    if (occupancyAnalysisChart) occupancyAnalysisChart.destroy();
    occupancyAnalysisChart = new Chart(occupancyCtx, {
        type: 'bar',
        data: {
            labels: sortedOccupancy.map(item => item[0]),
            datasets: [{
                label: 'Incidents',
                data: sortedOccupancy.map(item => item[1]),
                backgroundColor: '#3b82f6', // Blue for occupancy
                borderRadius: 8,
                barThickness: 30
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y', // Horizontal bar chart
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, ticks: { stepSize: 1, font: { weight: 'bold' } }, grid: { display: false } },
                y: { ticks: { font: { size: 11, weight: 'bold' } }, grid: { display: false } }
            }
        }
    });
}