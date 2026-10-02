// ====== Firebase Setup ======
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  remove
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDz-SR5wZ4SVXE_dNF4F3073hV9MnvgeUM",
  authDomain: "cc-groupings.firebaseapp.com",
  databaseURL: "https://cc-groupings-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "cc-groupings",
  storageBucket: "cc-groupings.firebasestorage.app",
  messagingSenderId: "803260881683",
  appId: "1:803260881683:web:d97870283a7387080658e6",
  measurementId: "G-99TXN87B78"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const projectsRef = ref(db, "projects");
const migrationRef = ref(db, "state");

// ====== Local storage keys ======
const LS_PERSONAL = "groupRandomizerPersonalProjects";
const LS_ACTIVE = "groupRandomizerActiveProjectId";
const LS_MIGRATED = "groupRandomizerMigrated_v1";
const LS_TUTORIAL_SEEN = "groupRandomizerTutorialSeen_v1";

// ====== Projects ======
let projects = {};
let activeProjectId = null;

// ====== Utilities ======
function generateId() {
  return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function setSyncStatus(text, ok) {
  const el = document.getElementById("sync-status");
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? "#2e7d32" : "#b91c1c";
}

function showNotification(msg) {
  let el = document.querySelector(".notification");
  if (!el) {
    el = document.createElement("div");
    el.className = "notification";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2200);
}

// ====== Personal storage ======
function loadPersonalProjects() {
  try {
    const raw = localStorage.getItem(LS_PERSONAL);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("Failed to load personal projects:", e);
    return {};
  }
}

function savePersonalProjects(all) {
  try {
    localStorage.setItem(LS_PERSONAL, JSON.stringify(all));
  } catch (e) {
    console.error("Failed to save personal projects:", e);
    showNotification("Failed to save personal project (storage full?)");
  }
}

function loadActiveProjectId() { return localStorage.getItem(LS_ACTIVE); }

function saveActiveProjectId(id) {
  if (id) localStorage.setItem(LS_ACTIVE, id);
  else localStorage.removeItem(LS_ACTIVE);
}

// ====== Firebase read ======
function initFirebaseListeners() {
  onValue(projectsRef, snapshot => {
    const data = snapshot.val() || {};
    const merged = {};

    for (const [id, p] of Object.entries(projects)) {
      if (p.type === "personal") merged[id] = p;
    }
    for (const [id, p] of Object.entries(data)) {
      merged[id] = {
        id,
        type: "shared",
        name: p.name || "Untitled",
        people: p.people || [],
        history: p.history || [],
        lastGenerationStart: typeof p.lastGenerationStart === "number" ? p.lastGenerationStart : -1,
        lastGenerationCount: typeof p.lastGenerationCount === "number" ? p.lastGenerationCount : 0
      };
    }
    const personal = loadPersonalProjects();
    for (const [id, p] of Object.entries(personal)) {
      merged[id] = {
        id,
        type: "personal",
        name: p.name || "Untitled",
        people: p.people || [],
        history: p.history || [],
        lastGenerationStart: typeof p.lastGenerationStart === "number" ? p.lastGenerationStart : -1,
        lastGenerationCount: typeof p.lastGenerationCount === "number" ? p.lastGenerationCount : 0
      };
    }

    projects = merged;
    ensureAtLeastOneProject();

    if (!activeProjectId || !projects[activeProjectId]) {
      const saved = loadActiveProjectId();
      if (saved && projects[saved]) activeProjectId = saved;
      else {
        const ids = Object.keys(projects).sort((a, b) => projects[a].name.localeCompare(projects[b].name));
        activeProjectId = ids[0];
        saveActiveProjectId(activeProjectId);
      }
    }

    setSyncStatus("Connected — shared with everyone", true);
    renderProjectBar();
    refreshCurrentProjectView();
  }, err => {
    console.error("Read failed:", err);
    setSyncStatus("Connection error: " + err.message, false);
  });
}

function ensureAtLeastOneProject() {
  if (Object.keys(projects).length > 0) return;
  const id = generateId();
  const newProject = {
    id, type: "shared", name: "Default",
    people: [], history: [],
    lastGenerationStart: -1, lastGenerationCount: 0
  };
  projects[id] = newProject;
  saveSharedProject(newProject);
}

function migrateLegacyDataIfPresent(legacy) {
  const id = generateId();
  const newProject = {
    id, type: "shared", name: "Default",
    people: legacy.people || [],
    history: legacy.history || [],
    lastGenerationStart: typeof legacy.lastGenerationStart === "number" ? legacy.lastGenerationStart : -1,
    lastGenerationCount: typeof legacy.lastGenerationCount === "number" ? legacy.lastGenerationCount : 0
  };
  projects[id] = newProject;
  saveSharedProject(newProject);
  remove(migrationRef).catch(err => console.warn("Could not remove legacy node:", err));
  localStorage.setItem(LS_MIGRATED, "1");
}

// ====== Firebase writes ======
function saveSharedProject(project) {
  const data = {
    name: project.name,
    people: project.people,
    history: project.history,
    lastGenerationStart: project.lastGenerationStart,
    lastGenerationCount: project.lastGenerationCount
  };
  set(ref(db, "projects/" + project.id), data).catch(err => {
    console.error("Save failed:", err);
    setSyncStatus("Save failed: " + err.message, false);
  });
}

function deleteSharedProject(id) {
  remove(ref(db, "projects/" + id)).catch(err => {
    console.error("Delete failed:", err);
    showNotification("Delete failed: " + err.message);
  });
}

function saveCurrentProject() {
  const project = projects[activeProjectId];
  if (!project) return;
  if (project.type === "shared") saveSharedProject(project);
  else {
    const all = loadPersonalProjects();
    all[project.id] = project;
    savePersonalProjects(all);
  }
}

// ====== Project operations ======
function createProject(name, type) {
  const id = generateId();
  const project = {
    id, type, name,
    people: [], history: [],
    lastGenerationStart: -1, lastGenerationCount: 0
  };
  projects[id] = project;

  if (type === "shared") saveSharedProject(project);
  else {
    const all = loadPersonalProjects();
    all[id] = project;
    savePersonalProjects(all);
  }

  activeProjectId = id;
  saveActiveProjectId(id);
  renderProjectBar();
  refreshCurrentProjectView();
  showNotification(`Created "${name}"`);
}

function renameProject(newName) {
  const project = projects[activeProjectId];
  if (!project) return;
  project.name = newName;
  saveCurrentProject();
  renderProjectBar();
  showNotification("Renamed");
}

function deleteActiveProject() {
  const project = projects[activeProjectId];
  if (!project) return;

  const confirmMsg = project.type === "shared"
    ? `Delete "${project.name}" for EVERYONE? This removes its people and history from the shared database.`
    : `Delete personal project "${project.name}"? It will be removed from this browser.`;

  if (!confirm(confirmMsg)) return;

  if (project.type === "shared") deleteSharedProject(project.id);
  else {
    const all = loadPersonalProjects();
    delete all[project.id];
    savePersonalProjects(all);
  }

  delete projects[project.id];

  if (Object.keys(projects).length === 0) {
    setTimeout(() => {
      if (Object.keys(projects).length === 0) createProject("Default", "shared");
    }, 400);
    return;
  }

  const ids = Object.keys(projects).sort((a, b) => projects[a].name.localeCompare(projects[b].name));
  activeProjectId = ids[0];
  saveActiveProjectId(activeProjectId);
  renderProjectBar();
  refreshCurrentProjectView();
  showNotification("Project deleted");
}

function convertActiveProject() {
  const project = projects[activeProjectId];
  if (!project) return;

  if (project.type === "shared") {
    if (!confirm(`Convert "${project.name}" to a PERSONAL project?\n\nIt will be copied to this browser only and removed from the shared database for everyone else.`)) return;
    const newId = generateId();
    const personalCopy = {
      id: newId, type: "personal", name: project.name + " (personal)",
      people: project.people.slice(),
      history: project.history.map(w => w.map(g => g.slice())),
      lastGenerationStart: project.lastGenerationStart,
      lastGenerationCount: project.lastGenerationCount
    };
    const all = loadPersonalProjects();
    all[newId] = personalCopy;
    savePersonalProjects(all);
    projects[newId] = personalCopy;
    deleteSharedProject(project.id);
    delete projects[project.id];
    activeProjectId = newId;
    saveActiveProjectId(newId);
    renderProjectBar();
    refreshCurrentProjectView();
    showNotification("Converted to personal");
  } else {
    if (!confirm(`Publish "${project.name}" to the SHARED database?\n\nEveryone will see it.`)) return;
    const newId = generateId();
    const sharedCopy = {
      id: newId, type: "shared", name: project.name.replace(/ \(personal\)$/, ""),
      people: project.people.slice(),
      history: project.history.map(w => w.map(g => g.slice())),
      lastGenerationStart: project.lastGenerationStart,
      lastGenerationCount: project.lastGenerationCount
    };
    projects[newId] = sharedCopy;
    saveSharedProject(sharedCopy);
    const all = loadPersonalProjects();
    delete all[project.id];
    savePersonalProjects(all);
    delete projects[project.id];
    activeProjectId = newId;
    saveActiveProjectId(newId);
    renderProjectBar();
    refreshCurrentProjectView();
    showNotification("Converted to shared");
  }
}

// ====== Project bar ======
function renderProjectBar() {
  const select = document.getElementById("project-select");
  const badge = document.getElementById("project-type-badge");

  const list = Object.values(projects).sort((a, b) => {
    if (a.type !== b.type) return a.type === "shared" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  select.innerHTML = "";
  for (const p of list) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.type === "shared" ? "[Shared]" : "[Personal]"} ${p.name}`;
    if (p.id === activeProjectId) opt.selected = true;
    select.appendChild(opt);
  }

  const project = projects[activeProjectId];
  if (project) {
    badge.textContent = project.type;
    badge.className = "project-badge " + project.type;
  } else {
    badge.textContent = "";
    badge.className = "project-badge";
  }
}

// ====== Current project ======
function currentProject() { return projects[activeProjectId]; }

function refreshCurrentProjectView() {
  renderPeople();
  renderStats();
  renderHistory();
  updateGroupInputMax();
}

// ====== Core Algorithm ======
function getPairKey(a, b) { return [a, b].sort().join("|||"); }

function getPairCountsFromHistory(history, weeksBack) {
  const counts = {};
  const h = weeksBack && weeksBack > 0 ? history.slice(-weeksBack) : history;
  for (const week of h) {
    for (const group of week) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const key = getPairKey(group[i], group[j]);
          counts[key] = (counts[key] || 0) + 1;
        }
      }
    }
  }
  return counts;
}

function groupScore(group, pairCounts) {
  let score = 0;
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const key = getPairKey(group[i], group[j]);
      const c = pairCounts[key] || 0;
      score += c * c;
    }
  }
  return score;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildGroupsFromShuffle(shuffled, numGroups) {
  const groups = Array.from({ length: numGroups }, () => []);
  shuffled.forEach((person, i) => groups[i % numGroups].push(person));
  return groups;
}

function improveWithSwaps(groups, pairCounts, iterations = 800) {
  const g = groups.map(x => x.slice());
  if (g.length < 2) return g;
  for (let it = 0; it < iterations; it++) {
    const i1 = Math.floor(Math.random() * g.length);
    let i2 = Math.floor(Math.random() * g.length);
    if (i1 === i2) continue;
    const g1 = g[i1], g2 = g[i2];
    if (!g1.length || !g2.length) continue;
    const p1Idx = Math.floor(Math.random() * g1.length);
    const p2Idx = Math.floor(Math.random() * g2.length);
    const p1 = g1[p1Idx], p2 = g2[p2Idx];
    const before = groupScore(g1, pairCounts) + groupScore(g2, pairCounts);
    g1[p1Idx] = p2; g2[p2Idx] = p1;
    const after = groupScore(g1, pairCounts) + groupScore(g2, pairCounts);
    if (after > before) { g1[p1Idx] = p1; g2[p2Idx] = p2; }
  }
  return g;
}

function createGroups(people, numGroups, pairCounts, attempts = 1500) {
  if (people.length < 2) throw new Error("Need at least 2 people.");
  if (numGroups < 2 || numGroups > people.length)
    throw new Error(`Number of groups must be between 2 and ${people.length}.`);

  let bestGroups = null, bestScore = Infinity;
  for (let a = 0; a < attempts; a++) {
    const shuffled = shuffle(people);
    const groups = buildGroupsFromShuffle(shuffled, numGroups);
    const total = groups.reduce((sum, grp) => sum + groupScore(grp, pairCounts), 0);
    if (total < bestScore) {
      bestScore = total;
      bestGroups = groups.map(x => x.slice());
      if (bestScore === 0) break;
    }
  }
  bestGroups = improveWithSwaps(bestGroups, pairCounts);
  return bestGroups;
}

function generateWeeksForProject(project, numWeeks, numGroups, weeksBack) {
  const allWeeks = [];
  const pairCounts = getPairCountsFromHistory(project.history, weeksBack);
  for (let w = 0; w < numWeeks; w++) {
    const groups = createGroups(project.people, numGroups, pairCounts);
    for (const group of groups) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const key = getPairKey(group[i], group[j]);
          pairCounts[key] = (pairCounts[key] || 0) + 1;
        }
      }
    }
    allWeeks.push(groups);
  }
  return allWeeks;
}

// ====== CSV ======
function csvEscape(value) {
  const s = String(value == null ? "" : value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function rowsToCSV(rows) {
  return rows.map(row => row.map(csvEscape).join(",")).join("\r\n");
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function timestampForFilename() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function safeFilename(s) {
  return (s || "project").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 40);
}

function parseCSV(text) {
  const rows = []; let row = []; let field = ""; let inQuotes = false; let i = 0;
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        else { inQuotes = false; i++; continue; }
      } else { field += ch; i++; continue; }
    } else {
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ",") { row.push(field); field = ""; i++; continue; }
      if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += ch; i++;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

function maxGroupSize(weeks) {
  let max = 0;
  for (const week of weeks) for (const group of week) if (group.length > max) max = group.length;
  return max;
}

function exportGroupingsCSV(weeks, label) {
  if (!weeks || !weeks.length) { alert("Nothing to export."); return; }
  const cols = maxGroupSize(weeks);
  const includeWeekCol = weeks.length > 1;
  const header = includeWeekCol ? ["Week", "Group"] : ["Group"];
  for (let i = 1; i <= cols; i++) header.push(`Person ${i}`);
  const rows = [header];
  weeks.forEach((week, wIdx) => {
    week.forEach((group, gIdx) => {
      const sorted = group.slice().sort((a, b) => a.localeCompare(b));
      const row = includeWeekCol ? [wIdx + 1, gIdx + 1] : [gIdx + 1];
      for (let i = 0; i < cols; i++) row.push(sorted[i] || "");
      rows.push(row);
    });
  });
  const csv = rowsToCSV(rows);
  downloadFile(csv, `${label}_${timestampForFilename()}.csv`, "text/csv;charset=utf-8");
}

function exportPeopleCSV() {
  const p = currentProject();
  if (!p || !p.people.length) { alert("No people to export."); return; }
  const rows = [["Name"]];
  p.people.slice().sort((a, b) => a.localeCompare(b)).forEach(name => rows.push([name]));
  const csv = rowsToCSV(rows);
  downloadFile(csv, `people_${safeFilename(p.name)}_${timestampForFilename()}.csv`, "text/csv;charset=utf-8");
}

function importPeopleCSV(text) {
  const p = currentProject();
  if (!p) return;
  const rows = parseCSV(text);
  if (!rows.length) { alert("CSV file is empty."); return; }
  const firstRow = rows[0].map(c => c.trim().toLowerCase());
  const hasHeader = firstRow.some(c => c === "name" || c === "person" || c === "people");
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const names = [];
  for (const row of dataRows) for (const cell of row) {
    const trimmed = cell.trim();
    if (trimmed) names.push(trimmed);
  }
  let added = 0;
  for (const name of names) if (!p.people.includes(name)) { p.people.push(name); added++; }
  saveCurrentProject();
  refreshCurrentProjectView();
  showNotification(`Imported ${added} new name${added === 1 ? "" : "s"} (${names.length - added} duplicate${names.length - added === 1 ? "" : "s"} skipped).`);
}

// ====== Rendering ======
function renderPeople() {
  const list = document.getElementById("people-list");
  const count = document.getElementById("people-count");
  const p = currentProject();
  if (!p) return;
  count.textContent = p.people.length;
  if (!p.people.length) {
    list.innerHTML = '<li class="empty">No people yet. Add some above.</li>';
    return;
  }
  list.innerHTML = "";
  p.people.slice().sort((a, b) => a.localeCompare(b)).forEach(name => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = name;
    const btn = document.createElement("button");
    btn.textContent = "×";
    btn.title = "Remove";
    btn.addEventListener("click", () => {
      p.people = p.people.filter(x => x !== name);
      saveCurrentProject();
      renderPeople();
      updateGroupInputMax();
    });
    li.appendChild(span);
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function updateGroupInputMax() {
  const input = document.getElementById("num-groups");
  const p = currentProject();
  const maxPeople = p ? p.people.length : 2;
  input.max = Math.max(2, maxPeople);
}

function renderGroupsHTML(groups, weekLabel) {
  const wrap = document.createElement("div");
  if (weekLabel) {
    const h = document.createElement("h3");
    h.textContent = weekLabel;
    wrap.appendChild(h);
  }
  const grid = document.createElement("div");
  grid.className = "groups";
  groups.forEach((group, i) => {
    const box = document.createElement("div");
    box.className = "group-box";
    const title = document.createElement("h3");
    title.textContent = `Group ${i + 1} (${group.length})`;
    box.appendChild(title);
    const ul = document.createElement("ul");
    group.slice().sort((a, b) => a.localeCompare(b)).forEach(p => {
      const li = document.createElement("li");
      li.textContent = p;
      ul.appendChild(li);
    });
    box.appendChild(ul);
    grid.appendChild(box);
  });
  wrap.appendChild(grid);
  return wrap;
}

let currentPreviewWeeks = null;

function renderPreview(weeks, isMultiWeek) {
  const output = document.getElementById("groups-output");
  const area = document.getElementById("preview-area");
  const title = document.getElementById("preview-title");
  const saveRow = document.getElementById("save-preview-row");

  currentPreviewWeeks = weeks;
  output.innerHTML = "";
  area.classList.remove("hidden");

  if (isMultiWeek) {
    title.textContent = `Generated ${weeks.length} week(s) — not saved yet`;
    weeks.forEach((w, i) => {
      const block = document.createElement("div");
      block.className = "week-block";
      block.appendChild(renderGroupsHTML(w, `Week ${i + 1}`));
      output.appendChild(block);
    });
  } else {
    title.textContent = "Generated Groups — not saved yet";
    output.appendChild(renderGroupsHTML(weeks[0], ""));
  }
  saveRow.classList.remove("hidden");
  area.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderStats() {
  const el = document.getElementById("stats-output");
  const p = currentProject();
  if (!p) return;
  el.innerHTML = "";
  if (!p.history.length) {
    el.innerHTML = '<p class="empty">No history yet.</p>';
    return;
  }
  const pairCounts = getPairCountsFromHistory(p.history, null);
  const entries = Object.entries(pairCounts);
  const repeats = entries.filter(([, c]) => c > 1);
  const rows = [
    ["Total unique pairs", entries.length],
    ["Pairs seen more than once", repeats.length],
    ["Total weeks recorded", p.history.length]
  ];
  rows.forEach(([label, value]) => {
    const div = document.createElement("div");
    div.className = "stat-row";
    div.innerHTML = `<span class="stat-label">${label}</span><span class="stat-value">${value}</span>`;
    el.appendChild(div);
  });
  if (repeats.length) {
    const pairDiv = document.createElement("div");
    pairDiv.className = "pair-list";
    const h = document.createElement("h3");
    h.textContent = "Most frequent pairings";
    pairDiv.appendChild(h);
    repeats.sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([key, count]) => {
      const [a, b] = key.split("|||");
      const row = document.createElement("div");
      row.textContent = `${a} & ${b} — ${count} times`;
      pairDiv.appendChild(row);
    });
    el.appendChild(pairDiv);
  }
}

function renderHistory() {
  const el = document.getElementById("history-output");
  const count = document.getElementById("history-count");
  const p = currentProject();
  if (!p) return;
  count.textContent = p.history.length;
  el.innerHTML = "";
  if (!p.history.length) {
    el.innerHTML = '<p class="empty">No history yet. Generate and save weeks to build history.</p>';
    return;
  }
  for (let i = p.history.length - 1; i >= 0; i--) {
    const week = p.history[i];
    const block = document.createElement("div");
    block.className = "week-block";
    block.appendChild(renderGroupsHTML(week, `Week ${i + 1}`));
    el.appendChild(block);
  }
}

// ====== Tutorial ======
const TUTORIAL_STEPS = [
  {
    title: "Welcome to Group Randomizer",
    text: "This quick tour shows you how to use the app. You can skip anytime and re-open it from the Help button at the top.",
    target: null,
    tab: null
  },
  {
    title: "Projects",
    text: "Each project has its own people and history. Use this dropdown to switch projects. Create a new one with the + New button.",
    target: "#project-select",
    tab: null
  },
  {
    title: "Shared vs Personal",
    text: "When you create a project, choose Shared (everyone with the link sees it) or Personal (only on this browser). This badge shows the current type.",
    target: "#project-type-badge",
    tab: null
  },
  {
    title: "Project actions",
    text: "Use these buttons to create, rename, convert between shared/personal, or delete the current project.",
    target: "#new-project-btn",
    tab: null
  },
  {
    title: "People tab",
    text: "Add people here. Paste a whole list separated by commas or new lines. Import/Export CSV is also here.",
    target: "#add-input",
    tab: "people"
  },
  {
    title: "Generate tab",
    text: "Set how many groups you want and how many weeks to generate. The app avoids repeating the same pairs across weeks.",
    target: "#num-groups",
    tab: "generate"
  },
  {
    title: "Generate, then Save",
    text: "Click Generate Groups to see the random groupings. If you like them, click Save to History in the preview. Nothing is saved until you click Save.",
    target: "#preview-btn",
    tab: "generate"
  },
  {
    title: "History tab",
    text: "View past weeks (newest at the top) and export as CSV. Latest Generation exports just the most recent batch; All Weeks exports everything.",
    target: "#export-latest-csv-btn",
    tab: "history"
  },
  {
    title: "You're ready!",
    text: "That's it. Start by adding people, then head to Generate. Click Help at the top anytime to see this again.",
    target: null,
    tab: null
  }
];

let tutorialStep = 0;

function switchTab(tabName) {
  if (!tabName) return;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  const tabBtn = document.querySelector(`.tab[data-tab="${tabName}"]`);
  const tabContent = document.getElementById(`tab-${tabName}`);
  if (tabBtn) tabBtn.classList.add("active");
  if (tabContent) tabContent.classList.add("active");
}

function startTutorial() {
  tutorialStep = 0;
  document.getElementById("tutorial-overlay").classList.remove("hidden");
  showTutorialStep();
}

function endTutorial() {
  document.getElementById("tutorial-overlay").classList.add("hidden");
  document.getElementById("tutorial-highlight").classList.add("hidden");
  try { localStorage.setItem(LS_TUTORIAL_SEEN, "1"); } catch (e) {}
}

function showTutorialStep() {
  const step = TUTORIAL_STEPS[tutorialStep];
  const box = document.querySelector(".tutorial-box");
  const highlight = document.getElementById("tutorial-highlight");

  document.getElementById("tutorial-step").textContent =
    `Step ${tutorialStep + 1} of ${TUTORIAL_STEPS.length}`;
  document.getElementById("tutorial-title").textContent = step.title;
  document.getElementById("tutorial-text").textContent = step.text;
  document.getElementById("tutorial-back").disabled = tutorialStep === 0;
  document.getElementById("tutorial-next").textContent =
    tutorialStep === TUTORIAL_STEPS.length - 1 ? "Finish" : "Next";

  if (step.tab) switchTab(step.tab);

  requestAnimationFrame(() => {
    if (step.target) {
      const el = document.querySelector(step.target);
      if (el) {
        const rect = el.getBoundingClientRect();
        const pad = 6;
        highlight.style.top = (rect.top + window.scrollY - pad) + "px";
        highlight.style.left = (rect.left + window.scrollX - pad) + "px";
        highlight.style.width = (rect.width + pad * 2) + "px";
        highlight.style.height = (rect.height + pad * 2) + "px";
        highlight.classList.remove("hidden");

        const spaceBelow = window.innerHeight - rect.bottom;
        let top;
        if (spaceBelow > 220) top = rect.bottom + 20;
        else top = Math.max(20, rect.top - 220);

        box.style.position = "fixed";
        box.style.top = top + "px";
        box.style.left = "50%";
        box.style.transform = "translateX(-50%)";
      } else {
        highlight.classList.add("hidden");
        box.style.position = "fixed";
        box.style.top = "50%";
        box.style.left = "50%";
        box.style.transform = "translate(-50%, -50%)";
      }
    } else {
      highlight.classList.add("hidden");
      box.style.position = "fixed";
      box.style.top = "50%";
      box.style.left = "50%";
      box.style.transform = "translate(-50%, -50%)";
    }
  });
}

// ====== Event Wiring ======
document.addEventListener("DOMContentLoaded", () => {
  // Load personal projects synchronously
  const personal = loadPersonalProjects();
  for (const [id, p] of Object.entries(personal)) {
    projects[id] = {
      id, type: "personal",
      name: p.name || "Untitled",
      people: p.people || [],
      history: p.history || [],
      lastGenerationStart: typeof p.lastGenerationStart === "number" ? p.lastGenerationStart : -1,
      lastGenerationCount: typeof p.lastGenerationCount === "number" ? p.lastGenerationCount : 0
    };
  }

  activeProjectId = loadActiveProjectId();

  // Tabs
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
    });
  });

  // Project select
  document.getElementById("project-select").addEventListener("change", e => {
    activeProjectId = e.target.value;
    saveActiveProjectId(activeProjectId);
    renderProjectBar();
    refreshCurrentProjectView();
  });

  // New project
  document.getElementById("new-project-btn").addEventListener("click", () => {
    const name = prompt("Project name:");
    if (!name || !name.trim()) return;
    const typeChoice = prompt('Type "shared" to share with everyone, or "personal" for this device only:', "shared");
    if (!typeChoice) return;
    const type = typeChoice.trim().toLowerCase() === "personal" ? "personal" : "shared";
    createProject(name.trim(), type);
  });

  document.getElementById("rename-project-btn").addEventListener("click", () => {
    const p = currentProject();
    if (!p) return;
    const newName = prompt("New name:", p.name);
    if (!newName || !newName.trim()) return;
    renameProject(newName.trim());
  });

  document.getElementById("convert-project-btn").addEventListener("click", convertActiveProject);
  document.getElementById("delete-project-btn").addEventListener("click", deleteActiveProject);

  // Add people
  document.getElementById("add-btn").addEventListener("click", addPeopleFromInput);
  document.getElementById("add-input").addEventListener("keydown", e => {
    if (e.key === "Enter") addPeopleFromInput();
  });

  function addPeopleFromInput() {
    const input = document.getElementById("add-input");
    const raw = input.value.trim();
    if (!raw) return;
    const p = currentProject();
    if (!p) return;
    const names = raw.split(/[,\n]/).map(n => n.trim()).filter(Boolean);
    let added = 0;
    for (const name of names) {
      if (!p.people.includes(name)) { p.people.push(name); added++; }
    }
    input.value = "";
    saveCurrentProject();
    renderPeople();
    updateGroupInputMax();
    showNotification(`Added ${added} name${added === 1 ? "" : "s"}.`);
  }

  document.getElementById("clear-people-btn").addEventListener("click", () => {
    const p = currentProject();
    if (!p || !p.people.length) return;
    if (confirm("Remove all people? (History will be kept.)")) {
      p.people = [];
      saveCurrentProject();
      renderPeople();
      updateGroupInputMax();
    }
  });

  // Generate Groups (replaces Preview)
  document.getElementById("preview-btn").addEventListener("click", () => {
    const p = currentProject();
    if (!p) return;
    const numGroups = parseInt(document.getElementById("num-groups").value, 10);
    const numWeeks = parseInt(document.getElementById("num-weeks").value, 10) || 1;
    const wbRaw = document.getElementById("weeks-back").value.trim();
    const weeksBack = wbRaw ? parseInt(wbRaw, 10) : null;
    try {
      const weeks = generateWeeksForProject(p, numWeeks, numGroups, weeksBack);
      renderPreview(weeks, numWeeks > 1);
    } catch (e) { alert(e.message); }
  });

  // Save to History (from preview)
  document.getElementById("save-preview-btn").addEventListener("click", () => {
    const p = currentProject();
    if (!p || !currentPreviewWeeks) return;
    p.lastGenerationStart = p.history.length;
    p.lastGenerationCount = currentPreviewWeeks.length;
    p.history.push(...currentPreviewWeeks);
    saveCurrentProject();
    renderStats();
    renderHistory();
    showNotification(`Saved ${currentPreviewWeeks.length} week(s) to history.`);
  });

  // Export Preview CSV
  document.getElementById("export-preview-csv-btn").addEventListener("click", () => {
    if (!currentPreviewWeeks) return;
    const p = currentProject();
    exportGroupingsCSV(currentPreviewWeeks, `preview_${safeFilename(p ? p.name : "project")}`);
  });

  // Clear history
  document.getElementById("clear-history-btn").addEventListener("click", () => {
    const p = currentProject();
    if (!p || !p.history.length) return;
    const msg = p.type === "shared"
      ? "Clear all history for everyone in this project?"
      : "Clear all history for this personal project?";
    if (confirm(msg)) {
      p.history = [];
      p.lastGenerationStart = -1;
      p.lastGenerationCount = 0;
      saveCurrentProject();
      renderStats();
      renderHistory();
    }
  });

  // CSV exports
  document.getElementById("export-people-csv-btn").addEventListener("click", exportPeopleCSV);

  document.getElementById("export-latest-csv-btn").addEventListener("click", () => {
    const p = currentProject();
    if (!p || !p.history.length) { alert("No history to export."); return; }
    const start = p.lastGenerationStart;
    const count = p.lastGenerationCount;
    const label = `latest_${safeFilename(p.name)}`;
    if (start >= 0 && count > 0 && start + count <= p.history.length) {
      exportGroupingsCSV(p.history.slice(start, start + count), label);
      return;
    }
    exportGroupingsCSV([p.history[p.history.length - 1]], label);
  });

  document.getElementById("export-all-csv-btn").addEventListener("click", () => {
    const p = currentProject();
    if (!p || !p.history.length) { alert("No history to export."); return; }
    exportGroupingsCSV(p.history, `all_${safeFilename(p.name)}`);
  });

  // CSV import people
  document.getElementById("import-people-csv-btn").addEventListener("click", () => {
    document.getElementById("import-people-file").click();
  });

  document.getElementById("import-people-file").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try { importPeopleCSV(ev.target.result); }
      catch (err) { alert("Failed to import CSV: " + err.message); }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  // Tutorial
  document.getElementById("help-btn").addEventListener("click", startTutorial);
  document.getElementById("tutorial-skip").addEventListener("click", endTutorial);
  document.getElementById("tutorial-back").addEventListener("click", () => {
    if (tutorialStep > 0) { tutorialStep--; showTutorialStep(); }
  });
  document.getElementById("tutorial-next").addEventListener("click", () => {
    if (tutorialStep < TUTORIAL_STEPS.length - 1) {
      tutorialStep++;
      showTutorialStep();
    } else {
      endTutorial();
    }
  });

  // Show tutorial on first visit
  if (!localStorage.getItem(LS_TUTORIAL_SEEN)) {
    setTimeout(startTutorial, 600);
  }

  // Migrate legacy data if present
  if (!localStorage.getItem(LS_MIGRATED)) {
    onValue(migrationRef, snapshot => {
      const legacy = snapshot.val();
      if (legacy && (legacy.people || legacy.history)
          && Object.keys(projects).filter(id => projects[id].type === "shared").length === 0) {
        migrateLegacyDataIfPresent(legacy);
      } else {
        localStorage.setItem(LS_MIGRATED, "1");
      }
    }, { onlyOnce: true });
  }

  // Connect Firebase
  initFirebaseListeners();
});
