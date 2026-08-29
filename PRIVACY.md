# Employee Privacy & Data Transparency Guide (WorkTrackPro)

This document describes the privacy rights, data collection transparency, consent controls, and data retention policies for all employees using **WorkTrackPro**.

---

## 1. What Data Is Collected & Why

WorkTrackPro is designed with **100% Employee Self-Visibility**. The platform collects data exclusively during active, checked-in work sessions and configured working hours for supervisor auditing and team productivity tracking:

1. **Full Desktop Screen Captures**:
   - Captured automatically at randomized 5 to 15-minute intervals during active work shifts.
   - **Excluded Applications**: Applications specified in your organization's policy (e.g. `1Password`, `KeePass`, `Bitwarden`, or banking software) are automatically excluded from capture.
2. **Active Application & Window Titles**:
   - Logs application focus names and window headers to compute shift productivity metrics.
3. **Work Session & Idle Time**:
   - Tracks active vs idle keyboard/mouse time. System idle time exceeding 60 seconds is logged as `IDLE_STARTED`.
4. **Short Video Clips (Optional)**:
   - On-demand 15–30 second video recordings triggered manually by authorized managers or specific policy events.

---

## 2. Who Can View Your Data

Your captured screenshots, activity events, and session metrics can be viewed **ONLY** by:

- **You (The Employee)**: Access your own gallery and activity timeline at any time via the Employee Portal.
- **Your Designated Organization Managers & Supervisors**.
- **System Administrators**.

No unauthorized third parties or unassigned managers have access to your data.

---

## 3. Mandatory Consent Policy (v1.0.0)

Before any desktop monitoring or screen capture begins:
- A full-screen, non-dismissable **Consent Modal** is displayed on first launch.
- You must review the policy version, data collection scope, retention period, and privacy rights.
- Server-side consent records are logged with your user ID, policy version, timestamp, and IP address.
- If the organization updates the monitoring policy version, a new consent prompt will be presented on next launch.

---

## 4. Pause / Blackout Control (Section 2.3)

You retain control over your personal moments during work shifts:
- Click **"Pause Monitoring"** in the top banner or system tray to take a break or make a personal phone call.
- **While Paused**:
  - NO screenshots are taken.
  - NO video clips are recorded.
  - NO live streams are transmitted.
- **Auto-Resume**: Pause auto-resumes after 15 minutes (with an in-app nudge allowing you to resume or extend).
- Duration is logged as `PAUSED` so full-day gaps do not occur without a record.

---

## 5. Automated Data Retention & Deletion (60 Days)

- All screenshots, activity logs, and video recordings are retained for a maximum of **60 days**.
- Scheduled **BullMQ retention background jobs** automatically purge files and database records older than 60 days.
- Audit logs track all data purges and viewing events.

---

## 6. Support & Privacy Questions

If you have questions regarding your data privacy rights, contact your organization's Human Resources department or System Administrator.
