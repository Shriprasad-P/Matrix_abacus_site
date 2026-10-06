const $ = id => document.getElementById(id);
const mobileApp = window.ABACUS_MOBILE === true;
let apiOrigin = mobileApp ? localStorage.getItem('abacus_api_origin') || window.ABACUS_DEFAULT_API_URL || '' : '';
let mobileToken = null;
function apiFetch(path, options={}) {
  if (!mobileApp || !path.startsWith('/api/')) return window.fetch(path, options);
  if (!apiOrigin) return Promise.reject(new Error('Set the institute server URL before signing in.'));
  const headers = new Headers(options.headers || {});
  if (mobileToken) headers.set('Authorization', 'Bearer ' + mobileToken);
  return window.fetch(new URL(path, apiOrigin), {...options, headers, credentials:'omit'});
}
const navButtons = [...document.querySelectorAll('.nav')];
let students = [];
let sessions = [];
let reviewingSession = null;
let feeData = {cycles:[], payments:[]};
let reviewingPayment = null;
let submittingFeeCycle = null;
let worksheetData = {worksheets:[], attempts:[]};
let scheduleData = {enabled:false, slots:[], selection:[]};
let solvingWorksheet = null;
let reviewingWorksheet = null;
let editingStudent = null;
let portalRole = null;
let currentStudent = null;
let activeChallenge = null;
let challengeTimer = null;
let savingAnswer = false;
const upper = [false, false, false, false];
const lower = [0, 0, 0, 0];
const places = ['THOUSANDS', 'HUNDREDS', 'TENS', 'ONES'];

function show(view) {
  if (portalRole === 'admin' && !['dashboard','students','admin-schedule','progress','admin-worksheets','admin-fees'].includes(view)) view = 'dashboard';
  if (portalRole === 'student' && !['student-home','practice','student-schedule','student-worksheets','my-progress','student-fees'].includes(view)) view = 'student-home';
  for (const name of ['dashboard', 'students', 'admin-schedule', 'practice', 'progress', 'admin-worksheets', 'student-home', 'student-schedule', 'student-worksheets', 'my-progress', 'admin-fees', 'student-fees']) $(name + '-view').classList.toggle('hidden', name !== view);
  navButtons.forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $('breadcrumb').textContent = {dashboard:'Overview', students:'Students','admin-schedule':'Class schedule', practice:'Abacus Lab', progress:'Reviews','admin-worksheets':'Worksheets','student-home':'My home','student-schedule':'My classes','student-worksheets':'Worksheets','my-progress':'Profile','admin-fees':'Payments','student-fees':'Payments'}[view];
  if (['progress','my-progress'].includes(view)) loadSessions();
  if (['admin-fees','student-fees'].includes(view)) loadFees();
  if (['progress','admin-worksheets','student-home','student-worksheets','my-progress'].includes(view)) loadWorksheets();
  if (['admin-schedule','student-home','student-schedule'].includes(view)) loadSchedule();
  if (view === 'practice' && !activeChallenge && !savingAnswer) $('new-challenge').click();
}
navButtons.forEach(button => button.addEventListener('click', () => show(button.dataset.view)));
function enterPortal(role, student=null) {
  portalRole = role; currentStudent = student;
  $('portal-gate').classList.add('hidden');
  document.querySelector('.shell').inert = false;
  document.querySelectorAll('.admin-nav').forEach(n => n.classList.toggle('hidden', role !== 'admin'));
  document.querySelectorAll('.student-nav').forEach(n => n.classList.toggle('hidden', role !== 'student'));
  if (role === 'admin') { show('dashboard'); loadStudents(); loadSessions(); loadWorksheets(); loadFees(); }
  else { students = [student]; renderStudentHome(); show('student-home'); }
}
async function signIn(path, payload) {
  $('portal-error').textContent = '';
  try {
    const response = await apiFetch(path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Sign-in failed.');
    if (mobileApp) mobileToken = result.token;
    if (result.role === 'admin') enterPortal('admin');
    else {
      const me = await apiFetch('/api/me');
      if (!me.ok) throw new Error('Could not load student profile.');
      enterPortal('student', (await me.json()).student);
    }
  } catch (error) { $('portal-error').textContent = error.message; }
}
$('admin-login').onsubmit = event => { event.preventDefault(); signIn('/api/login/admin',{password:$('admin-password').value}); };
$('student-login').onsubmit = event => { event.preventDefault(); signIn('/api/login/student',{student_id:$('student-id').value,code:$('student-code').value}); };
$('switch-portal').onclick = async () => { await apiFetch('/api/logout',{method:'POST'}); location.reload(); };
async function restoreSession() {
  if (mobileApp) return;
  const response = await apiFetch('/api/me');
  if (!response.ok) return;
  const me = await response.json();
  enterPortal(me.role, me.student);
}
if (mobileApp) {
  $('mobile-server-settings').classList.remove('hidden');
  $('mobile-server-settings').open = !apiOrigin;
  $('mobile-server-url').value = apiOrigin;
  $('mobile-server-status').textContent = apiOrigin ? 'Server: ' + apiOrigin : 'Enter your institute’s HTTPS server address.';
  $('mobile-server-form').onsubmit = event => {
    event.preventDefault();
    try {
      const url = new URL($('mobile-server-url').value);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','10.0.2.2'].includes(url.hostname))) throw new Error('Use an HTTPS address. HTTP is only allowed for local simulator testing.');
      apiOrigin = url.origin;
      localStorage.setItem('abacus_api_origin', apiOrigin);
      $('mobile-server-status').textContent = 'Server: ' + apiOrigin;
      $('mobile-server-settings').open = false;
      $('portal-error').textContent = '';
    } catch (error) { $('mobile-server-status').textContent = error.message; }
  };
}
['dashboard-add', 'students-add'].forEach(id => $(id).onclick = () => openStudentForm());
$('close-dialog').onclick = $('cancel-dialog').onclick = () => $('student-dialog').close();
$('view-all').onclick = () => show('students');
$('hero-practice').onclick = () => show('progress');
$('dashboard-payments').onclick = () => show('admin-fees');
$('student-start').onclick = () => show('practice');
$('student-view-progress').onclick = () => show('my-progress');
$('student-open-schedule').onclick = () => show('student-schedule');
$('admin-open-schedule').onclick = () => show('admin-schedule');
$('today').textContent = new Intl.DateTimeFormat('en', {dateStyle:'medium'}).format(new Date());

const weekdays = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const classSlotId = slot => `${slot.day}|${slot.start}|${slot.end}`;
const classSlotLabel = slot => `${weekdays[slot.day]} · ${slot.start}–${slot.end}`;

function addScheduleSlotRow(slot={day:0,start:'16:00',end:'17:00',capacity:12,instructor:''}) {
  const row = document.createElement('div');
  row.className = 'schedule-slot-row';
  row.innerHTML = `<label>Day<select class="slot-day">${weekdays.map((day, index) => `<option value="${index}">${day}</option>`).join('')}</select></label><label>Starts<input class="slot-start" type="time" required></label><label>Ends<input class="slot-end" type="time" required></label><label>Capacity<input class="slot-capacity" type="number" min="1" max="100" required></label><label>Instructor<input class="slot-instructor" maxlength="80" placeholder="Optional"></label><button class="secondary" type="button" aria-label="Remove class time">Remove</button>`;
  row.querySelector('.slot-day').value = slot.day;
  row.querySelector('.slot-start').value = slot.start;
  row.querySelector('.slot-end').value = slot.end;
  row.querySelector('.slot-capacity').value = slot.capacity || 12;
  row.querySelector('.slot-instructor').value = slot.instructor || '';
  row.querySelector('button').onclick = () => row.remove();
  $('schedule-slot-rows').append(row);
}

function renderSchedule() {
  const available = new Set(scheduleData.slots.map(classSlotId));
  if (portalRole === 'admin') {
    $('schedule-enabled').checked = scheduleData.enabled;
    $('schedule-slot-rows').replaceChildren();
    scheduleData.slots.forEach(addScheduleSlotRow);
    $('admin-slot-rosters').replaceChildren();
    for (const slot of scheduleData.slots) {
      const card = document.createElement('article'); card.className = 'session-card';
      const details = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = classSlotLabel(slot);
      const meta = document.createElement('p'); meta.textContent = (slot.instructor || 'Instructor not assigned') + ' · ' + slot.booked + '/' + slot.capacity + ' seats booked';
      const enrolled = (scheduleData.students || []).filter(student =>
        student.selection.some(chosen => classSlotId(chosen) === classSlotId(slot)));
      details.append(title, meta);
      if (enrolled.length) {
        const names = document.createElement('ul'); names.className = 'roster-students';
        for (const student of enrolled) addText(names, 'li', student.name);
        details.append(names);
      } else addText(details, 'small', 'No students enrolled yet.');
      card.append(details); $('admin-slot-rosters').append(card);
    }
    if (!scheduleData.slots.length) $('admin-slot-rosters').textContent = 'No class times configured yet.';
    $('admin-schedule-list').replaceChildren();
    for (const student of scheduleData.students || []) {
      const card = document.createElement('article');
      card.className = 'session-card';
      const details = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = student.name;
      const times = document.createElement('p');
      times.textContent = student.selection.length ? student.selection.map(classSlotLabel).join(' · ') : 'No classes chosen yet';
      details.append(name, times);
      if (student.selection.some(slot => !available.has(classSlotId(slot)))) {
        const warning = document.createElement('small'); warning.textContent = 'Schedule needs updating: a class time is no longer offered.';
        details.append(warning);
      }
      card.append(details);
      $('admin-schedule-list').append(card);
    }
    if (!scheduleData.students?.length) $('admin-schedule-list').textContent = 'No active students yet.';
    return;
  }
  const selected = scheduleData.selection || [];
  const current = selected.length ? selected.map(classSlotLabel).join(' · ') : 'No classes chosen yet.';
  const needsUpdate = selected.some(slot => !available.has(classSlotId(slot)));
  $('schedule-home-summary').textContent = current + (needsUpdate ? ' Please choose from the current class times.' : '');
  $('student-schedule-current').textContent = current + (needsUpdate ? ' A class time is no longer offered; please update your choices.' : '');
  $('student-schedule-options').replaceChildren();
  if (!scheduleData.enabled) {
    $('student-schedule-options').textContent = 'Your instructor has not opened class scheduling yet.';
  } else {
    for (const slot of scheduleData.slots) {
      const label = document.createElement('label'); label.className = 'schedule-choice';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = classSlotId(slot);
      checkbox.checked = selected.some(chosen => classSlotId(chosen) === checkbox.value);
      checkbox.disabled = !checkbox.checked && slot.booked >= slot.capacity;
      label.append(checkbox, document.createTextNode(classSlotLabel(slot) + ' · ' + slot.booked + '/' + slot.capacity + (checkbox.disabled ? ' · Full' : '')));
      $('student-schedule-options').append(label);
    }
  }
  $('student-schedule-form').querySelector('button[type="submit"]').disabled = !scheduleData.enabled;
}

async function loadSchedule() {
  try {
    const response = await apiFetch('/api/schedule');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load class times.');
    scheduleData = result;
    renderSchedule();
  } catch (error) {
    $(portalRole === 'admin' ? 'schedule-settings-message' : 'student-schedule-message').textContent = error.message;
  }
}

$('add-schedule-slot').onclick = () => addScheduleSlotRow();
$('schedule-settings-form').onsubmit = async event => {
  event.preventDefault();
  const slots = [...$('schedule-slot-rows').children].map(row => ({
    day:Number(row.querySelector('.slot-day').value), start:row.querySelector('.slot-start').value,
    end:row.querySelector('.slot-end').value, capacity:Number(row.querySelector('.slot-capacity').value),
    instructor:row.querySelector('.slot-instructor').value.trim()
  }));
  try {
    const response = await apiFetch('/api/schedule/settings', {method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({enabled:$('schedule-enabled').checked, slots})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save class times.');
    await loadSchedule();
    $('schedule-settings-message').textContent = 'Class times saved.';
  } catch (error) { $('schedule-settings-message').textContent = error.message; }
};
$('student-schedule-form').onsubmit = async event => {
  event.preventDefault();
  const chosen = [...$('student-schedule-options').querySelectorAll('input:checked')].map(input => input.value);
  const byId = new Map(scheduleData.slots.map(slot => [classSlotId(slot), slot]));
  if (chosen.length !== 2 || byId.get(chosen[0])?.day === byId.get(chosen[1])?.day) {
    $('student-schedule-message').textContent = 'Choose exactly two class times on different days.';
    return;
  }
  try {
    const response = await apiFetch('/api/schedule/my', {method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({slot_ids:chosen})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save your class times.');
    await loadSchedule();
    $('student-schedule-message').textContent = 'Your two weekly classes are saved.';
  } catch (error) { $('student-schedule-message').textContent = error.message; }
};

async function loadStudents() {
  try {
    const response = await apiFetch('/api/students');
    if (!response.ok) throw new Error('Could not load students.');
    students = await response.json();
    renderStudents();
    renderDashboardCounts();
  } catch (error) {
    $('student-empty').textContent = error.message;
    $('student-empty').classList.remove('hidden');
  }
}
function renderStudents() {
  const query = $('student-search').value.trim().toLowerCase();
  const shown = students.filter(s => (!s.archived || $('show-archived').checked) &&
    [s.name, s.guardian, s.level].some(value => value.toLowerCase().includes(query)));
  const tbody = $('student-rows');
  tbody.replaceChildren();
  for (const s of shown) {
    const row = document.createElement('tr');
    [s.name, s.age, s.level, s.guardian, s.phone].forEach((value, index) => {
      const cell = document.createElement('td');
      cell.dataset.label = ['Student', 'Age', 'Level', 'Guardian', 'Contact'][index];
      if (value === s.level) { const pill = document.createElement('span'); pill.className = 'pill'; pill.textContent = value; cell.append(pill); }
      else cell.textContent = value;
      row.append(cell);
    });
    const progressCell = document.createElement('td');
    progressCell.dataset.label = 'Progress';
    progressCell.append(progressBar(s.progress, s.name));
    row.append(progressCell);
    const action = document.createElement('td');
    action.className = 'student-actions';
    const edit = document.createElement('button'); edit.className = 'code-reset'; edit.textContent = 'Edit';
    edit.setAttribute('aria-label', 'Edit ' + s.name); edit.onclick = () => openStudentForm(s);
    const reset = document.createElement('button');
    reset.className = 'code-reset'; reset.textContent = 'Access code';
    reset.setAttribute('aria-label', 'Reset access code for ' + s.name);
    reset.onclick = async () => {
      if (!confirm('Generate a new access code for ' + s.name + '? The old code will stop working.')) return;
      const response = await apiFetch('/api/students/' + s.id + '/reset-code', {method:'POST'});
      const result = await response.json();
      if (response.ok) showCode(result.student_id, result.access_code);
      else alert(result.error || 'Could not reset access code.');
    };
    const archive = document.createElement('button');
    archive.className = 'code-reset'; archive.textContent = s.archived ? 'Restore' : 'Archive';
    archive.setAttribute('aria-label', (s.archived ? 'Restore ' : 'Archive ') + s.name);
    archive.onclick = async () => {
      if (!s.archived && !confirm('Archive ' + s.name + '? Their sign-in will stop until restored.')) return;
      const response = await apiFetch('/api/students/' + s.id + '/archive', {method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify({archived:!s.archived})});
      if (response.ok) await loadStudents();
      else alert((await response.json()).error || 'Could not update student.');
    };
    action.append(edit,reset,archive); row.append(action); tbody.append(row);
  }
  $('student-empty').textContent = query ? 'No matching students.' : 'No students yet. Add your first student to get started.';
  $('student-empty').classList.toggle('hidden', shown.length > 0);
  $('student-count').textContent = students.filter(s => !s.archived).length;
  const recent = $('recent-students'); recent.replaceChildren();
  for (const s of students.filter(s => !s.archived).slice(0, 3)) {
    const card = document.createElement('article'); card.className = 'recent-card';
    const avatar = document.createElement('span'); avatar.className = 'initials'; avatar.textContent = s.name.split(/\s+/).map(x => x[0]).slice(0,2).join('').toUpperCase();
    const details = document.createElement('span'); const name = document.createElement('strong'); name.textContent = s.name;
    const level = document.createElement('small'); level.textContent = s.level + ' · Age ' + s.age;
    details.append(name,level,progressBar(s.progress,s.name)); card.append(avatar,details); recent.append(card);
  }
  if (!recent.children.length) recent.textContent = 'No active students yet. Add a student to see them here.';
}
function progressBar(percent, name) {
  const wrap = document.createElement('span'); wrap.className = 'progress-widget';
  const bar = document.createElement('progress'); bar.max = 100; bar.value = percent;
  bar.setAttribute('aria-label', name + ' progress');
  const label = document.createElement('small'); label.textContent = percent + '%';
  wrap.append(bar,label); return wrap;
}
$('student-search').oninput = renderStudents;
$('show-archived').onchange = renderStudents;
function openStudentForm(student=null) {
  editingStudent = student;
  const form = $('student-form'); form.reset();
  $('student-dialog-title').textContent = student ? 'Edit student' : 'Add a student';
  $('student-save-button').textContent = student ? 'Save changes' : 'Save student';
  if (student) for (const key of ['name','age','guardian','phone','level']) form.elements[key].value = student[key];
  $('form-error').textContent = '';
  $('student-dialog').showModal();
}
$('student-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const details = Object.fromEntries(new FormData(form));
  $('form-error').textContent = '';
  try {
    const response = await apiFetch(editingStudent ? '/api/students/' + editingStudent.id : '/api/students',
      {method:editingStudent ? 'PUT' : 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(details)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save student.');
    form.reset(); $('student-dialog').close(); show('students'); await loadStudents();
    if (!editingStudent) showCode(result.id,result.access_code);
    editingStudent = null;
  } catch (error) { $('form-error').textContent = error.message; }
};
function showCode(id, code) {
  $('new-student-id').textContent = id;
  $('new-student-code').textContent = code;
  $('code-dialog').showModal();
}
$('close-code').onclick = $('done-code').onclick = () => $('code-dialog').close();

async function loadSessions() {
  try {
    if (portalRole === 'student') {
      const me = await apiFetch('/api/me');
      if (!me.ok) throw new Error('Could not refresh student progress.');
      currentStudent = (await me.json()).student;
      students = [currentStudent];
      renderStudentHome();
    }
    const response = await apiFetch('/api/sessions');
    if (!response.ok) throw new Error('Could not load practice sessions.');
    sessions = await response.json();
    if (portalRole === 'admin') { renderSessions(); renderDashboardCounts(); } else renderStudentSessions();
  } catch (error) {
    const empty = $(portalRole === 'student' ? 'my-session-empty' : 'session-empty');
    empty.textContent = error.message; empty.classList.remove('hidden');
  }
}
function renderStudentHome() {
  if (!currentStudent) return;
  $('student-welcome').textContent = 'Hi, ' + currentStudent.name.split(/\s+/)[0] + '! 👋';
  $('profile-name').textContent = currentStudent.name;
  $('profile-level').textContent = currentStudent.level + ' · Student ID ' + currentStudent.id;
  $('my-progress').value = currentStudent.progress;
  $('my-progress-text').textContent = currentStudent.progress + '%';
  $('profile-checkpoint').textContent = checkpoint(currentStudent.progress);
  $('profile-mastery').textContent = 'Timed practice: ' + (currentStudent.mastery_streak || 0) + ' of 5 correct in a row.';
}
function checkpoint(progress) {
  return ['Starting','Building','Practicing','Confident','Mastered'][Math.min(4, Math.floor(progress / 25))];
}
function renderStudentSessions() {
  const all = $('my-session-list'); all.replaceChildren();
  const currentSessions = sessions.filter(session => session.level_at_attempt === currentStudent.level);
  $('profile-practice-count').textContent = currentSessions.length;
  $('profile-accuracy').textContent = currentSessions.length ? Math.round(100 * currentSessions.filter(session => session.correct).length / currentSessions.length) + '%' : '—';
  $('my-session-empty').classList.toggle('hidden', sessions.length > 0);
  for (const session of sessions) {
    const card = document.createElement('article'); card.className = 'session-card';
    const details = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = (session.correct ? '✓ Correct' : '↗ Keep practicing') + ' · Target ' + String(session.target).padStart(4,'0');
    const result = document.createElement('p');
    result.textContent = 'Your answer: ' + String(session.answer).padStart(4,'0') +
      (session.on_time === null ? '' : ' · ' + (session.on_time ? 'Within' : 'After') + ' ' + session.duration_seconds + 's limit');
    const status = document.createElement('small'); status.textContent = session.auto_promoted ?
      'Level advanced automatically after timed practice' :
      session.level_at_attempt !== session.current_level ?
      `Earlier level (${session.level_at_attempt || 'unverified'}) · history only` :
      session.reviewed_progress === null ? 'Awaiting instructor review' : 'Reviewed · ' + session.reviewed_progress + '% progress';
    details.append(title,result,status); card.append(details); all.append(card);
  }
}
function renderSessions() {
  const list = $('session-list'); list.replaceChildren();
  $('session-count').textContent = sessions.length + (sessions.length === 1 ? ' session' : ' sessions');
  $('session-empty').classList.toggle('hidden', sessions.length > 0);
  for (const session of sessions) {
    const card = document.createElement('article'); card.className = 'session-card';
    const main = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = session.student_name;
    const detail = document.createElement('p');
    detail.textContent = 'Target ' + String(session.target).padStart(4,'0') + ' · Answer ' + String(session.answer).padStart(4,'0') + ' · ' + (session.correct ? 'Correct' : 'Needs practice') +
      (session.on_time === null ? '' : ' · ' + (session.on_time ? 'On time' : 'Time expired'));
    const stale = session.level_at_attempt !== session.current_level;
    const status = document.createElement('small'); status.textContent = session.auto_promoted ?
      'Advanced automatically after timed practice' :
      stale ? 'Earlier or unverified level · history only' : session.reviewed_progress === null ? 'Awaiting admin review' : 'Reviewed · ' + session.reviewed_progress + '% progress';
    main.append(name,detail,status);
    const button = document.createElement('button'); button.className = 'secondary'; button.textContent = session.reviewed_progress === null ? 'Review' : 'Edit review';
    button.disabled = stale;
    button.onclick = () => openReview(session);
    card.append(main,button); list.append(card);
  }
}
function renderDashboardCounts() {
  if (portalRole !== 'admin') return;
  $('pending-review-count').textContent = sessions.filter(s => s.reviewed_progress === null && s.level_at_attempt === s.current_level).length +
    worksheetData.attempts.filter(a => a.reviewed_progress === null && a.level_at_attempt === a.current_level).length;
  const cycle = currentFee();
  $('fee-followup-count').textContent = feeData.payments.filter(p => p.status === 'pending' ||
    (cycle && p.cycle_id === cycle.id && !p.archived && p.status !== 'paid')).length;
}
function openReview(session) {
  reviewingSession = session;
  $('review-session-summary').textContent = session.student_name + ' · Target ' + String(session.target).padStart(4,'0') + ' · ' + (session.correct ? 'Correct answer' : 'Needs more practice');
  const current = students.find(s => s.id === session.student_id)?.progress ?? 0;
  $('review-progress').min = Math.ceil(current / 25) * 25;
  $('review-progress').value = Math.max(session.reviewed_progress ?? current, current);
  $('review-value').textContent = $('review-progress').value + '%';
  $('review-note').value = session.admin_note;
  $('review-error').textContent = '';
  $('review-dialog').showModal();
}
$('review-progress').oninput = () => $('review-value').textContent = $('review-progress').value + '%';
$('close-review').onclick = $('cancel-review').onclick = () => $('review-dialog').close();
$('review-form').onsubmit = async event => {
  event.preventDefault();
  if (!reviewingSession) return;
  try {
    const response = await apiFetch('/api/sessions/' + reviewingSession.id + '/review', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({progress:$('review-progress').value,note:$('review-note').value})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save progress.');
    $('review-dialog').close(); await loadStudents(); await loadSessions();
  } catch (error) { $('review-error').textContent = error.message; }
};

const rupees = paise => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(paise / 100);
const currentFee = () => feeData.cycles.find(cycle => cycle.active === 1);
const paymentStatus = row => row?.status || 'unpaid';
function addText(parent, tag, value, className='') {
  const node = document.createElement(tag); node.textContent = value;
  if (className) node.className = className;
  parent.append(node); return node;
}
async function loadFees() {
  try {
    const response = await apiFetch('/api/fees');
    if (!response.ok) throw new Error('Could not load payments.');
    feeData = await response.json();
    if (portalRole === 'admin') renderAdminFees(); else renderStudentFees();
    renderDashboardCounts();
  } catch (error) {
    $(portalRole === 'admin' ? 'admin-fee-summary' : 'student-fee-current').textContent = error.message;
  }
}
function renderAdminFees() {
  const cycle = currentFee(), summary = $('admin-fee-summary'), list = $('admin-fee-list');
  summary.replaceChildren(); list.replaceChildren();
  if (!cycle) { addText(summary,'h2','No current fee'); addText(summary,'p','Set a fee amount and payment details for all students.'); return; }
  const rows = feeData.payments.filter(row => row.cycle_id === cycle.id);
  addText(summary,'small','CURRENT FEE'); addText(summary,'h2',cycle.label);
  addText(summary,'div',rupees(cycle.amount_paise),'fee-amount');
  if (cycle.due_date) addText(summary,'p','Due ' + cycle.due_date);
  addText(summary,'p',`${rows.filter(row => row.status === 'pending').length} awaiting verification · ${rows.filter(row => row.status === 'paid').length} paid · ${rows.length} ${rows.length === 1 ? 'student' : 'students'}`);
  if (cycle.upi_id) addText(summary,'p','UPI: ' + cycle.upi_id);
  if (cycle.instructions) addText(summary,'p',cycle.instructions,'fee-instructions');
  const earlierPending = feeData.payments.filter(row => row.cycle_id !== cycle.id && row.status === 'pending');
  if (!rows.length && !earlierPending.length) { addText(list,'p','No students yet. Add a student to see their fee status.'); return; }
  for (const row of [...rows, ...earlierPending]) {
    if (row === earlierPending[0]) addText(list,'h3',`Earlier fees awaiting verification (${earlierPending.length})`);
    const rowCycle = feeData.cycles.find(item => item.id === row.cycle_id);
    const card = document.createElement('article'); card.className = 'session-card';
    const details = document.createElement('div');
    addText(details,'strong',row.student_name + (row.archived ? ' · archived' : ''));
    if (row.cycle_id !== cycle.id) addText(details,'p',rowCycle.label + ' · ' + rupees(rowCycle.amount_paise));
    const meta = document.createElement('div'); meta.className = 'fee-card-meta';
    addText(meta,'span',paymentStatus(row),'fee-status ' + paymentStatus(row));
    if (row.reference) addText(meta,'small','Reference: ' + row.reference);
    details.append(meta);
    if (row.admin_note) addText(details,'p',row.admin_note);
    card.append(details);
    if (row.status === 'pending') {
      const button = addText(card,'button','Review transfer','secondary');
      button.onclick = () => {
        reviewingPayment = row;
        $('payment-review-summary').textContent = `${row.student_name} · ${rowCycle.label} · ${rupees(rowCycle.amount_paise)} · Reference ${row.reference}`;
        $('payment-review-note').value = '';
        $('bank-verified').checked = false;
        $('payment-review-error').textContent = '';
        $('payment-review-dialog').showModal();
      };
    }
    list.append(card);
  }
}
function paymentActions(cycle) {
  const actions = document.createElement('div'); actions.className = 'fee-actions';
  if (cycle.upi_id) {
    const params = new URLSearchParams({pa:cycle.upi_id,pn:'Matrix Abacus',am:(cycle.amount_paise/100).toFixed(2),cu:'INR'});
    const link = addText(actions,'a','Open any UPI app','primary'); link.href = 'upi://pay?' + params;
  }
  const button = addText(actions,'button','I have paid · Send reference','secondary');
  button.onclick = () => { submittingFeeCycle = cycle; $('payment-summary').textContent = `${cycle.label} · ${rupees(cycle.amount_paise)}`; $('payment-error').textContent = ''; $('payment-form').reset(); $('payment-dialog').showModal(); };
  return actions;
}
function renderStudentFees() {
  const cycle = currentFee(), summary = $('student-fee-current'), history = $('student-fee-history');
  summary.replaceChildren(); history.replaceChildren();
  if (!cycle) { addText(summary,'h2','No current fee'); addText(summary,'p','Your institute has not set a fee yet.'); }
  else {
    const row = feeData.payments.find(payment => payment.cycle_id === cycle.id);
    const status = paymentStatus(row);
    addText(summary,'small','CURRENT FEE'); addText(summary,'h2',cycle.label);
    addText(summary,'div',rupees(cycle.amount_paise),'fee-amount');
    if (cycle.due_date) addText(summary,'p','Due ' + cycle.due_date);
    addText(summary,'span',status,'fee-status ' + status);
    if (cycle.upi_id) addText(summary,'p','Pay to UPI ID: ' + cycle.upi_id);
    if (cycle.instructions) addText(summary,'p',cycle.instructions,'fee-instructions');
    if (row?.reference) addText(summary,'p','Submitted reference: ' + row.reference);
    if (row?.admin_note) addText(summary,'p','Admin note: ' + row.admin_note);
    if (status === 'pending') addText(summary,'p','Your reference is awaiting admin verification.');
    if (status === 'paid') addText(summary,'p','Your transfer has been confirmed by the admin.');
    if (status === 'rejected') addText(summary,'p','Please check the transfer and submit a new reference.');
    if (status === 'unpaid' || status === 'rejected') summary.append(paymentActions(cycle));
  }
  for (const old of feeData.cycles.filter(item => item.id !== cycle?.id)) {
    const latest = feeData.payments.find(payment => payment.cycle_id === old.id);
    const card = worksheetCard(old.label, rupees(old.amount_paise) + (old.due_date ? ' · Due ' + old.due_date : '') +
      (old.upi_id ? ' · UPI: ' + old.upi_id : '') + (old.instructions ? ' · ' + old.instructions : ''),
      'Fee status: ' + paymentStatus(latest), '', null);
    if (!latest?.status || latest.status === 'rejected') card.append(paymentActions(old));
    history.append(card);
  }
  for (const row of feeData.history) {
    const card = document.createElement('article'); card.className = 'session-card';
    const details = document.createElement('div');
    addText(details,'strong',row.label + ' · ' + rupees(row.amount_paise));
    addText(details,'p','Reference: ' + row.reference + ' · Submitted ' + row.submitted_at + ' UTC');
    addText(details,'span',paymentStatus(row),'fee-status ' + paymentStatus(row));
    if (row.admin_note) addText(details,'p','Admin note: ' + row.admin_note);
    card.append(details);
    if (row.status === 'paid') addText(card,'button','View receipt','secondary').onclick = () => openReceipt(row);
    history.append(card);
  }
  if (!history.children.length) addText(history,'p','No payment submissions yet.');
}
function openReceipt(payment) {
  const details = $('receipt-details'); details.replaceChildren();
  addText(details,'strong','Matrix Abacus');
  addText(details,'p','Receipt AI-' + String(payment.id).padStart(6,'0'));
  addText(details,'p','Student: ' + currentStudent.name + ' · ID ' + currentStudent.id);
  addText(details,'p','Fee: ' + payment.label + ' · ' + rupees(payment.amount_paise));
  if (payment.due_date) addText(details,'p','Due date: ' + payment.due_date);
  addText(details,'p','Reference: ' + payment.reference);
  addText(details,'p','Confirmed: ' + payment.reviewed_at + ' UTC');
  $('receipt-dialog').showModal();
}
$('close-receipt').onclick = () => $('receipt-dialog').close();
$('print-receipt').onclick = () => window.print();
$('set-fee').onclick = () => { $('fee-error').textContent = ''; $('fee-dialog').showModal(); };
$('close-fee').onclick = $('cancel-fee').onclick = () => $('fee-dialog').close();
$('fee-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const response = await apiFetch('/api/fees',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not set fee.');
    $('fee-dialog').close(); form.reset(); await loadFees();
  } catch (error) { $('fee-error').textContent = error.message; }
};
$('refresh-fees').onclick = loadFees;
$('close-payment').onclick = $('cancel-payment').onclick = () => $('payment-dialog').close();
$('payment-form').onsubmit = async event => {
  event.preventDefault();
  try {
    const response = await apiFetch('/api/fees/' + submittingFeeCycle.id + '/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference:$('payment-reference').value})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not submit reference.');
    $('payment-dialog').close(); await loadFees();
  } catch (error) { $('payment-error').textContent = error.message; }
};
$('close-payment-review').onclick = () => $('payment-review-dialog').close();
async function reviewPayment(status) {
  try {
    if (status === 'paid' && !$('bank-verified').checked) throw new Error('Check the bank or UPI statement before confirming payment.');
    const response = await apiFetch('/api/fees/' + reviewingPayment.payment_id + '/review',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,note:$('payment-review-note').value,bank_verified:$('bank-verified').checked})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not review payment.');
    $('payment-review-dialog').close(); await loadFees();
  } catch (error) { $('payment-review-error').textContent = error.message; }
}
$('confirm-payment').onclick = () => reviewPayment('paid');
$('reject-payment').onclick = () => reviewPayment('rejected');
async function loadWorksheets() {
  try {
    const response = await apiFetch('/api/worksheets');
    if (!response.ok) throw new Error('Could not load worksheets.');
    worksheetData = await response.json();
    if (portalRole === 'admin') { renderAdminWorksheets(); renderDashboardCounts(); }
    else { renderStudentWorksheets(); renderStudentNext(); }
  } catch (error) {
    $(portalRole === 'admin' ? 'admin-worksheet-list' : 'student-worksheet-list').textContent = error.message;
  }
}
function worksheetCard(title, detail, status, action, onClick) {
  const card = document.createElement('article'); card.className = 'session-card';
  const body = document.createElement('div');
  addText(body,'strong',title); addText(body,'p',detail); addText(body,'small',status);
  card.append(body);
  if (action) { const button = addText(card,'button',action,'secondary'); button.onclick = onClick; }
  return card;
}
function renderAdminWorksheets() {
  const list = $('admin-worksheet-list'), results = $('admin-worksheet-results');
  list.replaceChildren(); results.replaceChildren();
  $('worksheet-review-count').textContent = worksheetData.attempts.length + (worksheetData.attempts.length === 1 ? ' attempt' : ' attempts');
  for (const worksheet of worksheetData.worksheets) list.append(worksheetCard(worksheet.title, worksheet.level + ' · ' + worksheet.questions.length + ' questions', 'Assigned', '', null));
  if (!worksheetData.worksheets.length) addText(list,'p','No worksheets yet. Create one to get started.');
  for (const attempt of worksheetData.attempts) {
    const stale = attempt.level_at_attempt !== attempt.current_level;
    const card = worksheetCard(attempt.student_name, attempt.title + ' · Attempt ' + attempt.attempt_number + ' · ' + attempt.score + '/' + attempt.total + ' correct',
      stale ? 'Earlier or unverified level · history only' : attempt.reviewed_progress === null ? 'Awaiting review' : 'Reviewed · ' + attempt.reviewed_progress + '% progress',
      stale ? '' : attempt.reviewed_progress === null ? 'Review' : 'Edit review', () => openWorksheetReview(attempt));
    results.append(card);
  }
  if (!worksheetData.attempts.length) addText(results,'p','No student submissions yet.');
}
function renderStudentWorksheets() {
  const list = $('student-worksheet-list'), results = $('profile-worksheet-results');
  list.replaceChildren(); results.replaceChildren();
  $('profile-worksheet-count').textContent = new Set(worksheetData.attempts.filter(attempt => attempt.score === attempt.total).map(attempt => attempt.worksheet_id)).size;
  for (const worksheet of worksheetData.worksheets) {
    const attempts = worksheetData.attempts.filter(item => item.worksheet_id === worksheet.id);
    const attempt = attempts[0];
    const canRetry = attempts.length < 3 && (!attempt || attempt.score < attempt.total);
    const missed = attempt?.correctness.flatMap((correct, index) => correct ? [] : [index + 1]).join(', ');
    list.append(worksheetCard(worksheet.title, worksheet.level + ' · ' + worksheet.questions.length + ' questions',
      attempt ? `Latest: ${attempt.score}/${attempt.total} correct · Attempt ${attempts.length}/3${missed ? ' · Revisit questions ' + missed : ''}` : 'Ready to solve',
      canRetry ? (attempt ? 'Try again' : 'Start worksheet') : '', canRetry ? () => openWorksheet(worksheet) : null));
  }
  if (!worksheetData.worksheets.length) addText(list,'p','Your instructor has not assigned a worksheet for your level yet.');
  for (const attempt of worksheetData.attempts) results.append(worksheetCard(attempt.title,
    'Attempt ' + attempt.attempt_number + ' · ' + attempt.score + '/' + attempt.total + ' correct' +
      (attempt.correctness.some(correct => !correct) ? ' · Revisit questions ' + attempt.correctness.flatMap((correct, index) => correct ? [] : [index + 1]).join(', ') : '') +
      (attempt.admin_note ? ' · ' + attempt.admin_note : ''),
    attempt.level_at_attempt !== currentStudent.level ? `Earlier level (${attempt.level_at_attempt || 'unverified'}) · history only` :
      attempt.reviewed_progress === null ? 'Awaiting instructor review' : 'Reviewed · ' + attempt.reviewed_progress + '% progress', '', null));
  if (!worksheetData.attempts.length) addText(results,'p','No worksheet attempts yet.');
}
function renderStudentNext() {
  if (portalRole !== 'student') return;
  const next = worksheetData.worksheets.find(worksheet => {
    const attempts = worksheetData.attempts.filter(item => item.worksheet_id === worksheet.id);
    return attempts.length < 3 && (!attempts.length || attempts[0].score < attempts[0].total);
  });
  $('next-step-title').textContent = next ? next.title : 'Ready for practice?';
  $('next-step-detail').textContent = next ? 'Continue this ' + next.level + ' worksheet.' : 'Start a challenge matched to your level.';
  $('student-start').textContent = next ? 'Open worksheet →' : 'Start practicing ↗';
  $('student-start').onclick = () => show(next ? 'student-worksheets' : 'practice');
}
function openWorksheet(worksheet) {
  solvingWorksheet = worksheet;
  $('worksheet-solve-title').textContent = worksheet.title;
  $('worksheet-solve-error').textContent = '';
  const list = $('worksheet-questions'); list.replaceChildren();
  worksheet.questions.forEach((question, index) => {
    const label = document.createElement('label'); label.className = 'worksheet-question';
    addText(label,'span',(index + 1) + '. ' + question.prompt + ' =');
    const input = document.createElement('input'); input.type = 'number'; input.min = 0; input.max = 9999;
    input.required = true; input.inputMode = 'numeric'; input.setAttribute('aria-label', question.prompt + ' answer');
    label.append(input); list.append(label);
  });
  $('worksheet-solve-dialog').showModal();
}
function openWorksheetReview(attempt) {
  reviewingWorksheet = attempt;
  $('worksheet-review-summary').textContent = attempt.student_name + ' · ' + attempt.title + ' · Attempt ' + attempt.attempt_number + ' · ' + attempt.score + '/' + attempt.total + ' correct. Answers: ' + attempt.answers.map((answer, index) => answer + (attempt.correctness[index] ? ' ✓' : ' ✕')).join(', ');
  const current = students.find(student => student.id === attempt.student_id)?.progress ?? 0;
  $('worksheet-review-progress').min = Math.ceil(current / 25) * 25;
  $('worksheet-review-progress').value = Math.max(attempt.reviewed_progress ?? current, current);
  $('worksheet-review-value').textContent = $('worksheet-review-progress').value + '%';
  $('worksheet-review-note').value = attempt.admin_note;
  $('worksheet-review-error').textContent = '';
  $('worksheet-review-dialog').showModal();
}
$('create-worksheet').onclick = () => { $('worksheet-error').textContent = ''; $('worksheet-dialog').showModal(); };
$('close-worksheet').onclick = $('cancel-worksheet').onclick = () => $('worksheet-dialog').close();
$('worksheet-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const response = await apiFetch('/api/worksheets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not assign worksheet.');
    form.reset(); $('worksheet-dialog').close(); await loadWorksheets();
  } catch (error) { $('worksheet-error').textContent = error.message; }
};
$('close-worksheet-solve').onclick = $('cancel-worksheet-solve').onclick = () => $('worksheet-solve-dialog').close();
$('worksheet-solve-form').onsubmit = async event => {
  event.preventDefault();
  try {
    const answers = [...$('worksheet-questions').querySelectorAll('input')].map(input => Number(input.value));
    const response = await apiFetch('/api/worksheets/' + solvingWorksheet.id + '/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answers})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not submit worksheet.');
    $('worksheet-solve-dialog').close(); await loadWorksheets();
  } catch (error) { $('worksheet-solve-error').textContent = error.message; }
};
$('close-worksheet-review').onclick = $('cancel-worksheet-review').onclick = () => $('worksheet-review-dialog').close();
$('worksheet-review-progress').oninput = () => $('worksheet-review-value').textContent = $('worksheet-review-progress').value + '%';
$('worksheet-review-form').onsubmit = async event => {
  event.preventDefault();
  try {
    const response = await apiFetch('/api/worksheets/' + reviewingWorksheet.id + '/review',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({progress:$('worksheet-review-progress').value,note:$('worksheet-review-note').value})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save progress.');
    $('worksheet-review-dialog').close(); await loadStudents(); await loadWorksheets();
  } catch (error) { $('worksheet-review-error').textContent = error.message; }
};
setInterval(() => {
  if (portalRole === 'admin' && !$('admin-fees-view').classList.contains('hidden')) loadFees();
  if (portalRole === 'student' && !$('student-fees-view').classList.contains('hidden')) loadFees();
}, 15000);

function value() { return upper.reduce((sum, active, i) => sum + (active * 5 + lower[i]) * 10 ** (3 - i), 0); }
function renderAbacus(focusBead=null) {
  const board = $('abacus'); board.replaceChildren();
  let restoredFocus = null;
  for (let rod = 0; rod < 4; rod++) {
    const column = document.createElement('div'); column.className = 'rod';
    const top = document.createElement('div'); top.className = 'upper-zone';
    const upperBead = document.createElement('button'); upperBead.className = 'bead'; upperBead.type = 'button';
    upperBead.setAttribute('aria-label', places[rod] + ': five bead'); upperBead.setAttribute('aria-pressed', String(upper[rod]));
    if (focusBead?.rod === rod && focusBead.kind === 'upper') restoredFocus = upperBead;
    upperBead.onclick = () => { upper[rod] = !upper[rod]; renderAbacus({rod,kind:'upper'}); };
    top.append(upperBead);
    const bottom = document.createElement('div'); bottom.className = 'lower-zone';
    const activeStack = document.createElement('div'); activeStack.className = 'active-stack';
    const inactiveStack = document.createElement('div'); inactiveStack.className = 'inactive-stack';
    for (let n = 4; n >= 1; n--) {
      const active = n <= lower[rod];
      const bead = document.createElement('button'); bead.type = 'button'; bead.className = 'bead' + (active ? ' active' : '');
      bead.setAttribute('aria-label', places[rod] + ': set lower beads to ' + n);
      bead.setAttribute('aria-pressed', String(active));
      if (focusBead?.rod === rod && focusBead.kind === 'lower' && focusBead.number === n) restoredFocus = bead;
      bead.onclick = () => { lower[rod] = lower[rod] === n ? n - 1 : n; renderAbacus({rod,kind:'lower',number:n}); };
      (active ? activeStack : inactiveStack).append(bead);
    }
    bottom.append(activeStack, inactiveStack);
    const label = document.createElement('span'); label.className = 'place-label'; label.textContent = places[rod];
    column.append(top,bottom,label); board.append(column);
  }
  $('abacus-value').textContent = String(value()).padStart(4,'0');
  restoredFocus?.focus({preventScroll:true});
}
$('reset-abacus').onclick = () => { upper.fill(false); lower.fill(0); $('feedback').textContent = ''; renderAbacus(); };
const challengeRange = {Beginner:[1,99],'Level 1':[100,999],'Level 2':[1000,4999],'Level 3':[5000,9999]};
async function submitChallenge() {
  if (portalRole !== 'student' || savingAnswer || !activeChallenge) return;
  clearInterval(challengeTimer);
  savingAnswer = true;
  $('check-answer').disabled = true;
  $('new-challenge').disabled = true;
  try {
    const response = await apiFetch('/api/challenges/' + activeChallenge.id + '/answer',
      {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answer:value()})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save practice.');
    activeChallenge = null;
    if (result.promoted) {
      currentStudent.level = result.level;
      currentStudent.progress = 0;
      currentStudent.mastery_streak = 0;
      renderStudentHome();
      $('feedback').textContent = 'Level up! Five correct timed challenges in a row. Your next level is ' + result.level + '.';
    } else if (result.correct && result.on_time) {
      currentStudent.mastery_streak = result.mastery_streak;
      renderStudentHome();
      $('feedback').textContent = result.level === 'Level 3' && result.mastery_streak === result.mastery_required ?
        'Correct and on time! You mastered the highest available level.' :
        'Correct and on time! ' + result.mastery_streak + ' of ' + result.mastery_required + ' in a row toward the next level.';
    } else if (result.correct) {
      currentStudent.mastery_streak = 0; renderStudentHome();
      $('feedback').textContent = 'Correct, but the time limit passed. Try another challenge to level up.';
    } else {
      currentStudent.mastery_streak = 0; renderStudentHome();
      $('feedback').textContent = result.on_time ? 'Not quite. Try another challenge.' : 'Time is up. Try another challenge.';
    }
    $('challenge-mastery').textContent = 'Timed mastery: ' + result.mastery_streak + ' / ' + result.mastery_required;
    $('challenge-time').textContent = result.on_time ? 'Complete' : 'Time up';
    await loadSessions();
  } catch (error) { activeChallenge = null; $('feedback').textContent = error.message; }
  finally { savingAnswer = false; $('new-challenge').disabled = false; }
}
$('check-answer').onclick = submitChallenge;
$('new-challenge').onclick = async () => {
  if (portalRole !== 'student' || savingAnswer || activeChallenge) return;
  clearInterval(challengeTimer);
  activeChallenge = null;
  $('new-challenge').disabled = true;
  $('check-answer').disabled = true;
  $('challenge-time').textContent = 'Starting…';
  $('feedback').textContent = '';
  try {
    const requestStartedAt = performance.now();
    const response = await apiFetch('/api/challenges', {method:'POST'});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not start practice.');
    activeChallenge = result;
    upper.fill(false); lower.fill(0); renderAbacus();
    const [, maximum] = challengeRange[result.level];
    $('challenge-level').textContent = result.level + ' · ' + (maximum < 100 ? 'up to 2 digits' : maximum < 1000 ? '3 digits' : '4 digits') + ' practice';
    $('challenge-hint').textContent = maximum < 100 ? 'Use the tens and ones rods.' : maximum < 1000 ? 'Build hundreds, tens, then ones.' : 'Build thousands, hundreds, tens, then ones.';
    $('challenge-mastery').textContent = 'Timed mastery: ' + result.mastery_streak + ' / ' + result.mastery_required;
    $('target').textContent = String(result.target);
    $('check-answer').disabled = false;
    // The challenge starts before its response reaches the phone. Start the visible clock
    // at request dispatch so it never promises more time than the attempt allows.
    const deadline = requestStartedAt + result.duration_seconds * 1000;
    function tick() {
      const remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
      $('challenge-time').textContent = remaining + 's';
      if (remaining === 0) submitChallenge();
    }
    tick();
    challengeTimer = setInterval(tick, 250);
  } catch (error) { $('challenge-time').textContent = '—'; $('feedback').textContent = error.message; }
  finally { $('new-challenge').disabled = Boolean(activeChallenge); }
};
renderAbacus(); restoreSession();
