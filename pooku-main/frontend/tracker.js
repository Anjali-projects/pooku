const API_URL = 'https://pooku.onrender.com/api';

let habits = [];
let allLogs = {};
let selectedEmoji = '⭐';
let notifInterval = null;
let currentUserId = null;
let currentUsername = '';
let habitStreaks = {};
let habitNotes = {};

// Check authentication
function checkAuth() {
  currentUserId = localStorage.getItem('userId');
  currentUsername = localStorage.getItem('username');

  if (!localStorage.getItem('authenticated')) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function setSyncStatus(s) {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-label');
  if (s === 'ok') {
    dot.className = 'sync-dot green';
    lbl.textContent = 'Synced ✓';
  } else if (s === 'loading') {
    dot.className = 'sync-dot orange';
    lbl.textContent = 'Syncing...';
  } else {
    dot.className = 'sync-dot red';
    lbl.textContent = 'Sync error';
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// API CALLS
async function apiCall(endpoint, method = 'GET', body = null, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const token = localStorage.getItem('token');
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(`${API_URL}${endpoint}`, options);

      if (response.status === 401) {
        logout();
        return null;
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const msg = error.error || error.message || 'Something went wrong';
        showToast(msg);
        console.error('API Error:', error);
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error(`API call error (attempt ${attempt + 1}):`, error);
      if (attempt < retries) {
        setSyncStatus('loading');
        showToast('Server is waking up... retrying');
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      showToast('Unable to reach server. Please try again.');
      setSyncStatus('error');
      return null;
    }
  }
}

// LOAD DATA
async function loadHabits() {
  const data = await apiCall('/habits');
  if (data) {
    habits = data;
    renderToday();
    renderManage();
  }
}

async function loadTodayLog() {
  const key = todayKey();
  const completions = await apiCall(`/logs/${key}`);
  if (completions) {
    allLogs[key] = {
      done: completions.completedHabits || [],
      mood: '',
      journal: ''
    };

    const details = await apiCall(`/logs/details/${key}`);
    if (details) {
      allLogs[key].mood = details.mood || '';
      allLogs[key].journal = details.journal || '';
    }

    renderToday();
  }
}

async function loadAllLogs() {
  const data = await apiCall('/logs');
  if (data) {
    allLogs = data;
  }
}

async function loadStreaks() {
  const analytics = await apiCall('/analytics');
  if (analytics && analytics.habitStats) {
    habitStreaks = {};
    for (const [id, stat] of Object.entries(analytics.habitStats)) {
      habitStreaks[Number(id)] = stat.currentStreak || 0;
    }
  }
}

// HABIT FUNCTIONS
window.toggleHabit = async function (id) {
  const key = todayKey();
  const result = await apiCall('/logs/toggle', 'POST', { habitId: id, logDate: key });

  if (result) {
    // Haptic feedback
    triggerHaptic();

    setSyncStatus('loading');
    await loadTodayLog();
    await loadStreaks();
    renderToday();
    setSyncStatus('ok');

    // Check for 100% completion → confetti
    checkCelebration();
  }
};

window.selectMood = function (btn, mood) {
  document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  saveLogData();
};

window.saveDay = async function () {
  await saveLogData();
  showToast('Saved! Great job today');
};

async function saveLogData() {
  const key = todayKey();
  const mood = document.querySelector('.mood-btn.selected')?.textContent.trim() || '';
  const journal = document.getElementById('journal-box').value;

  setSyncStatus('loading');
  await apiCall('/logs/save', 'POST', { logDate: key, mood, journal });
  setSyncStatus('ok');
}

window.addHabit = async function () {
  const name = document.getElementById('habit-name-input').value.trim();
  if (!name) {
    showToast('Please enter a habit name');
    return;
  }

  const frequency = document.getElementById('habit-freq-input').value;
  const category = document.getElementById('habit-cat-input').value;
  const my_why = document.getElementById('habit-why-input').value.trim();
  const result = await apiCall('/habits', 'POST', { name, icon: selectedEmoji, frequency, category, my_why });
  if (result) {
    document.getElementById('habit-name-input').value = '';
    document.getElementById('habit-freq-input').value = 'daily';
    document.getElementById('habit-cat-input').value = '';
    document.getElementById('habit-why-input').value = '';
    showToast('Habit added!');
    await loadHabits();
  }
};

window.deleteHabit = async function (id) {
  if (confirm('Delete this habit?')) {
    setSyncStatus('loading');
    await apiCall(`/habits/${id}`, 'DELETE');
    showToast('Habit removed');
    await loadHabits();
    setSyncStatus('ok');
  }
};

// RENDER FUNCTIONS
function renderToday() {
  const key = todayKey();
  const log = allLogs[key] || { done: [], mood: '', journal: '' };
  const list = document.getElementById('habits-list');
  list.innerHTML = '';

  const todayDow = new Date().getDay(); // 0=Sun, 6=Sat
  const isWeekday = todayDow >= 1 && todayDow <= 5;
  const isWeekend = todayDow === 0 || todayDow === 6;

  const todayHabits = habits.filter(h => {
    const freq = h.frequency || 'daily';
    if (freq === 'daily') return true;
    if (freq === 'weekdays') return isWeekday;
    if (freq === 'weekends') return isWeekend;
    if (freq === 'weekly' || freq === '3x_week') return true;
    return true;
  });

  // Empty state for no habits
  if (todayHabits.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <span class="empty-state-emoji">🌱</span>
      <h3>Your habits live here</h3>
      <p>You haven't added any habits yet. Start with something small — even one habit a day can change your life.</p>
      <button class="empty-state-btn" onclick="switchView('manage')">+ Add your first habit</button>
    </div>`;
    updateProgress(todayHabits);
    return;
  }

  // Try grouped rendering if habits have categories
  if (!renderGroupedHabits(todayHabits, log, key)) {
    // Flat rendering fallback
    todayHabits.forEach(h => {
      const done = log.done && log.done.includes(h.id);
      const streak = habitStreaks[h.id] || 0;
      const plant = getPlantStage(streak, done);
      const streakText = streak > 0 ? `${streak} day streak ${plant.emoji}` : 'Start your journey!';
      const noteKey = `${key}_${h.id}`;
      const hasNote = habitNotes[noteKey] ? ' has-note' : '';
      const whyHtml = h.my_why ? `<div class="habit-why">${escapeHtml(h.my_why)}</div>` : '';
      const growthPct = Math.min(streak, plant.nextAt) / plant.nextAt * 100;
      const plantBar = streak > 0 ? `<div class="plant-growth-bar"><div class="plant-growth-fill" style="width:${growthPct}%"></div></div>` : '';
      const card = document.createElement('div');
      card.className = 'habit-card' + (done ? ' done' : '');
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `${h.name} - ${done ? 'completed' : 'not completed'}. ${streakText}`);
      card.innerHTML = `<div class="habit-icon ${getIconCategory(h.icon)}">${h.icon}</div><div class="habit-info"><div class="habit-name">${escapeHtml(h.name)}</div><div class="habit-streak">${streakText}</div>${plantBar}${whyHtml}</div><button class="habit-note-btn${hasNote}" onclick="event.stopPropagation();openHabitNote(${h.id}, '${escapeHtml(h.name).replace(/'/g, "\\'")}')" title="Add note" aria-label="Add note for ${escapeHtml(h.name)}">📝</button><div class="habit-check"><span class="checkmark">✓</span></div>`;
      card.onclick = () => toggleHabit(h.id);
      if (h.my_why) {
        let pressTimer;
        card.addEventListener('pointerdown', () => { pressTimer = setTimeout(() => card.classList.toggle('expanded'), 500); });
        card.addEventListener('pointerup', () => clearTimeout(pressTimer));
        card.addEventListener('pointerleave', () => clearTimeout(pressTimer));
      }
      card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleHabit(h.id); } };
      list.appendChild(card);
    });
  }

  updateProgress(todayHabits);

  if (log.mood) {
    document.querySelectorAll('.mood-btn').forEach(b => {
      b.classList.toggle('selected', b.textContent.trim() === log.mood);
    });
  }

  document.getElementById('journal-box').value = log.journal || '';
}

function updateProgress(todayHabits) {
  const key = todayKey();
  const log = allLogs[key] || { done: [] };
  const filteredHabits = todayHabits || habits;
  const total = filteredHabits.length;
  const done = (log.done || []).filter(id => filteredHabits.some(h => h.id === id)).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  document.getElementById('progress-pct').textContent = pct + '%';
  // 326.7 = 2 * π * 52 (new ring radius)
  document.getElementById('progress-arc').style.strokeDashoffset = 326.7 - (pct / 100) * 326.7;

  const labels = [
    "Let's start your day!",
    'Great start, keep going',
    'Halfway there!',
    'Almost done, so close',
    'All done! Amazing!'
  ];
  document.getElementById('progress-label').textContent = labels[Math.min(Math.floor(pct / 25), 4)];
  document.getElementById('progress-sub').textContent = `${done} of ${total} habits completed`;

  // Glow effect when progressing
  const glow = document.getElementById('progress-glow');
  if (glow) {
    if (pct > 0 && pct < 100) glow.classList.add('active');
    else glow.classList.remove('active');
  }
}

function renderManage() {
  const list = document.getElementById('manage-list');
  list.innerHTML = '';

  const FREQ_LABELS = { daily: 'Daily', weekdays: 'Weekdays', weekends: 'Weekends', weekly: 'Weekly', '3x_week': '3x/wk' };

  if (habits.length === 0) {
    list.innerHTML = getEmptyManageHtml();
  }

  habits.forEach(h => {
    const freqLabel = FREQ_LABELS[h.frequency] || 'Daily';
    const freqBadge = h.frequency && h.frequency !== 'daily' ? `<span class="habit-freq">${freqLabel}</span>` : '';
    const card = document.createElement('div');
    card.className = 'manage-card';
    card.innerHTML = `<div class="manage-icon">${h.icon}</div><div class="manage-name">${escapeHtml(h.name)}${freqBadge}</div><button class="manage-del" onclick="openEditHabit(${h.id}, '${escapeHtml(h.name).replace(/'/g, "\\'")}', '${h.icon}')" title="Edit" aria-label="Edit ${escapeHtml(h.name)}" style="color:var(--accent-dark);">✎</button><button class="btn-archive" onclick="archiveHabit(${h.id})" title="Archive" aria-label="Archive ${escapeHtml(h.name)}">📦</button><button class="manage-del" onclick="deleteHabit(${h.id})" title="Delete" aria-label="Delete ${escapeHtml(h.name)}">×</button>`;
    list.appendChild(card);
  });

  // Load archived habits count
  loadArchivedHabits();

  const EMOJIS = ['🏋️', '💧', '🧘', '🚶', '🎨', '💤', '📚', '🌿', '☀️', '🍎', '💊', '🧹', '✍️', '🎵', '🧴', '🏃', '🛏️', '💻', '🥗', '🌊'];
  const er = document.getElementById('emoji-row');
  er.innerHTML = '';

  EMOJIS.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'emoji-pick' + (e === selectedEmoji ? ' selected' : '');
    btn.textContent = e;
    btn.onclick = () => {
      selectedEmoji = e;
      renderManage();
    };
    er.appendChild(btn);
  });

  // Render template packs
  renderTemplatePacks();
}

async function renderProgress() {
  const stats = await apiCall('/stats');
  if (stats) {
    document.getElementById('stats-row').innerHTML = `
      <div class="stat-card"><div class="stat-num">${stats.daysTracked}</div><div class="stat-label">Days tracked</div></div>
      <div class="stat-card"><div class="stat-num">${stats.totalCompleted}</div><div class="stat-label">Completed</div></div>
      <div class="stat-card"><div class="stat-num">${stats.bestStreak}</div><div class="stat-label">Best streak</div></div>
    `;
  }

  const bc = document.getElementById('bar-chart');
  bc.innerHTML = '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = d.toISOString().slice(0, 10);
    const log = allLogs[k];
    const done = log ? (log.done || []).length : 0;
    const tot = habits.length || 1;
    const pct = Math.round((done / tot) * 100);

    const w = document.createElement('div');
    w.className = 'bar-wrap';
    w.innerHTML = `
      <div class="bar-val">${done > 0 ? done : ''}</div>
      <div class="bar" style="height:${Math.max(pct, 4)}%"></div>
      <div class="bar-label">${days[d.getDay()]}</div>
    `;
    bc.appendChild(w);
  }

  const pl = document.getElementById('hprog-list');
  pl.innerHTML = '';

  habits.forEach(h => {
    let count = 0;
    for (const key in allLogs) {
      if (allLogs[key].done && allLogs[key].done.includes(h.id)) {
        count++;
      }
    }
    const total = Object.keys(allLogs).length || 1;
    const pct = Math.round((count / total) * 100);

    pl.innerHTML += `
      <div class="hprog-item">
        <div class="hprog-name">${h.icon} ${escapeHtml(h.name)}</div>
        <div class="prog-bg"><div class="prog-fill" style="width:${pct}%"></div></div>
        <div class="prog-pct">${pct}%</div>
      </div>
    `;
  });
}

// VIEW SWITCHING
const VIEW_LIST = ['today', 'manage', 'progress', 'calendar', 'reminders', 'analytics', 'friends', 'settings'];

window.switchView = function (v) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el => { el.classList.remove('active'); el.setAttribute('aria-selected', 'false'); });
  document.getElementById('view-' + v).classList.add('active');
  const activeTab = document.querySelectorAll('.nav-tab')[VIEW_LIST.indexOf(v)];
  activeTab.classList.add('active');
  activeTab.setAttribute('aria-selected', 'true');

  if (v === 'progress') { showSkeleton('stats-row', 'cards'); showSkeleton('bar-chart', 'bars'); renderProgress(); }
  if (v === 'manage') renderManage();
  if (v === 'calendar') renderCalendar();
  if (v === 'reminders') renderReminders();
  if (v === 'analytics') { showSkeleton('analytics-list', 'cards'); renderAnalytics(); loadMoodTrends(30); }
  if (v === 'friends') renderFriends();
  if (v === 'settings') renderSettings();
};

// NOTIFICATION
window.openNotifModal = () => { document.getElementById('notif-modal').classList.add('open'); trapFocus(document.getElementById('notif-modal')); };
window.closeModal = id => { document.getElementById(id).classList.remove('open'); releaseFocus(); };

window.setReminder = function () {
  const time = document.getElementById('notif-time').value;
  if (!time) return;

  if ('Notification' in window) {
    Notification.requestPermission().then(p => {
      if (p === 'granted') {
        localStorage.setItem('reminderTime', time);
        scheduleReminder(time);
        document.getElementById('notif-btn').classList.add('on');
        document.getElementById('notif-btn').textContent = 'Reminder on';
        closeModal('notif-modal');
        showToast('Reminder set!');
      } else {
        showToast('Allow notifications in browser settings');
      }
    });
  }
};

function scheduleReminder(time) {
  if (notifInterval) clearInterval(notifInterval);
  notifInterval = setInterval(() => {
    const now = new Date();
    const cur = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    if (cur === time) {
      const key = todayKey();
      const log = allLogs[key] || { done: [] };
      const done = (log.done || []).length;
      const tot = habits.length;
      new Notification("Pooku", {
        body: `You've done ${done}/${tot} habits today. Keep going!`
      });
    }
  }, 60000);
}

window.logout = async function () {
  try {
    const token = localStorage.getItem('token');
    await fetch(`${API_URL}/auth/logout`, { method: 'POST', headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
  } catch (e) { /* ignore */ }
  localStorage.removeItem('authenticated');
  localStorage.removeItem('userId');
  localStorage.removeItem('username');
  localStorage.removeItem('token');
  window.location.href = 'login.html';
};

// INITIALIZATION
async function init() {
  if (!checkAuth()) return;

  initDarkMode();

  document.getElementById('user-name').textContent = currentUsername;

  const now = new Date();
  const h = now.getHours();
  document.getElementById('time-greeting').textContent = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  document.getElementById('date-pill').textContent = now.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });

  const QUOTES = [
    '"Small steps every day lead to big change."',
    '"Believe you can and you\'re halfway there."',
    '"You don\'t have to be great to start, but start to be great."',
    '"Every day is a new chance to be better."',
    '"Your only limit is your mind."',
    '"Discipline is choosing what you want most."',
    '"Be proud of every step forward, no matter how small."',
    '"The secret of getting ahead is getting started."',
    '"It does not matter how slowly you go, as long as you do not stop."',
    '"What you do today can improve all your tomorrows."',
    '"Don\'t watch the clock; do what it does. Keep going."',
    '"A journey of a thousand miles begins with a single step."',
    '"Success is the sum of small efforts, repeated day in and day out."',
    '"Motivation gets you started. Habit keeps you going."',
    '"The best time to plant a tree was 20 years ago. The second best is now."',
    '"You are never too old to set another goal or dream a new dream."',
    '"Progress is progress, no matter how small."',
    '"Wake up determined. Go to bed satisfied."',
    '"The only bad workout is the one that didn\'t happen."',
    '"Strive for progress, not perfection."',
    '"Your habits shape your identity."',
    '"Fall seven times, stand up eight."',
    '"Be stronger than your excuses."',
    '"Consistency is the key to mastery."',
    '"One day or day one. You decide."',
    '"Start where you are. Use what you have. Do what you can."',
    '"The harder you work for something, the greater you feel when you achieve it."',
    '"Dream big. Start small. Act now."',
    '"Push yourself, because no one else is going to do it for you."',
    '"Great things never come from comfort zones."',
    '"Today is a good day to have a good day."',
    '"You\'re braver than you believe and stronger than you seem."',
    '"A little progress each day adds up to big results."',
    '"Don\'t limit your challenges. Challenge your limits."',
    '"Set your goals high and don\'t stop till you get there."',
    '"The future depends on what you do today."',
    '"Be the change you wish to see."',
    '"Happiness is not something ready-made. It comes from your own actions."',
    '"Difficult roads often lead to beautiful destinations."',
    '"It always seems impossible until it\'s done."',
    '"Your body hears everything your mind says. Stay positive."',
    '"The pain you feel today will be the strength you feel tomorrow."',
    '"You are what you do, not what you say you\'ll do."',
    '"Action is the foundational key to all success."',
    '"Life is 10% what happens to you and 90% how you react to it."',
    '"The only way to do great work is to love what you do."',
    '"Don\'t let yesterday take up too much of today."',
    '"In the middle of every difficulty lies opportunity."',
    '"Tough times never last, but tough people do."',
    '"Inch by inch, anything\'s a cinch."',
    '"Energy and persistence conquer all things."',
    '"Be patient with yourself. Self-growth is tender."',
    '"Your vibe attracts your tribe."'
  ];
  // Seed random quote based on date (different each day, stable within a day)
  const dateSeed = now.getFullYear() * 10000 + (now.getMonth()+1) * 100 + now.getDate();
  document.getElementById('daily-quote').textContent = QUOTES[dateSeed % QUOTES.length];

  // Show skeleton loading states
  showSkeleton('habits-list', 'habits');

  setSyncStatus('loading');
  try {
    await loadHabits();
    await loadTodayLog();
    await loadAllLogs();
    await loadStreaks();
    await loadHabitNotes();
    renderToday();
    setSyncStatus('ok');
  } catch (e) {
    console.error('Data load error:', e);
    setSyncStatus('error');
  }

  // Render badge strip on Today view
  renderBadgeStrip();
  // Render avatar displays
  renderAvatarDisplays();

  // Daily check-in & journal
  doCheckIn().catch(e => console.error('Check-in error:', e));
  checkFloatingJournal();
  checkWeeklyReflection();
  // SSE for real-time chat
  try { connectChatSSE(); } catch(e) { console.error('Chat SSE error:', e); }

  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('app').style.display = '';

  showOnboarding();

  initThemeColor();
  setupTypingIndicator();
  scheduleWeeklySummary();
  flushSyncQueue();
  showEveningSummary();
  checkStreakFreezeEarned();

  // New features
  applySeasonalTheme();
  checkBedtimeMode();
  loadTimeCapsules();
  loadTodayVoiceJournal();

  const savedTime = localStorage.getItem('reminderTime');
  if (savedTime && Notification.permission === 'granted') {
    scheduleReminder(savedTime);
    document.getElementById('notif-btn').classList.add('on');
    document.getElementById('notif-btn').textContent = 'Reminder on';
  }

  // PWA shortcut hash routing
  const hash = window.location.hash.replace('#', '');
  if (hash && ['today','manage','progress','calendar','reminders','analytics','friends','settings'].includes(hash)) {
    switchView(hash);
  }
}

// CALENDAR VIEW
let currentCalendarMonth = new Date().getMonth();
let currentCalendarYear = new Date().getFullYear();

window.renderCalendar = async function() {
  await loadTodayLog();
  renderWeekStrip();
  
  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
  
  document.getElementById('calendar-month-year').textContent = 
    `${monthNames[currentCalendarMonth]} ${currentCalendarYear}`;

  // First day of month and total days
  const firstDay = new Date(currentCalendarYear, currentCalendarMonth, 1).getDay();
  const daysInMonth = new Date(currentCalendarYear, currentCalendarMonth + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getMonth() === currentCalendarMonth && today.getFullYear() === currentCalendarYear;

  // Previous month's days
  const prevMonthDays = new Date(currentCalendarYear, currentCalendarMonth, 0).getDate();
  for (let i = firstDay - 1; i >= 0; i--) {
    const dayEl = document.createElement('div');
    dayEl.className = 'calendar-day other-month';
    dayEl.innerHTML = `<div class="day-num">${prevMonthDays - i}</div>`;
    grid.appendChild(dayEl);
  }

  // Current month's days
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${currentCalendarYear}-${String(currentCalendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayEl = document.createElement('div');
    dayEl.className = 'calendar-day';
    
    if (isCurrentMonth && day === today.getDate()) {
      dayEl.classList.add('today');
    }

    const log = allLogs[dateStr];
    const completedCount = log ? (log.done || []).length : 0;
    const totalHabits = habits.length || 1;

    let habitsHTML = '';
    if (log && log.done && log.done.length > 0) {
      habits.forEach(h => {
        if (log.done.includes(h.id)) {
          habitsHTML += `<span class="habit-emoji" title="${escapeHtml(h.name)}">${h.icon}</span>`;
        }
      });
    }

    dayEl.innerHTML = `
      <div class="day-num">${day}</div>
      <div class="day-habits">${habitsHTML}</div>
      ${completedCount > 0 ? `<div style="font-size:9px;color:var(--success);margin-top:1px;font-weight:500;">${completedCount}/${totalHabits}</div>` : ''}
    `;
    dayEl.onclick = () => showDayDetail(dateStr, day);
    grid.appendChild(dayEl);
  }

  // Next month's days
  const totalCells = grid.children.length;
  const remainingCells = 42 - totalCells;
  for (let day = 1; day <= remainingCells; day++) {
    const dayEl = document.createElement('div');
    dayEl.className = 'calendar-day other-month';
    dayEl.innerHTML = `<div class="day-num">${day}</div>`;
    grid.appendChild(dayEl);
  }
};

window.prevMonth = function() {
  currentCalendarMonth--;
  if (currentCalendarMonth < 0) {
    currentCalendarMonth = 11;
    currentCalendarYear--;
  }
  renderCalendar();
};

window.nextMonth = function() {
  currentCalendarMonth++;
  if (currentCalendarMonth > 11) {
    currentCalendarMonth = 0;
    currentCalendarYear++;
  }
  renderCalendar();
};

// REMINDERS
window.renderReminders = async function() {
  const reminders = await apiCall('/reminders');
  if (!reminders) return;

  const list = document.getElementById('reminders-list');
  list.innerHTML = '';

  if (!habits.length) {
    list.innerHTML = '<p style="text-align:center;color:var(--muted);padding:2rem;">No habits yet. Add some to set reminders!</p>';
    return;
  }

  habits.forEach(h => {
    const reminder = reminders.find(r => r.habit_id === h.id);
    const time = reminder?.reminder_time || '09:00';

    const card = document.createElement('div');
    card.className = 'reminder-card';
    card.innerHTML = `
      <div class="reminder-info">
        <div class="reminder-habit">${h.icon} ${escapeHtml(h.name)}</div>
        <div class="reminder-time">Time: ${time}</div>
      </div>
      <input type="time" class="reminder-input" value="${time}" onchange="saveReminder(${h.id}, this.value)">
      <button class="reminder-btn" onclick="deleteReminder(${h.id})" aria-label="Delete reminder for ${escapeHtml(h.name)}">✕</button>
    `;
    list.appendChild(card);
  });
};

window.saveReminder = async function(habitId, time) {
  await apiCall('/reminders', 'POST', { habitId, reminderTime: time, enabled: 1 });
  showToast('Reminder saved!');
  renderReminders();
};

window.deleteReminder = async function(habitId) {
  await apiCall(`/reminders/${habitId}`, 'DELETE');
  showToast('Reminder deleted');
  renderReminders();
};

// ADVANCED ANALYTICS
window.renderAnalytics = async function() {
  const analytics = await apiCall('/analytics');
  if (!analytics) return;

  const list = document.getElementById('analytics-list');
  list.innerHTML = '';

  Object.values(analytics.habitStats).forEach(stat => {
    const card = document.createElement('div');
    card.className = 'analytics-card';

    const streakEmoji = stat.currentStreak > 0 ? 'Active' : 'Inactive';
    
    card.innerHTML = `
      <div class="analytics-header">
        <div class="analytics-name">
          ${stat.icon} ${stat.name}
          <span class="analytics-badge">${stat.rate30Day}%</span>
        </div>
      </div>
      <div class="analytics-row">
        <span>Total completed</span>
        <span class="analytics-value">${stat.totalCompletions}</span>
      </div>
      <div class="analytics-row">
        <span>Current streak</span>
        <span class="analytics-value">${stat.currentStreak} days</span>
      </div>
      <div class="analytics-row">
        <span>30-day rate</span>
        <span class="analytics-value">${stat.rate30Day}%</span>
      </div>
      <div class="analytics-streak">${streakEmoji} ${stat.currentStreak > 0 ? 'Keep it going!' : 'Start a new streak'}</div>
    `;
    list.appendChild(card);
  });

  if (Object.keys(analytics.habitStats).length === 0) {
    list.innerHTML = '<p style="text-align:center;color:var(--muted);padding:2rem;">No data yet. Start tracking habits to see analytics!</p>';
  }
};

// ============ FRIENDS & SOCIAL ============

let currentChatFriendId = null;
let chatPollInterval = null;

window.searchFriends = async function() {
  const query = document.getElementById('friend-search-input').value.trim();
  const container = document.getElementById('search-results');
  if (!query || query.length < 2) {
    container.innerHTML = '';
    showToast('Type at least 2 characters');
    return;
  }

  const users = await apiCall(`/users/search?query=${encodeURIComponent(query)}`);
  container.innerHTML = '';

  if (!users || users.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:12px;color:var(--muted);font-size:13px;">No users found</div>';
    return;
  }

  users.forEach(u => {
    const initials = u.username.slice(0, 2).toUpperCase();
    const card = document.createElement('div');
    card.className = 'search-result-card';
    card.innerHTML = `
      <div class="search-result-info">
        <div class="search-avatar">${initials}</div>
        <div class="search-name">${escapeHtml(u.username)}</div>
      </div>
      <button class="add-friend-btn" onclick="addFriend(${u.id}, this)">+ Add Friend</button>
    `;
    container.appendChild(card);
  });
};

window.addFriend = async function(friendId, btn) {
  btn.disabled = true;
  btn.textContent = 'Sending...';
  const result = await apiCall('/friends/add', 'POST', { friendId });
  if (result) {
    btn.textContent = 'Sent ✓';
    btn.style.background = 'var(--success)';
    showToast('Friend request sent!');
  } else {
    btn.textContent = 'Failed';
    btn.disabled = false;
  }
};

window.acceptFriend = async function(friendId) {
  const result = await apiCall('/friends/accept', 'POST', { friendId });
  if (result) {
    showToast('Friend request accepted!');
    renderFriends();
  }
};

window.renderFriends = async function() {
  const friends = await apiCall('/friends');
  if (!friends) return;

  // Render leaderboard
  renderLeaderboard();
  // Render shared challenges
  loadChallenges();

  const accepted = friends.filter(f => f.status === 'accepted');
  const pending = friends.filter(f => f.status === 'pending');

  // Pending requests
  const pendingSection = document.getElementById('pending-section');
  const pendingList = document.getElementById('pending-list');
  document.getElementById('pending-count').textContent = pending.length;

  if (pending.length > 0) {
    pendingSection.style.display = 'block';
    pendingList.innerHTML = '';
    pending.forEach(f => {
      const initials = f.username.slice(0, 2).toUpperCase();
      const card = document.createElement('div');
      card.className = 'friend-card';
      card.innerHTML = `
        <div class="friend-avatar">${initials}</div>
        <div class="friend-details">
          <div class="friend-username">${escapeHtml(f.username)}</div>
          <div class="friend-status">Wants to be friends</div>
        </div>
        <div class="friend-actions">
          <button class="friend-action-btn btn-accept" onclick="event.stopPropagation();acceptFriend(${f.id})">Accept</button>
          <button class="friend-action-btn btn-decline" onclick="event.stopPropagation();declineFriend(${f.id})">Decline</button>
        </div>
      `;
      pendingList.appendChild(card);
    });
  } else {
    pendingSection.style.display = 'none';
  }

  // Accepted friends
  const friendsList = document.getElementById('friends-list');
  document.getElementById('friends-count').textContent = accepted.length;
  friendsList.innerHTML = '';

  if (accepted.length === 0) {
    friendsList.innerHTML = '<div class="no-friends-msg"><span class="emoji" style="font-size:2.5rem;display:block;margin-bottom:8px;">—</span>No friends yet. Search for users above to connect!</div>';
    return;
  }

  accepted.forEach(f => {
    const initials = f.username.slice(0, 2).toUpperCase();
    const card = document.createElement('div');
    card.className = 'friend-card';
    card.innerHTML = `
      <div class="friend-avatar">${initials}</div>
      <div class="friend-details">
        <div class="friend-username">${escapeHtml(f.username)}</div>
        <div class="friend-status online">Friend</div>
      </div>
      <div class="friend-actions">
        <button class="friend-action-btn btn-view" onclick="event.stopPropagation();viewFriendProgress(${f.id}, '${escapeHtml(f.username)}')">Progress</button>
        <button class="friend-action-btn btn-view" onclick="event.stopPropagation();viewFriendComparison(${f.id}, '${escapeHtml(f.username)}')" style="background:var(--success-light);color:var(--success);">Compare</button>
        <button class="friend-action-btn btn-chat" onclick="event.stopPropagation();openFriendChat(${f.id}, '${escapeHtml(f.username)}')">Chat</button>
        <button class="friend-action-btn btn-decline" onclick="event.stopPropagation();unfriend(${f.id}, '${escapeHtml(f.username)}')" title="Remove friend">✕</button>
      </div>
    `;
    friendsList.appendChild(card);
  });
};

// Friend Progress
window.viewFriendProgress = async function(friendId, username) {
  document.getElementById('friends-main-panel').style.display = 'none';
  document.getElementById('friend-chat-panel').style.display = 'none';
  document.getElementById('friend-progress-panel').style.display = 'block';

  const content = document.getElementById('friend-progress-content');
  content.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted);">Loading...</div>';

  const data = await apiCall(`/friends/${friendId}/progress`);
  if (!data) {
    content.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted);">Could not load progress</div>';
    return;
  }

  const initials = username.slice(0, 2).toUpperCase();
  const completedCount = data.completed ? data.completed.length : 0;
  const totalHabits = data.habits ? data.habits.length : 0;
  const pct = totalHabits > 0 ? Math.round((completedCount / totalHabits) * 100) : 0;

  let habitsHtml = '';
  if (data.habits && data.habits.length > 0) {
    data.habits.forEach(h => {
      const isDone = data.completed && data.completed.includes(h.id);
      habitsHtml += `
        <div class="friend-habit-item ${isDone ? 'completed' : ''}">
          <span class="friend-habit-icon">${h.icon}</span>
          <span class="friend-habit-name">${escapeHtml(h.name)}</span>
          <span class="friend-habit-status">${isDone ? '✅' : '⬜'}</span>
        </div>
      `;
    });
  } else {
    habitsHtml = '<div style="text-align:center;padding:1rem;color:var(--muted);font-size:13px;">No habits yet</div>';
  }

  content.innerHTML = `
    <div class="friend-progress-card">
      <div class="friend-progress-header">
        <div class="friend-progress-avatar">${initials}</div>
        <div>
          <div class="friend-progress-name">${escapeHtml(username)}'s Today</div>
          <div class="friend-progress-sub">${completedCount}/${totalHabits} habits completed (${pct}%)</div>
        </div>
      </div>
      <div class="friend-habit-list">
        ${habitsHtml}
      </div>
    </div>
  `;
};

window.closeFriendProgress = function() {
  document.getElementById('friend-progress-panel').style.display = 'none';
  document.getElementById('friends-main-panel').style.display = 'block';
};

// Chat / Messaging
window.openFriendChat = async function(friendId, username) {
  currentChatFriendId = friendId;

  document.getElementById('friends-main-panel').style.display = 'none';
  document.getElementById('friend-progress-panel').style.display = 'none';
  document.getElementById('friend-chat-panel').style.display = 'block';

  const initials = username.slice(0, 2).toUpperCase();
  document.getElementById('chat-avatar').textContent = initials;
  document.getElementById('chat-name').textContent = username;
  document.getElementById('chat-input').value = '';

  await loadMessages(friendId);

  // Auto-scroll to bottom on first open
  setTimeout(() => {
    const container = document.getElementById('chat-messages');
    container.scrollTop = container.scrollHeight;
  }, 100);

  // Poll for new messages every 5 seconds (SSE handles real-time, this is fallback)
  if (chatPollInterval) clearInterval(chatPollInterval);
  chatPollInterval = setInterval(() => loadMessages(friendId), 15000);
};

window.closeFriendChat = function() {
  if (chatPollInterval) { clearInterval(chatPollInterval); chatPollInterval = null; }
  currentChatFriendId = null;
  document.getElementById('friend-chat-panel').style.display = 'none';
  document.getElementById('friends-main-panel').style.display = 'block';
};

async function loadMessages(friendId) {
  const messages = await apiCall(`/messages/${friendId}`);
  const container = document.getElementById('chat-messages');

  // Check typing status
  const typingData = await apiCall(`/messages/typing/${friendId}`);
  const indicator = document.getElementById('typing-indicator');
  if (typingData && typingData.typing) {
    indicator.classList.add('visible');
  } else {
    indicator.classList.remove('visible');
  }

  if (!messages || messages.length === 0) {
    container.innerHTML = '<div class="chat-empty">No messages yet. Say hello!</div>';
    return;
  }

  const wasAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 30;

  container.innerHTML = '';
  messages.forEach(m => {
    const isSent = m.sender_id == currentUserId;
    const time = new Date(m.created_at + (m.created_at.endsWith('Z') ? '' : 'Z')).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const readIcon = isSent ? `<span class="chat-read ${m.read_status ? 'read' : ''}">${m.read_status ? '✓✓' : '✓'}</span>` : '';
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isSent ? 'sent' : 'received'}`;
    bubble.innerHTML = `${escapeHtml(m.message)}<span class="chat-time">${time} ${readIcon}</span>`;
    container.appendChild(bubble);
  });

  if (wasAtBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

window.sendMessage = async function() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message || !currentChatFriendId) return;

  input.value = '';
  const result = await apiCall('/messages/send-sse', 'POST', {
    receiverId: currentChatFriendId,
    message
  });

  if (result) {
    await loadMessages(currentChatFriendId);
    const container = document.getElementById('chat-messages');
    container.scrollTop = container.scrollHeight;
  }
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============ CALENDAR DAY DETAIL ============
let currentDetailDate = null;

window.showDayDetail = async function(dateStr, day) {
  currentDetailDate = dateStr;
  const modal = document.getElementById('day-detail-modal');
  const content = document.getElementById('day-detail-content');

  const dateObj = new Date(dateStr + 'T12:00:00');
  const formatted = dateObj.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Get day's log data
  const log = allLogs[dateStr];
  const completedIds = log ? (log.done || []) : [];

  // Fetch mood/journal for this date
  let mood = '', journal = '';
  const details = await apiCall(`/logs/details/${dateStr}`);
  if (details) {
    mood = details.mood || '';
    journal = details.journal || '';
  }

  // Build habits list — clickable to toggle
  let habitsHtml = '';
  if (habits.length > 0) {
    habits.forEach(h => {
      const isDone = completedIds.includes(h.id);
      habitsHtml += `<div class="day-detail-habit ${isDone ? 'done' : ''}" onclick="togglePastHabit(${h.id}, '${dateStr}')" style="cursor:pointer;"><span class="icon">${h.icon}</span><span class="name">${escapeHtml(h.name)}</span><span class="status">${isDone ? '✅' : '⬜'}</span></div>`;
    });
  } else {
    habitsHtml = '<div class="day-detail-empty">No habits tracked yet</div>';
  }

  const doneCount = completedIds.length;
  const totalCount = habits.length;

  content.innerHTML = `
    <div class="day-detail-date">${formatted}</div>
    <div class="day-detail-sub" id="day-detail-count">${doneCount} of ${totalCount} habits completed</div>
    <div class="day-detail-section">
      <h4>Habits <span style="font-size:10px;font-weight:400;color:var(--muted);text-transform:none;">(tap to toggle)</span></h4>
      <div id="day-detail-habits">${habitsHtml}</div>
    </div>
    <div class="day-detail-section">
      <h4>Mood</h4>
      ${mood ? `<div class="day-detail-mood">${escapeHtml(mood)}</div>` : '<div class="day-detail-empty">No mood recorded</div>'}
    </div>
    <div class="day-detail-section">
      <h4>Journal</h4>
      ${journal ? `<div class="day-detail-journal">${escapeHtml(journal)}</div>` : '<div class="day-detail-empty">No journal entry</div>'}
    </div>
    <button class="day-detail-close" onclick="closeDayDetail()">Close</button>
  `;

  modal.classList.add('open');
  trapFocus(modal);
};

window.togglePastHabit = async function(habitId, dateStr) {
  const result = await apiCall('/logs/toggle', 'POST', { habitId, logDate: dateStr });
  if (result) {
    // Refresh log for that date
    const completions = await apiCall(`/logs/${dateStr}`);
    if (completions) {
      if (!allLogs[dateStr]) allLogs[dateStr] = { done: [], mood: '', journal: '' };
      allLogs[dateStr].done = completions.completedHabits || [];
    }
    // Re-render the day detail modal
    await showDayDetail(dateStr);
    // Re-render calendar grid behind
    await loadAllLogs();
    renderCalendar();
  }
};

window.closeDayDetail = function() {
  document.getElementById('day-detail-modal').classList.remove('open');
  releaseFocus();
};

// ============ EDIT HABIT ============
let editingHabitId = null;
let editSelectedEmoji = '';
const EDIT_EMOJIS = ['🏋️','💧','🧘','🚶','🎨','💤','📚','🌿','☀️','🍎','💊','🧹','✍️','🎵','🧴','🏃','🛏️','💻','🥗','🌊','⭐','🔥','🎯','💪','🧠','🎶','🌸','🌈'];

window.openEditHabit = function(id, currentName, currentIcon) {
  editingHabitId = id;
  editSelectedEmoji = currentIcon;
  document.getElementById('edit-habit-name').value = currentName;

  const emojiRow = document.getElementById('edit-emoji-row');
  emojiRow.innerHTML = '';
  EDIT_EMOJIS.forEach(e => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'edit-emoji-pick' + (e === editSelectedEmoji ? ' selected' : '');
    btn.textContent = e;
    btn.onclick = () => {
      editSelectedEmoji = e;
      emojiRow.querySelectorAll('.edit-emoji-pick').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    };
    emojiRow.appendChild(btn);
  });

  document.getElementById('edit-habit-modal').classList.add('open');
  trapFocus(document.getElementById('edit-habit-modal'));
};

window.closeEditHabit = function() {
  document.getElementById('edit-habit-modal').classList.remove('open');
  releaseFocus();
  editingHabitId = null;
};

window.saveEditHabit = async function() {
  const name = document.getElementById('edit-habit-name').value.trim();
  if (!name) { showToast('Please enter a habit name'); return; }

  const result = await apiCall(`/habits/${editingHabitId}`, 'PUT', { name, icon: editSelectedEmoji });
  if (result) {
    showToast('Habit updated!');
    closeEditHabit();
    await loadHabits();
  }
};

// ============ DECLINE / UNFRIEND ============

// ============ PER-HABIT NOTES ============
let currentNoteHabitId = null;

async function loadHabitNotes() {
  const key = todayKey();
  const data = await apiCall(`/habit-notes/${key}`);
  if (data) {
    for (const [hid, note] of Object.entries(data)) {
      habitNotes[`${key}_${hid}`] = note;
    }
  }
}

window.openHabitNote = function(habitId, habitName) {
  currentNoteHabitId = habitId;
  const key = todayKey();
  const noteKey = `${key}_${habitId}`;
  document.getElementById('habit-note-title').textContent = `${habitName}`;
  document.getElementById('habit-note-date').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('habit-note-text').value = habitNotes[noteKey] || '';
  document.getElementById('habit-note-modal').classList.add('open');
  trapFocus(document.getElementById('habit-note-modal'));
  setTimeout(() => document.getElementById('habit-note-text').focus(), 100);
};

window.closeHabitNote = function() {
  document.getElementById('habit-note-modal').classList.remove('open');
  releaseFocus();
  currentNoteHabitId = null;
};

window.saveHabitNote = async function() {
  const note = document.getElementById('habit-note-text').value.trim();
  const key = todayKey();
  const result = await apiCall('/habit-notes', 'POST', { habitId: currentNoteHabitId, logDate: key, note });
  if (result) {
    const noteKey = `${key}_${currentNoteHabitId}`;
    if (note) {
      habitNotes[noteKey] = note;
    } else {
      delete habitNotes[noteKey];
    }
    showToast('Note saved!');
    closeHabitNote();
    renderToday();
  }
};

window.declineFriend = async function(friendId) {
  const result = await apiCall(`/friends/${friendId}`, 'DELETE');
  if (result) {
    showToast('Request declined');
    renderFriends();
  }
};

window.unfriend = async function(friendId, username) {
  if (confirm(`Remove ${username} from your friends?`)) {
    const result = await apiCall(`/friends/${friendId}`, 'DELETE');
    if (result) {
      showToast('Friend removed');
      renderFriends();
    }
  }
};

// ============ EMOJI PICKER ============

// ============ DARK MODE ============
window.toggleDarkMode = function() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  if (isDark) {
    html.removeAttribute('data-theme');
    localStorage.setItem('theme', 'light');
    document.getElementById('dark-toggle').textContent = '🌙';
  } else {
    html.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
    document.getElementById('dark-toggle').textContent = '☀️';
  }
};

function initDarkMode() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('dark-toggle').textContent = '☀️';
  }
}

// ============ ARCHIVE / RESTORE ============
let archivedHabits = [];

window.archiveHabit = async function(id) {
  const result = await apiCall(`/habits/${id}/archive`, 'PATCH', { archived: true });
  if (result) {
    showToast('Habit archived');
    await loadHabits();
  }
};

window.restoreHabit = async function(id) {
  const result = await apiCall(`/habits/${id}/archive`, 'PATCH', { archived: false });
  if (result) {
    showToast('Habit restored');
    await loadHabits();
    await loadArchivedHabits();
  }
};

async function loadArchivedHabits() {
  const data = await apiCall('/habits?archived=1');
  archivedHabits = data || [];
  document.getElementById('archived-count').textContent = archivedHabits.length;

  const list = document.getElementById('archived-list');
  list.innerHTML = '';

  if (archivedHabits.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--muted);font-size:13px;">No archived habits</div>';
    return;
  }

  archivedHabits.forEach(h => {
    const card = document.createElement('div');
    card.className = 'manage-card archived';
    card.innerHTML = `<div class="manage-icon">${h.icon}</div><div class="manage-name">${escapeHtml(h.name)}</div><button class="btn-restore" onclick="restoreHabit(${h.id})" title="Restore">↩ Restore</button><button class="manage-del" onclick="deleteHabit(${h.id})" title="Delete permanently">×</button>`;
    list.appendChild(card);
  });
}

window.toggleArchivedSection = function() {
  const section = document.getElementById('archived-section');
  const arrow = document.getElementById('archive-arrow');
  if (section.style.display === 'none') {
    section.style.display = 'block';
    arrow.textContent = '▼';
  } else {
    section.style.display = 'none';
    arrow.textContent = '▶';
  }
};

// ============ DATA EXPORT ============
window.exportData = async function() {
  const data = await apiCall('/export');
  if (!data) return;

  // Build CSV content
  let csv = 'Type,Habit,Icon,Frequency,Date,Mood,Journal\n';

  // Add habit completions
  if (data.completions) {
    data.completions.forEach(c => {
      csv += `Completion,"${(c.habit_name || '').replace(/"/g, '""')}",,,${c.log_date},,\n`;
    });
  }

  // Add mood/journal logs
  if (data.logs) {
    data.logs.forEach(l => {
      csv += `Log,,,,${l.log_date},"${(l.mood || '').replace(/"/g, '""')}","${(l.journal || '').replace(/"/g, '""')}"\n`;
    });
  }

  // Add habits list
  if (data.habits) {
    data.habits.forEach(h => {
      csv += `Habit,"${(h.name || '').replace(/"/g, '""')}",${h.icon},${h.frequency || 'daily'},${h.created_at},,\n`;
    });
  }

  // Download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `pooku-export-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast('Data exported!');
};

const EMOJI_CATEGORIES = {
  '😊 Smileys': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😗','😚','😋','😛','😜','🤪','😝','🤗','🤭','🤫','🤔','😐','😑','😶','😏','😒','🙄','😬','😮‍💨','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐'],
  '❤️ Hearts': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💘','💝','💟','♥️','💌','💋','💍','💐','🌹','🌷','🌸'],
  '👋 Hands': ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪','🦾'],
  '🎉 Objects': ['🎉','🎊','🎈','🎁','🎀','🏆','🥇','🥈','🥉','⚽','🏀','🏈','⚾','🎾','🎮','🎲','🎯','🎵','🎶','🎸','🎹','🎺','📚','📖','✏️','💡','🔥','⭐','🌟','✨','💫','🌈','☀️','🌙'],
  '🍔 Food': ['🍎','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍒','🍑','🥝','🍅','🥑','🍔','🍕','🌮','🌯','🍜','🍝','🍣','🍩','🍪','🎂','🍰','🧁','🍫','🍬','☕','🍵','🧃','🥤','🍺'],
  '🐶 Animals': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦅','🦆','🦋','🐛','🐝','🐞','🐢','🐍','🦎','🐙','🐠','🐬','🐳','🦈']
};

function initEmojiPicker() {
  const tabs = document.getElementById('emoji-picker-tabs');
  const grid = document.getElementById('emoji-picker-grid');
  if (!tabs || !grid) return;
  
  const categories = Object.keys(EMOJI_CATEGORIES);
  tabs.innerHTML = '';
  categories.forEach((cat, i) => {
    const btn = document.createElement('button');
    btn.className = 'emoji-tab' + (i === 0 ? ' active' : '');
    btn.textContent = cat.split(' ')[0];
    btn.onclick = () => {
      tabs.querySelectorAll('.emoji-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      renderEmojiGrid(cat);
    };
    tabs.appendChild(btn);
  });
  renderEmojiGrid(categories[0]);
}

function renderEmojiGrid(category) {
  const grid = document.getElementById('emoji-picker-grid');
  grid.innerHTML = '';
  EMOJI_CATEGORIES[category].forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'emoji-item';
    btn.textContent = emoji;
    btn.onclick = () => insertEmoji(emoji);
    grid.appendChild(btn);
  });
}

function insertEmoji(emoji) {
  const input = document.getElementById('chat-input');
  const start = input.selectionStart;
  const end = input.selectionEnd;
  input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
  input.focus();
  const pos = start + emoji.length;
  input.setSelectionRange(pos, pos);
}

window.toggleEmojiPicker = function() {
  const panel = document.getElementById('emoji-picker-panel');
  const isOpen = panel.classList.contains('open');
  if (!isOpen) initEmojiPicker();
  panel.classList.toggle('open');
};

function closeEmojiPicker() {
  document.getElementById('emoji-picker-panel')?.classList.remove('open');
}

// Close emoji picker when clicking outside
document.addEventListener('click', function(e) {
  const panel = document.getElementById('emoji-picker-panel');
  const toggle = document.querySelector('.emoji-picker-toggle');
  if (panel && !panel.contains(e.target) && e.target !== toggle) {
    panel.classList.remove('open');
  }
});

// ============ ONBOARDING ============
const ONBOARD_STEPS = [
  { emoji: '🌿', title: 'Welcome to Pooku!', desc: 'Your personal habit tracker. We\'ve added some starter habits — customize them anytime in My Habits.' },
  { emoji: '✅', title: 'Track Your Day', desc: 'Tap any habit card to mark it done. Add moods, journal entries, and notes to capture your day.' },
  { emoji: '📊', title: 'Watch Your Progress', desc: 'Visit Progress, Calendar, and Analytics to see streaks, charts, and completion rates over time.' },
  { emoji: '👋', title: 'Connect with Friends', desc: 'Search for friends, compare progress, and chat to stay motivated together. You\'re all set!' }
];
let onboardStep = 0;

function showOnboarding() {
  if (localStorage.getItem('onboardDone')) return;
  onboardStep = 0;
  renderOnboardStep();
  document.getElementById('onboard-overlay').style.display = 'flex';
}

function renderOnboardStep() {
  const s = ONBOARD_STEPS[onboardStep];
  document.getElementById('onboard-step-label').textContent = `Step ${onboardStep + 1} of ${ONBOARD_STEPS.length}`;
  document.getElementById('onboard-emoji').textContent = s.emoji;
  document.getElementById('onboard-title').textContent = s.title;
  document.getElementById('onboard-desc').textContent = s.desc;
  document.getElementById('onboard-next').textContent = onboardStep === ONBOARD_STEPS.length - 1 ? 'Get Started' : 'Next';
  const dots = document.getElementById('onboard-dots');
  dots.innerHTML = '';
  ONBOARD_STEPS.forEach((_, i) => {
    const d = document.createElement('div');
    d.className = 'onboard-dot' + (i === onboardStep ? ' active' : '');
    dots.appendChild(d);
  });
}

window.nextOnboardStep = function() {
  if (onboardStep < ONBOARD_STEPS.length - 1) {
    onboardStep++;
    renderOnboardStep();
  } else {
    finishOnboarding();
  }
};

window.finishOnboarding = function() {
  localStorage.setItem('onboardDone', '1');
  document.getElementById('onboard-overlay').style.display = 'none';
};

window.resetOnboarding = function() {
  localStorage.removeItem('onboardDone');
  showToast('Tutorial will show on next reload');
};

// ============ ACHIEVEMENT BADGES ============
const BADGE_DEFS = [
  { id: 'streak7', emoji: '🔥', name: '7-Day Streak', desc: '7 days in a row', check: s => s.bestStreak >= 7 },
  { id: 'streak30', emoji: '💎', name: '30-Day Streak', desc: '30 days in a row', check: s => s.bestStreak >= 30 },
  { id: 'streak100', emoji: '👑', name: '100-Day Streak', desc: '100 days!', check: s => s.bestStreak >= 100 },
  { id: 'days7', emoji: '📅', name: 'First Week', desc: 'Track for 7 days', check: s => s.daysTracked >= 7 },
  { id: 'days30', emoji: '🗓️', name: 'Monthly', desc: 'Track for 30 days', check: s => s.daysTracked >= 30 },
  { id: 'habits5', emoji: '🎯', name: '5 Habits', desc: 'Create 5 habits', check: (s, h) => h >= 5 },
  { id: 'complete50', emoji: '⭐', name: '50 Done', desc: '50 completions', check: s => s.totalCompleted >= 50 },
  { id: 'complete200', emoji: '🏆', name: '200 Done', desc: '200 completions', check: s => s.totalCompleted >= 200 },
];

function renderBadges(stats) {
  const grid = document.getElementById('badges-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const totalHabits = habits.length + (archivedHabits ? archivedHabits.length : 0);
  BADGE_DEFS.forEach(b => {
    const earned = b.check(stats || {daysTracked:0,totalCompleted:0,bestStreak:0}, totalHabits);
    const card = document.createElement('div');
    card.className = `badge-card ${earned ? 'earned' : 'locked'}`;
    card.innerHTML = `<span class="badge-emoji">${b.emoji}</span><div class="badge-name">${b.name}</div><div class="badge-sub">${b.desc}</div>`;
    grid.appendChild(card);
  });
}

// ============ PROFILE / SETTINGS ============
window.renderSettings = async function() {
  document.getElementById('settings-username').textContent = currentUsername;
  // Fetch email from profile endpoint
  const profile = await apiCall('/auth/profile');
  if (profile) {
    document.getElementById('settings-email').textContent = profile.email || '—';
  }
  // Render avatar
  renderAvatarDisplays();
  // Render badges
  const stats = await apiCall('/stats');
  renderBadges(stats);
  // Render color picker
  renderColorPicker();
};

window.changePassword = async function() {
  const current = document.getElementById('settings-current-pw').value;
  const newPw = document.getElementById('settings-new-pw').value;
  if (!current || !newPw) { showToast('Fill in both fields'); return; }
  if (newPw.length < 6) { showToast('New password must be at least 6 characters'); return; }
  const result = await apiCall('/auth/change-password', 'POST', { currentPassword: current, newPassword: newPw });
  if (result) {
    showToast('Password updated!');
    document.getElementById('settings-current-pw').value = '';
    document.getElementById('settings-new-pw').value = '';
  }
};

// ============ CUSTOM THEME COLORS ============
const THEME_COLORS = [
  { name: 'Blue', accent: '#6ba3d4', dark: '#4a7ba8', light: '#9bbfe8' },
  { name: 'Purple', accent: '#9478cc', dark: '#6d4db3', light: '#c4b5e0' },
  { name: 'Green', accent: '#4a9d7f', dark: '#357a60', light: '#7fbfa3' },
  { name: 'Rose', accent: '#d47b8a', dark: '#b85a6a', light: '#e8a8b4' },
  { name: 'Orange', accent: '#d4a574', dark: '#b88550', light: '#e8c9a8' },
  { name: 'Teal', accent: '#5ba8a0', dark: '#3d8a82', light: '#8cc8c2' },
  { name: 'Indigo', accent: '#5b6abf', dark: '#4050a0', light: '#8e98d8' },
  { name: 'Coral', accent: '#e07060', dark: '#c05040', light: '#f0a090' },
];

function renderColorPicker() {
  const row = document.getElementById('color-picker-row');
  if (!row) return;
  row.innerHTML = '';
  const saved = localStorage.getItem('themeColor') || '#6ba3d4';
  THEME_COLORS.forEach(c => {
    const sw = document.createElement('button');
    sw.className = 'color-swatch' + (c.accent === saved ? ' active' : '');
    sw.style.background = c.accent;
    sw.title = c.name;
    sw.onclick = () => applyThemeColor(c);
    row.appendChild(sw);
  });
}

function applyThemeColor(c) {
  document.documentElement.style.setProperty('--accent', c.accent);
  document.documentElement.style.setProperty('--accent-dark', c.dark);
  document.documentElement.style.setProperty('--accent-light', c.light);
  localStorage.setItem('themeColor', c.accent);
  localStorage.setItem('themeColorDark', c.dark);
  localStorage.setItem('themeColorLight', c.light);
  renderColorPicker();
}

function initThemeColor() {
  const accent = localStorage.getItem('themeColor');
  if (accent) {
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-dark', localStorage.getItem('themeColorDark'));
    document.documentElement.style.setProperty('--accent-light', localStorage.getItem('themeColorLight'));
  }
}

// ============ FRIEND COMPARISON ============
let compareRange = 'week';

window.viewFriendComparison = async function(friendId, username) {
  document.getElementById('friends-main-panel').style.display = 'none';
  document.getElementById('friend-chat-panel').style.display = 'none';
  document.getElementById('friend-progress-panel').style.display = 'block';

  const content = document.getElementById('friend-progress-content');
  content.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted);">Loading comparison...</div>';

  const data = await apiCall(`/friends/${friendId}/compare?range=${compareRange}`);
  if (!data) {
    content.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted);">Could not load comparison</div>';
    return;
  }

  const initials = username.slice(0, 2).toUpperCase();
  let barsHtml = '';
  const labels = data.labels || [];
  const myData = data.myData || [];
  const friendData = data.friendData || [];
  const maxVal = Math.max(...myData, ...friendData, 1);

  labels.forEach((label, i) => {
    const myH = Math.round((myData[i] / maxVal) * 100);
    const fH = Math.round((friendData[i] / maxVal) * 100);
    barsHtml += `<div class="compare-bar-group"><div class="compare-bar mine" style="height:${Math.max(myH,4)}%" title="You: ${myData[i]}"></div><div class="compare-bar friend" style="height:${Math.max(fH,4)}%" title="${escapeHtml(username)}: ${friendData[i]}"></div></div>`;
  });

  content.innerHTML = `
    <div class="friend-progress-card">
      <div class="friend-progress-header">
        <div class="friend-progress-avatar">${initials}</div>
        <div>
          <div class="friend-progress-name">You vs ${escapeHtml(username)}</div>
          <div class="friend-progress-sub">Habit completions comparison</div>
        </div>
      </div>
      <div class="compare-tabs">
        <button class="compare-tab ${compareRange==='week'?'active':''}" onclick="compareRange='week';viewFriendComparison(${friendId},'${escapeHtml(username).replace(/'/g,"\\'")}')">Week</button>
        <button class="compare-tab ${compareRange==='month'?'active':''}" onclick="compareRange='month';viewFriendComparison(${friendId},'${escapeHtml(username).replace(/'/g,"\\'")}')">Month</button>
      </div>
      <div class="compare-chart">${barsHtml}</div>
      <div class="compare-legend"><span class="me">You</span><span class="them">${escapeHtml(username)}</span></div>
      <div style="font-size:11px;color:var(--muted);text-align:center;margin-top:8px;">Labels: ${labels.join(', ')}</div>
    </div>
  `;
};

// ============ TYPING INDICATOR ============
let typingTimeout = null;
let lastTypingSent = 0;

function setupTypingIndicator() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  input.addEventListener('input', () => {
    if (!currentChatFriendId) return;
    const now = Date.now();
    if (now - lastTypingSent > 2000) {
      apiCall('/messages/typing', 'POST', { receiverId: currentChatFriendId });
      lastTypingSent = now;
    }
  });
}

function checkTypingStatus(messages) {
  const indicator = document.getElementById('typing-indicator');
  if (!indicator) return;
  // The server will include a typing flag in the messages response
  // For simplicity, we check if the friend sent a typing signal recently
  if (messages && messages._typing) {
    indicator.classList.add('visible');
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => indicator.classList.remove('visible'), 3000);
  } else {
    indicator.classList.remove('visible');
  }
}

// ============ WEEKLY/MONTHLY SUMMARY NOTIFICATIONS ============
function scheduleWeeklySummary() {
  // Check once an hour if it's Sunday evening for weekly summary
  setInterval(() => {
    const now = new Date();
    if (now.getDay() === 0 && now.getHours() === 19 && now.getMinutes() === 0) {
      sendWeeklySummaryNotif();
    }
    // Monthly on 1st at 10am
    if (now.getDate() === 1 && now.getHours() === 10 && now.getMinutes() === 0) {
      sendMonthlySummaryNotif();
    }
  }, 60000);
}

async function sendWeeklySummaryNotif() {
  if (Notification.permission !== 'granted') return;
  const stats = await apiCall('/stats');
  if (!stats) return;
  new Notification('Pooku — Weekly Summary 📊', {
    body: `This week: ${stats.totalCompleted} completions, ${stats.bestStreak} day best streak. Keep going!`,
    icon: '/pooku.png'
  });
}

async function sendMonthlySummaryNotif() {
  if (Notification.permission !== 'granted') return;
  const stats = await apiCall('/stats');
  if (!stats) return;
  new Notification('Pooku — Monthly Summary 🗓️', {
    body: `${stats.daysTracked} days tracked, ${stats.totalCompleted} completions total. Amazing progress!`,
    icon: '/pooku.png'
  });
}

// ============ OFFLINE SYNC QUEUE ============
let syncQueue = JSON.parse(localStorage.getItem('syncQueue') || '[]');

async function apiCallWithQueue(endpoint, method = 'GET', body = null) {
  // For GET requests, just use normal apiCall
  if (method === 'GET') return apiCall(endpoint, method, body);

  try {
    const result = await apiCall(endpoint, method, body);
    if (result) return result;
    throw new Error('API returned null');
  } catch (e) {
    // Queue failed mutations for later sync
    syncQueue.push({ endpoint, method, body, timestamp: Date.now() });
    localStorage.setItem('syncQueue', JSON.stringify(syncQueue));
    showToast('Saved offline — will sync when connected');
    return { _queued: true };
  }
}

async function flushSyncQueue() {
  if (syncQueue.length === 0) return;
  const queue = [...syncQueue];
  syncQueue = [];
  localStorage.setItem('syncQueue', '[]');
  let failed = [];
  for (const item of queue) {
    try {
      const result = await apiCall(item.endpoint, item.method, item.body);
      if (!result) failed.push(item);
    } catch (e) {
      failed.push(item);
    }
  }
  if (failed.length > 0) {
    syncQueue = failed;
    localStorage.setItem('syncQueue', JSON.stringify(syncQueue));
  } else if (queue.length > 0) {
    showToast(`Synced ${queue.length} offline action${queue.length > 1 ? 's' : ''}!`);
  }
}

// Listen for coming back online
window.addEventListener('online', () => {
  showToast('Back online!');
  flushSyncQueue();
});

window.addEventListener('offline', () => {
  showToast('You\'re offline — changes will sync later');
  setSyncStatus('error');
});

// ============ CONFETTI CELEBRATION ============
let confettiFired = false;

function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) { console.warn('Confetti canvas not found'); return; }
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.display = 'block';

  const pieces = [];
  const colors = ['#6ba3d4','#4a9d7f','#d4a574','#9478cc','#e07060','#5ab890','#f0c060','#e88090'];
  for (let i = 0; i < 150; i++) {
    pieces.push({
      x: canvas.width * 0.5 + (Math.random() - 0.5) * canvas.width * 0.6,
      y: canvas.height * 0.3 * Math.random(),
      w: 5 + Math.random() * 7,
      h: 10 + Math.random() * 10,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 8,
      vy: -(2 + Math.random() * 6),
      rot: Math.random() * 360,
      rotV: (Math.random() - 0.5) * 15,
      opacity: 1
    });
  }

  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    pieces.forEach(p => {
      if (p.opacity <= 0) return;
      alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      ctx.restore();
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15; // gravity
      p.vx *= 0.99; // air resistance
      p.rot += p.rotV;
      if (frame > 40) p.opacity -= 0.012;
    });
    frame++;
    if (alive && frame < 250) {
      requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = 'none';
    }
  }
  requestAnimationFrame(draw);
}

function checkCelebration() {
  const key = todayKey();
  const log = allLogs[key] || { done: [] };
  const todayHabits = habits.filter(h => {
    const freq = h.frequency || 'daily';
    const dow = new Date().getDay();
    if (freq === 'daily') return true;
    if (freq === 'weekdays') return dow >= 1 && dow <= 5;
    if (freq === 'weekends') return dow === 0 || dow === 6;
    return true;
  });
  const done = (log.done || []).filter(id => todayHabits.some(h => h.id === id)).length;
  const total = todayHabits.length;

  if (total > 0 && done === total && !confettiFired) {
    confettiFired = true;
    launchConfetti();
    triggerHaptic('heavy');
    showToast('🎉 All habits done! You\'re amazing!');
    // Check streak milestones
    checkStreakMilestones();
  }
  // Reset confetti flag if not all done (user un-toggled)
  if (done < total) confettiFired = false;
}

function checkStreakMilestones() {
  const milestones = [7, 14, 21, 30, 50, 100, 365];
  for (const [id, streak] of Object.entries(habitStreaks)) {
    const habit = habits.find(h => h.id === Number(id));
    if (!habit) continue;
    if (milestones.includes(streak)) {
      const shown = JSON.parse(localStorage.getItem('shownMilestones') || '{}');
      const milestoneKey = `${id}_${streak}`;
      if (!shown[milestoneKey]) {
        shown[milestoneKey] = true;
        localStorage.setItem('shownMilestones', JSON.stringify(shown));
        setTimeout(() => {
          showToast(`🏆 ${habit.icon} ${habit.name}: ${streak}-day streak!`);
        }, 1500);
        break; // Only show one milestone at a time
      }
    }
  }
}

// ============ HAPTIC FEEDBACK ============
function triggerHaptic(intensity = 'light') {
  if (!navigator.vibrate) return;
  if (localStorage.getItem('hapticOff') === '1') return;
  if (intensity === 'heavy') navigator.vibrate([30, 20, 30]);
  else navigator.vibrate(15);
}

// ============ EVENING SUMMARY ============
function showEveningSummary() {
  const now = new Date();
  const hour = now.getHours();
  // Show between 8pm and midnight
  if (hour < 20) return;

  const key = todayKey();
  const dismissKey = `eveningDismissed_${key}`;
  if (localStorage.getItem(dismissKey)) return;

  const log = allLogs[key] || { done: [], mood: '', journal: '' };
  const done = (log.done || []).length;
  const total = habits.length;
  const mood = log.mood || 'not recorded';
  const journaled = log.journal ? 'Yes ✓' : 'Not yet';
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const slot = document.getElementById('evening-summary-slot');
  if (!slot) return;

  const emoji = pct === 100 ? '🌟' : pct >= 50 ? '🌙' : '💫';

  slot.innerHTML = `
    <div class="evening-card">
      <h3>${emoji} Your evening check-in</h3>
      <p>Here's how your day went, ${escapeHtml(currentUsername)}.</p>
      <div class="evening-stats">
        <div class="evening-stat"><span class="num">${done}/${total}</span><span class="label">Habits</span></div>
        <div class="evening-stat"><span class="num">${pct}%</span><span class="label">Complete</span></div>
        <div class="evening-stat"><span class="num">${mood}</span><span class="label">Mood</span></div>
        <div class="evening-stat"><span class="num">${journaled}</span><span class="label">Journal</span></div>
      </div>
      <p style="opacity:0.8;font-size:12px;">${pct === 100 ? 'Perfect day! You showed up for yourself. Rest well. 🌿' : pct >= 50 ? 'Good progress today. Tomorrow is another chance to grow. 🌙' : 'Every day is a fresh start. Be gentle with yourself. 💛'}</p>
      <button class="evening-dismiss" onclick="dismissEvening()">Thanks, good night ✨</button>
    </div>
  `;
}

window.dismissEvening = function() {
  const key = todayKey();
  localStorage.setItem(`eveningDismissed_${key}`, '1');
  const slot = document.getElementById('evening-summary-slot');
  if (slot) slot.innerHTML = '';
};

// ============ STREAK FREEZE ============
let streakFreezes = parseInt(localStorage.getItem('streakFreezes') || '0');
let lastPerfectCheck = localStorage.getItem('lastPerfectCheck') || '';

function checkStreakFreezeEarned() {
  const key = todayKey();
  if (lastPerfectCheck === key) return; // Already checked today

  // Count consecutive perfect days (last 7 days)
  let perfectDays = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dk = d.toISOString().slice(0, 10);
    const log = allLogs[dk] || { done: [] };
    const done = (log.done || []).length;
    if (done > 0 && done >= habits.length && habits.length > 0) {
      perfectDays++;
    } else {
      break;
    }
  }

  if (perfectDays >= 7) {
    const lastEarned = localStorage.getItem('lastFreezeEarned') || '';
    if (lastEarned !== key) {
      streakFreezes++;
      localStorage.setItem('streakFreezes', streakFreezes.toString());
      localStorage.setItem('lastFreezeEarned', key);
      showToast('❄️ You earned a Streak Freeze! (7 perfect days)');
    }
  }
  lastPerfectCheck = key;
  localStorage.setItem('lastPerfectCheck', key);

  // Update streak freeze display
  updateStreakFreezeDisplay();
}

function updateStreakFreezeDisplay() {
  const existing = document.getElementById('streak-freeze-info');
  if (existing) existing.remove();

  if (streakFreezes > 0) {
    const badge = document.createElement('span');
    badge.id = 'streak-freeze-info';
    badge.className = 'streak-freeze-badge';
    badge.innerHTML = `❄️ ${streakFreezes}`;
    badge.title = `${streakFreezes} Streak Freeze${streakFreezes > 1 ? 's' : ''} available — protects your streak if you miss a day`;
    const progressText = document.querySelector('.progress-text');
    if (progressText) {
      const sub = document.getElementById('progress-sub');
      if (sub) sub.appendChild(badge);
    }
  }
}

window.useStreakFreeze = async function(habitId) {
  if (streakFreezes <= 0) {
    showToast('No streak freezes available. Earn one with 7 perfect days!');
    return;
  }
  streakFreezes--;
  localStorage.setItem('streakFreezes', streakFreezes.toString());
  showToast('❄️ Streak Freeze used! Your streak is protected.');
  updateStreakFreezeDisplay();
};

// ============ EMPTY STATES FOR OTHER VIEWS ============
function getEmptyManageHtml() {
  return `<div class="empty-state" style="grid-column:1/-1;">
    <span class="empty-state-emoji">✨</span>
    <h3>No habits yet</h3>
    <p>Create your first habit below. Start small — even "drink a glass of water" counts!</p>
  </div>`;
}

function getEmptyProgressHtml() {
  return `<div class="empty-state">
    <span class="empty-state-emoji">📊</span>
    <h3>Nothing to show yet</h3>
    <p>Track a few days of habits and your progress charts will appear here.</p>
    <button class="empty-state-btn" onclick="switchView('today')">Go to Today</button>
  </div>`;
}

function getEmptyAnalyticsHtml() {
  return `<div class="empty-state">
    <span class="empty-state-emoji">🔍</span>
    <h3>Analytics need data</h3>
    <p>Start tracking your habits daily, and detailed analytics will show up here after a few days.</p>
    <button class="empty-state-btn" onclick="switchView('today')">Start tracking</button>
  </div>`;
}

// ============ ICON CATEGORY CLASSIFIER ============
function getIconCategory(icon) {
  const health = ['💧','🍎','💊','🥗','🧴','💤'];
  const fitness = ['🏋️','🚶','🏃','🌊','🧘'];
  const mind = ['📚','✍️','🎵','🎨'];
  const productivity = ['💻','🧹'];
  const selfCare = ['🛏️','☀️','🌿'];
  if (health.includes(icon)) return 'cat-health';
  if (fitness.includes(icon)) return 'cat-fitness';
  if (mind.includes(icon)) return 'cat-mind';
  if (productivity.includes(icon)) return 'cat-productivity';
  if (selfCare.includes(icon)) return 'cat-self';
  return '';
}

// ============ MOBILE WEEK STRIP ============
function renderWeekStrip() {
  const strip = document.getElementById('week-strip');
  if (!strip) return;
  strip.innerHTML = '';
  const today = new Date();
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Show current week (Mon-Sun)
  const startOfWeek = new Date(today);
  const dayOfWeek = today.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  startOfWeek.setDate(today.getDate() + diff);

  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const log = allLogs[dateStr];
    const completedCount = log ? (log.done || []).length : 0;
    const totalH = habits.length;
    const isToday = d.toDateString() === today.toDateString();

    const dayEl = document.createElement('div');
    dayEl.className = 'week-strip-day' + (isToday ? ' today' : '') + (completedCount > 0 ? ' has-data' : '');

    let dotsHtml = '';
    if (log && log.done && log.done.length > 0) {
      const shown = Math.min(log.done.length, 4);
      for (let j = 0; j < shown; j++) dotsHtml += '<span class="ws-dot"></span>';
      if (totalH > shown) {
        for (let j = shown; j < Math.min(totalH, 4); j++) dotsHtml += '<span class="ws-dot missed"></span>';
      }
    }

    dayEl.innerHTML = `<div class="ws-dow">${dayNames[d.getDay()]}</div><div class="ws-num">${d.getDate()}</div><div class="ws-dots">${dotsHtml}</div>`;
    dayEl.onclick = () => showDayDetail(dateStr, d.getDate());
    strip.appendChild(dayEl);
  }
}

window.toggleCalMonth = function() {
  const full = document.getElementById('calendar-full-month');
  const toggle = document.getElementById('cal-month-toggle');
  if (full.classList.contains('expanded')) {
    full.classList.remove('expanded');
    toggle.textContent = '▼ Show full month';
  } else {
    full.classList.add('expanded');
    toggle.textContent = '▲ Hide full month';
  }
};

// ============ SKELETON LOADING ============
function showSkeleton(containerId, type) {
  const el = document.getElementById(containerId);
  if (!el) return;
  let html = '';
  if (type === 'habits') {
    html = `<div class="skeleton skeleton-card"></div>`.repeat(4);
  } else if (type === 'ring') {
    html = `<div style="text-align:center;"><div class="skeleton skeleton-ring"></div><div class="skeleton skeleton-bar w60" style="margin:0 auto;"></div></div>`;
  } else if (type === 'cards') {
    html = `<div class="skeleton skeleton-card"></div>`.repeat(3);
  } else if (type === 'bars') {
    html = `<div class="skeleton skeleton-bar w80"></div><div class="skeleton skeleton-bar w60"></div><div class="skeleton skeleton-bar w40"></div>`;
  }
  el.innerHTML = html;
}

// ============ BADGES ON TODAY VIEW ============
async function renderBadgeStrip() {
  const strip = document.getElementById('badge-strip-today');
  if (!strip) return;
  const stats = await apiCall('/stats');
  if (!stats) return;
  const totalHabits = habits.length + (archivedHabits ? archivedHabits.length : 0);
  const seenBadges = JSON.parse(localStorage.getItem('seenBadges') || '[]');
  let html = '';
  let hasNew = false;
  BADGE_DEFS.forEach(b => {
    const earned = b.check(stats, totalHabits);
    const isNew = earned && !seenBadges.includes(b.id);
    if (isNew) hasNew = true;
    html += `<div class="badge-mini ${earned ? 'earned' : 'locked'}" title="${b.name}: ${b.desc}">
      ${b.emoji}
      ${isNew ? '<span class="badge-new"></span>' : ''}
      <span class="badge-mini-tooltip">${b.name}</span>
    </div>`;
  });
  strip.innerHTML = html;

  // Mark all earned as seen
  if (hasNew) {
    const nowSeen = BADGE_DEFS.filter(b => b.check(stats, totalHabits)).map(b => b.id);
    localStorage.setItem('seenBadges', JSON.stringify(nowSeen));
  }
}

// ============ AVATAR SYSTEM ============
const AVATAR_OPTIONS = [
  '🐻','🐱','🐶','🦊','🐼','🐨','🦁','🐯','🐸','🦉',
  '🌸','🌻','🌿','🍀','🌵','🌺','🍄','🌈','⭐','🌙',
  '🎭','🎨','🎯','🎸','🎵','📚','💎','🔮','🧸','🦋'
];

function getAvatar() {
  return localStorage.getItem('userAvatar') || '';
}

function setAvatar(emoji) {
  localStorage.setItem('userAvatar', emoji);
  renderAvatarDisplays();
}

function renderAvatarDisplays() {
  const avatar = getAvatar();
  const initials = (currentUsername || '?').slice(0, 2).toUpperCase();

  // Settings avatar
  const settingsAvatar = document.getElementById('settings-avatar');
  if (settingsAvatar) {
    settingsAvatar.textContent = avatar || initials;
    settingsAvatar.className = 'avatar-display' + (avatar ? ' has-avatar' : '');
    if (!avatar) settingsAvatar.style.background = 'linear-gradient(135deg,var(--accent),var(--success))';
    else settingsAvatar.style.background = 'var(--accent-light)';
  }

  // Hero avatar
  const heroAvatar = document.getElementById('hero-avatar');
  if (heroAvatar) {
    heroAvatar.textContent = avatar || initials;
  }
}

window.toggleAvatarPicker = function() {
  const picker = document.getElementById('avatar-picker');
  if (!picker) return;
  const isOpen = picker.style.display !== 'none';
  picker.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) renderAvatarGrid();
};

function renderAvatarGrid() {
  const grid = document.getElementById('avatar-grid');
  if (!grid) return;
  const current = getAvatar();
  grid.innerHTML = '';
  AVATAR_OPTIONS.forEach(a => {
    const opt = document.createElement('button');
    opt.className = 'avatar-option' + (a === current ? ' selected' : '');
    opt.textContent = a;
    opt.onclick = () => {
      setAvatar(a);
      renderAvatarGrid();
      showToast('Avatar updated!');
    };
    grid.appendChild(opt);
  });
}

// ============ FOCUS TRAP FOR MODALS ============
let previouslyFocused = null;

function trapFocus(modalEl) {
  previouslyFocused = document.activeElement;
  const focusable = modalEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  function handleTab(e) {
    if (e.key === 'Escape') {
      // Close any open modal
      const overlays = document.querySelectorAll('.habit-note-overlay.open, .day-detail-overlay.open, .edit-habit-overlay.open, .modal-overlay.open, .onboard-overlay[style*="flex"]');
      overlays.forEach(o => o.classList.remove('open'));
      const onboard = document.getElementById('onboard-overlay');
      if (onboard) onboard.style.display = 'none';
      releaseFocus();
      return;
    }
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  modalEl._trapHandler = handleTab;
  modalEl.addEventListener('keydown', handleTab);
  setTimeout(() => first.focus(), 50);
}

function releaseFocus() {
  document.querySelectorAll('[role="dialog"]').forEach(m => {
    if (m._trapHandler) { m.removeEventListener('keydown', m._trapHandler); delete m._trapHandler; }
  });
  if (previouslyFocused) { previouslyFocused.focus(); previouslyFocused = null; }
}

// ============ DAILY CHECK-IN STREAK (#15) ============
async function doCheckIn() {
  await apiCall('/check-in', 'POST');
  const data = await apiCall('/check-in/streak');
  if (data && data.streak > 0) {
    const pill = document.getElementById('checkin-pill');
    const num = document.getElementById('checkin-streak');
    if (pill && num) {
      num.textContent = data.streak;
      pill.style.display = 'inline-flex';
    }
  }
}

// ============ HABIT CATEGORIES / GROUPING (#16) ============
const CATEGORIES = ['Morning Routine','Health','Fitness','Mind','Creative','Productivity','Self-Care'];
let collapsedCategories = JSON.parse(localStorage.getItem('collapsedCats') || '{}');

function groupHabitsByCategory(habitsList) {
  const groups = { '': [] };
  CATEGORIES.forEach(c => groups[c] = []);
  habitsList.forEach(h => {
    const cat = h.category || '';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(h);
  });
  return groups;
}

function renderGroupedHabits(todayHabits, log, key) {
  const list = document.getElementById('habits-list');
  const groups = groupHabitsByCategory(todayHabits);

  // Check if any habits have categories
  const hasCats = todayHabits.some(h => h.category);
  if (!hasCats) return false; // fallback to flat rendering

  list.innerHTML = '';
  const catOrder = ['', ...CATEGORIES];

  catOrder.forEach(cat => {
    const catHabits = groups[cat];
    if (!catHabits || catHabits.length === 0) return;

    const isCollapsed = collapsedCategories[cat || '_uncategorized'];
    const label = cat || 'Uncategorized';

    if (cat) {
      const header = document.createElement('div');
      header.className = 'category-header';
      header.innerHTML = `<span class="cat-arrow ${isCollapsed ? 'collapsed' : ''}">▼</span><span class="cat-label">${escapeHtml(label)}</span><span class="cat-count">${catHabits.length}</span>`;
      header.onclick = () => {
        const k = cat || '_uncategorized';
        collapsedCategories[k] = !collapsedCategories[k];
        localStorage.setItem('collapsedCats', JSON.stringify(collapsedCategories));
        renderToday();
      };
      list.appendChild(header);
    }

    if (!isCollapsed) {
      catHabits.forEach(h => {
        const done = log.done && log.done.includes(h.id);
        const streak = habitStreaks[h.id] || 0;
        const plant = getPlantStage(streak, done);
        const streakText = streak > 0 ? `${streak} day streak ${plant.emoji}` : 'Start your journey!';
        const noteKey = `${key}_${h.id}`;
        const hasNote = habitNotes[noteKey] ? ' has-note' : '';
        const whyHtml = h.my_why ? `<div class="habit-why">${escapeHtml(h.my_why)}</div>` : '';
        const growthPct = Math.min(streak, plant.nextAt) / plant.nextAt * 100;
        const plantBar = streak > 0 ? `<div class="plant-growth-bar"><div class="plant-growth-fill" style="width:${growthPct}%"></div></div>` : '';
        const card = document.createElement('div');
        card.className = 'habit-card' + (done ? ' done' : '');
        card.setAttribute('tabindex', '0');
        card.innerHTML = `<div class="habit-icon ${getIconCategory(h.icon)}">${h.icon}</div><div class="habit-info"><div class="habit-name">${escapeHtml(h.name)}</div><div class="habit-streak">${streakText}</div>${plantBar}${whyHtml}</div><button class="habit-note-btn${hasNote}" onclick="event.stopPropagation();openHabitNote(${h.id}, '${escapeHtml(h.name).replace(/'/g, "\\'")}')" title="Add note">📝</button><div class="habit-check"><span class="checkmark">✓</span></div>`;
        card.onclick = () => toggleHabit(h.id);
        // Long-press to expand "my why"
        if (h.my_why) {
          let pressTimer;
          card.addEventListener('pointerdown', () => { pressTimer = setTimeout(() => card.classList.toggle('expanded'), 500); });
          card.addEventListener('pointerup', () => clearTimeout(pressTimer));
          card.addEventListener('pointerleave', () => clearTimeout(pressTimer));
        }
        list.appendChild(card);
      });
    }
  });
  return true;
}

// ============ WEEKLY FRIEND LEADERBOARD (#17) ============
async function renderLeaderboard() {
  const slot = document.getElementById('leaderboard-slot');
  if (!slot) return;
  const board = await apiCall('/friends/leaderboard');
  if (!board || board.length <= 1) { slot.innerHTML = ''; return; }

  const medals = ['🥇','🥈','🥉'];
  let html = '<div class="leaderboard"><h3>🏆 This Week\'s Leaderboard</h3>';
  board.forEach((entry, i) => {
    const medal = i < 3 ? medals[i] : `${i + 1}`;
    const badge = i === 0 ? '<span class="lb-badge">Most Consistent</span>' : '';
    html += `<div class="lb-row">
      <div class="lb-rank">${medal}</div>
      <div class="lb-name ${entry.isMe ? 'me' : ''}">${escapeHtml(entry.username)}${entry.isMe ? ' (you)' : ''}</div>
      <div class="lb-score">${entry.completions} done · ${entry.daysActive}d active</div>
      ${badge}
    </div>`;
  });
  html += '</div>';
  slot.innerHTML = html;
}

// ============ FLOATING JOURNAL CARD (#19) ============
function checkFloatingJournal() {
  const hour = new Date().getHours();
  const journalHour = parseInt(localStorage.getItem('journalHour') || '20');
  if (hour < journalHour) return;

  const key = todayKey();
  if (localStorage.getItem(`journalFloat_${key}`)) return;
  const log = allLogs[key] || {};
  if (log.journal) return; // Already journaled today

  const existing = document.getElementById('journal-float');
  if (existing) return;

  const card = document.createElement('div');
  card.className = 'journal-float';
  card.id = 'journal-float';
  card.innerHTML = `
    <h3>✨ How's your day?</h3>
    <p style="font-size:12px;color:var(--muted);margin-bottom:8px;">Take a moment to jot down your thoughts.</p>
    <textarea id="journal-float-text" placeholder="Any wins, struggles, or reflections today..." maxlength="1000"></textarea>
    <div class="journal-float-btns">
      <button style="background:var(--cream);color:var(--muted);" onclick="dismissJournalFloat()">Later</button>
      <button style="background:var(--accent-dark);color:white;" onclick="saveJournalFloat()">Save</button>
    </div>
  `;
  document.body.appendChild(card);
}

window.dismissJournalFloat = function() {
  const key = todayKey();
  localStorage.setItem(`journalFloat_${key}`, '1');
  const el = document.getElementById('journal-float');
  if (el) el.remove();
};

window.saveJournalFloat = async function() {
  const text = document.getElementById('journal-float-text').value.trim();
  if (!text) { showToast('Write something first!'); return; }
  const key = todayKey();
  const mood = document.querySelector('.mood-btn.selected')?.textContent.trim() || '';
  await apiCall('/logs/save', 'POST', { logDate: key, mood, journal: text });
  // Also update the main journal box
  const mainBox = document.getElementById('journal-box');
  if (mainBox) mainBox.value = text;
  if (allLogs[key]) allLogs[key].journal = text;
  dismissJournalFloat();
  showToast('Journal saved! ✨');
};

// ============ WEEKLY REFLECTION (#20) ============
function checkWeeklyReflection() {
  const now = new Date();
  if (now.getDay() !== 0) return; // Sunday only

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);
  const weekKey = weekStart.toISOString().slice(0, 10);
  if (localStorage.getItem(`reflection_${weekKey}`)) return;

  const slot = document.getElementById('weekly-reflection-slot');
  if (!slot) return;

  slot.innerHTML = `
    <div class="reflection-card">
      <h3>🌟 Your Weekly Reflection</h3>
      <p style="font-size:12px;color:var(--muted);">Take a few minutes to look back at your week.</p>
      <div class="ref-q">What went well this week?</div>
      <textarea id="ref-well" placeholder="Wins, achievements, good moments..."></textarea>
      <div class="ref-q">What was hard?</div>
      <textarea id="ref-hard" placeholder="Challenges, missed days, struggles..."></textarea>
      <div class="ref-q">What will you focus on next week?</div>
      <textarea id="ref-focus" placeholder="Goals, areas to improve..."></textarea>
      <div class="reflection-btns">
        <button class="empty-state-btn" style="background:var(--cream);color:var(--muted);" onclick="dismissReflection()">Skip</button>
        <button class="empty-state-btn" onclick="saveReflection()">Save reflection</button>
      </div>
    </div>
  `;
}

window.dismissReflection = function() {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);
  localStorage.setItem(`reflection_${weekStart.toISOString().slice(0, 10)}`, '1');
  document.getElementById('weekly-reflection-slot').innerHTML = '';
};

window.saveReflection = async function() {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);
  const weekKey = weekStart.toISOString().slice(0, 10);

  const wentWell = document.getElementById('ref-well').value.trim();
  const wasHard = document.getElementById('ref-hard').value.trim();
  const focusNext = document.getElementById('ref-focus').value.trim();

  await apiCall('/reflections', 'POST', { weekStart: weekKey, wentWell, wasHard, focusNext });
  localStorage.setItem(`reflection_${weekKey}`, '1');
  document.getElementById('weekly-reflection-slot').innerHTML = '';
  showToast('Reflection saved! 🌟');
};

// ============ SSE CHAT (#21) ============
let chatSSE = null;

function connectChatSSE() {
  if (chatSSE) return;
  chatSSE = new EventSource(`${API_URL}/messages/stream`, { withCredentials: true });

  chatSSE.addEventListener('new-message', (e) => {
    try {
      const msg = JSON.parse(e.data);
      // If we're in a chat with this person, append the message
      if (currentChatFriendId && (msg.sender_id == currentChatFriendId || msg.receiver_id == currentChatFriendId)) {
        appendChatMessage(msg);
      }
    } catch(err) { console.error('SSE parse error:', err); }
  });

  chatSSE.onerror = () => {
    chatSSE.close();
    chatSSE = null;
    // Reconnect after 5s
    setTimeout(connectChatSSE, 5000);
  };
}

function appendChatMessage(m) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const empty = container.querySelector('.chat-empty');
  if (empty) empty.remove();

  // Check if message already exists
  if (container.querySelector(`[data-msg-id="${m.id}"]`)) return;

  const isSent = m.sender_id == currentUserId;
  const time = new Date(m.created_at + (m.created_at.endsWith('Z') ? '' : 'Z')).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const readIcon = isSent ? `<span class="chat-read ${m.read_status ? 'read' : ''}">${m.read_status ? '✓✓' : '✓'}</span>` : '';
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${isSent ? 'sent' : 'received'}`;
  bubble.setAttribute('data-msg-id', m.id);
  bubble.innerHTML = `${escapeHtml(m.message)}<span class="chat-time">${time} ${readIcon}</span>`;
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

// ============ HABIT TEMPLATE PACKS (#22) ============
async function renderTemplatePacks() {
  const grid = document.getElementById('template-grid');
  if (!grid) return;
  const templates = await apiCall('/habit-templates');
  if (!templates) return;
  grid.innerHTML = '';
  templates.forEach((tpl, i) => {
    const habitsPreview = tpl.habits.map(h => h.icon).join(' ');
    const card = document.createElement('div');
    card.className = 'template-card';
    card.innerHTML = `
      <div class="tpl-icon">${tpl.icon}</div>
      <div class="tpl-name">${escapeHtml(tpl.name)}</div>
      <div class="tpl-desc">${escapeHtml(tpl.desc)}</div>
      <div class="tpl-habits">${habitsPreview} (${tpl.habits.length} habits)</div>
      <button class="tpl-import" onclick="event.stopPropagation();importTemplate(${i})">Import pack</button>
    `;
    grid.appendChild(card);
  });
  // Store templates for import
  window._templateData = templates;
}

window.importTemplate = async function(idx) {
  const tpl = window._templateData?.[idx];
  if (!tpl) return;
  if (!confirm(`Import "${tpl.name}" (${tpl.habits.length} habits)?`)) return;
  const result = await apiCall('/habit-templates/import', 'POST', { habits: tpl.habits });
  if (result) {
    showToast(`${result.count} habits imported! 🎉`);
    await loadHabits();
  }
};

// PWA AND SERVICE WORKER
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err => {
    console.log('Service Worker registration failed:', err);
  });
}

// ═══ #31 SEASONAL AMBIENT BACKGROUNDS ═══
function getSeason() {
  const m = new Date().getMonth(); // 0-11
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 6) return 'monsoon'; // June-July (Indian monsoon)
  if (m >= 7 && m <= 8) return 'summer';  // Aug-Sep
  if (m >= 9 && m <= 10) return 'autumn';
  return 'winter'; // Nov-Feb
}

const SEASON_PARTICLES = {
  spring: ['🌸', '🌼', '🌷', '🦋', '🌿'],
  summer: ['☀️', '🌻', '🍃', '🐝', '🌴'],
  monsoon: ['🌧️', '💧', '☔', '🌊', '🍃'],
  autumn: ['🍂', '🍁', '🍄', '🌾', '🌰'],
  winter: ['❄️', '🌨️', '⭐', '✨', '🤍']
};

function applySeasonalTheme() {
  const hero = document.getElementById('hero-bg');
  if (!hero) return;
  const season = getSeason();
  // Remove old season classes
  hero.classList.remove('season-spring', 'season-summer', 'season-autumn', 'season-winter', 'season-monsoon');
  hero.classList.add('season-' + season);

  // Add floating particles
  const container = document.getElementById('season-particles');
  if (!container) return;
  container.innerHTML = '';
  const particles = SEASON_PARTICLES[season] || [];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;
  for (let i = 0; i < 6; i++) {
    const p = document.createElement('span');
    p.className = 'season-particle';
    p.textContent = particles[i % particles.length];
    p.style.left = (Math.random() * 90 + 5) + '%';
    p.style.animationDuration = (4 + Math.random() * 4) + 's';
    p.style.animationDelay = (Math.random() * 5) + 's';
    p.style.fontSize = (10 + Math.random() * 8) + 'px';
    container.appendChild(p);
  }
}

// ═══ #32 GARDEN METAPHOR ═══
function getPlantStage(streak, isDoneToday) {
  // If streak is 0 and not done today, show wilted
  if (streak === 0 && !isDoneToday) return { emoji: '🌱', label: 'Seed', nextAt: 3 };
  if (streak >= 100) return { emoji: '🌳', label: 'Mighty tree', nextAt: 100 };
  if (streak >= 30) return { emoji: '🌲', label: 'Tree', nextAt: 100 };
  if (streak >= 14) return { emoji: '🌻', label: 'Bloom', nextAt: 30 };
  if (streak >= 7) return { emoji: '🌿', label: 'Sapling', nextAt: 14 };
  if (streak >= 3) return { emoji: '🌱', label: 'Sprout', nextAt: 7 };
  return { emoji: '🫘', label: 'Seed', nextAt: 3 };
}

// ═══ #33 BEDTIME MODE ═══
function checkBedtimeMode() {
  const hour = new Date().getHours();
  const isBedtime = hour >= 21 || hour < 5;
  document.documentElement.setAttribute('data-bedtime', isBedtime ? 'true' : 'false');

  const slot = document.getElementById('bedtime-banner-slot');
  if (!slot) return;

  if (isBedtime) {
    slot.innerHTML = `<div class="bedtime-banner">
      <span class="bedtime-icon">🌙</span>
      <span class="bedtime-text">Time to wind down. You've done enough today — rest is productive too.</span>
    </div>`;
    // Softer greeting
    const greetEl = document.getElementById('time-greeting');
    if (greetEl && hour >= 21) greetEl.textContent = 'evening';
  } else {
    slot.innerHTML = '';
  }
}

// ═══ #34 SHARED CHALLENGES ═══
window.toggleChallengeForm = function() {
  const form = document.getElementById('create-challenge-form');
  form.style.display = form.style.display === 'none' ? '' : 'none';
};

window.createChallenge = async function() {
  const title = document.getElementById('challenge-title').value.trim();
  const desc = document.getElementById('challenge-desc').value.trim();
  const duration = document.getElementById('challenge-duration').value;
  if (!title) { showToast('Give your challenge a name'); return; }
  const result = await apiCall('/challenges', 'POST', { title, description: desc, duration });
  if (result) {
    showToast('Challenge created! 🎉');
    document.getElementById('challenge-title').value = '';
    document.getElementById('challenge-desc').value = '';
    document.getElementById('create-challenge-form').style.display = 'none';
    loadChallenges();
  }
};

async function loadChallenges() {
  const slot = document.getElementById('challenges-list');
  if (!slot) return;
  const challenges = await apiCall('/challenges');
  if (!challenges || challenges.length === 0) {
    slot.innerHTML = '<p style="font-size:12px;color:var(--muted);text-align:center;padding:8px;">No challenges yet. Start one with your friends!</p>';
    return;
  }
  slot.innerHTML = challenges.map(ch => {
    const endDate = new Date(new Date(ch.start_date).getTime() + ch.duration * 86400000);
    const daysLeft = Math.max(0, Math.ceil((endDate - Date.now()) / 86400000));
    const pct = ch.duration > 0 ? Math.round((ch.my_completed_days / ch.duration) * 100) : 0;
    const isActive = daysLeft > 0;
    return `<div class="challenge-card">
      <h4>${escapeHtml(ch.title)}</h4>
      <div class="ch-meta">${escapeHtml(ch.description || '')} • ${ch.duration} days • by ${escapeHtml(ch.creator_name)}</div>
      <div class="ch-progress-bar"><div class="ch-progress-fill" style="width:${pct}%"></div></div>
      <div class="ch-participants">${ch.my_completed_days}/${ch.duration} days done • ${ch.participant_count} participants • ${isActive ? daysLeft + ' days left' : 'Completed!'}</div>
      <div class="ch-actions">
        ${!ch.joined ? `<button class="ch-btn primary" onclick="joinChallenge(${ch.id})">Join</button>` : ''}
        ${ch.joined && isActive ? `<button class="ch-btn primary" onclick="logChallengeDay(${ch.id})">✓ Done today</button>` : ''}
        <button class="ch-btn" onclick="viewChallengeBoard(${ch.id})">Scoreboard</button>
      </div>
    </div>`;
  }).join('');
}

window.joinChallenge = async function(id) {
  const r = await apiCall(`/challenges/${id}/join`, 'POST');
  if (r) { showToast('Joined! 💪'); loadChallenges(); }
};

window.logChallengeDay = async function(id) {
  const r = await apiCall(`/challenges/${id}/log`, 'POST');
  if (r) { showToast('Day logged! 🌟'); loadChallenges(); }
};

window.viewChallengeBoard = async function(id) {
  const data = await apiCall(`/challenges/${id}/progress`);
  if (!data) return;
  const ch = data.challenge;
  const parts = data.participants;
  let html = `<h3>${escapeHtml(ch.title)} — Scoreboard</h3>`;
  html += parts.map((p, i) => {
    const medals = ['🥇','🥈','🥉'];
    const medal = i < 3 ? medals[i] : '';
    const pct = ch.duration > 0 ? Math.round((p.days_done / ch.duration) * 100) : 0;
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;">
      <span>${medal || (i+1)+'.'}</span>
      <span style="flex:1;">${escapeHtml(p.username)}</span>
      <div style="width:80px;height:6px;background:var(--accent-light);border-radius:6px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:var(--success);border-radius:6px;"></div></div>
      <span style="font-size:11px;color:var(--muted);">${p.days_done}/${ch.duration}</span>
    </div>`;
  }).join('');
  showToast(''); // clear any toast
  const overlay = document.getElementById('day-detail-modal');
  const content = document.getElementById('day-detail-content');
  if (overlay && content) {
    content.innerHTML = html + '<div style="margin-top:12px;text-align:center;"><button class="modal-cancel" onclick="closeDayDetail()">Close</button></div>';
    overlay.classList.add('active');
    trapFocus(overlay);
  }
};

// ═══ #35 VOICE JOURNAL ═══
let voiceRecorder = null;
let voiceChunks = [];
let voiceTimerInterval = null;
let voiceStartTime = 0;

window.toggleVoiceRecord = async function() {
  const btn = document.getElementById('voice-record-btn');
  if (voiceRecorder && voiceRecorder.state === 'recording') {
    // Stop recording
    voiceRecorder.stop();
    btn.classList.remove('recording');
    btn.textContent = '🎙';
    clearInterval(voiceTimerInterval);
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceRecorder = new MediaRecorder(stream);
    voiceChunks = [];
    voiceRecorder.ondataavailable = (e) => { if (e.data.size > 0) voiceChunks.push(e.data); };
    voiceRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(voiceChunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onloadend = async () => {
        const audioData = reader.result;
        const duration = Math.round((Date.now() - voiceStartTime) / 1000);
        const result = await apiCall('/voice-journal', 'POST', { audioData, duration });
        if (result) {
          showToast('Voice note saved 🎤');
          renderVoicePlayback(audioData, duration);
        }
      };
      reader.readAsDataURL(blob);
    };
    voiceRecorder.start();
    voiceStartTime = Date.now();
    btn.classList.add('recording');
    btn.textContent = '⏹';
    // Timer display
    const timer = document.getElementById('voice-timer');
    voiceTimerInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - voiceStartTime) / 1000);
      timer.textContent = elapsed + 's';
      if (elapsed >= 30) {
        voiceRecorder.stop();
        btn.classList.remove('recording');
        btn.textContent = '🎙';
        clearInterval(voiceTimerInterval);
      }
    }, 500);
  } catch (e) {
    showToast('Microphone access denied');
  }
};

function renderVoicePlayback(audioSrc, duration) {
  const slot = document.getElementById('voice-playback-slot');
  if (!slot) return;
  slot.innerHTML = `<div class="voice-playback">
    <button onclick="playVoiceNote(this)" aria-label="Play voice note">▶</button>
    <div class="voice-bar"><div class="voice-bar-fill" id="voice-bar-fill"></div></div>
    <span class="voice-dur">${duration}s</span>
    <audio id="voice-audio" src="${escapeHtml(audioSrc)}"></audio>
  </div>`;
}

window.playVoiceNote = function(btn) {
  const audio = document.getElementById('voice-audio');
  if (!audio) return;
  if (audio.paused) {
    audio.play();
    btn.textContent = '⏸';
    const fill = document.getElementById('voice-bar-fill');
    audio.ontimeupdate = () => {
      if (audio.duration) fill.style.width = (audio.currentTime / audio.duration * 100) + '%';
    };
    audio.onended = () => { btn.textContent = '▶'; fill.style.width = '0'; };
  } else {
    audio.pause();
    btn.textContent = '▶';
  }
};

async function loadTodayVoiceJournal() {
  const entry = await apiCall(`/voice-journal/${todayKey()}`);
  if (entry && entry.audio_data) {
    renderVoicePlayback(entry.audio_data, entry.duration_secs || 0);
  }
}

// ═══ #36 TIME CAPSULE ═══
window.createTimeCapsule = async function() {
  const msg = document.getElementById('capsule-message').value.trim();
  if (!msg) { showToast('Write something to your future self'); return; }
  const revealIn = document.getElementById('capsule-duration').value;
  const result = await apiCall('/time-capsules', 'POST', { message: msg, revealIn });
  if (result) {
    showToast(`Capsule sealed! Opens on ${result.reveal_date} 🔮`);
    document.getElementById('capsule-message').value = '';
    loadTimeCapsules();
  }
};

async function loadTimeCapsules() {
  const slot = document.getElementById('capsule-list');
  if (!slot) return;
  const capsules = await apiCall('/time-capsules');
  if (!capsules || capsules.length === 0) { slot.innerHTML = ''; return; }
  const today = todayKey();
  slot.innerHTML = capsules.slice(0, 10).map(c => {
    const isRevealed = c.message !== null;
    const created = new Date(c.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
    const reveal = new Date(c.reveal_date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
    return `<div class="capsule-card ${isRevealed ? '' : 'locked'}">
      <div class="capsule-date">Written on ${created}</div>
      <div class="capsule-reveal">${isRevealed ? '🔓 Opened' : '🔒 Opens on ' + reveal}</div>
      <div class="capsule-msg">${isRevealed ? escapeHtml(c.message) : 'This message is sealed until ' + reveal + '...'}</div>
    </div>`;
  }).join('');
}

// ═══ #37 MOOD TRENDS GRAPH ═══
window.loadMoodTrends = async function(days = 30) {
  // Update button states
  document.getElementById('mood-30').className = days === 30 ? 'ch-btn primary' : 'ch-btn';
  document.getElementById('mood-90').className = days === 90 ? 'ch-btn primary' : 'ch-btn';

  const data = await apiCall(`/mood-trends?days=${days}`);
  if (!data) return;

  const canvas = document.getElementById('mood-chart-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth * 2;
  const H = canvas.height = 360;
  ctx.clearRect(0, 0, W, H);

  const MOOD_MAP = { 'Happy': 5, 'Motivated': 4, 'Calm': 3, 'Meh': 2, 'Tired': 1, 'Stressed': 0 };
  const MOOD_COLORS = { 'Happy': '#4a9d7f', 'Motivated': '#6ba3d4', 'Calm': '#9478cc', 'Meh': '#d4a574', 'Tired': '#8a95a5', 'Stressed': '#e74c3c' };

  const moods = data.moods || [];
  const completions = data.completions || [];

  if (moods.length < 2) {
    ctx.font = '24px DM Sans';
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
    ctx.textAlign = 'center';
    ctx.fillText('Track your mood for a few days to see trends', W/2, H/2);
    return;
  }

  const padL = 40, padR = 20, padT = 20, padB = 40;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  // Draw grid lines
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--card-border').trim() || '#e0e0e0';
  ctx.lineWidth = 1;
  const labels = ['Stressed', 'Tired', 'Meh', 'Calm', 'Motivated', 'Happy'];
  ctx.font = '18px DM Sans';
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
  ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const y = padT + chartH - (i / 5) * chartH;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillText(labels[i], padL - 6, y + 5);
  }

  // Mood line
  ctx.beginPath();
  ctx.strokeStyle = '#6ba3d4';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  moods.forEach((m, i) => {
    const x = padL + (i / (moods.length - 1)) * chartW;
    const val = MOOD_MAP[m.mood] ?? 2;
    const y = padT + chartH - (val / 5) * chartH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Mood dots
  moods.forEach((m, i) => {
    const x = padL + (i / (moods.length - 1)) * chartW;
    const val = MOOD_MAP[m.mood] ?? 2;
    const y = padT + chartH - (val / 5) * chartH;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = MOOD_COLORS[m.mood] || '#6ba3d4';
    ctx.fill();
  });

  // Completion rate bars (faded, behind)
  if (completions.length > 0) {
    completions.forEach((c, i) => {
      const x = padL + (i / (completions.length - 1)) * chartW;
      const rate = c.total > 0 ? c.completed / c.total : 0;
      const barH = rate * chartH * 0.5;
      ctx.fillStyle = 'rgba(74,157,127,0.12)';
      ctx.fillRect(x - 4, padT + chartH - barH, 8, barH);
    });
  }

  // Date labels
  ctx.font = '16px DM Sans';
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(moods.length / 6));
  moods.forEach((m, i) => {
    if (i % step !== 0 && i !== moods.length - 1) return;
    const x = padL + (i / (moods.length - 1)) * chartW;
    const d = new Date(m.log_date);
    ctx.fillText(`${d.getDate()}/${d.getMonth()+1}`, x, H - 8);
  });

  // Legend
  const legend = document.getElementById('mood-legend');
  if (legend) {
    legend.innerHTML = Object.entries(MOOD_COLORS).map(([mood, color]) =>
      `<div class="mood-legend-item"><div class="mood-legend-dot" style="background:${color}"></div>${mood}</div>`
    ).join('') + '<div class="mood-legend-item"><div class="mood-legend-dot" style="background:rgba(74,157,127,0.3)"></div>Habit completion</div>';
  }
};

// ═══ #38 PWA SHORTCUTS ═══
// (Handled via manifest.json - shortcuts added there)

init();