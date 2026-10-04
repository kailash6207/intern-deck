/**
 * Content Extraction & Parsing Utility
 * Robust Regex and lightweight NLP heuristics for parsing internship emails,
 * extracting application deadlines, dates, times, roles, and company names.
 */

// Date components
const MONTHS_PATTERN = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DAY_NUM_PATTERN = '\\b(?:[1-9]|[12][0-9]|3[01])(?:st|nd|rd|th)?\\b';
const YEAR_PATTERN = '\\b(?:20\\d{2}|19\\d{2})\\b';
const TIME_PATTERN = '(?:(?:at|by|before)\\s+)?(?:1[0-2]|0?[1-9])(?::[0-5][0-9])?\\s*(?:AM|PM|am|pm)(?:\\s*(?:EST|PST|CST|MST|EDT|PDT|CDT|MDT|UTC|GMT|IST|[A-Z]{3}))?|(?:(?:at|by|before)\\s+)?(?:2[0-3]|[01]?[0-9]):[0-5][0-9](?:\\s*(?:EST|PST|CST|MST|UTC|GMT|IST|[A-Z]{3}))?|midnight|EOD|end of day';

// Deadline trigger phrases
const DEADLINE_TRIGGERS = [
  /application\s+deadline(?:\s+is|\s*:|\s*[-–—]|\s+for\s+applications)?/i,
  /submission\s+deadline(?:\s+is|\s*:|\s*[-–—])?/i,
  /deadline(?:\s+to\s+apply|\s+is|\s*:|\s*[-–—])?/i,
  /apply\s+(?:by|before|no\s+later\s+than)/i,
  /applications?\s+close(?:s)?(?:\s+(?:on|by|at))?/i,
  /closing\s+date(?:\s+is|\s*:|\s*[-–—])?/i,
  /closes\s+(?:on|by|at)/i,
  /due\s+date(?:\s+is|\s*:|\s*[-–—])?/i,
  /last\s+date\s+(?:to\s+apply|of\s+submission|for\s+applications)?/i,
  /cutoff\s+date(?:\s+is|\s*:|\s*[-–—])?/i,
  /must\s+be\s+submitted\s+by/i,
  /accepting\s+applications\s+until/i
];

/**
 * Strips HTML tags and decodes common HTML entities
 */
export function cleanHtml(rawText) {
  if (!rawText) return '';
  return rawText
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Recursively decodes Gmail API message payload into plain text.
 */
export function decodeGmailPayload(payload) {
  if (!payload) return '';

  let textPlain = '';
  let textHtml = '';

  function traverseParts(part) {
    if (!part) return;

    if (part.mimeType === 'text/plain' && part.body && part.body.data) {
      textPlain += decodeBase64Url(part.body.data) + '\n';
    } else if (part.mimeType === 'text/html' && part.body && part.body.data) {
      textHtml += decodeBase64Url(part.body.data) + '\n';
    }

    if (part.parts && Array.isArray(part.parts)) {
      for (const subPart of part.parts) {
        traverseParts(subPart);
      }
    }
  }

  if (payload.body && payload.body.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === 'text/html') {
      textHtml += decoded;
    } else {
      textPlain += decoded;
    }
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      traverseParts(part);
    }
  }

  if (textPlain.trim()) {
    return textPlain;
  }

  return cleanHtml(textHtml);
}

/**
 * Decodes Gmail base64url-encoded string (RFC 4648) with UTF-8 support.
 */
export function decodeBase64Url(base64UrlStr) {
  if (!base64UrlStr) return '';
  try {
    const base64 = base64UrlStr.replace(/-/g, '+').replace(/_/g, '/');
    const binaryStr = atob(base64);
    const bytes = Uint8Array.from(binaryStr, c => c.charCodeAt(0));
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
  } catch (err) {
    console.error('Base64 decode error:', err);
    try {
      return atob(base64UrlStr.replace(/-/g, '+').replace(/_/g, '/'));
    } catch {
      return '';
    }
  }
}

/**
 * Searches text for explicit deadline triggers and parses the date/time.
 * Returns an object: { found: boolean, rawDeadline: string, formattedDeadline: string, context: string }
 */
export function extractDeadline(emailBody, subject = '') {
  const combinedText = `${subject}\n\n${emailBody}`;
  const cleanContent = cleanHtml(combinedText);

  // Strategy 1: Targeted trigger phrases
  for (const triggerRegex of DEADLINE_TRIGGERS) {
    const match = triggerRegex.exec(cleanContent);
    if (match) {
      const matchIndex = match.index;
      // Examine a window of up to 120 characters after the trigger
      const windowStart = matchIndex;
      const windowEnd = Math.min(cleanContent.length, matchIndex + match[0].length + 120);
      const contextWindow = cleanContent.substring(windowStart, windowEnd);

      const parsedDate = parseDateFromWindow(contextWindow.substring(match[0].length));
      if (parsedDate) {
        return {
          found: true,
          trigger: match[0].trim(),
          rawDeadline: parsedDate.raw,
          formattedDeadline: parsedDate.formatted,
          snippet: contextWindow.trim()
        };
      }
    }
  }

  // Strategy 2: Fallback scan for sentences containing "deadline" or "due"
  const lines = cleanContent.split(/[\r\n.]+/);
  for (const line of lines) {
    if (/\b(?:deadline|due|closes|closing|cutoff)\b/i.test(line)) {
      const parsedDate = parseDateFromWindow(line);
      if (parsedDate) {
        return {
          found: true,
          trigger: 'Context match',
          rawDeadline: parsedDate.raw,
          formattedDeadline: parsedDate.formatted,
          snippet: line.trim()
        };
      }
    }
  }

  return { found: false, rawDeadline: null, formattedDeadline: null, snippet: null };
}

/**
 * Parses date patterns from a candidate text segment, picking the best and closest match.
 */
function parseDateFromWindow(textSegment) {
  if (!textSegment) return null;

  // Day first: "15th November 2026", "15 Oct 2026 5:00 PM"
  const patternDayFirst = new RegExp(
    `(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?,?\\s*)?` +
    `(${DAY_NUM_PATTERN})\\s+(?:of\\s+)?(${MONTHS_PATTERN})\\.?(?:,?\\s+(${YEAR_PATTERN}))?` +
    `(?:\\s+(?:at|by|before|,)\\s+(${TIME_PATTERN}))?`,
    'i'
  );

  // Month first: "October 15, 2026", "Oct 15th", "October 15 at 11:59 PM"
  const patternMonthFirst = new RegExp(
    `(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?,?\\s*)?` +
    `(${MONTHS_PATTERN})\\.?\\s+(${DAY_NUM_PATTERN})(?:,?\\s+(${YEAR_PATTERN}))?` +
    `(?:\\s+(?:at|by|before|,)\\s+(${TIME_PATTERN}))?`,
    'i'
  );

  // Numeric formats: MM/DD/YYYY or DD/MM/YYYY or YYYY-MM-DD
  const patternNumeric = new RegExp(
    `(\\b\\d{1,4}[/-]\\d{1,2}[/-]\\d{2,4}\\b)(?:\\s+(?:at|by|before|,)?\\s*(${TIME_PATTERN}))?`,
    'i'
  );

  // Relative keywords: "tomorrow at 5 PM", "this Friday at midnight"
  const patternRelative = new RegExp(
    `\\b(today|tomorrow|this\\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|next\\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|end\\s+of\\s+(?:this\\s+)?week)\\b(?:\\s+(?:at|by|,)?\\s*(${TIME_PATTERN}))?`,
    'i'
  );

  const patterns = [patternDayFirst, patternMonthFirst, patternNumeric, patternRelative];
  let bestMatch = null;

  for (const pat of patterns) {
    const m = pat.exec(textSegment);
    if (m) {
      if (!bestMatch || m.index < bestMatch.index || (m.index === bestMatch.index && m[0].length > bestMatch[0].length)) {
        bestMatch = m;
      }
    }
  }

  if (bestMatch) {
    const raw = bestMatch[0].trim();
    return { raw, formatted: cleanFoundDate(raw) };
  }

  return null;
}

/**
 * Clean and normalize the extracted date string
 */
function cleanFoundDate(str) {
  return str
    .replace(/^[:\s\-–—,]+/, '')
    .replace(/[\.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts Company Name and Role from Email Headers & Subject
 */
export function extractRoleAndCompany(headers = [], subject = '', snippet = '') {
  let fromHeader = '';

  for (const h of headers) {
    if (h.name.toLowerCase() === 'from') {
      fromHeader = h.value;
      break;
    }
  }

  // 1. Company Name extraction
  let company = 'Company';
  if (fromHeader) {
    // "Google Careers <careers@google.com>" -> "Google Careers"
    const nameMatch = fromHeader.match(/^"?([^"<]+)"?\s*</);
    if (nameMatch && nameMatch[1].trim()) {
      company = nameMatch[1].trim();
    } else {
      // Extract domain: "jobs@stripe.com" -> "Stripe"
      const domainMatch = fromHeader.match(/@([a-zA-Z0-9.-]+)\./);
      if (domainMatch && domainMatch[1] && !['gmail', 'yahoo', 'outlook', 'hotmail'].includes(domainMatch[1])) {
        company = domainMatch[1].charAt(0).toUpperCase() + domainMatch[1].slice(1);
      }
    }
  }

  // Check if subject has [Company] prefix, e.g. "[Meta] Internship Application Update"
  const bracketMatch = subject.match(/\[([a-zA-Z0-9\s&.-]{2,30})\]/);
  if (bracketMatch) {
    company = bracketMatch[1].trim();
  }

  // 2. Role extraction
  let role = 'Internship Opportunity';
  const roleRegex = /(?:software\s+engine(?:er(?:ing)?)?|frontend|backend|fullstack|data\s+scien(?:ce|tist)|machine\s+learning|ai|product\s+manag(?:er|ement)|ui\/ux|design|cyber\s*security|cloud|marketing|sales|business|research|analyst)?\s*(?:intern(?:ship)?|co-?op)/i;

  const subjectRoleMatch = subject.match(roleRegex);
  if (subjectRoleMatch) {
    role = subjectRoleMatch[0].trim();
    // Capitalize words
    role = role.replace(/\b\w/g, l => l.toUpperCase());
  } else {
    // Try in snippet/body
    const snippetMatch = snippet.match(roleRegex);
    if (snippetMatch) {
      role = snippetMatch[0].trim().replace(/\b\w/g, l => l.toUpperCase());
    } else if (subject.trim()) {
      // Trim subject if reasonably short
      role = subject.length > 50 ? subject.substring(0, 47) + '...' : subject;
    }
  }

  return { company, role };
}

/**
 * Extracts Requirements such as CGPA, GPA, Target Batch, Degrees, Branches, and Eligibility
 */
export function extractRequirements(emailBody = '', subject = '') {
  const combined = cleanHtml(`${subject}\n\n${emailBody}`);

  let cgpa = null;
  let batch = null;
  let branches = null;
  let backlogs = null;
  let generalReq = null;

  // 1. CGPA / GPA / Percentage Extractor
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
