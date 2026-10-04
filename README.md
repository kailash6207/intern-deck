# 🎯 Intern Deck — Smart Gmail Internship Deadline & Eligibility Tracker

> **Intern Deck** is a 100% free, privacy-first Chrome Extension (Manifest V3) that tracks internship opportunities, application deadlines, CGPA cutoffs, and eligibility criteria from your Gmail inbox with **Zero Mandatory Cloud Setup**, instant desktop push notifications, a full **Glassmorphism Kanban Dashboard**, and **1-Click Calendar Sync**.

Inspired by the user-friendly design of **Tab Deck**.

---

## ✨ What Makes It Free & User-Friendly?

| Feature | Standard Complex API Extensions | 🎯 Intern Deck (Our Approach) |
|---|---|---|
| **Setup Barrier** | Requires Google Cloud project, OAuth consent screens, test users, and client IDs | **⚡ Zero-Setup Mode**: Works instantly with your open Gmail tab! No Google Cloud needed. |
| **All-in-One Notifications** | Just generic subject line | **🎓 Instant Details**: Company name, exact deadline, and CGPA/eligibility directly in the push alert! |
| **Pricing** | Subscription / Paid API keys | **100% Free Forever & Open-Source** |
| **Interface** | Tiny cramped popup | **Full Screen Glassmorphism Dashboard** (`dashboard.html`) + Compact Popup |
| **Calendar Sync** | Complex Google API permissions | **1-Click `.ics` Export & Direct Google Calendar Link** |
| **Testing** | Must wait for real emails | **🧪 Pre-loaded Realistic Demo Data** (Google, Stripe, Microsoft, OpenAI) |
| **Sound Feedback** | None | **Relaxing Procedural Audio Chime** (Web Audio API, runs offline) |
| **Urgency Kanban** | Plain text list | **Color-coded Urgency Columns**: 🔴 Urgent (< 48h), 🟡 This Week (< 7d), 🟢 Future, ✅ Applied |

---

## 🚀 Two Flexible Modes

### 1. ⚡ Zero-Setup Mode (Default — 100% Free & Instant)
- Whenever you open `mail.google.com` in Chrome, the lightweight in-browser content script scans your unread rows and opened emails.
- Extracts company name, role, deadline date, and eligibility criteria (CGPA, Batch, Branch, Backlog rules).
- Shows a non-intrusive floating badge: `"🎯 3 Internship Deadlines Tracked"`.
- Click **"Scan Open Gmail Tab"** in the popup or dashboard anytime for an instant scan.
- **Zero API keys, zero Google Cloud setup, zero configuration.**

### 2. ☁️ Google Cloud API Mode (Optional — 24/7 Background Polling)
- For power users who want background polling every 15 minutes even when Gmail and Chrome tabs are closed.
- Paste your Client ID directly into the in-dashboard **Settings (⚙️)** modal.

---

## 📁 Project Structure

```
intern-deck/
├── manifest.json              # Manifest V3 configuration, permissions & options page
├── background.js              # Service worker (alarms, notifications, Gmail API, tab messaging)
├── content.js                 # In-browser zero-setup Gmail scanner with CGPA parser
├── popup.html                 # Clean popup UI with quick scan & dashboard link
├── popup.js                   # Popup controller & storage sync
├── popup.css                  # Standalone Tailwind utility stylesheet
├── dashboard.html             # Full-screen Glassmorphism application dashboard
├── dashboard.js               # Urgency Kanban, search, calendar export & Web Audio chime
├── dashboard.css              # Dark/Light Glassmorphism design system
├── utils/
│   └── extractor.js           # Multi-pattern regex & heuristic date/time/CGPA extractor
├── icons/
│   ├── icon16.png             # Extension toolbar icon (16x16)
│   ├── icon48.png             # Chrome management icon (48x48)
│   └── icon128.png            # Notification & store icon (128x128)
├── create-icons.js            # Node script for PNG icon generation
├── test-extractor.js          # Unit tests verifying extraction accuracy
└── README.md                  # Complete documentation
```

---

## 🛠️ Quick Installation

1. Clone or download the repository:
   ```bash
   git clone https://github.com/kailash6207/intern-deck.git
   ```
2. Open Google Chrome and go to `chrome://extensions/`.
3. Toggle on **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the cloned directory.
5. Pin the **Intern Deck** icon to your toolbar!

---

## 🎮 How to Use

### 1. Automatic Live Monitoring (Hands-Free)
- Simply open and use Gmail (`mail.google.com`) as usual.
- Whenever you receive or view an internship email with an application deadline:
  - **Desktop Push Notification**: Instantly alerts you with the **Company Name**, **Deadline Date/Time**, and **Eligibility Criteria** (such as CGPA cutoff, Graduating Batch, and Branch).
  - **In-Page Floating Banner**: Highlights key criteria directly inside the Gmail tab.
  - You never even need to open the email to know if you're eligible!

### 2. Manual Gmail Scan
- Open your Gmail tab.
- Click the **Intern Deck** toolbar icon and click **"Scan Open Gmail Tab"** (or click **"🔄 Scan Gmail"** in the dashboard).
- Any detected opportunities will be parsed and organized into your Kanban columns.

### 3. Open the Interactive Dashboard
- Right-click the extension icon and select **Options**, or click the **"Dashboard ↗"** button in the popup.
- View your opportunities across 3 layout views:
  - **Kanban Board**: Color-coded by urgency — 🔴 Urgent (< 48h), 🟡 Approaching (< 7d), 🟢 Future, and ✅ Applied.
  - **Timeline Schedule**: Chronological listing of upcoming deadlines.
  - **Spreadsheet Table**: Sortable table with dedicated eligibility and CGPA columns.

### 4. 1-Click Calendar Sync
- Click **"📅 Cal"** on any opportunity card to open Google Calendar with pre-filled title, deadline, eligibility details, and application link.
- Or click **"Export Calendar (.ics)"** to download an `.ics` file compatible with Apple Calendar, Outlook, and Google Calendar.

### 5. Track Application Progress
- Click **"✅ Mark Applied"** on any card to move it into your Applied/Interviewing column.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — see the [`LICENSE`](LICENSE) file for details.
