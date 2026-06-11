# Add-on test checklist

Serve this folder over HTTP:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`.

## Original planner

- Open and close the cover.
- Add, complete, edit reminders for, and delete a to-do.
- Add a calendar event and class.
- Edit goals and notebook notes.
- Draw, undo, save, and clear a doodle.
- Reload and confirm all existing data remains.
- Export and import the existing JSON backup.

## Optional add-ons

- **Guest mode:** Leave Firebase placeholders unchanged. Confirm all local features
  work and the header says `local only`.
- **Authentication:** Configure Firebase, then test Google, email registration,
  email sign-in, sign-out, and the small signed-in header label.
- **Cloud sync:** Sign in, add data, wait for `cloud saved`, then sign in from a
  second browser. Confirm the cloud copy loads. Make changes in both browsers
  before refreshing and confirm the conflict chooser appears.
- **PDF:** Click `PDF` in the footer. Confirm the print preview contains to-dos,
  schedule entries, and notebook notes.
- **Recurring tasks:** Choose daily, weekly, or monthly before adding a task.
  Complete it once and confirm exactly one next occurrence is created.
- **Study & habit section:** Open the dedicated Trackers tab and confirm both
  trackers appear together in one pastel card.
- **Study tracker:** Log subject, date, minutes, and notes. Confirm the current
  week's minutes total updates.
- **Habit tracker:** Add a habit and check days in the current week. Confirm
  checkmarks persist and the streak updates.
- **Rewards:** Complete an unfinished task or habit day. Confirm a small,
  non-blocking star message appears.
- **Failure fallback:** Block Firebase requests or go offline. Confirm all
  planner features continue saving to localStorage.
