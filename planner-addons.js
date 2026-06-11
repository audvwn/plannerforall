(() => {
const ADDON_KEYS = {
  study: "planner_study_log",
  habits: "planner_habits",
  rewards: "planner_rewards",
  syncMeta: "planner_cloud_meta"
};

const parse = (key, fallback) => {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
};
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const uid = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const today = () => new Date().toISOString().slice(0, 10);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

let firebase = null;
let currentUser = null;
let syncTimer = null;
let applyingCloud = false;

function configuredFirebase() {
  const c = window.PLANNER_FIREBASE_CONFIG || {};
  return c.apiKey && !String(c.apiKey).startsWith("YOUR_");
}

function plannerKeys() {
  return Object.keys(localStorage).filter(k =>
    k.startsWith("planner_") && !["planner_cloud_meta"].includes(k)
  );
}

function snapshotLocal() {
  const values = {};
  plannerKeys().forEach(key => { values[key] = localStorage.getItem(key); });
  return { schema: 2, updatedAt: Date.now(), values };
}

function localHasPlannerData() {
  return plannerKeys().some(k => {
    const value = localStorage.getItem(k);
    return value && value !== "[]" && value !== "{}" && value !== '""';
  });
}

function applySnapshot(snapshot) {
  if (!snapshot?.values) return;
  applyingCloud = true;
  Object.entries(snapshot.values).forEach(([key, value]) => {
    if (key.startsWith("planner_") && typeof value === "string") localStorage.setItem(key, value);
  });
  localStorage.setItem(ADDON_KEYS.syncMeta, JSON.stringify({ pulledAt: Date.now(), cloudUpdatedAt: snapshot.updatedAt || 0 }));
  applyingCloud = false;
}

function setSyncStatus(text, color = "#ccc") {
  const label = document.getElementById("syncText");
  const dot = document.getElementById("syncDot");
  if (label) label.textContent = text;
  if (dot) dot.style.background = color;
}

async function initFirebase() {
  if (!configuredFirebase()) {
    setSyncStatus("local only", "#aaa");
    return;
  }
  try {
    const appSdk = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
    const authSdk = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
    const storeSdk = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const app = appSdk.initializeApp(window.PLANNER_FIREBASE_CONFIG);
    firebase = {
      auth: authSdk.getAuth(app),
      db: storeSdk.getFirestore(app),
      authSdk,
      storeSdk
    };
    authSdk.onAuthStateChanged(firebase.auth, handleAuthState);
  } catch (error) {
    console.warn("Optional Firebase add-on unavailable:", error);
    setSyncStatus("local only", "#aaa");
  }
}

async function handleAuthState(user) {
  currentUser = user;
  renderAuthState();
  if (!user) {
    setSyncStatus("local only", "#aaa");
    return;
  }
  setSyncStatus("checking cloud", "#e0b34f");
  const ref = firebase.storeSdk.doc(firebase.db, "users", user.uid, "planner", "main");
  try {
    const cloudDoc = await firebase.storeSdk.getDoc(ref);
    if (!cloudDoc.exists()) {
      await pushCloud();
      return;
    }
    const cloud = cloudDoc.data();
    const meta = parse(ADDON_KEYS.syncMeta, {});
    const localChangedAt = Number(meta.localChangedAt || 0);
    const cloudChangedAt = Number(cloud.updatedAt || 0);
    if (!localHasPlannerData()) {
      applySnapshot(cloud);
      location.reload();
      return;
    }
    if (cloudChangedAt > Number(meta.cloudUpdatedAt || 0) && localChangedAt > Number(meta.pulledAt || 0)) {
      showConflictDialog(cloud);
      setSyncStatus("choose version", "#e0b34f");
      return;
    }
    if (cloudChangedAt > localChangedAt) {
      applySnapshot(cloud);
      location.reload();
      return;
    }
    await pushCloud();
  } catch (error) {
    console.warn("Cloud load failed; local data is still active:", error);
    setSyncStatus("local saved", "#aaa");
  }
}

async function pushCloud() {
  if (!firebase || !currentUser || applyingCloud) return;
  const data = snapshotLocal();
  const ref = firebase.storeSdk.doc(firebase.db, "users", currentUser.uid, "planner", "main");
  try {
    await firebase.storeSdk.setDoc(ref, data, { merge: true });
    save(ADDON_KEYS.syncMeta, { pulledAt: Date.now(), cloudUpdatedAt: data.updatedAt, localChangedAt: data.updatedAt });
    setSyncStatus("cloud saved", "#62b88d");
  } catch (error) {
    console.warn("Cloud save failed; local data is still active:", error);
    setSyncStatus("local saved", "#aaa");
  }
}

function queueCloudSave() {
  if (applyingCloud) return;
  const meta = parse(ADDON_KEYS.syncMeta, {});
  meta.localChangedAt = Date.now();
  save(ADDON_KEYS.syncMeta, meta);
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushCloud, 1200);
}

function observeLocalChanges() {
  const nativeSet = Storage.prototype.setItem;
  const nativeRemove = Storage.prototype.removeItem;
  Storage.prototype.setItem = function(key, value) {
    nativeSet.call(this, key, value);
    if (this === localStorage && String(key).startsWith("planner_") && key !== ADDON_KEYS.syncMeta) queueCloudSave();
  };
  Storage.prototype.removeItem = function(key) {
    nativeRemove.call(this, key);
    if (this === localStorage && String(key).startsWith("planner_")) queueCloudSave();
  };
}

function createAuthUi() {
  const headerRight = document.querySelector(".book-header > div:last-child");
  if (!headerRight) return;
  const tools = document.createElement("div");
  tools.className = "addon-header-tools";
  tools.innerHTML = `
    <span id="addonUserPill" class="addon-user-pill">guest mode</span>
    <button class="btn ghost sm" id="addonAuthBtn" style="padding:4px 8px;font-size:.68rem">sign in</button>
  `;
  headerRight.insertBefore(tools, headerRight.firstChild);

  document.body.insertAdjacentHTML("beforeend", `
    <div class="addon-panel" id="addonAuthPanel">
      <div class="addon-dialog">
        <h2>optional cloud sign-in</h2>
        <button class="btn blue" id="addonGoogleBtn" style="width:100%">continue with Google</button>
        <div class="addon-divider">or use email</div>
        <div class="addon-grid">
          <input class="addon-field" id="addonEmail" type="email" placeholder="email">
          <input class="addon-field" id="addonPassword" type="password" minlength="6" placeholder="password">
        </div>
        <div class="addon-note" id="addonAuthMessage">The planner always works in guest mode. Signing in adds private cloud sync.</div>
        <div class="addon-actions">
          <button class="btn ghost sm" id="addonCloseAuth">close</button>
          <button class="btn ghost sm" id="addonRegisterBtn">create account</button>
          <button class="btn sm" id="addonEmailBtn">sign in</button>
        </div>
      </div>
    </div>
  `);
  document.getElementById("addonAuthBtn").addEventListener("click", async () => {
    if (currentUser) await firebase.authSdk.signOut(firebase.auth);
    else document.getElementById("addonAuthPanel").classList.add("open");
  });
  document.getElementById("addonCloseAuth").addEventListener("click", closeAuth);
  document.getElementById("addonAuthPanel").addEventListener("click", e => {
    if (e.target.id === "addonAuthPanel") closeAuth();
  });
  document.getElementById("addonGoogleBtn").addEventListener("click", signInGoogle);
  document.getElementById("addonEmailBtn").addEventListener("click", () => signInEmail(false));
  document.getElementById("addonRegisterBtn").addEventListener("click", () => signInEmail(true));
}

function closeAuth() {
  document.getElementById("addonAuthPanel")?.classList.remove("open");
}
function authMessage(message) {
  const el = document.getElementById("addonAuthMessage");
  if (el) el.textContent = message;
}
async function signInGoogle() {
  if (!firebase) return authMessage("Add your Firebase config first.");
  try {
    await firebase.authSdk.signInWithPopup(firebase.auth, new firebase.authSdk.GoogleAuthProvider());
    closeAuth();
  } catch (e) { authMessage(e.message); }
}
async function signInEmail(register) {
  if (!firebase) return authMessage("Add your Firebase config first.");
  const email = document.getElementById("addonEmail").value.trim();
  const password = document.getElementById("addonPassword").value;
  try {
    if (register) await firebase.authSdk.createUserWithEmailAndPassword(firebase.auth, email, password);
    else await firebase.authSdk.signInWithEmailAndPassword(firebase.auth, email, password);
    closeAuth();
  } catch (e) { authMessage(e.message); }
}
function renderAuthState() {
  const pill = document.getElementById("addonUserPill");
  const button = document.getElementById("addonAuthBtn");
  if (pill) pill.textContent = currentUser ? `signed in: ${currentUser.displayName || currentUser.email || "user"}` : "guest mode";
  if (button) button.textContent = currentUser ? "sign out" : "sign in";
}

function showConflictDialog(cloud) {
  document.body.insertAdjacentHTML("beforeend", `
    <div class="addon-panel open" id="addonConflict">
      <div class="addon-dialog">
        <h2>local and cloud changes found</h2>
        <p class="addon-note">Nothing will be deleted automatically. Choose which complete version to keep. Exporting a backup first is recommended.</p>
        <div class="addon-actions">
          <button class="btn ghost sm" id="conflictExport">export backup</button>
          <button class="btn blue sm" id="conflictCloud">use cloud</button>
          <button class="btn sm" id="conflictLocal">keep local</button>
        </div>
      </div>
    </div>
  `);
  document.getElementById("conflictExport").onclick = exportJsonBackup;
  document.getElementById("conflictCloud").onclick = () => { applySnapshot(cloud); location.reload(); };
  document.getElementById("conflictLocal").onclick = async () => {
    document.getElementById("addonConflict").remove();
    await pushCloud();
  };
}

function addRecurrence() {
  const row = document.querySelector("#sec-todos .input-row");
  const input = document.getElementById("todoInput");
  if (!row || !input) return;
  input.insertAdjacentHTML("afterend", `
    <select id="todoRecurrence" class="recurrence-select" title="repeat task">
      <option value="">no repeat</option><option value="daily">daily</option>
      <option value="weekly">weekly</option><option value="monthly">monthly</option>
    </select>
  `);
  const addBtn = document.getElementById("addTodoBtn");
  const tagNewest = () => setTimeout(() => {
    const recurrence = document.getElementById("todoRecurrence").value;
    if (!recurrence) return;
    const todos = parse("planner_todos", []);
    const item = todos[todos.length - 1];
    if (item && !item.recurrence) {
      item.id ||= uid();
      item.recurrence = recurrence;
      item.recurrenceRoot = item.id;
      save("planner_todos", todos);
      document.getElementById("todoRecurrence").value = "";
      window.dispatchEvent(new Event("planner-addon-refresh"));
    }
  }, 0);
  addBtn?.addEventListener("click", tagNewest);
  input.addEventListener("keydown", e => { if (e.key === "Enter") tagNewest(); });

  document.addEventListener("click", e => {
    const check = e.target.closest(".todo-check-right");
    if (!check) return;
    const before = parse("planner_todos", []).map(t => Boolean(t.done));
    setTimeout(() => createNextRecurring(before), 0);
  }, true);
}

function addPeriod(dateString, recurrence) {
  const date = dateString ? new Date(`${dateString}T12:00:00`) : new Date();
  if (recurrence === "daily") date.setDate(date.getDate() + 1);
  if (recurrence === "weekly") date.setDate(date.getDate() + 7);
  if (recurrence === "monthly") date.setMonth(date.getMonth() + 1);
  return date.toISOString().slice(0, 10);
}
function createNextRecurring(before) {
  const todos = parse("planner_todos", []);
  let changed = false;
  todos.forEach((task, index) => {
    if (!task.recurrence || before[index] || !task.done || task.recurrenceSpawned) return;
    task.id ||= uid();
    task.recurrenceRoot ||= task.id;
    task.recurrenceSpawned = true;
    todos.push({
      ...task, id: uid(), done: false, recurrenceSpawned: false,
      dueDate: addPeriod(task.dueDate, task.recurrence)
    });
    changed = true;
    reward("a repeating task is ready for next time");
  });
  if (changed) {
    save("planner_todos", todos);
    location.reload();
  }
}

function addStudyTracker() {
  const section = getTrackerSection();
  if (!section) return;
  section.insertAdjacentHTML("beforeend", `
    <div class="tracker-pane">
      <div class="addon-card-title"><span>study tracker</span><span id="studyWeeklyTotal">0 min this week</span></div>
      <form class="addon-form" id="studyForm">
        <input class="addon-field wide" id="studySubject" required maxlength="50" placeholder="subject / class">
        <input class="addon-field" id="studyDate" type="date" required>
        <input class="addon-field" id="studyMinutes" type="number" min="1" max="1440" required placeholder="min">
        <input class="addon-field wide" id="studyNotes" maxlength="120" placeholder="optional notes">
        <button class="btn mint sm">+ log</button>
      </form>
      <div class="addon-list" id="studyList"></div>
    </div>
  `);
  document.getElementById("studyDate").value = today();
  document.getElementById("studyForm").addEventListener("submit", e => {
    e.preventDefault();
    const logs = parse(ADDON_KEYS.study, []);
    logs.unshift({
      id: uid(), subject: document.getElementById("studySubject").value.trim(),
      date: document.getElementById("studyDate").value,
      minutes: Number(document.getElementById("studyMinutes").value),
      notes: document.getElementById("studyNotes").value.trim()
    });
    save(ADDON_KEYS.study, logs);
    e.target.reset(); document.getElementById("studyDate").value = today();
    renderStudy();
  });
  renderStudy();
}
function startOfWeek() {
  const d = new Date(); const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - day); return d;
}
function renderStudy() {
  const logs = parse(ADDON_KEYS.study, []);
  const weekly = logs.filter(x => new Date(`${x.date}T12:00:00`) >= startOfWeek()).reduce((n, x) => n + Number(x.minutes || 0), 0);
  document.getElementById("studyWeeklyTotal").textContent = `${weekly} min this week`;
  document.getElementById("studyList").innerHTML = logs.slice(0, 8).map(x => `
    <div class="addon-row"><div class="addon-row-main"><strong>${escapeHtml(x.subject)}</strong>
    <div class="addon-row-sub">${escapeHtml(x.date)} · ${x.minutes} minutes${x.notes ? ` · ${escapeHtml(x.notes)}` : ""}</div></div>
    <button class="icon-btn study-delete" data-id="${x.id}" aria-label="delete">×</button></div>
  `).join("") || '<div class="addon-empty">no study sessions logged yet</div>';
  document.querySelectorAll(".study-delete").forEach(b => b.onclick = () => {
    save(ADDON_KEYS.study, logs.filter(x => x.id !== b.dataset.id)); renderStudy();
  });
}

function weekDates() {
  const start = startOfWeek();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i); return d.toISOString().slice(0, 10);
  });
}
function addHabitTracker() {
  const section = getTrackerSection();
  if (!section) return;
  section.insertAdjacentHTML("beforeend", `
    <div class="tracker-pane">
      <div class="addon-card-title"><span>habit tracker</span><span id="habitStreak">0 day streak</span></div>
      <form class="input-row" id="habitForm">
        <input id="habitName" required maxlength="50" placeholder="add a daily habit...">
        <button class="btn mint sm">+ habit</button>
      </form>
      <div class="addon-list" id="habitList"></div>
    </div>
  `);
  document.getElementById("habitForm").addEventListener("submit", e => {
    e.preventDefault();
    const habits = parse(ADDON_KEYS.habits, []);
    habits.push({ id: uid(), name: document.getElementById("habitName").value.trim(), dates: [] });
    save(ADDON_KEYS.habits, habits); e.target.reset(); renderHabits();
  });
  renderHabits();
}

// Keeps both productivity trackers together on their dedicated book page.
function getTrackerSection() {
  let tracker = document.getElementById("productivityTrackers");
  if (tracker) return tracker;
  const section = document.getElementById("sec-trackers");
  if (!section) return null;
  section.insertAdjacentHTML("beforeend", `
    <div class="card card-mint addon-card">
      <div class="sec-title mint">study &amp; habit trackers</div>
      <div class="tracker-section" id="productivityTrackers"></div>
    </div>
  `);
  return document.getElementById("productivityTrackers");
}
function habitStreak(habits) {
  let count = 0; const d = new Date();
  while (true) {
    const key = d.toISOString().slice(0, 10);
    if (!habits.length || !habits.some(h => (h.dates || []).includes(key))) break;
    count++; d.setDate(d.getDate() - 1);
  }
  return count;
}
function renderHabits() {
  const habits = parse(ADDON_KEYS.habits, []);
  const dates = weekDates();
  const streak = habitStreak(habits);
  document.getElementById("habitStreak").textContent = `${streak} day streak`;
  document.getElementById("habitList").innerHTML = habits.map(h => `
    <div class="addon-row"><div class="addon-row-main"><strong>${escapeHtml(h.name)}</strong>
      <div class="addon-row-sub">M T W T F S S</div></div>
      <div class="habit-week">${dates.map((d, i) => `<button class="habit-day ${(h.dates || []).includes(d) ? "done" : ""}" data-id="${h.id}" data-date="${d}" title="${d}">${i + 1}</button>`).join("")}</div>
      <button class="icon-btn habit-delete" data-id="${h.id}" aria-label="delete">×</button>
    </div>
  `).join("") || '<div class="addon-empty">add a habit to begin</div>';
  document.querySelectorAll(".habit-day").forEach(b => b.onclick = () => {
    const habit = habits.find(h => h.id === b.dataset.id);
    habit.dates ||= [];
    const index = habit.dates.indexOf(b.dataset.date);
    if (index >= 0) habit.dates.splice(index, 1);
    else { habit.dates.push(b.dataset.date); reward("a little progress star for you"); }
    save(ADDON_KEYS.habits, habits); renderHabits();
  });
  document.querySelectorAll(".habit-delete").forEach(b => b.onclick = () => {
    save(ADDON_KEYS.habits, habits.filter(h => h.id !== b.dataset.id)); renderHabits();
  });
}

function reward(message) {
  const prefs = parse(ADDON_KEYS.rewards, { enabled: true, stars: 0 });
  if (!prefs.enabled) return;
  prefs.stars = Number(prefs.stars || 0) + 1; save(ADDON_KEYS.rewards, prefs);
  let toast = document.getElementById("addonReward");
  if (!toast) {
    document.body.insertAdjacentHTML("beforeend", '<div class="addon-reward" id="addonReward"></div>');
    toast = document.getElementById("addonReward");
  }
  toast.textContent = `★ ${message} · ${prefs.stars} stars`;
  toast.classList.add("show");
  clearTimeout(reward.timer); reward.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function addCompletionRewards() {
  document.addEventListener("click", e => {
    const check = e.target.closest(".todo-check-right");
    if (!check || check.classList.contains("done")) return;
    setTimeout(() => reward("task complete"), 80);
  });
}

function exportPdf() {
  const todos = parse("planner_todos", []);
  const notebooks = parse("planner_notebooks", []);
  const years = parse("planner_sched_years", []);
  const schedule = years.map(year => ({ year, data: parse(`planner_schedule_${year}`, {}) }));
  const notes = notebooks.flatMap(nb => (nb.notes || []).map(n => ({ notebook: nb.name, ...n })));
  const win = window.open("", "_blank");
  if (!win) return alert("Please allow pop-ups to export a PDF.");
  const classes = schedule.flatMap(y => Object.entries(y.data || {}).flatMap(([term, list]) =>
    (list || []).map(c => `<li><strong>${escapeHtml(c.name)}</strong> · ${escapeHtml(y.year)} ${escapeHtml(term)} · ${escapeHtml((c.days || []).join(" "))} ${escapeHtml(c.startTime || "")}</li>`)
  )).join("");
  win.document.write(`<!doctype html><html><head><title>Planner export</title><style>
    body{font-family:Arial,sans-serif;color:#3a2a35;margin:40px;line-height:1.5}h1,h2{color:#a03060}
    section{break-inside:avoid;margin:26px 0}li{margin:7px 0}.done{text-decoration:line-through;color:#888}
    @media print{button{display:none}}</style></head><body>
    <h1>${escapeHtml(localStorage.getItem("planner_title") || "my little planner")}</h1>
    <button onclick="window.print()">save as PDF</button>
    <section><h2>To-dos</h2><ul>${todos.map(t => `<li class="${t.done ? "done" : ""}">${escapeHtml(t.text)}${t.dueDate ? ` · ${escapeHtml(t.dueDate)}` : ""}${t.recurrence ? ` · repeats ${t.recurrence}` : ""}</li>`).join("") || "<li>No tasks</li>"}</ul></section>
    <section><h2>Schedule</h2><ul>${classes || "<li>No classes</li>"}</ul></section>
    <section><h2>Notes</h2>${notes.map(n => `<h3>${escapeHtml(n.notebook)} · ${escapeHtml(n.title || "Untitled")}</h3><div>${n.body || n.content || ""}</div>`).join("") || "<p>No notes</p>"}</section>
    <script>setTimeout(()=>window.print(),350)<\/script></body></html>`);
  win.document.close();
}
function exportJsonBackup() {
  const blob = new Blob([JSON.stringify(snapshotLocal(), null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `planner-backup-${today()}.json`; a.click(); URL.revokeObjectURL(a.href);
}
function addPdfButton() {
  const footer = document.querySelector(".book-footer > div:nth-child(2)");
  if (!footer) return;
  const button = document.createElement("button");
  button.className = "btn ghost sm"; button.id = "exportPdfBtn";
  button.style.cssText = "font-size:.72rem;padding:5px 12px";
  button.textContent = "PDF"; button.title = "export planner as PDF";
  button.addEventListener("click", exportPdf); footer.appendChild(button);
}

function init() {
  observeLocalChanges();
  createAuthUi();
  addRecurrence();
  addStudyTracker();
  addHabitTracker();
  addCompletionRewards();
  addPdfButton();
  initFirebase();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
})();
