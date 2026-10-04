/**
 * Popup Script (popup.js)
 * Clean, lightweight, self-contained popup controller.
 * Handles instant Gmail tab scanning, native desktop alerts,
 * reliable iOS toggle switch, and instant opportunity deletion.
 */

// Web Audio API Synthesizer
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.5);
  } catch (e) {
    console.log('Audio chime not allowed:', e);
  }
}

// DOM Elements
const toastBanner = document.getElementById('toastBanner');
const toastIcon = document.getElementById('toastIcon');
const toastMsg = document.getElementById('toastMsg');
const toastClose = document.getElementById('toastClose');

const headerStatusText = document.getElementById('headerStatusText');
const btnScanTab = document.getElementById('btnScanTab');
const btnTestNotification = document.getElementById('btnTestNotification');
const noGmailBanner = document.getElementById('noGmailBanner');
const btnOpenGmail = document.getElementById('btnOpenGmail');

const monitoringToggle = document.getElementById('monitoringToggle');
const toggleStateLabel = document.getElementById('toggleStateLabel');

const keywordForm = document.getElementById('keywordForm');
const keywordInput = document.getElementById('keywordInput');
const keywordChips = document.getElementById('keywordChips');
const keywordCount = document.getElementById('keywordCount');

const alertsList = document.getElementById('alertsList');
const oppsCount = document.getElementById('oppsCount');
const btnClearHistory = document.getElementById('btnClearHistory');
const lastCheckedFooter = document.getElementById('lastCheckedFooter');

// State
let currentKeywords = [];
let recentOpportunities = [];
let toastTimeout = null;

document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  setupEventListeners();
});

/**
 * Toast Notification Banner
 */
function showToast(msg, icon = '🔔', isError = false) {
  clearTimeout(toastTimeout);
  toastMsg.textContent = msg;
  toastIcon.textContent = icon;

  if (isError) {
    toastBanner.classList.add('toast-error');
  } else {
    toastBanner.classList.remove('toast-error');
  }

  toastBanner.classList.remove('hidden');

  toastTimeout = setTimeout(() => {
    toastBanner.classList.add('hidden');
  }, 4000);
}

toastClose.addEventListener('click', () => {
  toastBanner.classList.add('hidden');
});

/**
 * Load Initial Settings & Opportunities
 */
async function loadState() {
  const syncData = await chrome.storage.sync.get(['monitoringEnabled', 'keywords']);
  const localData = await chrome.storage.local.get(['lastChecked', 'recentAlerts']);

  // Monitoring toggle state
  const isEnabled = syncData.monitoringEnabled !== false;
  monitoringToggle.checked = isEnabled;
  updateSwitchUI(isEnabled);

  // Keywords
  currentKeywords = syncData.keywords || ['Internship', 'Intern', 'Co-op', 'Fellowship'];
  renderKeywords();

  // Opportunities
  recentOpportunities = localData.recentAlerts || [];
  renderOpportunities(recentOpportunities);

  // Last Checked
  updateLastCheckedUI(localData.lastChecked);
}

/**
 * Setup Event Listeners
 */
function setupEventListeners() {
  // 1. Scan Open Gmail Tab
  btnScanTab.addEventListener('click', async () => {
    btnScanTab.disabled = true;
    btnScanTab.innerHTML = '<span class="btn-icon">⏳</span> <span>Scanning...</span>';
    noGmailBanner.classList.add('hidden');

    try {
      const tabs = await chrome.tabs.query({ url: '*://mail.google.com/*' });
      
      if (tabs.length === 0) {
        noGmailBanner.classList.remove('hidden');
        showToast('No Gmail tab found! Open Gmail first.', '⚠️', true);
        btnScanTab.disabled = false;
        btnScanTab.innerHTML = '<span class="btn-icon">⚡</span> <span>Scan Gmail Tab</span>';
        return;
      }

      showToast('Scanning your open Gmail tab...', '⚡');
      let foundCount = 0;

      for (const tab of tabs) {
        // Ensure content script is actively injected into tab
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        }).catch(() => {});

        await new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id, { type: 'SCAN_GMAIL_PAGE' }, (res) => {
            if (res && res.items && res.items.length > 0) {
              res.items.forEach(newItem => {
                const existingIdx = recentOpportunities.findIndex(o => 
                  (newItem.legacyThreadId && o.legacyThreadId === newItem.legacyThreadId) ||
                  (newItem.id && o.id === newItem.id) ||
                  (newItem.lastMessageId && o.lastMessageId === newItem.lastMessageId) ||
                  (o.company.toLowerCase() === newItem.company.toLowerCase() && o.cleanSubject && newItem.cleanSubject && o.cleanSubject.toLowerCase() === newItem.cleanSubject.toLowerCase())
                );
                if (existingIdx >= 0) {
                  const existing = recentOpportunities[existingIdx];
                  const hasNewInfo = (newItem.deadline && newItem.deadline !== 'See Email Details' && newItem.deadline !== existing.deadline) ||
                                     (newItem.snippet && newItem.snippet !== existing.snippet);
                  if (hasNewInfo) {
                    recentOpportunities[existingIdx] = { ...existing, ...newItem, timestamp: Date.now() };
                    foundCount++;
                  }
                } else {
                  recentOpportunities.unshift(newItem);
                  foundCount++;
                }
              });
            }
            resolve();
          });
          setTimeout(resolve, 1500); // 1.5s timeout safety
        });
      }

      const nowIso = new Date().toISOString();
      await chrome.storage.local.set({ 
        recentAlerts: recentOpportunities,
        lastChecked: nowIso
      });
      updateLastCheckedUI(nowIso);
      renderOpportunities(recentOpportunities);

      if (foundCount > 0) {
        playChime();
        showToast(`🎯 Found ${foundCount} new deadline(s)!`, '🎉');
      } else {
        showToast('✓ Scanned Gmail: No new unread internship emails found.', '✓');
      }
    } catch (err) {
      console.warn('Tab scan error:', err);
      showToast('Scan error: ' + err.message, '⚠️', true);
    } finally {
      btnScanTab.disabled = false;
      btnScanTab.innerHTML = '<span class="btn-icon">⚡</span> <span>Scan Gmail Tab</span>';
    }
  });

  // Open Gmail button from notice
  btnOpenGmail.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://mail.google.com' });
    noGmailBanner.classList.add('hidden');
  });

  // 2. Test Desktop Push Alert
  btnTestNotification.addEventListener('click', async () => {
    playChime();
    showToast('🔔 Desktop Notification Sent!', '🔔');

    const sampleItem = {
      id: 'test-' + Date.now(),
      company: 'Google',
      role: 'Software Engineering Intern — Summer 2026',
      sender: 'Google University Programs <internships@google.com>',
      subject: 'Software Engineering Internship 2026 - Next Steps',
      snippet: 'Thank you for applying. Minimum 8.0 CGPA required. 2026 Batch (B.Tech / M.Tech CSE/IT). The application deadline is October 25, 2026 at 11:59 PM EST. Please submit your materials before the cutoff.',
      deadline: 'October 25, 2026 at 11:59 PM EST',
      cgpa: '8.0+ CGPA',
      batch: '2026 Batch',
      branches: 'B.Tech / M.Tech CSE/IT',
      requirements: '8.0+ CGPA | 2026 Batch | B.Tech / M.Tech CSE/IT',
      url: 'https://mail.google.com/mail/u/0/#search/subject%3A%28internship%29+OR+deadline',
      timestamp: Date.now(),
      source: 'Sample Test Alert'
    };

    // Add to list and save
    recentOpportunities.unshift(sampleItem);
    await chrome.storage.local.set({ recentAlerts: recentOpportunities });
    renderOpportunities(recentOpportunities);

    // Dispatch native Windows push notification and in-page banner
    chrome.runtime.sendMessage({ type: 'TEST_NOTIFICATION', item: sampleItem });
  });

  // 3. Real-Time Monitor Switch (ON/OFF)
  monitoringToggle.addEventListener('change', async (e) => {
    const isEnabled = e.target.checked;
    updateSwitchUI(isEnabled);
    await chrome.storage.sync.set({ monitoringEnabled: isEnabled });
    chrome.runtime.sendMessage({ type: 'TOGGLE_MONITORING', enabled: isEnabled });
    showToast(isEnabled ? 'Monitoring is Active' : 'Monitoring is Paused', isEnabled ? '⚡' : '⏸️');
  });

  // 4. Keyword Form
  keywordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const newWord = keywordInput.value.trim();
    if (!newWord) return;

    if (currentKeywords.some(k => k.toLowerCase() === newWord.toLowerCase())) {
      keywordInput.value = '';
      return;
    }

    currentKeywords.push(newWord);
    keywordInput.value = '';
    saveKeywords();
    renderKeywords();
    showToast(`Added keyword: "${newWord}"`, '➕');
  });

  // 5. Clear All History
  btnClearHistory.addEventListener('click', async () => {
    if (recentOpportunities.length === 0) return;
    if (confirm('Clear all tracked opportunities from your list?')) {
      recentOpportunities = [];
      await chrome.storage.local.set({ recentAlerts: [], emailHistory: {} });
      renderOpportunities([]);
      showToast('Cleared all opportunities', '🗑️');
    }
  });

  // Storage listener for live background updates
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes.recentAlerts) {
        recentOpportunities = changes.recentAlerts.newValue || [];
        renderOpportunities(recentOpportunities);
      }
      if (changes.lastChecked) {
        updateLastCheckedUI(changes.lastChecked.newValue);
      }
    }
  });
}

function updateSwitchUI(isEnabled) {
  if (isEnabled) {
    toggleStateLabel.textContent = 'ON';
    toggleStateLabel.className = 'switch-status-label status-on';
    headerStatusText.textContent = 'Active';
  } else {
    toggleStateLabel.textContent = 'OFF';
    toggleStateLabel.className = 'switch-status-label status-off';
    headerStatusText.textContent = 'Paused';
  }
}

function renderKeywords() {
  keywordChips.innerHTML = '';
  keywordCount.textContent = `${currentKeywords.length} keyword${currentKeywords.length === 1 ? '' : 's'}`;

  currentKeywords.forEach((keyword, index) => {
    const chip = document.createElement('div');
    chip.className = 'keyword-chip';
    chip.innerHTML = `
      <span>${escapeHtml(keyword)}</span>
      <button class="chip-remove-btn" title="Remove keyword">✕</button>
    `;

    chip.querySelector('.chip-remove-btn').addEventListener('click', () => {
      currentKeywords.splice(index, 1);
      saveKeywords();
      renderKeywords();
    });

    keywordChips.appendChild(chip);
  });
}

async function saveKeywords() {
  await chrome.storage.sync.set({ keywords: currentKeywords });
  chrome.runtime.sendMessage({ type: 'UPDATE_KEYWORDS', keywords: currentKeywords });
}

function updateLastCheckedUI(timestamp) {
  if (!timestamp) {
    lastCheckedFooter.textContent = 'Last checked: Never';
    return;
  }
  const date = new Date(timestamp);
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);

  if (diffSec < 60) lastCheckedFooter.textContent = 'Last checked: Just now';
  else if (diffSec < 3600) lastCheckedFooter.textContent = `Last checked: ${Math.floor(diffSec / 60)}m ago`;
  else lastCheckedFooter.textContent = `Last checked: ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Render Opportunities with Visible Red Delete Button
 */
function renderOpportunities(alerts) {
  oppsCount.textContent = alerts.length;

  if (!alerts || alerts.length === 0) {
    alertsList.innerHTML = `
      <div class="empty-state">
        No opportunities detected yet.<br>Click <strong>Scan Gmail Tab</strong> or <strong>Test Alert</strong> above!
      </div>
    `;
    return;
  }

  alertsList.innerHTML = '';
  alerts.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'opportunity-item';

    let directUrl = item.url;
    if (!directUrl || directUrl.endsWith('#inbox') || directUrl.endsWith('/#inbox') || directUrl === 'https://mail.google.com') {
      const q = (item.company && item.company !== 'Company') ? `${item.company} ${item.role}` : item.role;
      directUrl = `https://mail.google.com/mail/u/0/#search/subject%3A%28${encodeURIComponent(q.slice(0, 40))}%29`;
    }

    const reqText = item.requirements || (item.cgpa ? `${item.cgpa}${item.batch ? ' | ' + item.batch : ''}` : '');
    const reqHtml = reqText ? `<div class="opp-requirements" style="font-size: 11px; color: #34d399; font-weight: 600; margin: 3px 0; background: rgba(52, 211, 153, 0.12); border: 1px solid rgba(52, 211, 153, 0.3); padding: 3px 8px; border-radius: 4px; display: inline-block;">🎓 ${escapeHtml(reqText)}</div>` : '';

    const senderHtml = item.sender ? `<div class="opp-sender">👤 ${escapeHtml(item.sender)}</div>` : '';
    const subjectHtml = item.subject ? `<div class="opp-subject">📧 ${escapeHtml(item.subject)}</div>` : '';
    const snippetHtml = item.snippet ? `<div class="opp-snippet">“${escapeHtml(item.snippet.slice(0, 110))}${item.snippet.length > 110 ? '...' : ''}”</div>` : '';

    card.innerHTML = `
      <div class="opp-details">
        <div class="opp-title-row">
          <span class="opp-company">${escapeHtml(item.company)}</span>
          <span class="opp-deadline-tag">⏳ ${escapeHtml(item.deadline)}</span>
        </div>
        <div class="opp-role">${escapeHtml(item.role)}</div>
        ${reqHtml}
        ${senderHtml}
        ${subjectHtml}
        ${snippetHtml}
        <div class="opp-bottom-row">
          <button type="button" class="opp-email-btn">Open in Gmail ↗</button>
          <button type="button" class="opp-cal-btn" style="background: none; border: none; color: #94a3b8; font-size: 10px; cursor: pointer; padding: 0;">📅 Add to Cal</button>
          <span class="opp-time-ago">${formatTimeAgo(item.timestamp)}</span>
        </div>
      </div>
      <button class="btn-delete-card" title="Delete this opportunity" aria-label="Delete">
        ✕
      </button>
    `;

    // Click "Open in Gmail" -> calls background to focus/click or open exact thread!
    card.querySelector('.opp-email-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'OPEN_EMAIL_IN_GMAIL', item: item });
    });

    // Click "Add to Cal"
    card.querySelector('.opp-cal-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const title = encodeURIComponent(`Application Deadline: ${item.company} (${item.role})`);
      const details = encodeURIComponent(`Deadline for ${item.role} at ${item.company}.\nDeadline: ${item.deadline}\nEligibility/Requirements: ${reqText || 'Check Email'}\nSubject: ${item.subject || ''}\nDirect Link: ${item.url || 'Check Gmail'}`);
      window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}`, '_blank');
    });

    // Click Red Delete Button -> Delete Immediately
    card.querySelector('.btn-delete-card').addEventListener('click', async (e) => {
      e.stopPropagation();
      recentOpportunities = recentOpportunities.filter((_, i) => i !== index);
      await chrome.storage.local.set({ recentAlerts: recentOpportunities });
      renderOpportunities(recentOpportunities);
      showToast(`Deleted ${item.company}`, '🗑️');
    });

    alertsList.appendChild(card);
  });
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

function formatTimeAgo(ts) {
  if (!ts) return '';
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.floor(diffHours / 24)}d`;
}
