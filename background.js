/**
 * Background Service Worker (Manifest V3)
 * Polls Gmail API via chrome.alarms, extracts internship deadlines,
 * and delivers native desktop push notifications.
 */

import { decodeGmailPayload, extractDeadline, extractRoleAndCompany, extractRequirements } from './utils/extractor.js';

const ALARM_NAME = 'gmailInboxPollAlarm';
const DEFAULT_POLL_INTERVAL_MIN = 15;
const DEFAULT_KEYWORDS = ['Internship', 'Intern', 'Co-op'];
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

// In-memory mapping of notification IDs to Gmail web URLs
const notificationUrlMap = new Map();

/**
 * Extension Installation & Setup
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Background] Extension installed/updated:', details.reason);

  const syncData = await chrome.storage.sync.get([
    'monitoringEnabled',
    'pollIntervalMinutes',
    'keywords'
  ]);

  const localData = await chrome.storage.local.get([
    'processedEmailIds',
    'lastChecked',
    'recentAlerts'
  ]);

  // Set default settings if not already present
  const newSyncSettings = {
    monitoringEnabled: syncData.monitoringEnabled !== undefined ? syncData.monitoringEnabled : true,
    pollIntervalMinutes: syncData.pollIntervalMinutes || DEFAULT_POLL_INTERVAL_MIN,
    keywords: syncData.keywords && syncData.keywords.length > 0 ? syncData.keywords : DEFAULT_KEYWORDS
  };

  await chrome.storage.sync.set(newSyncSettings);

  if (!localData.processedEmailIds) {
    await chrome.storage.local.set({
      processedEmailIds: [],
      lastChecked: null,
      recentAlerts: []
    });
  }

  // Set up periodic alarm if monitoring is enabled
  if (newSyncSettings.monitoringEnabled) {
    setupAlarm(newSyncSettings.pollIntervalMinutes);
  }
});

/**
 * Configure chrome.alarms
 */
function setupAlarm(intervalMinutes) {
  chrome.alarms.clear(ALARM_NAME, () => {
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: 1, // First run after 1 minute
      periodInMinutes: intervalMinutes
    });
    console.log(`[Background] Alarm scheduled to run every ${intervalMinutes} minutes.`);
  });
}

/**
 * Alarm listener for background polling
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('[Background] Alarm triggered inbox check at:', new Date().toLocaleTimeString());
    const { monitoringEnabled } = await chrome.storage.sync.get('monitoringEnabled');
    if (monitoringEnabled) {
      // 1. Automatically trigger silent scan on any open Gmail tabs
      try {
        const tabs = await chrome.tabs.query({ url: '*://mail.google.com/*' });
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, { type: 'SCAN_GMAIL_PAGE' }, () => {
            if (chrome.runtime.lastError) { /* ignore silent tab error */ }
          });
        }
      } catch (tabErr) {
        console.warn('[Background] Tab scan trigger error:', tabErr);
      }

      // 2. Also run API background poll if Google Cloud OAuth is active
      await pollInbox(false);
    }
  }
});

/**
 * Message handler for Popup interactions
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'CHECK_NOW': {
        const result = await pollInbox(true); // interactive = true if user explicitly clicks
        sendResponse(result);
        break;
      }

      case 'TOGGLE_MONITORING': {
        const { enabled } = message;
        await chrome.storage.sync.set({ monitoringEnabled: enabled });
        if (enabled) {
          const { pollIntervalMinutes } = await chrome.storage.sync.get('pollIntervalMinutes');
          setupAlarm(pollIntervalMinutes || DEFAULT_POLL_INTERVAL_MIN);
        } else {
          chrome.alarms.clear(ALARM_NAME);
          console.log('[Background] Monitoring disabled, alarm cleared.');
        }
        sendResponse({ success: true, enabled });
        break;
      }

      case 'UPDATE_KEYWORDS': {
        await chrome.storage.sync.set({ keywords: message.keywords });
        sendResponse({ success: true });
        break;
      }

      case 'TEST_NOTIFICATION': {
        const testItem = message.item || {
          id: 'test-' + Date.now(),
          company: 'Acme Robotics',
          role: 'Software Engineering Intern — Summer 2026',
          sender: 'Robotics Talent Team <recruiting@acmerobotics.com>',
          subject: 'Application Deadline: Software Engineering Intern 2026',
          snippet: 'Your application has been received. Eligibility criteria: Minimum 7.5 CGPA required for 2026 batch B.Tech CSE/IT students. Applications close on November 15, 2026 at 11:59 PM EST.',
          deadline: 'November 15, 2026 at 11:59 PM EST',
          cgpa: '7.5+ CGPA',
          batch: '2026 Batch',
          branches: 'B.Tech - CSE / IT',
          requirements: '7.5+ CGPA • 2026 Batch • B.Tech (CS/IT/ECE) • No Active Backlogs',
          url: 'https://mail.google.com/mail/u/0/#search/subject%3A%28internship%29+OR+deadline',
          timestamp: Date.now(),
          source: 'Sample Test Alert'
        };

        if (!message.item) {
          // Save to storage only if not already saved by popup
          await saveAlert(testItem);
        }

        // Trigger native desktop push notification and in-page banner (bypass cooldown for explicit test)
        createDeadlineNotification(testItem, true);
        sendResponse({ success: true, item: testItem });
        break;
      }

      case 'GET_AUTH_TOKEN': {
        try {
          const token = await getAuthToken(true);
          sendResponse({ success: true, tokenPresent: !!token });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        break;
      }

      case 'OPEN_DASHBOARD': {
        chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
        sendResponse({ success: true });
        break;
      }

      case 'IN_BROWSER_OPPORTUNITY_FOUND': {
        const item = message.data;
        if (item) {
          await saveAlert(item);
          createDeadlineNotification(item);
        }
        sendResponse({ success: true });
        break;
      }

      case 'OPEN_EMAIL_IN_GMAIL': {
        openOpportunityInGmail(message.item);
        sendResponse({ success: true });
        break;
      }

      default:
        sendResponse({ error: 'Unknown message type' });
    }
  })();

  return true; // Keep message channel open for async response
});

/**
 * Obtain Google OAuth2 token via chrome.identity
 */
async function getAuthToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        console.warn('[Background] getAuthToken error:', chrome.runtime.lastError.message);
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (!token) {
        return reject(new Error('Failed to retrieve OAuth2 token.'));
      }
      resolve(token);
    });
  });
}

/**
 * Invalidate cached token when 401 Unauthorized occurs
 */
async function invalidateToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => {
      console.log('[Background] Invalidated expired OAuth token.');
      resolve();
    });
  });
}

/**
 * Core Inbox Polling Flow
 */
export async function pollInbox(interactiveAuth = false) {
  try {
    console.log('[Background] Starting inbox poll...');
    let token;
    try {
      token = await getAuthToken(interactiveAuth);
    } catch (authErr) {
      console.warn('[Background] Auth error during poll:', authErr.message);
      await chrome.storage.local.set({
        lastCheckStatus: 'auth_required',
        lastCheckError: authErr.message
      });
      return { success: false, reason: 'auth_required', message: authErr.message };
    }

    const { keywords = DEFAULT_KEYWORDS } = await chrome.storage.sync.get('keywords');
    const { processedEmailIds = [] } = await chrome.storage.local.get('processedEmailIds');

    // Build Gmail search query
    // E.g.: is:unread ("Internship" OR "Intern" OR "Co-op") newer_than:7d
    const keywordQuery = keywords.map(k => `"${k.trim()}"`).join(' OR ');
    const query = `is:unread (${keywordQuery}) newer_than:7d`;

    const searchUrl = `${GMAIL_API_BASE}/messages?q=${encodeURIComponent(query)}&maxResults=15`;
    
    let res = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.status === 401) {
      console.warn('[Background] Token expired, refreshing...');
      await invalidateToken(token);
      token = await getAuthToken(interactiveAuth);
      res = await fetch(searchUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });
    }

    if (!res.ok) {
      throw new Error(`Gmail API error: ${res.status} ${res.statusText}`);
    }

    const searchData = await res.json();
    const messages = searchData.messages || [];
    console.log(`[Background] Found ${messages.length} unread matching messages.`);

    let newOpportunitiesFound = 0;
    const processedSet = new Set(processedEmailIds);

    for (const msgRef of messages) {
      if (processedSet.has(msgRef.id)) {
        continue; // Already processed
      }

      // Fetch full message details
      const msgDetails = await fetchMessageDetails(msgRef.id, token);
      if (!msgDetails) continue;

      // Extract details
      const headers = msgDetails.payload?.headers || [];
      let subject = '';
      for (const h of headers) {
        if (h.name.toLowerCase() === 'subject') {
          subject = h.value;
          break;
        }
      }

      const bodyText = decodeGmailPayload(msgDetails.payload);
      const deadlineResult = extractDeadline(bodyText, subject);

      if (deadlineResult.found) {
        const { company, role } = extractRoleAndCompany(headers, subject, msgDetails.snippet);
        const reqInfo = extractRequirements(bodyText, subject);
        const webUrl = `https://mail.google.com/mail/u/0/#inbox/${msgRef.id}`;

        console.log(`[Background] 🎯 Deadline found for ${company} (${role}): ${deadlineResult.formattedDeadline} | Req: ${reqInfo.summary}`);

        const item = {
          id: msgRef.id,
          company,
          role,
          deadline: deadlineResult.formattedDeadline,
          cgpa: reqInfo.cgpa,
          batch: reqInfo.batch,
          branches: reqInfo.branches,
          requirements: reqInfo.summary,
          snippet: deadlineResult.snippet,
          url: webUrl,
          timestamp: Date.now()
        };

        // Trigger native notification
        createDeadlineNotification(item);

        // Save to recent alerts
        await saveAlert(item);

        newOpportunitiesFound++;
      }

      // Mark as processed to prevent duplicate alerts
      processedSet.add(msgRef.id);
    }

    // Keep processed IDs list bounded to 300 to avoid unbounded storage growth
    const updatedProcessed = Array.from(processedSet).slice(-300);
    const nowIso = new Date().toISOString();

    await chrome.storage.local.set({
      processedEmailIds: updatedProcessed,
      lastChecked: nowIso,
      lastCheckStatus: 'success',
      lastCheckError: null
    });

    console.log(`[Background] Poll completed. New alerts: ${newOpportunitiesFound}`);
    return {
      success: true,
      newAlerts: newOpportunitiesFound,
      totalChecked: messages.length,
      lastChecked: nowIso
    };
  } catch (error) {
    console.error('[Background] Polling error:', error);
    await chrome.storage.local.set({
      lastCheckStatus: 'error',
      lastCheckError: error.message
    });
    return { success: false, error: error.message };
  }
}

/**
 * Fetches full message payload
 */
async function fetchMessageDetails(messageId, token) {
  try {
    const url = `${GMAIL_API_BASE}/messages/${messageId}?format=full`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error(`[Background] Failed to fetch message ${messageId}:`, err);
    return null;
  }
}

const notificationItemMap = new Map();
const recentlyNotifiedDeadlines = new Map(); // key -> timestamp
const BG_NOTIFICATION_COOLDOWN_MS = 15 * 60 * 1000; // 15 mins cooldown

/**
 * Creates a rich native desktop push notification and injects an in-page Chrome banner
 */
async function openOpportunityInGmail(item) {
  if (!item) return;

  const legacyThreadId = item.legacyThreadId || (item.id && !item.id.startsWith('test-') && !item.id.startsWith('open-') ? item.id.replace(/^gmail-/, '') : null);
  const cleanSubject = (item.cleanSubject || item.role || 'internship').replace(/[\[\]"']/g, ' ').replace(/\s+/g, ' ').trim();
  const safeSearchWords = ((item.company && item.company !== 'Company' ? item.company + ' ' : '') + cleanSubject).slice(0, 50).trim();

  // 1. Try to find an existing open Gmail tab first
  try {
    const tabs = await chrome.tabs.query({ url: '*://mail.google.com/*' });
    if (tabs.length > 0) {
      const tab = tabs[0];
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }

      chrome.tabs.sendMessage(tab.id, {
        type: 'OPEN_EMAIL_THREAD',
        legacyThreadId: legacyThreadId,
        search: safeSearchWords
      }, (res) => {
        if (chrome.runtime.lastError || !res || !res.opened) {
          const userBase = tab.url ? tab.url.split('#')[0] : 'https://mail.google.com/mail/u/0/';
          const dest = legacyThreadId ? `${userBase}#all/${legacyThreadId}` : `${userBase}#search/${encodeURIComponent(safeSearchWords)}`;
          chrome.tabs.update(tab.id, { url: dest });
        }
      });
      return;
    }
  } catch (err) {
    console.warn('[Background] Tab query error:', err);
  }

  // 2. If no Gmail tab open, create a new tab with exact target URL
  let targetUrl = item.url;
  if (!targetUrl || targetUrl.endsWith('#inbox') || targetUrl.endsWith('/#inbox') || targetUrl === 'https://mail.google.com' || targetUrl.includes('.slice(')) {
    const base = item.gmailBase || 'https://mail.google.com/mail/u/0/';
    targetUrl = legacyThreadId ? `${base}#all/${legacyThreadId}` : `${base}#search/${encodeURIComponent(safeSearchWords)}`;
  }
  await chrome.tabs.create({ url: targetUrl });
}

/**
 * Creates a rich native desktop push notification and injects an in-page Chrome banner
 */
function createDeadlineNotification(item, isTest = false) {
  if (!item) return;

  const { id, company = 'Company', role = 'Opportunity', deadline = 'See Email', url } = item;

  const legacyThreadId = item.legacyThreadId || (id && !String(id).startsWith('test-') ? String(id).replace(/^gmail-/, '') : '');
  const cleanSubject = (item.cleanSubject || role).replace(/[\[\]"']/g, ' ').replace(/\s+/g, ' ').trim();
  const safeSearch = ((company !== 'Company' ? company + ' ' : '') + cleanSubject).slice(0, 50).trim();

  // Deduplication check: prevent loop spamming of the same opportunity
  const dedupKey = item.stateKey || (legacyThreadId ? `thread:${legacyThreadId}` : `${company.toLowerCase()}::${cleanSubject.toLowerCase()}`);
  if (!isTest && dedupKey) {
    const lastNotifiedTime = recentlyNotifiedDeadlines.get(dedupKey);
    const now = Date.now();
    if (lastNotifiedTime && (now - lastNotifiedTime) < BG_NOTIFICATION_COOLDOWN_MS) {
      console.log(`[Background] Skipping duplicate notification for "${dedupKey}" (cooldown active: ${Math.round((now - lastNotifiedTime) / 1000)}s ago).`);
      return;
    }
    recentlyNotifiedDeadlines.set(dedupKey, now);

    // Keep cache bounded
    if (recentlyNotifiedDeadlines.size > 200) {
      const oldestKeys = Array.from(recentlyNotifiedDeadlines.keys()).slice(0, 50);
      oldestKeys.forEach(k => recentlyNotifiedDeadlines.delete(k));
    }
  }

  let targetUrl = url;
  if (!targetUrl || targetUrl.endsWith('#inbox') || targetUrl.endsWith('/#inbox') || targetUrl.includes('.slice(')) {
    const base = item.gmailBase || 'https://mail.google.com/mail/u/0/';
    targetUrl = legacyThreadId ? `${base}#all/${legacyThreadId}` : `${base}#search/${encodeURIComponent(safeSearch)}`;
  }

  // Short, deterministic notificationId so updates modify in-place instead of creating infinite stacked alerts
  const shortId = legacyThreadId ? legacyThreadId.slice(0, 24) : (dedupKey ? dedupKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-24) : String(id).slice(-12));
  const notificationId = isTest ? `deadline__test__${Date.now()}` : `deadline__${shortId}`;
  notificationItemMap.set(notificationId, { ...item, url: targetUrl });

  // Concise layout optimized for Windows Action Center and desktop alerts
  const reqText = item.requirements || (item.cgpa && item.cgpa !== 'Not specified' ? `Min CGPA: ${item.cgpa}` : (item.snippet ? `“${item.snippet.slice(0, 70)}”` : 'Check email for details'));
  const title = `🎯 ${company} — ${role}`.slice(0, 60);
  const message = `⏳ Deadline: ${deadline}\n🎓 Criteria: ${reqText}`.slice(0, 140);

  const simpleOptions = {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: title,
    message: message,
    priority: 2
  };

  try {
    chrome.notifications.create(
      notificationId,
      {
        ...simpleOptions,
        contextMessage: item.cgpa && item.cgpa !== 'Not specified' ? `Eligibility: ${item.cgpa}` : `${company} • Internship Alert`,
        requireInteraction: true,
        buttons: [
          { title: '📬 Open in Gmail' },
          { title: '📅 Add to Calendar' }
        ]
      },
      () => {
        if (chrome.runtime.lastError) {
          chrome.notifications.create(notificationId, simpleOptions);
        }
      }
    );
  } catch (err) {
    chrome.notifications.create(notificationId, simpleOptions);
  }

  // Inject rich, formatted in-page alert banner on the active tab
  injectInPageBanner({ ...item, url: targetUrl });
}

async function resolveNotificationItem(notificationId) {
  if (notificationItemMap.has(notificationId)) {
    return notificationItemMap.get(notificationId);
  }
  // If service worker woke up from idle sleep, recover item from persistent storage!
  try {
    const { recentAlerts = [] } = await chrome.storage.local.get(['recentAlerts']);
    const shortId = notificationId.replace(/^deadline__/, '');
    const found = recentAlerts.find(a => 
      (a.legacyThreadId && a.legacyThreadId.includes(shortId)) ||
      (a.stateKey && a.stateKey.includes(shortId)) ||
      (a.id && String(a.id).includes(shortId))
    );
    if (found) return found;
    if (recentAlerts.length > 0) return recentAlerts[0];
  } catch (err) {
    console.warn('[Background] Error recovering item from storage:', err);
  }
  return null;
}

/**
 * Notification Button Click Listener
 */
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  const item = await resolveNotificationItem(notificationId);

  if (buttonIndex === 0) {
    // Button 0: 'Open in Gmail' -> exact email link!
    openOpportunityInGmail(item);
  } else if (buttonIndex === 1) {
    // Button 1: 'Add to Calendar'
    const company = item?.company || 'Internship';
    const role = item?.role || 'Opportunity';
    const title = encodeURIComponent(`Application Deadline: ${company} (${role})`);
    const details = encodeURIComponent(`Application deadline for ${role} at ${company}.\nDeadline: ${item?.deadline || ''}\nSubject: ${item?.subject || ''}\nDirect Link: ${item?.url || 'Check Gmail'}`);
    chrome.tabs.create({
      url: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}`
    });
  }

  chrome.notifications.clear(notificationId);
});

/**
 * Notification Body Click Listener
 */
chrome.notifications.onClicked.addListener(async (notificationId) => {
  const item = await resolveNotificationItem(notificationId);
  openOpportunityInGmail(item);
  chrome.notifications.clear(notificationId);
});

/**
 * Save alert into recent alerts array in chrome.storage.local
 */
async function saveAlert(alertObj) {
  const { recentAlerts = [] } = await chrome.storage.local.get(['recentAlerts']);
  
  const existingIndex = recentAlerts.findIndex(a => 
    (alertObj.legacyThreadId && a.legacyThreadId === alertObj.legacyThreadId) ||
    (alertObj.stateKey && a.stateKey === alertObj.stateKey) ||
    (alertObj.id && a.id === alertObj.id) ||
    (alertObj.lastMessageId && a.lastMessageId === alertObj.lastMessageId) ||
    (a.company && alertObj.company && a.company.toLowerCase() === alertObj.company.toLowerCase() && 
     ((a.subject && alertObj.subject && a.subject.toLowerCase() === alertObj.subject.toLowerCase()) ||
      (a.role && alertObj.role && a.role.toLowerCase() === alertObj.role.toLowerCase())))
  );

  let updatedList;
  if (existingIndex >= 0) {
    const existing = recentAlerts[existingIndex];
    const merged = {
      ...existing,
      ...alertObj,
      deadline: (alertObj.deadline && alertObj.deadline !== 'See Email Details') ? alertObj.deadline : existing.deadline,
      cgpa: alertObj.cgpa || existing.cgpa,
      requirements: alertObj.requirements || existing.requirements,
      snippet: alertObj.snippet || existing.snippet,
      subject: alertObj.subject || existing.subject,
      timestamp: Date.now()
    };
    updatedList = [...recentAlerts];
    updatedList.splice(existingIndex, 1);
    updatedList.unshift(merged);
  } else {
    updatedList = [alertObj, ...recentAlerts].slice(0, 50);
  }

  await chrome.storage.local.set({ recentAlerts: updatedList });
}

/**
 * Injects a sleek in-page alert banner directly onto the active Chrome webpage
 */
function injectInPageBanner(item) {
  // Use lastFocusedWindow: true because service workers have no currentWindow
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    let targetTab = tabs && tabs[0];
    if (!targetTab) {
      chrome.tabs.query({ active: true }, (allActive) => {
        if (allActive && allActive[0]) {
          injectIntoTabIfSafe(allActive[0], item);
        }
      });
      return;
    }
    injectIntoTabIfSafe(targetTab, item);
  });
}

function injectIntoTabIfSafe(tab, item) {
  if (tab && tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://') && !tab.url.startsWith('edge://') && !tab.url.startsWith('about:')) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: renderChromePageBanner,
      args: [item]
    }).catch((e) => console.log('[Background] Tab script note:', e.message));
  }
}

/**
 * Executed in the active Chrome page context: Rich details including Sender, Subject, and Snippet
 */
function renderChromePageBanner(item) {
  const existing = document.getElementById('internship-deck-inpage-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'internship-deck-inpage-banner';
  banner.style.cssText = `
    position: fixed !important;
    top: 20px !important;
    right: 20px !important;
    z-index: 2147483647 !important;
    width: 390px !important;
    max-width: 90vw !important;
    background: #0f172a !important;
    color: #f8fafc !important;
    border: 1px solid rgba(99, 102, 241, 0.6) !important;
    border-left: 5px solid #6366f1 !important;
    border-radius: 14px !important;
    padding: 16px !important;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 20px rgba(99, 102, 241, 0.25) !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    font-size: 12px !important;
    line-height: 1.45 !important;
    box-sizing: border-box !important;
    animation: slideDownIn 0.3s ease-out !important;
  `;

  const reqText = item.requirements || (item.cgpa && item.cgpa !== 'Not specified' ? `Min CGPA: ${item.cgpa}` : null);
  const reqHtml = reqText ? `
    <div style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 8px; padding: 7px 10px; margin-bottom: 8px;">
      <div style="font-size: 10.5px; font-weight: 800; color: #34d399; margin-bottom: 2px; display: flex; align-items: center; gap: 4px;">
        <span>🎓</span> <span>ELIGIBILITY & REQUIREMENTS</span>
      </div>
      <div style="font-size: 11.5px; color: #f8fafc; font-weight: 600;">
        ${escapeBannerHtml(reqText)}
      </div>
    </div>
  ` : '';

  const senderHtml = item.sender ? `<div style="font-size: 11px; color: #94a3b8; margin-bottom: 2px;"><strong>From:</strong> ${escapeBannerHtml(item.sender)}</div>` : '';
  const subjectHtml = item.subject ? `<div style="font-size: 11px; color: #cbd5e1; margin-bottom: 6px; font-weight: 600;"><strong>Subject:</strong> ${escapeBannerHtml(item.subject)}</div>` : '';
  const snippetHtml = item.snippet ? `<div style="font-size: 11px; color: #94a3b8; font-style: italic; background: rgba(0,0,0,0.25); border-left: 2px solid #6366f1; padding: 6px 8px; border-radius: 4px; margin-bottom: 8px;">“${escapeBannerHtml(item.snippet)}”</div>` : '';

  banner.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 18px;">🎯</span>
        <strong style="font-size: 13px; color: #ffffff; font-weight: 800;">Internship Opportunity Alert!</strong>
      </div>
      <button id="inpage-banner-close" style="background: rgba(255,255,255,0.08); border: none; color: #94a3b8; font-size: 14px; cursor: pointer; padding: 3px 8px; border-radius: 6px;">✕</button>
    </div>

    <div style="background: #1e293b; border-radius: 10px; padding: 12px; margin-bottom: 12px; border: 1px solid #334155;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
        <span style="font-size: 14px; font-weight: 800; color: #ffffff;">🏢 ${escapeBannerHtml(item.company || 'Company')}</span>
        <span style="display: inline-block; font-size: 10.5px; font-weight: 800; color: #fca5a5; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); padding: 2px 7px; border-radius: 6px;">
          ⏳ ${escapeBannerHtml(item.deadline || 'Check Email')}
        </span>
      </div>
      <div style="font-size: 12px; color: #818cf8; font-weight: 600; margin-bottom: 8px;">💼 ${escapeBannerHtml(item.role || 'Opportunity')}</div>
      ${reqHtml}
      ${senderHtml}
      ${subjectHtml}
      ${snippetHtml}
    </div>

    <div style="display: flex; gap: 8px;">
      <button id="inpage-banner-open-mail" style="flex: 1.2; text-align: center; background: linear-gradient(135deg, #4f46e5, #7e22ce); color: #ffffff; border: none; padding: 9px 12px; border-radius: 8px; font-weight: 700; font-size: 11.5px; cursor: pointer; box-shadow: 0 4px 10px rgba(79, 70, 229, 0.3);">
        📬 Open Email
      </button>
      <button id="inpage-banner-cal" style="flex: 1; text-align: center; background: #1e293b; color: #e2e8f0; border: 1px solid #334155; padding: 9px 10px; border-radius: 8px; font-weight: 700; font-size: 11.5px; cursor: pointer;">
        📅 Add to Cal
      </button>
    </div>
  `;

  function escapeBannerHtml(str) {
    return (str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
  }

  document.body.appendChild(banner);

  document.getElementById('inpage-banner-close').addEventListener('click', () => {
    banner.remove();
  });

  document.getElementById('inpage-banner-open-mail').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_EMAIL_IN_GMAIL', item: item });
    banner.remove();
  });

  document.getElementById('inpage-banner-cal').addEventListener('click', () => {
    const title = encodeURIComponent(`Application Deadline: ${item.company} (${item.role})`);
    const details = encodeURIComponent(`Internship deadline for ${item.role} at ${item.company}.\nDeadline: ${item.deadline}\nSubject: ${item.subject || ''}\nDirect Link: ${item.url || 'Check Gmail'}`);
    window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}`, '_blank');
    banner.remove();
  });

  // Auto-dismiss after 18 seconds
  setTimeout(() => {
    if (banner.parentElement) banner.remove();
  }, 18000);
}
