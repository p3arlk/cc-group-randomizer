// ====== Firebase Setup ======
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  set
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
const stateRef = ref(db, "state");

// ====== State ======
let state = {
  people: [],
  history: [],
  lastGenerationStart: -1,   // index in history where the most recent generate batch begins
  lastGenerationCount: 0     // how many weeks the most recent batch has
};

// ====== Sync status ======
function setSyncStatus(text, ok) {
  const el = document.getElementById("sync-status");
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? "#2e7d32" : "#b91c1c";
}

// ====== Firebase write ======
function pushState() {
  set(stateRef, state).catch(err => {
    console.error("Save failed:", err);
    setSyncStatus("Save failed: " + err.message, false);
  });
}

// ====== Firebase read ======
function initFirebaseListeners() {
  onValue(stateRef, snapshot => {
    const data = snapshot.val();
    if (data) {
      state.people = data.people || [];
      state.history = data.history || [];
      state.lastGenerationStart = typeof data.lastGenerationStart === "number"
        ? data.lastGenerationStart
        : -1;
      state.lastGenerationCount = typeof data.lastGenerationCount === "number"
        ? data.lastGenerationCount
        : 0;
    } else {
      state.people = [];
      state.history = [];
      state.lastGenerationStart = -1;
      state.lastGenerationCount = 0;
    }
    setSyncStatus("Connected — shared with everyone", true);
    refreshAll();
  }, err => {
    console.error("Read failed:", err);
    setSyncStatus("Connection error: " + err.message, false);
  });
}

// ====== Core Algorithm ======
function getPairKey(a, b) {
  return [a, b].sort().join("|||");
}

function getPairCounts(weeksBack) {
  const counts = {};
  const history = weeksBack && weeksBack > 0
    ? state.history.slice(-weeksBack)
    : state.history;

  for (const week of history) {
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
  shuffled.forEach((person, i) => {
    groups[i % numGroups].push(person);
  });
  return groups;
}

function improveWithSwaps(groups, pairCounts, iterations = 800) {
  const g = groups.map(x => x.slice());
  if (g.length < 2) return g;

  for (let it = 0; it < iterations; it++) {
    const i1 = Math.floor(Math.random() * g.length);
    let i2 = Math.floor(Math.random() * g.length);
    if (i1 === i2) continue;

    const g1 = g[i1];
    const g2 = g[i2];
    if (!g1.length || !g2.length) continue;

    const p1Idx = Math.floor(Math.random() * g1.length);
    const p2Idx = Math.floor(Math.random() * g2.length);
    const p1 = g1[p1Idx];
    const p2 = g2[p2Idx];

    const before = groupScore(g1, pairCounts) + groupScore(g2, pairCounts);

    g1[p1Idx] = p2;
    g2[p2Idx] = p1;

    const after = groupScore(g1, pairCounts) + groupScore(g2, pairCounts);

    if (after > before) {
      g1[p1Idx] = p1;
      g2[p2Idx] = p2;
    }
  }
  return g;
}

function createGroups(numGroups, pairCounts, attempts = 1500) {
  if (state.people.length < 2) {
    throw new Error("Need at least 2 people.");
  }
  if (numGroups < 2 || numGroups > state.people.length) {
    throw new Error(`Number of groups must be between 2 and ${state.people.length}.`);
  }

  let bestGroups = null;
  let bestScore = Infinity;

  for (let a = 0; a < attempts; a++) {
    const shuffled = shuffle(state.people);
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

function generateWeeks(numWeeks, numGroups, weeksBack) {
  const allWeeks = [];
  const pairCounts = getPairCounts(weeksBack);

  for (let w = 0; w < numWeeks; w++) {
    const groups = createGroups(numGroups, pairCounts);

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

// ====== CSV Utilities ======
function csvEscape(value) {
  const s = String(value == null ? "" : value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
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

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        field += ch;
        i++;
        continue;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (ch === ",") {
        row.push(field);
        field = "";
        i++;
        continue;
      }
      if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i++;
        continue;
      }
      field += ch;
      i++;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

// ====== CSV Export ======
function maxGroupSize(weeks) {
  let max = 0;
  for (const week of weeks) {
    for (const group of week) {
      if (group.length > max) max = group.length;
    }
  }
  return max;
}

function exportGroupingsCSV(weeks, label) {
  if (!weeks || !weeks.length) {
    alert("Nothing to export.");
    return;
  }

  const cols = maxGroupSize(weeks);
  const includeWeekCol = weeks.length > 1;

  const header = includeWeekCol ? ["Week", "Group"] : ["Group"];
  for (let i = 1; i <= cols; i++) header.push(`Person ${i}`);

  const rows = [header];

  weeks.forEach((week, wIdx) => {
    week.forEach((group, gIdx) => {
      const sorted = group.slice().sort((a, b) => a.localeCompare(b));
      const row = includeWeekCol ? [wIdx + 1, gIdx + 1] : [gIdx + 1];
      for (let i = 0; i < cols; i++) {
        row.push(sorted[i] || "");
      }
      rows.push(row);
    });
  });

  const csv = rowsToCSV(rows);
  downloadFile(csv, `${label}_${timestampForFilename()}.csv`, "text/csv;charset=utf-8");
}

function exportPeopleCSV() {
  if (!state.people.length) {
    alert("No people to export.");
    return;
  }
  const rows = [["Name"]];
  state.people
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .forEach(name => rows.push([name]));
  const csv = rowsToCSV(rows);
  downloadFile(csv, `people_${timestampForFilename()}.csv`, "text/csv;charset=utf-8");
}

// ====== CSV Import: People ======
function importPeopleCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) {
    alert("CSV file is empty.");
    return;
  }

  const firstRow = rows[0].map(c => c.trim().toLowerCase());
  const hasHeader = firstRow.some(c => c === "name" || c === "person" || c === "people");

  const dataRows = hasHeader ? rows.slice(1) : rows;
  const names = [];
  for (const row of dataRows) {
    for (const cell of row) {
      const trimmed = cell.trim();
      if (trimmed) names.push(trimmed);
    }
  }

  let added = 0;
  for (const name of names) {
    if (!state.people.includes(name)) {
      state.people.push(name);
      added++;
    }
  }

  pushState();
  showNotification(`Imported ${added} new name${added === 1 ? "" : "s"} (${names.length - added} duplicate${names.length - added === 1 ? "" : "s"} skipped).`);
}

// ====== UI Helpers ======
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

function renderPeople() {
  const list = document.getElementById("people-list");
  const count = document.getElementById("people-count");
  count.textContent = state.people.length;

  if (!state.people.length) {
    list.innerHTML = '<li class="empty">No people yet. Add some above.</li>';
    return;
  }

  list.innerHTML = "";
  state.people
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .forEach(name => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.textContent = name;
      const btn = document.createElement("button");
      btn.textContent = "×";
      btn.title = "Remove";
      btn.addEventListener("click", () => {
        state.people = state.people.filter(p => p !== name);
        pushState();
      });
      li.appendChild(span);
      li.appendChild(btn);
      list.appendChild(li);
    });
}

function updateGroupInputMax() {
  const input = document.getElementById("num-groups");
  input.max = Math.max(2, state.people.length);
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
    title.textContent = `Generated ${weeks.length} week(s)`;
    weeks.forEach((w, i) => {
      const block = document.createElement("div");
      block.className = "week-block";
      block.appendChild(renderGroupsHTML(w, `Week ${i + 1}`));
      output.appendChild(block);
    });
  } else {
    title.textContent = "Preview";
    output.appendChild(renderGroupsHTML(weeks[0], ""));
  }
  saveRow.classList.remove("hidden");

  area.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderStats() {
  const el = document.getElementById("stats-output");
  el.innerHTML = "";

  if (!state.history.length) {
    el.innerHTML = '<p class="empty">No history yet.</p>';
    return;
  }

  const pairCounts = getPairCounts(null);
  const entries = Object.entries(pairCounts);
  const repeats = entries.filter(([, c]) => c > 1);

  const rows = [
    ["Total unique pairs", entries.length],
    ["Pairs seen more than once", repeats.length],
    ["Total weeks recorded", state.history.length]
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

    repeats
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([key, count]) => {
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
  count.textContent = state.history.length;
  el.innerHTML = "";

  if (!state.history.length) {
    el.innerHTML = '<p class="empty">No history yet. Generate and save weeks to build history.</p>';
    return;
  }

  // Show in descending order: newest week first.
  // Week numbers still reflect the actual stored position (1-based).
  for (let i = state.history.length - 1; i >= 0; i--) {
    const week = state.history[i];
    const block = document.createElement("div");
    block.className = "week-block";
    block.appendChild(renderGroupsHTML(week, `Week ${i + 1}`));
    el.appendChild(block);
  }
}

function refreshAll() {
  renderPeople();
  renderStats();
  renderHistory();
  updateGroupInputMax();
}

// ====== Event Wiring ======
document.addEventListener("DOMContentLoaded", () => {
  initFirebaseListeners();

  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
    });
  });

  document.getElementById("add-btn").addEventListener("click", addPeopleFromInput);
  document.getElementById("add-input").addEventListener("keydown", e => {
    if (e.key === "Enter") addPeopleFromInput();
  });

  function addPeopleFromInput() {
    const input = document.getElementById("add-input");
    const raw = input.value.trim();
    if (!raw) return;

    const names = raw
      .split(/[,\n]/)
      .map(n => n.trim())
      .filter(Boolean);

    let added = 0;
    for (const name of names) {
      if (!state.people.includes(name)) {
        state.people.push(name);
        added++;
      }
    }

    input.value = "";
    pushState();
    showNotification(`Added ${added} name${added === 1 ? "" : "s"}.`);
  }

  document.getElementById("clear-people-btn").addEventListener("click", () => {
    if (!state.people.length) return;
    if (confirm("Remove all people? (History will be kept.)")) {
      state.people = [];
      pushState();
    }
  });

  document.getElementById("preview-btn").addEventListener("click", () => {
    const numGroups = parseInt(document.getElementById("num-groups").value, 10);
    const wbRaw = document.getElementById("weeks-back").value.trim();
    const weeksBack = wbRaw ? parseInt(wbRaw, 10) : null;

    try {
      const pairCounts = getPairCounts(weeksBack);
      const groups = createGroups(numGroups, pairCounts);
      renderPreview([groups], false);
    } catch (e) {
      alert(e.message);
    }
  });

  document.getElementById("generate-btn").addEventListener("click", () => {
    const numGroups = parseInt(document.getElementById("num-groups").value, 10);
    const numWeeks = parseInt(document.getElementById("num-weeks").value, 10);
    const wbRaw = document.getElementById("weeks-back").value.trim();
    const weeksBack = wbRaw ? parseInt(wbRaw, 10) : null;

    if (!numWeeks || numWeeks < 1) {
      alert("Number of weeks must be at least 1.");
      return;
    }

    try {
      const weeks = generateWeeks(numWeeks, numGroups, weeksBack);
      renderPreview(weeks.length === 1 ? [weeks[0]] : weeks, numWeeks > 1);

      // Remember where this batch begins and how many weeks it has,
      // so "Export Latest Generation" exports exactly this batch.
      state.lastGenerationStart = state.history.length;
      state.lastGenerationCount = weeks.length;

      state.history.push(...weeks);
      pushState();
      showNotification(`Saved ${numWeeks} week(s) to shared history.`);
    } catch (e) {
      alert(e.message);
    }
  });

  document.getElementById("save-preview-btn").addEventListener("click", () => {
    if (!currentPreviewWeeks) return;

    // Mark the start and size of this batch too
    state.lastGenerationStart = state.history.length;
    state.lastGenerationCount = currentPreviewWeeks.length;

    state.history.push(...currentPreviewWeeks);
    pushState();
    showNotification(`Saved ${currentPreviewWeeks.length} week(s) to shared history.`);
  });

  document.getElementById("export-preview-csv-btn").addEventListener("click", () => {
    if (!currentPreviewWeeks) return;
    exportGroupingsCSV(currentPreviewWeeks, "preview-groups");
  });

  document.getElementById("clear-history-btn").addEventListener("click", () => {
    if (!state.history.length) return;
    if (confirm("Clear all history for everyone? This affects all users.")) {
      state.history = [];
      state.lastGenerationStart = -1;
      state.lastGenerationCount = 0;
      pushState();
    }
  });

  document.getElementById("export-people-csv-btn").addEventListener("click", exportPeopleCSV);

  document.getElementById("export-latest-csv-btn").addEventListener("click", () => {
    if (!state.history.length) {
      alert("No history to export.");
      return;
    }

    const start = state.lastGenerationStart;
    const count = state.lastGenerationCount;

    // If we have a valid batch recorded, slice exactly that batch.
    if (start >= 0 && count > 0 && start + count <= state.history.length) {
      const latestBatch = state.history.slice(start, start + count);
      exportGroupingsCSV(latestBatch, "latest-generation");
      return;
    }

    // No valid batch info — export the last week only as a fallback.
    exportGroupingsCSV([state.history[state.history.length - 1]], "latest-generation");
  });

  document.getElementById("export-all-csv-btn").addEventListener("click", () => {
    if (!state.history.length) {
      alert("No history to export.");
      return;
    }
    exportGroupingsCSV(state.history, "all-weeks");
  });

  document.getElementById("import-people-csv-btn").addEventListener("click", () => {
    document.getElementById("import-people-file").click();
  });

  document.getElementById("import-people-file").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        importPeopleCSV(ev.target.result);
      } catch (err) {
        alert("Failed to import CSV: " + err.message);
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });
});
