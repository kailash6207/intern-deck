/**
 * Content Script (content.js) - Automatic Real-Time Gmail Scanner
 * Runs directly on mail.google.com to detect internship opportunities & deadlines in real-time.
 * 100% Free & Zero Cloud/OAuth setup required!
 */

(function () {
  if (window.__INTERNSHIP_TRACKER_LOADED__) {
    return;
  }
  window.__INTERNSHIP_TRACKER_LOADED__ = true;

// Default trigger keywords
let activeKeywords = ['internship', 'intern', 'co-op', 'fellowship', 'summer 2026', 'deadline', 'apply by', 'due date'];
const DEADLINE_TRIGGERS = [
  'deadline', 'apply by', 'closes on', 'due date', 'last date', 'applications close', 
  'closing date', 'cutoff', 'must be submitted by', 'apply now', 'applications open', 
  'rolling basis', 'closing soon', 'priority deadline', 'accepting applications', 
  'submit by', 'application window', 'final deadline', 'last call', 'expires on'
];

// In-page UI and scanning state variables
let floatingBadge = null;
let mutationTimeout = null;

// Track email state (snippet, deadline, messageId, timestamp) to prevent duplicate push notifications
const emailHistoryMap = new Map();
const NOTIFICATION_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6-hour cooldown per opportunity to prevent looping alerts

// Stable key generator across inbox list and opened email views
function getOpportunityKey(legacyThreadId, companyOrSender, cleanSubject) {
  if (legacyThreadId) {
    return 'thread:' + String(legacyThreadId).replace(/^thread_/, '');
  }
  const s = (companyOrSender || '').toLowerCase().trim();
  const subj = (cleanSubject || '').toLowerCase().trim();
  if (s && subj) {
    return `email:${s}::${subj}`;
  }
  if (subj) {
    return `subject:${subj}`;
  }
  return null;
}

// Load custom search keywords from sync storage
async function loadKeywords() {
  try {
    const data = await chrome.storage.sync.get('keywords');
    if (data && data.keywords && Array.isArray(data.keywords) && data.keywords.length > 0) {
      activeKeywords = data.keywords.map(k => k.toLowerCase().trim());
    }
  } catch (err) {
    console.warn('[Internship Deck] Error loading keywords:', err);
  }
}
loadKeywords();

function loadEmailHistory() {
  chrome.storage.local.get(['emailHistory'], (res) => {
    if (res.emailHistory && typeof res.emailHistory === 'object') {
      Object.entries(res.emailHistory).forEach(([k, v]) => {
        emailHistoryMap.set(k, v);
      });
    }
  });
}
loadEmailHistory();

let saveHistoryTimeout = null;
function debouncedSaveEmailHistory() {
  clearTimeout(saveHistoryTimeout);
  saveHistoryTimeout = setTimeout(() => {
    saveEmailHistory();
  }, 400);
}

function saveEmailHistory() {
  const obj = {};
  const entries = Array.from(emailHistoryMap.entries()).slice(-300);
  entries.forEach(([k, v]) => { obj[k] = v; });
  chrome.storage.local.set({ emailHistory: obj });
}

// React to keyword changes or explicit history reset
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.keywords) {
    activeKeywords = (changes.keywords.newValue || []).map(k => k.toLowerCase().trim());
    scanInbox(true);
  }

  // If user explicitly cleared history from popup/dashboard, clear local memory map
  if (areaName === 'local' && changes.emailHistory) {
    const newHistory = changes.emailHistory.newValue;
    if (!newHistory || Object.keys(newHistory).length === 0) {
      emailHistoryMap.clear();
    } else {
      Object.entries(newHistory).forEach(([k, v]) => {
        emailHistoryMap.set(k, v);
      });
    }
  }
});

// 3. Message Listener for manual scan & direct email opening
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SCAN_GMAIL_PAGE') {
    const found = scanInbox(true);
    sendResponse({ success: true, count: found.length, items: found });
    return true;
  }

  // Direct Email Opener: click the row in the DOM or route the hash
  if (message.type === 'OPEN_EMAIL_THREAD') {
    const threadId = message.legacyThreadId;
    let targetRow = null;

    if (threadId) {
      targetRow = document.querySelector(`tr[data-legacy-thread-id="${threadId}"], div[data-legacy-thread-id="${threadId}"]`) ||
                  document.querySelector(`[data-thread-id*="${threadId}"]`);
    }

    if (targetRow) {
      // Direct DOM click opens the email immediately with zero reload!
      const clickEl = targetRow.querySelector('.bog, .bqc, .y6, .bA4') || targetRow;
      clickEl.click();
      sendResponse({ opened: true, method: 'dom_click' });
      return true;
    }

    // If not visible in current folder, navigate hash directly
    if (threadId) {
      window.location.hash = `#all/${threadId}`;
      sendResponse({ opened: true, method: 'hash_all' });
      return true;
    }

    if (message.search) {
      window.location.hash = `#search/${encodeURIComponent(message.search)}`;
      sendResponse({ opened: true, method: 'hash_search' });
      return true;
    }

    sendResponse({ opened: false });
    return true;
  }

  return true;
});

// 4. MutationObserver for instant DOM updates as new emails arrive
const observer = new MutationObserver((mutations) => {
  // Ignore mutations originating from our own in-page elements to prevent feedback loops
  const isSelfMutation = mutations.every(m => {
    const el = m.target;
    if (el) {
      if (el.id === 'internship-deck-inpage-banner' || el.id === 'internship-tracker-floating-badge') {
        return true;
      }
      if (el.closest && el.closest('#internship-deck-inpage-banner, #internship-tracker-floating-badge')) {
        return true;
      }
    }
    const nodes = [...(m.addedNodes || []), ...(m.removedNodes || [])];
    if (nodes.length > 0) {
      return nodes.every(n => {
        if (!n) return true;
        if (n.id === 'internship-deck-inpage-banner' || n.id === 'internship-tracker-floating-badge') return true;
        if (n.querySelector && n.querySelector('#internship-deck-inpage-banner, #internship-tracker-floating-badge')) return true;
        return false;
      });
    }
    return false;
  });

  if (isSelfMutation) return;

  clearTimeout(mutationTimeout);
  mutationTimeout = setTimeout(() => {
    scanInbox(false);
  }, 2000);
});

// Observe main email container if available, fallback to body
const observeTarget = document.querySelector('div[role="main"]') || document.body;
observer.observe(observeTarget, {
  childList: true,
  subtree: true
});

// 5. Periodic fallback check every 30 seconds
setInterval(() => {
  scanInbox(false);
}, 30000);

// Initial scan
setTimeout(() => {
  scanInbox(true);
}, 2500);

/**
 * Core Inbox Scanner Function
 */
function scanInbox(isManual = false) {
  const detected = [];

  // Scan all visible email rows once with accurate unread state
  const allRows = document.querySelectorAll('tr.zA, div.zA');
  allRows.forEach(row => {
    const isUnread = row.classList.contains('zE') || !!row.querySelector('.zE');
    processEmailRow(row, detected, isUnread, isManual);
  });

  // Scan opened email view if user is reading one
  scanOpenedEmailView(detected, isManual);

  if (detected.length > 0) {
    console.log(`[Internship Deck] 🎯 Found ${detected.length} opportunities!`);
    updateFloatingBadge(detected.length);
  }

  return detected;
}

/**
 * Get current account Gmail base URL (preserves multi-account u/0, u/1, etc.)
 */
function getGmailBaseUrl() {
  const path = window.location.pathname.replace(/\/$/, '');
  return `${window.location.origin}${path}/`;
}

/**
 * Process a single email table row in Gmail
 */
function processEmailRow(row, detectedList, isUnread, isManual = false) {
  const legacyThreadId = row.getAttribute('data-legacy-thread-id') ||
                         row.getAttribute('data-thread-id')?.replace(/^#thread-[f|a]:/, '') ||
                         row.querySelector('[data-legacy-thread-id]')?.getAttribute('data-legacy-thread-id');

  const lastMessageId = row.getAttribute('data-legacy-last-message-id') ||
                        row.getAttribute('data-legacy-message-id') ||
                        row.querySelector('[data-legacy-last-message-id]')?.getAttribute('data-legacy-last-message-id') ||
                        row.querySelector('[data-legacy-message-id]')?.getAttribute('data-legacy-message-id');

  // Extract Sender / Company
  const senderEl = row.querySelector('.bA4, span[email], .yP');
  const senderText = senderEl ? senderEl.innerText.trim() : 'Company';

  // Extract Subject
  const subjectEl = row.querySelector('.bog, .bqc');
  const subjectText = subjectEl ? subjectEl.innerText.trim() : '';

  // Extract Snippet
  const snippetEl = row.querySelector('.y2');
  const snippetText = snippetEl ? snippetEl.innerText.trim() : '';

  const combinedContent = `${subjectText} ${snippetText}`.toLowerCase();

  // Check if matches keywords
  const matchesKeyword = activeKeywords.some(kw => combinedContent.includes(kw));
  if (!matchesKeyword) return;

  // Check if contains deadline mention or explicit date
  const hasDeadlineHint = DEADLINE_TRIGGERS.some(trig => combinedContent.includes(trig));
  const deadlineInfo = parseDeadlineFromText(`${subjectText} ${snippetText}`);

  // Capture if explicit date found, or if deadline hint exists, or if unread internship alert
  if (deadlineInfo.found || hasDeadlineHint || isUnread) {
    const company = cleanCompanyName(senderText, subjectText);
    const role = extractRoleName(subjectText, snippetText);

    const cleanSubject = subjectText.replace(/[\[\]"']/g, '').replace(/\s+/g, ' ').trim();
    const stateKey = getOpportunityKey(legacyThreadId, company, cleanSubject);
    if (!stateKey) return; // Skip skeleton/empty rows

    const reqInfo = parseRequirementsFromText(`${subjectText} ${snippetText}`, subjectText);
    const gmailBase = getGmailBaseUrl();
    let directUrl = '';
    const safeSearchQuery = `${company} ${cleanSubject}`.slice(0, 50).trim();

    if (legacyThreadId) {
      directUrl = `${gmailBase}#all/${legacyThreadId}`;
    } else {
      directUrl = `${gmailBase}#search/${encodeURIComponent(safeSearchQuery)}`;
    }

    let resolvedDeadline = 'See Email Details';
    if (deadlineInfo.found && deadlineInfo.formatted) {
      resolvedDeadline = deadlineInfo.formatted;
    } else if (hasDeadlineHint) {
      resolvedDeadline = 'Deadline Mentioned (See Email)';
    }

    const normalizedSnippet = snippetText.slice(0, 120).trim();
    const previousState = emailHistoryMap.get(stateKey);

    let shouldNotify = false;
    let isUpdate = false;

    if (isManual) {
      // Manual scan: ALWAYS capture matching opportunity to update UI without push toast
      shouldNotify = false;
    } else if (!previousState) {
      // Brand new opportunity never seen before!
      shouldNotify = true;
    } else {
      // Cooldown check: prevent looping alerts on the same email
      const lastNotified = previousState.lastNotified || 0;
      const cooldownActive = (Date.now() - lastNotified) < NOTIFICATION_COOLDOWN_MS;

      if (!cooldownActive) {
        // Only re-notify if cooldown expired and deadline or message genuinely changed
        const deadlineChanged = resolvedDeadline && 
          !resolvedDeadline.startsWith('See Email') && 
          !resolvedDeadline.startsWith('Deadline Mentioned') && 
          previousState.deadline !== resolvedDeadline;
        const newMsgArrived = lastMessageId && previousState.lastMessageId && previousState.lastMessageId !== lastMessageId;

        if (deadlineChanged || newMsgArrived) {
          shouldNotify = true;
          isUpdate = true;
        }
      }
    }

    const stableId = legacyThreadId ? `gmail-${legacyThreadId}` : `gmail-${stateKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const opportunity = {
      id: stableId,
      legacyThreadId: legacyThreadId || null,
      lastMessageId: lastMessageId || null,
      stateKey: stateKey,
      company,
      role,
      sender: senderText,
      subject: subjectText || cleanSubject,
      cleanSubject,
      snippet: snippetText.slice(0, 240).trim(),
      deadline: resolvedDeadline,
      cgpa: reqInfo.cgpa,
      batch: reqInfo.batch,
      branches: reqInfo.branches,
      requirements: reqInfo.summary,
      rawDeadline: deadlineInfo.raw || '',
      url: directUrl,
      searchWords: safeSearchQuery,
      gmailBase: gmailBase,
      timestamp: Date.now(),
      source: isUpdate ? 'Email Thread Update' : (isUnread ? 'New Unread Email' : 'Gmail Scan')
    };

    // Avoid duplicate additions in the same detectedList array
    if (!detectedList.some(o => (o.stateKey && o.stateKey === opportunity.stateKey) || (o.legacyThreadId && o.legacyThreadId === opportunity.legacyThreadId) || o.id === opportunity.id)) {
      detectedList.push(opportunity);
    }

    // Always update history map so next scan knows this email has been seen
    emailHistoryMap.set(stateKey, {
      snippet: normalizedSnippet,
      deadline: resolvedDeadline,
      lastMessageId: lastMessageId || (previousState ? previousState.lastMessageId : null),
      lastNotified: shouldNotify ? Date.now() : (previousState ? previousState.lastNotified : 0),
      isUnread: isUnread
    });
    debouncedSaveEmailHistory();

    if (shouldNotify) {
      notifyBackground(opportunity);
    }
  }
}

/**
 * Scan opened email body reading pane
 */
function scanOpenedEmailView(detectedList, isManual = false) {
  const bodyEl = document.querySelector('div.a3s.aiL, div.ii.gt');
  if (!bodyEl) return;

  const subjectHeading = document.querySelector('h2.hP');
  const subject = subjectHeading ? subjectHeading.innerText.trim() : document.title;
  const bodyText = bodyEl.innerText;
  const combined = `${subject}\n${bodyText}`.toLowerCase();

  const matchesKeyword = activeKeywords.some(kw => combined.includes(kw));
  if (!matchesKeyword) return;

  const threadMatch = window.location.href.match(/#(?:all|inbox|sent|trash|starred|spam|search\/[^/]+)\/([a-zA-Z0-9_-]+)/);
  const legacyThreadId = threadMatch ? threadMatch[1] : null;

  const hasDeadlineHint = DEADLINE_TRIGGERS.some(trig => combined.includes(trig));
  const deadlineInfo = parseDeadlineFromText(`${subject}\n${bodyText}`);
  const reqInfo = parseRequirementsFromText(`${subject}\n${bodyText}`, subject);

  if (deadlineInfo.found || hasDeadlineHint) {
    const senderEl = document.querySelector('span.gD, span[email]');
    const senderText = senderEl ? senderEl.innerText.trim() : 'Recruiter';
    const company = cleanCompanyName(senderText, subject);
    const role = extractRoleName(subject, bodyText.slice(0, 160));

    let openedUrl = window.location.href;
    const cleanSubject = subject.replace(/[\[\]"']/g, '').replace(/\s+/g, ' ').trim();
    const gmailBase = getGmailBaseUrl();
    const safeSearchQuery = `${company} ${cleanSubject}`.slice(0, 50).trim();

    if (!openedUrl.includes('/#inbox/') && !openedUrl.includes('/#all/')) {
      openedUrl = `${gmailBase}#search/${encodeURIComponent(safeSearchQuery)}`;
    }

    let resolvedDeadline = 'See Email Details';
    if (deadlineInfo.found && deadlineInfo.formatted) {
      resolvedDeadline = deadlineInfo.formatted;
    } else if (hasDeadlineHint) {
      resolvedDeadline = 'Deadline Mentioned (See Email)';
    }

    const stateKey = getOpportunityKey(legacyThreadId, company, cleanSubject);
    if (!stateKey) return;

    const normalizedSnippet = bodyText.slice(0, 120).trim();
    const previousState = emailHistoryMap.get(stateKey);

    let shouldNotify = false;
    let isUpdate = false;

    if (isManual) {
      shouldNotify = false;
    } else if (!previousState) {
      shouldNotify = true;
    } else {
      const lastNotified = previousState.lastNotified || 0;
      const cooldownActive = (Date.now() - lastNotified) < NOTIFICATION_COOLDOWN_MS;

      if (!cooldownActive) {
        const deadlineChanged = resolvedDeadline && 
          !resolvedDeadline.startsWith('See Email') && 
          !resolvedDeadline.startsWith('Deadline Mentioned') && 
          previousState.deadline !== resolvedDeadline;

        if (deadlineChanged) {
          shouldNotify = true;
          isUpdate = true;
        }
      }
    }

    const stableId = legacyThreadId ? `open-${legacyThreadId}` : `open-${stateKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const opportunity = {
      id: stableId,
      legacyThreadId: legacyThreadId,
      stateKey: stateKey,
      company,
      role,
      sender: senderText,
      subject: subject,
      cleanSubject,
      snippet: bodyText.slice(0, 240).trim(),
      deadline: resolvedDeadline,
      cgpa: reqInfo.cgpa,
      batch: reqInfo.batch,
      branches: reqInfo.branches,
      requirements: reqInfo.summary,
      rawDeadline: deadlineInfo.raw || '',
      url: openedUrl,
      searchWords: safeSearchQuery,
      gmailBase: gmailBase,
      timestamp: Date.now(),
      source: isUpdate ? 'Email Thread Update' : 'Opened Email'
    };

    if (!detectedList.some(o => (o.stateKey && o.stateKey === opportunity.stateKey) || (o.legacyThreadId && o.legacyThreadId === opportunity.legacyThreadId) || o.id === opportunity.id)) {
      detectedList.push(opportunity);
    }

    // Always update history map
    emailHistoryMap.set(stateKey, {
      snippet: normalizedSnippet,
      deadline: resolvedDeadline,
      lastMessageId: (previousState ? previousState.lastMessageId : null),
      lastNotified: shouldNotify ? Date.now() : (previousState ? previousState.lastNotified : 0),
      isUnread: false
    });
    debouncedSaveEmailHistory();

    if (shouldNotify) {
      notifyBackground(opportunity);
    }
  }
}

/**
 * Client-Side Regex Parser
 */
function parseDeadlineFromText(text) {
  const months = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  const day = '\\b(?:[1-9]|[12][0-9]|3[01])(?:st|nd|rd|th)?\\b';
  const year = '\\b(?:20\\d{2})\\b';
  const time = '(?:(?:at|by|before)\\s+)?(?:1[0-2]|0?[1-9])(?::[0-5][0-9])?\\s*(?:AM|PM|am|pm)?|(?:midnight|EOD|end of day)';

  // Pattern A: Trigger + Date
  const triggerPattern = new RegExp(
    `(?:deadline|apply\\s+by|closes\\s+on|applications?\\s+close|due\\s+date|last\\s+date|cutoff|submit\\s+by|expires\\s+on)[\\s:–—-]+(?:(?:is|on|by)\\s+)?` +
    `((?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?,?\\s*)?(?:${months}\\.?\\s+${day}|${day}\\s+(?:of\\s+)?${months}\\.?)(?:,?\\s+${year})?(?:\\s+${time})?)`,
    'i'
  );

  const match = triggerPattern.exec(text);
  if (match && match[1]) {
    const raw = match[1].trim();
    return {
      found: true,
      raw: raw,
      formatted: raw.replace(/[\.\s]+$/, '').trim()
    };
  }

  // Pattern B: Numeric: "deadline: 10/25/2026"
  const numericPattern = new RegExp(
    `(?:deadline|apply\\s+by|due\\s+date)[\\s:–—-]+(\\b\\d{1,4}[/-]\\d{1,2}[/-]\\d{2,4}\\b)`,
    'i'
  );
  const numMatch = numericPattern.exec(text);
  if (numMatch && numMatch[1]) {
    return {
      found: true,
      raw: numMatch[1].trim(),
      formatted: numMatch[1].trim()
    };
  }

  return { found: false };
}

/**
 * Intelligent Requirements & CGPA Parser (Client-Side)
 */
function parseRequirementsFromText(emailBody = '', subject = '') {
  const combined = `${subject}\n\n${emailBody}`.replace(/<[^>]+>/g, ' ');

  let cgpa = null;
  let batch = null;
  let branches = null;
  let backlogs = null;
  let generalReq = null;

  // 1. CGPA / GPA / Aggregate Extractor
  const cgpaPatterns = [
    /\b(?:min(?:imum)?\s+)?(?:cgpa|gpa)\s*(?:is|of|:|>=|=>|>|=|-|–)?\s*([0-9]+(?:\.[0-9]+)?(?:\s*\/\s*(?:10|4)(?:\.0)?)?(?:\s*(?:\+|and\s+above|or\s+above|and\s+more))?)\b/i,
    /\b([0-9]+(?:\.[0-9]+)?(?:\s*\/\s*(?:10|4)(?:\.0)?)?(?:\s*(?:\+|and\s+above|or\s+above))?)\s*(?:cgpa|gpa)\b/i,
    /\b(?:cut-?off|criteria|eligibility)(?:[^\n\r.:]{0,35})?(?:cgpa|gpa)\s*[:–-]?\s*([0-9]+(?:\.[0-9]+)?\+?)/i,
    /\b(?:min(?:imum)?\s+)?(?:percentage|marks|aggregate)\s*(?:is|of|:|>=|=>|>|=|-|–)?\s*([0-9]{2}(?:\.[0-9]+)?%?(?:\s*(?:\+|and\s+above|or\s+above))?)/i
  ];

  for (const pat of cgpaPatterns) {
    const m = combined.match(pat);
    if (m && m[1]) {
      const val = m[1].trim();
      const num = parseFloat(val);
      if (!isNaN(num) && ((num >= 2.0 && num <= 10.0) || (num >= 50 && num <= 100))) {
        if (/gpa/i.test(m[0]) && !/cgpa/i.test(m[0])) {
          cgpa = `${val.replace(/\s+/g, ' ')} GPA`;
        } else if (num >= 50) {
          cgpa = `${val.replace(/\s+/g, ' ')} Aggregate`;
        } else {
          cgpa = `${val.replace(/\s+/g, ' ')} CGPA`;
        }
        break;
      }
    }
  }

  // 2. Batch / Graduating Year Extractor
  const batchPatterns = [
    /\b(?:batch(?:\s+of)?|graduating(?:\s+in)?|class\s+of|passout)\s*[:–-]?\s*(202[4-9](?:\s*[-/&,]\s*202[4-9])?)\b/i,
    /\b(202[4-9])\s+(?:batch|passout|graduates?)\b/i
  ];

  for (const pat of batchPatterns) {
    const m = combined.match(pat);
    if (m && m[1]) {
      batch = m[1].trim() + ' Batch';
      break;
    }
  }

  // 3. Branches / Degrees Extractor
  const branchList = [];
  const degreeMatch = combined.match(/\b(B\.?Tech|B\.?E\.?|M\.?Tech|M\.?E\.?|MCA|M\.?S\.?|B\.?S\.?|Dual\s+Degree)\b/i);
  if (degreeMatch) {
    branchList.push(degreeMatch[0].trim());
  }

  const specMatch = combined.match(/\b(CSE|IT|ECE|EEE|AI[/\\]?ML|Data\s+Science|Circuit\s+Branches|CS\s+and\s+IT|Computer\s+Science|Software\s+Engineering)\b/i);
  if (specMatch) {
    branchList.push(specMatch[0].trim());
  }
  if (branchList.length > 0) {
    branches = branchList.join(' - ');
  }

  // 4. Backlogs / Arrears Extractor
  if (/\b(?:no\s+(?:active\s+)?(?:backlogs?|arrears?|standing\s+arrears?)|0\s+(?:active\s+)?backlogs?)\b/i.test(combined)) {
    backlogs = 'No Active Backlogs';
  }

  // 5. General Requirements / Eligibility Snippet Extractor
  const reqLineMatch = combined.match(/(?:eligibility|requirements|criteria|qualification)s?\s*[:–-]\s*([^\n\r.]{10,120})/i);
  if (reqLineMatch && reqLineMatch[1]) {
    generalReq = reqLineMatch[1].trim();
  }

  // 6. Build concise, human-readable summary
  const summaryParts = [];
  if (cgpa) summaryParts.push(cgpa);
  if (batch) summaryParts.push(batch);
  if (branches) summaryParts.push(branches);
  if (backlogs) summaryParts.push(backlogs);

  let formattedSummary = summaryParts.join(' • ');
  if (!formattedSummary) {
    if (generalReq) {
      formattedSummary = generalReq;
    } else {
      formattedSummary = 'Check email for specific criteria';
    }
  }

  return {
    found: !!(cgpa || batch || branches || generalReq),
    cgpa: cgpa || 'Not specified',
    batch: batch || 'Not specified',
    branches: branches || 'All eligible streams',
    backlogs: backlogs || null,
    generalReq: generalReq || null,
    summary: formattedSummary
  };
}

/**
 * Intelligent Company Name Extractor with ATS Support
 */
function cleanCompanyName(sender, subject) {
  // 1. Check brackets: "[Netflix] Software Engineering..." or "(Palantir) Internship..."
  const bracketMatch = subject.match(/[\[\(]([a-zA-Z0-9\s&.-]{2,30})[\]\)]/);
  if (bracketMatch && !/intern|update|application|job|reminder|fellowship/i.test(bracketMatch[1])) {
    return bracketMatch[1].trim();
  }

  // 2. Check prefix before dash or colon: "Spotify: Application Received" or "Tesla - Careers"
  const prefixMatch = subject.match(/^([a-zA-Z0-9\s&.]{2,25})\s*[:–—|-]\s+/);
  if (prefixMatch && !/re|fwd|your|update|internship|intern|application|status/i.test(prefixMatch[1])) {
    return prefixMatch[1].trim();
  }

  let name = sender.replace(/<[^>]+>/g, '').trim();
  const atsPlatforms = ['greenhouse', 'lever', 'myworkday', 'workday', 'ashby', 'ashbyhq', 'taleo', 'smartrecruiters', 'handshake', 'ripplematch', 'jobvite', 'icims', 'brassring'];

  // Clean noise terms
  name = name.replace(/(Careers|Recruiting|Talent|Team|University Programs|Internships|Jobs|HR|People Team|Global Recruiting)/gi, '').trim();

  const isAts = atsPlatforms.some(ats => name.toLowerCase().includes(ats));
  if (isAts) {
    const atCompanyMatch = subject.match(/(?:at|with|@)\s+([A-Z][a-zA-Z0-9&.\s]{1,20})/);
    if (atCompanyMatch) return atCompanyMatch[1].trim();
  }

  if (name && !isAts && name.length >= 2) {
    return name;
  }

  // Extract from domain
  const domainMatch = sender.match(/@([a-zA-Z0-9.-]+)\./);
  if (domainMatch && domainMatch[1] && !['gmail', 'googlemail', 'yahoo', 'outlook', 'hotmail', ...atsPlatforms].includes(domainMatch[1].toLowerCase())) {
    return domainMatch[1].charAt(0).toUpperCase() + domainMatch[1].slice(1);
  }

  return name || 'Company';
}

function extractRoleName(subject, text) {
  const roleRegex = /(?:software\s+engine(?:er(?:ing)?)?|frontend|backend|fullstack|data\s+scien(?:ce|tist)|machine\s+learning|ai|product\s+manag(?:er|ement)|ui\/ux|design|cyber\s*security|cloud|marketing|sales|business|research|analyst)?\s*(?:intern(?:ship)?|co-?op)/i;
  const match = subject.match(roleRegex) || text.match(roleRegex);
  if (match) {
    return match[0].trim().replace(/\b\w/g, l => l.toUpperCase());
  }
  return subject.length > 42 ? subject.slice(0, 39) + '...' : (subject || 'Internship Opportunity');
}

/**
 * Dispatch message to background service worker
 */
function notifyBackground(item) {
  try {
    chrome.runtime.sendMessage({
      type: 'IN_BROWSER_OPPORTUNITY_FOUND',
      data: item
    });
  } catch (e) {
    console.warn('[Internship Deck] Background notify error:', e);
  }
}

/**
 * Floating badge on bottom-right of Gmail
 */
function updateFloatingBadge(count) {
  if (floatingBadge) {
    const countEl = document.getElementById('it-widget-count');
    if (countEl) countEl.textContent = count;
    return;
  }

  floatingBadge = document.createElement('div');
  floatingBadge.id = 'internship-tracker-floating-badge';
  floatingBadge.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 999999;
    background: linear-gradient(135deg, #4f46e5 0%, #7e22ce 100%);
    color: white;
    padding: 10px 18px;
    border-radius: 9999px;
    box-shadow: 0 10px 25px -5px rgba(79, 70, 229, 0.45);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
  `;

  floatingBadge.innerHTML = `
    <span style="font-size: 16px;">🎯</span>
    <span><span id="it-widget-count">${count}</span> Deadline${count === 1 ? '' : 's'} Tracked</span>
    <span style="background: rgba(255,255,255,0.25); border-radius: 9999px; padding: 2px 10px; font-size: 11px;">View Pop-up</span>
  `;

  floatingBadge.addEventListener('mouseenter', () => {
    floatingBadge.style.transform = 'translateY(-2px) scale(1.02)';
  });
  floatingBadge.addEventListener('mouseleave', () => {
    floatingBadge.style.transform = 'translateY(0) scale(1)';
  });

  floatingBadge.addEventListener('click', () => {
    scanInbox(true);
  });

  document.body.appendChild(floatingBadge);
}
})();

