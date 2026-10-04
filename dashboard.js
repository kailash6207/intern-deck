/**
 * Dashboard Logic (dashboard.js)
 * Full application hub with Urgency Kanban, Timeline, Calendar Sync (.ics),
 * Audio Chime Synthesizer, and Gmail in-browser tab scanning.
 */

// State
let opportunities = [];
let currentFilter = '';
let currentView = 'kanban';
let isAudioEnabled = true;

// Sample Demo Data for instant zero-friction testing
const DEMO_OPPORTUNITIES = [
  {
    id: 'demo-1',
    company: 'Google',
    role: 'Software Engineering Intern — Summer 2026',
    deadline: 'October 25, 2026 at 11:59 PM EST',
    cgpa: '8.0+ CGPA',
    batch: '2026 Batch',
    requirements: '8.0+ CGPA | 2026 Batch | B.Tech / M.Tech CSE/IT',
    status: 'pending',
    url: 'https://careers.google.com/students',
    source: 'Gmail Scan'
  },
  {
    id: 'demo-2',
    company: 'Stripe',
    role: 'Backend Engineering Intern',
    deadline: 'October 12, 2026 at 5:00 PM PST',
    cgpa: '7.5+ CGPA',
    requirements: '7.5+ CGPA | 2025/2026 Batch',
    status: 'pending',
    url: 'https://stripe.com/jobs',
    source: 'Gmail Scan'
  },
  {
    id: 'demo-3',
    company: 'OpenAI',
    role: 'Research & AI Engineering Intern',
    deadline: 'November 15, 2026',
    cgpa: '8.5+ CGPA',
    requirements: '8.5+ CGPA | MS/PhD or strong publications',
    status: 'pending',
    url: 'https://openai.com/careers',
    source: 'Manual Add'
  },
  {
    id: 'demo-4',
    company: 'Microsoft',
    role: 'Data Science & Machine Learning Intern',
    deadline: 'October 8, 2026',
    cgpa: '7.0+ CGPA',
    requirements: '7.0+ CGPA | 2026 Batch | No active backlogs',
    status: 'applied',
    url: 'https://careers.microsoft.com',
    source: 'Gmail Scan'
  }
];

// Audio Synthesizer (Pure Web Audio API - zero external files)
function playGentleChime() {
  if (!isAudioEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, now); // C5
    osc1.frequency.exponentialRampToValueAtTime(659.25, now + 0.15); // E5

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(783.99, now + 0.1); // G5
    osc2.frequency.exponentialRampToValueAtTime(1046.50, now + 0.3); // C6

    gainNode.gain.setValueAtTime(0.01, now);
    gainNode.gain.linearRampToValueAtTime(0.18, now + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now + 0.1);
    osc1.stop(now + 0.6);
    osc2.stop(now + 0.6);
  } catch (e) {
    console.log('Audio chime not allowed:', e);
  }
}

// DOM Elements
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const btnScanNow = document.getElementById('btnScanNow');
const btnAddManual = document.getElementById('btnAddManual');
const btnExportIcs = document.getElementById('btnExportIcs');
const btnThemeToggle = document.getElementById('btnThemeToggle');
const btnSettings = document.getElementById('btnSettings');

const statTotal = document.getElementById('statTotal');
const statUrgent = document.getElementById('statUrgent');
const statWeek = document.getElementById('statWeek');
const statApplied = document.getElementById('statApplied');

const kanbanView = document.getElementById('kanbanView');
const timelineView = document.getElementById('timelineView');
const tableView = document.getElementById('tableView');

const cardsUrgent = document.getElementById('cardsUrgent');
const cardsWeek = document.getElementById('cardsWeek');
const cardsFuture = document.getElementById('cardsFuture');
const cardsApplied = document.getElementById('cardsApplied');

const countUrgent = document.getElementById('countUrgent');
const countWeek = document.getElementById('countWeek');
const countFuture = document.getElementById('countFuture');
const countApplied = document.getElementById('countApplied');

const timelineContainer = document.getElementById('timelineContainer');
const tableBody = document.getElementById('tableBody');

// Modals
const addModal = document.getElementById('addModal');
const closeAddModal = document.getElementById('closeAddModal');
const cancelAddBtn = document.getElementById('cancelAddBtn');
const addForm = document.getElementById('addForm');

const settingsModal = document.getElementById('settingsModal');
const closeSettingsModal = document.getElementById('closeSettingsModal');
const btnToggleApiSetup = document.getElementById('btnToggleApiSetup');
const apiSetupBox = document.getElementById('apiSetupBox');
const settingClientId = document.getElementById('settingClientId');
const btnSaveClientId = document.getElementById('btnSaveClientId');
const settingChime = document.getElementById('settingChime');
const settingPushNotif = document.getElementById('settingPushNotif');
const btnExportJson = document.getElementById('btnExportJson');
const btnLoadDemo = document.getElementById('btnLoadDemo');
const btnClearAll = document.getElementById('btnClearAll');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadDashboardData();
  setupEventListeners();
});

async function loadDashboardData() {
  const localData = await chrome.storage.local.get(['recentAlerts', 'theme', 'soundEnabled']);
  const syncData = await chrome.storage.sync.get(['clientId', 'keywords']);

  // Theme
  if (localData.theme === 'light') {
    document.body.classList.remove('theme-dark');
    document.body.classList.add('theme-light');
  }

  isAudioEnabled = localData.soundEnabled !== false;
  if (settingChime) settingChime.checked = isAudioEnabled;

  if (syncData.clientId && settingClientId) {
    settingClientId.value = syncData.clientId;
  }

  // Load opportunities
  if (localData.recentAlerts && localData.recentAlerts.length > 0) {
    opportunities = localData.recentAlerts;
  } else {
    // If first time open, pre-seed with demo data for delightful user onboarding!
    opportunities = [...DEMO_OPPORTUNITIES];
    await chrome.storage.local.set({ recentAlerts: opportunities });
  }

  renderAll();
}

function renderAll() {
  updateMetrics();
  renderKanban();
  renderTimeline();
  renderTable();
}

/**
 * Filter opportunities by search term
 */
function getFilteredOpportunities() {
  if (!currentFilter) return opportunities;
  const q = currentFilter.toLowerCase();
  return opportunities.filter(item => 
    item.company.toLowerCase().includes(q) ||
    item.role.toLowerCase().includes(q) ||
    item.deadline.toLowerCase().includes(q)
  );
}

/**
 * Classifies deadline urgency
 */
function getUrgencyLevel(item) {
  if (item.status === 'applied') return 'applied';

  // Basic estimation: parse date or check keywords
  const text = item.deadline.toLowerCase();
  if (text.includes('today') || text.includes('tomorrow') || text.includes('24h') || text.includes('48h')) {
    return 'urgent';
  }

  // Try parsing date
  const parsed = Date.parse(item.deadline.replace(/at.*$/, ''));
  if (!isNaN(parsed)) {
    const diffHours = (parsed - Date.now()) / (1000 * 60 * 60);
    if (diffHours <= 48 && diffHours > 0) return 'urgent';
    if (diffHours <= 168 && diffHours > 0) return 'week';
    if (diffHours <= 0) return 'urgent'; // past due or closing now
    return 'future';
  }

  // Default heuristic based on month / keyword
  if (text.includes('closing') || text.includes('oct 8') || text.includes('oct 12')) {
    return 'urgent';
  }
  if (text.includes('oct 25') || text.includes('friday') || text.includes('this week')) {
    return 'week';
  }

  return 'future';
}

/**
 * Metrics Calculation
 */
function updateMetrics() {
  const filtered = getFilteredOpportunities();
  statTotal.textContent = filtered.length;

  let urgent = 0;
  let week = 0;
  let applied = 0;

  filtered.forEach(item => {
    const urgency = getUrgencyLevel(item);
    if (urgency === 'urgent') urgent++;
    else if (urgency === 'week') week++;
    else if (urgency === 'applied') applied++;
  });

  statUrgent.textContent = urgent;
  statWeek.textContent = week;
  statApplied.textContent = applied;
}

/**
 * Render Kanban View
 */
function renderKanban() {
  cardsUrgent.innerHTML = '';
  cardsWeek.innerHTML = '';
  cardsFuture.innerHTML = '';
  cardsApplied.innerHTML = '';

  const groups = {
    urgent: [],
    week: [],
    future: [],
    applied: []
  };

  const filtered = getFilteredOpportunities();
  filtered.forEach(item => {
    const u = getUrgencyLevel(item);
    groups[u].push(item);
  });

  countUrgent.textContent = groups.urgent.length;
  countWeek.textContent = groups.week.length;
  countFuture.textContent = groups.future.length;
  countApplied.textContent = groups.applied.length;

  groups.urgent.forEach(item => cardsUrgent.appendChild(createCardElement(item, 'urgent')));
  groups.week.forEach(item => cardsWeek.appendChild(createCardElement(item, 'week')));
  groups.future.forEach(item => cardsFuture.appendChild(createCardElement(item, 'future')));
  groups.applied.forEach(item => cardsApplied.appendChild(createCardElement(item, 'applied')));

  // Empty state placeholders
  ['urgent', 'week', 'future', 'applied'].forEach(key => {
    const container = document.getElementById('cards' + key.charAt(0).toUpperCase() + key.slice(1));
    if (groups[key].length === 0) {
      container.innerHTML = `<div style="text-align: center; padding: 24px 10px; color: var(--text-sub); font-size: 0.8rem; border: 1px dashed var(--glass-border); border-radius: 8px;">No opportunities in this list</div>`;
    }
  });
}

function createCardElement(item, urgency) {
  const card = document.createElement('div');
  card.className = 'opp-card';

  const badgeClass = `deadline-${urgency}`;
  const isApplied = item.status === 'applied';
  const reqText = item.requirements || (item.cgpa ? `${item.cgpa}${item.batch ? ' | ' + item.batch : ''}` : '');
  const reqBadge = reqText ? `
    <div style="font-size: 0.72rem; color: #34d399; font-weight: 600; margin: 4px 0 6px 0; background: rgba(52, 211, 153, 0.12); border: 1px solid rgba(52, 211, 153, 0.25); border-radius: 4px; padding: 2px 7px; display: inline-block;">
      🎓 ${escapeHtml(reqText)}
    </div>` : '';

  card.innerHTML = `
    <div class="card-top">
      <div>
        <div class="card-company">${escapeHtml(item.company)}</div>
        <div class="card-role">${escapeHtml(item.role)}</div>
        ${reqBadge}
      </div>
      <button class="card-delete-icon-btn" title="Delete this opportunity" aria-label="Delete">✕</button>
    </div>
    <div class="card-deadline ${badgeClass}">
      <span>⏳</span>
      <span>${escapeHtml(item.deadline)}</span>
    </div>
    <div class="card-actions">
      <button class="btn-toggle-applied" title="${isApplied ? 'Mark as Not Applied' : 'Mark as Applied'}">
        ${isApplied ? '↩️ Unmark' : '✅ Mark Applied'}
      </button>
      <button class="btn-cal-sync" title="Add to Google Calendar">📅 Cal</button>
      <a href="${item.url || 'https://mail.google.com'}" target="_blank" class="btn-open-email" style="text-decoration: none;">📬 Open</a>
      <button class="btn-delete-text" title="Delete this opportunity" style="color: #f87171 !important;">🗑️</button>
    </div>
  `;

  // Event handlers
  card.querySelector('.card-delete-icon-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteOpportunity(item.id);
  });

  card.querySelector('.btn-delete-text').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteOpportunity(item.id);
  });

  card.querySelector('.btn-toggle-applied').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAppliedStatus(item.id);
  });

  card.querySelector('.btn-cal-sync').addEventListener('click', (e) => {
    e.stopPropagation();
    addToGoogleCalendar(item);
  });

  return card;
}

/**
 * Render Timeline View
 */
function renderTimeline() {
  const filtered = getFilteredOpportunities();
  if (filtered.length === 0) {
    timelineContainer.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-sub);">No opportunities to display.</div>`;
    return;
  }

  timelineContainer.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 16px; padding: 20px;">
      ${filtered.map(item => `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background: rgba(0,0,0,0.2); border-radius: 10px; border-left: 4px solid var(--primary);">
          <div>
            <strong style="font-size: 1rem;">${escapeHtml(item.company)}</strong>
            <div style="font-size: 0.82rem; color: var(--text-sub);">${escapeHtml(item.role)}</div>
            ${item.requirements || item.cgpa ? `<div style="font-size: 0.75rem; color: #34d399; margin-top: 3px; font-weight: 600;">🎓 ${escapeHtml(item.requirements || item.cgpa)}</div>` : ''}
          </div>
          <div style="display: flex; align-items: center; gap: 14px;">
            <span style="font-weight: 700; color: #fbbf24; font-size: 0.85rem;">📅 ${escapeHtml(item.deadline)}</span>
            <a href="${item.url || '#'}" target="_blank" class="glass-btn" style="padding: 6px 12px; font-size: 0.75rem;">View</a>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * Render Spreadsheet Table View
 */
function renderTable() {
  const filtered = getFilteredOpportunities();
  tableBody.innerHTML = filtered.map(item => `
    <tr>
      <td><strong>${escapeHtml(item.company)}</strong></td>
      <td>${escapeHtml(item.role)}</td>
      <td><span style="color: #34d399; font-weight: 600; font-size: 0.8rem;">${escapeHtml(item.requirements || item.cgpa || '—')}</span></td>
      <td><span class="badge ${item.status === 'applied' ? 'deadline-applied' : 'deadline-urgent'}">${escapeHtml(item.deadline)}</span></td>
      <td>${item.status === 'applied' ? '✅ Applied' : '⏳ Pending'}</td>
      <td><small style="color: var(--text-sub);">${escapeHtml(item.source || 'Gmail')}</small></td>
      <td>
        <a href="${item.url || '#'}" target="_blank" style="color: var(--primary); text-decoration: none; font-weight: 600; font-size: 0.8rem; margin-right: 8px;">Open</a>
        <button onclick="window.deleteOppGlobal('${item.id}')" style="background: none; border: none; color: #f87171; cursor: pointer; font-size: 0.8rem;">Delete</button>
      </td>
    </tr>
  `).join('');
}

window.deleteOppGlobal = function(id) {
  deleteOpportunity(id);
};

/**
 * Setup Event Listeners
 */
function setupEventListeners() {
  // Search
  searchInput.addEventListener('input', (e) => {
    currentFilter = e.target.value.trim();
    clearSearchBtn.style.display = currentFilter ? 'block' : 'none';
    renderAll();
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    currentFilter = '';
    clearSearchBtn.style.display = 'none';
    renderAll();
  });

  // Keyboard shortcut '/'
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  // View switchers
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.getAttribute('data-view');
      currentView = view;

      kanbanView.style.display = view === 'kanban' ? 'grid' : 'none';
      timelineView.style.display = view === 'timeline' ? 'block' : 'none';
      tableView.style.display = view === 'table' ? 'block' : 'none';
    });
  });

  // Theme toggle
  btnThemeToggle.addEventListener('click', () => {
    const isLight = document.body.classList.contains('theme-light');
    if (isLight) {
      document.body.classList.remove('theme-light');
      document.body.classList.add('theme-dark');
      chrome.storage.local.set({ theme: 'dark' });
    } else {
      document.body.classList.remove('theme-dark');
      document.body.classList.add('theme-light');
      chrome.storage.local.set({ theme: 'light' });
    }
  });

  // Scan Gmail Now (Zero-setup in-browser scanner trigger)
  btnScanNow.addEventListener('click', async () => {
    btnScanNow.disabled = true;
    btnScanNow.innerHTML = `<span class="spin-icon" style="animation: spin 1s linear infinite; display: inline-block;">🔄</span> Scanning...`;

    try {
      const tabs = await chrome.tabs.query({ url: '*://mail.google.com/*' });
      if (tabs.length === 0) {
        if (confirm('ℹ️ No open Gmail tab found.\n\nWould you like to open Gmail now to scan your inbox for internship deadlines?')) {
          chrome.tabs.create({ url: 'https://mail.google.com' });
        }
      } else {
        let totalFound = 0;
        for (const tab of tabs) {
          // Inject scanner script into tab in case tab was loaded prior to extension
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          }).catch(() => {});

          await new Promise(resolve => {
            chrome.tabs.sendMessage(tab.id, { type: 'SCAN_GMAIL_PAGE' }, (response) => {
              if (response && response.items) {
                response.items.forEach(newItem => {
                  if (!opportunities.some(o => o.company.toLowerCase() === newItem.company.toLowerCase() && o.role.toLowerCase() === newItem.role.toLowerCase())) {
                    opportunities.unshift(newItem);
                    totalFound++;
                  }
                });
                saveOpportunities();
              }
              resolve();
            });
            setTimeout(resolve, 1500); // 1.5s timeout safety
          });
        }

        if (totalFound > 0) {
          playGentleChime();
          alert(`🎯 Successfully found ${totalFound} new internship deadline(s)!`);
        } else {
          alert('✓ Scan completed! Checked your Gmail tab. No new unread internship deadlines found right now.\n\nTip: You can add custom keywords in Settings ⚙️ to search for specific roles!');
        }
      }
    } catch (e) {
      console.warn('Tab scan error:', e);
    } finally {
      btnScanNow.disabled = false;
      btnScanNow.innerHTML = `<span>🔄</span> <span>Scan Gmail</span>`;
      renderAll();
    }
  });

  // Export Calendar (.ics)
  btnExportIcs.addEventListener('click', () => {
    downloadIcsCalendar(opportunities);
  });

  // Add Manual Modal
  btnAddManual.addEventListener('click', () => {
    addModal.style.display = 'flex';
    document.getElementById('addCompany').focus();
  });

  closeAddModal.addEventListener('click', () => addModal.style.display = 'none');
  cancelAddBtn.addEventListener('click', () => addModal.style.display = 'none');

  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const reqValue = (document.getElementById('addRequirements') ? document.getElementById('addRequirements').value.trim() : '');
    const cgpaMatch = reqValue.match(/\b(?:\d\.\d{1,2}|10)\s*(?:\/10)?\s*(?:CGPA|GPA)\b/i);
    const newOpp = {
      id: 'manual-' + Date.now(),
      company: document.getElementById('addCompany').value.trim(),
      role: document.getElementById('addRole').value.trim(),
      requirements: reqValue,
      cgpa: cgpaMatch ? cgpaMatch[0] : '',
      deadline: document.getElementById('addDeadline').value.trim(),
      status: document.getElementById('addStatus').value,
      url: document.getElementById('addUrl').value.trim() || 'https://google.com',
      source: 'Manual Add'
    };

    opportunities.unshift(newOpp);
    saveOpportunities();
    playGentleChime();
    addModal.style.display = 'none';
    addForm.reset();
    renderAll();
  });

  // Settings Modal
  btnSettings.addEventListener('click', () => {
    settingsModal.style.display = 'flex';
  });

  closeSettingsModal.addEventListener('click', () => settingsModal.style.display = 'none');

  btnToggleApiSetup.addEventListener('click', () => {
    apiSetupBox.style.display = apiSetupBox.style.display === 'none' ? 'block' : 'none';
  });

  btnSaveClientId.addEventListener('click', async () => {
    const val = settingClientId.value.trim();
    await chrome.storage.sync.set({ clientId: val });
    alert('✅ Client ID saved successfully!');
  });

  // Preset keywords
  document.querySelectorAll('.chip-preset').forEach(btn => {
    btn.addEventListener('click', async () => {
      const kw = btn.getAttribute('data-kw');
      const { keywords = [] } = await chrome.storage.sync.get('keywords');
      if (!keywords.includes(kw)) {
        keywords.push(kw);
        await chrome.storage.sync.set({ keywords });
        btn.style.background = 'rgba(16, 185, 129, 0.3)';
        btn.textContent = `✓ ${kw}`;
      }
    });
  });

  // Chime toggle
  settingChime.addEventListener('change', (e) => {
    isAudioEnabled = e.target.checked;
    chrome.storage.local.set({ soundEnabled: isAudioEnabled });
    if (isAudioEnabled) playGentleChime();
  });

  // Backup & Demo buttons
  btnExportJson.addEventListener('click', () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(opportunities, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `internship-deadlines-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  });

  btnLoadDemo.addEventListener('click', () => {
    opportunities = [...DEMO_OPPORTUNITIES];
    saveOpportunities();
    playGentleChime();
    renderAll();
    settingsModal.style.display = 'none';
  });

  btnClearAll.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all tracked opportunities?')) {
      opportunities = [];
      saveOpportunities();
      renderAll();
      settingsModal.style.display = 'none';
    }
  });

  // Storage listener for live updates from content script
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.recentAlerts) {
      opportunities = changes.recentAlerts.newValue || [];
      renderAll();
    }
  });
}

function deleteOpportunity(id) {
  opportunities = opportunities.filter(o => o.id !== id);
  saveOpportunities();
  renderAll();
}

function toggleAppliedStatus(id) {
  const item = opportunities.find(o => o.id === id);
  if (item) {
    item.status = item.status === 'applied' ? 'pending' : 'applied';
    saveOpportunities();
    renderAll();
  }
}

async function saveOpportunities() {
  await chrome.storage.local.set({ recentAlerts: opportunities });
}

/**
 * 1-Click Google Calendar event link
 */
function addToGoogleCalendar(item) {
  const title = encodeURIComponent(`Application Deadline: ${item.company} (${item.role})`);
  const reqStr = item.requirements || item.cgpa ? `\nEligibility & Requirements: ${item.requirements || item.cgpa}\n` : '\n';
  const details = encodeURIComponent(`Internship application deadline tracked via Internship Deck.\nDeadline: ${item.deadline}${reqStr}\nApply or view here: ${item.url || 'Check email'}`);
  const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}`;
  window.open(gcalUrl, '_blank');
}

/**
 * Generate standard RFC 5545 iCalendar (.ics) file
 */
function downloadIcsCalendar(items) {
  let icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Internship Deck//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  items.forEach((item, idx) => {
    const nowStr = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const reqStr = item.requirements || item.cgpa ? ` Criteria: ${item.requirements || item.cgpa}.` : '';
    icsContent.push('BEGIN:VEVENT');
    icsContent.push(`UID:internship-${item.id || idx}@internshipdeck.app`);
    icsContent.push(`DTSTAMP:${nowStr}`);
    icsContent.push(`SUMMARY:⏳ Deadline: ${item.company} - ${item.role}`);
    icsContent.push(`DESCRIPTION:Application deadline for ${item.role} at ${item.company}.${reqStr} Deadline: ${item.deadline}. Link: ${item.url || 'None'}`);
    icsContent.push(`STATUS:CONFIRMED`);
    icsContent.push('END:VEVENT');
  });

  icsContent.push('END:VCALENDAR');

  const blob = new Blob([icsContent.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `internship-deadlines-${new Date().toISOString().slice(0, 10)}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}
